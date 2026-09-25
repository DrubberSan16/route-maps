import 'package:drift/drift.dart';

import '../../domain/entities/sync.dart';

/// Stores [SyncStatus] with the names used across the platform (PENDING...).
class SyncStatusConverter extends TypeConverter<SyncStatus, String> {
  const SyncStatusConverter();

  @override
  SyncStatus fromSql(String fromDb) => SyncStatus.fromValue(fromDb);

  @override
  String toSql(SyncStatus value) => value.value;
}

/// Last catalog of regions received from the API (region detection offline).
@DataClassName('CatalogRegionRow')
class CatalogRegions extends Table {
  TextColumn get code => text()();
  TextColumn get name => text()();
  TextColumn get country => text()();
  TextColumn get province => text().nullable()();
  TextColumn get city => text().nullable()();
  TextColumn get version => text()();
  IntColumn get mapSize => integer()();
  IntColumn get routingSize => integer().nullable()();
  TextColumn get checksum => text()();
  TextColumn get routingChecksum => text().nullable()();
  RealColumn get west => real().nullable()();
  RealColumn get south => real().nullable()();
  RealColumn get east => real().nullable()();
  RealColumn get north => real().nullable()();
  IntColumn get minZoom => integer()();
  IntColumn get maxZoom => integer()();
  TextColumn get mapDownloadUrl => text()();
  TextColumn get routingDownloadUrl => text().nullable()();
  TextColumn get tilesUrl => text()();
  DateTimeColumn get updatedAt => dateTime()();
  DateTimeColumn get fetchedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {code};
}

/// Regions whose PMTiles file is complete and verified on the device.
@DataClassName('DownloadedRegionRow')
class DownloadedRegions extends Table {
  TextColumn get code => text()();
  TextColumn get name => text()();
  TextColumn get version => text()();
  TextColumn get checksum => text()();
  IntColumn get sizeBytes => integer()();

  /// Relative to the offline storage root.
  TextColumn get relativePath => text()();
  RealColumn get west => real().nullable()();
  RealColumn get south => real().nullable()();
  RealColumn get east => real().nullable()();
  RealColumn get north => real().nullable()();
  IntColumn get minZoom => integer()();
  IntColumn get maxZoom => integer()();
  DateTimeColumn get downloadedAt => dateTime()();

  /// Latest version on the server at the last update check.
  TextColumn get latestVersion => text().nullable()();
  DateTimeColumn get checkedAt => dateTime().nullable()();

  @override
  Set<Column> get primaryKey => {code};
}

/// Downloads that have not finished: the bytes live in `<file>.part`.
@DataClassName('RegionDownloadRow')
class RegionDownloads extends Table {
  TextColumn get code => text()();
  TextColumn get name => text()();
  TextColumn get version => text()();
  TextColumn get checksum => text()();
  IntColumn get totalBytes => integer()();
  TextColumn get url => text()();

  /// Final file, relative to the offline storage root.
  TextColumn get relativePath => text()();

  /// ETag of the first response, sent back in `If-Range` when resuming.
  TextColumn get etag => text().nullable()();

  /// DOWNLOADING, PAUSED or FAILED.
  TextColumn get status => text()();
  TextColumn get errorCode => text().nullable()();
  TextColumn get errorMessage => text().nullable()();
  DateTimeColumn get startedAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {code};
}

/// Saved routes (OfflineRoute): drawable and usable without connection.
@DataClassName('OfflineRouteRow')
class OfflineRoutes extends Table {
  TextColumn get routeId => text()();
  TextColumn get name => text()();
  TextColumn get profile => text()();
  RealColumn get originLatitude => real()();
  RealColumn get originLongitude => real()();
  RealColumn get destinationLatitude => real()();
  RealColumn get destinationLongitude => real()();
  RealColumn get distanceMeters => real()();
  RealColumn get durationSeconds => real()();

  /// GeoJSON positions `[[lng, lat], ...]`.
  TextColumn get geometry => text()();

  /// JSON array of steps, same shape as the API.
  TextColumn get steps => text()();
  TextColumn get regionId => text().nullable()();
  TextColumn get provider => text().nullable()();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();

  /// Owner account (user id); null for a route saved without an account.
  TextColumn get accountId => text().nullable()();

  @override
  Set<Column> get primaryKey => {routeId};
}

/// Changes waiting to be sent to `POST /api/v1/sync/push`.
@DataClassName('SyncQueueRow')
@TableIndex(name: 'sync_queue_status_created', columns: {#status, #createdAt})
class SyncQueue extends Table {
  /// Client generated id, used by the server as idempotency key.
  TextColumn get id => text()();
  TextColumn get operation => text()();
  TextColumn get entity => text()();

  /// JSON object.
  TextColumn get payload => text()();
  DateTimeColumn get createdAt => dateTime()();
  IntColumn get retryCount => integer().withDefault(const Constant(0))();
  TextColumn get status => text().map(const SyncStatusConverter())();
  TextColumn get lastError => text().nullable()();

  /// Earliest time of the next attempt (exponential backoff).
  DateTimeColumn get nextAttemptAt => dateTime().nullable()();
  DateTimeColumn get completedAt => dateTime().nullable()();

  /// Account whose session sends the operation; null for a change made
  /// without an account.
  TextColumn get accountId => text().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}

@DataClassName('TripRow')
class Trips extends Table {
  TextColumn get id => text()();
  TextColumn get name => text().nullable()();
  TextColumn get profile => text()();
  TextColumn get routeId => text().nullable()();

  /// ACTIVE, COMPLETED or CANCELLED.
  TextColumn get status => text()();
  DateTimeColumn get startedAt => dateTime()();
  DateTimeColumn get endedAt => dateTime().nullable()();
  RealColumn get distanceMeters => real().withDefault(const Constant(0))();
  IntColumn get pointCount => integer().withDefault(const Constant(0))();

  /// Owner account (user id); null for a trip recorded without an account.
  TextColumn get accountId => text().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}

/// GPS fixes of a trip. `queued` turns true once the point is part of a
/// `tracking_point:CREATE` operation, so no fix is lost or sent twice.
@DataClassName('TrackingPointRow')
@TableIndex(name: 'tracking_points_trip_queued', columns: {#tripId, #queued})
class TrackingPoints extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get tripId => text().references(Trips, #id, onDelete: KeyAction.cascade)();
  RealColumn get latitude => real()();
  RealColumn get longitude => real()();
  RealColumn get accuracy => real().nullable()();
  RealColumn get speed => real().nullable()();
  RealColumn get heading => real().nullable()();
  RealColumn get altitude => real().nullable()();
  DateTimeColumn get recordedAt => dateTime()();
  BoolColumn get queued => boolean().withDefault(const Constant(false))();

  @override
  List<Set<Column>> get uniqueKeys => [
    {tripId, recordedAt},
  ];
}

/// Small settings: installation id, last pull time...
@DataClassName('KeyValueRow')
class KeyValues extends Table {
  TextColumn get key => text()();
  TextColumn get value => text()();

  @override
  Set<Column> get primaryKey => {key};
}
