import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';

import '../../core/errors/app_exception.dart';
import '../../core/utils/streams.dart';
import '../../data/local/region_download_store.dart';
import '../../domain/entities/coordinate.dart';
import '../../domain/entities/map_region.dart';
import '../../domain/entities/sync.dart';
import '../../domain/repositories/region_repository.dart';
import '../../domain/services/connectivity_service.dart';
import '../../domain/services/offline_storage_service.dart';
import '../../domain/services/synchronization_service.dart';
import '../../infrastructure/download/region_download_manager.dart';

enum RegionDownloadResult { completed, paused, failed }

/// Downloads of offline regions: start, progress, pause, resume, retry,
/// discard, update to a newer version and delete.
///
/// A new version is downloaded next to the current one, which stays usable
/// until the new file is complete and verified; only then are the old files
/// removed. Downloads interrupted by a lost connection or by closing the app
/// resume by themselves when the connection is back.
class RegionDownloadService {
  RegionDownloadService({
    required this._regions,
    required this._store,
    required this._manager,
    required this._storage,
    required this._sync,
    required this._connectivity,
    required this._resolveUrl,
    DateTime Function()? clock,
    this.progressInterval = const Duration(milliseconds: 250),
  }) : _clock = clock ?? DateTime.now;

  final RegionRepository _regions;
  final RegionDownloadStore _store;
  final RegionDownloadManager _manager;
  final OfflineStorageService _storage;
  final SynchronizationService _sync;
  final ConnectivityService _connectivity;
  final Uri Function(String path) _resolveUrl;
  final DateTime Function() _clock;

  /// Minimum time between two progress notifications.
  final Duration progressInterval;

  final _tasks = <String, RegionDownloadTask>{};
  final _running = <String, _RunningDownload>{};

  /// Downloads to resume when the connection comes back.
  final _autoResume = <String>{};

  /// Downloads being discarded: their cancellation must not leave a task.
  final _discarding = <String>{};
  final _changes = StreamController<Map<String, RegionDownloadTask>>.broadcast();
  StreamSubscription<ConnectivityStatus>? _connectivitySubscription;

  /// Unfinished downloads by region code.
  Map<String, RegionDownloadTask> get tasks => Map.unmodifiable(_tasks);

  Stream<Map<String, RegionDownloadTask>> watchTasks() =>
      currentAndChanges(() => tasks, _changes.stream);

  /// Restores the unfinished downloads of a previous session and forgets
  /// regions whose files were removed outside the app.
  Future<void> start() async {
    await _regions.removeMissingFiles();
    for (final row in await _store.all()) {
      final status = RegionDownloadStore.statusOf(row.status);
      final interrupted = status == RegionDownloadStatus.downloading;
      if (interrupted || row.errorCode == ErrorCodes.networkUnavailable) {
        _autoResume.add(row.code);
      }
      _tasks[row.code] = RegionDownloadTask(
        code: row.code,
        name: row.name,
        version: row.version,
        totalBytes: row.totalBytes,
        receivedBytes: await _partLength(row.relativePath),
        // The app was closed while downloading: the task is paused.
        status: interrupted ? RegionDownloadStatus.paused : status,
        errorCode: row.errorCode,
        errorMessage: row.errorMessage,
      );
    }
    await _store.markInterrupted();
    _emit();
    _connectivitySubscription ??= _connectivity.watchStatus().listen((status) {
      if (status == ConnectivityStatus.online) _resumeInterrupted();
    });
  }

  /// Downloads [region] (or resumes it) and registers it for offline use.
  Future<RegionDownloadResult> download(MapRegion region) {
    final running = _running[region.code];
    if (running != null) return running.result;
    final token = CancelToken();
    final result = _download(region, token).whenComplete(() => _running.remove(region.code));
    _running[region.code] = _RunningDownload(token, result);
    return result;
  }

  /// Resumes a paused or failed download with the catalog entry of its region.
  Future<RegionDownloadResult> resume(String code) async {
    final catalog = await _regions.cachedCatalog();
    final region = catalog.where((region) => region.code == code).firstOrNull;
    if (region == null) {
      await _fail(code, AppException.of(ErrorCodes.mapRegionNotFound));
      return RegionDownloadResult.failed;
    }
    return download(region);
  }

  /// Stops the download and keeps the bytes received so far.
  void pause(String code) {
    _autoResume.remove(code);
    _running[code]?.token.cancel();
  }

  /// Stops the download (if running) and deletes what was received.
  Future<void> discard(String code) async {
    _autoResume.remove(code);
    final running = _running[code];
    if (running != null) {
      _discarding.add(code);
      running.token.cancel();
      await running.result;
      _discarding.remove(code);
    }
    final row = await _store.find(code);
    if (row != null) await _deletePart(row.relativePath);
    await _store.remove(code);
    _tasks.remove(code);
    _emit();
  }

