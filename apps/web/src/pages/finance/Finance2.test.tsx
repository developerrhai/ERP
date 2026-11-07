// Phase 7 part 2 screens: credit / debit notes, expense claims, cash flow, tax registers, TDS challan,
// period close & year-end, recurring journals and exchange rates.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, countCalls, json, makeUser, renderApp, signedIn } from '../../test/helpers';
import type { Handler } from '../../test/helpers';

const owner = makeUser({ role: 'SUPER_ADMIN', roleLabel: 'Super Admin', name: 'Owner Person' });
const ALL: Handler = (call) => {
  const pageId = new URL(call.url, 'http://test').searchParams.get('pageId') ?? '';
  const names = [
    'view',
    'add',
    'edit',
    'delete',
    'approve',
    'export',
    'controls',
    'submit',
    'post',
    'cancel',
    'print',
    'import',
  ];
  return json(200, {
    data: { pageId, actions: Object.fromEntries(names.map((a) => [a, true])), scope: 'ALL' },
  });
};
const page = (rows: unknown[]) =>
  json(200, { data: rows, meta: { page: 1, size: 20, total: rows.length } });

const note = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  code: 'DRAFT-1a2b',
  kind: 'CREDIT',
  effect: 'REDUCE',
  partyId: 'c1',
  partyName: 'Acme Fabrication',
  docDate: '2026-11-05',
  amount: '1200.00',
  reason: 'Agreed discount',
  againstDocNo: null,
  status: 'Draft',
  version: 1,
  counterAccountId: 'a1',
  ...over,
});

describe('Credit Notes page', () => {
  it('lists notes with their effect, posts a Draft and says what to do when empty', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/finance/credit-notes': () =>
        page([note(), note({ id: 'n2', code: 'CRN/TAL/26-27/0001', status: 'Posted' })]),
      'POST /api/v1/finance/credit-notes/n1/post': () =>
        json(200, { data: note({ status: 'Posted' }) }),
    });
    renderApp('/m/fin-creditnote');
    await screen.findByRole('heading', { name: 'Credit Notes' });
    expect(await screen.findByText('CRN/TAL/26-27/0001')).toBeInTheDocument();
    expect(screen.getAllByText('Reduces the balance')).toHaveLength(2);
    expect(screen.getAllByText('₹ 1,200.00').length).toBeGreaterThan(0);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(countCalls(calls, 'POST', '/credit-notes/n1/post')).toBe(1));
    expect(calls.find((c) => c.path.endsWith('/post'))?.headers['If-Match']).toBe('"1"');
    expect(await screen.findByText('Note posted.')).toBeInTheDocument();
  });

  it('the new-note form asks for the missing pieces in plain English before calling the server', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/finance/debit-notes': () => page([]),
      'GET /api/v1/suppliers': () => page([]),
      'GET /api/v1/finance/accounts': () => page([]),
    });
    renderApp('/m/fin-debitnote');
    expect(await screen.findByText(/No notes yet/)).toBeInTheDocument();
    const ue = userEvent.setup();
    await ue.click(screen.getByRole('button', { name: /New Debit Note/ }));
    const dlg = await screen.findByRole('dialog');
    await ue.click(within(dlg).getByRole('button', { name: 'Save Draft' }));
    expect(await within(dlg).findByText('Choose the supplier.')).toBeInTheDocument();
    expect(within(dlg).getByText('Enter an amount greater than 0.')).toBeInTheDocument();
    expect(within(dlg).getByText('Give a reason of at least 5 characters.')).toBeInTheDocument();
    expect(countCalls(calls, 'POST', '/debit-notes')).toBe(0);
  });
});

