import 'package:flutter/foundation.dart';

import '../data/connection_repository.dart';
import '../domain/edge_connection.dart';

/// In-memory view of the stored connections, kept in sync with the database.
class ConnectionsController extends ChangeNotifier {
  ConnectionsController(this._repository);

  /// Builds the controller and reads the stored connections once.
  static Future<ConnectionsController> load(
    ConnectionRepository repository,
  ) async {
    final controller = ConnectionsController(repository);
    await controller.refresh();
    return controller;
  }

  final ConnectionRepository _repository;

  EdgeConnection? _iem;
  List<EdgeConnection> _devices = const [];

  /// The single connected IEM, or `null` when none is configured.
  EdgeConnection? get iem => _iem;

  /// Configured Industrial Edge Devices, oldest first.
  List<EdgeConnection> get devices => List.unmodifiable(_devices);

  Future<void> refresh() async {
    _iem = await _repository.loadIem();
    _devices = await _repository.loadDevices();
    notifyListeners();
  }

  Future<void> saveIem(EdgeConnection connection, {String? password}) async {
    await _repository.saveIem(connection, password: password);
    await refresh();
  }

  Future<void> removeIem() async {
    await _repository.removeIem();
    await refresh();
  }

  Future<void> saveDevice(EdgeConnection connection, {String? password}) async {
    await _repository.saveDevice(connection, password: password);
    await refresh();
  }

  Future<void> removeDevice(String id) async {
    await _repository.removeDevice(id);
    await refresh();
  }
}
