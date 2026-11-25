// V40 tab definitions of the Finance & Accounts pages. The engine is in v40-engine.ts; every column below is a real
// field of open_items / gl_entries / payments / journals / budgets ... or a value computed from them. A label with no
// expression has no source in the database yet (it shows a dash and is listed in noSource).
import {
  ACTIONS,
  DOCS,
  allocPanel,
  apJoin,
  approvalCols,
  d,
  exc,
  exceptionPanel,
  ledgerPanel,
  m,
  n,
  NOAP,
  none,
  partyName,
  pill,
  settlePanel,
  t,
  validationPanel,
} from './v40-engine';
import type { PageDef, PanelDef, ViewDef } from './v40-engine';


/** The financial year that contains today: report pages read it as `fy` */
const FY = `(SELECT fy0.id, fy0.start_date, fy0.end_date FROM financial_years fy0 WHERE fy0.start_date <= current_date AND fy0.end_date >= current_date ORDER BY fy0.start_date DESC LIMIT 1) fy`;

const view = (match: RegExp, labels: string[], more: Partial<ViewDef> = {}): ViewDef => ({ match, labels, ...more });
const names = (a: string[]): string => a.map((x) => `'${x}'`).join(',');
const GST_SUBTYPES = `('GSTInput','GSTOutput','GSTRCM')`;

/** open items of both sides (the sub-ledger behind the control accounts) */
const openItemsPanel = (title: string, types: string[] = ['INVOICE']): PanelDef => {
  const p = settlePanel(title, 'RECEIVABLE', types);
  return { ...p, where: [`p.item_type IN (${names(types)})`, `p.status<>'Cancelled'`, 'p.outstanding>0'] };
};

// ================================================================================================ fin-ap
const AP_INV = `t.item_type='INVOICE'`;
const AP_COMPACT = ['Vendor Invoice', 'Vendor', 'Invoice Date', 'Due Date', 'Invoice Amount', 'Paid', 'Outstanding', 'Status', 'Actions'];
const AP: PageDef = {
  from: `open_items t LEFT JOIN suppliers su ON su.id=t.party_id LEFT JOIN purchase_invoices pi ON pi.id=t.doc_id LEFT JOIN projects pr ON pr.id=pi.project_id ${apJoin('fin-ap')}`,
  soft: null,
  number: 't.doc_no',
  status: 't.status',
  search: ['t.doc_no', 'su.name', 'pi.vendor_invoice_no'],
  base: [`t.side='PAYABLE'`, `t.status<>'Cancelled'`],
  dflt: [AP_INV],
  order: 't.due_date NULLS LAST, t.doc_no',
  metric: { label: 'Invoice Amount', e: 'abs(t.amount)' },
  calendar: 't.due_date',
  cols: {
    ...approvalCols('t.doc_no'),
    'Vendor Invoice': t('COALESCE(pi.vendor_invoice_no, t.doc_no)'),
    Vendor: t('su.name'),
    'Invoice Date': d('t.doc_date'),
    'Due Date': d('t.due_date'),
    'Invoice Amount': m('abs(t.amount)'),
    Paid: m('t.settled_amount'),
    Outstanding: m('abs(t.outstanding)'),
    'Age Days': n(`CASE WHEN t.outstanding<>0 THEN GREATEST(current_date - t.doc_date, 0) END`),
    'Payment Block': t(`CASE WHEN pi.payment_block THEN COALESCE(pi.payment_block_reason,'Blocked') ELSE t.blocked_reason END`),
    'Payment Method': t('t.payment_method'),
    Status: pill('t.status'),
    'Project Number': t('pr.code'),
    Docs: DOCS('fin-ap'),
    Actions: ACTIONS,
  },
  register: ['Vendor Invoice', 'Vendor', 'Invoice Date', 'Due Date', 'Invoice Amount', 'Status', 'Project Number', 'Actions'],
  compact: AP_COMPACT,
  views: [
    view(/^vendor payables$/i, ['Vendor Invoice', 'Vendor', 'Invoice Date', 'Due Date', 'Invoice Amount', 'Status', 'Project Number', 'Actions'], {
      panel: settlePanel('Open payables', 'PAYABLE', ['INVOICE']),
    }),
    view(/^invoice queue$/i, ['Vendor Invoice', 'Vendor', 'Invoice Date', 'Due Date', 'Invoice Amount', 'Paid', 'Outstanding', 'Age Days', 'Payment Block', 'Payment Method', 'Status', 'Project Number', 'Docs', 'Actions'], {
      where: [AP_INV],
      order: 't.doc_date DESC, t.doc_no',
    }),
    view(/^due schedule$/i, ['Vendor Invoice', 'Vendor', 'Invoice Date', 'Due Date', 'Invoice Amount', 'Paid', 'Outstanding', 'Status', 'Actions'], {
      where: [AP_INV, 't.outstanding>0'],
      panel: settlePanel('Due schedule', 'PAYABLE', ['INVOICE']),
    }),
    view(/^payment proposal$/i, ['Invoice Date', 'Due Date', 'Paid', 'Payment Block', 'Payment Method', 'Status', 'Vendor Invoice', 'Actions'], {
      where: [AP_INV, 't.outstanding>0', `t.status NOT IN ('Blocked','Disputed')`, `COALESCE(pi.payment_block,false)=false`],
      panel: settlePanel('Invoices ready for a payment proposal', 'PAYABLE', ['INVOICE']),
    }),
    view(/^debit notes$/i, AP_COMPACT, {
      where: [`t.item_type='DEBIT_NOTE'`],
      panel: settlePanel('Open debit notes', 'PAYABLE', ['DEBIT_NOTE'], true),
    }),
    view(/^ap ageing$/i, AP_COMPACT, { where: [AP_INV, 't.outstanding>0', 't.due_date < current_date'], order: 't.due_date, t.doc_no' }),
  ],
};

// ================================================================================================ fin-ar
const AR_INV = `t.item_type='INVOICE'`;
const AR_COMPACT = ['Invoice No', 'Customer', 'Invoice Date', 'Due Date', 'Invoice Amount', 'Received', 'Outstanding', 'Status', 'Actions'];
const AR: PageDef = {
  from: `open_items t LEFT JOIN customers cu ON cu.id=t.party_id ${apJoin('fin-ar')}`,
  soft: null,
  number: 't.doc_no',
  status: 't.status',
  search: ['t.doc_no', 'cu.name'],
  base: [`t.side='RECEIVABLE'`, `t.status<>'Cancelled'`],
  dflt: [AR_INV],
  order: 't.due_date NULLS LAST, t.doc_no',
  metric: { label: 'Invoice Amount', e: 'abs(t.amount)' },
  calendar: 't.due_date',
  cols: {
    ...approvalCols('t.doc_no'),
    'Invoice No': t('t.doc_no'),
    Customer: t('cu.name'),
    'Invoice Date': d('t.doc_date'),
    'Due Date': d('t.due_date'),
    'Invoice Amount': m('abs(t.amount)'),
    Received: m('t.settled_amount'),
    Outstanding: m('abs(t.outstanding)'),
    Status: pill('t.status'),
    Docs: DOCS('fin-ar'),
    Actions: ACTIONS,
  },
  register: ['Invoice No', 'Customer', 'Invoice Date', 'Due Date', 'Invoice Amount', 'Status', 'Received', 'Actions'],
  compact: AR_COMPACT,
  views: [
    view(/^customer receivables$/i, ['Invoice No', 'Customer', 'Invoice Date', 'Due Date', 'Invoice Amount', 'Status', 'Received', 'Actions'], {
      panel: settlePanel('Open receivables', 'RECEIVABLE', ['INVOICE']),
    }),
    view(/^invoice exposure$/i, ['Invoice No', 'Customer', 'Invoice Date', 'Due Date', 'Invoice Amount', 'Status', 'Received', 'Actions'], {
      panel: ledgerPanel('Receivables ledger', [`pa.sub_type='Receivable'`]),
    }),
    view(/^due schedule$/i, AR_COMPACT.slice(0, 7).concat(['Status', 'Actions']), {
      where: [AR_INV, 't.outstanding>0'],
      panel: settlePanel('Due schedule', 'RECEIVABLE', ['INVOICE']),
    }),
    view(/^collection allocation$/i, ['Invoice Date', 'Due Date', 'Status', 'Invoice No', 'Customer', 'Invoice Amount', 'Received', 'Actions'], {
      where: [AR_INV, 't.outstanding>0'],
      panel: allocPanel(
        'Collection allocation',
        'open_items p',
        'p.unit_id',
        'p.due_date NULLS LAST, p.doc_no',
        {
          record: 'p.doc_no',
          demand: 'abs(p.amount)',
          available: `(SELECT COALESCE(-sum(r.outstanding),0) FROM open_items r WHERE r.party_id=p.party_id AND r.side='RECEIVABLE' AND r.item_type IN ('RECEIPT','ADVANCE','CREDIT_NOTE') AND r.status<>'Cancelled' AND r.outstanding<0)`,
          allocated: 'p.settled_amount',
          short: 'p.outstanding',
          id: 'COALESCE(p.doc_id,p.id)',
          action: `CASE WHEN p.outstanding>0 THEN 'Allocate' END`,
          where: [`p.side='RECEIVABLE'`, `p.item_type='INVOICE'`, `p.status<>'Cancelled'`, 'p.outstanding>0'],
        },
      ),
    }),
    view(/^credit notes$/i, AR_COMPACT, {
      where: [`t.item_type='CREDIT_NOTE'`],
      panel: settlePanel('Open credit notes', 'RECEIVABLE', ['CREDIT_NOTE'], true),
    }),
    view(/^ar ageing$/i, AR_COMPACT, { where: [AR_INV, 't.outstanding>0', 't.due_date < current_date'], order: 't.due_date, t.doc_no' }),
  ],
};

// ================================================================================================ fin-ageing
const AGE_BUCKETS = `sum(oi.outstanding) FILTER (WHERE oi.due_date IS NULL OR oi.due_date >= current_date) AS cur,
  sum(oi.outstanding) FILTER (WHERE oi.due_date < current_date AND oi.due_date >= current_date - 30) AS d30,
  sum(oi.outstanding) FILTER (WHERE oi.due_date < current_date - 30 AND oi.due_date >= current_date - 60) AS d60,
  sum(oi.outstanding) FILTER (WHERE oi.due_date < current_date - 60 AND oi.due_date >= current_date - 90) AS d90,
  sum(oi.outstanding) FILTER (WHERE oi.due_date < current_date - 90) AS d90p,
  sum(oi.outstanding) AS total`;
