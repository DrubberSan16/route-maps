import 'dart:math' as math;
import 'dart:typed_data';

import 'binary.dart';
import 'fold.dart';
import 'js_math.dart';
import 'road_graph.dart' show metersPerDegree;

/// One search result of the index.
class PlaceHit {
  const PlaceHit({
    required this.index,
    required this.name,
    required this.detail,
    required this.kind,
    required this.type,
    required this.category,
    required this.lon,
    required this.lat,
    required this.bbox,
    required this.score,
  });

  final int index;
  final String name;

  /// Context of the entry: "Guayaquil, Guayas", or "Hospital · Guayaquil, Guayas".
  final String detail;

  /// admin, place, poi or street.
  final String kind;
  final String type;
  final String? category;
  final double lon;
  final double lat;
  final List<double>? bbox;
  final double score;

  bool get isPlace => kind == 'admin' || kind == 'place';
}

/// Words that describe a road type or join words: they help ranking but never filter.
const _softWords = {
  'de', 'del', 'la', 'las', 'los', 'el', 'en', 'y', 'e', 'a', 'al', 'con', 'calle', 'c', 'cl', //
  'avenida', 'av', 'avda', 'pasaje', 'pje', 'psje', 'callejon', 'cjon', 'peatonal', 'paseo', //
  'via', 'carretera', 'autopista', 'diagonal', 'transversal', 'redondel', 'sector', 'barrio', //
  'parque', 'cerca',
};

/// Places people search from anywhere: proximity barely changes their order.
const _majorPlaces = {'city', 'town', 'state', 'county'};

/// Bonus of a place or division named exactly like the query (a city must beat the nearby
/// streets named after it).
const _exactPlaceBonus = <String, double>{
  'city': 100,
  'state': 90,
  'town': 80,
  'county': 70,
  'administrative': 40,
};

/// Cell of the grid of places and points of interest, in degrees.
const _grid = 0.002;

/// Search over the places, streets, points of interest and administrative units of an offline
/// pack: the backend's `NativeSearchIndex` (native-search.ts) over the index section that the
/// data pipeline builds from the same entries (offline_pack.py), with the same matching, scores
/// and order.
class PlaceIndex {
  PlaceIndex._(BinaryFile file)
    : size = ((file.header['counts']! as Map<String, Object?>)['entries']! as num).toInt(),
      _names = file.strings('name'),
      _details = file.strings('detail'),
      _folded = file.strings('folded'),
      _contexts = file.strings('context'),
      _kinds = file.uint8('kind'),
      _types = file.uint16('type'),
      _categories = file.int32('category'),
      _lon = file.float64('lon'),
      _lat = file.float64('lat'),
      _boxes = file.float32('bbox'),
      _ranks = file.uint8('rank'),
      _kindNames = _stringList(file.header['kinds']),
      _typeNames = _stringList(file.header['types']),
      _categoryNames = _stringList(file.header['categories']),
      _nameWords = _Postings(file, 'name'),
      _contextWords = _Postings(file, 'context'),
      _gridKeys = file.float64('grid_key'),
      _gridStart = file.uint32('grid_start'),
      _gridEntries = file.int32('grid_entry');

  /// Reads the search section of an offline pack.
  factory PlaceIndex.parse(Uint8List bytes) {
    final file = BinaryFile.parse(bytes, magic: 'RMSRCH01');
    final header = file.header;
    if (header['format'] != 'route-maps-search' || header['version'] != 1) {
      throw FormatException('Unsupported search format ${header['format']} v${header['version']}');
    }
    return PlaceIndex._(file);
  }

  static List<String> _stringList(Object? value) => [
    for (final item in (value as List<Object?>?) ?? const <Object?>[]) item! as String,
  ];

  final int size;
  final Strings _names;
  final Strings _details;
  final Strings _folded;
  final Strings _contexts;
  final Uint8List _kinds;
  final Uint16List _types;
  final Int32List _categories;
  final Float64List _lon;
  final Float64List _lat;
  final Float32List _boxes;
  final Uint8List _ranks;
  final List<String> _kindNames;
  final List<String> _typeNames;
  final List<String> _categoryNames;
  final _Postings _nameWords;
  final _Postings _contextWords;
  final Float64List _gridKeys;
  final Uint32List _gridStart;
  final Int32List _gridEntries;

