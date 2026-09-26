import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeText, WorldPlace, WorldPlaceIndex } from './world-place-index';

const PLACES: WorldPlace[] = [
  {
    type: 'country',
    name: 'Peru',
    nameEs: 'Perú',
    countryCode: 'PE',
    country: 'Peru',
    countryEs: 'Perú',
    lat: -9.15,
    lng: -74.38,
    population: 32_510_453,
    bbox: [-81.41, -18.35, -68.67, -0.04],
  },
  {
    type: 'country',
    name: 'Colombia',
    countryCode: 'CO',
    country: 'Colombia',
    lat: 3.9,
    lng: -73.07,
    population: 50_339_443,
  },
  {
    type: 'city',
    name: 'Lima',
    countryCode: 'PE',
    country: 'Peru',
    countryEs: 'Perú',
    admin1: 'Lima',
    capital: '2',
    lat: -12.04641,
    lng: -77.04275,
    population: 8_950_000,
  },
  {
    type: 'city',
    name: 'Lima',
    countryCode: 'US',
    country: 'United States of America',
    countryEs: 'Estados Unidos',
    admin1: 'Ohio',
    lat: 40.7429,
    lng: -84.1052,
    population: 38_355,
  },
  {
    type: 'city',
    name: 'Guayaquil',
    countryCode: 'EC',
    country: 'Ecuador',
    admin1: 'Guayas',
    capital: '4',
    lat: -2.22,
    lng: -79.92,
    population: 2_514_000,
  },
  {
    type: 'city',
    name: 'São Paulo',
    nameEs: 'São Paulo',
    countryCode: 'BR',
    country: 'Brazil',
    countryEs: 'Brasil',
    admin1: 'São Paulo',
    capital: '4',
    lat: -23.55868,
    lng: -46.62502,
    population: 18_845_000,
  },
];

describe('WorldPlaceIndex', () => {
  let dir: string;
  let file: string;

  const write = (places: unknown[]) =>
    writeFileSync(file, JSON.stringify({ version: 1, source: 'Natural Earth', places }));
  const search = (index: WorldPlaceIndex, text: string, extra: object = {}) =>
    index.search({ text, limit: 10, ...extra });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'world-places-'));
    file = join(dir, 'world.places.json');
    write(PLACES);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('normalizes accents, case and punctuation', () => {
    expect(normalizeText('  São  Paulo, Brasil! ')).toBe('sao paulo brasil');
    expect(normalizeText('Perú')).toBe('peru');
  });

  it('finds capitals before smaller places with the same name', async () => {
    const matches = await search(new WorldPlaceIndex(file), 'Lima');

    expect(matches.map((match) => match.result.displayName)).toEqual([
      'Lima, Perú',
      'Lima, Ohio, Estados Unidos',
    ]);
    expect(matches[0].important).toBe(true);
    expect(matches[1].important).toBe(false);
    expect(matches[0].result).toMatchObject({
      name: 'Lima',
      latitude: -12.04641,
      longitude: -77.04275,
      category: 'place',
      type: 'capital',
      address: { city: 'Lima', country: 'Perú', countryCode: 'PE' },
      bbox: null,
    });
  });

  it('narrows the search with the country or province after the name', async () => {
    const index = new WorldPlaceIndex(file);

    expect((await search(index, 'Lima, Ohio')).map((m) => m.result.displayName)).toEqual([
      'Lima, Ohio, Estados Unidos',
    ]);
    // Without a comma the last word is tried as the country.
    expect((await search(index, 'lima peru')).map((m) => m.result.displayName)).toEqual([
      'Lima, Perú',
    ]);
  });

  it('matches without accents, by prefix and by any word of the name', async () => {
    const index = new WorldPlaceIndex(file);

    expect((await search(index, 'sao paulo'))[0].result.name).toBe('São Paulo');
    const colombia = await search(index, 'Colom');
    expect(colombia[0].result).toMatchObject({ name: 'Colombia', type: 'country' });
    expect(colombia[0].important).toBe(true);
    const paulo = await search(index, 'paulo');
    expect(paulo[0].result.name).toBe('São Paulo');
    expect(paulo[0].important).toBe(false);
  });

  it('returns countries with their bounding box and Spanish name', async () => {
    const [peru] = await search(new WorldPlaceIndex(file), 'peru');

    expect(peru.result).toMatchObject({
      displayName: 'Perú',
      name: 'Perú',
      type: 'country',
      bbox: [-81.41, -18.35, -68.67, -0.04],
      sourceId: 'naturalearth:country:PE',
    });
  });

  it('honours an explicit country filter and the limit', async () => {
    const index = new WorldPlaceIndex(file);

    expect(await search(index, 'Guayaquil', { countryCodes: ['ec'] })).toHaveLength(1);
    expect(await search(index, 'Guayaquil', { countryCodes: ['pe'] })).toHaveLength(0);
    expect(await search(index, 'Lima', { limit: 1 })).toHaveLength(1);
  });

  it('is empty without the file and reloads it when it changes', async () => {
    let now = 0;
    const index = new WorldPlaceIndex(join(dir, 'missing.json'), 60_000, () => now);
    expect(await index.available()).toBe(false);
    expect(await search(index, 'Lima')).toEqual([]);

    const changing = new WorldPlaceIndex(file, 60_000, () => now);
    expect(await search(changing, 'Quito')).toEqual([]);
    write([
      {
        type: 'city',
        name: 'Quito',
        countryCode: 'EC',
        country: 'Ecuador',
        capital: '2',
        lat: -0.21,
        lng: -78.5,
        population: 1_701_000,
      },
    ]);
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(await search(changing, 'Quito')).toEqual([]); // re-checked at most once a minute
    now = 61_000;
    expect((await search(changing, 'Quito'))[0].result.displayName).toBe('Quito, Ecuador');
  });
});
