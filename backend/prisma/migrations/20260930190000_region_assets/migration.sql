-- Relief, satellite and overlay archives of each region (listed in its manifest).
ALTER TABLE "map_regions" ADD COLUMN "assets" JSONB NOT NULL DEFAULT '[]';
