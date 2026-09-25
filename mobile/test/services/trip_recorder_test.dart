import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/core/errors/app_exception.dart';
import 'package:maps_platform/data/local/app_database.dart';
import 'package:maps_platform/data/local/sync_queue_store.dart';
import 'package:maps_platform/data/repositories/settings_repository_impl.dart';
import 'package:maps_platform/data/repositories/trip_repository_impl.dart';
import 'package:maps_platform/domain/entities/routing_profile.dart';
import 'package:maps_platform/domain/services/location_service.dart';
import 'package:maps_platform/services/tracking/trip_recorder.dart';

import '../helpers/async.dart';
import '../helpers/database.dart';
import '../helpers/fakes.dart';

void main() {
  late AppDatabase db;
  late SyncQueueStore queue;
  late TripRepositoryImpl trips;
  late SettingsRepositoryImpl settings;
  late FakeLocationService location;
  late TripRecorder recorder;

  TripRecorder createRecorder({Duration queueInterval = const Duration(hours: 1)}) => TripRecorder(
    trips: trips,
    location: location,
    settings: settings,
    queueInterval: queueInterval,
  );

  setUp(() {
    db = memoryDatabase();
    queue = SyncQueueStore(db);
    trips = TripRepositoryImpl(db: db, queue: queue);
    settings = SettingsRepositoryImpl(db);
    location = FakeLocationService(position: fix(-2.17, -79.90));
    recorder = createRecorder();
  });

  tearDown(() async {
    await recorder.dispose();
    await db.close();
  });

  DateTime second(int s) => DateTime.utc(2026, 9, 25, 12, 0, s);

  test('records the accurate fixes, also with the screen off', () async {
    await recorder.start(profile: RoutingProfile.bicycle, name: 'Malecón');
    expect(location.background, isTrue);

    location.positions
      ..add(fix(-2.1700, -79.9000, at: second(0)))
      ..add(fix(-2.1705, -79.9000, accuracy: 120, at: second(2))) // too imprecise
      ..add(fix(-2.1710, -79.9000, at: second(4)));
    await eventually(() => recorder.state.trip?.pointCount == 2);

    expect(recorder.state.discardedFixes, 1);
    expect(recorder.state.trip!.distanceMeters, closeTo(111, 1));
    expect(recorder.state.lastPosition!.latitude, -2.1710);
  });

  test('finishing queues the points and then the finish', () async {
    await recorder.start(profile: RoutingProfile.car);
    location.positions.add(fix(-2.17, -79.90, at: second(0)));
    await eventually(() => recorder.state.trip?.pointCount == 1);

    final finished = await recorder.finish();

    expect(finished!.pointCount, 1);
    expect(recorder.state.isRecording, isFalse);
    expect(location.background, isFalse);
    final ops = await queue.nextBatch(limit: 10);
    expect(ops.map((op) => '${op.entity}:${op.operation}'), [
      'trip:CREATE',
      'tracking_point:CREATE',
      'trip:FINISH',
    ]);
  });

  test('points move to the synchronization queue while recording', () async {
    await recorder.dispose();
    recorder = createRecorder(queueInterval: const Duration(milliseconds: 20));
    await recorder.start(profile: RoutingProfile.car);
    location.positions.add(fix(-2.17, -79.90, at: second(0)));
    await eventually(
      () async => (await queue.nextBatch(limit: 10)).any((op) => op.entity == 'tracking_point'),
    );
    expect(recorder.state.isRecording, isTrue);
  });

  test('without location permission nothing is recorded', () async {
    for (final (access, code) in [
      (LocationAccess.denied, ErrorCodes.locationPermissionDenied),
      (LocationAccess.deniedForever, ErrorCodes.locationPermissionDeniedForever),
      (LocationAccess.serviceDisabled, ErrorCodes.locationServiceDisabled),
    ]) {
      location.access = access;
      await expectLater(
        recorder.start(profile: RoutingProfile.car),
        throwsA(isA<AppException>().having((e) => e.code, 'code', code)),
      );
    }
    expect(await trips.activeTrip(), isNull);
    expect(recorder.state.isRecording, isFalse);
  });

  test('a trip left active is continued when the app starts again', () async {
    final previous = await trips.startTrip(
      profile: RoutingProfile.pedestrian,
      installationId: 'i-1',
    );
    await recorder.restore();
    expect(recorder.state.trip!.id, previous.id);

    location.positions.add(fix(-2.17, -79.90, at: second(0)));
    await eventually(() => recorder.state.trip?.pointCount == 1);
    expect((await trips.activeTrip())!.pointCount, 1);
  });

  test('a GPS problem is shown and recording goes on', () async {
    await recorder.start(profile: RoutingProfile.car);
    location.positions.addError(AppException.of(ErrorCodes.locationServiceDisabled));
    await eventually(() => recorder.state.error != null);
    expect(recorder.state.error!.code, ErrorCodes.locationServiceDisabled);

    location.positions.add(fix(-2.17, -79.90, at: second(0)));
    await eventually(() => recorder.state.trip?.pointCount == 1);
    expect(recorder.state.error, isNull);
  });

  test('starting twice keeps the same trip', () async {
    final first = await recorder.start(profile: RoutingProfile.car);
    final second = await recorder.start(profile: RoutingProfile.car);
    expect(second.id, first.id);
  });
}
