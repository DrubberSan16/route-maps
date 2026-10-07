import 'dart:convert';
import 'dart:typed_data';

/// Reader of the binary files of the data pipeline (graph.bin, offline packs and their search
/// index): an 8-byte magic, a uint32 LE header length, a JSON header padded with spaces to 8
/// bytes, and little-endian typed sections, each 8-byte aligned at `dataOffset + offset`.
///
/// Sections are views on the bytes, without copies, when they are aligned (always, for files
/// read whole) and the device is little-endian (every Android and iOS device).
class BinaryFile {
  BinaryFile._(this._bytes, this.header, this._dataOffset, this._sections);

  factory BinaryFile.parse(Uint8List bytes, {required String magic}) {
    if (bytes.length < 12 || latin1.decode(bytes.sublist(0, 8)) != magic) {
      throw FormatException('Not a $magic file');
    }
    final headerLength = ByteData.sublistView(bytes, 8, 12).getUint32(0, Endian.little);
    if (12 + headerLength > bytes.length) throw FormatException('Truncated $magic header');
    final header =
        jsonDecode(utf8.decode(bytes.sublist(12, 12 + headerLength))) as Map<String, Object?>;
    final sections = <String, ({String type, int offset, int length})>{};
    for (final item in (header['sections'] as List<Object?>?) ?? const []) {
      final section = item! as Map<String, Object?>;
      sections[section['name']! as String] = (
        type: section['type']! as String,
        offset: (section['offset']! as num).toInt(),
        length: (section['length']! as num).toInt(),
      );
    }
    final dataOffset = (12 + headerLength + 7) ~/ 8 * 8;
    return BinaryFile._(bytes, header, dataOffset, sections);
  }

  final Uint8List _bytes;
  final Map<String, Object?> header;
  final int _dataOffset;
  final Map<String, ({String type, int offset, int length})> _sections;

  bool has(String name) => _sections.containsKey(name);

  Uint8List uint8(String name) {
    final (:start, :length) = _locate(name, 'uint8', 1);
    return Uint8List.sublistView(_bytes, start, start + length);
  }

  Uint16List uint16(String name) => _typed(
    name,
    'uint16',
    2,
    (buffer, offset, length) => buffer.asUint16List(offset, length),
    (view, length) => Uint16List.fromList([
      for (var i = 0; i < length; i += 1) view.getUint16(i * 2, Endian.little),
    ]),
  );

  Int32List int32(String name) => _typed(
    name,
    'int32',
    4,
    (buffer, offset, length) => buffer.asInt32List(offset, length),
    (view, length) => Int32List.fromList([
      for (var i = 0; i < length; i += 1) view.getInt32(i * 4, Endian.little),
    ]),
  );

  Uint32List uint32(String name) => _typed(
    name,
    'uint32',
    4,
    (buffer, offset, length) => buffer.asUint32List(offset, length),
    (view, length) => Uint32List.fromList([
      for (var i = 0; i < length; i += 1) view.getUint32(i * 4, Endian.little),
    ]),
  );

  Float32List float32(String name) => _typed(
    name,
    'float32',
    4,
    (buffer, offset, length) => buffer.asFloat32List(offset, length),
    (view, length) => Float32List.fromList([
      for (var i = 0; i < length; i += 1) view.getFloat32(i * 4, Endian.little),
    ]),
  );

  Float64List float64(String name) => _typed(
    name,
    'float64',
    8,
    (buffer, offset, length) => buffer.asFloat64List(offset, length),
    (view, length) => Float64List.fromList([
      for (var i = 0; i < length; i += 1) view.getFloat64(i * 8, Endian.little),
    ]),
  );

  /// UTF-8 strings stored as `<name>_off` (uint32 offsets, one more than strings) and `<name>`.
  Strings strings(String name) => Strings(uint32('${name}_off'), uint8(name));

  /// Absolute start (in bytes) and number of values of a section.
  ({int start, int length}) _locate(String name, String type, int size) {
    final section = _sections[name];
    if (section == null) throw FormatException('Missing section $name');
    if (section.type != type) throw FormatException('Section $name is ${section.type}, not $type');
    final start = _dataOffset + section.offset;
    if (start + section.length * size > _bytes.length) {
      throw FormatException('Truncated section $name');
    }
    return (start: start, length: section.length);
  }

  T _typed<T>(
    String name,
    String type,
    int size,
    T Function(ByteBuffer buffer, int offset, int length) view,
    T Function(ByteData data, int length) copy,
  ) {
    final (:start, :length) = _locate(name, type, size);
    final absolute = _bytes.offsetInBytes + start;
    if (Endian.host == Endian.little && absolute % size == 0) {
      return view(_bytes.buffer, absolute, length);
    }
    return copy(ByteData.sublistView(_bytes, start, start + length * size), length);
  }
}

/// A table of UTF-8 strings, decoded on demand.
class Strings {
  Strings(this._offsets, this._bytes);

  final Uint32List _offsets;
  final Uint8List _bytes;

  int get length => _offsets.length - 1;

  String operator [](int index) => utf8.decode(
    Uint8List.sublistView(_bytes, _offsets[index], _offsets[index + 1]),
    allowMalformed: true,
  );

  List<String> toList() => [for (var index = 0; index < length; index += 1) this[index]];
}