const AGEING_FROM = `(SELECT oi.party_id::text || oi.side AS id, oi.party_id, oi.side,
  COALESCE(cu.code, su.code) AS pcode, COALESCE(cu.name, su.name) AS pname, ${AGE_BUCKETS}
  FROM open_items oi LEFT JOIN customers cu ON cu.id=oi.party_id AND oi.side='RECEIVABLE' LEFT JOIN suppliers su ON su.id=oi.party_id AND oi.side='PAYABLE'
  WHERE oi.item_type='INVOICE' AND oi.outstanding>0 AND oi.status<>'Cancelled' AND {SCOPE:oi:nosoft}
  GROUP BY oi.party_id, oi.side, cu.code, cu.name, su.code, su.name) t ${NOAP}`;
const AGE_LABELS = ['Party Code', 'Party Name', 'Type', 'Current', '1 30 Days', '31 60 Days', '61 90 Days', 'Over 90 Days', 'Status', 'Actions'];
const AGEING: PageDef = {
  from: AGEING_FROM,
  unit: null,
  soft: null,
  number: 't.pcode',
  status: `CASE WHEN COALESCE(t.d90p,0)>0 THEN 'Critical' WHEN COALESCE(t.d30,0)+COALESCE(t.d60,0)+COALESCE(t.d90,0)>0 THEN 'Overdue' ELSE 'Current' END`,
  search: ['t.pcode', 't.pname'],
  order: 't.pname, t.side',
  metric: { label: 'Outstanding', e: 't.total' },
  cols: {
    ...approvalCols('t.pcode'),
    'Party Code': t('t.pcode'),
    'Party Name': t('t.pname'),
    Type: t(`CASE t.side WHEN 'RECEIVABLE' THEN 'Customer' ELSE 'Supplier' END`),
    Current: m('COALESCE(t.cur,0)'),
    '1 30 Days': m('COALESCE(t.d30,0)'),
    '31 60 Days': m('COALESCE(t.d60,0)'),
    '61 90 Days': m('COALESCE(t.d90,0)'),
    'Over 90 Days': m('COALESCE(t.d90p,0)'),
    Status: pill(`CASE WHEN COALESCE(t.d90p,0)>0 THEN 'Critical' WHEN COALESCE(t.d30,0)+COALESCE(t.d60,0)+COALESCE(t.d90,0)>0 THEN 'Overdue' ELSE 'Current' END`),
    Actions: ACTIONS,
  },
  register: AGE_LABELS,
  compact: AGE_LABELS,
  views: [
    view(/^ageing summary$/i, AGE_LABELS),
    view(/^receivable buckets$/i, AGE_LABELS, { where: [`t.side='RECEIVABLE'`], panel: settlePanel('Open receivables', 'RECEIVABLE', ['INVOICE']) }),
    view(/^payable buckets$/i, AGE_LABELS, { where: [`t.side='PAYABLE'`], panel: settlePanel('Open payables', 'PAYABLE', ['INVOICE']) }),
    view(/^top overdue accounts$/i, AGE_LABELS, {
      where: [`COALESCE(t.d30,0)+COALESCE(t.d60,0)+COALESCE(t.d90,0)+COALESCE(t.d90p,0)>0`],
      order: 'COALESCE(t.d30,0)+COALESCE(t.d60,0)+COALESCE(t.d90,0)+COALESCE(t.d90p,0) DESC, t.pname',
    }),
    view(/^collection priority$/i, ['Status', 'Party Code', 'Party Name', 'Type', 'Current', '1 30 Days', '31 60 Days', 'Over 90 Days', 'Actions'], {
      where: [`t.side='RECEIVABLE'`, `COALESCE(t.d30,0)+COALESCE(t.d60,0)+COALESCE(t.d90,0)+COALESCE(t.d90p,0)>0`],
      order: 'COALESCE(t.d90p,0) DESC, COALESCE(t.d90,0) DESC, t.pname',
      panel: settlePanel('Receivables to collect', 'RECEIVABLE', ['INVOICE']),
    }),
    view(/^ageing trend$/i, AGE_LABELS),
  ],
};

// ================================================================================================ ledger pages (gl entries)
// the party of the line, else the party carried by another line of the same voucher (a cash / bank line is posted without it)
const GL_PARTY = `COALESCE(${partyName('t', 't.party_type', 't.party_id')}, (SELECT ${partyName('gx', 'gx.party_type', 'gx.party_id')} FROM gl_entries gx WHERE gx.journal_id=t.journal_id AND gx.party_id IS NOT NULL LIMIT 1))`;
const GL_BASE_FROM = (extraJoin = ''): string =>
  `gl_entries t JOIN accounts a ON a.id=t.account_id LEFT JOIN cost_centers cc ON cc.id=t.cost_center_id ${extraJoin} ${NOAP}`;
const GL_STATUS = `CASE WHEN t.is_reversal THEN 'Reversal' ELSE 'Posted' END`;
const GL_LABELS = ['Posting Date', 'Voucher No', 'Voucher Type', 'Account', 'Narration', 'Debit', 'Credit', 'Status', 'Actions'];
const GL: PageDef = {
  from: GL_BASE_FROM(),
  soft: null,
  number: 't.voucher_no',
  status: GL_STATUS,
  search: ['t.voucher_no', 't.narration', 'a.name', 'a.code'],
  order: 't.posting_date DESC, t.seq DESC',
  metric: { label: 'Debit', e: 't.debit' },
  calendar: 't.posting_date',
  cols: {
    ...approvalCols('t.voucher_no'),
    'Posting Date': d('t.posting_date'),
    'Voucher No': t('t.voucher_no'),
    'Voucher Type': t('t.voucher_type'),
    Account: t(`a.code || ' ' || a.name`),
    Narration: t('t.narration'),
    Debit: m('t.debit'),
    Credit: m('t.credit'),
    'Cost Center': t('cc.name'),
    Status: pill(GL_STATUS),
    Actions: ACTIONS,
  },
  register: ['Posting Date', 'Voucher No', 'Voucher Type', 'Account', 'Narration', 'Status', 'Actions'],
  compact: GL_LABELS,
  views: [
    view(/^general ledger$/i, ['Posting Date', 'Voucher No', 'Voucher Type', 'Account', 'Narration', 'Status', 'Actions'], { panel: ledgerPanel('Ledger with running balance', []) }),
    view(/^voucher drilldown$/i, ['Posting Date', 'Voucher No', 'Voucher Type', 'Account', 'Narration', 'Status', 'Actions'], { panel: ledgerPanel('Voucher lines', []) }),
    view(/^account movement$/i, ['Posting Date', 'Voucher No', 'Voucher Type', 'Account', 'Narration', 'Debit', 'Credit', 'Status', 'Actions'], {
      panel: allocPanel(
        'Account movement',
        `(SELECT pa.code || ' ' || pa.name AS rec, sum(p.debit - p.credit) AS net FROM gl_entries p JOIN accounts pa ON pa.id=p.account_id WHERE {SCOPE:p:nosoft} GROUP BY pa.id, pa.code, pa.name) p`,
        null,
        'p.rec',
        { record: 'p.rec', demand: 'p.net' },
      ),
    }),
    view(/^cost center split$/i, ['Cost Center', 'Posting Date', 'Voucher No', 'Voucher Type', 'Account', 'Narration', 'Debit', 'Status', 'Actions'], {
      where: ['t.cost_center_id IS NOT NULL'],
    }),
    view(/^period comparison$/i, GL_LABELS, {
      kpis: [
        { label: 'Debit this month', e: `COALESCE(sum(t.debit) FILTER (WHERE t.posting_date >= date_trunc('month', current_date)),0)`, type: 'inr' },
        { label: 'Debit last month', e: `COALESCE(sum(t.debit) FILTER (WHERE t.posting_date >= date_trunc('month', current_date) - interval '1 month' AND t.posting_date < date_trunc('month', current_date)),0)`, type: 'inr' },
        { label: 'Credit this month', e: `COALESCE(sum(t.credit) FILTER (WHERE t.posting_date >= date_trunc('month', current_date)),0)`, type: 'inr' },
        { label: 'Credit last month', e: `COALESCE(sum(t.credit) FILTER (WHERE t.posting_date >= date_trunc('month', current_date) - interval '1 month' AND t.posting_date < date_trunc('month', current_date)),0)`, type: 'inr' },
      ],
    }),
    view(/^ledger audit$/i, ['Posting Date', 'Voucher No', 'Voucher Type', 'Account', 'Narration', 'Status', 'Actions'], {
      audit: true,
      panel: ledgerPanel('Reversal entries', ['p.is_reversal']),
    }),
  ],
};

// ------------------------------------------------------------------------------------------------ cash book / bank book
const CASHBOOK_LABELS = ['Date', 'Voucher No', 'Receipt Payment', 'Party', 'Narration', 'Cash In', 'Cash Out', 'Status', 'Actions'];
const CB_MAIN = ['Voucher No', 'Receipt Payment', 'Party', 'Narration', 'Cash In', 'Cash Out', 'Status', 'Actions'];
const CB_ACC = `a.sub_type='Cash'`;
const RP = `CASE WHEN t.debit>0 THEN 'Receipt' ELSE 'Payment' END`;
const CASHBOOK: PageDef = {
  from: GL_BASE_FROM(),
  soft: null,
  number: 't.voucher_no',
  status: GL_STATUS,
  search: ['t.voucher_no', 't.narration', 'a.name'],
  base: [CB_ACC],
  order: 't.posting_date DESC, t.seq DESC',
  metric: { label: 'Cash In', e: 't.debit' },
  calendar: 't.posting_date',
  cols: {
    ...approvalCols('t.voucher_no'),
    Date: d('t.posting_date'),
    'Voucher No': t('t.voucher_no'),
    'Receipt Payment': t(RP),
    Party: t(GL_PARTY),
    Narration: t('t.narration'),
    'Cash In': m('t.debit'),
    'Cash Out': m('t.credit'),
    Status: pill(GL_STATUS),
    Actions: ACTIONS,
  },
  register: CB_MAIN,
  compact: CASHBOOK_LABELS,
  views: [
    view(/^cash book$/i, CB_MAIN, { panel: ledgerPanel('Cash ledger', [`pa.sub_type='Cash'`]) }),
    view(/^receipts$/i, ['Date', 'Receipt Payment', 'Status', 'Voucher No', 'Party', 'Narration', 'Actions'], {
      where: ['t.debit>0'],
      panel: settlePanel('Unallocated receipts', 'RECEIVABLE', ['RECEIPT', 'ADVANCE'], true),
    }),
    view(/^payments$/i, ['Date', 'Receipt Payment', 'Status', 'Voucher No', 'Party', 'Narration', 'Actions'], {
      where: ['t.credit>0'],
      panel: settlePanel('Unallocated payments', 'PAYABLE', ['PAYMENT', 'ADVANCE'], true),
    }),
    view(/^petty cash$/i, CB_MAIN, {
      where: [`a.id IN (SELECT ba.account_id FROM bank_accounts ba WHERE ba.kind='PETTY' AND ba.deleted_at IS NULL)`],
      panel: ledgerPanel('Petty cash ledger', [`p.account_id IN (SELECT ba.account_id FROM bank_accounts ba WHERE ba.kind='PETTY' AND ba.deleted_at IS NULL)`]),
    }),
    view(/^cash reconciliation$/i, CB_MAIN, {
      panel: ledgerPanel('Cash ledger', [`pa.sub_type='Cash'`]),
      kpis: [{ label: 'Book balance of cash', e: 'COALESCE(sum(t.debit - t.credit),0)', type: 'inr' }],
    }),
    view(/^cash position$/i, CB_MAIN, {
      panel: ledgerPanel('Cash ledger', [`pa.sub_type='Cash'`]),
      kpis: [
        { label: 'Total cash in', e: 'COALESCE(sum(t.debit),0)', type: 'inr' },
        { label: 'Total cash out', e: 'COALESCE(sum(t.credit),0)', type: 'inr' },
        { label: 'Closing cash', e: 'COALESCE(sum(t.debit - t.credit),0)', type: 'inr' },
      ],
    }),
  ],
};

