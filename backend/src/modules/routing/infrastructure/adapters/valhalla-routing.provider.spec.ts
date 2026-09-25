import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePolyline, encodePolyline } from '../../../../common/geo/polyline';
import { CalculateRouteInput } from '../../domain/entities/route-result';
import {
  InvalidRouteRequestError,
  RouteNotFoundError,
  RoutingProviderUnavailableError,
} from '../../domain/errors';
import { RoutingProfile } from '../../domain/value-objects/routing-profile';
import { VALHALLA_COSTING, ValhallaRoutingProvider } from './valhalla-routing.provider';

interface FixtureTrip {
  legs: { shape: string; maneuvers: { instruction: string }[] }[];
  summary: {
    length: number;
    time: number;
    min_lat: number;
    min_lon: number;
    max_lat: number;
    max_lon: number;
  };
}
interface FixtureResponse {
  trip: FixtureTrip;
  alternates?: { trip: FixtureTrip }[];
}

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8')) as FixtureResponse;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('ValhallaRoutingProvider', () => {
  const provider = new ValhallaRoutingProvider({
    baseUrl: 'http://routing:8002/',
    timeoutMs: 1000,
  });
  let fetchMock: jest.SpyInstance<Promise<Response>, Parameters<typeof fetch>>;

  // Monaco: Avenue de l'Hermitage -> Avenue Albert II (the points used to capture the fixtures).
  const input = (overrides: Partial<CalculateRouteInput> = {}): CalculateRouteInput => ({
    origin: { latitude: 43.7384, longitude: 7.4246 },
    destination: { latitude: 43.7311, longitude: 7.4197 },
    profile: 'CAR',
    alternatives: 1,
    language: 'es-ES',
    ...overrides,
  });

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => fetchMock.mockRestore());

  describe('buildRequest', () => {
    it.each(Object.entries(VALHALLA_COSTING))(
      'maps profile %s to costing "%s"',
      (profile, costing) => {
        expect(provider.buildRequest(input({ profile: profile as RoutingProfile })).costing).toBe(
          costing,
        );
      },
    );

    it('sends every point as a stop and asks for polyline6 in the requested language', () => {
      const request = provider.buildRequest(
        input({ waypoints: [{ latitude: 43.735, longitude: 7.421 }], language: 'en-US' }),
      );
      expect(request).toMatchObject({
        locations: [
          { lat: 43.7384, lon: 7.4246, type: 'break' },
          { lat: 43.735, lon: 7.421, type: 'break' },
          { lat: 43.7311, lon: 7.4197, type: 'break' },
        ],
        directions_options: { units: 'kilometers', language: 'en-US' },
        shape_format: 'polyline6',
      });
      expect(request).not.toHaveProperty('costing_options');
    });

    it('only asks for alternates on two-point routes', () => {
      expect(provider.buildRequest(input({ alternatives: 2 })).alternates).toBe(2);
      expect(
        provider.buildRequest(
          input({ alternatives: 2, waypoints: [{ latitude: 43.735, longitude: 7.421 }] }),
        ).alternates,
      ).toBe(0);
    });

    it('turns avoid options into options of the selected costing', () => {
      const request = provider.buildRequest(
        input({
          profile: 'TRUCK',
          options: { avoidTolls: true, avoidHighways: true, avoidFerries: true },
        }),
      );
      expect(request.costing_options).toEqual({
        truck: { use_tolls: 0, use_highways: 0, use_ferry: 0 },
      });
    });
  });

  describe('calculateRoute with a real Valhalla response (Monaco)', () => {
    const response = fixture('valhalla-route-monaco.json');

    it('posts the request to /route of the configured engine', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(response));

      await provider.calculateRoute(input());

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://routing:8002/route');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toEqual(provider.buildRequest(input()));
    });

    it('normalises distance, duration, geometry and bbox', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(response));

      const { primary, provider: name } = await provider.calculateRoute(input());

      const { summary, legs } = response.trip;
      expect(name).toBe('valhalla');
      expect(primary.distanceMeters).toBe(Math.round(summary.length * 1000));
      expect(primary.durationSeconds).toBe(Math.round(summary.time));
      expect(primary.geometry).toEqual({
        type: 'LineString',
        coordinates: decodePolyline(legs[0].shape, 6),
      });
      const [minLng, minLat, maxLng, maxLat] = primary.bbox;
      expect(minLng).toBeCloseTo(summary.min_lon, 5);
      expect(minLat).toBeCloseTo(summary.min_lat, 5);
      expect(maxLng).toBeCloseTo(summary.max_lon, 5);
      expect(maxLat).toBeCloseTo(summary.max_lat, 5);
      expect(primary).toMatchObject({ hasTolls: false, hasFerry: false });
    });

    it('keeps the Spanish instructions and normalises every maneuver', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(response));

      const { primary } = await provider.calculateRoute(input());

      expect(primary.steps.map((step) => step.maneuver)).toEqual([
        'DEPART',
        'TURN_LEFT',
        'SLIGHT_LEFT',
        'TURN_RIGHT',
        'ROUNDABOUT_ENTER',
        'ROUNDABOUT_EXIT',
        'SLIGHT_RIGHT',
        'TURN_RIGHT',
        'SLIGHT_LEFT',
        'ROUNDABOUT_ENTER',
        'ROUNDABOUT_EXIT',
        'ARRIVE',
      ]);
      expect(primary.steps[0]).toEqual({
        instruction: "Conduzca hacia el noroeste por Avenue de l'Hermitage.",
        distanceMeters: 20,
        durationSeconds: 2.1,
        maneuver: 'DEPART',
        location: primary.geometry.coordinates[0],
        streetNames: ["Avenue de l'Hermitage"],
        geometryIndex: [0, 1],
      });
      // Valhalla sends street_names: null on some maneuvers.
      expect(primary.steps[11]).toMatchObject({
        instruction: 'Su destino está a la derecha.',
        streetNames: [],
        location: primary.geometry.coordinates.at(-1),
      });
    });

    it('anchors every step on the route geometry', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(response));

      const { primary } = await provider.calculateRoute(input());

      const last = primary.geometry.coordinates.length - 1;
      for (const step of primary.steps) {
        const [begin, end] = step.geometryIndex;
        expect(0 <= begin && begin <= end && end <= last).toBe(true);
        expect(step.location).toEqual(primary.geometry.coordinates[begin]);
      }
      const total = primary.steps.reduce((sum, step) => sum + step.distanceMeters, 0);
      expect(Math.abs(total - primary.distanceMeters)).toBeLessThan(5);
    });

    it('returns the alternate route', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(response));

      const { alternatives } = await provider.calculateRoute(input());

      const alternate = response.alternates![0].trip;
      expect(alternatives).toHaveLength(1);
      expect(alternatives[0].distanceMeters).toBe(Math.round(alternate.summary.length * 1000));
      expect(alternatives[0].geometry.coordinates).toEqual(
        decodePolyline(alternate.legs[0].shape, 6),
      );
    });
  });

  describe('calculateRoute with an intermediate stop', () => {
    const response = fixture('valhalla-route-monaco-stops.json');
    const withStop = input({
      alternatives: 0,
      waypoints: [{ latitude: 43.735, longitude: 7.421 }],
    });

    it('joins the legs without repeating the stop point', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(response));

      const { primary } = await provider.calculateRoute(withStop);

      const [first, second] = response.trip.legs.map((leg) => decodePolyline(leg.shape, 6));
      expect(primary.geometry.coordinates).toEqual([...first, ...second.slice(1)]);
      for (const step of primary.steps) {
        expect(step.location).toEqual(primary.geometry.coordinates[step.geometryIndex[0]]);
      }
    });

    it('announces the intermediate stop instead of a final arrival', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(response));

      const { primary } = await provider.calculateRoute(withStop);

      const waypoints = primary.steps.filter((step) => step.maneuver === 'WAYPOINT');
      expect(waypoints).toEqual([
        expect.objectContaining({ instruction: 'Ha llegado a la parada 1' }),
      ]);
      expect(primary.steps.filter((step) => step.maneuver === 'ARRIVE')).toHaveLength(1);
      expect(primary.steps.at(-1)?.maneuver).toBe('ARRIVE');
      expect(primary.steps.filter((step) => step.maneuver === 'DEPART')).toHaveLength(2);
    });

    it("keeps the engine's wording for languages without a stop phrase", () => {
      const result = provider.toRouteResult({
        ...(response.trip as unknown as Parameters<typeof provider.toRouteResult>[0]),
        language: 'fr-FR',
      });
      const waypoint = result.steps.find((step) => step.maneuver === 'WAYPOINT');
      expect(waypoint?.instruction).toBe(response.trip.legs[0].maneuvers.at(-1)?.instruction);
    });
  });

  it('converts lengths reported in miles', () => {
    const result = provider.toRouteResult({
      units: 'miles',
      summary: { length: 1, time: 60 },
      legs: [
        {
          shape: encodePolyline([
            [-79.9, -2.19],
            [-79.9, -2.18],
          ]),
          maneuvers: [
            {
              type: 1,
              instruction: 'Start',
              length: 1,
              time: 60,
              begin_shape_index: 0,
              end_shape_index: 1,
            },
            {
              type: 4,
              instruction: 'Arrive',
              length: 0,
              time: 0,
              begin_shape_index: 1,
              end_shape_index: 1,
            },
          ],
        },
      ],
    });
    expect(result.distanceMeters).toBe(1609);
    expect(result.steps[0].distanceMeters).toBe(1609.3);
  });

  describe('errors', () => {
    it.each([
      [171, 'No suitable edges near location'],
      [442, 'No path could be found for input'],
    ])('maps Valhalla error %i to RouteNotFoundError', async (code, message) => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error_code: code, error: message, status_code: 400 }, 400),
      );
      const error = await provider.calculateRoute(input()).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RouteNotFoundError);
      expect(error).toMatchObject({ message, providerCode: code });
    });

    it('maps request limits to InvalidRouteRequestError', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          { error_code: 154, error: 'Path distance exceeds the max distance limit' },
          400,
        ),
      );
      await expect(provider.calculateRoute(input())).rejects.toBeInstanceOf(
        InvalidRouteRequestError,
      );
    });

    it('maps server errors to RoutingProviderUnavailableError', async () => {
      fetchMock.mockResolvedValueOnce(new Response('upstream failure', { status: 502 }));
      await expect(provider.calculateRoute(input())).rejects.toBeInstanceOf(
        RoutingProviderUnavailableError,
      );
    });

    it('maps network failures to RoutingProviderUnavailableError', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(provider.calculateRoute(input())).rejects.toBeInstanceOf(
        RoutingProviderUnavailableError,
      );
    });
  });

  describe('health', () => {
    it('is up when /status answers', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ version: '3.9.0' }));
      await expect(provider.health()).resolves.toBe('up');
      expect(fetchMock.mock.calls[0][0]).toBe('http://routing:8002/status');
    });

    it('is down when the engine does not answer', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(provider.health()).resolves.toBe('down');
    });
  });
});
