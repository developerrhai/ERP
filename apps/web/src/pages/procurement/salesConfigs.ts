// Config of the CRM and Sales header + lines pages (see DocPage.tsx).
import type { DocCfg } from './DocPage';

export const LEAD_CFG: DocCfg = {
  title: 'Lead Management',
  sub: 'Enquiries before they are customers. Qualify a lead, then convert it into an opportunity.',
  path: '/crm/leads',
  add: '＋ New Lead',
  columns: [
    { key: 'name', label: 'Name' },
    { key: 'company', label: 'Company' },
    { key: 'mobile', label: 'Mobile' },
    { key: 'estValue', label: 'Expected value', fmt: 'inr' },
  ],
  header: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'company', label: 'Company', type: 'text' },
    { key: 'mobile', label: 'Mobile', type: 'text' },
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'interest', label: 'Interested in', type: 'text' },
    { key: 'estValue', label: 'Expected value', type: 'number' },
  ],
  more: [
    ['status', 'Mark Contacted', 'New', false, { body: { status: 'Contacted' } }],
    ['status', 'Mark Qualified', 'New,Contacted', false, { body: { status: 'Qualified' } }],
    [
      'status',
      'Not qualified',
      'New,Contacted',
      false,
      { body: { status: 'Unqualified' }, ask: [{ key: 'lostReason', label: 'Why', type: 'text' }] },
    ],
    ['convert', 'Convert to opportunity', 'Qualified', false, { body: {} }],
  ],
};

export const OPP_CFG: DocCfg = {
  title: 'Opportunity Management',
  sub: 'Deals being worked on. Move them along the stages on the Sales Pipeline board.',
  path: '/crm/opportunities',
  add: '＋ New Opportunity',
  columns: [
    { key: 'title', label: 'Title' },
    { key: 'customerName', label: 'Customer' },
    { key: 'amount', label: 'Value', fmt: 'inr' },
    { key: 'probability', label: 'Chance %' },
    { key: 'expectedClose', label: 'Expected close', fmt: 'date' },
  ],
  header: [
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'customerId', label: 'Customer', type: 'customer' },
    { key: 'amount', label: 'Value', type: 'number' },
    { key: 'probability', label: 'Chance %', type: 'number' },
    { key: 'expectedClose', label: 'Expected close', type: 'date' },
  ],
};

export const FU_CFG: DocCfg = {
  title: 'Follow-ups & Tasks',
  sub: 'Calls and tasks to do. Close each one with what happened.',
  path: '/crm/followups',
  add: '＋ New Follow-up',
  columns: [
    { key: 'title', label: 'Task' },
    { key: 'customerName', label: 'Customer' },
    { key: 'dueAt', label: 'Due', fmt: 'date' },
    { key: 'outcome', label: 'Outcome' },
  ],
  header: [
    { key: 'title', label: 'Task', type: 'text', required: true },
    { key: 'customerId', label: 'Customer', type: 'customer' },
    { key: 'dueAt', label: 'Due on', type: 'date', required: true },
  ],
  more: [
    [
      'done',
      'Mark done',
      'Open',
      false,
      { ask: [{ key: 'outcome', label: 'What happened', type: 'text' }] },
    ],
  ],
};

export const MTG_CFG: DocCfg = {
  title: 'Meetings & Calls',
  sub: 'Meetings and calls with customers and leads, with their outcome.',
  path: '/crm/meetings',
  add: '＋ New Meeting',
  columns: [
    { key: 'subject', label: 'Subject' },
    { key: 'customerName', label: 'Customer' },
    { key: 'kind', label: 'Kind' },
    { key: 'startsAt', label: 'On', fmt: 'date' },
    { key: 'outcome', label: 'Outcome' },
  ],
  header: [
    { key: 'subject', label: 'Subject', type: 'text', required: true },
    { key: 'customerId', label: 'Customer', type: 'customer' },
    {
      key: 'kind',
      label: 'Kind',
      type: 'select',
      options: [
        ['Meeting', 'Meeting'],
        ['Call', 'Call'],
      ],
      def: 'Meeting',
    },
    { key: 'startsAt', label: 'On', type: 'date', required: true },
  ],
  more: [
    [
      'held',
      'Mark held',
      'Planned',
      false,
      { ask: [{ key: 'outcome', label: 'Outcome', type: 'text' }] },
    ],
  ],
};

