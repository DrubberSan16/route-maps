import '../entities/sync.dart';

/// Sends the changes queued offline (`sync_queue`) to the API and pulls the
/// changes made on other devices.
abstract class SynchronizationService {
  SyncState get state;

  Stream<SyncState> watchState();

  /// Queues an operation (it is sent on the next synchronization).
  Future<void> enqueue({
    required String entity,
    required String operation,
    required Map<String, Object?> payload,
  });

  /// Runs one round now (push, then pull). Concurrent calls share the round.
  Future<SyncReport> synchronize();

  /// Moves failed operations back to pending.
  Future<void> retryFailed();
}
