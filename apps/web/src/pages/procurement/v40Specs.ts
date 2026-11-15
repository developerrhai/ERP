// What V40 shows on each tab of the Procurement / SCM pages, mapped to the real fields of /scm/v40/<kind>.
// A tab = an optional workspace panel (allocation / validation / payment ...) + the register table with that tab's columns.
// A column whose key is not in the API row (no real source in the database) shows a plain dash.
export type Row = Record<string, unknown>;
export type Fmt = 'text' | 'inr' | 'date' | 'qty' | 'pct' | 'num' | 'bool' | 'pill';
export interface Col {
  key: string;
  label: string;
  fmt?: Fmt;
}
export type Level = 'pass' | 'warn' | 'fail' | null;

export type Panel =
  | {
      type: 'allocation';
      hint: string;
      money?: boolean;
      map: (r: Row) => [unknown, unknown, unknown, unknown, unknown, unknown];
    }
  | {
      type: 'payment';
      hint: string;
      money: boolean;
      map: (r: Row) => {
        ref: unknown;
        due: unknown;
        amount: unknown;
        allocated: unknown;
        balance: unknown;
      };
      /** where the Allocate button leads */
      goto: string;
    }
  | { type: 'validation'; hint: string }
  | { type: 'exceptions' }
  | { type: 'revision' }
  | { type: 'approval' }
  | { type: 'channel' }
  | { type: 'simulation' }
  | { type: 'tiles'; title: string; hint: string; tiles: (rows: Row[]) => [string, string][] }
  | { type: 'breakdown' }
  | { type: 'calendar' }
  | { type: 'analytics' };

export interface TabCfg {
  panel?: Panel;
  cols?: string[];
  /** columns appended after `cols` (Docs / Actions / Status are added by the table) */
  noDocs?: boolean;
}

export interface PageSpec {
  kind: string;
  pageId: string;
  /** REST path of the document (submit / delete); none = the page has no document lifecycle here */
  path?: string;
  title: string;
  cols: Record<string, Col>;
  /** register tab (first tab) */
  register: string[];
  /** register columns shown after Actions (before Status) and after Status */
  afterActions?: string[];
  trailing?: string[];
  /** the compact column set of the other tabs */
  compact: string[];
  tabs: Record<string, TabCfg>;
  /** field used by Analytics / Reports */
  amountKey: string;
  amountLabel: string;
  dateKey: string;
  /** keys that must be filled for a row to count as complete (Data Quality) */
  required: string[];
  rules: (r: Row, all: Row[]) => Level[];
  cal?: (r: Row) => { date: unknown; subject: string } | null;
  statusKey?: string;
}

/** A value as text: strings, numbers and booleans only, anything else (null, objects) is the fallback. */
export const txt = (v: unknown, fallback = ''): string =>
  typeof v === 'string'
    ? v
    : typeof v === 'number' || typeof v === 'boolean'
      ? String(v)
      : fallback;
const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const has = (v: unknown): boolean => v !== null && v !== undefined && v !== '';
const dash = (v: unknown): unknown => (has(v) ? v : null);
const maxZero = (x: number): number => (x > 0 ? x : 0);
const lvl = (ok: boolean, bad: Level = 'fail'): Level => (ok ? 'pass' : bad);
export const RULE_NAMES = [
  'Mandatory fields',
  'Reference integrity',
  'Date validity',
  'Amount / quantity tolerance',
  'Document availability',
  'Status consistency',
  'Duplicate control',
  'Approval readiness',
];
const approvalLevel = (status: unknown): Level => {
  const s = txt(status, '');
  if (['Approved', 'Posted', 'Issued', 'Closed', 'Awarded', 'Locked', 'Active'].includes(s))
    return 'pass';
  if (['Rejected', 'Cancelled'].includes(s)) return 'fail';
  return 'warn';
};
const dupLevel = (r: Row, all: Row[], keys: string[]): Level =>
  all.filter((x) => keys.every((k) => txt(x[k], '') === txt(r[k], ''))).length > 1
    ? 'warn'
    : 'pass';
const dateOrder = (a: unknown, b: unknown): Level =>
  has(a) && has(b) ? lvl(String(b) >= String(a)) : 'warn';

const c = (key: string, label: string, fmt?: Fmt): Col =>
  fmt ? { key, label, fmt } : { key, label };
const dict = (cols: Col[]): Record<string, Col> => Object.fromEntries(cols.map((x) => [x.key, x]));

// ------------------------------------------------------------------------------------------------ purchase order
const PO_COLS = dict([
  c('number', 'PO Number'),
  c('prNumber', 'PR Number'),
  c('vendorId', 'Vendor ID'),
  c('vendor', 'Vendor'),
  c('materialCode', 'Material Code'),
  c('material', 'Material'),
  c('orderedQuantity', 'Ordered Quantity', 'qty'),
  c('uom', 'UOM'),
  c('rate', 'Rate', 'inr'),
  c('gstPct', 'GST %', 'pct'),
  c('totalAmount', 'Total Amount', 'inr'),
  c('poDate', 'PO Date', 'date'),
  c('expectedDeliveryDate', 'Expected Delivery Date', 'date'),
  c('paymentTerms', 'Payment Terms'),
  c('receivedQuantity', 'Received Quantity', 'qty'),
  c('cancelledQuantity', 'Cancelled Quantity', 'qty'),
  c('pendingQuantity', 'Pending Quantity', 'qty'),
  c('status', 'Approval Status'),
]);
const PO_BASE = [
  'number',
  'prNumber',
  'vendorId',
  'vendor',
  'materialCode',
  'material',
  'orderedQuantity',
];

