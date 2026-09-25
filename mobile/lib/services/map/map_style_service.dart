import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;

import '../../domain/repositories/map_repository.dart';
import '../../domain/services/offline_storage_service.dart';

/// Builds the MapLibre style for a [MapSource] from the bundled template
/// (`assets/map/style.json`, the same style the platform serves):
///
/// * the `basemap` source points to the local PMTiles file
///   (`pmtiles://file:///…`) or to the server's (`pmtiles://https://…`);
/// * label glyphs are always read from files on the device, so text renders
///   without connection;
/// * with no map data only the background is kept (routes and markers are
///   still drawn on top).
class MapStyleService {
  MapStyleService({
    required this._storage,
    AssetBundle? bundle,
    this.styleAsset = 'assets/map/style.json',
    this.fontsAssetDirectory = 'assets/fonts/',
  }) : _bundle = bundle ?? rootBundle;

  final OfflineStorageService _storage;
  final AssetBundle _bundle;
  final String styleAsset;
  final String fontsAssetDirectory;

  static const _basemap = 'basemap';

  Future<Uri>? _glyphs;
  Map<String, Object?>? _template;

  /// Style JSON for [source].
  Future<String> styleFor(MapSource source) async {
    final style = jsonDecode(jsonEncode(await _loadTemplate())) as Map<String, Object?>;
    final sources = style['sources']! as Map<String, Object?>;
    final basemap = sources[_basemap]! as Map<String, Object?>;
    switch (source) {
      case LocalMapSource(:final file):
        basemap['url'] = 'pmtiles://${Uri.file(file.path)}';
      case RemoteMapSource(:final url):
        basemap['url'] = 'pmtiles://$url';
      case NoMapSource():
        sources.remove(_basemap);
        (style['layers']! as List<Object?>).removeWhere(
          (layer) => (layer! as Map<String, Object?>)['source'] == _basemap,
        );
    }
    style['glyphs'] = '${await glyphsBaseUri()}{fontstack}/{range}.pbf';
    return jsonEncode(style);
  }

  /// Directory (as a `file://` URI ending in `/`) holding the glyphs, copied
  /// from the app bundle the first time.
  Future<Uri> glyphsBaseUri() async {
    final pending = _glyphs ??= _installGlyphs();
    try {
      return await pending;
    } on Object {
      // Not cached: the next style load tries again.
      if (identical(_glyphs, pending)) _glyphs = null;
      rethrow;
    }
  }

  Future<Map<String, Object?>> _loadTemplate() async =>
      _template ??= jsonDecode(await _bundle.loadString(styleAsset)) as Map<String, Object?>;

  Future<Uri> _installGlyphs() async {
    final directory = await _storage.glyphsDirectory();
    final manifest = await AssetManifest.loadFromAssetBundle(_bundle);
    final assets = manifest.listAssets().where(
      (asset) => asset.startsWith(fontsAssetDirectory) && asset.endsWith('.pbf'),
    );
    for (final asset in assets) {
      final relative = asset.substring(fontsAssetDirectory.length);
      final file = File(p.joinAll([directory.path, ...relative.split('/')]));
      final data = await _bundle.load(asset);
      // Same size means already installed (glyph files never change in place).
      if (await file.exists() && await file.length() == data.lengthInBytes) continue;
      await file.parent.create(recursive: true);
      await file.writeAsBytes(
        data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes),
        flush: true,
      );
    }
    return Uri.directory(directory.path);
  }
}
