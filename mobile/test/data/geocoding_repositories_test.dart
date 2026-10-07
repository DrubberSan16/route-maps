import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/core/errors/app_exception.dart';
import 'package:maps_platform/data/repositories/device_geocoding_repository.dart';
import 'package:maps_platform/data/repositories/hybrid_geocoding_repository.dart';
import 'package:maps_platform/domain/entities/coordinate.dart';
import 'package:maps_platform/domain/entities/geocoding_result.dart';
import 'package:maps_platform/domain/repositories/geocoding_repository.dart';
import 'package:maps_platform/domain/services/connectivity_service.dart';
import 'package:maps_platform/infrastructure/offline/offline_engine.dart';

import '../helpers/fakes.dart';
import '../infrastructure/offline/offline_fixture.dart';

/// Answers set by the test, counting the calls.
class _ScriptedGeocoding implements GeocodingRepository {
  _ScriptedGeocoding(GeocodingSource source)
    : place = GeocodingResult(
        displayName: source.name,
        coordinate: const Coordinate(-2.19, -79.88),
        source: source,
      );

  final GeocodingResult place;
  AppException? error;
  int calls = 0;

  @override
  Future<List<GeocodingResult>> search(String query, {Coordinate? near}) async {
    calls++;
    if (error case final error?) throw error;
    return [place];
  }

  @override
  Future<GeocodingResult?> reverse(Coordinate coordinate) async {
    calls++;
    if (error case final error?) throw error;
    return place;
  }
}

void main() {
  final expected = readExpected();

  group('on the phone', () {
    late OfflineEngine engine;
    late List<String> packs;
    late DeviceGeocodingRepository device;
    setUp(() {
      engine = OfflineEngine();
      packs = [fixturePack, duranPack];
      device = DeviceGeocodingRepository(engine: engine, packs: () async => packs);
    });
    tearDown(() => engine.dispose());

    test('finds the places the platform finds', () async {
      for (final item in expected['searches']! as List<Object?>) {
        final query = item! as Map<String, Object?>;
        if (query['limit'] != 10) continue;
        final near = query['near'] as List<Object?>?;
        final results = await device.search(
          query['text']! as String,
          near: near == null ? null : Coordinate.fromLngLat(near),
        );
        final platform = [
          for (final result in query['results']! as List<Object?>)
            GeocodingResult.fromJson(result! as Map<String, Object?>),
        ];
        expect(
          [for (final result in results) (result.displayName, result.coordinate, result.type)],
          [for (final result in platform) (result.displayName, result.coordinate, result.type)],
          reason: query['text'] as String?,
        );
        expect(results.every((result) => result.source == GeocodingSource.device), isTrue);
      }
    });

    test('gives the address of a point, and none outside the downloaded regions', () async {
      for (final item in expected['reverses']! as List<Object?>) {
        final query = item! as Map<String, Object?>;
        final point = Coordinate.fromLngLat(query['point']! as List<Object?>);
        final platform = query['result'] as Map<String, Object?>?;
        final result = await device.reverse(point);
        expect(result?.label, platform?['name'], reason: '$point');
        if (result != null) expect(result.source, GeocodingSource.device);
      }
      expect(await device.reverse(const Coordinate(-0.2, -78.5)), isNull);
    });

    test('without downloaded regions it explains what to do', () async {
      packs = [];
      await expectLater(
        device.search('hospital'),
        throwsA(
          isA<AppException>().having(
            (error) => error.code,
            'code',
            ErrorCodes.offlineSearchUnavailable,
          ),
        ),
      );
      await expectLater(
        device.reverse(const Coordinate(-2.188, -79.887)),
        throwsA(
          isA<AppException>().having(
            (error) => error.message,
            'message',
            contains('Mapas offline'),
          ),
        ),
      );
    });
  });

  group('online or on the phone', () {
    late FakeConnectivityService connectivity;
    late _ScriptedGeocoding online;
    late _ScriptedGeocoding device;
    late HybridGeocodingRepository hybrid;
    setUp(() {
      connectivity = FakeConnectivityService();
      online = _ScriptedGeocoding(GeocodingSource.server);
      device = _ScriptedGeocoding(GeocodingSource.device);
      hybrid = HybridGeocodingRepository(
        online: online,
        device: device,
        connectivity: connectivity,
      );
    });

    test('with connection the platform answers', () async {
      expect((await hybrid.search('malecon')).single.source, GeocodingSource.server);
      expect(
        (await hybrid.reverse(const Coordinate(-2.19, -79.88)))!.source,
        GeocodingSource.server,
      );
      expect(device.calls, 0);
    });

    test('without connection the phone answers, without trying the platform', () async {
      connectivity.status = ConnectivityStatus.offline;
      expect((await hybrid.search('malecon')).single.source, GeocodingSource.device);
      expect(
        (await hybrid.reverse(const Coordinate(-2.19, -79.88)))!.source,
        GeocodingSource.device,
      );
      expect(online.calls, 0);
    });

    test('a lost connection or a search engine down falls back to the phone', () async {
      for (final error in [
        AppException.of(ErrorCodes.networkUnavailable),
        AppException.of(ErrorCodes.geocodingProviderUnavailable, statusCode: 503),
        AppException.of(ErrorCodes.internalError, statusCode: 500),
      ]) {
        online.error = error;
        expect((await hybrid.search('malecon')).single.source, GeocodingSource.device);
      }
    });

    test('a request the platform rejects is not retried on the phone', () async {
      online.error = AppException.of(ErrorCodes.validationError, statusCode: 400);
      await expectLater(
        hybrid.search('m'),
        throwsA(isA<AppException>().having((e) => e.code, 'code', ErrorCodes.validationError)),
      );
      expect(device.calls, 0);
    });

    test('nothing downloaded: the problem that matters is reported', () async {
      device.error = AppException.of(ErrorCodes.offlineSearchUnavailable);
      online.error = AppException.of(ErrorCodes.geocodingProviderUnavailable, statusCode: 503);
      await expectLater(
        hybrid.search('malecon'),
        throwsA(
          isA<AppException>().having(
            (e) => e.code,
            'code',
            ErrorCodes.geocodingProviderUnavailable,
          ),
        ),
      );
      online.error = AppException.of(ErrorCodes.networkUnavailable);
      await expectLater(
        hybrid.search('malecon'),
        throwsA(
          isA<AppException>().having((e) => e.code, 'code', ErrorCodes.offlineSearchUnavailable),
        ),
      );
    });
  });
}
