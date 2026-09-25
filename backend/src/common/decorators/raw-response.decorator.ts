import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE_KEY = 'rawResponse';

/** Skips the `{ success, data }` envelope (health checks, file downloads). */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);
