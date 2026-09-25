import 'package:flutter/foundation.dart';

import '../../core/utils/time.dart';

export '../../core/utils/time.dart' show isoUtc;

/// States of a row in the local `sync_queue` table.
enum SyncStatus {
  pending('PENDING'),
  syncing('SYNCING'),
  completed('COMPLETED'),
  failed('FAILED');

  const SyncStatus(this.value);

  /// Value stored in the database.
  final String value;

  static SyncStatus fromValue(String value) => values.firstWhere((status) => status.value == value);
}

/// Entities accepted by `POST /api/v1/sync/push`.
abstract final class SyncEntities {
  static const trip = 'trip';
  static const trackingPoint = 'tracking_point';
  static const route = 'route';
  static const place = 'place';
  static const downloadedRegion = 'downloaded_region';
}

/// Operations accepted by `POST /api/v1/sync/push`.
abstract final class SyncOperations {
  static const create = 'CREATE';
  static const upsert = 'UPSERT';
  static const update = 'UPDATE';
  static const delete = 'DELETE';
  static const finish = 'FINISH';
  static const cancel = 'CANCEL';
}

/// A change made on the device that still has to reach the server.
@immutable
class SyncOperation {
  const SyncOperation({
    required this.id,
    required this.entity,
    required this.operation,
    required this.payload,
    required this.createdAt,
    required this.retryCount,
    required this.status,
    this.lastError,
    this.nextAttemptAt,
  });

  /// Client generated id; the server uses it as idempotency key.
  final String id;
  final String entity;
  final String operation;
  final Map<String, Object?> payload;
  final DateTime createdAt;
  final int retryCount;
  final SyncStatus status;
  final String? lastError;
  final DateTime? nextAttemptAt;

  Map<String, Object?> toApi() => {
    'id': id,
    'entity': entity,
    'operation': operation,
    'payload': payload,
    'createdAt': isoUtc(createdAt),
  };
}

/// Snapshot of the synchronization state for the UI.
@immutable
class SyncState {
  const SyncState({
    this.pending = 0,
    this.failed = 0,
    this.isSyncing = false,
    this.lastSyncAt,
    this.lastError,
    this.isAuthenticated = false,
  });

  final int pending;
  final int failed;
  final bool isSyncing;
  final DateTime? lastSyncAt;
  final String? lastError;
  final bool isAuthenticated;

  SyncState copyWith({
    int? pending,
    int? failed,
    bool? isSyncing,
    DateTime? lastSyncAt,
    String? lastError,
    bool clearError = false,
    bool? isAuthenticated,
  }) => SyncState(
    pending: pending ?? this.pending,
    failed: failed ?? this.failed,
    isSyncing: isSyncing ?? this.isSyncing,
    lastSyncAt: lastSyncAt ?? this.lastSyncAt,
    lastError: clearError ? null : lastError ?? this.lastError,
    isAuthenticated: isAuthenticated ?? this.isAuthenticated,
  );
}

/// Why a synchronization round did not run.
enum SyncSkipReason { notAuthenticated, offline }

/// Outcome of one synchronization round.
@immutable
class SyncReport {
  const SyncReport({
    this.completed = 0,
    this.failed = 0,
    this.retried = 0,
    this.pulledRoutes = 0,
    this.deletedRoutes = 0,
    this.skipped,
  });

  final int completed;
  final int failed;
  final int retried;
  final int pulledRoutes;
  final int deletedRoutes;
  final SyncSkipReason? skipped;

  bool get ran => skipped == null;
}
