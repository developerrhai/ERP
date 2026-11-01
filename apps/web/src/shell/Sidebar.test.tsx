// Sidebar now comes from GET /me/menu (Phase 2 §4): shows exactly what the server returns with
// registry titles/icons, refetches on refreshMenu(), and offers Retry when loading fails.
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { refreshMenu } from '../lib/menu';
import { apiError, countCalls, json, makeUser, renderApp, signedIn } from '../test/helpers';

const MENU = 'GET /api/v1/me/menu';

describe('server-driven sidebar', () => {
  it('shows only the families and items the server returns, with registry labels', async () => {
    signedIn(makeUser({ role: 'MEMBER', roleLabel: 'Member', department: 'Sales' }), {
      [MENU]: () =>
        json(200, {
          data: {
            families: [
              { name: 'CRM', icon: '?', items: [{ id: 'crm-leads', title: 'server title' }] },
            ],
          },
        }),
    });
    renderApp('/');
    const menu = await screen.findByLabelText('Main menu');
    const link = await within(menu).findByRole('link', { name: 'Lead Management' });
    expect(link).toHaveAttribute('href', '/m/crm-leads');
    expect(within(menu).getAllByRole('link')).toHaveLength(1);
    expect(within(menu).getByRole('button', { name: /◎ CRM/ })).toBeInTheDocument();
  });

  it('refetches when refreshMenu() is called (after admin saves)', async () => {
    let enabled = true;
    const { calls } = signedIn(makeUser(), {
      [MENU]: () =>
        json(200, {
          data: {
            families: [
              {
                name: 'Sales',
                icon: '₹',
                items: enabled ? [{ id: 'sales-orders', title: 'Sales Orders' }] : [],
              },
            ].filter((f) => f.items.length),
          },
        }),
    });
    renderApp('/');
    const menu = await screen.findByLabelText('Main menu');
    await within(menu).findByRole('link', { name: 'Sales Orders' });
    enabled = false;
    await act(async () => {
      await refreshMenu();
    });
    expect(within(menu).queryByRole('link', { name: 'Sales Orders' })).toBeNull();
    expect(countCalls(calls, 'GET', '/me/menu')).toBeGreaterThanOrEqual(2);
  });

  it('shows an error with Retry when the menu cannot be loaded', async () => {
    let fail = true;
    signedIn(makeUser(), {
      [MENU]: () =>
        fail
          ? apiError(500, 'INTERNAL', 'Something went wrong.')
          : json(200, {
              data: {
                families: [{ name: 'CRM', icon: '◎', items: [{ id: 'crm-leads', title: 'x' }] }],
              },
            }),
    });
    renderApp('/');
    const menu = await screen.findByLabelText('Main menu');
    expect(await within(menu).findByRole('alert')).toHaveTextContent('Something went wrong.');
    fail = false;
    await userEvent.setup().click(within(menu).getByRole('button', { name: 'Retry' }));
    expect(await within(menu).findByRole('link', { name: 'Lead Management' })).toBeInTheDocument();
  });
});
