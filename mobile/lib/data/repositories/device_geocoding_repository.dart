import '../../core/errors/app_exception.dart';
import '../../domain/entities/coordinate.dart';
import '../../domain/entities/geocoding_result.dart';
import '../../domain/repositories/geocoding_repository.dart';
import '../../infrastructure/offline/offline_engine.dart';
import '../../services/regions/offline_packs.dart';

/// Place search and addresses on the phone, with the offline packs of the
/// downloaded regions: the platform's own search index and address rules,
/// answering like `GET /geocoding/search` and `GET /geocoding/reverse`.
class DeviceGeocodingRepository implements GeocodingRepository {
  DeviceGeocodingRepository({required this._engine, required this._packs});

  final OfflineEngine _engine;
  final OfflinePackPaths _packs;

  @override
  Future<List<GeocodingResult>> search(String query, {Coordinate? near}) async {
    final packs = await _packs();
    if (packs.isEmpty) throw AppException.of(ErrorCodes.offlineSearchUnavailable);
    try {
      final results = await _engine.search(
        packs: packs,
        text: query.trim(),
        nearLatitude: near?.latitude,
        nearLongitude: near?.longitude,
      );
      return [
        for (final result in results)
          GeocodingResult.fromJson(result, source: GeocodingSource.device),
      ];
    } on OfflineEngineException catch (error) {
      throw offlineEngineError(error, ErrorCodes.offlineSearchUnavailable);
    }
  }

  @override
  Future<GeocodingResult?> reverse(Coordinate coordinate) async {
    final packs = await _packs();
    if (packs.isEmpty) throw AppException.of(ErrorCodes.offlineSearchUnavailable);
    try {
      final result = await _engine.reverse(
        packs: packs,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
      );
      return result == null
          ? null
          : GeocodingResult.fromJson(result, source: GeocodingSource.device);
    } on OfflineEngineException catch (error) {
      // Outside the downloaded regions there is no address to give.
      if (error.code == 'not_covered') return null;
      throw offlineEngineError(error, ErrorCodes.offlineSearchUnavailable);
    }
  }
}
