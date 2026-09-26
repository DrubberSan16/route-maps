import '../entities/user.dart';

/// Optional account: the map, downloads and routing work without it; it is
/// needed to synchronize trips and saved routes. The saved routes and trips
/// created without an account go to the first account that logs in; those of
/// an account are only visible while it is logged in.
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

  /// Ends the session; its data stays on the device for its next login.
  Future<void> logout();
}
