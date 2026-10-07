import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/infrastructure/offline/binary.dart';
import 'package:maps_platform/infrastructure/offline/js_math.dart';
import 'package:maps_platform/infrastructure/offline/offline_engine.dart';
import 'package:maps_platform/infrastructure/offline/road_router.dart';

import 'offline_fixture.dart';

void main() {
  final expected = readExpected();
  Map<String, Object?> expectedRoute(String name) => (expected['routes']! as List<Object?>)
      .cast<Map<String, Object?>>()
      .firstWhere((route) => route['name'] == name);
  Map<String, Object?> expectedSearch(String text, {bool near = true}) =>
      (expected['searches']! as List<Object?>).cast<Map<String, Object?>>().firstWhere(
        (search) => search['text'] == text && (search['near'] != null) == near,
      );
  List<Stop> stopsOf(Map<String, Object?> query) => [
    for (final stop in query['stops']! as List<Object?>)
      if (stop case [final num longitude, final num latitude])
        (longitude: longitude.toDouble(), latitude: latitude.toDouble()),
  ];
  Matcher engineError(String code) =>
      throwsA(isA<OfflineEngineException>().having((error) => error.code, 'code', code));

  const downtown = (longitude: -79.887, latitude: -2.188);
  const inDuran = (longitude: -79.8336, latitude: -2.1961);
  const inDuranToo = (longitude: -79.8186, latitude: -2.2058);
  const farAway = (longitude: -78.5, latitude: -0.2);

  group('OfflinePackSet', () {
    late OfflinePackSet packs;
    setUp(() => packs = OfflinePackSet());

    test('routes on the smallest pack that covers every stop', () {
      final local = packs.route(
        packs: [fixturePack, duranPack],
        profile: 'CAR',
        stops: [inDuran, inDuranToo],
        alternatives: 2,
      );
      expect(local['region'], 'fixture-duran');
      expect((local['primary']! as Map<String, Object?>)['distanceMeters'], greaterThan(0));

      final query = expectedRoute('downtown to Durán through the roundabout and the E40');
      final across = packs.route(
        packs: [duranPack, fixturePack],
        profile: query['profile']! as String,
        stops: stopsOf(query),
        alternatives: (query['alternatives']! as num).toInt(),
        language: query['language'] as String?,
      );
      expect(across['region'], 'fixture');
      expect({
        'primary': across['primary'],
        'alternatives': across['alternatives'],
      }, query['result']);
    });

    test('routes exactly as the platform, failures included', () {
      for (final item in expected['routes']! as List<Object?>) {
        final query = item! as Map<String, Object?>;
        Map<String, Object?> route() => packs.route(
          packs: [fixturePack],
          profile: query['profile']! as String,
          stops: stopsOf(query),
          alternatives: (query['alternatives']! as num).toInt(),
          language: query['language'] as String?,
        );
        if (query['error'] case final String message) {
          expect(
            route,
            throwsA(isA<NoRouteError>().having((error) => error.message, 'message', message)),
            reason: query['name'] as String?,
          );
        } else {
          final answer = route();
          expect(
            {'primary': answer['primary'], 'alternatives': answer['alternatives']},
            query['result'],
            reason: query['name'] as String?,
          );
        }
      }
    });

    test('a route outside the downloaded regions is not covered', () {
      expect(
        () => packs.route(
          packs: [fixturePack, duranPack],
          profile: 'CAR',
          stops: [downtown, farAway],
          alternatives: 0,
        ),
        engineError('not_covered'),
      );
      expect(
        () => packs.route(
          packs: const [],
          profile: 'CAR',
          stops: [downtown, inDuran],
          alternatives: 0,
        ),
        engineError('not_covered'),
      );
    });

    test('searches every region that another one does not contain', () {
      final query = expectedSearch('rocafuerte');
      final near = query['near']! as List<Object?>;
      List<Map<String, Object?>> search(List<String> paths) => packs.search(
        packs: paths,
        text: query['text']! as String,
        limit: (query['limit']! as num).toInt(),
        nearLongitude: (near[0]! as num).toDouble(),
        nearLatitude: (near[1]! as num).toDouble(),
      );
      // Durán is inside the city: the city alone answers, exactly as the platform.
      expect(search([duranPack, fixturePack]), query['results']);
      expect(search([fixturePack, duranPack, fixturePack]), query['results']);

      final duran = search([duranPack]);
      expect(duran, isNotEmpty);
      for (final result in duran) {
        expect(result['longitude'], inInclusiveRange(-79.84, -79.81));
        expect(result['latitude'], inInclusiveRange(-2.21, -2.19));
      }
    });

    test('finds the address with the smallest pack that covers the point', () {
      final query = (expected['reverses']! as List<Object?>)
          .cast<Map<String, Object?>>()
          .firstWhere(
            (reverse) => (reverse['result'] as Map<String, Object?>?)?['name'] == 'Durán',
          );
      final [longitude as num, latitude as num] = query['point']! as List<Object?>;
      final answer = packs.reverse(
        packs: [fixturePack, duranPack],
        latitude: latitude.toDouble(),
        longitude: longitude.toDouble(),
      )!;
      final platform = query['result']! as Map<String, Object?>;
      // The same place, numbered in the index of the Durán pack.
      expect(answer['sourceId'], isNot(platform['sourceId']));
      expect({...answer}..remove('sourceId'), {...platform}..remove('sourceId'));
      expect(
        () => packs.reverse(
          packs: [fixturePack, duranPack],
          latitude: farAway.latitude,
          longitude: farAway.longitude,
        ),
        engineError('not_covered'),
      );
    });

    test('reads a pack again when its file is replaced', () {
      final directory = Directory.systemTemp.createTempSync('offline-pack');
      addTearDown(() => directory.deleteSync(recursive: true));
      final file = File('${directory.path}/region.rmpack');
      File(duranPack).copySync(file.path);
      expect(packs.pack(file.path).region, 'fixture-duran');
      expect(identical(packs.pack(file.path), packs.pack(file.path)), isTrue);
      File(fixturePack).copySync(file.path);
      file.setLastModifiedSync(DateTime.now().add(const Duration(minutes: 1)));
      expect(packs.pack(file.path).region, 'fixture');
    });

    test('rejects missing and damaged packs', () {
      final directory = Directory.systemTemp.createTempSync('offline-pack');
      addTearDown(() => directory.deleteSync(recursive: true));
      expect(() => packs.pack('${directory.path}/missing.rmpack'), engineError('invalid_pack'));
      final damaged = File('${directory.path}/damaged.rmpack')
        ..writeAsBytesSync(Uint8List.fromList(List.generate(64, (index) => index)));
      expect(() => packs.pack(damaged.path), throwsFormatException);
      final truncated = File('${directory.path}/truncated.rmpack')
        ..writeAsBytesSync(File(duranPack).readAsBytesSync().sublist(0, 4000));
      expect(() => packs.pack(truncated.path).places, throwsFormatException);
    });
  });

  group('OfflineEngine', () {
    test('answers from a background isolate like the pack set', () async {
      final engine = OfflineEngine();
      addTearDown(engine.dispose);
      final query = expectedRoute('downtown by car, with alternatives');
      final route = await engine.route(
        packs: [fixturePack],
        profile: query['profile']! as String,
        stops: stopsOf(query),
        alternatives: (query['alternatives']! as num).toInt(),
        language: query['language'] as String?,
      );
      expect({'primary': route['primary'], 'alternatives': route['alternatives']}, query['result']);

      final search = expectedSearch('hospital');
      final near = search['near']! as List<Object?>;
      expect(
        await engine.search(
          packs: [fixturePack],
          text: 'hospital',
          nearLongitude: (near[0]! as num).toDouble(),
          nearLatitude: (near[1]! as num).toDouble(),
        ),
        search['results'],
      );

      final reverse = (expected['reverses']! as List<Object?>).first! as Map<String, Object?>;
      final [longitude as num, latitude as num] = reverse['point']! as List<Object?>;
      expect(
        await engine.reverse(
          packs: [fixturePack],
          latitude: latitude.toDouble(),
          longitude: longitude.toDouble(),
        ),
        reverse['result'],
      );
      expect((await engine.describe(duranPack))['region'], 'fixture-duran');
    });

    test('reports why a request failed', () async {
      final engine = OfflineEngine();
      addTearDown(engine.dispose);
      final far = expectedRoute('destination far from any road');
      await expectLater(
        engine.route(packs: [fixturePack], profile: 'CAR', stops: stopsOf(far)),
        throwsA(
          isA<OfflineEngineException>()
              .having((error) => error.code, 'code', 'no_route')
              .having((error) => error.message, 'message', far['error']),
        ),
      );
      await expectLater(
        engine.route(packs: [duranPack], profile: 'CAR', stops: [downtown, inDuran]),
        engineError('not_covered'),
      );
      await expectLater(
        engine.search(packs: ['${Directory.systemTemp.path}/none.rmpack'], text: 'hospital'),
        engineError('invalid_pack'),
      );
      // The isolate keeps working after errors.
      expect(await engine.search(packs: [fixturePack], text: 'malecon'), isNotEmpty);
    });

    test('stops when idle and starts again on the next request', () async {
      final engine = OfflineEngine(idleTimeout: const Duration(milliseconds: 50));
      addTearDown(engine.dispose);
      expect(await engine.search(packs: [fixturePack], text: 'faro'), isNotEmpty);
      await Future<void>.delayed(const Duration(milliseconds: 300));
      expect(await engine.search(packs: [fixturePack], text: 'faro'), isNotEmpty);
      await engine.dispose();
      expect(await engine.search(packs: [duranPack], text: 'duran'), isNotEmpty);
    });
  });

  group('binary files', () {
    test('reject a wrong magic, a truncated header and a missing or mistyped section', () {
      final pack = File(duranPack).readAsBytesSync();
      expect(() => BinaryFile.parse(pack, magic: 'RMGRAPH2'), throwsFormatException);
      expect(() => BinaryFile.parse(pack.sublist(0, 20), magic: 'RMPACK01'), throwsFormatException);
      final file = BinaryFile.parse(pack, magic: 'RMPACK01');
      expect(file.has('graph'), isTrue);
      expect(() => file.uint8('nothing'), throwsFormatException);
      expect(() => file.int32('graph'), throwsFormatException);
    });
  });

  group('JavaScript arithmetic', () {
    test('rounds halves up like Math.round', () {
      expect(jsRound(2.5), 3);
      expect(jsRound(-2.5), -2);
      expect(jsRound(-2.6), -3);
      expect(jsRound(0.49999999999999994), 0);
      expect(jsRoundInt(1526.4999), 1526);
    });

    test('computes Math.hypot bit for bit', () {
      // Values where V8's Math.hypot and sqrt(a * a + b * b) differ in the last bit.
      expect(jsHypot(42.291998863220215, 487.09189891815186), 488.9244636541903);
      expect(jsHypot(369.89355087280273, 415.3265953063965), 556.1631233245279);
      expect(jsHypot(-425.44031143188477, 497.3731338977814), 654.507061011995);
      expect(jsHypot(3, -4), 5);
      expect(jsHypot(0, 0), 0);
      expect(jsHypot(double.nan, double.infinity), double.infinity);
      expect(jsHypot(double.nan, 1), isNaN);
    });

    test('sorts keeping the order of equal elements', () {
      final items = [(3, 'a'), (1, 'b'), (3, 'c'), (1, 'd'), (2, 'e')];
      stableSort(items, (a, b) => a.$1 - b.$1);
      expect(items.map((item) => item.$2).join(), 'bdeac');
      expect(jsCompare(double.nan), 0);
      expect(jsCompare(-0.0), 0);
    });
  });
}
