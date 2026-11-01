// UI side of the security-review fixes: why-you-are-signed-out messages on the login page,
// the DATABASE ISSUE health state, and the sign-out toast when the server cannot confirm.
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { apiError, authOk, json, makeUser, mockFetch, renderApp } from './test/helpers';

const REFRESH = 'POST /api/v1/auth/refresh';

describe('signed-out reasons on the login page', () => {
  it('API returning 503 on load shows the network message, not a generic error', async () => {
    mockFetch({ [REFRESH]: () => apiError(503, 'UNAVAILABLE', 'down') });
    renderApp('/');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cannot reach the server. Check your connection and try again.',
    );
    expect(screen.queryByText('Something went wrong.')).toBeNull();
  });

  it('an unreachable API on load shows the network message', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    renderApp('/');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cannot reach the server. Check your connection and try again.',
    );
  });

  it('a repeated REFRESH_RACE shows "Your session ended. Please sign in again."', async () => {
    mockFetch({ [REFRESH]: () => apiError(409, 'REFRESH_RACE', 'busy') });
    renderApp('/');
    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent(
      'Your session ended. Please sign in again.',
    );
  });

  it('a plain 401 on load shows the login page without an error', async () => {
    mockFetch({ [REFRESH]: () => apiError(401, 'UNAUTHENTICATED', 'x') });
    renderApp('/');
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('shell', () => {
  it('health 503 {db:"down"} shows DATABASE ISSUE', async () => {
    mockFetch({
      [REFRESH]: () => authOk(makeUser()),
      'GET /api/v1/health': () => json(503, { data: { status: 'degraded', db: 'down' } }),
    });
    renderApp('/');
    expect(await screen.findByText(/DATABASE ISSUE/)).toBeInTheDocument();
  });

  it('health network failure shows API OFFLINE', async () => {
    const auth = authOk(makeUser());
    vi.stubGlobal('fetch', (input: string) =>
      input.endsWith('/auth/refresh')
        ? Promise.resolve(auth.clone())
        : Promise.reject(new TypeError('Failed to fetch')),
    );
    renderApp('/');
    expect(await screen.findByText(/API OFFLINE/)).toBeInTheDocument();
  });

  it('Sign Out with the server unreachable signs out locally and says it is retrying', async () => {
    mockFetch({
      [REFRESH]: () => authOk(makeUser({ name: 'Asha Patil' })),
      'GET /api/v1/health': () => json(200, { data: { status: 'ok', db: 'ok' } }),
      'POST /api/v1/auth/logout': () => apiError(503, 'UNAVAILABLE', 'down'),
    });
    renderApp('/');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'Account: Asha Patil' }));
    await ue.click(await screen.findByRole('button', { name: 'Sign Out' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(
      await screen.findByText('Sign-out could not be confirmed by the server. Retrying…'),
    ).toBeInTheDocument();
  });
});
