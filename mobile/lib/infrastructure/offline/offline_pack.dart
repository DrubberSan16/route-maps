import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'offline_geocoder.dart';
import 'place_index.dart';
import 'road_graph.dart';
import 'road_router.dart';

/// The offline pack of a region (infrastructure/data-tools/lib/mapsdata/offline_pack.py):
///
///   "RMPACK01" | uint32 LE header length | JSON header (padded to 8 bytes) | sections
///
/// with the road network of the region and its search index, clipped to the region plus a
/// margin (`coverage`). Only the header is read when the pack is opened; each section is read
/// the first time it is needed, so a search does not load the road network and vice versa.
class OfflinePack {
  OfflinePack._(this.path, this.header, this._dataOffset, this._sections, this.coverage);

  /// Opens the pack at [path] (reads its header).
  factory OfflinePack.open(String path) {
    final file = File(path).openSync();
    try {
      final head = _readExactly(file, 12);
      if (latin1.decode(head.sublist(0, 8)) != _magic) {
        throw FormatException('$path is not an offline pack');
      }
      final length = ByteData.sublistView(head).getUint32(8, Endian.little);
      final header = jsonDecode(utf8.decode(_readExactly(file, length))) as Map<String, Object?>;
      if (header['format'] != 'route-maps-offline-pack' || header['version'] != 1) {
        throw FormatException(
          'Unsupported offline pack format ${header['format']} v${header['version']}',
        );
      }
      final sections = <String, ({int offset, int length})>{};
      for (final item in (header['sections'] as List<Object?>?) ?? const <Object?>[]) {
        final section = item! as Map<String, Object?>;
        sections[section['name']! as String] = (
          offset: (section['offset']! as num).toInt(),
          length: (section['length']! as num).toInt(),
        );
      }
      final coverage = [
        for (final value in header['coverage']! as List<Object?>) (value! as num).toDouble(),
      ];
      if (coverage.length != 4) throw const FormatException('Invalid coverage of offline pack');
      return OfflinePack._(path, header, (12 + length + 7) ~/ 8 * 8, sections, coverage);
    } finally {
      file.closeSync();
    }
  }

  static const _magic = 'RMPACK01';

  final String path;
  final Map<String, Object?> header;
  final int _dataOffset;
  final Map<String, ({int offset, int length})> _sections;

  /// Area with data: [minLng, minLat, maxLng, maxLat] of the region plus the margin.
  final List<double> coverage;

  late final RoadGraph graph = RoadGraph.parse(_read('graph'));
  late final PlaceIndex places = PlaceIndex.parse(_read('search'));
  late final RoadRouter router = RoadRouter(graph);
  late final OfflineGeocoder geocoder = OfflineGeocoder(places, graph);

  String get region => (header['region'] as String?) ?? '';

  /// Size of the coverage, in square degrees (to prefer the smallest pack that covers a trip).
  double get area => (coverage[2] - coverage[0]) * (coverage[3] - coverage[1]);

  bool covers(double longitude, double latitude) =>
      longitude >= coverage[0] &&
      longitude <= coverage[2] &&
      latitude >= coverage[1] &&
      latitude <= coverage[3];

  /// Whether the coverage of [other] is inside this one.
  bool contains(OfflinePack other) =>
      other.coverage[0] >= coverage[0] &&
      other.coverage[1] >= coverage[1] &&
      other.coverage[2] <= coverage[2] &&
      other.coverage[3] <= coverage[3];

  Uint8List _read(String name) {
    final section = _sections[name];
    if (section == null) throw FormatException('The offline pack has no $name section');
    final file = File(path).openSync();
    try {
      file.setPositionSync(_dataOffset + section.offset);
      return _readExactly(file, section.length);
    } finally {
      file.closeSync();
    }
  }

  static Uint8List _readExactly(RandomAccessFile file, int length) {
    final bytes = Uint8List(length);
    var read = 0;
    while (read < length) {
      final count = file.readIntoSync(bytes, read);
      if (count <= 0) throw const FormatException('Truncated offline pack');
      read += count;
    }
    return bytes;
  }
}
