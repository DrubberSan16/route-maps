import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

/// Writes the header and JSON metadata of a PMTiles v3 archive (without
/// tiles) whose vector layers are [vectorLayers]; the metadata is gzipped as
/// Planetiler writes it unless [compressed] is false.
Future<File> writePmtiles(
  File file, {
  required List<String> vectorLayers,
  bool compressed = true,
}) async {
  final json = utf8.encode(
    jsonEncode({
      'name': 'test',
      'vector_layers': [
        for (final id in vectorLayers) {'id': id, 'fields': <String, Object?>{}},
      ],
    }),
  );
  final metadata = compressed ? gzip.encode(json) : json;
  final header = ByteData(127);
  for (final (index, byte) in ascii.encode('PMTiles').indexed) {
    header.setUint8(index, byte);
  }
  header
    ..setUint8(7, 3)
    ..setUint64(8, 127, Endian.little) // empty root directory
    ..setUint64(24, 127, Endian.little) // metadata right after the header
    ..setUint64(32, metadata.length, Endian.little)
    ..setUint8(97, compressed ? 2 : 1);
  await file.parent.create(recursive: true);
  await file.writeAsBytes([...header.buffer.asUint8List(), ...metadata]);
  return file;
}
