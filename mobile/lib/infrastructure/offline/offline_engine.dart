import 'dart:async';
import 'dart:io';
import 'dart:isolate';

import 'offline_geocoder.dart';
import 'offline_pack.dart';
import 'road_router.dart';

/// Error of the offline engine. [code] is `no_route` (no road joins the points), `not_covered`
/// (no downloaded region covers them), `invalid_pack` (a pack file is missing or damaged) or
/// `failed`.
class OfflineEngineException implements Exception {
  const OfflineEngineException(this.code, this.message);

  final String code;
  final String message;

  @override
  String toString() => 'OfflineEngineException($code): $message';
}

/// The offline packs of the device, opened once and kept while their files do not change.
/// Answers route, search and address requests like the platform's API, choosing the packs that
/// cover each request.
class OfflinePackSet {
  final _open = <String, ({OfflinePack pack, int size, DateTime modified})>{};

  /// The pack at [path], read again when its file was replaced (an updated download).
  OfflinePack pack(String path) {
    final stat = File(path).statSync();
    if (stat.type != FileSystemEntityType.file) {
      throw OfflineEngineException('invalid_pack', 'The offline pack $path does not exist');
    }
    final cached = _open[path];
    if (cached != null && cached.size == stat.size && cached.modified == stat.modified) {
      return cached.pack;
    }
    final pack = OfflinePack.open(path);
    _open[path] = (pack: pack, size: stat.size, modified: stat.modified);
    return pack;
  }

  /// Forgets the packs that are not in [paths] (deleted regions), freeing their memory.
  void retain(Iterable<String> paths) {
    final keep = paths.toSet();
    _open.removeWhere((path, _) => !keep.contains(path));
  }

  /// The route through [stops] on the smallest pack that covers all of them: the backend's
  /// `{primary, alternatives}` and the region of the pack.
  Map<String, Object?> route({
    required List<String> packs,
    required String profile,
    required List<Stop> stops,
    required int alternatives,
    String? language,
  }) {
    final pack = _smallest(
      packs,
      (pack) => stops.every((stop) => pack.covers(stop.longitude, stop.latitude)),
    );
    if (pack == null) {
      throw const OfflineEngineException(
        'not_covered',
        'No downloaded region covers every stop of the route',
      );
    }
    final result = pack.router.route(
      profile,
      stops,
      stops.length > 2 ? 0 : alternatives,
      language: language,
    );
    return {'region': pack.region, 'primary': result.primary, 'alternatives': result.alternatives};
  }

  /// Places, streets and points of interest of the downloaded regions matching [text].
  List<Map<String, Object?>> search({
    required List<String> packs,
    required String text,
    int limit = 10,
    double? nearLatitude,
    double? nearLongitude,
  }) {
    final opened = [for (final path in packs) pack(path)];
    // A pack inside another one has nothing that the bigger one lacks.
    bool redundant(int index) {
      for (var other = 0; other < opened.length; other += 1) {
        if (other == index || !opened[other].contains(opened[index])) continue;
        if (!opened[index].contains(opened[other]) || other < index) return true;
      }
      return false;
    }

    return OfflineGeocoder.combine([
      for (var index = 0; index < opened.length; index += 1)
        if (!redundant(index))
          opened[index].geocoder.candidates(
            text,
            limit: limit,
            nearLatitude: nearLatitude,
            nearLongitude: nearLongitude,
          ),
    ], limit);
  }

  /// The address of a point, from the smallest pack that covers it.
  Map<String, Object?>? reverse({
    required List<String> packs,
    required double latitude,
    required double longitude,
  }) {
    final pack = _smallest(packs, (pack) => pack.covers(longitude, latitude));
    if (pack == null) {
      throw const OfflineEngineException('not_covered', 'No downloaded region covers the point');
    }
    return pack.geocoder.reverse(latitude, longitude);
  }

  OfflinePack? _smallest(List<String> paths, bool Function(OfflinePack pack) accept) {
    OfflinePack? best;
    for (final path in paths) {
      final candidate = pack(path);
      if (accept(candidate) && (best == null || candidate.area < best.area)) best = candidate;
    }
    return best;
  }

