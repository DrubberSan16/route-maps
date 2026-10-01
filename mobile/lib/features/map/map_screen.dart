import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors/app_exception.dart';
import '../../core/utils/formatters.dart';
import '../../domain/entities/coordinate.dart';
import '../../domain/entities/map_region.dart';
import '../../domain/entities/offline_route.dart';
import '../../domain/repositories/map_repository.dart';
import '../../domain/services/location_service.dart';
import '../../presentation/providers.dart';
import '../../presentation/theme.dart';
import '../../presentation/widgets/connection_banner.dart';
import '../../services/map/map_style_service.dart';
import '../../services/regions/region_download_service.dart';
import '../account/account_screen.dart';
import '../offline_maps/offline_maps_screen.dart';
import '../routes/saved_routes_screen.dart';
import '../search/search_screen.dart';
import '../trips/trips_screen.dart';
import 'map_controller.dart';
import 'map_layers_controller.dart';
import 'map_view.dart';
import 'widgets/destination_card.dart';
import 'widgets/map_layers_sheet.dart';
import 'widgets/recording_banner.dart';
import 'widgets/region_suggestion_card.dart';
import 'widgets/route_panel.dart';
import 'widgets/steps_sheet.dart';

/// Where the map opens: the last known position, a stored region, a region
/// of the catalog or, with nothing else, Guayaquil.
final initialCameraProvider = FutureProvider<({Coordinate center, double zoom})>((ref) async {
  final last = await ref.read(locationServiceProvider).getLastKnownPosition();
  if (last != null) return (center: last.coordinate, zoom: 15.0);
  final regions = ref.read(regionRepositoryProvider);
  for (final region in await regions.downloadedRegions()) {
    if (region.bbox != null) return (center: region.bbox!.center, zoom: 12.0);
  }
  for (final region in await regions.cachedCatalog()) {
    if (region.bbox != null) return (center: region.bbox!.center, zoom: 11.0);
  }
  return (center: const Coordinate(-2.1894, -79.8891), zoom: 11.0);
});

/// Main screen: map, search, current position, destination, routes and the
/// entry points to offline maps, saved routes, trips and the account.
class MapScreen extends ConsumerStatefulWidget {
  const MapScreen({super.key});