const PO: PageSpec = {
  kind: 'po',
  pageId: 'scm-po',
  path: '/scm/po',
  title: 'Purchase Orders',
  cols: PO_COLS,
  register: [
    'number',
    'prNumber',
    'vendorId',
    'vendor',
    'materialCode',
    'material',
    'orderedQuantity',
    'uom',
    'rate',
    'gstPct',
    'totalAmount',
    'poDate',
  ],
  compact: PO_BASE,
  amountKey: 'totalAmount',
  amountLabel: 'Total Amount',
  dateKey: 'poDate',
  required: ['vendor', 'materialCode', 'orderedQuantity', 'rate', 'poDate'],
  rules: (r, all) => [
    lvl(has(r.vendor) && has(r.material) && n(r.orderedQuantity) > 0 && has(r.rate)),
    has(r.prNumber) ? 'pass' : 'warn',
    dateOrder(r.poDate, r.expectedDeliveryDate),
    lvl(n(r.receivedQuantity) <= n(r.orderedQuantity)),
    null,
    lvl(!(['Draft', 'Pending Approval'].includes(String(r.status)) && n(r.receivedQuantity) > 0)),
    dupLevel(r, all, ['number', 'materialCode']),
    approvalLevel(r.status),
  ],
  cal: (r) =>
    has(r.expectedDeliveryDate)
      ? {
          date: r.expectedDeliveryDate,
          subject: `Delivery due ${String(r.number)} · ${txt(r.material, '')}`,
        }
      : null,
  tabs: {
    Items: {
      panel: {
        type: 'allocation',
        hint: 'Ordered, received and still-to-receive quantity of every PO line, with the delivery warehouse.',
        map: (r) => [
          `${String(r.number)} / ${String(r.lineNo)}`,
          r.orderedQuantity,
          r.receivedQuantity,
          r.acceptedQuantity,
          r.pendingQuantity,
          dash(r.shipTo),
        ],
      },
      cols: PO_BASE,
    },
    'Commercial Terms': {
      panel: {
        type: 'validation',
        hint: 'Rule results over the purchase order lines on this page.',
      },
      cols: PO_BASE,
    },
    Approval: { panel: { type: 'revision' }, cols: PO_BASE },
    'Receipt Balance': {
      panel: {
        type: 'payment',
        hint: 'Order value against the value already received on each line.',
        money: true,
        goto: '/m/scm-grn',
        map: (r) => ({
          ref: r.number,
          due: r.expectedDeliveryDate,
          amount: r.totalAmount,
          allocated: r.receivedValue,
          balance: maxZero(n(r.totalAmount) - n(r.receivedValue)),
        }),
      },
      cols: ['poDate', 'expectedDeliveryDate', 'paymentTerms', 'status', 'number', 'prNumber'],
    },
    Audit: { cols: PO_BASE },
  },
};

// ------------------------------------------------------------------------------------------------ goods receipt
const GRN_COLS = dict([
  c('number', 'GRN Number'),
  c('poNumber', 'PO Number'),
  c('prNumber', 'PR Number'),
  c('salesOrder', 'Sales Order'),
  c('vendorId', 'Vendor ID'),
  c('vendor', 'Vendor'),
  c('materialCode', 'Material Code'),
  c('material', 'Material'),
  c('orderedQuantity', 'Ordered Quantity', 'qty'),
  c('receivedQuantity', 'Received Quantity', 'qty'),
  c('acceptedQuantity', 'Accepted Quantity', 'qty'),
  c('rejectedQuantity', 'Rejected Quantity', 'qty'),
  c('receiptDate', 'Received Date', 'date'),
  c('qcStatus', 'QC Status'),
  c('warehouse', 'Warehouse'),
  c('batchNumber', 'Batch Number'),
]);
const GRN_BASE = [
  'number',
  'poNumber',
  'prNumber',
  'salesOrder',
  'vendorId',
  'vendor',
  'materialCode',
];
const GRN: PageSpec = {
  kind: 'grn',
  pageId: 'scm-grn',
  path: '/scm/grn',
  title: 'Goods Receipt / GRN',
  cols: GRN_COLS,
  register: [
    'number',
    'poNumber',
    'prNumber',
    'salesOrder',
    'vendorId',
    'vendor',
    'materialCode',
    'material',
    'orderedQuantity',
    'receivedQuantity',
    'acceptedQuantity',
    'rejectedQuantity',
  ],
  compact: GRN_BASE,
  amountKey: 'stockValue',
  amountLabel: 'Stock Value',
  dateKey: 'receiptDate',
  required: ['poNumber', 'vendor', 'materialCode', 'receivedQuantity', 'receiptDate'],
  rules: (r, all) => [
    lvl(has(r.vendor) && has(r.material) && n(r.receivedQuantity) > 0),
    lvl(has(r.poNumber)),
    has(r.receiptDate)
      ? lvl(String(r.receiptDate) <= new Date().toISOString().slice(0, 10), 'warn')
      : 'warn',
    n(r.receivedQuantity) > n(r.orderedQuantity)
      ? 'fail'
      : r.qcStatus === 'Pending'
        ? 'warn'
        : lvl(
            Math.abs(n(r.receivedQuantity) - n(r.acceptedQuantity) - n(r.rejectedQuantity)) <
              0.0005,
            'warn',
          ),
    null,
    lvl(!(r.status === 'Posted' && !has(r.warehouse))),
    dupLevel(r, all, ['number', 'materialCode']),
    approvalLevel(r.status),
  ],
  cal: (r) =>
    has(r.receiptDate)
      ? {
          date: r.receiptDate,
          subject: `Received ${String(r.number)} · ${txt(r.material, '')}`,
        }
      : null,
  tabs: {
    'Receipt Quantity': {
      panel: {
        type: 'payment',
        hint: 'Quantity ordered on the PO line against the quantity received so far and what is still due.',
        money: false,
        goto: '/m/scm-po',
        map: (r) => ({
          ref: r.number,
          due: r.receiptDate,
          amount: r.orderedQuantity,
          allocated: r.receivedQuantity,
          balance: r.poBalanceQuantity,
        }),
      },
      cols: ['receiptDate', 'qcStatus', 'number', 'poNumber', 'prNumber', 'salesOrder'],
    },
    'Batch & Warehouse': {
      panel: {
        type: 'allocation',
        hint: 'Received, accepted and put-away quantity by warehouse and batch.',
        map: (r) => [
          r.number,
          r.receivedQuantity,
          r.acceptedQuantity,
          r.putawayQuantity,
          maxZero(n(r.acceptedQuantity) - n(r.putawayQuantity)),
          dash(r.warehouse),
        ],
      },
      cols: ['warehouse', 'batchNumber', 'qcStatus', 'number', 'poNumber', 'prNumber'],
    },
    'Incoming Quality': {
      panel: {
        type: 'tiles',
        title: 'Incoming Quality',
        hint: 'Inspection result of the receipt lines on this page.',
        tiles: (rows) => {
          const rec = rows.reduce((a, r) => a + n(r.receivedQuantity), 0);
          const acc = rows.reduce((a, r) => a + n(r.acceptedQuantity), 0);
          const rej = rows.reduce((a, r) => a + n(r.rejectedQuantity), 0);
          const by = (s: string): number => rows.filter((r) => r.qcStatus === s).length;
          return [
            ['Received quantity', String(rec)],
            ['Accepted quantity', String(acc)],
            ['Rejected quantity', String(rej)],
            ['Rejection rate', rec ? `${((rej / rec) * 100).toFixed(1)}%` : '—'],
            ['Waiting for inspection', String(by('Pending'))],
            ['Lines inspected', String(rows.filter((r) => r.qcState && r.qcState !== 'NA').length)],
          ];
        },
      },
      cols: GRN_BASE,
    },
    'PO Balance': {
      panel: {
        type: 'payment',
        hint: 'What is still to be received against each purchase order line.',
        money: false,
        goto: '/m/scm-po',
        map: (r) => ({
          ref: r.poNumber,
          due: r.receiptDate,
          amount: r.orderedQuantity,
          allocated: r.receivedQuantity,
          balance: r.poBalanceQuantity,
        }),
      },
      cols: ['number', 'poNumber', 'prNumber', 'salesOrder', 'vendorId', 'vendor', 'materialCode'],
    },
    Audit: { cols: GRN_BASE },
  },
};

