import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/data/local/app_database.dart';
import 'package:maps_platform/data/local/sync_queue_store.dart';
import 'package:maps_platform/data/repositories/auth_repository_impl.dart';
import 'package:maps_platform/data/repositories/saved_route_repository_impl.dart';
import 'package:maps_platform/data/repositories/trip_repository_impl.dart';
import 'package:maps_platform/domain/entities/coordinate.dart';
import 'package:maps_platform/domain/entities/offline_route.dart';
import 'package:maps_platform/domain/entities/route.dart';
import 'package:maps_platform/domain/entities/routing_profile.dart';
import 'package:maps_platform/domain/entities/sync.dart';

import '../helpers/api_stub.dart';
import '../helpers/database.dart';
import '../helpers/fakes.dart';

const _origin = Coordinate(-2.1962, -79.8862);
const _destination = Coordinate(-2.1894, -79.8975);

final _result = RouteResult(
  profile: RoutingProfile.car,
  provider: 'valhalla',
  source: RouteSource.server,
  routes: const [
    RouteOption(
      routeId: 'r',
      type: RouteType.primary,
      distanceMeters: 1500,
      durationSeconds: 180,
      geometry: [_origin, _destination],
      steps: [],
    ),
  ],
  origin: _origin,
  destination: _destination,
);

/// Schema of the first release (schemaVersion 1), before accounts were recorded.
const _schemaV1 = [
  'CREATE TABLE "offline_routes" ("route_id" TEXT NOT NULL, "name" TEXT NOT NULL, '
      '"profile" TEXT NOT NULL, "origin_latitude" REAL NOT NULL, "origin_longitude" REAL NOT NULL, '
      '"destination_latitude" REAL NOT NULL, "destination_longitude" REAL NOT NULL, '
      '"distance_meters" REAL NOT NULL, "duration_seconds" REAL NOT NULL, "geometry" TEXT NOT NULL, '
      '"steps" TEXT NOT NULL, "region_id" TEXT NULL, "provider" TEXT NULL, '
      '"created_at" TEXT NOT NULL, "updated_at" TEXT NOT NULL, PRIMARY KEY ("route_id"))',
  'CREATE TABLE "sync_queue" ("id" TEXT NOT NULL, "operation" TEXT NOT NULL, '
      '"entity" TEXT NOT NULL, "payload" TEXT NOT NULL, "created_at" TEXT NOT NULL, '
      '"retry_count" INTEGER NOT NULL DEFAULT 0, "status" TEXT NOT NULL, "last_error" TEXT NULL, '
      '"next_attempt_at" TEXT NULL, "completed_at" TEXT NULL, PRIMARY KEY ("id"))',
  'CREATE TABLE "trips" ("id" TEXT NOT NULL, "name" TEXT NULL, "profile" TEXT NOT NULL, '
      '"route_id" TEXT NULL, "status" TEXT NOT NULL, "started_at" TEXT NOT NULL, '
      '"ended_at" TEXT NULL, "distance_meters" REAL NOT NULL DEFAULT 0.0, '
      '"point_count" INTEGER NOT NULL DEFAULT 0, PRIMARY KEY ("id"))',
  'CREATE TABLE "catalog_regions" ("code" TEXT NOT NULL, "name" TEXT NOT NULL, '
      '"country" TEXT NOT NULL, "province" TEXT NULL, "city" TEXT NULL, "version" TEXT NOT NULL, '
      '"map_size" INTEGER NOT NULL, "routing_size" INTEGER NULL, "checksum" TEXT NOT NULL, '
      '"routing_checksum" TEXT NULL, "west" REAL NULL, "south" REAL NULL, "east" REAL NULL, '
      '"north" REAL NULL, "min_zoom" INTEGER NOT NULL, "max_zoom" INTEGER NOT NULL, '
      '"map_download_url" TEXT NOT NULL, "routing_download_url" TEXT NULL, '
      '"tiles_url" TEXT NOT NULL, "updated_at" TEXT NOT NULL, "fetched_at" TEXT NOT NULL, '
      'PRIMARY KEY ("code"))',
  'CREATE TABLE "downloaded_regions" ("code" TEXT NOT NULL, "name" TEXT NOT NULL, '
      '"version" TEXT NOT NULL, "checksum" TEXT NOT NULL, "size_bytes" INTEGER NOT NULL, '
      '"relative_path" TEXT NOT NULL, "west" REAL NULL, "south" REAL NULL, "east" REAL NULL, '
      '"north" REAL NULL, "min_zoom" INTEGER NOT NULL, "max_zoom" INTEGER NOT NULL, '
      '"downloaded_at" TEXT NOT NULL, "latest_version" TEXT NULL, "checked_at" TEXT NULL, '
      'PRIMARY KEY ("code"))',
  'CREATE TABLE "region_downloads" ("code" TEXT NOT NULL, "name" TEXT NOT NULL, '
      '"version" TEXT NOT NULL, "checksum" TEXT NOT NULL, "total_bytes" INTEGER NOT NULL, '
      '"url" TEXT NOT NULL, "relative_path" TEXT NOT NULL, "etag" TEXT NULL, '
      '"status" TEXT NOT NULL, "error_code" TEXT NULL, "error_message" TEXT NULL, '
      '"started_at" TEXT NOT NULL, "updated_at" TEXT NOT NULL, PRIMARY KEY ("code"))',
  'CREATE TABLE "tracking_points" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, '
      '"trip_id" TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE, '
      '"latitude" REAL NOT NULL, "longitude" REAL NOT NULL, "accuracy" REAL NULL, '
      '"speed" REAL NULL, "heading" REAL NULL, "altitude" REAL NULL, '
      '"recorded_at" TEXT NOT NULL, "queued" INTEGER NOT NULL DEFAULT 0 '
      'CHECK ("queued" IN (0, 1)), UNIQUE ("trip_id", "recorded_at"))',
  'CREATE TABLE "key_values" ("key" TEXT NOT NULL, "value" TEXT NOT NULL, PRIMARY KEY ("key"))',
  'CREATE INDEX sync_queue_status_created ON sync_queue (status, created_at)',
  'CREATE INDEX tracking_points_trip_queued ON tracking_points (trip_id, queued)',
];