  /// Every query word must appear in the name (or an alias) or in the context of an entry, at
  /// least one in the name; the last word may be incomplete. Results are ranked by how well the
  /// name is covered, the importance of the entry and, with [nearLon] and [nearLat], the
  /// distance.
  List<PlaceHit> search(
    String text, {
    required int limit,
    double? nearLon,
    double? nearLat,
    List<String>? kinds,
  }) {
    final query = fold(text);
    final words = [
      for (final word in query.split(' '))
        if (word.isNotEmpty) word,
    ];
    if (words.isEmpty) return const [];
    final partialLast = !_endsWithSpace.hasMatch(text);
    var required = [
      for (final word in words)
        if (!_softWords.contains(word)) word,
    ];
    if (required.isEmpty) required = words;
    final lastWord = words.last;
    final matchers = [
      for (final word in required)
        _Matcher.of(
          word,
          partialLast && word == lastWord && word.length >= 2,
          _nameWords,
          _contextWords,
        ),
    ];
    // Every word is in the name or the context of a result, and at least one in the name.
    if (matchers.any((matcher) => matcher.size == 0)) return const [];
    if (matchers.every((matcher) => matcher.inNames.isEmpty)) return const [];
    // Candidates: the entries with the rarest word, in their name or in their context.
    final driver = matchers.reduce(
      (rarest, matcher) => matcher.size < rarest.size ? matcher : rarest,
    );
    final kindFilter = kinds == null ? null : {for (final kind in kinds) _kindNames.indexOf(kind)};
    final near = nearLon != null && nearLat != null;
    final kx = near ? metersPerDegree * math.cos((nearLat * math.pi) / 180) : 0.0;
    final hits = <PlaceHit>[];
    final seen = <int>{};
    for (final list in [...driver.inNames, ...driver.inContexts]) {
      for (var i = 0; i < list.length; i += 1) {
        final index = list[i];
        if (!seen.add(index)) continue;
        if (kindFilter != null && !kindFilter.contains(_kinds[index])) continue;
        final folded = _folded[index];
        final nameWords = [
          for (final word in folded.split(' '))
            if (word.isNotEmpty && word != '|') word,
        ];
        final contextWords = _contexts[index].split(' ');
        var nameMatches = 0;
        var contextOnly = 0;
        var ok = true;
        final covered = <String>{};
        for (final matcher in matchers) {
          final hit = _firstWhere(nameWords, matcher.matches);
          if (hit != null) {
            nameMatches += 1;
            covered.add(hit);
            continue;
          }
          if (contextWords.any(matcher.matches)) {
            contextOnly += 1;
            continue;
          }
          ok = false;
          break;
        }
        if (!ok || nameMatches == 0) continue;
        final names = folded.split(' | ');
        // Coverage of the meaningful words of the best name ("de", "calle"… do not count).
        var coverage = 0.0;
        for (final name in names) {
          final meaningful = [
            for (final word in name.split(' '))
              if (!_softWords.contains(word)) word,
          ];
          if (meaningful.isEmpty) continue;
          final share = meaningful.where(covered.contains).length / meaningful.length;
          if (share > coverage) coverage = share;
        }
        final exact = names.contains(query);
        final startsWith = names.any((name) => name.startsWith(query));
        final kind = _kindName(index);
        final type = _typeNames[_types[index]];
        final exactPlace = exact && (kind == 'admin' || kind == 'place')
            ? (_exactPlaceBonus[type] ?? 0.0)
            : 0.0;
        var score =
            _ranks[index] +
            coverage * 60 +
            (exact ? 20 : 0) +
            exactPlace +
            (startsWith ? 10 : 0) -
            contextOnly * 6;
        if (near) {
          final dx = (_lon[index] - nearLon) * kx;
          final dy = (_lat[index] - nearLat) * metersPerDegree;
          final km = math.sqrt(dx * dx + dy * dy) / 1000;
          // What is near matters most for streets, places of interest and neighbourhoods, less
          // for villages and parishes, little for cities.
          score += kind == 'poi' || kind == 'street' || type == 'suburb'
              ? 80 * math.exp(-km / 15) + 15 * math.exp(-km / 150)
              : _majorPlaces.contains(type)
              ? 15 * math.exp(-km / 50)
              : 40 * math.exp(-km / 15) + 10 * math.exp(-km / 150);
        }
        hits.add(_hit(index, score));
      }
    }
    return bestHits(hits, limit);
  }

  /// [hits] best first (score, then shorter name), without repeated places, at most [limit].
  static List<PlaceHit> bestHits(List<PlaceHit> hits, int limit) {
    stableSort(hits, (a, b) {
      final order = jsCompare(b.score - a.score);
      return order != 0 ? order : a.name.length - b.name.length;
    });
    final kept = <PlaceHit>[];
    for (final hit in hits) {
      if (kept.length >= limit) break;
      // The same name close by is one place: a city and its canton or parish, or a landmark
      // listed by two sources.
      final area = hit.isPlace ? 0.2 : 0.003;
      final duplicate = kept.any(
        (other) =>
            fold(other.name) == fold(hit.name) &&
            other.isPlace == hit.isPlace &&
            (other.lon - hit.lon).abs() < area &&
            (other.lat - hit.lat).abs() < area,
      );
      if (!duplicate) kept.add(hit);
    }
    return kept;
  }

  /// Street entries whose name matches the text (for intersections).
  List<PlaceHit> streets(String text, {required int limit, double? nearLon, double? nearLat}) =>
      search(text, limit: limit, nearLon: nearLon, nearLat: nearLat, kinds: const ['street']);

