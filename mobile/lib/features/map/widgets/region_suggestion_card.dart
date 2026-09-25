import 'package:flutter/material.dart';

import '../../../core/utils/formatters.dart';
import '../../../domain/entities/map_region.dart';

/// Offers the region around the user when it is not stored on the device.
class RegionSuggestionCard extends StatelessWidget {
  const RegionSuggestionCard({
    super.key,
    required this.region,
    required this.onDownload,
    required this.onDismiss,
    this.task,
  });

  final MapRegion region;

  /// Download in progress, paused or failed for this region.
  final RegionDownloadTask? task;
  final VoidCallback onDownload;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final task = this.task;
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
                    'No tienes descargado el mapa de esta región.',
                    style: theme.textTheme.bodyMedium,
                  ),
                ),
                IconButton(
                  tooltip: 'Ahora no',
                  icon: const Icon(Icons.close),
                  onPressed: onDismiss,
                ),
              ],
            ),
            Row(
              children: [
                Expanded(
                  child: Text(
                    '${region.name}   ${formatBytes(region.mapSizeBytes)}',
                    style: theme.textTheme.titleMedium,
                  ),
                ),
                if (task?.status == RegionDownloadStatus.downloading)
                  Text(formatPercent(task!.progress))
                else
                  FilledButton(
                    onPressed: onDownload,
                    child: Text(task == null ? 'Descargar' : 'Reanudar'),
                  ),
              ],
            ),
            if (task != null) ...[
              const SizedBox(height: 8),
              LinearProgressIndicator(value: task.progress),
            ],
          ],
        ),
      ),
    );
  }
}
