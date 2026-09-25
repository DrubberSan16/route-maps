import 'dart:async';
import 'dart:io';

import 'package:geolocator/geolocator.dart' as geo;

import '../../core/errors/app_exception.dart';
import '../../domain/entities/coordinate.dart';
import '../../domain/entities/position.dart';
import '../../domain/services/location_service.dart';

/// [LocationService] on top of `geolocator` (Fused Location Provider on
/// Android, Core Location on iOS). Satellite positioning works offline.
class GeolocatorLocationService implements LocationService {
  GeolocatorLocationService({
    this.distanceFilterMeters = 3,
    this.currentPositionTimeout = const Duration(seconds: 20),
  });

  final int distanceFilterMeters;
  final Duration currentPositionTimeout;

  StreamController<Position>? _positions;
  StreamSubscription<geo.Position>? _subscription;
  Future<LocationAccess>? _pendingRequest;
  bool _background = false;

  @override
  Future<LocationAccess> checkAccess() async {
    if (!await geo.Geolocator.isLocationServiceEnabled()) {
      return LocationAccess.serviceDisabled;
    }
    return _access(await geo.Geolocator.checkPermission());
  }

  @override
  Future<LocationAccess> requestAccess() =>
      // The platform rejects overlapping permission requests.
      _pendingRequest ??= _request().whenComplete(() => _pendingRequest = null);

  Future<LocationAccess> _request() async {
    if (!await geo.Geolocator.isLocationServiceEnabled()) {
      return LocationAccess.serviceDisabled;
    }
    var permission = await geo.Geolocator.checkPermission();
    if (permission == geo.LocationPermission.denied) {
      permission = await geo.Geolocator.requestPermission();
    }
    return _access(permission);
  }

  @override
  Future<void> openSettings(LocationAccess access) async {
    if (access == LocationAccess.serviceDisabled) {
      await geo.Geolocator.openLocationSettings();
    } else {
      await geo.Geolocator.openAppSettings();
    }
  }

  @override
  Future<Position> getCurrentPosition() async {
    await _ensureAccess();
    try {
      final fix = await geo.Geolocator.getCurrentPosition(
        locationSettings: geo.LocationSettings(
          accuracy: geo.LocationAccuracy.high,
          timeLimit: currentPositionTimeout,
        ),
      );
      return _toPosition(fix);
    } on TimeoutException {
      final last = await geo.Geolocator.getLastKnownPosition();
      if (last != null) return _toPosition(last);
      throw AppException.of(ErrorCodes.locationUnavailable);
    }
  }

  @override
  Future<Position?> getLastKnownPosition() async {
    if (await checkAccess() != LocationAccess.granted) return null;
    final last = await geo.Geolocator.getLastKnownPosition();
    return last == null ? null : _toPosition(last);
  }

  @override
  Stream<Position> watchPosition() {
    _positions ??= StreamController<Position>.broadcast(
      onListen: _startUpdates,
      onCancel: _stopUpdates,
    );
    return _positions!.stream;
  }

  @override
  Future<void> setBackgroundUpdates(bool enabled) async {
    if (enabled == _background) return;
    _background = enabled;
    // The platform stream keeps its settings: restart it with the new ones.
    if (_subscription != null) {
      await _subscription!.cancel();
      _subscription = null;
      await _startUpdates();
    }
  }

  Future<void> _startUpdates() async {
    final access = await requestAccess();
    final positions = _positions;
    if (positions == null || !positions.hasListener || _subscription != null) return;
    if (access != LocationAccess.granted) {
      positions.addError(_accessError(access));
      return;
    }
    _subscription = geo.Geolocator.getPositionStream(locationSettings: _settings()).listen(
      (fix) => positions.add(_toPosition(fix)),
      onError: (Object error, StackTrace stackTrace) =>
          positions.addError(_streamError(error), stackTrace),
    );
  }

  Future<void> _stopUpdates() async {
    await _subscription?.cancel();
    _subscription = null;
  }

  geo.LocationSettings _settings() {
    if (Platform.isAndroid) {
      return geo.AndroidSettings(
        accuracy: geo.LocationAccuracy.high,
        distanceFilter: distanceFilterMeters,
        intervalDuration: const Duration(seconds: 2),
        foregroundNotificationConfig: _background
            ? const geo.ForegroundNotificationConfig(
                notificationTitle: 'Grabando recorrido',
                notificationText: 'Maps Platform registra tu ubicación para el recorrido.',
                notificationChannelName: 'Recorridos',
                enableWakeLock: true,
                setOngoing: true,
              )
            : null,
      );
    }
    if (Platform.isIOS) {
      return geo.AppleSettings(
        accuracy: geo.LocationAccuracy.bestForNavigation,
        distanceFilter: distanceFilterMeters,
        activityType: geo.ActivityType.otherNavigation,
        pauseLocationUpdatesAutomatically: !_background,
        allowBackgroundLocationUpdates: _background,
        showBackgroundLocationIndicator: _background,
      );
    }
    return geo.LocationSettings(
      accuracy: geo.LocationAccuracy.high,
      distanceFilter: distanceFilterMeters,
    );
  }

  Future<void> _ensureAccess() async {
    final access = await requestAccess();
    if (access != LocationAccess.granted) throw _accessError(access);
  }

  static LocationAccess _access(geo.LocationPermission permission) => switch (permission) {
    geo.LocationPermission.always || geo.LocationPermission.whileInUse => LocationAccess.granted,
    geo.LocationPermission.deniedForever => LocationAccess.deniedForever,
    geo.LocationPermission.denied ||
    geo.LocationPermission.unableToDetermine => LocationAccess.denied,
  };

  static AppException _accessError(LocationAccess access) => AppException.of(switch (access) {
    LocationAccess.serviceDisabled => ErrorCodes.locationServiceDisabled,
    LocationAccess.deniedForever => ErrorCodes.locationPermissionDeniedForever,
    LocationAccess.denied || LocationAccess.granted => ErrorCodes.locationPermissionDenied,
  });

  static Object _streamError(Object error) => switch (error) {
    geo.LocationServiceDisabledException() => AppException.of(
      ErrorCodes.locationServiceDisabled,
      cause: error,
    ),
    geo.PermissionDeniedException() => AppException.of(
      ErrorCodes.locationPermissionDenied,
      cause: error,
    ),
    _ => AppException.of(ErrorCodes.locationUnavailable, cause: error),
  };

  static Position _toPosition(geo.Position fix) => Position(
    coordinate: Coordinate(fix.latitude, fix.longitude),
    timestamp: fix.timestamp.toUtc(),
    accuracy: fix.accuracy >= 0 ? fix.accuracy : null,
    altitude: fix.altitude,
    speed: fix.speed >= 0 ? fix.speed : null,
    heading: fix.heading >= 0 ? fix.heading : null,
  );
}
