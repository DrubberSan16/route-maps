import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/data/local/app_database.dart';
import 'package:maps_platform/data/local/sync_queue_store.dart';
import 'package:maps_platform/data/remote/api_client.dart';
import 'package:maps_platform/data/repositories/saved_route_repository_impl.dart';
import 'package:maps_platform/data/repositories/settings_repository_impl.dart';
import 'package:maps_platform/data/repositories/trip_repository_impl.dart';
import 'package:maps_platform/domain/entities/coordinate.dart';
import 'package:maps_platform/domain/entities/offline_route.dart';
import 'package:maps_platform/domain/entities/routing_profile.dart';
import 'package:maps_platform/domain/entities/sync.dart';
import 'package:maps_platform/domain/entities/trip.dart';
import 'package:maps_platform/domain/services/connectivity_service.dart';
import 'package:maps_platform/services/sync/sync_service.dart';

import '../helpers/api_stub.dart';
import '../helpers/async.dart';
import '../helpers/database.dart';
import '../helpers/fakes.dart';
import '../helpers/fixtures.dart';

typedef Operation = Map<String, Object?>;

void main() {
  late AppDatabase db;
  late TestClock clock;
  late SyncQueueStore queue;
  late TripRepositoryImpl trips;
  late SavedRouteRepositoryImpl savedRoutes;
  late SettingsRepositoryImpl settings;
  late FakeAuthRepository auth;
  late FakeConnectivityService connectivity;
  late StubAdapter adapter;
  late ApiClient api;
  late SyncService sync;

  /// Server behaviour for `POST sync/push` and `GET sync/pull`.
  late StubResponse Function(List<Operation> operations) onPush;
  late StubResponse Function(String? since) onPull;
  late List<List<Operation>> pushed;
  late List<String?> pulls;

  StubResponse results(List<Operation> operations, [String status = 'APPLIED']) => StubResponse.ok({
    'results': [
      for (final op in operations) {'id': op['id'], 'status': status},
    ],
    'serverTime': '2026-09-25T12:00:00.000Z',
  });

  StubResponse noChanges(String? since) => StubResponse.ok({
    'serverTime': '2026-09-25T12:00:00.000Z',
    'routes': <Object?>[],
    'deletedRouteIds': <Object?>[],
    'hasMore': false,
  });

  SyncService createService({int batchSize = 100}) => SyncService(
    api: api,
    queue: queue,
    trips: trips,
    savedRoutes: savedRoutes,
    auth: auth,
    connectivity: connectivity,
    settings: settings,
    clock: clock.call,
    batchSize: batchSize,
    queueDebounce: const Duration(milliseconds: 20),
    periodicInterval: const Duration(hours: 1),
  );

  setUp(() {
    db = memoryDatabase();
    clock = TestClock();
    queue = SyncQueueStore(db, clock: clock.call);
    trips = TripRepositoryImpl(db: db, queue: queue, clock: clock.call);
    savedRoutes = SavedRouteRepositoryImpl(db: db, queue: queue, clock: clock.call);
    settings = SettingsRepositoryImpl(db);
    auth = FakeAuthRepository(testSession);
    connectivity = FakeConnectivityService();
    pushed = [];
    pulls = [];
    onPush = results;
    onPull = noChanges;
    final stub = stubApi((request) {
      switch (request.path) {
        case 'sync/push':
          final body = request.data as Map<String, Object?>;
          final operations = (body['operations']! as List<Object?>).cast<Operation>();
          expect(body['installationId'], isA<String>());
          pushed.add(operations);
          return onPush(operations);
        case 'sync/pull':
          final since = request.queryParameters['since'] as String?;
          pulls.add(since);
          return onPull(since);
        default:
          return StubResponse.error(404, 'NOT_FOUND', 'No encontrado');
      }
    });
    adapter = stub.adapter;
    api = stub.api;
    sync = createService();
  });

  tearDown(() async {
    await sync.dispose();
    await db.close();
  });

  /// A completed trip: CREATE, one batch of points, FINISH.
  Future<Trip> recordTrip() async {
    final trip = await trips.startTrip(profile: RoutingProfile.car, installationId: 'install-1');
    for (var i = 0; i < 2; i++) {
      await trips.addPoint(
        TrackingPoint(
          tripId: trip.id,
          coordinate: Coordinate(-2.17, -79.90 - i / 1000),
          recordedAt: DateTime.utc(2026, 9, 25, 12, 0, i * 5),
          accuracy: 5,
        ),
      );
    }
    return trips.finishTrip(trip.id);
  }

  List<String> entities(List<Operation> operations) => [
    for (final op in operations) '${op['entity']}:${op['operation']}',
  ];

  test('nothing is sent without a session', () async {
    auth = FakeAuthRepository();
    await sync.dispose();
    sync = createService();
    await recordTrip();
    final report = await sync.synchronize();
    expect(report.skipped, SyncSkipReason.notAuthenticated);
    expect(adapter.requests, isEmpty);
  });

  test('nothing is sent without connection', () async {
    connectivity.status = ConnectivityStatus.offline;
    await recordTrip();
    final report = await sync.synchronize();
    expect(report.skipped, SyncSkipReason.offline);
    expect(adapter.requests, isEmpty);
    expect(await queue.nextBatch(limit: 10), hasLength(3));
  });

  test('sends the queue in order and brings the routes saved on other devices', () async {
    await recordTrip();
    onPull = (_) => StubResponse(200, json: loadFixture('sync_pull_response'));

    final report = await sync.synchronize();

    expect(pushed, hasLength(1));
    expect(entities(pushed.single), ['trip:CREATE', 'tracking_point:CREATE', 'trip:FINISH']);
    expect(report.completed, 3);
    expect(report.pulledRoutes, 1);
    expect(await queue.nextBatch(limit: 10), isEmpty);
    expect((await savedRoutes.getAll()).single.name, 'Casa → Oficina');
    expect(sync.state.lastSyncAt, clock.now);
    expect(sync.state.lastError, isNull);
    expect(await settings.read('sync.lastSyncAt'), '2026-09-25T12:00:00.000Z');
    // Next pull starts shortly before the server time of this one.
    expect(await settings.read('sync.pullCursor.user-1'), '2026-09-25T19:34:29.918Z');
  });

  test('the same installation id is sent in every round', () async {
    await recordTrip();
    await sync.synchronize();
    await recordTrip();
    await sync.synchronize();
    final ids = [for (final request in adapter.requests) (request.data as Map?)?['installationId']];
    expect(ids.whereType<String>().toSet(), hasLength(1));
  });

  test('a retryable failure is retried later and holds what depends on it', () async {
    await recordTrip();
    onPush = (operations) => StubResponse.ok({
      'results': [
        {
          'id': operations[0]['id'],
          'status': 'FAILED',
          'retryable': true,
          'error': {'code': 'INTERNAL_ERROR', 'message': 'Database unavailable'},
        },
        for (final op in operations.skip(1))
          {
            'id': op['id'],
            'status': 'FAILED',
            'retryable': false,
            'error': {'code': 'TRIP_NOT_FOUND', 'message': 'Trip not found'},
          },
      ],
      'serverTime': '2026-09-25T12:00:00.000Z',
    });

    final first = await sync.synchronize();
    expect(first.retried, 3, reason: 'the points and the finish wait for the trip');
    expect(first.failed, 0);
    expect(await queue.nextBatch(limit: 10), isEmpty);
    expect(await queue.nextAttemptAt(), clock.now.add(const Duration(seconds: 5)));

    // Before the backoff expires nothing is sent.
    await sync.synchronize();
    expect(pushed, hasLength(1));

    clock.advance(const Duration(seconds: 6));
    onPush = results;
    final second = await sync.synchronize();
    expect(second.completed, 3);
    expect(entities(pushed.last), ['trip:CREATE', 'tracking_point:CREATE', 'trip:FINISH']);
  });

  test('an operation rejected by the server is set aside and does not block the rest', () async {
    await queue.add(entity: SyncEntities.place, operation: SyncOperations.create, payload: {});
    await recordTrip();
    onPush = (operations) => StubResponse.ok({
      'results': [
        {
          'id': operations[0]['id'],
          'status': 'FAILED',
          'retryable': false,
          'error': {
            'code': 'VALIDATION_ERROR',
            'message': 'Invalid operation payload',
            'details': ['name must be a string'],
          },
        },
        for (final op in operations.skip(1)) {'id': op['id'], 'status': 'APPLIED'},
      ],
      'serverTime': '2026-09-25T12:00:00.000Z',
    });

    final report = await sync.synchronize();

    expect(report.failed, 1);
    expect(report.completed, 3);
    final failed = (await queue.byStatus(SyncStatus.failed)).single;
    expect(failed.entity, SyncEntities.place);
    expect(failed.lastError, contains('VALIDATION_ERROR'));
    expect(failed.lastError, contains('name must be a string'));
  });

  test('a duplicate is a success: the server already had the operation', () async {
    await recordTrip();
    onPush = (operations) => results(operations, 'DUPLICATE');
    expect((await sync.synchronize()).completed, 3);
  });

  test('without connection the batch waits without counting an attempt', () async {
    await recordTrip();
    onPush = (_) => throw StateError('unused');
    adapter.handler = (request) => throwConnectionError(request);

    final report = await sync.synchronize();

    expect(report.completed, 0);
    final waiting = await queue.nextBatch(limit: 10);
    expect(waiting, hasLength(3));
    expect(waiting.every((op) => op.retryCount == 0), isTrue);
    expect(connectivity.failuresReported, greaterThan(0));
    expect(sync.state.lastError, 'No hay conexión con el servidor.');
    expect(sync.state.lastSyncAt, isNull);
    expect(await settings.read('sync.lastSyncAt'), isNull);
  });

  test('a server outage is retried with backoff and the pull waits', () async {
    await recordTrip();
    onPush = (_) => const StubResponse(503, text: '<html>503 Service Unavailable</html>');

    final report = await sync.synchronize();

    expect(report.retried, 3);
    expect(pulls, isEmpty);
    expect(sync.state.lastError, 'El servidor no está disponible (HTTP 503).');
    expect(await queue.nextAttemptAt(), isNotNull);
  });

  test('a request rejected as a whole is split to find the operation at fault', () async {
    final ids = [
      await queue.add(
        entity: SyncEntities.route,
        operation: SyncOperations.delete,
        payload: {'id': 'r1'},
      ),
      await queue.add(
        entity: SyncEntities.route,
        operation: SyncOperations.delete,
        payload: {'id': 'bad'},
      ),
      await queue.add(
        entity: SyncEntities.route,
        operation: SyncOperations.delete,
        payload: {'id': 'r3'},
      ),
    ];
    onPush = (operations) {
      final hasBad = operations.any((op) => (op['payload']! as Map)['id'] == 'bad');
      return hasBad
          ? StubResponse.error(400, 'VALIDATION_ERROR', 'Invalid request body')
          : results(operations);
    };

    final report = await sync.synchronize();

    expect(pushed.map((batch) => batch.length), [3, 1, 1, 1]);
    expect(report.completed, 2);
    expect(report.failed, 1);
    expect((await queue.byStatus(SyncStatus.failed)).single.id, ids[1]);
  });

  test('large queues are sent in several requests, in order', () async {
    await sync.dispose();
    sync = createService(batchSize: 2);
    for (var i = 0; i < 5; i++) {
      await queue.add(
        entity: SyncEntities.route,
        operation: SyncOperations.delete,
        payload: {'id': 'r$i'},
      );
    }
    expect((await sync.synchronize()).completed, 5);
    expect(pushed.map((batch) => batch.length), [2, 2, 1]);
    expect(
      [
        for (final batch in pushed)
          for (final op in batch) (op['payload']! as Map)['id'],
      ],
      ['r0', 'r1', 'r2', 'r3', 'r4'],
    );
  });

  test('the pull follows pages and remembers where it stopped', () async {
    Map<String, Object?> route(String id, String updatedAt) => {
      'id': id,
      'name': 'Ruta $id',
      'profile': 'CAR',
      'origin': {'latitude': -2.17, 'longitude': -79.90},
      'destination': {'latitude': -2.18, 'longitude': -79.91},
      'distanceMeters': 1500,
      'durationSeconds': 180,
      'geometry': {
        'type': 'LineString',
        'coordinates': [
          [-79.90, -2.17],
          [-79.91, -2.18],
        ],
      },
      'steps': <Object?>[],
      'regionCode': 'guayaquil',
      'provider': 'valhalla',
      'createdAt': updatedAt,
      'updatedAt': updatedAt,
    };
    await savedRoutes.applyRemote(
      routes: [OfflineRoute.fromApi(route('old', '2026-09-01T00:00:00.000Z'))],
      deletedIds: const [],
    );
    onPull = (since) => switch (since) {
      null => StubResponse.ok({
        'serverTime': '2026-09-25T12:00:00.000Z',
        'routes': [route('a', '2026-09-20T10:00:00.000Z')],
        'deletedRouteIds': <Object?>[],
        'hasMore': true,
      }),
      '2026-09-20T10:00:00.000Z' => StubResponse.ok({
        'serverTime': '2026-09-25T12:00:00.000Z',
        'routes': [route('b', '2026-09-21T10:00:00.000Z')],
        'deletedRouteIds': ['old'],
        'hasMore': false,
      }),
      _ => noChanges(since),
    };

    final report = await sync.synchronize();

    expect(pulls, [null, '2026-09-20T10:00:00.000Z']);
    expect(report.pulledRoutes, 2);
    expect(report.deletedRoutes, 1);
    expect((await savedRoutes.getAll()).map((r) => r.routeId).toSet(), {'a', 'b'});

    await sync.synchronize();
    expect(pulls.last, '2026-09-25T11:59:55.000Z');
  });

  test('a route deleted here and not sent yet is not brought back by the server', () async {
    final remote = OfflineRoute.fromApi(
      ((fixtureData('sync_pull_response')! as Map<String, Object?>)['routes']! as List<Object?>)
              .first!
          as Map<String, Object?>,
    );
    await savedRoutes.applyRemote(routes: [remote], deletedIds: const []);
    await savedRoutes.delete(remote.routeId);
    // The delete cannot be applied yet (the server is busy) but the pull runs.
    onPush = (operations) => StubResponse.ok({
      'results': [
        for (final op in operations)
          {
            'id': op['id'],
            'status': 'FAILED',
            'retryable': true,
            'error': {'code': 'INTERNAL_ERROR', 'message': 'Busy'},
          },
      ],
      'serverTime': '2026-09-25T12:00:00.000Z',
    });
    onPull = (_) => StubResponse(200, json: loadFixture('sync_pull_response'));

    await sync.synchronize();

    expect(pulls, hasLength(1));
    expect(await savedRoutes.getAll(), isEmpty);
  });

  test('concurrent requests share one round at a time', () async {
    await recordTrip();
    var inFlight = 0, maxInFlight = 0;
    adapter.handler = (request) async {
      inFlight++;
      maxInFlight = inFlight > maxInFlight ? inFlight : maxInFlight;
      await Future<void>.delayed(const Duration(milliseconds: 20));
      inFlight--;
      return request.path == 'sync/push'
          ? results(((request.data as Map)['operations'] as List).cast<Operation>())
          : noChanges(null);
    };
    await Future.wait([sync.synchronize(), sync.synchronize(), sync.synchronize()]);
    // The extra calls asked for one more round; wait for it to end.
    await eventually(() => !sync.state.isSyncing && adapter.requests.length >= 3);
    await sync.synchronize();
    expect(maxInFlight, 1);
  });

  test('connection coming back and new operations start a round by themselves', () async {
    connectivity.status = ConnectivityStatus.offline;
    await sync.start();
    await recordTrip();
    await Future<void>.delayed(const Duration(milliseconds: 60));
    expect(pushed, isEmpty);

    connectivity.status = ConnectivityStatus.online;
    await eventually(() => pushed.isNotEmpty && !sync.state.isSyncing);
    expect(sync.state.pending, 0);

    await recordTrip();
    await eventually(() => pushed.length >= 2 && !sync.state.isSyncing);
    await eventually(() => sync.state.pending == 0);
  });

  test('logging in starts a round', () async {
    final loggedOut = FakeAuthRepository();
    auth = loggedOut;
    await sync.dispose();
    sync = createService();
    await recordTrip();
    await sync.start();
    expect(sync.state.isAuthenticated, isFalse);
    loggedOut.session = testSession;
    await eventually(() => pushed.isNotEmpty && !sync.state.isSyncing);
    expect(sync.state.isAuthenticated, isTrue);
  });
}
