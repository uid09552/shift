import 'package:flutter/material.dart';

import '../../domain/onboarding_method.dart';
import '../../l10n/app_localizations.dart';

/// Step 1 of onboarding: how does the onboarding configuration reach the device?
class OnboardMethodPage extends StatelessWidget {
  const OnboardMethodPage({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.onboardTitle)),
      body: ListView(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Text(
              l10n.onboardChooseMethod,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
          _MethodTile(
            method: OnboardingMethod.qrCode,
            icon: Icons.qr_code_scanner,
            title: l10n.onboardQr,
            subtitle: l10n.onboardQrSubtitle,
          ),
          _MethodTile(
            method: OnboardingMethod.usb,
            icon: Icons.usb,
            title: l10n.onboardUsb,
            subtitle: l10n.onboardUsbSubtitle,
          ),
          _MethodTile(
            method: OnboardingMethod.webAccess,
            icon: Icons.language,
            title: l10n.onboardWeb,
            subtitle: l10n.onboardWebSubtitle,
          ),
        ],
      ),
    );
  }
}

class _MethodTile extends StatelessWidget {
  const _MethodTile({
    required this.method,
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final OnboardingMethod method;
  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon),
      title: Text(title),
      subtitle: Text(subtitle),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => OnboardMethodDetailPage(method: method, title: title),
        ),
      ),
    );
  }
}

/// Placeholder for a chosen onboarding path.
///
/// Deliberately does nothing: every path needs the onboarding configuration
/// issued by the connected IEM, and no IEM client exists yet.
class OnboardMethodDetailPage extends StatelessWidget {
  const OnboardMethodDetailPage({
    required this.method,
    required this.title,
    super.key,
  });

  final OnboardingMethod method;
  final String title;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.construction_outlined,
                size: 48,
                color: theme.colorScheme.primary,
              ),
              const SizedBox(height: 16),
              Text(l10n.notImplementedTitle, style: theme.textTheme.titleMedium),
              const SizedBox(height: 8),
              Text(
                l10n.notImplementedBody,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
