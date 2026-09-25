import '../../domain/entities/user.dart';

/// Keeps the tokens of the logged in user (secure storage on the device).
abstract class SessionStore {
  AuthSession? get current;

  /// Emits every change (null after logout or an expired refresh token).
  Stream<AuthSession?> get changes;

  Future<AuthSession?> load();

  Future<void> save(AuthSession session);

  Future<void> clear();
}
