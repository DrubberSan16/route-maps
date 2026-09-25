import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config/app_config.dart';
import '../data/local/app_database.dart';
import '../data/local/region_download_store.dart';
import '../data/local/sync_queue_store.dart';
import '../data/remote/api_client.dart';
import '../data/remote/auth_interceptor.dart';
import '../data/remote/session_store.dart';
import '../data/repositories/auth_repository_impl.dart';
import '../data/repositories/geocoding_repository_impl.dart';
import '../data/repositories/map_repository_impl.dart';
import '../data/repositories/region_repository_impl.dart';
import '../data/repositories/saved_route_repository_impl.dart';
import '../data/repositories/settings_repository_impl.dart';
import '../data/repositories/trip_repository_impl.dart';
import '../domain/entities/map_region.dart';
import '../domain/entities/offline_route.dart';
import '../domain/entities/position.dart';
import '../domain/entities/sync.dart';
import '../domain/entities/trip.dart';
import '../domain/entities/user.dart';
import '../domain/repositories/auth_repository.dart';
import '../domain/repositories/geocoding_repository.dart';
import '../domain/repositories/map_repository.dart';
import '../domain/repositories/region_repository.dart';
import '../domain/repositories/saved_route_repository.dart';
import '../domain/repositories/settings_repository.dart';
import '../domain/repositories/trip_repository.dart';
import '../domain/services/connectivity_service.dart';
import '../domain/services/location_service.dart';
import '../domain/services/offline_routing_provider.dart';
import '../domain/services/offline_storage_service.dart';
import '../domain/services/routing_service.dart';
import '../domain/services/synchronization_service.dart';
import '../infrastructure/connectivity/reachability_connectivity_service.dart';
import '../infrastructure/download/region_download_manager.dart';
import '../infrastructure/location/geolocator_location_service.dart';
import '../infrastructure/security/secure_session_store.dart';
import '../infrastructure/storage/file_offline_storage_service.dart';
import '../services/map/map_style_service.dart';
import '../services/regions/region_download_service.dart';
import '../services/routing/hybrid_routing_service.dart';
import '../services/routing/offline_routing_service.dart';
import '../services/routing/online_routing_service.dart';
import '../services/routing/unavailable_offline_routing_provider.dart';
import '../services/sync/sync_service.dart';
import '../services/tracking/trip_recorder.dart';

// Composition root: every dependency of the app is created here, and every
// provider can be overridden (tests replace the platform-bound ones).

final appConfigProvider = Provider<AppConfig>((ref) => AppConfig.fromEnvironment());

final databaseProvider = Provider<AppDatabase>((ref) {
  final db = AppDatabase.open();
  ref.onDispose(db.close);
  return db;
});

final sessionStoreProvider = Provider<SessionStore>((ref) => SecureSessionStore());

/// Dio without interceptors: token refresh, health probe, file downloads.
final plainDioProvider = Provider<Dio>((ref) {
  final dio = createApiDio(ref.watch(appConfigProvider));
  ref.onDispose(dio.close);
  return dio;
});

final apiDioProvider = Provider<Dio>((ref) {
  final dio = createApiDio(ref.watch(appConfigProvider));
  dio.interceptors.add(
    AuthInterceptor(
      sessions: ref.watch(sessionStoreProvider),
      plainDio: ref.watch(plainDioProvider),
    ),
  );
  ref.onDispose(dio.close);
  return dio;
});

final connectivityServiceProvider = Provider<ConnectivityService>((ref) {
  final config = ref.watch(appConfigProvider);
  final service = ReachabilityConnectivityService(
    network: ConnectivityPlusNetworkMonitor(),
    probe: healthProbe(ref.watch(plainDioProvider), config.resolve('/health/live')),
  );
  unawaited(service.start());
  ref.onDispose(service.dispose);
  return service;
});

final apiClientProvider = Provider<ApiClient>(
  (ref) => ApiClient(
    ref.watch(apiDioProvider),
    onNetworkFailure: () => ref.read(connectivityServiceProvider).reportNetworkFailure(),
  ),
);

final locationServiceProvider = Provider<LocationService>((ref) => GeolocatorLocationService());

final offlineStorageProvider = Provider<OfflineStorageService>(
  (ref) => FileOfflineStorageService(),
);

final syncQueueStoreProvider = Provider<SyncQueueStore>(
  (ref) => SyncQueueStore(ref.watch(databaseProvider)),
);

final settingsRepositoryProvider = Provider<SettingsRepository>(
  (ref) => SettingsRepositoryImpl(ref.watch(databaseProvider)),
);

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepositoryImpl(
    api: ref.watch(apiClientProvider),
    sessions: ref.watch(sessionStoreProvider),
  ),
);

final regionRepositoryProvider = Provider<RegionRepository>(
  (ref) => RegionRepositoryImpl(
    api: ref.watch(apiClientProvider),
    db: ref.watch(databaseProvider),
    storage: ref.watch(offlineStorageProvider),
  ),
);

final mapRepositoryProvider = Provider<MapRepository>(
  (ref) => MapRepositoryImpl(
    regions: ref.watch(regionRepositoryProvider),
    storage: ref.watch(offlineStorageProvider),
    config: ref.watch(appConfigProvider),
  ),
);

