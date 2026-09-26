import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import '../../core/errors/app_exception.dart';
import '../../core/utils/streams.dart';
import '../../core/utils/time.dart';
import '../../data/local/sync_queue_store.dart';
import '../../data/remote/api_client.dart';
import '../../domain/entities/offline_route.dart';
import '../../domain/entities/sync.dart';
import '../../domain/entities/user.dart';
import '../../domain/repositories/auth_repository.dart';
import '../../domain/repositories/saved_route_repository.dart';
import '../../domain/repositories/settings_repository.dart';
import '../../domain/repositories/trip_repository.dart';
import '../../domain/services/connectivity_service.dart';
import '../../domain/services/synchronization_service.dart';

/// Offline-first synchronization.
///
/// Every local change is stored together with an operation in `sync_queue`
/// (same transaction). A round pushes the queue in order to
/// `POST /api/v1/sync/push` and then pulls the changes made on other devices
/// (`GET /api/v1/sync/pull`). Operation ids are idempotency keys, so sending
/// an operation twice is harmless and nothing is lost when a round is
/// interrupted:
///
/// * APPLIED / DUPLICATE: completed;
/// * FAILED and retryable (server error, rate limit): retried with
///   exponential backoff, the rest of the queue waits behind it;
/// * FAILED and not retryable (rejected payload): kept as FAILED for the user
///   to see and retry;
/// * no connection or expired session: the batch goes back to pending
///   without counting an attempt.
///
/// Rounds start when the connection comes back, after login, shortly after
/// new operations are queued, every [periodicInterval] and on demand.
///
/// A round belongs to the account of the session that started it: it only
/// sends that account's operations, stores the pulled routes for it and stops
/// if another account logs in meanwhile.
class SyncService implements SynchronizationService {
  SyncService({
    required this._api,
    required this._queue,
    required this._trips,
    required this._savedRoutes,
    required this._auth,
    required this._connectivity,
    required this._settings,
    DateTime Function()? clock,
    this.batchSize = 100,
    this.maxBatchBytes = 1000 * 1000,
    this.maxAttempts = 10,
    this.periodicInterval = const Duration(minutes: 5),
    this.queueDebounce = const Duration(seconds: 2),
  }) : _clock = clock ?? DateTime.now;

  final ApiClient _api;
  final SyncQueueStore _queue;
  final TripRepository _trips;
  final SavedRouteRepository _savedRoutes;
  final AuthRepository _auth;
  final ConnectivityService _connectivity;
  final SettingsRepository _settings;
  final DateTime Function() _clock;

  /// Operations per push request (the API accepts up to 500).
  final int batchSize;

  /// Approximate JSON size of a push request (the API accepts 5 MB).
  final int maxBatchBytes;

  /// Attempts of an operation that keeps failing on the server before it is
  /// set aside as FAILED, so it cannot block the queue forever.
  final int maxAttempts;
  final Duration periodicInterval;
  final Duration queueDebounce;

  static const _lastSyncKey = 'sync.lastSyncAt';
  static const _pullCursorPrefix = 'sync.pullCursor.';

  /// Overlap of pull windows, so a change committed while a pull was being
  /// answered is not skipped (applying a route twice is harmless).
  static const _pullOverlap = Duration(seconds: 5);
  static const _maxPullPages = 50;

  final _states = StreamController<SyncState>.broadcast();
  final _subscriptions = <StreamSubscription<Object?>>[];
  StreamSubscription<({int pending, int failed})>? _counts;
  String? _countsAccount;
  SyncState _state = const SyncState();
  Future<SyncReport>? _round;
  bool _runAgain = false;
  bool _started = false;
  int _lastPending = 0;
  Timer? _periodic;
  Timer? _debounce;
  Timer? _retry;

  @override
  SyncState get state => _state;

  @override
  Stream<SyncState> watchState() => currentAndChanges(() => _state, _states.stream);

