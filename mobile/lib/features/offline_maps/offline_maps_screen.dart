import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/utils/formatters.dart';
import '../../domain/entities/map_region.dart';
import '../../presentation/providers.dart';
import '../../presentation/widgets/connection_banner.dart';
import '../../services/regions/region_download_service.dart';
import 'offline_maps_controller.dart';

/// Regions stored on the device and regions available on the server, with
/// download progress, pause/resume, updates and deletion.
class OfflineMapsScreen extends ConsumerWidget {
  const OfflineMapsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final catalogState = ref.watch(catalogControllerProvider);
    final catalog = ref.watch(catalogProvider).value ?? const <MapRegion>[];
    final downloaded = ref.watch(downloadedRegionsProvider).value ?? const <DownloadedRegion>[];
    final tasks = ref.watch(downloadTasksProvider).value ?? const <String, RegionDownloadTask>{};
    final online = ref.watch(isOnlineProvider);
    final freeBytes = ref.watch(freeSpaceProvider).value;

    final downloadedCodes = {for (final region in downloaded) region.code};
    final available = [
      for (final region in catalog)
        if (!downloadedCodes.contains(region.code)) region,
    ];
    final catalogByCode = {for (final region in catalog) region.code: region};

    return Scaffold(
      appBar: AppBar(
        title: const Text('Mapas offline'),
        actions: [
          IconButton(
            tooltip: 'Actualizar lista',
            onPressed: online && !catalogState.isRefreshing
                ? () => ref.read(catalogControllerProvider.notifier).refresh()
                : null,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: Column(
        children: [
          const ConnectionBanner(
            message:
                'Sin conexión: tus mapas descargados siguen funcionando. '
                'Para descargar necesitas Internet.',
          ),
          if (catalogState.isRefreshing) const LinearProgressIndicator(),
          Expanded(
            child: RefreshIndicator(
              onRefresh: ref.read(catalogControllerProvider.notifier).refresh,
              child: ListView(
                padding: const EdgeInsets.only(bottom: 24),
                children: [
                  if (catalogState.error case final error?)
                    ListTile(
                      leading: const Icon(Icons.error_outline),
                      title: Text('No se pudo actualizar la lista: $error'),
                    ),
                  if (freeBytes != null)
                    ListTile(
                      dense: true,
                      leading: const Icon(Icons.sd_storage),
                      title: Text('Espacio libre: ${formatBytes(freeBytes)}'),
                    ),
                  const _SectionHeader('En este dispositivo'),
                  if (downloaded.isEmpty)
                    const ListTile(
                      title: Text('Todavía no descargaste ningún mapa.'),
                      subtitle: Text('Descarga una región para usar el mapa sin conexión.'),
                    ),
                  for (final region in downloaded)
                    _DownloadedRegionTile(
                      region: region,
                      latest: catalogByCode[region.code],
                      task: tasks[region.code],
                      online: online,
                    ),
                  const _SectionHeader('Disponibles para descargar'),
                  if (available.isEmpty)
                    ListTile(
                      title: Text(
                        catalog.isEmpty && !online
                            ? 'Conéctate para ver las regiones disponibles.'
                            : catalog.isEmpty
                            ? 'El servidor todavía no publica regiones.'
                            : 'Ya tienes todas las regiones disponibles.',
                      ),
                    ),
                  for (final region in available)
                    _AvailableRegionTile(region: region, task: tasks[region.code], online: online),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DownloadedRegionTile extends ConsumerWidget {
  const _DownloadedRegionTile({
    required this.region,
    required this.latest,
    required this.task,
    required this.online,
  });

  final DownloadedRegion region;

  /// Catalog entry, with the newest version published.
  final MapRegion? latest;

  /// Download of a newer version, if one was started.
  final RegionDownloadTask? task;
  final bool online;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final latest = this.latest;
    final canUpdate = region.updateAvailable && latest != null && latest.version != region.version;
    return Card(
      key: Key('downloaded-${region.code}'),
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 8, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(region.name, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            const Text('Descargado'),
            Text('Versión ${region.version} · ${formatBytes(region.sizeBytes)}'),
            if (canUpdate && task == null)
              Text(
                'Nueva versión disponible: ${latest.version} (${formatBytes(latest.mapSizeBytes)})',
                style: TextStyle(color: Theme.of(context).colorScheme.primary),
              ),
            if (task case final task?) _TaskProgress(task: task),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                if (task case final task?)
                  ..._taskActions(context, ref, task, latest, online)
                else if (canUpdate)
                  TextButton(
                    onPressed: online ? () => _download(context, ref, latest) : null,
                    child: const Text('Actualizar'),
                  ),
                TextButton(
                  onPressed: () => _confirmDelete(context, ref),
                  child: const Text('Eliminar'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('¿Eliminar el mapa de ${region.name}?'),
        content: Text(
          'Liberarás ${formatBytes(region.sizeBytes)}. Sin este mapa la zona no se verá sin '
          'conexión; podrás descargarlo otra vez cuando quieras.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Eliminar'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await ref.read(regionDownloadServiceProvider).deleteRegion(region);
  }
}

class _AvailableRegionTile extends ConsumerWidget {
  const _AvailableRegionTile({required this.region, required this.task, required this.online});

  final MapRegion region;
  final RegionDownloadTask? task;
  final bool online;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final task = this.task;
    return Card(
      key: Key('available-${region.code}'),
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 8, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text(region.name, style: Theme.of(context).textTheme.titleMedium)),
                Text(formatBytes(region.mapSizeBytes)),
              ],
            ),
            Text(
              [region.city, region.province, region.country].whereType<String>().join(', '),
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (task != null) _TaskProgress(task: task),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                if (task != null)
                  ..._taskActions(context, ref, task, region, online)
                else
                  FilledButton(
                    onPressed: online ? () => _download(context, ref, region) : null,
                    child: const Text('Descargar'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _TaskProgress extends StatelessWidget {
  const _TaskProgress({required this.task});

  final RegionDownloadTask task;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final status = switch (task.status) {
      RegionDownloadStatus.downloading => formatPercent(task.progress),
      RegionDownloadStatus.paused => 'En pausa · ${formatPercent(task.progress)}',
      RegionDownloadStatus.failed => 'Error · ${formatPercent(task.progress)}',
    };
    return Padding(
      padding: const EdgeInsets.only(top: 8, right: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(status, key: Key('task-status-${task.code}'))),
              Text('${formatBytes(task.receivedBytes)} / ${formatBytes(task.totalBytes)}'),
            ],
          ),
          const SizedBox(height: 4),
          LinearProgressIndicator(value: task.progress),
          if (task.errorMessage case final message?)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(message, style: TextStyle(color: theme.colorScheme.error)),
            ),
        ],
      ),
    );
  }
}

List<Widget> _taskActions(
  BuildContext context,
  WidgetRef ref,
  RegionDownloadTask task,
  MapRegion? region,
  bool online,
) {
  final service = ref.read(regionDownloadServiceProvider);
  return switch (task.status) {
    // Cancelling keeps the downloaded part, so the download can resume.
    RegionDownloadStatus.downloading => [
      TextButton(onPressed: () => service.pause(task.code), child: const Text('Cancelar')),
    ],
    RegionDownloadStatus.paused || RegionDownloadStatus.failed => [
      TextButton(onPressed: () => service.discard(task.code), child: const Text('Descartar')),
      FilledButton(
        onPressed: online && region != null ? () => _download(context, ref, region) : null,
        child: Text(task.status == RegionDownloadStatus.failed ? 'Reintentar' : 'Reanudar'),
      ),
    ],
  };
}

Future<void> _download(BuildContext context, WidgetRef ref, MapRegion region) async {
  final messenger = ScaffoldMessenger.of(context);
  final result = await ref.read(regionDownloadServiceProvider).download(region);
  if (result == RegionDownloadResult.completed) {
    messenger.showSnackBar(
      SnackBar(content: Text('Mapa de ${region.name} descargado. Ya funciona sin conexión.')),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 20, 16, 4),
    child: Text(text, style: Theme.of(context).textTheme.titleSmall),
  );
}
