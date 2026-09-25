import 'package:flutter/material.dart';

/// Required credit for OpenStreetMap data (ODbL), always visible over the map.
class OsmAttribution extends StatelessWidget {
  const OsmAttribution({super.key});

  static const text = '© OpenStreetMap contributors';

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.85),
        borderRadius: BorderRadius.circular(4),
      ),
      child: const Padding(
        padding: EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        child: Text(text, style: TextStyle(fontSize: 11, color: Colors.black87)),
      ),
    );
  }
}
