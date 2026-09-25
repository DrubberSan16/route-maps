import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/core/errors/app_exception.dart';
import 'package:maps_platform/domain/entities/coordinate.dart';
import 'package:maps_platform/domain/entities/route.dart';
import 'package:maps_platform/domain/entities/routing_profile.dart';
import 'package:maps_platform/domain/services/connectivity_service.dart';
import 'package:maps_platform/domain/services/routing_service.dart';
import 'package:maps_platform/services/routing/hybrid_routing_service.dart';
import 'package:maps_platform/services/routing/online_routing_service.dart';

import '../helpers/api_stub.dart';
import '../helpers/fakes.dart';
import '../helpers/fixtures.dart';

const _origin = Coordinate(43.7383, 7.4245);
const _destination = Coordinate(43.7314, 7.4196);

RouteResult _result(RouteSource source) => RouteResult(
  profile: RoutingProfile.car,
  provider: source.name,
  source: source,
  routes: const [
    RouteOption(
      routeId: 'r',
      type: RouteType.primary,
      distanceMeters: 1,
      durationSeconds: 1,
      geometry: [_origin, _destination],
      steps: [],
    ),
  ],
  origin: _origin,
  destination: _destination,
);

class _ScriptedRouting implements RoutingService {
  _ScriptedRouting(this.answer);

  Future<RouteResult> Function() answer;
  int calls = 0;

  @override
  Future<RouteResult> calculateRoute({
    required Coordinate origin,
    required Coordinate destination,
    required RoutingProfile profile,
    bool alternatives = true,
  }) {
    calls++;
    return answer();
  }
}

void main() {
  group('OnlineRoutingService', () {
    test('posts the request and parses the captured response', () async {
      final stub = stubApi((_) => StubResponse.ok(fixtureData('route_calculate_monaco')));
      final service = OnlineRoutingService(stub.api);
      final result = await service.calculateRoute(
        origin: _origin,
        destination: _destination,
        profile: RoutingProfile.car,
      );
      final request = stub.adapter.requests.single;
      expect(request.path, 'routes/calculate');
      expect(request.method, 'POST');
      expect(request.data, {
        'origin': {'latitude': 43.7383, 'longitude': 7.4245},
        'destination': {'latitude': 43.7314, 'longitude': 7.4196},
        'profile': 'CAR',
        'alternatives': true,
        'language': 'es-ES',
      });
      expect(result.routes, hasLength(2));
      expect(result.source, RouteSource.server);
    });

    test('rejects invalid coordinates before calling the API', () async {
      final stub = stubApi((_) => StubResponse.ok(null));
      await expectLater(
        OnlineRoutingService(stub.api).calculateRoute(
          origin: const Coordinate(95, 0),
          destination: _destination,
          profile: RoutingProfile.car,
        ),
        throwsA(isA<AppException>().having((e) => e.code, 'code', ErrorCodes.invalidCoordinates)),
      );
      expect(stub.adapter.requests, isEmpty);
    });
  });

  group('HybridRoutingService chooses online or offline', () {
    late FakeConnectivityService connectivity;
    late _ScriptedRouting online;
    late _ScriptedRouting offline;
    late HybridRoutingService hybrid;

    setUp(() {
      connectivity = FakeConnectivityService();
      online = _ScriptedRouting(() async => _result(RouteSource.server));
      offline = _ScriptedRouting(() async => _result(RouteSource.savedRoute));
      hybrid = HybridRoutingService(online: online, offline: offline, connectivity: connectivity);
    });

    Future<RouteResult> route() => hybrid.calculateRoute(
      origin: _origin,
      destination: _destination,
      profile: RoutingProfile.car,
    );

    test('online: the server calculates', () async {
      expect((await route()).source, RouteSource.server);
      expect(offline.calls, 0);
    });

    test('offline: the device answers without trying the server', () async {
      connectivity.status = ConnectivityStatus.offline;
      expect((await route()).source, RouteSource.savedRoute);
      expect(online.calls, 0);
    });

    test('connection lost during the request: falls back to the device', () async {
      online.answer = () async => throw AppException.of(ErrorCodes.networkUnavailable);
      expect((await route()).source, RouteSource.savedRoute);
    });

    test('routing engine down: falls back to the device', () async {
      online.answer = () async =>
          throw AppException.of(ErrorCodes.routingProviderUnavailable, statusCode: 503);
      expect((await route()).source, RouteSource.savedRoute);
    });

    test('a request the server rejects is not retried offline', () async {
      online.answer = () async =>
          throw AppException.of(ErrorCodes.invalidCoordinates, statusCode: 400);
      await expectLater(
        route(),
        throwsA(isA<AppException>().having((e) => e.code, 'code', ErrorCodes.invalidCoordinates)),
      );
      expect(offline.calls, 0);
    });

    test('engine down and nothing stored: the server problem is reported', () async {
      online.answer = () async =>
          throw AppException.of(ErrorCodes.routingProviderUnavailable, statusCode: 503);
      offline.answer = () async => throw AppException.of(ErrorCodes.offlineRouteUnavailable);
      await expectLater(
        route(),
        throwsA(
          isA<AppException>().having((e) => e.code, 'code', ErrorCodes.routingProviderUnavailable),
        ),
      );
    });

    test('no connection and nothing stored: says a new route needs Internet', () async {
      online.answer = () async => throw AppException.of(ErrorCodes.networkUnavailable);
      offline.answer = () async => throw AppException.of(ErrorCodes.offlineRouteUnavailable);
      await expectLater(
        route(),
        throwsA(
          isA<AppException>()
              .having((e) => e.code, 'code', ErrorCodes.offlineRouteUnavailable)
              .having((e) => e.message, 'message', contains('requiere Internet')),
        ),
      );
    });
  });
}
