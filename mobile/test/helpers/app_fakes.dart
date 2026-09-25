import 'dart:async';

import 'package:flutter/material.dart';
import 'package:maps_platform/core/errors/app_exception.dart';
import 'package:maps_platform/core/utils/streams.dart';
import 'package:maps_platform/domain/entities/coordinate.dart';
import 'package:maps_platform/domain/entities/geocoding_result.dart';
import 'package:maps_platform/domain/entities/map_region.dart';
import 'package:maps_platform/domain/entities/route.dart';
import 'package:maps_platform/domain/entities/routing_profile.dart';
import 'package:maps_platform/domain/repositories/geocoding_repository.dart';
import 'package:maps_platform/domain/repositories/region_repository.dart';
import 'package:maps_platform/domain/services/routing_service.dart';
import 'package:maps_platform/features/map/map_view.dart';
import 'package:maps_platform/services/regions/region_download_service.dart';

/// Regions kept in memory, observable like the Drift-backed repository.
class InMemoryRegionRepository implements RegionRepository {
  InMemoryRegionRepository({
    List<MapRegion> catalog = const [],
    List<DownloadedRegion> downloaded = const [],
  }) : _catalog = [...catalog],
       _downloaded = [...downloaded];

  final List<MapRegion> _catalog;
  List<DownloadedRegion> _downloaded;
  final _catalogChanges = StreamController<List<MapRegion>>.broadcast();
  final _downloadedChanges = StreamController<List<DownloadedRegion>>.broadcast();

  List<MapRegion> get catalogForTest => _catalog;

  set downloaded(List<DownloadedRegion> value) {
    _downloaded = [...value];
    _downloadedChanges.add(_downloaded);
  }

  @override
  Future<List<MapRegion>> refreshCatalog() async {
    _catalogChanges.add(_catalog);
    return _catalog;
  }

  @override
  Future<List<MapRegion>> cachedCatalog() async => _catalog;

  @override
  Stream<List<MapRegion>> watchCatalog() =>
      currentAndChanges(() => _catalog, _catalogChanges.stream);

  @override
  Future<List<DownloadedRegion>> downloadedRegions() async => _downloaded;

  @override
  Stream<List<DownloadedRegion>> watchDownloadedRegions() =>
      currentAndChanges(() => _downloaded, _downloadedChanges.stream);

  @override
  Future<List<RegionVersionStatus>> checkForUpdates() async => const [];

  @override
  Future<MapRegion?> detectRegion(Coordinate position) async =>
      _catalog.where((region) => region.contains(position)).firstOrNull;

  @override
  Future<List<DownloadedRegion>> downloadedRegionsAt(Coordinate position) async =>
      _downloaded.where((region) => region.contains(position)).toList();

  @override
  Future<DownloadedRegion> saveDownloaded({
    required MapRegion region,
    required String relativePath,
    required int sizeBytes,
  }) async {
    final stored = DownloadedRegion(
      code: region.code,
      name: region.name,
      version: region.version,
      checksum: region.checksum,
      sizeBytes: sizeBytes,
      relativePath: relativePath,
      bbox: region.bbox,
      minZoom: region.minZoom,
      maxZoom: region.maxZoom,
      downloadedAt: DateTime.utc(2026, 9, 25),
      latestVersion: region.version,
    );
    downloaded = [..._downloaded.where((r) => r.code != region.code), stored];
    return stored;
  }

  @override
  Future<void> deleteDownloaded(String code) async =>
      downloaded = _downloaded.where((region) => region.code != code).toList();

  @override
  Future<List<String>> removeMissingFiles() async => const [];
}

/// Download service driven by the test: tasks are set by hand and the calls
/// made by the screens are recorded.
class ScriptedRegionDownloadService implements RegionDownloadService {
  ScriptedRegionDownloadService(this._regions);

