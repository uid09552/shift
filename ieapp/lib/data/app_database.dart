import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

/// Opens and migrates the application database.
///
/// One SQLite file holds everything the app persists — connections and
/// settings. The only data kept outside it are the connection passwords, which
/// belong in the platform secure storage (see `credential_store.dart`).
class AppDatabase {
  static const fileName = 'ieapp.db';
  static const version = 1;

  /// Opens the database, creating the schema on first use.
  ///
  /// Tests pass an in-memory [path] together with the ffi [factory].
  static Future<Database> open({String? path, DatabaseFactory? factory}) async {
    return (factory ?? databaseFactory).openDatabase(
      path ?? p.join(await getDatabasesPath(), fileName),
      options: OpenDatabaseOptions(
        version: version,
        onConfigure: (db) => db.execute('PRAGMA foreign_keys = ON'),
        onCreate: (db, version) => _create(db),
        onUpgrade: _upgrade,
      ),
    );
  }

  static Future<void> _create(Database db) async {
    await db.execute('''
      CREATE TABLE connections (
        id           TEXT PRIMARY KEY,
        kind         TEXT NOT NULL CHECK (kind IN ('iem', 'device')),
        base_url     TEXT NOT NULL,
        username     TEXT NOT NULL,
        display_name TEXT,
        added_at     TEXT NOT NULL
      )
    ''');
    // Exactly one IEM, enforced by the schema rather than by the caller.
    await db.execute('''
      CREATE UNIQUE INDEX connections_single_iem
        ON connections (kind) WHERE kind = 'iem'
    ''');
    await db.execute('''
      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    ''');
  }

  /// No shipped version has an older schema yet.
  static Future<void> _upgrade(Database db, int from, int to) async {}
}
