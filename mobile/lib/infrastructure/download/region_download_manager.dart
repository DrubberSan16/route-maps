import 'dart:io';
import 'dart:isolate';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';

import '../../core/errors/app_exception.dart';
import '../../core/utils/formatters.dart';

/// What to download and how to verify it.
class DownloadRequest {
  const DownloadRequest({
    required this.url,
    required this.target,
    required this.expectedBytes,
    required this.expectedSha256,
    this.etag,
  });

  final Uri url;

  /// Final location. Bytes are written to `<target>.part` until verified.
  final File target;
  final int expectedBytes;
  final String expectedSha256;

  /// Validator (ETag) of a previous attempt, sent in `If-Range` to resume.
  final String? etag;

  File get partFile => File('${target.path}.part');
}

typedef DownloadProgressCallback = void Function(int receivedBytes, int totalBytes);

/// Resumable, verified downloads of large files (region PMTiles):
///
/// * checks free space before starting;
/// * writes to `<file>.part` and resumes with `Range` + `If-Range`;
/// * cancelling keeps the `.part` so the next attempt continues from there;
/// * verifies size and SHA-256 (in a background isolate) before an atomic
///   rename to the final name, so a corrupt file is never used.
class RegionDownloadManager {
  RegionDownloadManager({
    required this._dio,
    required this._freeBytes,
    this.minimumFreeMarginBytes = 50 * 1000 * 1000,
    Future<String> Function(String path)? sha256OfFile,
  }) : _sha256OfFile = sha256OfFile ?? sha256InIsolate;

  final Dio _dio;
  final Future<int?> Function() _freeBytes;
  final Future<String> Function(String path) _sha256OfFile;

  /// Space that must remain free after the download.
  final int minimumFreeMarginBytes;

  static const _flushThreshold = 512 * 1024;

  Future<File> download(
    DownloadRequest request, {
    CancelToken? cancelToken,
    DownloadProgressCallback? onProgress,
    void Function(String? etag)? onValidator,
  }) async {
    final part = request.partFile;
    await part.parent.create(recursive: true);
    var received = await part.exists() ? await part.length() : 0;
    if (received > request.expectedBytes) {
      await part.delete();
      received = 0;
    }
    onProgress?.call(received, request.expectedBytes);

    if (received < request.expectedBytes) {
      await _ensureFreeSpace(request.expectedBytes - received);
      received = await _transfer(
        request,
        received,
        cancelToken: cancelToken,
        onProgress: onProgress,
        onValidator: onValidator,
        allowRestart: true,
      );
    }

    if (received != request.expectedBytes) {
      await part.delete();
      throw AppException(
        ErrorCodes.mapDownloadFailed,
        'El archivo recibido mide ${formatBytes(received)} y se esperaban '
        '${formatBytes(request.expectedBytes)}. Se descartó.',
      );
    }
    final digest = await _sha256OfFile(part.path);
    if (digest.toLowerCase() != request.expectedSha256.toLowerCase()) {
      await part.delete();
      throw AppException.of(ErrorCodes.checksumMismatch, details: {'sha256': digest});
    }
    // Same directory, so the rename is atomic: readers see the old state or
    // the complete file, never a partial one.
    return part.rename(request.target.path);
  }

  Future<void> _ensureFreeSpace(int remainingBytes) async {
    final free = await _freeBytes();
    if (free == null) return;
    final margin = math.max(minimumFreeMarginBytes, remainingBytes ~/ 20);
    if (free < remainingBytes + margin) {
      throw AppException(
        ErrorCodes.insufficientStorage,
        'No hay espacio suficiente: se necesitan ${formatBytes(remainingBytes + margin)} '
        'y hay ${formatBytes(free)} libres.',
      );
    }
  }

