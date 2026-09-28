/**
 * Loads the national graph and search index built by the data pipeline and measures memory, route
 * and search times on real places. Development tool:
 *
 *   npx tsx scripts/bench-native.ts ../storage/imports/native/ecuador
 */
import { join } from 'node:path';
import { NativeGraph } from '../src/infrastructure/native/native-graph';
import { NativeSearchIndex } from '../src/infrastructure/native/native-search';
import { NativeRouter } from '../src/modules/routing/infrastructure/native/native-router';
import { RoutingProfile } from '../src/modules/routing/domain/value-objects/routing-profile';

const directory = process.argv[2] ?? '../storage/imports/native/ecuador';
const mb = () => Math.round(process.memoryUsage().rss / 1024 / 1024);

async function main() {
  let started = Date.now();
  const graph = await NativeGraph.load(join(directory, 'graph.bin'));
  console.log(
    `graph: ${graph.nodeCount} nodes, ${graph.edgeCount} edges in ${Date.now() - started} ms, rss ${mb()} MB`,
  );
  started = Date.now();
  const index = await NativeSearchIndex.load(join(directory, 'search.ndjson'));
  console.log(`search: ${index.size} entries in ${Date.now() - started} ms, rss ${mb()} MB`);
  const router = new NativeRouter(graph);
  const cases: [string, RoutingProfile, number, number, number, number][] = [
    ['Guayaquil: Malecón del Salado -> Terminal', 'CAR', -2.1897, -79.8963, -2.1419, -79.8862],
    ['Guayaquil -> Quito', 'CAR', -2.1709, -79.9224, -0.1807, -78.4678],
    ['Quito -> Cuenca', 'CAR', -0.1807, -78.4678, -2.9005, -79.0045],
    ['Guayaquil -> Latacunga', 'CAR', -2.1709, -79.9224, -0.9336, -78.6155],
    ['Quito -> El Coca', 'CAR', -0.1807, -78.4678, -0.4623, -76.9876],
    ['Manta -> Portoviejo', 'CAR', -0.9677, -80.7089, -1.0546, -80.4545],
    ['Quito -> Tumbaco', 'CAR', -0.2002, -78.4891, -0.2123, -78.4011],
    ['Machala -> Huaquillas', 'CAR', -3.2581, -79.9554, -3.4757, -80.2308],
    // The E30 of the state layer stops before Pelileo: a loose-end link must avoid a 130 km detour.
    ['Ambato -> Baños', 'CAR', -1.2491, -78.6167, -1.3964, -78.4247],
    ['Guayaquil a pie', 'PEDESTRIAN', -2.1961, -79.8862, -2.1894, -79.887],
    ['Tulcán -> Macará', 'CAR', 0.8117, -77.7173, -4.3811, -79.9437],
  ];
  for (const [label, profile, lat1, lon1, lat2, lon2] of cases) {
    started = Date.now();
    try {
      const { primary, alternatives } = router.route(
        profile,
        [
          { latitude: lat1, longitude: lon1 },
          { latitude: lat2, longitude: lon2 },
        ],
        profile === 'CAR' ? 2 : 0,
      );
      const approximate = (primary.approximateSections ?? []).reduce(
        (s, x) => s + x.distanceMeters,
        0,
      );
      console.log(
        `${label}: ${(primary.distanceMeters / 1000).toFixed(1)} km, ${Math.round(primary.durationSeconds / 60)} min, ` +
          `${primary.steps.length} steps, ${alternatives.length} alt, approx ${approximate} m, ${Date.now() - started} ms`,
      );
      console.log(
        `   ${primary.steps
          .slice(0, 4)
          .map((s) => s.instruction)
          .join(' | ')}`,
      );
    } catch (error) {
      console.log(`${label}: ERROR ${(error as Error).message} (${Date.now() - started} ms)`);
    }
  }
  for (const [text, lat, lon] of [
    ['terminal terrestre', -2.19, -79.89],
    ['malecon del salado', -2.19, -79.89],
    ['malecon simon bolivar', -2.19, -79.89],
    ['quitumbe', -0.22, -78.5],
    ['mall del rio', -2.9, -79.0],
    ['hospitales', -1.05, -80.45],
    ['latacunga', -1.0, -78.6],
  ] as [string, number, number][]) {
    started = Date.now();
    const hits = index.search(text, { limit: 3, near: { latitude: lat, longitude: lon } });
    console.log(
      `search '${text}' (${Date.now() - started} ms): ${hits.map((h) => `${h.name} [${h.detail}]`).join(' ; ')}`,
    );
  }
  console.log(
    `rss ${mb()} MB, heap ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`,
  );
}

void main();
