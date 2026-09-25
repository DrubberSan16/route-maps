import 'dart:io';

import 'package:dio/dio.dart';

import '../../core/config/app_config.dart';
import '../../core/errors/app_exception.dart';

/// Converts the `data` of a successful response into a typed value.
typedef JsonParser<T> = T Function(Object? data);

/// Dio configured for the platform API (`<base>/api/v1/`).
Dio createApiDio(AppConfig config) => Dio(
  BaseOptions(
    baseUrl: config.apiV1,
    connectTimeout: config.connectTimeout,
    sendTimeout: config.receiveTimeout,
    receiveTimeout: config.receiveTimeout,
    headers: const {'Accept': 'application/json'},
    responseType: ResponseType.json,
  ),
);

/// Thin wrapper over Dio that understands the API envelope
/// (`{success, data}` / `{success: false, error: {code, message}}`) and turns
/// every failure into an [AppException]. Widgets never use it directly.
class ApiClient {
  ApiClient(this._dio, {this._onNetworkFailure});

  final Dio _dio;
  final void Function()? _onNetworkFailure;

  Future<T> get<T>(
    String path,
    JsonParser<T> parse, {
    Map<String, Object?>? query,
    CancelToken? cancelToken,
  }) =>
      _send(() => _dio.get<Object?>(path, queryParameters: query, cancelToken: cancelToken), parse);

  Future<T> post<T>(String path, JsonParser<T> parse, {Object? body, CancelToken? cancelToken}) =>
      _send(() => _dio.post<Object?>(path, data: body, cancelToken: cancelToken), parse);

  Future<T> delete<T>(String path, JsonParser<T> parse) =>
      _send(() => _dio.delete<Object?>(path), parse);

  Future<T> _send<T>(Future<Response<Object?>> Function() request, JsonParser<T> parse) async {
    final Response<Object?> response;
    try {
      response = await request();
    } on DioException catch (error) {
      final exception = mapDioException(error);
      if (exception.isNetworkError) _onNetworkFailure?.call();
      throw exception;
    }
    final data = unwrapEnvelope(response.data);
    try {
      return parse(data);
    } on TypeError catch (error) {
      throw AppException.of(ErrorCodes.unexpectedResponse, cause: error);
    } on FormatException catch (error) {
      throw AppException.of(ErrorCodes.unexpectedResponse, cause: error);
    }
  }
}

/// Returns `data` of a success envelope.
Object? unwrapEnvelope(Object? body) {
  if (body is Map<String, Object?> && body['success'] == true) {
    return body['data'];
  }
  throw AppException.of(ErrorCodes.unexpectedResponse, details: body);
}

/// Maps transport and HTTP failures to [AppException].
AppException mapDioException(DioException error) {
  switch (error.type) {
    case DioExceptionType.cancel:
      return AppException.of(ErrorCodes.requestCancelled, cause: error);
    case DioExceptionType.connectionTimeout:
    case DioExceptionType.sendTimeout:
    case DioExceptionType.receiveTimeout:
    case DioExceptionType.transformTimeout:
    case DioExceptionType.connectionError:
      return AppException.of(ErrorCodes.networkUnavailable, cause: error);
    case DioExceptionType.badCertificate:
      return AppException(
        ErrorCodes.networkUnavailable,
        'El certificado del servidor no es válido.',
        cause: error,
      );
    case DioExceptionType.badResponse:
      return exceptionFromResponse(error.response, cause: error);
    case DioExceptionType.unknown:
      final cause = error.error;
      if (cause is SocketException || cause is HttpException || cause is TlsException) {
        return AppException.of(ErrorCodes.networkUnavailable, cause: error);
      }
      return AppException.of(ErrorCodes.unexpectedResponse, cause: error);
  }
}

/// Reads the error envelope of a failed response. Responses that do not come
/// from the API (a proxy page, for instance) are mapped from the status code.
AppException exceptionFromResponse(Response<Object?>? response, {Object? cause}) {
  final status = response?.statusCode;
  final body = response?.data;
  if (body is Map<String, Object?> && body['error'] is Map<String, Object?>) {
    final error = body['error']! as Map<String, Object?>;
    final code = (error['code'] as String?) ?? ErrorCodes.internalError;
    return AppException(
      code,
      userMessageFor(code, fallback: error['message'] as String?),
      statusCode: status,
      details: error['details'],
      cause: cause,
    );
  }
  if (status != null && status >= 500) {
    return AppException(
      ErrorCodes.internalError,
      'El servidor no está disponible (HTTP $status).',
      statusCode: status,
      cause: cause,
    );
  }
  return AppException(
    ErrorCodes.unexpectedResponse,
    userMessageFor(ErrorCodes.unexpectedResponse),
    statusCode: status,
    cause: cause,
  );
}
