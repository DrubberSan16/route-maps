import 'dart:async';
import 'dart:math' show Point, log, ln2;

import 'package:flutter/foundation.dart' show listEquals, setEquals;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import '../../domain/entities/coordinate.dart';
import '../../domain/entities/position.dart';
import '../../services/map/map_style_service.dart';
import 'poi_icons.dart';

/// Camera movements requested by the screen.
sealed class CameraCommand {
  const CameraCommand();
}

class CenterOn extends CameraCommand {
  const CenterOn(this.target, {this.zoom});

  final Coordinate target;
  final double? zoom;
}

class FitBounds extends CameraCommand {
  const FitBounds(this.bounds);

  final BoundingBox bounds;
}

/// Everything the map draws. The map widget is replaceable (see
/// [mapViewBuilderProvider]) so screens can be tested without the native view.
@immutable
class MapViewProps {
  const MapViewProps({
    required this.style,
    required this.initialCenter,
    required this.initialZoom,
    required this.cameraCommands,
    required this.onLongPress,
    required this.onRouteTap,
    this.userPosition,
    this.routes = const [],
    this.selectedRoute = 0,
    this.origin,
    this.stops = const [],
    this.destination,
    this.trafficVisible = false,
    this.trafficFlow,
    this.overlays = const {},
    this.onCameraIdle,
  });

  /// MapLibre style JSON.
  final String style;
  final Coordinate initialCenter;
  final double initialZoom;
  final Stream<CameraCommand> cameraCommands;
  final ValueChanged<Coordinate> onLongPress;

  /// Index of the tapped route in [routes].
  final ValueChanged<int> onRouteTap;
  final Position? userPosition;

  /// Geometries of the primary route and its alternatives.
  final List<List<Coordinate>> routes;
  final int selectedRoute;
  final Coordinate? origin;

  /// Stops between the origin and the destination, drawn numbered in order.
  final List<Coordinate> stops;
  final Coordinate? destination;

  /// Shows the traffic: the main roads of the map and [trafficFlow] on top.
  final bool trafficVisible;

  /// Measured road segments (GeoJSON FeatureCollection of `GET /traffic/flow`).
  final Map<String, Object?>? trafficFlow;

  /// Overlays of the style shown (`precipitation`, `temperature`, `population`).
  final Set<String> overlays;

  /// The map stopped moving with these bounds at this zoom (estimated).
  final void Function(BoundingBox bounds, double zoom)? onCameraIdle;
}

typedef MapViewBuilder = Widget Function(BuildContext context, MapViewProps props);

final mapViewBuilderProvider = Provider<MapViewBuilder>(
  (ref) =>
      (context, props) => MapLibreView(props: props),
);

/// [MapViewProps] rendered with MapLibre Native. Routes and markers are
/// GeoJSON sources with style layers (added again after every style change);
/// the user's position feeds MapLibre's location component.
class MapLibreView extends StatefulWidget {
  const MapLibreView({super.key, required this.props});

  final MapViewProps props;

  @override
  State<MapLibreView> createState() => _MapLibreViewState();
}

class _MapLibreViewState extends State<MapLibreView> {
  static const _routesSource = 'app-routes';
  static const _markersSource = 'app-markers';
  static const _alternativeLayer = 'app-route-alternative';
  static const _casingLayer = 'app-route-casing';
  static const _selectedLayer = 'app-route-selected';
  static const _originLayer = 'app-origin';
  static const _destinationLayer = 'app-destination';
  static const _stopLayer = 'app-stop';
  static const _stopLabelLayer = 'app-stop-label';

  static const _emptyCollection = {'type': 'FeatureCollection', 'features': <Object?>[]};

  MapLibreMapController? _controller;
  StreamSubscription<CameraCommand>? _commands;
  bool _styleReady = false;
  late MapStyleLayers _layers;

  @override
  void initState() {
    super.initState();
    _commands = widget.props.cameraCommands.listen(_moveCamera);
    _layers = MapStyleLayers.of(widget.props.style);
  }

  @override
  void didUpdateWidget(MapLibreView oldWidget) {
    super.didUpdateWidget(oldWidget);
    final old = oldWidget.props, props = widget.props;
    if (!identical(old.cameraCommands, props.cameraCommands)) {
      unawaited(_commands?.cancel());
      _commands = props.cameraCommands.listen(_moveCamera);
    }
    if (old.style != props.style) {
      // MapLibre reloads the style; layers are added again when it is ready.
      _styleReady = false;
      _layers = MapStyleLayers.of(props.style);
      return;
    }
    if (!_styleReady) return;
    if (old.trafficVisible != props.trafficVisible) unawaited(_showTraffic());
    if (!identical(old.trafficFlow, props.trafficFlow)) unawaited(_setTrafficFlow());
    if (!setEquals(old.overlays, props.overlays)) unawaited(_showOverlays());
    if (!identical(old.routes, props.routes) || old.selectedRoute != props.selectedRoute) {
      unawaited(_controller?.setGeoJsonSource(_routesSource, _routesGeoJson()));
    }
    if (old.origin != props.origin ||
        old.destination != props.destination ||
        !listEquals(old.stops, props.stops)) {
      unawaited(_controller?.setGeoJsonSource(_markersSource, _markersGeoJson()));
    }
    if (old.userPosition != props.userPosition) _pushLocation();
  }

