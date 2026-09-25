import { AppException } from '../../../../common/errors/app.exception';
import { ErrorCode } from '../../../../common/errors/error-codes';
import { RouteRepository, SaveRouteInput } from '../../domain/entities/saved-route';
import { SavedRoutesService } from './saved-routes.service';

const USER = 'a3f1c2d4-5b6e-4f70-8a9b-0c1d2e3f4a5b';

const input = (steps: SaveRouteInput['steps']): SaveRouteInput => ({
  name: 'Malecón → Parque Seminario',
  profile: 'CAR',
  origin: { latitude: -2.1962, longitude: -79.8862 },
  destination: { latitude: -2.1894, longitude: -79.8975 },
  distanceMeters: 1500,
  durationSeconds: 150,
  geometry: {
    type: 'LineString',
    coordinates: [
      [-79.8862, -2.1962],
      [-79.892, -2.193],
      [-79.8975, -2.1894],
    ],
  },
  steps,
});

const step = (geometryIndex?: [number, number]) => ({
  instruction: 'Continúe recto',
  distanceMeters: 750,
  durationSeconds: 75,
  location: [-79.8862, -2.1962] as [number, number],
  geometryIndex,
});

describe('SavedRoutesService', () => {
  let routes: jest.Mocked<Pick<RouteRepository, 'upsert'>>;
  let service: SavedRoutesService;

  beforeEach(() => {
    routes = {
      upsert: jest.fn((_userId, route) => Promise.resolve({ ...route, userId: USER } as never)),
    };
    service = new SavedRoutesService(routes as unknown as RouteRepository);
  });

  it('stores steps whose vertex ranges lie on the route geometry', async () => {
    await service.save(USER, input([step([0, 1]), step([1, 2]), step([2, 2]), step()]));

    expect(routes.upsert).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ id: expect.any(String) }),
    );
  });

  it.each([
    ['past the last vertex', [1, 3] as [number, number]],
    ['reversed', [2, 1] as [number, number]],
  ])('rejects a step range %s (the app cuts the geometry with it)', async (_case, range) => {
    const saving = service.save(USER, input([step([0, 1]), step(range)]));

    await expect(saving).rejects.toBeInstanceOf(AppException);
    await expect(saving).rejects.toMatchObject({
      code: ErrorCode.INVALID_GEOMETRY,
      message: 'steps.1.geometryIndex must be a range of vertices of the route geometry',
    });
    expect(routes.upsert).not.toHaveBeenCalled();
  });
});
