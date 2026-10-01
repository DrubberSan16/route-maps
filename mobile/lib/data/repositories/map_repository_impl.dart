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
          assets: _assets(region, catalog),
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
        assets: published == null ? const {} : _assets(published, catalog),
      );
    }
    return null;
  }

  /// The extra layers to draw over the map of [region], as the web viewer
  /// does: its own overlays; the imagery of every region over it, the widest
  /// first so that a city's (more zoom levels) is drawn over the country's;
  /// and the elevation of the outermost ones only, since slopes shaded twice
  /// would come out darker. The world overview, shown far from every detailed
  /// map, only gets its own.
  Map<String, List<Uri>> _assets(MapRegion region, List<MapRegion> catalog) {
    final box = region.isDetailed ? region.bbox : null;
    final over = [
      for (final other in catalog)
        if (other.code == region.code || (box != null && (other.bbox?.intersects(box) ?? false)))
          other,
    ]..sort((a, b) => _area(b.bbox).compareTo(_area(a.bbox)));
    final withTerrain = [
      for (final other in over)
        if (other.asset(RegionAsset.terrain) != null) other,
    ];
    final outermost = [
      for (final (index, other) in withTerrain.indexed)
        if (!withTerrain.take(index).any((wider) => _inside(other.bbox, wider.bbox))) other,
    ];
    final assets = {
      RegionAsset.overlays: _urls([region], RegionAsset.overlays),
      RegionAsset.satellite: _urls(over, RegionAsset.satellite),
      RegionAsset.terrain: _urls(outermost, RegionAsset.terrain),
    };
    return {
      for (final MapEntry(:key, :value) in assets.entries)
        if (value.isNotEmpty) key: value,
    };
  }

  List<Uri> _urls(Iterable<MapRegion> regions, String kind) => [
    for (final region in regions)
      if (region.asset(kind) case final asset?) _config.resolve(asset.tilesUrl),
  ];

  static bool _inside(BoundingBox? inner, BoundingBox? outer) =>
      inner != null && outer != null && outer.containsBox(inner);

  static double _area(BoundingBox? bbox) => bbox?.area ?? 0;
}
