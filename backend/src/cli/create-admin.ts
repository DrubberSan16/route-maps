/**
 * Creates an administrator, or makes an existing account an active administrator again.
 * Usage: node dist/src/cli/create-admin.js --email admin@example.com [--name "Name"]
 *          [--password-stdin | --reset-password]
 * A new account without --password-stdin gets a temporary password, printed once. For an
 * existing account the password is kept unless --password-stdin or --reset-password is given.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { UserRole } from '../generated/prisma/enums';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { generateTemporaryPassword } from '../modules/admin/domain/temporary-password';
import { AuditService } from '../modules/audit/application/audit.service';
import { PASSWORD_HASHER, type PasswordHasher } from '../modules/auth/domain/password-hasher';
import { UsersService } from '../modules/users/application/users.service';

const USAGE =
  'Usage: create-admin --email admin@example.com [--name "Name"] ' +
  '[--password-stdin | --reset-password]';
/** Who the audit log names for changes made from the command line. */
const CLI_ACTOR = { id: null, email: 'command line' };

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '');
}

function fail(message: string): never {
  process.stderr.write(`${message}\n${USAGE}\n`);
  process.exit(2);
}

async function main(): Promise<void> {
  const email = option('email')?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('A valid --email is required.');
  const name = option('name')?.trim() || 'Administrador';
  if (name.length > 120) fail('--name can have at most 120 characters.');
  const typed = process.argv.includes('--password-stdin') ? await readStdin() : undefined;
  if (typed !== undefined && (typed.length < 8 || typed.length > 128)) {
    fail('The password must have between 8 and 128 characters.');
  }

  process.env.REGIONS_SYNC_ON_STARTUP = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const users = app.get(UsersService);
    const hasher = app.get<PasswordHasher>(PASSWORD_HASHER);
    const audit = app.get(AuditService);
    const prisma = app.get(PrismaService);

    const existing = await users.findByEmail(email);
    if (existing?.serviceAccount) fail(`${email} is the account of an integration.`);
    const generate =
      typed === undefined && (!existing || process.argv.includes('--reset-password'));
    const temporaryPassword = generate ? generateTemporaryPassword() : null;
    const password = typed ?? temporaryPassword;

    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: UserRole.ADMIN, active: true },
      });
      if (password) await users.replacePassword(existing.id, await hasher.hash(password));
      await audit.record(CLI_ACTOR, {
        action: 'user.role',
        targetType: 'user',
        targetId: existing.id,
        summary: existing.email,
        details: {
          role: { from: existing.role, to: UserRole.ADMIN },
          active: { from: existing.active, to: true },
          passwordChanged: password !== null,
        },
      });
    } else {
      const user = await users.create({
        email,
        name,
        role: UserRole.ADMIN,
        passwordHash: await hasher.hash(password!),
      });
      await audit.record(CLI_ACTOR, {
        action: 'user.create',
        targetType: 'user',
        targetId: user.id,
        summary: user.email,
        details: { role: UserRole.ADMIN, generatedPassword: temporaryPassword !== null },
      });
    }

    process.stdout.write(`Administrator ready: ${email}\n`);
    if (temporaryPassword) {
      process.stdout.write(`Temporary password (shown only once): ${temporaryPassword}\n`);
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
