import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors/app_exception.dart';
import '../../core/utils/coordinate_parser.dart';
import '../../domain/entities/coordinate.dart';
import '../../domain/entities/geocoding_result.dart';
import '../../domain/entities/offline_route.dart';
import '../../presentation/providers.dart';

@immutable
class SearchState {
  const SearchState({
    this.query = '',
    this.coordinate,
    this.savedRoutes = const [],
    this.places = const [],
    this.isSearching = false,
    this.error,
  });

  final String query;

  /// The query read as "latitude, longitude" (works offline).
  final Coordinate? coordinate;

  /// Saved routes whose name matches (works offline).
  final List<OfflineRoute> savedRoutes;

  /// Addresses found by the server.
  final List<GeocodingResult> places;
  final bool isSearching;
  final String? error;
}

final destinationSearchProvider =
    NotifierProvider.autoDispose<DestinationSearchController, SearchState>(
      DestinationSearchController.new,
    );

/// Destination search: coordinates and saved routes on the device, addresses
/// through the API (Nominatim) when there is connection.
class DestinationSearchController extends Notifier<SearchState> {
  static const debounce = Duration(milliseconds: 400);
  static const minimumLength = 3;

  Timer? _timer;
  int _generation = 0;

  @override
  SearchState build() {
    ref.onDispose(() => _timer?.cancel());
    return const SearchState();
  }

  void search(String text) {
    _timer?.cancel();
    final query = text.trim();
    final generation = ++_generation;
    state = SearchState(
      query: query,
      coordinate: parseCoordinate(query),
      isSearching: query.isNotEmpty,
    );
    if (query.isEmpty) return;
    _timer = Timer(debounce, () => unawaited(_run(query, generation)));
  }

  Future<void> _run(String query, int generation) async {
    final saved = _matching(await ref.read(savedRouteRepositoryProvider).getAll(), query);
    if (!ref.mounted || generation != _generation) return;
    final online = ref.read(isOnlineProvider);
    final lookUp = online && state.coordinate == null && query.length >= minimumLength;
    state = SearchState(
      query: query,
      coordinate: state.coordinate,
      savedRoutes: saved,
      isSearching: lookUp,
      error: online || state.coordinate != null
          ? null
          : 'Sin conexión: la búsqueda de direcciones necesita Internet. '
                'Escribe coordenadas (latitud, longitud), mantén presionado el mapa '
                'o elige una ruta guardada.',
    );
    if (!lookUp) return;
    final near = ref.read(positionProvider).value?.coordinate;
    try {
      final places = await ref.read(geocodingRepositoryProvider).search(query, near: near);
      if (!ref.mounted || generation != _generation) return;
      state = SearchState(query: query, savedRoutes: saved, places: places);
    } on AppException catch (error) {
      if (!ref.mounted || generation != _generation) return;
      state = SearchState(query: query, savedRoutes: saved, error: error.message);
    }
  }

  static List<OfflineRoute> _matching(List<OfflineRoute> routes, String query) {
    final needle = _fold(query);
    return [
      for (final route in routes)
        if (_fold(route.name).contains(needle)) route,
    ];
  }

  /// Lower case without Spanish accents, so "malecon" finds "Malecón".
  static String _fold(String text) {
    const from = 'áéíóúüñ';
    const to = 'aeiouun';
    final lower = text.toLowerCase();
    final buffer = StringBuffer();
    for (final char in lower.split('')) {
      final index = from.indexOf(char);
      buffer.write(index >= 0 ? to[index] : char);
    }
    return buffer.toString();
  }
}
