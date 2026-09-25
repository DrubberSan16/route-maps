/** Entities the mobile offline queue can push. */
export const SYNC_ENTITIES = [
  'trip',
  'tracking_point',
  'route',
  'place',
  'downloaded_region',
] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

export const SYNC_OPERATIONS = [
  'CREATE',
  'UPSERT',
  'UPDATE',
  'DELETE',
  'FINISH',
  'CANCEL',
] as const;
export type SyncOperationType = (typeof SYNC_OPERATIONS)[number];

export interface SyncOperation {
  /** Client generated id of the queued operation (idempotency key). */
  id: string;
  entity: SyncEntity;
  operation: SyncOperationType;
  payload: Record<string, unknown>;
  createdAt?: Date;
}

export type SyncOperationStatus = 'APPLIED' | 'DUPLICATE' | 'FAILED';

export interface SyncOperationResult {
  id: string;
  status: SyncOperationStatus;
  /** When FAILED: whether retrying the same operation later can succeed. */
  retryable?: boolean;
  error?: { code: string; message: string; details?: unknown };
  result?: unknown;
}

/** Thrown by handlers for invalid payloads: permanent failure, never retried. */
export class SyncValidationError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'SyncValidationError';
  }
}
