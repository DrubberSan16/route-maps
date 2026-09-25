/** Error raised when an upstream HTTP service cannot be reached or times out. */
export class UpstreamUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'UpstreamUnavailableError';
  }
}

/** Error raised when an upstream HTTP service answers with a non-2xx status. */
export class UpstreamHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'UpstreamHttpError';
  }
}

export interface FetchJsonOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs: number;
  headers?: Record<string, string>;
}

/** Small JSON-over-HTTP helper with timeout and typed errors (uses Node's fetch). */
export async function fetchJson<T>(url: string, options: FetchJsonOptions): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    throw new UpstreamUnavailableError(`Request to ${new URL(url).host} failed`, { cause: error });
  }

  const text = await response.text();
  let parsed: unknown = undefined;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!response.ok) {
    throw new UpstreamHttpError(
      response.status,
      parsed,
      `Upstream ${new URL(url).host} answered ${response.status}`,
    );
  }
  return parsed as T;
}
