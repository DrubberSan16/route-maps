import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/core/errors/app_exception.dart';
import 'package:maps_platform/data/repositories/auth_repository_impl.dart';

import '../helpers/api_stub.dart';
import '../helpers/fakes.dart';

void main() {
  AuthRepositoryImpl repository(StubHandler handler, MemorySessionStore sessions) =>
      AuthRepositoryImpl(
        api: stubApi(handler).api,
        sessions: sessions,
        adoptGuestData: (_) async {},
      );

  test('changing the password keeps the session with the new tokens', () async {
    final sessions = MemorySessionStore(testSession);
    final auth = repository((request) {
      expect(request.method, 'POST');
      expect(request.path, 'auth/password');
      expect(request.data, {'currentPassword': testPassword, 'newPassword': 'Nueva-clave-2026'});
      return StubResponse.ok({
        'accessToken': 'access-2',
        'refreshToken': 'refresh-2',
        'tokenType': 'Bearer',
        'expiresIn': 900,
        'refreshExpiresIn': 2592000,
      });
    }, sessions);

    await auth.changePassword(currentPassword: testPassword, newPassword: 'Nueva-clave-2026');

    expect(sessions.current!.accessToken, 'access-2');
    expect(sessions.current!.refreshToken, 'refresh-2');
    expect(sessions.current!.user, testUser);
  });

  test('a wrong current password leaves the session as it was', () async {
    final sessions = MemorySessionStore(testSession);
    final auth = repository(
      (_) => StubResponse.error(
        400,
        'INVALID_CURRENT_PASSWORD',
        'The current password is not correct',
      ),
      sessions,
    );

    await expectLater(
      auth.changePassword(currentPassword: 'otra-clave', newPassword: 'Nueva-clave-2026'),
      throwsA(
        isA<AppException>()
            .having((error) => error.code, 'code', ErrorCodes.invalidCurrentPassword)
            .having((error) => error.message, 'message', 'La contraseña actual no es correcta.'),
      ),
    );
    expect(sessions.current, same(testSession));
  });

  test('without a session there is no password to change', () async {
    final auth = repository((_) => throw StateError('no request expected'), MemorySessionStore());

    await expectLater(
      auth.changePassword(currentPassword: testPassword, newPassword: 'Nueva-clave-2026'),
      throwsA(
        isA<AppException>().having((error) => error.code, 'code', ErrorCodes.notAuthenticated),
      ),
    );
  });

  test('a disabled account or a closed session is explained in Spanish', () {
    expect(
      userMessageFor(ErrorCodes.accountDisabled),
      'Tu cuenta fue deshabilitada. Comunícate con un administrador.',
    );
    expect(
      userMessageFor(ErrorCodes.sessionRevoked),
      'Un administrador cerró tu sesión. Inicia sesión de nuevo.',
    );
  });
}
