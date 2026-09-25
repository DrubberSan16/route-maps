import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/errors/app_exception.dart';
import '../../core/utils/streams.dart';
import '../../domain/entities/position.dart';
import '../../domain/entities/routing_profile.dart';
import '../../domain/entities/trip.dart';
import '../../domain/repositories/settings_repository.dart';
import '../../domain/repositories/trip_repository.dart';
import '../../domain/services/location_service.dart';

/// What the recorder is doing, for the UI.
@immutable
class RecordingState {
  const RecordingState({this.trip, this.lastPosition, this.discardedFixes = 0, this.error});

  /// The active trip, or null when nothing is being recorded.
  final Trip? trip;
  final Position? lastPosition;

  /// Fixes ignored because their accuracy was too poor.
  final int discardedFixes;
  final AppException? error;

  bool get isRecording => trip != null;
}

/// Records journeys. Every GPS fix is written to the local database as soon
/// as it arrives and moved to the synchronization queue in batches, so the
/// track survives having no connection or the app being closed. Recording
/// keeps going with the screen off (foreground service notification on
/// Android, background location on iOS).
class TripRecorder {
  TripRecorder({
    required this._trips,
    required this._location,
    required this._settings,
    this.maxAccuracyMeters = 50,
    this.queueInterval = const Duration(seconds: 60),
  });

  final TripRepository _trips;
  final LocationService _location;
  final SettingsRepository _settings;

  /// Fixes less accurate than this are not stored.
  final double maxAccuracyMeters;

  /// How often recorded points are moved to the synchronization queue.
  final Duration queueInterval;

  final _states = StreamController<RecordingState>.broadcast();
  RecordingState _state = const RecordingState();
  StreamSubscription<Position>? _positions;
  Timer? _queueTimer;
  Future<void> _writes = Future.value();

  RecordingState get state => _state;

  Stream<RecordingState> watch() => currentAndChanges(() => _state, _states.stream);

  /// Continues a trip left active by a previous session (the app was closed
  /// or killed while recording).
  Future<void> restore() async {
    final active = await _trips.activeTrip();
    if (active == null) return;
    _emit(RecordingState(trip: active));
    await _listen();
  }

  Future<Trip> start({required RoutingProfile profile, String? name, String? routeId}) async {
    final current = _state.trip;
    if (current != null) return current;
    final access = await _location.requestAccess();
    if (access != LocationAccess.granted) {
      throw AppException.of(switch (access) {
        LocationAccess.serviceDisabled => ErrorCodes.locationServiceDisabled,
        LocationAccess.deniedForever => ErrorCodes.locationPermissionDeniedForever,
        LocationAccess.denied || LocationAccess.granted => ErrorCodes.locationPermissionDenied,
      });
    }
    final trip = await _trips.startTrip(
      profile: profile,
      name: name,
      routeId: routeId,
      installationId: await _settings.installationId(),
    );
    _emit(RecordingState(trip: trip));
    await _listen();
    return trip;
  }

  /// Ends the trip: the remaining points and the finish are queued.
  Future<Trip?> finish() => _stop((id) => _trips.finishTrip(id));

  /// Discards the trip on the server side (points already recorded are kept
  /// until then so the queue stays consistent).
  Future<Trip?> cancel() => _stop((id) => _trips.cancelTrip(id));

  Future<void> dispose() async {
    _queueTimer?.cancel();
    await _positions?.cancel();
    await _states.close();
  }

  Future<void> _listen() async {
    await _location.setBackgroundUpdates(true);
    await _positions?.cancel();
    _positions = _location.watchPosition().listen(
      _onPosition,
      onError: (Object error) {
        if (error is! AppException) throw error;
        _emit(_copy(error: error));
      },
    );
    _queueTimer?.cancel();
    _queueTimer = Timer.periodic(queueInterval, (_) => _queuePoints());
  }

  void _onPosition(Position position) {
    final trip = _state.trip;
    if (trip == null) return;
    final accuracy = position.accuracy;
    if (accuracy != null && accuracy > maxAccuracyMeters) {
      _emit(_copy(lastPosition: position, discardedFixes: _state.discardedFixes + 1));
      return;
    }
    _serialize(() async {
      await _trips.addPoint(
        TrackingPoint(
          tripId: trip.id,
          coordinate: position.coordinate,
          recordedAt: position.timestamp,
          accuracy: position.accuracy,
          speed: position.speed,
          heading: position.heading,
          altitude: position.altitude,
        ),
      );
      final updated = await _trips.activeTrip();
      if (updated != null && updated.id == _state.trip?.id) {
        _emit(_copy(trip: updated, lastPosition: position, clearError: true));
      }
    });
  }

  void _queuePoints() => _serialize(() => _trips.queuePendingPoints());

  /// Runs database writes one after another, in arrival order. A failed write
  /// is reported and shown, and recording goes on with the next fix.
  void _serialize(Future<void> Function() write) {
    _writes = _writes.then((_) async {
      try {
        await write();
      } on Object catch (error, stackTrace) {
        FlutterError.reportError(
          FlutterErrorDetails(exception: error, stack: stackTrace, library: 'trip recorder'),
        );
        _emit(
          _copy(
            error: AppException(
              ErrorCodes.internalError,
              'No se pudo guardar un punto del recorrido en el dispositivo.',
              cause: error,
            ),
          ),
        );
      }
    });
  }

  Future<Trip?> _stop(Future<Trip> Function(String tripId) close) async {
    final trip = _state.trip;
    if (trip == null) return null;
    _queueTimer?.cancel();
    _queueTimer = null;
    await _positions?.cancel();
    _positions = null;
    await _writes;
    final closed = await close(trip.id);
    await _location.setBackgroundUpdates(false);
    _emit(const RecordingState());
    return closed;
  }

  RecordingState _copy({
    Trip? trip,
    Position? lastPosition,
    int? discardedFixes,
    AppException? error,
    bool clearError = false,
  }) => RecordingState(
    trip: trip ?? _state.trip,
    lastPosition: lastPosition ?? _state.lastPosition,
    discardedFixes: discardedFixes ?? _state.discardedFixes,
    error: clearError ? null : error ?? _state.error,
  );

  void _emit(RecordingState next) {
    _state = next;
    if (!_states.isClosed) _states.add(next);
  }
}
