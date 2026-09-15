---
type: Software Project
title: ieapp — Industrial Edge operations app
description: Flutter mobile app for operating a Siemens Industrial Edge installation — device onboarding, edge-app lifecycle, configuration, and logs — against IE Hub, IEM/IEM-V, and IE Devices.
resource: file:///mnt/c/Users/maxrg/git/ieapp
tags: [industrial-edge, siemens, iem, iehub, flutter, dart, mobile, device-management, edge-apps]
status: draft
generated: { by: claude-code/claude-opus-5, at: 2026-09-03T00:00:00Z }
sources:
  - id: repo
    resource: file:///mnt/c/Users/maxrg/git/ieapp
    title: ieapp repository
    last_modified: 2026-09-03T00:00:00Z
  - id: owner
    resource: human:max.rgbg
    title: Project owner — stated scope, target backends, and the todo.txt work list
    author: human:max.rgbg
  - id: okf-spec
    resource: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
    title: Open Knowledge Format v0.2 specification
---

# Overview

`ieapp` is a cross-platform Flutter application (Android and iOS) for operating a **Siemens
Industrial Edge** installation from a mobile device. It is an operator/administrator tool, not a
plant-floor HMI: it manages the edge infrastructure itself rather than the process running on it.

The app is intended to sit in front of three systems:

- **IE Hub (IEH)** — the cloud-side catalog and portal: available edge apps, device images, versions.
- **IEM / IEM-V** — Industrial Edge Management, the fleet manager that owns a set of devices and the
  apps deployed to them. `IEM-V` is the virtual/containerised deployment flavour of the same system.
- **IE Devices (IED)** — the edge hardware running Edge Device OS, addressed directly (e.g. its Web
  Based Management interface) for cases the IEM does not cover or when the IEM is unreachable.

Agent-facing working rules live in [CLAUDE.md](../CLAUDE.md).

# Implementation status

Implemented (UI shell and local storage):

| Area | State |
| --- | --- |
| Tab shell — one IEM tab, one devices tab | done |
| Device list showing name and IP address | done |
| Device page with an applications tab and a settings tab | shell done; the applications tab has no data source |
| Add an already-onboarded device: URL, user name, password, store | done, with URL/IP validation |
| Edit / remove a device and the IEM connection, with confirmation | done |
| Expanding `+` button: add an onboarded device, or onboard one | done |
| Onboarding method chooser — QR code, USB, web access | chooser done; all three paths are placeholders |
| Petrol launcher icon for Android (legacy + adaptive) and iOS | done |
| Material 3 theming, system / light / dark | done, persisted |
| English, German, system language | done, persisted |
| Storage: connections and settings in SQLite, passwords in platform secure storage | done |
| One-time import of data written by the previous preference storage | done |

Not implemented: **any backend communication**. No IEM, IE Hub or device client exists, so a
device in the list is a *configured* device, never one that has been reached. App lifecycle
(install / start / stop / update), configuration read-write, and log retrieval — the reasons the
app exists — are still ahead.

## Structure

```
lib/
  main.dart        composition root      core/    AppScope, theme, EmptyState
  app.dart         MaterialApp           domain/  EdgeConnection, OnboardingMethod
  state/           ChangeNotifier controllers     data/    ConnectionRepository, CredentialStore
  features/        home, iem, ieds, connections, settings
  l10n/            app_en.arb, app_de.arb + generated localizations
```

Dependencies are deliberately few: `sqflite`, `flutter_secure_storage`,
`flutter_localizations`/`intl` (and `shared_preferences`, kept only until the one-time import can be
deleted). State is plain `ChangeNotifier` controllers reached through an
`InheritedWidget` — no state-management package.

# Capabilities

Scope as stated by the project owner:[^owner]

1. **Control IE Devices** — list the fleet, see online/offline and health status, restart, and read
   device-level information from the managing IEM (or from the device directly).
2. **Onboard devices** — obtain an onboarding configuration from an IEM and apply it to a device so
   the device registers with that IEM, transferred by QR code, USB, or the device web interface.
3. **Start / stop edge apps** — install from catalog, then start, stop, restart, update, and
   uninstall app instances on a target device or device group.
4. **Change configuration** — read and write application configuration and device settings, and push
   a configuration to one or many devices.