  /// Restores the last synchronization time and starts the triggers.
  Future<void> start() async {
    if (_started) return;
    _started = true;
    final lastSync = await _settings.read(_lastSyncKey);
    _emit(
      _state.copyWith(
        lastSyncAt: lastSync == null ? null : DateTime.parse(lastSync),
        isAuthenticated: _auth.currentSession != null,
      ),
    );
    _watchCounts(_account);
    _subscriptions
      ..add(
        _connectivity.watchStatus().listen((status) {
          if (status == ConnectivityStatus.online) _trigger();
        }),
      )
      ..add(_auth.watchSession().listen(_onSession));
    _periodic = Timer.periodic(periodicInterval, (_) => _trigger());
  }

  @override
  Future<void> enqueue({
    required String entity,
    required String operation,
    required Map<String, Object?> payload,
  }) async {
    await _queue.add(accountId: _account, entity: entity, operation: operation, payload: payload);
  }

  @override
  Future<void> retryFailed() async {
    await _queue.retryFailed(accountId: _account);
    _trigger();
  }

  @override
  Future<SyncReport> synchronize() {
    final running = _round;
    if (running != null) {
      // Changes queued during this round are sent by the next one.
      _runAgain = true;
      return running;
    }
    final round = _run();
    _round = round;
    return round.whenComplete(() {
      _round = null;
      if (_runAgain) {
        _runAgain = false;
        _trigger();
      }
    });
  }

  Future<void> dispose() async {
    _periodic?.cancel();
    _debounce?.cancel();
    _retry?.cancel();
    await _counts?.cancel();
    for (final subscription in _subscriptions) {
      await subscription.cancel();
    }
    await _states.close();
  }

  String? get _account => _auth.currentSession?.user.id;

  void _trigger() => unawaited(synchronize());

  /// Pending and failed counts shown to the user: those of the session's account.
  void _watchCounts(String? accountId) {
    if (_counts != null && accountId == _countsAccount) return;
    unawaited(_counts?.cancel());
    _countsAccount = accountId;
    _lastPending = 0;
    _counts = _queue.watchCounts(accountId: accountId).listen(_onCounts);
  }

  void _onCounts(({int pending, int failed}) counts) {
    final grew = counts.pending > _lastPending;
    _lastPending = counts.pending;
    _emit(_state.copyWith(pending: counts.pending, failed: counts.failed));
    if (grew) {
      _debounce?.cancel();
      _debounce = Timer(queueDebounce, _trigger);
    }
  }

  void _onSession(AuthSession? session) {
    final wasAuthenticated = _state.isAuthenticated;
    _watchCounts(session?.user.id);
    _emit(_state.copyWith(isAuthenticated: session != null));
    if (session != null && !wasAuthenticated) _trigger();
  }

  Future<SyncReport> _run() async {
    final accountId = _account;
    if (accountId == null) {
      return const SyncReport(skipped: SyncSkipReason.notAuthenticated);
    }
    if (_connectivity.status == ConnectivityStatus.offline) {
      return const SyncReport(skipped: SyncSkipReason.offline);
    }
    _retry?.cancel();
    _emit(_state.copyWith(isSyncing: true));
    var report = const SyncReport();
    AppException? error;
    try {
      await _queue.recoverInterrupted();
      await _trips.queuePendingPoints();
      final push = await _push(accountId);
      report = push.report;
      error = push.error;
      if (error == null) {
        final pulled = await _pull(accountId);
        report = SyncReport(
          completed: report.completed,
          failed: report.failed,
          retried: report.retried,
          pulledRoutes: pulled.routes,
          deletedRoutes: pulled.deleted,
        );
      }
      await _queue.purgeCompleted();
    } on AppException catch (exception) {
      error = exception;
    } on Object {
      // A defect, not a sync condition: leave a consistent state and report it.
      await _finishRound(
        const AppException(
          ErrorCodes.internalError,
          'La sincronización se detuvo por un error interno de la app.',
        ),
      );
      rethrow;
    }
    await _finishRound(error);
    return report;
  }

  Future<void> _finishRound(AppException? error) async {
    if (error?.isNetworkError ?? false) _connectivity.reportNetworkFailure();
    DateTime? lastSyncAt;
    if (error == null) {
      lastSyncAt = utcMillis(_clock());
      await _settings.write(_lastSyncKey, isoUtc(lastSyncAt));
    }
    _emit(
      _state.copyWith(
        isSyncing: false,
        lastSyncAt: lastSyncAt,
        lastError: error?.message,
        clearError: error == null,
        isAuthenticated: _auth.currentSession != null,
      ),
    );
    await _scheduleRetry();
  }

