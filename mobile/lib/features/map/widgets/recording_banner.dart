import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/utils/formatters.dart';
import '../../../domain/entities/trip.dart';

/// Shown while a trip is being recorded.
class RecordingBanner extends StatefulWidget {
  const RecordingBanner({super.key, required this.trip, required this.onFinish});

  final Trip trip;
  final VoidCallback onFinish;

  @override
  State<RecordingBanner> createState() => _RecordingBannerState();
}

class _RecordingBannerState extends State<RecordingBanner> {
  late final Timer _ticker;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) => setState(() {}));
  }

  @override
  void dispose() {
    _ticker.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final elapsed = DateTime.now().toUtc().difference(widget.trip.startedAt);
    return Material(
      color: scheme.errorContainer,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 4, 4, 4),
        child: Row(
          children: [
            Icon(Icons.fiber_manual_record, color: scheme.error, size: 16),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'Grabando recorrido · ${formatElapsed(elapsed)} · '
                '${formatDistance(widget.trip.distanceMeters)}',
                style: TextStyle(color: scheme.onErrorContainer),
              ),
            ),
            TextButton(onPressed: widget.onFinish, child: const Text('Finalizar')),
          ],
        ),
      ),
    );
  }
}
