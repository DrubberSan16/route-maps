import 'package:flutter/material.dart';

import '../map_controller.dart';

/// Stops of the route, numbered like their markers on the map, each with a
/// button to remove it, and the action to add another one.
class StopsList extends StatelessWidget {
  const StopsList({
    super.key,
    required this.stops,
    required this.onAdd,
    required this.onRemove,
    this.enabled = true,
  });

  final List<RouteStop> stops;
  final VoidCallback onAdd;
  final ValueChanged<int> onRemove;

  /// False while a route is being calculated.
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final canAdd = enabled && stops.length < MapController.maxStops;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < stops.length; i++)
          Row(
            children: [
              StopBadge(number: i + 1),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  stops[i].label,
                  style: theme.textTheme.bodyMedium,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              IconButton(
                tooltip: 'Quitar parada ${i + 1}',
                icon: const Icon(Icons.close, size: 20),
                onPressed: enabled ? () => onRemove(i) : null,
              ),
            ],
          ),
        TextButton.icon(
          onPressed: canAdd ? onAdd : null,
          icon: const Icon(Icons.add_location_alt_outlined),
          label: const Text('Añadir parada'),
        ),
      ],
    );
  }
}

/// Number of a stop, drawn like its marker on the map.
class StopBadge extends StatelessWidget {
  const StopBadge({super.key, required this.number});

  final int number;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      width: 22,
      height: 22,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: colors.primary, shape: BoxShape.circle),
      child: Text(
        '$number',
        style: TextStyle(color: colors.onPrimary, fontSize: 12, fontWeight: FontWeight.w700),
      ),
    );
  }
}