final savedRouteRepositoryProvider = Provider<SavedRouteRepository>(
  (ref) => SavedRouteRepositoryImpl(
    db: ref.watch(databaseProvider),
    queue: ref.watch(syncQueueStoreProvider),
  ),
);

final tripRepositoryProvider = Provider<TripRepository>(
  (ref) =>
      TripRepositoryImpl(db: ref.watch(databaseProvider), queue: ref.watch(syncQueueStoreProvider)),
);

final geocodingRepositoryProvider = Provider<GeocodingRepository>(
  (ref) => GeocodingRepositoryImpl(ref.watch(apiClientProvider)),
);

/// On-device routing engine (Mode 2). None is bundled yet: see
/// docs/offline-architecture.md.
final offlineRoutingProviderProvider = Provider<OfflineRoutingProvider>(
  (ref) => const UnavailableOfflineRoutingProvider(),
);

final offlineRoutingServiceProvider = Provider<OfflineRoutingService>(
  (ref) => OfflineRoutingService(
    savedRoutes: ref.watch(savedRouteRepositoryProvider),
    provider: ref.watch(offlineRoutingProviderProvider),
  ),
);

final routingServiceProvider = Provider<RoutingService>(
  (ref) => HybridRoutingService(
    online: OnlineRoutingService(
      ref.watch(apiClientProvider),
      language: ref.watch(appConfigProvider).routeLanguage,
    ),
    offline: ref.watch(offlineRoutingServiceProvider),
    connectivity: ref.watch(connectivityServiceProvider),
  ),
);

final synchronizationServiceProvider = Provider<SynchronizationService>((ref) {
  final service = SyncService(
    api: ref.watch(apiClientProvider),
    queue: ref.watch(syncQueueStoreProvider),
    trips: ref.watch(tripRepositoryProvider),
    savedRoutes: ref.watch(savedRouteRepositoryProvider),
    auth: ref.watch(authRepositoryProvider),
    connectivity: ref.watch(connectivityServiceProvider),
    settings: ref.watch(settingsRepositoryProvider),
  );
  unawaited(service.start());
  ref.onDispose(service.dispose);
  return service;
});

final regionDownloadServiceProvider = Provider<RegionDownloadService>((ref) {
  final storage = ref.watch(offlineStorageProvider);
  final config = ref.watch(appConfigProvider);
  final service = RegionDownloadService(
    regions: ref.watch(regionRepositoryProvider),
    store: RegionDownloadStore(ref.watch(databaseProvider)),
    manager: RegionDownloadManager(dio: ref.watch(plainDioProvider), freeBytes: storage.freeBytes),
    storage: storage,
    sync: ref.watch(synchronizationServiceProvider),
    connectivity: ref.watch(connectivityServiceProvider),
    resolveUrl: config.resolve,
  );
  unawaited(service.start());
  ref.onDispose(service.dispose);
  return service;
});

final tripRecorderProvider = Provider<TripRecorder>((ref) {
  final recorder = TripRecorder(
    trips: ref.watch(tripRepositoryProvider),
    location: ref.watch(locationServiceProvider),
    settings: ref.watch(settingsRepositoryProvider),
  );
  unawaited(recorder.restore());
  ref.onDispose(recorder.dispose);
  return recorder;
});

final mapStyleServiceProvider = Provider<MapStyleService>(
  (ref) => MapStyleService(storage: ref.watch(offlineStorageProvider)),
);

// State exposed to the widgets.

final connectivityStatusProvider = StreamProvider<ConnectivityStatus>(
  (ref) => ref.watch(connectivityServiceProvider).watchStatus(),
);

/// True only once the API is known to be reachable.
final isOnlineProvider = Provider<bool>(
  (ref) => ref.watch(connectivityStatusProvider).value == ConnectivityStatus.online,
);

final sessionProvider = StreamProvider<AuthSession?>(
  (ref) => ref.watch(authRepositoryProvider).watchSession(),
);

final syncStateProvider = StreamProvider<SyncState>(
  (ref) => ref.watch(synchronizationServiceProvider).watchState(),
);

final catalogProvider = StreamProvider<List<MapRegion>>(
  (ref) => ref.watch(regionRepositoryProvider).watchCatalog(),
);

final downloadedRegionsProvider = StreamProvider<List<DownloadedRegion>>(
  (ref) => ref.watch(regionRepositoryProvider).watchDownloadedRegions(),
);

final downloadTasksProvider = StreamProvider<Map<String, RegionDownloadTask>>(
  (ref) => ref.watch(regionDownloadServiceProvider).watchTasks(),
);

final savedRoutesProvider = StreamProvider<List<OfflineRoute>>(
  (ref) => ref.watch(savedRouteRepositoryProvider).watchAll(),
);

final tripsProvider = StreamProvider<List<Trip>>(
  (ref) => ref.watch(tripRepositoryProvider).watchTrips(),
);

final recordingProvider = StreamProvider<RecordingState>(
  (ref) => ref.watch(tripRecorderProvider).watch(),
);

/// Live GPS fixes while the map is visible (the stream stops without listeners).
final positionProvider = StreamProvider<Position>(
  (ref) => ref.watch(locationServiceProvider).watchPosition(),
);
