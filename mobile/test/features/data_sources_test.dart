import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/features/map/widgets/data_sources_sheet.dart';

void main() {
  test('the app credits the same sources as the web viewer\'s page', () {
    final page = File('../infrastructure/nginx/html/fuentes.html').readAsStringSync();
    String text(String html) => html.replaceAll(RegExp(r'\s+'), ' ').trim();
    final item = RegExp(r'<li><strong>(.*?)</strong>\s*<span>(.*?)</span></li>', dotAll: true);
    final listed = [
      for (final match in item.allMatches(page)) (citation: text(match[1]!), use: text(match[2]!)),
    ];

    expect(listed, isNotEmpty);
    expect(dataSources, listed);
  });
}
