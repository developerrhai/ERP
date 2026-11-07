// Phase 8 inventory screens: vouchers with lines (status-driven buttons, plain-English field errors, Indian format),
// batches with the Quality Inspection quantity, the weekly powder sheet and the scan page.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  apiError,
  json,
  makeUser,
  permissionsRoute,
  renderApp,
  signedIn,
} from '../../test/helpers';
import { qty } from './shared';

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
  controls: true,
});

const line = {
  id: 'l1',
  lineNo: 1,
  item: { id: 'i1', code: 'PWD-RED', name: 'Red powder', baseUom: 'Kg' },
  qty: 25,
  enteredQty: 25,
  uom: null,
  unitCost: 100,
  value: 2500,
  stockStatus: 'QUALITY_INSPECTION',
  batchNo: 'B-9',
  batchId: 'b1',
  mfgDate: '2026-10-01',
  expiryDate: '2027-10-01',
  serialNos: [],
  binId: null,
  countedQty: null,
  systemQty: null,
  varianceQty: null,
  reasonCode: null,
  remarks: null,
  dispatchedQty: null,
  receivedQty: null,
  reservationId: null,
};
const voucher = (id: string, status: string, number: string) => ({
  id,
  kind: 'TRANSACTION',
  pageId: 'inv-transactions',
  number,
  status,
  postingDate: '2026-11-06',
  warehouse: { id: 'w1', code: 'TAL-MAIN', name: 'Talwade Main Store' },
  toWarehouse: null,
  txType: 'Receipt',
  reference: null,
  narration: null,
  vehicleRef: null,
  expectedReceipt: null,
  totalQty: 25,
  totalValue: 125000,
  version: 2,
  cancelReason: null,
  lines: [line],
});

describe('format', () => {
  it('quantities use Indian grouping', () => {
    expect(qty(1250000.5)).toBe('12,50,000.5');
    expect(qty(null)).toBe('—');
  });
});

describe('Inventory Transactions (vouchers with lines)', () => {
  it('offers the right button for each status and shows the value in rupees', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/inventory/vouchers/transactions': () =>
        json(200, {
          data: [
            voucher('v1', 'Draft', 'TXN/TAL/26-27/0001'),
            voucher('v2', 'Approved', 'TXN/TAL/26-27/0002'),
            voucher('v3', 'Posted', 'TXN/TAL/26-27/0003'),
          ],
          meta: { page: 1, size: 20, total: 3 },
        }),
    });
    renderApp('/m/inv-transactions');
    await screen.findByRole('heading', { name: 'Inventory Transactions' });
    await userEvent.click(await screen.findByRole('tab', { name: 'Vouchers' }));
    const draft = (await screen.findByText('TXN/TAL/26-27/0001')).closest('tr') as HTMLElement;
    expect(within(draft).getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(within(draft).queryByRole('button', { name: 'Post' })).toBeNull();
    const approved = screen.getByText('TXN/TAL/26-27/0002').closest('tr') as HTMLElement;
    expect(within(approved).getByRole('button', { name: 'Post' })).toBeInTheDocument();
    const posted = screen.getByText('TXN/TAL/26-27/0003').closest('tr') as HTMLElement;
    expect(within(posted).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(posted).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(posted).getByText('₹ 1,25,000.00')).toBeInTheDocument();
  });

  it('says what to do when there is nothing yet', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/inventory/vouchers/opening': () =>
        json(200, { data: [], meta: { page: 1, size: 20, total: 0 } }),
    });
    renderApp('/m/inv-opening');
    expect(await screen.findByText(/No opening stock yet/)).toBeInTheDocument();
  });

  it('shows the server field errors under the line they belong to, in plain words', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/inventory/vouchers/transactions': () =>
        json(200, { data: [], meta: { page: 1, size: 20, total: 0 } }),
      'GET /api/v1/lookups/warehouses': () =>
        json(200, { data: [{ id: 'w1', code: 'TAL-MAIN', name: 'Talwade Main Store' }] }),
      'GET /api/v1/lookups/items': () =>
        json(200, { data: [{ id: 'i1', code: 'PWD-RED', name: 'Red powder', uom: 'Kg' }] }),
      'POST /api/v1/inventory/vouchers/transactions': () =>
        apiError(422, 'VALIDATION_ERROR', 'Please fix the highlighted fields.', {
          'lines.0.qty': 'Enter a quantity greater than 0.',
        }),
    });
    const user = userEvent.setup();
    renderApp('/m/inv-transactions');
    await user.click(await screen.findByRole('tab', { name: 'Vouchers' }));
    await user.click(await screen.findByRole('button', { name: /New Receipt \/ Issue/ }));
    await user.selectOptions(await screen.findByLabelText('Warehouse'), 'w1');
    await user.click(screen.getByLabelText('Item 1'));
    await user.click(await screen.findByRole('option', { name: /PWD-RED/ }));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Enter a quantity greater than 0.')).toBeInTheDocument();
  });
});

