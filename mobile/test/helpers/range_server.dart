import 'dart:async';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

/// A file server with the behaviour of the platform's download endpoint:
/// ETag, `Range`/`If-Range`, 416 and `X-Checksum-Sha256`.
class RangeServer {
  RangeServer._(this._server);

  static Future<RangeServer> start() async =>
      RangeServer._(await HttpServer.bind(InternetAddress.loopbackIPv4, 0)).._listen();

  final HttpServer _server;
  late Uint8List content;
  String etag = '"v1"';
  String? checksumHeader;

  /// Closes the connection after sending this many bytes of the body.
  int? dropAfter;
  int? statusOverride;

  /// Sends the body slowly, in 64 KiB chunks.
  Duration? chunkDelay;
  final requests = <({String? range, String? ifRange})>[];

  /// The platform host, to resolve the download paths of the catalog.
  Uri get origin => Uri.parse('http://127.0.0.1:${_server.port}');

  Uri get url =>
      Uri.parse('http://127.0.0.1:${_server.port}/api/v1/maps/regions/guayaquil/download');

  void _listen() {
    _server.listen((request) async {
      final response = request.response;
      final range = request.headers.value(HttpHeaders.rangeHeader);
      final ifRange = request.headers.value('if-range');
      requests.add((range: range, ifRange: ifRange));
      if (statusOverride case final status?) {
        response.statusCode = status;
        await response.close();
        return;
      }
      response.headers
        ..set(HttpHeaders.etagHeader, etag)
        ..set(HttpHeaders.acceptRangesHeader, 'bytes');
      if (checksumHeader case final checksum?) response.headers.set('X-Checksum-Sha256', checksum);

      var start = 0;
      final match = RegExp(r'^bytes=(\d+)-$').firstMatch(range ?? '');
      final useRange = match != null && (ifRange == null || ifRange == etag);
      if (useRange) {
        start = int.parse(match.group(1)!);
        if (start >= content.length) {
          response
            ..statusCode = HttpStatus.requestedRangeNotSatisfiable
            ..headers.set(HttpHeaders.contentRangeHeader, 'bytes */${content.length}');
          await response.close();
          return;
        }
        response
          ..statusCode = HttpStatus.partialContent
          ..headers.set(
            HttpHeaders.contentRangeHeader,
            'bytes $start-${content.length - 1}/${content.length}',
          );
      }
      final body = content.sublist(start);
      response.contentLength = body.length;
      try {
        final limit = dropAfter;
        if (limit != null && limit < body.length) {
          // Headers and part of the body, then the connection is lost.
          final socket = await response.detachSocket();
          socket.add(body.sublist(0, limit));
          await socket.flush();
          socket.destroy();
          return;
        }
        if (chunkDelay case final delay?) {
          for (var i = 0; i < body.length; i += 64 * 1024) {
            response.add(body.sublist(i, math.min(i + 64 * 1024, body.length)));
            await response.flush();
            await Future<void>.delayed(delay);
          }
        } else {
          response.add(body);
        }
        await response.close();
      } on IOException {
        // The client went away (cancelled download): nothing else to send.
      }
    });
  }

  Future<void> close() => _server.close(force: true);
}
