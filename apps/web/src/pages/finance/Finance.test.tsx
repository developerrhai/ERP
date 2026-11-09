// Phase 7 finance screens: Indian money and DD-MM-YYYY dates, the journal form's live balance, plain-English
// errors under the fields, and the report screens reading what the API returns.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  apiError,
  countCalls,
  json,
  makeUser,
  permissionsRoute,
  renderApp,
  signedIn,
} from '../../test/helpers';
import { amt, dmy, inr } from './shared';

const owner = makeUser({ role: 'SUPER_ADMIN', roleLabel: 'Super Admin', name: 'Owner Person' });
const ALL = permissionsRoute({ view: true, add: true, edit: true, delete: true, approve: true });

const accounts = [
  {
    id: 'a-rent',
    code: '6201',
    name: 'Rent',
    rootType: 'Expense',
    isGroup: false,
    status: 'Active',
    version: 1,
    postingAllowed: true,
    costCenterRequired: true,
    partyRequired: false,
    controlSide: null,
    subType: 'Other',
    isSystem: true,
    parentId: null,
  },
  {
    id: 'a-bank',
    code: '1111',
    name: 'HDFC Bank Current A/c',
    rootType: 'Asset',
    isGroup: false,
    status: 'Active',
    version: 1,
    postingAllowed: true,
    costCenterRequired: false,
    partyRequired: false,
    controlSide: null,
    subType: 'Bank',
    isSystem: true,
    parentId: null,
  },
];

describe('format helpers', () => {
  it('shows rupees with Indian grouping and dates as DD-MM-YYYY', () => {
    expect(inr('125000')).toBe('₹ 1,25,000.00');
    expect(inr('1234567.5')).toBe('₹ 12,34,567.50');
    expect(inr(null)).toBe('—');
    expect(amt('0.00')).toBe('');
    expect(amt('2500')).toBe('2,500.00');
    expect(dmy('2026-11-06')).toBe('06-11-2026');
    expect(dmy(null)).toBe('—');
  });
});

describe('Trial Balance page', () => {
  it('shows the lines, the Indian format and a plain balanced notice', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/finance/reports/trial-balance': () =>
        json(200, {
          data: {
            asOf: '2026-11-06',
            totalDebit: '112000.00',
            totalCredit: '112000.00',
            balanced: true,
            lines: [
              {
                code: '1111',
                name: 'HDFC Bank Current A/c',
                debit: '100000.00',
                credit: '12000.00',
                closingDebit: '88000.00',
                closingCredit: '0.00',
              },
            ],
          },
        }),
    });
    renderApp('/m/fin-trial');
    await screen.findByRole('heading', { name: 'Trial Balance' });
    expect(await screen.findByText(/Balanced: ₹ 1,12,000.00 on both sides/)).toBeInTheDocument();
    const row = within(screen.getByRole('table')).getByText('HDFC Bank Current A/c').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('1,00,000.00')).toBeInTheDocument();
  });

  it('warns in plain English when it does not balance', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/finance/reports/trial-balance': () =>
        json(200, {
          data: {
            asOf: '2026-11-06',
            totalDebit: '10.00',
            totalCredit: '9.00',
            balanced: false,
            lines: [],
          },
        }),
    });
    renderApp('/m/fin-trial');
    expect(await screen.findByText(/does not balance/)).toBeInTheDocument();
    expect(await screen.findByText(/No postings yet/)).toBeInTheDocument();
  });
});

