import { NativeGraphStore } from '../../../infrastructure/native/native-graph.store';
import { NativeSearchIndex, fold } from '../../../infrastructure/native/native-search';
import { NativeSearchStore } from '../../../infrastructure/native/native-search.store';
import { fixtureGraph } from '../../../infrastructure/native/testing/graph-fixture';
import { NativeGeocodingProvider } from './native-geocoding.provider';

const GYE = { latitude: -2.19, longitude: -79.89 };
const CUE = { latitude: -2.9, longitude: -79.0 };

const entries = [
  {
    n: 'Guayaquil',
    k: 'place',
    t: 'city',
    x: -79.9,
    y: -2.18,
    r: 94,
    d: 'Guayas',
    b: [-80.0, -2.3, -79.8, -2.0] as [number, number, number, number],
  },
  {
    n: 'Terminal Terrestre de Guayaquil',
    k: 'poi',
    t: 'bus_station',
    c: 'bus',
    x: -79.886,
    y: -2.142,
    r: 66,
    d: 'Terminal de buses · Guayaquil, Guayas',
  },
  {
    n: 'Terminal Terrestre de Cuenca',
    k: 'poi',
    t: 'bus_station',
    c: 'bus',
    x: -78.99,
    y: -2.89,
    r: 66,
    d: 'Terminal de buses · Cuenca, Azuay',
  },
  {
    n: 'Av. 9 de Octubre',
    k: 'street',
    t: 'avenida',
    x: -79.885,
    y: -2.19,
    r: 58,
    d: 'Guayaquil, Guayas',
  },
  { n: 'C. Boyacá', k: 'street', t: 'calle', x: -79.884, y: -2.191, r: 46, d: 'Guayaquil, Guayas' },
  { n: 'C. Guayaquil', k: 'street', t: 'calle', x: -78.5, y: -0.2, r: 44, d: 'Quito, Pichincha' },
  {
    n: 'Hospital Luis Vernaza',
    k: 'poi',
    t: 'hospital',
    c: 'hospital',
    x: -79.88,
    y: -2.188,
    r: 64,
    d: 'Hospital · Guayaquil, Guayas',
  },
  {
    n: 'Av. 12 S-E - Malecón Simón Bolívar Palacios',
    k: 'street',
    t: 'avenida',
    x: -79.879,
    y: -2.195,
    r: 60,
    d: 'Guayaquil, Guayas',
    a: ['Malecón 2000', 'Malecon Simon Bolivar Palacios'],
  },
];

describe('NativeSearchIndex', () => {
  const index = NativeSearchIndex.fromEntries(entries);

  it('folds accents, case and punctuation', () => {
    expect(fold('Malecón Simón-Bolívar')).toBe('malecon simon bolivar');
  });

  it('ranks the city first for its name', () => {
    expect(index.search('guayaquil', { limit: 5 })[0].name).toBe('Guayaquil');
  });

  it('keeps an exact major place ahead of a nearby street containing its name', () => {
    const local = NativeSearchIndex.fromEntries([
      { n: 'Machala', k: 'place', t: 'city', x: -79.96, y: -3.26, r: 88 },
      { n: 'Av. Machala', k: 'street', t: 'avenida', x: -79.955, y: -3.258, r: 60 },
    ]);
    expect(
      local.search('Machala', { limit: 5, near: { latitude: -3.258, longitude: -79.955 } })[0].name,
    ).toBe('Machala');
  });

  it('puts a distant city before the local streets named after it', () => {
    const local = NativeSearchIndex.fromEntries([
      {
        n: 'Av. 1D S-E - Ambato',
        a: ['Ambato'],
        k: 'street',
        t: 'avenida',
        x: -79.885,
        y: -2.195,
        r: 58,
      },
      { n: 'Ambato', k: 'place', t: 'city', x: -78.6167, y: -1.2491, r: 88 },
    ]);
    expect(local.search('Ambato', { limit: 5, near: GYE }).map((hit) => hit.name)).toEqual([
      'Ambato',
      'Av. 1D S-E - Ambato',
    ]);
    // With the street type the street is meant.
    expect(local.search('Av. Ambato', { limit: 5, near: GYE })[0].name).toBe('Av. 1D S-E - Ambato');
  });

  it('completes the last word and prefers what is near', () => {
    const nearGuayaquil = index
      .search('terminal terr', { limit: 5, near: GYE })
      .map((hit) => hit.name);
    expect(nearGuayaquil.slice(0, 2)).toEqual([
      'Terminal Terrestre de Guayaquil',
      'Terminal Terrestre de Cuenca',
    ]);
    const nearCuenca = index
      .search('terminal terr', { limit: 5, near: CUE })
      .map((hit) => hit.name);
    expect(nearCuenca[0]).toBe('Terminal Terrestre de Cuenca');
  });

  it('accepts city or province words that only appear in the context', () => {
    const hits = index.search('terminal cuenca', { limit: 5 });
    expect(hits.map((hit) => hit.name)).toEqual(['Terminal Terrestre de Cuenca']);
  });

  it('finds the context word in any order, even when it also names other entries', () => {
    const local = NativeSearchIndex.fromEntries([
      {
        n: 'Hospital del Río',
        k: 'poi',
        t: 'hospital',
        c: 'hospital',
        x: -79.01,
        y: -2.88,
        r: 60,
        d: 'Hospital · Cuenca, Azuay',
      },
      {
        n: 'C. Azuay',
        k: 'street',
        t: 'calle',
        x: -79.884,
        y: -2.19,
        r: 46,
        d: 'Guayaquil, Guayas',
      },
    ]);
    for (const text of ['hospital azuay', 'azuay hospital']) {
      expect(local.search(text, { limit: 5 }).map((hit) => hit.name)).toEqual(['Hospital del Río']);
    }
  });

  it('finds plurals and popular names', () => {
    expect(index.search('hospitales', { limit: 5 })[0].name).toBe('Hospital Luis Vernaza');
    expect(index.search('malecon 2000', { limit: 5 })[0].name).toBe(
      'Av. 12 S-E - Malecón Simón Bolívar Palacios',
    );
    expect(index.search('Malecón Simón Bolívar', { limit: 5 })[0].name).toBe(
      'Av. 12 S-E - Malecón Simón Bolívar Palacios',
    );
  });

  it('treats road-type words as optional', () => {
    expect(index.search('avenida 9 de octubre', { limit: 5 })[0].name).toBe('Av. 9 de Octubre');
    expect(index.search('calle boyaca', { limit: 5 })[0].name).toBe('C. Boyacá');
  });

  it('returns nothing for unknown words', () => {
    expect(index.search('zzzzqqq', { limit: 5 })).toEqual([]);
  });
});

