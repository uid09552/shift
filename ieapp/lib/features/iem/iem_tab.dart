import 'package:flutter/material.dart';

import '../../core/app_scope.dart';
import '../../core/empty_state.dart';
import '../../domain/edge_connection.dart';
import '../../l10n/app_localizations.dart';
import '../connections/connection_form_page.dart';

/// The single Industrial Edge Management connection.
///
/// Exactly one IEM can be configured; connecting another replaces it.
class IemTab extends StatelessWidget {
  const IemTab({super.key});

  static Future<void> connect(BuildContext context, {EdgeConnection? existing}) async {
    final l10n = AppLocalizations.of(context);
    final connections = AppScope.of(context).connections;
    final result = await Navigator.of(context).push<ConnectionFormResult>(
      MaterialPageRoute(
        builder: (_) => ConnectionFormPage(
          title: existing == null ? l10n.iemConnectTitle : l10n.iemEditTitle,
          initial: existing,
          showDisplayName: false,
        ),
      ),
    );
    if (result == null) return;
    await connections.saveIem(result.connection, password: result.password);
  }

  Future<void> _remove(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final connections = AppScope.of(context).connections;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.iemRemoveTitle),
        content: Text(l10n.iemRemoveMessage),
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
    await connections.removeIem();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final connections = AppScope.of(context).connections;

    return ListenableBuilder(
      listenable: connections,
      builder: (context, _) {
        final iem = connections.iem;
        if (iem == null) {
          return EmptyState(
            icon: Icons.hub_outlined,
            title: l10n.iemEmptyTitle,
            body: l10n.iemEmptyBody,
            action: FilledButton.icon(
              onPressed: () => connect(context),
              icon: const Icon(Icons.add_link),
              label: Text(l10n.iemConnect),
            ),
          );
        }
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              child: Column(
                children: [
                  ListTile(
                    leading: const CircleAvatar(child: Icon(Icons.hub)),
                    title: Text(iem.host),
                    subtitle: Text(iem.baseUrl.toString()),
                  ),
                  const Divider(height: 1),
                  ListTile(
                    dense: true,
                    title: Text(l10n.labelUser),
                    trailing: Text(iem.username),
                  ),
                  ListTile(
                    dense: true,
                    title: Text(l10n.labelAdded),
                    trailing: Text(
                      MaterialLocalizations.of(
                        context,
                      ).formatShortDate(iem.addedAt),
                    ),
                  ),
                  OverflowBar(
                    alignment: MainAxisAlignment.end,
                    children: [
                      TextButton.icon(
                        onPressed: () => connect(context, existing: iem),
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
          ],
        );
      },
    );
  }
}
