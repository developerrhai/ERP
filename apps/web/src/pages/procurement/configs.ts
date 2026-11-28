// Config of the header + lines purchasing pages (see DocPage.tsx).
import type { DocCfg, FieldCfg } from './DocPage';

/** A stored quantity without trailing zeros. */
const qtyText = (v: unknown): string => (v === null || v === undefined || v === '' ? '' : String(Number(v)));

const supplierType: [string, string][] = [
  ['MATERIAL', 'Material supplier'],
  ['CONTRACTOR', 'Contractor'],
];

const text = (key: string, label: string, extra: Partial<FieldCfg> = {}): FieldCfg => ({ key, label, type: 'text', clearable: true, ...extra });
const date = (key: string, label: string, extra: Partial<FieldCfg> = {}): FieldCfg => ({ key, label, type: 'date', nullable: true, ...extra });
const pick = (key: string, label: string, list: string, extra: Partial<FieldCfg> = {}): FieldCfg => ({
  key,
  label,
  type: 'ref',
  refPath: `/scm/options/${list}`,
  refLabel: ['label'],
  nullable: true,
  ...extra,
});
const given = (key: string, label: string): FieldCfg => ({ key, label, type: 'text', readOnly: true, placeholder: 'Given automatically when saved' });
const company: FieldCfg = { key: 'companyCode', label: 'Company Code', type: 'text', readOnly: true, placeholder: 'The plant chosen at the top' };

/** The references every purchasing document carries, under one heading. */
const connected = (first: FieldCfg[] = [], customerOrder: FieldCfg = pick('salesOrderId', 'Sales Order / Customer PO', 'sales-orders', { knownKey: 'salesOrderNo' })): FieldCfg[] => {
  const all: FieldCfg[] = [
    ...first,
    company,
    customerOrder,
    pick('customerId', 'Customer', 'customers', { knownKey: 'customerName' }),
    pick('mfgOrderId', 'Manufacturing Order', 'mfg-orders', { knownKey: 'mfgOrderNo' }),
    { key: 'projectNumber', label: 'Project Number', type: 'project', clearable: true },
  ];
  return all.map((f, i) => (i === 0 ? { ...f, section: 'Connected Master & Source Document' } : f));
};
const section = (name: string, fields: FieldCfg[]): FieldCfg[] => fields.map((f, i) => (i === 0 ? { ...f, section: name } : f));

export const PR_CFG: DocCfg = {
  pageId: 'scm-pr',
  title: 'Purchase Requisition',
  sub: 'Ask Purchase to buy what you need. After approval it becomes an RFQ or a purchase order.',
  path: '/scm/pr',
  add: '＋ New Requisition',
  itemPicker: true,
  wrapLines: true,
  keepLineKeys: ['serviceText', 'costCenterId'],
  columns: [
    { key: 'purpose', label: 'Purpose' },
    { key: 'requiredDate', label: 'Needed by', fmt: 'date' },
    { key: 'estimatedTotal', label: 'Estimated value', fmt: 'inr' },
  ],
  header: [
    ...connected(),
    ...section('Requisition details', [
      given('number', 'PR Number'),
      date('prDate', 'PR Date', { today: true }),
      { key: 'supplierType', label: 'For', type: 'select', options: supplierType, def: 'MATERIAL' },
      date('requiredDate', 'Needed by'),
      text('purpose', 'Purpose'),
      pick('requestDepartment', 'Department', 'departments', { knownKey: 'requestDepartment' }),
      pick('requestedById', 'Requester', 'users', { knownKey: 'requesterName' }),
      { key: 'preferredSupplierId', label: 'Preferred Vendor', type: 'supplier', nullable: true, knownKey: 'preferredSupplierName' },
      {
        key: 'priority',
        label: 'Priority',
        type: 'select',
        clearable: true,
        def: 'Medium',
        options: [['', 'Not set'], ['Low', 'Low'], ['Medium', 'Medium'], ['High', 'High'], ['Urgent', 'Urgent']],
      },
      pick('productionPlanId', 'Production Plan', 'production-plans', { knownKey: 'productionPlanNo' }),
      text('mrpLineNo', 'MRP Line No'),
    ]),
  ],
  lines: [
    { key: 'itemId', label: 'Item', type: 'item', required: true },
    { key: 'uom', label: 'Unit', type: 'text', required: true },
    { key: 'qty', label: 'Quantity', type: 'number', required: true },
    { key: 'estRate', label: 'Expected rate', type: 'number' },
    { key: 'requiredDate', label: 'Needed by', type: 'date' },
  ],
  more: [['to-rfq', 'Create RFQ', 'Approved', false]],
};

