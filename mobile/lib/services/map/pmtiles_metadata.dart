import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

/// Ids of the vector layers of a PMTiles v3 archive (`vector_layers` in its
/// JSON metadata), or null when the file is not one or its metadata cannot be
/// read. Only the 127-byte header and the metadata are read.
Future<Set<String>?> pmtilesVectorLayers(File file) async {
  RandomAccessFile? handle;
  try {
    handle = await file.open();
    final header = await handle.read(_headerLength);
    if (header.length < _headerLength || !_isVersion3(header)) return null;
    final fields = ByteData.sublistView(header);
    final offset = fields.getUint64(24, Endian.little);
    final length = fields.getUint64(32, Endian.little);
    if (length == 0 || length > _maxMetadataBytes) return null;
    await handle.setPosition(offset);
    final stored = await handle.read(length);
    if (stored.length != length) return null;
    final json = switch (header[_internalCompression]) {
      _uncompressed => stored,
      _gzip => gzip.decode(stored),
      _ => null, // brotli or zstd: the platform's tools write gzip
    };
    if (json == null) return null;
    final metadata = jsonDecode(utf8.decode(json));
    final layers = metadata is Map<String, Object?> ? metadata['vector_layers'] : null;
    if (layers is! List<Object?>) return null;
    return {
      for (final layer in layers)
        if (layer case {'id': final String id}) id,
    };
  } on Object {
    // Unreadable file or metadata: unknown.
    return null;
  } finally {
    await handle?.close();
  }
}

const _headerLength = 127;
const _internalCompression = 97;
const _uncompressed = 1;
const _gzip = 2;

/// Planetiler writes a few kilobytes; anything far bigger is not a map's.
const _maxMetadataBytes = 8 * 1024 * 1024;

bool _isVersion3(Uint8List header) =>
    ascii.decode(header.sublist(0, 7), allowInvalid: true) == 'PMTiles' && header[7] == 3;
