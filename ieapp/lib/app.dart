import 'package:flutter/material.dart';

import 'core/app_scope.dart';
import 'core/theme.dart';
import 'features/home/home_page.dart';
import 'l10n/app_localizations.dart';
import 'state/connections_controller.dart';
import 'state/settings_controller.dart';

/// Root widget: wires the controllers into the tree and applies theme + locale.
class IeApp extends StatelessWidget {
  const IeApp({
    required this.settings,
    required this.connections,
    super.key,
  });

  final SettingsController settings;
  final ConnectionsController connections;

  @override
  Widget build(BuildContext context) {
    return AppScope(
      settings: settings,
      connections: connections,
      child: ListenableBuilder(
        listenable: settings,
        builder: (context, _) => MaterialApp(
          onGenerateTitle: (context) => AppLocalizations.of(context).appTitle,
          theme: appTheme(Brightness.light),
          darkTheme: appTheme(Brightness.dark),
          themeMode: settings.themeMode,
          locale: settings.locale,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const HomePage(),
        ),
      ),
    );
  }
}
