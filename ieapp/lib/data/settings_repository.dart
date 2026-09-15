import 'package:sqflite/sqflite.dart';

/// Key/value settings, stored in the `settings` table.
class SettingsRepository {
  const SettingsRepository(this._db);

  static const themeModeKey = 'themeMode';
  static const languageKey = 'language';

  final Database _db;

  Future<Map<String, String>> loadAll() async {
    final rows = await _db.query('settings');
    return {
      for (final row in rows) row['key']! as String: row['value']! as String,
    };
  }

  Future<void> put(String key, String value) => _db.insert(
    'settings',
    {'key': key, 'value': value},
    conflictAlgorithm: ConflictAlgorithm.replace,
  );

  Future<void> remove(String key) =>
      _db.delete('settings', where: 'key = ?', whereArgs: [key]);
}
