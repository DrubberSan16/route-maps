import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:maps_platform/data/remote/api_client.dart';

/// A canned HTTP answer.
class StubResponse {
  const StubResponse(this.status, {this.json, this.text, this.headers = const {}});

  /// `{success: true, data: ...}` as the API answers.
  factory StubResponse.ok(Object? data) => StubResponse(200, json: {'success': true, 'data': data});

  /// `{success: false, error: {...}}` as the API answers.
  factory StubResponse.error(int status, String code, String message, {Object? details}) =>
      StubResponse(
        status,
        json: {
          'success': false,
          'error': {'code': code, 'message': message, 'details': ?details},
        },
      );

  final int status;
  final Object? json;
  final String? text;
  final Map<String, List<String>> headers;
}

typedef StubHandler = FutureOr<StubResponse> Function(RequestOptions request);

/// Dio adapter answering from [handler] instead of the network. Throw a
/// [DioException] from the handler to simulate transport failures.
class StubAdapter implements HttpClientAdapter {
  StubAdapter(this.handler);

  StubHandler handler;
  final requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final response = await handler(options);
    final json = response.json;
    final body = json != null ? jsonEncode(json) : response.text ?? '';
    return ResponseBody.fromString(
      body,
      response.status,
      headers: {
        Headers.contentTypeHeader: [json != null ? 'application/json' : 'text/html'],
        ...response.headers,
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

/// An [ApiClient] whose requests are answered by [handler].
({ApiClient api, StubAdapter adapter, Dio dio}) stubApi(
  StubHandler handler, {
  void Function()? onNetworkFailure,
}) {
  final adapter = StubAdapter(handler);
  final dio = Dio(BaseOptions(baseUrl: 'http://maps.test/api/v1/', responseType: ResponseType.json))
    ..httpClientAdapter = adapter;
  return (api: ApiClient(dio, onNetworkFailure: onNetworkFailure), adapter: adapter, dio: dio);
}

/// Simulates a device without connection.
Never throwConnectionError(RequestOptions request) =>
    throw DioException.connectionError(requestOptions: request, reason: 'Network is unreachable');
