import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/core/errors/app_exception.dart';
import 'package:maps_platform/domain/entities/coordinate.dart';
import 'package:maps_platform/domain/entities/geocoding_result.dart';
import 'package:maps_platform/domain/entities/map_region.dart';
import 'package:maps_platform/domain/entities/route.dart';
import 'package:maps_platform/domain/entities/routing_profile.dart';
import 'package:maps_platform/domain/entities/trip.dart';
import 'package:maps_platform/domain/repositories/map_repository.dart';
import 'package:maps_platform/domain/services/connectivity_service.dart';
import 'package:maps_platform/domain/services/location_service.dart';
import 'package:maps_platform/features/map/map_controller.dart';
import 'package:maps_platform/features/map/map_layers_controller.dart';
import 'package:maps_platform/features/map/map_screen.dart';
import 'package:maps_platform/features/map/map_view.dart';
import 'package:maps_platform/features/offline_maps/offline_maps_controller.dart';
import 'package:maps_platform/presentation/providers.dart';
import 'package:maps_platform/services/map/map_style_service.dart';
import 'package:maps_platform/services/regions/region_download_service.dart';
import 'package:maps_platform/services/tracking/trip_recorder.dart';

import '../helpers/app_fakes.dart';
import '../helpers/fakes.dart';
import '../helpers/fixtures.dart';
import '../helpers/regions.dart';

const _emptyStyle = '{"version":8,"sources":{},"layers":[]}';
const _casino = Coordinate(43.7311, 7.4197);
const _home = Coordinate(43.7384, 7.4246);
const _port = Coordinate(43.7350, 7.4210);

