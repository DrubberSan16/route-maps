import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors/app_exception.dart';
import '../../domain/entities/coordinate.dart';
import '../../domain/entities/map_region.dart';
import '../../domain/entities/offline_route.dart';
import '../../domain/entities/route.dart';
import '../../domain/entities/routing_profile.dart';
import '../../domain/repositories/map_repository.dart';
import '../../domain/services/connectivity_service.dart';
import '../../presentation/providers.dart';
import 'map_layers_controller.dart';

/// Intermediate stop of the route, visited in order before the destination.
@immutable
class RouteStop {
  const RouteStop(this.coordinate, this.label);

  final Coordinate coordinate;
  final String label;

  @override
  bool operator ==(Object other) =>
      other is RouteStop && other.coordinate == coordinate && other.label == label;

  @override
  int get hashCode => Object.hash(coordinate, label);
}

/// Origin, stops, destination and route shown on the map.
@immutable
class MapViewState {
  const MapViewState({
    this.origin,
    this.originLabel,
    this.stops = const [],
    this.destination,
    this.destinationLabel,
    this.profile = RoutingProfile.car,
    this.route,
    this.selectedRoute = 0,
    this.isRouting = false,
    this.message,
  });

  /// Explicit origin; null means "my location".
  final Coordinate? origin;
  final String? originLabel;

  /// Stops between the origin and the destination, in order.
  final List<RouteStop> stops;
  final Coordinate? destination;
  final String? destinationLabel;
  final RoutingProfile profile;
  final RouteResult? route;
  final int selectedRoute;
  final bool isRouting;

  /// A message for the user (shown once, then cleared).
  final String? message;

  RouteOption? get selectedOption {
    final result = route;
    if (result == null || selectedRoute >= result.routes.length) return null;
    return result.routes[selectedRoute];
  }

  MapViewState copyWith({
    Coordinate? origin,
    String? originLabel,
    bool clearOrigin = false,
    List<RouteStop>? stops,
    Coordinate? destination,
    String? destinationLabel,
    RoutingProfile? profile,
    RouteResult? route,
    bool clearRoute = false,
    int? selectedRoute,
    bool? isRouting,
    String? message,
    bool clearMessage = false,
  }) => MapViewState(
    origin: clearOrigin ? null : origin ?? this.origin,
    originLabel: clearOrigin ? null : originLabel ?? this.originLabel,
    stops: stops ?? this.stops,
    destination: destination ?? this.destination,
    destinationLabel: destinationLabel ?? this.destinationLabel,
    profile: profile ?? this.profile,
    route: clearRoute ? null : route ?? this.route,
    selectedRoute: clearRoute ? 0 : selectedRoute ?? this.selectedRoute,
    isRouting: isRouting ?? this.isRouting,
    message: clearMessage ? null : message ?? this.message,
  );
}

final mapControllerProvider = NotifierProvider<MapController, MapViewState>(MapController.new);

class MapController extends Notifier<MapViewState> {
  /// Stops a route may have (the limit of `POST /routes/calculate`).
  static const maxStops = 23;

  /// Changes whenever the origin, stops, destination or profile change or another
  /// calculation starts, so that an answer to an earlier request is dropped instead of shown.
  int _request = 0;

  @override
  MapViewState build() => const MapViewState();

  /// Sets the destination and clears the previous route; the stops stay. Without
  /// a label the address is looked up (on the phone when there is no connection).
  void setDestination(Coordinate destination, {String? label}) {
    _request++;
    state = MapViewState(
      origin: state.origin,
      originLabel: state.originLabel,
      stops: state.stops,
      destination: destination,
      destinationLabel: label ?? destination.toString(),
      profile: state.profile,
    );
    if (label == null) unawaited(_lookUpLabel(destination));
  }

  /// Adds a stop after the others (before the destination). A route on screen
  /// is calculated again through it.
  void addStop(Coordinate stop, {String? label}) {
    if (state.stops.length >= maxStops) {
      state = state.copyWith(message: 'Una ruta admite hasta $maxStops paradas.');
      return;
    }
    _changeStops([...state.stops, RouteStop(stop, label ?? stop.toString())]);
    if (label == null) unawaited(_lookUpLabel(stop));
  }

  /// Removes the stop at [index]; a route on screen is calculated again without it.
  void removeStop(int index) {
    if (index < 0 || index >= state.stops.length) return;
    _changeStops([...state.stops]..removeAt(index));
  }

  void _changeStops(List<RouteStop> stops) {
    _request++;
    final recalculate = state.route != null || state.isRouting;
    state = state.copyWith(stops: stops, clearRoute: true, isRouting: false);
    if (recalculate) unawaited(calculateRoute());
  }

  /// Uses [origin] instead of the current position (null goes back to it).
  void setOrigin(Coordinate? origin, {String? label}) {
    _request++;
    state = origin == null
        ? state.copyWith(clearOrigin: true, clearRoute: true, isRouting: false)
        : state.copyWith(
            origin: origin,
            originLabel: label ?? origin.toString(),
            clearRoute: true,
            isRouting: false,
          );
  }

  /// Changes the profile; a route shown or being calculated is calculated again for it.
  void setProfile(RoutingProfile profile) {
    if (profile == state.profile) return;
    _request++;
    final recalculate = state.route != null || state.isRouting;
    state = state.copyWith(profile: profile, clearRoute: true, isRouting: false);
    if (recalculate) unawaited(calculateRoute());
  }

  void selectRoute(int index) {
    final route = state.route;
    if (route == null || index < 0 || index >= route.routes.length) return;
    state = state.copyWith(selectedRoute: index);
  }

