import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/infrastructure/storage/file_offline_storage_service.dart';

void main() {
  late Directory base;
  late List<String> excluded;
  late FileOfflineStorageService storage;

  setUp(() async {
    base = await Directory.systemTemp.createTemp('storage_test_');
    excluded = [];
    storage = FileOfflineStorageService(
      baseDirectory: () async => base,
      freeBytesOf: (_) async => 1000,
      excludeFromBackup: (directory) async => excluded.add(directory.path),
    );
  });

  tearDown(() => base.delete(recursive: true));

  test('offline data lives in its own directory, kept out of backups', () async {
    final root = await storage.rootDirectory();
    expect(root.path, '${base.path}/offline');
    expect(await root.exists(), isTrue);
    await storage.rootDirectory();
    expect(excluded, [root.path], reason: 'marked once');
  });

  test('regions are stored by code and version, with relative paths in the database', () async {
    final file = await storage.regionMapFile('guayaquil', '2026.09.20');
    expect(file.path, '${base.path}/offline/regions/guayaquil/2026.09.20/guayaquil.pmtiles');
    final relative = await storage.relativePathOf(file);
    expect(relative, 'regions/guayaquil/2026.09.20/guayaquil.pmtiles');
    expect((await storage.resolve(relative)).path, file.path);
  });

  test('deleting old versions keeps the current one', () async {
    for (final version in ['2026.08.01', '2026.09.20']) {
      final file = await storage.regionMapFile('guayaquil', version);
      await file.create(recursive: true);
    }
    await storage.deleteRegionFiles('guayaquil', keepVersion: '2026.09.20');
    expect(await (await storage.regionMapFile('guayaquil', '2026.08.01')).exists(), isFalse);
    expect(await (await storage.regionMapFile('guayaquil', '2026.09.20')).exists(), isTrue);

    await storage.deleteRegionFiles('guayaquil');
    expect(await Directory('${base.path}/offline/regions/guayaquil').exists(), isFalse);
  });

  test('values from the API cannot become paths outside the directory', () async {
    expect(() => storage.regionMapFile('..', '1'), throwsArgumentError);
    expect(() => storage.regionMapFile('guayaquil', '../../x'), throwsArgumentError);
    expect(() => storage.resolve('../outside.pmtiles'), throwsArgumentError);
    expect(() => storage.relativePathOf(File('/etc/passwd')), throwsArgumentError);
  });
}