  @override
  ConsumerState<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends ConsumerState<MapScreen> {
  final _camera = StreamController<CameraCommand>.broadcast();
  bool _centeredOnUser = false;
  String? _dismissedSuggestion;

  MapController get _controller => ref.read(mapControllerProvider.notifier);

  @override
  void dispose() {
    unawaited(_camera.close());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(mapControllerProvider.select((state) => state.message), (_, message) {
      if (message == null) return;
      _snack(message);
      _controller.consumeMessage();
    });
    ref.listen(mapControllerProvider.select((state) => state.route), (previous, route) {
      if (route != null && !identical(route, previous)) _camera.add(FitBounds(route.primary.bbox));
    });
    ref.listen(positionProvider, (_, next) {
      final position = next.value;
      if (position == null || _centeredOnUser) return;
      _centeredOnUser = true;
      _camera.add(CenterOn(position.coordinate, zoom: 15));
    });

    final state = ref.watch(mapControllerProvider);
    final recording = ref.watch(recordingProvider).value;
    final position = ref.watch(positionProvider);
    final source = ref.watch(mapStyleProvider).value?.source;
    final traffic = ref.watch(trafficProvider);
    final panel = _buildPanel(state);

    return Scaffold(
      body: Stack(
        children: [
          Positioned.fill(child: _buildMap(context, state)),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _SearchBarButton(onTap: _openSearch, onMenu: _openMenu),
                  const SizedBox(height: 8),
                  const ClipRRect(
                    borderRadius: BorderRadius.all(Radius.circular(MapChrome.radius)),
                    child: ConnectionBanner(
                      message: 'Sin conexión: usas los mapas descargados y tus rutas guardadas.',
                    ),
                  ),
                  if (source != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: _MapSourceChip(source: source),
                      ),
                    ),
                  if (traffic.visible)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: _TrafficLegend(status: traffic.status),
                    ),
                  if (position.error case final AppException error) ...[
                    const SizedBox(height: 8),
                    _LocationProblem(error: error, onFix: () => _fixLocation(error)),
                  ],
                  if (recording?.trip case final trip?) ...[
                    const SizedBox(height: 8),
                    RecordingBanner(trip: trip, onFinish: _finishTrip),
                  ],
                ],
              ),
            ),
          ),
          Align(
            alignment: Alignment.bottomCenter,
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        _LayersButton(onTap: () => MapLayersSheet.show(context)),
                        const Spacer(),
                        FloatingActionButton(
                          key: const Key('my-location-button'),
                          heroTag: null,
                          tooltip: 'Mi ubicación',
                          onPressed: _centerOnUser,
                          child: const Icon(Icons.my_location),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    // The destination and route panels carry their own actions.
                    ?panel,
                    if (panel is RegionSuggestionCard) const SizedBox(height: 8),
                    if (panel == null || panel is RegionSuggestionCard)
                      _ActionButtons(
                        isRouting: state.isRouting,
                        onRoute: _controller.calculateRoute,
                        onOfflineMaps: () => _push(const OfflineMapsScreen()),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMap(BuildContext context, MapViewState state) {
    final style = ref.watch(mapStyleProvider);
    final camera = ref.watch(initialCameraProvider);
    if (style.error case final error?) {
      return _MapError(
        message: error is AppException ? error.message : 'No se pudo preparar el mapa.',
        onRetry: () => ref.invalidate(mapStyleProvider),
      );
    }
    final styleValue = style.value;
    final cameraValue = camera.value;
    if (styleValue == null || cameraValue == null) {
      return const ColoredBox(
        color: BrandColors.background,
        child: Center(child: CircularProgressIndicator()),
      );
    }
    final route = state.route;
    final layers = ref.watch(mapLayersProvider).value ?? const MapLayers();
    final traffic = ref.watch(trafficProvider);
    return ref.watch(mapViewBuilderProvider)(
      context,
      MapViewProps(
        style: styleValue.style,
        initialCenter: cameraValue.center,
        initialZoom: cameraValue.zoom,
        cameraCommands: _camera.stream,
        onLongPress: _onLongPress,
        onRouteTap: _controller.selectRoute,
        userPosition: ref.watch(positionProvider).value,
        routes: route == null ? const [] : [for (final option in route.routes) option.geometry],
        selectedRoute: state.selectedRoute,
        origin: state.origin,
        stops: [for (final stop in state.stops) stop.coordinate],
        destination: state.destination,
        trafficVisible: traffic.visible,
        trafficFlow: traffic.flow,
        overlays: layers.overlays,
        onCameraIdle: ref.read(trafficProvider.notifier).onViewChanged,
      ),
    );
  }

  Widget? _buildPanel(MapViewState state) {
    if (state.route != null) {
      return RoutePanel(
        state: state,
        onSelectRoute: _controller.selectRoute,
        onProfileChanged: _controller.setProfile,
        onShowSteps: () => showStepsSheet(context, state.selectedOption!),
        onSave: _saveRoute,
        onStartTrip: _startTrip,
        onClose: _controller.clearRoute,
        onAddStop: _addStopFromSearch,
        onRemoveStop: _controller.removeStop,
      );
    }
    if (state.destination != null) {
      return DestinationCard(
        state: state,
        onRoute: _controller.calculateRoute,
        onClear: _controller.clearRoute,
        onResetOrigin: () => _controller.setOrigin(null),
        onAddStop: _addStopFromSearch,
        onRemoveStop: _controller.removeStop,
      );
    }
    final suggestion = ref.watch(regionSuggestionProvider).value;
    if (suggestion == null || suggestion.code == _dismissedSuggestion) return null;
    final task = ref.watch(downloadTasksProvider).value?[suggestion.code];
    return RegionSuggestionCard(
      region: suggestion,
      task: task,
      onDownload: () => _download(suggestion),
      onDismiss: () => setState(() => _dismissedSuggestion = suggestion.code),
    );
  }

  Future<void> _openSearch() async {
    final selection = await Navigator.of(context)
        .push<SearchSelection>(MaterialPageRoute(builder: (_) => const SearchScreen()));
    if (selection == null || !mounted) return;
    switch (selection) {
      case PlaceSelection(:final coordinate, :final label):
        _controller.setDestination(coordinate, label: label);
        _camera.add(CenterOn(coordinate, zoom: 15));
      case SavedRouteSelection(:final route):
        _showSavedRoute(route);
    }
  }

  /// Searches a place and adds it as the next stop of the route.
  Future<void> _addStopFromSearch() async {
    final selection = await Navigator.of(context)
        .push<SearchSelection>(MaterialPageRoute(builder: (_) => const SearchScreen()));
    if (selection is PlaceSelection && mounted) {
      _controller.addStop(selection.coordinate, label: selection.label);
    }
  }

  Future<void> _openMenu() async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => const _MenuSheet(),
    );
    if (!mounted) return;
    switch (choice) {
      case 'routes':
        final route = await Navigator.of(context)
            .push<OfflineRoute>(MaterialPageRoute(builder: (_) => const SavedRoutesScreen()));
        if (route != null && mounted) _showSavedRoute(route);
      case 'trips':
        await _push(const TripsScreen());
      case 'offline':
        await _push(const OfflineMapsScreen());
      case 'account':
        await _push(const AccountScreen());
    }
  }

  void _showSavedRoute(OfflineRoute route) {
    _controller.showSavedRoute(route);
  }

  Future<void> _onLongPress(Coordinate point) async {
    final canAddStop = ref.read(mapControllerProvider).destination != null;
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(title: const Text('Punto del mapa'), subtitle: Text(point.toString())),
            ListTile(
              leading: const Icon(Icons.place, color: BrandColors.destination),
              title: const Text('Ir aquí'),
              onTap: () => Navigator.pop(context, 'destination'),
            ),
            ListTile(
              leading: const Icon(Icons.trip_origin, color: BrandColors.origin),
              title: const Text('Salir desde aquí'),
              onTap: () => Navigator.pop(context, 'origin'),
            ),
            if (canAddStop)
              ListTile(
                leading: const Icon(Icons.add_location_alt_outlined),
                title: const Text('Añadir parada'),
                onTap: () => Navigator.pop(context, 'stop'),
              ),
          ],
        ),
      ),
    );
    if (!mounted) return;
    if (choice == 'destination') _controller.setDestination(point);
    if (choice == 'origin') _controller.setOrigin(point);
    if (choice == 'stop') _controller.addStop(point);
  }

  Future<void> _centerOnUser() async {
    try {
      final position = await ref.read(locationServiceProvider).getCurrentPosition();
      _camera.add(CenterOn(position.coordinate, zoom: 16));
    } on AppException catch (error) {
      if (!mounted) return;
      _snack(
        error.message,
        action: _accessFor(error) == null
            ? null
            : SnackBarAction(label: 'Ajustes', onPressed: () => _fixLocation(error)),
      );
    }
  }

  Future<void> _fixLocation(AppException error) async {
    final service = ref.read(locationServiceProvider);
    final access = _accessFor(error);
    if (access == LocationAccess.denied) {
      // The prompt can still be shown: ask again and restart the updates.
      if (await service.requestAccess() == LocationAccess.granted) ref.invalidate(positionProvider);
      return;
    }
    if (access != null) await service.openSettings(access);
  }

  static LocationAccess? _accessFor(AppException error) => switch (error.code) {
    ErrorCodes.locationServiceDisabled => LocationAccess.serviceDisabled,
    ErrorCodes.locationPermissionDeniedForever => LocationAccess.deniedForever,
    ErrorCodes.locationPermissionDenied => LocationAccess.denied,
    _ => null,
  };

  Future<void> _saveRoute() async {
    final state = ref.read(mapControllerProvider);
    final name = await showDialog<String>(
      context: context,
      builder: (context) => _NameDialog(initial: state.destinationLabel ?? 'Mi ruta'),
    );
    if (name == null || name.trim().isEmpty) return;
    await _controller.saveSelectedRoute(name.trim());
  }

  Future<void> _startTrip() async {
    final state = ref.read(mapControllerProvider);
    try {
      await ref
          .read(tripRecorderProvider)
          .start(
            profile: state.profile,
            name: state.destinationLabel,
            routeId: state.selectedOption?.savedRouteId,
          );
      _snack('Recorrido iniciado. Se guarda en el teléfono aunque no haya conexión.');
    } on AppException catch (error) {
      _snack(error.message);
    }
  }

  Future<void> _finishTrip() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('¿Finalizar el recorrido?'),
        content: const Text('Los puntos grabados se enviarán al servidor cuando haya conexión.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Seguir')),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Finalizar'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final trip = await ref.read(tripRecorderProvider).finish();
    if (trip != null) {
      _snack(
        'Recorrido guardado: ${formatDistance(trip.distanceMeters)}, ${trip.pointCount} puntos.',
      );
    }
  }

  Future<void> _download(MapRegion region) async {
    final result = await ref.read(regionDownloadServiceProvider).download(region);
    if (!mounted) return;
    if (result == RegionDownloadResult.completed) {
      _snack('Mapa de ${region.name} descargado. Ya funciona sin conexión.');
    }
  }

  Future<void> _push(Widget screen) =>
      Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => screen));

  void _snack(String message, {SnackBarAction? action}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message), action: action));
  }
}

