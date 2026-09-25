import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/domain/entities/coordinate.dart';
import 'package:maps_platform/domain/geo.dart';

void main() {
  test('haversine distance matches known values', () {
    // Guayaquil (Malecón) to Quito (Plaza Grande): ~270 km.
    final km =
        distanceMeters(const Coordinate(-2.1937, -79.8811), const Coordinate(-0.2202, -78.5125)) /
        1000;
    expect(km, closeTo(267, 3));
    // One degree of latitude is ~111.2 km.
    expect(distanceMeters(const Coordinate(0, 0), const Coordinate(1, 0)), closeTo(111195, 5));
    expect(distanceMeters(const Coordinate(10, 10), const Coordinate(10, 10)), 0);
  });

  group('locateOnLine', () {
    // A straight east-west line along the equator, 4 vertices ~1.1 km apart.
    const line = [Coordinate(0, 0), Coordinate(0, 0.01), Coordinate(0, 0.02), Coordinate(0, 0.03)];

    test('projects onto the closest segment', () {
      final match = locateOnLine(line, const Coordinate(0.0005, 0.015));
      expect(match.position.vertex, 1);
      expect(match.position.fraction, closeTo(0.5, 1e-6));
      expect(match.point.longitude, closeTo(0.015, 1e-9));
      expect(match.meters, closeTo(55.6, 0.5));
    });

    test('clamps to the ends of the line', () {
      expect(locateOnLine(line, const Coordinate(0, -1)).position, const LinePosition(0));
      expect(locateOnLine(line, const Coordinate(0, 5)).position, const LinePosition(3));
    });

    test('only looks ahead of `after`', () {
      final match = locateOnLine(line, const Coordinate(0, 0.005), after: const LinePosition(2));
      expect(match.position, const LinePosition(2));
    });

    test('slices between two positions', () {
      final part = sliceLine(line, const LinePosition(0, 0.5), const LinePosition(2, 0.5));
      expect(part, [
        const Coordinate(0, 0.005),
        const Coordinate(0, 0.01),
        const Coordinate(0, 0.02),
        const Coordinate(0, 0.025),
      ]);
      expect(sliceLine(line, const LinePosition(1), const LinePosition(3)), line.sublist(1));
      expect(lineLengthMeters(part), closeTo(2223.9, 1));
    });
  });
}
