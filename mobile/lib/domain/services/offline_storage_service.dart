import 'dart:io';

/// Files kept on the device for offline use (maps, glyphs).
abstract class OfflineStorageService {
  /// Base directory; relative paths stored in the database start here.
  Future<Directory> rootDirectory();

  /// Final location of a region's PMTiles: `regions/<code>/<version>/<code>.pmtiles`.
  Future<File> regionMapFile(String code, String version);

  Future<File> resolve(String relativePath);

  Future<String> relativePathOf(File file);

  /// Free bytes on the volume holding [rootDirectory], or null when the
  /// platform cannot report it.
  Future<int?> freeBytes();

  /// Deletes the files of a region, except [keepVersion] when given.
  Future<void> deleteRegionFiles(String code, {String? keepVersion});

  /// Directory with the SDF glyphs used by the map labels.
  Future<Directory> glyphsDirectory();
}
