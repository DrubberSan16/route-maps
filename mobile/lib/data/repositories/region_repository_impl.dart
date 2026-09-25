import 'package:drift/drift.dart';

import '../../core/utils/time.dart';
import '../../domain/entities/coordinate.dart';
import '../../domain/entities/map_region.dart';
import '../../domain/repositories/region_repository.dart';
import '../../domain/services/offline_storage_service.dart';
import '../local/app_database.dart';
import '../remote/api_client.dart';

class RegionRepositoryImpl implements RegionRepository {
  RegionRepositoryImpl({
    required this._api,
    required this._db,
    required this._storage,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final ApiClient _api;
  final AppDatabase _db;
  final OfflineStorageService _storage;
  final DateTime Function() _clock;

  @override
  Future<List<MapRegion>> refreshCatalog() async {
    final regions = await _api.get(
      'maps/regions',
      (data) => [
        for (final item in data! as List<Object?>)
          MapRegion.fromJson(item! as Map<String, Object?>),
      ],
    );
    final now = utcMillis(_clock());
    await _db.transaction(() async {
      await _db.delete(_db.catalogRegions).go();
      await _db.batch(
        (batch) => batch.insertAll(_db.catalogRegions, [
          for (final region in regions) _catalogRow(region, now),
        ]),
      );
      // The catalog also tells which stored regions have a newer version.
      for (final region in regions) {
        await (_db.update(_db.downloadedRegions)..where((t) => t.code.equals(region.code))).write(
          DownloadedRegionsCompanion(latestVersion: Value(region.version), checkedAt: Value(now)),
        );
      }
    });
    return regions;
  }

  @override
  Future<List<MapRegion>> cachedCatalog() async =>
      (await _catalogQuery().get()).map(_toRegion).toList();

  @override
  Stream<List<MapRegion>> watchCatalog() =>
      _catalogQuery().watch().map((rows) => rows.map(_toRegion).toList());

  @override
  Future<List<DownloadedRegion>> downloadedRegions() async =>
      (await _downloadedQuery().get()).map(_toDownloaded).toList();

  @override
  Stream<List<DownloadedRegion>> watchDownloadedRegions() =>
      _downloadedQuery().watch().map((rows) => rows.map(_toDownloaded).toList());

  @override
  Future<List<RegionVersionStatus>> checkForUpdates() async {
    final local = await downloadedRegions();
    if (local.isEmpty) return const [];
    final statuses = await _api.post(
      'maps/regions/updates',
      (data) => [
        for (final item in data! as List<Object?>)
          RegionVersionStatus.fromJson(item! as Map<String, Object?>),
      ],
      body: {
        'regions': [
          for (final region in local) {'id': region.code, 'version': region.version},
        ],
      },
    );
    final now = utcMillis(_clock());
    await _db.transaction(() async {
      for (final status in statuses) {
        await (_db.update(_db.downloadedRegions)..where((t) => t.code.equals(status.region))).write(
          DownloadedRegionsCompanion(
            latestVersion: Value(status.latestVersion),
            checkedAt: Value(now),
          ),
        );
      }
    });
    return statuses;
  }

  @override
  Future<MapRegion?> detectRegion(Coordinate position) async {
    final covering = (await cachedCatalog()).where((region) => region.contains(position)).toList()
      ..sort((a, b) => a.bbox!.area.compareTo(b.bbox!.area));
    return covering.isEmpty ? null : covering.first;
  }

  @override
  Future<List<DownloadedRegion>> downloadedRegionsAt(Coordinate position) async =>
      (await downloadedRegions()).where((region) => region.contains(position)).toList()
        ..sort((a, b) => b.bbox!.area.compareTo(a.bbox!.area));

  @override
  Future<DownloadedRegion> saveDownloaded({
    required MapRegion region,
    required String relativePath,
    required int sizeBytes,
  }) async {
    final now = utcMillis(_clock());
    final bbox = region.bbox;
    await _db
        .into(_db.downloadedRegions)
        .insertOnConflictUpdate(
          DownloadedRegionsCompanion.insert(
            code: region.code,
            name: region.name,
            version: region.version,
            checksum: region.checksum,
            sizeBytes: sizeBytes,
            relativePath: relativePath,
            west: Value(bbox?.west),
            south: Value(bbox?.south),
            east: Value(bbox?.east),
            north: Value(bbox?.north),
            minZoom: region.minZoom,
            maxZoom: region.maxZoom,
            downloadedAt: now,
            latestVersion: Value(region.version),
            checkedAt: Value(now),
          ),
        );
    return _toDownloaded(
      await (_db.select(
        _db.downloadedRegions,
      )..where((t) => t.code.equals(region.code))).getSingle(),
    );
  }

  @override
  Future<void> deleteDownloaded(String code) async {
    await _db.transaction(() async {
      await (_db.delete(_db.downloadedRegions)..where((t) => t.code.equals(code))).go();
      await (_db.delete(_db.regionDownloads)..where((t) => t.code.equals(code))).go();
    });
    await _storage.deleteRegionFiles(code);
  }

  @override
  Future<List<String>> removeMissingFiles() async {
    final removed = <String>[];
    for (final region in await downloadedRegions()) {
      final file = await _storage.resolve(region.relativePath);
      if (!await file.exists()) {
        await (_db.delete(_db.downloadedRegions)..where((t) => t.code.equals(region.code))).go();
        removed.add(region.code);
      }
    }
    return removed;
  }

  SimpleSelectStatement<$CatalogRegionsTable, CatalogRegionRow> _catalogQuery() =>
      _db.select(_db.catalogRegions)..orderBy([(t) => OrderingTerm.asc(t.name)]);

  SimpleSelectStatement<$DownloadedRegionsTable, DownloadedRegionRow> _downloadedQuery() =>
      _db.select(_db.downloadedRegions)..orderBy([(t) => OrderingTerm.desc(t.downloadedAt)]);

  CatalogRegionsCompanion _catalogRow(MapRegion region, DateTime fetchedAt) =>
      CatalogRegionsCompanion.insert(
        code: region.code,
        name: region.name,
        country: region.country,
        province: Value(region.province),
        city: Value(region.city),
        version: region.version,
        mapSize: region.mapSizeBytes,
        routingSize: Value(region.routingSizeBytes),
        checksum: region.checksum,
        routingChecksum: Value(region.routingChecksum),
        west: Value(region.bbox?.west),
        south: Value(region.bbox?.south),
        east: Value(region.bbox?.east),
        north: Value(region.bbox?.north),
        minZoom: region.minZoom,
        maxZoom: region.maxZoom,
        mapDownloadUrl: region.mapDownloadUrl,
        routingDownloadUrl: Value(region.routingDownloadUrl),
        tilesUrl: region.tilesUrl,
        updatedAt: utcMillis(region.updatedAt),
        fetchedAt: fetchedAt,
      );

  static BoundingBox? _bbox(double? west, double? south, double? east, double? north) =>
      west == null || south == null || east == null || north == null
      ? null
      : BoundingBox(west: west, south: south, east: east, north: north);

  static MapRegion _toRegion(CatalogRegionRow row) => MapRegion(
    code: row.code,
    name: row.name,
    country: row.country,
    province: row.province,
    city: row.city,
    version: row.version,
    mapSizeBytes: row.mapSize,
    routingSizeBytes: row.routingSize,
    checksum: row.checksum,
    routingChecksum: row.routingChecksum,
    bbox: _bbox(row.west, row.south, row.east, row.north),
    minZoom: row.minZoom,
    maxZoom: row.maxZoom,
    mapDownloadUrl: row.mapDownloadUrl,
    routingDownloadUrl: row.routingDownloadUrl,
    tilesUrl: row.tilesUrl,
    updatedAt: row.updatedAt,
  );

  static DownloadedRegion _toDownloaded(DownloadedRegionRow row) => DownloadedRegion(
    code: row.code,
    name: row.name,
    version: row.version,
    checksum: row.checksum,
    sizeBytes: row.sizeBytes,
    relativePath: row.relativePath,
    bbox: _bbox(row.west, row.south, row.east, row.north),
    minZoom: row.minZoom,
    maxZoom: row.maxZoom,
    downloadedAt: row.downloadedAt,
    latestVersion: row.latestVersion,
    checkedAt: row.checkedAt,
  );
}
