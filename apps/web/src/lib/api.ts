// The only HTTP client for /api/v1: attaches the in-memory Bearer token, sends cookies, times out
// hung requests, and on a 401 refreshes once (single-flight in-tab, Web Lock across tabs) and retries.
import { broadcastLogout, broadcastRefreshed } from '../auth/channel';
import { clearSession, getAccessToken, setSession } from '../auth/session';
import type { AuthResult, PageMeta } from '../types';

export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api/v1';
const CSRF_HEADER = { 'X-Requested-With': 'rhai-web' } as const;
export const NETWORK_MESSAGE = 'Cannot reach the server. Check your connection and try again.';
export const SESSION_ENDED_MESSAGE = 'Your session ended. Please sign in again.';
export const LOGOUT_RETRYING_MESSAGE = 'Sign-out could not be confirmed by the server. Retrying…';
export const LOGOUT_FAILED_MESSAGE =
  'You are signed out on this device, but the server could not be reached. Sign out again when online.';
/** A hung API must never block a tab (or every tab, via the refresh lock) indefinitely. */
export const REQUEST_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export interface Envelope<T> {
  data: T;
  meta?: PageMeta;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** false for endpoints that must never trigger refresh-and-retry (login, health). */
  auth?: boolean;
}

interface ErrorBody {
  error?: { code?: unknown; message?: unknown; fields?: unknown };
}

function toFields(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) if (typeof v === 'string') out[k] = v;
  return out;
}

async function parse<T>(res: Response): Promise<Envelope<T>> {
  if (res.status === 204) return { data: undefined as T };
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = (body as ErrorBody | null)?.error;
    const code = typeof err?.code === 'string' ? err.code : `HTTP_${res.status}`;
    const message =
      typeof err?.message === 'string' && err.message ? err.message : 'Something went wrong.';
    throw new ApiError(res.status, code, message, toFields(err?.fields));
  }
  return body as Envelope<T>;
}

/** fetch with credentials and a REQUEST_TIMEOUT_MS abort; rejection/timeout → ApiError NETWORK. */
async function send(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? 'GET',
      credentials: 'include',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', NETWORK_MESSAGE);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ok: new session. denied: server said 401/403 (session cleared). ended: a repeated
 * REFRESH_RACE (session cleared, other tabs signed out). network: unreachable, timed out,
 * 429, 5xx or anything unexpected — the in-memory session is kept.
 */
export type RefreshOutcome = 'ok' | 'denied' | 'ended' | 'network';
let refreshInFlight: Promise<RefreshOutcome> | null = null;

export const REFRESH_LOCK = 'rhai-auth-refresh';
export const REFRESH_RACE_RETRY_MS = 300;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function errorCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.clone().json()) as ErrorBody | null;
    return typeof body?.error?.code === 'string' ? body.error.code : null;
  } catch {
    return null;
  }
}

async function isRefreshRace(res: Response): Promise<boolean> {
  return res.status === 409 && (await errorCode(res)) === 'REFRESH_RACE';
}

/**
 * Runs fn while holding a cross-tab Web Lock, so two tabs never present the same refresh
 * cookie at once (the API treats reuse of a rotated cookie as theft). Without Web Locks the
 * in-tab single-flight below is the only protection.
 */
function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== 'function') return fn();
  return locks.request(REFRESH_LOCK, () => fn());
}

async function refreshOnce(): Promise<RefreshOutcome> {
  try {
    // Always call the API inside the lock, even if another tab refreshed a moment ago: the
    // cookie jar is shared, so this request already carries the cookie that tab received.
    const post = (): Promise<Response> =>
      send('/auth/refresh', { method: 'POST', headers: CSRF_HEADER }, null);
    let res = await post();
    if (await isRefreshRace(res)) {
      // Exactly one retry: presenting the same rotated token again would look like theft.
      await delay(REFRESH_RACE_RETRY_MS);
      res = await post();
      if (await isRefreshRace(res)) {
        clearSession(SESSION_ENDED_MESSAGE);
        broadcastLogout();
        return 'ended';
      }
    }
    if (res.status === 401 || res.status === 403) {
      clearSession();
      return 'denied';
    }
    if (!res.ok) return 'network';
    const { data } = await parse<AuthResult>(res);
    setSession(data);
    broadcastRefreshed();
    return 'ok';
  } catch {
    return 'network';
  }
}

