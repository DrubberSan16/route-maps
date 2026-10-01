import '../../core/config/app_config.dart';
import '../../domain/entities/coordinate.dart';
import '../../domain/entities/map_region.dart';
import '../../domain/repositories/map_repository.dart';
import '../../domain/repositories/region_repository.dart';
import '../../domain/services/offline_storage_service.dart';

/// Offline first: a downloaded region is always preferred over the network.
class MapRepositoryImpl implements MapRepository {
  MapRepositoryImpl({required this._regions, required this._storage, required this._config});

  final RegionRepository _regions;
  final OfflineStorageService _storage;
  final AppConfig _config;

  @override
  Future<MapSource> resolveSource({Coordinate? around, required bool online}) async {
    final downloaded = await _regions.downloadedRegions();
    final catalog = online ? await _regions.cachedCatalog() : const <MapRegion>[];

    // 1. A downloaded region covering the reference point (widest first), or
    //    the most recent download when the position is unknown.
    final local = around == null ? downloaded : await _regions.downloadedRegionsAt(around);
    final localSource = await _firstAvailable(local, catalog);
    if (localSource != null) return localSource;

    // 2. The server's PMTiles for the region around the point: the widest
    //    detailed one, so that panning around stays inside it. An overview map
    //    (the world base map stops at zoom 7) only when no detailed one covers it.
    if (online) {
      final covering = around == null
          ? <MapRegion>[]
          : catalog.where((region) => region.contains(around)).toList();
      final candidates = (covering.isNotEmpty ? covering : catalog).toList()
        ..sort(
          (a, b) => a.isDetailed != b.isDetailed
              ? (a.isDetailed ? -1 : 1)
              : _area(b.bbox).compareTo(_area(a.bbox)),
        );
      if (candidates.isNotEmpty) {
        final region = candidates.first;
        return RemoteMapSource(
          region: region,
          url: _config.resolve(region.tilesUrl),
          assets: _assets(region),
        );
      }
    }

    // 3. Offline and outside every stored region: still show what is stored.
    return await _firstAvailable(downloaded, catalog) ?? const NoMapSource();
  }

  /// The first stored region whose file is in place, with the extra layers the
  /// platform publishes for it (only in [catalog] while online).
  Future<LocalMapSource?> _firstAvailable(
    List<DownloadedRegion> regions,
    List<MapRegion> catalog,
  ) async {
    for (final region in regions) {
      final file = await _storage.resolve(region.relativePath);
      if (!await file.exists()) continue;
      final published = catalog.where((entry) => entry.code == region.code).firstOrNull;
      return LocalMapSource(
        region: region,
        file: file,
        assets: published == null ? const {} : _assets(published),
      );
    }
    return null;
  }

  Map<String, Uri> _assets(MapRegion region) => {
    for (final asset in region.assets) asset.kind: _config.resolve(asset.tilesUrl),
  };

  static double _area(BoundingBox? bbox) => bbox?.area ?? 0;
}
