import '../../domain/entities/coordinate.dart';

final _dotDecimals = RegExp(r'^\s*([-+]?\d+(?:\.\d+)?)\s*[,;\s]\s*([-+]?\d+(?:\.\d+)?)\s*$');
final _commaDecimals = RegExp(r'^\s*([-+]?\d+(?:,\d+)?)\s*[;\s]\s*([-+]?\d+(?:,\d+)?)\s*$');

/// Parses "latitude, longitude" typed by the user: `-2.170, -79.922`,
/// `-2.170 -79.922` or, with decimal commas, `-2,170; -79,922`.
/// Returns null when the text is not a valid coordinate pair.
Coordinate? parseCoordinate(String input) {
  final match = _dotDecimals.firstMatch(input) ?? _commaDecimals.firstMatch(input);
  if (match == null) return null;
  final latitude = double.tryParse(match.group(1)!.replaceAll(',', '.'));
  final longitude = double.tryParse(match.group(2)!.replaceAll(',', '.'));
  if (latitude == null || longitude == null) return null;
  final coordinate = Coordinate(latitude, longitude);
  return coordinate.isValid ? coordinate : null;
}