  /// Wakes up when the operation at the head of the queue may be retried.
  Future<void> _scheduleRetry() async {
    final accountId = _account;
    if (accountId == null) return;
    final next = await _queue.nextAttemptAt(accountId: accountId);
    if (next == null) return;
    final delay = next.difference(_clock().toUtc()) + const Duration(seconds: 1);
    _retry?.cancel();
    _retry = Timer(delay.isNegative ? Duration.zero : delay, _trigger);
  }

  Future<({SyncReport report, AppException? error})> _push(String accountId) async {
    final installationId = await _settings.installationId();
    var completed = 0, failed = 0, retried = 0;
    // After a request rejected as a whole, operations go one by one to find
    // the one the server does not accept.
    var oneByOne = 0;
    // Stops if another account logs in: its session must not send these.
    while (_account == accountId) {
      final batch = _limitSize(
        await _queue.nextBatch(accountId: accountId, limit: oneByOne > 0 ? 1 : batchSize),
      );
      if (batch.isEmpty) break;
      if (oneByOne > 0) oneByOne--;
      await _queue.markSyncing(batch.map((op) => op.id));

      final List<_OperationResult> results;
      try {
        results = await _api.post(
          'sync/push',
          _parseResults,
          body: {
            'installationId': installationId,
            'operations': [for (final op in batch) op.toApi()],
          },
        );
      } on AppException catch (error) {
        final status = error.statusCode;
        final rejectedAsWhole = status == 400 || status == 413;
        if (rejectedAsWhole && batch.length > 1) {
          await _queue.release(batch.map((op) => op.id));
          oneByOne = batch.length;
          continue;
        }
        if (rejectedAsWhole) {
          await _queue.markFailed(batch.single, error: _describe(error));
          failed++;
          continue;
        }
        if (error.isRetryable && !error.isNetworkError) {
          for (final op in batch) {
            await _queue.markRetry(op, error: _describe(error), delay: _retryDelay(op.retryCount));
          }
          retried += batch.length;
        } else {
          // No connection, expired session...: nothing was applied or the
          // server will report DUPLICATE next time; no attempt is counted.
          await _queue.release(batch.map((op) => op.id));
        }
        return (
          report: SyncReport(completed: completed, failed: failed, retried: retried),
          error: error,
        );
      }

      final pending = {for (final op in batch) op.id: op};
      final done = <String>[];
      var blocked = false;
      for (final result in results) {
        final op = pending.remove(result.id);
        if (op == null) continue;
        if (result.succeeded) {
          done.add(op.id);
          continue;
        }
        // Operations after a retried one may depend on it (points of a trip
        // whose creation failed): they are retried too, in order.
        final retry = (result.retryable || blocked) && op.retryCount + 1 < maxAttempts;
        if (retry) {
          await _queue.markRetry(op, error: result.error, delay: _retryDelay(op.retryCount));
          retried++;
          blocked = true;
        } else {
          await _queue.markFailed(op, error: result.error);
          failed++;
        }
      }
      await _queue.markCompleted(done);
      completed += done.length;
      if (pending.isNotEmpty) await _queue.release(pending.keys);
    }
    return (
      report: SyncReport(completed: completed, failed: failed, retried: retried),
      error: null,
    );
  }

  /// Keeps the first operations whose JSON fits in [maxBatchBytes] (always at
  /// least one).
  List<SyncOperation> _limitSize(List<SyncOperation> operations) {
    var bytes = 0;
    final batch = <SyncOperation>[];
    for (final op in operations) {
      bytes += utf8.encode(jsonEncode(op.toApi())).length;
      if (batch.isNotEmpty && bytes > maxBatchBytes) break;
      batch.add(op);
    }
    return batch;
  }

