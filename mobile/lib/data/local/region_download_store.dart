import 'package:drift/drift.dart';

import '../../core/utils/time.dart';
import '../../domain/entities/map_region.dart';
import 'app_database.dart';

/// Persisted state of unfinished downloads, so they can be resumed after the
/// app is closed. The downloaded bytes themselves are the `.part` file.
class RegionDownloadStore {
  RegionDownloadStore(this._db, {DateTime Function()? clock}) : _clock = clock ?? DateTime.now;

  final AppDatabase _db;
  final DateTime Function() _clock;

  static const _statusValues = {
    RegionDownloadStatus.downloading: 'DOWNLOADING',
    RegionDownloadStatus.paused: 'PAUSED',
    RegionDownloadStatus.failed: 'FAILED',
  };

  static const _partValues = {
    RegionDownloadPart.map: 'map',
    RegionDownloadPart.offlinePack: 'routing',
  };

  static RegionDownloadStatus statusOf(String value) =>
      _statusValues.entries.firstWhere((entry) => entry.value == value).key;

  static RegionDownloadPart partOf(String value) => _partValues.entries
      .firstWhere((entry) => entry.value == value, orElse: () => _partValues.entries.first)
      .key;

  Future<List<RegionDownloadRow>> all() => _db.select(_db.regionDownloads).get();

  Future<RegionDownloadRow?> find(String code) =>
      (_db.select(_db.regionDownloads)..where((t) => t.code.equals(code))).getSingleOrNull();

  /// Starts (or restarts) tracking the download of one file of [region]: [part]
  /// (by default the map) from [url] to [relativePath]. [totalBytes] counts
  /// every file of the download and [doneBytes] those already completed.
  Future<RegionDownloadRow> begin({
    required MapRegion region,
    required String url,
    required String relativePath,
    RegionDownloadPart part = RegionDownloadPart.map,
    String? checksum,
    int? totalBytes,
    int doneBytes = 0,
  }) async {
    final existing = await find(region.code);
    final now = utcMillis(_clock());
    // A task for another version (or file) cannot reuse its ETag.
    final sameTarget =
        existing != null &&
        existing.version == region.version &&
        existing.relativePath == relativePath;
    await _db
        .into(_db.regionDownloads)
        .insertOnConflictUpdate(
          RegionDownloadsCompanion.insert(
            code: region.code,
            name: region.name,
            version: region.version,
            checksum: checksum ?? region.checksum,
            totalBytes: totalBytes ?? region.mapSizeBytes,
            doneBytes: Value(doneBytes),
            kind: Value(_partValues[part]!),
            url: url,
            relativePath: relativePath,
            etag: Value(sameTarget ? existing.etag : null),
            status: _statusValues[RegionDownloadStatus.downloading]!,
            startedAt: sameTarget ? existing.startedAt : now,
            updatedAt: now,
          ),
        );
    return (await find(region.code))!;
  }

  Future<void> setEtag(String code, String? etag) =>
      (_db.update(_db.regionDownloads)..where((t) => t.code.equals(code))).write(
        RegionDownloadsCompanion(etag: Value(etag), updatedAt: Value(utcMillis(_clock()))),
      );

  Future<void> setStatus(
    String code,
    RegionDownloadStatus status, {
    String? errorCode,
    String? errorMessage,
  }) => (_db.update(_db.regionDownloads)..where((t) => t.code.equals(code))).write(
    RegionDownloadsCompanion(
      status: Value(_statusValues[status]!),
      errorCode: Value(errorCode),
      errorMessage: Value(errorMessage),
      updatedAt: Value(utcMillis(_clock())),
    ),
  );

  Future<void> remove(String code) =>
      (_db.delete(_db.regionDownloads)..where((t) => t.code.equals(code))).go();

  /// Downloads marked as running when the app starts were interrupted.
  Future<int> markInterrupted() =>
      (_db.update(
        _db.regionDownloads,
      )..where((t) => t.status.equals(_statusValues[RegionDownloadStatus.downloading]!))).write(
        RegionDownloadsCompanion(
          status: Value(_statusValues[RegionDownloadStatus.paused]!),
          updatedAt: Value(utcMillis(_clock())),
        ),
      );
}