  /// Runs one request of [OfflineEngine] (see its methods for the arguments).
  Object? handle(String operation, Map<String, Object?> arguments) {
    List<String> paths() => [
      for (final path in arguments['packs']! as List<Object?>) path! as String,
    ];
    double number(String key) => (arguments[key]! as num).toDouble();
    double? optional(String key) => (arguments[key] as num?)?.toDouble();
    switch (operation) {
      case 'route':
        return route(
          packs: paths(),
          profile: arguments['profile']! as String,
          stops: [
            for (final stop in arguments['stops']! as List<Object?>)
              if (stop case [final num longitude, final num latitude])
                (longitude: longitude.toDouble(), latitude: latitude.toDouble())
              else
                throw OfflineEngineException('failed', 'Invalid stop $stop'),
          ],
          alternatives: (arguments['alternatives']! as num).toInt(),
          language: arguments['language'] as String?,
        );
      case 'search':
        return search(
          packs: paths(),
          text: arguments['text']! as String,
          limit: (arguments['limit'] as num?)?.toInt() ?? 10,
          nearLatitude: optional('nearLatitude'),
          nearLongitude: optional('nearLongitude'),
        );
      case 'reverse':
        return reverse(
          packs: paths(),
          latitude: number('latitude'),
          longitude: number('longitude'),
        );
      case 'describe':
        return pack(arguments['path']! as String).header;
      case 'retain':
        retain(paths());
        return null;
    }
    throw OfflineEngineException('failed', 'Unknown operation $operation');
  }
}

/// The offline engine of the app: routes, place search and addresses calculated on the phone
/// with the downloaded offline packs, in a background isolate that keeps the packs loaded while
/// they are being used and stops after [idleTimeout] without requests (freeing their memory).
class OfflineEngine {
  OfflineEngine({this.idleTimeout = const Duration(minutes: 5)});

  final Duration idleTimeout;
  Future<_Worker>? _worker;
  Timer? _idle;
  var _active = 0;

  /// Route through [stops] ([longitude, latitude] pairs) on the smallest pack of [packs] that
  /// covers them: `{region, primary, alternatives}` with the routes as the platform's
  /// `RouteResult` JSON.
  Future<Map<String, Object?>> route({
    required List<String> packs,
    required String profile,
    required List<Stop> stops,
    int alternatives = 0,
    String? language,
  }) async =>
      (await _call('route', {
            'packs': packs,
            'profile': profile,
            'stops': [
              for (final stop in stops) [stop.longitude, stop.latitude],
            ],
            'alternatives': alternatives,
            'language': language,
          }))!
          as Map<String, Object?>;

  /// Results of `GET /geocoding/search` from the data of [packs].
  Future<List<Map<String, Object?>>> search({
    required List<String> packs,
    required String text,
    int limit = 10,
    double? nearLatitude,
    double? nearLongitude,
  }) async {
    final results = await _call('search', {
      'packs': packs,
      'text': text,
      'limit': limit,
      'nearLatitude': nearLatitude,
      'nearLongitude': nearLongitude,
    });
    return [for (final item in results! as List<Object?>) item! as Map<String, Object?>];
  }

  /// Result of `GET /geocoding/reverse` from the data of [packs].
  Future<Map<String, Object?>?> reverse({
    required List<String> packs,
    required double latitude,
    required double longitude,
  }) async =>
      await _call('reverse', {'packs': packs, 'latitude': latitude, 'longitude': longitude})
          as Map<String, Object?>?;

  /// Header of the pack at [path] (region, coverage, counts and sources).
  Future<Map<String, Object?>> describe(String path) async =>
      (await _call('describe', {'path': path}))! as Map<String, Object?>;

  /// Frees the packs that are not in [packs].
  Future<void> retain(List<String> packs) async {
    if (_worker == null) return;
    await _call('retain', {'packs': packs});
  }

  Future<void> dispose() async {
    _idle?.cancel();
    await _stop();
  }

