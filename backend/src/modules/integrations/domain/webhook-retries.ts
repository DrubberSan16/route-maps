/** Waits after failed attempts 1, 2, 3...; the delivery fails for good after the last one. */
export const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 3_600_000,
  6 * 3_600_000,
  12 * 3_600_000,
  24 * 3_600_000,
];

/** Attempts of a delivery before it is marked as failed (about 45 hours in all). */
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
