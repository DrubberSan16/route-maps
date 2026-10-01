import 'package:flutter/material.dart';

/// Colours of the design system (design-system/route-maps/MASTER.md), shared
/// with the web viewer.
abstract final class BrandColors {
  static const primary = Color(0xFF2563EB);
  static const primaryStrong = Color(0xFF1D4ED8);
  static const secondary = Color(0xFF059669);
  static const accent = Color(0xFFDC2626);
  static const background = Color(0xFFF0F9FF);
  static const foreground = Color(0xFF0F172A);
  static const muted = Color(0xFFF1F5FD);
  static const mutedForeground = Color(0xFF475569);
  static const border = Color(0xFFE4ECFC);
  static const selected = Color(0xFFDBEAFE);

  /// Markers of the route: origin, destination (as on the web viewer).
  static const origin = Color(0xFF047857);
  static const destination = accent;

  /// Traffic levels (style metadata `maps-platform:traffic`).
  static const trafficFree = Color(0xFF1E8E3E);
  static const trafficModerate = Color(0xFFF9AB00);
  static const trafficSlow = Color(0xFFE8710A);
  static const trafficJammed = Color(0xFFB31412);
}

/// Shape and elevation of the floating controls over the map.
abstract final class MapChrome {
  static const radius = 16.0;
  static const shadow = [
    BoxShadow(color: Color(0x1F0F172A), blurRadius: 3, offset: Offset(0, 1)),
    BoxShadow(color: Color(0x1F0F172A), blurRadius: 16, offset: Offset(0, 6)),
  ];
}

/// Material 3 theme of the app in the brand colours: white floating cards,
/// rounded controls and the blue of the web viewer.
ThemeData appTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final seeded = ColorScheme.fromSeed(
    seedColor: BrandColors.primary,
    brightness: brightness,
    dynamicSchemeVariant: DynamicSchemeVariant.fidelity,
  );
  final scheme = dark
      ? seeded
      : seeded.copyWith(
          primary: BrandColors.primary,
          onPrimary: Colors.white,
          primaryContainer: BrandColors.selected,
          onPrimaryContainer: BrandColors.primaryStrong,
          secondary: BrandColors.secondary,
          onSecondary: Colors.white,
          error: BrandColors.accent,
          surface: Colors.white,
          onSurface: BrandColors.foreground,
          onSurfaceVariant: BrandColors.mutedForeground,
          surfaceContainerLowest: Colors.white,
          surfaceContainerLow: const Color(0xFFF8FAFF),
          surfaceContainer: BrandColors.muted,
          surfaceContainerHigh: const Color(0xFFE9EFFB),
          surfaceContainerHighest: const Color(0xFFE2E8F5),
          outlineVariant: BrandColors.border,
        );
  final base = ThemeData(colorScheme: scheme, useMaterial3: true);
  final text = base.textTheme;
  final rounded = RoundedRectangleBorder(borderRadius: BorderRadius.circular(12));
  const buttonSize = Size(48, 48);
  final buttonText = text.labelLarge?.copyWith(
    fontSize: 15,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.1,
  );
  return base.copyWith(
    scaffoldBackgroundColor: dark ? scheme.surface : BrandColors.background,
    textTheme: text.copyWith(
      titleLarge: text.titleLarge?.copyWith(fontWeight: FontWeight.w700, letterSpacing: -0.2),
      titleMedium: text.titleMedium?.copyWith(fontWeight: FontWeight.w600),
      titleSmall: text.titleSmall?.copyWith(fontWeight: FontWeight.w600),
      labelLarge: text.labelLarge?.copyWith(fontWeight: FontWeight.w600),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: scheme.surface,
      foregroundColor: scheme.onSurface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 1,
      shadowColor: const Color(0x330F172A),
      centerTitle: false,
      titleTextStyle: text.titleLarge?.copyWith(
        color: scheme.onSurface,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.2,
      ),
    ),
    cardTheme: CardThemeData(
      color: scheme.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 2,
      shadowColor: const Color(0x330F172A),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(minimumSize: buttonSize, shape: rounded, textStyle: buttonText),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: buttonSize,
        shape: rounded,
        textStyle: buttonText,
        side: BorderSide(color: scheme.outlineVariant),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(shape: rounded, textStyle: buttonText),
    ),
    floatingActionButtonTheme: FloatingActionButtonThemeData(
      backgroundColor: scheme.surface,
      foregroundColor: scheme.primary,
      elevation: 3,
      highlightElevation: 4,
      shape: const CircleBorder(),
    ),
    chipTheme: base.chipTheme.copyWith(
      shape: const StadiumBorder(),
      side: BorderSide(color: scheme.outlineVariant),
      backgroundColor: scheme.surface,
      labelStyle: text.labelLarge?.copyWith(color: scheme.onSurface),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: scheme.surface,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: scheme.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: dark ? scheme.inverseSurface : BrandColors.foreground,
      shape: rounded,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: dark ? scheme.surfaceContainerHigh : BrandColors.muted,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide.none,
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: scheme.primary, width: 2),
      ),
    ),
    listTileTheme: ListTileThemeData(
      iconColor: scheme.primary,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: SegmentedButton.styleFrom(
        selectedBackgroundColor: scheme.primaryContainer,
        selectedForegroundColor: scheme.onPrimaryContainer,
      ),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: scheme.primary),
    dividerTheme: DividerThemeData(color: scheme.outlineVariant, space: 1),
  );
}
