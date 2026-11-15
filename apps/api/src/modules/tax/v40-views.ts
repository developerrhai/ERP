// V40 tab definitions of the Indian Taxation pages (page-by-page build). Engine: ../finance/v40-engine.ts. Every column is a
// field of tax_documents / gst_returns / einvoice_records / eway_bills / tds_entries / gst_registrations / hsn_sac_codes or a
// value computed from them (GSTR-3B figures come from the same service as the GSTR-3B page). A label with no
// expression has no source in the database yet: it shows a dash and is listed in noSource.
import { D, money } from '../finance/money';
import {
  ACTIONS,
  DOCS,
  NOAP,
  allocPanel,
  approvalCols,
  d,
  exc,
  exceptionPanel,
  ledgerPanel,
  m,
  n,
  none,
  pill,
  settlePanel,
  t,
  validationPanel,
} from '../finance/v40-engine';
import type { PageDef, PanelDef, ViewDef } from '../finance/v40-engine';
import { returnsService } from './returns-service';

const view = (match: RegExp, labels: string[], more: Partial<ViewDef> = {}): ViewDef => ({ match, labels, ...more });
const TAXSUM = (a: string): string => `(${a}.cgst + ${a}.sgst + ${a}.igst + ${a}.cess)`;
const DOCTYPE = `CASE t.doc_kind WHEN 'INV' THEN 'Tax Invoice' WHEN 'CRN' THEN 'Credit Note' ELSE 'Debit Note' END`;

