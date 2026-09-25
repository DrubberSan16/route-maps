import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';
import 'package:path_provider/path_provider.dart';

import '../../domain/entities/sync.dart';
import 'tables.dart';

export 'tables.dart';

part 'app_database.g.dart';

/// Local SQLite database (Drift). Everything the app needs offline lives here:
/// the region catalog, downloaded regions, saved routes, trips with their GPS
/// points and the `sync_queue` of changes waiting for the server.
@DriftDatabase(
  tables: [
    CatalogRegions,
    DownloadedRegions,
    RegionDownloads,
    OfflineRoutes,
    SyncQueue,
    Trips,
    TrackingPoints,
    KeyValues,
  ],
)
class AppDatabase extends _$AppDatabase {
  AppDatabase(super.executor);

  /// Database file in the application support directory.
  factory AppDatabase.open() => AppDatabase(
    driftDatabase(
      name: 'maps_platform',
      native: const DriftNativeOptions(databaseDirectory: getApplicationSupportDirectory),
    ),
  );

  @override
  int get schemaVersion => 1;

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (migrator) => migrator.createAll(),
    beforeOpen: (details) async {
      await customStatement('PRAGMA foreign_keys = ON');
    },
  );

  Future<String?> readValue(String key) async {
    final row = await (select(
      keyValues,
    )..where((table) => table.key.equals(key))).getSingleOrNull();
    return row?.value;
  }

  Future<void> writeValue(String key, String value) =>
      into(keyValues).insertOnConflictUpdate(KeyValuesCompanion.insert(key: key, value: value));

  Future<void> deleteValue(String key) =>
      (delete(keyValues)..where((table) => table.key.equals(key))).go();
}
