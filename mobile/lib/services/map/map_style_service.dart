import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;

import '../../domain/repositories/map_repository.dart';
import '../../domain/services/offline_storage_service.dart';
import 'pmtiles_metadata.dart';

/// A way of drawing the map ("Mapa", "Satélite", "Relieve"), from the style
/// metadata (`maps-platform:map-types`).
@immutable
class MapTypeOption {
  const MapTypeOption({required this.id, required this.label, required this.available});

  static const map = 'map';
  static const satellite = 'satellite';
  static const relief = 'relief';

  final String id;
  final String label;

  /// Whether the current map source has its data (imagery, elevation).
  final bool available;
}

/// Builds the MapLibre style for a [MapSource] from the bundled template
/// (`assets/map/style.json`, the same style the platform serves):
///
/// * the `basemap` source points to the local PMTiles file
///   (`pmtiles://file:///…`) or to the server's (`pmtiles://https://…`);
/// * the climate and population overlays (hidden until switched on) are read
///   from the region's overlays archive, or from the map for maps built before
///   it existed;
/// * the satellite and relief types add the imagery or elevation published
///   over the map (read from the platform, the most detailed on top) and
///   restyle the base layers as the metadata says;
/// * the measured traffic is an empty GeoJSON source with its (hidden) layers
///   under the labels, filled and shown by the map view;
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
  static const _overlays = 'overlays';

  /// GeoJSON source of the measured traffic (`GET /traffic/flow`).
  static const trafficSource = 'traffic-flow';

  Future<Uri>? _glyphs;
  Map<String, Object?>? _template;

  /// Map types of the template and whether [source] can show them.
  Future<List<MapTypeOption>> mapTypes(MapSource source) async {
    final types = _mapTypeSpecs(await _loadTemplate());
    return [
      for (final MapEntry(key: id, value: spec) in types.entries)
        MapTypeOption(
          id: id,
          label: spec['label'] as String? ?? id,
          available: id == MapTypeOption.map || _assetUrls(spec, source).isNotEmpty,
        ),
    ];
  }

  /// Style JSON for [source], drawn as [mapType] when the source has its data
  /// (the plain map otherwise).
  Future<String> styleFor(MapSource source, {String mapType = MapTypeOption.map}) async {
    final template = await _loadTemplate();
    final style = jsonDecode(jsonEncode(template)) as Map<String, Object?>;
    final sources = style['sources']! as Map<String, Object?>;
    final layers = (style['layers']! as List<Object?>).cast<Map<String, Object?>>();
    final basemap = sources[_basemap]! as Map<String, Object?>;
    switch (source) {
      case LocalMapSource(:final file):
        basemap['url'] = 'pmtiles://${Uri.file(file.path)}';
      case RemoteMapSource(:final url):
        basemap['url'] = 'pmtiles://$url';
      case NoMapSource():
        sources
          ..remove(_basemap)
          ..remove(_overlays);
        layers.removeWhere((layer) => const {_basemap, _overlays}.contains(layer['source']));
    }
    if (sources[_overlays] case final Map<String, Object?> overlays) {
      overlays['url'] = switch (source.assets[_overlays]?.firstOrNull) {
        final Uri url => 'pmtiles://$url',
        null => basemap['url'],
      };
    }
    if (source is! NoMapSource) _addTraffic(style, layers);
    if (_mapTypeSpecs(template)[mapType] case final spec? when mapType != MapTypeOption.map) {
      final urls = _assetUrls(spec, source);
      if (urls.isNotEmpty) _applyMapType(spec, urls, sources, layers);
    }
    style['layers'] = layers;
    style['glyphs'] = '${await glyphsBaseUri()}{fontstack}/{range}.pbf';
    return jsonEncode(style);
  }

  /// Whether [source] can draw the overlays (climate, population): from their
  /// own archive, or from the map itself where it was built before they had
  /// one. A downloaded file tells by its metadata; the platform's maps are
  /// taken to have them, except the world overview.
  Future<bool> overlaysAvailable(MapSource source) async {
    if (source.assets[_overlays]?.isNotEmpty ?? false) return true;
    return switch (source) {
      LocalMapSource(:final file) => _hasOverlays(
        await pmtilesVectorLayers(file),
        await _loadTemplate(),
      ),
      RemoteMapSource(:final region) => region.isDetailed,
      NoMapSource() => false,
    };
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

  static Map<String, Map<String, Object?>> _mapTypeSpecs(Map<String, Object?> template) {
    final metadata = template['metadata'] as Map<String, Object?>? ?? const {};
    final types = metadata['maps-platform:map-types'] as Map<String, Object?>?;
    if (types == null) {
      return const {
        MapTypeOption.map: {'label': 'Mapa'},
      };
    }
    return types.map((id, spec) => MapEntry(id, spec! as Map<String, Object?>));
  }

  /// Archives a map type needs that [source] has, in drawing order.
  static List<Uri> _assetUrls(Map<String, Object?> spec, MapSource source) {
    final asset = spec['asset'] as String?;
    return asset == null ? const [] : source.assets[asset] ?? const [];
  }

  /// Whether a map with [vectorLayers] has the data of the overlay layers
  /// (unreadable metadata counts as yes: the overlays stay on offer).
  static bool _hasOverlays(Set<String>? vectorLayers, Map<String, Object?> template) =>
      vectorLayers == null ||
      (template['layers']! as List<Object?>).cast<Map<String, Object?>>().any(
        (layer) => layer['source'] == _overlays && vectorLayers.contains(layer['source-layer']),
      );

  /// Adds the imagery or elevation of a map type below the layers its
  /// metadata names (a source and a copy of its layers per archive, the later
  /// ones on top), hides the base layers it replaces and restyles the rest.
  static void _applyMapType(
    Map<String, Object?> spec,
    List<Uri> urls,
    Map<String, Object?> sources,
    List<Map<String, Object?>> layers,
  ) {
    final asset = spec['asset']! as String;
    // The first archive keeps the template's ids: `satellite`, then `satellite-2`...
    String numbered(String id, int index) => index == 0 ? id : '$id-${index + 1}';
    for (final (index, url) in urls.indexed) {
      sources[numbered(asset, index)] = {
        ...?spec['source'] as Map<String, Object?>?,
        'url': 'pmtiles://$url',
      };
    }
    for (final added
        in (spec['layers'] as List<Object?>? ?? const []).cast<Map<String, Object?>>()) {
      for (var index = 0; index < urls.length; index++) {
        final layer = {...added}..remove('before');
        layer['id'] = numbered(added['id']! as String, index);
        layer['source'] = numbered(asset, index);
        var position = layers.indexWhere((existing) => existing['id'] == added['before']);
        if (position < 0) position = _firstSymbol(layers);
        layers.insert(position, layer);
      }
    }
    final hide = (spec['hide'] as List<Object?>? ?? const []).toSet();
    final paint = spec['paint'] as Map<String, Object?>? ?? const {};
    for (final layer in layers) {
      if (hide.contains(layer['id'])) {
        layer['layout'] = {...?layer['layout'] as Map<String, Object?>?, 'visibility': 'none'};
      }
      if (paint[layer['id']] case final Map<String, Object?> changes) {
        layer['paint'] = {...?layer['paint'] as Map<String, Object?>?, ...changes};
      }
    }
  }

  /// The measured traffic: an empty GeoJSON source and its hidden layers
  /// below the labels, so the view only has to fill and show them.
  static void _addTraffic(Map<String, Object?> style, List<Map<String, Object?>> layers) {
    final metadata = style['metadata'] as Map<String, Object?>? ?? const {};
    final traffic = metadata['maps-platform:traffic'] as Map<String, Object?>?;
    final flow = (traffic?['layers'] as List<Object?>? ?? const []).cast<Map<String, Object?>>();
    if (flow.isEmpty) return;
    (style['sources']! as Map<String, Object?>)[trafficSource] = {
      'type': 'geojson',
      'data': {'type': 'FeatureCollection', 'features': <Object?>[]},
    };
    layers.insertAll(_firstSymbol(layers), [
      for (final layer in flow)
        {
          ...layer,
          'source': trafficSource,
          'layout': {...?layer['layout'] as Map<String, Object?>?, 'visibility': 'none'},
        },
    ]);
  }

  static int _firstSymbol(List<Map<String, Object?>> layers) {
    final index = layers.indexWhere((layer) => layer['type'] == 'symbol');
    return index < 0 ? layers.length : index;
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

/// The layers of a style built by [MapStyleService] that the map view shows
/// and hides without reloading it: traffic and overlays. Also the colours of
/// the point of interest classes, to draw their icons.
@immutable
class MapStyleLayers {
  const MapStyleLayers({
    this.traffic = const [],
    this.overlays = const {},
    this.poiColors = const {},
    this.firstSymbol,
  });

  factory MapStyleLayers.of(String style) {
    final json = jsonDecode(style) as Map<String, Object?>;
    final layers = (json['layers'] as List<Object?>? ?? const []).cast<Map<String, Object?>>();
    final ids = {for (final layer in layers) layer['id']! as String};
    final metadata = json['metadata'] as Map<String, Object?>? ?? const {};
    final traffic = metadata['maps-platform:traffic'] as Map<String, Object?>? ?? const {};
    final overlays = metadata['maps-platform:overlays'] as Map<String, Object?>? ?? const {};
    List<String> present(Iterable<Object?>? names) => [
      for (final name in names ?? const <Object?>[])
        if (ids.contains(name)) name! as String,
    ];
    final colors = metadata['maps-platform:poi-colors'] as Map<String, Object?>? ?? const {};
    return MapStyleLayers(
      traffic: present([
        ...?traffic['network'] as List<Object?>?,
        for (final layer in (traffic['layers'] as List<Object?>? ?? const []))
          (layer! as Map<String, Object?>)['id'],
      ]),
      overlays: {
        for (final MapEntry(:key, :value) in overlays.entries)
          key: present(value as List<Object?>?),
      },
      poiColors: {
        for (final MapEntry(:key, :value) in colors.entries)
          if (value is String) key: value,
      },
      firstSymbol: [
        for (final layer in layers)
          if (layer['type'] == 'symbol') layer['id']! as String,
      ].firstOrNull,
    );
  }

  /// The main roads in green and the measured segments on top.
  final List<String> traffic;

  /// Layers of each overlay (`precipitation`, `temperature`, `population`).
  final Map<String, List<String>> overlays;

  /// `#rrggbb` colour of each point of interest class (`default` for the rest).
  final Map<String, String> poiColors;

  /// First label layer: lines added by the app go below it.
  final String? firstSymbol;
}
