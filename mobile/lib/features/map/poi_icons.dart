import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

/// Icons of the points of interest: the style asks for a `poi-<class>` image
/// per class and they are drawn here as a coloured disc with a white glyph,
/// like the web viewer does. Colours come from the style metadata
/// (`maps-platform:poi-colors`); without an icon MapLibre shows only the name.
abstract final class PoiIcons {
  /// Size on the map, in logical pixels (the style scales it from 0.75 to 1).
  static const size = 24.0;

  static const _glyphs = <String, IconData>{
    'restaurant': Icons.restaurant,
    'cafe': Icons.local_cafe,
    'bar': Icons.local_bar,
    'shop': Icons.shopping_bag,
    'supermarket': Icons.shopping_cart,
    'hospital': Icons.local_hospital,
    'pharmacy': Icons.local_pharmacy,
    'school': Icons.school,
    'college': Icons.school,
    'library': Icons.local_library,
    'park': Icons.park,
    'sports': Icons.sports_soccer,
    'stadium': Icons.stadium,
    'cemetery': Icons.local_florist,
    'bus': Icons.directions_bus,
    'airport': Icons.flight,
    'rail': Icons.train,
    'ferry': Icons.directions_boat,
    'fuel': Icons.local_gas_station,
    'parking': Icons.local_parking,
    'taxi': Icons.local_taxi,
    'charging_station': Icons.ev_station,
    'lodging': Icons.hotel,
    'campsite': Icons.festival,
    'bank': Icons.account_balance,
    'museum': Icons.museum,
    'theatre': Icons.theater_comedy,
    'cinema': Icons.local_movies,
    'attraction': Icons.star,
    'place_of_worship': Icons.church,
    'town_hall': Icons.location_city,
    'government': Icons.location_city,
    'police': Icons.local_police,
    'fire_station': Icons.local_fire_department,
    'post': Icons.local_post_office,
    'military': Icons.shield,
    'community': Icons.groups,
  };

  /// Classes of the OSM-based tiles drawn with the glyph of their native counterpart.
  static const _aliases = {
    'food': 'restaurant',
    'mall': 'shop',
    'market': 'shop',
    'grocery': 'supermarket',
    'health': 'hospital',
    'emergency': 'hospital',
    'bus_station': 'bus',
    'bus_stop': 'bus',
    'railway_station': 'rail',
    'transit_station': 'rail',
    'tram_stop': 'rail',
    'ferry_terminal': 'ferry',
    'culture': 'theatre',
    'historic': 'attraction',
    'worship': 'place_of_worship',
    'playground': 'park',
  };

  static final _cache = <String, Uint8List>{};

  /// Glyph of [poiClass]; null draws a plain dot (buildings and unknown classes).
  static IconData? glyphOf(String poiClass) => _glyphs[poiClass] ?? _glyphs[_aliases[poiClass]];

  /// PNG of the icon of [poiClass] in [color] (`#rrggbb`) for screens of [pixelRatio].
  static Future<Uint8List> png(String poiClass, String color, double pixelRatio) async {
    final key = '$poiClass $color $pixelRatio';
    if (_cache[key] case final bytes?) return bytes;
    final side = (size * pixelRatio).round();
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder)..scale(side / size);
    const center = Offset(size / 2, size / 2);
    canvas
      ..drawCircle(center, size / 2 - 0.5, Paint()..color = const Color(0x33000000))
      ..drawCircle(center, size / 2 - 1.5, Paint()..color = const Color(0xFFFFFFFF))
      ..drawCircle(center, size / 2 - 2.5, Paint()..color = _parse(color));
    final glyph = glyphOf(poiClass);
    if (glyph == null) {
      canvas.drawCircle(center, 3, Paint()..color = const Color(0xFFFFFFFF));
    } else {
      final painter = TextPainter(
        text: TextSpan(
          text: String.fromCharCode(glyph.codePoint),
          style: TextStyle(
            fontFamily: glyph.fontFamily,
            package: glyph.fontPackage,
            fontSize: 14,
            height: 1,
            color: const Color(0xFFFFFFFF),
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      painter
        ..paint(canvas, center - Offset(painter.width / 2, painter.height / 2))
        ..dispose();
    }
    final image = await recorder.endRecording().toImage(side, side);
    try {
      final data = await image.toByteData(format: ui.ImageByteFormat.png);
      return _cache[key] = data!.buffer.asUint8List();
    } finally {
      image.dispose();
    }
  }

  static Color _parse(String hex) {
    final value = int.tryParse(hex.replaceFirst('#', ''), radix: 16);
    return value == null || hex.length != 7 ? const Color(0xFF70757A) : Color(0xFF000000 | value);
  }
}
