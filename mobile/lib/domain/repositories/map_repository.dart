import 'dart:io';

import '../entities/coordinate.dart';
import '../entities/map_region.dart';

/// Where the base map is read from.
sealed class MapSource {
  const MapSource();

  /// Identifies the map data (kind, region and version): the style only has
  /// to be rebuilt when it changes.
  String get id;
}

/// A downloaded PMTiles file: renders with no connection.
class LocalMapSource extends MapSource {
  const LocalMapSource({required this.region, required this.file});

  final DownloadedRegion region;
  final File file;

  @override
  String get id => 'local:${region.code}:${region.version}';
}

/// The PMTiles published by the platform, read with HTTP Range requests.
class RemoteMapSource extends MapSource {
  const RemoteMapSource({required this.region, required this.url});

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
  /// PMTiles when [online]; otherwise any downloaded region.
  Future<MapSource> resolveSource({Coordinate? around, required bool online});
}
