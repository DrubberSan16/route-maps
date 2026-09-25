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
import '../../presentation/providers.dart';

/// Origin, destination and route shown on the map.
@immutable
class MapViewState {
  const MapViewState({
    this.origin,
    this.originLabel,
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
  @override
  MapViewState build() => const MapViewState();

  /// Sets the destination and clears the previous route. Without a label the
  /// address is looked up when there is connection.
  void setDestination(Coordinate destination, {String? label}) {
    state = MapViewState(
      origin: state.origin,
      originLabel: state.originLabel,
      destination: destination,
      destinationLabel: label ?? destination.toString(),
      profile: state.profile,
    );
    if (label == null) unawaited(_lookUpLabel(destination));
  }

  /// Uses [origin] instead of the current position (null goes back to it).
  void setOrigin(Coordinate? origin, {String? label}) {
    state = origin == null
        ? state.copyWith(clearOrigin: true, clearRoute: true)
        : state.copyWith(origin: origin, originLabel: label ?? origin.toString(), clearRoute: true);
  }

  void setProfile(RoutingProfile profile) {
    if (profile == state.profile) return;
    final hadRoute = state.route != null;
    state = state.copyWith(profile: profile, clearRoute: true);
    if (hadRoute) unawaited(calculateRoute());
  }

  void selectRoute(int index) {
    final route = state.route;
    if (route == null || index < 0 || index >= route.routes.length) return;
    state = state.copyWith(selectedRoute: index);
  }

  /// Calculates the route from the origin (or the current position) to the
  /// destination: on the server when online, from stored routes otherwise.
  Future<void> calculateRoute() async {
    final destination = state.destination;
    if (destination == null) {
      state = state.copyWith(message: 'Elige un destino: búscalo o mantén presionado el mapa.');
      return;
    }
    state = state.copyWith(isRouting: true, clearMessage: true);
    try {
      final origin =
          state.origin ?? (await ref.read(locationServiceProvider).getCurrentPosition()).coordinate;
      final result = await ref
          .read(routingServiceProvider)
          .calculateRoute(origin: origin, destination: destination, profile: state.profile);
      if (!ref.mounted) return;
      state = state.copyWith(route: result, selectedRoute: 0, isRouting: false);
    } on AppException catch (error) {
      if (!ref.mounted) return;
      state = state.copyWith(isRouting: false, clearRoute: true, message: error.message);
    }
  }

  /// Shows a stored route as it was saved.
  void showSavedRoute(OfflineRoute route) {
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
    final option = state.selectedOption;
    if (result == null || option == null) return null;
    final region = await ref.read(regionRepositoryProvider).detectRegion(result.origin);
    final saved = await ref
        .read(savedRouteRepositoryProvider)
        .save(result: result, option: option, name: name, regionId: region?.code);
    if (!ref.mounted) return saved;
    // The displayed option now refers to the stored copy.
    final options = [...result.routes];
    options[state.selectedRoute] = saved.toRouteOption().withType(option.type);
    state = state.copyWith(
      route: RouteResult(
        profile: result.profile,
        provider: result.provider,
        source: result.source,
        routes: options,
        origin: result.origin,
        destination: result.destination,
      ),
      message: 'Ruta «${saved.name}» guardada. Estará disponible sin conexión.',
    );
    return saved;
  }

  void clearRoute() {
    state = MapViewState(profile: state.profile);
  }

  void showMessage(String message) => state = state.copyWith(message: message);

  void consumeMessage() => state = state.copyWith(clearMessage: true);

  Future<void> _lookUpLabel(Coordinate destination) async {
    if (!ref.read(isOnlineProvider)) return;
    try {
      final place = await ref.read(geocodingRepositoryProvider).reverse(destination);
      if (!ref.mounted || place == null || state.destination != destination) return;
      state = state.copyWith(destinationLabel: place.label);
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
  final online = ref.watch(isOnlineProvider);
  final around = ref.watch(referencePointProvider);
  // Recompute when regions are downloaded or deleted and when the catalog changes.
  ref.watch(downloadedRegionsProvider);
  ref.watch(catalogProvider);
  return ref.watch(mapRepositoryProvider).resolveSource(around: around, online: online);
});

/// Style JSON for the current map source.
final mapStyleProvider = FutureProvider<({MapSource source, String style})>((ref) async {
  final source = await ref.watch(mapSourceProvider.future);
  final style = await ref.watch(mapStyleServiceProvider).styleFor(source);
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