export const FB_CFG: DocCfg = {
  title: 'Customer Feedback',
  sub: 'What customers say, scored 0 to 10. Low scores need an action before they can be closed.',
  path: '/crm/feedback',
  add: '＋ New Feedback',
  columns: [
    { key: 'customerName', label: 'Customer' },
    { key: 'rating', label: 'Score' },
    { key: 'category', label: 'About' },
    { key: 'comment', label: 'Comment' },
  ],
  header: [
    { key: 'customerId', label: 'Customer', type: 'customer', required: true },
    { key: 'rating', label: 'Score (0-10)', type: 'number', required: true },
    { key: 'category', label: 'About', type: 'text', def: 'General' },
    { key: 'comment', label: 'Comment', type: 'text' },
  ],
  more: [
    ['status', 'Start review', 'New', false, { body: { status: 'In review' } }],
    [
      'status',
      'Close',
      'New,In review',
      false,
      {
        body: { status: 'Closed' },
        ask: [{ key: 'actionNote', label: 'Action taken', type: 'text' }],
      },
    ],
  ],
};

export const CRFQ_CFG: DocCfg = {
  title: 'Customer RFQs',
  sub: 'Enquiries from customers. Engineering says if it can be made, Finance checks the margin, then you quote.',
  path: '/sales/rfq',
  add: '＋ New Customer RFQ',
  columns: [
    { key: 'customerName', label: 'Customer' },
    { key: 'customerRef', label: 'Their reference' },
    { key: 'requiredBy', label: 'Needed by', fmt: 'date' },
    { key: 'feasibility', label: 'Engineering' },
    { key: 'financeMarginPct', label: 'Margin %' },
  ],
  header: [
    { key: 'customerId', label: 'Customer', type: 'customer', required: true },
    { key: 'customerRef', label: 'Their reference', type: 'text' },
    { key: 'requiredBy', label: 'Needed by', type: 'date' },
    { key: 'description', label: 'Description', type: 'text' },
  ],
  lines: [
    { key: 'itemId', label: 'Item', type: 'item' },
    { key: 'description', label: 'Part / description', type: 'text' },
    { key: 'qty', label: 'Quantity', type: 'number', required: true },
    { key: 'uom', label: 'Unit', type: 'text', def: 'NOS' },
    { key: 'targetRate', label: 'Their target rate', type: 'number' },
  ],
  more: [
    [
      'engineering-review',
      'Engineering: can be made',
      'Received,In review',
      false,
      { body: { feasible: true }, ask: [{ key: 'note', label: 'Engineering note', type: 'text' }] },
    ],
    [
      'engineering-review',
      'Engineering: cannot be made',
      'Received,In review',
      false,
      { body: { feasible: false }, ask: [{ key: 'note', label: 'Why not', type: 'text' }] },
    ],
    [
      'finance-review',
      'Finance: check margin',
      'Received,In review',
      false,
      {
        ask: [
          { key: 'marginPct', label: 'Expected margin %', type: 'number' },
          { key: 'note', label: 'Finance note', type: 'text' },
        ],
      },
    ],
    [
      'to-quotation',
      'Make quotation',
      'Reviewed',
      false,
      { ask: [{ key: 'gstPct', label: 'GST % for the quotation lines', type: 'number' }] },
    ],
  ],
};

