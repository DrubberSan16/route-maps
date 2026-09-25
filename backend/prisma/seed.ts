/**
 * Development/demo seed. Idempotent: safe to run several times.
 *
 * - admin and demo users (passwords from SEED_ADMIN_PASSWORD / SEED_DEMO_PASSWORD,
 *   with development defaults that are refused in production)
 * - a demo place, favorite, geofence and saved route in Guayaquil
 *
 * Map regions are NOT seeded with fake files: they are registered from the
 * manifests produced by `make prepare-region` (see docs/maps.md).
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client';

const isProduction = process.env.NODE_ENV === 'production';

function password(envName: string, fallback: string): string {
  const value = process.env[envName];
  if (value && value.length >= 8) return value;
  if (isProduction) throw new Error(`${envName} must be set (>= 8 chars) to seed in production`);
  return fallback;
}

const hash = (plain: string) =>
  argon2.hash(plain, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    const admin = await prisma.user.upsert({
      where: { email: 'admin@maps.local' },
      update: {},
      create: {
        email: 'admin@maps.local',
        name: 'Administrador',
        role: 'ADMIN',
        passwordHash: await hash(password('SEED_ADMIN_PASSWORD', 'Admin1234!')),
      },
    });
    const demo = await prisma.user.upsert({
      where: { email: 'demo@maps.local' },
      update: {},
      create: {
        email: 'demo@maps.local',
        name: 'Usuario Demo',
        role: 'USER',
        passwordHash: await hash(password('SEED_DEMO_PASSWORD', 'Demo1234!')),
      },
    });

    // Demo place + favorite: Malecón 2000, Guayaquil.
    const placeId = '6f1c1f3a-8a51-4d8e-9a57-0b0a8b3d2c11';
    await prisma.$executeRaw`
      INSERT INTO places (id, user_id, name, description, category, address, location, created_at, updated_at)
      VALUES (${placeId}::uuid, ${demo.id}::uuid, 'Malecón 2000', 'Lugar de demostración', 'landmark',
              'Malecón Simón Bolívar, Guayaquil', ST_SetSRID(ST_MakePoint(-79.8816, -2.1894), 4326), now(), now())
      ON CONFLICT (id) DO NOTHING`;
    await prisma.favoritePlace.upsert({
      where: { userId_placeId: { userId: demo.id, placeId } },
      update: {},
      create: { userId: demo.id, placeId, alias: 'Malecón' },
    });

    // Demo circular geofence (300 m) around Parque Seminario.
    const geofenceId = '0d3b7c1e-2f4a-4b6c-8d9e-1a2b3c4d5e6f';
    await prisma.$executeRaw`
      INSERT INTO geofences (id, user_id, name, description, type, center, radius_meters, area, active, created_at, updated_at)
      VALUES (${geofenceId}::uuid, ${demo.id}::uuid, 'Parque Seminario', 'Geocerca de demostración',
              'CIRCLE'::"GeofenceType", ST_SetSRID(ST_MakePoint(-79.8832, -2.1960), 4326), 300,
              ST_Buffer(ST_SetSRID(ST_MakePoint(-79.8832, -2.1960), 4326)::geography, 300, 'quad_segs=16')::geometry,
              true, now(), now())
      ON CONFLICT (id) DO NOTHING`;

    // Demo saved route (straight segments, for rendering offline without a routing engine).
    const routeId = '3c9a4d2e-5b6f-4a7c-9d8e-2f1a0b9c8d7e';
    const geometry = {
      type: 'LineString',
      coordinates: [
        [-79.8832, -2.196],
        [-79.8825, -2.1935],
        [-79.8816, -2.1894],
      ],
    };
    await prisma.$executeRaw`
      INSERT INTO routes (id, user_id, name, profile, origin, destination, distance_meters, duration_seconds,
                          geometry, steps, region_code, provider, created_at, updated_at)
      VALUES (${routeId}::uuid, ${demo.id}::uuid, 'Parque Seminario → Malecón 2000', 'PEDESTRIAN'::"RoutingProfile",
              ST_SetSRID(ST_MakePoint(-79.8832, -2.1960), 4326), ST_SetSRID(ST_MakePoint(-79.8816, -2.1894), 4326),
              760, 560, ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326), '[]'::jsonb,
              'guayaquil', 'seed', now(), now())
      ON CONFLICT (id) DO NOTHING`;

    process.stdout.write(
      `Seed completed: users ${admin.email} (ADMIN), ${demo.email} (USER); demo place, geofence and route.\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
