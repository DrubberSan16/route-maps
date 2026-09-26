import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/data/local/app_database.dart';
import 'package:maps_platform/data/local/sync_queue_store.dart';
import 'package:maps_platform/data/repositories/trip_repository_impl.dart';
import 'package:maps_platform/domain/entities/coordinate.dart';
import 'package:maps_platform/domain/entities/routing_profile.dart';
import 'package:maps_platform/domain/entities/sync.dart';
import 'package:maps_platform/domain/entities/trip.dart';

import '../helpers/database.dart';

void main() {
  late AppDatabase db;
  late TestClock clock;
  late SyncQueueStore queue;
  late TripRepositoryImpl trips;
  String? account;

  setUp(() {
    db = memoryDatabase();
    clock = TestClock();
    queue = SyncQueueStore(db, clock: clock.call);
    account = 'user-1';
    trips = TripRepositoryImpl(db: db, queue: queue, account: () => account, clock: clock.call);
  });

  tearDown(() => db.close());

  TrackingPoint point(String tripId, int second, double longitude, {double? speed}) =>
      TrackingPoint(
        tripId: tripId,
        coordinate: Coordinate(-2.17, longitude),
        recordedAt: DateTime.utc(2026, 9, 25, 12, 0, second),
        accuracy: 5,
        speed: speed,
      );

  test('a trip is recorded locally and queued in causal order', () async {
    final trip = await trips.startTrip(
      profile: RoutingProfile.car,
      name: 'Reparto',
      installationId: 'install-0001',
    );
    await trips.addPoint(point(trip.id, 0, -79.900));
    await trips.addPoint(point(trip.id, 5, -79.901, speed: -1)); // iOS: unknown speed
    await trips.addPoint(point(trip.id, 5, -79.901)); // same instant: ignored
    await trips.addPoint(point(trip.id, 10, -79.902));

    final active = (await trips.activeTrip())!;
    expect(active.pointCount, 3);
    expect(active.distanceMeters, closeTo(222.4, 1));

    final finished = await trips.finishTrip(trip.id);
    expect(finished.status, TripStatus.completed);
    expect(await trips.activeTrip(), isNull);

    final ops = await queue.nextBatch(accountId: 'user-1', limit: 10);
    expect(ops.map((op) => '${op.entity}:${op.operation}'), [
      'trip:CREATE',
      'tracking_point:CREATE',
      'trip:FINISH',
    ]);
    expect(ops.first.payload, containsPair('id', trip.id));
    expect(ops.first.payload, containsPair('name', 'Reparto'));
    expect(ops.first.payload.containsKey('routeId'), isFalse);
    final points = ops[1].payload['points']! as List<Object?>;
    expect(points, hasLength(3));
    final second = points[1]! as Map<String, Object?>;
    expect(second['timestamp'], '2026-09-25T12:00:05.000Z');
    expect(second.containsKey('speed'), isFalse, reason: 'out of range values are not sent');
    expect(ops.last.payload, {'id': trip.id, 'endedAt': '2026-09-25T12:00:00.000Z'});
  });

  test('points are queued in batches and only once', () async {
    final trip = await trips.startTrip(
      profile: RoutingProfile.bicycle,
      installationId: 'install-0001',
    );
    for (var i = 0; i < 7; i++) {
      await trips.addPoint(point(trip.id, i, -79.9 + i / 10000));
    }
    expect(await trips.queuePendingPoints(batchSize: 3), 7);
    expect(await trips.queuePendingPoints(batchSize: 3), 0);
    final ops = await queue.nextBatch(accountId: 'user-1', limit: 10);
    final batches = ops.where((op) => op.entity == SyncEntities.trackingPoint);
    expect(batches.map((op) => (op.payload['points']! as List).length), [3, 3, 1]);
  });

  test('each account lists its own trips; the one recording keeps its owner', () async {
    final first = await trips.startTrip(profile: RoutingProfile.car, installationId: 'install-1');
    await trips.addPoint(point(first.id, 0, -79.900));

    // user-1 logs out and user-2 logs in while the trip is still recording.
    account = 'user-2';
    expect(await trips.watchTrips().first, isEmpty);
    expect((await trips.activeTrip())?.id, first.id, reason: 'the device keeps recording it');
    await trips.addPoint(point(first.id, 5, -79.901));
    await trips.finishTrip(first.id);

    expect(await queue.nextBatch(accountId: 'user-2', limit: 10), isEmpty);
    final ops = await queue.nextBatch(accountId: 'user-1', limit: 10);
    expect(ops.map((op) => '${op.entity}:${op.operation}'), [
      'trip:CREATE',
      'tracking_point:CREATE',
      'trip:FINISH',
    ]);
    account = 'user-1';
    expect((await trips.watchTrips().first).single.pointCount, 2);
  });

  test('a cancelled trip no longer accepts points', () async {
    final trip = await trips.startTrip(profile: RoutingProfile.car, installationId: 'install-0001');
    await trips.addPoint(point(trip.id, 0, -79.9));
    final cancelled = await trips.cancelTrip(trip.id);
    expect(cancelled.status, TripStatus.cancelled);
    await trips.addPoint(point(trip.id, 9, -79.9));
    expect((await trips.watchTrips().first).single.pointCount, 1);
    final ops = await queue.nextBatch(accountId: 'user-1', limit: 10);
    expect(ops.last.operation, SyncOperations.cancel);
    expect(ops.last.payload, {'id': trip.id});
  });
}
