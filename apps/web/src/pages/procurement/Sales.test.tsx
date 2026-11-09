// Phase 10 screens: the pipeline board shows stages with weighted value and asks why before Lost; the lead page offers
// the next legal action only; collections lists unpaid invoices with days late; credit limits flag an over-limit customer.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  json,
  makeUser,
  permissionsRoute,
  renderApp,
  signedIn,
  countCalls,
} from '../../test/helpers';

const owner = makeUser({ role: 'SUPER_ADMIN', roleLabel: 'Super Admin', name: 'Owner Person' });
const ALL = permissionsRoute({
  view: true,
  add: true,
  edit: true,
  delete: true,
  approve: true,
  submit: true,
  post: true,
  cancel: true,
});

describe('Sales Pipeline', () => {
  it('shows stages and asks for a reason before an opportunity is marked Lost', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/crm/pipeline': () =>
        json(200, {
          data: {
            stages: [
              {
                stage: 'Prospecting',
                count: 1,
                amount: '50000.00',
                weighted: '5000.00',
                items: [{ id: 'o1', title: 'Brackets', customerName: 'Acme', amount: '50000.00' }],
              },
              { stage: 'Qualification', count: 0, amount: '0', weighted: '0', items: [] },
              { stage: 'Won', count: 0, amount: '0', weighted: '0', items: [] },
              { stage: 'Lost', count: 0, amount: '0', weighted: '0', items: [] },
            ],
          },
        }),
      'POST /api/v1/crm/opportunities/o1/move-stage': () =>
        json(200, { data: { id: 'o1', version: 2, status: 'Lost' } }),
    });
    renderApp('/m/crm-pipeline');
    expect(await screen.findByText('Brackets')).toBeInTheDocument();
    expect(screen.getByText('₹ 50,000.00 · weighted ₹ 5,000.00')).toBeInTheDocument();
    const ue = userEvent.setup();
    await ue.selectOptions(screen.getByLabelText('Move Brackets'), 'Lost');
    const dialog = await screen.findByRole('dialog', { name: /Lost: Brackets/ });
    const ok = within(dialog).getByRole('button', { name: 'Mark lost' });
    expect(ok).toBeDisabled();
    await ue.type(within(dialog).getByLabelText(/Why was it lost/), 'Price too high');
    await ue.click(ok);
    await screen.findByText('Brackets');
    expect(countCalls(calls, 'POST', '/crm/opportunities/o1/move-stage')).toBe(1);
  });
});

describe('Lead Management', () => {
  it('a new lead offers Contacted / Qualified / Not qualified but not Convert yet', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/crm/leads': () =>
        json(200, {
          data: [
            { id: 'l1', number: 'LD/TAL/26-27/0001', name: 'Ravi', status: 'New', version: 1 },
          ],
          meta: { page: 1, size: 20, total: 1 },
        }),
      'GET /api/v1/crm/leads/l1': () =>
        json(200, {
          data: {
            id: 'l1',
            number: 'LD/TAL/26-27/0001',
            name: 'Ravi',
            status: 'New',
            version: 1,
            lines: [],
          },
        }),
    });
    renderApp('/m/crm-leads');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'LD/TAL/26-27/0001' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Mark Qualified' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Not qualified' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Convert to opportunity' })).toBeNull();
  });
});

describe('Collections and Credit Limits', () => {
  it('collections shows days late and credit shows an over-limit customer', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/sales/collections/outstanding': () =>
        json(200, {
          data: {
            asOf: '2026-11-08',
            rows: [
              {
                id: 'i1',
                number: 'INV/TAL/26-27/0001',
                customerName: 'Acme',
                customerId: 'c1',
                dueDate: '2026-10-01',
                daysOverdue: 38,
                outstanding: '1180.00',
              },
            ],
            customers: [],
          },
        }),
      'GET /api/v1/sales/credit/overview': () =>
        json(200, {
          data: [
            {
              id: 'c1',
              name: 'Acme',
              creditLimit: '100000.00',
              receivable: '90000.00',
              openOrders: '20000.00',
              exposure: '110000.00',
              available: '-10000.00',
              onHold: true,
            },
          ],
        }),
    });
    renderApp('/m/sales-collections');
    expect(await screen.findByText('INV/TAL/26-27/0001')).toBeInTheDocument();
    expect(screen.getByText('38')).toBeInTheDocument();
    expect(screen.getByText('01-10-2026')).toBeInTheDocument();
  });

  it('credit limits flag the customer who is over', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/sales/credit/overview': () =>
        json(200, {
          data: [
            {
              id: 'c1',
              name: 'Acme',
              creditLimit: '100000.00',
              receivable: '90000.00',
              openOrders: '20000.00',
              exposure: '110000.00',
              available: '-10000.00',
              onHold: true,
            },
          ],
        }),
    });
    renderApp('/m/sales-credit');
    expect(await screen.findByText('Over limit')).toBeInTheDocument();
  });
});
