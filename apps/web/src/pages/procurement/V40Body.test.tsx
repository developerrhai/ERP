// V40 parity of the Procurement / SCM pages: each V40 tab shows its own workspace panel and its own column set,
// with values from the real /scm/v40 rows (pending = ordered - received, balance, matched amount ...).
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { json, makeUser, permissionsRoute, renderApp, signedIn } from '../../test/helpers';
import { cell } from './V40Body';
import { SPECS } from './v40Specs';

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
const page = (rows: unknown[]) => () =>
  json(200, { data: rows, meta: { page: 1, size: 20, total: rows.length } });

const poLine = {
  id: 'po1',
  lineId: 'l1',
  lineNo: 1,
  number: 'PO/TAL/26-27/0001',
  status: 'Approved',
  version: 3,
  prNumber: 'PR/TAL/26-27/0001',
  vendorId: 'SUP-1',
  vendor: 'Steel Traders',
  materialCode: 'SHAFT',
  material: 'Steel shaft',
  orderedQuantity: '100',
  uom: 'Kg',
  rate: '50',
  gstPct: '18',
  totalAmount: '5900.00',
  poDate: '2026-11-05',
  expectedDeliveryDate: '2026-11-12',
  paymentTerms: 'Net 30',
  receivedQuantity: '60',
  acceptedQuantity: '58',
  cancelledQuantity: '0',
  pendingQuantity: '40',
  receivedValue: '3540.00',
  shipTo: 'WH-1',
};
const routes = (extra: Record<string, () => Response> = {}) => ({
  'GET /api/v1/me/permissions': ALL,
  'GET /api/v1/scm/v40/po': page([poLine]),
  'GET /api/v1/approvals/requests': page([]),
  ...extra,
});
const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent);

