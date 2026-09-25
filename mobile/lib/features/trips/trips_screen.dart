import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/utils/formatters.dart';
import '../../domain/entities/trip.dart';
import '../../presentation/providers.dart';

/// Recorded trips, stored on the device and synchronized in the background.
class TripsScreen extends ConsumerWidget {
  const TripsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final trips = ref.watch(tripsProvider);
    final recording = ref.watch(recordingProvider).value;
    return Scaffold(
      appBar: AppBar(title: const Text('Mis recorridos')),
      body: switch (trips) {
        AsyncValue(:final value?) when value.isEmpty => const Center(
          child: Padding(
            padding: EdgeInsets.all(32),
            child: Text(
              'Aún no grabaste recorridos. Calcula una ruta y pulsa «Iniciar recorrido».',
              textAlign: TextAlign.center,
            ),
          ),
        ),
        AsyncValue(:final value?) => ListView.separated(
          itemCount: value.length,
          separatorBuilder: (_, _) => const Divider(height: 1),
          itemBuilder: (context, index) {
            final trip = value[index];
            final isRecording = recording?.trip?.id == trip.id;
            return ListTile(
              leading: Icon(_icon(trip.status), color: isRecording ? Colors.red : null),
              title: Text(trip.name ?? 'Recorrido ${trip.profile.label.toLowerCase()}'),
              subtitle: Text(
                '${formatDateTime(trip.startedAt)} · ${formatDistance(trip.distanceMeters)} · '
                '${trip.pointCount} puntos\n${_statusLabel(trip, isRecording)}',
              ),
              isThreeLine: true,
              trailing: isRecording
                  ? TextButton(
                      onPressed: () => ref.read(tripRecorderProvider).finish(),
                      child: const Text('Finalizar'),
                    )
                  : null,
            );
          },
        ),
        AsyncValue(:final error?) => Center(
          child: Text('No se pudieron leer los recorridos: $error'),
        ),
        _ => const Center(child: CircularProgressIndicator()),
      },
    );
  }

  static IconData _icon(TripStatus status) => switch (status) {
    TripStatus.active => Icons.fiber_manual_record,
    TripStatus.completed => Icons.check_circle_outline,
    TripStatus.cancelled => Icons.cancel_outlined,
  };

  static String _statusLabel(Trip trip, bool isRecording) {
    if (isRecording) return 'Grabando';
    return switch (trip.status) {
      TripStatus.active => 'Activo',
      TripStatus.completed =>
        'Finalizado${trip.endedAt == null ? '' : ' · ${formatElapsed(trip.endedAt!.difference(trip.startedAt))}'}',
      TripStatus.cancelled => 'Cancelado',
    };
  }
}
