// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for German (`de`).
class AppLocalizationsDe extends AppLocalizations {
  AppLocalizationsDe([String locale = 'de']) : super(locale);

  @override
  String get appTitle => 'Industrial Edge';

  @override
  String get tabIem => 'IEM';

  @override
  String get tabDevices => 'Geräte';

  @override
  String get settingsTitle => 'Einstellungen';

  @override
  String get settingsAppearance => 'Darstellung';

  @override
  String get settingsLanguage => 'Sprache';

  @override
  String get themeSystem => 'System';

  @override
  String get themeLight => 'Hell';

  @override
  String get themeDark => 'Dunkel';

  @override
  String get languageSystem => 'System';

  @override
  String get languageEnglish => 'Englisch';

  @override
  String get languageGerman => 'Deutsch';

  @override
  String get iemEmptyTitle => 'Kein IEM verbunden';

  @override
  String get iemEmptyBody =>
      'Verbinden Sie genau ein Industrial Edge Management, um Ihre Geräte zu verwalten.';

  @override
  String get iemConnect => 'IEM verbinden';

  @override
  String get iemConnectTitle => 'IEM verbinden';

  @override
  String get iemEditTitle => 'IEM-Verbindung bearbeiten';

  @override
  String get iemRemoveTitle => 'IEM-Verbindung entfernen?';

  @override
  String get iemRemoveMessage =>
      'Die gespeicherte URL, der Benutzername und das Passwort dieses IEM werden von diesem Gerät gelöscht.';

  @override
  String get devicesEmptyTitle => 'Keine Geräte';

  @override
  String get devicesEmptyBody =>
      'Fügen Sie ein bereits onboardetes Gerät hinzu oder onboarden Sie ein neues.';

  @override
  String get deviceAddTooltip => 'Onboardetes Gerät hinzufügen';

  @override
  String get deviceOnboardTooltip => 'Gerät onboarden';

  @override
  String get deviceAddTitle => 'Gerät hinzufügen';

  @override
  String get deviceEditTitle => 'Gerät bearbeiten';

  @override
  String get deviceRemoveTitle => 'Gerät entfernen?';

  @override
  String deviceRemoveMessage(String name) {
    return '$name wird aus dieser App entfernt. Das Gerät selbst wird nicht verändert.';
  }

  @override
  String get fieldUrl => 'URL';

  @override
  String get fieldUrlHint => 'https://192.168.0.10';

  @override
  String get fieldUsername => 'Benutzername';

  @override
  String get fieldPassword => 'Passwort';

  @override
  String get fieldDisplayName => 'Anzeigename (optional)';

  @override
  String get labelUrl => 'URL';

  @override
  String get labelUser => 'Benutzer';

  @override
  String get labelAdded => 'Hinzugefügt';

  @override
  String get validationRequired => 'Pflichtfeld';

  @override
  String get validationUrlInvalid =>
      'Geben Sie eine gültige URL ein, zum Beispiel https://192.168.0.10';

  @override
  String get validationUrlScheme =>
      'Nur http:// und https:// werden unterstützt';

  @override
  String get validationUrlHost =>
      'Geben Sie eine gültige IP-Adresse oder einen Hostnamen ein';

  @override
  String get validationUrlPort => 'Der Port muss zwischen 1 und 65535 liegen';

  @override
  String get deviceActionsTooltip => 'Geräteaktionen';

  @override
  String get tabApplications => 'Anwendungen';

  @override
  String get tabDeviceSettings => 'Einstellungen';

  @override
  String get deviceAppsEmptyTitle => 'Keine Anwendungsdaten';

  @override
  String get deviceAppsEmptyBody =>
      'Die auf diesem Gerät installierten Apps werden vom Gerät selbst gelesen. Dafür fehlt der Geräte-Client, der noch nicht implementiert ist.';

  @override
  String get deviceSettingsConnection => 'Verbindung';

  @override
  String get deviceSettingsPendingTitle =>
      'Geräteeinstellungen sind noch nicht verfügbar';

  @override
  String get deviceSettingsPendingBody =>
      'Netzwerk-, Zeit- und Gerätekonfiguration werden vom Gerät gelesen. Hier lässt sich nur die in dieser App gespeicherte Verbindung ändern.';

  @override
  String get actionStore => 'Speichern';

  @override
  String get actionSave => 'Sichern';

  @override
  String get actionCancel => 'Abbrechen';

  @override
  String get actionRemove => 'Entfernen';

  @override
  String get actionEdit => 'Bearbeiten';

  @override
  String get snackStored => 'Gespeichert';

  @override
  String get onboardTitle => 'Gerät onboarden';

  @override
  String get onboardChooseMethod =>
      'Wählen Sie, wie die Onboarding-Konfiguration auf das Gerät gelangt.';

  @override
  String get onboardQr => 'QR-Code';

  @override
  String get onboardQrSubtitle =>
      'Den vom Gerät angezeigten Onboarding-QR-Code scannen.';

  @override
  String get onboardUsb => 'USB';

  @override
  String get onboardUsbSubtitle =>
      'Die Onboarding-Konfiguration auf einen USB-Stick schreiben.';

  @override
  String get onboardWeb => 'Webzugriff';

  @override
  String get onboardWebSubtitle =>
      'Die Konfiguration über das Web Based Management des Geräts hochladen.';

  @override
  String get notImplementedTitle => 'Noch nicht implementiert';

  @override
  String get notImplementedBody =>
      'Dieser Onboarding-Weg ist nicht implementiert. Er benötigt die Onboarding-Konfiguration des verbundenen IEM und damit den IEM-API-Client.';

  @override
  String get credentialsNote =>
      'Das Passwort wird im sicheren Speicher dieses Geräts abgelegt, nicht in den App-Einstellungen.';
}
