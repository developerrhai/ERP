// Auth client contract tests: refresh-once-then-retry, single in-flight refresh, CSRF header,
// credentials, memory-only token and cross-tab logout (CONTRACT §6/§8).
/* eslint-disable no-restricted-properties -- this test reads web storage to prove the token is NOT there */
import { describe, expect, it, vi } from 'vitest';
import { AUTH_CHANNEL } from '../auth/channel';
import { getAccessToken, getSession, setSession } from '../auth/session';
import { apiError, authOk, json, makeUser, mockFetch } from '../test/helpers';
import { api, ApiError, login, logout, refreshSession } from './api';

const USERS = 'GET /api/v1/users';
const REFRESH = 'POST /api/v1/auth/refresh';

function signIn(token = 'old'): void {
  setSession({ accessToken: token, expiresIn: 900, user: makeUser() });
}

describe('api client', () => {
  it('sends the Bearer token and credentials: include', async () => {
    signIn('abc');
    const { calls } = mockFetch({ [USERS]: () => json(200, { data: [] }) });
    await api('/users');
    expect(calls[0]?.headers.Authorization).toBe('Bearer abc');
    expect(calls[0]?.credentials).toBe('include');
  });

  it('on 401 refreshes once and retries once with the new token', async () => {
    signIn('old');
    let n = 0;
    const { calls } = mockFetch({
      [USERS]: (c) => {
        n += 1;
        return c.headers.Authorization === 'Bearer new'
          ? json(200, { data: ['ok'] })
          : apiError(401, 'UNAUTHENTICATED', 'Expired');
      },
      [REFRESH]: () => authOk(makeUser(), 'new'),
    });
    await expect(api<string[]>('/users')).resolves.toEqual(['ok']);
    expect(n).toBe(2);
    expect(calls.filter((c) => c.path.endsWith('/auth/refresh'))).toHaveLength(1);
    expect(getAccessToken()).toBe('new');
  });

  it('shares one in-flight refresh between concurrent 401s (no stampede)', async () => {
    signIn('old');
    const { calls } = mockFetch({
      [USERS]: (c) =>
        c.headers.Authorization === 'Bearer new'
          ? json(200, { data: 1 })
          : apiError(401, 'UNAUTHENTICATED', 'Expired'),
      [REFRESH]: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return authOk(makeUser(), 'new');
      },
    });
    await Promise.all([api('/users'), api('/users'), api('/users')]);
    expect(calls.filter((c) => c.path.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('when refresh fails, clears the session and does not retry', async () => {
    signIn('old');
    const { calls } = mockFetch({
      [USERS]: () => apiError(401, 'UNAUTHENTICATED', 'Expired'),
      [REFRESH]: () => apiError(401, 'SESSION_EXPIRED', 'Session expired'),
    });
    await expect(api('/users')).rejects.toMatchObject({ status: 401 });
    expect(calls.filter((c) => c.path.endsWith('/users'))).toHaveLength(1);
    expect(getSession().status).toBe('anonymous');
    expect(getAccessToken()).toBeNull();
  });

  it('when the retry is still 401, clears the session without looping', async () => {
    signIn('old');
    const { calls } = mockFetch({
      [USERS]: () => apiError(401, 'UNAUTHENTICATED', 'Nope'),
      [REFRESH]: () => authOk(makeUser(), 'new'),
    });
    await expect(api('/users')).rejects.toBeInstanceOf(ApiError);
    expect(calls.filter((c) => c.path.endsWith('/users'))).toHaveLength(2);
    expect(calls.filter((c) => c.path.endsWith('/auth/refresh'))).toHaveLength(1);
    expect(getSession().status).toBe('anonymous');
  });

  it('refresh sends X-Requested-With: rhai-web with credentials and no Bearer', async () => {
    const { calls } = mockFetch({ [REFRESH]: () => authOk(makeUser(), 't') });
    await expect(refreshSession()).resolves.toBe('ok');
    expect(calls[0]?.headers['X-Requested-With']).toBe('rhai-web');
    expect(calls[0]?.headers.Authorization).toBeUndefined();
    expect(calls[0]?.credentials).toBe('include');
  });

  it('login 401 shows the API message and never triggers a refresh', async () => {
    const { calls } = mockFetch({
      'POST /api/v1/auth/login': () =>
        apiError(401, 'INVALID_CREDENTIALS', 'Invalid login ID or password.'),
    });
    await expect(login('x', 'y')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid login ID or password.',
    });
    expect(calls).toHaveLength(1);
  });

  it('keeps the access token in memory only (never web storage)', async () => {
    mockFetch({ 'POST /api/v1/auth/login': () => authOk(makeUser(), 'secret-token') });
    await login('asha', 'Correct#Horse1');
    expect(getAccessToken()).toBe('secret-token');
    const stored = [
      ...Object.keys(window.localStorage).map((k) => window.localStorage.getItem(k)),
      ...Object.keys(window.sessionStorage).map((k) => window.sessionStorage.getItem(k)),
    ].join('|');
    expect(stored).not.toContain('secret-token');
  });

  it('a network failure becomes an ApiError with a readable message', async () => {
    signIn();
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fetch failed')));
    await expect(api('/users')).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
  });

  it('logout calls the API with the CSRF header, clears the session and broadcasts', async () => {
    signIn('abc');
    const { calls } = mockFetch({ 'POST /api/v1/auth/logout': () => json(204) });
    const other = new BroadcastChannel(AUTH_CHANNEL);
    const received = new Promise<unknown>((resolve) => {
      other.onmessage = (e: MessageEvent<unknown>) => resolve(e.data);
    });
    await logout();
    expect(calls[0]?.headers['X-Requested-With']).toBe('rhai-web');
    expect(calls[0]?.credentials).toBe('include');
    expect(getSession().status).toBe('anonymous');
    await expect(received).resolves.toEqual({ type: 'logout' });
    other.close();
  });
});
