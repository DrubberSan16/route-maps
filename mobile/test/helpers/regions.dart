import 'package:maps_platform/domain/entities/coordinate.dart';
import 'package:maps_platform/domain/entities/map_region.dart';

/// A catalog entry as the API publishes it.
MapRegion region(
  String code, {
  String? name,
  String version = '2026.09.01',
  int size = 185 * 1000 * 1000,
  BoundingBox? bbox,
  String checksum = 'aa',
}) => MapRegion(
  code: code,
  name: name ?? code,
  country: 'EC',
  city: name,
  version: version,
  mapSizeBytes: size,
  checksum: checksum,
  bbox: bbox,
  minZoom: 0,
  maxZoom: 14,
  mapDownloadUrl: '/api/v1/maps/regions/$code/download',
  tilesUrl: '/maps/ec/$code.pmtiles',
  updatedAt: DateTime.utc(2026, 9, 1),
);

Map<String, Object?> regionJson(MapRegion region) => {
  'id': region.code,
  'name': region.name,
  'country': region.country,
  'province': region.province,
  'city': region.city,
  'version': region.version,
  'mapSize': region.mapSizeBytes,
  'routingSize': region.routingSizeBytes,
  'checksum': region.checksum,
  'routingChecksum': region.routingChecksum,
  if (region.bbox case final bbox?) 'bbox': [bbox.west, bbox.south, bbox.east, bbox.north],
  'minZoom': region.minZoom,
  'maxZoom': region.maxZoom,
  'mapDownloadUrl': region.mapDownloadUrl,
  'routingDownloadUrl': region.routingDownloadUrl,
  'tilesUrl': region.tilesUrl,
  'enabled': true,
  'updatedAt': region.updatedAt.toIso8601String(),
};

const guayaquilBox = BoundingBox(west: -80.10, south: -2.35, east: -79.75, north: -1.95);
const ecuadorBox = BoundingBox(west: -81.1, south: -5.1, east: -75.2, north: 1.5);
const guayaquilCenter = Coordinate(-2.1894, -79.8891);
const quito = Coordinate(-0.1807, -78.4678);