describe('Batches', () => {
  it('shows expiry, days left and the quantity still in Quality Inspection', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/inventory/batches': () =>
        json(200, {
          data: [
            {
              id: 'b1',
              itemId: 'i1',
              itemCode: 'PWD-RED',
              itemName: 'Red powder',
              batchNo: 'B-9',
              mfgDate: '2026-10-01',
              expiryDate: '2027-10-01',
              daysToExpiry: 329,
              qcStatus: 'Released',
              recalled: false,
              disposition: null,
              onHand: 25,
              qualityInspection: 10,
              version: 1,
            },
          ],
          meta: { page: 1, size: 20, total: 1 },
        }),
    });
    renderApp('/m/inv-batch');
    await screen.findByRole('heading', { name: 'Batch / Lot Tracking' });
    expect(await screen.findByText('B-9')).toBeInTheDocument();
    expect(screen.getByText('01-10-2027')).toBeInTheDocument();
    expect(screen.getByText(/10 in inspection/)).toBeInTheDocument();
  });
});

describe('Barcode scan', () => {
  it('shows a plain message for a code that is not valid', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/lookups/warehouses': () => json(200, { data: [] }),
      'POST /api/v1/inventory/scan': () =>
        json(200, {
          data: { valid: false, kind: 'UNKNOWN', message: 'The barcode check digit is wrong.' },
        }),
    });
    const user = userEvent.setup();
    renderApp('/m/wms-barcode');
    await user.type(await screen.findByLabelText('Scan here'), '4006381333932{Enter}');
    expect(await screen.findByText(/check digit is wrong/)).toBeInTheDocument();
    expect(screen.getByText('Not valid')).toBeInTheDocument();
  });
});

describe('Ledger | Vouchers toggle', () => {
  it('opens on the ledger and the Vouchers tab shows the document list', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/pages/inv-transactions/records': () =>
        json(200, {
          data: [
            {
              id: 'l1',
              code: 'TXN/TAL/26-27/0001',
              data: {
                postingDate: '2026-11-06',
                voucherNo: 'TXN/TAL/26-27/0001',
                voucherType: 'RECEIPT',
                item: 'PWD-RED',
                warehouse: 'TAL-MAIN',
                qtyIn: 25,
                qtyOut: 0,
                value: 3000,
                balanceQty: 25,
              },
            },
          ],
          meta: { page: 1, size: 20, total: 1 },
        }),
      'GET /api/v1/inventory/vouchers/transactions': () =>
        json(200, {
          data: [voucher('v1', 'Draft', 'TXN/TAL/26-27/0009')],
          meta: { page: 1, size: 20, total: 1 },
        }),
    });
    const user = userEvent.setup();
    renderApp('/m/inv-transactions');
    expect(await screen.findByText('RECEIPT')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Vouchers' }));
    expect(await screen.findByText('TXN/TAL/26-27/0009')).toBeInTheDocument();
  });
});

