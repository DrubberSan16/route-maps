import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/utils/formatters.dart';
import '../../domain/entities/coordinate.dart';
import '../../domain/entities/offline_route.dart';
import 'search_controller.dart';

/// What the user picked in the search screen.
sealed class SearchSelection {
  const SearchSelection();
}

class PlaceSelection extends SearchSelection {
  const PlaceSelection(this.coordinate, this.label);

  final Coordinate coordinate;
  final String label;
}

class SavedRouteSelection extends SearchSelection {
  const SavedRouteSelection(this.route);

  final OfflineRoute route;
}

class SearchScreen extends ConsumerWidget {
  const SearchScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(destinationSearchProvider);
    final controller = ref.read(destinationSearchProvider.notifier);
    final coordinate = state.coordinate;
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: TextField(
          key: const Key('search-field'),
          autofocus: true,
          textInputAction: TextInputAction.search,
          decoration: const InputDecoration(
            hintText: 'Buscar destino...',
            border: InputBorder.none,
          ),
          onChanged: controller.search,
        ),
      ),
      body: ListView(
        children: [
          if (state.isSearching) const LinearProgressIndicator(),
          if (coordinate != null)
            ListTile(
              leading: const Icon(Icons.my_location),
              title: Text('Ir a $coordinate'),
              subtitle: const Text('Coordenadas'),
              onTap: () =>
                  Navigator.pop(context, PlaceSelection(coordinate, coordinate.toString())),
            ),
          if (state.savedRoutes.isNotEmpty) const _Header('Rutas guardadas'),
          for (final route in state.savedRoutes)
            ListTile(
              leading: const Icon(Icons.bookmark),
              title: Text(route.name),
              subtitle: Text(
                '${formatDistance(route.distanceMeters)} · ${formatDuration(route.durationSeconds)}',
              ),
              onTap: () => Navigator.pop(context, SavedRouteSelection(route)),
            ),
          if (state.places.isNotEmpty) const _Header('Lugares'),
          for (final place in state.places)
            ListTile(
              leading: const Icon(Icons.place),
              title: Text(place.label),
              subtitle: Text(place.displayName, maxLines: 2, overflow: TextOverflow.ellipsis),
              onTap: () => Navigator.pop(context, PlaceSelection(place.coordinate, place.label)),
            ),
          if (state.error case final error?)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(error, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ),
          if (_nothingFound(state))
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Sin resultados. Prueba con otra dirección o escribe coordenadas.'),
            ),
        ],
      ),
    );
  }

  static bool _nothingFound(SearchState state) =>
      state.query.length >= DestinationSearchController.minimumLength &&
      !state.isSearching &&
      state.error == null &&
      state.coordinate == null &&
      state.savedRoutes.isEmpty &&
      state.places.isEmpty;
}

class _Header extends StatelessWidget {
  const _Header(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
    child: Text(text, style: Theme.of(context).textTheme.titleSmall),
  );
}
