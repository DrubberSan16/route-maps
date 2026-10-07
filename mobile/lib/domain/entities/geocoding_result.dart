import 'package:flutter/foundation.dart';

import 'coordinate.dart';

/// Where a [GeocodingResult] was found.
enum GeocodingSource {
  /// The platform's API.
  server,

  /// The offline packs of the regions downloaded on the phone.
  device,
}

/// A place found by text search or reverse geocoding.
@immutable
class GeocodingResult {
  const GeocodingResult({
    required this.displayName,
    required this.coordinate,
    this.name,
    this.category,
    this.type,
    this.source = GeocodingSource.server,
  });

  /// Parses a result of the API, or the same JSON answered by the offline engine.
  factory GeocodingResult.fromJson(
    Map<String, Object?> json, {
    GeocodingSource source = GeocodingSource.server,
  }) => GeocodingResult(
    displayName: json['displayName']! as String,
    name: json['name'] as String?,
    coordinate: Coordinate(
      (json['latitude']! as num).toDouble(),
      (json['longitude']! as num).toDouble(),
    ),
    category: json['category'] as String?,
    type: json['type'] as String?,
    source: source,
  );

  final String displayName;
  final String? name;
  final Coordinate coordinate;
  final String? category;
  final String? type;
  final GeocodingSource source;

  /// Short label for the map ("Malecón 2000" instead of the full address).
  String get label => (name != null && name!.isNotEmpty) ? name! : displayName;
}
