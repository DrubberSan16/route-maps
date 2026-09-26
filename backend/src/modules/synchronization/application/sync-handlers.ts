import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { SyncValidationError } from '../domain/sync-operation';

/** Validates an operation payload with the same DTO classes as the REST API. */
export async function parsePayload<T extends object>(
  cls: ClassConstructor<T>,
  payload: Record<string, unknown>,
): Promise<T> {
  const instance = plainToInstance(cls, payload);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length > 0) {
    throw new SyncValidationError(
      'Invalid operation payload',
      errors.flatMap((error) => messages(error)),
    );
  }
  return instance;
}

/** Messages with the path of nested properties, as the REST API reports them (steps.0.x). */
function messages(error: ValidationError, parentPath = ''): string[] {
  const prefix = parentPath ? `${parentPath}.` : '';
  return [
    ...Object.values(error.constraints ?? {}).map((message) => `${prefix}${message}`),
    ...(error.children ?? []).flatMap((child) => messages(child, `${prefix}${error.property}`)),
  ];
}
