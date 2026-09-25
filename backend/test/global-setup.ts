import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** Applies the Prisma migrations to the dedicated e2e database before the suite runs. */
export default function globalSetup(): void {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) {
    throw new Error(
      'E2E tests need PostgreSQL + PostGIS. Set E2E_DATABASE_URL, for example ' +
        'postgresql://maps:<password>@localhost:5432/maps_e2e',
    );
  }
  const database = new URL(url).pathname.slice(1);
  if (!/_(e2e|test)$/.test(database)) {
    throw new Error(
      `Refusing to run e2e tests against database "${database}": ` +
        'use a dedicated database whose name ends in _e2e or _test.',
    );
  }
  const backend = join(__dirname, '..');
  try {
    execFileSync(join(backend, 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy'], {
      cwd: backend,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `prisma migrate deploy failed:\n${String(stdout ?? '')}${String(stderr ?? '')}`,
      { cause: error },
    );
  }
}
