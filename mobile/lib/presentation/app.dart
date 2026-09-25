import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/map/map_screen.dart';
import '../features/offline_maps/offline_maps_controller.dart';
import 'providers.dart';

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
      title: 'Maps Platform',
      debugShowCheckedModeBanner: false,
      theme: _theme(Brightness.light),
      darkTheme: _theme(Brightness.dark),
      locale: const Locale('es'),
      supportedLocales: const [Locale('es'), Locale('en')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      home: home,
    );
  }

  static ThemeData _theme(Brightness brightness) => ThemeData(
    colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF1A73E8), brightness: brightness),
    useMaterial3: true,
  );
}
