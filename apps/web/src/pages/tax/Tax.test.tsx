// Phase 11 screens: GSTR-1 lists the checks and keeps the file button off while there are errors; the e-invoice page
// only accepts a 64-character IRN; GSTR-3B shows the output tax, ITC and what is payable in cash.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  countCalls,
  json,
  makeUser,
  permissionsRoute,
  renderApp,
  signedIn,
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

const gstr1 = (canPrepare: boolean) => ({
  gstin: '27AAAAA1234F1Z5',
  unit: 'Talwade',
  month: '2026-11',
  status: { status: 'Not filed', arn: null },
  canPrepare,
  issues: canPrepare
    ? []
    : [{ level: 'error', doc: 'INV TAL/26-27/0001', message: 'A line has no HSN / SAC code.' }],
  summary: { b2b: { count: 1, taxable: '1000.00', igst: '0.00', cgst: '90.00', sgst: '90.00' } },
  b2b: [
    {
      docNo: 'TAL/26-27/0001',
      date: '2026-11-02',
      customer: 'Acme',
      gstin: '27BBBBB1234F1Z5',
      value: '1180.00',
      taxable: '1000.00',
    },
  ],
  cdnr: [],
  hsn: [],
});

describe('GSTR-1', () => {
  it('shows the errors and keeps the file button off', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/tax/gstr1': () => json(200, { data: gstr1(false) }),
    });
    renderApp('/m/tax-gstr1');
    expect(await screen.findByText(/A line has no HSN/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download GSTR-1 JSON' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mark as filed' })).toBeDisabled();
    expect(screen.getByText('TAL/26-27/0001')).toBeInTheDocument();
  });

  it('is ready when there is no error', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/tax/gstr1': () => json(200, { data: gstr1(true) }),
    });
    renderApp('/m/tax-gstr1');
    expect(await screen.findByText('No problems found.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download GSTR-1 JSON' })).toBeEnabled();
  });
});

describe('E-Invoice', () => {
  it('accepts an IRN only when it has 64 characters and then records it', async () => {
    const { calls } = signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/tax/einvoice/pending': () =>
        json(200, {
          data: {
            enabled: true,
            reportWithinDays: 30,
            rows: [
              {
                docType: 'INV',
                id: 'i1',
                docNo: 'TAL/26-27/0001',
                date: '2026-11-02',
                customer: 'Acme',
                gstin: 'x',
                total: '1180.00',
                ageDays: 3,
                late: false,
              },
            ],
          },
        }),
      'GET /api/v1/tax/einvoice/records': () => json(200, { data: [] }),
      'POST /api/v1/tax/einvoice': () => json(200, { data: { id: 'e1', version: 1 } }),
    });
    renderApp('/m/tax-einvoice');
    const ue = userEvent.setup();
    await ue.click(await screen.findByRole('button', { name: 'Enter IRN' }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: 'Save IRN' });
    await ue.type(within(dialog).getByLabelText(/IRN \(64/), 'abc');
    await ue.type(within(dialog).getByLabelText(/Acknowledgement no/), '112233445566');
    expect(save).toBeDisabled();
    await ue.clear(within(dialog).getByLabelText(/IRN \(64/));
    await ue.type(within(dialog).getByLabelText(/IRN \(64/), 'a'.repeat(64));
    expect(save).toBeEnabled();
    await ue.click(save);
    await screen.findByRole('button', { name: 'Enter IRN' });
    expect(countCalls(calls, 'POST', '/tax/einvoice')).toBe(1);
  });
});

describe('GSTR-3B', () => {
  it('shows output tax, the ITC and the cash payable', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/tax/gstr3b': () =>
        json(200, {
          data: {
            gstin: '27AAAAA1234F1Z5',
            month: '2026-11',
            dueDate: '2026-12-20',
            status: { status: 'Not filed', arn: null },
            issues: [],
            s31: {
              a_taxable: { taxable: '1300.00', igst: '0.00', cgst: '117.00', sgst: '117.00' },
            },
            s4: { c_net: { igst: '0.00', cgst: '90.00', sgst: '90.00' } },
            s51: { interest: '0.00', lateFee: '0.00', daysLate: 0 },
            s61: { cashPayable: { igst: '0.00', cgst: '27.00', sgst: '27.00' } },
          },
        }),
    });
    renderApp('/m/tax-gstr3b');
    expect(await screen.findByText('3.1(a) Taxable outward supplies')).toBeInTheDocument();
    expect(screen.getByText('4C Net ITC available')).toBeInTheDocument();
    expect(screen.getByText('Payable in cash')).toBeInTheDocument();
  });
});
