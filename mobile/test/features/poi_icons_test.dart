import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/features/map/poi_icons.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('classes of the map tiles share the glyph of their native counterpart', () {
    expect(PoiIcons.glyphOf('restaurant'), Icons.restaurant);
    expect(PoiIcons.glyphOf('food'), Icons.restaurant);
    expect(PoiIcons.glyphOf('bus_stop'), Icons.directions_bus);
    // Buildings and unknown classes are drawn as a dot.
    expect(PoiIcons.glyphOf('building'), isNull);
  });

  test('icons are PNGs at the density of the screen, drawn once', () async {
    final png = await PoiIcons.png('restaurant', '#e8710a', 2);
    expect(png.sublist(0, 4), [0x89, 0x50, 0x4E, 0x47]);
    final frame = await (await ui.instantiateImageCodec(png)).getNextFrame();
    expect(frame.image.width, PoiIcons.size * 2);
    expect(frame.image.height, PoiIcons.size * 2);
    frame.image.dispose();

    expect(await PoiIcons.png('restaurant', '#e8710a', 2), same(png));
    expect(await PoiIcons.png('building', 'not a colour', 1), isNotEmpty);
  });
}