  @override
  void dispose() {
    unawaited(_commands?.cancel());
    _controller?.onFeatureTapped.remove(_onFeatureTapped);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final props = widget.props;
    return MapLibreMap(
      styleString: props.style,
      initialCameraPosition: CameraPosition(
        target: LatLng(props.initialCenter.latitude, props.initialCenter.longitude),
        zoom: props.initialZoom,
      ),
      onMapCreated: (controller) {
        _controller = controller;
        controller.onFeatureTapped.add(_onFeatureTapped);
      },
      onStyleLoadedCallback: _onStyleLoaded,
      onCameraIdle: _reportView,
      onMapLongClick: (_, latLng) =>
          props.onLongPress(Coordinate(latLng.latitude, latLng.longitude)),
      myLocationEnabled: true,
      locationSource: const ManualLocationSource(),
      compassEnabled: true,
      attributionButtonPosition: AttributionButtonPosition.bottomRight,
      annotationOrder: const [],
    );
  }

  Future<void> _onStyleLoaded() async {
    final controller = _controller;
    if (controller == null) return;
    final below = _layers.firstSymbol;
    // Routes and markers in the colours of the web viewer (viewer.css).
    await controller.addGeoJsonSource(_routesSource, _routesGeoJson());
    await controller.addGeoJsonSource(_markersSource, _markersGeoJson());
    await controller.addLineLayer(
      _routesSource,
      _alternativeLayer,
      const LineLayerProperties(
        lineColor: '#7FA3E8',
        lineWidth: 5,
        lineOpacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round',
      ),
      belowLayerId: below,
      filter: ['==', 'selected', false],
    );
    await controller.addLineLayer(
      _routesSource,
      _casingLayer,
      const LineLayerProperties(
        lineColor: '#FFFFFF',
        lineWidth: 9,
        lineJoin: 'round',
        lineCap: 'round',
      ),
      belowLayerId: below,
      filter: ['==', 'selected', true],
      enableInteraction: false,
    );
    await controller.addLineLayer(
      _routesSource,
      _selectedLayer,
      const LineLayerProperties(
        lineColor: '#2563EB',
        lineWidth: 6,
        lineJoin: 'round',
        lineCap: 'round',
      ),
      belowLayerId: below,
      filter: ['==', 'selected', true],
    );
    await controller.addCircleLayer(
      _markersSource,
      _originLayer,
      const CircleLayerProperties(
        circleRadius: 7,
        circleColor: '#047857',
        circleStrokeColor: '#FFFFFF',
        circleStrokeWidth: 3,
      ),
      filter: ['==', 'kind', 'origin'],
      enableInteraction: false,
    );
    await controller.addCircleLayer(
      _markersSource,
      _destinationLayer,
      const CircleLayerProperties(
        circleRadius: 9,
        circleColor: '#DC2626',
        circleStrokeColor: '#FFFFFF',
        circleStrokeWidth: 3,
      ),
      filter: ['==', 'kind', 'destination'],
      enableInteraction: false,
    );
    await controller.addCircleLayer(
      _markersSource,
      _stopLayer,
      const CircleLayerProperties(
        circleRadius: 10,
        circleColor: '#2563EB',
        circleStrokeColor: '#FFFFFF',
        circleStrokeWidth: 2,
      ),
      filter: ['==', 'kind', 'stop'],
      enableInteraction: false,
    );
    await controller.addSymbolLayer(
      _markersSource,
      _stopLabelLayer,
      const SymbolLayerProperties(
        textField: [Expressions.get, 'label'],
        textFont: ['Noto Sans Medium'],
        textSize: 12,
        textColor: '#FFFFFF',
        textAllowOverlap: true,
        textIgnorePlacement: true,
      ),
      filter: ['==', 'kind', 'stop'],
      enableInteraction: false,
    );
    _styleReady = true;
    _pushLocation();
    await Future.wait([_showTraffic(), _setTrafficFlow(), _showOverlays()]);
    unawaited(_reportView());
    await _addPoiIcons(controller);
  }

  /// Traffic and overlays are hidden in the style: shown here, without reloading it.
  Future<void> _showTraffic() => _setVisible(_layers.traffic, widget.props.trafficVisible);

  Future<void> _showOverlays() => Future.wait([
    for (final MapEntry(key: kind, value: ids) in _layers.overlays.entries)
      _setVisible(ids, widget.props.overlays.contains(kind)),
  ]);

