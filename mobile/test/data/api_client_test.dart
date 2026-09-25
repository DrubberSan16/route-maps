import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/core/errors/app_exception.dart';

import '../helpers/api_stub.dart';

void main() {
  test('returns the data of the success envelope', () async {
    final stub = stubApi((_) => StubResponse.ok({'answer': 42}));
    final data = await stub.api.get('things', (data) => (data! as Map)['answer']);
    expect(data, 42);
    expect(stub.adapter.requests.single.uri.toString(), 'http://maps.test/api/v1/things');
  });

  test('maps the error envelope to its code and a Spanish message', () async {
    final stub = stubApi(
      (_) => StubResponse.error(404, 'MAP_REGION_NOT_FOUND', 'Region guayaquil not found'),
    );
    await expectLater(
      stub.api.get('maps/regions/guayaquil', (data) => data),
      throwsA(
        isA<AppException>()
            .having((e) => e.code, 'code', ErrorCodes.mapRegionNotFound)
            .having((e) => e.statusCode, 'status', 404)
            .having((e) => e.message, 'message', 'La región no existe o fue deshabilitada.'),
      ),
    );
  });

  test('a proxy error page becomes a retryable server error', () async {
    final stub = stubApi((_) => const StubResponse(502, text: '<html>Bad Gateway</html>'));
    await expectLater(
      stub.api.get('health', (data) => data),
      throwsA(
        isA<AppException>()
            .having((e) => e.code, 'code', ErrorCodes.internalError)
            .having((e) => e.isRetryable, 'retryable', isTrue),
      ),
    );
  });

  test('no connection is a network error and is reported', () async {
    var reported = 0;
    final stub = stubApi(throwConnectionError, onNetworkFailure: () => reported++);
    await expectLater(
      stub.api.post('routes/calculate', (data) => data, body: const {}),
      throwsA(isA<AppException>().having((e) => e.isNetworkError, 'network', isTrue)),
    );
    expect(reported, 1);
  });

  test('a response with an unexpected shape is reported as such', () async {
    final stub = stubApi((_) => StubResponse.ok('not a list'));
    await expectLater(
      stub.api.get('maps/regions', (data) => (data! as List).length),
      throwsA(isA<AppException>().having((e) => e.code, 'code', ErrorCodes.unexpectedResponse)),
    );
  });
}
