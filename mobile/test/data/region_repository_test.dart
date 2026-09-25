import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/core/config/app_config.dart';
import 'package:maps_platform/data/local/app_database.dart';
import 'package:maps_platform/data/repositories/map_repository_impl.dart';
import 'package:maps_platform/data/repositories/region_repository_impl.dart';
import 'package:maps_platform/domain/entities/coordinate.dart';
import 'package:maps_platform/domain/entities/map_region.dart';
import 'package:maps_platform/domain/repositories/map_repository.dart';
import 'package:maps_platform/domain/services/offline_storage_service.dart';

import '../helpers/api_stub.dart';
import '../helpers/database.dart';
import '../helpers/fixtures.dart';
import '../helpers/regions.dart';

void main() {
  late AppDatabase db;
  late OfflineStorageService storage;
  late Directory root;
  var catalog = <MapRegion>[];
  var online = true;
  late RegionRepositoryImpl regions;
  late MapRepositoryImpl maps;

  setUp(() async {
    db = memoryDatabase();
    (:storage, :root) = await temporaryStorage();
    online = true;
    catalog = [
      region('ecuador', name: 'Ecuador', bbox: ecuadorBox, version: '2026.09.01'),
      region('guayaquil', name: 'Guayaquil', bbox: guayaquilBox, version: '2026.09.20'),
    ];
    final stub = stubApi((request) {
      if (!online) throwConnectionError(request);
      return switch (request.path) {
        'maps/regions' => StubResponse.ok([for (final r in catalog) regionJson(r)]),
        'maps/regions/updates' => StubResponse.ok([
          for (final item in (request.data as Map)['regions'] as List)
            {
              'region': (item as Map)['id'],
              'localVersion': item['version'],
              'latestVersion': catalog.firstWhere((r) => r.code == item['id']).version,
              'checksum': 'bb',
              'updateAvailable':
                  catalog.firstWhere((r) => r.code == item['id']).version != item['version'],
            },
        ]),
        _ => StubResponse.error(404, 'NOT_FOUND', 'No encontrado'),
      };
    });
    regions = RegionRepositoryImpl(api: stub.api, db: db, storage: storage);
    maps = MapRepositoryImpl(
      regions: regions,
      storage: storage,
      config: AppConfig(apiBaseUrl: Uri.parse('https://maps.example.com')),
    );
  });

  tearDown(() async {
    await db.close();
    await root.delete(recursive: true);
  });

  Future<DownloadedRegion> storeFile(MapRegion region) async {
    final file = await storage.regionMapFile(region.code, region.version);
    await file.create(recursive: true);
    await file.writeAsBytes(List.filled(16, 1));
    return regions.saveDownloaded(
      region: region,
      relativePath: await storage.relativePathOf(file),
      sizeBytes: 16,
    );
  }

  test('parses the catalog captured from the platform', () {
    final parsed = [
      for (final item in fixtureData('regions_list')! as List<Object?>)
        MapRegion.fromJson(item! as Map<String, Object?>),
    ];
    final monaco = parsed.single;
    expect(monaco.code, 'monaco');
    expect(monaco.mapSizeBytes, 791537);
    expect(monaco.bbox!.contains(const Coordinate(43.7384, 7.4246)), isTrue);
    expect(monaco.mapDownloadUrl, '/api/v1/maps/regions/monaco/download');
  });

  test('the catalog is cached and still readable without connection', () async {
    await regions.refreshCatalog();
    online = false;
    await expectLater(regions.refreshCatalog(), throwsA(anything));
    final cached = await regions.cachedCatalog();
    expect(cached.map((r) => r.code), ['ecuador', 'guayaquil']);
    expect(cached.last.bbox, guayaquilBox);
  });

  test('detects the most specific region for a position', () async {
    await regions.refreshCatalog();
    expect((await regions.detectRegion(guayaquilCenter))!.code, 'guayaquil');
    expect((await regions.detectRegion(quito))!.code, 'ecuador');
    expect(await regions.detectRegion(const Coordinate(40.4, -3.7)), isNull);
  });

  test('knows when a stored region has a newer version', () async {
    await regions.refreshCatalog();
    await storeFile(
      region('guayaquil', name: 'Guayaquil', bbox: guayaquilBox, version: '2026.08.01'),
    );
    expect((await regions.downloadedRegions()).single.updateAvailable, isFalse);

    final statuses = await regions.checkForUpdates();
    expect(statuses.single.updateAvailable, isTrue);
    final stored = (await regions.downloadedRegions()).single;
    expect(stored.updateAvailable, isTrue);
    expect(stored.latestVersion, '2026.09.20');
  });

  test('a stored region whose file disappeared is forgotten', () async {
    final stored = await storeFile(catalog.last);
    await (await storage.resolve(stored.relativePath)).delete();
    expect(await regions.removeMissingFiles(), ['guayaquil']);
    expect(await regions.downloadedRegions(), isEmpty);
  });

  test('deleting a region removes its row and its files', () async {
    final stored = await storeFile(catalog.last);
    await regions.deleteDownloaded('guayaquil');
    expect(await regions.downloadedRegions(), isEmpty);
    expect(await (await storage.resolve(stored.relativePath)).exists(), isFalse);
  });

  group('map source (offline first)', () {
    test('a downloaded region is used even with connection', () async {
      await regions.refreshCatalog();
      await storeFile(catalog.last);
      final source = await maps.resolveSource(around: guayaquilCenter, online: true);
      expect(source, isA<LocalMapSource>());
      expect(source.id, 'local:guayaquil:2026.09.20');
    });

    test('online outside stored regions, the server tiles of the area are used', () async {
      await regions.refreshCatalog();
      await storeFile(catalog.last);
      final source = await maps.resolveSource(around: quito, online: true);
      expect(source, isA<RemoteMapSource>());
      expect(
        (source as RemoteMapSource).url.toString(),
        'https://maps.example.com/maps/ec/ecuador.pmtiles',
      );
    });

    test('offline outside stored regions, the stored map is still shown', () async {
      await storeFile(catalog.last);
      final source = await maps.resolveSource(around: quito, online: false);
      expect(source.id, 'local:guayaquil:2026.09.20');
    });

    test('offline with nothing stored there is no base map', () async {
      await regions.refreshCatalog();
      expect(await maps.resolveSource(around: quito, online: false), isA<NoMapSource>());
    });
  });

  test('file paths from the API cannot escape the storage directory', () async {
    expect(() => storage.regionMapFile('../etc', '1'), throwsArgumentError);
    expect(() => storage.resolve('../../secret'), throwsArgumentError);
  });
}
