import '../../core/errors/app_exception.dart';
import '../../domain/repositories/region_repository.dart';
import '../../domain/services/offline_storage_service.dart';
import '../../infrastructure/offline/offline_engine.dart';

/// Absolute paths of the offline packs stored on the device, for the offline engine.
typedef OfflinePackPaths = Future<List<String>> Function();

/// The offline packs of the regions downloaded with [regions], resolved in [storage].
OfflinePackPaths storedOfflinePacks(RegionRepository regions, OfflineStorageService storage) =>
    () async => [
      for (final region in await regions.downloadedRegions())
        if (region.routingRelativePath case final path?) (await storage.resolve(path)).path,
    ];

/// [error] of the offline engine as an [AppException] with [code], explained to the user.
AppException offlineEngineError(OfflineEngineException error, String code) => AppException(
  code,
  error.code == 'invalid_pack'
      ? 'Faltan o están dañados los datos sin conexión de una región. '
            'Descárgalos otra vez en «Mapas offline».'
      : 'No se pudieron usar los datos sin conexión del teléfono.',
  details: {'reason': error.message},
  cause: error,
);
