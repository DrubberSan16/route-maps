import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/services/connectivity_service.dart';
import '../providers.dart';

/// Tells the user when the platform cannot be reached (only after the first
/// check, so the app does not flash "offline" while starting).
class ConnectionBanner extends ConsumerWidget {
  const ConnectionBanner({super.key, this.message});

  /// What still works without connection on this screen.
  final String? message;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(connectivityStatusProvider).value;
    if (status != ConnectivityStatus.offline) return const SizedBox.shrink();
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.tertiaryContainer,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Row(
          children: [
            Icon(Icons.cloud_off, size: 18, color: scheme.onTertiaryContainer),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                message ?? 'Sin conexión con el servidor.',
                style: TextStyle(color: scheme.onTertiaryContainer),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