void main() {
  late AppDatabase db;
  late SyncQueueStore queue;
  late SavedRouteRepositoryImpl routes;
  late TripRepositoryImpl trips;
  String? account;

  setUp(() {
    db = memoryDatabase();
    queue = SyncQueueStore(db);
    account = 'user-1';
    routes = SavedRouteRepositoryImpl(db: db, queue: queue, account: () => account);
    trips = TripRepositoryImpl(db: db, queue: queue, account: () => account);
  });

  tearDown(() => db.close());

  Future<OfflineRoute> saveRoute(String name) =>
      routes.save(result: _result, option: _result.primary, name: name);

  Future<List<String>> queued(String accountId) async => [
    for (final op in await queue.nextBatch(accountId: accountId, limit: 50))
      '${op.entity}:${op.operation}',
  ];

  test('each account only sees and changes its own saved routes', () async {
    final mine = await saveRoute('Casa');

    account = 'user-2';
    expect(await routes.getAll(), isEmpty);
    expect(await routes.getById(mine.routeId), isNull);
    expect(await routes.byProfile(RoutingProfile.car), isEmpty);
    await routes.delete(mine.routeId);
    expect(await queued('user-2'), isEmpty);

    account = 'user-1';
    expect((await routes.getAll()).single.routeId, mine.routeId);
    expect(await queued('user-1'), ['route:UPSERT']);
  });

  test('pulled routes and deletions only touch the account that pulled them', () async {
    final pulled = OfflineRoute.fromApi({
      'id': '89119e76-4090-48ad-a849-60cba745d6a0',
      'name': 'Casa → Oficina',
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
      'createdAt': '2026-09-25T12:00:00.000Z',
      'updatedAt': '2026-09-25T12:00:00.000Z',
    });

    await routes.applyRemote(accountId: 'user-2', routes: [pulled], deletedIds: const []);
    expect(await routes.getAll(), isEmpty);

    await routes.applyRemote(accountId: 'user-1', routes: const [], deletedIds: [pulled.routeId]);
    account = 'user-2';
    expect((await routes.getAll()).single.routeId, pulled.routeId);
  });

  test('what was saved or recorded without an account goes to the next login', () async {
    account = null;
    final route = await saveRoute('Sin cuenta');
    final trip = await trips.startTrip(
      profile: RoutingProfile.pedestrian,
      installationId: 'install-1',
    );
    await trips.finishTrip(trip.id);

    final sessions = MemorySessionStore();
    final auth = AuthRepositoryImpl(
      api: stubApi(
        (_) => StubResponse.ok({
          'accessToken': 'access',
          'refreshToken': 'refresh',
          'user': {'id': 'user-1', 'email': 'demo@maps.local', 'name': 'Demo', 'role': 'USER'},
        }),
      ).api,
      sessions: sessions,
      adoptGuestData: (accountId) async {
        // Adopted before the session exists, so no round can start without it.
        expect(sessions.current, isNull);
        await db.adoptGuestData(accountId);
      },
    );

    await auth.login(email: 'demo@maps.local', password: 'S3cure-password');
    account = sessions.current!.user.id;

    expect((await routes.getAll()).single.routeId, route.routeId);
    expect((await trips.watchTrips().first).single.id, trip.id);
    expect(await queued('user-1'), ['route:UPSERT', 'trip:CREATE', 'trip:FINISH']);

    // user-1 logs out: its data stays on the phone, out of sight.
    await auth.logout();
    account = null;
    expect(await routes.getAll(), isEmpty);
    expect(await trips.watchTrips().first, isEmpty);
  });

  test('an upgrade from the first schema keeps the data for the restored session', () async {
    await db.close();
    db = AppDatabase(
      NativeDatabase.memory(
        setup: (raw) {
          if (raw.userVersion > 0) return;
          _schemaV1.forEach(raw.execute);
          raw
            ..execute(
              "INSERT INTO offline_routes VALUES ('route-1', 'Casa', 'CAR', -2.19, -79.88, "
              "-2.18, -79.89, 1500.0, 180.0, '[[-79.88,-2.19],[-79.89,-2.18]]', '[]', NULL, "
              "'valhalla', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')",
            )
            ..execute(
              'INSERT INTO trips (id, profile, status, started_at) '
              "VALUES ('trip-1', 'CAR', 'COMPLETED', '2026-09-01T08:00:00.000Z')",
            )
            ..execute(
              'INSERT INTO sync_queue (id, operation, entity, payload, created_at, status) '
              """VALUES ('op-1', 'FINISH', 'trip', '{"id":"trip-1"}', """
              "'2026-09-01T09:00:00.000Z', 'PENDING')",
            )
            ..userVersion = 1;
        },
      ),
    );
    queue = SyncQueueStore(db);
    routes = SavedRouteRepositoryImpl(db: db, queue: queue, account: () => account);
    trips = TripRepositoryImpl(db: db, queue: queue, account: () => account);

    final auth = AuthRepositoryImpl(
      api: stubApi((_) => throw StateError('no request expected')).api,
      sessions: MemorySessionStore(testSession),
      adoptGuestData: db.adoptGuestData,
    );
    await auth.restore();

    expect((await routes.getAll()).single.name, 'Casa');
    expect((await trips.watchTrips().first).single.id, 'trip-1');
    expect(await queued('user-1'), ['trip:FINISH']);
    expect((await queue.byStatus(SyncStatus.pending, accountId: 'user-1')).single.id, 'op-1');
  });
}
