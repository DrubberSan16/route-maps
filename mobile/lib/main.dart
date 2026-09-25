import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'presentation/app.dart';
import 'presentation/providers.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Failed providers are not retried automatically: each screen offers a
  // retry and the services have their own recovery (sync backoff, download
  // resume, connectivity re-checks).
  final container = ProviderContainer(retry: (_, _) => null);
  // The stored session decides whether synchronization can start.
  await container.read(authRepositoryProvider).restore();
  runApp(UncontrolledProviderScope(container: container, child: const MapsPlatformApp()));
}