const BANK_PM = `LEFT JOIN payments pm ON pm.journal_id=t.journal_id`;
const CLEARED = `EXISTS (SELECT 1 FROM bank_matches bm WHERE bm.gl_entry_id=t.id AND bm.unmatched_at IS NULL)`;
const BK_LABELS = ['Date', 'Voucher No', 'Bank Account', 'Receipt Payment', 'Party', 'Instrument UTR', 'Debit', 'Status', 'Actions'];
const BANKBOOK: PageDef = {
  from: GL_BASE_FROM(`LEFT JOIN bank_accounts ba ON ba.account_id=t.account_id AND ba.deleted_at IS NULL ${BANK_PM}`),
  soft: null,
  number: 't.voucher_no',
  status: GL_STATUS,
  search: ['t.voucher_no', 't.narration', 'ba.name', 'pm.reference_no'],
  base: [`a.sub_type='Bank'`],
  order: 't.posting_date DESC, t.seq DESC',
  metric: { label: 'Debit', e: 't.debit' },
  calendar: 't.posting_date',
  cols: {
    ...approvalCols('t.voucher_no'),
    Date: d('t.posting_date'),
    'Voucher No': t('t.voucher_no'),
    'Bank Account': t('COALESCE(ba.name, a.name)'),
    'Receipt Payment': t(RP),
    'Clearing Status': t(`CASE WHEN ${CLEARED} THEN 'Cleared' ELSE 'Uncleared' END`),
    Party: t(GL_PARTY),
    'Instrument UTR': t('pm.reference_no'),
    Debit: m('t.debit'),
    Credit: m('t.credit'),
    Status: pill(GL_STATUS),
    Actions: ACTIONS,
  },
  register: ['Bank Account', 'Receipt Payment', 'Clearing Status', 'Status', 'Voucher No', 'Actions'],
  compact: BK_LABELS,
  views: [
    view(/^bank book$/i, ['Bank Account', 'Receipt Payment', 'Clearing Status', 'Status', 'Voucher No', 'Actions'], { panel: ledgerPanel('Bank ledger', [`pa.sub_type='Bank'`]) }),
    view(/^bank receipts$/i, ['Date', 'Bank Account', 'Receipt Payment', 'Clearing Status', 'Status', 'Voucher No', 'Actions'], {
      where: ['t.debit>0'],
      panel: settlePanel('Unallocated receipts', 'RECEIVABLE', ['RECEIPT', 'ADVANCE'], true),
    }),
    view(/^bank payments$/i, ['Date', 'Bank Account', 'Receipt Payment', 'Clearing Status', 'Status', 'Voucher No', 'Actions'], {
      where: ['t.credit>0'],
      panel: settlePanel('Unallocated payments', 'PAYABLE', ['PAYMENT', 'ADVANCE'], true),
    }),
    view(/^transfers$/i, ['Date', 'Voucher No', 'Bank Account', 'Receipt Payment', 'Party', 'Instrument UTR', 'Debit', 'Status', 'Actions'], {
      where: [`pm.kind='TRANSFER'`],
      panel: allocPanel(
        'Bank transfers',
        'payments p',
        'p.unit_id',
        'p.doc_date DESC, p.code DESC',
        { record: 'p.code', demand: 'p.amount', where: [`p.kind='TRANSFER'`, `p.status='Posted'`] },
      ),
    }),
    view(/^uncleared items$/i, ['Voucher No', 'Bank Account', 'Receipt Payment', 'Party', 'Instrument UTR', 'Status', 'Actions'], {
      where: [`NOT ${CLEARED}`],
      panel: ledgerPanel('Bank ledger', [`pa.sub_type='Bank'`, `NOT EXISTS (SELECT 1 FROM bank_matches bm WHERE bm.gl_entry_id=p.id AND bm.unmatched_at IS NULL)`]),
    }),
    view(/^bank position$/i, ['Bank Account', 'Receipt Payment', 'Clearing Status', 'Status', 'Voucher No', 'Actions'], {
      panel: ledgerPanel('Bank ledger', [`pa.sub_type='Bank'`]),
      kpis: [
        { label: 'Book balance of banks', e: 'COALESCE(sum(t.debit - t.credit),0)', type: 'inr' },
        { label: 'Uncleared in book', e: `COALESCE(sum(t.debit - t.credit) FILTER (WHERE NOT ${CLEARED}),0)`, type: 'inr' },
      ],
    }),
  ],
};

// ================================================================================================ fin-journal
const JV_COMPACT = ['JV No', 'Date', 'Reference', 'Narration', 'Debit Total', 'Credit Total', 'Cost Center', 'Status', 'Actions'];
const JV_PANEL = (title: string, where: string[]): PanelDef => ({
  title,
  from: 'journal_lines p JOIN journals pj ON pj.id=p.journal_id JOIN accounts pa ON pa.id=p.account_id',
  unit: 'p.unit_id',
  soft: 'pj.deleted_at',
  where,
  order: 'pj.doc_date DESC, pj.code DESC, p.line_no',
  cols: [
    ['Date', 'pj.doc_date', 'date'],
    ['Reference', 'pj.code', 'text'],
    ['Particulars', `pa.code || ' ' || pa.name`, 'text'],
    ['Debit', 'p.debit', 'inr'],
    ['Credit', 'p.credit', 'inr'],
    ['Balance', 'sum(p.debit - p.credit) OVER (PARTITION BY p.journal_id ORDER BY p.line_no)', 'inr'],
    ['Action', undefined, 'actions'],
  ],
});
const JOURNAL: PageDef = {
  from: `journals t LEFT JOIN cost_centers cc ON cc.id=t.cost_center_id ${apJoin('fin-journal')}`,
  number: 't.code',
  status: `CASE WHEN t.status='Draft' THEN t.posting_status ELSE t.status END`,
  search: ['t.code', 't.narration', 't.reference_no'],
  order: 't.doc_date DESC, t.code DESC',
  metric: { label: 'Debit Total', e: 't.total_debit' },
  calendar: 't.doc_date',
  cols: {
    ...approvalCols('t.code'),
    'JV No': t('t.code'),
    Date: d('t.doc_date'),
    Reference: t('COALESCE(t.reference_no, t.source_doc_no)'),
    Narration: t('t.narration'),
    'Debit Total': m('t.total_debit'),
    'Credit Total': m('t.total_credit'),
    'Cost Center': t('cc.name'),
    Status: pill(`CASE WHEN t.status='Draft' THEN t.posting_status ELSE t.status END`),
    Actions: ACTIONS,
  },
  register: ['JV No', 'Narration', 'Debit Total', 'Credit Total', 'Cost Center', 'Status', 'Actions'],
  compact: JV_COMPACT,
  views: [
    view(/^journal register$/i, ['JV No', 'Narration', 'Debit Total', 'Credit Total', 'Cost Center', 'Status', 'Actions'], { panel: JV_PANEL('Journal lines', ['true']) }),
    view(/^debit credit lines$/i, ['JV No', 'Narration', 'Debit Total', 'Credit Total', 'Cost Center', 'Status', 'Actions'], { panel: JV_PANEL('Journal lines', ['true']) }),
    view(/^approval (&|and) posting$/i, JV_COMPACT, { where: [`t.status='Draft'`] }),
    view(/^reversal entries$/i, ['JV No', 'Narration', 'Debit Total', 'Credit Total', 'Cost Center', 'Status', 'Actions'], {
      where: ['(t.reversal_of_id IS NOT NULL OR t.reversed_by_id IS NOT NULL)'],
      panel: JV_PANEL('Lines of reversal entries', ['(pj.reversal_of_id IS NOT NULL OR pj.reversed_by_id IS NOT NULL)']),
    }),
    view(/^journal audit$/i, ['JV No', 'Narration', 'Debit Total', 'Credit Total', 'Cost Center', 'Status', 'Actions'], { audit: true, panel: JV_PANEL('Journal lines', ['true']) }),
  ],
};