  /// Removes a downloaded region from the device, with any pending update.
  Future<void> deleteRegion(DownloadedRegion region) async {
    await discard(region.code);
    await _regions.deleteDownloaded(region.code);
    await _sync.enqueue(
      entity: SyncEntities.downloadedRegion,
      operation: SyncOperations.delete,
      payload: {'regionId': region.code, 'version': region.version},
    );
  }

  /// Catalog region covering [position] when no downloaded region does, so
  /// the app can offer to download it.
  Future<MapRegion?> missingRegionAt(Coordinate position) async {
    if ((await _regions.downloadedRegionsAt(position)).isNotEmpty) return null;
    return _regions.detectRegion(position);
  }

  Future<void> dispose() async {
    await _connectivitySubscription?.cancel();
    for (final running in _running.values) {
      running.token.cancel();
    }
    await _changes.close();
  }

  Future<RegionDownloadResult> _download(MapRegion region, CancelToken token) async {
    _autoResume.remove(region.code);
    final target = await _storage.regionMapFile(region.code, region.version);
    final relativePath = await _storage.relativePathOf(target);
    final previous = await _store.find(region.code);
    if (previous != null && previous.relativePath != relativePath) {
      // Partial file of an older version: it can never be completed.
      await _deletePart(previous.relativePath);
    }
    final row = await _store.begin(
      region: region,
      url: region.mapDownloadUrl,
      relativePath: relativePath,
    );
    var task = RegionDownloadTask(
      code: region.code,
      name: region.name,
      version: region.version,
      totalBytes: region.mapSizeBytes,
      receivedBytes: await _partLength(relativePath),
      status: RegionDownloadStatus.downloading,
    );
    _update(task);

    var lastNotified = DateTime.fromMillisecondsSinceEpoch(0);
    try {
      await _manager.download(
        DownloadRequest(
          url: _resolveUrl(region.mapDownloadUrl),
          target: target,
          expectedBytes: region.mapSizeBytes,
          expectedSha256: region.checksum,
          etag: row.etag,
        ),
        cancelToken: token,
        onProgress: (received, total) {
          final now = _clock();
          if (received < total && now.difference(lastNotified) < progressInterval) return;
          lastNotified = now;
          task = task.copyWith(receivedBytes: received);
          _update(task);
        },
        onValidator: (etag) => unawaited(_store.setEtag(region.code, etag)),
      );
    } on AppException catch (error) {
      if (error.code == ErrorCodes.downloadCancelled) {
        if (_discarding.contains(region.code)) return RegionDownloadResult.paused;
        await _store.setStatus(region.code, RegionDownloadStatus.paused);
        _update(task.copyWith(status: RegionDownloadStatus.paused));
        return RegionDownloadResult.paused;
      }
      if (error.isNetworkError) {
        _autoResume.add(region.code);
        _connectivity.reportNetworkFailure();
      }
      await _fail(region.code, error);
      return RegionDownloadResult.failed;
    } on FileSystemException catch (error) {
      await _fail(
        region.code,
        AppException(
          ErrorCodes.mapDownloadFailed,
          'No se pudo guardar el mapa en el dispositivo: ${error.message}',
          cause: error,
        ),
      );
      return RegionDownloadResult.failed;
    }

    await _regions.saveDownloaded(
      region: region,
      relativePath: relativePath,
      sizeBytes: region.mapSizeBytes,
    );
    await _store.remove(region.code);
    // The new version is registered: files of older versions can go.
    await _storage.deleteRegionFiles(region.code, keepVersion: region.version);
    await _sync.enqueue(
      entity: SyncEntities.downloadedRegion,
      operation: SyncOperations.upsert,
      payload: {'regionId': region.code, 'version': region.version},
    );
    _tasks.remove(region.code);
    _emit();
    return RegionDownloadResult.completed;
  }

  void _resumeInterrupted() {
    for (final code in _autoResume.toList()) {
      if (_running.containsKey(code) || !_tasks.containsKey(code)) continue;
      unawaited(resume(code));
    }
  }

  Future<void> _fail(String code, AppException error) async {
    await _store.setStatus(
      code,
      RegionDownloadStatus.failed,
      errorCode: error.code,
      errorMessage: error.message,
    );
    final task = _tasks[code];
    if (task != null) {
      _update(
        task.copyWith(
          status: RegionDownloadStatus.failed,
          errorCode: error.code,
          errorMessage: error.message,
        ),
      );
    }
  }

  Future<int> _partLength(String relativePath) async {
    final part = File('${(await _storage.resolve(relativePath)).path}.part');
    return await part.exists() ? part.length() : 0;
  }

  Future<void> _deletePart(String relativePath) async {
    final part = File('${(await _storage.resolve(relativePath)).path}.part');
    if (await part.exists()) await part.delete();
  }

  void _update(RegionDownloadTask task) {
    _tasks[task.code] = task;
    _emit();
  }

  void _emit() {
    if (!_changes.isClosed) _changes.add(tasks);
  }
}

class _RunningDownload {
  const _RunningDownload(this.token, this.result);

  final CancelToken token;
  final Future<RegionDownloadResult> result;
}
