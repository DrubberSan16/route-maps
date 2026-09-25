import '../../domain/entities/coordinate.dart';
import '../../domain/entities/geocoding_result.dart';
import '../../domain/repositories/geocoding_repository.dart';
import '../remote/api_client.dart';

class GeocodingRepositoryImpl implements GeocodingRepository {
  GeocodingRepositoryImpl(this._api, {this.language = 'es'});

  final ApiClient _api;
  final String language;

  @override
  Future<List<GeocodingResult>> search(String query, {Coordinate? near}) => _api.get(
    'geocoding/search',
    (data) => [
      for (final item in data! as List<Object?>)
        GeocodingResult.fromJson(item! as Map<String, Object?>),
    ],
    query: {
      'q': query.trim(),
      'limit': 10,
      'lang': language,
      if (near != null) 'lat': near.latitude,
      if (near != null) 'lng': near.longitude,
    },
  );

  @override
  Future<GeocodingResult?> reverse(Coordinate coordinate) => _api.get(
    'geocoding/reverse',
    (data) => data == null ? null : GeocodingResult.fromJson(data as Map<String, Object?>),
    query: {'lat': coordinate.latitude, 'lng': coordinate.longitude, 'lang': language},
  );
}
