import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../app_harness.dart';

void main() {
  Future<void> openDevice(WidgetTester tester) async {
    await tester.tap(find.widgetWithText(Tab, 'Devices'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Line 1 gateway'));
    await tester.pumpAndSettle();
  }

  testWidgets('tapping a device opens applications and settings tabs',
      (tester) async {
    final harness = await AppHarness.create();
    await harness.connections.saveDevice(device(displayName: 'Line 1 gateway'));
    await pumpApp(tester, harness);

    await openDevice(tester);

    expect(find.widgetWithText(Tab, 'Applications'), findsOneWidget);
    expect(find.widgetWithText(Tab, 'Settings'), findsOneWidget);
    expect(find.text('No application data'), findsOneWidget);
  });

  testWidgets('the settings tab shows the stored connection', (tester) async {
    final harness = await AppHarness.create();
    await harness.connections.saveDevice(device(displayName: 'Line 1 gateway'));
    await pumpApp(tester, harness);
    await openDevice(tester);

    await tester.tap(find.widgetWithText(Tab, 'Settings'));
    await tester.pumpAndSettle();

    expect(find.text('https://192.168.0.10'), findsOneWidget);
    expect(find.text('admin'), findsOneWidget);
  });

  testWidgets('editing from the settings tab updates the device',
      (tester) async {
    final harness = await AppHarness.create();
    await harness.connections.saveDevice(device(displayName: 'Line 1 gateway'));
    await pumpApp(tester, harness);
    await openDevice(tester);
    await tester.tap(find.widgetWithText(Tab, 'Settings'));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(TextButton, 'Edit'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextFormField, 'URL'),
      '192.168.0.20',
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();

    expect(harness.connections.devices.single.host, '192.168.0.20');
    expect(find.text('https://192.168.0.20'), findsOneWidget);
  });

  testWidgets('removing from the settings tab confirms and returns to the list',
      (tester) async {
    final harness = await AppHarness.create();
    await harness.connections.saveDevice(device(displayName: 'Line 1 gateway'));
    await pumpApp(tester, harness);
    await openDevice(tester);
    await tester.tap(find.widgetWithText(Tab, 'Settings'));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(TextButton, 'Remove'));
    await tester.pumpAndSettle();
    expect(find.text('Remove device?'), findsOneWidget);

    await tester.tap(find.widgetWithText(FilledButton, 'Remove'));
    await tester.pumpAndSettle();

    expect(harness.connections.devices, isEmpty);
    expect(find.text('No devices'), findsOneWidget);
  });
}
