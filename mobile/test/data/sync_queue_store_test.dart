import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/data/local/app_database.dart';
import 'package:maps_platform/data/local/sync_queue_store.dart';
import 'package:maps_platform/domain/entities/sync.dart';

import '../helpers/database.dart';

void main() {
  late AppDatabase db;
  late TestClock clock;
  late SyncQueueStore queue;

  setUp(() {
    db = memoryDatabase();
    clock = TestClock();
    queue = SyncQueueStore(db, clock: clock.call);
  });

  tearDown(() => db.close());

  Future<String> add(String entity, [Map<String, Object?> payload = const {}]) =>
      queue.add(entity: entity, operation: SyncOperations.create, payload: payload);

  test('operations come out in the order they were queued', () async {
    final trip = await add(SyncEntities.trip, {'id': 't1'});
    final points = await add(SyncEntities.trackingPoint, {'points': []});
    // A clock moved backwards must not reorder the queue.
    clock.advance(const Duration(hours: -2));
    final finish = await add(SyncEntities.trip, {'id': 't1'});
    final batch = await queue.nextBatch(limit: 10);
    expect(batch.map((op) => op.id), [trip, points, finish]);
    expect(batch.first.status, SyncStatus.pending);
    expect(batch.first.payload, {'id': 't1'});
  });

  test('an operation waiting to be retried holds the ones behind it', () async {
    await add(SyncEntities.trip);
    await add(SyncEntities.trackingPoint);
    final head = (await queue.nextBatch(limit: 10)).first;
    await queue.markRetry(head, error: 'INTERNAL_ERROR', delay: const Duration(seconds: 30));

    expect(await queue.nextBatch(limit: 10), isEmpty);
    expect(await queue.nextAttemptAt(), clock.now.add(const Duration(seconds: 30)));

    clock.advance(const Duration(seconds: 31));
    final ready = await queue.nextBatch(limit: 10);
    expect(ready, hasLength(2));
    expect(ready.first.retryCount, 1);
    expect(ready.first.lastError, 'INTERNAL_ERROR');
  });

  test('failed operations leave the way free and can be retried by the user', () async {
    await add(SyncEntities.route);
    await add(SyncEntities.trip);
    final first = (await queue.nextBatch(limit: 10)).first;
    await queue.markFailed(first, error: 'VALIDATION_ERROR');

    expect((await queue.nextBatch(limit: 10)).map((op) => op.entity), [SyncEntities.trip]);
    expect((await queue.byStatus(SyncStatus.failed)).single.lastError, 'VALIDATION_ERROR');

    expect(await queue.retryFailed(), 1);
    expect(await queue.nextBatch(limit: 10), hasLength(2));
  });

  test('an interrupted round goes back to pending', () async {
    final id = await add(SyncEntities.trip);
    await queue.markSyncing([id]);
    expect(await queue.nextBatch(limit: 10), isEmpty);
    expect(await queue.recoverInterrupted(), 1);
    expect(await queue.nextBatch(limit: 10), hasLength(1));
  });

  test('completed operations are purged after a week', () async {
    final id = await add(SyncEntities.trip);
    await queue.markCompleted([id]);
    expect(await queue.purgeCompleted(), 0);
    clock.advance(const Duration(days: 8));
    expect(await queue.purgeCompleted(), 1);
  });

  test('counts pending and failed operations for the UI', () async {
    final counts = queue.watchCounts();
    await add(SyncEntities.trip);
    final second = await add(SyncEntities.route);
    await queue.markFailed((await queue.byStatus(SyncStatus.pending)).last, error: 'x');
    expect(second, isNotEmpty);
    await expectLater(counts, emitsThrough((pending: 1, failed: 1)));
  });

  test('knows when a route has a delete waiting to be sent', () async {
    await queue.add(
      entity: SyncEntities.route,
      operation: SyncOperations.delete,
      payload: {'id': 'r1'},
    );
    expect(await queue.hasUnsentRouteDelete('r1'), isTrue);
    expect(await queue.hasUnsentRouteDelete('r2'), isFalse);
  });
}
