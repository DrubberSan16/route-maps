import 'package:flutter/material.dart';

import '../../../core/utils/formatters.dart';
import '../../../domain/entities/route.dart';
import '../../../domain/entities/routing_profile.dart';
import '../map_controller.dart';

/// Route summary: time, distance, arrival, origin of the data, alternatives
/// and the actions on the selected route.
class RoutePanel extends StatelessWidget {
  const RoutePanel({
    super.key,
    required this.state,
    required this.onSelectRoute,
    required this.onProfileChanged,
    required this.onShowSteps,
    required this.onSave,
    required this.onStartTrip,
    required this.onClose,
    this.now,
  });

  final MapViewState state;
  final ValueChanged<int> onSelectRoute;
  final ValueChanged<RoutingProfile> onProfileChanged;
  final VoidCallback onShowSteps;
  final VoidCallback onSave;
  final VoidCallback onStartTrip;
  final VoidCallback onClose;

  /// Clock used for the arrival time (tests pass a fixed one).
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    final result = state.route!;
    final option = state.selectedOption!;
    final theme = Theme.of(context);
    final arrival = (now ?? DateTime.now()).add(Duration(seconds: option.durationSeconds.round()));
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '${formatDuration(option.durationSeconds)} · '
                    '${formatDistance(option.distanceMeters)}',
                    key: const Key('route-summary'),
                    style: theme.textTheme.titleLarge,
                  ),
                ),
                IconButton(
                  tooltip: 'Cerrar ruta',
                  icon: const Icon(Icons.close),
                  onPressed: onClose,
                ),
              ],
            ),
            Text(
              'Llegada ${TimeOfDay.fromDateTime(arrival).format(context)} · ${_sourceLabel(result, option)}',
              style: theme.textTheme.bodySmall,
            ),
            if (option.hasTolls || option.hasFerry)
              Text(
                [
                  if (option.hasTolls) 'Incluye peajes',
                  if (option.hasFerry) 'Incluye ferry',
                ].join(' · '),
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error),
              ),
            const SizedBox(height: 8),
            _ProfileSelector(selected: state.profile, onChanged: onProfileChanged),
            if (result.routes.length > 1) ...[
              const SizedBox(height: 8),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    for (var i = 0; i < result.routes.length; i++)
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                          key: Key('route-option-$i'),
                          selected: i == state.selectedRoute,
                          label: Text(
                            '${i == 0 ? 'Principal' : 'Alternativa $i'}: '
                            '${formatDuration(result.routes[i].durationSeconds)} · '
                            '${formatDistance(result.routes[i].distanceMeters)}',
                          ),
                          onSelected: (_) => onSelectRoute(i),
                        ),
                      ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 4),
            Wrap(
              spacing: 8,
              children: [
                TextButton.icon(
                  onPressed: option.steps.isEmpty ? null : onShowSteps,
                  icon: const Icon(Icons.list),
                  label: const Text('Indicaciones'),
                ),
                TextButton.icon(
                  onPressed: option.savedRouteId == null ? onSave : null,
                  icon: Icon(
                    option.savedRouteId == null ? Icons.bookmark_add : Icons.bookmark_added,
                  ),
                  label: Text(option.savedRouteId == null ? 'Guardar' : 'Guardada'),
                ),
                FilledButton.icon(
                  onPressed: onStartTrip,
                  icon: const Icon(Icons.fiber_manual_record),
                  label: const Text('Iniciar recorrido'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  static String _sourceLabel(RouteResult result, RouteOption option) => switch (result.source) {
    RouteSource.server => 'Calculada en el servidor (${result.provider})',
    RouteSource.savedRoute =>
      'Ruta guardada «${option.savedRouteName ?? ''}», disponible sin conexión',
    RouteSource.onDevice => 'Calculada en el dispositivo (${result.provider})',
  };
}

class _ProfileSelector extends StatelessWidget {
  const _ProfileSelector({required this.selected, required this.onChanged});

  final RoutingProfile selected;
  final ValueChanged<RoutingProfile> onChanged;

  static const _icons = {
    RoutingProfile.car: Icons.directions_car,
    RoutingProfile.motorcycle: Icons.two_wheeler,
    RoutingProfile.truck: Icons.local_shipping,
    RoutingProfile.bicycle: Icons.directions_bike,
    RoutingProfile.pedestrian: Icons.directions_walk,
  };

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final profile in RoutingProfile.values)
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: ChoiceChip(
                avatar: Icon(_icons[profile], size: 18),
                label: Text(profile.label),
                selected: profile == selected,
                onSelected: (_) => onChanged(profile),
              ),
            ),
        ],
      ),
    );
  }
}
