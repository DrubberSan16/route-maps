import { ValidateBy, ValidationOptions } from 'class-validator';

/** The value serialised as JSON is at most `maxBytes` bytes long (free-form metadata). */
export const MaxJsonSize = (maxBytes: number, options?: ValidationOptions): PropertyDecorator =>
  ValidateBy(
    {
      name: 'maxJsonSize',
      constraints: [maxBytes],
      validator: {
        validate: (value: unknown) => {
          try {
            return Buffer.byteLength(JSON.stringify(value) ?? '') <= maxBytes;
          } catch {
            return false;
          }
        },
        defaultMessage: (args) =>
          `${args?.property ?? 'value'} must be at most ${maxBytes} bytes of JSON`,
      },
    },
    options,
  );
