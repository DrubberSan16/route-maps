import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Position } from '../../../../common/geo/geojson';
import { CalculateRouteInput } from '../../domain/entities/route-result';
import {
  InvalidRouteRequestError,
  RouteNotFoundError,
  RoutingProfileNotSupportedError,
  RoutingProviderUnavailableError,
} from '../../domain/errors';
import { OsrmRoutingProvider } from './osrm-routing.provider';

interface FixtureStep {
  distance: number;
  name: string;
  maneuver: { type: string; location: Position };
}
interface FixtureResponse {
  routes: {
    distance: number;
    duration: number;
    geometry: { coordinates: Position[] };
    legs: { steps: FixtureStep[] }[];
  }[];
}

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8')) as FixtureResponse;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('OsrmRoutingProvider', () => {
  const provider = new OsrmRoutingProvider({
    urls: { CAR: 'http://osrm-car:5000/', PEDESTRIAN: 'http://osrm-foot:5000' },
    timeoutMs: 1000,
  });
  let fetchMock: jest.SpyInstance<Promise<Response>, Parameters<typeof fetch>>;

  const input = (overrides: Partial<CalculateRouteInput> = {}): CalculateRouteInput => ({
    origin: { latitude: 43.7384, longitude: 7.4246 },
    destination: { latitude: 43.7311, longitude: 7.4197 },
    profile: 'CAR',
    alternatives: 2,
    language: 'es-ES',
    ...overrides,
  });

  const requestedUrl = () => new URL(fetchMock.mock.calls[0][0]);

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => fetchMock.mockRestore());

  it('only supports the profiles that have an OSRM instance', async () => {
    expect(provider.supportedProfiles()).toEqual(['CAR', 'PEDESTRIAN']);
    await expect(provider.calculateRoute(input({ profile: 'TRUCK' }))).rejects.toBeInstanceOf(
      RoutingProfileNotSupportedError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('request', () => {
    it('calls the instance of the profile with lng,lat pairs and a snap radius', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(fixture('osrm-route-monaco.json')));

      await provider.calculateRoute(input());

      const url = requestedUrl();
      expect(url.origin).toBe('http://osrm-car:5000');
      expect(decodeURIComponent(url.pathname)).toBe(
        '/route/v1/driving/7.4246,43.7384;7.4197,43.7311',
      );
      expect(Object.fromEntries(url.searchParams)).toEqual({
        alternatives: '2',
        steps: 'true',
        geometries: 'geojson',
        overview: 'full',
        radiuses: '5000;5000',
      });
    });

    it('disables alternatives with intermediate stops and maps avoid options to exclude', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(fixture('osrm-route-monaco-stops.json')));

      await provider.calculateRoute(
        input({
          waypoints: [{ latitude: 43.735, longitude: 7.421 }],
          options: { avoidTolls: true },
        }),
      );

      const url = requestedUrl();
      expect(url.searchParams.get('alternatives')).toBe('false');
      expect(url.searchParams.get('exclude')).toBe('toll');
      expect(url.searchParams.get('radiuses')).toBe('5000;5000;5000');
    });
  });

  describe('with a real OSRM response (Monaco)', () => {
    const response = fixture('osrm-route-monaco.json');

    it('normalises the route and builds Spanish instructions', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(response));

      const result = await provider.calculateRoute(input());

      const [route] = response.routes;
      expect(result.provider).toBe('osrm');
      expect(result.alternatives).toEqual([]);
      expect(result.primary.distanceMeters).toBe(Math.round(route.distance));
      expect(result.primary.durationSeconds).toBe(Math.round(route.duration));
      expect(result.primary.geometry.coordinates).toEqual(route.geometry.coordinates);
      expect(result.primary.steps[0]).toMatchObject({
        instruction: "Inicie el recorrido por Avenue de l'Hermitage",
        maneuver: 'DEPART',
        streetNames: ["Avenue de l'Hermitage"],
      });
      expect(result.primary.steps.at(-1)).toMatchObject({
        instruction: 'Ha llegado a su destino, a la derecha',
        maneuver: 'ARRIVE',
      });
      expect(result.primary.steps.map((step) => step.instruction)).toContain(
        'Gire a la izquierda por Avenue de la Costa',
      );
    });

    it('anchors every step on the overview geometry', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(response));

      const { primary } = await provider.calculateRoute(input());

      const last = primary.geometry.coordinates.length - 1;
      expect(primary.steps.at(-1)?.geometryIndex).toEqual([last, last]);
      for (const step of primary.steps) {
        expect(step.location).toEqual(primary.geometry.coordinates[step.geometryIndex[0]]);
      }
    });
  });

  describe('with an intermediate stop', () => {
    const response = fixture('osrm-route-monaco-stops.json');

    it('keeps geometry indexes aligned across legs', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(response));

      const { primary } = await provider.calculateRoute(
        input({ waypoints: [{ latitude: 43.735, longitude: 7.421 }] }),
      );

      const coordinates = primary.geometry.coordinates;
      for (const step of primary.steps) {
        expect(step.location).toEqual(coordinates[step.geometryIndex[0]]);
      }
      expect(primary.steps.at(-1)?.geometryIndex).toEqual([
        coordinates.length - 1,
        coordinates.length - 1,
      ]);
    });

    it('announces the stop and arrives once', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(response));

      const { primary } = await provider.calculateRoute(
        input({ waypoints: [{ latitude: 43.735, longitude: 7.421 }] }),
      );

      expect(primary.steps.filter((step) => step.maneuver === 'WAYPOINT')).toEqual([
        expect.objectContaining({ instruction: 'Ha llegado a la parada 1' }),
      ]);
      expect(primary.steps.filter((step) => step.maneuver === 'ARRIVE')).toHaveLength(1);
    });
  });

  describe('errors', () => {
    it('maps NoSegment (point too far from any road) to RouteNotFoundError', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          { code: 'NoSegment', message: 'Could not find a matching segment for coordinate 0' },
          400,
        ),
      );
      await expect(provider.calculateRoute(input())).rejects.toBeInstanceOf(RouteNotFoundError);
    });

    it('maps NoRoute in a successful answer to RouteNotFoundError', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ code: 'NoRoute', message: 'Impossible route' }),
      );
      await expect(provider.calculateRoute(input())).rejects.toBeInstanceOf(RouteNotFoundError);
    });

    it('maps unsupported exclude combinations to InvalidRouteRequestError', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          { code: 'InvalidValue', message: 'Exclude flag combination is not supported.' },
          400,
        ),
      );
      await expect(
        provider.calculateRoute(input({ options: { avoidTolls: true, avoidHighways: true } })),
      ).rejects.toBeInstanceOf(InvalidRouteRequestError);
    });

    it('maps network failures and 5xx to RoutingProviderUnavailableError', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(provider.calculateRoute(input())).rejects.toBeInstanceOf(
        RoutingProviderUnavailableError,
      );
      fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
      await expect(provider.calculateRoute(input())).rejects.toBeInstanceOf(
        RoutingProviderUnavailableError,
      );
    });
  });

  describe('health', () => {
    it('is up while osrm-routed answers, even with a 4xx', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'NoSegment' }, 400));
      await expect(provider.health()).resolves.toBe('up');
      expect(fetchMock.mock.calls[0][0]).toBe('http://osrm-car:5000/nearest/v1/driving/0,0');
    });

    it('is down when unreachable or without any instance', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(provider.health()).resolves.toBe('down');
      await expect(new OsrmRoutingProvider({ urls: {}, timeoutMs: 1000 }).health()).resolves.toBe(
        'down',
      );
    });
  });
});
