import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../app_harness.dart';

void main() {
  /// Opens the devices tab and expands the `+` button.
  Future<void> openDeviceActions(WidgetTester tester) async {
    await tester.tap(find.widgetWithText(Tab, 'Devices'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Device actions'));
    await tester.pumpAndSettle();
  }
  testWidgets('shows an IEM tab and a devices tab', (tester) async {
    final harness = await AppHarness.create();
    await pumpApp(tester, harness);

    expect(find.widgetWithText(Tab, 'IEM'), findsOneWidget);
    expect(find.widgetWithText(Tab, 'Devices'), findsOneWidget);
  });

  testWidgets('IEM tab is empty until one is connected', (tester) async {
    final harness = await AppHarness.create();
    await pumpApp(tester, harness);

    expect(find.text('No IEM connected'), findsOneWidget);

    await harness.connections.saveIem(
      device(id: 'iem-1', url: 'https://iem.example.com', username: 'operator'),
      password: 'secret',
    );
    await tester.pumpAndSettle();

    expect(find.text('No IEM connected'), findsNothing);
    expect(find.text('iem.example.com'), findsOneWidget);
    expect(find.text('operator'), findsOneWidget);
  });

  testWidgets('devices tab lists name and ip address', (tester) async {
    final harness = await AppHarness.create();
    await harness.connections.saveDevice(
      device(displayName: 'Line 1 gateway'),
      password: 'secret',
    );
    await pumpApp(tester, harness);

    await tester.tap(find.widgetWithText(Tab, 'Devices'));
    await tester.pumpAndSettle();

    expect(find.text('Line 1 gateway'), findsOneWidget);
    expect(find.text('192.168.0.10'), findsOneWidget);
  });

  testWidgets('the plus button offers adding and onboarding', (tester) async {
    final harness = await AppHarness.create();
    await pumpApp(tester, harness);
    await openDeviceActions(tester);

    expect(find.text('Add onboarded device'), findsOneWidget);
    expect(find.text('Onboard device'), findsOneWidget);
  });

  testWidgets('the plus button stores an onboarded device', (tester) async {
    final harness = await AppHarness.create();
    await pumpApp(tester, harness);
    await openDeviceActions(tester);

    await tester.tap(find.text('Add onboarded device'));
    await tester.pumpAndSettle();

    await tester.enterText(find.widgetWithText(TextFormField, 'URL'), '192.168.0.42');
    await tester.enterText(
      find.widgetWithText(TextFormField, 'User name'),
      'admin',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Password'),
      'secret',
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Store'));
    await tester.pumpAndSettle();

    final stored = harness.connections.devices.single;
    expect(stored.baseUrl.toString(), 'https://192.168.0.42');
    expect(stored.username, 'admin');
    expect(await harness.repository.password(stored.id), 'secret');
    // No display name was given, so the host stands in for the name: it shows
    // as both the tile title and the tile subtitle.
    expect(find.text('192.168.0.42'), findsNWidgets(2));
  });

  testWidgets('the form rejects an empty url and an unusable scheme',
      (tester) async {
    final harness = await AppHarness.create();
    await pumpApp(tester, harness);
    await openDeviceActions(tester);
    await tester.tap(find.text('Add onboarded device'));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'Store'));
    await tester.pumpAndSettle();
    expect(find.text('Required'), findsNWidgets(3));

    await tester.enterText(
      find.widgetWithText(TextFormField, 'URL'),
      'ftp://192.168.0.42',
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Store'));
    await tester.pumpAndSettle();
    expect(find.text('Only http:// and https:// are supported'), findsOneWidget);

    await tester.enterText(
      find.widgetWithText(TextFormField, 'URL'),
      '192.168.0.999',
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Store'));
    await tester.pumpAndSettle();
    expect(
      find.text('Enter a valid IP address or host name'),
      findsOneWidget,
    );
    expect(harness.connections.devices, isEmpty);
  });

  testWidgets('the onboard button offers qr code, usb and web access',
      (tester) async {
    final harness = await AppHarness.create();
    await pumpApp(tester, harness);
    await openDeviceActions(tester);

    await tester.tap(find.text('Onboard device'));
    await tester.pumpAndSettle();

    expect(find.text('QR code'), findsOneWidget);
    expect(find.text('USB'), findsOneWidget);
    expect(find.text('Web access'), findsOneWidget);

    await tester.tap(find.text('QR code'));
    await tester.pumpAndSettle();
    expect(find.text('Not implemented yet'), findsOneWidget);
  });

  testWidgets('removing a device asks first', (tester) async {
    final harness = await AppHarness.create();
    await harness.connections.saveDevice(device(displayName: 'Line 1 gateway'));
    await pumpApp(tester, harness);
    await tester.tap(find.widgetWithText(Tab, 'Devices'));
    await tester.pumpAndSettle();

    await tester.tap(find.byType(PopupMenuButton<void Function(BuildContext)>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Remove').last);
    await tester.pumpAndSettle();

    expect(find.text('Remove device?'), findsOneWidget);
    await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
    await tester.pumpAndSettle();
    expect(harness.connections.devices, hasLength(1));

    await tester.tap(find.byType(PopupMenuButton<void Function(BuildContext)>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Remove').last);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Remove'));
    await tester.pumpAndSettle();
    expect(harness.connections.devices, isEmpty);
  });
}
