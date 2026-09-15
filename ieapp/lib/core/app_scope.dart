import 'package:flutter/widgets.dart';

import '../state/connections_controller.dart';
import '../state/settings_controller.dart';

/// Makes the app-wide controllers reachable from the widget tree.
class AppScope extends InheritedWidget {
  const AppScope({
    required this.settings,
    required this.connections,
    required super.child,
    super.key,
  });

  final SettingsController settings;
  final ConnectionsController connections;

  static AppScope of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<AppScope>();
    assert(scope != null, 'No AppScope found above this widget');
    return scope!;
  }

  @override
  bool updateShouldNotify(AppScope oldWidget) =>
      settings != oldWidget.settings || connections != oldWidget.connections;
}
