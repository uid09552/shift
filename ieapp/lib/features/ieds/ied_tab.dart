import 'package:flutter/material.dart';

import '../../core/app_scope.dart';
import '../../core/empty_state.dart';
import '../../domain/edge_connection.dart';
import '../../l10n/app_localizations.dart';
import '../connections/connection_form_page.dart';
import 'device_detail_page.dart';

/// Fleet list: the Industrial Edge Devices configured in this app.
class IedTab extends StatelessWidget {
  const IedTab({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final connections = AppScope.of(context).connections;

    return ListenableBuilder(
      listenable: connections,
      builder: (context, _) {
        final devices = connections.devices;
        if (devices.isEmpty) {
          return EmptyState(
            icon: Icons.devices_other_outlined,
            title: l10n.devicesEmptyTitle,
            body: l10n.devicesEmptyBody,
          );
        }
        return ListView.builder(
          itemCount: devices.length,
          itemBuilder: (context, index) =>
              _DeviceTile(device: devices[index]),
        );
      },
    );
  }
}

class _DeviceTile extends StatelessWidget {
  const _DeviceTile({required this.device});

  final EdgeConnection device;

  Future<void> _edit(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final connections = AppScope.of(context).connections;
    final result = await Navigator.of(context).push<ConnectionFormResult>(
      MaterialPageRoute(
        builder: (_) => ConnectionFormPage(
          title: l10n.deviceEditTitle,
          initial: device,
        ),
      ),
    );
    if (result == null) return;
    await connections.saveDevice(result.connection, password: result.password);
  }

  Future<void> _remove(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final connections = AppScope.of(context).connections;
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
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return ListTile(
      leading: const CircleAvatar(child: Icon(Icons.developer_board)),
      title: Text(device.name),
      subtitle: Text(device.host),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => DeviceDetailPage(deviceId: device.id),
        ),
      ),
      trailing: PopupMenuButton<void Function(BuildContext)>(
        onSelected: (action) => action(context),
        itemBuilder: (context) => [
          PopupMenuItem(value: _edit, child: Text(l10n.actionEdit)),
          PopupMenuItem(value: _remove, child: Text(l10n.actionRemove)),
        ],
      ),
    );
  }
}