  /// Nearest point of interest or place within [meters].
  PlaceHit? nearest(double lon, double lat, double meters, {bool Function(PlaceHit hit)? accept}) {
    final kx = metersPerDegree * math.cos((lat * math.pi) / 180);
    final span = (meters / (_grid * metersPerDegree)).ceil() + 1;
    final cx = (lon / _grid).floor();
    final cy = (lat / _grid).floor();
    int? bestIndex;
    var bestDistance = 0.0;
    for (var dx = -span; dx <= span; dx += 1) {
      for (var dy = -span; dy <= span; dy += 1) {
        final cell = _findCell(cx + dx, cy + dy);
        if (cell < 0) continue;
        for (var i = _gridStart[cell]; i < _gridStart[cell + 1]; i += 1) {
          final index = _gridEntries[i];
          final distance = jsHypot((_lon[index] - lon) * kx, (_lat[index] - lat) * metersPerDegree);
          if (distance > meters || (bestIndex != null && distance >= bestDistance)) continue;
          if (accept != null && !accept(_hit(index, 0))) continue;
          bestIndex = index;
          bestDistance = distance;
        }
      }
    }
    return bestIndex == null ? null : _hit(bestIndex, 0);
  }

  int _findCell(int cx, int cy) {
    final key = ((cy + 100000) * 400000 + (cx + 200000)).toDouble();
    var low = 0;
    var high = _gridKeys.length - 1;
    while (low <= high) {
      final middle = (low + high) >> 1;
      final value = _gridKeys[middle];
      if (value == key) return middle;
      if (value < key) {
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return -1;
  }

  String _kindName(int index) {
    final kind = _kinds[index];
    return kind < _kindNames.length ? _kindNames[kind] : _kindNames.first;
  }

  PlaceHit _hit(int index, double score) {
    final category = _categories[index];
    final box = index * 4;
    return PlaceHit(
      index: index,
      name: _names[index],
      detail: _details[index],
      kind: _kindName(index),
      type: _typeNames[_types[index]],
      category: category >= 0 ? _categoryNames[category] : null,
      lon: _lon[index],
      lat: _lat[index],
      bbox: _boxes[box].isNaN
          ? null
          : [_boxes[box], _boxes[box + 1], _boxes[box + 2], _boxes[box + 3]],
      score: score,
    );
  }
}

final _endsWithSpace = RegExp(r'\s$');

T? _firstWhere<T>(List<T> items, bool Function(T item) test) {
  for (final item in items) {
    if (test(item)) return item;
  }
  return null;
}

/// Entries of each word, with the words sorted (for the words starting with a prefix).
class _Postings {
  _Postings(BinaryFile file, String name)
    : _vocabulary = file.strings('${name}_vocab'),
      _starts = file.uint32('${name}_post_off'),
      _entries = file.int32('${name}_post');

  final Strings _vocabulary;
  final Uint32List _starts;
  final Int32List _entries;

  Int32List _list(int word) => Int32List.sublistView(_entries, _starts[word], _starts[word + 1]);

  /// Position of the first word not below [word].
  int _lowerBound(String word) {
    var low = 0;
    var high = _vocabulary.length;
    while (low < high) {
      final middle = (low + high) >> 1;
      if (_vocabulary[middle].compareTo(word) < 0) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  }

  /// Lists of the entries with the word (or one of its [variants], or with [prefix], a word
  /// starting with it).
  List<Int32List> lookup(String word, List<String> variants, {required bool prefix}) {
    final lists = <Int32List>[];
    for (final variant in variants) {
      final position = _lowerBound(variant);
      if (position < _vocabulary.length && _vocabulary[position] == variant) {
        lists.add(_list(position));
      }
    }
    if (prefix) {
      var taken = 0;
      for (var i = _lowerBound(word); i < _vocabulary.length; i += 1) {
        final candidate = _vocabulary[i];
        if (!candidate.startsWith(word)) break;
        if (candidate == word) continue;
        lists.add(_list(i));
        if (++taken >= 400) break;
      }
    }
    return lists;
  }
}

class _Matcher {
  _Matcher(this.word, this.prefix, this.variants, this.inNames, this.inContexts)
    : size = [...inNames, ...inContexts].fold(0, (sum, list) => sum + list.length);

  factory _Matcher.of(String word, bool prefix, _Postings names, _Postings contexts) {
    final forms = _variants(word);
    return _Matcher(
      word,
      prefix,
      forms,
      names.lookup(word, forms, prefix: prefix),
      contexts.lookup(word, forms, prefix: prefix),
    );
  }

  final String word;
  final bool prefix;
  final List<String> variants;
  final List<Int32List> inNames;
  final List<Int32List> inContexts;
  final int size;

  bool matches(String candidate) =>
      variants.contains(candidate) || (prefix && candidate.startsWith(word));
}

/// Singular forms of a Spanish plural, so "hospitales" also finds "hospital".
List<String> _variants(String word) => [
  word,
  if (word.length > 4 && word.endsWith('es')) word.substring(0, word.length - 2),
  if (word.length > 3 && word.endsWith('s')) word.substring(0, word.length - 1),
];