describe('Procurement V40 tabs', () => {
  it('PO Register: the V40 columns, a dash where the database has nothing, and every row button', async () => {
    signedIn(owner, routes());
    renderApp('/m/scm-po');
    expect(await screen.findByText('PR/TAL/26-27/0001')).toBeInTheDocument();
    for (const h of [
      'PO Number',
      'PR Number',
      'Vendor ID',
      'Vendor',
      'Material Code',
      'Material',
      'Ordered Quantity',
      'UOM',
      'Rate',
      'GST %',
      'Total Amount',
      'PO Date',
      'Docs',
      'Actions',
      'Status',
    ])
      expect(headers()).toContain(h);
    expect(screen.getByText('₹ 5,900.00')).toBeInTheDocument();
    expect(screen.getByText('18%')).toBeInTheDocument();
    for (const b of ['View', 'Email', 'PDF', '360° Track', 'Move Forward'])
      expect(screen.getByRole('button', { name: `${b} ${poLine.number}` })).toBeInTheDocument();
    for (const b of ['Export Selected', 'Submit Selected', 'Delete Selected'])
      expect(screen.getByRole('button', { name: b })).toBeInTheDocument();
    expect(screen.queryByText(/Reset 25 Demo/)).not.toBeInTheDocument();
  });

  it('Items tab: allocation panel with ordered / received / accepted / still to receive', async () => {
    signedIn(owner, routes());
    renderApp('/m/scm-po?tab=1');
    const panel = (await screen.findByText('Allocation and availability')).closest(
      '.proc-section',
    ) as HTMLElement;
    for (const h of ['Record', 'Demand', 'Available', 'Allocated', 'Short', 'Location', 'Action'])
      expect(within(panel).getByRole('columnheader', { name: h })).toBeInTheDocument();
    const row = (await within(panel).findByText('PO/TAL/26-27/0001 / 1')).closest(
      'tr',
    ) as HTMLElement;
    expect(within(row).getByText('100')).toBeInTheDocument();
    expect(within(row).getByText('60')).toBeInTheDocument();
    expect(within(row).getByText('40')).toBeInTheDocument();
    expect(within(row).getByText('WH-1')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Allocate' })).toBeDisabled();
  });

  it('Receipt Balance tab: payment panel with the value received and the balance', async () => {
    signedIn(owner, routes());
    renderApp('/m/scm-po?tab=4');
    const panel = (await screen.findByText('Receipt / payment allocation')).closest(
      '.proc-section',
    ) as HTMLElement;
    for (const h of ['Reference', 'Due', 'Amount', 'Allocated', 'Balance', 'Action'])
      expect(within(panel).getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(await within(panel).findByText('₹ 3,540.00')).toBeInTheDocument();
    expect(within(panel).getByText('₹ 2,360.00')).toBeInTheDocument();
    expect(headers()).toContain('Expected Delivery Date');
    expect(headers()).toContain('Payment Terms');
  });

  it('Commercial Terms tab shows validation rules with counts', async () => {
    signedIn(owner, routes());
    renderApp('/m/scm-po?tab=2');
    expect(await screen.findByText('Reference integrity')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run Full Validation' })).toBeInTheDocument();
    // there is no document store: that rule shows dashes, never a made-up count
    const docRow = screen.getByText('Document availability').closest('tr') as HTMLElement;
    expect(within(docRow).getAllByText('—').length).toBe(3);
  });

  it('Approval tab has the revision reason and the Create New Revision button', async () => {
    signedIn(owner, routes());
    renderApp('/m/scm-po');
    await screen.findByText('PR/TAL/26-27/0001');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Approval' }));
    expect(await screen.findByLabelText('Revision Reason')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create New Revision' })).toBeInTheDocument();
  });

  it('GRN: Batch & Warehouse tab shows warehouse, batch and put-away quantity from the receipt line', async () => {
    const grn = {
      id: 'g1',
      lineId: 'gl1',
      lineNo: 1,
      number: 'GRN/TAL/26-27/0001',
      status: 'Posted',
      version: 2,
      poNumber: 'PO/TAL/26-27/0001',
      vendor: 'Steel Traders',
      vendorId: 'SUP-1',
      materialCode: 'SHAFT',
      material: 'Steel shaft',
      orderedQuantity: '100',
      receivedQuantity: '60',
      acceptedQuantity: '58',
      rejectedQuantity: '2',
      putawayQuantity: '50',
      warehouse: 'WH-1',
      batchNumber: 'B-77',
      qcStatus: 'Passed',
      receiptDate: '2026-11-08',
      poBalanceQuantity: '40',
    };
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/scm/v40/grn': page([grn]),
      'GET /api/v1/scm/grn': page([]),
    });
    renderApp('/m/scm-grn?tab=2');
    const panel = (await screen.findByText('Allocation and availability')).closest(
      '.proc-section',
    ) as HTMLElement;
    expect(await within(panel).findByText('GRN/TAL/26-27/0001')).toBeInTheDocument();
    expect(within(panel).getByText('8')).toBeInTheDocument(); // accepted 58 - put away 50
    expect(headers()).toEqual(expect.arrayContaining(['Warehouse', 'Batch Number', 'QC Status']));
    expect(screen.getByText('B-77')).toBeInTheDocument();
  });

  it('Purchase Invoice: Invoice Exceptions lists the real open exceptions', async () => {
    const inv = {
      id: 'i1',
      number: 'PINV/TAL/26-27/0001',
      status: 'Posted',
      version: 1,
      vendor: 'Steel Traders',
      vendorInvoiceRef: 'S-1',
      invoiceDate: '2026-11-07',
      dueDate: '2026-12-07',
      invoiceTotal: '5900',
      matchedAmount: '4900',
      paymentStatus: 'PARTIAL',
    };
    const ex = {
      id: 'e1',
      invoiceId: 'i1',
      number: inv.number,
      code: 'QTY_OVER',
      severity: 'ERROR',
      message: 'Billed 100, received 98',
      state: 'OPEN',
      ageDays: 3,
      department: 'Purchase',
    };
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/scm/v40/invoice': page([inv]),
      'GET /api/v1/scm/v40/invoice-exceptions': page([ex]),
      'GET /api/v1/scm/purchaseinvoice': page([]),
    });
    renderApp('/m/scm-purchaseinvoice?tab=5');
    expect(await screen.findByText('Billed 100, received 98')).toBeInTheDocument();
    expect(screen.getByText('3 days')).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });

  it('Purchase Invoice: Payment Readiness shows what is still to be paid', async () => {
    const inv = {
      id: 'i1',
      number: 'PINV/TAL/26-27/0001',
      status: 'Posted',
      version: 1,
      vendor: 'Steel Traders',
      vendorInvoiceRef: 'S-1',
      invoiceDate: '2026-11-07',
      dueDate: '2026-12-07',
      netPayable: '5900',
      paidAmount: '1000',
      paymentStatus: 'PARTIAL',
    };
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      'GET /api/v1/scm/v40/invoice': page([inv]),
      'GET /api/v1/scm/purchaseinvoice': page([]),
    });
    renderApp('/m/scm-purchaseinvoice?tab=4');
    const panel = (await screen.findByText('Receipt / payment allocation')).closest(
      '.proc-section',
    ) as HTMLElement;
    expect(await within(panel).findByText('₹ 4,900.00')).toBeInTheDocument(); // 5900 - 1000 paid
  });
});

