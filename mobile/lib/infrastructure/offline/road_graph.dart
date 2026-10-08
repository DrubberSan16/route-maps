import 'dart:math' as math;
import 'dart:typed_data';

import 'binary.dart';
import 'js_math.dart';

/// Road classes of the graph, by index (backend native-graph.ts `ROAD_CLASSES`).
abstract final class RoadClass {
  static const motorway = 0;
  static const trunk = 1;
  static const primary = 2;
  static const secondary = 3;
  static const tertiary = 4;
  static const street = 5;
  static const service = 6;
  static const track = 7;
  static const path = 8;
  static const footway = 9;
  static const steps = 10;
  static const connector = 11;
}

abstract final class RoadFlags {
  static const roundabout = 1;
  static const stateRoad = 2;
  static const unpaved = 4;
  static const tunnel = 8;

  /// Straight link over a gap of the official data (access road of a town that is not mapped).
  static const approximate = 16;
}

/// Parish of a road: names of its parish, canton and province.
class ParishInfo {
  const ParishInfo({required this.code, this.parish, this.canton, this.province});

  factory ParishInfo.fromJson(Map<String, Object?> json) => ParishInfo(
    code: (json['code'] as String?) ?? '',
    parish: json['parish'] as String?,
    canton: json['canton'] as String?,
    province: json['province'] as String?,
  );

  final String code;
  final String? parish;
  final String? canton;
  final String? province;
}

/// Connected networks of the roads of some classes.
class RoadNetworks {
  const RoadNetworks(this.component, this.largest);

  /// Network of every node, -1 when no road of those classes touches it.
  final Int32List component;

  /// The network with the most nodes, -1 when there is none.
  final int largest;
}

class NearestEdge {
  const NearestEdge({
    required this.edge,
    required this.distance,
    required this.fraction,
    required this.point,
  });

  final int edge;

  /// Distance in meters from the query point to the edge.
  final double distance;

  /// Position along the edge, 0 at `u`, 1 at `v` (by length).
  final double fraction;

  /// Snapped point [lng, lat].
  final List<double> point;
}

/// Cell size of the edge grid, in degrees (about 220 m).
const _cell = 0.002;
const metersPerDegree = 111195.08;

/// The road network of an offline pack: the graph.bin of the data pipeline, read like the
/// backend's `NativeGraph` (native-graph.ts) so that the phone routes exactly as the server.
class RoadGraph {
  RoadGraph._(BinaryFile file, this.nodeCount, this.edgeCount)
    : edgeU = file.int32('edge_u'),
      edgeV = file.int32('edge_v'),
      edgeLength = file.float32('edge_len'),
      edgeClass = file.uint8('edge_cls'),
      edgeFlags = file.uint8('edge_flags'),
      edgeName = file.int32('edge_name'),
      edgeRef = file.int32('edge_ref'),
      edgeParish = file.int32('edge_parish'),
      shapeOffset = file.uint32('shape_off'),
      shapeLon = file.int32('shape_lon'),
      shapeLat = file.int32('shape_lat'),
      names = file.strings('names').toList(),
      parishes = [
        for (final item in (file.header['parishes'] as List<Object?>?) ?? const <Object?>[])
          ParishInfo.fromJson(item! as Map<String, Object?>),
      ],
      nodeLon = Float64List(nodeCount),
      nodeLat = Float64List(nodeCount),
      adjacencyStart = Uint32List(nodeCount + 1),
      adjacency = Int32List(edgeCount * 2) {
    final lonE7 = file.int32('node_lon');
    final latE7 = file.int32('node_lat');
    for (var node = 0; node < nodeCount; node += 1) {
      nodeLon[node] = lonE7[node] / 1e7;
      nodeLat[node] = latE7[node] / 1e7;
    }
    for (var index = 0; index < names.length; index += 1) {
      _nameIds[names[index]] = index;
    }

    // Adjacency (CSR): for node n, adjacency[adjacencyStart[n] .. adjacencyStart[n + 1]) holds
    // edge * 2 + direction.
    for (var edge = 0; edge < edgeCount; edge += 1) {
      adjacencyStart[edgeU[edge] + 1] += 1;
      adjacencyStart[edgeV[edge] + 1] += 1;
    }
    for (var node = 0; node < nodeCount; node += 1) {
      adjacencyStart[node + 1] += adjacencyStart[node];
    }
    final fill = adjacencyStart.sublist(0, nodeCount);
    for (var edge = 0; edge < edgeCount; edge += 1) {
      adjacency[fill[edgeU[edge]]++] = edge * 2;
      adjacency[fill[edgeV[edge]]++] = edge * 2 + 1;
    }
    _buildGrid();
  }

