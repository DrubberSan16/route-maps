import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NativeGraph } from '../../infrastructure/native/native-graph';
import {
  FIXTURE_DIR,
  FOLD_TABLE_FILE,
  buildFixtureFiles,
  foldTable,
  routeAnswers,
} from './expectations';

const REGENERATE = 'run `npm run fixtures:offline` in backend/ to regenerate the offline fixture';

/** One section of an offline pack (format in infrastructure/data-tools/lib/mapsdata/offline_pack.py). */
function packSection(pack: Buffer, name: string): Buffer {
  expect(pack.subarray(0, 8).toString('latin1')).toBe('RMPACK01');
  const length = pack.readUInt32LE(8);
  const header = JSON.parse(pack.subarray(12, 12 + length).toString('utf8')) as {
    format: string;
    sections: { name: string; offset: number; length: number }[];
  };
  expect(header.format).toBe('route-maps-offline-pack');
  const dataOffset = Math.ceil((12 + length) / 8) * 8;
  const section = header.sections.find((item) => item.name === name);
  if (!section) throw new Error(`The pack has no ${name} section`);
  return pack.subarray(dataOffset + section.offset, dataOffset + section.offset + section.length);
}

describe('offline parity fixture', () => {
  it('matches what the native engines answer on the fixture city', async () => {
    const files = await buildFixtureFiles();
    for (const [name, content] of Object.entries(files)) {
      const current = readFileSync(join(FIXTURE_DIR, name)).equals(Buffer.from(content));
      if (!current) throw new Error(`${name} is out of date: ${REGENERATE}`);
    }
    if (readFileSync(FOLD_TABLE_FILE, 'utf8') !== foldTable()) {
      throw new Error(`The fold table of the mobile app is out of date: ${REGENERATE}`);
    }
  });

  it('routes on the graph of the offline pack exactly as on the region graph', () => {
    const pack = readFileSync(join(FIXTURE_DIR, 'fixture.rmpack'));
    const graph = NativeGraph.parse(packSection(pack, 'graph'));
    const expected = (
      JSON.parse(readFileSync(join(FIXTURE_DIR, 'expected.json'), 'utf8')) as {
        routes: unknown[];
      }
    ).routes;
    expect(JSON.parse(JSON.stringify(routeAnswers(graph)))).toEqual(expected);
  });
});
