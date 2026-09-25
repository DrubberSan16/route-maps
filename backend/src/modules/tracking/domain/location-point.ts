export interface LocationPoint {
  tripId: string;
  latitude: number;
  longitude: number;
  /** Horizontal accuracy in meters. */
  accuracy?: number | null;
  /** Speed in meters per second (as reported by the device GPS). */
  speed?: number | null;
  /** Course over ground in degrees (0-360). */
  heading?: number | null;
  altitude?: number | null;
  recordedAt: Date;
}

export interface TrackingBatchResult {
  received: number;
  inserted: number;
  duplicates: number;
}
