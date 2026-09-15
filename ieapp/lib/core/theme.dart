import 'package:flutter/material.dart';

/// Seed colour for the Material 3 scheme — Siemens petrol.
const _seed = Color(0xFF009999);

ThemeData appTheme(Brightness brightness) {
  final scheme = ColorScheme.fromSeed(seedColor: _seed, brightness: brightness);
  return ThemeData(
    colorScheme: scheme,
    appBarTheme: AppBarTheme(
      backgroundColor: scheme.surfaceContainer,
      foregroundColor: scheme.onSurface,
    ),
    listTileTheme: const ListTileThemeData(minVerticalPadding: 12),
  );
}
