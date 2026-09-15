import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite/sqflite.dart';

import '../domain/edge_connection.dart';
import 'settings_repository.dart';

/// Moves data written by the previous `shared_preferences` storage into SQLite.
///
/// Runs once: the marker row in `settings` stops it from running again, and the
/// old preference keys are dropped after a successful copy. Delete this file
/// once no installation can still hold preference data.
class PreferencesMigration {
  const PreferencesMigration(this._db);

  static const markerKey = 'migration.preferences';
  static const _iemKey = 'connections.iem';
  static const _devicesKey = 'connections.devices';
  static const _themeKey = 'settings.themeMode';
  static const _languageKey = 'settings.languageCode';

  final Database _db;

  /// Returns the number of rows copied.
  Future<int> run({SharedPreferences? preferences}) async {
    final done = await _db.query(
      'settings',
      where: 'key = ?',
      whereArgs: [markerKey],
      limit: 1,
    );
    if (done.isNotEmpty) return 0;

    final prefs = preferences ?? await SharedPreferences.getInstance();
    var copied = 0;

    final iem = prefs.getString(_iemKey);
    if (iem != null) {
      copied += await _insertConnection(iem, 'iem');
    }
    for (final device in prefs.getStringList(_devicesKey) ?? const <String>[]) {
      copied += await _insertConnection(device, 'device');
    }

    final settings = SettingsRepository(_db);
    final theme = prefs.getString(_themeKey);
    if (theme != null) {
      await settings.put(SettingsRepository.themeModeKey, theme);
      copied++;
    }
    final language = prefs.getString(_languageKey);
    if (language != null && language.isNotEmpty) {
      await settings.put(SettingsRepository.languageKey, language);
      copied++;
    }

    await settings.put(markerKey, DateTime.now().toIso8601String());
    for (final key in [_iemKey, _devicesKey, _themeKey, _languageKey]) {
      await prefs.remove(key);
    }
    return copied;
  }

  Future<int> _insertConnection(String json, String kind) async {
    final EdgeConnection connection;
    try {
      connection = EdgeConnection.fromJson(
        jsonDecode(json) as Map<String, dynamic>,
      );
    } on FormatException {
      // A value we cannot read is not worth failing the app launch over.
      return 0;
    }
    await _db.insert('connections', {
      'id': connection.id,
      'kind': kind,
      'base_url': connection.baseUrl.toString(),
      'username': connection.username,
      'display_name': connection.displayName,
      'added_at': connection.addedAt.toIso8601String(),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
    return 1;
  }
}
