import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_de.dart';
import 'app_localizations_en.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('de'),
    Locale('en'),
  ];

  /// No description provided for @appTitle.
  ///
  /// In en, this message translates to:
  /// **'Industrial Edge'**
  String get appTitle;

  /// No description provided for @tabIem.
  ///
  /// In en, this message translates to:
  /// **'IEM'**
  String get tabIem;

  /// No description provided for @tabDevices.
  ///
  /// In en, this message translates to:
  /// **'Devices'**
  String get tabDevices;

  /// No description provided for @settingsTitle.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settingsTitle;

  /// No description provided for @settingsAppearance.
  ///
  /// In en, this message translates to:
  /// **'Appearance'**
  String get settingsAppearance;

  /// No description provided for @settingsLanguage.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get settingsLanguage;

  /// No description provided for @themeSystem.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get themeSystem;

  /// No description provided for @themeLight.
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get themeLight;

  /// No description provided for @themeDark.
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get themeDark;

  /// No description provided for @languageSystem.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get languageSystem;

  /// No description provided for @languageEnglish.
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get languageEnglish;

  /// No description provided for @languageGerman.
  ///
  /// In en, this message translates to:
  /// **'German'**
  String get languageGerman;

  /// No description provided for @iemEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No IEM connected'**
  String get iemEmptyTitle;

  /// No description provided for @iemEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Connect exactly one Industrial Edge Management to manage your fleet.'**
  String get iemEmptyBody;

  /// No description provided for @iemConnect.
  ///
  /// In en, this message translates to:
  /// **'Connect IEM'**
  String get iemConnect;

  /// No description provided for @iemConnectTitle.
  ///
  /// In en, this message translates to:
  /// **'Connect IEM'**
  String get iemConnectTitle;

  /// No description provided for @iemEditTitle.
  ///
  /// In en, this message translates to:
  /// **'Edit IEM connection'**
  String get iemEditTitle;

  /// No description provided for @iemRemoveTitle.
  ///
  /// In en, this message translates to:
  /// **'Remove IEM connection?'**
  String get iemRemoveTitle;

  /// No description provided for @iemRemoveMessage.
  ///
  /// In en, this message translates to:
  /// **'The stored URL, user name and password for this IEM are deleted from this device.'**
  String get iemRemoveMessage;

  /// No description provided for @devicesEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No devices'**
  String get devicesEmptyTitle;

  /// No description provided for @devicesEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Add a device that is already onboarded, or onboard a new one.'**
  String get devicesEmptyBody;

  /// No description provided for @deviceAddTooltip.
  ///
  /// In en, this message translates to:
  /// **'Add onboarded device'**
  String get deviceAddTooltip;

  /// No description provided for @deviceOnboardTooltip.
  ///
  /// In en, this message translates to:
  /// **'Onboard device'**
  String get deviceOnboardTooltip;

  /// No description provided for @deviceAddTitle.
  ///
  /// In en, this message translates to:
  /// **'Add device'**
  String get deviceAddTitle;

  /// No description provided for @deviceEditTitle.
  ///
  /// In en, this message translates to:
  /// **'Edit device'**
  String get deviceEditTitle;

  /// No description provided for @deviceRemoveTitle.
  ///
  /// In en, this message translates to:
  /// **'Remove device?'**
  String get deviceRemoveTitle;

  /// No description provided for @deviceRemoveMessage.
  ///
  /// In en, this message translates to:
  /// **'{name} is removed from this app. The device itself is not changed.'**
  String deviceRemoveMessage(String name);

  /// No description provided for @fieldUrl.
  ///
  /// In en, this message translates to:
  /// **'URL'**
  String get fieldUrl;

  /// No description provided for @fieldUrlHint.
  ///
  /// In en, this message translates to:
  /// **'https://192.168.0.10'**
  String get fieldUrlHint;

  /// No description provided for @fieldUsername.
  ///
  /// In en, this message translates to:
  /// **'User name'**
  String get fieldUsername;

  /// No description provided for @fieldPassword.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get fieldPassword;

  /// No description provided for @fieldDisplayName.
  ///
  /// In en, this message translates to:
  /// **'Display name (optional)'**
  String get fieldDisplayName;

  /// No description provided for @labelUrl.
  ///
  /// In en, this message translates to:
  /// **'URL'**
  String get labelUrl;

  /// No description provided for @labelUser.
  ///
  /// In en, this message translates to:
  /// **'User'**
  String get labelUser;

  /// No description provided for @labelAdded.
  ///
  /// In en, this message translates to:
  /// **'Added'**
  String get labelAdded;

  /// No description provided for @validationRequired.
  ///
  /// In en, this message translates to:
  /// **'Required'**
  String get validationRequired;

  /// No description provided for @validationUrlInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid URL, for example https://192.168.0.10'**
  String get validationUrlInvalid;

  /// No description provided for @validationUrlScheme.
  ///
  /// In en, this message translates to:
  /// **'Only http:// and https:// are supported'**
  String get validationUrlScheme;

  /// No description provided for @validationUrlHost.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid IP address or host name'**
  String get validationUrlHost;

  /// No description provided for @validationUrlPort.
  ///
  /// In en, this message translates to:
  /// **'The port must be between 1 and 65535'**
  String get validationUrlPort;

  /// No description provided for @deviceActionsTooltip.
  ///
  /// In en, this message translates to:
  /// **'Device actions'**
  String get deviceActionsTooltip;

  /// No description provided for @tabApplications.
  ///
  /// In en, this message translates to:
  /// **'Applications'**
  String get tabApplications;

  /// No description provided for @tabDeviceSettings.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get tabDeviceSettings;

  /// No description provided for @deviceAppsEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No application data'**
  String get deviceAppsEmptyTitle;

  /// No description provided for @deviceAppsEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'The apps installed on this device are read from the device itself. That needs the device client, which is not implemented yet.'**
  String get deviceAppsEmptyBody;

  /// No description provided for @deviceSettingsConnection.
  ///
  /// In en, this message translates to:
  /// **'Connection'**
  String get deviceSettingsConnection;

  /// No description provided for @deviceSettingsPendingTitle.
  ///
  /// In en, this message translates to:
  /// **'Device settings are not available yet'**
  String get deviceSettingsPendingTitle;

  /// No description provided for @deviceSettingsPendingBody.
  ///
  /// In en, this message translates to:
  /// **'Network, time and device configuration are read from the device. Only the connection stored in this app can be changed here.'**
  String get deviceSettingsPendingBody;

  /// No description provided for @actionStore.
  ///
  /// In en, this message translates to:
  /// **'Store'**
  String get actionStore;

  /// No description provided for @actionSave.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get actionSave;

  /// No description provided for @actionCancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get actionCancel;

  /// No description provided for @actionRemove.
  ///
  /// In en, this message translates to:
  /// **'Remove'**
  String get actionRemove;

  /// No description provided for @actionEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit'**
  String get actionEdit;

  /// No description provided for @snackStored.
  ///
  /// In en, this message translates to:
  /// **'Stored'**
  String get snackStored;

  /// No description provided for @onboardTitle.
  ///
  /// In en, this message translates to:
  /// **'Onboard device'**
  String get onboardTitle;

  /// No description provided for @onboardChooseMethod.
  ///
  /// In en, this message translates to:
  /// **'Choose how the onboarding configuration reaches the device.'**
  String get onboardChooseMethod;

  /// No description provided for @onboardQr.
  ///
  /// In en, this message translates to:
  /// **'QR code'**
  String get onboardQr;

  /// No description provided for @onboardQrSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Scan the onboarding QR code shown by the device.'**
  String get onboardQrSubtitle;

  /// No description provided for @onboardUsb.
  ///
  /// In en, this message translates to:
  /// **'USB'**
  String get onboardUsb;

  /// No description provided for @onboardUsbSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Write the onboarding configuration to a USB drive.'**
  String get onboardUsbSubtitle;

  /// No description provided for @onboardWeb.
  ///
  /// In en, this message translates to:
  /// **'Web access'**
  String get onboardWeb;

  /// No description provided for @onboardWebSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Upload the configuration through the device Web Based Management.'**
  String get onboardWebSubtitle;

  /// No description provided for @notImplementedTitle.
  ///
  /// In en, this message translates to:
  /// **'Not implemented yet'**
  String get notImplementedTitle;

  /// No description provided for @notImplementedBody.
  ///
  /// In en, this message translates to:
  /// **'This onboarding path is not implemented. It needs the onboarding configuration from the connected IEM, which requires the IEM API client.'**
  String get notImplementedBody;

  /// No description provided for @credentialsNote.
  ///
  /// In en, this message translates to:
  /// **'The password is kept in the platform secure storage of this device, not in the app settings.'**
  String get credentialsNote;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['de', 'en'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'de':
      return AppLocalizationsDe();
    case 'en':
      return AppLocalizationsEn();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
