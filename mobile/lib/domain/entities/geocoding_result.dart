import 'package:flutter/foundation.dart';

import 'coordinate.dart';

/// A place found by text search or reverse geocoding.
@immutable
class GeocodingResult {
  const GeocodingResult({
    required this.displayName,
    required this.coordinate,
    this.name,
    this.category,
    this.type,
  });

  factory GeocodingResult.fromJson(Map<String, Object?> json) => GeocodingResult(
    displayName: json['displayName']! as String,
    name: json['name'] as String?,
    coordinate: Coordinate(
      (json['latitude']! as num).toDouble(),
      (json['longitude']! as num).toDouble(),
    ),
    category: json['category'] as String?,
    type: json['type'] as String?,
  );

  final String displayName;
  final String? name;
  final Coordinate coordinate;
  final String? category;
  final String? type;

  /// Short label for the map ("Malecón 2000" instead of the full address).
  String get label => (name != null && name!.isNotEmpty) ? name! : displayName;
}
