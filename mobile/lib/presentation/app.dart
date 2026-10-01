import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/map/map_screen.dart';
import '../features/offline_maps/offline_maps_controller.dart';
import 'providers.dart';
import 'theme.dart';

/// Background services that run for the whole life of the app: synchronization,
/// download recovery, trip recording and catalog refresh.
final appServicesProvider = Provider<void>((ref) {
  ref
    ..watch(synchronizationServiceProvider)
    ..watch(regionDownloadServiceProvider)
    ..watch(tripRecorderProvider)
    ..watch(catalogControllerProvider);
});

class MapsPlatformApp extends ConsumerWidget {
  const MapsPlatformApp({super.key, this.home = const MapScreen()});

  final Widget home;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(appServicesProvider);
    return MaterialApp(
      title: 'Route Maps',
      debugShowCheckedModeBanner: false,
      theme: appTheme(Brightness.light),
      darkTheme: appTheme(Brightness.dark),
      locale: const Locale('es'),
      supportedLocales: const [Locale('es'), Locale('en')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      home: home,
    );
  }
}