describe('Customer Material tab', () => {
  const balance = {
    customerId: 'c1',
    customerName: 'Alpha Coaters',
    itemId: 'i1',
    itemCode: 'PWD-RED',
    itemName: 'Red powder',
    warehouseCode: 'TAL-MAIN',
    lots: 1,
    receivedQty: 100,
    balanceQty: 70,
    nextExpiry: '2026-11-01',
    expiry: 'expired',
  };
  const base = {
    'GET /api/v1/me/permissions': ALL,
    'GET /api/v1/inventory/vouchers/transactions': () =>
      json(200, { data: [], meta: { page: 1, size: 20, total: 0 } }),
    'GET /api/v1/inventory/ledger': () =>
      json(200, { data: [], meta: { page: 1, size: 20, total: 0 } }),
    'GET /api/v1/inventory/customer-material/customers': () =>
      json(200, { data: [{ id: 'c1', code: 'C001', name: 'Alpha Coaters' }] }),
    'GET /api/v1/lookups/warehouses': () =>
      json(200, { data: [{ id: 'w1', code: 'TAL-MAIN', name: 'Talwade Main Store' }] }),
    'GET /api/v1/lookups/items': () =>
      json(200, { data: [{ id: 'i1', code: 'PWD-RED', name: 'Red powder', uom: 'Kg' }] }),
  };

  it('explains the flow, offers three big buttons and shows what we hold with an Expired mark', async () => {
    signedIn(owner, {
      ...base,
      'GET /api/v1/inventory/customer-material/balances': () => json(200, { data: [balance] }),
    });
    const user = userEvent.setup();
    renderApp('/m/inv-transactions');
    await user.click(await screen.findByRole('tab', { name: 'Customer Material' }));
    expect(await screen.findByText(/NOT our stock/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /1\. Material received from customer/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2\. Use material for a job/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /3\. Send material back/ })).toBeInTheDocument();
    const row = (await screen.findByText('Alpha Coaters')).closest('tr') as HTMLElement;
    expect(within(row).getByText('70')).toBeInTheDocument();
    expect(within(row).getByText('Expired')).toBeInTheDocument();
  });

  it('says what to do when empty, and shows server errors in plain words under the field', async () => {
    signedIn(owner, {
      ...base,
      'GET /api/v1/inventory/customer-material/balances': () => json(200, { data: [] }),
      'POST /api/v1/inventory/customer-material/receipts': () =>
        apiError(422, 'VALIDATION_ERROR', 'Please fix the highlighted fields.', {
          challanNo: 'Enter the customer challan number that came with the material.',
        }),
    });
    const user = userEvent.setup();
    renderApp('/m/inv-transactions');
    await user.click(await screen.findByRole('tab', { name: 'Customer Material' }));
    expect(
      await screen.findByText(/Nothing yet\. When a customer sends material/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /1\. Material received from customer/ }));
    await user.click(await screen.findByRole('button', { name: 'Save received material' }));
    expect(
      await screen.findByText('Enter the customer challan number that came with the material.'),
    ).toBeInTheDocument();
  });

  it('the issue form tells you to choose customer and store first, and shows the quantity left per lot', async () => {
    signedIn(owner, {
      ...base,
      'GET /api/v1/inventory/customer-material/balances': () => json(200, { data: [] }),
      'GET /api/v1/inventory/customer-material/lots': () =>
        json(200, {
          data: [
            {
              id: 'lot1',
              customerId: 'c1',
              customerCode: 'C001',
              customerName: 'Alpha Coaters',
              itemId: 'i1',
              itemCode: 'PWD-RED',
              itemName: 'Red powder',
              uom: 'Kg',
              warehouseId: 'w1',
              warehouseCode: 'TAL-MAIN',
              batchNo: 'B-5',
              mfgDate: null,
              expiryDate: null,
              expiry: 'none',
              challanNo: 'CH-77',
              challanDate: '2026-11-01',
              receivedQty: 100,
              balanceQty: 70,
              receivedAt: '2026-11-01T00:00:00Z',
            },
          ],
          meta: { page: 1, size: 100, total: 1 },
        }),
    });
    const user = userEvent.setup();
    renderApp('/m/inv-transactions');
    await user.click(await screen.findByRole('tab', { name: 'Customer Material' }));
    await user.click(await screen.findByRole('button', { name: /2\. Use material for a job/ }));
    expect(await screen.findByText(/Choose the customer and the store first/)).toBeInTheDocument();
    await user.selectOptions(await screen.findByLabelText('Customer'), 'c1');
    await user.selectOptions(await screen.findByLabelText('Store where it is kept'), 'w1');
    expect(await screen.findByRole('option', { name: /CH-77.*70 left/ })).toBeInTheDocument();
  });
});

describe('How this works', () => {
  it('every inventory screen has a who-does-what strip that opens on click', async () => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/inventory/vouchers/opening': () =>
        json(200, { data: [], meta: { page: 1, size: 20, total: 0 } }),
    });
    const user = userEvent.setup();
    renderApp('/m/inv-opening');
    const toggle = await screen.findByRole('button', { name: /How this works/ });
    expect(screen.queryByText('Store keeper')).toBeNull();
    await user.click(toggle);
    expect((await screen.findAllByText('Store keeper')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Manager (approver)').length).toBeGreaterThan(0);
  });
});
