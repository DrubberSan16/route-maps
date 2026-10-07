import 'package:flutter/foundation.dart';

import 'coordinate.dart';

/// A region offered for offline use (`GET /api/v1/maps/regions`).
@immutable
class MapRegion {
  const MapRegion({
    required this.code,
    required this.name,
    required this.country,
    required this.version,
    required this.mapSizeBytes,
    required this.checksum,
    required this.minZoom,
    required this.maxZoom,
    required this.mapDownloadUrl,
    required this.tilesUrl,
    required this.updatedAt,
    this.province,
    this.city,
    this.routingSizeBytes,
    this.routingChecksum,
    this.routingDownloadUrl,
    this.routingFormat,
    this.bbox,
    this.assets = const [],
  });

  factory MapRegion.fromJson(Map<String, Object?> json) {
    final bbox = json['bbox'] as List<Object?>?;
    final assets = json['assets'] as List<Object?>?;
    return MapRegion(
      code: json['id']! as String,
      name: json['name']! as String,
      country: json['country']! as String,
      province: json['province'] as String?,
      city: json['city'] as String?,
      version: json['version']! as String,
      mapSizeBytes: (json['mapSize']! as num).toInt(),
      routingSizeBytes: (json['routingSize'] as num?)?.toInt(),
      checksum: json['checksum']! as String,
      routingChecksum: json['routingChecksum'] as String?,
      bbox: bbox == null ? null : BoundingBox.fromList(bbox),
      minZoom: (json['minZoom']! as num).toInt(),
      maxZoom: (json['maxZoom']! as num).toInt(),
      mapDownloadUrl: json['mapDownloadUrl']! as String,
      routingDownloadUrl: json['routingDownloadUrl'] as String?,
      routingFormat: json['routingFormat'] as String?,
      tilesUrl: json['tilesUrl']! as String,
      updatedAt: DateTime.parse(json['updatedAt']! as String),
      assets: [
        for (final asset in assets ?? const <Object?>[])
          RegionAsset.fromJson(asset! as Map<String, Object?>),
      ],
    );
  }

  /// Public identifier (`id` in the API), e.g. `guayaquil`.
  final String code;
  final String name;

  /// ISO 3166-1 alpha-2 country code.
  final String country;
  final String? province;
  final String? city;
  final String version;
  final int mapSizeBytes;
  final int? routingSizeBytes;

  /// SHA-256 (hex) of the PMTiles file.
  final String checksum;
  final String? routingChecksum;
  final BoundingBox? bbox;
  final int minZoom;
  final int maxZoom;

  /// Resumable download of the PMTiles file (absolute path on the platform host).
  final String mapDownloadUrl;

  /// Resumable download of the routing file of the region.
  final String? routingDownloadUrl;

  /// What [routingDownloadUrl] serves: [offlinePackFormat] is the offline pack
  /// the app routes and searches with; anything else (an engine's own tiles) is
  /// not for the phone.
  final String? routingFormat;

  /// Range-readable PMTiles URL for online rendering.
  final String tilesUrl;
  final DateTime updatedAt;

  /// Relief, satellite imagery and overlays published with the map.
  final List<RegionAsset> assets;

  /// Format of the offline pack: road network and search index of the region,
  /// used by the phone for routes, place search and addresses without connection.
  static const offlinePackFormat = 'route-maps-pack';

  /// Whether the region publishes an offline pack for the phone.
  bool get hasOfflinePack =>
      routingFormat == offlinePackFormat &&
      routingDownloadUrl != null &&
      routingSizeBytes != null &&
      routingChecksum != null;

  /// Bytes the phone downloads for the region: the map and the offline pack.
  int get downloadSizeBytes => mapSizeBytes + (hasOfflinePack ? routingSizeBytes! : 0);

  bool contains(Coordinate point) => bbox?.contains(point) ?? false;

  /// The archive of [kind] (`terrain`, `satellite`, `overlays`), if published.
  RegionAsset? asset(String kind) {
    for (final asset in assets) {
      if (asset.kind == kind) return asset;
    }
    return null;
  }

  /// Highest zoom with tiles: a region that stops early (the world base map)
  /// only gives an overview.
  bool get isDetailed => maxZoom > overviewMaxZoom;

  /// Last zoom of the overview maps (the world base map has tiles up to 7).
  static const overviewMaxZoom = 8;
}

/// Extra archive of a region next to its map (`assets` in the API): the relief
/// (`terrain`), the satellite imagery or the optional overlays (population,
/// climate), read with HTTP Range requests like the map.
@immutable
class RegionAsset {
  const RegionAsset({
    required this.kind,
    required this.tilesUrl,
    required this.format,
    required this.minZoom,
    required this.maxZoom,
    required this.sizeBytes,
    required this.checksum,
  });

  factory RegionAsset.fromJson(Map<String, Object?> json) => RegionAsset(
    kind: json['kind']! as String,
    tilesUrl: json['tilesUrl']! as String,
    format: json['format'] as String? ?? '',
    minZoom: (json['minZoom'] as num?)?.toInt() ?? 0,
    maxZoom: (json['maxZoom'] as num?)?.toInt() ?? 14,
    sizeBytes: (json['size'] as num?)?.toInt() ?? 0,
    checksum: json['checksum'] as String? ?? '',
  );

  static const terrain = 'terrain';
  static const satellite = 'satellite';
  static const overlays = 'overlays';

