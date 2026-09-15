import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../app_harness.dart';

void main() {
  Future<void> openSettings(WidgetTester tester, String tooltip) async {
    await tester.tap(find.byTooltip(tooltip));
    await tester.pumpAndSettle();
  }

  testWidgets('switching to dark applies the dark theme', (tester) async {
    final harness = await AppHarness.create();
    await pumpApp(tester, harness);
    await openSettings(tester, 'Settings');

    await tester.tap(find.text('Dark'));
    await tester.pumpAndSettle();

    expect(harness.settings.themeMode, ThemeMode.dark);
    final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
    expect(app.themeMode, ThemeMode.dark);
  });

  testWidgets('switching to German translates the app', (tester) async {
    final harness = await AppHarness.create();
    await pumpApp(tester, harness);
    await openSettings(tester, 'Settings');

    await tester.tap(find.text('German'));
    await tester.pumpAndSettle();

    expect(harness.settings.locale, const Locale('de'));
    expect(find.text('Einstellungen'), findsOneWidget);

    tester.state<NavigatorState>(find.byType(Navigator).first).pop();
    await tester.pumpAndSettle();
    expect(find.widgetWithText(Tab, 'Geräte'), findsOneWidget);
  });

  testWidgets('system language follows the device locale', (tester) async {
    final harness = await AppHarness.create(storedSettings: {'language': 'de'});
    await pumpApp(tester, harness);
    await openSettings(tester, 'Einstellungen');

    // 'System' is also a theme option, so target the language list tile.
    await tester.tap(find.widgetWithText(ListTile, 'System'));
    await tester.pumpAndSettle();

    expect(harness.settings.locale, isNull);
    final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
    expect(app.locale, isNull);
  });
}