// ------------------------------------------------------------------------------------------------ purchase requisition
const PR_COLS = dict([
  c('number', 'PR Number'),
  c('prDate', 'PR Date', 'date'),
  c('materialCode', 'Material Code'),
  c('requiredMaterial', 'Required Material'),
  c('quantity', 'Quantity', 'qty'),
  c('uom', 'UOM'),
  c('requiredDate', 'Required Date', 'date'),
  c('department', 'Department'),
  c('requester', 'Requester'),
  c('salesOrder', 'Sales Order'),
  c('productionPlan', 'Production Plan'),
  c('mrpLineNo', 'MRP Line No'),
  c('status', 'Approval Status'),
  c('orderedQuantity', 'Ordered via PO', 'qty'),
  c('poNumbers', 'PO Numbers'),
]);
const PR_BASE = [
  'number',
  'prDate',
  'materialCode',
  'requiredMaterial',
  'quantity',
  'uom',
  'requiredDate',
];
const PR: PageSpec = {
  kind: 'pr',
  pageId: 'scm-pr',
  path: '/scm/pr',
  title: 'Purchase Requisition',
  cols: PR_COLS,
  register: [...PR_BASE, 'department', 'requester', 'salesOrder', 'productionPlan', 'mrpLineNo'],
  compact: PR_BASE,
  amountKey: 'estimatedTotal',
  amountLabel: 'Estimated Value',
  dateKey: 'prDate',
  required: ['materialCode', 'quantity', 'uom', 'requiredDate', 'requester'],
  rules: (r, all) => [
    lvl(has(r.requiredMaterial) && n(r.quantity) > 0 && has(r.uom)),
    has(r.salesOrder) || has(r.mrpLineNo) ? 'pass' : 'warn',
    dateOrder(r.prDate, r.requiredDate),
    lvl(n(r.orderedQuantity) <= n(r.quantity)),
    null,
    lvl(!(r.status === 'Draft' && n(r.orderedQuantity) > 0)),
    dupLevel(r, all, ['number', 'materialCode']),
    approvalLevel(r.status),
  ],
  cal: (r) =>
    has(r.requiredDate)
      ? {
          date: r.requiredDate,
          subject: `Needed ${String(r.number)} · ${txt(r.requiredMaterial, '')}`,
        }
      : null,
  tabs: {
    Requirement: {
      panel: {
        type: 'allocation',
        hint: 'Requirement against stock on hand in this plant and what is already ordered on purchase orders.',
        map: (r) => [
          r.number,
          r.quantity,
          r.stockOnHand,
          r.orderedQuantity,
          maxZero(n(r.quantity) - n(r.orderedQuantity) - n(r.stockOnHand)),
          dash(r.department),
        ],
      },
      cols: PR_BASE,
    },
    'Sales & Production Link': {
      cols: [
        'productionPlan',
        'status',
        'number',
        'prDate',
        'materialCode',
        'requiredMaterial',
        'salesOrder',
        'mrpLineNo',
      ],
    },
    Approval: { panel: { type: 'revision' }, cols: PR_BASE },
    'PO Conversion': { cols: [...PR_BASE, 'orderedQuantity', 'poNumbers'] },
    Audit: { cols: PR_BASE },
  },
};

