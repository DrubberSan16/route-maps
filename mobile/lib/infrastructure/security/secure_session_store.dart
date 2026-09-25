import 'dart:async';
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../data/remote/session_store.dart';
import '../../domain/entities/user.dart';

/// Tokens in the Android Keystore / iOS Keychain backed secure storage.
class SecureSessionStore implements SessionStore {
  SecureSessionStore([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();

  static const _key = 'auth_session';

  final FlutterSecureStorage _storage;
  final _changes = StreamController<AuthSession?>.broadcast();
  AuthSession? _current;

  @override
  AuthSession? get current => _current;

  @override
  Stream<AuthSession?> get changes => _changes.stream;

  @override
  Future<AuthSession?> load() async {
    try {
      final raw = await _storage.read(key: _key);
      if (raw == null) return _set(null);
      final json = jsonDecode(raw) as Map<String, Object?>;
      return _set(
        AuthSession(
          accessToken: json['accessToken']! as String,
          refreshToken: json['refreshToken']! as String,
          user: UserProfile.fromJson(json['user']! as Map<String, Object?>),
        ),
      );
    } on PlatformException {
      // The keystore entry cannot be decrypted (e.g. the app data was restored
      // on another device): the user has to log in again.
      await _storage.delete(key: _key);
      return _set(null);
    } on FormatException {
      await _storage.delete(key: _key);
      return _set(null);
    } on TypeError {
      await _storage.delete(key: _key);
      return _set(null);
    }
  }

  @override
  Future<void> save(AuthSession session) async {
    await _storage.write(
      key: _key,
      value: jsonEncode({
        'accessToken': session.accessToken,
        'refreshToken': session.refreshToken,
        'user': session.user.toJson(),
      }),
    );
    _set(session);
  }

  @override
  Future<void> clear() async {
    await _storage.delete(key: _key);
    _set(null);
  }

  AuthSession? _set(AuthSession? session) {
    _current = session;
    _changes.add(session);
    return session;
  }
}
