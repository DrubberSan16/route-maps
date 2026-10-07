import {
  FLAG_APPROXIMATE,
  FLAG_ROUNDABOUT,
  FLAG_STATE_ROAD,
  FLAG_TUNNEL,
  FLAG_UNPAVED,
  ParishInfo,
  RoadClass,
} from '../../infrastructure/native/native-graph';
import { SearchEntry, fold } from '../../infrastructure/native/native-search';
import { FixtureEdge, FixtureGraph } from '../../infrastructure/native/testing/graph-fixture';

/**
 * A small invented city with everything the native engines handle: a downtown grid with avenues,
 * a pedestrian street, missing blocks, steps and a hillside path, an unpaved track, a tunnel, a
 * roundabout, a state road to a second town, an approximate link to an isolated village and an
 * island no road reaches. Its search index has administrative units, places, neighbourhoods,
 * points of interest with popular names and one entry per street and parish, as the data pipeline
 * writes them (catalog.py).
 *
 * The server's engines answer the queries of fixture-queries.ts on it, and the device engine of
 * the mobile app must give the same answers on the offline pack built from it.
 */

const LON0 = -79.89;
const LAT0 = -2.185;
const STEP = 0.001; // ~111 m
const SIZE = 8;

/** Six decimals, like the coordinates of the data pipeline. */
const fixed = (value: number, digits = 6) => Number(value.toFixed(digits));

export const PARISHES: ParishInfo[] = [
  { code: '090112', parish: 'Rocafuerte', canton: 'Guayaquil', province: 'Guayas' },
  { code: '090150', parish: 'Guayaquil', canton: 'Guayaquil', province: 'Guayas' },
  { code: '090750', parish: 'Eloy Alfaro', canton: 'Durán', province: 'Guayas' },
  { code: '090751', parish: 'El Paraíso', canton: 'Durán', province: 'Guayas' },
];

const nodes: [number, number][] = [];
const edges: FixtureEdge[] = [];

const node = (lon: number, lat: number): number => nodes.push([fixed(lon), fixed(lat)]) - 1;

interface Road {
  name?: string;
  ref?: string;
  cls?: RoadClass;
  flags?: number;
  parish?: number;
  shape?: [number, number][];
}

const road = (u: number, v: number, options: Road = {}) => {
  edges.push({
    u,
    v,
    name: options.name,
    ref: options.ref,
    cls: options.cls ?? 'street',
    flags: options.flags ?? 0,
    parish: options.parish ?? -1,
    shape: options.shape?.map(([lon, lat]) => [fixed(lon), fixed(lat)]),
  });
};

// ------------------------------------------------------------------ downtown grid

/** West-east streets, north to south. */
const ROWS: { name: string; cls: RoadClass }[] = [
  { name: 'C. Junín', cls: 'street' },
  { name: 'C. Vélez', cls: 'street' },
  { name: 'Av. 9 de Octubre', cls: 'primary' },
  { name: 'C. Luque', cls: 'street' },
  { name: 'C. Aguirre', cls: 'street' },
  { name: 'C. Ballén', cls: 'street' },
  { name: 'Av. 10 de Agosto', cls: 'secondary' },
  { name: 'C. Sucre', cls: 'street' },
];
/** South-north streets, west to east. */
const COLUMNS: { name: string; cls: RoadClass }[] = [
  { name: 'Av. Quito', cls: 'secondary' },
  { name: 'C. Pedro Moncayo', cls: 'street' },
  { name: 'C. Boyacá', cls: 'street' },
  { name: 'C. García Avilés', cls: 'street' },
  { name: 'C. Chimborazo', cls: 'street' },
  { name: 'C. Chile', cls: 'street' },
  { name: 'C. Rocafuerte', cls: 'street' },
  { name: 'Malecón Simón Bolívar', cls: 'primary' },
];

const grid: number[][] = [];
for (let row = 0; row < SIZE; row += 1) {
  grid.push([]);
  for (let col = 0; col < SIZE; col += 1) {
    grid[row].push(node(LON0 + col * STEP, LAT0 - row * STEP));
  }
}
/** The west half is the parish of Rocafuerte, the east half the urban parish of Guayaquil. */
const parishOfColumn = (col: number) => (col <= 3 ? 0 : 1);

