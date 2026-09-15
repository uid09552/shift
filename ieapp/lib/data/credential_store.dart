import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Storage for connection passwords.
///
/// Passwords must never be written to app settings, logs or the repository —
/// only through this interface.
abstract interface class CredentialStore {
  Future<String?> read(String connectionId);
  Future<void> write(String connectionId, String password);
  Future<void> delete(String connectionId);
}

/// Platform-backed implementation (Keystore on Android, Keychain on iOS).
class SecureCredentialStore implements CredentialStore {
  SecureCredentialStore([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  String _key(String connectionId) => 'credential/$connectionId';

  @override
  Future<String?> read(String connectionId) =>
      _storage.read(key: _key(connectionId));

  @override
  Future<void> write(String connectionId, String password) =>
      _storage.write(key: _key(connectionId), value: password);

  @override
  Future<void> delete(String connectionId) =>
      _storage.delete(key: _key(connectionId));
}

/// Session-only implementation used by tests and by unsupported platforms.
class InMemoryCredentialStore implements CredentialStore {
  final Map<String, String> _values = {};

  @override
  Future<String?> read(String connectionId) async => _values[connectionId];

  @override
  Future<void> write(String connectionId, String password) async {
    _values[connectionId] = password;
  }

  @override
  Future<void> delete(String connectionId) async {
    _values.remove(connectionId);
  }
}
