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
    this.bbox,
  });

  factory MapRegion.fromJson(Map<String, Object?> json) {
    final bbox = json['bbox'] as List<Object?>?;
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
      tilesUrl: json['tilesUrl']! as String,
      updatedAt: DateTime.parse(json['updatedAt']! as String),
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

  /// Routing graph package for a future on-device engine (see docs/offline-architecture.md).
  final String? routingDownloadUrl;

  /// Range-readable PMTiles URL for online rendering.
  final String tilesUrl;
  final DateTime updatedAt;

  bool contains(Coordinate point) => bbox?.contains(point) ?? false;
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

  bool get updateAvailable => latestVersion != null && latestVersion != version;

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
    this.errorCode,
    this.errorMessage,
  });

  final String code;
  final String name;
  final String version;
  final int totalBytes;
  final int receivedBytes;
  final RegionDownloadStatus status;
  final String? errorCode;
  final String? errorMessage;

  double get progress => totalBytes <= 0 ? 0 : receivedBytes / totalBytes;

  /// Copy with new progress or status; the error is kept only for failed tasks.
  RegionDownloadTask copyWith({
    int? receivedBytes,
    RegionDownloadStatus? status,
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
      errorCode: failed ? errorCode ?? this.errorCode : null,
      errorMessage: failed ? errorMessage ?? this.errorMessage : null,
    );
  }
}