describe('Expense Management page', () => {
  const claim = (over: Record<string, unknown> = {}) => ({
    id: 'e1',
    code: 'EXP/TAL/26-27/0001',
    employee: 'Manoj Kale',
    claimDate: '2026-11-05',
    category: 'Travel',
    amount: '6000.00',
    description: 'Client visit, Pune',
    billNo: null,
    status: 'Draft',
    warnings: [{ code: 'OVER_CLAIM_LIMIT', message: 'Above the ₹ 5,000.00 limit for Travel.' }],
    version: 2,
    ...over,
  });
  const policies = [
    {
      category: 'Travel',
      perClaimLimit: '5000.00',
      perMonthLimit: '25000.00',
      approvalLimit: '15000.00',
      defaultAccountId: null,
      version: 1,
    },
  ];

  it('shows the claim, its warning, and Submit sends it for approval', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/finance/expenses': () =>
        page([claim(), claim({ id: 'e2', code: 'EXP/TAL/26-27/0002', status: 'Approved' })]),
      'GET /api/v1/finance/expense-policies': () => json(200, { data: policies }),
      'POST /api/v1/finance/expenses/e1/submit': () =>
        json(200, { data: claim({ status: 'Pending Approval' }) }),
    });
    renderApp('/m/fin-expenses');
    await screen.findByRole('heading', { name: 'Expense Management' });
    expect(await screen.findByText('EXP/TAL/26-27/0001')).toBeInTheDocument();
    expect(screen.getAllByText(/Above the ₹ 5,000.00 limit/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Pay' })).toBeInTheDocument(); // the approved one
    await userEvent.setup().click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Sent for approval.')).toBeInTheDocument();
    expect(calls.find((c) => c.path.endsWith('/e1/submit'))?.headers['If-Match']).toBe('"2"');
  });

  it('the Limits tab lists the category limits and an approver can edit them', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/finance/expenses': () => page([]),
      'GET /api/v1/finance/expense-policies': () => json(200, { data: policies }),
      'PUT /api/v1/finance/expense-policies/Travel': () => json(200, { data: policies[0] }),
    });
    renderApp('/m/fin-expenses');
    const ue = userEvent.setup();
    expect(await screen.findByText(/No claims yet/)).toBeInTheDocument();
    await ue.click(screen.getByRole('tab', { name: 'Limits' }));
    expect(await screen.findByText('₹ 25,000.00')).toBeInTheDocument();
    await ue.click(screen.getByRole('button', { name: 'Edit Travel limits' }));
    const dlg = await screen.findByRole('dialog');
    const claimLimit = within(dlg).getByLabelText('Per claim');
    await ue.clear(claimLimit);
    await ue.type(claimLimit, '6000');
    await ue.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Limit saved.')).toBeInTheDocument();
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.headers['If-Match']).toBe('"1"');
    expect((put?.body as { perClaimLimit: string }).perClaimLimit).toBe('6000');
  });
});

describe('Cash Flow page', () => {
  it('shows the three sections and proves the total', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/finance/reports/cash-flow': () =>
        json(200, {
          data: {
            from: '2026-04-01',
            to: '2026-11-06',
            netChange: '110000.00',
            openingCash: '0.00',
            closingCash: '110000.00',
            reconciles: true,
            operating: {
              netProfit: '60000.00',
              total: '40000.00',
              items: [{ code: '1201', name: 'Trade Receivables - Domestic', amount: '-20000.00' }],
            },
            investing: {
              total: '-30000.00',
              items: [{ code: '1603', name: 'Plant and Machinery', amount: '-30000.00' }],
            },
            financing: {
              total: '100000.00',
              items: [{ code: '3001', name: 'Equity Share Capital', amount: '100000.00' }],
            },
          },
        }),
    });
    renderApp('/m/fin-cashflow');
    await screen.findByRole('heading', { name: 'Cash Flow' });
    expect(await screen.findByText('Operating activities')).toBeInTheDocument();
    expect(screen.getByText('Net profit for the period')).toBeInTheDocument();
    expect(screen.getAllByText('₹ 1,10,000.00').length).toBeGreaterThan(0);
    expect(screen.getByText(/Plant and Machinery/)).toBeInTheDocument();
    expect(screen.queryByText(/does not add up/)).toBeNull();
  });
});

