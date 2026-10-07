import '../../core/errors/app_exception.dart';
import '../../domain/entities/coordinate.dart';
import '../../domain/entities/geocoding_result.dart';
import '../../domain/repositories/geocoding_repository.dart';
import '../../domain/services/connectivity_service.dart';

/// Chooses where to search, like the hybrid routing service: the platform's
/// API when there is connection; the phone (the downloaded regions) without
/// it, or when the request fails for network reasons or because the search
/// engine of the server is down.
class HybridGeocodingRepository implements GeocodingRepository {
  HybridGeocodingRepository({
    required this._online,
    required this._device,
    required this._connectivity,
  });

  final GeocodingRepository _online;
  final GeocodingRepository _device;
  final ConnectivityService _connectivity;

  @override
  Future<List<GeocodingResult>> search(String query, {Coordinate? near}) =>
      _ask((repository) => repository.search(query, near: near));

  @override
  Future<GeocodingResult?> reverse(Coordinate coordinate) =>
      _ask((repository) => repository.reverse(coordinate));

  Future<T> _ask<T>(Future<T> Function(GeocodingRepository repository) request) async {
    if (_connectivity.status == ConnectivityStatus.offline) return request(_device);
    try {
      return await request(_online);
    } on AppException catch (serverError) {
      if (!_canFallBack(serverError)) rethrow;
      try {
        return await request(_device);
      } on AppException catch (deviceError) {
        // Nothing downloaded either: explain the server problem when there is
        // connection, or the offline limitation when there is not.
        if (deviceError.code == ErrorCodes.offlineSearchUnavailable &&
            !serverError.isNetworkError) {
          throw serverError;
        }
        rethrow;
      }
    }
  }

  static bool _canFallBack(AppException error) =>
      error.isNetworkError ||
      error.code == ErrorCodes.geocodingProviderUnavailable ||
      (error.statusCode != null && error.statusCode! >= 500);
}
