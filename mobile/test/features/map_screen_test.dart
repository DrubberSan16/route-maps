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
import 'package:maps_platform/features/map/map_screen.dart';
import 'package:maps_platform/features/map/map_view.dart';
import 'package:maps_platform/features/offline_maps/offline_maps_controller.dart';
import 'package:maps_platform/presentation/providers.dart';
import 'package:maps_platform/services/regions/region_download_service.dart';
import 'package:maps_platform/services/tracking/trip_recorder.dart';

import '../helpers/app_fakes.dart';
import '../helpers/fakes.dart';
import '../helpers/fixtures.dart';
import '../helpers/regions.dart';

const _emptyStyle = '{"version":8,"sources":{},"layers":[]}';
const _casino = Coordinate(43.7311, 7.4197);
const _home = Coordinate(43.7384, 7.4246);

void main() {
  late FakeConnectivityService connectivity;
  late FakeLocationService location;
  late InMemoryRegionRepository regions;
  late ScriptedRegionDownloadService downloads;
  late ScriptedRoutingService routing;
  late ScriptedGeocodingRepository geocoding;
  late InMemorySavedRouteRepository savedRoutes;
  late RecordingMapView mapView;

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
    mapView = RecordingMapView();
  });

  tearDown(() => mapView.dispose());

  Future<void> pumpMap(
    WidgetTester tester, {
    MapSource source = const NoMapSource(),
    Stream<RecordingState>? recording,
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
          mapStyleProvider.overrideWith((ref) async => (source: source, style: _emptyStyle)),
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

  testWidgets('shows the map with search, the three actions and the OSM credit', (tester) async {
    await pumpMap(tester);

    expect(find.byKey(const Key('fake-map')), findsOneWidget);
    expect(find.text('Buscar destino...'), findsOneWidget);
    expect(find.text('📍 Mi ubicación'), findsOneWidget);
    expect(find.text('🗺 Trazar ruta'), findsOneWidget);
    expect(find.text('📥 Mapas offline'), findsOneWidget);
    expect(find.text('© OpenStreetMap contributors'), findsOneWidget);
    expect(find.text('Sin mapa base: descarga una región'), findsOneWidget);
    // Opens where the user was last seen.
    expect(mapView.props!.initialCenter, _home);
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