class _SearchBarButton extends StatelessWidget {
  const _SearchBarButton({required this.onTap, required this.onMenu});

  final VoidCallback onTap;
  final VoidCallback onMenu;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DecoratedBox(
      decoration: const BoxDecoration(
        borderRadius: BorderRadius.all(Radius.circular(28)),
        boxShadow: MapChrome.shadow,
      ),
      child: Material(
        key: const Key('search-bar'),
        borderRadius: BorderRadius.circular(28),
        color: theme.colorScheme.surface,
        child: InkWell(
          borderRadius: BorderRadius.circular(28),
          onTap: onTap,
          child: SizedBox(
            height: 56,
            child: Row(
              children: [
                const SizedBox(width: 10),
                ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: Image.asset('assets/images/logo.png', width: 34, height: 34),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Buscar destino...',
                    style: theme.textTheme.bodyLarge?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
                Icon(Icons.search, color: theme.colorScheme.onSurfaceVariant),
                const SizedBox(width: 4),
                IconButton(tooltip: 'Menú', icon: const Icon(Icons.menu), onPressed: onMenu),
                const SizedBox(width: 4),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Opens the layers sheet; shows the map type it switches to, like the web viewer.
class _LayersButton extends ConsumerWidget {
  const _LayersButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final layers = ref.watch(mapLayersProvider).value ?? const MapLayers();
    final options = ref.watch(mapTypeOptionsProvider).value ?? const <MapTypeOption>[];
    final current = effectiveMapType(layers.mapType, options);
    final satellite = options.any((o) => o.id == MapTypeOption.satellite && o.available);
    final preview = current == MapTypeOption.map && satellite
        ? MapTypeOption.satellite
        : MapTypeOption.map;
    return DecoratedBox(
      decoration: const BoxDecoration(
        borderRadius: BorderRadius.all(Radius.circular(MapChrome.radius)),
        boxShadow: MapChrome.shadow,
      ),
      child: Material(
        key: const Key('layers-button'),
        color: Colors.white,
        borderRadius: BorderRadius.circular(MapChrome.radius),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(3),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(MapChrome.radius - 3),
              child: SizedBox.square(
                dimension: 58,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    Image.asset(mapTypeThumbnail(preview), fit: BoxFit.cover),
                    const DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [Color(0x000F172A), Color(0xB30F172A)],
                          stops: [0.4, 1],
                        ),
                      ),
                    ),
                    const Align(
                      alignment: Alignment.bottomCenter,
                      child: Padding(
                        padding: EdgeInsets.fromLTRB(4, 0, 4, 4),
                        child: FittedBox(
                          fit: BoxFit.scaleDown,
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.layers_outlined, size: 13, color: Colors.white),
                              SizedBox(width: 3),
                              Text(
                                'Capas',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ActionButtons extends StatelessWidget {
  const _ActionButtons({
    required this.isRouting,
    required this.onRoute,
    required this.onOfflineMaps,
  });

  final bool isRouting;
  final VoidCallback onRoute;
  final VoidCallback onOfflineMaps;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    const height = Size.fromHeight(52);
    return Row(
      children: [
        Expanded(
          flex: 5,
          child: DecoratedBox(
            decoration: const BoxDecoration(
              borderRadius: BorderRadius.all(Radius.circular(MapChrome.radius)),
              boxShadow: MapChrome.shadow,
            ),
            child: FilledButton.icon(
              key: const Key('offline-maps-button'),
              style: FilledButton.styleFrom(
                minimumSize: height,
                backgroundColor: scheme.surface,
                foregroundColor: scheme.primary,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(MapChrome.radius),
                ),
              ),
              onPressed: onOfflineMaps,
              icon: const Icon(Icons.download_for_offline_outlined),
              label: const FittedBox(child: Text('Mapas offline')),
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          flex: 6,
          child: DecoratedBox(
            decoration: const BoxDecoration(
              borderRadius: BorderRadius.all(Radius.circular(MapChrome.radius)),
              boxShadow: MapChrome.shadow,
            ),
            child: FilledButton.icon(
              key: const Key('route-button'),
              style: FilledButton.styleFrom(
                minimumSize: height,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(MapChrome.radius),
                ),
              ),
              onPressed: isRouting ? null : onRoute,
              icon: const Icon(Icons.directions),
              label: FittedBox(child: Text(isRouting ? 'Calculando…' : 'Trazar ruta')),
            ),
          ),
        ),
      ],
    );
  }
}

class _MapSourceChip extends StatelessWidget {
  const _MapSourceChip({required this.source});

  final MapSource source;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final (icon, text) = switch (source) {
      LocalMapSource(:final region) => (Icons.offline_pin, 'Mapa offline: ${region.name}'),
      RemoteMapSource(:final region) => (Icons.cloud_outlined, 'Mapa en línea: ${region.name}'),
      NoMapSource() => (Icons.layers_clear, 'Sin mapa base: descarga una región'),
    };
    return DecoratedBox(
      key: const Key('map-source'),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface.withValues(alpha: 0.94),
        borderRadius: BorderRadius.circular(999),
        boxShadow: MapChrome.shadow,
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(10, 6, 12, 6),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16, color: theme.colorScheme.primary),
            const SizedBox(width: 6),
            Text(text, style: theme.textTheme.labelMedium),
          ],
        ),
      ),
    );
  }
}

/// What the traffic colours mean and what is measured in this area.
class _TrafficLegend extends StatelessWidget {
  const _TrafficLegend({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DecoratedBox(
      key: const Key('traffic-legend'),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(MapChrome.radius),
        boxShadow: MapChrome.shadow,
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.traffic, size: 18, color: theme.colorScheme.primary),
                const SizedBox(width: 6),
                Text('Tráfico', style: theme.textTheme.titleSmall),
                const SizedBox(width: 12),
                const Expanded(child: LegendRow(entries: trafficLegend)),
              ],
            ),
            if (status.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                status,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Saved routes, trips, offline maps and the account.
class _MenuSheet extends StatelessWidget {
  const _MenuSheet();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    Widget item(String value, IconData icon, String title, String subtitle) => ListTile(
      leading: CircleAvatar(
        backgroundColor: theme.colorScheme.primaryContainer,
        foregroundColor: theme.colorScheme.primary,
        child: Icon(icon),
      ),
      title: Text(title),
      subtitle: Text(subtitle),
      onTap: () => Navigator.pop(context, value),
    );
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(8, 0, 8, 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Row(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: Image.asset('assets/images/logo.png', width: 44, height: 44),
                  ),
                  const SizedBox(width: 12),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Route Maps', style: theme.textTheme.titleLarge),
                      Text(
                        'Mapas y rutas, también sin conexión',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            item('routes', Icons.bookmarks_outlined, 'Rutas guardadas', 'Disponibles sin conexión'),
            item('trips', Icons.timeline, 'Mis recorridos', 'Viajes grabados con el GPS'),
            item(
              'offline',
              Icons.download_for_offline_outlined,
              'Mapas offline',
              'Descarga regiones para usarlas sin Internet',
            ),
            item(
              'account',
              Icons.account_circle_outlined,
              'Cuenta y sincronización',
              'Tus datos en todos tus dispositivos',
            ),
          ],
        ),
      ),
    );
  }
}

class _LocationProblem extends StatelessWidget {
  const _LocationProblem({required this.error, required this.onFix});

  final AppException error;
  final VoidCallback onFix;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.secondaryContainer,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 4, 4, 4),
        child: Row(
          children: [
            const Icon(Icons.location_off, size: 18),
            const SizedBox(width: 8),
            Expanded(child: Text(error.message)),
            TextButton(onPressed: onFix, child: const Text('Activar')),
          ],
        ),
      ),
    );
  }
}

class _MapError extends StatelessWidget {
  const _MapError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.map_outlined, size: 48),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            OutlinedButton(onPressed: onRetry, child: const Text('Reintentar')),
          ],
        ),
      ),
    );
  }
}

class _NameDialog extends StatefulWidget {
  const _NameDialog({required this.initial});

  final String initial;

  @override
  State<_NameDialog> createState() => _NameDialogState();
}

class _NameDialogState extends State<_NameDialog> {
  late final _name = TextEditingController(text: widget.initial);

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Guardar ruta'),
      content: TextField(
        controller: _name,
        autofocus: true,
        maxLength: 120,
        decoration: const InputDecoration(labelText: 'Nombre'),
        onSubmitted: (value) => Navigator.pop(context, value),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
        FilledButton(
          onPressed: () => Navigator.pop(context, _name.text),
          child: const Text('Guardar'),
        ),
      ],
    );
  }
}