  /// Reads a graph.bin (or the graph section of an offline pack).
  factory RoadGraph.parse(Uint8List bytes) {
    final file = BinaryFile.parse(bytes, magic: 'RMGRAPH2');
    final header = file.header;
    if (header['format'] != 'route-maps-graph' || header['version'] != 2) {
      throw FormatException('Unsupported graph format ${header['format']} v${header['version']}');
    }
    final counts = header['counts']! as Map<String, Object?>;
    return RoadGraph._(file, (counts['nodes']! as num).toInt(), (counts['edges']! as num).toInt());
  }

  final int nodeCount;
  final int edgeCount;
  final Float64List nodeLon;
  final Float64List nodeLat;
  final Int32List edgeU;
  final Int32List edgeV;
  final Float32List edgeLength;
  final Uint8List edgeClass;
  final Uint8List edgeFlags;
  final Int32List edgeName;
  final Int32List edgeRef;
  final Int32List edgeParish;
  final Uint32List shapeOffset;
  final Int32List shapeLon;
  final Int32List shapeLat;
  final List<String> names;
  final List<ParishInfo> parishes;
  final Uint32List adjacencyStart;
  final Int32List adjacency;

  /// Grid cells holding edges, sorted by row (cell of the latitude) and column (cell of the
  /// longitude), which is the order of the backend's cell keys.
  late final Int32List _cellRow;
  late final Int32List _cellColumn;
  late final Uint32List _cellStart;
  late final Int32List _cellEdges;
  final _edgesByName = <int, List<int>>{};
  final _nameIds = <String, int>{};
  final _networksByClasses = <int, RoadNetworks>{};

  /// Spatial grid of edges: every cell of the bounding box of every edge, with the edges of a
  /// cell in ascending order. Counting sorts keep it linear and in typed lists, so that
  /// country-wide packs load quickly on a phone.
  void _buildGrid() {
    final fromX = Int32List(edgeCount);
    final toX = Int32List(edgeCount);
    final fromY = Int32List(edgeCount);
    final toY = Int32List(edgeCount);
    var firstRow = 0;
    var lastRow = -1;
    var firstColumn = 0;
    var lastColumn = -1;
    for (var edge = 0; edge < edgeCount; edge += 1) {
      var minX = double.infinity;
      var minY = double.infinity;
      var maxX = double.negativeInfinity;
      var maxY = double.negativeInfinity;
      forEachPoint(edge, (x, y) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      });
      fromX[edge] = _cellOf(minX);
      toX[edge] = _cellOf(maxX);
      fromY[edge] = _cellOf(minY);
      toY[edge] = _cellOf(maxY);
      if (edge == 0 || fromY[edge] < firstRow) firstRow = fromY[edge];
      if (edge == 0 || toY[edge] > lastRow) lastRow = toY[edge];
      if (edge == 0 || fromX[edge] < firstColumn) firstColumn = fromX[edge];
      if (edge == 0 || toX[edge] > lastColumn) lastColumn = toX[edge];
    }

    // Entries of every row, in edge order.
    final rowStart = Int32List(lastRow - firstRow + 2);
    for (var edge = 0; edge < edgeCount; edge += 1) {
      final columns = toX[edge] - fromX[edge] + 1;
      for (var row = fromY[edge]; row <= toY[edge]; row += 1) {
        rowStart[row - firstRow + 1] += columns;
      }
    }
    for (var row = 1; row < rowStart.length; row += 1) {
      rowStart[row] += rowStart[row - 1];
    }
    final total = rowStart[rowStart.length - 1];
    final column = Int32List(total);
    final edges = Int32List(total);
    final fill = Int32List.fromList(rowStart);
    for (var edge = 0; edge < edgeCount; edge += 1) {
      for (var row = fromY[edge]; row <= toY[edge]; row += 1) {
        for (var cx = fromX[edge]; cx <= toX[edge]; cx += 1) {
          final at = fill[row - firstRow]++;
          column[at] = cx;
          edges[at] = edge;
        }
      }
    }