  Future<Object?> _call(String operation, Map<String, Object?> arguments) async {
    _idle?.cancel();
    _active += 1;
    try {
      final starting = _worker ??= _Worker.spawn();
      final _Worker worker;
      try {
        worker = await starting;
      } catch (_) {
        if (identical(_worker, starting)) _worker = null;
        rethrow;
      }
      try {
        return await worker.call(operation, arguments);
      } on OfflineEngineException catch (error) {
        // A stopped isolate is replaced by the next request.
        if (error.code == 'failed' && worker.closed && identical(_worker, starting)) _worker = null;
        rethrow;
      }
    } finally {
      _active -= 1;
      if (_active == 0) _idle = Timer(idleTimeout, () => unawaited(_stop()));
    }
  }

  Future<void> _stop() async {
    final worker = _worker;
    _worker = null;
    if (worker == null) return;
    try {
      (await worker).close();
    } on Object {
      // It never started.
    }
  }
}

class _Worker {
  _Worker._(this._replies, this._exits) {
    _replies.listen(_onReply);
    _exits.listen((_) => _fail('The offline engine stopped unexpectedly'));
  }

  static Future<_Worker> spawn() async {
    final worker = _Worker._(ReceivePort(), ReceivePort());
    try {
      worker._isolate = await Isolate.spawn(
        _serve,
        worker._replies.sendPort,
        debugName: 'offline-engine',
        onExit: worker._exits.sendPort,
        onError: worker._exits.sendPort,
      );
      worker._commands = await worker._ready.future;
    } catch (error) {
      worker._fail('The offline engine could not start: $error');
      rethrow;
    }
    return worker;
  }

  final ReceivePort _replies;
  final ReceivePort _exits;
  Isolate? _isolate;
  late final SendPort _commands;
  final _ready = Completer<SendPort>();
  final _calls = <int, Completer<Object?>>{};
  var _next = 0;
  var closed = false;

  Future<Object?> call(String operation, Map<String, Object?> arguments) {
    if (closed) {
      return Future.error(const OfflineEngineException('failed', 'The offline engine stopped'));
    }
    final id = _next++;
    final completer = Completer<Object?>();
    _calls[id] = completer;
    _commands.send([id, operation, arguments]);
    return completer.future;
  }

  void close() {
    if (closed) return;
    _isolate?.kill(priority: Isolate.immediate);
    _fail('The offline engine stopped');
  }

  void _onReply(Object? message) {
    if (message is SendPort) {
      if (!_ready.isCompleted) _ready.complete(message);
      return;
    }
    final reply = message! as List<Object?>;
    final completer = _calls.remove(reply[0]! as int);
    if (completer == null) return;
    if (reply[1] == true) {
      completer.complete(reply[2]);
    } else {
      completer.completeError(OfflineEngineException(reply[2]! as String, reply[3]! as String));
    }
  }

  void _fail(String message) {
    if (closed) return;
    closed = true;
    final error = OfflineEngineException('failed', message);
    if (!_ready.isCompleted) _ready.completeError(error);
    for (final completer in _calls.values) {
      completer.completeError(error);
    }
    _calls.clear();
    _replies.close();
    _exits.close();
  }
}

/// Entry point of the engine isolate.
void _serve(SendPort replies) {
  final commands = ReceivePort();
  final packs = OfflinePackSet();
  replies.send(commands.sendPort);
  commands.listen((message) {
    final request = message! as List<Object?>;
    final id = request[0]! as int;
    try {
      final result = packs.handle(request[1]! as String, request[2]! as Map<String, Object?>);
      replies.send([id, true, result]);
    } on OfflineEngineException catch (error) {
      replies.send([id, false, error.code, error.message]);
    } on NoRouteError catch (error) {
      replies.send([id, false, 'no_route', error.message]);
    } on FormatException catch (error) {
      replies.send([id, false, 'invalid_pack', error.message]);
    } on FileSystemException catch (error) {
      replies.send([id, false, 'invalid_pack', error.message]);
    } catch (error) {
      replies.send([id, false, 'failed', '$error']);
    }
  });
}