// ================================================================================================ fin-coa
const COA_LABELS = ['Account Code', 'Account Name', 'Account Type', 'Parent Group', 'Normal Balance', 'Posting Allowed', 'Cost Center Required', 'Status', 'Actions'];
const COA: PageDef = {
  from: `accounts t LEFT JOIN accounts pa ON pa.id=t.parent_id ${NOAP}`,
  unit: null,
  number: 't.code',
  status: 't.status',
  search: ['t.code', 't.name', 'pa.name'],
  order: 't.code',
  cols: {
    ...approvalCols('t.code'),
    'Account Code': t('t.code'),
    'Account Name': t('t.name'),
    'Account Type': t('t.root_type'),
    'Parent Group': t('pa.name'),
    'Normal Balance': t('t.normal_balance'),
    'Posting Allowed': t(`CASE WHEN t.posting_allowed THEN 'Yes' ELSE 'No' END`),
    'Cost Center Required': t(`CASE WHEN t.cost_center_required THEN 'Yes' ELSE 'No' END`),
    Status: pill('t.status'),
    Actions: ACTIONS,
  },
  register: COA_LABELS,
  compact: COA_LABELS,
  views: [
    view(/^account tree$/i, COA_LABELS),
    view(/^account master$/i, ['Account Code', 'Account Name', 'Account Type', 'Status', 'Parent Group', 'Actions', 'Normal Balance', 'Posting Allowed', 'Cost Center Required']),
    view(/^group mapping$/i, COA_LABELS, {
      panel: {
        title: 'Account import mapping',
        from: `(VALUES (1,'Account Code','accounts.code','Digits only (4 to 8)','Yes',(SELECT code FROM accounts WHERE deleted_at IS NULL ORDER BY code LIMIT 1)),
          (2,'Account Name','accounts.name','Trimmed','Yes',(SELECT name FROM accounts WHERE deleted_at IS NULL ORDER BY code LIMIT 1)),
          (3,'Account Type','accounts.root_type','Asset, Liability, Equity, Income or Expense','Yes',(SELECT root_type FROM accounts WHERE deleted_at IS NULL ORDER BY code LIMIT 1)),
          (4,'Parent Group','accounts.parent_id','Looked up by parent code','No',(SELECT code FROM accounts WHERE id=(SELECT parent_id FROM accounts WHERE parent_id IS NOT NULL AND deleted_at IS NULL ORDER BY code LIMIT 1))))
          AS p(ord, src, dst, tr, req, smp)`,
        unit: null,
        soft: null,
        order: 'p.ord',
        cols: [
          ['Source Field', 'p.src', 'text'],
          ['Target Field', 'p.dst', 'text'],
          ['Transformation', 'p.tr', 'text'],
          ['Required', 'p.req', 'text'],
          ['Sample', 'p.smp', 'text'],
        ],
      },
    }),
    view(/^posting controls$/i, COA_LABELS, { panel: ledgerPanel('Latest postings', []) }),
    view(/^opening balances$/i, COA_LABELS, { panel: openItemsPanel('Opening items', ['OPENING']) }),
    view(/^coa validation$/i, COA_LABELS, {
      panel: validationPanel('Chart of accounts checks', [
        ['Every account except the roots has a parent group', `SELECT count(*) FROM accounts WHERE deleted_at IS NULL AND parent_id IS NOT NULL`, `SELECT 0`, `SELECT count(*) FROM accounts WHERE deleted_at IS NULL AND parent_id IS NULL AND is_group=false`],
        ['Posting accounts are not groups', `SELECT count(*) FROM accounts WHERE deleted_at IS NULL AND NOT (is_group AND posting_allowed)`, `SELECT 0`, `SELECT count(*) FROM accounts WHERE deleted_at IS NULL AND is_group AND posting_allowed`],
        ['Account names are unique', `SELECT count(DISTINCT lower(name)) FROM accounts WHERE deleted_at IS NULL`, `SELECT count(*) - count(DISTINCT lower(name)) FROM accounts WHERE deleted_at IS NULL`, `SELECT 0`],
        ['Normal balance matches the account type', `SELECT count(*) FROM accounts WHERE deleted_at IS NULL AND ((root_type IN ('Asset','Expense') AND normal_balance='Debit') OR (root_type IN ('Liability','Equity','Income') AND normal_balance='Credit'))`, `SELECT 0`, `SELECT count(*) FROM accounts WHERE deleted_at IS NULL AND NOT ((root_type IN ('Asset','Expense') AND normal_balance='Debit') OR (root_type IN ('Liability','Equity','Income') AND normal_balance='Credit'))`],
      ]),
    }),
  ],
};

// ================================================================================================ fin-costcenter / fin-profitcenter
const CC_YTD = (col: 'debit-credit' | 'credit-debit', roots: string): string =>
  `(SELECT COALESCE(sum(g.${col.split('-')[0]} - g.${col.split('-')[1]}),0) FROM gl_entries g JOIN accounts ga ON ga.id=g.account_id WHERE g.cost_center_id=t.id AND ga.root_type IN (${roots}) AND NOT g.is_closing)`;
const CC_BUDGET = `(SELECT COALESCE(sum(bm.amount),0) FROM budgets b JOIN budget_months bm ON bm.budget_id=b.id WHERE b.cost_center_id=t.id AND b.deleted_at IS NULL AND b.status<>'Closed')`;
const CC_LABELS = ['Cost Center Code', 'Cost Center Name', 'Department', 'Manager', 'Parent', 'Budget', 'Actual', 'Status', 'Actions'];
const COSTCENTER: PageDef = {
  unit: null,
  from: `cost_centers t LEFT JOIN cost_centers pc ON pc.id=t.parent_id LEFT JOIN users mu ON mu.id=t.manager_id ${NOAP}`,
  number: 't.code',
  status: 't.status',
  search: ['t.code', 't.name', 't.department'],
  order: 't.code',
  metric: { label: 'Budget', e: CC_BUDGET },
  cols: {
    ...approvalCols('t.code'),
    'Cost Center Code': t('t.code'),
    'Cost Center Name': t('t.name'),
    Department: t('t.department'),
    Manager: t('mu.name'),
    Parent: t('pc.name'),
    Budget: m(CC_BUDGET),
    Actual: m(CC_YTD('debit-credit', `'Expense'`)),
    Variance: m(`${CC_BUDGET} - ${CC_YTD('debit-credit', `'Expense'`)}`),
    Status: pill('t.status'),
    Actions: ACTIONS,
  },
  register: CC_LABELS,
  compact: CC_LABELS,
  views: [
    view(/^cost center master$/i, CC_LABELS),
    view(/^hierarchy$/i, CC_LABELS, { order: `COALESCE(pc.code, t.code), t.code` }),
    view(/^budget mapping$/i, CC_LABELS),
    view(/^transaction allocation$/i, ['Status', 'Cost Center Code', 'Cost Center Name', 'Department', 'Manager', 'Parent', 'Actions'], {
      panel: allocPanel(
        'Budget against actual',
        'cost_centers p',
        'p.unit_id',
        'p.code',
        {
          record: `p.code || ' ' || p.name`,
          demand: `(SELECT COALESCE(sum(bm.amount),0) FROM budgets b JOIN budget_months bm ON bm.budget_id=b.id WHERE b.cost_center_id=p.id AND b.deleted_at IS NULL AND b.status<>'Closed')`,
          allocated: `(SELECT COALESCE(sum(g.debit-g.credit),0) FROM gl_entries g JOIN accounts ga ON ga.id=g.account_id WHERE g.cost_center_id=p.id AND ga.root_type='Expense' AND NOT g.is_closing)`,
          available: `(SELECT COALESCE(sum(bm.amount),0) FROM budgets b JOIN budget_months bm ON bm.budget_id=b.id WHERE b.cost_center_id=p.id AND b.deleted_at IS NULL AND b.status<>'Closed') - (SELECT COALESCE(sum(g.debit-g.credit),0) FROM gl_entries g JOIN accounts ga ON ga.id=g.account_id WHERE g.cost_center_id=p.id AND ga.root_type='Expense' AND NOT g.is_closing)`,
          where: ['p.deleted_at IS NULL', 'p.is_group=false'],
        },
      ),
    }),
    view(/^cost statement$/i, CC_LABELS, { panel: ledgerPanel('Ledger of cost-center postings', ['p.cost_center_id IS NOT NULL']) }),
    view(/^variance$/i, [...CC_LABELS.slice(0, 7), 'Variance', 'Status', 'Actions']),
  ],
};
const PC_REV = `(SELECT COALESCE(sum(g.credit-g.debit),0) FROM gl_entries g JOIN accounts ga ON ga.id=g.account_id WHERE g.profit_center_id=t.id AND ga.root_type='Income' AND NOT g.is_closing)`;
const PC_COST = `(SELECT COALESCE(sum(g.debit-g.credit),0) FROM gl_entries g JOIN accounts ga ON ga.id=g.account_id WHERE g.profit_center_id=t.id AND ga.root_type='Expense' AND NOT g.is_closing)`;
const PC_LABELS = ['Profit Center Code', 'Profit Center Name', 'Branch', 'Manager', 'Revenue', 'Direct Cost', 'Allocated Cost', 'Status', 'Actions'];
const PROFITCENTER: PageDef = {
  from: `profit_centers t LEFT JOIN units un ON un.id=t.unit_id LEFT JOIN users mu ON mu.id=t.manager_id ${NOAP}`,
  number: 't.code',
  status: 't.status',
  search: ['t.code', 't.name', 'un.name'],
  order: 't.code',
  metric: { label: 'Revenue', e: PC_REV },
  cols: {
    ...approvalCols('t.code'),
    'Profit Center Code': t('t.code'),
    'Profit Center Name': t('t.name'),
    Branch: t('un.name'),
    Manager: t('mu.name'),
    Revenue: m(PC_REV),
    'Direct Cost': m(PC_COST),
    'Allocated Cost': none('inr'),
    'Margin %': n(`CASE WHEN ${PC_REV} > 0 THEN round((${PC_REV} - ${PC_COST}) / ${PC_REV} * 100, 2) END`),
    Status: pill('t.status'),
    Actions: ACTIONS,
  },
  register: ['Profit Center Code', 'Profit Center Name', 'Status', 'Branch', 'Manager', 'Actions', 'Direct Cost', 'Allocated Cost', 'Margin %'],
  compact: PC_LABELS,
  views: [
    view(/^profit center master$/i, ['Profit Center Code', 'Profit Center Name', 'Status', 'Branch', 'Manager', 'Actions', 'Direct Cost', 'Allocated Cost', 'Margin %']),
    view(/^revenue allocation$/i, ['Direct Cost', 'Allocated Cost', 'Margin %', 'Profit Center Code', 'Profit Center Name', 'Branch', 'Manager', 'Status', 'Actions'], {
      panel: allocPanel('Revenue by profit center', 'profit_centers p', 'p.unit_id', 'p.code', {
        record: `p.code || ' ' || p.name`,
        allocated: `(SELECT COALESCE(sum(g.credit-g.debit),0) FROM gl_entries g JOIN accounts ga ON ga.id=g.account_id WHERE g.profit_center_id=p.id AND ga.root_type='Income' AND NOT g.is_closing)`,
        where: ['p.deleted_at IS NULL'],
      }),
    }),
    view(/^cost allocation$/i, ['Direct Cost', 'Allocated Cost', 'Margin %', 'Profit Center Code', 'Profit Center Name', 'Branch', 'Manager', 'Status', 'Actions']),
    view(/^contribution margin$/i, ['Direct Cost', 'Allocated Cost', 'Margin %', 'Profit Center Code', 'Profit Center Name', 'Branch', 'Manager', 'Status', 'Actions']),
    view(/^segment p&l$/i, ['Profit Center Code', 'Profit Center Name', 'Branch', 'Manager', 'Revenue', 'Direct Cost', 'Allocated Cost', 'Status', 'Actions'], {
      panel: ledgerPanel('Profit and loss postings by segment', [`p.profit_center_id IS NOT NULL`, `pa.root_type IN ('Income','Expense')`]),
    }),
    view(/^performance$/i, PC_LABELS),
  ],
};