describe('Tax registers', () => {
  it('the sales register shows the totals and the GSTIN (or Unregistered)', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/finance/tax/sales-register': () =>
        json(200, {
          data: {
            totals: {
              taxable: '10000.00',
              cgst: '900.00',
              sgst: '900.00',
              igst: '0.00',
              cess: '0.00',
            },
            rows: [
              {
                id: 'r1',
                docKind: 'INV',
                docNo: 'TAL/2627/00001',
                docDate: '2026-11-05',
                partyName: 'Acme',
                partyGstin: '27AAAPA1001A1ZB',
                placeOfSupply: '27',
                taxable: '10000.00',
                cgst: '900.00',
                sgst: '900.00',
                igst: '0.00',
                cess: '0.00',
                status: 'Active',
              },
              {
                id: 'r2',
                docKind: 'INV',
                docNo: 'TAL/2627/00002',
                docDate: '2026-11-05',
                partyName: 'Walk-in buyer',
                partyGstin: null,
                placeOfSupply: '27',
                taxable: '0.00',
                cgst: '0.00',
                sgst: '0.00',
                igst: '0.00',
                cess: '0.00',
                status: 'Cancelled',
              },
            ],
          },
        }),
    });
    renderApp('/m/tax-salesreg');
    await screen.findByRole('heading', { name: 'Sales Register' });
    expect(await screen.findByText('TAL/2627/00001')).toBeInTheDocument();
    expect(screen.getByText('27AAAPA1001A1ZB')).toBeInTheDocument();
    expect(screen.getByText('Unregistered')).toBeInTheDocument();
    expect(screen.getAllByText('₹ 900.00').length).toBeGreaterThan(0);
  });

  it('TDS: tick an undeposited entry to enable "Record challan"; the form posts it', async () => {
    const reg = {
      totalDeducted: '2000.00',
      pendingDeposit: '2000.00',
      rows: [
        {
          id: 't1',
          sectionCode: '194C',
          supplier: 'TDS Contractor',
          baseAmount: '100000.00',
          ratePct: '2',
          tdsAmount: '2000.00',
          deductedOn: '2026-11-05',
          docNo: 'JW-1',
          challanNo: null,
          status: 'Active',
        },
      ],
    };
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/finance/tax/tds-register': () => json(200, { data: reg }),
      'GET /api/v1/finance/tax/challans': () => json(200, { data: [] }),
      'GET /api/v1/finance/bank-accounts': () =>
        json(200, { data: [{ id: 'b1', name: 'HDFC current', kind: 'BANK', unitId: 'u' }] }),
      'POST /api/v1/finance/tax/challans': () =>
        json(201, { data: { challanNo: 'CH-1', amount: '2000.00' } }),
    });
    renderApp('/m/tax-tds');
    await screen.findByRole('heading', { name: 'TDS' });
    const ue = userEvent.setup();
    const btn = await screen.findByRole('button', { name: /Record challan/ });
    expect(btn).toBeDisabled();
    await ue.click(screen.getByRole('checkbox', { name: /TDS Contractor/ }));
    expect(btn).toBeEnabled();
    await ue.click(btn);
    const dlg = await screen.findByRole('dialog');
    await ue.selectOptions(within(dlg).getByLabelText('Paid from *'), 'b1');
    await ue.type(within(dlg).getByLabelText('Challan number *'), 'CH-1');
    await ue.click(within(dlg).getByRole('button', { name: 'Post challan' }));
    expect(await screen.findByText('Challan recorded and posted.')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/tax/challans'));
    expect((post?.body as { entryIds: string[] }).entryIds).toEqual(['t1']);
  });
});

