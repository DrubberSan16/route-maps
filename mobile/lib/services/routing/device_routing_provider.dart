import 'package:uuid/uuid.dart';

import '../../core/errors/app_exception.dart';
import '../../domain/entities/coordinate.dart';
import '../../domain/entities/route.dart';
import '../../domain/entities/routing_profile.dart';
import '../../domain/geo.dart';
import '../../domain/services/offline_routing_provider.dart';
import '../../infrastructure/offline/offline_engine.dart';
import '../regions/offline_packs.dart';

/// Mode 2 of offline routing: new routes calculated on the phone by the
/// platform's native engine, ported to the app, on the offline pack of the
/// smallest downloaded region that covers every stop. The routes are the ones
/// the server would calculate on the same data, without the weather and
/// traffic adjustments that only the server knows.
class DeviceRoutingProvider implements OfflineRoutingProvider {
  DeviceRoutingProvider({
    required this._engine,
    required this._packs,
    this.language = 'es-ES',
    this.maxAlternatives = 2,
    this._uuid = const Uuid(),
  });

  final OfflineEngine _engine;
  final OfflinePackPaths _packs;
  final Uuid _uuid;

  /// Language of the instructions (BCP-47).
  final String language;

  /// Alternatives offered with the primary route (the server's default).
  final int maxAlternatives;

  /// Answer for points outside the downloaded regions.
  static const notCoveredMessage =
      'Sin conexión: el origen, el destino o alguna parada están fuera de las regiones '
      'descargadas. Descarga la región en «Mapas offline» o conéctate a Internet.';

  @override
  String get name => 'native';

  @override
  Future<bool> canRoute({
    required Coordinate origin,
    required Coordinate destination,
    required RoutingProfile profile,
    List<Coordinate> waypoints = const [],
  }) async => (await _packs()).isNotEmpty;

  @override
  Future<RouteResult> calculateRoute({
    required Coordinate origin,
    required Coordinate destination,
    required RoutingProfile profile,
    List<Coordinate> waypoints = const [],
    bool alternatives = true,
  }) async {
    final stops = [origin, ...waypoints, destination];
    // The checks of the server's API.
    if (!stops.every((stop) => stop.isValid)) {
      throw AppException.of(ErrorCodes.invalidCoordinates);
    }
    if (waypoints.isEmpty && distanceMeters(origin, destination) < 1) {
      throw const AppException(
        ErrorCodes.invalidCoordinates,
        'El origen y el destino son el mismo punto.',
      );
    }
    final packs = await _packs();
    if (packs.isEmpty) throw AppException.of(ErrorCodes.offlineRouteUnavailable);

    final Map<String, Object?> answer;
    try {
      answer = await _engine.route(
        packs: packs,
        profile: profile.apiValue,
        stops: [for (final stop in stops) (longitude: stop.longitude, latitude: stop.latitude)],
        alternatives: alternatives && waypoints.isEmpty ? maxAlternatives : 0,
        language: language,
      );
    } on OfflineEngineException catch (error) {
      throw switch (error.code) {
        'no_route' => AppException(
          ErrorCodes.routeNotFound,
          userMessageFor(ErrorCodes.routeNotFound),
          details: {'reason': error.message},
          cause: error,
        ),
        'not_covered' => AppException(
          ErrorCodes.offlineRouteUnavailable,
          notCoveredMessage,
          cause: error,
        ),
        _ => offlineEngineError(error, ErrorCodes.offlineRouteUnavailable),
      };
    }
    // The same JSON as `POST /routes/calculate`, with fresh ids like the server's.
    RouteOption option(Object? route, String type) => RouteOption.fromJson({
      ...route! as Map<String, Object?>,
      'routeId': _uuid.v4(),
      'type': type,
    });
    return RouteResult(
      profile: profile,
      provider: name,
      source: RouteSource.onDevice,
      routes: [
        option(answer['primary'], 'PRIMARY'),
        for (final alternative in answer['alternatives']! as List<Object?>)
          option(alternative, 'ALTERNATIVE'),
      ],
      origin: origin,
      destination: destination,
    );
  }
}
