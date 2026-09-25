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

    // 1. A downloaded region covering the reference point (widest first), or
    //    the most recent download when the position is unknown.
    final local = around == null ? downloaded : await _regions.downloadedRegionsAt(around);
    final localSource = await _firstAvailable(local);
    if (localSource != null) return localSource;

    // 2. The server's PMTiles for the region around the point (widest first).
    if (online) {
      final catalog = await _regions.cachedCatalog();
      final covering = around == null
          ? <MapRegion>[]
          : catalog.where((region) => region.contains(around)).toList();
      final candidates = (covering.isNotEmpty ? covering : catalog).toList()
        ..sort((a, b) => _area(b.bbox).compareTo(_area(a.bbox)));
      if (candidates.isNotEmpty) {
        final region = candidates.first;
        return RemoteMapSource(region: region, url: _config.resolve(region.tilesUrl));
      }
    }

    // 3. Offline and outside every stored region: still show what is stored.
    return await _firstAvailable(downloaded) ?? const NoMapSource();
  }

  Future<LocalMapSource?> _firstAvailable(List<DownloadedRegion> regions) async {
    for (final region in regions) {
      final file = await _storage.resolve(region.relativePath);
      if (await file.exists()) return LocalMapSource(region: region, file: file);
    }
    return null;
  }

  static double _area(BoundingBox? bbox) => bbox?.area ?? 0;
}