  Future<void> _setVisible(List<String> layerIds, bool visible) async {
    final controller = _controller;
    if (controller == null || !_styleReady) return;
    for (final id in layerIds) {
      await controller.setLayerVisibility(id, visible);
    }
  }

  Future<void> _setTrafficFlow() async {
    final controller = _controller;
    if (controller == null || !_styleReady || _layers.traffic.isEmpty) return;
    await controller.setGeoJsonSource(
      MapStyleService.trafficSource,
      widget.props.trafficFlow ?? _emptyCollection,
    );
  }

  /// Draws the icon of every point of interest class of the style (they are
  /// part of the style, so again after each reload).
  Future<void> _addPoiIcons(MapLibreMapController controller) async {
    final ratio = MediaQuery.devicePixelRatioOf(context);
    final style = widget.props.style;
    for (final MapEntry(key: poiClass, value: color) in _layers.poiColors.entries) {
      if (poiClass == 'default') continue;
      final png = await PoiIcons.png(poiClass, color, ratio);
      if (!mounted || widget.props.style != style || !_styleReady) return;
      await controller.addImage('poi-$poiClass', png);
    }
  }

  /// Tells the screen which area is visible (for the traffic of that area).
  Future<void> _reportView() async {
    final controller = _controller;
    final callback = widget.props.onCameraIdle;
    if (controller == null || callback == null) return;
    final region = await controller.getVisibleRegion();
    if (!mounted) return;
    final bounds = BoundingBox(
      west: region.southwest.longitude,
      south: region.southwest.latitude,
      east: region.northeast.longitude,
      north: region.northeast.latitude,
    );
    // Zoom from the visible width (512-point tiles) instead of tracking every camera move.
    final width = context.size?.width ?? 360;
    final span = bounds.east - bounds.west;
    final zoom = span > 0 ? log(360 * width / (512 * span)) / ln2 : 0.0;
    callback(bounds, zoom);
  }

  void _onFeatureTapped(
    Point<double> point,
    LatLng coordinates,
    String id,
    String layerId,
    Annotation? annotation,
  ) {
    if (layerId != _alternativeLayer && layerId != _selectedLayer) return;
    final index = int.tryParse(id);
    if (index != null) widget.props.onRouteTap(index);
  }

  void _pushLocation() {
    final position = widget.props.userPosition;
    final controller = _controller;
    if (position == null || controller == null) return;
    unawaited(
      controller.updateManualLocation(
        ManualLocationUpdate(
          target: LatLng(position.latitude, position.longitude),
          horizontalAccuracy: position.accuracy,
          altitude: position.altitude,
          bearing: position.heading,
          speed: position.speed,
          timestamp: position.timestamp,
        ),
      ),
    );
  }

  Future<void> _moveCamera(CameraCommand command) async {
    final controller = _controller;
    if (controller == null) return;
    switch (command) {
      case CenterOn(:final target, :final zoom):
        final latLng = LatLng(target.latitude, target.longitude);
        await controller.animateCamera(
          zoom == null ? CameraUpdate.newLatLng(latLng) : CameraUpdate.newLatLngZoom(latLng, zoom),
        );
      case FitBounds(:final bounds):
        await controller.animateCamera(
          CameraUpdate.newLatLngBounds(
            LatLngBounds(
              southwest: LatLng(bounds.south, bounds.west),
              northeast: LatLng(bounds.north, bounds.east),
            ),
            left: 48,
            top: 160,
            right: 48,
            bottom: 320,
          ),
        );
    }
  }

  Map<String, dynamic> _routesGeoJson() {
    final props = widget.props;
    // The selected route goes last so it is drawn above the alternatives.
    final order = [
      for (var i = 0; i < props.routes.length; i++)
        if (i != props.selectedRoute) i,
      if (props.selectedRoute < props.routes.length) props.selectedRoute,
    ];
    return {
      'type': 'FeatureCollection',
      'features': [
        for (final i in order)
          if (props.routes[i].length >= 2)
            {
              'type': 'Feature',
              'id': '$i',
              'properties': {'selected': i == props.selectedRoute},
              'geometry': {
                'type': 'LineString',
                'coordinates': [for (final point in props.routes[i]) point.toLngLat()],
              },
            },
      ],
    };
  }

  Map<String, dynamic> _markersGeoJson() {
    final props = widget.props;
    Map<String, dynamic> marker(String kind, Coordinate point, {String id = '', String? label}) => {
      'type': 'Feature',
      'id': id.isEmpty ? kind : id,
      'properties': {'kind': kind, 'label': ?label},
      'geometry': {'type': 'Point', 'coordinates': point.toLngLat()},
    };
    return {
      'type': 'FeatureCollection',
      'features': [
        if (props.origin != null) marker('origin', props.origin!),
        for (var i = 0; i < props.stops.length; i++)
          marker('stop', props.stops[i], id: 'stop-${i + 1}', label: '${i + 1}'),
        if (props.destination != null) marker('destination', props.destination!),
      ],
    };
  }
}
