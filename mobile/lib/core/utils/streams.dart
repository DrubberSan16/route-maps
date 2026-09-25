import 'dart:async';

/// The value returned by [current] followed by every event of [changes].
///
/// The subscription to [changes] is made in the same step as the first
/// event, so a change published right after someone starts listening is
/// never lost (an `async*` generator would only subscribe after resuming from
/// its first `yield`).
Stream<T> currentAndChanges<T>(T Function() current, Stream<T> changes) {
  late final StreamController<T> controller;
  StreamSubscription<T>? subscription;
  controller = StreamController<T>(
    onListen: () {
      controller.add(current());
      subscription = changes.listen(
        controller.add,
        onError: controller.addError,
        onDone: controller.close,
      );
    },
    onPause: () => subscription?.pause(),
    onResume: () => subscription?.resume(),
    onCancel: () => subscription?.cancel(),
  );
  return controller.stream;
}
