-- CreateTable
CREATE TABLE "route_tombstones" (
    "user_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_tombstones_pkey" PRIMARY KEY ("user_id","route_id")
);

-- CreateIndex
CREATE INDEX "route_tombstones_user_id_deleted_at_route_id_idx" ON "route_tombstones"("user_id", "deleted_at", "route_id");

-- CreateIndex
CREATE INDEX "routes_user_id_updated_at_id_idx" ON "routes"("user_id", "updated_at", "id");

-- AddForeignKey
ALTER TABLE "route_tombstones" ADD CONSTRAINT "route_tombstones_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: route deletions pushed by the app before this migration were only
-- recorded as sync events; keep them reaching the user's other devices.
INSERT INTO "route_tombstones" ("user_id", "route_id", "deleted_at")
SELECT DISTINCT ON (d."user_id", d."route_id") d."user_id", d."route_id", d."processed_at"
FROM (
    SELECT e."user_id", e."processed_at",
           CASE WHEN e."payload"->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN (e."payload"->>'id')::uuid END AS "route_id"
    FROM "synchronization_events" e
    WHERE e."entity" = 'route' AND e."operation" = 'DELETE' AND e."status" = 'APPLIED'
) d
WHERE d."route_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "routes" r WHERE r."id" = d."route_id")
ORDER BY d."user_id", d."route_id", d."processed_at" DESC;
