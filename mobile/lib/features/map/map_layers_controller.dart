import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors/app_exception.dart';
import '../../domain/entities/coordinate.dart';
import '../../domain/services/connectivity_service.dart';
import '../../presentation/providers.dart';
import '../../services/map/map_style_service.dart';
import 'map_controller.dart';

/// Optional overlays of the style (`maps-platform:overlays`).
abstract final class MapOverlays {
  static const precipitation = 'precipitation';
  static const temperature = 'temperature';
  static const population = 'population';

  static const all = [precipitation, temperature, population];
}

/// What the user chose to see: the map type and the layers drawn on top.
@immutable
class MapLayers {
  const MapLayers({
    this.mapType = MapTypeOption.map,
    this.traffic = false,
    this.overlays = const {},
  });

  /// Reads the stored choice; anything unexpected gives the defaults.
  factory MapLayers.parse(String? json) {
    if (json == null) return const MapLayers();
    try {
      final value = jsonDecode(json) as Map<String, Object?>;
      return MapLayers(
        mapType: value['mapType'] as String? ?? MapTypeOption.map,
        traffic: value['traffic'] == true,
        overlays: {
          for (final kind in value['overlays'] as List<Object?>? ?? const [])
            if (MapOverlays.all.contains(kind)) kind! as String,
        },
      );
    } on Object {
      return const MapLayers();
    }
  }

  /// Preferred map type; drawn only where the map source has its data.
  final String mapType;
  final bool traffic;

  /// Overlays shown ([MapOverlays]).
  final Set<String> overlays;

  MapLayers copyWith({String? mapType, bool? traffic, Set<String>? overlays}) => MapLayers(
    mapType: mapType ?? this.mapType,
    traffic: traffic ?? this.traffic,
    overlays: overlays ?? this.overlays,
  );

  String toJson() =>
      jsonEncode({'mapType': mapType, 'traffic': traffic, 'overlays': overlays.toList()..sort()});

  @override
  bool operator ==(Object other) =>
      other is MapLayers &&
      other.mapType == mapType &&
      other.traffic == traffic &&
      setEquals(other.overlays, overlays);

  @override
  int get hashCode => Object.hash(mapType, traffic, Object.hashAllUnordered(overlays));
}

final mapLayersProvider = AsyncNotifierProvider<MapLayersController, MapLayers>(
  MapLayersController.new,
);

/// The map type and layers chosen on the layers sheet, kept on the device so
/// the map opens the same way next time.
class MapLayersController extends AsyncNotifier<MapLayers> {
  static const _key = 'map.layers';

  @override
  Future<MapLayers> build() async {
    try {
      return MapLayers.parse(await ref.read(settingsRepositoryProvider).read(_key));
    } on Object catch (error) {
      debugPrint('Map layers not restored: $error');
      return const MapLayers();
    }
  }

  MapLayers get _current => state.value ?? const MapLayers();

  Future<void> setMapType(String mapType) => _save(_current.copyWith(mapType: mapType));

  Future<void> setTraffic(bool visible) => _save(_current.copyWith(traffic: visible));

  Future<void> setOverlay(String kind, bool visible) => _save(
    _current.copyWith(
      overlays: visible ? {..._current.overlays, kind} : ({..._current.overlays}..remove(kind)),
    ),
  );

  Future<void> _save(MapLayers next) async {
    if (next == state.value) return;
    state = AsyncData(next);
    try {
      await ref.read(settingsRepositoryProvider).write(_key, next.toJson());
    } on Object catch (error) {
      // The choice still applies now; it is only not remembered.
      debugPrint('Map layers not saved: $error');
    }
  }
}

/// Map types of the style and whether the current map source has their data.
final mapTypeOptionsProvider = FutureProvider<List<MapTypeOption>>((ref) async {
  final source = (await ref.watch(mapStyleProvider.future)).source;
  return ref.watch(mapStyleServiceProvider).mapTypes(source);
});

/// Whether the current map source has the data of the overlays (climate,
/// population): a map downloaded without them only shows them with connection.
final overlaysAvailableProvider = FutureProvider<bool>((ref) async {
  final source = await ref.watch(mapSourceProvider.future);
  return ref.watch(mapStyleServiceProvider).overlaysAvailable(source);
});

// ---------------------------------------------------------------- traffic

/// Reads the measured traffic of `minLng,minLat,maxLng,maxLat` (`GET /traffic/flow`):
/// a GeoJSON FeatureCollection of road segments with `status` and `source`.
typedef TrafficFlowReader = Future<Map<String, Object?>> Function(String bbox);

final trafficFlowReaderProvider = Provider<TrafficFlowReader>((ref) {
  final api = ref.watch(apiClientProvider);
  return (bbox) =>
      api.get('traffic/flow', (data) => data! as Map<String, Object?>, query: {'bbox': bbox});
});

/// The traffic drawn on the map: the main roads in green (from the map tiles)
/// and, for city-sized views, the segments measured by the platform's own
/// trips on top.
@immutable
class TrafficState {
  const TrafficState({this.visible = false, this.flow, this.status = ''});

