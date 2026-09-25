import '../entities/coordinate.dart';
import '../entities/map_region.dart';

/// Offline map regions: the server catalog (cached for offline use) and the
/// regions stored on the device.
abstract class RegionRepository {
  /// Downloads the catalog and caches it. Throws when the API is unreachable.
  Future<List<MapRegion>> refreshCatalog();

  /// Last cached catalog (works offline).
  Future<List<MapRegion>> cachedCatalog();

  Stream<List<MapRegion>> watchCatalog();

  Future<List<DownloadedRegion>> downloadedRegions();

  Stream<List<DownloadedRegion>> watchDownloadedRegions();

  /// Asks the API which stored regions have a newer version and remembers it.
  Future<List<RegionVersionStatus>> checkForUpdates();

  /// Smallest catalog region containing [position] (city before country).
  Future<MapRegion?> detectRegion(Coordinate position);

  /// Downloaded regions containing [position], widest coverage first.
  Future<List<DownloadedRegion>> downloadedRegionsAt(Coordinate position);

  /// Registers a completed download (replaces the previous version).
  Future<DownloadedRegion> saveDownloaded({
    required MapRegion region,
    required String relativePath,
    required int sizeBytes,
  });

  /// Removes the region from the device (database row and files).
  Future<void> deleteDownloaded(String code);

  /// Drops rows whose file no longer exists (e.g. storage cleared by the user).
  Future<List<String>> removeMissingFiles();
}
