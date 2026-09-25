import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/core/errors/app_exception.dart';
import 'package:maps_platform/infrastructure/download/region_download_manager.dart';

import '../helpers/range_server.dart';

void main() {
  late RangeServer server;
  late Directory directory;
  late File target;
  late Uint8List content;
  late String checksum;
  int? freeBytes;

  RegionDownloadManager manager({int margin = 0}) => RegionDownloadManager(
    dio: Dio(),
    freeBytes: () async => freeBytes,
    minimumFreeMarginBytes: margin,
    // Same result as the isolate version, without spawning isolates in tests.
    sha256OfFile: (path) async => sha256.convert(await File(path).readAsBytes()).toString(),
  );

  DownloadRequest request({String? etag, String? sha}) => DownloadRequest(
    url: server.url,
    target: target,
    expectedBytes: content.length,
    expectedSha256: sha ?? checksum,
    etag: etag,
  );

  setUp(() async {
    server = await RangeServer.start();
    final random = math.Random(42);
    content = Uint8List.fromList(List.generate(3 * 1024 * 1024 + 123, (_) => random.nextInt(256)));
    checksum = sha256.convert(content).toString();
    server.content = content;
    directory = await Directory.systemTemp.createTemp('download_test_');
    target = File('${directory.path}/regions/guayaquil/2026.09.20/guayaquil.pmtiles');
    freeBytes = 1 << 40;
  });

  tearDown(() async {
    await server.close();
    await directory.delete(recursive: true);
  });

  test('downloads, verifies and moves the file into place', () async {
    final progress = <int>[];
    String? validator;
    final file = await manager().download(
      request(),
      onProgress: (received, total) => progress.add(received),
      onValidator: (etag) => validator = etag,
    );
    expect(file.path, target.path);
    expect(await file.readAsBytes(), content);
    expect(await request().partFile.exists(), isFalse);
    expect(progress.first, 0);
    expect(progress.last, content.length);
    expect(validator, '"v1"');
  });

  test('a lost connection keeps the part and the next attempt resumes it', () async {
    server.dropAfter = 1024 * 1024;
    await expectLater(
      manager().download(request()),
      throwsA(isA<AppException>().having((e) => e.code, 'code', ErrorCodes.networkUnavailable)),
    );
    final partial = await request().partFile.length();
    expect(partial, greaterThan(0));
    expect(partial, lessThanOrEqualTo(1024 * 1024));

    server.dropAfter = null;
    final file = await manager().download(request(etag: '"v1"'));
    expect(server.requests.last, (range: 'bytes=$partial-', ifRange: '"v1"'));
    expect(await file.readAsBytes(), content);
  });

  test('when the file changed on the server the download starts over', () async {
    await request().partFile.create(recursive: true);
    await request().partFile.writeAsBytes(List.filled(1000, 7)); // bytes of an old file
    server.etag = '"v2"';
    final file = await manager().download(request(etag: '"v1"'));
    expect(await file.readAsBytes(), content, reason: 'If-Range did not match: full body (200)');
  });

  test('a complete part is verified without downloading again (416)', () async {
    await request().partFile.create(recursive: true);
    await request().partFile.writeAsBytes(content);
    final file = await manager().download(request(etag: '"v1"'));
    expect(await file.readAsBytes(), content);
  });

  test('a corrupt file is discarded, never installed', () async {
    await expectLater(
      manager().download(request(sha: 'f' * 64)),
      throwsA(isA<AppException>().having((e) => e.code, 'code', ErrorCodes.checksumMismatch)),
    );
    expect(await target.exists(), isFalse);
    expect(await request().partFile.exists(), isFalse);
  });

  test('a new version published during the download is detected', () async {
    server.checksumHeader = 'a' * 64;
    await expectLater(
      manager().download(request()),
      throwsA(
        isA<AppException>()
            .having((e) => e.code, 'code', ErrorCodes.checksumMismatch)
            .having((e) => e.message, 'message', contains('se actualizó en el servidor')),
      ),
    );
    expect(await target.exists(), isFalse);
  });

  test('checks the free space before starting', () async {
    freeBytes = content.length + 10;
    await expectLater(
      manager(margin: 50 * 1000 * 1000).download(request()),
      throwsA(isA<AppException>().having((e) => e.code, 'code', ErrorCodes.insufficientStorage)),
    );
    expect(server.requests, isEmpty);
  });

  test('cancelling keeps what was downloaded', () async {
    server.chunkDelay = const Duration(milliseconds: 5);
    final token = CancelToken();
    final future = manager().download(
      request(),
      cancelToken: token,
      onProgress: (received, _) {
        if (received > 0) token.cancel();
      },
    );
    await expectLater(
      future,
      throwsA(isA<AppException>().having((e) => e.code, 'code', ErrorCodes.downloadCancelled)),
    );
    expect(await request().partFile.length(), greaterThan(0));
    expect(await target.exists(), isFalse);
  });

  test('a missing file on the server is reported as such', () async {
    server.statusOverride = 404;
    await expectLater(
      manager().download(request()),
      throwsA(
        isA<AppException>().having((e) => e.code, 'code', ErrorCodes.mapRegionFileNotAvailable),
      ),
    );
  });

  test('a truncated body is not accepted as complete', () async {
    // The server announces the full length but the file is shorter.
    server.content = content.sublist(0, content.length - 10);
    await expectLater(
      manager().download(request()),
      throwsA(isA<AppException>().having((e) => e.code, 'code', ErrorCodes.mapDownloadFailed)),
    );
    expect(await target.exists(), isFalse);
  });
}
