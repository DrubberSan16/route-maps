/// Machine readable error codes. Server codes mirror the backend `error.code`
/// values; the rest are produced on the device.
abstract final class ErrorCodes {
  // Returned by the API.
  static const validationError = 'VALIDATION_ERROR';
  static const notFound = 'NOT_FOUND';
  static const conflict = 'CONFLICT';
  static const unauthorized = 'UNAUTHORIZED';
  static const forbidden = 'FORBIDDEN';
  static const rateLimitExceeded = 'RATE_LIMIT_EXCEEDED';
  static const internalError = 'INTERNAL_ERROR';
  static const emailAlreadyRegistered = 'EMAIL_ALREADY_REGISTERED';
  static const invalidCredentials = 'INVALID_CREDENTIALS';
  static const invalidRefreshToken = 'INVALID_REFRESH_TOKEN';
  static const mapRegionNotFound = 'MAP_REGION_NOT_FOUND';
  static const mapRegionFileNotAvailable = 'MAP_REGION_FILE_NOT_AVAILABLE';
  static const mapDownloadFailed = 'MAP_DOWNLOAD_FAILED';
  static const checksumMismatch = 'CHECKSUM_MISMATCH';
  static const insufficientStorage = 'INSUFFICIENT_STORAGE';
  static const routeNotFound = 'ROUTE_NOT_FOUND';
  static const routingProviderUnavailable = 'ROUTING_PROVIDER_UNAVAILABLE';
  static const routingProfileNotSupported = 'ROUTING_PROFILE_NOT_SUPPORTED';
  static const invalidCoordinates = 'INVALID_COORDINATES';
  static const geocodingProviderUnavailable = 'GEOCODING_PROVIDER_UNAVAILABLE';

  // Produced on the device.
  static const networkUnavailable = 'NETWORK_UNAVAILABLE';
  static const requestCancelled = 'REQUEST_CANCELLED';
  static const unexpectedResponse = 'UNEXPECTED_RESPONSE';
  static const offlineRouteUnavailable = 'OFFLINE_ROUTE_UNAVAILABLE';
  static const downloadCancelled = 'DOWNLOAD_CANCELLED';
  static const locationServiceDisabled = 'LOCATION_SERVICE_DISABLED';
  static const locationPermissionDenied = 'LOCATION_PERMISSION_DENIED';
  static const locationPermissionDeniedForever = 'LOCATION_PERMISSION_DENIED_FOREVER';
  static const locationUnavailable = 'LOCATION_UNAVAILABLE';
  static const notAuthenticated = 'NOT_AUTHENTICATED';
}

const _userMessages = <String, String>{
  ErrorCodes.validationError: 'Los datos enviados no son válidos.',
  ErrorCodes.unauthorized: 'Tu sesión expiró. Inicia sesión de nuevo.',
  ErrorCodes.forbidden: 'No tienes permiso para esta operación.',
  ErrorCodes.rateLimitExceeded: 'Demasiadas solicitudes. Espera un momento e inténtalo otra vez.',
  ErrorCodes.internalError: 'El servidor tuvo un problema. Inténtalo más tarde.',
  ErrorCodes.emailAlreadyRegistered: 'Ese correo ya está registrado.',
  ErrorCodes.invalidCredentials: 'Correo o contraseña incorrectos.',
  ErrorCodes.invalidRefreshToken: 'Tu sesión expiró. Inicia sesión de nuevo.',
  ErrorCodes.mapRegionNotFound: 'La región no existe o fue deshabilitada.',
  ErrorCodes.mapRegionFileNotAvailable:
      'El archivo de esta región no está disponible en el servidor.',
  ErrorCodes.mapDownloadFailed: 'La descarga se interrumpió. Puedes reanudarla desde donde quedó.',
  ErrorCodes.checksumMismatch:
      'El archivo descargado no coincide con su suma SHA-256 y se descartó.',
  ErrorCodes.insufficientStorage: 'No hay espacio suficiente en el dispositivo para esta región.',
  ErrorCodes.routeNotFound: 'No se encontró una ruta entre esos puntos.',
  ErrorCodes.routingProviderUnavailable: 'El motor de rutas no está disponible en este momento.',
  ErrorCodes.routingProfileNotSupported:
      'Ese medio de transporte no está disponible en el servidor.',
  ErrorCodes.invalidCoordinates: 'Los puntos no son válidos o están demasiado lejos entre sí.',
  ErrorCodes.geocodingProviderUnavailable:
      'La búsqueda de direcciones no está habilitada en el servidor.',
  ErrorCodes.networkUnavailable: 'No hay conexión con el servidor.',
  ErrorCodes.requestCancelled: 'La operación se canceló.',
  ErrorCodes.unexpectedResponse: 'El servidor devolvió una respuesta inesperada.',
  ErrorCodes.offlineRouteUnavailable:
      'Sin conexión: calcular una ruta nueva requiere Internet. '
      'Puedes abrir una de tus rutas guardadas.',
  ErrorCodes.downloadCancelled: 'Descarga pausada.',
  ErrorCodes.locationServiceDisabled: 'La ubicación del dispositivo está desactivada.',
  ErrorCodes.locationPermissionDenied: 'Sin permiso de ubicación no podemos mostrar tu posición.',
  ErrorCodes.locationPermissionDeniedForever:
      'El permiso de ubicación está bloqueado. Actívalo en los ajustes.',
  ErrorCodes.locationUnavailable: 'No fue posible obtener tu ubicación.',
  ErrorCodes.notAuthenticated: 'Inicia sesión para sincronizar tus datos con el servidor.',
};

/// Spanish message for [code], or [fallback] when the code has none.
String userMessageFor(String code, {String? fallback}) =>
    _userMessages[code] ?? fallback ?? 'Ocurrió un error inesperado ($code).';

/// Error raised by repositories and services. [message] is meant for the user.
class AppException implements Exception {
  const AppException(this.code, this.message, {this.statusCode, this.details, this.cause});

  /// Builds the exception with the standard Spanish message of [code].
  factory AppException.of(String code, {int? statusCode, Object? details, Object? cause}) =>
      AppException(
        code,
        userMessageFor(code),
        statusCode: statusCode,
        details: details,
        cause: cause,
      );

  final String code;
  final String message;
  final int? statusCode;
  final Object? details;
  final Object? cause;

  bool get isNetworkError => code == ErrorCodes.networkUnavailable;

  /// Whether repeating the same request later can succeed.
  bool get isRetryable =>
      isNetworkError ||
      code == ErrorCodes.rateLimitExceeded ||
      code == ErrorCodes.routingProviderUnavailable ||
      (statusCode != null && statusCode! >= 500);

  @override
  String toString() {
    final status = statusCode == null ? '' : ', HTTP $statusCode';
    return 'AppException($code$status): $message';
  }
}
