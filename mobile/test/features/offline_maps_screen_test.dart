import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/domain/entities/map_region.dart';
import 'package:maps_platform/domain/services/connectivity_service.dart';
import 'package:maps_platform/features/offline_maps/offline_maps_controller.dart';
import 'package:maps_platform/features/offline_maps/offline_maps_screen.dart';
import 'package:maps_platform/presentation/providers.dart';
import 'package:maps_platform/services/regions/region_download_service.dart';

import '../helpers/app_fakes.dart';
import '../helpers/fakes.dart';
import '../helpers/regions.dart';

void main() {
  late InMemoryRegionRepository regions;
  late ScriptedRegionDownloadService downloads;
  late FakeConnectivityService connectivity;

  final guayaquil = region(
    'guayaquil',
    name: 'Guayaquil',
    version: '2026.09.20',
    size: 185 * 1000 * 1000,
    bbox: guayaquilBox,
  );
  final quito = region('quito', name: 'Quito', size: 150 * 1000 * 1000);

  DownloadedRegion stored(
    MapRegion region, {
    String? version,
    String? latest,
    bool withPack = false,
  }) => DownloadedRegion(
    code: region.code,
    name: region.name,
    version: version ?? region.version,
    // An older version has another map.
    checksum: version == null || version == region.version ? region.checksum : 'map-$version',
    sizeBytes: region.mapSizeBytes,
    relativePath: 'regions/${region.code}/${version ?? region.version}/${region.code}.pmtiles',
    bbox: region.bbox,
    minZoom: 0,
    maxZoom: 14,
    downloadedAt: DateTime.utc(2026, 9, 1),
    latestVersion: latest ?? version ?? region.version,
    routingRelativePath: withPack
        ? 'packs/${region.code}/${region.version}/${region.code}.rmpack'
        : null,
    routingChecksum: withPack ? region.routingChecksum : null,
    routingSizeBytes: withPack ? region.routingSizeBytes : null,
  );

  RegionDownloadTask task(RegionDownloadStatus status, int received, {String? error}) =>
      RegionDownloadTask(
        code: 'guayaquil',
        name: 'Guayaquil',
        version: '2026.09.20',
        totalBytes: 185 * 1000 * 1000,
        receivedBytes: received,
        status: status,
        errorCode: error == null ? null : 'NETWORK_UNAVAILABLE',
        errorMessage: error,
      );

  setUp(() {
    regions = InMemoryRegionRepository(catalog: [guayaquil, quito]);
    downloads = ScriptedRegionDownloadService(regions);
    connectivity = FakeConnectivityService();
  });

  Future<void> pumpScreen(WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          connectivityServiceProvider.overrideWithValue(connectivity),
          regionRepositoryProvider.overrideWithValue(regions),
          regionDownloadServiceProvider.overrideWithValue(downloads),
          freeSpaceProvider.overrideWith((ref) async => 2400 * 1000 * 1000),
        ],
        child: const MaterialApp(home: OfflineMapsScreen()),
      ),
    );
    await tester.pumpAndSettle();
  }

  Finder inCard(String key, Finder finder) =>
      find.descendant(of: find.byKey(Key(key)), matching: finder);

  testWidgets('download with progress, cancel, and the region ready offline', (tester) async {
    await pumpScreen(tester);

    expect(find.text('Espacio libre: 2,4 GB'), findsOneWidget);
    expect(find.text('Todavía no descargaste ningún mapa.'), findsOneWidget);
    expect(inCard('available-guayaquil', find.text('185 MB')), findsOneWidget);
    expect(inCard('available-quito', find.text('150 MB')), findsOneWidget);

    await tester.tap(inCard('available-guayaquil', find.text('Descargar')));
    await tester.pump();
    expect(downloads.calls, ['download:guayaquil:2026.09.20']);

    downloads.setTask(task(RegionDownloadStatus.downloading, 124 * 1000 * 1000));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('task-status-guayaquil')), findsOneWidget);
    expect(find.text('67 %'), findsOneWidget);
    expect(find.text('124 MB / 185 MB'), findsOneWidget);

    await tester.tap(inCard('available-guayaquil', find.text('Cancelar')));
    await tester.pump();
    expect(downloads.calls.last, 'pause:guayaquil');

    // The download completes.
    downloads.clearTask('guayaquil');
    regions.downloaded = [stored(guayaquil)];
    downloads.pendingDownload!.complete(RegionDownloadResult.completed);
    await tester.pumpAndSettle();

    expect(find.text('Mapa de Guayaquil descargado. Ya funciona sin conexión.'), findsOneWidget);
    expect(inCard('downloaded-guayaquil', find.text('Descargado')), findsOneWidget);
    expect(
      inCard('downloaded-guayaquil', find.text('Versión 2026.09.20 · 185 MB')),
      findsOneWidget,
    );
    expect(inCard('downloaded-guayaquil', find.text('Eliminar')), findsOneWidget);
    expect(find.byKey(const Key('available-guayaquil')), findsNothing);
  });

  testWidgets('a newer version can be installed and a region deleted', (tester) async {
    regions.downloaded = [stored(guayaquil, version: '2026.08.01', latest: '2026.09.20')];
    await pumpScreen(tester);

    expect(
      inCard('downloaded-guayaquil', find.text('Versión 2026.08.01 · 185 MB')),
      findsOneWidget,
    );
    expect(find.text('Nueva versión disponible: 2026.09.20 (185 MB)'), findsOneWidget);

    await tester.tap(inCard('downloaded-guayaquil', find.text('Actualizar')));
    await tester.pump();
    expect(downloads.calls, ['download:guayaquil:2026.09.20']);

    await tester.tap(inCard('downloaded-guayaquil', find.text('Eliminar')));
    await tester.pumpAndSettle();
    expect(find.text('¿Eliminar el mapa de Guayaquil?'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Eliminar'));
    await tester.pumpAndSettle();

    expect(downloads.calls.last, 'delete:guayaquil');
    expect(find.byKey(const Key('downloaded-guayaquil')), findsNothing);
    expect(find.text('Todavía no descargaste ningún mapa.'), findsOneWidget);
  });

  testWidgets('a paused or failed download can be resumed or discarded', (tester) async {
    await pumpScreen(tester);
    downloads.setTask(task(RegionDownloadStatus.paused, 111 * 1000 * 1000));
    await tester.pumpAndSettle();
    expect(find.text('En pausa · 60 %'), findsOneWidget);

    await tester.tap(inCard('available-guayaquil', find.text('Reanudar')));
    await tester.pump();
    expect(downloads.calls.last, 'download:guayaquil:2026.09.20');

    downloads.setTask(
      task(
        RegionDownloadStatus.failed,
        111 * 1000 * 1000,
        error: 'Se perdió la conexión. La descarga continuará desde donde quedó.',
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Error · 60 %'), findsOneWidget);
    expect(
      find.text('Se perdió la conexión. La descarga continuará desde donde quedó.'),
      findsOneWidget,
    );
    expect(inCard('available-guayaquil', find.text('Reintentar')), findsOneWidget);

    await tester.tap(inCard('available-guayaquil', find.text('Descartar')));
    await tester.pumpAndSettle();
    expect(downloads.calls.last, 'discard:guayaquil');
    expect(find.byKey(const Key('task-status-guayaquil')), findsNothing);
  });

  testWidgets('without connection stored maps are listed and downloads wait', (tester) async {
    connectivity.status = ConnectivityStatus.offline;
    regions.downloaded = [stored(guayaquil)];
    await pumpScreen(tester);

    expect(
      find.text(
        'Sin conexión: tus mapas descargados siguen funcionando. Para descargar necesitas Internet.',
      ),
      findsOneWidget,
    );
    expect(inCard('downloaded-guayaquil', find.text('Descargado')), findsOneWidget);
    final download = tester.widget<FilledButton>(
      find.descendant(
        of: find.byKey(const Key('available-quito')),
        matching: find.widgetWithText(FilledButton, 'Descargar'),
      ),
    );
    expect(download.onPressed, isNull);
  });

  group('offline packs', () {
    final withPack = region(
      'guayaquil',
      name: 'Guayaquil',
      version: '2026.09.20',
      size: 185 * 1000 * 1000,
      bbox: guayaquilBox,
      packSize: 40 * 1000 * 1000,
    );

    testWidgets('a region brings its routes and search without connection', (tester) async {
      regions = InMemoryRegionRepository(catalog: [withPack, quito]);
      downloads = ScriptedRegionDownloadService(regions);
      await pumpScreen(tester);

      expect(inCard('available-guayaquil', find.text('225 MB')), findsOneWidget);
      expect(
        inCard('available-guayaquil', find.text('Incluye rutas y búsqueda sin conexión')),
        findsOneWidget,
      );
      expect(
        inCard('available-quito', find.text('Incluye rutas y búsqueda sin conexión')),
        findsNothing,
      );

      await tester.tap(inCard('available-guayaquil', find.text('Descargar')));
      await tester.pump();
      downloads.setTask(
        const RegionDownloadTask(
          code: 'guayaquil',
          name: 'Guayaquil',
          version: '2026.09.20',
          totalBytes: 225 * 1000 * 1000,
          receivedBytes: 200 * 1000 * 1000,
          status: RegionDownloadStatus.downloading,
          part: RegionDownloadPart.offlinePack,
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Rutas y búsqueda · 88 %'), findsOneWidget);
      expect(find.text('200 MB / 225 MB'), findsOneWidget);

      downloads.clearTask('guayaquil');
      regions.downloaded = [stored(withPack, withPack: true)];
      downloads.pendingDownload!.complete(RegionDownloadResult.completed);
      await tester.pumpAndSettle();
      expect(
        find.text('Listo: Guayaquil funciona sin conexión, con mapa, rutas y búsqueda.'),
        findsOneWidget,
      );
      expect(
        inCard('downloaded-guayaquil', find.text('Versión 2026.09.20 · 225 MB')),
        findsOneWidget,
      );
      expect(
        inCard('downloaded-guayaquil', find.text('Rutas y búsqueda sin conexión · 40 MB')),
        findsOneWidget,
      );
      expect(inCard('downloaded-guayaquil', find.text('Descargar rutas')), findsNothing);

      await tester.tap(inCard('downloaded-guayaquil', find.text('Eliminar')));
      await tester.pumpAndSettle();
      expect(find.textContaining('Liberarás 225 MB.'), findsOneWidget);
      expect(find.textContaining('ni tendrá rutas ni búsqueda sin conexión'), findsOneWidget);
    });

    testWidgets('a map downloaded before its pack existed can add it', (tester) async {
      regions = InMemoryRegionRepository(
        catalog: [withPack, quito],
        downloaded: [stored(withPack)],
      );
      downloads = ScriptedRegionDownloadService(regions);
      await pumpScreen(tester);

      expect(
        inCard(
          'downloaded-guayaquil',
          find.text('Rutas y búsqueda sin conexión: sin descargar (40 MB)'),
        ),
        findsOneWidget,
      );
      await tester.tap(inCard('downloaded-guayaquil', find.text('Descargar rutas')));
      await tester.pump();
      expect(downloads.calls, ['download:guayaquil:2026.09.20']);

      downloads.setTask(
        const RegionDownloadTask(
          code: 'guayaquil',
          name: 'Guayaquil',
          version: '2026.09.20',
          totalBytes: 40 * 1000 * 1000,
          receivedBytes: 10 * 1000 * 1000,
          status: RegionDownloadStatus.failed,
          part: RegionDownloadPart.offlinePack,
          errorMessage: 'El archivo de esta región no está disponible en el servidor.',
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Error · rutas y búsqueda · 25 %'), findsOneWidget);
      expect(inCard('downloaded-guayaquil', find.text('Reintentar')), findsOneWidget);
    });

    testWidgets('a newer pack is offered as an update of the routes', (tester) async {
      final newerPack = region(
        'guayaquil',
        name: 'Guayaquil',
        version: '2026.09.20',
        bbox: guayaquilBox,
        packSize: 41 * 1000 * 1000,
        packChecksum: 'qq',
      );
      regions = InMemoryRegionRepository(
        catalog: [newerPack],
        downloaded: [stored(withPack, withPack: true)],
      );
      downloads = ScriptedRegionDownloadService(regions);
      await pumpScreen(tester);

      await tester.tap(inCard('downloaded-guayaquil', find.text('Actualizar rutas')));
      await tester.pump();
      expect(downloads.calls, ['download:guayaquil:2026.09.20']);
    });

    testWidgets('a new version with the same map only counts its new pack', (tester) async {
      final older = region(
        'guayaquil',
        name: 'Guayaquil',
        bbox: guayaquilBox,
        packSize: 40 * 1000 * 1000,
      );
      final newer = region(
        'guayaquil',
        name: 'Guayaquil',
        version: '2026.09.20',
        bbox: guayaquilBox,
        packSize: 41 * 1000 * 1000,
        packChecksum: 'qq',
      );
      regions = InMemoryRegionRepository(
        catalog: [newer],
        downloaded: [stored(older, withPack: true, latest: '2026.09.20')],
      );
      downloads = ScriptedRegionDownloadService(regions);
      await pumpScreen(tester);

      expect(find.text('Nueva versión disponible: 2026.09.20 (41 MB)'), findsOneWidget);
      await tester.tap(inCard('downloaded-guayaquil', find.text('Actualizar')));
      await tester.pump();
      expect(downloads.calls, ['download:guayaquil:2026.09.20']);
    });
  });
}
