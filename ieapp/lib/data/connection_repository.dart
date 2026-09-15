import 'package:sqflite/sqflite.dart';

import '../domain/edge_connection.dart';
import 'credential_store.dart';

/// Persists the configured connections: exactly one IEM and a list of devices.
///
/// Connection metadata lives in the `connections` table; passwords go to the
/// [CredentialStore]. Nothing here talks to an IEM or a device — no backend
/// client exists yet, so a stored device is a *configured* device, not a
/// device that has been reached.
class ConnectionRepository {
  const ConnectionRepository({
    required Database database,
    required CredentialStore credentials,
  }) : _db = database,
       _credentials = credentials;

  static const _table = 'connections';
  static const _iemKind = 'iem';
  static const _deviceKind = 'device';

  final Database _db;
  final CredentialStore _credentials;

  Future<EdgeConnection?> loadIem() async {
    final rows = await _db.query(
      _table,
      where: 'kind = ?',
      whereArgs: [_iemKind],
      limit: 1,
    );
    return rows.isEmpty ? null : _fromRow(rows.single);
  }

  Future<List<EdgeConnection>> loadDevices() async {
    final rows = await _db.query(
      _table,
      where: 'kind = ?',
      whereArgs: [_deviceKind],
      orderBy: 'added_at, id',
    );
    return rows.map(_fromRow).toList(growable: false);
  }

  /// Stores the one IEM connection, replacing any previous one.
  Future<void> saveIem(EdgeConnection connection, {String? password}) async {
    final previous = await loadIem();
    if (previous != null && previous.id != connection.id) {
      await _credentials.delete(previous.id);
      await _delete(previous.id);
    }
    await _upsert(connection, _iemKind);
    if (password != null) {
      await _credentials.write(connection.id, password);
    }
  }

  Future<void> removeIem() async {
    final current = await loadIem();
    if (current == null) return;
    await _delete(current.id);
    await _credentials.delete(current.id);
  }

  /// Adds [connection], or replaces the entry with the same id.
  Future<void> saveDevice(EdgeConnection connection, {String? password}) async {
    await _upsert(connection, _deviceKind);
    if (password != null) {
      await _credentials.write(connection.id, password);
    }
  }

  Future<void> removeDevice(String id) async {
    await _delete(id);
    await _credentials.delete(id);
  }

  Future<String?> password(String connectionId) =>
      _credentials.read(connectionId);

  Future<void> _upsert(EdgeConnection connection, String kind) => _db.insert(
    _table,
    {
      'id': connection.id,
      'kind': kind,
      'base_url': connection.baseUrl.toString(),
      'username': connection.username,
      'display_name': connection.displayName,
      'added_at': connection.addedAt.toIso8601String(),
    },
    conflictAlgorithm: ConflictAlgorithm.replace,
  );

  Future<void> _delete(String id) =>
      _db.delete(_table, where: 'id = ?', whereArgs: [id]);

  static EdgeConnection _fromRow(Map<String, Object?> row) => EdgeConnection(
    id: row['id']! as String,
    baseUrl: Uri.parse(row['base_url']! as String),
    username: row['username']! as String,
    displayName: row['display_name'] as String?,
    addedAt: DateTime.parse(row['added_at']! as String),
  );
}
