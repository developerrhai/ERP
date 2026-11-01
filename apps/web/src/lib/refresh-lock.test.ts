// Cross-tab refresh safety: /auth/refresh runs inside the 'rhai-auth-refresh' Web Lock (or the
// in-tab single-flight without it), announces success to other tabs, and retries a REFRESH_RACE.
import { afterEach, describe, expect, it } from 'vitest';
import { AUTH_CHANNEL } from '../auth/channel';
import { getSession } from '../auth/session';
import { apiError, authOk, makeUser, mockFetch } from '../test/helpers';
import { REFRESH_LOCK, refreshSession } from './api';

const REFRESH = 'POST /api/v1/auth/refresh';

/** Minimal LockManager: exclusive, FIFO, records requested names. */
function installFakeLocks() {
  const names: string[] = [];
  let tail: Promise<unknown> = Promise.resolve();
  let held = false;
  const locks = {
    request<T>(name: string, cb: () => Promise<T>): Promise<T> {
      names.push(name);
      const run = tail.then(async () => {
        held = true;
        try {
          return await cb();
        } finally {
          held = false;
        }
      });
      tail = run.catch(() => undefined);
      return run;
    },
  };
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
  return { names, isHeld: () => held, locks };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'locks');
});

describe('refresh across tabs', () => {
  it('falls back to the in-tab single-flight when navigator.locks is missing', async () => {
    expect('locks' in navigator).toBe(false);
    const { calls } = mockFetch({ [REFRESH]: () => authOk(makeUser(), 'n') });
    const results = await Promise.all([refreshSession(), refreshSession()]);
    expect(results).toEqual(['ok', 'ok']);
    expect(calls).toHaveLength(1);
  });

  it('calls /auth/refresh only while holding the rhai-auth-refresh lock', async () => {
    const fake = installFakeLocks();
    const heldDuringFetch: boolean[] = [];
    mockFetch({
      [REFRESH]: () => {
        heldDuringFetch.push(fake.isHeld());
        return authOk(makeUser(), 'n');
      },
    });
    await expect(refreshSession()).resolves.toBe('ok');
    expect(fake.names).toEqual([REFRESH_LOCK]);
    expect(heldDuringFetch).toEqual([true]);
  });

  it('waits for another tab holding the lock, then still refreshes with the shared cookie', async () => {
    const fake = installFakeLocks();
    let releaseOtherTab: () => void = () => undefined;
    const otherTab = fake.locks.request(
      REFRESH_LOCK,
      () => new Promise<void>((r) => (releaseOtherTab = r)),
    );
    const { calls } = mockFetch({ [REFRESH]: () => authOk(makeUser(), 'n') });
    const mine = refreshSession();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(0);
    releaseOtherTab();
    await otherTab;
    await expect(mine).resolves.toBe('ok');
    expect(calls).toHaveLength(1);
  });

  it('broadcasts {type:"refreshed"} to other tabs after a successful refresh', async () => {
    mockFetch({ [REFRESH]: () => authOk(makeUser(), 'n') });
    const other = new BroadcastChannel(AUTH_CHANNEL);
    const got = new Promise<unknown>((resolve) => {
      other.onmessage = (e: MessageEvent<unknown>) => resolve(e.data);
    });
    await refreshSession();
    await expect(got).resolves.toMatchObject({ type: 'refreshed' });
    other.close();
  });

  it('on 409 REFRESH_RACE waits ~300 ms and retries the refresh once', async () => {
    let n = 0;
    const times: number[] = [];
    const { calls } = mockFetch({
      [REFRESH]: () => {
        n += 1;
        times.push(Date.now());
        return n === 1
          ? apiError(409, 'REFRESH_RACE', 'Another refresh is in progress.')
          : authOk(makeUser(), 'n');
      },
    });
    await expect(refreshSession()).resolves.toBe('ok');
    expect(calls).toHaveLength(2);
    expect((times[1] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(280);
    expect(getSession().status).toBe('authenticated');
  });

  it('a second REFRESH_RACE is not retried again and ends the session', async () => {
    const { calls } = mockFetch({
      [REFRESH]: () => apiError(409, 'REFRESH_RACE', 'Another refresh is in progress.'),
    });
    await expect(refreshSession()).resolves.toBe('ended');
    expect(calls).toHaveLength(2);
    expect(getSession().status).toBe('anonymous');
  });

  it('other 409 codes are not retried and keep the session (not a 401/403)', async () => {
    const { calls } = mockFetch({ [REFRESH]: () => apiError(409, 'CONFLICT', 'x') });
    await expect(refreshSession()).resolves.toBe('network');
    expect(calls).toHaveLength(1);
  });
});