// ================================================================================================ fin-bankreco
const REC_MATCHED = `(SELECT COALESCE(sum(l.deposit + l.withdrawal),0) FROM bank_statement_lines l WHERE l.statement_id=t.id AND l.match_status='Matched')`;
const REC_UNMATCHED = `(SELECT COALESCE(sum(l.deposit + l.withdrawal),0) FROM bank_statement_lines l WHERE l.statement_id=t.id AND l.match_status='Unmatched')`;
const REC_LABELS = ['Statement Ref', 'Bank Account', 'Statement Date', 'ERP Balance', 'Bank Balance', 'Matched Amount', 'Unmatched Bank', 'Status', 'Actions'];
const stmtLinesPanel = (title: string, where: string[]): PanelDef => ({
  title,
  from: 'bank_statement_lines p JOIN bank_statements ps ON ps.id=p.statement_id JOIN bank_accounts pb ON pb.id=ps.bank_account_id',
  unit: 'pb.unit_id',
  soft: 'pb.deleted_at',
  where,
  order: 'p.txn_date DESC, p.line_no DESC',
  cols: [
    ['Date', 'p.txn_date', 'date'],
    ['Reference', 'p.ref_no', 'text'],
    ['Particulars', 'p.description', 'text'],
    ['Debit', 'p.deposit', 'inr'],
    ['Credit', 'p.withdrawal', 'inr'],
    ['Balance', 'ps.opening_balance + sum(p.deposit - p.withdrawal) OVER (PARTITION BY p.statement_id ORDER BY p.line_no)', 'inr'],
    ['Action', `CASE WHEN p.match_status='Unmatched' THEN 'Match' END`, 'actions'],
  ],
});
const BANKRECO: PageDef = {
  from: `bank_statements t JOIN bank_accounts ba ON ba.id=t.bank_account_id ${NOAP}`,
  unit: 'ba.unit_id',
  soft: 'ba.deleted_at',
  number: `upper(left(t.id::text, 8))`,
  status: 't.status',
  search: ['ba.name', 't.status'],
  order: 't.period_to DESC, t.created_at DESC',
  metric: { label: 'Bank Balance', e: 't.closing_balance' },
  calendar: 't.period_to',
  cols: {
    ...approvalCols(`upper(left(t.id::text, 8))`),
    'Statement Ref': t(`upper(left(t.id::text, 8))`),
    'Bank Account': t('ba.name'),
    'Statement Date': d('t.period_to'),
    'ERP Balance': m(`(SELECT COALESCE(sum(g.debit-g.credit),0) FROM gl_entries g WHERE g.account_id=ba.account_id AND g.unit_id=ba.unit_id AND g.posting_date <= t.period_to)`),
    'Bank Balance': m('t.closing_balance'),
    'Matched Amount': m(REC_MATCHED),
    'Unmatched Bank': m(REC_UNMATCHED),
    Status: pill('t.status'),
    Actions: ACTIONS,
  },
  register: REC_LABELS,
  compact: REC_LABELS,
  views: [
    view(/^reconciliation workspace$/i, REC_LABELS, { panel: stmtLinesPanel('Statement lines', ['true']) }),
    view(/^bank statement$/i, ['Bank Account', 'Statement Date', 'ERP Balance', 'Bank Balance', 'Unmatched Bank', 'Status', 'Statement Ref', 'Actions'], { panel: stmtLinesPanel('Statement lines', ['true']) }),
    view(/^erp transactions$/i, REC_LABELS),
    view(/^auto matching$/i, REC_LABELS, { panel: stmtLinesPanel('Matched statement lines', [`p.match_status='Matched'`]) }),
    view(/^unmatched exceptions$/i, REC_LABELS, {
      where: [`t.status<>'Reconciled'`],
      panel: exceptionPanel('Unmatched items', [
        exc('Bank line not in the books', `COALESCE(l.ref_no, l.description, 'line ' || l.line_no)`, 'Medium', `current_date - l.txn_date`, `'Statement line has no matching ledger entry'`,
          `FROM bank_statement_lines l JOIN bank_statements s ON s.id=l.statement_id JOIN bank_accounts xb ON xb.id=s.bank_account_id WHERE l.match_status='Unmatched' AND {SCOPE:xb}`),
        exc('Ledger entry not on the statement', `g.voucher_no`, 'Medium', `current_date - g.posting_date`, `'Posted in the books, not on any statement line'`,
          `FROM gl_entries g JOIN accounts ga ON ga.id=g.account_id WHERE ga.sub_type='Bank' AND NOT EXISTS (SELECT 1 FROM bank_matches bm WHERE bm.gl_entry_id=g.id AND bm.unmatched_at IS NULL) AND {SCOPE:g:nosoft}`),
      ]),
    }),
    view(/^reconciliation summary$/i, REC_LABELS, {
      panel: stmtLinesPanel('Statement lines', ['true']),
      kpis: [
        { label: 'Matched amount', e: `COALESCE(sum(${REC_MATCHED}),0)`, type: 'inr' },
        { label: 'Unmatched bank', e: `COALESCE(sum(${REC_UNMATCHED}),0)`, type: 'inr' },
      ],
    }),
  ],
};

// ================================================================================================ credit / debit notes
const gstOfNote = `(SELECT COALESCE(sum(jl.debit + jl.credit),0) FROM journal_lines jl JOIN accounts ja ON ja.id=jl.account_id WHERE jl.journal_id=t.journal_id AND ja.sub_type IN ${GST_SUBTYPES})`;
const NOTE_JOIN = (doc: string): string =>
  `credit_debit_notes t LEFT JOIN customers cu ON cu.id=t.party_id AND t.party_type='CUSTOMER' LEFT JOIN suppliers su ON su.id=t.party_id AND t.party_type='SUPPLIER' LEFT JOIN journals nj ON nj.id=t.journal_id ${apJoin(doc)}`;
const noteDef = (kind: 'CREDIT' | 'DEBIT'): PageDef => {
  const doc = kind === 'CREDIT' ? 'fin-creditnote' : 'fin-debitnote';
  const noCol = kind === 'CREDIT' ? 'Credit Note No' : 'Debit Note No';
  const party = kind === 'CREDIT' ? 'Customer' : 'Vendor';
  const compact = [noCol, party, 'Invoice Ref', 'Date', 'Reason', 'Taxable Adjustment', 'GST Adjustment', 'Status', 'Actions'];
  const side = kind === 'CREDIT' ? 'RECEIVABLE' : 'PAYABLE';
  const item = kind === 'CREDIT' ? 'CREDIT_NOTE' : 'DEBIT_NOTE';
  const ledgerWhere = [`p.journal_id IN (SELECT journal_id FROM credit_debit_notes WHERE kind='${kind}' AND journal_id IS NOT NULL)`];
  const settle = settlePanel(`Open ${kind === 'CREDIT' ? 'credit' : 'debit'} notes`, side, [item], true);
  const refView =
    kind === 'CREDIT'
      ? view(/^reference invoice$/i, ['Customer', 'Invoice Ref', 'Status', 'Credit Note No', 'Reason', 'Taxable Adjustment', 'Actions'], { panel: ledgerPanel('Ledger postings of the notes', ledgerWhere) })
      : view(/^vendor reference$/i, ['Vendor', 'Approval', 'Posting Ref', 'Status', 'Project Number', 'Debit Note No', 'Actions'], { panel: ledgerPanel('Ledger postings of the notes', ledgerWhere) });
  return {
    from: NOTE_JOIN(doc),
    number: 't.code',
    status: 't.status',
    search: ['t.code', 'cu.name', 'su.name', 't.against_doc_no', 't.reason'],
    base: [`t.kind='${kind}'`],
    order: 't.doc_date DESC, t.code DESC',
    metric: { label: 'Amount', e: 't.amount' },
    calendar: 't.doc_date',
    cols: {
      [noCol]: t('t.code'),
      [party]: t('COALESCE(cu.name, su.name)'),
      'Invoice Ref': t('t.against_doc_no'),
      Date: d('t.doc_date'),
      Reason: t('t.reason'),
      'Taxable Adjustment': m(`t.amount - ${gstOfNote}`),
      'GST Adjustment': m(gstOfNote),
      Approval: t('ap.status'),
      'Posting Ref': t('nj.code'),
      'Project Number': none(),
      Status: pill('t.status'),
      Actions: ACTIONS,
      ...approvalCols('t.code'),
    },
    register: compact,
    compact,
    views: [
      view(kind === 'CREDIT' ? /^credit note register$/i : /^debit note register$/i, compact, { panel: settle }),
      refView,
      view(/^tax adjustment$/i, ['Taxable Adjustment', 'GST Adjustment', noCol, party, 'Invoice Ref', 'Date', 'Reason', 'Status', 'Actions']),
      view(/^approval$/i, compact, { where: [`t.status IN ('Pending Approval','Draft','Approved','Rejected')`] }),
      view(/^ledger posting$/i, [noCol, party, 'Invoice Ref', 'Reason', 'Taxable Adjustment', 'GST Adjustment', 'Status', 'Actions'], { panel: ledgerPanel('Ledger postings of the notes', ledgerWhere) }),
      view(kind === 'CREDIT' ? /^credit note analysis$/i : /^debit note analysis$/i, compact, { panel: settle }),
    ],
  };
};
const CREDITNOTE = noteDef('CREDIT');
const DEBITNOTE = noteDef('DEBIT');

