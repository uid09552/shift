import 'package:flutter_test/flutter_test.dart';
import 'package:ieapp/app.dart';
import 'package:ieapp/data/app_database.dart';
import 'package:ieapp/data/connection_repository.dart';
import 'package:ieapp/data/credential_store.dart';
import 'package:ieapp/data/settings_repository.dart';
import 'package:ieapp/domain/edge_connection.dart';
import 'package:ieapp/state/connections_controller.dart';
import 'package:ieapp/state/settings_controller.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Opens a fresh in-memory database with the real schema.
///
/// The no-isolate factory is deliberate: `testWidgets` runs inside a fake-async
/// zone, and work handed to another isolate never completes there.
Future<Database> openTestDatabase() async {
  sqfliteFfiInit();
  final db = await AppDatabase.open(
    path: inMemoryDatabasePath,
    factory: databaseFactoryFfiNoIsolate,
  );
  // sqflite hands back the same open database for a given path, so an
  // unclosed ':memory:' database would carry rows into the next test.
  addTearDown(db.close);
  return db;
}

/// Everything a test needs to drive the app without platform channels.
class AppHarness {
  AppHarness._({
    required this.database,
    required this.repository,
    required this.credentials,
    required this.settings,
    required this.connections,
  });

  final Database database;
  final ConnectionRepository repository;
  final InMemoryCredentialStore credentials;
  final SettingsController settings;
  final ConnectionsController connections;

  static Future<AppHarness> create({
    Map<String, String> storedSettings = const {},
  }) async {
    final database = await openTestDatabase();
    final settingsRepository = SettingsRepository(database);
    for (final entry in storedSettings.entries) {
      await settingsRepository.put(entry.key, entry.value);
    }
    final credentials = InMemoryCredentialStore();
    final repository = ConnectionRepository(
      database: database,
      credentials: credentials,
    );
    return AppHarness._(
      database: database,
      repository: repository,
      credentials: credentials,
      settings: await SettingsController.load(settingsRepository),
      connections: await ConnectionsController.load(repository),
    );
  }

  IeApp get app => IeApp(settings: settings, connections: connections);
}

EdgeConnection device({
  String id = 'device-1',
  String url = 'https://192.168.0.10',
  String username = 'admin',
  String? displayName,
}) => EdgeConnection(
  id: id,
  baseUrl: Uri.parse(url),
  username: username,
  displayName: displayName,
  addedAt: DateTime(2026, 9, 3),
);

/// Pumps the app and settles the initial frame.
Future<void> pumpApp(WidgetTester tester, AppHarness harness) async {
  await tester.pumpWidget(harness.app);
  await tester.pumpAndSettle();
}