for (let row = 0; row < SIZE; row += 1) {
  for (let col = 0; col < SIZE - 1; col += 1) {
    // Blocks without a street between them.
    if ((row === 3 && col === 3) || (row === 4 && col === 6)) continue;
    road(grid[row][col], grid[row][col + 1], {
      name: ROWS[row].name,
      cls: ROWS[row].cls,
      parish: parishOfColumn(col),
      // Calle Vélez bends between Boyacá and García Avilés.
      shape:
        row === 1 && col === 2
          ? [
              [LON0 + 2.3 * STEP, LAT0 - 1.15 * STEP],
              [LON0 + 2.7 * STEP, LAT0 - 1.12 * STEP],
            ]
          : undefined,
    });
  }
}
for (let col = 0; col < SIZE; col += 1) {
  for (let row = 0; row < SIZE - 1; row += 1) {
    // Calle Chile is pedestrian between 9 de Octubre and Aguirre.
    const pedestrian = col === 5 && row >= 2 && row < 4;
    road(grid[row][col], grid[row + 1][col], {
      name: COLUMNS[col].name,
      cls: pedestrian ? 'footway' : COLUMNS[col].cls,
      parish: parishOfColumn(col),
    });
  }
}

// ------------------------------------------------------------------ hill, tunnel, track

// Steps up the hill from the north end of the Malecón, a path to the lighthouse and an unnamed
// service lane back down to Calle Junín.
const hill = node(LON0 + 7 * STEP + 0.0004, LAT0 + 0.0008);
const lighthouse = node(LON0 + 7 * STEP - 0.0002, LAT0 + 0.0016);
road(grid[0][7], hill, { name: 'Escalinata Diego Noboa', cls: 'steps', parish: 1 });
road(hill, lighthouse, {
  name: 'Sendero El Faro',
  cls: 'path',
  parish: 1,
  shape: [[LON0 + 7 * STEP + 0.0003, LAT0 + 0.0013]],
});
road(lighthouse, grid[0][6], {
  cls: 'service',
  parish: 1,
  shape: [[LON0 + 6.4 * STEP, LAT0 + 0.0009]],
});

// A tunnel under the hill to the north-west and the avenue beyond it.
const tunnelEnd = node(LON0 - 0.004, LAT0 + 0.003);
const northWest = node(LON0 - 0.0042, LAT0 + 0.006);
road(grid[0][0], tunnelEnd, {
  name: 'Túnel Cerro del Carmen',
  cls: 'primary',
  flags: FLAG_TUNNEL,
  parish: 0,
  shape: [[LON0 - 0.002, LAT0 + 0.0016]],
});
road(tunnelEnd, northWest, { name: 'Av. Pedro Menéndez Gilbert', cls: 'secondary', parish: 0 });

// An unpaved track to the west, to the hamlet of La Toma.
const trackMiddle = node(LON0 - 0.006, LAT0 - 3 * STEP - 0.0005);
const laToma = node(LON0 - 0.012, LAT0 - 0.004);
road(grid[3][0], trackMiddle, {
  name: 'Camino a La Toma',
  cls: 'track',
  flags: FLAG_UNPAVED,
  parish: 0,
  shape: [
    [LON0 - 0.002, LAT0 - 3 * STEP + 0.0002],
    [LON0 - 0.004, LAT0 - 3 * STEP - 0.0001],
  ],
});
road(trackMiddle, laToma, {
  name: 'Camino a La Toma',
  cls: 'track',
  flags: FLAG_UNPAVED,
  parish: 0,
  shape: [[LON0 - 0.009, LAT0 - 0.0037]],
});

// An unnamed street south-west of the grid.
road(grid[7][0], node(LON0 - 0.0006, LAT0 - 7 * STEP - 0.0005), { parish: 0 });

// ------------------------------------------------------------------ roundabout and state road

