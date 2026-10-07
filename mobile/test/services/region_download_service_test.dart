import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/core/errors/app_exception.dart';
import 'package:maps_platform/data/local/app_database.dart';
import 'package:maps_platform/data/local/region_download_store.dart';
import 'package:maps_platform/data/repositories/region_repository_impl.dart';
import 'package:maps_platform/domain/entities/map_region.dart';
import 'package:maps_platform/domain/services/connectivity_service.dart';
import 'package:maps_platform/domain/services/offline_storage_service.dart';
import 'package:maps_platform/infrastructure/download/region_download_manager.dart';
import 'package:maps_platform/services/regions/region_download_service.dart';

import '../helpers/api_stub.dart';
import '../helpers/async.dart';
import '../helpers/database.dart';
import '../helpers/fakes.dart';
import '../helpers/range_server.dart';
import '../helpers/regions.dart';

Uint8List randomBytes(int length, int seed) {
  final random = math.Random(seed);
  return Uint8List.fromList(List.generate(length, (_) => random.nextInt(256)));
}

void main() {
  late AppDatabase db;
  late OfflineStorageService storage;
  late Directory root;
  late RangeServer server;
  late RegionRepositoryImpl regions;
  late RegionDownloadStore store;
  late RecordingSyncService sync;
  late FakeConnectivityService connectivity;
  late RegionDownloadService service;
  late List<MapRegion> catalog;
  late int freeBytes;

  const mapPath = '/api/v1/maps/regions/guayaquil/download';
  const packPath = '/api/v1/maps/regions/guayaquil/routing/download';

  /// Guayaquil as published: the server serves [content] for it and, with
  /// [pack], that offline pack in [packFormat].
  MapRegion publish(
    Uint8List content, {
    String version = '2026.09.20',
    Uint8List? pack,
    String packFormat = MapRegion.offlinePackFormat,
  }) {
    server
      ..content = content
      ..etag = '"$version"'
      ..files.clear();
    if (pack != null) server.files[packPath] = pack;
    final published = MapRegion(
      code: 'guayaquil',
      name: 'Guayaquil',
      country: 'EC',
      city: 'Guayaquil',
      version: version,
      mapSizeBytes: content.length,
      checksum: sha256.convert(content).toString(),
      routingSizeBytes: pack?.length,
      routingChecksum: pack == null ? null : sha256.convert(pack).toString(),
      routingDownloadUrl: pack == null ? null : packPath,
      routingFormat: pack == null ? null : packFormat,
      bbox: guayaquilBox,
      minZoom: 0,
      maxZoom: 14,
      mapDownloadUrl: mapPath,
      tilesUrl: '/maps/ec/guayaquil.pmtiles',
      updatedAt: DateTime.utc(2026, 9, 20),
    );
    catalog = [published];
    return published;
  }

  List<String> requestedPaths() => [for (final request in server.requests) request.path];

  RegionDownloadService createService() => RegionDownloadService(
    regions: regions,
    store: store,
    manager: RegionDownloadManager(
      dio: Dio(),
      freeBytes: () async => freeBytes,
      minimumFreeMarginBytes: 0,
      sha256OfFile: (path) async => sha256.convert(await File(path).readAsBytes()).toString(),
    ),
    storage: storage,
    sync: sync,
    connectivity: connectivity,
    resolveUrl: (path) => server.origin.resolve(path),
    progressInterval: Duration.zero,
  );

  setUp(() async {
    db = memoryDatabase();
    (:storage, :root) = await temporaryStorage();
    server = await RangeServer.start();
    freeBytes = 1 << 40;
    catalog = [];
    final api = stubApi(
      (request) => StubResponse.ok([for (final region in catalog) regionJson(region)]),
    ).api;
    regions = RegionRepositoryImpl(api: api, db: db, storage: storage);
    store = RegionDownloadStore(db);
    sync = RecordingSyncService();
    connectivity = FakeConnectivityService();
    service = createService();
  });

  tearDown(() async {
    await service.dispose();
    await server.close();
    await db.close();
    await root.delete(recursive: true);
  });

  Future<File> fileOf(MapRegion region) => storage.regionMapFile(region.code, region.version);
  Future<File> packOf(MapRegion region) => storage.regionPackFile(region.code, region.version);

  test('downloads a region, registers it for offline use and tells the server', () async {
    final region = publish(randomBytes(2 * 1024 * 1024, 1));
    final progress = <RegionDownloadTask>[];
    final subscription = service.watchTasks().listen((tasks) {
      if (tasks['guayaquil'] case final task?) progress.add(task);
    });

    expect(await service.download(region), RegionDownloadResult.completed);

    final stored = (await regions.downloadedRegions()).single;
    expect(stored.version, '2026.09.20');
    expect(await (await fileOf(region)).readAsBytes(), server.content);
    expect(service.tasks, isEmpty);
    expect(progress.first.status, RegionDownloadStatus.downloading);
    expect(progress.map((task) => task.receivedBytes), contains(greaterThan(0)));
    expect(sync.enqueued.single.operation, 'UPSERT');
    expect(sync.enqueued.single.payload, {'regionId': 'guayaquil', 'version': '2026.09.20'});
    await subscription.cancel();
  });

  test('cancelling pauses with the progress kept; resuming continues from there', () async {
    final region = publish(randomBytes(4 * 1024 * 1024, 2));
    server.chunkDelay = const Duration(milliseconds: 5);
    final running = service.download(region);
    await eventually(() => (service.tasks['guayaquil']?.receivedBytes ?? 0) > 0);
    service.pause('guayaquil');

    expect(await running, RegionDownloadResult.paused);
    final paused = service.tasks['guayaquil']!;
    expect(paused.status, RegionDownloadStatus.paused);
    expect(paused.receivedBytes, greaterThan(0));

    server.chunkDelay = null;
    expect(await service.download(region), RegionDownloadResult.completed);
    expect(server.requests.last.range, startsWith('bytes='));
    expect(await (await fileOf(region)).readAsBytes(), server.content);
  });

  test('a lost connection resumes by itself when the connection is back', () async {
    final region = publish(randomBytes(3 * 1024 * 1024, 3));
    await regions.refreshCatalog();
    await service.start();
    server.dropAfter = 1024 * 1024;

    expect(await service.download(region), RegionDownloadResult.failed);
    final failed = service.tasks['guayaquil']!;
    expect(failed.errorCode, ErrorCodes.networkUnavailable);
    expect(failed.errorMessage, contains('continuará desde donde quedó'));
    expect(connectivity.failuresReported, 1);

    server.dropAfter = null;
    connectivity
      ..status = ConnectivityStatus.offline
      ..status = ConnectivityStatus.online;
    await eventually(() async => (await regions.downloadedRegions()).isNotEmpty);
    expect(server.requests.last.range, startsWith('bytes='));
  });

  test('a download interrupted by closing the app is continued on the next start', () async {
    final region = publish(randomBytes(2 * 1024 * 1024, 4));
    await regions.refreshCatalog();
    // Previous session: 500 KB received, then the app was killed.
    final target = await fileOf(region);
    await store.begin(
      region: region,
      url: region.mapDownloadUrl,
      relativePath: await storage.relativePathOf(target),
    );
    await File('${target.path}.part').create(recursive: true);
    await File('${target.path}.part').writeAsBytes(server.content.sublist(0, 500 * 1000));

    connectivity.status = ConnectivityStatus.offline;
    await service.start();
    final restored = service.tasks['guayaquil']!;
    expect(restored.status, RegionDownloadStatus.paused);
    expect(restored.receivedBytes, 500 * 1000);

    connectivity.status = ConnectivityStatus.online;
    await eventually(() async => (await regions.downloadedRegions()).isNotEmpty);
    expect(server.requests.single.range, 'bytes=500000-');
  });

  test('an update keeps the current version usable until the new one is verified', () async {
    final v1 = publish(randomBytes(1024 * 1024, 5), version: '2026.08.01');
    await service.download(v1);

    // The new version arrives corrupt: it is discarded and v1 stays.
    final v2 = publish(randomBytes(1024 * 1024, 6), version: '2026.09.20');
    final corrupt = MapRegion(
      code: v2.code,
      name: v2.name,
      country: v2.country,
      version: v2.version,
      mapSizeBytes: v2.mapSizeBytes,
      checksum: 'f' * 64,
      bbox: v2.bbox,
      minZoom: v2.minZoom,
      maxZoom: v2.maxZoom,
      mapDownloadUrl: v2.mapDownloadUrl,
      tilesUrl: v2.tilesUrl,
      updatedAt: v2.updatedAt,
    );
    expect(await service.download(corrupt), RegionDownloadResult.failed);
    expect(service.tasks['guayaquil']!.errorCode, ErrorCodes.checksumMismatch);
    expect((await regions.downloadedRegions()).single.version, '2026.08.01');
    expect(await (await fileOf(v1)).exists(), isTrue);

    expect(await service.download(v2), RegionDownloadResult.completed);
    expect((await regions.downloadedRegions()).single.version, '2026.09.20');
    expect(await (await fileOf(v1)).exists(), isFalse, reason: 'old version removed');
    expect(await (await fileOf(v2)).exists(), isTrue);
  });

  test('not enough free space is reported before downloading', () async {
    final region = publish(randomBytes(1024 * 1024, 7));
    freeBytes = 1000;
    expect(await service.download(region), RegionDownloadResult.failed);
    expect(service.tasks['guayaquil']!.errorCode, ErrorCodes.insufficientStorage);
    expect(server.requests, isEmpty);
  });

  test('discarding removes the partial file', () async {
    final region = publish(randomBytes(4 * 1024 * 1024, 8));
    server.chunkDelay = const Duration(milliseconds: 5);
    final running = service.download(region);
    await eventually(() => (service.tasks['guayaquil']?.receivedBytes ?? 0) > 0);
    await service.discard('guayaquil');
    await running;

    expect(service.tasks, isEmpty);
    expect(await store.find('guayaquil'), isNull);
    expect(await File('${(await fileOf(region)).path}.part').exists(), isFalse);
  });

  test('deleting a region frees its files and tells the server', () async {
    final region = publish(randomBytes(1024 * 1024, 9));
    await service.download(region);
    await service.deleteRegion((await regions.downloadedRegions()).single);

    expect(await regions.downloadedRegions(), isEmpty);
    expect(await (await fileOf(region)).exists(), isFalse);
    expect(sync.enqueued.last.operation, 'DELETE');
    expect(sync.enqueued.last.payload, {'regionId': 'guayaquil', 'version': '2026.09.20'});
  });

  test('offers the region of a position that has no downloaded map', () async {
    final region = publish(randomBytes(1024, 10));
    await regions.refreshCatalog();
    expect((await service.missingRegionAt(guayaquilCenter))?.code, 'guayaquil');
    expect(await service.missingRegionAt(quito), isNull, reason: 'not in the catalog');

    await service.download(region);
    expect(await service.missingRegionAt(guayaquilCenter), isNull);
  });

  group('offline packs', () {
    test('the map and its pack download with one progress and work offline', () async {
      final map = randomBytes(2 * 1024 * 1024, 11);
      final pack = randomBytes(1024 * 1024, 12);
      final region = publish(map, pack: pack);
      final progress = <RegionDownloadTask>[];
      final subscription = service.watchTasks().listen((tasks) {
        if (tasks['guayaquil'] case final task?) progress.add(task);
      });

      expect(await service.download(region), RegionDownloadResult.completed);

      final stored = (await regions.downloadedRegions()).single;
      expect(stored.hasOfflinePack, isTrue);
      expect(stored.routingRelativePath, 'packs/guayaquil/2026.09.20/guayaquil.rmpack');
      expect(stored.routingChecksum, region.routingChecksum);
      expect(stored.routingSizeBytes, pack.length);
      expect(stored.storedBytes, map.length + pack.length);
      expect(await (await packOf(region)).readAsBytes(), pack);
      expect(await (await fileOf(region)).readAsBytes(), map);
      expect(requestedPaths(), [mapPath, packPath]);

      // One bar for both files: it never goes back.
      expect(progress.map((task) => task.totalBytes).toSet(), {map.length + pack.length});
      final received = [for (final task in progress) task.receivedBytes];
      expect(received, orderedEquals([...received]..sort()));
      expect(
        progress.where((task) => task.part == RegionDownloadPart.offlinePack).first.receivedBytes,
        greaterThanOrEqualTo(map.length),
      );
      expect(service.tasks, isEmpty);
      expect(sync.enqueued.single.payload, {'regionId': 'guayaquil', 'version': '2026.09.20'});
      await subscription.cancel();
    });

    test('a failed pack keeps the map, and retrying only downloads the pack', () async {
      final map = randomBytes(1024 * 1024, 13);
      final pack = randomBytes(512 * 1024, 14);
      final region = publish(map, pack: pack);
      server.failures[packPath] = HttpStatus.notFound;

      expect(await service.download(region), RegionDownloadResult.failed);
      final stored = (await regions.downloadedRegions()).single;
      expect(stored.version, '2026.09.20', reason: 'the map works without its pack');
      expect(stored.hasOfflinePack, isFalse);
      final failed = service.tasks['guayaquil']!;
      expect(failed.part, RegionDownloadPart.offlinePack);
      expect(failed.errorCode, ErrorCodes.mapRegionFileNotAvailable);
      expect(failed.receivedBytes, map.length);

      server.failures.clear();
      expect(await service.download(region), RegionDownloadResult.completed);
      expect(requestedPaths().where((path) => path == mapPath), hasLength(1));
      expect((await regions.downloadedRegions()).single.hasOfflinePack, isTrue);
      expect(service.tasks, isEmpty);
    });

    test('a region downloaded before its pack existed only downloads the pack', () async {
      final map = randomBytes(1024 * 1024, 15);
      await service.download(publish(map));
      expect((await regions.downloadedRegions()).single.hasOfflinePack, isFalse);
      server.requests.clear();

      final pack = randomBytes(256 * 1024, 16);
      final withPack = publish(map, pack: pack);
      final totals = <int>[];
      final subscription = service.watchTasks().listen((tasks) {
        if (tasks['guayaquil'] case final task?) totals.add(task.totalBytes);
      });
      expect(await service.download(withPack), RegionDownloadResult.completed);
      expect(requestedPaths(), [packPath]);
      expect(totals.toSet(), {pack.length});
      expect((await regions.downloadedRegions()).single.routingChecksum, withPack.routingChecksum);
      expect(sync.enqueued, hasLength(1), reason: 'the map version did not change');
      await subscription.cancel();
    });

    test('an update downloads what changed and replaces each file once verified', () async {
      final pack = randomBytes(256 * 1024, 17);
      final v1 = publish(randomBytes(512 * 1024, 18), version: '2026.08.01', pack: pack);
      await service.download(v1);

      // Only the map changed: the pack stays where it is.
      server.requests.clear();
      final v2 = publish(randomBytes(512 * 1024, 19), version: '2026.09.01', pack: pack);
      expect(await service.download(v2), RegionDownloadResult.completed);
      expect(requestedPaths(), [mapPath]);
      var stored = (await regions.downloadedRegions()).single;
      expect(stored.version, '2026.09.01');
      expect(stored.routingRelativePath, 'packs/guayaquil/2026.08.01/guayaquil.rmpack');
      expect(await (await packOf(v1)).exists(), isTrue);
      expect(await (await fileOf(v1)).exists(), isFalse);

      // A new pack arrives corrupt: the current one stays usable.
      final newPack = randomBytes(300 * 1024, 20);
      final v3 = publish(randomBytes(512 * 1024, 21), version: '2026.10.01', pack: newPack);
      server.files[packPath] = randomBytes(newPack.length, 22);
      expect(await service.download(v3), RegionDownloadResult.failed);
      expect(service.tasks['guayaquil']!.errorCode, ErrorCodes.checksumMismatch);
      stored = (await regions.downloadedRegions()).single;
      expect(stored.version, '2026.10.01');
      expect(stored.routingChecksum, v1.routingChecksum);
      expect(await (await packOf(v1)).exists(), isTrue);

      server.files[packPath] = newPack;
      expect(await service.download(v3), RegionDownloadResult.completed);
      stored = (await regions.downloadedRegions()).single;
      expect(stored.routingChecksum, v3.routingChecksum);
      expect(await (await packOf(v3)).readAsBytes(), newPack);
      expect(await (await packOf(v1)).exists(), isFalse, reason: 'old pack removed');
    });

    test('a pack interrupted by closing the app continues counting the map', () async {
      final map = randomBytes(1024 * 1024, 23);
      final pack = randomBytes(1024 * 1024, 24);
      final region = publish(map, pack: pack);
      await regions.refreshCatalog();
      // Previous session: the map was stored, then 300 KB of the pack arrived.
      final mapFile = await fileOf(region);
      await mapFile.create(recursive: true);
      await mapFile.writeAsBytes(map);
      await regions.saveDownloaded(
        region: region,
        relativePath: await storage.relativePathOf(mapFile),
        sizeBytes: map.length,
      );
      final target = await packOf(region);
      await store.begin(
        region: region,
        part: RegionDownloadPart.offlinePack,
        url: packPath,
        relativePath: await storage.relativePathOf(target),
        checksum: region.routingChecksum,
        totalBytes: map.length + pack.length,
        doneBytes: map.length,
      );
      await File('${target.path}.part').create(recursive: true);
      await File('${target.path}.part').writeAsBytes(pack.sublist(0, 300 * 1000));

      connectivity.status = ConnectivityStatus.offline;
      await service.start();
      final restored = service.tasks['guayaquil']!;
      expect(restored.status, RegionDownloadStatus.paused);
      expect(restored.part, RegionDownloadPart.offlinePack);
      expect(restored.totalBytes, map.length + pack.length);
      expect(restored.receivedBytes, map.length + 300 * 1000);

      final totals = <int>{};
      final subscription = service.watchTasks().listen((tasks) {
        if (tasks['guayaquil'] case final task?) totals.add(task.totalBytes);
      });
      connectivity.status = ConnectivityStatus.online;
      await eventually(() async => (await regions.downloadedRegions()).single.hasOfflinePack);
      expect(server.requests.single.path, packPath);
      expect(server.requests.single.range, 'bytes=300000-');
      expect(totals, {map.length + pack.length});
      await subscription.cancel();
    });

    test('routing files in other formats are not for the phone', () async {
      final region = publish(
        randomBytes(512 * 1024, 25),
        pack: randomBytes(1024, 26),
        packFormat: 'valhalla-tiles',
      );
      expect(region.hasOfflinePack, isFalse);
      expect(await service.download(region), RegionDownloadResult.completed);
      expect(requestedPaths(), [mapPath]);
      expect((await regions.downloadedRegions()).single.hasOfflinePack, isFalse);
    });

    test('deleting a region removes its pack too', () async {
      final region = publish(randomBytes(512 * 1024, 27), pack: randomBytes(1024, 28));
      await service.download(region);
      await service.deleteRegion((await regions.downloadedRegions()).single);
      expect(await (await packOf(region)).exists(), isFalse);
      expect(await (await fileOf(region)).exists(), isFalse);
    });
  });
}
