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
import '../../presentation/widgets/attribution.dart';
import '../../presentation/widgets/connection_banner.dart';
import '../../services/regions/region_download_service.dart';
import '../account/account_screen.dart';
import '../offline_maps/offline_maps_screen.dart';
import '../routes/saved_routes_screen.dart';
import '../search/search_screen.dart';
import '../trips/trips_screen.dart';
import 'map_controller.dart';
import 'map_view.dart';
import 'widgets/destination_card.dart';
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

    return Scaffold(
      body: Stack(
        children: [
          Positioned.fill(child: _buildMap(context, state)),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _SearchBarButton(onTap: _openSearch, onMenu: _openMenu),
                  const SizedBox(height: 8),
                  const ClipRRect(
                    borderRadius: BorderRadius.all(Radius.circular(12)),
                    child: ConnectionBanner(
                      message: 'Sin conexión: usas los mapas descargados y tus rutas guardadas.',
                    ),
                  ),
                  if (source != null) ...[
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: _MapSourceChip(source: source),
                    ),
                  ],
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
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 4),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    ?_buildPanel(state),
                    const SizedBox(height: 8),
                    _ActionButtons(
                      isRouting: state.isRouting,
                      onMyLocation: _centerOnUser,
                      onRoute: _controller.calculateRoute,
                      onOfflineMaps: () => _push(const OfflineMapsScreen()),
                    ),
                    const SizedBox(height: 4),
                    const Align(alignment: Alignment.centerLeft, child: OsmAttribution()),
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
      return const Center(child: CircularProgressIndicator());
    }
    final route = state.route;
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
        destination: state.destination,
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
      );
    }
    if (state.destination != null) {
      return DestinationCard(
        state: state,
        onRoute: _controller.calculateRoute,
        onClear: _controller.clearRoute,
        onResetOrigin: () => _controller.setOrigin(null),
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

  Future<void> _openMenu() async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.bookmarks),
              title: const Text('Rutas guardadas'),
              onTap: () => Navigator.pop(context, 'routes'),
            ),
            ListTile(
              leading: const Icon(Icons.timeline),
              title: const Text('Mis recorridos'),
              onTap: () => Navigator.pop(context, 'trips'),
            ),
            ListTile(
              leading: const Icon(Icons.download_for_offline),
              title: const Text('Mapas offline'),
              onTap: () => Navigator.pop(context, 'offline'),
            ),
            ListTile(
              leading: const Icon(Icons.account_circle),
              title: const Text('Cuenta y sincronización'),
              onTap: () => Navigator.pop(context, 'account'),
            ),
          ],
        ),
      ),
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
    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(title: Text(point.toString())),
            ListTile(
              leading: const Icon(Icons.place, color: Color(0xFFD93025)),
              title: const Text('Ir aquí'),
              onTap: () => Navigator.pop(context, 'destination'),
            ),
            ListTile(
              leading: const Icon(Icons.trip_origin, color: Color(0xFF188038)),
              title: const Text('Salir desde aquí'),
              onTap: () => Navigator.pop(context, 'origin'),
            ),
          ],
        ),
      ),
    );
    if (!mounted) return;
    if (choice == 'destination') _controller.setDestination(point);
    if (choice == 'origin') _controller.setOrigin(point);
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
    return Material(
      key: const Key('search-bar'),
      elevation: 3,
      borderRadius: BorderRadius.circular(28),
      color: Theme.of(context).colorScheme.surface,
      child: InkWell(
        borderRadius: BorderRadius.circular(28),
        onTap: onTap,
        child: SizedBox(
          height: 52,
          child: Row(
            children: [
              const SizedBox(width: 16),
              const Icon(Icons.search),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  'Buscar destino...',
                  style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
                ),
              ),
              IconButton(tooltip: 'Menú', icon: const Icon(Icons.menu), onPressed: onMenu),
              const SizedBox(width: 4),
            ],
          ),
        ),
      ),
    );
  }
}

class _ActionButtons extends StatelessWidget {
  const _ActionButtons({
    required this.isRouting,
    required this.onMyLocation,
    required this.onRoute,
    required this.onOfflineMaps,
  });

  final bool isRouting;
  final VoidCallback onMyLocation;
  final VoidCallback onRoute;
  final VoidCallback onOfflineMaps;

  @override
  Widget build(BuildContext context) {
    final style = FilledButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8));
    return Row(
      children: [
        Expanded(
          child: FilledButton.tonal(
            key: const Key('my-location-button'),
            style: style,
            onPressed: onMyLocation,
            child: const FittedBox(child: Text('📍 Mi ubicación')),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: FilledButton(
            key: const Key('route-button'),
            style: style,
            onPressed: isRouting ? null : onRoute,
            child: FittedBox(child: Text(isRouting ? 'Calculando…' : '🗺 Trazar ruta')),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: FilledButton.tonal(
            key: const Key('offline-maps-button'),
            style: style,
            onPressed: onOfflineMaps,
            child: const FittedBox(child: Text('📥 Mapas offline')),
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
    final (icon, text) = switch (source) {
      LocalMapSource(:final region) => (Icons.offline_pin, 'Mapa offline: ${region.name}'),
      RemoteMapSource(:final region) => (Icons.cloud, 'Mapa en línea: ${region.name}'),
      NoMapSource() => (Icons.layers_clear, 'Sin mapa base: descarga una región'),
    };
    return Chip(
      key: const Key('map-source'),
      avatar: Icon(icon, size: 18),
      label: Text(text),
      visualDensity: VisualDensity.compact,
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
