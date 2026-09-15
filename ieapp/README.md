# ieapp

Mobile companion app for a **Siemens Industrial Edge** installation: onboard Industrial Edge
Devices, manage the edge apps running on them, change configuration, and read logs — from a phone
or tablet.

Flutter, Android and iOS, Material 3, English and German.

## What works today

- **IEM tab** — the single Industrial Edge Management connection (exactly one).
- **Devices tab** — the configured Industrial Edge Devices, listed by name and IP address.
  The `+` button expands into *Add onboarded device* (URL, user name, password — validated as a
  URL or IP address) and *Onboard device*.
- **Device page** — tap a device for its *Applications* tab (empty until the device client exists)
  and its *Settings* tab, where the stored connection can be edited or removed.
- **Onboarding** — chooser for QR code, USB or web access. The three transfer paths are
  placeholders: they need the onboarding configuration issued by the IEM.
- **Settings** — theme (system / light / dark) and language (system / English / German), persisted.

Connections and settings are stored in a local SQLite database; passwords go to the platform secure
storage (Keystore/Keychain) and never touch the database.

**No backend communication is implemented yet.** A device in the list is a *configured* device, not
one that has been contacted. Starting and stopping apps, configuration and logs are still to come.

## Development

This repository targets Flutter 3.41.7 / Dart 3.11.5.

```bash
flutter pub get
flutter analyze
flutter test
flutter run
flutter gen-l10n   # after editing lib/l10n/app_en.arb or app_de.arb
```

Further context: [`CLAUDE.md`](CLAUDE.md) for working rules, [`okf/`](okf/) for the Open Knowledge
Format description of the project.
