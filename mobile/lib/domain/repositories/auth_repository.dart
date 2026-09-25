import '../entities/user.dart';

/// Optional account: the map, downloads and routing work without it; it is
/// needed to synchronize trips and saved routes.
abstract class AuthRepository {
  AuthSession? get currentSession;

  /// Emits the current session first, then every change.
  Stream<AuthSession?> watchSession();

  Future<void> restore();

  Future<AuthSession> login({required String email, required String password});

  Future<AuthSession> register({
    required String email,
    required String password,
    required String name,
  });

  Future<void> logout();
}
