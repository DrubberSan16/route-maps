import 'dart:math' as math;

import 'fold.dart';
import 'js_math.dart';
import 'place_index.dart';
import 'road_graph.dart';

/// "Av. 9 de Octubre y Boyacá", "Amazonas & Naciones Unidas", "10 de Agosto esquina Colón".
final _intersection = RegExp(
  r'^(.+?)\s+(?:y|e|&|esq\.?|esquina|con|interseccion|intersección)\s+(.+)$',
  caseSensitive: false,
);

/// A tap farther than this from any street keeps its coordinates as the name.
const _reverseStreetMeters = 60.0;
const _reversePoiMeters = 25.0;

/// Country of the native data.
const _countryCode = 'EC';

/// A result with the score that ranks it.
typedef ScoredResult = ({double score, Map<String, Object?> result});

/// What one pack finds for a text: street intersections (best first, at most three) and places,
/// streets and points of interest (best first).
class GeocodeCandidates {
  const GeocodeCandidates(this.intersections, this.hits);

  final List<ScoredResult> intersections;
  final List<PlaceHit> hits;
}

/// Geocoding on the phone with the data of an offline pack: the backend's
/// `NativeGeocodingProvider` (native-geocoding.provider.ts) behind its `GeocodingService`, over
/// the pack's search index and road network. Results are the JSON of the API
/// (`GET /geocoding/search` and `/geocoding/reverse`).
class OfflineGeocoder {
  OfflineGeocoder(this.index, this.graph);

  final PlaceIndex index;
  final RoadGraph graph;

  /// Places, streets, points of interest and street intersections matching [text], like
  /// `GET /geocoding/search`.
  List<Map<String, Object?>> search(
    String text, {
    int limit = 10,
    double? nearLatitude,
    double? nearLongitude,
  }) => combine([
    candidates(text, limit: limit, nearLatitude: nearLatitude, nearLongitude: nearLongitude),
  ], limit);

  /// What the pack finds for [text], to [combine] with what other packs find.
  GeocodeCandidates candidates(
    String text, {
    int limit = 10,
    double? nearLatitude,
    double? nearLongitude,
  }) {
    // GeocodingService: the text is trimmed and its blanks collapsed.
    final normalized = text.replaceAll(_outerBlanks, '').replaceAll(_blanks, ' ');
    final near = nearLatitude != null && nearLongitude != null;
    final crossing = _intersection.firstMatch(normalized);
    return GeocodeCandidates(
      crossing == null
          ? const []
          : _intersections(
              crossing[1]!,
              crossing[2]!,
              near ? nearLongitude : null,
              near ? nearLatitude : null,
            ),
      index.search(
        normalized,
        limit: limit,
        nearLon: near ? nearLongitude : null,
        nearLat: near ? nearLatitude : null,
      ),
    );
  }

  /// The results of one or more packs: the best street intersections, then the best places,
  /// streets and points of interest, without repeating what two packs both have. With one
  /// pack it is exactly the platform's answer.
  static List<Map<String, Object?>> combine(List<GeocodeCandidates> found, int limit) {
    final crossings = [for (final item in found) ...item.intersections];
    stableSort(crossings, (x, y) => jsCompare(y.score - x.score));
    final seen = <Object?>{};
    final results = <Map<String, Object?>>[
      for (final crossing in crossings)
        if (seen.add(crossing.result['sourceId'])) crossing.result,
    ].take(3).toList();
    for (final hit in PlaceIndex.bestHits([for (final item in found) ...item.hits], limit)) {
      if (results.length >= limit) break;
      results.add(_toResult(hit));
    }
    return results.length > limit ? results.sublist(0, limit) : results;
  }

  /// The address of a point: the point of interest at it or the street under it, else the
  /// nearest town or neighbourhood; null when there is nothing around.
  Map<String, Object?>? reverse(double latitudeIn, double longitudeIn) {
    // GeocodingService: about 1 m of precision.
    final latitude = double.parse(latitudeIn.toStringAsFixed(5));
    final longitude = double.parse(longitudeIn.toStringAsFixed(5));
    final poi = index.nearest(
      longitude,
      latitude,
      _reversePoiMeters,
      accept: (hit) => hit.kind == 'poi',
    );
    final streets = graph.nearestEdges(
      longitude,
      latitude,
      _reverseStreetMeters,
      (edge) => graph.edgeName[edge] >= 0 && graph.edgeClass[edge] != RoadClass.connector,
    );
    final street = streets.isEmpty ? null : streets.first;
    if (poi == null && street == null) {
      final place = index.nearest(longitude, latitude, 3000, accept: (hit) => hit.kind == 'place');
      if (place == null) return null;
      return {..._toResult(place), 'latitude': latitude, 'longitude': longitude, 'bbox': null};
    }
    final road = street != null ? graph.nameOf(street.edge) : null;
    final parish = street != null ? graph.parishOf(street.edge) : null;
    final city = parish?.canton;
    final context = [
      parish?.parish != parish?.canton ? parish?.parish : null,
      city,
      parish?.province,
    ].whereType<String>().where((value) => value.isNotEmpty);
    final name = poi?.name ?? road;
    final parts = [
      name,
      poi != null && _truthy(road) ? road : null,
      ...context,
      'Ecuador',
    ].whereType<String>().where((value) => value.isNotEmpty).toList();
    final displayName = [
      for (var position = 0; position < parts.length; position += 1)
        if (parts.indexWhere((other) => fold(other) == fold(parts[position])) == position)
          parts[position],
    ].join(', ');
    return {
      'displayName': displayName,
      'name': name,
      'latitude': latitude,
      'longitude': longitude,
      'category': poi != null ? (poi.category ?? 'poi') : 'highway',
      'type': poi != null ? poi.type : 'street',
      'address': {
        'road': ?road,
        if (_truthy(parish?.parish) && parish!.parish != parish.canton) 'suburb': parish.parish,
        'city': ?city,
        'state': ?parish?.province,
        'country': 'Ecuador',
        'countryCode': _countryCode,
      },
      'bbox': null,
      'sourceId': poi != null
          ? 'native:poi:${poi.index}'
          : street != null
          ? 'native:edge:${street.edge}'
          : null,
    };
  }