export const RFQ_CFG: DocCfg = {
  pageId: 'scm-rfq',
  title: 'RFQ Management',
  sub: 'Ask suppliers for quotes. Invite at least one supplier, then issue the RFQ.',
  path: '/scm/rfq',
  add: '＋ New RFQ',
  invite: true,
  itemPicker: true,
  wrapLines: true,
  keepLineKeys: ['prLineId', 'serviceText', 'requiredDate'],
  columns: [
    { key: 'dueDate', label: 'Quote by', fmt: 'date' },
    { key: 'issuedAt', label: 'Issued', fmt: 'date' },
  ],
  header: [
    ...connected([pick('prId', 'Source Requisition (PR Number)', 'requisitions', { loads: 'pr' })]),
    ...section('RFQ details', [
      given('number', 'RFQ No'),
      date('issueDate', 'RFQ Date', { today: true }),
      date('dueDate', 'Quote by'),
      { key: 'supplierType', label: 'For', type: 'select', options: supplierType, def: 'MATERIAL' },
      pick('buyerId', 'Buyer', 'users', { knownKey: 'buyerName' }),
      text('category', 'Category'),
      text('technicalSpec', 'Technical Specification'),
      text('commercialTerms', 'Commercial Terms'),
      text('deliveryLocation', 'Delivery Location'),
      text('validity', 'Validity'),
      text('notes', 'Notes'),
    ]),
  ],
  lines: [
    { key: 'itemId', label: 'Item', type: 'item', required: true },
    { key: 'uom', label: 'Unit', type: 'text', required: true },
    { key: 'qty', label: 'Quantity', type: 'number', required: true },
  ],
  more: [['issue', 'Issue RFQ', 'Approved', false]],
};

export const VQ_CFG: DocCfg = {
  pageId: 'scm-vendorquote',
  title: 'Vendor Quotations',
  sub: 'What each supplier offered. Negotiate again to start a new round.',
  path: '/scm/vendorquote',
  add: '＋ New Quotation',
  itemPicker: true,
  wrapLines: true,
  landedTotals: true,
  keepLineKeys: ['rfqLineId', 'landedCost'],
  detailLines: [{ label: 'HSN/SAC', value: (l) => (typeof l.hsnSac === 'string' ? l.hsnSac : '') }],
  columns: [
    { key: 'supplierName', label: 'Supplier' },
    { key: 'roundNo', label: 'Round' },
    { key: 'total', label: 'Total (before tax)', fmt: 'inr' },
  ],
  header: [
    ...connected([{ key: 'rfqId', label: 'RFQ', type: 'ref', refPath: '/scm/rfq', nullable: true, loads: 'rfq' }]),
    ...section('Quotation details', [
      given('number', 'Quote No'),
      { key: 'supplierId', label: 'Supplier', type: 'supplier', required: true, knownKey: 'supplierName' },
      date('quoteDate', 'Quote Date', { today: true, nullable: false }),
      date('validUntil', 'Valid until'),
      { key: 'freight', label: 'Freight', type: 'number' },
      pick('paymentTermId', 'Payment Terms', 'payment-terms', { knownKey: 'paymentTerms' }),
      text('warranty', 'Warranty'),
      { key: 'technicalCompliance', label: 'Meets technical needs', type: 'check', def: 'true' },
      text('complianceNote', 'Technical Compliance Note'),
      text('notes', 'Notes'),
    ]),
  ],
  lines: [
    { key: 'itemId', label: 'Item', type: 'item', required: true },
    { key: 'uom', label: 'Unit', type: 'text', required: true },
    { key: 'qty', label: 'Quantity', type: 'number', required: true },
    { key: 'rate', label: 'Rate', type: 'number', required: true },
    { key: 'discountPct', label: 'Discount %', type: 'number' },
    { key: 'gstPct', label: 'GST %', type: 'number' },
    { key: 'leadDays', label: 'Lead days', type: 'number' },
  ],
  more: [['round', 'Negotiate again', 'Approved', false]],
};

