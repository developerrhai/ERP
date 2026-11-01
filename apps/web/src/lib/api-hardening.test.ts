// Security-review hardening of the auth client: refresh clears the session only on 401/403,
// 10 s timeouts (also inside the refresh lock), REFRESH_RACE ends the session on a second hit,
// raw /health parsing, and logout retries when the server cannot confirm.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_CHANNEL } from '../auth/channel';
import { getAccessToken, getSession, setSession } from '../auth/session';
import { apiError, json, makeUser, mockFetch, type Handler } from '../test/helpers';
import {
  api,
  getHealth,
  LOGOUT_FAILED_MESSAGE,
  LOGOUT_RETRYING_MESSAGE,
  logout,
  REFRESH_LOCK,
  refreshSession,
  REQUEST_TIMEOUT_MS,
  SESSION_ENDED_MESSAGE,
} from './api';

const REFRESH = 'POST /api/v1/auth/refresh';
const LOGOUT = 'POST /api/v1/auth/logout';

function signIn(token = 'keep-me'): void {
  setSession({ accessToken: token, expiresIn: 900, user: makeUser() });
}

/** A handler that never answers until the request is aborted. */
const hang: Handler = (call) =>
  new Promise<Response>((_, reject) => {
    call.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });

function listenOnChannel(): { messages: unknown[]; close: () => void } {
  const other = new BroadcastChannel(AUTH_CHANNEL);
  const messages: unknown[] = [];
  other.onmessage = (e: MessageEvent<unknown>) => messages.push(e.data);
  return { messages, close: () => other.close() };
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'locks');
});

describe('refresh outcome mapping', () => {
  it.each([401, 403])('%i from /auth/refresh clears the session', async (status) => {
    signIn();
    mockFetch({ [REFRESH]: () => apiError(status, 'UNAUTHENTICATED', 'x') });
    await expect(refreshSession()).resolves.toBe('denied');
    expect(getSession().status).toBe('anonymous');
    expect(getAccessToken()).toBeNull();
  });

  it.each([429, 500, 502, 503, 504])(
    '%i is a network outcome and keeps the session',
    async (status) => {
      signIn();
      mockFetch({ [REFRESH]: () => apiError(status, 'X', 'x') });
      await expect(refreshSession()).resolves.toBe('network');
      expect(getSession().status).toBe('authenticated');
      expect(getAccessToken()).toBe('keep-me');
    },
  );

  it('a fetch rejection is a network outcome and keeps the session', async () => {
    signIn();
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(refreshSession()).resolves.toBe('network');
    expect(getAccessToken()).toBe('keep-me');
  });

  it('a 401 on a call whose refresh hits 503 throws NETWORK and keeps the session', async () => {
    signIn();
    mockFetch({
      'GET /api/v1/users': () => apiError(401, 'UNAUTHENTICATED', 'Expired'),
      [REFRESH]: () => apiError(503, 'UNAVAILABLE', 'down'),
    });
    await expect(api('/users')).rejects.toMatchObject({
      code: 'NETWORK',
      message: 'Cannot reach the server. Check your connection and try again.',
    });
    expect(getSession().status).toBe('authenticated');
  });
});

describe('timeouts', () => {
  it(`a hung API call is aborted after ${REQUEST_TIMEOUT_MS} ms`, async () => {
    vi.useFakeTimers();
    signIn();
    mockFetch({ 'GET /api/v1/users': hang });
    const p = api('/users');
    const check = expect(p).rejects.toMatchObject({ code: 'NETWORK' });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await check;
  });

  it('a hung refresh times out inside the Web Lock and releases it', async () => {
    vi.useFakeTimers();
    let held = 0;
    const names: string[] = [];
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        async request<T>(name: string, cb: () => Promise<T>): Promise<T> {
          names.push(name);
          held += 1;
          try {
            return await cb();
          } finally {
            held -= 1;
          }
        },
      },
    });
    mockFetch({ [REFRESH]: hang });
    const p = refreshSession();
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(held).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe('network');
    expect(held).toBe(0);
    expect(names).toEqual([REFRESH_LOCK]);
  });
});

