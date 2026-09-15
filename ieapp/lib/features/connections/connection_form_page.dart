import 'package:flutter/material.dart';

import '../../core/url_input.dart';
import '../../domain/edge_connection.dart';
import '../../l10n/app_localizations.dart';

/// What a completed [ConnectionFormPage] hands back.
class ConnectionFormResult {
  const ConnectionFormResult(this.connection, this.password);

  final EdgeConnection connection;

  /// `null` when editing and the password field was left untouched.
  final String? password;
}

/// URL / user name / password form, used for the IEM and for edge devices.
class ConnectionFormPage extends StatefulWidget {
  const ConnectionFormPage({
    required this.title,
    this.initial,
    this.showDisplayName = true,
    super.key,
  });

  final String title;

  /// Existing connection when editing; `null` when adding.
  final EdgeConnection? initial;
  final bool showDisplayName;

  @override
  State<ConnectionFormPage> createState() => _ConnectionFormPageState();
}

class _ConnectionFormPageState extends State<ConnectionFormPage> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _url = TextEditingController(
    text: widget.initial?.baseUrl.toString() ?? '',
  );
  late final TextEditingController _username = TextEditingController(
    text: widget.initial?.username ?? '',
  );
  late final TextEditingController _displayName = TextEditingController(
    text: widget.initial?.displayName ?? '',
  );
  final _password = TextEditingController();
  bool _obscurePassword = true;

  @override
  void dispose() {
    _url.dispose();
    _username.dispose();
    _displayName.dispose();
    _password.dispose();
    super.dispose();
  }

  /// Maps a rejected URL to the message shown under the field.
  static String? _urlError(AppLocalizations l10n, String value) =>
      switch (parseBaseUrl(value).problem) {
        null => null,
        UrlProblem.empty => l10n.validationRequired,
        UrlProblem.unsupportedScheme => l10n.validationUrlScheme,
        UrlProblem.invalidHost => l10n.validationUrlHost,
        UrlProblem.invalidPort => l10n.validationUrlPort,
        UrlProblem.malformed => l10n.validationUrlInvalid,
      };

  void _submit() {
    if (!_formKey.currentState!.validate()) return;
    final existing = widget.initial;
    final url = parseBaseUrl(_url.text).uri!;
    final displayName = _displayName.text.trim();
    final connection = existing == null
        ? EdgeConnection(
            id: 'conn-${DateTime.now().microsecondsSinceEpoch}',
            baseUrl: url,
            username: _username.text.trim(),
            displayName: displayName.isEmpty ? null : displayName,
            addedAt: DateTime.now(),
          )
        : existing.copyWith(
            baseUrl: url,
            username: _username.text.trim(),
            displayName: displayName.isEmpty ? null : displayName,
            clearDisplayName: displayName.isEmpty,
          );
    Navigator.of(context).pop(
      ConnectionFormResult(
        connection,
        _password.text.isEmpty ? null : _password.text,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final isEditing = widget.initial != null;

    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              controller: _url,
              autofocus: true,
              keyboardType: TextInputType.url,
              autocorrect: false,
              decoration: InputDecoration(
                labelText: l10n.fieldUrl,
                hintText: l10n.fieldUrlHint,
                prefixIcon: const Icon(Icons.link),
              ),
              validator: (value) => _urlError(l10n, value ?? ''),
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _username,
              autocorrect: false,
              decoration: InputDecoration(
                labelText: l10n.fieldUsername,
                prefixIcon: const Icon(Icons.person_outline),
              ),
              validator: (value) => (value == null || value.trim().isEmpty)
                  ? l10n.validationRequired
                  : null,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _password,
              obscureText: _obscurePassword,
              decoration: InputDecoration(
                labelText: l10n.fieldPassword,
                prefixIcon: const Icon(Icons.lock_outline),
                suffixIcon: IconButton(
                  icon: Icon(
                    _obscurePassword
                        ? Icons.visibility_outlined
                        : Icons.visibility_off_outlined,
                  ),
                  onPressed: () =>
                      setState(() => _obscurePassword = !_obscurePassword),
                ),
              ),
              validator: (value) => (!isEditing && (value == null || value.isEmpty))
                  ? l10n.validationRequired
                  : null,
            ),
            if (widget.showDisplayName) ...[
              const SizedBox(height: 16),
              TextFormField(
                controller: _displayName,
                decoration: InputDecoration(
                  labelText: l10n.fieldDisplayName,
                  prefixIcon: const Icon(Icons.badge_outlined),
                ),
              ),
            ],
            const SizedBox(height: 12),
            Text(
              l10n.credentialsNote,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: _submit,
              icon: const Icon(Icons.save_outlined),
              label: Text(isEditing ? l10n.actionSave : l10n.actionStore),
            ),
          ],
        ),
      ),
    );
  }
}