// ================================================================================================ sales / purchase registers
const SR_COMPACT = ['Invoice No', 'Date', 'Customer', 'GSTIN', 'Document Type', 'Taxable', 'CGST', 'Status', 'Actions'];
const SALESREG: PageDef = {
  from: `tax_documents t LEFT JOIN LATERAL (SELECT e.irn FROM einvoice_records e WHERE e.doc_id=t.source_id AND e.status='Generated' ORDER BY e.created_at DESC LIMIT 1) ei ON true ${NOAP}`,
  soft: null,
  number: 't.doc_no',
  status: 't.status',
  search: ['t.doc_no', 't.party_name', 't.party_gstin'],
  base: [`t.direction='OUTWARD'`],
  order: 't.doc_date DESC, t.doc_no DESC',
  metric: { label: 'Taxable', e: 't.taxable' },
  calendar: 't.doc_date',
  cols: {
    'Invoice No': t('t.doc_no'),
    Date: d('t.doc_date'),
    Customer: t('t.party_name'),
    GSTIN: t('t.party_gstin'),
    'Document Type': t(DOCTYPE),
    Taxable: m('t.taxable'),
    CGST: m('t.cgst'),
    SGST: m('t.sgst'),
    IGST: m('t.igst'),
    Total: m(`t.taxable + ${TAXSUM('t')}`),
    IRN: t('ei.irn'),
    Status: pill('t.status'),
    Docs: DOCS('tax-salesreg'),
    Actions: ACTIONS,
    ...approvalCols('t.doc_no'),
  },
  register: ['Invoice No', 'Date', 'Customer', 'GSTIN', 'Document Type', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total', 'IRN', 'Status', 'Docs', 'Actions'],
  compact: SR_COMPACT,
  views: [
    view(/^sales register$/i, ['Invoice No', 'Date', 'Customer', 'GSTIN', 'Document Type', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total', 'IRN', 'Status', 'Docs', 'Actions']),
    view(/^invoice detail$/i, ['Invoice No', 'Date', 'Customer', 'Status', 'GSTIN', 'Document Type', 'Taxable', 'Actions']),
    view(/^tax summary$/i, ['GSTIN', 'Taxable', 'CGST', 'SGST', 'IGST', 'Invoice No', 'Date', 'Status', 'Actions'], {
      order: 't.party_gstin NULLS LAST, t.doc_date DESC',
      kpis: [
        { label: 'Taxable', e: 'COALESCE(sum(t.taxable),0)', type: 'inr' },
        { label: 'CGST', e: 'COALESCE(sum(t.cgst),0)', type: 'inr' },
        { label: 'SGST', e: 'COALESCE(sum(t.sgst),0)', type: 'inr' },
        { label: 'IGST', e: 'COALESCE(sum(t.igst),0)', type: 'inr' },
      ],
    }),
    view(/^customer gstin$/i, ['GSTIN', 'Taxable', 'CGST', 'SGST', 'IGST', 'Invoice No', 'Date', 'Status', 'Actions'], { order: 't.party_gstin NULLS LAST, t.doc_date DESC' }),
    view(/^document type$/i, ['Invoice No', 'Date', 'Customer', 'GSTIN', 'Document Type', 'Taxable', 'CGST', 'Actions'], {
      order: 't.doc_kind, t.doc_date DESC',
      panel: {
        title: 'Documents attached to the register',
        from: 'record_documents p',
        unit: null,
        soft: 'p.deleted_at',
        where: [`p.page_id='tax-salesreg'`],
        order: 'p.created_at DESC',
        cols: [
          ['Document', 'p.title', 'text'],
          ['Category', 'p.doc_type', 'text'],
          ['Revision', undefined, 'text'],
          ['Linked Record', `(SELECT x.doc_no FROM tax_documents x WHERE x.id::text = p.record_id::text)`, 'text'],
          ['Expiry', undefined, 'date'],
          ['Status', `'Active'`, 'pill'],
        ],
      },
    }),
    view(/^gst reconciliation$/i, ['GSTIN', 'Taxable', 'CGST', 'SGST', 'IGST', 'Invoice No', 'Date', 'Status', 'Actions'], {
      panel: ledgerPanel('GST output ledger', [`pa.sub_type='GSTOutput'`]),
      kpis: [
        { label: 'Tax in the register', e: `COALESCE(sum(${TAXSUM('t')}),0)`, type: 'inr' },
        { label: 'Output GST in the ledger', e: `(SELECT COALESCE(sum(g.credit - g.debit),0) FROM gl_entries g JOIN accounts ga ON ga.id=g.account_id WHERE ga.sub_type='GSTOutput')`, type: 'inr' },
      ],
    }),
  ],
};

const PR_LABELS = ['Vendor Invoice', 'Date', 'Vendor', 'GSTIN', 'Taxable', 'CGST', 'SGST', 'Status', 'Actions'];
const PR_INELIGIBLE = `COALESCE((SELECT sum(l.cgst + l.sgst + l.igst) FROM purchase_invoice_lines l WHERE l.invoice_id=pi.id AND l.itc_flag='INELIGIBLE_17_5'),0)`;
const PURCHASEREG: PageDef = {
  from: `tax_documents t LEFT JOIN purchase_invoices pi ON pi.id=t.source_id LEFT JOIN projects pr ON pr.id=pi.project_id
    LEFT JOIN LATERAL (SELECT x.cgst + x.sgst + x.igst AS tax, x.match_status FROM gstr2b_lines x WHERE x.invoice_id=pi.id ORDER BY x.doc_date DESC LIMIT 1) b2 ON true ${NOAP}`,
  soft: null,
  number: `COALESCE(pi.vendor_invoice_no, t.doc_no)`,
  status: 't.status',
  search: ['t.doc_no', 'pi.vendor_invoice_no', 't.party_name', 't.party_gstin'],
  base: [`t.direction='INWARD'`],
  order: 't.doc_date DESC, t.doc_no DESC',
  metric: { label: 'Taxable', e: 't.taxable' },
  calendar: 't.doc_date',
  cols: {
    'Vendor Invoice': t('COALESCE(pi.vendor_invoice_no, t.doc_no)'),
    Date: d('t.doc_date'),
    Vendor: t('t.party_name'),
    GSTIN: t('t.party_gstin'),
    Taxable: m('t.taxable'),
    CGST: m('t.cgst'),
    SGST: m('t.sgst'),
    IGST: m('t.igst'),
    'ITC Eligible': m(`CASE WHEN t.doc_kind='INV' THEN ${TAXSUM('t')} - ${PR_INELIGIBLE} END`),
    '2B Match': t(`COALESCE(pi.gstr2b_status, b2.match_status)`),
    Difference: m(`CASE WHEN b2.tax IS NOT NULL THEN (t.cgst + t.sgst + t.igst) - b2.tax END`),
    'Project Number': t('pr.code'),
    Status: pill('t.status'),
    Docs: DOCS('tax-purchasereg'),
    Actions: ACTIONS,
    ...approvalCols('t.doc_no'),
  },
  register: ['Vendor Invoice', 'Date', 'Vendor', 'GSTIN', 'Taxable', 'CGST', 'SGST', 'IGST', 'ITC Eligible', '2B Match', 'Difference', 'Status', 'Docs', 'Actions', 'Project Number'],
  compact: PR_LABELS,
  views: [
    view(/^purchase register$/i, ['Vendor Invoice', 'Date', 'Vendor', 'GSTIN', 'Taxable', 'CGST', 'SGST', 'IGST', 'ITC Eligible', '2B Match', 'Difference', 'Status', 'Docs', 'Actions', 'Project Number']),
    view(/^vendor invoice detail$/i, ['Vendor Invoice', 'Date', 'Vendor', 'Status', 'Project Number', 'GSTIN', 'Taxable', 'Actions']),
    view(/^itc eligibility$/i, ['Vendor Invoice', 'Date', 'Vendor', 'GSTIN', 'Taxable', 'CGST', 'SGST', 'ITC Eligible', 'Status', 'Actions'], {
      where: [`t.doc_kind='INV'`],
      kpis: [
        { label: 'Eligible ITC', e: `COALESCE(sum(${TAXSUM('t')} - ${PR_INELIGIBLE}),0)`, type: 'inr' },
        { label: 'Ineligible (section 17(5))', e: `COALESCE(sum(${PR_INELIGIBLE}),0)`, type: 'inr' },
      ],
    }),
    view(/^vendor gstin$/i, ['GSTIN', 'Taxable', 'CGST', 'SGST', 'IGST', 'Vendor Invoice', 'Date', 'Status', 'Actions'], { order: 't.party_gstin NULLS LAST, t.doc_date DESC' }),
    view(/^2b match status$/i, PR_LABELS.slice(0, 7).concat(['2B Match', 'Difference', 'Status', 'Actions']), {
      kpis: [
        { label: 'In GSTR-2B', e: `count(*) FILTER (WHERE b2.tax IS NOT NULL)`, type: 'num' },
        { label: 'Not in GSTR-2B', e: `count(*) FILTER (WHERE b2.tax IS NULL)`, type: 'num' },
      ],
    }),
    view(/^gst reconciliation$/i, ['GSTIN', 'Taxable', 'CGST', 'SGST', 'IGST', 'Vendor Invoice', 'Date', 'Status', 'Actions'], {
      kpis: [
        { label: 'Tax in the register', e: `COALESCE(sum(${TAXSUM('t')}),0)`, type: 'inr' },
        { label: 'Input GST in the ledger', e: `(SELECT COALESCE(sum(g.debit - g.credit),0) FROM gl_entries g JOIN accounts ga ON ga.id=g.account_id WHERE ga.sub_type='GSTInput')`, type: 'inr' },
      ],
    }),
  ],
};

// ================================================================================================ GSTR-1 / GSTR-3B (one row per GSTIN and month)
const RET_BASE = (kind: 'GSTR1' | 'GSTR3B'): string =>
  `(SELECT x.unit_id, x.gstin, date_trunc('month', x.doc_date)::date AS pm,
      x.unit_id::text || '|' || to_char(date_trunc('month', x.doc_date), 'YYYY-MM') AS id,
      COALESCE(sum(x.taxable) FILTER (WHERE x.direction='OUTWARD' AND x.doc_kind='INV' AND COALESCE(x.party_gstin,'')<>'' AND COALESCE(x.place_of_supply,'')<>'96'),0) AS b2b,
      COALESCE(sum(x.taxable) FILTER (WHERE x.direction='OUTWARD' AND x.doc_kind='INV' AND COALESCE(x.party_gstin,'')='' AND COALESCE(x.place_of_supply,'')<>'96'),0) AS b2c,
      COALESCE(sum(x.taxable) FILTER (WHERE x.direction='OUTWARD' AND x.doc_kind='INV' AND COALESCE(x.place_of_supply,'')='96'),0) AS expo,
      COALESCE(sum(x.taxable) FILTER (WHERE x.direction='OUTWARD' AND x.doc_kind='CRN'),0) AS crn,
      COALESCE(sum(x.cgst + x.sgst + x.igst + x.cess) FILTER (WHERE x.direction='OUTWARD' AND x.doc_kind IN ('INV','DBN')),0)
        - COALESCE(sum(x.cgst + x.sgst + x.igst + x.cess) FILTER (WHERE x.direction='OUTWARD' AND x.doc_kind='CRN'),0) AS liab,
      COALESCE(sum(x.cgst + x.sgst + x.igst + x.cess) FILTER (WHERE x.direction='INWARD' AND x.reverse_charge AND x.doc_kind='INV'),0) AS rcm
    FROM tax_documents x WHERE x.status='Active' AND {SCOPE:x:nosoft} GROUP BY x.unit_id, x.gstin, date_trunc('month', x.doc_date)) t
  LEFT JOIN gst_returns gr ON gr.unit_id=t.unit_id AND gr.gstin=t.gstin AND gr.return_type='${kind}' AND gr.period_month=t.pm ${NOAP}`;
const RET_STATUS = `COALESCE(gr.status,'Not prepared')`;
const RET_COMMON = {
  GSTIN: t('t.gstin'),
  'Return Period': t(`to_char(t.pm,'YYYY-MM')`),
  Status: pill(RET_STATUS),
  'Filing Status': t(`CASE WHEN gr.filed_on IS NOT NULL THEN 'Filed on ' || to_char(gr.filed_on,'DD-MM-YYYY') || ' (ARN ' || gr.arn || ')' ELSE 'Not filed' END`),
  Actions: ACTIONS,
  ...approvalCols(`to_char(t.pm,'YYYY-MM')`),
};
const G1_LABELS = ['Return Period', 'GSTIN', 'B2B Taxable', 'B2C Taxable', 'Exports', 'Credit Notes', 'Tax Liability', 'Status', 'Actions'];
const G1_RULES = (): PanelDef =>
  validationPanel('GSTR-1 checks', [
    ['Every B2B invoice carries the customer GSTIN', `SELECT count(*) FROM tax_documents x WHERE x.direction='OUTWARD' AND x.doc_kind='INV' AND x.status='Active' AND COALESCE(x.party_gstin,'')<>'' AND {SCOPE:x:nosoft}`, 'SELECT 0', `SELECT count(*) FROM tax_documents x WHERE x.direction='OUTWARD' AND x.doc_kind='INV' AND x.status='Active' AND x.reverse_charge=false AND COALESCE(x.party_gstin,'')='' AND x.taxable >= 250000 AND {SCOPE:x:nosoft}`],
    ['Every document has a place of supply', `SELECT count(*) FROM tax_documents x WHERE x.direction='OUTWARD' AND x.status='Active' AND COALESCE(x.place_of_supply,'')<>'' AND {SCOPE:x:nosoft}`, 'SELECT 0', `SELECT count(*) FROM tax_documents x WHERE x.direction='OUTWARD' AND x.status='Active' AND COALESCE(x.place_of_supply,'')='' AND {SCOPE:x:nosoft}`],
    ['Every document line carries an HSN or SAC', `SELECT count(*) FROM tax_document_lines l JOIN tax_documents x ON x.id=l.tax_document_id WHERE x.direction='OUTWARD' AND x.status='Active' AND COALESCE(l.hsn,'')<>'' AND {SCOPE:x:nosoft}`, 'SELECT 0', `SELECT count(*) FROM tax_document_lines l JOIN tax_documents x ON x.id=l.tax_document_id WHERE x.direction='OUTWARD' AND x.status='Active' AND COALESCE(l.hsn,'')='' AND {SCOPE:x:nosoft}`],
    ['Credit and debit notes name the original document', `SELECT count(*) FROM tax_documents x WHERE x.direction='OUTWARD' AND x.doc_kind IN ('CRN','DBN') AND x.status='Active' AND x.orig_doc_no IS NOT NULL AND {SCOPE:x:nosoft}`, 'SELECT 0', `SELECT count(*) FROM tax_documents x WHERE x.direction='OUTWARD' AND x.doc_kind IN ('CRN','DBN') AND x.status='Active' AND x.orig_doc_no IS NULL AND {SCOPE:x:nosoft}`],
  ]);
const GSTR1: PageDef = {
  from: RET_BASE('GSTR1'),
  unit: null,
  soft: null,
  number: `to_char(t.pm,'YYYY-MM')`,
  status: RET_STATUS,
  search: ['t.gstin', `to_char(t.pm,'YYYY-MM')`],
  base: ['(t.b2b<>0 OR t.b2c<>0 OR t.expo<>0 OR t.crn<>0 OR t.liab<>0)'],
  order: 't.pm DESC, t.gstin',
  metric: { label: 'Tax Liability', e: 't.liab' },
  calendar: 't.pm',
  cols: {
    ...RET_COMMON,
    'B2B Taxable': m('t.b2b'),
    'B2C Taxable': m('t.b2c'),
    'Tax Liability': m('t.liab'),
    Exports: m('t.expo'),
    'Credit Notes': m('t.crn'),
  },
  register: ['GSTIN', 'B2B Taxable', 'B2C Taxable', 'Tax Liability', 'Return Period', 'Exports', 'Credit Notes', 'Status', 'Actions'],
  compact: G1_LABELS,
  views: [
    view(/^gstr 1 workspace$/i, ['GSTIN', 'B2B Taxable', 'B2C Taxable', 'Tax Liability', 'Return Period', 'Exports', 'Credit Notes', 'Status', 'Actions']),
    view(/^b2b invoices$/i, ['Filing Status', 'Return Period', 'GSTIN', 'B2B Taxable', 'B2C Taxable', 'Exports', 'Credit Notes', 'Status', 'Actions']),
    view(/^b2c supplies$/i, G1_LABELS),
    view(/^credit debit notes$/i, G1_LABELS, { panel: settlePanel('Open credit notes', 'RECEIVABLE', ['CREDIT_NOTE'], true) }),
    view(/^hsn summary$/i, G1_LABELS),
    view(/^return validation$/i, G1_LABELS, { panel: G1_RULES() }),
  ],
};

const G3_LABELS = ['Return Period', 'GSTIN', 'Outward Tax', 'Reverse Charge', 'Eligible ITC', 'Ineligible ITC', 'Net Tax Payable', 'Status', 'Actions'];
const GSTR3B: PageDef = {
  from: RET_BASE('GSTR3B'),
  unit: null,
  soft: null,
  number: `to_char(t.pm,'YYYY-MM')`,
  status: RET_STATUS,
  search: ['t.gstin', `to_char(t.pm,'YYYY-MM')`],
  order: 't.pm DESC, t.gstin',
  metric: { label: 'Outward Tax', e: 't.liab' },
  calendar: 't.pm',
  cols: {
    ...RET_COMMON,
    'Outward Tax': m('t.liab'),
    'Reverse Charge': m('t.rcm'),
    // the next three come from the GSTR-3B build (same numbers as the GSTR-3B page); until then they are empty
    'Eligible ITC': { e: 'NULL', type: 'inr' },
    'Ineligible ITC': { e: 'NULL', type: 'inr' },
    'Net Tax Payable': { e: 'NULL', type: 'inr' },
  },
  register: ['GSTIN', 'Outward Tax', 'Net Tax Payable', 'Return Period', 'Reverse Charge', 'Eligible ITC', 'Ineligible ITC', 'Status', 'Actions'],
  compact: G3_LABELS,
  views: [
    view(/^gstr 3b workspace$/i, ['GSTIN', 'Outward Tax', 'Net Tax Payable', 'Return Period', 'Reverse Charge', 'Eligible ITC', 'Ineligible ITC', 'Status', 'Actions']),
    view(/^outward tax liability$/i, ['GSTIN', 'Outward Tax', 'Net Tax Payable', 'Return Period', 'Reverse Charge', 'Eligible ITC', 'Ineligible ITC', 'Status', 'Actions']),
    view(/^eligible itc$/i, G3_LABELS),
    view(/^ineligible itc$/i, ['Return Period', 'GSTIN', 'Outward Tax', 'Reverse Charge', 'Eligible ITC', 'Ineligible ITC', 'Net Tax Payable', 'Status', 'Actions']),
    view(/^tax payment$/i, ['GSTIN', 'Outward Tax', 'Net Tax Payable', 'Return Period', 'Reverse Charge', 'Eligible ITC', 'Ineligible ITC', 'Status', 'Actions'], {
      panel: {
        title: 'GST cash payments (challans)',
        from: 'gst_settlements p',
        unit: 'p.unit_id',
        soft: null,
        order: 'p.period_month DESC, p.created_at DESC',
        cols: [
          ['Reference', `COALESCE(p.challan_no, to_char(p.period_month,'YYYY-MM'))`, 'text'],
          ['Due', undefined, 'date'],
          ['Amount', 'p.cash_paid', 'inr'],
          ['Allocated', undefined, 'inr'],
          ['Balance', undefined, 'inr'],
          ['Action', undefined, 'actions'],
        ],
      },
    }),
    view(/^return reconciliation$/i, ['Return Period', 'GSTIN', 'Outward Tax', 'Reverse Charge', 'Eligible ITC', 'Ineligible ITC', 'Net Tax Payable', 'Status', 'Actions'], {
      panel: ledgerPanel('GST ledger (output, input, reverse charge)', [`pa.sub_type IN ('GSTOutput','GSTInput','GSTRCM')`]),
    }),
  ],
  async enrich(rows, keys) {
    const k = (label: string): string | undefined => keys[label];
    for (const r of rows) {
      const [unitId, month] = String(r.id).split('|');
      if (!unitId || !month) continue;
      try {
        const x = (await returnsService.gstr3b(unitId, month)) as unknown as {
          s31: { a_taxable: Tax; d_reverseCharge: Tax };
          s4: { c_net: Tax; d_ineligible: Tax };
          s61: { cashPayable: Tax };
        };
        const sum = (h: Tax): string => money(D(h.igst).plus(h.cgst).plus(h.sgst));
        const set = (label: string, v: string): void => {
          const key = k(label);
          if (key) r[key] = v;
        };
        set('Outward Tax', sum(x.s31.a_taxable));
        set('Reverse Charge', sum(x.s31.d_reverseCharge));
        set('Eligible ITC', sum(x.s4.c_net));
        set('Ineligible ITC', sum(x.s4.d_ineligible));
        set('Net Tax Payable', sum(x.s61.cashPayable));
      } catch {
        // the unit has no valid GSTIN: the figures stay empty (dash)
      }
    }
  },
};
interface Tax {
  igst: string;
  cgst: string;
  sgst: string;
}

// ================================================================================================ TDS / TCS
const TDS_FROM = `tds_entries t
  LEFT JOIN LATERAL (SELECT jl.party_type, jl.party_id FROM journal_lines jl WHERE jl.journal_id=t.journal_id AND jl.party_id IS NOT NULL ORDER BY jl.line_no LIMIT 1) jp ON true
  LEFT JOIN suppliers su ON su.id = COALESCE(t.supplier_id, CASE WHEN jp.party_type='SUPPLIER' THEN jp.party_id END)
  LEFT JOIN customers cu ON cu.id = CASE WHEN jp.party_type='CUSTOMER' THEN jp.party_id END ${NOAP}`;
const TDS_STATUS = `CASE WHEN t.status='Cancelled' THEN 'Cancelled' WHEN t.challan_id IS NOT NULL THEN 'Deposited' ELSE 'Deducted' END`;
const taxAtSource = (kind: 'TDS' | 'TCS'): PageDef => {
  const no = `${kind} Entry No`;
  const who = kind === 'TDS' ? 'Deductee' : 'Collectee';
  const dt = kind === 'TDS' ? 'Payment Date' : 'Receipt Date';
  const amt = kind === 'TDS' ? 'Amount Paid' : 'Amount';
  const page = kind === 'TDS' ? 'tax-tds' : 'tax-tcs';
  const base = [no, 'Section', who, 'PAN', dt, amt, 'Rate %', 'Status', 'Actions'];
  const challanPanel: PanelDef = {
    title: `${kind} challans`,
    from: 'tax_challans p',
    unit: 'p.unit_id',
    soft: null,
    where: [`p.tax_kind='${kind}'`],
    order: 'p.paid_on DESC, p.challan_no',
    cols: [
      ['Reference', 'p.challan_no', 'text'],
      ['Due', undefined, 'date'],
      ['Amount', 'p.amount', 'inr'],
      ['Allocated', `(SELECT COALESCE(sum(e.tds_amount),0) FROM tds_entries e WHERE e.challan_id=p.id)`, 'inr'],
      ['Balance', `p.amount - (SELECT COALESCE(sum(e.tds_amount),0) FROM tds_entries e WHERE e.challan_id=p.id)`, 'inr'],
      ['Action', undefined, 'actions'],
    ],
  };
  const allocation = allocPanel(`${kind} against challans`, 'tds_entries p', 'p.unit_id', 'p.deducted_on DESC, p.source_doc_no', {
    record: 'p.source_doc_no',
    demand: 'p.tds_amount',
    allocated: 'CASE WHEN p.challan_id IS NOT NULL THEN p.tds_amount ELSE 0 END',
    short: 'CASE WHEN p.challan_id IS NULL THEN p.tds_amount ELSE 0 END',
    where: [`p.kind='${kind}'`, `p.status='Active'`],
    action: `CASE WHEN p.challan_id IS NULL THEN 'Allocate' END`,
  });
  return {
    from: TDS_FROM,
    soft: null,
    number: 't.source_doc_no',
    status: TDS_STATUS,
    search: ['t.source_doc_no', 'su.name', 'cu.name', 't.section_code', 'su.pan', 'cu.pan'],
    base: [`t.kind='${kind}'`],
    order: 't.deducted_on DESC, t.source_doc_no DESC',
    metric: { label: 'TDS Amount', e: 't.tds_amount' },
    calendar: 't.deducted_on',
    cols: {
      [no]: t('t.source_doc_no'),
      Section: t('t.section_code'),
      [who]: t('COALESCE(su.name, cu.name)'),
      PAN: t('COALESCE(su.pan, cu.pan)'),
      [dt]: d('t.deducted_on'),
      [amt]: m('t.base_amount'),
      'TDS Amount': m('t.tds_amount'),
      'Rate %': n('t.rate_pct'),
      Status: pill(TDS_STATUS),
      Actions: ACTIONS,
      ...approvalCols('t.source_doc_no'),
    },
    register: kind === 'TDS' ? [no, 'PAN', 'TDS Amount', 'Section', who, dt, amt, 'Status', 'Actions'] : base,
    compact: base,
    views: [
      view(kind === 'TDS' ? /^tds register$/i : /^tcs register$/i, kind === 'TDS' ? [no, 'PAN', 'TDS Amount', 'Section', who, dt, amt, 'Status', 'Actions'] : base),
      view(/^section mapping$/i, base),
      view(kind === 'TDS' ? /^deduction entries$/i : /^collection entries$/i, kind === 'TDS' ? [no, 'PAN', 'TDS Amount', 'Section', who, dt, amt, 'Status', 'Actions'] : [dt, 'Status', no, 'Section', who, 'PAN', 'Actions'], kind === 'TCS' ? { panel: challanPanel } : {}),
      view(/^challan allocation$/i, kind === 'TDS' ? ['Status', no, 'Section', who, 'PAN', dt, amt, 'Actions'] : ['Status', no, 'Section', who, 'PAN', dt, amt, 'Actions'], { panel: allocation }),
      view(/^return preparation$/i, base),
      view(/^(tds|tcs) compliance$/i, kind === 'TDS' ? [no, 'PAN', 'TDS Amount', 'Section', who, dt, amt, 'Status', 'Actions'] : ['PAN', no, 'Section', who, dt, amt, 'Rate %', 'Status', 'Actions'], {
        kpis: [
          { label: 'Entries without PAN', e: `count(*) FILTER (WHERE COALESCE(su.pan, cu.pan) IS NULL)`, type: 'num' },
          { label: `${kind} not yet deposited`, e: `COALESCE(sum(t.tds_amount) FILTER (WHERE t.challan_id IS NULL AND t.status='Active'),0)`, type: 'inr' },
        ],
      }),
    ],
  };
};
const TDS = taxAtSource('TDS');
const TCS = taxAtSource('TCS');
TDS.cols['Docs'] = DOCS(`tax-tds`);
TCS.cols['Docs'] = DOCS(`tax-tcs`);

// ================================================================================================ e-invoice / e-way bill
const EI_LABELS = ['Invoice No', 'Customer GSTIN', 'Invoice Date', 'Taxable Value', 'GST', 'IRN', 'Ack No', 'Status', 'Actions'];
const EINVOICE: PageDef = {
  from: `einvoice_records t LEFT JOIN LATERAL (SELECT td.party_gstin, td.taxable, td.cgst + td.sgst + td.igst + td.cess AS gst FROM tax_documents td WHERE td.source_id=t.doc_id ORDER BY td.created_at DESC LIMIT 1) td ON true ${NOAP}`,
  soft: null,
  number: 't.doc_no',
  status: 't.status',
  search: ['t.doc_no', 't.irn', 'td.party_gstin', 't.ack_no'],
  order: 't.doc_date DESC, t.doc_no DESC',
  metric: { label: 'Taxable Value', e: 'td.taxable' },
  calendar: 't.doc_date',
  cols: {
    'Invoice No': t('t.doc_no'),
    'Customer GSTIN': t('td.party_gstin'),
    'Invoice Date': d('t.doc_date'),
    'Taxable Value': m('td.taxable'),
    GST: m('td.gst'),
    IRN: t('t.irn'),
    'Ack No': t('t.ack_no'),
    'Ack Date': d('t.ack_date'),
    'QR Status': t(`CASE WHEN t.signed_qr IS NOT NULL AND t.signed_qr<>'' THEN 'QR available' ELSE 'No QR' END`),
    'Cancellation Status': t(`CASE WHEN t.status='Cancelled' THEN 'Cancelled on ' || to_char(t.cancelled_at,'DD-MM-YYYY') ELSE 'Not cancelled' END`),
    Error: none(),
    Status: pill('t.status'),
    Docs: DOCS('tax-einvoice'),
    Actions: ACTIONS,
    ...approvalCols('t.doc_no'),
  },
  register: ['Invoice No', 'Customer GSTIN', 'Invoice Date', 'Taxable Value', 'GST', 'IRN', 'Ack No', 'Ack Date', 'QR Status', 'Cancellation Status', 'Error', 'Status', 'Docs', 'Actions'],
  compact: EI_LABELS,
  views: [
    view(/^e invoice queue$/i, ['Invoice No', 'Customer GSTIN', 'Invoice Date', 'Taxable Value', 'GST', 'IRN', 'Ack No', 'Ack Date', 'QR Status', 'Cancellation Status', 'Error', 'Status', 'Docs', 'Actions']),
    view(/^irn generation$/i, EI_LABELS, { where: [`t.status='Generated'`] }),
    view(/^qr code$/i, EI_LABELS, { where: [`t.signed_qr IS NOT NULL`] }),
    view(/^cancellation$/i, EI_LABELS, { where: [`t.status='Cancelled'`], order: 't.cancelled_at DESC' }),
    view(/^error queue$/i, EI_LABELS, {
      where: [`(t.late_reported OR t.irn IS NULL OR t.irn='')`],
      panel: exceptionPanel('Invoices waiting for an IRN', [
        exc('IRN not generated', 'td.doc_no', 'High', `current_date - td.doc_date`, `'Tax invoice of an e-invoice GSTIN has no IRN'`,
          `FROM tax_documents td WHERE td.direction='OUTWARD' AND td.doc_kind='INV' AND td.status='Active' AND COALESCE(td.party_gstin,'')<>'' AND EXISTS (SELECT 1 FROM gst_registrations gr WHERE gr.gstin=td.gstin AND gr.einvoice_enabled AND gr.deleted_at IS NULL) AND NOT EXISTS (SELECT 1 FROM einvoice_records e WHERE e.doc_id=td.source_id AND e.status='Generated') AND {SCOPE:td:nosoft}`),
        exc('IRN reported late', 'e.doc_no', 'Medium', `current_date - e.doc_date`, `'IRN was generated after the reporting window'`,
          `FROM einvoice_records e WHERE e.late_reported AND {SCOPE:e:nosoft}`),
      ]),
    }),
    view(/^irp reconciliation$/i, EI_LABELS, {
      panel: ledgerPanel('GST output ledger', [`pa.sub_type='GSTOutput'`]),
      kpis: [
        { label: 'Invoices with an IRN', e: `count(*) FILTER (WHERE t.status='Generated')`, type: 'num' },
        { label: 'Tax on IRN invoices', e: `COALESCE(sum(td.gst) FILTER (WHERE t.status='Generated'),0)`, type: 'inr' },
      ],
    }),
  ],
};

const EW_LABELS = ['EWB No', 'Document No', 'Document Date', 'From GSTIN', 'To GSTIN', 'Transporter', 'Vehicle', 'Status', 'Actions'];
const EW_VALID = ['EWB No', 'Document No', 'Document Date', 'From GSTIN', 'To GSTIN', 'Transporter', 'Vehicle', 'Valid Until', 'Distance (km)', 'Status', 'Actions'];
const EWAY: PageDef = {
  from: `eway_bills t LEFT JOIN sales_invoices si ON si.id=t.invoice_id LEFT JOIN customers cu ON cu.id=si.customer_id LEFT JOIN units un ON un.id=t.unit_id ${NOAP}`,
  soft: null,
  number: 't.ewb_no',
  status: `CASE WHEN t.status='Active' AND t.valid_until < now() THEN 'Expired' ELSE t.status END`,
  search: ['t.ewb_no', 'si.number', 't.vehicle_no', 't.transporter', 'cu.gstin'],
  order: 't.ewb_date DESC, t.ewb_no DESC',
  metric: { label: 'Distance (km)', e: 't.distance_km' },
  calendar: 't.valid_until',
  cols: {
    'EWB No': t('t.ewb_no'),
    'Document No': t('si.number'),
    'Document Date': d('si.invoice_date'),
    'From GSTIN': t('un.gstin'),
    'To GSTIN': t('cu.gstin'),
    Transporter: t('t.transporter'),
    Vehicle: t('t.vehicle_no'),
    'Valid Until': d('t.valid_until'),
    'Distance (km)': n('t.distance_km'),
    Extensions: n('t.extensions'),
    Status: pill(`CASE WHEN t.status='Active' AND t.valid_until < now() THEN 'Expired' ELSE t.status END`),
    Docs: DOCS('tax-eway'),
    Actions: ACTIONS,
    ...approvalCols('t.ewb_no'),
  },
  register: EW_LABELS,
  compact: EW_LABELS,
  views: [
    view(/^e way bill queue$/i, EW_LABELS),
    view(/^part a details$/i, EW_LABELS),
    view(/^vehicle part b$/i, EW_LABELS, { where: [`t.status='Active'`], order: 't.vehicle_no NULLS FIRST, t.ewb_date DESC' }),
    view(/^validity (&|and) distance$/i, EW_VALID, { order: 't.valid_until ASC NULLS LAST' }),
    view(/^extension cancellation$/i, [...EW_LABELS.slice(0, 7), 'Extensions', 'Status', 'Actions'], {
      where: [`(t.status='Cancelled' OR t.extensions > 0)`],
    }),
    view(/^ewb exceptions$/i, EW_VALID, {
      where: [`t.status='Active' AND (t.valid_until < now() + interval '1 day' OR t.vehicle_no IS NULL OR t.vehicle_no='')`],
      order: 't.valid_until ASC NULLS LAST',
    }),
  ],
};

// ================================================================================================ GST configuration / HSN masters
const GST_LABELS = ['GSTIN', 'Legal Name', 'State', 'Registration Type', 'Effective Date', 'Default Tax Scheme', 'E Invoice Enabled', 'Status', 'Actions'];
const GST: PageDef = {
  from: `gst_registrations t LEFT JOIN gst_states gs ON gs.code=t.state_code ${NOAP}`,
  number: 't.gstin',
  status: 't.status',
  search: ['t.gstin', 't.legal_name', 'gs.name'],
  order: 't.gstin',
  cols: {
    GSTIN: t('t.gstin'),
    'Default Tax Scheme': none(),
    'Legal Name': t('t.legal_name'),
    State: t(`gs.name`),
    'Registration Type': t('t.registration_type'),
    'Effective Date': d('t.effective_from'),
    'E Invoice Enabled': t(`CASE WHEN t.einvoice_enabled THEN 'Yes' ELSE 'No' END`),
    Status: pill('t.status'),
    Actions: ACTIONS,
    ...approvalCols('t.gstin'),
  },
  register: ['GSTIN', 'Default Tax Scheme', 'Legal Name', 'State', 'Registration Type', 'Effective Date', 'E Invoice Enabled', 'Status', 'Actions'],
  compact: GST_LABELS,
  views: [
    view(/^gst configuration$/i, ['GSTIN', 'Default Tax Scheme', 'Legal Name', 'State', 'Registration Type', 'Effective Date', 'E Invoice Enabled', 'Status', 'Actions']),
    view(/^gstin registrations$/i, ['GSTIN', 'Default Tax Scheme', 'Legal Name', 'State', 'Registration Type', 'Effective Date', 'E Invoice Enabled', 'Status', 'Actions']),
    view(/^tax rates$/i, ['GSTIN', 'Default Tax Scheme', 'Legal Name', 'State', 'Registration Type', 'Effective Date', 'E Invoice Enabled', 'Status', 'Actions'], {
      panel: {
        title: 'GST rates',
        from: 'gst_rates p',
        unit: null,
        soft: 'p.deleted_at',
        order: 'p.igst_pct, p.code',
        cols: [
          ['Code', 'p.code', 'text'],
          ['Name', 'p.name', 'text'],
          ['IGST %', 'p.igst_pct', 'num'],
          ['CGST %', 'p.cgst_pct', 'num'],
          ['SGST %', 'p.sgst_pct', 'num'],
          ['Effective From', 'p.effective_from', 'date'],
        ],
      },
    }),
    view(/^place of supply$/i, GST_LABELS),
    view(/^reverse charge$/i, GST_LABELS, {
      kpis: [{ label: 'Documents on reverse charge', e: `(SELECT count(*) FROM tax_documents x WHERE x.reverse_charge AND x.status='Active')`, type: 'num' }],
    }),
    view(/^gst validation$/i, ['GSTIN', 'Default Tax Scheme', 'Legal Name', 'State', 'Registration Type', 'Effective Date', 'E Invoice Enabled', 'Status', 'Actions']),
  ],
};

const HSN_RATE = `LEFT JOIN LATERAL (SELECT gr.igst_pct, hr.cess_pct FROM hsn_sac_rates hr JOIN gst_rates gr ON gr.id=hr.gst_rate_id WHERE hr.hsn_id=t.id ORDER BY hr.effective_from DESC LIMIT 1) hr ON true`;
const HSN_LABELS = ['HSN SAC', 'Description', 'Goods Service', 'GST Rate', 'Cess Rate', 'UQC', 'Effective From', 'Status', 'Actions'];
const mapPanel = (): PanelDef => ({
  title: 'Rate mapping fields',
  from: `(VALUES (1,'HSN SAC','hsn_sac_codes.code','Trimmed, digits or SAC','Yes',(SELECT code FROM hsn_sac_codes WHERE deleted_at IS NULL ORDER BY code LIMIT 1)),
    (2,'Description','hsn_sac_codes.description','None','Yes',(SELECT left(description,40) FROM hsn_sac_codes WHERE deleted_at IS NULL ORDER BY code LIMIT 1)),
    (3,'GST Rate','hsn_sac_rates.gst_rate_id','Looked up in GST rates by percentage','Yes',(SELECT code FROM gst_rates WHERE deleted_at IS NULL ORDER BY igst_pct LIMIT 1)),
    (4,'Cess Rate','hsn_sac_rates.cess_pct','None','No',(SELECT cess_pct::text FROM hsn_sac_rates ORDER BY effective_from DESC LIMIT 1))) AS p(ord, src, dst, tr, req, smp)`,
  unit: null,
  soft: null,
  order: 'p.ord',
  cols: [
    ['Source Field', 'p.src', 'text'],
    ['Target Field', 'p.dst', 'text'],
    ['Transformation', 'p.tr', 'text'],
    ['Required', 'p.req', 'text'],
    ['Sample', 'p.smp::text', 'text'],
  ],
});
const HSN_RULES = (): PanelDef =>
  validationPanel('HSN and SAC checks', [
    ['Every code has a GST rate', `SELECT count(*) FROM hsn_sac_codes h WHERE h.deleted_at IS NULL AND EXISTS (SELECT 1 FROM hsn_sac_rates r WHERE r.hsn_id=h.id)`, 'SELECT 0', `SELECT count(*) FROM hsn_sac_codes h WHERE h.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM hsn_sac_rates r WHERE r.hsn_id=h.id)`],
    ['Codes marked for review are cleared', `SELECT count(*) FROM hsn_sac_codes h WHERE h.deleted_at IS NULL AND NOT h.needs_review`, `SELECT count(*) FROM hsn_sac_codes h WHERE h.deleted_at IS NULL AND h.needs_review`, 'SELECT 0'],
    ['HSN used on sales invoice lines exists in the master', `SELECT count(DISTINCT l.hsn_sac) FROM sales_invoice_lines l WHERE EXISTS (SELECT 1 FROM hsn_sac_codes h WHERE h.code=l.hsn_sac AND h.deleted_at IS NULL)`, 'SELECT 0', `SELECT count(DISTINCT l.hsn_sac) FROM sales_invoice_lines l WHERE l.hsn_sac IS NOT NULL AND NOT EXISTS (SELECT 1 FROM hsn_sac_codes h WHERE h.code=l.hsn_sac AND h.deleted_at IS NULL)`],
    ['HSN used on purchase invoice lines exists in the master', `SELECT count(DISTINCT l.hsn_sac) FROM purchase_invoice_lines l WHERE EXISTS (SELECT 1 FROM hsn_sac_codes h WHERE h.code=l.hsn_sac AND h.deleted_at IS NULL)`, 'SELECT 0', `SELECT count(DISTINCT l.hsn_sac) FROM purchase_invoice_lines l WHERE l.hsn_sac IS NOT NULL AND NOT EXISTS (SELECT 1 FROM hsn_sac_codes h WHERE h.code=l.hsn_sac AND h.deleted_at IS NULL)`],
  ]);
const HSN: PageDef = {
  from: `hsn_sac_codes t ${HSN_RATE} ${NOAP}`,
  unit: null,
  number: 't.code',
  status: 't.status',
  search: ['t.code', 't.description'],
  order: 't.code',
  cols: {
    'HSN SAC': t('t.code'),
    Description: t('t.description'),
    'Goods Service': t(`CASE WHEN t.is_service THEN 'Service' ELSE 'Goods' END`),
    'GST Rate': n('hr.igst_pct'),
    'Cess Rate': n('hr.cess_pct'),
    UQC: t('t.default_uqc'),
    'Effective From': d('t.created_at'),
    'Lines Using It': n(`(SELECT count(*) FROM sales_invoice_lines l WHERE l.hsn_sac=t.code) + (SELECT count(*) FROM purchase_invoice_lines l WHERE l.hsn_sac=t.code)`),
    Status: pill('t.status'),
    Actions: ACTIONS,
    ...approvalCols('t.code'),
  },
  register: HSN_LABELS,
  compact: HSN_LABELS,
  views: [
    view(/^hsn sac master$/i, HSN_LABELS),
    view(/^rate mapping$/i, HSN_LABELS, { panel: mapPanel() }),
    view(/^item service mapping$/i, HSN_LABELS),
    view(/^usage validation$/i, HSN_LABELS, { panel: HSN_RULES() }),
    view(/^hsn summary$/i, ['HSN SAC', 'Description', 'Goods Service', 'GST Rate', 'Cess Rate', 'UQC', 'Lines Using It', 'Status', 'Actions'], { order: `((SELECT count(*) FROM sales_invoice_lines l WHERE l.hsn_sac=t.code) + (SELECT count(*) FROM purchase_invoice_lines l WHERE l.hsn_sac=t.code)) DESC, t.code` }),
    view(/^compliance checks$/i, ['HSN SAC', 'GST Rate', 'Description', 'Goods Service', 'Cess Rate', 'UQC', 'Effective From', 'Status', 'Actions'], { panel: HSN_RULES() }),
  ],
};

export const TAX_V40_PAGES: Record<string, PageDef> = {
  'tax-salesreg': SALESREG,
  'tax-purchasereg': PURCHASEREG,
  'tax-gstr1': GSTR1,
  'tax-gstr3b': GSTR3B,
  'tax-tds': TDS,
  'tax-tcs': TCS,
  'tax-einvoice': EINVOICE,
  'tax-eway': EWAY,
  'tax-gst': GST,
  'tax-hsn': HSN,
};