describe('Journal Entries page', () => {
  it('lists journals, and the form tells you the difference live and keeps Save from sending a bad journal', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/finance/journals': () =>
        json(200, {
          data: [
            {
              id: 'j1',
              code: 'JV/TAL/26-27/0001',
              unitId: 'u',
              voucherType: 'Journal',
              docDate: '2026-11-05',
              status: 'Posted',
              postingStatus: 'Posted',
              narration: 'Rent for November',
              referenceNo: null,
              totalDebit: '10000.00',
              totalCredit: '10000.00',
              reversalOfId: null,
              reversedById: null,
              version: 3,
              warnings: [],
              lines: [],
            },
          ],
          meta: { page: 1, size: 20, total: 1 },
        }),
      'GET /api/v1/finance/accounts': () =>
        json(200, { data: accounts, meta: { page: 1, size: 200, total: 2 } }),
      'GET /api/v1/finance/cost-centers': () =>
        json(200, { data: [], meta: { page: 1, size: 200, total: 0 } }),
    });
    renderApp('/m/fin-journal');
    await screen.findByRole('heading', { name: 'Journal Entries' });
    expect(await screen.findByText('JV/TAL/26-27/0001')).toBeInTheDocument();
    expect(screen.getByText('05-11-2026')).toBeInTheDocument();
    expect(screen.getByText('₹ 10,000.00')).toBeInTheDocument();
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: /New Journal/ }));
    const dlg = await screen.findByRole('dialog');
    await ue.type(within(dlg).getByLabelText('Line 1 debit'), '5000');
    await ue.type(within(dlg).getByLabelText('Line 2 credit'), '4999.5');
    expect(within(dlg).getByRole('status')).toHaveTextContent('Difference ₹ 0.50');
    await ue.click(within(dlg).getByRole('button', { name: 'Save Draft' }));
    expect(await within(dlg).findAllByText('Choose an account.')).toHaveLength(2);
    expect(countCalls(calls, 'POST', '/finance/journals')).toBe(0);
  });

  it('shows the server message when a journal is refused', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/finance/journals': () =>
        json(200, { data: [], meta: { page: 1, size: 20, total: 0 } }),
      'GET /api/v1/finance/accounts': () =>
        json(200, { data: accounts, meta: { page: 1, size: 200, total: 2 } }),
      'GET /api/v1/finance/cost-centers': () =>
        json(200, { data: [], meta: { page: 1, size: 200, total: 0 } }),
      'POST /api/v1/finance/journals': () =>
        apiError(409, 'PERIOD_CLOSED', 'Period November 2026 is closed for posting.'),
    });
    renderApp('/m/fin-journal');
    expect(await screen.findByText(/No journals yet/)).toBeInTheDocument();
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: /New Journal/ }));
    const dlg = await screen.findByRole('dialog');
    await ue.selectOptions(within(dlg).getByLabelText('Line 1 account'), 'a-bank');
    await ue.selectOptions(within(dlg).getByLabelText('Line 2 account'), 'a-rent');
    await ue.type(within(dlg).getByLabelText('Line 1 debit'), '100');
    await ue.type(within(dlg).getByLabelText('Line 2 credit'), '100');
    await ue.click(within(dlg).getByRole('button', { name: 'Save Draft' }));
    await waitFor(() =>
      expect(within(dlg).getByRole('alert')).toHaveTextContent(
        'Period November 2026 is closed for posting.',
      ),
    );
  });
});

describe('Chart of Accounts page', () => {
  it('lists accounts, hides Delete for system accounts and explains an empty search', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/finance/accounts': () =>
        json(200, { data: accounts, meta: { page: 1, size: 200, total: 2 } }),
    });
    renderApp('/m/fin-coa');
    await screen.findByRole('heading', { name: 'Chart of Accounts' });
    expect(await screen.findByText('HDFC Bank Current A/c')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete Rent/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Edit Rent/ })).toBeInTheDocument();
    await userEvent.setup().type(screen.getByLabelText('Search accounts'), 'zzz');
    expect(await screen.findByText(/No accounts found/)).toBeInTheDocument();
  });
});

describe('Budgeting and ageing pages', () => {
  it('shows an empty state that says what to do next', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/finance/budgets': () => json(200, { data: [] }),
      'GET /api/v1/finance/reports/ageing': () =>
        json(200, {
          data: {
            parties: [],
            total: {
              notDue: '0.00',
              d1_30: '0.00',
              d31_60: '0.00',
              d61_90: '0.00',
              d90plus: '0.00',
              total: '0.00',
            },
          },
        }),
    });
    renderApp('/m/fin-budget');
    expect(await screen.findByText(/No budgets yet\. Click/)).toBeInTheDocument();
  });

  it('Accounts Payable (Phase 9) shows the supplier ageing from /fin/ap/ageing', async () => {
    const buckets = {
      NOT_DUE: '250.00',
      '0-30': '0.00',
      '31-60': '500.00',
      '61-90': '0.00',
      '90+': '0.00',
    };
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/fin/ap/payables': () =>
        json(200, { data: { asOf: '2026-11-07', rows: [], suppliers: [] } }),
      'GET /api/v1/fin/ap/due-schedule': () => json(200, { data: [] }),
      'GET /api/v1/fin/ap/payments': () =>
        json(200, { data: [], meta: { page: 1, size: 50, total: 0 } }),
      'GET /api/v1/fin/ap/ageing': () =>
        json(200, {
          data: {
            asOf: '2026-11-07',
            totals: buckets,
            total: '750.00',
            suppliers: [{ supplierId: 's1', supplierName: 'Steel Traders', buckets }],
          },
        }),
    });
    renderApp('/m/fin-ap');
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'Ageing' }));
    expect(await screen.findByText('Steel Traders')).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/fin/ap/ageing'))).toBe(true);
    expect(screen.getAllByText('₹ 500.00').length).toBeGreaterThan(0);
  });
});
