import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:maps_platform/data/local/app_database.dart';
import 'package:maps_platform/domain/services/offline_storage_service.dart';
import 'package:maps_platform/infrastructure/storage/file_offline_storage_service.dart';

/// A fresh in-memory database with the app schema.
AppDatabase memoryDatabase() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
  return AppDatabase(NativeDatabase.memory());
}

/// Offline storage in a temporary directory, with a fixed free space.
Future<({OfflineStorageService storage, Directory root})> temporaryStorage({
  int? freeBytes = 10 * 1000 * 1000 * 1000,
}) async {
  final root = await Directory.systemTemp.createTemp('maps_platform_test_');
  final storage = FileOfflineStorageService(
    baseDirectory: () async => root,
    freeBytesOf: (_) async => freeBytes,
  );
  return (storage: storage, root: root);
}

/// A controllable clock for code that timestamps rows.
class TestClock {
  TestClock([DateTime? start]) : now = start ?? DateTime.utc(2026, 9, 25, 12);

  DateTime now;

  DateTime call() => now;

  void advance(Duration duration) => now = now.add(duration);
}