  Future<int> _transfer(
    DownloadRequest request,
    int offset, {
    required bool allowRestart,
    CancelToken? cancelToken,
    DownloadProgressCallback? onProgress,
    void Function(String? etag)? onValidator,
  }) async {
    final Response<ResponseBody> response;
    try {
      response = await _dio.getUri<ResponseBody>(
        request.url,
        cancelToken: cancelToken,
        options: Options(
          responseType: ResponseType.stream,
          headers: {
            if (offset > 0) 'Range': 'bytes=$offset-',
            if (offset > 0 && request.etag != null) 'If-Range': request.etag,
          },
          validateStatus: (status) => status == 200 || status == 206 || status == 416,
        ),
      );
    } on DioException catch (error) {
      throw _mapError(error);
    }
    final headers = response.headers;
    final body = response.data!;

    if (response.statusCode == 416) {
      await body.stream.drain<void>();
      // Nothing left to send: the .part is complete, or it no longer matches.
      if (_totalFromContentRange(headers.value('content-range')) == offset) return offset;
      await request.partFile.delete();
      if (!allowRestart) throw AppException.of(ErrorCodes.mapDownloadFailed);
      return _transfer(
        request,
        0,
        allowRestart: false,
        cancelToken: cancelToken,
        onProgress: onProgress,
        onValidator: onValidator,
      );
    }

    final serverChecksum = headers.value('x-checksum-sha256');
    if (serverChecksum != null &&
        serverChecksum.toLowerCase() != request.expectedSha256.toLowerCase()) {
      // Abort the response and drop bytes that belong to the old file.
      await body.stream.listen(null).cancel();
      if (await request.partFile.exists()) await request.partFile.delete();
      throw const AppException(
        ErrorCodes.checksumMismatch,
        'La región se actualizó en el servidor mientras se descargaba. '
        'Actualiza la lista e inténtalo de nuevo.',
      );
    }
    onValidator?.call(headers.value('etag'));

    var start = offset;
    if (response.statusCode == 206) {
      final rangeStart = _startFromContentRange(headers.value('content-range'));
      if (rangeStart != offset) {
        throw AppException(
          ErrorCodes.mapDownloadFailed,
          'El servidor respondió un rango inesperado ($rangeStart en lugar de $offset).',
        );
      }
    } else {
      // 200: the server sent the whole file (first attempt, or If-Range did
      // not match because the file changed), so the .part starts over.
      start = 0;
    }
    return _write(body.stream, request, start: start, onProgress: onProgress);
  }

  Future<int> _write(
    Stream<Uint8List> stream,
    DownloadRequest request, {
    required int start,
    DownloadProgressCallback? onProgress,
  }) async {
    final file = await request.partFile.open(mode: start == 0 ? FileMode.write : FileMode.append);
    final buffer = BytesBuilder(copy: false);
    var written = start;
    Future<void> flush() async {
      if (buffer.isEmpty) return;
      final bytes = buffer.takeBytes();
      await file.writeFrom(bytes);
      written += bytes.length;
      onProgress?.call(written, request.expectedBytes);
    }

    try {
      await for (final chunk in stream) {
        buffer.add(chunk);
        if (written + buffer.length > request.expectedBytes) {
          throw const AppException(
            ErrorCodes.mapDownloadFailed,
            'El servidor envió más datos de los esperados.',
          );
        }
        if (buffer.length >= _flushThreshold) await flush();
      }
      await flush();
      return written;
    } on DioException catch (error) {
      await flush();
      throw _mapError(error);
    } on FileSystemException catch (error) {
      throw _mapFileError(error);
    } on IOException catch (error) {
      // The connection dropped while reading the body (socket closed).
      await flush();
      throw AppException(
        ErrorCodes.networkUnavailable,
        'Se perdió la conexión. La descarga continuará desde donde quedó.',
        cause: error,
      );
    } finally {
      await file.close();
    }
  }

  AppException _mapError(DioException error) {
    switch (error.type) {
      case DioExceptionType.cancel:
        return AppException.of(ErrorCodes.downloadCancelled, cause: error);
      case DioExceptionType.badResponse:
        final status = error.response?.statusCode;
        if (status == 404) {
          return AppException.of(
            ErrorCodes.mapRegionFileNotAvailable,
            statusCode: status,
            cause: error,
          );
        }
        return AppException(
          ErrorCodes.mapDownloadFailed,
          'El servidor rechazó la descarga (HTTP $status).',
          statusCode: status,
          cause: error,
        );
      case DioExceptionType.badCertificate:
        return AppException(
          ErrorCodes.mapDownloadFailed,
          'El certificado del servidor no es válido.',
          cause: error,
        );
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.transformTimeout:
      case DioExceptionType.connectionError:
      case DioExceptionType.unknown:
        final cause = error.error;
        if (cause is FileSystemException) return _mapFileError(cause);
        return AppException(
          ErrorCodes.networkUnavailable,
          'Se perdió la conexión. La descarga continuará desde donde quedó.',
          cause: error,
        );
    }
  }

  static AppException _mapFileError(FileSystemException error) {
    // ENOSPC is 28 on Linux, Android and iOS.
    if (error.osError?.errorCode == 28) {
      return AppException.of(ErrorCodes.insufficientStorage, cause: error);
    }
    return AppException(
      ErrorCodes.mapDownloadFailed,
      'No se pudo escribir el archivo: ${error.message}',
      cause: error,
    );
  }

  static int? _startFromContentRange(String? value) {
    final match = RegExp(r'^bytes (\d+)-\d+/(\d+|\*)$').firstMatch(value?.trim() ?? '');
    return match == null ? null : int.parse(match.group(1)!);
  }

  static int? _totalFromContentRange(String? value) {
    final match = RegExp(r'/(\d+)$').firstMatch(value?.trim() ?? '');
    return match == null ? null : int.parse(match.group(1)!);
  }
}

/// SHA-256 (hex) of a file, computed in a background isolate so hashing
/// hundreds of MB does not block the UI.
Future<String> sha256InIsolate(String path) => Isolate.run(() async {
  final digest = await sha256.bind(File(path).openRead()).first;
  return digest.toString();
});
