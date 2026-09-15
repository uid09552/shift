# ieapp — Industrial Edge companion app

Flutter app (Android + iOS) for operating a **Siemens Industrial Edge** installation from a
phone or tablet. Target capabilities: onboard IE Devices, install/start/stop edge apps,
change app and device configuration, and pull logs/diagnostics.

Backends it will talk to: **IE Hub** (cloud catalog), **IEM / IEM-V** (fleet management), and
**IE Devices** directly.

## Repo status — read this first

What exists today is the **UI shell and local connection storage only**:

- two tabs — the single IEM connection, and the list of edge devices (name + IP);
- a device detail page with an *Applications* tab (empty — needs the device client) and a
  *Settings* tab that edits or removes the stored connection;
- the `+` button expands into *Add onboarded device* and *Onboard device*;
- adding an already-onboarded device (URL / user name / password), with URL/IP validation;
- an onboarding method chooser (QR code, USB, web access) whose three paths are deliberate
  placeholders;
- theme (system/light/dark) and language (system/English/German), both persisted;
- everything persisted in one SQLite database, with a one-time import of the old
  `shared_preferences` data;
- a petrol launcher icon (Android legacy + adaptive, iOS), generated, not hand-drawn.

There is still **no backend client**: nothing in this repo calls an IEM, an IE Hub or a device.
A "connected" device in the UI is a *configured* device — reachability has never been checked.
Do not describe start/stop, configuration or log features as existing.

Longer domain description: `okf/ieapp.md` (Open Knowledge Format bundle).

## Commands

The `flutter` on the WSL `PATH` (`/mnt/c/tools/flutter`) is a **different, older SDK** (3.38.7) and
its shell script has CRLF endings, so it fails under WSL. Use the SDK this project was created
with, through `cmd.exe`:

```bash
FLUTTER='C:\Users\maxrg\develop\flutter\bin\flutter.bat'   # Flutter 3.41.7 / Dart 3.11.5
cmd.exe /c "cd /d C:\Users\maxrg\git\ieapp && $FLUTTER pub get"
cmd.exe /c "cd /d C:\Users\maxrg\git\ieapp && $FLUTTER analyze"       # must be clean
cmd.exe /c "cd /d C:\Users\maxrg\git\ieapp && $FLUTTER test"
cmd.exe /c "cd /d C:\Users\maxrg\git\ieapp && $FLUTTER gen-l10n"      # after editing .arb files
cmd.exe /c "cd /d C:\Users\maxrg\git\ieapp && $FLUTTER build apk --debug"
```

## Layout

```
lib/
  main.dart                     composition root: prefs -> repository -> controllers -> IeApp
  app.dart                      MaterialApp, theme mode + locale
  core/                         app_scope.dart (InheritedWidget), theme.dart, empty_state.dart,
                                expandable_fab.dart, url_input.dart (base URL/IP validation)
  domain/                       edge_connection.dart, onboarding_method.dart
  data/                         app_database.dart (schema), connection_repository.dart,
                                settings_repository.dart, credential_store.dart,
                                preferences_migration.dart (one-time import, delete later)
  state/                        settings_controller.dart, connections_controller.dart
  features/
    home/                       tab scaffold, add (+ FAB) and onboard (app-bar icon) actions
    iem/                        the single IEM connection
    ieds/                       device list, onboarding method chooser + placeholders
    connections/                shared URL/user/password form
    settings/                   theme and language
  l10n/                         app_en.arb, app_de.arb + generated app_localizations*.dart
```

Not yet created: `data/` clients for IEM/IE Hub/device, and the app-lifecycle, configuration and
log features.

## Conventions

- Dart SDK `^3.11.5`, Material 3, `flutter_lints ^6.0.0`. The scaffold's Dart **dot-shorthands**
  style is fine on this SDK.
- State: `ChangeNotifier` controllers reached through `AppScope.of(context)`, rendered with
  `ListenableBuilder`. No state-management package — do not add one without a reason.
- Dependencies are deliberately few: `shared_preferences`, `flutter_secure_storage`,
  `flutter_localizations`/`intl`.
- **Every user-visible string comes from `AppLocalizations`.** Add the key to both `lib/l10n/app_en.arb`
  and `lib/l10n/app_de.arb`, then run `gen-l10n`. The generated files under `lib/l10n/` are committed.