// ------------------------------------------------------------------------------------------------ purchase invoice
const INV_COLS = dict([
  c('number', 'Purchase Invoice No'),
  c('vendor', 'Vendor'),
  c('vendorInvoiceRef', 'Vendor Invoice Ref'),
  c('invoiceDate', 'Invoice Date', 'date'),
  c('dueDate', 'Due Date', 'date'),
  c('poNumber', 'PO No'),
  c('grnNumber', 'GRN No'),
  c('taxableValue', 'Taxable Value', 'inr'),
  c('gst', 'GST', 'inr'),
  c('tds', 'TDS', 'inr'),
  c('invoiceTotal', 'Invoice Total', 'inr'),
  c('matchedAmount', 'Matched Amount', 'inr'),
  c('paymentStatus', 'Payment Status', 'pill'),
  c('companyCode', 'Company Code'),
]);
const INV_BASE = [
  'number',
  'vendor',
  'vendorInvoiceRef',
  'invoiceDate',
  'dueDate',
  'poNumber',
  'grnNumber',
];
const INV: PageSpec = {
  kind: 'invoice',
  pageId: 'scm-purchaseinvoice',
  path: '/scm/purchaseinvoice',
  title: 'Purchase Invoice',
  cols: INV_COLS,
  register: [...INV_BASE, 'taxableValue', 'gst', 'tds', 'invoiceTotal', 'matchedAmount'],
  afterActions: ['paymentStatus'],
  compact: INV_BASE,
  amountKey: 'invoiceTotal',
  amountLabel: 'Invoice Total',
  dateKey: 'invoiceDate',
  required: ['vendor', 'vendorInvoiceRef', 'invoiceDate', 'dueDate', 'poNumber', 'grnNumber'],
  rules: (r, all) => [
    lvl(has(r.vendor) && has(r.vendorInvoiceRef) && has(r.invoiceDate)),
    has(r.poNumber) && has(r.grnNumber) ? 'pass' : 'warn',
    dateOrder(r.invoiceDate, r.dueDate),
    r.matchState === 'MATCHED' ? 'pass' : r.matchState === 'ON_HOLD' ? 'fail' : 'warn',
    null,
    lvl(!(r.paymentStatus === 'PAID' && r.status !== 'Posted')),
    all.filter((x) => x.vendor === r.vendor && x.vendorInvoiceRef === r.vendorInvoiceRef).length > 1
      ? 'fail'
      : 'pass',
    approvalLevel(r.status),
  ],
  cal: (r) =>
    has(r.dueDate)
      ? { date: r.dueDate, subject: `Payment due ${String(r.number)} · ${txt(r.vendor, '')}` }
      : null,
  tabs: {
    'PO GRN Matching': {
      panel: {
        type: 'allocation',
        hint: 'Invoice value against the value matched to the purchase order and goods receipt lines.',
        money: true,
        map: (r) => [
          r.number,
          r.taxableValue,
          null,
          r.matchedAmount,
          maxZero(n(r.taxableValue) - n(r.matchedAmount)),
          dash(r.grnNumber ?? r.poNumber),
        ],
      },
      cols: [...INV_BASE],
    },
    'Tax Validation': {
      panel: {
        type: 'tiles',
        title: 'Tax validation',
        hint: 'GST registration, tax regime and return status of the invoices on this page.',
        tiles: (rows) => {
          const cnt = (f: (r: Row) => boolean): string =>
            `${rows.filter(f).length} of ${rows.length}`;
          return [
            [
              'GSTIN on invoice (15 characters)',
              cnt((r) => txt(r.supplierGstin, '').length === 15),
            ],
            ['GST charged', cnt((r) => n(r.gst) > 0)],
            ['TDS deducted', cnt((r) => n(r.tds) > 0)],
            ['Reverse charge', cnt((r) => r.isRcm === true)],
            ['Seen in GSTR-2B', cnt((r) => txt(r.gstr2bStatus, '').toUpperCase() === 'MATCHED')],
            ['Payment blocked', cnt((r) => r.paymentBlock === true)],
          ];
        },
      },
      cols: ['taxableValue', 'gst', 'tds', 'companyCode', 'number', 'vendor', 'vendorInvoiceRef'],
    },
    'Debit Adjustments': {
      panel: {
        type: 'allocation',
        hint: 'Invoice total against what is matched; the unmatched part is what a debit note may adjust.',
        money: true,
        map: (r) => [
          r.number,
          r.invoiceTotal,
          null,
          r.matchedAmount,
          maxZero(n(r.invoiceTotal) - n(r.matchedAmount)),
          dash(r.poNumber),
        ],
      },
      cols: [...INV_BASE],
    },
    'Payment Readiness': {
      panel: {
        type: 'payment',
        hint: 'Net payable against what has been paid; payment-blocked invoices cannot be paid.',
        money: true,
        goto: '/m/fin-ap',
        map: (r) => ({
          ref: r.number,
          due: r.dueDate,
          amount: r.netPayable,
          allocated: r.paidAmount,
          balance: maxZero(n(r.netPayable) - n(r.paidAmount)),
        }),
      },
      cols: ['invoiceDate', 'dueDate', 'paymentStatus', 'number', 'vendor', 'vendorInvoiceRef'],
    },
    'Invoice Exceptions': {
      panel: { type: 'exceptions' },
      cols: [
        'number',
        'vendorInvoiceRef',
        'invoiceDate',
        'dueDate',
        'invoiceTotal',
        'matchedAmount',
        'paymentStatus',
      ],
    },
  },
};