  /// Follows the change feed of saved routes from the cursor of [accountId].
  Future<({int routes, int deleted})> _pull(String accountId) async {
    final cursorKey = '$_pullCursorPrefix$accountId';
    var cursor = _PullCursor.decode(await _settings.read(cursorKey));
    DateTime? startedAt;
    var routes = 0, deleted = 0;
    for (var page = 0; page < _maxPullPages; page++) {
      if (_account != accountId) return (routes: routes, deleted: deleted);
      final changes = await _api.get('sync/pull', _parsePull, query: cursor?.toQuery());
      await _savedRoutes.applyRemote(
        accountId: accountId,
        routes: changes.routes,
        deletedIds: changes.deletedIds,
      );
      routes += changes.routes.length;
      deleted += changes.deletedIds.length;
      startedAt ??= changes.serverTime;
      final next = changes.next;
      if (!changes.hasMore || next == null) {
        // Up to date. The next pull starts a little before this one did.
        await _settings.write(
          cursorKey,
          _PullCursor(since: startedAt.subtract(_pullOverlap)).encode(),
        );
        return (routes: routes, deleted: deleted);
      }
      cursor = next;
    }
    // Too many pages for one round: continue from here next time.
    await _settings.write(cursorKey, cursor!.encode());
    return (routes: routes, deleted: deleted);
  }

  static Duration _retryDelay(int retryCount) =>
      Duration(seconds: math.min(5 * math.pow(2, retryCount).toInt(), 15 * 60));

  static String _describe(AppException error) => '${error.code}: ${error.message}';

  static List<_OperationResult> _parseResults(Object? data) => [
    for (final item in (data! as Map<String, Object?>)['results']! as List<Object?>)
      _OperationResult.fromJson(item! as Map<String, Object?>),
  ];

  static _PullChanges _parsePull(Object? data) {
    final json = data! as Map<String, Object?>;
    final next = json['next'] as Map<String, Object?>?;
    return _PullChanges(
      serverTime: DateTime.parse(json['serverTime']! as String),
      routes: [
        for (final route in json['routes']! as List<Object?>)
          OfflineRoute.fromApi(route! as Map<String, Object?>),
      ],
      deletedIds: [
        for (final id in (json['deletedRouteIds'] as List<Object?>?) ?? const []) id! as String,
      ],
      hasMore: json['hasMore'] == true,
      next: next == null
          ? null
          : _PullCursor(
              since: DateTime.parse(next['since']! as String),
              afterId: next['afterId']! as String,
            ),
    );
  }

  void _emit(SyncState next) {
    _state = next;
    if (!_states.isClosed) _states.add(next);
  }
}

class _OperationResult {
  const _OperationResult({
    required this.id,
    required this.succeeded,
    required this.retryable,
    required this.error,
  });

  factory _OperationResult.fromJson(Map<String, Object?> json) {
    final status = json['status']! as String;
    final error = json['error'] as Map<String, Object?>?;
    final details = error?['details'];
    return _OperationResult(
      id: json['id']! as String,
      succeeded: status == 'APPLIED' || status == 'DUPLICATE',
      retryable: json['retryable'] == true,
      error: error == null
          ? status
          : [
              '${error['code']}: ${error['message']}',
              if (details is List && details.isNotEmpty) details.join('; '),
            ].join(' | '),
    );
  }

  final String id;
  final bool succeeded;
  final bool retryable;
  final String error;
}

class _PullChanges {
  const _PullChanges({
    required this.serverTime,
    required this.routes,
    required this.deletedIds,
    required this.hasMore,
    required this.next,
  });

  final DateTime serverTime;
  final List<OfflineRoute> routes;
  final List<String> deletedIds;
  final bool hasMore;

  /// Where the following page starts.
  final _PullCursor? next;
}

/// Position in the change feed of `GET sync/pull`: the changes at or after
/// [since], or only those after [afterId] at that same instant when
/// continuing a page (changes of the same millisecond are never skipped).
class _PullCursor {
  const _PullCursor({required this.since, this.afterId});

  /// Stored as `<since>` or `<since> <afterId>`.
  static _PullCursor? decode(String? value) {
    if (value == null) return null;
    final parts = value.split(' ');
    return _PullCursor(
      since: DateTime.parse(parts.first),
      afterId: parts.length > 1 ? parts[1] : null,
    );
  }

  final DateTime since;
  final String? afterId;

  String encode() => [isoUtc(since), ?afterId].join(' ');

  Map<String, Object?> toQuery() => {'since': isoUtc(since), 'afterId': ?afterId};
}
