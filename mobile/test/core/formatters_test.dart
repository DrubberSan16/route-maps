import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/core/utils/coordinate_parser.dart';
import 'package:maps_platform/core/utils/formatters.dart';
import 'package:maps_platform/domain/entities/coordinate.dart';

void main() {
  test('distances', () {
    expect(formatDistance(850), '850 m');
    expect(formatDistance(2487), '2,5 km');
  });

  test('durations', () {
    expect(formatDuration(198), '3 min');
    expect(formatDuration(3900), '1 h 05 min');
  });

  test('sizes use decimal units as the download screen shows them', () {
    expect(formatBytes(791537), '792 KB');
    expect(formatBytes(185 * 1000 * 1000), '185 MB');
    expect(formatBytes(124 * 1000 * 1000), '124 MB');
    expect(formatBytes(1300 * 1000 * 1000), '1,3 GB');
  });

  test('progress is floored so 100 % means finished', () {
    expect(formatPercent(0.67), '67 %');
    expect(formatPercent(0.999), '99 %');
    expect(formatPercent(1), '100 %');
  });

  test('coordinates typed by the user', () {
    expect(parseCoordinate('-2.170, -79.922'), const Coordinate(-2.17, -79.922));
    expect(parseCoordinate('-2.170 -79.922'), const Coordinate(-2.17, -79.922));
    expect(parseCoordinate('-2,170; -79,922'), const Coordinate(-2.17, -79.922));
    expect(parseCoordinate('Malecón 2000'), isNull);
    expect(parseCoordinate('95, 10'), isNull);
  });
}
