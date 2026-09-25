import 'package:flutter/foundation.dart';

@immutable
class UserProfile {
  const UserProfile({
    required this.id,
    required this.email,
    required this.name,
    required this.role,
  });

  factory UserProfile.fromJson(Map<String, Object?> json) => UserProfile(
    id: json['id']! as String,
    email: json['email']! as String,
    name: json['name']! as String,
    role: (json['role'] as String?) ?? 'USER',
  );

  final String id;
  final String email;
  final String name;
  final String role;

  Map<String, Object?> toJson() => {'id': id, 'email': email, 'name': name, 'role': role};
}

/// Tokens of a logged in user (kept in the platform secure storage).
@immutable
class AuthSession {
  const AuthSession({required this.accessToken, required this.refreshToken, required this.user});

  final String accessToken;
  final String refreshToken;
  final UserProfile user;

  AuthSession withTokens({required String accessToken, required String refreshToken}) =>
      AuthSession(accessToken: accessToken, refreshToken: refreshToken, user: user);
}
