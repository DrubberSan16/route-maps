import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/domain/entities/map_region.dart';
import 'package:maps_platform/domain/repositories/map_repository.dart';
import 'package:maps_platform/domain/services/offline_storage_service.dart';
import 'package:maps_platform/services/map/map_style_service.dart';

import '../helpers/database.dart';
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

  test('a downloaded region is read from its local PMTiles file', () async {
    final file = File('${root.path}/offline/regions/guayaquil/2026.09.20/guayaquil.pmtiles');
    final style = decode(
      await styles.styleFor(
        LocalMapSource(
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
        ),
      ),
    );
    expect(basemap(style)['url'], 'pmtiles://${Uri.file(file.path)}');
    expect(basemap(style)['attribution'], contains('© OpenStreetMap contributors'));
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
  });

  test('without map data only the background remains', () async {
    final style = decode(await styles.styleFor(const NoMapSource()));
    expect((style['sources']! as Map).containsKey('basemap'), isFalse);
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
