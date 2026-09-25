/// UTC with millisecond precision.
///
/// Every timestamp stored in SQLite goes through this helper, so all values
/// share one ISO-8601 format and compare correctly as text.
DateTime utcMillis(DateTime value) {
  final utc = value.toUtc();
  return DateTime.utc(
    utc.year,
    utc.month,
    utc.day,
    utc.hour,
    utc.minute,
    utc.second,
    utc.millisecond,
  );
}

/// ISO-8601 in UTC with millisecond precision, as the API expects.
String isoUtc(DateTime value) => utcMillis(value).toIso8601String();
