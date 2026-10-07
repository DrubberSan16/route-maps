import '../../core/errors/app_exception.dart';
import '../../core/utils/streams.dart';
import '../../domain/entities/user.dart';
import '../../domain/repositories/auth_repository.dart';
import '../remote/api_client.dart';
import '../remote/session_store.dart';

class AuthRepositoryImpl implements AuthRepository {
  AuthRepositoryImpl({required this._api, required this._sessions, required this._adoptGuestData});

  final ApiClient _api;
  final SessionStore _sessions;

  /// Gives the local data created without an account to the given account.
  final Future<void> Function(String accountId) _adoptGuestData;

  @override
  AuthSession? get currentSession => _sessions.current;

  @override
  Stream<AuthSession?> watchSession() =>
      currentAndChanges(() => _sessions.current, _sessions.changes);

  @override
  Future<void> restore() async {
    final session = await _sessions.load();
    // Only data from before accounts were recorded can be unowned while a
    // session is open: it was created by that session.
    if (session != null) await _adoptGuestData(session.user.id);
  }

  @override
  Future<AuthSession> login({required String email, required String password}) =>
      _authenticate('auth/login', {'email': email.trim(), 'password': password});

  @override
  Future<AuthSession> register({
    required String email,
    required String password,
    required String name,
  }) => _authenticate('auth/register', {
    'email': email.trim(),
    'password': password,
    'name': name.trim(),
  });

  @override
  Future<void> logout() async {
    final session = _sessions.current;
    if (session == null) return;
    try {
      await _api.post('auth/logout', (_) {}, body: {'refreshToken': session.refreshToken});
    } on AppException catch (error) {
      // Without connection the server-side token simply expires; the user
      // asked to leave, so the local session is removed anyway.
      if (!error.isNetworkError && error.code != ErrorCodes.unauthorized) rethrow;
    } finally {
      await _sessions.clear();
    }
  }

  @override
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    final session = _sessions.current;
    if (session == null) throw AppException.of(ErrorCodes.notAuthenticated);
    final tokens = await _api.post('auth/password', (data) {
      final json = data! as Map<String, Object?>;
      return (access: json['accessToken']! as String, refresh: json['refreshToken']! as String);
    }, body: {'currentPassword': currentPassword, 'newPassword': newPassword});
    // The previous tokens no longer work. Unless another account logged in
    // meanwhile, the session continues with the new ones.
    final current = _sessions.current;
    if (current == null || current.user.id != session.user.id) return;
    await _sessions.save(
      current.withTokens(accessToken: tokens.access, refreshToken: tokens.refresh),
    );
  }

  Future<AuthSession> _authenticate(String path, Map<String, Object?> body) async {
    final session = await _api.post(path, (data) {
      final json = data! as Map<String, Object?>;
      return AuthSession(
        accessToken: json['accessToken']! as String,
        refreshToken: json['refreshToken']! as String,
        user: UserProfile.fromJson(json['user']! as Map<String, Object?>),
      );
    }, body: body);
    // What was saved or recorded on this device without an account stays
    // with the account that logs in (before the session is visible, so the
    // first synchronization already sends it).
    await _adoptGuestData(session.user.id);
    await _sessions.save(session);
    return session;
  }
}