5. **Get logs** — fetch, follow, filter, and export application and device logs for diagnosis.

Only the list/add/edit parts of 1 and the method chooser of 2 exist today.

# Schema

Working domain model:

| Concept | Meaning | State |
| --- | --- | --- |
| `EdgeConnection` | A stored connection — the one IEM, or one device: id, base URL, user name, optional display name, added-at. `host` is the IP shown in the list; the password is *not* a field | implemented |
| `CredentialStore` | Password storage interface; `SecureCredentialStore` (Keystore/Keychain) and `InMemoryCredentialStore` (tests) | implemented |
| `connections` / `settings` tables | The SQLite schema: one row per connection, `kind` separating the single IEM from the devices, a partial unique index enforcing that single IEM; key/value settings | implemented |
| `OnboardingMethod` | `qrCode` \| `usb` \| `webAccess` | implemented (enum only) |
| `UrlParseResult` / `UrlProblem` | Base-URL parsing: http/https only, IPv4, IPv6 and host names, port range, normalisation | implemented |
| `Device` | An IED as the backend knows it: model, OS version, status, device group | planned |
| `EdgeApp` / `AppInstance` | A catalog entry, and one deployment of it on a device | planned |
| `ConfigBundle` | Configuration payload for an app or a device, with schema and revision | planned |
| `LogQuery` / `LogEntry` | Log retrieval and one emitted line | planned |
| `Job` | An asynchronous backend operation — install, deploy, config push — with per-device outcome | planned |

Asynchrony is the central modelling constraint for the planned half: install, update and
configuration deployment are long-running fleet operations, so the UI must be built around `Job`
state rather than around a request that returns a finished result.

# Examples

Representative flows the app must support end to end:

- *Add an onboarded device* — devices tab → `+` → *Add onboarded device* → URL, user name,
  password → Store → the device appears in the list by name and IP. **Works today.**
- *Open a device* — tap it in the list → applications tab (no data yet) and settings tab, where the
  stored connection is edited or removed. **Shell works today.**
- *Onboard a new device* — devices tab → `+` → *Onboard device* → choose QR code, USB or web access.
  **Chooser works; the transfer needs the onboarding configuration from the IEM.**
- *Restart a misbehaving app* — open device → app instance shows `error` → read the last log lines →
  stop → start → confirm state returns to `running`. **Planned.**
- *Roll out a configuration* — edit a `ConfigBundle` → select target devices → confirm → track the
  `Job` to completion with per-device outcome. **Planned.**
- *Diagnose offline* — device unreachable from IEM → connect directly to the device and read
  device-level logs. **Planned.**

# Constraints

- **Operations affect a running plant.** Stopping an app, restarting a device, or pushing
  configuration is potentially disruptive. Every such action requires explicit confirmation naming
  the affected targets, and must never be silently retried in a way that repeats it.
- **Version-dependent APIs.** IEM and IE Hub REST surfaces differ across versions, and IEM-V differs
  from classic IEM. Concrete endpoints are deliberately not recorded here — they must be verified
  against the documentation for the targeted version before being implemented.
- **Transport security.** Self-signed certificates are common in IEM/IED deployments. Certificate
  verification is not to be globally disabled; trust is per host, opt-in, and pinned where possible.
- **Credentials** are held in platform secure storage, never in app settings or the repository.
- **Offline and partial connectivity** are normal: plant networks are segmented and a mobile client
  may reach a device but not its IEM, or the reverse.
- **Localisation is not optional.** Every user-visible string is an ARB key in English and German.

# Open questions

- Authentication model per backend (interactive login vs. service account / API token) and how a
  mobile client obtains and refreshes it. The current form stores a user name and password because
  that is what a device login needs; an IEM may need something else.
- Whether IE Hub access is in scope for v1, or the app only ever talks to IEM/IEM-V.
- Whether onboarding is driven fully from the app, or the app only transfers a configuration
  generated by the IEM.
- Multi-IEM support: the UI currently allows exactly one IEM by design.[^owner]
- Whether devices should be reachability-checked (and shown as online/offline) before any backend
  client exists — today the list makes no connectivity claim.

[^owner]: Project owner — stated scope, target backends, and the todo.txt work list
