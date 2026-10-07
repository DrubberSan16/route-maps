import '../entities/coordinate.dart';
import '../entities/geocoding_result.dart';

/// Place search and addresses: through the platform's own official-data API,
/// or on the phone with the offline packs of the downloaded regions.
abstract class GeocodingRepository {
  Future<List<GeocodingResult>> search(String query, {Coordinate? near});

  Future<GeocodingResult?> reverse(Coordinate coordinate);
}
