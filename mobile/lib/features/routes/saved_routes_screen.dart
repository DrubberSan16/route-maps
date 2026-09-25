import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/utils/formatters.dart';
import '../../domain/entities/offline_route.dart';
import '../../presentation/providers.dart';

/// Routes stored on the device: they can be opened on the map and followed
/// without connection. Returns the chosen route to the caller.
class SavedRoutesScreen extends ConsumerWidget {
  const SavedRoutesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final routes = ref.watch(savedRoutesProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Rutas guardadas')),
      body: switch (routes) {
        AsyncValue(:final value?) when value.isEmpty => const Center(
          child: Padding(
            padding: EdgeInsets.all(32),
            child: Text(
              'Aún no guardaste rutas. Calcula una ruta y pulsa «Guardar» para tenerla '
              'disponible sin conexión.',
              textAlign: TextAlign.center,
            ),
          ),
        ),
        AsyncValue(:final value?) => ListView.separated(
          itemCount: value.length,
          separatorBuilder: (_, _) => const Divider(height: 1),
          itemBuilder: (context, index) => _RouteTile(route: value[index]),
        ),
        AsyncValue(:final error?) => Center(child: Text('No se pudieron leer las rutas: $error')),
        _ => const Center(child: CircularProgressIndicator()),
      },
    );
  }
}

class _RouteTile extends ConsumerWidget {
  const _RouteTile({required this.route});

  final OfflineRoute route;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListTile(
      key: Key('saved-route-${route.routeId}'),
      leading: const Icon(Icons.route),
      title: Text(route.name),
      subtitle: Text(
        '${route.profile.label} · ${formatDistance(route.distanceMeters)} · '
        '${formatDuration(route.durationSeconds)}\nGuardada ${formatDateTime(route.createdAt)}',
      ),
      isThreeLine: true,
      onTap: () => Navigator.pop(context, route),
      trailing: IconButton(
        tooltip: 'Eliminar',
        icon: const Icon(Icons.delete_outline),
        onPressed: () => _confirmDelete(context, ref),
      ),
    );
  }

  Future<void> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('¿Eliminar «${route.name}»?'),
        content: const Text('También se eliminará de tu cuenta en la próxima sincronización.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Eliminar'),
          ),
        ],
      ),
    );
    if (confirmed == true) await ref.read(savedRouteRepositoryProvider).delete(route.routeId);
  }
}