describe('Period close & year-end', () => {
  it('shows why a month cannot close, closes a clean month and explains the year-end before it happens', async () => {
    const fy = {
      id: 'fy1',
      code: '2026-27',
      label: 'FY',
      startDate: '2026-04-01',
      endDate: '2027-03-31',
      status: 'OPEN',
      isCurrent: true,
      version: 1,
    };
    const periods = [
      {
        id: 'p4',
        periodNo: 4,
        label: 'July 2026',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        status: 'OPEN',
        version: 1,
        draftJournals: 2,
        openBankStatements: 0,
      },
      {
        id: 'p5',
        periodNo: 5,
        label: 'August 2026',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        status: 'OPEN',
        version: 3,
        draftJournals: 0,
        openBankStatements: 0,
      },
    ];
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/financial-years': () => json(200, { data: [fy] }),
      'GET /api/v1/finance/close/fy1': () =>
        json(200, {
          data: {
            fy: { id: 'fy1', code: '2026-27', status: 'OPEN', yearEndPosted: false },
            periods,
            preview: {
              draftJournals: 0,
              units: [{ unitId: 'u1', unit: 'TAL', netProfit: '70000.00' }],
            },
          },
        }),
      'POST /api/v1/finance/close/periods/p5/close': () =>
        json(200, { data: { ...periods[1], status: 'CLOSED' } }),
      'POST /api/v1/finance/close/fy1/year-end': () =>
        json(200, { data: { closings: [{ netProfit: '70000.00' }], version: 1 } }),
    });
    renderApp('/m/admin-fy/close');
    await screen.findByRole('heading', { name: 'Period Close & Year-End' });
    expect(await screen.findByText('2 draft journal(s)')).toBeInTheDocument();
    const ue = userEvent.setup();
    const july = within(screen.getByText('July 2026').closest('tr') as HTMLElement).getByRole(
      'button',
      { name: 'Close month' },
    );
    expect(july).toBeDisabled();
    expect(july).toHaveAttribute('title', expect.stringContaining('2 draft journal(s)'));
    await ue.click(
      within(screen.getByText('August 2026').closest('tr') as HTMLElement).getByRole('button', {
        name: 'Close month',
      }),
    );
    expect(await screen.findByText('August 2026 closed.')).toBeInTheDocument();
    expect(calls.find((c) => c.path.endsWith('/p5/close'))?.headers['If-Match']).toBe('"3"');
    expect(screen.getByText('₹ 70,000.00')).toBeInTheDocument();
    await ue.click(screen.getByRole('button', { name: /Close the year 2026-27/ }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/nobody can post to/)).toBeInTheDocument();
    await ue.click(within(dlg).getByRole('button', { name: 'Close the year' }));
    expect(await screen.findByText('2026-27 closed.')).toBeInTheDocument();
    expect(countCalls(calls, 'POST', '/year-end')).toBe(1);
  });

  it('a server refusal is shown in plain English', async () => {
    const fy = {
      id: 'fy1',
      code: '2026-27',
      label: 'FY',
      startDate: '2026-04-01',
      endDate: '2027-03-31',
      status: 'OPEN',
      isCurrent: true,
      version: 1,
    };
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/financial-years': () => json(200, { data: [fy] }),
      'GET /api/v1/finance/close/fy1': () =>
        json(200, {
          data: {
            fy: { id: 'fy1', code: '2026-27', status: 'OPEN', yearEndPosted: false },
            periods: [
              {
                id: 'p1',
                periodNo: 1,
                label: 'April 2026',
                startDate: '2026-04-01',
                endDate: '2026-04-30',
                status: 'OPEN',
                version: 1,
                draftJournals: 0,
                openBankStatements: 0,
              },
            ],
            preview: { draftJournals: 0, units: [] },
          },
        }),
      'POST /api/v1/finance/close/periods/p1/close': () =>
        apiError(
          409,
          'CLOSE_BLOCKED',
          'April 2026 cannot be closed: 1 bank statement(s) are not reconciled.',
        ),
    });
    renderApp('/m/admin-fy/close');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Close month' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not reconciled');
  });
});

describe('Journal helpers', () => {
  it('Recurring lists the templates and "Run what is due" reports what it made', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/finance/journals': () => page([]),
      'GET /api/v1/finance/fx-rates': () => page([]),
      'GET /api/v1/finance/recurring': () =>
        json(200, {
          data: [
            {
              id: 'r1',
              name: 'Monthly rent',
              frequency: 'MONTHLY',
              nextRun: '2026-11-30',
              endDate: null,
              autoPost: false,
              reverseNextDay: false,
              status: 'Active',
              runs: 2,
              version: 1,
              lines: [],
            },
          ],
        }),
      'POST /api/v1/finance/recurring/run': () =>
        json(200, {
          data: {
            created: [
              { template: 'Monthly rent', code: 'DRAFT-1', date: '2026-10-30', posted: false },
            ],
            reversed: [],
            failures: [],
          },
        }),
    });
    renderApp('/m/fin-journal');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'Recurring' }));
    const dlg = await screen.findByRole('dialog');
    expect(await within(dlg).findByText('Monthly rent')).toBeInTheDocument();
    expect(within(dlg).getByText('Every month')).toBeInTheDocument();
    expect(within(dlg).getByText('Saved as a Draft')).toBeInTheDocument();
    await ue.click(within(dlg).getByRole('button', { name: 'Run what is due' }));
    expect(
      await within(dlg).findByText(/1 journal\(s\) created, 0 accrual\(s\) reversed/),
    ).toBeInTheDocument();
    expect(countCalls(calls, 'POST', '/recurring/run')).toBe(1);
  });

  it('Exchange rates saves a rate and the revaluation check shows the gain', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/finance/journals': () => page([]),
      'GET /api/v1/finance/fx-rates': () =>
        page([{ id: 'x1', currencyCode: 'USD', rateDate: '2026-11-05', rate: '84.500000' }]),
      'PUT /api/v1/finance/fx-rates': () =>
        json(200, {
          data: { id: 'x2', currencyCode: 'USD', rateDate: '2026-11-06', rate: '84.600000' },
        }),
      'GET /api/v1/finance/reports/fx-revaluation': () =>
        json(200, {
          data: {
            asOf: '2026-11-06',
            unrealisedGain: '1300.00',
            unrealisedLoss: '0.00',
            net: '1300.00',
            lines: [
              {
                itemId: 'i1',
                docNo: 'EXP-1',
                currency: 'USD',
                foreignOutstanding: '1000.00',
                rate: '84.500000',
                carrying: '83200.00',
                revalued: '84500.00',
                difference: '1300.00',
                result: 'Gain',
              },
            ],
          },
        }),
    });
    renderApp('/m/fin-journal');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'Exchange rates' }));
    const dlg = await screen.findByRole('dialog');
    expect(await within(dlg).findByText('84.5000')).toBeInTheDocument();
    await ue.type(within(dlg).getByLabelText('Rate (INR)'), '84.6');
    await ue.click(within(dlg).getByRole('button', { name: 'Save rate' }));
    expect(await screen.findByText('Rate saved.')).toBeInTheDocument();
    expect((calls.find((c) => c.method === 'PUT')?.body as { rate: string }).rate).toBe('84.6');
    await ue.click(within(dlg).getByRole('button', { name: 'Check open foreign bills' }));
    expect(await within(dlg).findByText('EXP-1')).toBeInTheDocument();
    expect(within(dlg).getByText(/Gain ₹ 1,300.00/)).toBeInTheDocument();
  });
});

