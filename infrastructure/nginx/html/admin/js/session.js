// Session of the panel and calls to the API.
//
// The access token lives only in memory. The refresh token is kept in sessionStorage, so a reload
// keeps the member signed in while the tab stays open; closing the tab forgets it. Tokens are
// rotated by the API on every renewal, so renewals are never run in parallel: concurrent calls
// share the one in flight (a reused refresh token would close the whole session).
import { toQuery } from './router.js';

const API_BASE = '/api/v1';
const STORAGE_KEY = 'route-maps-admin:refresh-token';
/** The access token is renewed this long before it expires. */
const RENEW_BEFORE_MS = 30_000;

/** Codes after which the member has to sign in again. */
export const SESSION_ENDING_CODES = new Set([
  'INVALID_REFRESH_TOKEN',
  'ACCOUNT_DISABLED',
  'SESSION_REVOKED',
]);

export class ApiError extends Error {
  constructor({ code, message, status = 0, details = undefined }) {
    super(message ?? code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** `data` of a `{ success, data }` answer, or the error it carries as an ApiError. */
export async function readEnvelope(response) {
  const body = await response.json().catch(() => null);
  if (response.ok && body?.success) return body.data;
  const error = body?.error ?? {
    // Nginx answers its own rate limit (429) and gateway errors without the API's body.
    code: response.status === 429 ? 'RATE_LIMIT_EXCEEDED' : `HTTP_${response.status}`,
    message: response.statusText,
  };
  throw new ApiError({
    code: error.code,
    message: error.message,
    status: response.status,
    details: error.details,
  });
}

function browserStorage() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null; // storage blocked by the browser: the session lasts until the page is closed
  }
}

export class Session {
  constructor({ fetch: fetchImpl, storage = browserStorage(), now = () => Date.now(), base = API_BASE } = {}) {
    this.fetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.storage = storage;
    this.now = now;
    this.base = base;
    this.access = null;
    this.refreshToken = null;
    this.pending = null;
    this.listeners = new Set();
  }

  get signedIn() {
    return Boolean(this.refreshToken);
  }

  /** Takes the refresh token kept by an earlier page load of this tab, if any. */
  restore() {
    try {
      this.refreshToken = this.storage?.getItem(STORAGE_KEY) ?? null;
    } catch {
      this.refreshToken = null;
    }
    return this.signedIn;
  }

  /** Called with the error code when the session ends without the member signing out. */
  onEnd(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async signIn(email, password) {
    const data = await this.post('/auth/login', { email, password });
    this.adopt(data);
    return data.user;
  }

  /** Keeps a new token pair (sign-in, renewal, password change). */
  adopt(tokens) {
    this.access = { token: tokens.accessToken, expiresAt: this.now() + tokens.expiresIn * 1000 };
    this.refreshToken = tokens.refreshToken;
    try {
      this.storage?.setItem(STORAGE_KEY, tokens.refreshToken);
    } catch {
      // Not kept across reloads; the session still works in this page.
    }
  }

  /** A valid access token, renewed first when it is about to expire. */
  async accessToken() {
    if (this.access && this.access.expiresAt - RENEW_BEFORE_MS > this.now()) return this.access.token;
    return this.refresh();
  }

  /** Renews the token pair; concurrent callers wait for the same renewal. */
  refresh() {
    this.pending ??= this.renew().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  async renew() {
    if (!this.refreshToken) {
      throw new ApiError({ code: 'UNAUTHORIZED', message: 'Not signed in', status: 401 });
    }
    try {
      this.adopt(await this.post('/auth/refresh', { refreshToken: this.refreshToken }));
    } catch (error) {
      // An answer of the server that refuses the token ends the session; a network error does not.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429) {
        this.end(SESSION_ENDING_CODES.has(error.code) ? error.code : 'INVALID_REFRESH_TOKEN');
      }
      throw error;
    }
    return this.access.token;
  }

  /** Forgets the tokens and tells the panel why (the member has to sign in again). */
  end(code) {
    const wasSignedIn = this.signedIn;
    this.clear();
    if (wasSignedIn) for (const listener of this.listeners) listener(code);
  }

  /** Signs out: the refresh token is revoked on the server, best effort. */
  async signOut() {
    const token = this.refreshToken;
    this.clear();
    if (token) await this.post('/auth/logout', { refreshToken: token }).catch(() => undefined);
  }

  clear() {
    this.access = null;
    this.refreshToken = null;
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      // Nothing was kept.
    }
  }

  async post(path, body) {
    let response;
    try {
      response = await this.fetch(`${this.base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiError({ code: 'OFFLINE', message: 'Network error' });
    }
    return readEnvelope(response);
  }
}

/**
 * Calls to the API as the signed-in member. An expired access token is renewed and the call made
 * once more; a closed session (disabled account, sessions closed by an administrator) ends it.
 */
export function createApi(session, { fetch: fetchImpl, base = API_BASE } = {}) {
  const doFetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));

  async function send(method, url, token, body, signal) {
    try {
      return await doFetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new ApiError({ code: 'OFFLINE', message: 'Network error' });
    }
  }

  async function request(method, path, { query, body, signal } = {}) {
    const url = `${base}${path}${toQuery(query)}`;
    let response = await send(method, url, await session.accessToken(), body, signal);
    if (response.status === 401) {
      const code = (await response.clone().json().catch(() => null))?.error?.code;
      if (code === 'UNAUTHORIZED') {
        // Expired between the check and the call, or renewed in another way: once more.
        response = await send(method, url, await session.refresh(), body, signal);
      }
    }
    try {
      return await readEnvelope(response);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        session.end(SESSION_ENDING_CODES.has(error.code) ? error.code : 'UNAUTHORIZED');
      }
      throw error;
    }
  }

  return {
    get: (path, query, options = {}) => request('GET', path, { ...options, query }),
    post: (path, body = {}, options = {}) => request('POST', path, { ...options, body }),
    patch: (path, body, options = {}) => request('PATCH', path, { ...options, body }),
    delete: (path, options = {}) => request('DELETE', path, options),
    /** Health of the services (public, outside the API envelope). */
    async health() {
      try {
        const response = await doFetch('/health', { headers: { Accept: 'application/json' } });
        return await response.json();
      } catch {
        return null;
      }
    },
  };
}