const CENTER_LON = LON0 + 0.01;
const CENTER_LAT = LAT0 - 2 * STEP;
const RADIUS = 0.0004;
const DIAGONAL = RADIUS * Math.SQRT1_2;
const west = node(CENTER_LON - RADIUS, CENTER_LAT);
const south = node(CENTER_LON, CENTER_LAT - RADIUS);
const east = node(CENTER_LON + RADIUS, CENTER_LAT);
const north = node(CENTER_LON, CENTER_LAT + RADIUS);
// Counter-clockwise, as traffic turns in Ecuador.
for (const [from, to, dLon, dLat] of [
  [west, south, -DIAGONAL, -DIAGONAL],
  [south, east, DIAGONAL, -DIAGONAL],
  [east, north, DIAGONAL, DIAGONAL],
  [north, west, -DIAGONAL, DIAGONAL],
]) {
  road(from, to, {
    cls: 'primary',
    flags: FLAG_ROUNDABOUT,
    parish: 1,
    shape: [[CENTER_LON + dLon, CENTER_LAT + dLat]],
  });
}
road(grid[2][7], west, { name: 'Av. 9 de Octubre', cls: 'primary', parish: 1 });

// North: an unnamed slip road to an avenue.
const slipEnd = node(CENTER_LON, CENTER_LAT + 0.0012);
road(north, slipEnd, { cls: 'connector', parish: 1 });
const roldos1 = node(CENTER_LON + 0.0004, CENTER_LAT + 0.0025);
const roldos2 = node(CENTER_LON + 0.001, CENTER_LAT + 0.004);
road(slipEnd, roldos1, { name: 'Av. Jaime Roldós Aguilera', cls: 'secondary', parish: 1 });
road(roldos1, roldos2, {
  name: 'Av. Jaime Roldós Aguilera',
  cls: 'secondary',
  parish: 1,
  shape: [[CENTER_LON + 0.0006, CENTER_LAT + 0.0033]],
});

// East: the state road E40 to Durán, with a side street half way.
const TOWN_LON = CENTER_LON + 0.045;
const TOWN_LAT = CENTER_LAT - 0.008;
const halfWay = node(CENTER_LON + 0.022, CENTER_LAT - 0.003);
const townEntry = node(TOWN_LON, TOWN_LAT);
road(east, halfWay, {
  name: 'Vía Durán-Tambo',
  ref: 'E40',
  cls: 'primary',
  flags: FLAG_STATE_ROAD,
  shape: [
    [CENTER_LON + 0.004, CENTER_LAT - 0.0002],
    [CENTER_LON + 0.009, CENTER_LAT - 0.0008],
    [CENTER_LON + 0.015, CENTER_LAT - 0.0016],
  ],
});
road(halfWay, townEntry, {
  name: 'Vía Durán-Tambo',
  ref: 'E40',
  cls: 'primary',
  flags: FLAG_STATE_ROAD,
  shape: [
    [CENTER_LON + 0.03, CENTER_LAT - 0.0045],
    [CENTER_LON + 0.038, CENTER_LAT - 0.0062],
  ],
});
road(halfWay, node(CENTER_LON + 0.0222, CENTER_LAT - 0.0045), {
  name: 'C. Los Almendros',
  parish: 2,
});

// ------------------------------------------------------------------ Durán

const TOWN_ROWS = ['C. Principal', 'C. Bolívar', 'C. Rocafuerte'];
const TOWN_COLUMNS: { name: string; cls: RoadClass }[] = [
  { name: 'Av. Nicolás Lapentti', cls: 'secondary' },
  { name: 'C. Sucre', cls: 'street' },
  { name: 'C. Olmedo', cls: 'street' },
];
const town: number[][] = [];
for (let row = 0; row < 3; row += 1) {
  town.push([]);
  for (let col = 0; col < 3; col += 1) {
    town[row].push(
      row === 0 && col === 0 ? townEntry : node(TOWN_LON + col * STEP, TOWN_LAT - row * STEP),
    );
  }
}
for (let row = 0; row < 3; row += 1) {
  for (let col = 0; col < 2; col += 1) {
    road(town[row][col], town[row][col + 1], { name: TOWN_ROWS[row], parish: 2 });
  }
}
for (let col = 0; col < 3; col += 1) {
  for (let row = 0; row < 2; row += 1) {
    road(town[row][col], town[row + 1][col], {
      name: TOWN_COLUMNS[col].name,
      cls: TOWN_COLUMNS[col].cls,
      parish: 2,
    });
  }
}