describe('the other Procurement pages show their V40 panel on the matching tab', () => {
  const cases: [string, string, string, string, string[]][] = [
    [
      'scm-pr',
      'pr',
      '?tab=1',
      'Allocation and availability',
      ['PR Number', 'Required Material', 'Required Date'],
    ],
    [
      'scm-rfq',
      'rfq',
      '?tab=4',
      'Allocation and availability',
      ['RFQ No', 'PR No', 'Closing Date', 'Vendor Count'],
    ],
    [
      'scm-vendorquote',
      'quote',
      '?tab=1',
      'Commercial breakdown',
      ['Quote No', 'RFQ No', 'Base Amount'],
    ],
    [
      'scm-comparison',
      'comparison',
      '?tab=2',
      'Commercial simulation',
      ['Document No', 'Vendor', 'Amount'],
    ],
    [
      'scm-evaluation',
      'evaluation',
      '?tab=4',
      'Validation and compliance',
      ['Evaluation No', 'Quality Score', 'Delivery OTIF'],
    ],
    [
      'scm-contracts',
      'contract',
      '?tab=3',
      'Validation and compliance',
      ['Contract No', 'Start Date', 'End Date'],
    ],
    [
      'scm-suppliers',
      'supplier',
      '?tab=3',
      'Tax and address',
      ['GST Number', 'Vendor ID', 'Vendor Name'],
    ],
  ];
  it.each(cases)('%s', async (pageId, kind, tab, heading, cols) => {
    signedIn(owner, {
      'GET /api/v1/me/permissions': ALL,
      [`GET /api/v1/scm/v40/${kind}`]: page([]),
    });
    renderApp(`/m/${pageId}${tab}`);
    expect(await screen.findByText(heading)).toBeInTheDocument();
    for (const c of cols) expect(headers()).toContain(c);
  });
});

describe('cell formatting and specs', () => {
  it('formats dates, money, quantities and shows a dash for a missing value', () => {
    expect(cell({ key: 'a', label: 'A', fmt: 'date' }, '2026-11-05')).toBe('05-11-2026');
    expect(cell({ key: 'a', label: 'A', fmt: 'qty' }, '100.000')).toBe('100');
    expect(cell({ key: 'a', label: 'A', fmt: 'inr' }, '1500')).toBe('₹ 1,500.00');
    expect(cell({ key: 'a', label: 'A' }, null)).toBe('—');
  });

  it('every tab column key of every spec exists in its column dictionary', () => {
    for (const spec of Object.values(SPECS)) {
      const keys = [
        ...spec.register,
        ...spec.compact,
        ...(spec.afterActions ?? []),
        ...(spec.trailing ?? []),
        ...Object.values(spec.tabs).flatMap((t) => t.cols ?? []),
      ];
      for (const k of keys) expect(spec.cols[k], `${spec.pageId}: ${k}`).toBeDefined();
    }
  });
});
