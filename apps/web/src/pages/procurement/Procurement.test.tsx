// Phase 9 screens: the PO list shows Indian money and DD-MM-YYYY dates, the delivery tracking dialog marks a late line
// as Delayed, and the invoice matching tab explains a red line in plain words ("Billed 100, received 98").
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { json, makeUser, permissionsRoute, renderApp, signedIn } from '../../test/helpers';

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

const po = {
  id: 'po1',
  number: 'PO/TAL/26-27/0001',
  status: 'Approved',
  version: 3,
  supplierName: 'Steel Traders',
  poDate: '2026-11-05',
  grandTotal: '125000.00',
  revisionNo: 0,
  lines: [],
};

describe('Purchase Orders', () => {
  it('lists orders with ₹ and DD-MM-YYYY and opens delivery tracking', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/scm/po': () => json(200, { data: [po], meta: { page: 1, size: 20, total: 1 } }),
      'GET /api/v1/scm/po-delivery': () =>
        json(200, {
          data: [
            {
              id: 'l1',
              poId: 'po1',
              poNo: po.number,
              supplierName: 'Steel Traders',
              itemCode: 'SHAFT',
              partNo: 'P-77',
              poDate: '2026-11-05',
              leadDays: 5,
              expectedDate: '2026-11-08',
              poQty: '100',
              receivedQty: '40',
              balanceQty: '60',
              status: 'DELAYED',
            },
          ],
          meta: { page: 1, size: 200, total: 1 },
        }),
    });
    renderApp('/m/scm-po');
    expect(await screen.findByText(po.number)).toBeInTheDocument();
    expect(screen.getByText('₹ 1,25,000.00')).toBeInTheDocument();
    expect(screen.getByText('05-11-2026')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Delivery tracking' }));
    const dialog = await screen.findByRole('dialog', { name: /Delivery tracking/ });
    expect(await within(dialog).findByText('P-77')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Delayed').length).toBe(2); // the filter option and the status pill
    expect(within(dialog).getByText('60')).toBeInTheDocument();
  });

  it('shows a plain empty state when there is nothing yet', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/scm/po': () => json(200, { data: [], meta: { page: 1, size: 20, total: 0 } }),
    });
    renderApp('/m/scm-po');
    expect(await screen.findByText(/Nothing here yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New Purchase Order/ })).toBeInTheDocument();
  });
});

describe('Purchase Invoice matching', () => {
  it('shows the red line with its reason', async () => {
    const inv = {
      id: 'i1',
      number: 'PINV/TAL/26-27/0001',
      vendorInvoiceNo: 'S-1',
      supplierName: 'Steel Traders',
      invoiceDate: '2026-11-07',
      netPayable: '5835.00',
      matchState: 'ON_HOLD',
      status: 'Draft',
      version: 1,
      lines: [
        {
          id: 'il1',
          lineNo: 1,
          qty: '100',
          rate: '50.5',
          matchedValue: '4900',
          matchStatus: 'ERROR',
        },
      ],
      exceptions: [{ id: 'e1', lineId: 'il1', state: 'OPEN', message: 'Billed 100, received 98' }],
      readiness: {},
    };
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/scm/purchaseinvoice': () =>
        json(200, { data: [inv], meta: { page: 1, size: 50, total: 1 } }),
      'GET /api/v1/scm/purchaseinvoice/i1': () => json(200, { data: inv }),
    });
    renderApp('/m/scm-purchaseinvoice');
    await userEvent.setup().click(await screen.findByRole('button', { name: inv.number }));
    expect(await screen.findByText('Billed 100, received 98')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Payment Readiness' })).toBeInTheDocument();
  });
});
