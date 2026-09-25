import 'dart:async';
import 'dart:convert';
import 'dart:math' show Point;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import '../../domain/entities/coordinate.dart';
import '../../domain/entities/position.dart';

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
    this.destination,
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
  final Coordinate? destination;
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

  MapLibreMapController? _controller;
  StreamSubscription<CameraCommand>? _commands;
  bool _styleReady = false;

  @override
  void initState() {
    super.initState();
    _commands = widget.props.cameraCommands.listen(_moveCamera);
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
      return;
    }
    if (!_styleReady) return;
    if (!identical(old.routes, props.routes) || old.selectedRoute != props.selectedRoute) {
      unawaited(_controller?.setGeoJsonSource(_routesSource, _routesGeoJson()));
    }
    if (old.origin != props.origin || old.destination != props.destination) {
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
    final below = _firstSymbolLayer(widget.props.style);
    await controller.addGeoJsonSource(_routesSource, _routesGeoJson());
    await controller.addGeoJsonSource(_markersSource, _markersGeoJson());
    await controller.addLineLayer(
      _routesSource,
      _alternativeLayer,
      const LineLayerProperties(
        lineColor: '#8A94A6',
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
        lineColor: '#1A73E8',
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
        circleColor: '#188038',
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
        circleColor: '#D93025',
        circleStrokeColor: '#FFFFFF',
        circleStrokeWidth: 3,
      ),
      filter: ['==', 'kind', 'destination'],
      enableInteraction: false,
    );
    _styleReady = true;
    _pushLocation();
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
    Map<String, dynamic> marker(String kind, Coordinate point) => {
      'type': 'Feature',
      'id': kind,
      'properties': {'kind': kind},
      'geometry': {'type': 'Point', 'coordinates': point.toLngLat()},
    };
    return {
      'type': 'FeatureCollection',
      'features': [
        if (props.origin != null) marker('origin', props.origin!),
        if (props.destination != null) marker('destination', props.destination!),
      ],
    };
  }

  /// Route lines go below the first label layer so street names stay readable.
  static String? _firstSymbolLayer(String style) {
    final layers = (jsonDecode(style) as Map<String, Object?>)['layers'] as List<Object?>?;
    for (final layer in layers ?? const <Object?>[]) {
      final json = layer! as Map<String, Object?>;
      if (json['type'] == 'symbol') return json['id'] as String?;
    }
    return null;
  }
}