export const PO_CFG: DocCfg = {
  pageId: 'scm-po',
  title: 'Purchase Orders',
  sub: 'Orders placed with suppliers. Approved orders can be received against.',
  path: '/scm/po',
  add: '＋ New Purchase Order',
  delivery: true,
  itemPicker: true,
  wrapLines: true,
  keepLineKeys: ['prLineId'],
  detailLines: [
    { label: 'Received Quantity', value: (l) => qtyText(l.receivedQty) },
    { label: 'Cancelled Quantity', value: (l) => qtyText(l.closedQty) },
    { label: 'Pending Quantity', value: (l) => qtyText(Math.max(0, Number(l.qty) - Number(l.receivedQty ?? 0) - Number(l.closedQty ?? 0))) },
  ],
  columns: [
    { key: 'supplierName', label: 'Supplier' },
    { key: 'poDate', label: 'Date', fmt: 'date' },
    { key: 'grandTotal', label: 'Total', fmt: 'inr' },
    { key: 'revisionNo', label: 'Revision' },
  ],
  header: [
    ...connected(
      [pick('sourcePrId', 'Source Requisition (PR Number)', 'requisitions', { loads: 'pr', transient: true })],
      // the customer's order this purchase is for: shown as "Customer PO" next to this Supplier PO
      {
        key: 'salesOrderId',
        label: 'Customer PO',
        type: 'ref',
        refPath: '/scm/customer-pos',
        refLabel: ['customerPoNo', 'number', 'customerName'],
        clearable: true,
        knownKey: 'salesOrderNo',
      },
    ),
    ...section('Order details', [
      given('number', 'PO Number'),
      { key: 'supplierId', label: 'Supplier', type: 'supplier', required: true, knownKey: 'supplierName' },
      date('poDate', 'PO Date', { today: true, nullable: false }),
      { key: 'shipToWarehouseId', label: 'Deliver to', type: 'warehouse' },
      {
        key: 'poType',
        label: 'Type',
        type: 'select',
        options: [
          ['Standard', 'Standard'],
          ['Capital', 'Capital'],
          ['Service', 'Service'],
          ['Subcontract', 'Subcontract'],
        ],
        def: 'Standard',
      },
      {
        key: 'supplierType',
        label: 'Supplier is a',
        type: 'select',
        options: supplierType,
        def: 'MATERIAL',
      },
      pick('paymentTermId', 'Payment Terms', 'payment-terms', { knownKey: 'paymentTerms' }),
      text('notes', 'Notes', { clearable: false }),
    ]),
  ],
  lines: [
    { key: 'itemId', label: 'Item', type: 'item', required: true },
    { key: 'uom', label: 'Unit', type: 'text', required: true },
    { key: 'qty', label: 'Quantity', type: 'number', required: true },
    { key: 'rate', label: 'Rate', type: 'number', required: true },
    { key: 'discountPct', label: 'Discount %', type: 'number' },
    { key: 'gstPct', label: 'GST %', type: 'number' },
    { key: 'deliveryDate', label: 'Expected Delivery Date', type: 'date' },
    { key: 'partNo', label: 'Part Number / SKU', type: 'text' },
  ],
  more: [
    ['amend', 'Amend', 'Approved', true],
    ['short-close', 'Short-close balance', 'Approved', true],
  ],
};

/** The comparison sheet's own fields (the quotations and scores come from the server). */
export const CMP_CFG: DocCfg = {
  title: 'Vendor Comparison',
  sub: '',
  path: '/scm/comparison',
  add: '＋ New Comparison',
  columns: [],
  header: [
    ...connected(),
    ...section('Comparison details', [
      given('number', 'Document No'),
      date('docDate', 'Date'),
      date('requiredDate', 'Required Date'),
      pick('requestDepartment', 'Department', 'departments', { knownKey: 'requestDepartment' }),
      pick('buyerId', 'Buyer', 'users', { knownKey: 'buyerName' }),
      text('reference', 'Reference'),
      { key: 'wPrice', label: 'Price weight', type: 'number' },
      { key: 'wLead', label: 'Delivery time weight', type: 'number' },
      { key: 'wQuality', label: 'Quality weight', type: 'number' },
    ]),
  ],
};

export const CON_CFG: DocCfg = {
  pageId: 'scm-contracts',
  title: 'Rate / Blanket Contracts',
  sub: 'Agreed rates with a supplier. Purchase orders release against the contract up to its limits.',
  path: '/scm/contracts',
  add: '＋ New Contract',
  columns: [
    { key: 'supplierName', label: 'Supplier' },
    { key: 'validFrom', label: 'From', fmt: 'date' },
    { key: 'validTo', label: 'To', fmt: 'date' },
    { key: 'maxValue', label: 'Limit', fmt: 'inr' },
    { key: 'releasedValue', label: 'Released', fmt: 'inr' },
  ],
  header: [
    { key: 'supplierId', label: 'Supplier', type: 'supplier', required: true },
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'validFrom', label: 'Valid from', type: 'date', required: true },
    { key: 'validTo', label: 'Valid to', type: 'date', required: true },
    {
      key: 'contractType',
      label: 'Kind',
      type: 'select',
      options: [
        ['RATE', 'Rate contract'],
        ['BLANKET', 'Blanket order'],
      ],
      def: 'RATE',
    },
    { key: 'maxValue', label: 'Value limit', type: 'number' },
  ],
  lines: [
    { key: 'itemId', label: 'Item', type: 'item', required: true },
    { key: 'uom', label: 'Unit', type: 'text', required: true },
    { key: 'rate', label: 'Rate', type: 'number', required: true },
    { key: 'discountPct', label: 'Discount %', type: 'number' },
    { key: 'minQty', label: 'Min qty', type: 'number' },
    { key: 'maxQty', label: 'Max qty', type: 'number' },
  ],
};