void main() {
  late FakeConnectivityService connectivity;
  late FakeLocationService location;
  late InMemoryRegionRepository regions;
  late ScriptedRegionDownloadService downloads;
  late ScriptedRoutingService routing;
  late ScriptedGeocodingRepository geocoding;
  late InMemorySavedRouteRepository savedRoutes;
  late InMemorySettingsRepository settings;
  late RecordingMapView mapView;
  late List<String> trafficRequests;

  final monacoRoute = RouteResult.fromApi(
    fixtureData('route_calculate_monaco')! as Map<String, Object?>,
    origin: _home,
    destination: _casino,
  );

  setUp(() {
    connectivity = FakeConnectivityService();
    location = FakeLocationService(position: fix(_home.latitude, _home.longitude));
    regions = InMemoryRegionRepository(
      catalog: [region('guayaquil', name: 'Guayaquil', bbox: guayaquilBox)],
    );
    downloads = ScriptedRegionDownloadService(regions);
    routing = ScriptedRoutingService(monacoRoute);
    geocoding = ScriptedGeocodingRepository([
      const GeocodingResult(
        displayName: 'Casino de Monte-Carlo, Place du Casino, Monaco',
        name: 'Casino de Monte-Carlo',
        coordinate: _casino,
      ),
    ]);
    savedRoutes = InMemorySavedRouteRepository();
    settings = InMemorySettingsRepository();
    mapView = RecordingMapView();
    trafficRequests = [];
  });

  tearDown(() => mapView.dispose());

  Future<void> pumpMap(
    WidgetTester tester, {
    MapSource source = const NoMapSource(),
    Stream<RecordingState>? recording,
    List<MapTypeOption> mapTypes = const [
      MapTypeOption(id: MapTypeOption.map, label: 'Mapa', available: true),
    ],
    bool overlaysAvailable = true,
  }) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          connectivityServiceProvider.overrideWithValue(connectivity),
          locationServiceProvider.overrideWithValue(location),
          regionRepositoryProvider.overrideWithValue(regions),
          regionDownloadServiceProvider.overrideWithValue(downloads),
          routingServiceProvider.overrideWithValue(routing),
          geocodingRepositoryProvider.overrideWithValue(geocoding),
          savedRouteRepositoryProvider.overrideWithValue(savedRoutes),
          settingsRepositoryProvider.overrideWithValue(settings),
          trafficFlowReaderProvider.overrideWithValue((bbox) async {
            trafficRequests.add(bbox);
            return {'type': 'FeatureCollection', 'features': <Object?>[], 'windowMinutes': 15};
          }),
          mapStyleProvider.overrideWith((ref) async => (source: source, style: _emptyStyle)),
          mapTypeOptionsProvider.overrideWith((ref) async => mapTypes),
          overlaysAvailableProvider.overrideWith((ref) async => overlaysAvailable),
          mapViewBuilderProvider.overrideWithValue(mapView.build),
          recordingProvider.overrideWith(
            (ref) => recording ?? Stream.value(const RecordingState()),
          ),
          freeSpaceProvider.overrideWith((ref) async => null),
        ],
        child: const MaterialApp(home: MapScreen()),
      ),
    );
    await tester.pumpAndSettle();
  }

  /// Long press on the map and "Ir aquí".
  Future<void> chooseDestination(WidgetTester tester, Coordinate point) async {
    mapView.props!.onLongPress(point);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ir aquí'));
    await tester.pumpAndSettle();
  }

  testWidgets('shows the map with search, layers and the main actions', (tester) async {
    await pumpMap(tester);

    expect(find.byKey(const Key('fake-map')), findsOneWidget);
    expect(find.text('Buscar destino...'), findsOneWidget);
    expect(find.byTooltip('Menú'), findsOneWidget);
    expect(find.byTooltip('Mi ubicación'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Trazar ruta'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Mapas offline'), findsOneWidget);
    expect(find.text('Capas'), findsOneWidget);
    expect(find.text('Sin mapa base: descarga una región'), findsOneWidget);
    // Opens where the user was last seen.
    expect(mapView.props!.initialCenter, _home);
    expect(mapView.props!.trafficVisible, isFalse);
    expect(mapView.props!.overlays, isEmpty);
  });

  testWidgets('the layers sheet switches the map type and draws the chosen details', (
    tester,
  ) async {
    // The region has imagery but no elevation published.
    await pumpMap(
      tester,
      mapTypes: const [
        MapTypeOption(id: MapTypeOption.map, label: 'Mapa', available: true),
        MapTypeOption(id: MapTypeOption.satellite, label: 'Satélite', available: true),
        MapTypeOption(id: MapTypeOption.relief, label: 'Relieve', available: false),
      ],
    );
    await tester.tap(find.byKey(const Key('layers-button')));
    await tester.pumpAndSettle();

    expect(find.text('Tipo de mapa'), findsOneWidget);
    expect(find.text('Satélite'), findsOneWidget);
    expect(find.text('Sin datos en esta zona'), findsOneWidget);

    await tester.tap(find.byKey(const Key('map-type-satellite')));
    await tester.tap(find.byKey(const Key('layer-population')));
    await tester.tap(find.byKey(const Key('layer-traffic')));
    await tester.pumpAndSettle();

    expect(find.text('Mapa de calor de la malla censal de 1 km².'), findsOneWidget);
    expect(
      MapLayers.parse(settings.values['map.layers']),
      const MapLayers(mapType: 'satellite', traffic: true, overlays: {'population'}),
    );
    expect(mapView.props!.overlays, {'population'});
    expect(mapView.props!.trafficVisible, isTrue);

    // Relief cannot be picked here.
    await tester.tap(find.byKey(const Key('map-type-relief')));
    await tester.pumpAndSettle();
    expect(MapLayers.parse(settings.values['map.layers']).mapType, 'satellite');
  });

  testWidgets('offline, overlays the downloaded map lacks cannot be picked and say why', (
    tester,
  ) async {
    connectivity.status = ConnectivityStatus.offline;
    settings.values['map.layers'] = '{"overlays":["population"]}';
    await pumpMap(tester, overlaysAvailable: false);
    await tester.tap(find.byKey(const Key('layers-button')));
    await tester.pumpAndSettle();

    // Population, rain and climate: each one says it needs a connection.
    expect(find.text('Necesita conexión'), findsNWidgets(3));
    expect(find.text('Mapa de calor de la malla censal de 1 km².'), findsNothing);
    await tester.tap(find.byKey(const Key('layer-precipitation')));
    await tester.pumpAndSettle();
    // The choice made before is kept for when the data is there again.
    expect(MapLayers.parse(settings.values['map.layers']).overlays, {'population'});

    // Traffic does not depend on the map file.
    await tester.tap(find.byKey(const Key('layer-traffic')));
    await tester.pumpAndSettle();
    expect(MapLayers.parse(settings.values['map.layers']).traffic, isTrue);
  });

  testWidgets('with traffic on, the legend shows and city views ask for the measured segments', (
    tester,
  ) async {
    settings.values['map.layers'] = '{"traffic":true}';
    await pumpMap(tester);

    expect(find.byKey(const Key('traffic-legend')), findsOneWidget);
    expect(find.text('Sin demoras'), findsOneWidget);
    expect(find.text('Detenido'), findsOneWidget);

    mapView.props!.onCameraIdle!(
      const BoundingBox(west: 7.40, south: 43.72, east: 7.44, north: 43.75),
      14,
    );
    await tester.pumpAndSettle();
    expect(trafficRequests, ['7.40,43.72,7.44,43.75']);
    expect(mapView.props!.trafficFlow, isNotNull);
    expect(find.textContaining('Sin recorridos recientes ni habituales'), findsOneWidget);
  });

  testWidgets('traces a route with alternatives that can be picked on the panel or the map', (
    tester,
  ) async {
    await pumpMap(tester);
    await chooseDestination(tester, _casino);

    // The address of the point is looked up while online.
    expect(find.text('Casino de Monte-Carlo'), findsOneWidget);
    expect(find.text('Desde mi ubicación'), findsOneWidget);
    expect(mapView.props!.destination, _casino);

    await tester.tap(find.byKey(const Key('route-button')));
    await tester.pumpAndSettle();

    expect(routing.requests.single.origin, _home);
    expect(routing.requests.single.destination, _casino);
    expect(routing.requests.single.profile, RoutingProfile.car);
    expect(find.text('3 min · 2,5 km'), findsOneWidget);
    expect(find.textContaining('Calculada en el servidor (valhalla)'), findsOneWidget);
    expect(find.text('Principal: 3 min · 2,5 km'), findsOneWidget);
    expect(find.text('Alternativa 1: 3 min · 2,4 km'), findsOneWidget);
    expect(mapView.props!.routes, hasLength(2));
    expect(mapView.props!.selectedRoute, 0);
    expect(mapView.commands.whereType<FitBounds>(), isNotEmpty);

    await tester.tap(find.byKey(const Key('route-option-1')));
    await tester.pumpAndSettle();
    expect(mapView.props!.selectedRoute, 1);
    expect(find.byKey(const Key('route-summary')), findsOneWidget);
    expect(find.text('3 min · 2,4 km'), findsOneWidget);

    // Tapping the grey line on the map selects it too.
    mapView.props!.onRouteTap(0);
    await tester.pumpAndSettle();
    expect(mapView.props!.selectedRoute, 0);
    expect(find.text('3 min · 2,5 km'), findsOneWidget);
  });

  testWidgets('stops are added on the map, drawn in order and sent with the route', (tester) async {
    await pumpMap(tester);
    await chooseDestination(tester, _casino);

    mapView.props!.onLongPress(_port);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ListTile, 'Añadir parada'));
    await tester.pumpAndSettle();
    expect(mapView.props!.stops, [_port]);
    expect(find.byTooltip('Quitar parada 1'), findsOneWidget);

    await tester.tap(find.byKey(const Key('route-button')));
    await tester.pumpAndSettle();
    expect(routing.requests.single.waypoints, [_port]);

    // Removing the stop from the route panel calculates the route again.
    await tester.tap(find.byTooltip('Quitar parada 1'));
    await tester.pumpAndSettle();
    expect(mapView.props!.stops, isEmpty);
    expect(routing.requests, hasLength(2));
    expect(routing.requests.last.waypoints, isEmpty);
  });

  testWidgets('a calculated route can be saved for offline use', (tester) async {
    await pumpMap(tester);
    await chooseDestination(tester, _casino);
    await tester.tap(find.byKey(const Key('route-button')));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Guardar'));
    await tester.pumpAndSettle();
    expect(find.text('Guardar ruta'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Guardar'));
    await tester.pumpAndSettle();

    expect(savedRoutes.routes.single.name, 'Casino de Monte-Carlo');
    expect(
      find.text('Ruta «Casino de Monte-Carlo» guardada. Estará disponible sin conexión.'),
      findsOneWidget,
    );
    expect(find.text('Guardada'), findsOneWidget);
  });

  testWidgets('offline, a new route explains what still works', (tester) async {
    connectivity.status = ConnectivityStatus.offline;
    routing.error = AppException.of(ErrorCodes.offlineRouteUnavailable);
    await pumpMap(tester);

    expect(
      find.text('Sin conexión: usas los mapas descargados y tus rutas guardadas.'),
      findsOneWidget,
    );
    await chooseDestination(tester, _casino);
    expect(find.text(_casino.toString()), findsWidgets, reason: 'no address lookup offline');

    await tester.tap(find.byKey(const Key('route-button')));
    await tester.pumpAndSettle();
    expect(
      find.text(
        'Sin conexión: calcular una ruta nueva requiere Internet. '
        'Puedes abrir una de tus rutas guardadas.',
      ),
      findsOneWidget,
    );
    expect(find.byKey(const Key('route-summary')), findsNothing);
  });

  testWidgets('offers to download the region the user is in', (tester) async {
    location.position = fix(guayaquilCenter.latitude, guayaquilCenter.longitude);
    await pumpMap(tester);
    location.positions.add(location.position!);
    await tester.pumpAndSettle();

    expect(find.text('No tienes descargado el mapa de esta región.'), findsOneWidget);
    expect(find.text('Guayaquil   185 MB'), findsOneWidget);
    // The first fix centers the map on the user.
    expect(mapView.commands.whereType<CenterOn>().first.zoom, 15);

    await tester.tap(find.text('Descargar'));
    await tester.pump();
    expect(downloads.calls, ['download:guayaquil:2026.09.01']);

    downloads.setTask(
      const RegionDownloadTask(
        code: 'guayaquil',
        name: 'Guayaquil',
        version: '2026.09.01',
        totalBytes: 185 * 1000 * 1000,
        receivedBytes: 124 * 1000 * 1000,
        status: RegionDownloadStatus.downloading,
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('67 %'), findsOneWidget);

    downloads.clearTask('guayaquil');
    await regions.saveDownloaded(
      region: regions.catalogForTest.single,
      relativePath: 'regions/guayaquil/2026.09.01/guayaquil.pmtiles',
      sizeBytes: 185 * 1000 * 1000,
    );
    downloads.pendingDownload!.complete(RegionDownloadResult.completed);
    await tester.pumpAndSettle();
    expect(find.text('Mapa de Guayaquil descargado. Ya funciona sin conexión.'), findsOneWidget);
    expect(find.text('No tienes descargado el mapa de esta región.'), findsNothing);
  });

  testWidgets('"Mi ubicación" centers the map, or explains the missing permission', (tester) async {
    await pumpMap(tester);
    await tester.tap(find.byKey(const Key('my-location-button')));
    await tester.pumpAndSettle();
    final center = mapView.commands.whereType<CenterOn>().last;
    expect(center.target, _home);
    expect(center.zoom, 16);

    location.access = LocationAccess.denied;
    await tester.tap(find.byKey(const Key('my-location-button')));
    await tester.pumpAndSettle();
    expect(find.text('Sin permiso de ubicación no podemos mostrar tu posición.'), findsOneWidget);
    expect(find.text('Ajustes'), findsOneWidget);
  });

  testWidgets('tells whether the map is the downloaded one or the online one', (tester) async {
    await pumpMap(
      tester,
      source: LocalMapSource(
        region: DownloadedRegion(
          code: 'guayaquil',
          name: 'Guayaquil',
          version: '2026.09.01',
          checksum: 'aa',
          sizeBytes: 1,
          relativePath: 'regions/guayaquil/2026.09.01/guayaquil.pmtiles',
          minZoom: 0,
          maxZoom: 14,
          downloadedAt: DateTime.utc(2026, 9, 1),
        ),
        file: File('guayaquil.pmtiles'),
      ),
    );
    expect(find.text('Mapa offline: Guayaquil'), findsOneWidget);
  });

  testWidgets('credits the sources of the map, also without connection', (tester) async {
    connectivity.status = ConnectivityStatus.offline;
    await pumpMap(tester);

    await tester.tap(find.byKey(const Key('data-sources-button')));
    await tester.pumpAndSettle();
    expect(find.text('Fuentes de datos'), findsOneWidget);
    expect(
      find.text(
        'Fuente: INSTITUTO NACIONAL DE ESTADÍSTICA Y CENSOS – INEC; Marco Geoestadístico '
        'Nacional; 2026; GeoPackage; Quito, Ecuador.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('search finds an address and makes it the destination', (tester) async {
    await pumpMap(tester);
    await tester.tap(find.byKey(const Key('search-bar')));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('search-field')), 'casino');
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Casino de Monte-Carlo'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('search-field')), findsNothing);
    expect(mapView.props!.destination, _casino);
    expect(find.text('Casino de Monte-Carlo'), findsOneWidget);
  });

  testWidgets('a trip being recorded is shown with a way to finish it', (tester) async {
    await pumpMap(
      tester,
      recording: Stream.value(
        RecordingState(
          trip: Trip(
            id: 'trip-1',
            profile: RoutingProfile.car,
            status: TripStatus.active,
            startedAt: DateTime.now().toUtc(),
            distanceMeters: 1250,
            pointCount: 12,
          ),
        ),
      ),
    );
    expect(find.textContaining('Grabando recorrido'), findsOneWidget);
    expect(find.textContaining('1,3 km'), findsOneWidget);
    expect(find.text('Finalizar'), findsOneWidget);
  });

  testWidgets('opens the offline maps screen', (tester) async {
    await pumpMap(tester);
    await tester.tap(find.byKey(const Key('offline-maps-button')));
    await tester.pumpAndSettle();
    expect(find.text('En este dispositivo'), findsOneWidget);
    expect(find.text('Disponibles para descargar'), findsOneWidget);
  });
}
