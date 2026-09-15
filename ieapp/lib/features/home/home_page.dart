import 'package:flutter/material.dart';

import '../../core/app_scope.dart';
import '../../core/expandable_fab.dart';
import '../../l10n/app_localizations.dart';
import '../connections/connection_form_page.dart';
import '../ieds/ied_tab.dart';
import '../ieds/onboard_method_page.dart';
import '../iem/iem_tab.dart';
import '../settings/settings_page.dart';

/// Two tabs: the single connected IEM, and the list of edge devices.
class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> with SingleTickerProviderStateMixin {
  static const _devicesTabIndex = 1;

  late final TabController _tabs = TabController(length: 2, vsync: this)
    ..addListener(() => setState(() {}));

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  bool get _onDevicesTab => _tabs.index == _devicesTabIndex;

  Future<void> _addDevice() async {
    final l10n = AppLocalizations.of(context);
    final connections = AppScope.of(context).connections;
    final messenger = ScaffoldMessenger.of(context);
    final result = await Navigator.of(context).push<ConnectionFormResult>(
      MaterialPageRoute(
        builder: (_) => ConnectionFormPage(title: l10n.deviceAddTitle),
      ),
    );
    if (result == null) return;
    await connections.saveDevice(result.connection, password: result.password);
    messenger.showSnackBar(SnackBar(content: Text(l10n.snackStored)));
  }

  void _onboardDevice() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const OnboardMethodPage()),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.appTitle),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            tooltip: l10n.settingsTitle,
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => const SettingsPage()),
            ),
          ),
        ],
        bottom: TabBar(
          controller: _tabs,
          tabs: [
            Tab(icon: const Icon(Icons.hub_outlined), text: l10n.tabIem),
            Tab(
              icon: const Icon(Icons.developer_board),
              text: l10n.tabDevices,
            ),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabs,
        children: const [IemTab(), IedTab()],
      ),
      floatingActionButton: _onDevicesTab
          ? ExpandableFab(
              tooltip: l10n.deviceActionsTooltip,
              actions: [
                FabAction(
                  icon: Icons.add_to_home_screen,
                  label: l10n.deviceOnboardTooltip,
                  onPressed: _onboardDevice,
                ),
                FabAction(
                  icon: Icons.add_link,
                  label: l10n.deviceAddTooltip,
                  onPressed: _addDevice,
                ),
              ],
            )
          : null,
    );
  }
}
