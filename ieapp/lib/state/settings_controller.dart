import 'package:flutter/material.dart';

import '../data/settings_repository.dart';

/// Theme mode and language, persisted in the `settings` table.
///
/// Values are cached in memory so widgets can read them synchronously; writes
/// go to the database and then notify.  A `null` [locale] means "follow the
/// system language".
class SettingsController extends ChangeNotifier {
  SettingsController(this._repository, Map<String, String> initial)
    : _values = {...initial};

  /// Reads the stored settings and builds the controller around them.
  static Future<SettingsController> load(SettingsRepository repository) async =>
      SettingsController(repository, await repository.loadAll());

  final SettingsRepository _repository;
  final Map<String, String> _values;

  ThemeMode get themeMode =>
      switch (_values[SettingsRepository.themeModeKey]) {
        'light' => ThemeMode.light,
        'dark' => ThemeMode.dark,
        _ => ThemeMode.system,
      };

  Locale? get locale {
    final code = _values[SettingsRepository.languageKey];
    return (code == null || code.isEmpty) ? null : Locale(code);
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    _values[SettingsRepository.themeModeKey] = mode.name;
    await _repository.put(SettingsRepository.themeModeKey, mode.name);
    notifyListeners();
  }

  /// Pass `null` to follow the system language.
  Future<void> setLocale(Locale? value) async {
    if (value == null) {
      _values.remove(SettingsRepository.languageKey);
      await _repository.remove(SettingsRepository.languageKey);
    } else {
      _values[SettingsRepository.languageKey] = value.languageCode;
      await _repository.put(
        SettingsRepository.languageKey,
        value.languageCode,
      );
    }
    notifyListeners();
  }
}
