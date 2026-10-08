/**
 * Writes the offline parity fixture (graph.bin, search.ndjson, expected.json) and the mobile app's
 * fold table, and rebuilds the offline packs the app's tests read (FIXTURE_PACKS) with the data
 * tools. Run it after changing the native engines or the fixture city:
 *
 *   npm run fixtures:offline
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FIXTURE_DIR,
  FIXTURE_PACKS,
  FOLD_TABLE_FILE,
  buildFixtureFiles,
  foldTable,
} from '../src/testing/offline-parity/expectations';

async function main() {
  const files = await buildFixtureFiles();
  mkdirSync(FIXTURE_DIR, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(FIXTURE_DIR, name), content);
    console.log(`wrote ${join(FIXTURE_DIR, name)}`);
  }
  writeFileSync(FOLD_TABLE_FILE, foldTable());
  console.log(`wrote ${FOLD_TABLE_FILE}`);
  const tool = join(FIXTURE_DIR, '..', '..', '..', 'bin', 'native-data.py');
  for (const pack of FIXTURE_PACKS) {
    execFileSync(
      process.env.PYTHON ?? 'python3',
      [
        tool,
        'pack',
        '--graph',
        join(FIXTURE_DIR, 'graph.bin'),
        '--search',
        join(FIXTURE_DIR, 'search.ndjson'),
        // A negative longitude would read as an option without the "=".
        `--bbox=${pack.bbox.join(',')}`,
        '--margin-km',
        String(pack.marginKm),
        '--region',
        pack.region,
        '--name',
        pack.name,
        '--output',
        join(FIXTURE_DIR, pack.file),
      ],
      { stdio: 'inherit' },
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
