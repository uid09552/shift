import 'package:flutter/material.dart';

import '../../core/app_scope.dart';
import '../../core/empty_state.dart';
import '../../domain/edge_connection.dart';
import '../../l10n/app_localizations.dart';
import '../connections/connection_form_page.dart';

/// One Industrial Edge Device: the apps on it, and its settings.
///
/// Both tabs are limited by the same gap — no device client exists — so the
/// applications tab is empty and the settings tab can only edit the connection
/// this app stores.
class DeviceDetailPage extends StatelessWidget {
  const DeviceDetailPage({required this.deviceId, super.key});

  final String deviceId;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final connections = AppScope.of(context).connections;

    return ListenableBuilder(
      listenable: connections,
      builder: (context, _) {
        final device = connections.devices
            .where((d) => d.id == deviceId)
            .firstOrNull;
        // The device was removed from the settings tab: leave the page.
        if (device == null) return const SizedBox.shrink();

        return DefaultTabController(
          length: 2,
          child: Scaffold(
            appBar: AppBar(
              title: Text(device.name),
              bottom: TabBar(
                tabs: [
                  Tab(icon: const Icon(Icons.apps), text: l10n.tabApplications),
                  Tab(
                    icon: const Icon(Icons.tune),
                    text: l10n.tabDeviceSettings,
                  ),
                ],
              ),
            ),
            body: TabBarView(
              children: [
                EmptyState(
                  icon: Icons.apps_outage,
                  title: l10n.deviceAppsEmptyTitle,
                  body: l10n.deviceAppsEmptyBody,
                ),
                _DeviceSettingsTab(device: device),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _DeviceSettingsTab extends StatelessWidget {
  const _DeviceSettingsTab({required this.device});

  final EdgeConnection device;

  Future<void> _edit(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final connections = AppScope.of(context).connections;
    final result = await Navigator.of(context).push<ConnectionFormResult>(
      MaterialPageRoute(
        builder: (_) =>
            ConnectionFormPage(title: l10n.deviceEditTitle, initial: device),
      ),
    );
    if (result == null) return;
    await connections.saveDevice(result.connection, password: result.password);
  }

  Future<void> _remove(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final connections = AppScope.of(context).connections;
    final navigator = Navigator.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.deviceRemoveTitle),
        content: Text(l10n.deviceRemoveMessage(device.name)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.actionCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.actionRemove),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await connections.removeDevice(device.id);
    navigator.pop();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Column(
            children: [
              ListTile(
                leading: const Icon(Icons.link),
                title: Text(l10n.deviceSettingsConnection),
                subtitle: Text(device.baseUrl.toString()),
              ),
              const Divider(height: 1),
              ListTile(
                dense: true,
                title: Text(l10n.labelUser),
                trailing: Text(device.username),
              ),
              ListTile(
                dense: true,
                title: Text(l10n.labelAdded),
                trailing: Text(
                  MaterialLocalizations.of(
                    context,
                  ).formatShortDate(device.addedAt),
                ),
              ),
              OverflowBar(
                alignment: MainAxisAlignment.end,
                children: [
                  TextButton.icon(
                    onPressed: () => _edit(context),
                    icon: const Icon(Icons.edit_outlined),
                    label: Text(l10n.actionEdit),
                  ),
                  TextButton.icon(
                    onPressed: () => _remove(context),
                    icon: const Icon(Icons.delete_outline),
                    label: Text(l10n.actionRemove),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 24),
        Text(
          l10n.deviceSettingsPendingTitle,
          style: theme.textTheme.titleSmall,
        ),
        const SizedBox(height: 8),
        Text(l10n.deviceSettingsPendingBody, style: theme.textTheme.bodyMedium),
      ],
    );
  }
}
