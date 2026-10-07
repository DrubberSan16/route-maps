import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/core/errors/app_exception.dart';
import 'package:maps_platform/domain/entities/coordinate.dart';
import 'package:maps_platform/domain/entities/geocoding_result.dart';
import 'package:maps_platform/domain/repositories/geocoding_repository.dart';
import 'package:maps_platform/features/search/search_screen.dart';
import 'package:maps_platform/presentation/providers.dart';

import '../helpers/fakes.dart';

/// The answers of the phone's own search (the downloaded regions).
class _DeviceGeocoding implements GeocodingRepository {
  final queries = <String>[];
  AppException? error;

  @override
  Future<List<GeocodingResult>> search(String query, {Coordinate? near}) async {
    queries.add(query);
    if (error case final error?) throw error;
    return const [
      GeocodingResult(
        displayName: 'Hospital Luis Vernaza, Av. Julián Coronel, Guayaquil, Guayas',
        name: 'Hospital Luis Vernaza',
        coordinate: Coordinate(-2.18628, -79.88379),
        source: GeocodingSource.device,
      ),
    ];
  }

  @override
  Future<GeocodingResult?> reverse(Coordinate coordinate) async => null;
}

void main() {
  late _DeviceGeocoding geocoding;
  setUp(() => geocoding = _DeviceGeocoding());

  Future<void> search(WidgetTester tester, String text) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          connectivityServiceProvider.overrideWithValue(FakeConnectivityService()),
          locationServiceProvider.overrideWithValue(FakeLocationService()),
          geocodingRepositoryProvider.overrideWithValue(geocoding),
          savedRouteRepositoryProvider.overrideWithValue(InMemorySavedRouteRepository()),
        ],
        child: const MaterialApp(home: SearchScreen()),
      ),
    );
    await tester.enterText(find.byKey(const Key('search-field')), text);
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pumpAndSettle();
  }

  testWidgets('addresses found on the phone say they come from the downloaded maps', (
    tester,
  ) async {
    await search(tester, 'hospital');
    expect(geocoding.queries, ['hospital']);
    expect(find.text('Lugares · sin conexión, en tus mapas descargados'), findsOneWidget);
    expect(find.text('Hospital Luis Vernaza'), findsOneWidget);
  });

  testWidgets('with nothing downloaded it says what still works', (tester) async {
    geocoding.error = AppException.of(ErrorCodes.offlineSearchUnavailable);
    await search(tester, 'hospital');
    expect(find.text(userMessageFor(ErrorCodes.offlineSearchUnavailable)), findsOneWidget);
    expect(find.textContaining('Sin resultados'), findsNothing);
  });

  testWidgets('coordinates need no search at all', (tester) async {
    await search(tester, '-2.18628, -79.88379');
    expect(geocoding.queries, isEmpty);
    expect(find.text('Coordenadas'), findsOneWidget);
  });
}
