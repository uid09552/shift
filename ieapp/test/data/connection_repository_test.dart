import 'package:flutter_test/flutter_test.dart';
import 'package:ieapp/data/connection_repository.dart';
import 'package:ieapp/data/credential_store.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import '../app_harness.dart';

void main() {
  late Database db;
  late ConnectionRepository repository;
  late InMemoryCredentialStore credentials;

  setUp(() async {
    db = await openTestDatabase();
    credentials = InMemoryCredentialStore();
    repository = ConnectionRepository(database: db, credentials: credentials);
  });


  test('starts empty', () async {
    expect(await repository.loadIem(), isNull);
    expect(await repository.loadDevices(), isEmpty);
  });

  test('stores a device and its password separately', () async {
    await repository.saveDevice(device(), password: 'secret');

    final stored = (await repository.loadDevices()).single;
    expect(stored.id, 'device-1');
    expect(stored.host, '192.168.0.10');
    expect(stored.username, 'admin');
    expect(await repository.password('device-1'), 'secret');

    // The password must not reach the database.
    final rows = await db.query('connections');
    expect(rows.single.values.contains('secret'), isFalse);
  });

  test('saving the same id replaces instead of duplicating', () async {
    await repository.saveDevice(device(), password: 'secret');
    await repository.saveDevice(
      device(url: 'https://192.168.0.11', displayName: 'Line 1'),
    );

    final devices = await repository.loadDevices();
    expect(devices, hasLength(1));
    expect(devices.single.host, '192.168.0.11');
    expect(devices.single.name, 'Line 1');
    expect(
      await repository.password('device-1'),
      'secret',
      reason: 'an edit without a new password keeps the stored one',
    );
  });

  test('removing a device deletes its credential', () async {
    await repository.saveDevice(device(), password: 'secret');
    await repository.removeDevice('device-1');

    expect(await repository.loadDevices(), isEmpty);
    expect(await repository.password('device-1'), isNull);
  });

  test('only one IEM is kept, and the replaced credential is deleted', () async {
    await repository.saveIem(device(id: 'iem-1'), password: 'first');
    await repository.saveIem(
      device(id: 'iem-2', url: 'https://iem.example.com'),
      password: 'second',
    );

    expect((await repository.loadIem())!.id, 'iem-2');
    expect(
      await db.query('connections', where: "kind = 'iem'"),
      hasLength(1),
    );
    expect(await repository.password('iem-1'), isNull);
    expect(await repository.password('iem-2'), 'second');
  });

  test('the IEM and the devices do not shadow each other', () async {
    await repository.saveIem(device(id: 'iem-1'));
    await repository.saveDevice(device(id: 'device-1'));
    await repository.saveDevice(device(id: 'device-2'));

    expect((await repository.loadIem())!.id, 'iem-1');
    expect(
      (await repository.loadDevices()).map((d) => d.id),
      ['device-1', 'device-2'],
    );
  });

  test('removing the IEM clears metadata and credential', () async {
    await repository.saveIem(device(id: 'iem-1'), password: 'first');
    await repository.removeIem();

    expect(await repository.loadIem(), isNull);
    expect(await repository.password('iem-1'), isNull);
  });

  test('devices survive reopening the repository', () async {
    await repository.saveDevice(device(), password: 'secret');

    final reopened = ConnectionRepository(
      database: db,
      credentials: credentials,
    );
    expect((await reopened.loadDevices()).single.host, '192.168.0.10');
  });
}