/**
 * Rotates the refresh cookie. Concurrent callers in this tab share one request, and the
 * request itself is serialised across tabs by a Web Lock (no refresh stampede or race).
 */
export function refreshSession(): Promise<RefreshOutcome> {
  refreshInFlight ??= (async (): Promise<RefreshOutcome> => {
    try {
      return await withRefreshLock(refreshOnce);
    } catch {
      return 'network';
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<Envelope<T>> {
  const auth = opts.auth ?? true;
  let res = await send(path, opts, auth ? getAccessToken() : null);
  if (res.status === 401 && auth) {
    const outcome = await refreshSession();
    if (outcome === 'network') throw new ApiError(0, 'NETWORK', NETWORK_MESSAGE);
    if (outcome === 'ended') throw new ApiError(401, 'SESSION_ENDED', SESSION_ENDED_MESSAGE);
    if (outcome === 'ok') {
      res = await send(path, opts, getAccessToken());
      // Still unauthorised after one refresh: drop the session; the router sends us to /login.
      if (res.status === 401) clearSession();
    }
  }
  return parse<T>(res);
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return (await request<T>(path, opts)).data;
}

// ---- health --------------------------------------------------------------

export type HealthState = 'ok' | 'degraded' | 'down';

/** Reads /health raw, because a DB outage arrives as 503 {data:{status:"degraded",db:"down"}}. */
export async function getHealth(): Promise<HealthState> {
  let res: Response;
  try {
    res = await send('/health', {}, null);
  } catch {
    return 'down';
  }
  if (!res.ok && res.status !== 503) return 'down';
  let data: { status?: unknown; db?: unknown } | undefined;
  try {
    data = ((await res.json()) as { data?: { status?: unknown; db?: unknown } } | null)?.data;
  } catch {
    return 'down';
  }
  if (!data) return 'down';
  if (res.ok && data.status === 'ok' && data.db === 'ok') return 'ok';
  return data.status === 'degraded' || data.db === 'down' || res.ok ? 'degraded' : 'down';
}

// ---- auth endpoints ------------------------------------------------------

export async function login(identifier: string, password: string): Promise<AuthResult> {
  const data = await api<AuthResult>('/auth/login', {
    method: 'POST',
    body: { identifier, password },
    auth: false,
  });
  setSession(data);
  return data;
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<AuthResult> {
  const data = await api<AuthResult>('/auth/change-password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  });
  setSession(data);
  return data;
}

export const LOGOUT_RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000];

/** True when the server answered such that the server-side session is gone (or never existed). */
async function postLogout(token: string | null): Promise<boolean> {
  try {
    const res = await send('/auth/logout', { method: 'POST', headers: CSRF_HEADER }, token);
    return res.ok || res.status === 401;
  } catch {
    return false;
  }
}

/**
 * Signs out. The local session is always cleared and broadcast to other tabs. If the server
 * cannot confirm (its session and httpOnly cookie would survive), the user is told and the
 * request is retried with backoff; the returned promise settles when retries are done.
 */
export async function logout(
  notify: (message: string) => void = () => undefined,
  retryDelaysMs: readonly number[] = LOGOUT_RETRY_DELAYS_MS,
): Promise<void> {
  const token = getAccessToken();
  const confirmed = await postLogout(token);
  clearSession();
  broadcastLogout();
  if (confirmed) return;
  notify(LOGOUT_RETRYING_MESSAGE);
  for (const ms of retryDelaysMs) {
    await delay(ms);
    if (await postLogout(token)) return;
  }
  notify(LOGOUT_FAILED_MESSAGE);
}

export async function logoutAll(): Promise<void> {
  await api<undefined>('/auth/logout-all', { method: 'POST' });
  clearSession();
  broadcastLogout();
}
