import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/core/utils/coordinate_parser.dart';
import 'package:maps_platform/domain/entities/coordinate.dart';

void main() {
  test('reads coordinates the way people type them', () {
    const expected = Coordinate(-2.17, -79.922);
    expect(parseCoordinate('-2.170, -79.922'), expected);
    expect(parseCoordinate('  -2.170 -79.922 '), expected);
    expect(parseCoordinate('-2.170;-79.922'), expected);
    expect(parseCoordinate('-2,170; -79,922'), expected);
    expect(parseCoordinate('-2,170 -79,922'), expected);
  });

  test('rejects text and impossible positions', () {
    expect(parseCoordinate('Malecón 2000'), isNull);
    expect(parseCoordinate('-2.17'), isNull);
    expect(parseCoordinate('95.0, 10.0'), isNull);
    expect(parseCoordinate('10.0, 190.0'), isNull);
  });
}