// ================================================================================================ fin-expenses
const EXP_LABELS = ['Expense No', 'Employee Vendor', 'Date', 'Category', 'Department', 'Cost Center', 'Amount', 'Status', 'Actions'];
const EXP_PAY = `CASE WHEN t.payment_id IS NOT NULL OR t.status='Paid' THEN 'Paid' WHEN t.status='Approved' THEN 'Awaiting payment' ELSE 'Not payable yet' END`;
const EXP_SCOPE = `{SCOPE:x}`;
const EXPENSES: PageDef = {
  from: `expense_claims t LEFT JOIN employees e ON e.id=t.employee_id LEFT JOIN cost_centers cc ON cc.id=t.cost_center_id ${apJoin('fin-expenses')}`,
  number: 't.code',
  status: 't.status',
  search: ['t.code', 'e.first_name', 'e.last_name', 't.category', 't.bill_no'],
  order: 't.claim_date DESC, t.code DESC',
  metric: { label: 'Amount', e: 't.amount' },
  calendar: 't.claim_date',
  cols: {
    ...approvalCols('t.code'),
    'Expense No': t('t.code'),
    'Employee Vendor': t(`COALESCE(NULLIF(trim(e.first_name || ' ' || COALESCE(e.last_name,'')), ''), (SELECT cu.name FROM users cu WHERE cu.id=t.created_by_id))`),
    Date: d('t.claim_date'),
    Category: t('t.category'),
    Department: t('cc.department'),
    'Cost Center': t('cc.name'),
    Amount: m('t.amount'),
    GST: m(`(SELECT COALESCE(sum(l.gst_amount),0) FROM expense_claim_lines l WHERE l.claim_id=t.id)`),
    'Policy Result': t(`CASE WHEN EXISTS (SELECT 1 FROM expense_claim_lines l WHERE l.claim_id=t.id AND l.policy_breach) THEN 'Breach' ELSE 'Within policy' END`),
    Approver: t(`(SELECT us.name FROM approval_steps st JOIN users us ON us.id=st.acted_by WHERE st.request_id=ap.id AND st.status='APPROVED' ORDER BY st.level DESC LIMIT 1)`),
    'Payment Status': t(EXP_PAY),
    Status: pill('t.status'),
    Docs: DOCS('fin-expenses'),
    Actions: ACTIONS,
  },
  register: ['Expense No', 'Employee Vendor', 'Date', 'Category', 'Department', 'Cost Center', 'Amount', 'GST', 'Policy Result', 'Approver', 'Payment Status', 'Status', 'Docs', 'Actions'],
  compact: EXP_LABELS,
  views: [
    view(/^expense register$/i, ['Expense No', 'Employee Vendor', 'Date', 'Category', 'Department', 'Cost Center', 'Amount', 'GST', 'Policy Result', 'Approver', 'Payment Status', 'Status', 'Docs', 'Actions']),
    view(/^expense claims$/i, EXP_LABELS),
    view(/^policy validation$/i, EXP_LABELS, {
      panel: validationPanel('Expense policy checks', [
        ['No line breaches the expense policy', `SELECT count(*) FROM expense_claims x WHERE ${EXP_SCOPE} AND NOT EXISTS (SELECT 1 FROM expense_claim_lines l WHERE l.claim_id=x.id AND l.policy_breach)`, 'SELECT 0', `SELECT count(*) FROM expense_claims x WHERE ${EXP_SCOPE} AND EXISTS (SELECT 1 FROM expense_claim_lines l WHERE l.claim_id=x.id AND l.policy_breach)`],
        ['Receipt attached above the category limit', `SELECT count(*) FROM expense_claim_lines l JOIN expense_claims x ON x.id=l.claim_id JOIN expense_categories c ON c.id=l.category_id WHERE ${EXP_SCOPE} AND NOT (c.receipt_required_above IS NOT NULL AND l.amount > c.receipt_required_above AND l.receipt_document_id IS NULL)`, 'SELECT 0', `SELECT count(*) FROM expense_claim_lines l JOIN expense_claims x ON x.id=l.claim_id JOIN expense_categories c ON c.id=l.category_id WHERE ${EXP_SCOPE} AND c.receipt_required_above IS NOT NULL AND l.amount > c.receipt_required_above AND l.receipt_document_id IS NULL`],
        ['Cost center on every claim', `SELECT count(*) FROM expense_claims x WHERE ${EXP_SCOPE} AND x.cost_center_id IS NOT NULL`, `SELECT count(*) FROM expense_claims x WHERE ${EXP_SCOPE} AND x.cost_center_id IS NULL`, 'SELECT 0'],
      ]),
    }),
    view(/^approval queue$/i, EXP_LABELS, { where: [`t.status='Pending Approval'`] }),
    view(/^payment status$/i, ['Date', 'Payment Status', 'Status', 'Expense No', 'Employee Vendor', 'Category', 'Department', 'Actions'], {
      panel: { ...settlePanel('Employee payables', 'PAYABLE', ['INVOICE']), where: [`p.side='PAYABLE'`, `p.party_type='EMPLOYEE'`, `p.item_type='INVOICE'`, `p.status<>'Cancelled'`, 'p.outstanding>0'] },
    }),
    view(/^spend analytics$/i, EXP_LABELS, {
      kpis: [
        { label: 'Total claimed', e: 'COALESCE(sum(t.amount),0)', type: 'inr' },
        { label: 'Paid', e: `COALESCE(sum(t.amount) FILTER (WHERE t.status='Paid'),0)`, type: 'inr' },
        { label: 'Waiting for approval', e: `COALESCE(sum(t.amount) FILTER (WHERE t.status='Pending Approval'),0)`, type: 'inr' },
      ],
    }),
  ],
};

// ================================================================================================ fin-budget
const BUD_TOTAL = `(SELECT COALESCE(sum(bm.amount),0) FROM budget_months bm WHERE bm.budget_id=t.id)`;
const BUD_ACTUAL = `(SELECT COALESCE(sum(g.debit - g.credit),0) FROM gl_entries g WHERE g.account_id=t.account_id AND g.fy_id=t.fy_id AND NOT g.is_closing AND (t.cost_center_id IS NULL OR g.cost_center_id=t.cost_center_id))`;
const BUD_LABELS = ['Budget No', 'Financial Year', 'Department', 'Cost Center', 'Account', 'Budget Amount', 'Committed', 'Status', 'Actions'];
const BUD_ACTUAL_LABELS = ['Budget No', 'Financial Year', 'Department', 'Cost Center', 'Account', 'Budget Amount', 'Committed', 'Actual', 'Variance', 'Status', 'Actions'];
const BUDGET: PageDef = {
  from: `budgets t JOIN accounts ba ON ba.id=t.account_id JOIN financial_years fyr ON fyr.id=t.fy_id LEFT JOIN cost_centers cc ON cc.id=t.cost_center_id ${apJoin('fin-budget')}`,
  number: 't.name',
  status: 't.status',
  search: ['t.name', 'ba.name', 'cc.name'],
  order: 't.created_at DESC, t.name',
  metric: { label: 'Budget Amount', e: BUD_TOTAL },
  cols: {
    ...approvalCols('t.name'),
    'Budget No': t('t.name'),
    'Financial Year': t('fyr.label'),
    Department: t('cc.department'),
    'Cost Center': t('cc.name'),
    Account: t(`ba.code || ' ' || ba.name`),
    'Budget Amount': m(BUD_TOTAL),
    Committed: none('inr'),
    Actual: m(BUD_ACTUAL),
    Variance: m(`${BUD_TOTAL} - ${BUD_ACTUAL}`),
    Status: pill('t.status'),
    Actions: ACTIONS,
  },
  register: BUD_LABELS,
  compact: BUD_LABELS,
  views: [
    view(/^budget register$/i, BUD_LABELS),
    view(/^department budgets$/i, BUD_LABELS, { order: 'cc.department NULLS LAST, t.name' }),
    view(/^commitments$/i, BUD_LABELS, { panel: ledgerPanel('Postings on budgeted accounts', [`p.account_id IN (SELECT account_id FROM budgets WHERE deleted_at IS NULL)`]) }),
    view(/^actual consumption$/i, BUD_ACTUAL_LABELS, { panel: ledgerPanel('Postings on budgeted accounts', [`p.account_id IN (SELECT account_id FROM budgets WHERE deleted_at IS NULL)`]) }),
    view(/^budget control$/i, BUD_ACTUAL_LABELS, { where: [`t.status='Active'`] }),
    view(/^variance forecast$/i, BUD_ACTUAL_LABELS, { order: `(${BUD_TOTAL} - ${BUD_ACTUAL}) ASC, t.name` }),
  ],
};

// ================================================================================================ computed reports from the ledger
/** natural balance of an account family; income and liabilities are credit-natural */
const NAT = (net: string, root: string): string => `CASE WHEN ${root} IN ('Asset','Expense') THEN ${net} ELSE -(${net}) END`;
/** account movement of the ledger: one row per account with its debit and credit totals (Demand = the amount of the tab) */
const movePanel = (title: string, demand: string): PanelDef =>
  allocPanel(
    title,
    `(SELECT pa.code || ' ' || pa.name AS rec, sum(p.debit) AS dr, sum(p.credit) AS cr FROM gl_entries p JOIN accounts pa ON pa.id=p.account_id WHERE {SCOPE:p:nosoft} GROUP BY pa.id, pa.code, pa.name) p`,
    null,
    `${demand} DESC, p.rec`,
    { record: 'p.rec', demand },
  );
const TB_FROM = `(SELECT a.id, a.code, a.name, a.root_type,
    CASE WHEN a.root_type IN ('Asset','Liability','Equity') THEN COALESCE(sum(g.debit - g.credit) FILTER (WHERE g.posting_date < fy.start_date), 0) ELSE 0 END AS open_net,
    COALESCE(sum(g.debit) FILTER (WHERE g.posting_date >= fy.start_date AND g.posting_date <= fy.end_date AND NOT (g.is_closing AND g.fy_id = fy.id)), 0) AS p_debit,
    COALESCE(sum(g.credit) FILTER (WHERE g.posting_date >= fy.start_date AND g.posting_date <= fy.end_date AND NOT (g.is_closing AND g.fy_id = fy.id)), 0) AS p_credit
  FROM accounts a JOIN gl_entries g ON g.account_id = a.id CROSS JOIN ${FY}
  WHERE a.deleted_at IS NULL AND a.is_group = false AND {SCOPE:g:nosoft} GROUP BY a.id, a.code, a.name, a.root_type, fy.id, fy.start_date, fy.end_date) t ${NOAP}`;
