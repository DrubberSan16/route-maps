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

  const account = 'user-1';

  Future<String> add(
    String entity, [
    Map<String, Object?> payload = const {},
    String? accountId = account,
  ]) => queue.add(
    accountId: accountId,
    entity: entity,
    operation: SyncOperations.create,
    payload: payload,
  );

  Future<List<SyncOperation>> nextBatch([String accountId = account]) =>
      queue.nextBatch(accountId: accountId, limit: 10);

  test('operations come out in the order they were queued', () async {
    final trip = await add(SyncEntities.trip, {'id': 't1'});
    final points = await add(SyncEntities.trackingPoint, {'points': []});
    // A clock moved backwards must not reorder the queue.
    clock.advance(const Duration(hours: -2));
    final finish = await add(SyncEntities.trip, {'id': 't1'});
    final batch = await nextBatch();
    expect(batch.map((op) => op.id), [trip, points, finish]);
    expect(batch.first.status, SyncStatus.pending);
    expect(batch.first.payload, {'id': 't1'});
  });

  test('an operation waiting to be retried holds the ones behind it', () async {
    await add(SyncEntities.trip);
    await add(SyncEntities.trackingPoint);
    final head = (await nextBatch()).first;
    await queue.markRetry(head, error: 'INTERNAL_ERROR', delay: const Duration(seconds: 30));

    expect(await nextBatch(), isEmpty);
    expect(
      await queue.nextAttemptAt(accountId: account),
      clock.now.add(const Duration(seconds: 30)),
    );

    clock.advance(const Duration(seconds: 31));
    final ready = await nextBatch();
    expect(ready, hasLength(2));
    expect(ready.first.retryCount, 1);
    expect(ready.first.lastError, 'INTERNAL_ERROR');
  });

  test('failed operations leave the way free and can be retried by the user', () async {
    await add(SyncEntities.route);
    await add(SyncEntities.trip);
    final first = (await nextBatch()).first;
    await queue.markFailed(first, error: 'VALIDATION_ERROR');

    expect((await nextBatch()).map((op) => op.entity), [SyncEntities.trip]);
    expect(
      (await queue.byStatus(SyncStatus.failed, accountId: account)).single.lastError,
      'VALIDATION_ERROR',
    );

    expect(await queue.retryFailed(accountId: account), 1);
    expect(await nextBatch(), hasLength(2));
  });

  test('an interrupted round goes back to pending', () async {
    final id = await add(SyncEntities.trip);
    await queue.markSyncing([id]);
    expect(await nextBatch(), isEmpty);
    expect(await queue.recoverInterrupted(), 1);
    expect(await nextBatch(), hasLength(1));
  });

  test('completed operations are purged after a week', () async {
    final id = await add(SyncEntities.trip);
    await queue.markCompleted([id]);
    expect(await queue.purgeCompleted(), 0);
    clock.advance(const Duration(days: 8));
    expect(await queue.purgeCompleted(), 1);
  });

  test('counts pending and failed operations for the UI', () async {
    final counts = queue.watchCounts(accountId: account);
    await add(SyncEntities.trip);
    final second = await add(SyncEntities.route);
    await queue.markFailed(
      (await queue.byStatus(SyncStatus.pending, accountId: account)).last,
      error: 'x',
    );
    expect(second, isNotEmpty);
    await expectLater(counts, emitsThrough((pending: 1, failed: 1)));
  });

  test('each account only sends, counts and retries its own operations', () async {
    final mine = await add(SyncEntities.trip, {'id': 't1'});
    final theirs = await add(SyncEntities.trip, {'id': 't2'}, 'user-2');
    final guest = await add(SyncEntities.trip, {'id': 't3'}, null);

    expect((await nextBatch()).map((op) => op.id), [mine]);
    expect((await nextBatch('user-2')).map((op) => op.id), [theirs]);

    await queue.markFailed((await nextBatch('user-2')).single, error: 'x');
    expect(await queue.byStatus(SyncStatus.failed, accountId: account), isEmpty);
    expect(await queue.retryFailed(accountId: account), 0);
    expect(await queue.retryFailed(accountId: 'user-2'), 1);
    await expectLater(
      queue.watchCounts(accountId: null),
      emits((pending: 1, failed: 0)),
      reason: 'operations made without an account wait for one',
    );

    await db.adoptGuestData(account);
    expect((await nextBatch()).map((op) => op.id), [mine, guest]);
  });

  test('knows when a route has a delete waiting to be sent', () async {
    await queue.add(
      accountId: account,
      entity: SyncEntities.route,
      operation: SyncOperations.delete,
      payload: {'id': 'r1'},
    );
    expect(await queue.hasUnsentRouteDelete('r1'), isTrue);
    expect(await queue.hasUnsentRouteDelete('r2'), isFalse);
  });
}
