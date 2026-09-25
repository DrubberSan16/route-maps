import 'package:uuid/uuid.dart';

import '../../domain/repositories/settings_repository.dart';
import '../local/app_database.dart';

class SettingsRepositoryImpl implements SettingsRepository {
  SettingsRepositoryImpl(this._db, {this._uuid = const Uuid()});

  static const _installationIdKey = 'installation.id';

  final AppDatabase _db;
  final Uuid _uuid;
  Future<String>? _installationId;

  @override
  Future<String?> read(String key) => _db.readValue(key);

  @override
  Future<void> write(String key, String value) => _db.writeValue(key, value);

  @override
  Future<void> remove(String key) => _db.deleteValue(key);

  @override
  Future<String> installationId() => _installationId ??= _loadInstallationId();

  Future<String> _loadInstallationId() async {
    final stored = await _db.readValue(_installationIdKey);
    if (stored != null) return stored;
    final created = _uuid.v4();
    await _db.writeValue(_installationIdKey, created);
    return created;
  }
}