    // Each row by column: a stable counting sort keeps the edges of a cell in ascending order.
    var widest = 0;
    for (var row = 0; row + 1 < rowStart.length; row += 1) {
      widest = math.max(widest, rowStart[row + 1] - rowStart[row]);
    }
    final counts = Int32List(math.max(0, lastColumn - firstColumn) + 2);
    final sortedColumn = Int32List(widest);
    final sortedEdges = Int32List(widest);
    var cells = 0;
    for (var row = 0; row + 1 < rowStart.length; row += 1) {
      final start = rowStart[row];
      final end = rowStart[row + 1];
      if (start == end) continue;
      var low = column[start];
      var high = low;
      for (var i = start; i < end; i += 1) {
        if (column[i] < low) low = column[i];
        if (column[i] > high) high = column[i];
      }
      counts.fillRange(0, high - low + 2, 0);
      for (var i = start; i < end; i += 1) {
        counts[column[i] - low + 1] += 1;
      }
      for (var j = 1; j < high - low + 2; j += 1) {
        if (counts[j] > 0) cells += 1;
        counts[j] += counts[j - 1];
      }
      for (var i = start; i < end; i += 1) {
        final at = counts[column[i] - low]++;
        sortedColumn[at] = column[i];
        sortedEdges[at] = edges[i];
      }
      column.setRange(start, end, sortedColumn);
      edges.setRange(start, end, sortedEdges);
    }

