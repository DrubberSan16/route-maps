// Unit tests of the administration panel's browser modules (Node's test runner):
//   node --test 'infrastructure/nginx/tests/*.test.mjs'
// The modules that build the screens need a browser and are checked by importing them, which
// fails when a module asks another for something it does not export.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { niceScale } from '../html/admin/js/chart.js';
import {
  countOf,
  errorText,
  formatBytes,
  formatDateTime,
  formatDay,
  formatDistance,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRelative,
  label,
  maskedKey,
  ROLE_LABELS,
} from '../html/admin/js/format.js';
import { bboxOf, circlePolygon, distanceMeters, polygonFrom } from '../html/admin/js/map.js';
import { buildHash, dayRange, pages, parseHash, toQuery } from '../html/admin/js/router.js';
import { ApiError, createApi, Session } from '../html/admin/js/session.js';

const ADMIN_JS = fileURLToPath(new URL('../html/admin/js/', import.meta.url));

// ---------------------------------------------------------------- modules

test('every module of the panel links (named imports exist)', async () => {
  const files = [
    ...readdirSync(ADMIN_JS).filter((name) => name.endsWith('.js') && name !== 'app.js'),
    ...readdirSync(join(ADMIN_JS, 'views')).filter((name) => name.endsWith('.js')).map((name) => `views/${name}`),
  ];
  assert.ok(files.length >= 20);
  for (const file of files) {
    await assert.doesNotReject(import(pathToFileURL(join(ADMIN_JS, file)).href), file);
  }
});

// ---------------------------------------------------------------- formatting

test('formats distances, durations, sizes and numbers in Spanish', () => {
  assert.equal(formatDistance(850), '850 m');
  assert.equal(formatDistance(12_345), '12,3 km');
  assert.equal(formatDistance(250_000), '250 km');
  assert.equal(formatDistance(null), '—');
  assert.equal(formatDuration(45), '45 s');
  assert.equal(formatDuration(720), '12 min');
  assert.equal(formatDuration(3900), '1 h 05 min');
  assert.equal(formatDuration(7200), '2 h');
  assert.equal(formatDuration(86_400), '1 d');
  assert.equal(formatDuration(183_600), '2 d 3 h');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1,5 KB');
  assert.equal(formatBytes(3.5 * 1024 ** 3), '3,5 GB');
  assert.equal(formatNumber(12_345), '12.345');
  assert.equal(countOf(1, 'viaje', 'viajes'), '1 viaje');
  assert.equal(countOf(0, 'viaje', 'viajes'), '0 viajes');
  assert.equal(countOf(12_000, 'solicitud', 'solicitudes'), '12.000 solicitudes');
  assert.equal(formatPercent(1, 3), '33,3 %');
  assert.equal(formatPercent(1, 0), '—');
});

test('writes dates in the platform time zone and relative to now', () => {
  assert.equal(formatDateTime('2026-10-07T19:32:00Z', 'America/Guayaquil'), '7 oct 2026, 14:32');
  assert.equal(formatDateTime('not a date', 'UTC'), '—');
  assert.equal(formatDay('2026-10-07'), '7 oct');
  const now = Date.parse('2026-10-20T12:00:00Z');
  assert.equal(formatRelative(now - 3 * 60_000, now), 'hace 3 min');
  assert.equal(formatRelative(now - 86_400_000, now), 'ayer');
  assert.equal(formatRelative(now + 2 * 3_600_000, now), 'dentro de 2 h');
  assert.equal(formatRelative(now - 5000, now), 'ahora');
  assert.equal(formatRelative(now - 10 * 86_400_000, now, 'UTC'), '10 oct 2026');
});

test('shows stored API keys masked and labels with a fallback', () => {
  assert.equal(maskedKey({ prefix: 'ab12cd34', lastFour: 'wxyz' }), 'rmk_ab12cd34_…wxyz');
  assert.equal(label(ROLE_LABELS, 'OPERATOR'), 'Operador');
  assert.equal(label(ROLE_LABELS, 'NEW_ROLE'), 'NEW_ROLE');
  assert.equal(label(ROLE_LABELS, undefined), '—');
});

test('explains API errors, keeping what to correct', () => {
  assert.equal(
    errorText({ code: 'VALIDATION_ERROR', message: 'Validation failed', details: ['url must be a URL', 'events should not be empty'] }),
    'Revisa los datos del formulario. (url must be a URL; events should not be empty)',
  );
  assert.equal(
    errorText({ code: 'CONFLICT', message: 'The account has integrations' }),
    'No se puede hacer ese cambio ahora. (The account has integrations)',
  );
  assert.equal(errorText({ code: 'SESSION_REVOKED' }), 'Un administrador cerró tu sesión. Inicia sesión de nuevo.');
  assert.equal(errorText({ code: 'SOMETHING_NEW', message: 'Server said no' }), 'Server said no');
  assert.equal(errorText(undefined), 'Ocurrió un error inesperado.');
});

