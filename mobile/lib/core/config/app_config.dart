import 'dart:io';

/// Runtime configuration of the app.
///
/// The API base URL comes from `--dart-define=API_BASE_URL=https://maps.example.com`
/// (the Nginx entry point of the platform). Without it, development defaults
/// are used: the Android emulator reaches the host machine at 10.0.2.2 and the
/// iOS simulator at localhost, both on the port Nginx publishes (8080).
class AppConfig {
  AppConfig({
    required this.apiBaseUrl,
    this.connectTimeout = const Duration(seconds: 10),
    this.receiveTimeout = const Duration(seconds: 30),
    this.routeLanguage = 'es-ES',
  });

  factory AppConfig.fromEnvironment() {
    const fromDefine = String.fromEnvironment('API_BASE_URL');
    if (fromDefine.isNotEmpty) {
      return AppConfig(apiBaseUrl: Uri.parse(fromDefine));
    }
    final host = Platform.isAndroid ? '10.0.2.2' : 'localhost';
    return AppConfig(apiBaseUrl: Uri.parse('http://$host:8080'));
  }

  /// Public entry point of the platform (Nginx), without the `/api/v1` prefix.
  final Uri apiBaseUrl;
  final Duration connectTimeout;
  final Duration receiveTimeout;

  /// Language of turn-by-turn instructions requested from the routing engine.
  final String routeLanguage;

  /// Base URL of the versioned REST API, with a trailing slash.
  String get apiV1 => resolve('/api/v1/').toString();

  /// Resolves a URL returned by the API (usually an absolute path such as
  /// `/api/v1/maps/regions/guayaquil/download`) against the platform host.
  Uri resolve(String url) => apiBaseUrl.resolve(url);
}
