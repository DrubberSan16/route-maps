import 'dart:math' as math;

/// The arithmetic of the backend's engines (JavaScript) where Dart differs, so that the device
/// engine gives the same numbers: rounding, `Math.hypot` and stable sorting.

/// `Math.round` of JavaScript: halves go up (towards +∞), so `-2.5` is `-2` (Dart's `round()`
/// gives `-3`).
double jsRound(double value) {
  final floor = value.floorToDouble();
  return value - floor >= 0.5 ? floor + 1 : floor;
}

/// [jsRound] as an integer, for distances, durations and indexes.
int jsRoundInt(double value) => jsRound(value).toInt();

/// `Math.hypot(a, b)` of V8: both values scaled by the larger one, squared and added with Kahan
/// compensation (src/builtins/math.tq). `sqrt(a * a + b * b)` differs in the last bit.
double jsHypot(double a, double b) {
  final x = a.abs();
  final y = b.abs();
  if (x == double.infinity || y == double.infinity) return double.infinity;
  if (x.isNaN || y.isNaN) return double.nan;
  final max = math.max(x, y);
  if (max == 0) return 0;
  var sum = 0.0;
  var compensation = 0.0;
  for (final value in [x, y]) {
    final n = value / max;
    final summand = n * n - compensation;
    final preliminary = sum + summand;
    compensation = (preliminary - sum) - summand;
    sum = preliminary;
  }
  return math.sqrt(sum) * max;
}

/// Sign of a JavaScript comparator result (`a - b`): NaN and both zeros count as equal.
int jsCompare(double difference) => difference < 0
    ? -1
    : difference > 0
    ? 1
    : 0;

/// Sorts like `Array.prototype.sort` of JavaScript, which keeps the order of equal elements
/// (Dart's `List.sort` does not).
void stableSort<T>(List<T> list, int Function(T a, T b) compare) {
  if (list.length < 2) return;
  final order = List<int>.generate(list.length, (index) => index);
  final items = List<T>.of(list);
  order.sort((a, b) {
    final result = compare(items[a], items[b]);
    return result != 0 ? result : a - b;
  });
  for (var index = 0; index < order.length; index += 1) {
    list[index] = items[order[index]];
  }
}