describe('NativeGeocodingProvider', () => {
  // Av. 9 de Octubre (west-east) crosses C. Boyacá (south-north) at node 1.
  const graph = fixtureGraph({
    nodes: [
      [-79.886, -2.19],
      [-79.885, -2.19],
      [-79.884, -2.19],
      [-79.885, -2.191],
      [-79.885, -2.189],
    ],
    edges: [
      { u: 0, v: 1, name: 'Av. 9 de Octubre', cls: 'secondary', parish: 0 },
      { u: 1, v: 2, name: 'Av. 9 de Octubre', cls: 'secondary', parish: 0 },
      { u: 3, v: 1, name: 'C. Boyacá', parish: 0 },
      { u: 1, v: 4, name: 'C. Boyacá', parish: 0 },
    ],
    parishes: [{ code: '090150', parish: 'Guayaquil', canton: 'Guayaquil', province: 'Guayas' }],
  });
  const graphStore = {
    get: () => Promise.resolve(graph),
    available: () => Promise.resolve(true),
  } as unknown as NativeGraphStore;
  const searchStore = {
    get: () => Promise.resolve(NativeSearchIndex.fromEntries(entries)),
    available: () => Promise.resolve(true),
  } as unknown as NativeSearchStore;
  const provider = new NativeGeocodingProvider(searchStore, graphStore);

  it('resolves street intersections to the junction', async () => {
    const [first] = await provider.search({ text: '9 de octubre y boyaca', limit: 5, near: GYE });
    expect(first.type).toBe('intersection');
    expect(first.name).toBe('Av. 9 de Octubre y C. Boyacá');
    expect(first.longitude).toBeCloseTo(-79.885, 6);
    expect(first.latitude).toBeCloseTo(-2.19, 6);
  });

  it('answers places with their context', async () => {
    const [first] = await provider.search({ text: 'terminal terrestre', limit: 5, near: GYE });
    expect(first.name).toBe('Terminal Terrestre de Guayaquil');
    expect(first.displayName).toBe(
      'Terminal Terrestre de Guayaquil, Terminal de buses · Guayaquil, Guayas',
    );
    expect(first.address.countryCode).toBe('EC');
  });

  it('answers only when the requested countries include Ecuador', async () => {
    expect(
      await provider.search({ text: 'terminal terrestre', limit: 5, countryCodes: ['pe'] }),
    ).toEqual([]);
    expect(
      await provider.search({
        text: '9 de octubre y boyaca',
        limit: 5,
        countryCodes: ['PE', 'CO'],
      }),
    ).toEqual([]);
    const [first] = await provider.search({
      text: 'terminal terrestre',
      limit: 5,
      countryCodes: ['pe', 'ec'],
    });
    expect(first.address.countryCode).toBe('EC');
  });

  it('reverse geocodes to the nearest named street and its parish', async () => {
    const result = await provider.reverse(-2.19002, -79.8855);
    expect(result?.name).toBe('Av. 9 de Octubre');
    expect(result?.address.city).toBe('Guayaquil');
    expect(result?.address.state).toBe('Guayas');
  });
});
