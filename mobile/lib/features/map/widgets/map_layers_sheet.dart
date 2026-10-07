import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../domain/services/connectivity_service.dart';
import '../../../presentation/providers.dart';
import '../../../presentation/theme.dart';
import '../../../services/map/map_style_service.dart';
import '../map_layers_controller.dart';

/// Thumbnail of each map type (the same images as the web viewer).
String mapTypeThumbnail(String mapType) => switch (mapType) {
  MapTypeOption.satellite => 'assets/images/map-type-satellite.webp',
  MapTypeOption.relief => 'assets/images/map-type-relief.webp',
  _ => 'assets/images/map-type-map.webp',
};

/// The map type drawn: the preferred one where the map has its data.
String effectiveMapType(String preferred, List<MapTypeOption> options) =>
    options.any((option) => option.id == preferred && option.available)
    ? preferred
    : MapTypeOption.map;

typedef LegendEntry = (Color color, String label);

/// A detail that can be drawn over the map.
class LayerOption {
  const LayerOption({
    required this.id,
    required this.label,
    required this.icon,
    required this.legend,
    required this.note,
  });

  final String id;
  final String label;
  final IconData icon;
  final List<LegendEntry> legend;
  final String note;
}

const trafficLayerId = 'traffic';

const trafficLegend = <LegendEntry>[
  (BrandColors.trafficFree, 'Sin demoras'),
  (BrandColors.trafficModerate, 'Moderado'),
  (BrandColors.trafficSlow, 'Lento'),
  (BrandColors.trafficJammed, 'Detenido'),
];

/// Same options, legends and notes as the web viewer.
const layerOptions = [
  LayerOption(
    id: trafficLayerId,
    label: 'Tráfico',
    icon: Icons.traffic,
    legend: trafficLegend,
    note:
        'Vías principales en verde mientras no haya demoras reportadas. Los tramos medidos por '
        'los recorridos de la app se colorean en vivo (15 min) o, más tenues, con lo habitual a '
        'esta hora.',
  ),
  LayerOption(
    id: MapOverlays.precipitation,
    label: 'Lluvia',
    icon: Icons.water_drop_outlined,
    legend: [
      (Color(0xFFFFF4D6), '< 500 mm'),
      (Color(0xFFC2E3C4), '1000–2000 mm'),
      (Color(0xFF5AAED8), '3000–4000 mm'),
      (Color(0xFF2C4F9E), '> 4000 mm'),
    ],
    note: 'Regiones de precipitación anual (climatología oficial).',
  ),
  LayerOption(
    id: MapOverlays.temperature,
    label: 'Clima',
    icon: Icons.thermostat,
    legend: [
      (Color(0xFFDCD6F7), 'Muy frío'),
      (Color(0xFFCDEEE0), 'Templado frío'),
      (Color(0xFFF6F2C2), 'Templado'),
      (Color(0xFFF7A88C), 'Cálido'),
    ],
    note: 'Termotipos por altitud (climatología oficial).',
  ),
  LayerOption(
    id: MapOverlays.population,
    label: 'Población',
    icon: Icons.groups_outlined,
    legend: [
      (Color(0xFF67A9CF), 'Baja'),
      (Color(0xFFFDDBC7), 'Media'),
      (Color(0xFFB2182B), 'Alta'),
    ],
    note: 'Mapa de calor de la malla censal de 1 km².',
  ),
];

/// Bottom sheet to choose the map type ("Mapa", "Satélite", "Relieve") and
/// the details drawn on top. Every change applies at once.
class MapLayersSheet extends ConsumerWidget {
  const MapLayersSheet({super.key});

