import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/domain/entities/map_region.dart';
import 'package:maps_platform/domain/repositories/map_repository.dart';
import 'package:maps_platform/domain/services/offline_storage_service.dart';
import 'package:maps_platform/services/map/map_style_service.dart';

import '../helpers/database.dart';
import '../helpers/pmtiles.dart';
import '../helpers/regions.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late OfflineStorageService storage;
  late Directory root;
  late MapStyleService styles;

  setUp(() async {
    (:storage, :root) = await temporaryStorage();
    styles = MapStyleService(storage: storage);
  });

  tearDown(() => root.delete(recursive: true));

  Map<String, Object?> decode(String style) => jsonDecode(style) as Map<String, Object?>;

  Map<String, Object?> basemap(Map<String, Object?> style) =>
      (style['sources']! as Map<String, Object?>)['basemap']! as Map<String, Object?>;

  LocalMapSource downloaded(File file) => LocalMapSource(
    region: DownloadedRegion(
      code: 'guayaquil',
      name: 'Guayaquil',
      version: '2026.09.20',
      checksum: 'aa',
      sizeBytes: 1,
      relativePath: 'regions/guayaquil/2026.09.20/guayaquil.pmtiles',
      minZoom: 0,
      maxZoom: 14,
      downloadedAt: DateTime.utc(2026, 9, 20),
    ),
    file: file,
  );

  test('a downloaded region is read from its local PMTiles file', () async {
    final file = File('${root.path}/offline/regions/guayaquil/2026.09.20/guayaquil.pmtiles');
    final style = decode(await styles.styleFor(downloaded(file)));
    expect(basemap(style)['url'], 'pmtiles://${Uri.file(file.path)}');
    expect(basemap(style)['attribution'], isEmpty);
  });

  test('online the platform PMTiles are read with range requests', () async {
    final style = decode(
      await styles.styleFor(
        RemoteMapSource(
          region: region('guayaquil'),
          url: Uri.parse('https://maps.example.com/maps/ec/guayaquil.pmtiles'),
        ),
      ),
    );
    expect(basemap(style)['url'], 'pmtiles://https://maps.example.com/maps/ec/guayaquil.pmtiles');
    // The overlays (climate, population) come from the same archive: no placeholder is left.
    final overlays =
        (style['sources']! as Map<String, Object?>)['overlays']! as Map<String, Object?>;
    expect(overlays['url'], basemap(style)['url']);
    expect(jsonEncode(style['sources']), isNot(contains('__')));
  });

  group('map types', () {
    final satellite = Uri.parse('https://maps.example.com/maps/ec/guayaquil.satellite.pmtiles');
    final terrain = Uri.parse('https://maps.example.com/maps/ec/guayaquil.terrain.pmtiles');
    final online = RemoteMapSource(
      region: region('guayaquil'),
      url: Uri.parse('https://maps.example.com/maps/ec/guayaquil.pmtiles'),
      assets: {
        'satellite': [satellite],
        'terrain': [terrain],
      },
    );

    List<String> ids(Map<String, Object?> style) => [
      for (final layer in style['layers']! as List<Object?>) (layer! as Map)['id']! as String,
    ];

    Map<String, Object?> layer(Map<String, Object?> style, String id) =>
        (style['layers']! as List<Object?>).cast<Map<String, Object?>>().firstWhere(
          (layer) => layer['id'] == id,
        );

    test('are offered where the map has their imagery or elevation', () async {
      final options = await styles.mapTypes(online);
      expect(
        [for (final option in options) (option.id, option.label, option.available)],
        [('map', 'Mapa', true), ('satellite', 'Satélite', true), ('relief', 'Relieve', true)],
      );

      final plain = await styles.mapTypes(
        RemoteMapSource(region: region('guayaquil'), url: online.url),
      );
      expect([for (final option in plain) option.available], [true, false, false]);
      expect(
        [for (final option in await styles.mapTypes(const NoMapSource())) option.available],
        [true, false, false],
      );
    });

    test('satellite puts the imagery under the roads and labels', () async {
      final style = decode(await styles.styleFor(online, mapType: MapTypeOption.satellite));
      final source = (style['sources']! as Map<String, Object?>)['satellite']! as Map;
      expect(source['type'], 'raster');
      expect(source['url'], 'pmtiles://$satellite');
      expect(source['attribution'], contains('ESA WorldCover'));

      final order = ids(style);
      expect(order.indexOf('satellite'), order.indexOf('road-path') - 1);
      expect(layer(style, 'satellite')['source'], 'satellite');
      expect(layer(style, 'satellite').containsKey('before'), isFalse);
      // The paths and casings drawn for the plain map are hidden; labels turn white.
      expect((layer(style, 'road-casing')['layout']! as Map)['visibility'], 'none');
      expect((layer(style, 'road-label')['paint']! as Map)['text-color'], '#ffffff');
      expect((layer(style, 'road')['layout'] as Map?)?['visibility'], isNot('none'));
    });

    test('relief colours the land by elevation and shades the slopes', () async {
      final style = decode(await styles.styleFor(online, mapType: MapTypeOption.relief));
      final source = (style['sources']! as Map<String, Object?>)['terrain']! as Map;
      expect(source['type'], 'raster-dem');
      expect(source['encoding'], 'terrarium');
      expect(source['url'], 'pmtiles://$terrain');

      final order = ids(style);
      expect(order.indexOf('relief-color'), order.indexOf('landuse-urban') - 1);
      expect(order.indexOf('hillshade'), order.indexOf('road-path') - 1);
      expect(layer(style, 'hillshade')['type'], 'hillshade');
      expect((layer(style, 'hillshade')['paint']! as Map)['hillshade-method'], 'igor');
      expect((layer(style, 'landuse-natural')['layout']! as Map)['visibility'], 'none');
    });

    test('the imagery of every region over the map is drawn, the most detailed on top', () async {
      final country = Uri.parse('https://maps.example.com/maps/ec/ecuador.satellite.pmtiles');
      final style = decode(
        await styles.styleFor(
          RemoteMapSource(
            region: region('ecuador'),
            url: Uri.parse('https://maps.example.com/maps/ec/ecuador.pmtiles'),
            assets: {
              'satellite': [country, satellite],
            },
          ),
          mapType: MapTypeOption.satellite,
        ),
      );
      final sources = style['sources']! as Map<String, Object?>;
      expect((sources['satellite']! as Map)['url'], 'pmtiles://$country');
      expect((sources['satellite-2']! as Map)['url'], 'pmtiles://$satellite');

      final order = ids(style);
      final roads = order.indexOf('road-path');
      expect(order.sublist(roads - 2, roads), ['satellite', 'satellite-2']);
      expect(layer(style, 'satellite-2')['source'], 'satellite-2');
      expect(layer(style, 'satellite-2')['type'], 'raster');
    });

    test('without the imagery the plain map is drawn', () async {
      final style = decode(
        await styles.styleFor(
          RemoteMapSource(region: region('guayaquil'), url: online.url),
          mapType: MapTypeOption.satellite,
        ),
      );
      expect((style['sources']! as Map).containsKey('satellite'), isFalse);
      expect(ids(style), isNot(contains('satellite')));
      expect((layer(style, 'road-casing')['layout'] as Map?)?['visibility'], isNot('none'));
    });
  });

  test('the overlays are read from their own archive when the region has one', () async {
    final overlays = Uri.parse('https://maps.example.com/maps/ec/guayaquil.overlays.pmtiles');
    final style = decode(
      await styles.styleFor(
        RemoteMapSource(
          region: region('guayaquil'),
          url: Uri.parse('https://maps.example.com/maps/ec/guayaquil.pmtiles'),
          assets: {
            'overlays': [overlays],
          },
        ),
      ),
    );
    final source = (style['sources']! as Map<String, Object?>)['overlays']! as Map;
    expect(source['url'], 'pmtiles://$overlays');
  });

  group('overlays (climate, population)', () {
    final online = Uri.parse('https://maps.example.com/maps/ec/guayaquil.pmtiles');

    test('the platform has them in their own archive or inside the map', () async {
      final withArchive = RemoteMapSource(
        region: region('guayaquil'),
        url: online,
        assets: {
          'overlays': [Uri.parse('https://maps.example.com/maps/ec/guayaquil.overlays.pmtiles')],
        },
      );
      expect(await styles.overlaysAvailable(withArchive), isTrue);
      // A map built before the overlays had their own archive.
      expect(
        await styles.overlaysAvailable(RemoteMapSource(region: region('guayaquil'), url: online)),
        isTrue,
      );
      // The world overview has none.
      expect(
        await styles.overlaysAvailable(
          RemoteMapSource(region: region('world', maxZoom: 7), url: online),
        ),
        isFalse,
      );
      expect(await styles.overlaysAvailable(const NoMapSource()), isFalse);
    });

    test('a downloaded map only has them if it was built with them inside', () async {
      final old = await writePmtiles(
        File('${root.path}/old.pmtiles'),
        vectorLayers: ['transportation', 'population', 'climate'],
      );
      final current = await writePmtiles(
        File('${root.path}/current.pmtiles'),
        vectorLayers: ['transportation', 'building'],
      );
      expect(await styles.overlaysAvailable(downloaded(old)), isTrue);
      expect(await styles.overlaysAvailable(downloaded(current)), isFalse);
      // Unreadable metadata: still offered.
      final broken = File('${root.path}/broken.pmtiles')..writeAsStringSync('?');
      expect(await styles.overlaysAvailable(downloaded(broken)), isTrue);
    });
  });

  test('the measured traffic has its hidden layers under the labels', () async {
    final raw = await styles.styleFor(
      RemoteMapSource(
        region: region('guayaquil'),
        url: Uri.parse('https://maps.example.com/maps/ec/guayaquil.pmtiles'),
      ),
    );
    final style = decode(raw);
    final traffic =
        (style['sources']! as Map<String, Object?>)[MapStyleService.trafficSource]! as Map;
    expect(traffic['type'], 'geojson');
    expect((traffic['data']! as Map)['features'], isEmpty);

    final layers = (style['layers']! as List<Object?>).cast<Map<String, Object?>>();
    final flow = layers.indexWhere((layer) => layer['id'] == 'traffic-flow');
    final casing = layers.indexWhere((layer) => layer['id'] == 'traffic-flow-casing');
    final labels = layers.indexWhere((layer) => layer['type'] == 'symbol');
    expect(casing, flow - 1);
    expect(flow, lessThan(labels));
    for (final index in [casing, flow]) {
      expect(layers[index]['source'], MapStyleService.trafficSource);
      expect((layers[index]['layout']! as Map)['visibility'], 'none');
    }

    // What the map view shows and hides without reloading the style.
    final parsed = MapStyleLayers.of(raw);
    expect(parsed.traffic, ['traffic-network', 'traffic-flow-casing', 'traffic-flow']);
    expect(parsed.overlays, {
      'precipitation': ['overlay-precipitation'],
      'temperature': ['overlay-temperature'],
      'population': ['overlay-population'],
    });
    expect(parsed.poiColors['restaurant'], '#e8710a');
    expect(parsed.firstSymbol, layers[labels]['id']);
  });

  test('without map data only the background remains', () async {
    final style = decode(await styles.styleFor(const NoMapSource()));
    expect((style['sources']! as Map).keys, isEmpty);
    final layers = style['layers']! as List<Object?>;
    expect(layers.map((layer) => (layer! as Map)['id']), ['background']);
  });

  test('label glyphs are installed on the device so they work offline', () async {
    final style = decode(await styles.styleFor(const NoMapSource()));
    final glyphs = style['glyphs']! as String;
    expect(glyphs, startsWith('file://'));
    expect(glyphs, endsWith('{fontstack}/{range}.pbf'));

    final directory = await storage.glyphsDirectory();
    final regular = File('${directory.path}/Noto Sans Regular/0-255.pbf');
    expect(await regular.exists(), isTrue);
    expect(await regular.length(), greaterThan(1000));
    // Every font stack used by the style is installed.
    final stacks = <String>{
      for (final layer in style['layers']! as List<Object?>)
        if (((layer! as Map)['layout'] as Map?)?['text-font'] case final List<Object?> fonts)
          ...fonts.cast<String>(),
    };
    for (final stack in stacks) {
      expect(await Directory('${directory.path}/$stack').exists(), isTrue, reason: stack);
    }
  });
}
