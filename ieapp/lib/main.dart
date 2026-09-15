import 'package:flutter/material.dart';

import 'app.dart';
import 'data/app_database.dart';
import 'data/connection_repository.dart';
import 'data/credential_store.dart';
import 'data/preferences_migration.dart';
import 'data/settings_repository.dart';
import 'state/connections_controller.dart';
import 'state/settings_controller.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final database = await AppDatabase.open();
  await PreferencesMigration(database).run();

  final connections = await ConnectionsController.load(
    ConnectionRepository(
      database: database,
      credentials: SecureCredentialStore(),
    ),
  );
  final settings = await SettingsController.load(SettingsRepository(database));

  runApp(IeApp(settings: settings, connections: connections));
}
