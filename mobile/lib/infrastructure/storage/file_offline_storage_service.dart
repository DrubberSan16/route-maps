import 'dart:io';

import 'package:disk_space_2/disk_space_2.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../../domain/services/offline_storage_service.dart';

/// Offline files under `<application support>/offline/` (excluded from device
/// backups):
///
/// ```
/// offline/
/// ├── regions/<code>/<version>/<code>.pmtiles(.part)
/// └── glyphs/<font stack>/<range>.pbf
/// ```
class FileOfflineStorageService implements OfflineStorageService {
  FileOfflineStorageService({
    Future<Directory> Function()? baseDirectory,
    Future<int?> Function(String path)? freeBytesOf,
    Future<void> Function(Directory directory)? excludeFromBackup,
  }) : _baseDirectory = baseDirectory ?? getApplicationSupportDirectory,
       _freeBytesOf = freeBytesOf ?? _platformFreeBytes,
       _excludeFromBackup = excludeFromBackup ?? _platformExcludeFromBackup;

  final Future<Directory> Function() _baseDirectory;
  final Future<int?> Function(String path) _freeBytesOf;
  final Future<void> Function(Directory directory) _excludeFromBackup;
  Directory? _root;

  static const _storageChannel = MethodChannel('maps_platform/storage');

  /// Region codes and versions come from the API; they become path segments.
  static final _safeSegment = RegExp(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$');

  @override
  Future<Directory> rootDirectory() async {
    if (_root != null) return _root!;
    final root = Directory(p.join((await _baseDirectory()).path, 'offline'));
    await root.create(recursive: true);
    await _excludeFromBackup(root);
    return _root = root;
  }

  @override
  Future<File> regionMapFile(String code, String version) async {
    _checkSegment(code);
    _checkSegment(version);
    final root = await rootDirectory();
    return File(p.join(root.path, 'regions', code, version, '$code.pmtiles'));
  }

  @override
  Future<File> resolve(String relativePath) async {
    final root = await rootDirectory();
    final path = p.normalize(p.join(root.path, relativePath));
    if (!p.isWithin(root.path, path)) {
      throw ArgumentError.value(relativePath, 'relativePath', 'escapes the storage directory');
    }
    return File(path);
  }

  @override
  Future<String> relativePathOf(File file) async {
    final root = await rootDirectory();
    if (!p.isWithin(root.path, file.path)) {
      throw ArgumentError.value(file.path, 'file', 'is outside the storage directory');
    }
    return p.relative(file.path, from: root.path);
  }

  @override
  Future<int?> freeBytes() async => _freeBytesOf((await rootDirectory()).path);

  @override
  Future<void> deleteRegionFiles(String code, {String? keepVersion}) async {
    _checkSegment(code);
    final directory = Directory(p.join((await rootDirectory()).path, 'regions', code));
    if (!await directory.exists()) return;
    if (keepVersion == null) {
      await directory.delete(recursive: true);
      return;
    }
    await for (final entry in directory.list(followLinks: false)) {
      if (p.basename(entry.path) != keepVersion) {
        await entry.delete(recursive: true);
      }
    }
  }

  @override
  Future<Directory> glyphsDirectory() async {
    final directory = Directory(p.join((await rootDirectory()).path, 'glyphs'));
    await directory.create(recursive: true);
    return directory;
  }

  static void _checkSegment(String value) {
    if (!_safeSegment.hasMatch(value) || value.contains('..')) {
      throw ArgumentError.value(value, 'value', 'is not a valid path segment');
    }
  }

  /// Maps and glyphs can be downloaded again, so they stay out of the
  /// device backups (Apple's data storage guidelines; hundreds of MB would
  /// otherwise go to iCloud). Android keeps all app data out of backups in
  /// the manifest (`allowBackup="false"`).
  static Future<void> _platformExcludeFromBackup(Directory directory) async {
    if (!Platform.isIOS) return;
    try {
      await _storageChannel.invokeMethod<void>('excludeFromBackup', {'path': directory.path});
    } on PlatformException catch (error) {
      // The maps still work offline; they would only be part of the next backup.
      debugPrint('Offline maps could not be excluded from backups: ${error.message}');
    }
  }

  /// Free space reported by the platform in MiB, converted to bytes. Null on
  /// platforms without the plugin (unit tests on the host).
  static Future<int?> _platformFreeBytes(String path) async {
    try {
      final mebibytes = await DiskSpace.getFreeDiskSpaceForPath(path);
      return mebibytes == null ? null : (mebibytes * 1024 * 1024).floor();
    } on MissingPluginException {
      return null;
    }
  }
}
