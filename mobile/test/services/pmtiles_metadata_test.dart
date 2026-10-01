import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/services/map/pmtiles_metadata.dart';

import '../helpers/pmtiles.dart';

void main() {
  late Directory root;

  setUp(() async => root = await Directory.systemTemp.createTemp('pmtiles'));
  tearDown(() => root.delete(recursive: true));

  test('reads the vector layers from the gzipped metadata Planetiler writes', () async {
    final file = await writePmtiles(
      File('${root.path}/guayaquil.pmtiles'),
      vectorLayers: ['transportation', 'population', 'climate'],
    );
    expect(await pmtilesVectorLayers(file), {'transportation', 'population', 'climate'});
  });

  test('reads uncompressed metadata too', () async {
    final file = await writePmtiles(
      File('${root.path}/plain.pmtiles'),
      vectorLayers: ['transportation'],
      compressed: false,
    );
    expect(await pmtilesVectorLayers(file), {'transportation'});
  });

  test('is null for a file that is not a PMTiles archive or is missing', () async {
    final text = File('${root.path}/notes.txt')..writeAsStringSync('not a map');
    expect(await pmtilesVectorLayers(text), isNull);
    expect(await pmtilesVectorLayers(File('${root.path}/missing.pmtiles')), isNull);
  });
}
