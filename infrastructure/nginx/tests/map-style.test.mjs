// Unit tests of the browser map style module shared by the viewer and the SDK (Node's test runner):
//   node --test 'infrastructure/nginx/tests/*.test.mjs'
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pmtilesLoader } from '../html/sdk/map-style.js';

const TILE = { url: 'pmtiles://https://maps.example/maps/quito.pmtiles?v=abc/14/4783/8195', type: 'arrayBuffer' };
const TILEJSON = { url: 'pmtiles://https://maps.example/maps/quito.pmtiles?v=abc', type: 'json' };

/** The parts of the pmtiles library the loader uses; `answer` decides each byte read. */
function fakeLibrary(answer) {
  const reads = [];
  class FetchSource {
    constructor(url) {
      this.url = url;
      this.chromeWindowsNoCache = false;
    }

    getKey() {
      return this.url;
    }

    async getBytes(offset, length, signal) {
      reads.push({ offset, length, uncached: this.chromeWindowsNoCache });
      return answer(reads.length, { offset, length, signal });
    }
  }
  class PMTiles {
    constructor(source) {
      this.source = source;
    }
  }
  class Protocol {
    constructor() {
      this.tiles = new Map();
      Protocol.last = this;
    }

    add(instance) {
      this.tiles.set(instance.source.getKey(), instance);
    }

    get(url) {
      return this.tiles.get(url);
    }

    // Like the library: one archive per URL, a tile is one range of it.
    async tile(params, abortController) {
      const url = params.type === 'json'
        ? params.url.slice('pmtiles://'.length)
        : params.url.match(/^pmtiles:\/\/(.+)\/\d+\/\d+\/\d+$/)[1];
      const { data } = await this.get(url).source.getBytes(4096, 512, abortController.signal);
      return { data };
    }
  }
  return { library: { FetchSource, PMTiles, Protocol }, reads };
}

const whole = (_, { length }) => ({ data: new ArrayBuffer(length) });

test('a range that comes back incomplete is read again past the browser cache', async () => {
  const { library, reads } = fakeLibrary((count, read) => (count === 1 ? { data: new ArrayBuffer(100) } : whole(count, read)));
  const result = await pmtilesLoader(library, { delayMs: 0 })(TILE, new AbortController());
  assert.equal(result.data.byteLength, 512);
  assert.deepEqual(reads.map((read) => read.uncached), [false, true]);
});

test('a network error is retried and a lasting one is reported', async () => {
  const flaky = fakeLibrary((count, read) => {
    if (count === 1) throw new TypeError('Failed to fetch');
    return whole(count, read);
  });
  assert.equal((await pmtilesLoader(flaky.library, { delayMs: 0 })(TILE, new AbortController())).data.byteLength, 512);
  assert.equal(flaky.reads.length, 2);

  const down = fakeLibrary(() => {
    throw new TypeError('Failed to fetch');
  });
  await assert.rejects(pmtilesLoader(down.library, { delayMs: 0 })(TILE, new AbortController()), TypeError);
  assert.equal(down.reads.length, 3);
});

test('HTTP errors and cancelled requests are not retried', async () => {
  const missing = fakeLibrary(() => {
    throw new Error('Bad response code: 404');
  });
  await assert.rejects(pmtilesLoader(missing.library, { delayMs: 0 })(TILE, new AbortController()), /404/);
  assert.equal(missing.reads.length, 1);

  const controller = new AbortController();
  const cancelled = fakeLibrary(() => {
    controller.abort();
    throw new TypeError('Failed to fetch');
  });
  await assert.rejects(pmtilesLoader(cancelled.library, { delayMs: 0 })(TILE, controller), TypeError);
  assert.equal(cancelled.reads.length, 1);
});

test('the header of a small archive may be shorter than the 16 KiB asked for', async () => {
  const { library } = fakeLibrary(() => ({ data: new ArrayBuffer(900) }));
  const load = pmtilesLoader(library, { delayMs: 0 });
  await load(TILEJSON, new AbortController()).catch(() => {});
  const archive = library.Protocol.last.get('https://maps.example/maps/quito.pmtiles?v=abc');
  assert.equal((await archive.source.getBytes(0, 16384)).data.byteLength, 900);
});

test('the TileJSON and the tiles of an archive share one reader', async () => {
  const { library } = fakeLibrary(whole);
  const load = pmtilesLoader(library, { delayMs: 0 });
  await load(TILEJSON, new AbortController());
  const first = library.Protocol.last.get('https://maps.example/maps/quito.pmtiles?v=abc');
  await load(TILE, new AbortController());
  assert.equal(library.Protocol.last.tiles.size, 1);
  assert.equal(library.Protocol.last.get('https://maps.example/maps/quito.pmtiles?v=abc'), first);
});
