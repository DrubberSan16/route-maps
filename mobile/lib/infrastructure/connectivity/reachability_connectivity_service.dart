import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:dio/dio.dart';

import '../../domain/services/connectivity_service.dart';

/// Reports whether some network interface (Wi-Fi, mobile data...) is up.
abstract class NetworkMonitor {
  Future<bool> hasNetwork();

  Stream<bool> watchNetwork();
}

class ConnectivityPlusNetworkMonitor implements NetworkMonitor {
  ConnectivityPlusNetworkMonitor([Connectivity? connectivity])
    : _connectivity = connectivity ?? Connectivity();

  final Connectivity _connectivity;

  static bool _anyInterface(List<ConnectivityResult> results) =>
      results.any((result) => result != ConnectivityResult.none);

  @override
  Future<bool> hasNetwork() async => _anyInterface(await _connectivity.checkConnectivity());

  @override
  Stream<bool> watchNetwork() => _connectivity.onConnectivityChanged.map(_anyInterface).distinct();
}

/// Real reachability check: the platform must answer its liveness endpoint
/// with the expected JSON (a captive portal or a proxy error page does not).
typedef ReachabilityProbe = Future<bool> Function();

ReachabilityProbe healthProbe(Dio dio, Uri url) => () async {
  try {
    final response = await dio.getUri<Object?>(
      url,
      options: Options(
        responseType: ResponseType.json,
        sendTimeout: const Duration(seconds: 5),
        receiveTimeout: const Duration(seconds: 5),
        validateStatus: (_) => true,
      ),
    );
    final data = response.data;
    return response.statusCode == 200 && data is Map<String, Object?> && data['status'] == 'ok';
  } on DioException {
    // No route to the server: that is exactly what the probe measures.
    return false;
  }
};

/// [ConnectivityService] that does not trust the interface state alone: having
/// Wi-Fi does not mean having Internet, so every change is confirmed with
/// [ReachabilityProbe]. While a network exists but the API does not answer,
/// it keeps probing periodically.
class ReachabilityConnectivityService implements ConnectivityService {
  ReachabilityConnectivityService({
    required this._network,
    required this._probe,
    this.offlineRecheckInterval = const Duration(seconds: 20),
    this.onlineRecheckInterval = const Duration(minutes: 2),
  });

  final NetworkMonitor _network;
  final ReachabilityProbe _probe;
  final Duration offlineRecheckInterval;
  final Duration onlineRecheckInterval;

  final _changes = StreamController<ConnectivityStatus>.broadcast();
  ConnectivityStatus _status = ConnectivityStatus.offline;
  bool _checked = false;
  Future<ConnectivityStatus>? _inFlight;
  StreamSubscription<bool>? _networkSubscription;
  Timer? _timer;

  /// Subscribes to interface changes and runs the first check.
  Future<void> start() async {
    _networkSubscription ??= _network.watchNetwork().listen((_) => checkNow());
    await checkNow();
  }

  @override
  ConnectivityStatus get status => _status;

  /// Emits after the first check has completed, then every change.
  @override
  Stream<ConnectivityStatus> watchStatus() {
    late final StreamController<ConnectivityStatus> controller;
    StreamSubscription<ConnectivityStatus>? subscription;
    controller = StreamController<ConnectivityStatus>(
      onListen: () {
        if (_checked) controller.add(_status);
        subscription = _changes.stream.listen(controller.add);
      },
      onCancel: () => subscription?.cancel(),
    );
    return controller.stream;
  }

  @override
  Future<ConnectivityStatus> checkNow() =>
      _inFlight ??= _check().whenComplete(() => _inFlight = null);

  @override
  void reportNetworkFailure() {
    if (_status == ConnectivityStatus.online) checkNow();
  }

  Future<ConnectivityStatus> _check() async {
    final hasNetwork = await _network.hasNetwork();
    final reachable = hasNetwork && await _probe();
    final next = reachable ? ConnectivityStatus.online : ConnectivityStatus.offline;
    final changed = !_checked || next != _status;
    _status = next;
    _checked = true;
    if (changed && !_changes.isClosed) _changes.add(next);
    _schedule(hasNetwork);
    return next;
  }

  void _schedule(bool hasNetwork) {
    _timer?.cancel();
    final delay = switch (_status) {
      ConnectivityStatus.online => onlineRecheckInterval,
      // Network without Internet (captive portal, server down): retry soon.
      ConnectivityStatus.offline when hasNetwork => offlineRecheckInterval,
      // No interface at all: the next interface change triggers a check.
      ConnectivityStatus.offline => null,
    };
    if (delay != null) _timer = Timer(delay, checkNow);
  }

  Future<void> dispose() async {
    _timer?.cancel();
    await _networkSubscription?.cancel();
    await _changes.close();
  }
}