// ------------------------------------------------------------------------------------------------ supplier master
const SUP_COLS = dict([
  c('vendorId', 'Vendor ID'),
  c('vendorName', 'Vendor Name'),
  c('contactPerson', 'Contact Person'),
  c('mobile', 'Mobile'),
  c('email', 'Email'),
  c('gstNumber', 'GST Number'),
  c('address', 'Address'),
  c('paymentTerms', 'Payment Terms'),
  c('materialCategories', 'Material Categories'),
  c('leadTimeDays', 'Lead Time Days', 'num'),
  c('qualityRating', 'Quality Rating', 'num'),
  c('deliveryRating', 'Delivery Rating', 'num'),
  c('projectNumber', 'Project Number'),
  c('costRating', 'Cost Rating', 'num'),
  c('responseRating', 'Response Rating', 'num'),
  c('grade', 'Grade'),
  c('overallRating', 'Overall Rating', 'num'),
]);
const SUP_BASE = [
  'vendorId',
  'vendorName',
  'contactPerson',
  'mobile',
  'email',
  'gstNumber',
  'address',
];
const SUP: PageSpec = {
  kind: 'supplier',
  pageId: 'scm-suppliers',
  title: 'Supplier Master',
  cols: SUP_COLS,
  register: [
    ...SUP_BASE,
    'paymentTerms',
    'materialCategories',
    'leadTimeDays',
    'qualityRating',
    'deliveryRating',
  ],
  trailing: ['projectNumber'],
  compact: SUP_BASE,
  amountKey: 'poCount',
  amountLabel: 'Purchase Orders',
  dateKey: 'createdAt',
  required: ['vendorName', 'gstNumber', 'contactPerson', 'mobile', 'email', 'address'],
  statusKey: 'approvalStatus',
  rules: (r, all) => [
    lvl(
      has(r.vendorName) &&
        (has(r.gstNumber) || r.gstRegistrationType === 'UNREGISTERED') &&
        has(r.contactPerson),
    ),
    has(r.paymentTerms) ? 'pass' : 'warn',
    null,
    null,
    n(r.expiredDocuments) > 0 ? 'fail' : n(r.documentCount) === 0 ? 'warn' : 'pass',
    lvl(!(r.purchaseHold === true && r.status === 'ACTIVE'), 'warn'),
    has(r.gstNumber) && all.filter((x) => x.gstNumber === r.gstNumber).length > 1 ? 'fail' : 'pass',
    r.approvalStatus === 'APPROVED' ? 'pass' : r.approvalStatus === 'REJECTED' ? 'fail' : 'warn',
  ],
  tabs: {
    Categories: {
      panel: {
        type: 'allocation',
        hint: 'Purchase orders placed with each supplier and where the supplier is based. Stock-style columns have no source for a supplier and stay empty.',
        map: (r) => [r.vendorId, r.poCount, null, null, null, dash(r.address)],
      },
      cols: [...SUP_BASE, 'materialCategories'],
    },
    'Commercial Terms': {
      panel: { type: 'validation', hint: 'Rule results over the suppliers on this page.' },
      cols: [...SUP_BASE, 'paymentTerms'],
    },
    'Tax & Address': {
      panel: {
        type: 'tiles',
        title: 'Tax and address',
        hint: 'GST, PAN, MSME and TDS set-up of the suppliers on this page.',
        tiles: (rows) => {
          const cnt = (f: (r: Row) => boolean): string =>
            `${rows.filter(f).length} of ${rows.length}`;
          return [
            ['GSTIN given', cnt((r) => has(r.gstNumber))],
            ['PAN given', cnt((r) => has(r.pan))],
            ['Address given', cnt((r) => has(r.address))],
            ['MSME registered', cnt((r) => has(r.msmeUdyamNo))],
            ['TDS section set', cnt((r) => has(r.tdsSectionCode))],
            ['Approved for buying', cnt((r) => r.approvalStatus === 'APPROVED')],
          ];
        },
      },
      cols: ['gstNumber', 'vendorId', 'vendorName', 'contactPerson', 'mobile', 'email', 'address'],
    },
    Performance: {
      cols: [
        ...SUP_BASE,
        'qualityRating',
        'deliveryRating',
        'costRating',
        'responseRating',
        'overallRating',
        'grade',
      ],
    },
    Controls: {
      panel: {
        type: 'tiles',
        title: 'Purchase controls',
        hint: 'Holds, approval and compliance documents of the suppliers on this page.',
        tiles: (rows) => {
          const cnt = (f: (r: Row) => boolean): string =>
            `${rows.filter(f).length} of ${rows.length}`;
          return [
            ['On purchase hold', cnt((r) => r.purchaseHold === true)],
            ['Waiting for approval', cnt((r) => r.approvalStatus === 'PENDING')],
            ['Rejected', cnt((r) => r.approvalStatus === 'REJECTED')],
            ['With expired documents', cnt((r) => n(r.expiredDocuments) > 0)],
            ['Without any document', cnt((r) => n(r.documentCount) === 0)],
            ['Inactive', cnt((r) => r.status !== 'ACTIVE')],
          ];
        },
      },
      cols: SUP_BASE,
    },
  },
};

