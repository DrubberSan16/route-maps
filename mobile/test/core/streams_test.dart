import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/core/utils/streams.dart';

void main() {
  test('emits the current value and then every change', () async {
    var current = 1;
    final changes = StreamController<int>.broadcast();
    final values = <int>[];
    final subscription = currentAndChanges(() => current, changes.stream).listen(values.add);
    // Published right after listening: must not be lost.
    current = 2;
    changes.add(2);
    await pumpEventQueue();
    changes.add(3);
    await pumpEventQueue();
    expect(values, [1, 2, 3]);
    await subscription.cancel();
    expect(changes.hasListener, isFalse);
  });

  test('each listener starts from the value current at that moment', () async {
    var current = 'a';
    final changes = StreamController<String>.broadcast();
    Stream<String> watch() => currentAndChanges(() => current, changes.stream);
    expect(await watch().first, 'a');
    current = 'b';
    expect(await watch().first, 'b');
    await changes.close();
  });
}
