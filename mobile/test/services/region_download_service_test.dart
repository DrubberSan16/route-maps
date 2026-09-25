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

  /// Guayaquil as published: the server serves [content] for it.
  MapRegion publish(Uint8List content, {String version = '2026.09.20'}) {
    server
      ..content = content
      ..etag = '"$version"';
    final published = MapRegion(
      code: 'guayaquil',
      name: 'Guayaquil',
      country: 'EC',
      city: 'Guayaquil',
      version: version,
      mapSizeBytes: content.length,
      checksum: sha256.convert(content).toString(),
      bbox: guayaquilBox,
      minZoom: 0,
      maxZoom: 14,
      mapDownloadUrl: '/api/v1/maps/regions/guayaquil/download',
      tilesUrl: '/maps/ec/guayaquil.pmtiles',
      updatedAt: DateTime.utc(2026, 9, 20),
    );
    catalog = [published];
    return published;
  }

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
}
