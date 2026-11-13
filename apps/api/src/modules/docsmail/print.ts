// Phase 27: one print service for every record. render(pageId, id, kind) builds ONE view-model (PrintDto) and the adapters
// produce PDF (pdfkit), Word (docx) or Excel (exceljs). Posted documents carry an "Original" / "Duplicate" copy label,
// drafts a DRAFT mark, and Word files an "Uncontrolled copy" footer.
import { controlService } from '../control/service';
import ExcelJS from 'exceljs';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { accessUserOf, can } from '../../core/rbac/access';
import { formatInr, rupeesInWords } from '../../core/pdf/amount-words';
import { renderDocumentPdf } from '../../core/pdf/template';
import type { PdfLetterhead } from '../../core/pdf/template';
import { typedSchema } from '../inventory/definitions';
import { getPrintDataBuilder } from '../../kit/print';
import type { PrintDto } from '../../kit/print';
import { letterheadFor, recordPdfService } from '../records/pdf';
import type { Caller } from '../records/service';
import { stripHtml } from './letters';
import { query } from '../procurement/core';
import type { Row } from '../procurement/core';

export type PrintKind = 'standard' | 'letterhead' | 'commercial' | 'word' | 'excel';
export const PRINT_KINDS: readonly PrintKind[] = ['standard', 'letterhead', 'commercial', 'word', 'excel'];

export interface CatalogDoc {
  pageId: string;
  title: string;
  group: string;
  table: string;
  numberCol: string;
  dateCol: string;
  statusCol: string;
  unitCol: string | null;
  lines?: { table: string; fk: string };
  totalCol?: string;
  partyCol?: string;
}

/** The ~25 business documents of the Document Center. Every one prints in 5 formats. */
export const CATALOG: readonly CatalogDoc[] = [
  { pageId: 'sales-quotations', title: 'Quotation', group: 'Sales', table: 'sales_quotations', numberCol: 'number', dateCol: 'quote_date', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'sales_quotation_lines', fk: 'quotation_id' }, totalCol: 'grand_total' },
  { pageId: 'sales-orders', title: 'Sales Order', group: 'Sales', table: 'sales_orders', numberCol: 'number', dateCol: 'order_date', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'sales_order_lines', fk: 'order_id' }, totalCol: 'grand_total' },
  { pageId: 'sales-dispatch', title: 'Delivery Challan', group: 'Sales', table: 'sales_dispatches', numberCol: 'number', dateCol: 'dispatch_date', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'sales_dispatch_lines', fk: 'dispatch_id' } },
  { pageId: 'sales-invoices', title: 'GST Tax Invoice', group: 'Sales', table: 'sales_invoices', numberCol: 'number', dateCol: 'invoice_date', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'sales_invoice_lines', fk: 'invoice_id' }, totalCol: 'grand_total' },
  { pageId: 'sales-collections', title: 'Payment Receipt', group: 'Sales', table: 'sales_receipts', numberCol: 'number', dateCol: 'receipt_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'sales-returns', title: 'Sales Return', group: 'Sales', table: 'sales_returns', numberCol: 'number', dateCol: 'return_date', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'sales_return_lines', fk: 'return_id' }, totalCol: 'grand_total' },
  { pageId: 'sales-enquiries', title: 'Sales Enquiry', group: 'Sales', table: 'sales_enquiries', numberCol: 'number', dateCol: 'enq_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'scm-pr', title: 'Purchase Requisition', group: 'Procurement', table: 'purchase_requisitions', numberCol: 'number', dateCol: 'required_date', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'purchase_requisition_lines', fk: 'pr_id' } },
  { pageId: 'scm-rfq', title: 'Request for Quotation', group: 'Procurement', table: 'rfqs', numberCol: 'number', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'rfq_lines', fk: 'rfq_id' } },
  { pageId: 'scm-po', title: 'Purchase Order', group: 'Procurement', table: 'purchase_orders', numberCol: 'number', dateCol: 'po_date', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'purchase_order_lines', fk: 'po_id' }, totalCol: 'grand_total' },
  { pageId: 'scm-grn', title: 'Goods Receipt Note', group: 'Procurement', table: 'goods_receipts', numberCol: 'number', dateCol: 'receipt_date', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'goods_receipt_lines', fk: 'grn_id' }, totalCol: 'total_value' },
  { pageId: 'scm-purchaseinvoice', title: 'Purchase Invoice', group: 'Procurement', table: 'purchase_invoices', numberCol: 'number', dateCol: 'invoice_date', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'purchase_invoice_lines', fk: 'invoice_id' }, totalCol: 'grand_total' },
  { pageId: 'mfg-orders', title: 'Production Order', group: 'Manufacturing', table: 'mfg_orders', numberCol: 'number', dateCol: 'start_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'qms-inspections', title: 'Inspection Report', group: 'Quality', table: 'qms_inspections', numberCol: 'number', dateCol: 'doc_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'quality-certificate', title: 'Quality Certificate', group: 'Quality', table: 'quality_certificates', numberCol: 'number', dateCol: 'inspection_date', statusCol: 'quality_approval', unitCol: 'unit_id' },
  { pageId: 'inv-adjustment', title: 'Stock Voucher', group: 'Inventory', table: 'stock_vouchers', numberCol: 'number', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'stock_voucher_lines', fk: 'voucher_id' } },
  { pageId: 'gate-out', title: 'Gate Pass', group: 'Logistics', table: 'gate_passes', numberCol: 'pass_no', dateCol: 'entry_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'log-shipments', title: 'Shipment', group: 'Logistics', table: 'shipments', numberCol: 'shipment_no', dateCol: 'planned_dispatch_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'service-tickets', title: 'Service Ticket', group: 'Service', table: 'service_tickets', numberCol: 'ticket_no', dateCol: 'created_at', statusCol: 'status', unitCol: null },
  { pageId: 'proj-projects', title: 'Project', group: 'Projects', table: 'projects', numberCol: 'code', dateCol: 'start_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'ops-visitors', title: 'Visitor Pass', group: 'Logistics', table: 'visitor_passes', numberCol: 'pass_no', dateCol: 'visit_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'hr-offer-letter', title: 'Letters (offer / appointment)', group: 'HR', table: 'issued_letters', numberCol: 'number', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id' },
];

