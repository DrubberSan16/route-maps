import '../entities/position.dart';

/// Whether the app can read the device location.
enum LocationAccess { granted, denied, deniedForever, serviceDisabled }

/// Device positioning (GNSS). Never needs Internet.
abstract class LocationService {
  /// One fix, asking for permission first when needed.
  Future<Position> getCurrentPosition();

  /// Continuous fixes while there are listeners (broadcast stream).
  Stream<Position> watchPosition();

  /// Last fix cached by the OS, if any (instant, may be old).
  Future<Position?> getLastKnownPosition();

  Future<LocationAccess> checkAccess();

  /// Shows the system permission prompt when it can still be shown.
  Future<LocationAccess> requestAccess();

  /// Opens the system settings that can fix [access].
  Future<void> openSettings(LocationAccess access);

  /// Keeps updates flowing with the app in background (Android foreground
  /// service, iOS background location). Used while a trip is recorded.
  Future<void> setBackgroundUpdates(bool enabled);
}
