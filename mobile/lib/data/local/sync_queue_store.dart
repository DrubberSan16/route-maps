import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:uuid/uuid.dart';

import '../../core/utils/time.dart';
import '../../domain/entities/sync.dart';
import 'app_database.dart';

/// Access to the `sync_queue` table. Repositories call [add] inside their own
/// transactions, so a local change and its queued operation are stored
/// atomically (no change is lost if the app dies in between).
class SyncQueueStore {
  SyncQueueStore(this._db, {this._uuid = const Uuid(), DateTime Function()? clock})
    : _clock = clock ?? DateTime.now;

  final AppDatabase _db;
  final Uuid _uuid;
  final DateTime Function() _clock;

  $SyncQueueTable get _table => _db.syncQueue;

  Future<String> add({
    required String entity,
    required String operation,
    required Map<String, Object?> payload,
  }) async {
    final id = _uuid.v4();
    await _db
        .into(_table)
        .insert(
          SyncQueueCompanion.insert(
            id: id,
            entity: entity,
            operation: operation,
            payload: jsonEncode(payload),
            createdAt: utcMillis(_clock()),
            status: SyncStatus.pending,
          ),
        );
    return id;
  }

  /// Pending operations in queue order, up to the first one that is still
  /// waiting for its next attempt: later operations may depend on it (a trip
  /// must reach the server before its points), so they wait too.
  Future<List<SyncOperation>> nextBatch({required int limit}) async {
    final now = utcMillis(_clock());
    final ready = <SyncOperation>[];
    for (final row in await _pendingQuery(limit).get()) {
      final nextAttempt = row.nextAttemptAt;
      if (nextAttempt != null && nextAttempt.isAfter(now)) break;
      ready.add(_toOperation(row));
    }
    return ready;
  }

  /// When the operation at the head of the queue may be retried (null when
  /// it can be sent now or the queue is empty).
  Future<DateTime?> nextAttemptAt() async {
    final head = await _pendingQuery(1).getSingleOrNull();
    final nextAttempt = head?.nextAttemptAt;
    return nextAttempt != null && nextAttempt.isAfter(utcMillis(_clock())) ? nextAttempt : null;
  }

  SimpleSelectStatement<$SyncQueueTable, SyncQueueRow> _pendingQuery(int limit) =>
      _db.select(_table)
        ..where((t) => t.status.equalsValue(SyncStatus.pending))
        // Insertion order (rowid), not createdAt: a clock change on the device
        // must not send an operation before the ones it depends on.
        ..orderBy([(t) => OrderingTerm.asc(t.rowId)])
        ..limit(limit);

  Future<List<SyncOperation>> byStatus(SyncStatus status, {int limit = 100}) async {
    final query = _db.select(_table)
      ..where((t) => t.status.equalsValue(status))
      ..orderBy([(t) => OrderingTerm.asc(t.rowId)])
      ..limit(limit);
    return (await query.get()).map(_toOperation).toList();
  }

  Future<void> markSyncing(Iterable<String> ids) => _setStatus(ids, SyncStatus.syncing);

  /// Back to pending without counting an attempt (e.g. the request never left).
  Future<void> release(Iterable<String> ids) => _setStatus(ids, SyncStatus.pending);

  Future<void> markCompleted(Iterable<String> ids) =>
      (_db.update(_table)..where((t) => t.id.isIn(ids))).write(
        SyncQueueCompanion(
          status: const Value(SyncStatus.completed),
          completedAt: Value(utcMillis(_clock())),
          lastError: const Value(null),
        ),
      );

  /// Schedules another attempt after [delay].
  Future<void> markRetry(
    SyncOperation operation, {
    required String error,
    required Duration delay,
  }) => (_db.update(_table)..where((t) => t.id.equals(operation.id))).write(
    SyncQueueCompanion(
      status: const Value(SyncStatus.pending),
      retryCount: Value(operation.retryCount + 1),
      lastError: Value(error),
      nextAttemptAt: Value(utcMillis(_clock()).add(delay)),
    ),
  );

  /// Permanent failure: the server rejected the operation.
  Future<void> markFailed(SyncOperation operation, {required String error}) =>
      (_db.update(_table)..where((t) => t.id.equals(operation.id))).write(
        SyncQueueCompanion(
          status: const Value(SyncStatus.failed),
          retryCount: Value(operation.retryCount + 1),
          lastError: Value(error),
        ),
      );

  /// Operations left in SYNCING by an interrupted round go back to pending.
  Future<int> recoverInterrupted() =>
      (_db.update(_table)..where((t) => t.status.equalsValue(SyncStatus.syncing))).write(
        const SyncQueueCompanion(status: Value(SyncStatus.pending)),
      );

  Future<int> retryFailed() =>
      (_db.update(_table)..where((t) => t.status.equalsValue(SyncStatus.failed))).write(
        const SyncQueueCompanion(
          status: Value(SyncStatus.pending),
          retryCount: Value(0),
          nextAttemptAt: Value(null),
        ),
      );

  /// Deletes completed operations older than [age].
  Future<int> purgeCompleted({Duration age = const Duration(days: 7)}) {
    final limit = utcMillis(_clock()).subtract(age);
    return (_db.delete(_table)..where(
          (t) =>
              t.status.equalsValue(SyncStatus.completed) & t.completedAt.isSmallerThanValue(limit),
        ))
        .go();
  }

  /// Whether an unsent `route:DELETE` exists for [routeId].
  Future<bool> hasUnsentRouteDelete(String routeId) async {
    final rows = await _db
        .customSelect(
          "SELECT 1 FROM sync_queue WHERE entity = 'route' AND operation = 'DELETE' "
          "AND status <> 'COMPLETED' AND json_extract(payload, '\$.id') = ? LIMIT 1",
          variables: [Variable.withString(routeId)],
          readsFrom: {_table},
        )
        .get();
    return rows.isNotEmpty;
  }

  /// Number of pending (including in-flight) and failed operations.
  Stream<({int pending, int failed})> watchCounts() {
    final count = _table.id.count();
    final query = _db.selectOnly(_table)
      ..addColumns([_table.status, count])
      ..groupBy([_table.status]);
    return query.watch().map((rows) {
      var pending = 0, failed = 0;
      for (final row in rows) {
        final status = row.readWithConverter<SyncStatus, String>(_table.status);
        final n = row.read(count) ?? 0;
        if (status == SyncStatus.pending || status == SyncStatus.syncing) pending += n;
        if (status == SyncStatus.failed) failed += n;
      }
      return (pending: pending, failed: failed);
    });
  }

  Future<void> _setStatus(Iterable<String> ids, SyncStatus status) => (_db.update(
    _table,
  )..where((t) => t.id.isIn(ids))).write(SyncQueueCompanion(status: Value(status)));

  SyncOperation _toOperation(SyncQueueRow row) => SyncOperation(
    id: row.id,
    entity: row.entity,
    operation: row.operation,
    payload: jsonDecode(row.payload) as Map<String, Object?>,
    createdAt: row.createdAt,
    retryCount: row.retryCount,
    status: row.status,
    lastError: row.lastError,
    nextAttemptAt: row.nextAttemptAt,
  );
}