const TB_CLOSE = `(t.open_net + t.p_debit - t.p_credit)`;
const TB_STATUS = `CASE WHEN ${TB_CLOSE} = 0 THEN 'Nil' WHEN (t.root_type IN ('Asset','Expense') AND ${TB_CLOSE} < 0) OR (t.root_type IN ('Liability','Equity','Income') AND ${TB_CLOSE} > 0) THEN 'Abnormal' ELSE 'OK' END`;
const TB_LABELS = ['Account Code', 'Account Name', 'Opening Debit', 'Opening Credit', 'Period Debit', 'Period Credit', 'Closing Debit', 'Closing Credit', 'Status', 'Actions'];
const TB_COLS: Record<string, ReturnType<typeof t>> = {
  'Account Code': t('t.code'),
  'Account Name': t('t.name'),
  'Opening Debit': m('GREATEST(t.open_net, 0)'),
  'Opening Credit': m('GREATEST(-t.open_net, 0)'),
  'Period Debit': m('t.p_debit'),
  'Period Credit': m('t.p_credit'),
  'Closing Debit': m(`GREATEST(${TB_CLOSE}, 0)`),
  'Closing Credit': m(`GREATEST(-${TB_CLOSE}, 0)`),
  Status: pill(TB_STATUS),
  Actions: ACTIONS,
  ...approvalCols('t.code'),
};
const TRIAL: PageDef = {
  from: TB_FROM,
  unit: null,
  soft: null,
  number: 't.code',
  status: TB_STATUS,
  search: ['t.code', 't.name'],
  order: 't.code',
  metric: { label: 'Period Debit', e: 't.p_debit' },
  cols: TB_COLS,
  register: TB_LABELS,
  compact: TB_LABELS,
  views: [
    view(/^trial balance$/i, TB_LABELS, {
      panel: openItemsPanel('Sub-ledger open items behind the control accounts'),
      kpis: [
        { label: 'Closing debit', e: `COALESCE(sum(GREATEST(${TB_CLOSE}, 0)),0)`, type: 'inr' },
        { label: 'Closing credit', e: `COALESCE(sum(GREATEST(-${TB_CLOSE}, 0)),0)`, type: 'inr' },
      ],
    }),
    view(/^opening balance$/i, TB_LABELS, { panel: openItemsPanel('Sub-ledger open items behind the control accounts') }),
    view(/^debit movement$/i, TB_LABELS, {
      where: ['t.p_debit > 0'],
      order: 't.p_debit DESC, t.code',
      panel: movePanel('Debit movement by account', 'p.dr'),
    }),
    view(/^credit movement$/i, TB_LABELS, { where: ['t.p_credit > 0'], order: 't.p_credit DESC, t.code', panel: movePanel('Credit movement by account', 'p.cr') }),
    view(/^closing balance$/i, TB_LABELS, { where: [`${TB_CLOSE} <> 0`], panel: openItemsPanel('Sub-ledger open items behind the control accounts') }),
    view(/^exception review$/i, TB_LABELS, {
      where: [`${TB_STATUS} = 'Abnormal'`],
      panel: exceptionPanel('Ledger exceptions', [
        exc('Journal not balanced', 'j.code', 'High', `current_date - j.doc_date`, `'Posted debit differs from credit'`, `FROM journals j WHERE j.status='Posted' AND j.total_debit<>j.total_credit AND {SCOPE:j}`),
        exc('Abnormal account balance', `a.code || ' ' || a.name`, 'Medium', `NULL`, `'Closing balance is on the opposite side of the normal balance'`,
          `FROM accounts a JOIN gl_entries g ON g.account_id=a.id WHERE a.is_group=false AND a.deleted_at IS NULL AND {SCOPE:g:nosoft} GROUP BY a.id, a.code, a.name, a.root_type HAVING (a.root_type IN ('Asset','Expense') AND sum(g.debit-g.credit) < 0) OR (a.root_type IN ('Liability','Equity','Income') AND sum(g.debit-g.credit) > 0)`),
      ]),
    }),
  ],
};

// P&L: natural amounts of the income and expense accounts for this month, the year to date, the same period last year and the budget
const PL_NAT = (flt: string): string => `COALESCE(sum(CASE WHEN a.root_type='Income' THEN g.credit - g.debit ELSE g.debit - g.credit END) FILTER (WHERE ${flt}), 0)`;
const PL_BASE = `SELECT a.id::text AS id, a.code, a.name, a.root_type, a.sub_type,
    ${PL_NAT(`g.posting_date >= date_trunc('month', current_date) AND NOT g.is_closing`)} AS cm,
    ${PL_NAT(`g.fy_id = fy.id AND NOT g.is_closing`)} AS ytd,
    ${PL_NAT(`g.posting_date >= fy.start_date - interval '1 year' AND g.posting_date <= (current_date - interval '1 year') AND NOT g.is_closing`)} AS pytd,
    (SELECT COALESCE(sum(bm.amount),0) FROM budgets b JOIN budget_months bm ON bm.budget_id=b.id WHERE b.account_id=a.id AND b.fy_id=fy.id AND b.deleted_at IS NULL AND bm.period_no <= COALESCE((SELECT fp.period_no FROM financial_year_periods fp WHERE fp.fy_id=fy.id AND fp.start_date <= current_date AND fp.end_date >= current_date LIMIT 1), 12)) AS bud
  FROM accounts a LEFT JOIN gl_entries g ON g.account_id=a.id AND {SCOPE:g:nosoft} CROSS JOIN ${FY}
  WHERE a.deleted_at IS NULL AND a.is_group=false AND a.root_type IN ('Income','Expense')
  GROUP BY a.id, a.code, a.name, a.root_type, a.sub_type, fy.id, fy.start_date`;
const PL_FROM = `(${PL_BASE}) t ${NOAP}`;
const PL_LABELS = ['Line Code', 'Particulars', 'Current Month', 'YTD', 'Prior Year YTD', 'Budget YTD', 'Variance', 'Status', 'Actions'];
/** summary lines of the P&L: revenue, cost of goods, gross margin, other expenses, EBITDA, net profit */
const PL_SUMMARY = `(SELECT * FROM (
  SELECT 'REV' AS id, '1' AS code, 'Revenue' AS name, 'Income' AS root_type, 'Revenue' AS sub_type, sum(x.cm) FILTER (WHERE x.root_type='Income') AS cm, sum(x.ytd) FILTER (WHERE x.root_type='Income') AS ytd, sum(x.pytd) FILTER (WHERE x.root_type='Income') AS pytd, sum(x.bud) FILTER (WHERE x.root_type='Income') AS bud, 1 AS ord FROM (${PL_BASE}) x
  UNION ALL SELECT 'COGS', '2', 'Cost of goods sold', 'Expense', 'COGS', sum(x.cm) FILTER (WHERE x.sub_type='COGS'), sum(x.ytd) FILTER (WHERE x.sub_type='COGS'), sum(x.pytd) FILTER (WHERE x.sub_type='COGS'), sum(x.bud) FILTER (WHERE x.sub_type='COGS'), 2 FROM (${PL_BASE}) x
  UNION ALL SELECT 'GM', '3', 'Gross margin', 'Income', 'Margin', sum(CASE WHEN x.root_type='Income' THEN x.cm WHEN x.sub_type='COGS' THEN -x.cm ELSE 0 END), sum(CASE WHEN x.root_type='Income' THEN x.ytd WHEN x.sub_type='COGS' THEN -x.ytd ELSE 0 END), sum(CASE WHEN x.root_type='Income' THEN x.pytd WHEN x.sub_type='COGS' THEN -x.pytd ELSE 0 END), sum(CASE WHEN x.root_type='Income' THEN x.bud WHEN x.sub_type='COGS' THEN -x.bud ELSE 0 END), 3 FROM (${PL_BASE}) x
  UNION ALL SELECT 'OPEX', '4', 'Operating and other expenses', 'Expense', 'Opex', sum(x.cm) FILTER (WHERE x.root_type='Expense' AND x.sub_type<>'COGS'), sum(x.ytd) FILTER (WHERE x.root_type='Expense' AND x.sub_type<>'COGS'), sum(x.pytd) FILTER (WHERE x.root_type='Expense' AND x.sub_type<>'COGS'), sum(x.bud) FILTER (WHERE x.root_type='Expense' AND x.sub_type<>'COGS'), 4 FROM (${PL_BASE}) x
  UNION ALL SELECT 'DEP', '5', 'Depreciation', 'Expense', 'Depreciation', sum(x.cm) FILTER (WHERE x.sub_type='Depreciation'), sum(x.ytd) FILTER (WHERE x.sub_type='Depreciation'), sum(x.pytd) FILTER (WHERE x.sub_type='Depreciation'), sum(x.bud) FILTER (WHERE x.sub_type='Depreciation'), 5 FROM (${PL_BASE}) x
  UNION ALL SELECT 'NP', '6', 'Net profit', 'Income', 'Profit', sum(CASE WHEN x.root_type='Income' THEN x.cm ELSE -x.cm END), sum(CASE WHEN x.root_type='Income' THEN x.ytd ELSE -x.ytd END), sum(CASE WHEN x.root_type='Income' THEN x.pytd ELSE -x.pytd END), sum(CASE WHEN x.root_type='Income' THEN x.bud ELSE -x.bud END), 6 FROM (${PL_BASE}) x
  UNION ALL SELECT 'EBITDA', '7', 'EBITDA (net profit plus depreciation)', 'Income', 'Profit', sum(CASE WHEN x.root_type='Income' THEN x.cm WHEN x.sub_type='Depreciation' THEN 0 ELSE -x.cm END), sum(CASE WHEN x.root_type='Income' THEN x.ytd WHEN x.sub_type='Depreciation' THEN 0 ELSE -x.ytd END), sum(CASE WHEN x.root_type='Income' THEN x.pytd WHEN x.sub_type='Depreciation' THEN 0 ELSE -x.pytd END), sum(CASE WHEN x.root_type='Income' THEN x.bud WHEN x.sub_type='Depreciation' THEN 0 ELSE -x.bud END), 7 FROM (${PL_BASE}) x
 ) s) t ${NOAP}`;
const PL_STATUS = `CASE WHEN COALESCE(t.cm,0)=0 AND COALESCE(t.ytd,0)=0 THEN 'No activity' WHEN t.bud > 0 AND t.ytd > t.bud AND t.root_type='Expense' THEN 'Over budget' ELSE 'On track' END`;
const PL_COLS: Record<string, ReturnType<typeof t>> = {
  'Line Code': t('t.code'),
  Particulars: t('t.name'),
  'Current Month': m('COALESCE(t.cm,0)'),
  YTD: m('COALESCE(t.ytd,0)'),
  'Prior Year YTD': m('COALESCE(t.pytd,0)'),
  'Budget YTD': m('COALESCE(t.bud,0)'),
  Variance: m('COALESCE(t.ytd,0) - COALESCE(t.bud,0)'),
  Status: pill(PL_STATUS),
  Actions: ACTIONS,
  ...approvalCols('t.code'),
};
const PNL: PageDef = {
  from: PL_FROM,
  unit: null,
  soft: null,
  id: 't.id',
  number: 't.code',
  status: PL_STATUS,
  search: ['t.code', 't.name'],
  order: `CASE t.root_type WHEN 'Income' THEN 0 ELSE 1 END, t.code`,
  metric: { label: 'YTD', e: 't.ytd' },
  cols: PL_COLS,
  register: PL_LABELS,
  compact: PL_LABELS,
  views: [
    view(/^profit (&|and) loss$/i, PL_LABELS, { where: ['(t.cm<>0 OR t.ytd<>0 OR t.pytd<>0 OR t.bud<>0)'], panel: ledgerPanel('Income and expense postings', [`pa.root_type IN ('Income','Expense')`]) }),
    view(/^revenue breakdown$/i, PL_LABELS, { where: [`t.root_type='Income'`, '(t.cm<>0 OR t.ytd<>0 OR t.pytd<>0 OR t.bud<>0)'] }),
    view(/^cogs (&|and) gross margin$/i, PL_LABELS, { from: PL_SUMMARY, where: [`t.id IN ('REV','COGS','GM')`], order: 't.ord' }),
    view(/^operating expenses$/i, PL_LABELS, { where: [`t.root_type='Expense'`, `t.sub_type<>'COGS'`, '(t.cm<>0 OR t.ytd<>0 OR t.pytd<>0 OR t.bud<>0)'], panel: ledgerPanel('Expense postings', [`pa.root_type='Expense'`]) }),
    view(/^ebitda (&|and) net profit$/i, PL_LABELS, { from: PL_SUMMARY, where: [`t.id IN ('OPEX','DEP','NP','EBITDA')`], order: 't.ord', panel: ledgerPanel('Income and expense postings', [`pa.root_type IN ('Income','Expense')`]) }),
    view(/^period comparison$/i, PL_LABELS, { from: PL_SUMMARY, order: 't.ord' }),
  ],
};
PNL.cols['Line Code'] = t('t.code');