  static Future<void> show(BuildContext context) => showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (_) => const MapLayersSheet(),
  );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final layers = ref.watch(mapLayersProvider).value ?? const MapLayers();
    final options =
        ref.watch(mapTypeOptionsProvider).value ??
        const [MapTypeOption(id: MapTypeOption.map, label: 'Mapa', available: true)];
    final offline = ref.watch(connectivityStatusProvider).value == ConnectivityStatus.offline;
    final overlaysAvailable = ref.watch(overlaysAvailableProvider).value ?? true;
    final controller = ref.read(mapLayersProvider.notifier);
    final current = effectiveMapType(layers.mapType, options);
    final unavailableReason = offline ? 'Necesita conexión' : 'Sin datos en esta zona';
    bool isOn(String id) => id == trafficLayerId ? layers.traffic : layers.overlays.contains(id);
    // The choice of an overlay is kept while its data is missing, but not shown.
    bool canShow(String id) => id == trafficLayerId || overlaysAvailable;
    final active = [
      for (final option in layerOptions)
        if (isOn(option.id) && canShow(option.id)) option,
    ];

    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Tipo de mapa', style: theme.textTheme.titleMedium),
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final option in options)
                  Expanded(
                    child: _MapTypeTile(
                      option: option,
                      selected: option.id == current,
                      unavailableReason: unavailableReason,
                      onTap: () => controller.setMapType(option.id),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 24),
            Text('Detalles del mapa', style: theme.textTheme.titleMedium),
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final option in layerOptions)
                  Expanded(
                    child: _LayerTile(
                      option: option,
                      selected: isOn(option.id) && canShow(option.id),
                      available: canShow(option.id),
                      unavailableReason: unavailableReason,
                      onTap: () => option.id == trafficLayerId
                          ? controller.setTraffic(!layers.traffic)
                          : controller.setOverlay(option.id, !isOn(option.id)),
                    ),
                  ),
              ],
            ),
            for (final option in active) ...[
              const SizedBox(height: 16),
              Text(option.label, style: theme.textTheme.titleSmall),
              const SizedBox(height: 6),
              LegendRow(entries: option.legend),
              const SizedBox(height: 4),
              Text(
                option.note,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _MapTypeTile extends StatelessWidget {
  const _MapTypeTile({
    required this.option,
    required this.selected,
    required this.unavailableReason,
    required this.onTap,
  });

  final MapTypeOption option;
  final bool selected;
  final String unavailableReason;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Semantics(
      button: true,
      selected: selected,
      enabled: option.available,
      child: Opacity(
        opacity: option.available ? 1 : 0.45,
        child: InkWell(
          key: Key('map-type-${option.id}'),
          borderRadius: BorderRadius.circular(16),
          onTap: option.available ? onTap : null,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
            child: Column(
              children: [
                AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  padding: const EdgeInsets.all(3),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(
                      color: selected ? scheme.primary : Colors.transparent,
                      width: 2.5,
                    ),
                  ),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(13),
                    child: Image.asset(
                      mapTypeThumbnail(option.id),
                      width: 76,
                      height: 76,
                      fit: BoxFit.cover,
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  option.label,
                  textAlign: TextAlign.center,
                  style: theme.textTheme.labelLarge?.copyWith(
                    color: selected ? scheme.primary : scheme.onSurface,
                  ),
                ),
                if (!option.available)
                  Text(
                    unavailableReason,
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _LayerTile extends StatelessWidget {
  const _LayerTile({
    required this.option,
    required this.selected,
    required this.available,
    required this.unavailableReason,
    required this.onTap,
  });

  final LayerOption option;
  final bool selected;
  final bool available;
  final String unavailableReason;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Semantics(
      toggled: selected,
      enabled: available,
      child: Opacity(
        opacity: available ? 1 : 0.45,
        child: InkWell(
          key: Key('layer-${option.id}'),
          borderRadius: BorderRadius.circular(16),
          onTap: available ? onTap : null,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Column(
              children: [
                AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  width: 56,
                  height: 56,
                  decoration: BoxDecoration(
                    color: selected ? scheme.primaryContainer : scheme.surfaceContainer,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: selected ? scheme.primary : Colors.transparent,
                      width: 2,
                    ),
                  ),
                  child: Icon(
                    option.icon,
                    color: selected ? scheme.primary : scheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  option.label,
                  textAlign: TextAlign.center,
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: selected ? scheme.primary : scheme.onSurface,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (!available)
                  Text(
                    unavailableReason,
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Colour dots with their meaning.
class LegendRow extends StatelessWidget {
  const LegendRow({super.key, required this.entries});

  final List<LegendEntry> entries;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodySmall;
    return Wrap(
      spacing: 12,
      runSpacing: 4,
      children: [
        for (final (color, label) in entries)
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 12,
                height: 12,
                decoration: BoxDecoration(
                  color: color,
                  shape: BoxShape.circle,
                  border: Border.all(color: const Color(0x330F172A)),
                ),
              ),
              const SizedBox(width: 4),
              Text(label, style: style),
            ],
          ),
      ],
    );
  }
}
