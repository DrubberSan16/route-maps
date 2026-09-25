import 'dart:convert';
import 'dart:io';

/// Responses captured from the running platform (see test/fixtures/README.md).
Map<String, Object?> loadFixture(String name) =>
    jsonDecode(File('test/fixtures/$name.json').readAsStringSync()) as Map<String, Object?>;

/// The `data` of a captured success envelope.
Object? fixtureData(String name) => loadFixture(name)['data'];
