import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/core/errors/app_exception.dart';
import 'package:maps_platform/domain/entities/coordinate.dart';
import 'package:maps_platform/domain/entities/route.dart';
import 'package:maps_platform/domain/entities/routing_profile.dart';
import 'package:maps_platform/infrastructure/offline/offline_engine.dart';
import 'package:maps_platform/services/routing/device_routing_provider.dart';

import '../infrastructure/offline/offline_fixture.dart';

/// Routes on the phone with the offline packs of the fixture city, compared with what the
/// platform answers for the same trips (expected.json).
void main() {
  final expected = readExpected();
  Map<String, Object?> trip(String name) => (expected['routes']! as List<Object?>)
      .cast<Map<String, Object?>>()
      .firstWhere((route) => route['name'] == name);
  List<Coordinate> stopsOf(Map<String, Object?> trip) => [
    for (final stop in trip['stops']! as List<Object?>)
      Coordinate.fromLngLat(stop! as List<Object?>),
  ];
  Matcher appError(String code, [Object? message]) => throwsA(
    isA<AppException>()
        .having((error) => error.code, 'code', code)
        .having((error) => error.message, 'message', message ?? anything),
  );

  const downtown = Coordinate(-2.188, -79.887);
  const farAway = Coordinate(-0.2, -78.5);

  late OfflineEngine engine;
  late List<String> packs;
  setUp(() {
    engine = OfflineEngine();
    packs = [duranPack, fixturePack];
  });
  tearDown(() => engine.dispose());

  DeviceRoutingProvider provider({String language = 'es-ES'}) =>
      DeviceRoutingProvider(engine: engine, packs: () async => packs, language: language);

  Future<RouteResult> route(Map<String, Object?> trip, {bool alternatives = true}) {
    final stops = stopsOf(trip);
    return provider(language: trip['language']! as String).calculateRoute(
      origin: stops.first,
      destination: stops.last,
      waypoints: stops.sublist(1, stops.length - 1),
      profile: RoutingProfile.fromApi(trip['profile']! as String),
      alternatives: alternatives,
    );
  }

  /// [option] is the route of the platform's JSON [route].
  void expectSameRoute(RouteOption option, Object? route) {
    final json = route! as Map<String, Object?>;
    expect(option.distanceMeters, json['distanceMeters']);
    expect(option.durationSeconds, json['durationSeconds']);
    expect(option.geometryJson(), json['geometry']);
    expect([for (final step in option.steps) step.toJson()], json['steps']);
    expect(option.hasTolls, json['hasTolls']);
    expect(option.hasFerry, json['hasFerry']);
  }

  test('calculates the routes of the platform, with its alternatives', () async {
    final query = trip('downtown by car, with alternatives');
    final result = await route(query);
    final platform = query['result']! as Map<String, Object?>;
    final alternatives = platform['alternatives']! as List<Object?>;

    expect(result.source, RouteSource.onDevice);
    expect(result.provider, 'native');
    expect(result.profile, RoutingProfile.car);
    expect(result.routes.map((option) => option.type), [
      RouteType.primary,
      for (final _ in alternatives) RouteType.alternative,
    ]);
    expectSameRoute(result.primary, platform['primary']);
    for (var i = 0; i < alternatives.length; i++) {
      expectSameRoute(result.routes[i + 1], alternatives[i]);
    }
    expect(result.routes.map((option) => option.routeId).toSet(), hasLength(result.routes.length));
    expect(result.origin, stopsOf(query).first);

    final single = await route(query, alternatives: false);
    expect(single.routes, hasLength(1));
  });

  test('routes with stops, in the language asked for', () async {
    for (final name in ['stops along the way', 'stops in English, walking']) {
      final query = trip(name);
      final result = await route(query);
      final platform = query['result']! as Map<String, Object?>;
      expect(result.routes, hasLength(1), reason: 'routes with stops come without alternatives');
      expectSameRoute(result.primary, platform['primary']);
    }
  });

  test('explains the trips it cannot calculate', () async {
    final far = trip('destination far from any road');
    await expectLater(
      route(far),
      throwsA(
        isA<AppException>().having((error) => error.code, 'code', ErrorCodes.routeNotFound).having(
          (error) => error.details,
          'details',
          {'reason': far['error']},
        ),
      ),
    );
    await expectLater(
      provider().calculateRoute(
        origin: downtown,
        destination: farAway,
        profile: RoutingProfile.car,
      ),
      appError(ErrorCodes.offlineRouteUnavailable, DeviceRoutingProvider.notCoveredMessage),
    );
    await expectLater(
      provider().calculateRoute(
        origin: downtown,
        destination: downtown,
        profile: RoutingProfile.car,
      ),
      appError(ErrorCodes.invalidCoordinates),
    );
    await expectLater(
      provider().calculateRoute(
        origin: downtown,
        destination: const Coordinate(95, 0),
        profile: RoutingProfile.car,
      ),
      appError(ErrorCodes.invalidCoordinates),
    );
  });

  test('without downloaded regions it cannot route', () async {
    packs = [];
    expect(
      await provider().canRoute(
        origin: downtown,
        destination: farAway,
        profile: RoutingProfile.car,
      ),
      isFalse,
    );
    await expectLater(
      provider().calculateRoute(
        origin: downtown,
        destination: const Coordinate(-2.1961, -79.8336),
        profile: RoutingProfile.car,
      ),
      appError(
        ErrorCodes.offlineRouteUnavailable,
        userMessageFor(ErrorCodes.offlineRouteUnavailable),
      ),
    );

    packs = ['$fixtureDirectory/missing.rmpack'];
    expect(
      await provider().canRoute(
        origin: downtown,
        destination: farAway,
        profile: RoutingProfile.car,
      ),
      isTrue,
    );
    await expectLater(
      provider().calculateRoute(
        origin: downtown,
        destination: const Coordinate(-2.1961, -79.8336),
        profile: RoutingProfile.car,
      ),
      appError(ErrorCodes.offlineRouteUnavailable, contains('Descárgalos otra vez')),
    );
  });
}
