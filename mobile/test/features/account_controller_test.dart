import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/domain/entities/routing_profile.dart';
import 'package:maps_platform/features/account/account_controller.dart';
import 'package:maps_platform/presentation/providers.dart';

import '../helpers/database.dart';
import '../helpers/fakes.dart';

void main() {
  test('logging out finishes the trip being recorded, for the account that left', () async {
    final db = memoryDatabase();
    final auth = FakeAuthRepository(testSession);
    final location = FakeLocationService(position: fix(-2.17, -79.90));
    final container = ProviderContainer(
      overrides: [
        databaseProvider.overrideWithValue(db),
        authRepositoryProvider.overrideWithValue(auth),
        locationServiceProvider.overrideWithValue(location),
      ],
    );
    addTearDown(() async {
      container.dispose();
      await db.close();
    });
    container.listen(accountControllerProvider, (_, _) {});
    final recorder = container.read(tripRecorderProvider);
    await recorder.start(profile: RoutingProfile.car);

    expect(await container.read(accountControllerProvider.notifier).logout(), isTrue);

    expect(auth.currentSession, isNull);
    expect(recorder.state.isRecording, isFalse);
    expect(location.background, isFalse);
    final queued = await container
        .read(syncQueueStoreProvider)
        .nextBatch(accountId: testUser.id, limit: 10);
    expect(queued.map((op) => '${op.entity}:${op.operation}'), ['trip:CREATE', 'trip:FINISH']);
  });
}