// ---------------------------------------------------------------- addresses

test('reads and writes the address of a screen', () => {
  assert.deepEqual(parseHash('#/viajes/abc?status=ACTIVE&q=a%20b'), {
    segments: ['viajes', 'abc'],
    query: { status: 'ACTIVE', q: 'a b' },
  });
  assert.deepEqual(parseHash(''), { segments: [], query: {} });
  assert.equal(buildHash(['integraciones', 'x y'], { tab: 'llaves', empty: '', none: undefined }), '#/integraciones/x%20y?tab=llaves');
  assert.equal(buildHash(['resumen']), '#/resumen');
});

test('builds list queries and pages', () => {
  assert.equal(
    toQuery({ limit: 25, offset: 0, q: undefined, status: '', events: ['trip.finished', 'geofence.entered'], none: [] }),
    '?limit=25&offset=0&events=trip.finished%2Cgeofence.entered',
  );
  assert.equal(toQuery({}), '');
  assert.deepEqual(pages({ total: 60, limit: 25, offset: 25 }), { from: 26, to: 50, previous: 0, next: 50 });
  assert.deepEqual(pages({ total: 60, limit: 25, offset: 50 }), { from: 51, to: 60, previous: 25, next: null });
  assert.deepEqual(pages({ total: 0, limit: 25, offset: 0 }), { from: 0, to: 0, previous: null, next: null });
});

test('turns calendar days of the browser into an instant range (end exclusive)', () => {
  assert.deepEqual(dayRange('2026-10-01', '2026-10-07'), {
    from: new Date(2026, 9, 1).toISOString(),
    to: new Date(2026, 9, 8).toISOString(),
  });
  assert.deepEqual(dayRange(undefined, undefined), { from: undefined, to: undefined });
  assert.deepEqual(dayRange('nope', undefined), { from: undefined, to: undefined });
});

// ---------------------------------------------------------------- charts and maps

test('chooses round chart scales', () => {
  assert.deepEqual(niceScale(0), { max: 4, step: 1, ticks: [0, 1, 2, 3, 4] });
  assert.deepEqual(niceScale(3), { max: 3, step: 1, ticks: [0, 1, 2, 3] });
  assert.deepEqual(niceScale(7), { max: 8, step: 2, ticks: [0, 2, 4, 6, 8] });
  assert.deepEqual(niceScale(1234), { max: 1500, step: 500, ticks: [0, 500, 1000, 1500] });
  assert.deepEqual(niceScale(0.3, { integer: false }), { max: 0.3, step: 0.1, ticks: [0, 0.1, 0.2, 0.3] });
});

test('draws circles and polygons as the API stores them', () => {
  const center = { latitude: -2.17, longitude: -79.9 };
  const circle = circlePolygon(center, 1000);
  const ring = circle.coordinates[0];
  assert.equal(circle.type, 'Polygon');
  assert.equal(ring.length, 65);
  assert.deepEqual(ring[0], ring[64]);
  for (const vertex of ring) {
    assert.ok(Math.abs(distanceMeters([center.longitude, center.latitude], vertex) - 1000) < 0.5);
  }

  assert.equal(polygonFrom([[-79.9, -2.1], [-79.8, -2.1]]), null);
  assert.deepEqual(polygonFrom([[-79.9, -2.1], [-79.8, -2.1], [-79.85, -2.000000004]]), {
    type: 'Polygon',
    coordinates: [[[-79.9, -2.1], [-79.8, -2.1], [-79.85, -2], [-79.9, -2.1]]],
  });

  assert.ok(Math.abs(distanceMeters([0, 0], [0, 1]) - 111_195.08) < 0.5);
  assert.deepEqual(bboxOf({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-79.9, -2.2] }, properties: {} },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-80.1, -2.0], [-79.5, -1.5]] }, properties: {} },
    ],
  }), [-80.1, -2.2, -79.5, -1.5]);
  assert.equal(bboxOf({ type: 'FeatureCollection', features: [] }), null);
});

// ---------------------------------------------------------------- session and API calls

const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), {
  status,
  headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
});
const ok = (data) => json(200, { success: true, data });
const failure = (status, code) => json(status, { success: false, error: { code, message: code } });
const tokens = (n, expiresIn = 900) => ({ accessToken: `access-${n}`, refreshToken: `refresh-${n}`, expiresIn, user: { id: 'u1' } });

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}

/** A fetch that records each call and answers with `handler(url, init, calls)`. */
function fakeFetch(handler) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined });
    return handler(url, init, calls);
  };
  return { fetch, calls };
}