// ------------------------------------------------------------------ village and island

// El Paraíso has no mapped access road: the pipeline joins it with a straight approximate link.
const VILLAGE_LON = TOWN_LON + 2 * STEP + 0.012;
const VILLAGE_LAT = TOWN_LAT - 2 * STEP - 0.006;
const village0 = node(VILLAGE_LON, VILLAGE_LAT);
const village1 = node(VILLAGE_LON + 0.0012, VILLAGE_LAT);
const village2 = node(VILLAGE_LON + 0.0024, VILLAGE_LAT + 0.0001);
const village3 = node(VILLAGE_LON + 0.0012, VILLAGE_LAT + 0.0008);
road(town[2][2], village0, { cls: 'connector', flags: FLAG_APPROXIMATE });
road(village0, village1, { name: 'C. Única', parish: 3 });
road(village1, village2, { name: 'C. Única', parish: 3 });
road(village1, village3, { name: 'C. La Iglesia', parish: 3 });

// An island south of downtown, with no road to the mainland.
const ISLAND_LON = LON0 + 0.004;
const ISLAND_LAT = LAT0 - 0.035;
const island0 = node(ISLAND_LON, ISLAND_LAT);
const island1 = node(ISLAND_LON + 0.0015, ISLAND_LAT - 0.0004);
const island2 = node(ISLAND_LON + 0.003, ISLAND_LAT - 0.0002);
const island3 = node(ISLAND_LON + 0.003, ISLAND_LAT - 0.0014);
road(island0, island1, { name: 'Sendero Isla Santay', cls: 'footway', parish: 0 });
road(island1, island2, { name: 'Sendero Isla Santay', cls: 'footway', parish: 0 });
road(island2, island3, { name: 'C. de la Isla', parish: 0 });

export const FIXTURE_GRAPH: FixtureGraph = { nodes, edges, parishes: PARISHES };

// ------------------------------------------------------------------ search index

