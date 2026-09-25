import 'package:dio/dio.dart';

import '../../core/errors/app_exception.dart';

import 'api_client.dart';
import 'session_store.dart';

/// Adds the access token to API requests and, when it has expired, rotates
/// the tokens once (`POST /auth/refresh`) and repeats the request. Queued, so
/// concurrent 401 responses trigger a single refresh.
class AuthInterceptor extends QueuedInterceptor {
  AuthInterceptor({required this._sessions, required this._plainDio});

  final SessionStore _sessions;

  /// Same base options as the API Dio but without interceptors.
  final Dio _plainDio;

  static const _retriedKey = 'authRetried';

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final session = _sessions.current;
    if (session != null && !options.headers.containsKey('Authorization')) {
      options.headers['Authorization'] = 'Bearer ${session.accessToken}';
    }
    handler.next(options);
  }

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    final options = err.requestOptions;
    final session = _sessions.current;
    final sentAuthorization = options.headers['Authorization'];
    if (err.response?.statusCode != 401 ||
        session == null ||
        sentAuthorization == null ||
        options.extra[_retriedKey] == true) {
      handler.next(err);
      return;
    }
    try {
      var current = session;
      // Another request may already have rotated the tokens while this one waited.
      if (sentAuthorization == 'Bearer ${session.accessToken}') {
        final response = await _plainDio.post<Object?>(
          'auth/refresh',
          data: {'refreshToken': session.refreshToken},
        );
        final data = unwrapEnvelope(response.data)! as Map<String, Object?>;
        current = session.withTokens(
          accessToken: data['accessToken']! as String,
          refreshToken: data['refreshToken']! as String,
        );
        await _sessions.save(current);
      }
      final retry = options.copyWith(
        headers: {...options.headers, 'Authorization': 'Bearer ${current.accessToken}'},
        extra: {...options.extra, _retriedKey: true},
      );
      handler.resolve(await _plainDio.fetch<Object?>(retry));
    } on DioException catch (error) {
      // A rejected refresh token means the session is over (revoked or expired).
      if (error.requestOptions.path == 'auth/refresh' && error.response?.statusCode == 401) {
        await _sessions.clear();
        handler.next(err);
        return;
      }
      handler.next(error);
    } on AppException {
      // Refresh answered without the API envelope: report the original 401.
      handler.next(err);
    } on TypeError {
      // Envelope without the new tokens: report the original 401.
      handler.next(err);
    }
  }
}
