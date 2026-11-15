// The Bank Book "New Entry" form: paying a ledger account that needs a cost centre shows the cost centre field,
// asks for it before posting, and sends costCentreId with the payment.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { json, makeUser, permissionsRoute, renderApp, signedIn } from '../../test/helpers';

const owner = makeUser({ role: 'SUPER_ADMIN', roleLabel: 'Super Admin', name: 'Owner Person' });
const ALL = permissionsRoute({ view: true, add: true, edit: true, delete: true, approve: true });
const acct = (id: string, code: string, name: string, costCenterRequired: boolean) => ({
  id,
  code,
  name,
  rootType: 'Expense',
  isGroup: false,
  status: 'Active',
  version: 1,
  postingAllowed: true,
  costCenterRequired,
  partyRequired: false,
  controlSide: null,
  subType: 'Other',
  isSystem: false,
  parentId: null,
});
const page = (rows: unknown[]) =>
  json(200, { data: rows, meta: { page: 1, size: 200, total: rows.length } });

describe('Bank Book payment form', () => {
  it('asks for a cost centre when the account needs one and sends costCentreId', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/finance/bank-accounts': () =>
        json(200, { data: [{ id: 'b1', name: 'HDFC current', kind: 'BANK', unitId: 'u' }] }),
      'GET /api/v1/finance/books/b1': () =>
        json(200, {
          data: {
            account: { id: 'b1', name: 'HDFC current', kind: 'BANK' },
            opening: '0.00',
            totalReceipts: '0.00',
            totalPayments: '0.00',
            closing: '0.00',
            rows: [],
          },
        }),
      'GET /api/v1/finance/accounts': () =>
        page([acct('a-rent', '6201', 'Rent', true), acct('a-misc', '6299', 'Misc', false)]),
      'GET /api/v1/finance/cost-centers': () =>
        page([{ id: 'cc1', code: 'PLANT', name: 'Plant', unitId: 'u', isGroup: false, status: 'Active' }]),
      'POST /api/v1/finance/payments': () => json(200, { data: { id: 'p1', code: 'PAY/1', warnings: [] } }),
    });
    renderApp('/m/fin-bankbook');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: /New Entry/ }));
    const dlg = await screen.findByRole('dialog');
    await ue.selectOptions(within(dlg).getByLabelText('What happened? *'), 'PAYMENT');
    await ue.selectOptions(within(dlg).getByLabelText(/Paid for/), 'a-rent');
    expect(within(dlg).getByLabelText('Cost centre *')).toBeInTheDocument();
    await ue.type(within(dlg).getByLabelText('Amount *'), '500');
    // posting without it is stopped in the form, in plain words
    await ue.click(within(dlg).getByRole('button', { name: 'Post' }));
    expect(await within(dlg).findByText(/needs a cost centre/i)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/finance/payments'))).toBe(false);
    await ue.selectOptions(within(dlg).getByLabelText('Cost centre *'), 'cc1');
    await ue.click(within(dlg).getByRole('button', { name: 'Post' }));
    await screen.findByText(/PAY\/1 posted/);
    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/finance/payments'));
    expect(post?.body).toMatchObject({ counterAccountId: 'a-rent', costCentreId: 'cc1' });
  });
});
