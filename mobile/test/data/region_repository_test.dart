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

    test('the world overview map is used only where no detailed map covers the point', () async {
      catalog.add(
        region(
          'world',
          name: 'Mundo',
          bbox: const BoundingBox(west: -180, south: -85, east: 180, north: 85),
          maxZoom: 7,
        ),
      );
      await regions.refreshCatalog();

      final atQuito = await maps.resolveSource(around: quito, online: true);
      expect(atQuito.id, 'remote:ecuador:2026.09.01');
      final atMadrid = await maps.resolveSource(around: const Coordinate(40.4, -3.7), online: true);
      expect(atMadrid.id, 'remote:world:2026.09.01');
      // Position unknown: the widest detailed map rather than the world.
      expect((await maps.resolveSource(online: true)).id, 'remote:ecuador:2026.09.01');
    });

    test('the relief, imagery and overlays published for the region come along', () async {
      catalog = [
        region(
          'guayaquil',
          name: 'Guayaquil',
          bbox: guayaquilBox,
          version: '2026.09.20',
          assets: [RegionAsset.terrain, RegionAsset.satellite, RegionAsset.overlays],
        ),
      ];
      await regions.refreshCatalog();
      final expected = {
        'overlays': [Uri.parse('https://maps.example.com/maps/ec/guayaquil.overlays.pmtiles')],
        'satellite': [Uri.parse('https://maps.example.com/maps/ec/guayaquil.satellite.pmtiles')],
        'terrain': [Uri.parse('https://maps.example.com/maps/ec/guayaquil.terrain.pmtiles')],
      };

      final remote = await maps.resolveSource(around: guayaquilCenter, online: true);
      expect(remote, isA<RemoteMapSource>());
      expect(remote.assets, expected);

      // A downloaded map draws its own file, and the extra layers while online.
      await storeFile(catalog.single);
      final local = await maps.resolveSource(around: guayaquilCenter, online: true);
      expect(local, isA<LocalMapSource>());
      expect(local.assets, expected);
      expect((await maps.resolveSource(around: guayaquilCenter, online: false)).assets, isEmpty);
    });

    test('the imagery of the regions inside the map is drawn over it, as on the web', () async {
      const quitoBox = BoundingBox(west: -78.65, south: -0.40, east: -78.35, north: 0.05);
      const all = [RegionAsset.terrain, RegionAsset.satellite, RegionAsset.overlays];
      catalog = [
        region('ecuador', name: 'Ecuador', bbox: ecuadorBox, assets: all),
        region(
          'guayaquil',
          name: 'Guayaquil',
          bbox: guayaquilBox,
          version: '2026.09.20',
          assets: all,
        ),
        region('quito', name: 'Quito', bbox: quitoBox, assets: [RegionAsset.satellite]),
      ];
      await regions.refreshCatalog();
      Uri url(String code, String kind) =>
          Uri.parse('https://maps.example.com/maps/ec/$code.$kind.pmtiles');

      // In Guayaquil the country's map is shown: the cities' imagery (more zoom
      // levels) goes over the country's, and the country's relief shades it all once.
      final remote = await maps.resolveSource(around: guayaquilCenter, online: true);
      expect(remote.id, 'remote:ecuador:2026.09.01');
      expect(remote.assets, {
        'overlays': [url('ecuador', 'overlays')],
        'satellite': [
          url('ecuador', 'satellite'),
          url('guayaquil', 'satellite'),
          url('quito', 'satellite'),
        ],
        'terrain': [url('ecuador', 'terrain')],
      });

      // A downloaded city map: the imagery of the regions over the city only.
      await storeFile(catalog[1]);
      final local = await maps.resolveSource(around: guayaquilCenter, online: true);
      expect(local.id, 'local:guayaquil:2026.09.20');
      expect(local.assets, {
        'overlays': [url('guayaquil', 'overlays')],
        'satellite': [url('ecuador', 'satellite'), url('guayaquil', 'satellite')],
        'terrain': [url('ecuador', 'terrain')],
      });

      // Far from every detailed map, the world overview offers none.
      catalog.add(
        region(
          'world',
          name: 'Mundo',
          bbox: const BoundingBox(west: -180, south: -85, east: 180, north: 85),
          maxZoom: 7,
        ),
      );
      await regions.refreshCatalog();
      final atMadrid = await maps.resolveSource(around: const Coordinate(40.4, -3.7), online: true);
      expect(atMadrid.id, 'remote:world:2026.09.01');
      expect(atMadrid.assets, isEmpty);
    });
  });

  test('the published layers of a region are kept with the cached catalog', () async {
    catalog = [
      region('guayaquil', bbox: guayaquilBox, assets: [RegionAsset.satellite, RegionAsset.terrain]),
    ];
    await regions.refreshCatalog();
    online = false;
    final cached = (await regions.cachedCatalog()).single;
    expect(cached.assets, catalog.single.assets);
    expect(cached.asset(RegionAsset.terrain)!.tilesUrl, '/maps/ec/guayaquil.terrain.pmtiles');
    expect(cached.asset(RegionAsset.overlays), isNull);
  });

  test('file paths from the API cannot escape the storage directory', () async {
    expect(() => storage.regionMapFile('../etc', '1'), throwsArgumentError);
    expect(() => storage.resolve('../../secret'), throwsArgumentError);
  });
}
