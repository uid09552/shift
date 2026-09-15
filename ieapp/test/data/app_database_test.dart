import 'package:flutter_test/flutter_test.dart';
import 'package:ieapp/data/app_database.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import '../app_harness.dart';

void main() {
  late Database db;

  setUp(() async => db = await openTestDatabase());

  test('creates the connections and settings tables', () async {
    final tables = await db.query(
      'sqlite_master',
      columns: ['name'],
      where: 'type = ?',
      whereArgs: ['table'],
    );
    final names = tables.map((row) => row['name']).toSet();
    expect(names, containsAll(['connections', 'settings']));
    expect(await db.getVersion(), AppDatabase.version);
  });

  test('refuses a second IEM row', () async {
    Future<void> insertIem(String id) => db.insert('connections', {
      'id': id,
      'kind': 'iem',
      'base_url': 'https://iem.example.com',
      'username': 'admin',
      'added_at': DateTime(2026).toIso8601String(),
    });

    await insertIem('iem-1');
    expect(insertIem('iem-2'), throwsA(isA<DatabaseException>()));
  });

  test('refuses an unknown connection kind', () async {
    expect(
      db.insert('connections', {
        'id': 'x',
        'kind': 'gateway',
        'base_url': 'https://x',
        'username': 'admin',
        'added_at': DateTime(2026).toIso8601String(),
      }),
      throwsA(isA<DatabaseException>()),
    );
  });
}