describe('REFRESH_RACE', () => {
  it('a second 409 REFRESH_RACE ends the session, broadcasts logout and is not retried again', async () => {
    signIn();
    const tab = listenOnChannel();
    const { calls } = mockFetch({
      [REFRESH]: () => apiError(409, 'REFRESH_RACE', 'busy'),
    });
    await expect(refreshSession()).resolves.toBe('ended');
    expect(calls).toHaveLength(2);
    expect(getSession()).toMatchObject({ status: 'anonymous', notice: SESSION_ENDED_MESSAGE });
    await vi.waitFor(() => expect(tab.messages).toContainEqual({ type: 'logout' }));
    tab.close();
  });

  it('an API call whose refresh ends the session rejects with the session-ended message', async () => {
    signIn();
    mockFetch({
      'GET /api/v1/users': () => apiError(401, 'UNAUTHENTICATED', 'Expired'),
      [REFRESH]: () => apiError(409, 'REFRESH_RACE', 'busy'),
    });
    await expect(api('/users')).rejects.toMatchObject({ message: SESSION_ENDED_MESSAGE });
  });
});

describe('getHealth', () => {
  it('ok when 200 {status:"ok", db:"ok"}', async () => {
    mockFetch({ 'GET /api/v1/health': () => json(200, { data: { status: 'ok', db: 'ok' } }) });
    await expect(getHealth()).resolves.toBe('ok');
  });

  it('degraded when 503 {status:"degraded", db:"down"}', async () => {
    mockFetch({
      'GET /api/v1/health': () => json(503, { data: { status: 'degraded', db: 'down' } }),
    });
    await expect(getHealth()).resolves.toBe('degraded');
  });

  it.each([
    ['a network error', (): Promise<Response> => Promise.reject(new TypeError('x'))],
    ['a 500', (): Promise<Response> => Promise.resolve(apiError(500, 'INTERNAL', 'x'))],
    [
      'a 503 without a body',
      (): Promise<Response> => Promise.resolve(new Response('', { status: 503 })),
    ],
  ])('down on %s', async (_label, impl) => {
    vi.stubGlobal('fetch', impl);
    await expect(getHealth()).resolves.toBe('down');
  });
});

describe('logout when the server cannot confirm', () => {
  it('confirmed by the server: no notices, one call, local session cleared', async () => {
    signIn();
    const notify = vi.fn();
    const { calls } = mockFetch({ [LOGOUT]: () => json(204) });
    await logout(notify, [0, 0, 0]);
    expect(calls).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
    expect(getSession().status).toBe('anonymous');
  });

  it('unreachable: clears locally, broadcasts, retries 3 times, then reports failure', async () => {
    signIn('t-1');
    const tab = listenOnChannel();
    const notify = vi.fn();
    const seen: (string | undefined)[] = [];
    mockFetch({
      [LOGOUT]: (c) => {
        seen.push(c.headers.Authorization);
        return apiError(503, 'UNAVAILABLE', 'down');
      },
    });
    await logout(notify, [0, 0, 0]);
    expect(seen).toEqual(['Bearer t-1', 'Bearer t-1', 'Bearer t-1', 'Bearer t-1']);
    expect(notify.mock.calls).toEqual([[LOGOUT_RETRYING_MESSAGE], [LOGOUT_FAILED_MESSAGE]]);
    expect(getSession().status).toBe('anonymous');
    expect(getAccessToken()).toBeNull();
    await vi.waitFor(() => expect(tab.messages).toContainEqual({ type: 'logout' }));
    tab.close();
  });

  it('stops retrying once the server confirms', async () => {
    signIn();
    const notify = vi.fn();
    let n = 0;
    const { calls } = mockFetch({
      [LOGOUT]: () => {
        n += 1;
        return n < 3 ? apiError(502, 'BAD_GATEWAY', 'x') : json(204);
      },
    });
    await logout(notify, [0, 0, 0]);
    expect(calls).toHaveLength(3);
    expect(notify.mock.calls).toEqual([[LOGOUT_RETRYING_MESSAGE]]);
  });

  it('uses backoff delays between retries', async () => {
    vi.useFakeTimers();
    signIn();
    const { calls } = mockFetch({ [LOGOUT]: () => apiError(503, 'X', 'x') });
    const done = logout(() => undefined, [1000, 2000, 4000]);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(4000);
    await done;
    expect(calls).toHaveLength(4);
  });
});
