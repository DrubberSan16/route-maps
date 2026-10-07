-- Recent fixes (route traffic, traffic map, activity) are read by time.
CREATE INDEX "trip_points_recorded_at_idx" ON "trip_points"("recorded_at");
