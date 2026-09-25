/** class-transformer helpers for query-string values. */
export const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === true || value === 'true' || value === '1';

export const toLowerCase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;

export const trimLowerCase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
