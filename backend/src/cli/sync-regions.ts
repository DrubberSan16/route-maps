/**
 * Registers the regions prepared by the data pipeline (manifests in map storage).
 * Usage: node dist/src/cli/sync-regions.js [--force]
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { MapRegionService } from '../modules/regions/application/map-region.service';

async function main(): Promise<void> {
  process.env.REGIONS_SYNC_ON_STARTUP = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const report = await app.get(MapRegionService).syncFromStorage({
      force: process.argv.includes('--force'),
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.errors.length > 0 ? 1 : 0;
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