test('keeps the refresh token for the tab and renews the access token shortly before it expires', async () => {
  let now = 1_000_000;
  const storage = memoryStorage();
  const server = fakeFetch((url) => (url.endsWith('/auth/login') ? ok(tokens(1)) : ok(tokens(2))));
  const session = new Session({ fetch: server.fetch, storage, now: () => now });

  await session.signIn('admin@example.com', 'secret-password');
  assert.equal(storage.data.get('route-maps-admin:refresh-token'), 'refresh-1');
  assert.equal(await session.accessToken(), 'access-1');
  now += 880_000; // 20 s before it expires: renewed first
  assert.equal(await session.accessToken(), 'access-2');
  assert.deepEqual(server.calls.map((call) => call.url), ['/api/v1/auth/login', '/api/v1/auth/refresh']);
  assert.deepEqual(server.calls[1].body, { refreshToken: 'refresh-1' });
  assert.equal(storage.data.get('route-maps-admin:refresh-token'), 'refresh-2');

  const restored = new Session({ fetch: server.fetch, storage });
  assert.equal(restored.restore(), true);
});

test('shares one renewal among concurrent calls (rotated tokens are never reused)', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const server = fakeFetch(async () => {
    await gate;
    return ok(tokens(2));
  });
  const session = new Session({ fetch: server.fetch, storage: memoryStorage({ 'route-maps-admin:refresh-token': 'refresh-1' }) });
  session.restore();
  const pending = [session.accessToken(), session.accessToken(), session.refresh()];
  release();
  assert.deepEqual(await Promise.all(pending), ['access-2', 'access-2', 'access-2']);
  assert.equal(server.calls.length, 1);
});

test('ends the session when the server refuses the refresh token, not when the network fails', async () => {
  const storage = memoryStorage({ 'route-maps-admin:refresh-token': 'refresh-1' });
  let answer = () => { throw new TypeError('fetch failed'); };
  const server = fakeFetch(() => answer());
  const session = new Session({ fetch: server.fetch, storage });
  const ended = [];
  session.onEnd((code) => ended.push(code));
  session.restore();

  await assert.rejects(session.refresh(), (error) => error instanceof ApiError && error.code === 'OFFLINE');
  answer = () => json(429, undefined);
  await assert.rejects(session.refresh(), (error) => error.code === 'RATE_LIMIT_EXCEEDED');
  assert.deepEqual(ended, []);
  assert.equal(session.signedIn, true);

  answer = () => failure(401, 'ACCOUNT_DISABLED');
  await assert.rejects(session.refresh(), (error) => error.code === 'ACCOUNT_DISABLED');
  assert.deepEqual(ended, ['ACCOUNT_DISABLED']);
  assert.equal(session.signedIn, false);
  assert.equal(storage.data.has('route-maps-admin:refresh-token'), false);
});

test('calls the API with the access token, renewing it once when it expired meanwhile', async () => {
  let accessCalls = 0;
  const server = fakeFetch((url, init) => {
    if (url.endsWith('/auth/refresh')) return ok(tokens(2));
    accessCalls += 1;
    if (init.headers.Authorization === 'Bearer access-1') return failure(401, 'UNAUTHORIZED');
    return ok({ items: [], total: 0 });
  });
  const session = new Session({ fetch: server.fetch, storage: memoryStorage() });
  session.adopt(tokens(1));
  const api = createApi(session, { fetch: server.fetch });

  assert.deepEqual(await api.get('/admin/trips', { status: 'ACTIVE', q: '', limit: 25, offset: 0 }), { items: [], total: 0 });
  assert.equal(accessCalls, 2);
  assert.deepEqual(server.calls.map((call) => `${call.method} ${call.url}`), [
    'GET /api/v1/admin/trips?status=ACTIVE&limit=25&offset=0',
    'POST /api/v1/auth/refresh',
    'GET /api/v1/admin/trips?status=ACTIVE&limit=25&offset=0',
  ]);
  assert.equal(server.calls[2].headers.Authorization, 'Bearer access-2');
});

test('ends the session when an administrator closed it, and maps the proxy rate limit', async () => {
  const server = fakeFetch((url) => (url.includes('/admin/overview') ? failure(401, 'SESSION_REVOKED') : json(429, undefined)));
  const session = new Session({ fetch: server.fetch, storage: memoryStorage() });
  session.adopt(tokens(1));
  const ended = [];
  session.onEnd((code) => ended.push(code));
  const api = createApi(session, { fetch: server.fetch });

  await assert.rejects(api.post('/admin/integrations', { name: 'ERP' }), (error) => error.code === 'RATE_LIMIT_EXCEEDED' && error.status === 429);
  assert.deepEqual(server.calls[0].body, { name: 'ERP' });
  assert.equal(server.calls[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(ended, []);

  await assert.rejects(api.get('/admin/overview'), (error) => error.code === 'SESSION_REVOKED');
  assert.deepEqual(ended, ['SESSION_REVOKED']);
  assert.equal(session.signedIn, false);
});
