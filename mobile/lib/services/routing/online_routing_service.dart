import '../../core/errors/app_exception.dart';
import '../../data/remote/api_client.dart';
import '../../domain/entities/coordinate.dart';
import '../../domain/entities/route.dart';
import '../../domain/entities/routing_profile.dart';
import '../../domain/services/routing_service.dart';

/// Routes calculated by the platform (`POST /api/v1/routes/calculate`), which
/// forwards to the self-hosted engine (Valhalla or OSRM).
class OnlineRoutingService implements RoutingService {
  OnlineRoutingService(this._api, {this.language = 'es-ES'});

  final ApiClient _api;

  /// Language of the instructions (BCP-47).
  final String language;

  @override
  Future<RouteResult> calculateRoute({
    required Coordinate origin,
    required Coordinate destination,
    required RoutingProfile profile,
    bool alternatives = true,
  }) async {
    if (!origin.isValid || !destination.isValid) {
      throw AppException.of(ErrorCodes.invalidCoordinates);
    }
    return _api.post(
      'routes/calculate',
      (data) => RouteResult.fromApi(
        data! as Map<String, Object?>,
        origin: origin,
        destination: destination,
      ),
      body: {
        'origin': origin.toJson(),
        'destination': destination.toJson(),
        'profile': profile.apiValue,
        'alternatives': alternatives,
        'language': language,
      },
    );
  }
}
