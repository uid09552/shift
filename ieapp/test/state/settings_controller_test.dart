import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ieapp/data/settings_repository.dart';
import 'package:ieapp/state/settings_controller.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import '../app_harness.dart';

void main() {
  late Database db;
  late SettingsRepository repository;

  setUp(() async {
    db = await openTestDatabase();
    repository = SettingsRepository(db);
  });


  test('defaults to system theme and system language', () async {
    final settings = await SettingsController.load(repository);
    expect(settings.themeMode, ThemeMode.system);
    expect(settings.locale, isNull);
  });

  test('persists the theme mode', () async {
    final settings = await SettingsController.load(repository);
    var notified = 0;
    settings.addListener(() => notified++);

    await settings.setThemeMode(ThemeMode.dark);

    expect(settings.themeMode, ThemeMode.dark);
    expect(notified, 1);
    expect((await SettingsController.load(repository)).themeMode, ThemeMode.dark);
  });

  test('persists the language and can fall back to system', () async {
    final settings = await SettingsController.load(repository);

    await settings.setLocale(const Locale('de'));
    expect(settings.locale, const Locale('de'));
    expect((await SettingsController.load(repository)).locale, const Locale('de'));

    await settings.setLocale(null);
    expect(settings.locale, isNull);
    expect((await repository.loadAll()), isNot(contains(SettingsRepository.languageKey)));
  });
}