// ------------------------------------------------------------------------------------------------ RFQ
const RFQ_COLS = dict([
  c('number', 'RFQ No'),
  c('prNumber', 'PR No'),
  c('rfqDate', 'RFQ Date', 'date'),
  c('closingDate', 'Closing Date', 'date'),
  c('buyer', 'Buyer'),
  c('category', 'Category'),
  c('vendorCount', 'Vendor Count', 'num'),
  c('technicalSpec', 'Technical Spec'),
  c('commercialTerms', 'Commercial Terms'),
  c('deliveryLocation', 'Delivery Location'),
  c('validity', 'Validity'),
  c('projectCode', 'Project Code'),
  c('respondedCount', 'Responded', 'num'),
  c('quoteCount', 'Quotes Received', 'num'),
]);
const RFQ_BASE = [
  'number',
  'prNumber',
  'rfqDate',
  'closingDate',
  'buyer',
  'category',
  'vendorCount',
];
const RFQ: PageSpec = {
  kind: 'rfq',
  pageId: 'scm-rfq',
  path: '/scm/rfq',
  title: 'RFQ Management',
  cols: RFQ_COLS,
  register: [...RFQ_BASE, 'technicalSpec', 'commercialTerms', 'deliveryLocation', 'validity'],
  trailing: ['projectCode'],
  compact: RFQ_BASE,
  amountKey: 'vendorCount',
  amountLabel: 'Invited Vendors',
  dateKey: 'rfqDate',
  required: ['prNumber', 'rfqDate', 'closingDate', 'buyer', 'vendorCount'],
  rules: (r, all) => [
    lvl(has(r.closingDate) && n(r.lineCount) > 0),
    has(r.prNumber) ? 'pass' : 'warn',
    dateOrder(r.rfqDate, r.closingDate),
    n(r.vendorCount) >= 1 ? 'pass' : 'fail',
    null,
    lvl(!(r.status === 'Draft' && n(r.respondedCount) > 0)),
    dupLevel(r, all, ['number']),
    approvalLevel(r.status),
  ],
  cal: (r) =>
    has(r.closingDate) ? { date: r.closingDate, subject: `Quotes due ${String(r.number)}` } : null,
  tabs: {
    'Supplier Invitations': {
      panel: { type: 'channel' },
      cols: [
        'number',
        'prNumber',
        'rfqDate',
        'closingDate',
        'vendorCount',
        'respondedCount',
        'projectCode',
      ],
    },
    'Technical Requirements': {
      panel: { type: 'validation', hint: 'Rule results over the RFQs on this page.' },
      cols: RFQ_BASE,
    },
    'Commercial Terms': {
      panel: { type: 'validation', hint: 'Rule results over the RFQs on this page.' },
      cols: RFQ_BASE,
    },
    'Response Tracker': {
      panel: {
        type: 'allocation',
        hint: 'Suppliers invited against suppliers who answered and quotations received.',
        map: (r) => [
          r.number,
          r.vendorCount,
          r.respondedCount,
          r.quoteCount,
          maxZero(n(r.vendorCount) - n(r.respondedCount)),
          null,
        ],
      },
      cols: RFQ_BASE,
    },
    'Sourcing Cycle Analytics': { panel: { type: 'analytics' }, cols: RFQ_BASE },
  },
};

// ------------------------------------------------------------------------------------------------ vendor quotation
const VQ_COLS = dict([
  c('number', 'Quote No'),
  c('rfqNo', 'RFQ No'),
  c('vendor', 'Vendor'),
  c('quoteDate', 'Quote Date', 'date'),
  c('baseAmount', 'Base Amount', 'inr'),
  c('discount', 'Discount', 'inr'),
  c('gst', 'GST', 'inr'),
  c('freight', 'Freight', 'inr'),
  c('landedCost', 'Landed Cost', 'inr'),
  c('leadTimeDays', 'Lead Time Days', 'num'),
  c('paymentTerms', 'Payment Terms'),
  c('warranty', 'Warranty'),
  c('customerId', 'Customer ID'),
  c('customerPoNumber', 'Customer PO Number'),
  c('salesOrder', 'Sales Order'),
  c('companyCode', 'Company Code'),
  c('roundNo', 'Round', 'num'),
  c('technicalCompliance', 'Meets Technical Needs', 'bool'),
  c('deviationPct', 'Deviation From Lowest', 'pct'),
]);
const VQ_BASE = ['number', 'rfqNo', 'vendor', 'quoteDate', 'baseAmount', 'discount', 'gst'];
const VQ: PageSpec = {
  kind: 'quote',
  pageId: 'scm-vendorquote',
  path: '/scm/vendorquote',
  title: 'Vendor Quotations',
  cols: VQ_COLS,
  register: [...VQ_BASE, 'freight', 'landedCost', 'leadTimeDays', 'paymentTerms', 'warranty'],
  trailing: ['customerId', 'customerPoNumber', 'salesOrder'],
  compact: VQ_BASE,
  amountKey: 'landedCost',
  amountLabel: 'Landed Cost',
  dateKey: 'quoteDate',
  required: ['rfqNo', 'vendor', 'quoteDate', 'baseAmount', 'leadTimeDays', 'paymentTerms'],
  rules: (r, all) => [
    lvl(has(r.vendor) && n(r.baseAmount) > 0 && r.technicalCompliance !== false),
    has(r.rfqNo) ? 'pass' : 'warn',
    has(r.validUntil) ? lvl(String(r.validUntil) >= String(r.quoteDate)) : 'warn',
    lvl(n(r.landedCost) >= n(r.baseAmount) - n(r.discount)),
    null,
    lvl(!(r.isCurrent === false && r.status === 'Approved'), 'warn'),
    all.filter((x) => x.vendor === r.vendor && x.rfqNo === r.rfqNo && x.roundNo === r.roundNo)
      .length > 1
      ? 'warn'
      : 'pass',
    approvalLevel(r.status),
  ],
  cal: (r) =>
    has(r.validUntil)
      ? {
          date: r.validUntil,
          subject: `Quote valid until · ${String(r.number)} · ${txt(r.vendor, '')}`,
        }
      : null,
  tabs: {
    'Commercial Breakdown': { panel: { type: 'breakdown' }, cols: VQ_BASE },
    'Technical Compliance': {
      panel: { type: 'validation', hint: 'Rule results over the quotations on this page.' },
      cols: [
        'gst',
        'companyCode',
        'number',
        'rfqNo',
        'vendor',
        'quoteDate',
        'baseAmount',
        'technicalCompliance',
      ],
    },
    'Negotiation History': { panel: { type: 'channel' }, cols: [...VQ_BASE, 'roundNo'] },
    'Deviation Log': {
      cols: [
        ...VQ_BASE,
        'freight',
        'landedCost',
        'deviationPct',
        'leadTimeDays',
        'paymentTerms',
        'warranty',
      ],
    },
    'Quote Analytics': { panel: { type: 'analytics' }, cols: VQ_BASE },
  },
};

