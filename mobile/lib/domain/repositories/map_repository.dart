import 'dart:io';

import '../entities/coordinate.dart';
import '../entities/map_region.dart';

/// Where the base map is read from.
sealed class MapSource {
  const MapSource({this.assets = const {}});

  /// Identifies the map data (kind, region and version): the style only has
  /// to be rebuilt when it changes.
  String get id;

  /// PMTiles of the region's extra layers that can be drawn now, by kind
  /// ([RegionAsset.terrain], [RegionAsset.satellite], [RegionAsset.overlays]):
  /// read from the platform, so only while there is connection.
  final Map<String, Uri> assets;
}

/// A downloaded PMTiles file: renders with no connection.
class LocalMapSource extends MapSource {
  const LocalMapSource({required this.region, required this.file, super.assets});

  final DownloadedRegion region;
  final File file;

  @override
  String get id => 'local:${region.code}:${region.version}';
}

/// The PMTiles published by the platform, read with HTTP Range requests.
class RemoteMapSource extends MapSource {
  const RemoteMapSource({required this.region, required this.url, super.assets});

  final MapRegion region;
  final Uri url;

  @override
  String get id => 'remote:${region.code}:${region.version}';
}

/// Nothing to draw: no region downloaded and no connection (or empty catalog).
class NoMapSource extends MapSource {
  const NoMapSource();

  @override
  String get id => 'none';
}

/// Chooses the map data to render (offline first).
abstract class MapRepository {
  /// Local region covering [around] if there is one; otherwise the server's
  /// PMTiles when [online]; otherwise any downloaded region. When [online],
  /// the source also lists the region's relief, satellite and overlay archives.
  Future<MapSource> resolveSource({Coordinate? around, required bool online});
}
