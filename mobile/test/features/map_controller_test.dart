import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/core/errors/app_exception.dart';
import 'package:maps_platform/domain/entities/coordinate.dart';
import 'package:maps_platform/domain/entities/map_region.dart';
import 'package:maps_platform/domain/entities/route.dart';
import 'package:maps_platform/domain/entities/routing_profile.dart';
import 'package:maps_platform/domain/services/routing_service.dart';
import 'package:maps_platform/features/map/map_controller.dart';
import 'package:maps_platform/presentation/providers.dart';

import '../helpers/app_fakes.dart';
import '../helpers/fakes.dart';

const _home = Coordinate(43.7384, 7.4246);
const _casino = Coordinate(43.7311, 7.4197);
const _port = Coordinate(43.7350, 7.4210);

/// Routing whose answers the test releases one by one, in any order.
class _PendingRouting implements RoutingService {
  final requests =
      <({Coordinate destination, RoutingProfile profile, Completer<RouteResult> answer})>[];

  @override
  Future<RouteResult> calculateRoute({
    required Coordinate origin,
    required Coordinate destination,
    required RoutingProfile profile,
    bool alternatives = true,
  }) {
    final answer = Completer<RouteResult>();
    requests.add((destination: destination, profile: profile, answer: answer));
    return answer.future;
  }

  /// Answers request [index] with a route to its destination.
  Future<RouteResult> answer(int index, {int options = 1}) async {
    final request = requests[index];
    final result = _route(request.destination, request.profile, options: options);
    request.answer.complete(result);
    await pumpEventQueue();
    return result;
  }

  Future<void> fail(int index) async {
    requests[index].answer.completeError(AppException.of(ErrorCodes.routingProviderUnavailable));
    await pumpEventQueue();
  }
}

/// Regions whose lookup waits until the test opens [gate].
class _SlowRegions extends InMemoryRegionRepository {
  final gate = Completer<void>();

  @override
  Future<MapRegion?> detectRegion(Coordinate position) async {
    await gate.future;
    return super.detectRegion(position);
  }
}

RouteResult _route(Coordinate destination, RoutingProfile profile, {int options = 1}) =>
    RouteResult(
      profile: profile,
      provider: 'test',
      source: RouteSource.server,
      routes: [
        for (var i = 0; i < options; i++)
          RouteOption(
            routeId: 'route-$i',
            type: i == 0 ? RouteType.primary : RouteType.alternative,
            distanceMeters: 900.0 + i,
            durationSeconds: 120,
            geometry: const [_home, _port],
            steps: const [],
          ),
      ],
      origin: _home,
      destination: destination,
    );

void main() {
  late _PendingRouting routing;
  late _SlowRegions regions;
  late InMemorySavedRouteRepository savedRoutes;
  late ProviderContainer container;

  MapController controller() => container.read(mapControllerProvider.notifier);
  MapViewState state() => container.read(mapControllerProvider);

  setUp(() {
    routing = _PendingRouting();
    regions = _SlowRegions();
    savedRoutes = InMemorySavedRouteRepository();
    container = ProviderContainer(
      overrides: [
        locationServiceProvider.overrideWithValue(
          FakeLocationService(position: fix(_home.latitude, _home.longitude)),
        ),
        routingServiceProvider.overrideWithValue(routing),
        regionRepositoryProvider.overrideWithValue(regions),
        savedRouteRepositoryProvider.overrideWithValue(savedRoutes),
      ],
    );
    container.listen(mapControllerProvider, (_, _) {});
  });

  tearDown(() => container.dispose());

  Future<void> calculate() async {
    unawaited(controller().calculateRoute());
    await pumpEventQueue();
  }

  test('a slower answer for the previous destination does not replace the new route', () async {
    controller().setDestination(_casino, label: 'Casino');
    await calculate();
    controller().setDestination(_port, label: 'Puerto');
    await calculate();

    final current = await routing.answer(1);
    await routing.answer(0);

    expect(state().route, same(current));
    expect(state().destination, _port);
    expect(state().destinationLabel, 'Puerto');
    expect(state().isRouting, isFalse);
  });

  test('an error for a calculation the user abandoned is not shown', () async {
    controller().setDestination(_casino, label: 'Casino');
    await calculate();
    controller().clearRoute();

    await routing.fail(0);

    expect(state().message, isNull);
    expect(state().destination, isNull);
    expect(state().isRouting, isFalse);
  });

  test('changing the profile while calculating asks again for the new profile', () async {
    controller().setDestination(_casino, label: 'Casino');
    await calculate();
    controller().setProfile(RoutingProfile.pedestrian);
    await pumpEventQueue();

    expect(routing.requests.map((request) => request.profile), [
      RoutingProfile.car,
      RoutingProfile.pedestrian,
    ]);
    await routing.answer(0);
    expect(state().route, isNull);
    expect(state().isRouting, isTrue);

    await routing.answer(1);
    expect(state().route?.profile, RoutingProfile.pedestrian);
    expect(state().isRouting, isFalse);
  });

  test('choosing another origin while calculating stops waiting for the old route', () async {
    controller().setDestination(_casino, label: 'Casino');
    await calculate();
    controller().setOrigin(_port, label: 'Puerto');

    expect(state().isRouting, isFalse);
    await routing.answer(0);
    expect(state().route, isNull);
  });

  test('a route saved after the user moved on is confirmed but not shown again', () async {
    controller().setDestination(_casino, label: 'Casino');
    await calculate();
    await routing.answer(0);

    final saving = controller().saveSelectedRoute('Al casino');
    await pumpEventQueue();
    controller().setDestination(_port, label: 'Puerto');
    regions.gate.complete();
    final saved = await saving;

    expect(savedRoutes.routes.single.routeId, saved!.routeId);
    expect(state().route, isNull);
    expect(state().destination, _port);
    expect(state().message, 'Ruta «Al casino» guardada. Estará disponible sin conexión.');
  });

  test(
    'saving marks the option that was saved, even if another one is selected meanwhile',
    () async {
      controller().setDestination(_casino, label: 'Casino');
      await calculate();
      await routing.answer(0, options: 2);

      final saving = controller().saveSelectedRoute('Al casino');
      await pumpEventQueue();
      controller().selectRoute(1);
      regions.gate.complete();
      final saved = await saving;

      final options = state().route!.routes;
      expect(options[0].savedRouteId, saved!.routeId);
      expect(options[1].savedRouteId, isNull);
      expect(state().selectedRoute, 1);
    },
  );
}