// ------------------------------------------------------------------------------------------------ vendor comparison
const CMP_COLS = dict([
  c('documentNo', 'Document No'),
  c('vendor', 'Vendor'),
  c('department', 'Department'),
  c('buyer', 'Buyer'),
  c('documentDate', 'Date', 'date'),
  c('requiredDate', 'Required Date', 'date'),
  c('amount', 'Amount', 'inr'),
  c('companyCode', 'Company Code'),
  c('rfqNo', 'RFQ No'),
  c('quoteCount', 'Quotes Compared', 'num'),
  c('bestLanded', 'Lowest Landed Cost', 'inr'),
  c('topScore', 'Top Score', 'num'),
  c('awardedVendor', 'Awarded To'),
  c('wPrice', 'Price Weight', 'num'),
  c('wLead', 'Lead Weight', 'num'),
  c('wQuality', 'Quality Weight', 'num'),
]);
const CMP_BASE = [
  'documentNo',
  'vendor',
  'department',
  'buyer',
  'documentDate',
  'requiredDate',
  'amount',
];
const CMP: PageSpec = {
  kind: 'comparison',
  pageId: 'scm-comparison',
  path: '/scm/comparison',
  title: 'Vendor Comparison',
  cols: CMP_COLS,
  register: CMP_BASE,
  compact: CMP_BASE,
  amountKey: 'amount',
  amountLabel: 'Amount',
  dateKey: 'documentDate',
  required: ['vendor', 'buyer', 'documentDate', 'requiredDate', 'amount'],
  statusKey: 'status',
  rules: (r, all) => [
    lvl(n(r.quoteCount) >= 1),
    has(r.rfqNo) ? 'pass' : 'warn',
    has(r.requiredDate) ? 'pass' : 'warn',
    n(r.quoteCount) >= 3 ? 'pass' : 'warn',
    null,
    lvl(!(has(r.awardedVendor) && !has(r.lockedAt)), 'warn'),
    dupLevel(r, all, ['documentNo']),
    approvalLevel(r.status),
  ],
  tabs: {
    'Weighted Criteria': {
      panel: {
        type: 'allocation',
        hint: 'Quotations compared in each sheet. Quantity-style columns have no source here and stay empty; the weights are in the table.',
        map: (r) => [r.documentNo, r.quoteCount, null, null, null, null],
      },
      cols: [...CMP_BASE, 'wPrice', 'wLead', 'wQuality'],
    },
    'Landed Cost': {
      panel: { type: 'simulation' },
      cols: [
        'amount',
        'documentNo',
        'vendor',
        'department',
        'buyer',
        'documentDate',
        'requiredDate',
        'bestLanded',
      ],
    },
    'Technical Compliance': {
      panel: { type: 'validation', hint: 'Rule results over the comparisons on this page.' },
      cols: [
        'companyCode',
        'documentNo',
        'vendor',
        'department',
        'buyer',
        'documentDate',
        'requiredDate',
      ],
    },
    'Negotiation Scenario': { panel: { type: 'channel' }, cols: CMP_BASE },
    'Award Recommendation': { cols: [...CMP_BASE, 'topScore', 'awardedVendor'] },
  },
};

// ------------------------------------------------------------------------------------------------ supplier evaluation
const EVA_COLS = dict([
  c('evaluationNo', 'Evaluation No'),
  c('vendor', 'Vendor'),
  c('period', 'Period'),
  c('qualityScore', 'Quality Score', 'num'),
  c('deliveryOtif', 'Delivery OTIF', 'pct'),
  c('costScore', 'Cost Score', 'num'),
  c('responsiveness', 'Responsiveness', 'num'),
  c('projectNumber', 'Project Number'),
  c('rank', 'Rank', 'num'),
  c('grade', 'Grade'),
  c('overall', 'Overall', 'num'),
  c('ppm', 'Defects PPM', 'num'),
  c('deliveryScore', 'Delivery Score', 'num'),
  c('complianceOk', 'Compliant', 'bool'),
]);
const EVA_BASE = [
  'evaluationNo',
  'vendor',
  'period',
  'qualityScore',
  'deliveryOtif',
  'costScore',
  'responsiveness',
];
const EVA: PageSpec = {
  kind: 'evaluation',
  pageId: 'scm-evaluation',
  title: 'Supplier Evaluation',
  cols: EVA_COLS,
  register: EVA_BASE,
  compact: EVA_BASE,
  amountKey: 'overall',
  amountLabel: 'Overall Score',
  dateKey: 'createdAt',
  required: ['vendor', 'period', 'qualityScore', 'deliveryOtif', 'costScore', 'responsiveness'],
  rules: (r) => [
    lvl(has(r.qualityScore) && has(r.costScore)),
    null,
    null,
    r.complianceOk === false ? 'fail' : 'pass',
    null,
    r.riskFlag === true ? 'warn' : 'pass',
    null,
    r.complianceOk === false ? 'fail' : r.complianceOk === true ? 'pass' : null,
  ],
  cal: (r) =>
    has(r.period)
      ? {
          date: `${String(r.period)}-01`,
          subject: `Evaluation period ${String(r.period)} · ${txt(r.vendor, '')}`,
        }
      : null,
  tabs: {
    'Evaluation Cycles': { panel: { type: 'simulation' }, cols: EVA_BASE },
    'Quality Score': { cols: [...EVA_BASE, 'ppm'] },
    'Delivery OTIF': { cols: [...EVA_BASE, 'deliveryScore'] },
    'Cost Competitiveness': {
      panel: { type: 'simulation' },
      cols: [
        'costScore',
        'evaluationNo',
        'vendor',
        'period',
        'qualityScore',
        'deliveryOtif',
        'responsiveness',
      ],
    },
    'Compliance Rating': {
      panel: {
        type: 'validation',
        hint: 'Compliance and risk results over the evaluations on this page.',
      },
      cols: [...EVA_BASE, 'complianceOk'],
    },
    'Supplier Ranking': {
      panel: {
        type: 'allocation',
        hint: 'Rank and grade of the evaluated suppliers. Stock-style columns have no source here and stay empty.',
        map: (r) => [
          r.evaluationNo,
          null,
          null,
          null,
          null,
          `Rank ${txt(r.rank, '—')} · Grade ${txt(r.grade, '—')}`,
        ],
      },
      cols: [
        'vendor',
        'responsiveness',
        'projectNumber',
        'evaluationNo',
        'period',
        'qualityScore',
        'rank',
        'grade',
      ],
    },
  },
};