  /// Junctions of the streets named like [first] and [second] (the best three).
  List<ScoredResult> _intersections(String first, String second, double? nearLon, double? nearLat) {
    final a = index.streets(first, limit: 25, nearLon: nearLon, nearLat: nearLat);
    final b = index.streets(second, limit: 25, nearLon: nearLon, nearLat: nearLat);
    final found = <ScoredResult>[];
    final seen = <String>{};
    for (final left in a) {
      for (final right in b) {
        if (left.name == right.name) continue;
        for (final point in _junctions(left.name, right.name)) {
          final key = '${point.lon.toStringAsFixed(4)},${point.lat.toStringAsFixed(4)}';
          if (!seen.add(key)) continue;
          final parish = graph.parishOf(point.edge);
          final context = [
            parish?.canton,
            parish?.province,
          ].whereType<String>().where((value) => value.isNotEmpty).join(', ');
          final name = '${left.name} y ${right.name}';
          var score = left.score + right.score;
          if (nearLon != null && nearLat != null) {
            final km =
                jsHypot(
                  (point.lon - nearLon) * math.cos((point.lat * math.pi) / 180),
                  point.lat - nearLat,
                ) *
                111.2;
            score += 60 * math.exp(-km / 10);
          }
          found.add((
            score: score,
            result: {
              'displayName': context.isNotEmpty ? '$name, $context' : name,
              'name': name,
              'latitude': point.lat,
              'longitude': point.lon,
              'category': 'highway',
              'type': 'intersection',
              'address': {
                'road': left.name,
                'city': ?parish?.canton,
                'state': ?parish?.province,
                'country': 'Ecuador',
                'countryCode': _countryCode,
              },
              'bbox': null,
              'sourceId': 'native:intersection:$key',
            },
          ));
        }
      }
    }
    stableSort(found, (x, y) => jsCompare(y.score - x.score));
    return found.take(3).toList();
  }

  /// Junctions where two named streets meet (native-search.ts `intersections`).
  List<({double lon, double lat, int edge})> _junctions(String first, String second) {
    final a = graph.nameId(first);
    final b = graph.nameId(second);
    if (a == null || b == null || a == b) return const [];
    final nodes = <int>{};
    for (final edge in graph.edgesNamed(a)) {
      nodes
        ..add(graph.edgeU[edge])
        ..add(graph.edgeV[edge]);
    }
    final found = <({double lon, double lat, int edge})>[];
    final seen = <int>{};
    for (final edge in graph.edgesNamed(b)) {
      for (final node in [graph.edgeU[edge], graph.edgeV[edge]]) {
        if (nodes.contains(node) && seen.add(node)) {
          found.add((lon: graph.nodeLon[node], lat: graph.nodeLat[node], edge: edge));
        }
      }
    }
    return found;
  }
}

final _outerBlanks = RegExp(r'^\s+|\s+$');
final _blanks = RegExp(r'\s+');

bool _truthy(String? value) => value != null && value.isNotEmpty;

Map<String, Object?> _toResult(PlaceHit hit) {
  final context = hit.detail;
  final parts = context.split(' · ');
  final place = parts.last;
  final pieces = place.split(', ');
  final first = pieces[0];
  final second = pieces.length > 1 ? pieces[1] : null;
  final third = pieces.length > 2 ? pieces[2] : null;
  final city = _truthy(third) ? second : first;
  final state = third ?? second;
  return {
    'displayName': context.isNotEmpty ? '${hit.name}, $context' : hit.name,
    'name': hit.name,
    'latitude': hit.lat,
    'longitude': hit.lon,
    'category': hit.kind == 'street'
        ? 'highway'
        : hit.kind == 'poi'
        ? (hit.category ?? 'poi')
        : 'place',
    'type': hit.kind == 'street' ? 'street' : hit.type,
    'address': {
      if (hit.kind == 'street') 'road': hit.name,
      if (hit.kind != 'place' && city != null) 'city': city,
      if (_truthy(state)) 'state': state,
      'country': 'Ecuador',
      'countryCode': _countryCode,
    },
    'bbox': hit.bbox,
    'sourceId': 'native:${hit.kind}:${hit.index}',
  };
}
