import 'dart:async';

import 'package:maps_platform/core/errors/app_exception.dart';
import 'package:maps_platform/core/utils/streams.dart';
import 'package:maps_platform/data/remote/session_store.dart';
import 'package:maps_platform/domain/entities/coordinate.dart';
import 'package:maps_platform/domain/entities/offline_route.dart';
import 'package:maps_platform/domain/entities/position.dart';
import 'package:maps_platform/domain/entities/route.dart';
import 'package:maps_platform/domain/entities/routing_profile.dart';
import 'package:maps_platform/domain/entities/sync.dart';
import 'package:maps_platform/domain/entities/user.dart';
import 'package:maps_platform/domain/repositories/auth_repository.dart';
import 'package:maps_platform/domain/repositories/saved_route_repository.dart';
import 'package:maps_platform/domain/services/connectivity_service.dart';
import 'package:maps_platform/domain/services/location_service.dart';
import 'package:maps_platform/domain/services/synchronization_service.dart';

class FakeConnectivityService implements ConnectivityService {
  FakeConnectivityService([this._status = ConnectivityStatus.online]);

  ConnectivityStatus _status;
  final _changes = StreamController<ConnectivityStatus>.broadcast();
  int failuresReported = 0;

  set status(ConnectivityStatus value) {
    _status = value;
    _changes.add(value);
  }

  @override
  ConnectivityStatus get status => _status;

  @override
  Stream<ConnectivityStatus> watchStatus() => currentAndChanges(() => _status, _changes.stream);

  @override
  Future<ConnectivityStatus> checkNow() async => _status;

  @override
  void reportNetworkFailure() => failuresReported++;
}

class FakeLocationService implements LocationService {
  FakeLocationService({this.position, this.access = LocationAccess.granted});

  Position? position;
  LocationAccess access;
  final positions = StreamController<Position>.broadcast();
  bool background = false;

  @override
  Future<LocationAccess> checkAccess() async => access;

  @override
  Future<LocationAccess> requestAccess() async => access;

  @override
  Future<void> openSettings(LocationAccess access) async {}

  @override
  Future<Position> getCurrentPosition() async {
    if (access != LocationAccess.granted) {
      throw AppException.of(ErrorCodes.locationPermissionDenied);
    }
    return position ?? (throw AppException.of(ErrorCodes.locationUnavailable));
  }

  @override
  Future<Position?> getLastKnownPosition() async => position;

  @override
  Stream<Position> watchPosition() => positions.stream;

  @override
  Future<void> setBackgroundUpdates(bool enabled) async => background = enabled;
}

Position fix(double latitude, double longitude, {double? accuracy = 5, DateTime? at}) => Position(
  coordinate: Coordinate(latitude, longitude),
  timestamp: (at ?? DateTime.utc(2026, 9, 25, 12)).toUtc(),
  accuracy: accuracy,
);

/// Saved routes kept in memory.
class InMemorySavedRouteRepository implements SavedRouteRepository {
  InMemorySavedRouteRepository([List<OfflineRoute> routes = const []]) : routes = [...routes];

  final List<OfflineRoute> routes;

  @override
  Future<List<OfflineRoute>> byProfile(RoutingProfile profile) async =>
      routes.where((route) => route.profile == profile).toList();

  @override
  Future<List<OfflineRoute>> getAll() async => routes;

  @override
  Future<OfflineRoute?> getById(String routeId) async =>
      routes.where((route) => route.routeId == routeId).firstOrNull;

  @override
  Stream<List<OfflineRoute>> watchAll() => Stream.value(routes);

  @override
  Future<OfflineRoute> save({
    required RouteResult result,
    required RouteOption option,
    required String name,
    String? regionId,
  }) async {
    final now = DateTime.utc(2026, 9, 25, 12);
    final route = OfflineRoute(
      routeId: 'saved-${routes.length + 1}',
      name: name,
      profile: result.profile,
      origin: result.origin,
      destination: result.destination,
      distanceMeters: option.distanceMeters,
      durationSeconds: option.durationSeconds,
      geometry: option.geometry,
      steps: option.steps,
      regionId: regionId,
      provider: result.provider,
      createdAt: now,
      updatedAt: now,
    );
    routes.add(route);
    return route;
  }

  @override
  Future<void> delete(String routeId) async =>
      routes.removeWhere((route) => route.routeId == routeId);

  @override
  Future<void> applyRemote({
    required List<OfflineRoute> routes,
    required List<String> deletedIds,
  }) async {}
}

class MemorySessionStore implements SessionStore {
  MemorySessionStore([this._current]);

  AuthSession? _current;
  final _changes = StreamController<AuthSession?>.broadcast();

  @override
  AuthSession? get current => _current;

  @override
  Stream<AuthSession?> get changes => _changes.stream;

  @override
  Future<AuthSession?> load() async => _current;

  @override
  Future<void> save(AuthSession session) async {
    _current = session;
    _changes.add(session);
  }

  @override
  Future<void> clear() async {
    _current = null;
    _changes.add(null);
  }
}

class FakeAuthRepository implements AuthRepository {
  FakeAuthRepository([this._session]);

  AuthSession? _session;
  final _changes = StreamController<AuthSession?>.broadcast();

  set session(AuthSession? value) {
    _session = value;
    _changes.add(value);
  }

  @override
  AuthSession? get currentSession => _session;

  @override
  Stream<AuthSession?> watchSession() => currentAndChanges(() => _session, _changes.stream);

  @override
  Future<void> restore() async {}

  @override
  Future<AuthSession> login({required String email, required String password}) async =>
      session = testSession;

  @override
  Future<AuthSession> register({
    required String email,
    required String password,
    required String name,
  }) async => session = testSession;

  @override
  Future<void> logout() async => session = null;
}

const testUser = UserProfile(id: 'user-1', email: 'demo@maps.local', name: 'Demo', role: 'USER');

const testSession = AuthSession(accessToken: 'access', refreshToken: 'refresh', user: testUser);

/// Records the operations queued for synchronization.
class RecordingSyncService implements SynchronizationService {
  final enqueued = <({String entity, String operation, Map<String, Object?> payload})>[];

  @override
  SyncState get state => const SyncState();

  @override
  Stream<SyncState> watchState() => Stream.value(state);

  @override
  Future<void> enqueue({
    required String entity,
    required String operation,
    required Map<String, Object?> payload,
  }) async => enqueued.add((entity: entity, operation: operation, payload: payload));

  @override
  Future<SyncReport> synchronize() async => const SyncReport();

  @override
  Future<void> retryFailed() async {}
}
