// Config of the header + lines purchasing pages (see DocPage.tsx).
import type { DocCfg } from './DocPage';

const supplierType: [string, string][] = [
  ['MATERIAL', 'Material supplier'],
  ['CONTRACTOR', 'Contractor'],
];

export const PR_CFG: DocCfg = {
  title: 'Purchase Requisition',
  sub: 'Ask Purchase to buy what you need. After approval it becomes an RFQ or a purchase order.',
  path: '/scm/pr',
  add: '＋ New Requisition',
  columns: [
    { key: 'purpose', label: 'Purpose' },
    { key: 'requiredDate', label: 'Needed by', fmt: 'date' },
    { key: 'estimatedTotal', label: 'Estimated value', fmt: 'inr' },
  ],
  header: [
    { key: 'supplierType', label: 'For', type: 'select', options: supplierType, def: 'MATERIAL' },
    { key: 'requiredDate', label: 'Needed by', type: 'date' },
    { key: 'purpose', label: 'Purpose', type: 'text' },
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
  title: 'RFQ Management',
  sub: 'Ask suppliers for quotes. Invite at least one supplier, then issue the RFQ.',
  path: '/scm/rfq',
  add: '＋ New RFQ',
  invite: true,
  columns: [
    { key: 'dueDate', label: 'Quote by', fmt: 'date' },
    { key: 'issuedAt', label: 'Issued', fmt: 'date' },
  ],
  header: [
    { key: 'supplierType', label: 'For', type: 'select', options: supplierType, def: 'MATERIAL' },
    { key: 'dueDate', label: 'Quote by', type: 'date' },
    { key: 'notes', label: 'Notes', type: 'text' },
  ],
  lines: [
    { key: 'itemId', label: 'Item', type: 'item', required: true },
    { key: 'uom', label: 'Unit', type: 'text', required: true },
    { key: 'qty', label: 'Quantity', type: 'number', required: true },
  ],
  more: [['issue', 'Issue RFQ', 'Approved', false]],
};

export const VQ_CFG: DocCfg = {
  title: 'Vendor Quotations',
  sub: 'What each supplier offered. Negotiate again to start a new round.',
  path: '/scm/vendorquote',
  add: '＋ New Quotation',
  columns: [
    { key: 'supplierName', label: 'Supplier' },
    { key: 'roundNo', label: 'Round' },
    { key: 'total', label: 'Total (before tax)', fmt: 'inr' },
  ],
  header: [
    { key: 'supplierId', label: 'Supplier', type: 'supplier', required: true },
    { key: 'rfqId', label: 'RFQ', type: 'ref', refPath: '/scm/rfq' },
    { key: 'validUntil', label: 'Valid until', type: 'date' },
    { key: 'freight', label: 'Freight', type: 'number' },
    { key: 'technicalCompliance', label: 'Meets technical needs', type: 'check', def: 'true' },
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
  title: 'Purchase Orders',
  sub: 'Orders placed with suppliers. Approved orders can be received against.',
  path: '/scm/po',
  add: '＋ New Purchase Order',
  delivery: true,
  columns: [
    { key: 'supplierName', label: 'Supplier' },
    { key: 'poDate', label: 'Date', fmt: 'date' },
    { key: 'grandTotal', label: 'Total', fmt: 'inr' },
    { key: 'revisionNo', label: 'Revision' },
  ],
  header: [
    { key: 'supplierId', label: 'Supplier', type: 'supplier', required: true },
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
    { key: 'notes', label: 'Notes', type: 'text' },
  ],
  lines: [
    { key: 'itemId', label: 'Item', type: 'item', required: true },
    { key: 'uom', label: 'Unit', type: 'text', required: true },
    { key: 'qty', label: 'Quantity', type: 'number', required: true },
    { key: 'rate', label: 'Rate', type: 'number', required: true },
    { key: 'discountPct', label: 'Discount %', type: 'number' },
    { key: 'gstPct', label: 'GST %', type: 'number' },
    { key: 'deliveryDate', label: 'Deliver by', type: 'date' },
    { key: 'partNo', label: 'Part no.', type: 'text' },
  ],
  more: [
    ['amend', 'Amend', 'Approved', true],
    ['short-close', 'Short-close balance', 'Approved', true],
  ],
};

export const CON_CFG: DocCfg = {
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