  final InMemoryRegionRepository _regions;
  final _tasks = <String, RegionDownloadTask>{};
  final _changes = StreamController<Map<String, RegionDownloadTask>>.broadcast();
  final calls = <String>[];

  /// Result of the next [download] call; completing it finishes the download.
  Completer<RegionDownloadResult>? pendingDownload;

  void setTask(RegionDownloadTask task) {
    _tasks[task.code] = task;
    _changes.add(tasks);
  }

  void clearTask(String code) {
    _tasks.remove(code);
    _changes.add(tasks);
  }

  @override
  Duration get progressInterval => Duration.zero;

  @override
  Map<String, RegionDownloadTask> get tasks => Map.unmodifiable(_tasks);

  @override
  Stream<Map<String, RegionDownloadTask>> watchTasks() =>
      currentAndChanges(() => tasks, _changes.stream);

  @override
  Future<void> start() async {}

  @override
  Future<RegionDownloadResult> download(MapRegion region) {
    calls.add('download:${region.code}:${region.version}');
    return (pendingDownload = Completer<RegionDownloadResult>()).future;
  }

  @override
  Future<RegionDownloadResult> resume(String code) async {
    calls.add('resume:$code');
    return RegionDownloadResult.paused;
  }

  @override
  void pause(String code) => calls.add('pause:$code');

  @override
  Future<void> discard(String code) async {
    calls.add('discard:$code');
    clearTask(code);
  }

  @override
  Future<void> deleteRegion(DownloadedRegion region) async {
    calls.add('delete:${region.code}');
    await _regions.deleteDownloaded(region.code);
  }

  @override
  Future<MapRegion?> missingRegionAt(Coordinate position) async {
    if ((await _regions.downloadedRegionsAt(position)).isNotEmpty) return null;
    return _regions.detectRegion(position);
  }

  @override
  Future<void> dispose() async {}
}

/// Routing answered with a fixed result, or an error.
class ScriptedRoutingService implements RoutingService {
  ScriptedRoutingService(this.result);

  RouteResult? result;
  AppException? error;
  final requests = <({Coordinate origin, Coordinate destination, RoutingProfile profile})>[];

  @override
  Future<RouteResult> calculateRoute({
    required Coordinate origin,
    required Coordinate destination,
    required RoutingProfile profile,
    bool alternatives = true,
  }) async {
    requests.add((origin: origin, destination: destination, profile: profile));
    if (error case final error?) throw error;
    return result!;
  }
}

/// Stands in for the native MapLibre view: shows what it was asked to draw
/// and lets tests send the gestures a user would make on the map.
class RecordingMapView {
  MapViewProps? props;
  final commands = <CameraCommand>[];
  StreamSubscription<CameraCommand>? _subscription;
  Stream<CameraCommand>? _stream;

  Widget build(BuildContext context, MapViewProps props) {
    this.props = props;
    if (!identical(_stream, props.cameraCommands)) {
      unawaited(_subscription?.cancel());
      _stream = props.cameraCommands;
      _subscription = props.cameraCommands.listen(commands.add);
    }
    return ColoredBox(
      key: const Key('fake-map'),
      color: const Color(0xFFE8EAED),
      child: Center(
        child: Text(
          'routes: ${props.routes.length}, selected: ${props.selectedRoute}',
          key: const Key('fake-map-state'),
        ),
      ),
    );
  }

  Future<void> dispose() async => _subscription?.cancel();
}

/// Address lookups answered from a fixed list.
class ScriptedGeocodingRepository implements GeocodingRepository {
  ScriptedGeocodingRepository([this.places = const []]);

  final List<GeocodingResult> places;

  @override
  Future<List<GeocodingResult>> search(String query, {Coordinate? near}) async => [
    for (final place in places)
      if (place.displayName.toLowerCase().contains(query.toLowerCase())) place,
  ];

  @override
  Future<GeocodingResult?> reverse(Coordinate coordinate) async => places.firstOrNull;
}