const HIDE = /(^id$|_id$|^version$|^deleted_at$|^created_at$|^updated_at$|^fy_id$|^password|^json|_json$|^body_html$)/;

function catalogOf(pageId: string): CatalogDoc | undefined {
  return CATALOG.find((c) => c.pageId === pageId);
}

const fmtDate = (v: unknown): string => {
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
};
const pretty = (k: string): string => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function cell(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return fmtDate(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** The print model of a record of the catalog, built from its table row and its lines (every record prints). */
async function rowDto(caller: Caller, doc: CatalogDoc, id: string): Promise<PrintDto> {
  const rows = await query(prisma, `SELECT t.* FROM ${doc.table} t WHERE t.id = $1::uuid`, id);
  const r = rows[0];
  if (!r) throw Errors.notFound('Record not found.');
  if (doc.unitCol && r[doc.unitCol] && !caller.ctx.unitIds.includes(String(r[doc.unitCol]))) throw Errors.notFound('Record not found.');
  const unitId = doc.unitCol ? String(r[doc.unitCol] ?? '') : '';
  const unit = unitId ? await prisma.unit.findUnique({ where: { id: unitId } }) : null;
  const facts = Object.entries(r)
    .filter(([k, v]) => !HIDE.test(k) && k !== doc.numberCol && v !== null && v !== '' && (typeof v !== 'object' || v instanceof Date))
    .map(([k, v]) => ({ label: pretty(k), value: cell(v) }));
  let lines: PrintDto['lines'] = null;
  if (doc.lines) {
    const ls = await query(prisma, `SELECT l.*, i.name AS item_name FROM ${doc.lines.table} l LEFT JOIN items i ON i.id = l.item_id WHERE l.${doc.lines.fk} = $1::uuid ORDER BY l.created_at NULLS LAST, l.id`, id).catch(
      () => query(prisma, `SELECT l.* FROM ${doc.lines!.table} l WHERE l.${doc.lines!.fk} = $1::uuid`, id),
    );
    if (ls.length > 0) {
      const keys = Object.keys(ls[0]!).filter((k) => !HIDE.test(k) || k === 'item_name');
      lines = {
        columns: keys.map((k) => ({ key: k, label: pretty(k === 'item_name' ? 'item' : k), format: 'text', align: ls.some((x) => typeof x[k] === 'number' || /^-?\d+(\.\d+)?$/.test(String(x[k] ?? ''))) ? ('right' as const) : ('left' as const) })),
        rows: ls.map((x) => Object.fromEntries(keys.map((k) => [k, x[k] instanceof Date ? fmtDate(x[k]) : (x[k] as string | number | null) ?? null]))) as never,
      };
    }
  }
  const total = doc.totalCol && r[doc.totalCol] !== null && r[doc.totalCol] !== undefined ? Number(r[doc.totalCol]) : null;
  const created = r.created_by_id ? (await query(prisma, `SELECT name FROM users WHERE id = $1::uuid`, r.created_by_id))[0] : null;
  return {
    templateKey: 'row',
    title: doc.title,
    docNo: String(r[doc.numberCol] ?? id),
    docDate: fmtDate(r[doc.dateCol] ?? new Date()),
    unit: { code: unit?.code ?? '-', name: unit?.name ?? '-', ...(unit?.gstin ? { gstin: unit.gstin } : {}), ...(unit?.address ? { address: [unit.address, unit.city].filter(Boolean).join(', ') } : {}) },
    letterhead: {},
    parties: [],
    facts: [{ label: 'Status', value: String(r[doc.statusCol] ?? '') }, ...facts],
    lines,
    sections: [],
    totals: total !== null ? [{ label: 'Total', value: formatInr(total), bold: true }] : [],
    ...(total !== null ? { amountInWords: rupeesInWords(total) } : {}),
    signatures: [{ label: 'Prepared by', ...(created?.name ? { name: String(created.name) } : {}) }, { label: 'Checked by' }, { label: 'Approved by' }],
  };
}

const POSTED = /^(posted|approved|issued|released|closed|accepted|active|pass)$/i;

/** Builds the model once: typed print builder first, then the generic record, then the table row of the catalog. */
export async function buildPrintDto(caller: Caller, pageId: string, id: string): Promise<{ dto: PrintDto; status: string }> {
  const user = accessUserOf(caller.auth.user);
  if (!(await can(user, pageId, 'view'))) throw Errors.forbidden();
  if (pageId === 'hr-offer-letter') {
    const l = (await query(prisma, `SELECT * FROM issued_letters WHERE id = $1::uuid`, id))[0];
    if (!l || !caller.ctx.unitIds.includes(String(l.unit_id))) throw Errors.notFound('Letter not found.');
    const unit = await prisma.unit.findUnique({ where: { id: String(l.unit_id) } });
    const dto: PrintDto = {
      templateKey: 'letter', title: String(l.template_code) === 'OFFER' ? 'Offer Letter' : 'Appointment Letter', docNo: String(l.number), docDate: fmtDate(l.created_at),
      unit: { code: unit?.code ?? '-', name: unit?.name ?? '-', ...(unit?.gstin ? { gstin: unit.gstin } : {}) }, letterhead: {}, parties: [{ role: 'To', name: String(l.person_name) }],
      facts: [{ label: 'Status', value: String(l.status) }], lines: null, sections: [{ title: '', text: stripHtml(String(l.body_html)) }], totals: [], signatures: [{ label: 'Authorised signatory' }],
    };
    return { dto, status: String(l.status) };
  }
  const doc = catalogOf(pageId);
  if (doc) {
    const dto = await rowDto(caller, doc, id);
    return { dto, status: dto.facts.find((f) => f.label === 'Status')?.value ?? '' };
  }
  const key = typedSchema(pageId)?.printTemplates?.find((t) => t.kind === 'web')?.key;
  const builder = key ? getPrintDataBuilder(pageId, key) : undefined;
  if (builder) {
    const dto = await builder({ db: prisma, caller, pageId, id });
    return { dto, status: dto.facts.find((f) => f.label === 'Status')?.value ?? '' };
  }
  const dto = await recordPdfService.recordPrintDto(caller, pageId, id);
  return { dto, status: dto.facts.find((f) => f.label === 'Status')?.value ?? '' };
}

/** "Original" the first time a posted document is printed, "Duplicate" after that; a draft is marked DRAFT. */
async function copyLabel(id: string, status: string, requested?: string): Promise<string> {
  if (!POSTED.test(status)) return 'DRAFT';
  if (requested === 'original') return 'Original';
  if (requested === 'duplicate') return 'Duplicate';
  const n = Number((await query(prisma, `SELECT count(*)::int AS n FROM audit_logs WHERE action = 'PRINT_RENDERED' AND target_id = $1 AND detail->>'copy' IN ('Original','Duplicate')`, id).catch(() => [{ n: 0 }]))[0]?.n ?? 0);
  return n > 0 ? 'Duplicate' : 'Original';
}

// ------------------------------------------------------------------------------------------ adapters
export async function wordOf(dto: PrintDto, copy: string): Promise<Buffer> {
  // docx 8 is an ES module: it is loaded with a dynamic import() from this CommonJS build.
  // The package ships ES-module typings that this CommonJS build cannot resolve, so the module is used untyped.
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
  const { AlignmentType, Document, Footer, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } = (await import('docx')) as any;
  const cellP = (text: string, bold = false) =>
    new TableCell({ width: { size: 25, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text, bold, size: 18 })] })] });
  const kids: any[] = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, children: [new TextRun({ text: dto.title, bold: true })] }),
    new Paragraph({ children: [new TextRun({ text: `${dto.docNo}  ·  ${dto.docDate}  ·  ${dto.unit.name} (${dto.unit.code})  ·  ${copy}`, size: 20 })] }),
  ];
  for (const p of dto.parties) kids.push(new Paragraph({ children: [new TextRun({ text: `${p.role}: `, bold: true }), new TextRun(`${p.name}${p.gstin ? `  GSTIN ${p.gstin}` : ''}${p.address ? `  ${p.address}` : ''}`)] }));
  if (dto.facts.length > 0) {
    kids.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Details')] }));
    kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: dto.facts.map((f) => new TableRow({ children: [cellP(f.label, true), cellP(f.value)] })) }));
  }
  if (dto.lines && dto.lines.rows.length > 0) {
    kids.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Lines')] }));
    kids.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ tableHeader: true, children: dto.lines.columns.map((c) => cellP(c.label, true)) }),
          ...dto.lines.rows.map((r) => new TableRow({ children: dto.lines!.columns.map((c) => cellP(r[c.key] === null || r[c.key] === undefined ? '' : String(r[c.key]))) })),
        ],
      }),
    );
  }
  for (const s of dto.sections) {
    kids.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(s.title)] }));
    if (s.text) kids.push(new Paragraph(s.text));
    for (const r of s.rows ?? []) kids.push(new Paragraph({ children: [new TextRun({ text: `${r.label}: `, bold: true }), new TextRun(r.value)] }));
  }
  for (const t of dto.totals) kids.push(new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${t.label}: ${t.value}`, bold: t.bold === true })] }));
  if (dto.amountInWords) kids.push(new Paragraph({ children: [new TextRun({ text: dto.amountInWords, italics: true })] }));
  if (dto.notes) kids.push(new Paragraph(dto.notes));
  kids.push(new Paragraph({ spacing: { before: 600 }, children: [new TextRun(dto.signatures.map((s) => `${s.label}: ${s.name ?? '________________'}`).join('        '))] }));
  const doc = new Document({
    creator: 'ERP',
    title: dto.title,
    sections: [{ children: kids, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Uncontrolled copy', italics: true, size: 16 })] })] }) } }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
}

export async function excelOf(dto: PrintDto, copy: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const head = wb.addWorksheet('Header');
  head.columns = [{ header: 'Field', key: 'k', width: 28 }, { header: 'Value', key: 'v', width: 60 }];
  head.addRows([
    { k: 'Document', v: dto.title }, { k: 'Number', v: dto.docNo }, { k: 'Date', v: dto.docDate }, { k: 'Plant', v: `${dto.unit.name} (${dto.unit.code})` }, { k: 'Copy', v: copy },
    ...dto.parties.map((p) => ({ k: p.role, v: p.name })),
    ...dto.facts.map((f) => ({ k: f.label, v: f.value })),
    ...dto.totals.map((t) => ({ k: t.label, v: t.value })),
  ]);
  head.getRow(1).font = { bold: true };
  const ls = wb.addWorksheet('Lines');
  if (dto.lines && dto.lines.rows.length > 0) {
    ls.columns = dto.lines.columns.map((c) => ({ header: c.label, key: c.key, width: 18 }));
    for (const r of dto.lines.rows) ls.addRow(r);
  } else {
    ls.addRow(['This document has no lines.']);
  }
  ls.getRow(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function renderPrint(caller: Caller, pageId: string, id: string, kind: PrintKind, copyParam?: string): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
  const { dto, status } = await buildPrintDto(caller, pageId, id);
  // Phase 31: the custom fields switched on for PDF / Excel
  dto.facts = [...dto.facts, ...(await controlService.printFacts(pageId, id, kind === 'excel' ? 'excel' : 'pdf'))];
  const copy = await copyLabel(id, status, copyParam);
  const labelled: PrintDto = { ...dto, title: copy === 'DRAFT' ? `DRAFT - ${dto.title}` : `${dto.title} (${copy})` };
  const base = `${dto.title.replace(/[^A-Za-z0-9]+/g, '-')}-${dto.docNo.replace(/[^A-Za-z0-9]+/g, '-')}`;
  let buffer: Buffer;
  let contentType: string;
  let ext: string;
  if (kind === 'word') {
    buffer = await wordOf(dto, copy);
    contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    ext = 'docx';
  } else if (kind === 'excel') {
    buffer = await excelOf(dto, copy);
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    ext = 'xlsx';
  } else {
    const { lh, logo } = await letterheadFor();
    // STANDARD: plain header; LETTERHEAD / COMMERCIAL: the plant letterhead with GSTIN and PAN
    const header: PdfLetterhead = kind === 'standard' ? { ...lh, address: null, phone: null, email: null, showGstin: false, showPan: false } : lh;
    buffer = await renderDocumentPdf(labelled, header, { logo: kind === 'standard' ? null : logo });
    contentType = 'application/pdf';
    ext = 'pdf';
  }
  await recordAudit({ action: 'PRINT_RENDERED', actorId: caller.auth.userId, targetType: 'record', targetId: id, meta: caller.meta, detail: { pageId, kind, copy } });
  return { buffer, contentType, filename: `${base}.${ext}` };
}

export interface CatalogEntry { pageId: string; title: string; group: string; count: number }

export async function catalogCounts(caller: Caller): Promise<CatalogEntry[]> {
  const out: CatalogEntry[] = [];
  for (const d of CATALOG) {
    const where = d.unitCol ? `WHERE ${d.unitCol} = ANY($1::uuid[])` : '';
    const n = await query(prisma, `SELECT count(*)::int AS n FROM ${d.table} ${where}`, ...(d.unitCol ? [caller.ctx.unitIds] : [])).catch(() => [{ n: 0 }]);
    out.push({ pageId: d.pageId, title: d.title, group: d.group, count: Number(n[0]?.n ?? 0) });
  }
  return out;
}

export async function catalogRecords(caller: Caller, pageId: string, q: string): Promise<Row[]> {
  const d = catalogOf(pageId);
  if (!d) throw Errors.notFound('Unknown document type.');
  const user = accessUserOf(caller.auth.user);
  if (!(await can(user, pageId, 'view'))) throw Errors.forbidden();
  const unit = d.unitCol ? `AND ${d.unitCol} = ANY($1::uuid[])` : 'AND $1::uuid[] IS NOT NULL';
  return query(prisma, `SELECT id, ${d.numberCol}::text AS number, ${d.statusCol}::text AS status, ${d.dateCol} AS date FROM ${d.table} WHERE ($2 = '' OR ${d.numberCol}::text ILIKE $3) ${unit} ORDER BY ${d.dateCol} DESC NULLS LAST LIMIT 30`, caller.ctx.unitIds, q, `%${q}%`);
}
