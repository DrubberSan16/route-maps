-- Runs once, when the PostgreSQL data volume is initialised.
-- The Prisma migrations also create the extension (CREATE EXTENSION IF NOT EXISTS),
-- so databases created outside Docker work the same way.
CREATE EXTENSION IF NOT EXISTS postgis;
