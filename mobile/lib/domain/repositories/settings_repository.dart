/// Small values kept on the device (identifiers, synchronization cursors).
abstract class SettingsRepository {
  Future<String?> read(String key);

  Future<void> write(String key, String value);

  Future<void> remove(String key);

  /// Random id generated once per installation. The server uses it to tell
  /// the user's devices apart (trips, downloaded regions).
  Future<String> installationId();
}