const haversine = ([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const h =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
};

/** "Tarqui, Cuenca, Azuay" without repeated names (catalog.context_line). */
const contextLine = (info: ParishInfo | undefined, locality?: string): string => {
  const parts: string[] = [];
  for (const value of [locality, info?.parish, info?.canton, info?.province]) {
    if (value && !parts.some((part) => fold(part) === fold(value))) parts.push(value);
  }
  return parts.join(', ');
};

const box = (points: [number, number][]): [number, number, number, number] => [
  fixed(Math.min(...points.map(([lon]) => lon)), 5),
  fixed(Math.min(...points.map(([, lat]) => lat)), 5),
  fixed(Math.max(...points.map(([lon]) => lon)), 5),
  fixed(Math.max(...points.map(([, lat]) => lat)), 5),
];

const STREET_TYPES: [string, string, number][] = [
  ['Av. ', 'avenida', 54],
  ['C. ', 'calle', 44],
  ['Vía ', 'via', 58],
  ['Malecón ', 'malecon', 34],
  ['Escalinata ', 'escalinata', 34],
  ['Sendero ', 'sendero', 34],
  ['Camino ', 'camino', 34],
  ['Túnel ', 'tunel', 34],
];

/** Popular names of streets (sources/aliases.json in the real data). */
const STREET_ALIASES: Record<string, string[]> = {
  'Malecón Simón Bolívar': ['Malecón 2000'],
  'Av. 9 de Octubre': ['Avenida Nueve de Octubre'],
};

/** One entry per street and parish, at the middle of its segment closest to its centre. */
function streetEntries(): SearchEntry[] {
  const groups = new Map<string, { name: string; parish: number; edges: FixtureEdge[] }>();
  for (const edge of edges) {
    if (!edge.name || edge.parish === undefined || edge.parish < 0) continue;
    const key = `${edge.name}|${edge.parish}`;
    const group = groups.get(key);
    if (group) group.edges.push(edge);
    else groups.set(key, { name: edge.name, parish: edge.parish, edges: [edge] });
  }
  const entries: SearchEntry[] = [];
  for (const { name, parish, edges: group } of groups.values()) {
    const middles: [number, number, number][] = [];
    const points: [number, number][] = [];
    let length = 0;
    for (const edge of group) {
      const line = [nodes[edge.u], ...(edge.shape ?? []), nodes[edge.v]];
      points.push(...line);
      for (let i = 1; i < line.length; i += 1) {
        const meters = haversine(line[i - 1], line[i]);
        length += meters;
        middles.push([
          (line[i - 1][0] + line[i][0]) / 2,
          (line[i - 1][1] + line[i][1]) / 2,
          meters,
        ]);
      }
    }
    const total = middles.reduce((sum, [, , weight]) => sum + weight, 0) || 1;
    const cx = middles.reduce((sum, [x, , weight]) => sum + x * weight, 0) / total;
    const cy = middles.reduce((sum, [, y, weight]) => sum + y * weight, 0) / total;
    const point = middles.reduce((best, item) =>
      (item[0] - cx) ** 2 + (item[1] - cy) ** 2 < (best[0] - cx) ** 2 + (best[1] - cy) ** 2
        ? item
        : best,
    );
    const [, type, base] = STREET_TYPES.find(([prefix]) => name.startsWith(prefix)) ?? [
      '',
      'calle',
      44,
    ];
    const aliases = STREET_ALIASES[name];
    entries.push({
      n: name,
      k: 'street',
      t: type,
      x: fixed(point[0]),
      y: fixed(point[1]),
      r: base + Math.min(6, Math.floor(length / 1000)),
      d: contextLine(PARISHES[parish]),
      b: box(points),
      p: PARISHES[parish].code,
      ...(aliases ? { a: aliases } : {}),
    });
  }
  return entries;
}

const at = (col: number, row: number, dLon = 0, dLat = 0): [number, number] => [
  fixed(LON0 + col * STEP + dLon),
  fixed(LAT0 - row * STEP + dLat),
];

const poi = (
  name: string,
  [x, y]: [number, number],
  category: string,
  type: string,
  label: string,
  rank: number,
  parish: number,
  extra: Partial<SearchEntry> = {},
): SearchEntry => ({
  n: name,
  k: 'poi',
  t: type,
  x,
  y,
  r: Math.max(26, 72 - rank),
  d: [label, contextLine(PARISHES[parish])].filter(Boolean).join(' · '),
  c: category,
  p: PARISHES[parish].code,
  ...extra,
});

export const FIXTURE_SEARCH: SearchEntry[] = [
  // Administrative units.
  {
    n: 'Guayas',
    k: 'admin',
    t: 'state',
    x: -79.95,
    y: -2.25,
    r: 90,
    d: 'Ecuador',
    b: [-80.5, -3.0, -79.2, -1.5],
    p: '09',
  },
  {
    n: 'Guayaquil',
    k: 'admin',
    t: 'county',
    x: -79.92,
    y: -2.2,
    r: 76,
    d: 'Guayas',
    b: [-80.1, -2.4, -79.85, -2.0],
    p: '0901',
  },
  {
    n: 'Durán',
    k: 'admin',
    t: 'county',
    x: -79.825,
    y: -2.205,
    r: 76,
    d: 'Guayas',
    b: [-79.84, -2.23, -79.8, -2.18],
    p: '0907',
  },
  ...PARISHES.filter(({ parish, canton }) => parish !== canton).map((info, index): SearchEntry => ({
    n: info.parish!,
    k: 'admin',
    t: 'administrative',
    x: [-79.888, -79.83, -79.8205][index],
    y: [-2.189, -2.199, -2.2065][index],
    r: 58,
    d: contextLine({ code: info.code, canton: info.canton, province: info.province }),
    b: [
      [-79.892, -2.193, -79.886, -2.184],
      [-79.836, -2.204, -79.828, -2.192],
      [-79.823, -2.209, -79.818, -2.204],
    ][index] as [number, number, number, number],
    p: info.code,
  })),
  // Built-up areas and localities.
  {
    n: 'Guayaquil',
    k: 'place',
    t: 'city',
    x: -79.886,
    y: -2.188,
    r: 94,
    d: 'Guayas',
    b: [-79.9, -2.2, -79.87, -2.17],
    p: '090150',
    pop: 2650288,
  },
  {
    n: 'Durán',
    k: 'place',
    t: 'town',
    x: -79.834,
    y: -2.196,
    r: 86,
    d: 'Guayas',
    b: [-79.836, -2.198, -79.832, -2.194],
    p: '090750',
    pop: 315724,
  },
  {
    n: 'El Paraíso',
    k: 'place',
    t: 'village',
    x: -79.8193,
    y: -2.2058,
    r: 66,
    d: 'Durán, Guayas',
    b: [-79.8205, -2.2062, -79.8178, -2.2048],
    p: '090751',
  },
  {
    n: 'La Toma',
    k: 'place',
    t: 'hamlet',
    x: fixed(LON0 - 0.012),
    y: fixed(LAT0 - 0.004),
    r: 46,
    d: contextLine(PARISHES[0]),
    p: '090112',
  },
  {
    n: 'Las Peñas',
    k: 'place',
    t: 'suburb',
    x: -79.8828,
    y: -2.1838,
    r: 62,
    d: contextLine(PARISHES[1]),
    b: [-79.8838, -2.1846, -79.8818, -2.183],
    p: '090150',
  },
  {
    n: 'Urdesa Central',
    k: 'place',
    t: 'suburb',
    x: -79.8955,
    y: -2.1815,
    r: 62,
    d: contextLine(PARISHES[0]),
    b: [-79.898, -2.184, -79.893, -2.179],
    p: '090112',
  },
  // Points of interest.
  poi('Hospital Luis Vernaza', at(6, 1, 0.0002, -0.0003), 'hospital', 'hospital', 'Hospital', 8, 1),
  poi('Hospital del Niño', [-79.8338, -2.1963], 'hospital', 'hospital', 'Hospital', 8, 2),
  poi(
    'Centro de Salud Rocafuerte',
    at(1, 4, 0.0004, 0.0002),
    'hospital',
    'clinic',
    'Centro de salud',
    14,
    0,
  ),
  poi(
    'Unidad Educativa Vicente Rocafuerte',
    at(2, 5, 0.0005, -0.0002),
    'school',
    'school',
    'Institución educativa',
    18,
    0,
  ),
  poi('Parque Seminario', at(3, 2, 0.0005, -0.0004), 'park', 'park', 'Parque', 16, 0, {
    a: ['Parque de las Iguanas'],
  }),
  poi('Malecón 2000', at(7, 3, 0.0003, 0), 'tourism', 'promenade', 'Malecón', 6, 1),
  poi('Mercado Central', at(4, 6, 0.0004, -0.0004), 'shop', 'marketplace', 'Mercado', 12, 1),
  poi(
    'Catedral Metropolitana',
    at(3, 1, 0.0003, -0.0005),
    'place_of_worship',
    'place_of_worship',
    'Templo',
    14,
    0,
  ),
  poi(
    'Terminal Terrestre de Durán',
    [-79.8358, -2.1985],
    'bus',
    'bus_station',
    'Terminal de buses',
    6,
    2,
  ),
  poi('Hotel Oro Verde', at(1, 2, 0.0003, 0.0001), 'lodging', 'hotel', 'Alojamiento', 18, 0),
  poi('Farmacia Cruz Azul', at(5, 6, -0.0002, -0.0001), 'pharmacy', 'pharmacy', 'Farmacia', 20, 1),
  poi(
    'Museo Antropológico y de Arte Contemporáneo',
    at(7, 5, 0.0004, 0.0001),
    'museum',
    'museum',
    'Museo',
    12,
    1,
    { a: ['MAAC'] },
  ),
  poi(
    'Faro del Cerro Santa Ana',
    at(7, 0, -0.0002, 0.0016),
    'tourism',
    'viewpoint',
    'Lugar de interés',
    14,
    1,
  ),
  // An unnamed fuel station: the pipeline names it after its category, without a label.
  { ...poi('Gasolinera', at(0, 6, -0.0003, 0.0002), 'fuel', 'fuel', '', 30, 0), r: 24 },
  ...streetEntries(),
];
