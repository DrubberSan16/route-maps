import '../entities/coordinate.dart';
import '../entities/geocoding_result.dart';

/// Place search through the platform's own official-data API.
abstract class GeocodingRepository {
  Future<List<GeocodingResult>> search(String query, {Coordinate? near});

  Future<GeocodingResult?> reverse(Coordinate coordinate);
}
