/// Spanish, locale-independent formatting helpers for the UI.
library;

String _decimal(double value, int fractionDigits) =>
    value.toStringAsFixed(fractionDigits).replaceAll('.', ',');

/// `850 m`, `2,5 km`, `12 km`.
String formatDistance(double meters) {
  if (meters < 1000) return '${meters.round()} m';
  final km = meters / 1000;
  return '${_decimal(km, km < 10 ? 1 : 0)} km';
}

/// `1 min`, `45 min`, `1 h 05 min`, `2 h`.
String formatDuration(double seconds) {
  final minutes = (seconds / 60).round();
  if (minutes < 60) return '${minutes < 1 ? 1 : minutes} min';
  final hours = minutes ~/ 60;
  final rest = minutes % 60;
  return rest == 0 ? '$hours h' : '$hours h ${rest.toString().padLeft(2, '0')} min';
}

/// Decimal units, as shown by download screens: `791 KB`, `4,2 MB`, `185 MB`, `1,3 GB`.
String formatBytes(int bytes) {
  if (bytes < 1000) return '$bytes B';
  if (bytes < 1000 * 1000) return '${(bytes / 1000).round()} KB';
  if (bytes < 1000 * 1000 * 1000) {
    final mb = bytes / (1000 * 1000);
    return '${_decimal(mb, mb < 10 ? 1 : 0)} MB';
  }
  return '${_decimal(bytes / (1000 * 1000 * 1000), 1)} GB';
}

/// `67 %` (floored, so 100 % is only shown when complete).
String formatPercent(double fraction) => '${(fraction.clamp(0, 1) * 100).floor()} %';

/// `12:05` for today, otherwise `25/09/2026 12:05` (device local time).
String formatDateTime(DateTime value, {DateTime? now}) {
  final local = value.toLocal();
  final reference = (now ?? DateTime.now()).toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  final time = '${two(local.hour)}:${two(local.minute)}';
  final sameDay =
      local.year == reference.year && local.month == reference.month && local.day == reference.day;
  if (sameDay) return time;
  return '${two(local.day)}/${two(local.month)}/${local.year} $time';
}

/// `hace 5 s`, `hace 3 min`, `hace 2 h`, or the date for older values.
String formatRelative(DateTime value, {DateTime? now}) {
  final reference = now ?? DateTime.now();
  final elapsed = reference.difference(value);
  if (elapsed.inSeconds < 60) return 'hace ${elapsed.inSeconds.clamp(0, 59)} s';
  if (elapsed.inMinutes < 60) return 'hace ${elapsed.inMinutes} min';
  if (elapsed.inHours < 24) return 'hace ${elapsed.inHours} h';
  return formatDateTime(value, now: reference);
}

/// `00:12:30` elapsed time for recordings.
String formatElapsed(Duration elapsed) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(elapsed.inHours)}:${two(elapsed.inMinutes % 60)}:${two(elapsed.inSeconds % 60)}';
}