  /// Calculates the route from the origin (or the current position) through the
  /// stops to the destination: on the server when online; otherwise from stored
  /// routes or on the phone with the downloaded regions.
  Future<void> calculateRoute() async {
    final destination = state.destination;
    if (destination == null) {
      state = state.copyWith(message: 'Elige un destino: búscalo o mantén presionado el mapa.');
      return;
    }
    final request = ++_request;
    final profile = state.profile;
    final waypoints = [for (final stop in state.stops) stop.coordinate];
    state = state.copyWith(isRouting: true, clearMessage: true);
    try {
      final origin =
          state.origin ?? (await ref.read(locationServiceProvider).getCurrentPosition()).coordinate;
      if (!_isCurrent(request)) return;
      final result = await ref
          .read(routingServiceProvider)
          .calculateRoute(
            origin: origin,
            destination: destination,
            profile: profile,
            waypoints: waypoints,
          );
      if (!_isCurrent(request)) return;
      state = state.copyWith(route: result, selectedRoute: 0, isRouting: false);
    } on AppException catch (error) {
      if (!_isCurrent(request)) return;
      state = state.copyWith(isRouting: false, clearRoute: true, message: error.message);
    }
  }

  /// Whether [request] is still the latest calculation for what is on screen.
  bool _isCurrent(int request) => ref.mounted && request == _request;

  /// Shows a stored route as it was saved.
  void showSavedRoute(OfflineRoute route) {
    _request++;
    state = MapViewState(
      origin: route.origin,
      originLabel: 'Inicio de «${route.name}»',
      destination: route.destination,
      destinationLabel: route.name,
      profile: route.profile,
      route: route.toRouteResult(),
    );
  }

  /// Stores the selected route for offline use and synchronization.
  Future<OfflineRoute?> saveSelectedRoute(String name) async {
    final result = state.route;
    final index = state.selectedRoute;
    final option = state.selectedOption;
    if (result == null || option == null) return null;
    final region = await ref.read(regionRepositoryProvider).detectRegion(result.origin);
    final saved = await ref
        .read(savedRouteRepositoryProvider)
        .save(result: result, option: option, name: name, regionId: region?.code);
    if (!ref.mounted) return saved;
    final message = 'Ruta «${saved.name}» guardada. Estará disponible sin conexión.';
    if (!identical(state.route, result)) {
      // Another route is on screen by now: only confirm the save.
      state = state.copyWith(message: message);
      return saved;
    }
    // The displayed option now refers to the stored copy.
    final options = [...result.routes];
    options[index] = saved.toRouteOption().withType(option.type);
    state = state.copyWith(
      route: RouteResult(
        profile: result.profile,
        provider: result.provider,
        source: result.source,
        routes: options,
        origin: result.origin,
        destination: result.destination,
      ),
      message: message,
    );
    return saved;
  }

  void clearRoute() {
    _request++;
    state = MapViewState(profile: state.profile);
  }

  void showMessage(String message) => state = state.copyWith(message: message);

  void consumeMessage() => state = state.copyWith(clearMessage: true);

  /// Replaces the coordinates shown for the destination or a stop at [point]
  /// with its address.
  Future<void> _lookUpLabel(Coordinate point) async {
    try {
      final place = await ref.read(geocodingRepositoryProvider).reverse(point);
      if (!ref.mounted || place == null) return;
      if (state.destination == point) state = state.copyWith(destinationLabel: place.label);
      final unnamed = point.toString();
      if (state.stops.any((stop) => stop.coordinate == point && stop.label == unnamed)) {
        state = state.copyWith(
          stops: [
            for (final stop in state.stops)
              stop.coordinate == point && stop.label == unnamed
                  ? RouteStop(point, place.label)
                  : stop,
          ],
        );
      }
    } on AppException catch (error) {
      // The coordinates stay as the label: the address is only a convenience.
      debugPrint('Reverse geocoding unavailable: ${error.code}');
    }
  }
}

/// Point used to pick the map data and to suggest downloads: the current
/// position rounded to ~1 km, so small movements do not recompute them.
final referencePointProvider = Provider<Coordinate?>((ref) {
  final position = ref.watch(positionProvider).value;
  if (position == null) return null;
  double round(double value) => (value * 100).roundToDouble() / 100;
  return Coordinate(round(position.latitude), round(position.longitude));
});

final mapSourceProvider = FutureProvider<MapSource>((ref) async {
  // Until the first reachability check answers, the server is assumed to be
  // there: its tiles start loading at once instead of after the check.
  final online = ref.watch(connectivityStatusProvider).value != ConnectivityStatus.offline;
  final around = ref.watch(referencePointProvider);
  // Recompute when regions are downloaded or deleted and when the catalog changes.
  ref.watch(downloadedRegionsProvider);
  ref.watch(catalogProvider);
  return ref.watch(mapRepositoryProvider).resolveSource(around: around, online: online);
});

/// Style JSON for the current map source, drawn as the chosen map type when
/// the source has its data.
final mapStyleProvider = FutureProvider<({MapSource source, String style})>((ref) async {
  final source = await ref.watch(mapSourceProvider.future);
  final mapType = await ref.watch(mapLayersProvider.selectAsync((layers) => layers.mapType));
  final style = await ref.watch(mapStyleServiceProvider).styleFor(source, mapType: mapType);
  return (source: source, style: style);
});

/// Region to offer for download when the user is outside every stored one.
final regionSuggestionProvider = FutureProvider<MapRegion?>((ref) async {
  final around = ref.watch(referencePointProvider);
  if (around == null) return null;
  ref.watch(downloadedRegionsProvider);
  ref.watch(catalogProvider);
  return ref.watch(regionDownloadServiceProvider).missingRegionAt(around);
});