  final bool visible;

  /// Measured segments (GeoJSON FeatureCollection); null draws none.
  final Map<String, Object?>? flow;

  /// Short description of what is shown.
  final String status;
}

final trafficProvider = NotifierProvider<TrafficController, TrafficState>(TrafficController.new);

/// Keeps the measured traffic of the visible area while the traffic layer is
/// on: asked again when the map stops over another area and every minute.
class TrafficController extends Notifier<TrafficState> {
  /// Measured traffic is requested for city-sized views only (the API takes
  /// up to 2.5 degrees).
  static const minZoom = 10.0;
  static const maxSpan = 2.5;
  static const refreshInterval = Duration(minutes: 1);

  static const farMessage =
      'Las vías principales en verde no tienen demoras reportadas. Acércate a una ciudad para '
      'ver los tramos medidos.';
  static const offlineMessage =
      'Sin conexión: las demoras medidas se verán cuando vuelva la conexión.';

  ({BoundingBox bounds, double? zoom})? _view;
  Timer? _timer;
  int _request = 0;
  String _lastBox = '';
  DateTime? _lastFetch;

  @override
  TrafficState build() {
    final visible = ref.watch(mapLayersProvider.select((layers) => layers.value?.traffic ?? false));
    ref.onDispose(() {
      _timer?.cancel();
      _request++;
    });
    _lastBox = '';
    if (!visible) return const TrafficState();
    _timer = Timer.periodic(refreshInterval, (_) => unawaited(_refresh(force: true)));
    // Back online: the measured traffic is asked for at once.
    ref.listen(connectivityStatusProvider, (previous, next) {
      if (previous?.value == ConnectivityStatus.offline && !_offline) {
        unawaited(_refresh(force: true));
      }
    });
    scheduleMicrotask(() => unawaited(_refresh(force: true)));
    return const TrafficState(visible: true, status: 'Cargando el tráfico…');
  }

  /// Only a failed check counts: while unknown (starting up) the request is tried.
  bool get _offline => ref.read(connectivityStatusProvider).value == ConnectivityStatus.offline;

  /// The map stopped moving: [bounds] are visible at [zoom].
  void onViewChanged(BoundingBox bounds, double? zoom) {
    _view = (bounds: bounds, zoom: zoom);
    if (state.visible) unawaited(_refresh());
  }

  Future<void> _refresh({bool force = false}) async {
    final view = _view;
    if (!ref.mounted || !state.visible || view == null) return;
    final span = view.bounds.east - view.bounds.west > view.bounds.north - view.bounds.south
        ? view.bounds.east - view.bounds.west
        : view.bounds.north - view.bounds.south;
    if ((view.zoom ?? minZoom) < minZoom || span > maxSpan) {
      _request++;
      _lastBox = '';
      state = const TrafficState(visible: true, status: farMessage);
      return;
    }
    if (_offline) {
      _request++;
      state = TrafficState(visible: true, flow: state.flow, status: offlineMessage);
      return;
    }
    final box = gridBox(view.bounds);
    final last = _lastFetch;
    if (!force &&
        box == _lastBox &&
        last != null &&
        DateTime.now().difference(last) < refreshInterval) {
      return;
    }
    final request = ++_request;
    try {
      final flow = await ref.read(trafficFlowReaderProvider)(box);
      if (!ref.mounted || request != _request) return;
      _lastBox = box;
      _lastFetch = DateTime.now();
      state = TrafficState(visible: true, flow: flow, status: describeFlow(flow));
    } on AppException catch (error) {
      if (!ref.mounted || request != _request) return;
      state = TrafficState(visible: true, flow: state.flow, status: error.message);
    }
  }

  /// Outward to a 0.01 degree grid: nearby views share the request (and the
  /// server cache).
  static String gridBox(BoundingBox bounds) => [
    (bounds.west * 100).floor() / 100,
    (bounds.south * 100).floor() / 100,
    (bounds.east * 100).ceil() / 100,
    (bounds.north * 100).ceil() / 100,
  ].map((value) => value.toStringAsFixed(2)).join(',');

  static String describeFlow(Map<String, Object?> flow) {
    final features = (flow['features'] as List<Object?>? ?? const []).cast<Map<String, Object?>>();
    if (features.isEmpty) {
      return 'Sin recorridos recientes ni habituales en esta zona: las vías en verde no tienen '
          'demoras reportadas.';
    }
    final typical = features
        .where((feature) => (feature['properties'] as Map?)?['source'] == 'typical')
        .length;
    final live = features.length - typical;
    final window = flow['windowMinutes'] ?? 15;
    return 'Tramos medidos: ${[if (live > 0) '$live en vivo (últimos $window min)', if (typical > 0) '$typical con lo habitual a esta hora (más tenues)'].join(' y ')}. El resto de vías en verde no tiene demoras reportadas.';
  }
}
