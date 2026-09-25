import '../entities/coordinate.dart';
import '../entities/geocoding_result.dart';

/// Address search through the platform API (Nominatim behind it).
abstract class GeocodingRepository {
  Future<List<GeocodingResult>> search(String query, {Coordinate? near});

  Future<GeocodingResult?> reverse(Coordinate coordinate);
}
