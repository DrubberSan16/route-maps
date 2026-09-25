import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SyncValidationError } from '../domain/sync-operation';

/** Validates an operation payload with the same DTO classes as the REST API. */
export async function parsePayload<T extends object>(
  cls: ClassConstructor<T>,
  payload: Record<string, unknown>,
): Promise<T> {
  const instance = plainToInstance(cls, payload);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length > 0) {
    const details = errors.flatMap((error) => [
      ...Object.values(error.constraints ?? {}),
      ...(error.children ?? []).flatMap((child) =>
        Object.values(child.constraints ?? {}).map((message) => `${error.property}.${message}`),
      ),
    ]);
    throw new SyncValidationError('Invalid operation payload', details);
  }
  return instance;
}
