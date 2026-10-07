import { FLAG_APPROXIMATE, FLAG_ROUNDABOUT } from '../../../../infrastructure/native/native-graph';
import { FixtureEdge, fixtureGraph } from '../../../../infrastructure/native/testing/graph-fixture';
import { haversineMeters } from '../../../../common/geo/geojson';
import { NativeRouter, NoRouteError } from './native-router';

const LON0 = -79.9;
const LAT0 = -2.19;
const STEP = 0.001; // ~111 m
const SIZE = 4;

/** 4x4 grid: west-east streets "C. 1".."C. 4" (south to north), south-north avenues "Av. A".."Av. D". */
function city(extra: { nodes?: [number, number][]; edges?: FixtureEdge[] } = {}) {
  const nodes: [number, number][] = [];
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) nodes.push([LON0 + col * STEP, LAT0 + row * STEP]);
  }
  const edges: FixtureEdge[] = [];
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE - 1; col += 1) {
      edges.push({
        u: row * SIZE + col,
        v: row * SIZE + col + 1,
        name: `C. ${row + 1}`,
        parish: 0,
      });
    }
  }
  for (let col = 0; col < SIZE; col += 1) {
    for (let row = 0; row < SIZE - 1; row += 1) {
      edges.push({
        u: row * SIZE + col,
        v: (row + 1) * SIZE + col,
        name: `Av. ${'ABCD'[col]}`,
        cls: 'secondary',
        parish: 0,
      });
    }
  }
  return fixtureGraph({
    nodes: [...nodes, ...(extra.nodes ?? [])],
    edges: [...edges, ...(extra.edges ?? [])],
    parishes: [{ code: '090150', parish: 'Guayaquil', canton: 'Guayaquil', province: 'Guayas' }],
  });
}

const at = (col: number, row: number, dLon = 0, dLat = 0) => ({
  longitude: LON0 + col * STEP + dLon,
  latitude: LAT0 + row * STEP + dLat,
});