    _cellRow = Int32List(cells);
    _cellColumn = Int32List(cells);
    _cellStart = Uint32List(cells + 1);
    var cell = 0;
    for (var row = 0; row + 1 < rowStart.length; row += 1) {
      for (var i = rowStart[row]; i < rowStart[row + 1]; i += 1) {
        if (i > rowStart[row] && column[i] == column[i - 1]) continue;
        _cellRow[cell] = row + firstRow;
        _cellColumn[cell] = column[i];
        _cellStart[cell] = i;
        cell += 1;
      }
    }
    _cellStart[cells] = total;
    _cellEdges = edges;
  }

  /// Calls [fn] with every point of the edge from u to v (both nodes included).
  void forEachPoint(int edge, void Function(double lon, double lat) fn) {
    final u = edgeU[edge];
    fn(nodeLon[u], nodeLat[u]);
    for (var i = shapeOffset[edge]; i < shapeOffset[edge + 1]; i += 1) {
      fn(shapeLon[i] / 1e7, shapeLat[i] / 1e7);
    }
    final v = edgeV[edge];
    fn(nodeLon[v], nodeLat[v]);
  }

  /// Points of the edge in travel order ([lng, lat]).
  List<List<double>> edgePoints(int edge, {bool reverse = false}) {
    final points = <List<double>>[];
    forEachPoint(edge, (lon, lat) => points.add([lon, lat]));
    return reverse ? points.reversed.toList() : points;
  }

  String? nameOf(int edge) {
    final id = edgeName[edge];
    return id >= 0 ? names[id] : null;
  }

  String? refOf(int edge) {
    final id = edgeRef[edge];
    return id >= 0 ? names[id] : null;
  }

  ParishInfo? parishOf(int edge) {
    final id = edgeParish[edge];
    return id >= 0 && id < parishes.length ? parishes[id] : null;
  }

  int? nameId(String label) => _nameIds[label];

  /// Edges carrying the given street label (lazy index).
  List<int> edgesNamed(int nameId) {
    if (_edgesByName.isEmpty) {
      for (var edge = 0; edge < edgeCount; edge += 1) {
        final id = edgeName[edge];
        if (id < 0) continue;
        (_edgesByName[id] ??= []).add(edge);
      }
    }
    return _edgesByName[nameId] ?? const [];
  }

  /// Connected networks of the roads whose class is in [classes] (bit `1 << class` per class),
  /// computed once per set: two roads are connected for a mode only through roads it may use.
  RoadNetworks networks(int classes) => _networksByClasses[classes] ??= _components(
    (edge) => ((classes >> edgeClass[edge]) & 1) == 1,
  );

  int degree(int node) => adjacencyStart[node + 1] - adjacencyStart[node];

  /// Nearest edges accepted by [accept] within [maxMeters], closest first (at most [limit]).
  /// Rings of grid cells are scanned outwards until enough candidates are closer than the ring.
  List<NearestEdge> nearestEdges(
    double lon,
    double lat,
    double maxMeters,
    bool Function(int edge) accept, {
    int limit = 1,
  }) {
    final cx = _cellOf(lon);
    final cy = _cellOf(lat);
    // Insertion order matters: equal distances keep the order in which edges were found.
    final found = <int, NearestEdge>{};
    final kx = metersPerDegree * math.cos((lat * math.pi) / 180);
    final ringMeters = _cell * metersPerDegree * math.min(1.0, math.cos((lat * math.pi) / 180));
    final maxRing = (maxMeters / ringMeters).ceil() + 1;
    List<NearestEdge> sortedFound() {
      final sorted = found.values.toList();
      stableSort(sorted, (a, b) => jsCompare(a.distance - b.distance));
      return sorted;
    }

    for (var ring = 0; ring <= maxRing; ring += 1) {
      for (var dx = -ring; dx <= ring; dx += 1) {
        for (var dy = -ring; dy <= ring; dy += 1) {
          if (math.max(dx.abs(), dy.abs()) != ring) continue;
          final index = _findCell(cx + dx, cy + dy);
          if (index < 0) continue;
          for (var i = _cellStart[index]; i < _cellStart[index + 1]; i += 1) {
            final edge = _cellEdges[i];
            if (found.containsKey(edge) || !accept(edge)) continue;
            final candidate = _project(edge, lon, lat, kx);
            if (candidate.distance <= maxMeters) found[edge] = candidate;
          }
        }
      }
      // Anything in a farther ring is at least (ring) cells away.
      final sorted = sortedFound();
      if (sorted.length >= limit && sorted[limit - 1].distance <= ring * ringMeters) {
        return sorted.sublist(0, limit);
      }
    }
    final sorted = sortedFound();
    return sorted.sublist(0, math.min(limit, sorted.length));
  }

  NearestEdge _project(int edge, double lon, double lat, double kx) {
    const ky = metersPerDegree;
    var best = double.infinity;
    var bestAlong = 0.0;
    var bestPoint = [lon, lat];
    var travelled = 0.0;
    var first = true;
    var previousX = 0.0;
    var previousY = 0.0;
    forEachPoint(edge, (x, y) {
      if (!first) {
        final ax = (previousX - lon) * kx;
        final ay = (previousY - lat) * ky;
        final bx = (x - lon) * kx;
        final by = (y - lat) * ky;
        final dx = bx - ax;
        final dy = by - ay;
        final length2 = dx * dx + dy * dy;
        final t = length2 == 0 ? 0.0 : math.max(0.0, math.min(1.0, -(ax * dx + ay * dy) / length2));
        final px = ax + t * dx;
        final py = ay + t * dy;
        final distance = jsHypot(px, py);
        final segment = math.sqrt(length2);
        if (distance < best) {
          best = distance;
          bestAlong = travelled + t * segment;
          bestPoint = [previousX + t * (x - previousX), previousY + t * (y - previousY)];
        }
        travelled += segment;
      }
      first = false;
      previousX = x;
      previousY = y;
    });
    return NearestEdge(
      edge: edge,
      distance: best,
      fraction: travelled > 0 ? bestAlong / travelled : 0,
      point: bestPoint,
    );
  }

  int _findCell(int cx, int cy) {
    var low = 0;
    var high = _cellRow.length - 1;
    while (low <= high) {
      final middle = (low + high) >> 1;
      final row = _cellRow[middle];
      final order = row != cy ? row - cy : _cellColumn[middle] - cx;
      if (order == 0) return middle;
      if (order < 0) {
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return -1;
  }

  RoadNetworks _components(bool Function(int edge) accept) {
    final component = Int32List(nodeCount)..fillRange(0, nodeCount, -1);
    final stack = <int>[];
    var next = 0;
    var largest = -1;
    var largestSize = 0;
    for (var start = 0; start < nodeCount; start += 1) {
      if (component[start] != -1) continue;
      var size = 0;
      var touched = false;
      component[start] = next;
      stack.add(start);
      while (stack.isNotEmpty) {
        final node = stack.removeLast();
        size += 1;
        for (var i = adjacencyStart[node]; i < adjacencyStart[node + 1]; i += 1) {
          final edge = adjacency[i] >> 1;
          if (!accept(edge)) continue;
          touched = true;
          final other = (adjacency[i] & 1) == 0 ? edgeV[edge] : edgeU[edge];
          if (component[other] == -1) {
            component[other] = next;
            stack.add(other);
          }
        }
      }
      if (!touched) {
        component[start] = -1;
        continue;
      }
      if (size > largestSize) {
        largestSize = size;
        largest = next;
      }
      next += 1;
    }
    return RoadNetworks(component, largest);
  }
}

int _cellOf(double value) => (value / _cell).floor();
