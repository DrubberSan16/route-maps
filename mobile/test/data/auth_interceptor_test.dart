import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/core/errors/app_exception.dart';
import 'package:maps_platform/data/remote/api_client.dart';
import 'package:maps_platform/data/remote/auth_interceptor.dart';
import 'package:maps_platform/domain/entities/user.dart';

import '../helpers/api_stub.dart';
import '../helpers/fakes.dart';

void main() {
  late MemorySessionStore sessions;
  late ApiClient api;
  late String validAccessToken;
  late int refreshes;
  late List<String?> authorizations;

  /// Runs while the server handles a request, before it checks the token.
  Future<void> Function()? whileHandling;

  setUp(() {
    sessions = MemorySessionStore(testSession);
    validAccessToken = 'access';
    refreshes = 0;
    authorizations = [];
    whileHandling = null;

    Future<StubResponse> server(RequestOptions request) async {
      if (request.path == 'auth/refresh') {
        refreshes++;
        await Future<void>.delayed(const Duration(milliseconds: 10));
        final token = (request.data as Map<String, Object?>)['refreshToken'];
        if (token != 'refresh') {
          return StubResponse.error(401, 'INVALID_REFRESH_TOKEN', 'Refresh token revoked');
        }
        validAccessToken = 'access-2';
        return StubResponse.ok({'accessToken': 'access-2', 'refreshToken': 'refresh-2'});
      }
      await whileHandling?.call();
      final authorization = request.headers['Authorization'] as String?;
      authorizations.add(authorization);
      if (authorization != 'Bearer $validAccessToken') {
        return StubResponse.error(401, 'UNAUTHORIZED', 'Token expired');
      }
      return StubResponse.ok({'id': 'user-1'});
    }

    final adapter = StubAdapter(server);
    Dio dio() => Dio(BaseOptions(baseUrl: 'http://maps.test/api/v1/'))..httpClientAdapter = adapter;
    final plainDio = dio();
    final apiDio = dio()..interceptors.add(AuthInterceptor(sessions: sessions, plainDio: plainDio));
    api = ApiClient(apiDio);
  });

  Future<Object?> me() => api.get('users/me', (data) => data);

  test('sends the access token of the session', () async {
    expect(await me(), {'id': 'user-1'});
    expect(authorizations, ['Bearer access']);
    expect(refreshes, 0);
  });

  test('an expired access token is rotated once and the request repeated', () async {
    validAccessToken = 'rotated-on-server';
    // The server only accepts the token returned by the refresh.
    expect(await me(), {'id': 'user-1'});
    expect(refreshes, 1);
    expect(sessions.current!.accessToken, 'access-2');
    expect(sessions.current!.refreshToken, 'refresh-2');
    expect(authorizations.last, 'Bearer access-2');
  });

  test('simultaneous 401 responses share a single refresh', () async {
    validAccessToken = 'rotated-on-server';
    final results = await Future.wait([me(), me(), me()]);
    expect(results, everyElement({'id': 'user-1'}));
    expect(refreshes, 1);
  });

  test('a rejected refresh token ends the session', () async {
    await sessions.save(testSession.withTokens(accessToken: 'old', refreshToken: 'revoked'));
    validAccessToken = 'rotated-on-server';
    await expectLater(
      me(),
      throwsA(isA<AppException>().having((e) => e.statusCode, 'statusCode', 401)),
    );
    expect(sessions.current, isNull);
  });

  test('a request of one account is never repeated with the tokens of another', () async {
    const other = AuthSession(
      accessToken: 'other-access',
      refreshToken: 'other-refresh',
      user: UserProfile(id: 'user-2', email: 'otra@maps.local', name: 'Otra', role: 'USER'),
    );
    validAccessToken = 'other-access';
    // The first account logs out and another one logs in while the request travels.
    whileHandling = () => sessions.save(other);

    await expectLater(
      me(),
      throwsA(isA<AppException>().having((e) => e.statusCode, 'statusCode', 401)),
    );
    expect(authorizations, ['Bearer access']);
    expect(refreshes, 0);
  });

  test('without a session nothing is refreshed', () async {
    await sessions.clear();
    await expectLater(me(), throwsA(isA<AppException>()));
    expect(refreshes, 0);
    expect(authorizations, [null]);
  });
}