describe('NativeRouter', () => {
  it('routes across the grid on streets, with the geometry between both points', () => {
    const router = new NativeRouter(city());
    const origin = at(0, 0, 0.00002, 0.00001);
    const destination = at(3, 3, -0.00001, -0.00002);
    const { primary } = router.route('CAR', [origin, destination], 0);
    // Manhattan distance of 6 blocks.
    expect(primary.distanceMeters).toBeGreaterThan(600);
    expect(primary.distanceMeters).toBeLessThan(700);
    expect(primary.durationSeconds).toBeGreaterThan(0);
    const first = primary.geometry.coordinates[0];
    const last = primary.geometry.coordinates.at(-1)!;
    expect(haversineMeters({ longitude: first[0], latitude: first[1] }, origin)).toBeLessThan(5);
    expect(haversineMeters({ longitude: last[0], latitude: last[1] }, destination)).toBeLessThan(5);
    expect(primary.steps[0].maneuver).toBe('DEPART');
    expect(primary.steps.at(-1)!.maneuver).toBe('ARRIVE');
    expect(primary.steps.at(-1)!.instruction).toBe('Llegaste a tu destino');
    const turns = primary.steps.filter((step) => /^TURN_/.test(step.maneuver));
    expect(turns.length).toBeGreaterThanOrEqual(1);
    expect(turns[0].instruction).toMatch(/^Gira a la (derecha|izquierda) en (Av\. [A-D]|C\. \d)$/);
    const total = primary.steps.reduce((sum, step) => sum + step.distanceMeters, 0);
    expect(Math.abs(total - primary.distanceMeters)).toBeLessThan(5);
  });

  it('prefers the faster avenues over the slower streets', () => {
    const router = new NativeRouter(city());
    const { primary } = router.route('CAR', [at(1, 0), at(1, 3)], 0);
    // Straight up Av. B.
    expect(primary.steps[0].instruction).toBe('Dirígete al norte por Av. B');
    expect(primary.steps).toHaveLength(2);
  });

  it('keeps footways for pedestrians and snaps cars to the nearest drivable road', () => {
    const graph = city({
      nodes: [[LON0 + 4 * STEP, LAT0]],
      edges: [{ u: 3, v: 16, cls: 'footway', name: 'Peatonal Las Peñas' }],
    });
    const router = new NativeRouter(graph);
    const target = { longitude: LON0 + 4 * STEP, latitude: LAT0 };
    const walk = router.route('PEDESTRIAN', [at(0, 0), target], 0).primary;
    const end = walk.geometry.coordinates.at(-1)!;
    expect(haversineMeters({ longitude: end[0], latitude: end[1] }, target)).toBeLessThan(2);
    expect(walk.steps.some((step) => step.streetNames.includes('Peatonal Las Peñas'))).toBe(true);
    const drive = router.route('CAR', [at(0, 0), target], 0).primary;
    const driveEnd = drive.geometry.coordinates.at(-1)!;
    expect(
      haversineMeters({ longitude: driveEnd[0], latitude: driveEnd[1] }, at(3, 0)),
    ).toBeLessThan(2);
  });

  it('snaps to the connected network when the nearest street is an isolated fragment', () => {
    const graph = city({
      nodes: [
        [LON0 + 12 * STEP, LAT0 + STEP],
        [LON0 + 12 * STEP, LAT0 + 2 * STEP],
      ],
      edges: [{ u: 16, v: 17, name: 'C. Aislada' }],
    });
    const router = new NativeRouter(graph);
    const { primary } = router.route(
      'CAR',
      [at(0, 0), { longitude: LON0 + 12 * STEP, latitude: LAT0 + 1.5 * STEP }],
      0,
    );
    const end = primary.geometry.coordinates.at(-1)!;
    // Ends on Av. D, the closest street of the network the origin belongs to.
    expect(end[0]).toBeCloseTo(LON0 + 3 * STEP, 5);
  });

  it.each([
    ['motorway', ['PEDESTRIAN', 'BICYCLE']],
    ['steps', ['BICYCLE']],
  ] as const)(
    'leaves a street joined to the city only by %s for a path the profile can use',
    (link, profiles) => {
      // The nearest street (C. Isla, east) reaches the grid only through the link; a footway
      // ending a few meters farther does reach it.
      const graph = city({
        nodes: [
          [LON0 + 6 * STEP, LAT0],
          [LON0 + 6 * STEP, LAT0 + 2 * STEP],
          [LON0 + 5.9 * STEP, LAT0 + STEP],
        ],
        edges: [
          { u: 16, v: 17, name: 'C. Isla' },
          { u: 3, v: 16, cls: link, name: 'Enlace' },
          { u: 7, v: 18, cls: 'footway', name: 'Sendero' },
        ],
      });
      const router = new NativeRouter(graph);
      const origin = { longitude: LON0 + 5.97 * STEP, latitude: LAT0 + STEP };
      for (const profile of profiles) {
        const { primary } = router.route(profile, [origin, at(0, 2)], 0);
        expect(primary.steps[0].streetNames).toEqual(['Sendero']);
        const [lon, lat] = primary.geometry.coordinates[0];
        expect(haversineMeters({ longitude: lon, latitude: lat }, origin)).toBeLessThan(10);
      }
    },
  );

  it('uses one snapped point for every stop, so the legs meet there', () => {
    // An isolated street (C. Aislada) next to the first two stops, too far from the last one.
    const graph = city({
      nodes: [
        [LON0 + 6 * STEP, LAT0],
        [LON0 + 6 * STEP, LAT0 + 3 * STEP],
      ],
      edges: [{ u: 16, v: 17, name: 'C. Aislada' }],
    });
    const router = new NativeRouter(graph);
    const stops = [
      { longitude: LON0 + 6.02 * STEP, latitude: LAT0 + 2.5 * STEP },
      { longitude: LON0 + 5.55 * STEP, latitude: LAT0 + 1.5 * STEP },
      at(0, 0),
    ];
    const { primary } = router.route('CAR', stops, 0);
    const points = primary.geometry.coordinates;
    let drawn = 0;
    for (let i = 1; i < points.length; i += 1) {
      drawn += haversineMeters(
        { longitude: points[i - 1][0], latitude: points[i - 1][1] },
        { longitude: points[i][0], latitude: points[i][1] },
      );
    }
    // No straight jump between two networks: the line is the distance travelled.
    expect(Math.abs(drawn - primary.distanceMeters)).toBeLessThan(5);
    expect(primary.steps.some((step) => step.streetNames.includes('C. Aislada'))).toBe(false);
  });

  it('routes between two points of the same street segment', () => {
    const router = new NativeRouter(city());
    const { primary } = router.route('CAR', [at(0, 0, 0.0002), at(0, 0, 0.0008)], 0);
    expect(primary.distanceMeters).toBeGreaterThan(60);
    expect(primary.distanceMeters).toBeLessThan(70);
    expect(primary.steps[0].streetNames).toEqual(['C. 1']);
  });

  it('offers alternatives that are different enough', () => {
    const router = new NativeRouter(city());
    const { primary, alternatives } = router.route('CAR', [at(0, 0), at(3, 3)], 2);
    expect(alternatives.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(alternatives[0].geometry)).not.toEqual(JSON.stringify(primary.geometry));
    expect(alternatives[0].durationSeconds).toBeLessThanOrEqual(primary.durationSeconds * 1.45);
  });

  it('goes through the stops in order', () => {
    const router = new NativeRouter(city());
    const { primary } = router.route('CAR', [at(0, 0), at(3, 0), at(3, 3)], 0);
    expect(primary.distanceMeters).toBeGreaterThan(600);
    expect(
      primary.steps.filter((step) => step.maneuver === 'WAYPOINT').length,
    ).toBeGreaterThanOrEqual(1);
    expect(primary.steps.some((step) => step.instruction === 'Llegaste a la parada 1')).toBe(true);
  });

  it('describes roundabouts with the exit to take', () => {
    // A square roundabout in the middle of the grid, entered from the south and left to the east.
    const nodes: [number, number][] = [
      [LON0, LAT0 - 0.002],
      [LON0, LAT0 - 0.0002],
      [LON0 + 0.0002, LAT0],
      [LON0, LAT0 + 0.0002],
      [LON0 - 0.0002, LAT0],
      [LON0 + 0.002, LAT0],
      [LON0, LAT0 + 0.002],
      [LON0 - 0.002, LAT0],
    ];
    const ring = FLAG_ROUNDABOUT;
    const graph = fixtureGraph({
      nodes,
      edges: [
        { u: 0, v: 1, name: 'Av. Sur' },
        { u: 1, v: 2, name: 'Redondel', flags: ring },
        { u: 2, v: 3, name: 'Redondel', flags: ring },
        { u: 3, v: 4, name: 'Redondel', flags: ring },
        { u: 4, v: 1, name: 'Redondel', flags: ring },
        { u: 2, v: 5, name: 'Av. Este' },
        { u: 3, v: 6, name: 'Av. Norte' },
        { u: 4, v: 7, name: 'Av. Oeste' },
      ],
    });
    const router = new NativeRouter(graph);
    const { primary } = router.route(
      'CAR',
      [
        { longitude: LON0, latitude: LAT0 - 0.0018 },
        { longitude: LON0 - 0.0018, latitude: LAT0 },
      ],
      0,
    );
    const roundabout = primary.steps.find((step) => step.maneuver === 'ROUNDABOUT_ENTER');
    expect(roundabout?.instruction).toMatch(
      /^En el redondel, toma la (primera|segunda|tercera) salida hacia Av\. Oeste$/,
    );
  });

  it('reports straight links over unmapped access roads as approximate', () => {
    // A town (nodes 16-17) linked to the grid only by an approximate straight link.
    const graph = city({
      nodes: [
        [LON0 + 10 * STEP, LAT0],
        [LON0 + 11 * STEP, LAT0],
      ],
      edges: [
        { u: 16, v: 17, name: 'C. del Pueblo' },
        { u: 3, v: 16, cls: 'connector', flags: FLAG_APPROXIMATE },
      ],
    });
    const router = new NativeRouter(graph);
    const { primary } = router.route(
      'CAR',
      [at(0, 0), { longitude: LON0 + 11 * STEP, latitude: LAT0 }],
      0,
    );
    expect(primary.approximateSections).toHaveLength(1);
    expect(primary.approximateSections![0].distanceMeters).toBeGreaterThan(700);
    const [from, to] = primary.approximateSections![0].geometryIndex;
    expect(to).toBeGreaterThan(from);
    expect(
      primary.steps.some((step) =>
        /tramo aproximado de 7\d\d m, sin vía registrada/.test(step.instruction),
      ),
    ).toBe(true);
    const plain = new NativeRouter(city()).route('CAR', [at(0, 0), at(3, 3)], 0).primary;
    expect(plain.approximateSections).toBeUndefined();
  });

  it('fails clearly when the points are far from every road', () => {
    const router = new NativeRouter(city());
    expect(() => router.route('CAR', [at(0, 0), { longitude: -85, latitude: -2.19 }], 0)).toThrow(
      NoRouteError,
    );
  });

  it('writes English instructions on request', () => {
    const router = new NativeRouter(city());
    const { primary } = router.route('CAR', [at(1, 0), at(1, 3)], 0, { language: 'en-US' });
    expect(primary.steps[0].instruction).toBe('Head north on Av. B');
    expect(primary.steps.at(-1)!.instruction).toBe('You have arrived at your destination');
  });
});