  final String kind;

  /// PMTiles URL (absolute path on the platform host, versioned by content).
  final String tilesUrl;

  /// Tile format: `webp`, `png`, `jpg` or `pbf`.
  final String format;
  final int minZoom;
  final int maxZoom;
  final int sizeBytes;
  final String checksum;

  Map<String, Object?> toJson() => {
    'kind': kind,
    'tilesUrl': tilesUrl,
    'format': format,
    'minZoom': minZoom,
    'maxZoom': maxZoom,
    'size': sizeBytes,
    'checksum': checksum,
  };

  @override
  bool operator ==(Object other) =>
      other is RegionAsset &&
      other.kind == kind &&
      other.tilesUrl == tilesUrl &&
      other.format == format &&
      other.minZoom == minZoom &&
      other.maxZoom == maxZoom &&
      other.sizeBytes == sizeBytes &&
      other.checksum == checksum;

  @override
  int get hashCode => Object.hash(kind, tilesUrl, format, minZoom, maxZoom, sizeBytes, checksum);
}

/// A region stored on the device and usable without connection.
@immutable
class DownloadedRegion {
  const DownloadedRegion({
    required this.code,
    required this.name,
    required this.version,
    required this.checksum,
    required this.sizeBytes,
    required this.relativePath,
    required this.minZoom,
    required this.maxZoom,
    required this.downloadedAt,
    this.bbox,
    this.latestVersion,
    this.checkedAt,
    this.routingRelativePath,
    this.routingChecksum,
    this.routingSizeBytes,
  });

  final String code;
  final String name;
  final String version;
  final String checksum;
  final int sizeBytes;

  /// PMTiles path relative to the app storage directory (absolute paths change
  /// between app updates on iOS).
  final String relativePath;
  final BoundingBox? bbox;
  final int minZoom;
  final int maxZoom;
  final DateTime downloadedAt;

  /// Latest version known on the server, from the last update check.
  final String? latestVersion;
  final DateTime? checkedAt;

  /// Offline pack (routes, place search and addresses without connection),
  /// relative to the app storage directory; null until it is downloaded.
  final String? routingRelativePath;
  final String? routingChecksum;
  final int? routingSizeBytes;

  bool get updateAvailable => latestVersion != null && latestVersion != version;

  bool get hasOfflinePack => routingRelativePath != null;

  /// Bytes on the device: the map and the offline pack.
  int get storedBytes => sizeBytes + (routingSizeBytes ?? 0);

  /// Whether [latest] (the catalog entry) publishes an offline pack that the
  /// device does not have, or a newer one.
  bool needsOfflinePack(MapRegion latest) =>
      latest.hasOfflinePack && latest.routingChecksum != routingChecksum;

  bool contains(Coordinate point) => bbox?.contains(point) ?? false;
}

/// Version comparison for a stored region (`POST /api/v1/maps/regions/updates`).
@immutable
class RegionVersionStatus {
  const RegionVersionStatus({
    required this.region,
    required this.latestVersion,
    required this.checksum,
    required this.updateAvailable,
    this.localVersion,
  });

  factory RegionVersionStatus.fromJson(Map<String, Object?> json) => RegionVersionStatus(
    region: json['region']! as String,
    localVersion: json['localVersion'] as String?,
    latestVersion: json['latestVersion']! as String,
    checksum: json['checksum']! as String,
    updateAvailable: json['updateAvailable'] == true,
  );

  final String region;
  final String? localVersion;
  final String latestVersion;
  final String checksum;
  final bool updateAvailable;
}

enum RegionDownloadStatus { downloading, paused, failed }

/// File of a region being downloaded.
enum RegionDownloadPart {
  /// The PMTiles map.
  map,

  /// The offline pack: routes, place search and addresses without connection.
  offlinePack,
}

/// A download in progress, paused or failed, resumable from its `.part` file.
@immutable
class RegionDownloadTask {
  const RegionDownloadTask({
    required this.code,
    required this.name,
    required this.version,
    required this.totalBytes,
    required this.receivedBytes,
    required this.status,
    this.part = RegionDownloadPart.map,
    this.errorCode,
    this.errorMessage,
  });

  final String code;
  final String name;
  final String version;

  /// Bytes of every file of the download, and of those received so far.
  final int totalBytes;
  final int receivedBytes;
  final RegionDownloadStatus status;

  /// The file being downloaded now.
  final RegionDownloadPart part;
  final String? errorCode;
  final String? errorMessage;

  double get progress => totalBytes <= 0 ? 0 : receivedBytes / totalBytes;

  /// Copy with new progress or status; the error is kept only for failed tasks.
  RegionDownloadTask copyWith({
    int? receivedBytes,
    RegionDownloadStatus? status,
    RegionDownloadPart? part,
    String? errorCode,
    String? errorMessage,
  }) {
    final nextStatus = status ?? this.status;
    final failed = nextStatus == RegionDownloadStatus.failed;
    return RegionDownloadTask(
      code: code,
      name: name,
      version: version,
      totalBytes: totalBytes,
      receivedBytes: receivedBytes ?? this.receivedBytes,
      status: nextStatus,
      part: part ?? this.part,
      errorCode: failed ? errorCode ?? this.errorCode : null,
      errorMessage: failed ? errorMessage ?? this.errorMessage : null,
    );
  }
}
