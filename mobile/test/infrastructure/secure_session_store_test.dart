import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/infrastructure/security/secure_session_store.dart';

import '../helpers/fakes.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('the session survives restarting the app', () async {
    FlutterSecureStorage.setMockInitialValues({});
    await SecureSessionStore().save(testSession);

    final restarted = SecureSessionStore();
    final session = await restarted.load();
    expect(session!.accessToken, 'access');
    expect(session.user.email, 'demo@maps.local');
    expect(restarted.current, isNotNull);
  });

  test('a damaged entry logs the user out instead of failing', () async {
    FlutterSecureStorage.setMockInitialValues({'auth_session': '{"accessToken": 3'});
    final store = SecureSessionStore();
    expect(await store.load(), isNull);
    expect(await const FlutterSecureStorage().read(key: 'auth_session'), isNull);
  });

  test('logging out removes the tokens and tells the listeners', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final store = SecureSessionStore();
    await store.save(testSession);
    final changes = store.changes.take(1).toList();
    await store.clear();
    expect(await changes, [null]);
    expect(await store.load(), isNull);
  });
}