describe('Finance Approval Limits (administrator setting)', () => {
  const limits = { journalApprovalThreshold: '500000.00', noteApprovalThreshold: null };

  it('shows the current limits in words and saves a changed one, clearing the other', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/finance/approval-limits': () => json(200, { data: limits }),
      'PUT /api/v1/finance/approval-limits': () =>
        json(200, {
          data: { journalApprovalThreshold: '250000.00', noteApprovalThreshold: '50000.00' },
        }),
    });
    renderApp('/m/admin-settings/finance-limits');
    await screen.findByRole('heading', { name: 'Finance Approval Limits' });
    expect(
      await screen.findByText(/₹ 5,00,000.00 or more goes to the approver first/),
    ).toBeInTheDocument();
    expect(screen.getByText(/No limit set: notes are posted without approval/)).toBeInTheDocument();
    const ue = userEvent.setup();
    const j = screen.getByLabelText(/Manual journals/);
    await ue.clear(j);
    await ue.type(j, '250000');
    await ue.type(screen.getByLabelText(/Credit and debit notes/), '50000');
    await ue.click(screen.getByRole('button', { name: 'Save limits' }));
    expect(await screen.findByText('Approval limits saved.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      journalApprovalThreshold: '250000',
      noteApprovalThreshold: '50000',
    });
  });

  it('refuses a non-number before calling the server, and an empty box clears the limit', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/finance/approval-limits': () => json(200, { data: limits }),
      'PUT /api/v1/finance/approval-limits': () =>
        json(200, { data: { journalApprovalThreshold: null, noteApprovalThreshold: null } }),
    });
    renderApp('/m/admin-settings/finance-limits');
    const ue = userEvent.setup();
    const j = await screen.findByLabelText(/Manual journals/);
    await waitFor(() => expect(j).toHaveValue('500000.00'));
    await ue.clear(j);
    await ue.type(j, 'abc');
    await ue.click(screen.getByRole('button', { name: 'Save limits' }));
    expect(
      await screen.findByText(/Enter an amount like 500000 or leave it empty/),
    ).toBeInTheDocument();
    expect(countCalls(calls, 'PUT', '/approval-limits')).toBe(0);
    await ue.clear(j);
    await ue.click(screen.getByRole('button', { name: 'Save limits' }));
    await waitFor(() => expect(countCalls(calls, 'PUT', '/approval-limits')).toBe(1));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      journalApprovalThreshold: null,
      noteApprovalThreshold: null,
    });
  });

  it('someone without the controls right sees the limits but cannot change them', async () => {
    const view: Handler = (call) => {
      const pageId = new URL(call.url, 'http://test').searchParams.get('pageId') ?? '';
      return json(200, {
        data: { pageId, actions: { view: true, controls: false }, scope: 'ALL' },
      });
    };
    signedIn(owner, {
      'GET /api/v1/me/permissions': view,
      'GET /api/v1/finance/approval-limits': () => json(200, { data: limits }),
    });
    renderApp('/m/admin-settings/finance-limits');
    expect(await screen.findByLabelText(/Manual journals/)).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save limits' })).toBeNull();
    expect(
      screen.getByText(/Only the Super User or an Administrator can change these limits/),
    ).toBeInTheDocument();
  });
});
