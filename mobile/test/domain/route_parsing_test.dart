import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/core/errors/app_exception.dart';
import 'package:maps_platform/data/remote/api_client.dart';
import 'package:maps_platform/domain/entities/coordinate.dart';
import 'package:maps_platform/domain/entities/offline_route.dart';
import 'package:maps_platform/domain/entities/route.dart';
import 'package:maps_platform/domain/entities/routing_profile.dart';

import '../helpers/fixtures.dart';

void main() {
  const origin = Coordinate(43.7383, 7.4245);
  const destination = Coordinate(43.7314, 7.4196);

  group('RouteResult.fromApi (captured Valhalla response for Monaco)', () {
    late RouteResult result;

    setUp(() {
      result = RouteResult.fromApi(
        fixtureData('route_calculate_monaco')! as Map<String, Object?>,
        origin: origin,
        destination: destination,
      );
    });

    test('reads the primary route and the alternative', () {
      expect(result.profile, RoutingProfile.car);
      expect(result.provider, 'valhalla');
      expect(result.source, RouteSource.server);
      expect(result.routes, hasLength(2));
      expect(result.primary.type, RouteType.primary);
      expect(result.routes[1].type, RouteType.alternative);
      expect(result.distanceMeters, 2487);
      expect(result.durationSeconds, 198);
      expect(result.routes[1].distanceMeters, 2399);
      expect(result.primary.hasTolls, isFalse);
      expect(result.primary.hasFerry, isFalse);
    });

    test('keeps GeoJSON [lng, lat] order straight', () {
      final geometry = result.geometry;
      expect(geometry, hasLength(154));
      expect(geometry.first, const Coordinate(43.738293, 7.424532));
      expect(geometry.last, const Coordinate(43.731357, 7.419557));
    });

    test('reads the turn-by-turn instructions in Spanish', () {
      final steps = result.steps;
      expect(steps, hasLength(12));
      expect(steps.first.maneuver, Maneuvers.depart);
      expect(steps.first.instruction, "Conduzca hacia el noroeste por Avenue de l'Hermitage.");
      expect(steps.first.distanceMeters, 20);
      expect(steps.first.durationSeconds, closeTo(2.1, 1e-9));
      expect(steps.first.location, const Coordinate(43.738293, 7.424532));
      expect(steps.first.geometryStart, 0);
      expect(steps.first.geometryEnd, 1);
      expect(steps.first.streetNames, ["Avenue de l'Hermitage"]);
      expect(steps.last.maneuver, Maneuvers.arrive);
      expect(steps.last.instruction, 'Su destino está a la derecha.');
      expect(steps.last.geometryStart, 153);
      expect(steps.last.geometryEnd, 153);
    });

    test('bounding box covers the geometry', () {
      final bbox = result.primary.bbox;
      for (final point in result.geometry) {
        expect(bbox.contains(point), isTrue);
      }
    });

    test('a stored route round-trips through the sync payload', () {
      final option = result.primary;
      final route = OfflineRoute(
        routeId: '0b9f7a52-3c1d-4d8e-9b8a-5f0e2d7c6a11',
        name: 'Hermitage → Fontvieille',
        profile: result.profile,
        origin: origin,
        destination: destination,
        distanceMeters: option.distanceMeters,
        durationSeconds: option.durationSeconds,
        geometry: option.geometry,
        steps: option.steps,
        provider: 'valhalla',
        regionId: 'monaco',
        createdAt: DateTime.utc(2026, 9, 25),
        updatedAt: DateTime.utc(2026, 9, 25),
      );
      final payload = route.toSyncPayload();
      expect(payload['regionCode'], 'monaco');
      expect((payload['geometry']! as Map)['type'], 'LineString');
      final back = OfflineRoute.fromApi({
        ...payload,
        'createdAt': '2026-09-25T00:00:00.000Z',
        'updatedAt': '2026-09-25T00:00:00.000Z',
      });
      expect(back.geometry, option.geometry);
      expect(
        back.steps.map((step) => step.instruction),
        option.steps.map((step) => step.instruction),
      );
      expect(back.steps[3].geometryStart, option.steps[3].geometryStart);
      expect(back.toRouteResult().source, RouteSource.savedRoute);
      expect(back.toRouteResult().primary.savedRouteName, 'Hermitage → Fontvieille');
    });

    test('rejects geometries that are not LineStrings', () {
      final json = Map<String, Object?>.from(
        (fixtureData('route_calculate_monaco')! as Map<String, Object?>),
      )..remove('routes');
      json['geometry'] = {
        'type': 'Point',
        'coordinates': [7.4, 43.7],
      };
      expect(
        () => RouteResult.fromApi(json, origin: origin, destination: destination),
        throwsFormatException,
      );
    });
  });

  test('routing errors keep the API code with a Spanish message', () {
    final error = exceptionFromResponse(
      Response<Object?>(
        requestOptions: RequestOptions(path: 'routes/calculate'),
        statusCode: 400,
        data: loadFixture('route_error'),
      ),
    );
    expect(error.code, ErrorCodes.invalidCoordinates);
    expect(error.statusCode, 400);
    expect(error.message, 'Los puntos no son válidos o están demasiado lejos entre sí.');
    expect(error.isRetryable, isFalse);
  });
}