// ------------------------------------------------------------------------------------------------ contracts
const CON_COLS = dict([
  c('number', 'Contract No'),
  c('vendor', 'Vendor'),
  c('contractType', 'Contract Type'),
  c('category', 'Category'),
  c('startDate', 'Start Date', 'date'),
  c('endDate', 'End Date', 'date'),
  c('currency', 'Currency'),
  c('committedValue', 'Committed Value', 'inr'),
  c('consumedValue', 'Consumed Value', 'inr'),
  c('balanceValue', 'Balance Value', 'inr'),
  c('releaseOrders', 'Release Orders', 'num'),
  c('renewalDate', 'Renewal Date', 'date'),
  c('lineCount', 'Rate Lines', 'num'),
  c('utilisationPct', 'Utilisation', 'pct'),
]);
const CON_BASE = [
  'number',
  'vendor',
  'contractType',
  'category',
  'startDate',
  'endDate',
  'currency',
];
const CON: PageSpec = {
  kind: 'contract',
  pageId: 'scm-contracts',
  path: '/scm/contracts',
  title: 'Rate / Blanket Contracts',
  cols: CON_COLS,
  register: [
    ...CON_BASE,
    'committedValue',
    'consumedValue',
    'balanceValue',
    'releaseOrders',
    'renewalDate',
  ],
  compact: CON_BASE,
  amountKey: 'committedValue',
  amountLabel: 'Committed Value',
  dateKey: 'startDate',
  required: ['vendor', 'startDate', 'endDate', 'committedValue', 'category'],
  rules: (r, all) => [
    lvl(has(r.vendor) && has(r.startDate) && has(r.endDate) && n(r.lineCount) > 0),
    lvl(n(r.lineCount) > 0),
    has(r.daysLeft) ? (n(r.daysLeft) < 0 ? 'fail' : n(r.daysLeft) <= 30 ? 'warn' : 'pass') : 'warn',
    has(r.balanceValue)
      ? n(r.balanceValue) < 0
        ? 'fail'
        : n(r.consumedValue) >= 0.9 * n(r.committedValue)
          ? 'warn'
          : 'pass'
      : 'warn',
    null,
    lvl(!(r.status === 'Approved' && n(r.daysLeft) < 0), 'warn'),
    dupLevel(r, all, ['vendor', 'startDate', 'endDate']),
    approvalLevel(r.status),
  ],
  cal: (r) =>
    has(r.endDate)
      ? {
          date: r.endDate,
          subject: `Contract ends ${String(r.number)} · ${txt(r.vendor, '')}`,
        }
      : null,
  tabs: {
    'Rate Schedule': { panel: { type: 'calendar' }, cols: [...CON_BASE, 'lineCount'] },
    'Volume Commitments': {
      panel: {
        type: 'allocation',
        hint: 'Committed quantity of the contract lines against what purchase orders have already released.',
        map: (r) => [
          r.number,
          r.committedQty,
          maxZero(n(r.committedQty) - n(r.consumedQty)),
          r.consumedQty,
          null,
          dash(r.vendor),
        ],
      },
      cols: CON_BASE,
    },
    'Validity & Renewal': {
      panel: {
        type: 'validation',
        hint: 'Validity and limit results over the contracts on this page.',
      },
      cols: CON_BASE,
    },
    'Release Orders': {
      cols: ['startDate', 'endDate', 'releaseOrders', 'renewalDate', 'number', 'vendor'],
    },
    'Contract Utilization': { panel: { type: 'analytics' }, cols: [...CON_BASE, 'utilisationPct'] },
  },
};

export const SPECS: Record<string, PageSpec> = {
  'scm-po': PO,
  'scm-grn': GRN,
  'scm-pr': PR,
  'scm-purchaseinvoice': INV,
  'scm-suppliers': SUP,
  'scm-rfq': RFQ,
  'scm-vendorquote': VQ,
  'scm-comparison': CMP,
  'scm-evaluation': EVA,
  'scm-contracts': CON,
};

/** Values the rows do not carry as such: computed here from real fields of the same row / the same page. */
export function enrich(spec: PageSpec, rows: Row[]): Row[] {
  if (spec.kind === 'quote') {
    const best = new Map<string, number>();
    for (const r of rows) {
      const k = txt(r.rfqNo, '');
      const v = n(r.landedCost);
      if (v > 0 && (!best.has(k) || v < (best.get(k) ?? Infinity))) best.set(k, v);
    }
    return rows.map((r) => {
      const b = best.get(txt(r.rfqNo, ''));
      return {
        ...r,
        deviationPct: b && n(r.landedCost) > 0 ? ((n(r.landedCost) - b) / b) * 100 : null,
      };
    });
  }
  if (spec.kind === 'contract')
    return rows.map((r) => ({
      ...r,
      renewalDate: r.endDate ?? null,
      utilisationPct:
        n(r.committedValue) > 0 ? (n(r.consumedValue) / n(r.committedValue)) * 100 : null,
    }));
  return rows;
}
