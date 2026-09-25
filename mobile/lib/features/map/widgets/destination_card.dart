import 'package:flutter/material.dart';

import '../map_controller.dart';

/// Chosen destination (and origin, when it is not the current position)
/// before the route is calculated.
class DestinationCard extends StatelessWidget {
  const DestinationCard({
    super.key,
    required this.state,
    required this.onRoute,
    required this.onClear,
    required this.onResetOrigin,
  });

  final MapViewState state;
  final VoidCallback onRoute;
  final VoidCallback onClear;
  final VoidCallback onResetOrigin;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
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
                const Icon(Icons.place, color: Color(0xFFD93025)),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    state.destinationLabel ?? '',
                    style: theme.textTheme.titleMedium,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                IconButton(
                  tooltip: 'Quitar destino',
                  icon: const Icon(Icons.close),
                  onPressed: onClear,
                ),
              ],
            ),
            Row(
              children: [
                const Icon(Icons.trip_origin, size: 18, color: Color(0xFF188038)),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    state.origin == null ? 'Desde mi ubicación' : 'Desde ${state.originLabel}',
                    style: theme.textTheme.bodyMedium,
                  ),
                ),
                if (state.origin != null)
                  TextButton(onPressed: onResetOrigin, child: const Text('Usar mi ubicación')),
              ],
            ),
            const SizedBox(height: 4),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton.icon(
                onPressed: state.isRouting ? null : onRoute,
                icon: state.isRouting
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.directions),
                label: const Text('Trazar ruta'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
