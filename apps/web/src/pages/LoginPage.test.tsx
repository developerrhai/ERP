// Login form behaviour (CONTRACT §8): empty fields, only Sign In/Forgot, show/hide, Enter
// submits, a double click sends one request, pending label, and API error messages.
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, authOk, makeUser, mockFetch, renderApp, type Handler } from '../test/helpers';

const REFRESH = 'POST /api/v1/auth/refresh';
const LOGIN = 'POST /api/v1/auth/login';
const anon: Handler = () => apiError(401, 'UNAUTHENTICATED', 'No session');

async function openLogin(routes: Record<string, Handler> = {}) {
  const mock = mockFetch({ [REFRESH]: anon, 'GET /api/v1/health': anon, ...routes });
  renderApp('/login');
  await screen.findByRole('heading', { name: 'Welcome back' });
  return mock;
}

describe('LoginPage', () => {
  it('renders the full prototype login UI with Company Code, Department, Sign In/Up/Forgot tabs, and demo buttons', async () => {
    await openLogin();
    const id = screen.getByLabelText('Email / User ID');
    const pw = screen.getByLabelText('Password');
    expect(id).toHaveValue('');
    expect(pw).toHaveValue('');
    expect(id).toHaveAttribute('autocomplete', 'username');
    expect(pw).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Sign In',
      'Sign Up',
      'Forgot',
    ]);
    expect(screen.getByLabelText(/company code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/department/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Demo ERP — Super User' })).toBeInTheDocument();
    expect(screen.getByText('Demo Accounts')).toBeInTheDocument();
    expect(screen.getByText('Sign in with your department account.')).toBeInTheDocument();
    expect(screen.getByText('Department is verified from User Master')).toBeInTheDocument();
    expect(screen.getByText('ENTERPRISE ERP')).toBeInTheDocument();
    expect(screen.getByText('Authorised users only. All sign-ins are logged.')).toBeInTheDocument();
  });

  it('Show/Hide toggles the password visibility', async () => {
    await openLogin();
    const user = userEvent.setup();
    const pw = screen.getByLabelText('Password');
    expect(pw).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(pw).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveTextContent('Hide');
  });

  it('does not call the API when fields are empty', async () => {
    const { calls } = await openLogin();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign In to ERP' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your email / user ID and password.');
    expect(calls.filter((c) => c.path.endsWith('/auth/login'))).toHaveLength(0);
  });

  it('a double click sends one request and shows "Signing in…" while pending', async () => {
    let release: (r: Response) => void = () => undefined;
    const { calls } = await openLogin({
      [LOGIN]: () => new Promise<Response>((r) => (release = r)),
    });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email / User ID'), 'asha');
    await user.type(screen.getByLabelText('Password'), 'Wrong#Pass12');
    const btn = screen.getByRole('button', { name: 'Sign In to ERP' });
    // Two submits in the same tick, before React re-renders the disabled button.
    act(() => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    const pending = await screen.findByRole('button', { name: 'Signing in…' });
    expect(pending).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(calls.filter((c) => c.path.endsWith('/auth/login'))).toHaveLength(1);
    await act(async () => {
      release(apiError(401, 'INVALID_CREDENTIALS', 'Invalid login ID or password.'));
      await Promise.resolve();
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login ID or password.');
    expect(screen.getByRole('button', { name: 'Sign In to ERP' })).toBeEnabled();
  });

  it('Enter submits the form with the trimmed identifier', async () => {
    const { calls } = await openLogin({
      [LOGIN]: () => apiError(401, 'INVALID_CREDENTIALS', 'Invalid login ID or password.'),
    });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email / User ID'), '  asha ');
    await user.type(screen.getByLabelText('Password'), 'Secret#Pass1{Enter}');
    await screen.findByRole('alert');
    const call = calls.find((c) => c.path.endsWith('/auth/login'));
    expect(call?.body).toEqual({ identifier: 'asha', password: 'Secret#Pass1' });
  });

  it.each([
    [423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again in 15 minutes.'],
    [429, 'RATE_LIMITED', 'Too many requests. Try again in a minute.'],
  ])('shows the API message for %i', async (status, code, message) => {
    await openLogin({ [LOGIN]: () => apiError(status, code, message) });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email / User ID'), 'asha');
    await user.type(screen.getByLabelText('Password'), 'Secret#Pass1{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('Forgot tab explains admin reset and returns to Sign In', async () => {
    await openLogin();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(
      screen.getByText(
        'For security, passwords are reset by your administrator. Contact your Admin or the Super Admin with your login ID.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to Sign In' }));
    expect(screen.getByLabelText('Email / User ID')).toBeInTheDocument();
  });

  it('successful login goes to the ?next= page', async () => {
    mockFetch({
      [REFRESH]: anon,
      'GET /api/v1/health': anon,
      [LOGIN]: () => authOk(makeUser({ role: 'MEMBER', roleLabel: 'Member', department: 'Sales' })),
    });
    renderApp('/m/crm-leads');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email / User ID'), 'asha');
    await user.type(screen.getByLabelText('Password'), 'Secret#Pass1{Enter}');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Lead Management' })).toBeInTheDocument(),
    );
  });
});