export const SQ_CFG: DocCfg = {
  title: 'Sales Quotations',
  sub: 'Quotes to customers. After approval, record the customer’s decision, then make the sales order.',
  path: '/sales/quotations',
  add: '＋ New Quotation',
  columns: [
    { key: 'customerName', label: 'Customer' },
    { key: 'quoteDate', label: 'Date', fmt: 'date' },
    { key: 'grandTotal', label: 'Total', fmt: 'inr' },
    { key: 'marginPct', label: 'Margin %' },
    { key: 'customerStatus', label: 'Customer says' },
    { key: 'revisionNo', label: 'Revision' },
  ],
  header: [
    { key: 'customerId', label: 'Customer', type: 'customer', required: true },
    { key: 'validUntil', label: 'Valid until', type: 'date' },
    { key: 'formatCode', label: 'Quotation format', type: 'text' },
    { key: 'notes', label: 'Notes', type: 'text' },
  ],
  lines: [
    { key: 'itemId', label: 'Item', type: 'item' },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'qty', label: 'Quantity', type: 'number', required: true },
    { key: 'uom', label: 'Unit', type: 'text' },
    { key: 'rate', label: 'Rate (blank = price list)', type: 'number' },
    { key: 'discountPct', label: 'Discount %', type: 'number' },
    { key: 'gstPct', label: 'GST %', type: 'number' },
    { key: 'unitCost', label: 'Our cost per unit', type: 'number' },
  ],
  more: [
    ['revise', 'Revise', 'Approved,Rejected', true],
    [
      'customer-decision',
      'Customer accepted',
      'Approved',
      false,
      {
        body: { decision: 'ACCEPTED' },
        ask: [{ key: 'customerRef', label: 'Customer’s reference', type: 'text' }],
      },
    ],
    [
      'customer-decision',
      'Customer rejected',
      'Approved',
      false,
      { body: { decision: 'REJECTED' } },
    ],
    [
      'to-order',
      'Make sales order',
      'Approved',
      false,
      { ask: [{ key: 'customerPoNo', label: 'Customer PO number', type: 'text' }] },
    ],
  ],
};

export const SO_CFG: DocCfg = {
  title: 'Sales Orders',
  sub: 'Orders from customers. The credit limit is checked when you submit.',
  path: '/sales/orders',
  add: '＋ New Sales Order',
  columns: [
    { key: 'customerName', label: 'Customer' },
    { key: 'customerPoNo', label: 'Customer PO' },
    { key: 'orderDate', label: 'Date', fmt: 'date' },
    { key: 'grandTotal', label: 'Total', fmt: 'inr' },
  ],
  header: [
    { key: 'customerId', label: 'Customer', type: 'customer', required: true },
    { key: 'customerPoNo', label: 'Customer PO number', type: 'text' },
    { key: 'customerPoDate', label: 'Customer PO date', type: 'date' },
    { key: 'deliveryDate', label: 'Deliver by', type: 'date' },
    { key: 'shipTo', label: 'Ship to', type: 'text' },
  ],
  lines: [
    { key: 'itemId', label: 'Item', type: 'item', required: true },
    { key: 'partNo', label: 'Part no.', type: 'text' },
    { key: 'colour', label: 'Colour / powder', type: 'text' },
    { key: 'qty', label: 'Quantity', type: 'number', required: true },
    { key: 'uom', label: 'Unit', type: 'text' },
    { key: 'rate', label: 'Rate (blank = price list)', type: 'number' },
    { key: 'discountPct', label: 'Discount %', type: 'number' },
    { key: 'gstPct', label: 'GST %', type: 'number' },
  ],
  more: [
    [
      'credit-override',
      'Credit override',
      'Draft,Rejected',
      false,
      { ask: [{ key: 'reason', label: 'Reason (min 5 letters)', type: 'text' }] },
    ],
    ['reserve', 'Reserve stock', 'Approved', false, { body: {} }],
    ['short-close', 'Short-close balance', 'Approved', true],
  ],
};