// Balance sheet: closing balance of every balance-sheet account today and at the end of the previous year; the profit of the year is its own line
const BS_NET = `COALESCE(sum(g.debit - g.credit) FILTER (WHERE g.posting_date <= current_date AND NOT (g.is_closing AND g.fy_id = fy.id)), 0)`;
const BS_PREV = `COALESCE(sum(g.debit - g.credit) FILTER (WHERE g.posting_date < fy.start_date), 0)`;
const BS_BASE = `SELECT a.id::text AS id, a.code, a.name, a.root_type, a.sub_type,
    ${NAT(BS_NET, 'a.root_type')} AS cur, ${NAT(BS_PREV, 'a.root_type')} AS prev, 1 AS ord
  FROM accounts a JOIN gl_entries g ON g.account_id=a.id AND {SCOPE:g:nosoft} CROSS JOIN ${FY}
  WHERE a.deleted_at IS NULL AND a.is_group=false AND a.root_type IN ('Asset','Liability','Equity')
  GROUP BY a.id, a.code, a.name, a.root_type, a.sub_type, fy.id, fy.start_date`;
const BS_PROFIT = `SELECT 'PROFIT' AS id, '-' AS code, 'Profit of the year' AS name, 'Equity' AS root_type, 'Profit' AS sub_type,
    COALESCE(sum(g.credit - g.debit) FILTER (WHERE g.fy_id = fy.id AND NOT g.is_closing), 0) AS cur, 0::numeric AS prev, 2 AS ord
  FROM accounts a JOIN gl_entries g ON g.account_id=a.id AND {SCOPE:g:nosoft} CROSS JOIN ${FY}
  WHERE a.deleted_at IS NULL AND a.root_type IN ('Income','Expense')`;
const BS_FROM = `(${BS_BASE} UNION ALL ${BS_PROFIT}) t ${NOAP}`;
const BS_LABELS = ['Line Code', 'Particulars', 'Current Period', 'Prior Period', 'Movement', 'Category', 'Status', 'Actions'];
const BS_STATUS = `CASE WHEN t.cur < 0 THEN 'Abnormal' WHEN t.cur = 0 THEN 'Nil' ELSE 'OK' END`;
const BALANCE: PageDef = {
  from: BS_FROM,
  unit: null,
  soft: null,
  number: 't.code',
  status: BS_STATUS,
  search: ['t.code', 't.name'],
  order: `CASE t.root_type WHEN 'Asset' THEN 0 WHEN 'Liability' THEN 1 ELSE 2 END, t.ord, t.code`,
  metric: { label: 'Current Period', e: 't.cur' },
  cols: {
    ...approvalCols('t.code'),
    'Line Code': t('t.code'),
    Particulars: t('t.name'),
    'Current Period': m('t.cur'),
    'Prior Period': m('t.prev'),
    Movement: m('t.cur - t.prev'),
    Category: t('t.root_type'),
    Status: pill(BS_STATUS),
    Actions: ACTIONS,
  },
  register: BS_LABELS,
  compact: BS_LABELS,
  views: [
    view(/^balance sheet$/i, BS_LABELS, { where: ['(t.cur<>0 OR t.prev<>0)'], panel: openItemsPanel('Sub-ledger open items behind the control accounts') }),
    view(/^assets$/i, BS_LABELS, {
      where: [`t.root_type='Asset'`, '(t.cur<>0 OR t.prev<>0)'],
      panel: {
        title: 'Fixed assets',
        from: `assets p JOIN asset_book_profile bp ON bp.asset_id=p.id AND bp.area='BOOK'`,
        unit: 'p.unit_id',
        soft: 'p.deleted_at',
        order: 'p.asset_no',
        cols: [
          ['Asset', `p.asset_no || ' ' || p.name`, 'text'],
          ['Cost', 'bp.cost', 'inr'],
          ['Book Value', 'bp.cost - bp.accum_dep', 'inr'],
          ['Depreciation', 'bp.accum_dep', 'inr'],
          ['Location', 'p.location', 'text'],
        ],
      },
    }),
    view(/^liabilities$/i, BS_LABELS, { where: [`t.root_type='Liability'`, '(t.cur<>0 OR t.prev<>0)'], panel: ledgerPanel('Liability postings', [`pa.root_type='Liability'`]) }),
    view(/^equity$/i, BS_LABELS, { where: [`t.root_type='Equity'`, '(t.cur<>0 OR t.prev<>0)'], panel: ledgerPanel('Equity postings', [`pa.root_type='Equity'`]) }),
    view(/^working capital$/i, BS_LABELS, {
      where: [`t.sub_type IN ('Cash','Bank','Receivable','Payable','Stock','GSTInput','GSTOutput','GSTRCM','TDSPayable','TDSReceivable','TCSPayable','TCSReceivable','GSTCash')`, '(t.cur<>0 OR t.prev<>0)'],
    }),
    view(/^period comparison$/i, BS_LABELS, { where: ['(t.cur<>0 OR t.prev<>0)'] }),
  ],
};

// Cash flow (indirect): every non-cash account's credit - debit is the cash it produced; P&L accounts are operating
const CF_CAT = `CASE WHEN a.root_type IN ('Income','Expense') OR a.cf_class IN ('WC','NONCASH') THEN 'Operating' WHEN a.cf_class='INVESTING' THEN 'Investing' ELSE 'Financing' END`;
const CF_FROM = `(SELECT a.id::text AS id, a.code, a.name, ${CF_CAT} AS cat,
    COALESCE(sum(g.credit - g.debit) FILTER (WHERE g.posting_date >= date_trunc('month', current_date) AND NOT g.is_closing), 0) AS cm,
    COALESCE(sum(g.credit - g.debit) FILTER (WHERE g.fy_id = fy.id AND NOT g.is_closing), 0) AS ytd,
    COALESCE(sum(g.credit - g.debit) FILTER (WHERE g.posting_date >= fy.start_date - interval '1 year' AND g.posting_date <= (current_date - interval '1 year') AND NOT g.is_closing), 0) AS pytd
  FROM accounts a JOIN gl_entries g ON g.account_id=a.id AND {SCOPE:g:nosoft} CROSS JOIN ${FY}
  WHERE a.deleted_at IS NULL AND a.is_group=false AND a.cf_class <> 'CASH'
  GROUP BY a.id, a.code, a.name, a.root_type, a.cf_class, fy.id, fy.start_date
  HAVING sum(g.credit - g.debit) FILTER (WHERE g.fy_id = fy.id AND NOT g.is_closing) <> 0 OR sum(g.credit - g.debit) FILTER (WHERE g.posting_date >= date_trunc('month', current_date) AND NOT g.is_closing) <> 0) t ${NOAP}`;
const CF_LABELS = ['Line Code', 'Cash Flow Category', 'Current Month', 'YTD', 'Prior YTD', 'Forecast', 'Variance', 'Status', 'Actions'];
const CF_STATUS = `CASE WHEN t.ytd > 0 THEN 'Inflow' WHEN t.ytd < 0 THEN 'Outflow' ELSE 'Nil' END`;
const CASHFLOW: PageDef = {
  from: CF_FROM,
  unit: null,
  soft: null,
  number: 't.code',
  status: CF_STATUS,
  search: ['t.code', 't.name'],
  order: 't.cat, t.code',
  metric: { label: 'YTD', e: 't.ytd' },
  cols: {
    ...approvalCols('t.code'),
    'Line Code': t(`t.code || ' ' || t.name`),
    'Cash Flow Category': t('t.cat'),
    'Current Month': m('t.cm'),
    YTD: m('t.ytd'),
    'Prior YTD': m('t.pytd'),
    Forecast: none('inr'),
    Variance: none('inr'),
    Status: pill(CF_STATUS),
    Actions: ACTIONS,
  },
  register: CF_LABELS,
  compact: CF_LABELS,
  views: [
    view(/^cash flow$/i, CF_LABELS, {
      panel: ledgerPanel('Cash and bank postings', [`pa.cf_class='CASH'`]),
      kpis: [
        { label: 'Operating (YTD)', e: `COALESCE(sum(t.ytd) FILTER (WHERE t.cat='Operating'),0)`, type: 'inr' },
        { label: 'Investing (YTD)', e: `COALESCE(sum(t.ytd) FILTER (WHERE t.cat='Investing'),0)`, type: 'inr' },
        { label: 'Financing (YTD)', e: `COALESCE(sum(t.ytd) FILTER (WHERE t.cat='Financing'),0)`, type: 'inr' },
      ],
    }),
    view(/^operating activities$/i, CF_LABELS, { where: [`t.cat='Operating'`], panel: ledgerPanel('Cash and bank postings', [`pa.cf_class='CASH'`]) }),
    view(/^investing activities$/i, CF_LABELS, { where: [`t.cat='Investing'`], panel: ledgerPanel('Cash and bank postings', [`pa.cf_class='CASH'`]) }),
    view(/^financing activities$/i, CF_LABELS, { where: [`t.cat='Financing'`], panel: ledgerPanel('Cash and bank postings', [`pa.cf_class='CASH'`]) }),
    view(/^cash forecast$/i, CF_LABELS),
    view(/^variance$/i, CF_LABELS),
  ],
};

export const FINANCE_V40_PAGES: Record<string, PageDef> = {
  'fin-ap': AP,
  'fin-ar': AR,
  'fin-ageing': AGEING,
  'fin-gl': GL,
  'fin-cashbook': CASHBOOK,
  'fin-bankbook': BANKBOOK,
  'fin-journal': JOURNAL,
  'fin-coa': COA,
  'fin-costcenter': COSTCENTER,
  'fin-profitcenter': PROFITCENTER,
  'fin-bankreco': BANKRECO,
  'fin-creditnote': CREDITNOTE,
  'fin-debitnote': DEBITNOTE,
  'fin-expenses': EXPENSES,
  'fin-budget': BUDGET,
  'fin-trial': TRIAL,
  'fin-pnl': PNL,
  'fin-bs': BALANCE,
  'fin-cashflow': CASHFLOW,
};
