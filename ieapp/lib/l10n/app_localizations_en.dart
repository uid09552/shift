// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Industrial Edge';

  @override
  String get tabIem => 'IEM';

  @override
  String get tabDevices => 'Devices';

  @override
  String get settingsTitle => 'Settings';

  @override
  String get settingsAppearance => 'Appearance';

  @override
  String get settingsLanguage => 'Language';

  @override
  String get themeSystem => 'System';

  @override
  String get themeLight => 'Light';

  @override
  String get themeDark => 'Dark';

  @override
  String get languageSystem => 'System';

  @override
  String get languageEnglish => 'English';

  @override
  String get languageGerman => 'German';

  @override
  String get iemEmptyTitle => 'No IEM connected';

  @override
  String get iemEmptyBody =>
      'Connect exactly one Industrial Edge Management to manage your fleet.';

  @override
  String get iemConnect => 'Connect IEM';

  @override
  String get iemConnectTitle => 'Connect IEM';

  @override
  String get iemEditTitle => 'Edit IEM connection';

  @override
  String get iemRemoveTitle => 'Remove IEM connection?';

  @override
  String get iemRemoveMessage =>
      'The stored URL, user name and password for this IEM are deleted from this device.';

  @override
  String get devicesEmptyTitle => 'No devices';

  @override
  String get devicesEmptyBody =>
      'Add a device that is already onboarded, or onboard a new one.';

  @override
  String get deviceAddTooltip => 'Add onboarded device';

  @override
  String get deviceOnboardTooltip => 'Onboard device';

  @override
  String get deviceAddTitle => 'Add device';

  @override
  String get deviceEditTitle => 'Edit device';

  @override
  String get deviceRemoveTitle => 'Remove device?';

  @override
  String deviceRemoveMessage(String name) {
    return '$name is removed from this app. The device itself is not changed.';
  }

  @override
  String get fieldUrl => 'URL';

  @override
  String get fieldUrlHint => 'https://192.168.0.10';

  @override
  String get fieldUsername => 'User name';

  @override
  String get fieldPassword => 'Password';

  @override
  String get fieldDisplayName => 'Display name (optional)';

  @override
  String get labelUrl => 'URL';

  @override
  String get labelUser => 'User';

  @override
  String get labelAdded => 'Added';

  @override
  String get validationRequired => 'Required';

  @override
  String get validationUrlInvalid =>
      'Enter a valid URL, for example https://192.168.0.10';

  @override
  String get validationUrlScheme => 'Only http:// and https:// are supported';

  @override
  String get validationUrlHost => 'Enter a valid IP address or host name';

  @override
  String get validationUrlPort => 'The port must be between 1 and 65535';

  @override
  String get deviceActionsTooltip => 'Device actions';

  @override
  String get tabApplications => 'Applications';

  @override
  String get tabDeviceSettings => 'Settings';

  @override
  String get deviceAppsEmptyTitle => 'No application data';

  @override
  String get deviceAppsEmptyBody =>
      'The apps installed on this device are read from the device itself. That needs the device client, which is not implemented yet.';

  @override
  String get deviceSettingsConnection => 'Connection';

  @override
  String get deviceSettingsPendingTitle =>
      'Device settings are not available yet';

  @override
  String get deviceSettingsPendingBody =>
      'Network, time and device configuration are read from the device. Only the connection stored in this app can be changed here.';

  @override
  String get actionStore => 'Store';

  @override
  String get actionSave => 'Save';

  @override
  String get actionCancel => 'Cancel';

  @override
  String get actionRemove => 'Remove';

  @override
  String get actionEdit => 'Edit';

  @override
  String get snackStored => 'Stored';

  @override
  String get onboardTitle => 'Onboard device';

  @override
  String get onboardChooseMethod =>
      'Choose how the onboarding configuration reaches the device.';

  @override
  String get onboardQr => 'QR code';

  @override
  String get onboardQrSubtitle =>
      'Scan the onboarding QR code shown by the device.';

  @override
  String get onboardUsb => 'USB';

  @override
  String get onboardUsbSubtitle =>
      'Write the onboarding configuration to a USB drive.';

  @override
  String get onboardWeb => 'Web access';

  @override
  String get onboardWebSubtitle =>
      'Upload the configuration through the device Web Based Management.';

  @override
  String get notImplementedTitle => 'Not implemented yet';

  @override
  String get notImplementedBody =>
      'This onboarding path is not implemented. It needs the onboarding configuration from the connected IEM, which requires the IEM API client.';

  @override
  String get credentialsNote =>
      'The password is kept in the platform secure storage of this device, not in the app settings.';
}
