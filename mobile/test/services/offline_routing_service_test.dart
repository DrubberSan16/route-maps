import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/core/errors/app_exception.dart';
import 'package:maps_platform/domain/entities/coordinate.dart';
import 'package:maps_platform/domain/entities/offline_route.dart';
import 'package:maps_platform/domain/entities/route.dart';
import 'package:maps_platform/domain/entities/routing_profile.dart';
import 'package:maps_platform/domain/geo.dart';
import 'package:maps_platform/domain/services/offline_routing_provider.dart';
import 'package:maps_platform/services/routing/offline_routing_service.dart';

import '../helpers/fakes.dart';
import '../helpers/fixtures.dart';

/// A stored route built from the captured Monaco response.
OfflineRoute _stored(
  RouteOption option, {
  String id = 'route-1',
  String name = 'Hermitage → Fontvieille',
}) => OfflineRoute(
  routeId: id,
  name: name,
  profile: RoutingProfile.car,
  origin: option.geometry.first,
  destination: option.geometry.last,
  distanceMeters: option.distanceMeters,
  durationSeconds: option.durationSeconds,
  geometry: option.geometry,
  steps: option.steps,
  provider: 'valhalla',
  createdAt: DateTime.utc(2026, 9, 25),
  updatedAt: DateTime.utc(2026, 9, 25),
);

/// [point] moved [meters] to the north.
Coordinate _north(Coordinate point, double meters) =>
    Coordinate(point.latitude + meters / 111195, point.longitude);

class _OnDeviceEngine implements OfflineRoutingProvider {
  @override
  String get name => 'test-engine';

  @override
  Future<bool> canRoute({
    required Coordinate origin,
    required Coordinate destination,
    required RoutingProfile profile,
  }) async => true;

  @override
  Future<RouteResult> calculateRoute({
    required Coordinate origin,
    required Coordinate destination,
    required RoutingProfile profile,
  }) async => RouteResult(
    profile: profile,
    provider: name,
    source: RouteSource.onDevice,
    routes: [
      RouteOption(
        routeId: 'device',
        type: RouteType.primary,
        distanceMeters: distanceMeters(origin, destination),
        durationSeconds: 60,
        geometry: [origin, destination],
        steps: const [],
      ),
    ],
    origin: origin,
    destination: destination,
  );
}