- Keep `data/` free of Flutter widget imports so clients stay testable without a widget tree.
- Tests mirror `lib/` paths under `test/`; `test/app_harness.dart` builds the app over a real
  in-memory SQLite database and an `InMemoryCredentialStore`. Use its `openTestDatabase()`: it picks
  the **no-isolate** ffi factory (a `testWidgets` fake-async zone never completes isolate work) and
  closes the database afterwards (sqflite hands back the same open `:memory:` database per path, so
  an unclosed one leaks rows into the next test).
- `flutter analyze` clean and `flutter test` green is the bar for "done".

## Storage

Everything the app persists lives in one SQLite database (`ieapp.db`, opened by
`data/app_database.dart`) — **except passwords**, which belong in the platform secure storage.

```sql
connections(id PK, kind CHECK ('iem'|'device'), base_url, username, display_name, added_at)
  UNIQUE INDEX connections_single_iem ON (kind) WHERE kind = 'iem'   -- exactly one IEM
settings(key PK, value)                                              -- themeMode, language
```

Passwords go through `CredentialStore` into Keystore/Keychain under `credential/<connection id>`,
never into the database, logs or a repository. `data/preferences_migration.dart` copies data written
by the previous `shared_preferences` storage into the database once, then clears those keys; the
`shared_preferences` dependency exists only for that and can go once no install can still hold it.

Schema changes bump `AppDatabase.version` and get an `_upgrade` branch — never edit `_create` alone.

## Domain glossary

| Term | Meaning |
| --- | --- |
| **IE** | Industrial Edge, Siemens' edge computing platform |
| **IE Hub (IEH)** | Cloud catalog/portal for edge apps, device images, publishing |
| **IEM** | Industrial Edge Management — manages a fleet of IE Devices |
| **IEM-V** | The virtual/containerised IEM deployment flavour |
| **IED** | Industrial Edge Device — the edge hardware running Edge Device OS |
| **Edge app** | Containerised workload deployed to an IED, managed from IEM |
| **Onboarding** | Registering an IED with an IEM using an IEM-issued onboarding configuration |
| **WBM** | Web Based Management — the local web UI/API on an IE Device |

## Working rules for agents in this repo

- **Never point dev runs or tests at a production IEM.** Use a test tenant, a staging IEM, or a fake client.
- **Stop/restart/uninstall/config-push affect a live plant.** Every such code path must be behind an
  explicit user confirmation in the UI, and must not be auto-retried in a way that repeats the action.
  Removing a stored connection already follows this pattern (confirmation dialog).
- **Do not invent API endpoints.** IEM/IEH REST surfaces differ by version. Verify against the docs for the
  targeted IEM version (or a captured response) before writing a client method; if unverified, say so.
- **No secrets in the repo** — no tokens, service-account credentials, or customer IEM hostnames in source,
  `pubspec.yaml`, assets, or tests.
- **TLS:** IEM/IED deployments commonly use self-signed certificates. Do not globally disable certificate
  verification. Implement per-host trust with explicit user opt-in and pinning where possible.
- Prefer adding a repository + fake over mocking HTTP inside widget tests.
- Base URLs go through `parseBaseUrl` in `core/url_input.dart` — http/https only, IPv4/IPv6/host
  name checked, normalised. Do not hand-roll another URL check.

## Launcher icon

Petrol (`#009999`) hub mark, generated by a stdlib rasteriser rather than committed by hand:
`android/app/src/main/res/mipmap-*/ic_launcher.png` (legacy) and `ic_launcher_foreground.png`
(adaptive, with `mipmap-anydpi-v26/ic_launcher.xml` + `drawable/ic_launcher_background.xml`), plus
the full iOS `AppIcon.appiconset`. The generator lives outside the repo; regenerate by re-running it
if the mark changes, and keep the petrol seed in `core/theme.dart` in sync.

## Known environment quirk

`android/build.gradle.kts` pins every Android subproject to `compileSdk 36`. The installed SDK ships
API 37 as `android-37.0`/`android-37.2`, which AGP 8.11 cannot resolve, and
`flutter_secure_storage 11` hard-codes `compileSdk = 37`. Remove the pin once AGP understands
minor-versioned platforms.

If the emulator refuses to launch the app with `Activity class {com.siemens.ie.ieapp/…MainActivity}
does not exist` even though `aapt2 dump badging` shows the launchable activity: the emulator's
package manager is inconsistent, not the build. Reinstalling does not help — reboot the emulator
(`adb reboot`), or cold-boot/wipe the AVD.
