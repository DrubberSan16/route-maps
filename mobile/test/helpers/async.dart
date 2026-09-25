import 'dart:async';

/// Waits until [condition] holds (for work started by timers or streams).
Future<void> eventually(
  FutureOr<bool> Function() condition, {
  Duration timeout = const Duration(seconds: 5),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (!await condition()) {
    if (DateTime.now().isAfter(deadline)) {
      throw TimeoutException('Condition not met', timeout);
    }
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
}