void main() {
  late RouteResult captured;
  late RouteOption primary;
  late List<Coordinate> line;

  setUpAll(() {
    captured = RouteResult.fromApi(
      fixtureData('route_calculate_monaco')! as Map<String, Object?>,
      origin: const Coordinate(43.7383, 7.4245),
      destination: const Coordinate(43.7314, 7.4196),
    );
    primary = captured.primary;
    line = primary.geometry;
  });

  OfflineRoutingService service(List<OfflineRoute> routes, {OfflineRoutingProvider? provider}) =>
      provider == null
      ? OfflineRoutingService(savedRoutes: InMemorySavedRouteRepository(routes))
      : OfflineRoutingService(
          savedRoutes: InMemorySavedRouteRepository(routes),
          provider: provider,
        );

  test('the same trip returns the stored route as it was saved', () async {
    final result = await service([_stored(primary)])
        .calculateRoute(origin: line.first, destination: line.last, profile: RoutingProfile.car);
    expect(result.source, RouteSource.savedRoute);
    expect(result.routes, hasLength(1));
    expect(result.primary.savedRouteId, 'route-1');
    expect(result.primary.savedRouteName, 'Hermitage → Fontvieille');
    expect(result.distanceMeters, primary.distanceMeters);
    expect(result.durationSeconds, primary.durationSeconds);
    expect(result.geometry, line);
    expect(result.steps.map((s) => s.instruction), primary.steps.map((s) => s.instruction));
  });

  test('starting in the middle follows the rest of the route', () async {
    // Vertex 50 lies on "Gire a la derecha hacia Avenue d'Ostende" (vertices 37-75).
    final origin = _north(line[50], 20);
    final result = await service([_stored(primary)])
        .calculateRoute(origin: origin, destination: line.last, profile: RoutingProfile.car);
    final option = result.primary;
    expect(distanceMeters(option.geometry.first, origin), lessThan(25));
    expect(option.geometry.last, line.last);
    expect(option.distanceMeters, lessThan(primary.distanceMeters));
    expect(option.durationSeconds, lessThan(primary.durationSeconds));

    // The turn onto Avenue d'Ostende is behind: the first instruction continues on it.
    final first = option.steps.first;
    expect(first.maneuver, Maneuvers.depart);
    expect(first.instruction, "Continúe por Avenue d'Ostende.");
    expect(first.geometryStart, 0);
    // The next maneuver keeps its text and points at the same place of the new geometry.
    final next = option.steps[1];
    expect(next.maneuver, Maneuvers.roundaboutEnter);
    expect(option.geometry[next.geometryStart], line[75]);
    // The original arrival is kept and the totals add up.
    expect(option.steps.last.instruction, 'Su destino está a la derecha.');
    expect(option.steps.last.geometryStart, option.geometry.length - 1);
    expect(
      option.distanceMeters,
      closeTo(option.steps.fold<double>(0, (s, x) => s + x.distanceMeters), 1e-6),
    );
    for (final step in option.steps) {
      expect(step.geometryStart, inInclusiveRange(0, option.geometry.length - 1));
      expect(step.geometryEnd, inInclusiveRange(step.geometryStart, option.geometry.length - 1));
    }
  });

  test('stopping before the end arrives where the destination is', () async {
    final destination = line[100];
    final result = await service([_stored(primary)])
        .calculateRoute(origin: line.first, destination: destination, profile: RoutingProfile.car);
    final option = result.primary;
    expect(option.geometry.last, destination);
    expect(option.steps.first.instruction, primary.steps.first.instruction);
    expect(option.steps.last.maneuver, Maneuvers.arrive);
    expect(option.steps.last.instruction, 'Ha llegado a su destino.');
    // Steps after the destination are gone; the one containing it is shortened.
    expect(option.steps.map((s) => s.maneuver), isNot(contains(Maneuvers.slightRight)));
    final cut = option.steps[option.steps.length - 2];
    expect(cut.maneuver, Maneuvers.roundaboutExit);
    expect(cut.distanceMeters, lessThan(primary.steps[5].distanceMeters));
  });

  test('a destination near the end of the route says how far it is', () async {
    final destination = _north(line[120], 100);
    final result = await service([_stored(primary)])
        .calculateRoute(origin: line.first, destination: destination, profile: RoutingProfile.car);
    expect(
      result.primary.steps.last.instruction,
      startsWith('Fin de la ruta guardada. Su destino está a'),
    );
  });

  test('routes are not followed backwards', () async {
    await expectLater(
      service([_stored(primary)])
          .calculateRoute(origin: line.last, destination: line.first, profile: RoutingProfile.car),
      throwsA(
        isA<AppException>().having((e) => e.code, 'code', ErrorCodes.offlineRouteUnavailable),
      ),
    );
  });

  test('other profiles and far away points are not matched', () async {
    final routes = [_stored(primary)];
    await expectLater(
      service(routes).calculateRoute(
        origin: line.first,
        destination: line.last,
        profile: RoutingProfile.pedestrian,
      ),
      throwsA(isA<AppException>()),
    );
    await expectLater(
      service(routes).calculateRoute(
        origin: _north(line.first, 1000),
        destination: line.last,
        profile: RoutingProfile.car,
      ),
      throwsA(
        isA<AppException>().having((e) => e.code, 'code', ErrorCodes.offlineRouteUnavailable),
      ),
    );
  });

  test('several stored routes: the closest first, the others as alternatives', () async {
    final alternative = captured.routes[1];
    final routes = [_stored(alternative, id: 'route-2', name: 'Por el puerto'), _stored(primary)];
    final origin = _north(line.first, 30);
    final result = await service(routes)
        .calculateRoute(origin: origin, destination: line.last, profile: RoutingProfile.car);
    expect(result.routes.map((r) => r.type), [RouteType.primary, RouteType.alternative]);
    final offsets = await service(routes)
        .matchStoredRoutes(origin: origin, destination: line.last, profile: RoutingProfile.car);
    expect(offsets.first.offsetMeters, lessThanOrEqualTo(offsets.last.offsetMeters));
  });

  test('without a stored route an installed on-device engine answers', () async {
    final result = await service(
      const [],
      provider: _OnDeviceEngine(),
    ).calculateRoute(origin: line.first, destination: line.last, profile: RoutingProfile.car);
    expect(result.source, RouteSource.onDevice);
    expect(result.provider, 'test-engine');
  });

  test('without stored routes nor engine it does not make a route up', () async {
    await expectLater(
      service(const [])
          .calculateRoute(origin: line.first, destination: line.last, profile: RoutingProfile.car),
      throwsA(
        isA<AppException>()
            .having((e) => e.code, 'code', ErrorCodes.offlineRouteUnavailable)
            .having((e) => e.message, 'message', contains('rutas guardadas')),
      ),
    );
  });
}
