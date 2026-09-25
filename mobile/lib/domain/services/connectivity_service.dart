enum ConnectivityStatus { online, offline }

/// Whether the platform API is reachable. Having Wi-Fi or mobile data is not
/// enough: implementations confirm it with a real request.
abstract class ConnectivityService {
  ConnectivityStatus get status;

  /// Emits the current status first, then every change.
  Stream<ConnectivityStatus> watchStatus();

  /// Re-checks reachability now.
  Future<ConnectivityStatus> checkNow();

  /// A request failed with a network error: the status may be stale.
  void reportNetworkFailure();
}
