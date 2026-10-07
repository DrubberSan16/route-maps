import 'package:flutter/material.dart';

/// A source of the map, in the words of the citation its licence asks for,
/// and what the platform takes from it.
typedef DataSource = ({String citation, String use});

/// The sources of the map, search and routes: the same list as the web
/// viewer's "Fuentes de datos" page (infrastructure/nginx/html/fuentes.html).
const dataSources = <DataSource>[
  (
    citation:
        'Fuente: INSTITUTO NACIONAL DE ESTADÍSTICA Y CENSOS – INEC; Marco Geoestadístico '
        'Nacional; 2026; GeoPackage; Quito, Ecuador.',
    use:
        'Ejes viales, manzanas, edificaciones, áreas amanzanadas, localidades y malla de '
        'población.',
  ),
  (
    citation: 'Ministerio de Transporte y Obras Públicas, Red Vial Estatal.',
    use: 'Carreteras entre ciudades y su numeración.',
  ),
  (
    citation: 'Comité Nacional de Límites Internos (CONALI), organización territorial 2026.',
    use: 'Límites de provincias, cantones y parroquias.',
  ),
  (
    citation: 'Ministerio de Salud Pública, establecimientos de salud 2023.',
    use: 'Hospitales, centros y puestos de salud.',
  ),
  (
    citation: 'Ministerio de Educación, instituciones educativas.',
    use: 'Escuelas, colegios y unidades educativas.',
  ),
  (
    citation: 'Ministerio de Turismo, inventario de atractivos turísticos 2024.',
    use: 'Atractivos naturales y culturales.',
  ),
  (
    citation: 'Secretaría Nacional de Gestión de Riesgos.',
    use: 'Servicios de publicación de las capas nacionales y la hidrografía.',
  ),
  (
    citation: 'Instituto Nacional de Meteorología e Hidrología (INAMHI).',
    use: 'Regiones de precipitación y de temperatura (climatología).',
  ),
  (
    citation: 'GAD Municipal de Guayaquil y Municipio del Distrito Metropolitano de Quito.',
    use: 'Cooperativas, urbanizaciones y parroquias urbanas.',
  ),
  (
    citation:
        'ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) '
        'processed by ESA WorldCover consortium.',
    use:
        'Vista satélite: compuestos Sentinel-2 sin nubes de 10 m (2021, completados con 2020). '
        'Licencia CC BY 4.0.',
  ),
  (
    citation:
        'Copernicus DEM GLO-30 © DLR e.V. 2010-2014 y © Airbus Defence and Space GmbH '
        '2014-2018, provisto por COPERNICUS de la Unión Europea y la ESA.',
    use: 'Relieve: altura de la superficie cada ~30 m (incluye edificios y vegetación).',
  ),
  (citation: 'Natural Earth.', use: 'Mapa base mundial (dominio público).'),
];

/// Bottom sheet with the sources of the map and their citations, also
/// without connection.
class DataSourcesSheet extends StatelessWidget {
  const DataSourcesSheet({super.key});

  static Future<void> show(BuildContext context) => showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (_) => const DataSourcesSheet(),
  );

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.6,
      maxChildSize: 0.9,
      builder: (context, scroll) => SafeArea(
        child: ListView(
          controller: scroll,
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          children: [
            Text('Fuentes de datos', style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(
              'El mapa, las búsquedas y las rutas se generan en esta plataforma a partir de '
              'información geográfica pública del Estado ecuatoriano y de programas abiertos de '
              'observación de la Tierra. Estas son las fuentes y sus citas oficiales.',
              style: muted,
            ),
            for (final source in dataSources) ...[
              const SizedBox(height: 14),
              Text(source.citation, style: theme.textTheme.titleSmall),
              const SizedBox(height: 2),
              Text(source.use, style: muted),
            ],
            const SizedBox(height: 18),
            Text(
              'El tráfico, en vivo y habitual, y la actividad provienen únicamente de recorridos '
              'anónimos registrados con esta aplicación; sin datos suficientes no se muestra '
              'congestión. La cartografía censal no tiene precisión métrica ni determina límites '
              'oficiales.',
              style: muted,
            ),
          ],
        ),
      ),
    );
  }
}
