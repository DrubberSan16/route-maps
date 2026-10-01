import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/core/errors/app_exception.dart';
import 'package:maps_platform/domain/entities/coordinate.dart';
import 'package:maps_platform/domain/services/connectivity_service.dart';
import 'package:maps_platform/features/map/map_layers_controller.dart';
import 'package:maps_platform/presentation/providers.dart';
import 'package:maps_platform/services/map/map_style_service.dart';

import '../helpers/fakes.dart';

/// Central Guayaquil at street level, and the whole country.
const _city = BoundingBox(west: -79.9234, south: -2.2345, east: -79.8812, north: -2.1501);
const _country = BoundingBox(west: -81.1, south: -5.1, east: -75.2, north: 1.5);

Map<String, Object?> _flow(List<String> sources) => {
  'type': 'FeatureCollection',
  'windowMinutes': 15,
  'features': [
    for (final source in sources)
      {
        'type': 'Feature',
        'geometry': {
          'type': 'LineString',
          'coordinates': [
            [-79.90, -2.19],
            [-79.89, -2.18],
          ],
        },
        'properties': {'status': 'slow', 'source': source},
      },
  ],
};

void main() {
  group('MapLayers', () {
    test('reads what was stored and falls back to the plain map', () {
      expect(MapLayers.parse(null), const MapLayers());
      expect(MapLayers.parse('not json'), const MapLayers());
      expect(MapLayers.parse('[1, 2]'), const MapLayers());
      expect(
        MapLayers.parse('{"mapType":"satellite","traffic":true,"overlays":["population","x"]}'),
        const MapLayers(mapType: 'satellite', traffic: true, overlays: {'population'}),
      );
    });

    test('is stored as it is read back', () {
      const layers = MapLayers(
        mapType: MapTypeOption.relief,
        traffic: true,
        overlays: {MapOverlays.temperature, MapOverlays.precipitation},
      );
      expect(MapLayers.parse(layers.toJson()), layers);
    });
  });

  group('MapLayersController', () {
    test('remembers the map type and layers on the device', () async {
      final settings = InMemorySettingsRepository();
      final container = ProviderContainer(
        overrides: [settingsRepositoryProvider.overrideWithValue(settings)],
      );
      addTearDown(container.dispose);

      final controller = container.read(mapLayersProvider.notifier);
      expect(await container.read(mapLayersProvider.future), const MapLayers());
      await controller.setMapType(MapTypeOption.satellite);
      await controller.setTraffic(true);
      await controller.setOverlay(MapOverlays.population, true);
      await controller.setOverlay(MapOverlays.temperature, true);
      await controller.setOverlay(MapOverlays.temperature, false);

      const expected = MapLayers(
        mapType: MapTypeOption.satellite,
        traffic: true,
        overlays: {MapOverlays.population},
      );
      expect(container.read(mapLayersProvider).value, expected);

      final reopened = ProviderContainer(
        overrides: [settingsRepositoryProvider.overrideWithValue(settings)],
      );
      addTearDown(reopened.dispose);
      expect(await reopened.read(mapLayersProvider.future), expected);
    });
  });

  group('TrafficController', () {
    late FakeConnectivityService connectivity;
    late List<String> requests;
    late Object? Function(String bbox) answer;
    late ProviderContainer container;

    setUp(() {
      connectivity = FakeConnectivityService();
      requests = [];
      answer = (_) => _flow(['live', 'live', 'typical']);
      container = ProviderContainer(
        overrides: [
          connectivityServiceProvider.overrideWithValue(connectivity),
          settingsRepositoryProvider.overrideWithValue(
            InMemorySettingsRepository({'map.layers': '{"traffic":true}'}),
          ),
          trafficFlowReaderProvider.overrideWithValue((bbox) async {
            requests.add(bbox);
            final result = answer(bbox);
            if (result is AppException) throw result;
            return result! as Map<String, Object?>;
          }),
        ],
      );
      addTearDown(container.dispose);
    });

    /// Lets the stored choice load, then waits for pending requests.
    Future<TrafficState> settle() async {
      for (var i = 0; i < 5; i++) {
        await Future<void>.delayed(Duration.zero);
      }
      return container.read(trafficProvider);
    }

    Future<TrafficState> start() async {
      container.listen(connectivityStatusProvider, (_, _) {});
      container.listen(trafficProvider, (_, _) {});
      await container.read(mapLayersProvider.future);
      return settle();
    }

    test('nothing is drawn or asked for while the layer is off', () async {
      final off = ProviderContainer(
        overrides: [
          settingsRepositoryProvider.overrideWithValue(InMemorySettingsRepository()),
          trafficFlowReaderProvider.overrideWithValue((bbox) async {
            requests.add(bbox);
            return _flow([]);
          }),
        ],
      );
      addTearDown(off.dispose);
      off.listen(trafficProvider, (_, _) {});
      await off.read(mapLayersProvider.future);
      off.read(trafficProvider.notifier).onViewChanged(_city, 14);
      await Future<void>.delayed(Duration.zero);

      expect(off.read(trafficProvider).visible, isFalse);
      expect(requests, isEmpty);
    });

    test('a city view shows the measured segments of the area', () async {
      expect((await start()).status, 'Cargando el tráfico…');

      container.read(trafficProvider.notifier).onViewChanged(_city, 14);
      final state = await settle();

      expect(requests, ['-79.93,-2.24,-79.88,-2.15']);
      expect(state.visible, isTrue);
      expect(state.flow!['features'], hasLength(3));
      expect(
        state.status,
        'Tramos medidos: 2 en vivo (últimos 15 min) y 1 con lo habitual a esta hora (más '
        'tenues). El resto de vías en verde no tiene demoras reportadas.',
      );

      // Small moves inside the same grid cell reuse the answer.
      container
          .read(trafficProvider.notifier)
          .onViewChanged(
            const BoundingBox(west: -79.9201, south: -2.2302, east: -79.8851, north: -2.1599),
            14.2,
          );
      await settle();
      expect(requests, hasLength(1));
    });

    test('far away only the main roads are drawn, without asking', () async {
      await start();
      container.read(trafficProvider.notifier).onViewChanged(_city, 8);
      expect((await settle()).status, TrafficController.farMessage);
      container.read(trafficProvider.notifier).onViewChanged(_country, 12);
      final state = await settle();
      expect(state.status, TrafficController.farMessage);
      expect(state.flow, isNull);
      expect(requests, isEmpty);
    });

    test('offline it says so, and asks again when the connection is back', () async {
      connectivity.status = ConnectivityStatus.offline;
      await start();
      container.read(trafficProvider.notifier).onViewChanged(_city, 14);
      expect((await settle()).status, TrafficController.offlineMessage);
      expect(requests, isEmpty);

      connectivity.status = ConnectivityStatus.online;
      final state = await settle();
      expect(requests, hasLength(1));
      expect(state.flow, isNotNull);
    });

    test('a failed request keeps what was drawn and explains why', () async {
      await start();
      container.read(trafficProvider.notifier).onViewChanged(_city, 14);
      await settle();
      final drawn = container.read(trafficProvider).flow;

      answer = (_) => AppException.of(ErrorCodes.networkUnavailable);
      container.read(trafficProvider.notifier).onViewChanged(_country.copyWithCenter(), 14);
      final state = await settle();
      expect(state.flow, same(drawn));
      expect(state.status, AppException.of(ErrorCodes.networkUnavailable).message);
    });

    test('an area without trips says the green roads have no reported delays', () {
      expect(
        TrafficController.describeFlow(_flow([])),
        'Sin recorridos recientes ni habituales en esta zona: las vías en verde no tienen '
        'demoras reportadas.',
      );
      expect(
        TrafficController.describeFlow(_flow(['live'])),
        'Tramos medidos: 1 en vivo (últimos 15 min). El resto de vías en verde no tiene demoras '
        'reportadas.',
      );
    });

    test('views are rounded outward to a 0.01 degree grid', () {
      expect(TrafficController.gridBox(_city), '-79.93,-2.24,-79.88,-2.15');
      expect(
        TrafficController.gridBox(
          const BoundingBox(west: 7.40, south: 43.72, east: 7.44, north: 43.75),
        ),
        '7.40,43.72,7.44,43.75',
      );
    });
  });
}

extension on BoundingBox {
  /// A city-sized box around the centre of this one.
  BoundingBox copyWithCenter() {
    final lng = (west + east) / 2;
    final lat = (south + north) / 2;
    return BoundingBox(west: lng - 0.02, south: lat - 0.02, east: lng + 0.02, north: lat + 0.02);
  }
}
