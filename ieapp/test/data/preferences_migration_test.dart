import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:ieapp/data/preferences_migration.dart';
import 'package:ieapp/data/settings_repository.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import '../app_harness.dart';

void main() {
  late Database db;

  setUp(() async => db = await openTestDatabase());

  Future<SharedPreferences> preferencesWith(Map<String, Object> values) async {
    SharedPreferences.setMockInitialValues(values);
    return SharedPreferences.getInstance();
  }

  String json(String id, String url) => jsonEncode({
    'id': id,
    'baseUrl': url,
    'username': 'admin',
    'addedAt': DateTime(2026, 9, 3).toIso8601String(),
  });

  test('copies connections and settings, then clears the old keys', () async {
    final prefs = await preferencesWith({
      'connections.iem': json('iem-1', 'https://iem.example.com'),
      'connections.devices': [
        json('device-1', 'https://192.168.0.10'),
        json('device-2', 'https://192.168.0.11'),
      ],
      'settings.themeMode': 'dark',
      'settings.languageCode': 'de',
    });

    expect(await PreferencesMigration(db).run(preferences: prefs), 5);

    final connections = await db.query('connections', orderBy: 'id');
    expect(connections.map((row) => row['id']), [
      'device-1',
      'device-2',
      'iem-1',
    ]);
    expect(
      connections.firstWhere((row) => row['id'] == 'iem-1')['kind'],
      'iem',
    );

    final settings = await SettingsRepository(db).loadAll();
    expect(settings[SettingsRepository.themeModeKey], 'dark');
    expect(settings[SettingsRepository.languageKey], 'de');

    expect(prefs.getString('connections.iem'), isNull);
    expect(prefs.getStringList('connections.devices'), isNull);
    expect(prefs.getString('settings.themeMode'), isNull);
  });

  test('runs only once', () async {
    final prefs = await preferencesWith({
      'connections.devices': [json('device-1', 'https://192.168.0.10')],
    });

    expect(await PreferencesMigration(db).run(preferences: prefs), 1);
    expect(await PreferencesMigration(db).run(preferences: prefs), 0);
    expect(await db.query('connections'), hasLength(1));
  });

  test('is a no-op on a fresh install', () async {
    final prefs = await preferencesWith({});

    expect(await PreferencesMigration(db).run(preferences: prefs), 0);
    expect(await db.query('connections'), isEmpty);
  });

  test('skips a value it cannot decode', () async {
    final prefs = await preferencesWith({
      'connections.devices': ['not json', json('device-1', 'https://10.0.0.1')],
    });

    expect(await PreferencesMigration(db).run(preferences: prefs), 1);
    expect((await db.query('connections')).single['id'], 'device-1');
  });
}
