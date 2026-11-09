// Phase 13 print and export: the Excel file of each register and the PDF of an order (job card), a BOM, a routing and an MRP
// run. Everything printed is the server's own figure; text cells that start with = + - or @ are made harmless (safeCell).
import ExcelJS from 'exceljs';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { finishPdf, newPdf } from '../../core/pdf';
import { safeCell } from '../records/export';
import type { Caller } from '../records/service';
import { query } from '../procurement/core';
import type { Row } from '../procurement/core';
import { boardService } from './board-service';
import { S } from './master-service';
import { masterService } from './master-service';
import { mrpService } from './mrp-service';
import { orderService } from './order-service';
import { reportsService } from './reports-service';

type Kind = 'text' | 'qty' | 'money' | 'date';
interface Col {
  key: string;
  label: string;
  kind?: Kind;
}
interface Report {
  page: string;
  title: string;
  cols: Col[];
  load: (caller: Caller, q: Record<string, string | undefined>) => Promise<Row[]>;
}
const ALL = { page: 1, size: 5000 };

export const REPORTS: Record<string, Report> = {
  orders: {
    page: 'mfg-orders',
    title: 'Production orders',
    cols: [
      { key: 'number', label: 'Order' },
      { key: 'itemCode', label: 'Item code' },
      { key: 'itemName', label: 'Item' },
      { key: 'customerName', label: 'Customer' },
      { key: 'qty', label: 'Quantity', kind: 'qty' },
      { key: 'qtyCompleted', label: 'Made (good)', kind: 'qty' },
      { key: 'qtyScrapped', label: 'Scrapped', kind: 'qty' },
      { key: 'qtyReceived', label: 'In stock', kind: 'qty' },
      { key: 'dueDate', label: 'Due', kind: 'date' },
      { key: 'status', label: 'Status' },
    ],
    load: async (c, q) =>
      (
        await orderService.list(c, 'mfg-orders', {
          ...ALL,
          ...(q.status ? { status: q.status } : {}),
        })
      ).rows,
  },
  scrap: {
    page: 'mfg-scrap',
    title: 'Scrap register',
    cols: [
      { key: 'number', label: 'No.' },
      { key: 'scrapDate', label: 'Date', kind: 'date' },
      { key: 'orderNumber', label: 'Order' },
      { key: 'opName', label: 'Operation' },
      { key: 'itemCode', label: 'Item code' },
      { key: 'itemName', label: 'Item' },
      { key: 'qty', label: 'Quantity', kind: 'qty' },
      { key: 'reason', label: 'Reason' },
    ],
    load: async (c) => (await reportsService.listScrap(c, 'mfg-scrap', ALL)).rows,
  },
  rework: {
    page: 'mfg-rework',
    title: 'Rework register',
    cols: [
      { key: 'number', label: 'No.' },
      { key: 'reworkDate', label: 'Date', kind: 'date' },
      { key: 'orderNumber', label: 'Order' },
      { key: 'opName', label: 'Operation' },
      { key: 'itemName', label: 'Item' },
      { key: 'qty', label: 'Pieces', kind: 'qty' },
      { key: 'reason', label: 'Reason' },
      { key: 'qtyOk', label: 'Good again', kind: 'qty' },
      { key: 'qtyScrap', label: 'Scrap', kind: 'qty' },
      { key: 'minutes', label: 'Minutes', kind: 'qty' },
      { key: 'cost', label: 'Rework cost', kind: 'money' },
      { key: 'status', label: 'Status' },
    ],
    load: async (c) => (await reportsService.listRework(c, 'mfg-rework', ALL)).rows,
  },
  wip: {
    page: 'mfg-wip',
    title: 'Work in process',
    cols: [
      { key: 'number', label: 'Order' },
      { key: 'itemName', label: 'Item' },
      { key: 'qty', label: 'Quantity', kind: 'qty' },
      { key: 'qtyCompleted', label: 'Made', kind: 'qty' },
      { key: 'qtyScrapped', label: 'Scrapped', kind: 'qty' },
      { key: 'qtyRework', label: 'In rework', kind: 'qty' },
      { key: 'qtyReceived', label: 'In stock', kind: 'qty' },
      { key: 'currentOp', label: 'Now at' },
      { key: 'wipValue', label: 'WIP value', kind: 'money' },
      { key: 'status', label: 'Status' },
    ],
    load: async (c) => (await reportsService.wip(c, 'mfg-wip', ALL)).rows,
  },
  costing: {
    page: 'mfg-costing',
    title: 'Production costing',
    cols: [
      { key: 'number', label: 'Order' },
      { key: 'itemCode', label: 'Item code' },
      { key: 'itemName', label: 'Item' },
      { key: 'qtyCompleted', label: 'Good pieces', kind: 'qty' },
      { key: 'material', label: 'Material', kind: 'money' },
      { key: 'conversion', label: 'Conversion', kind: 'money' },
      { key: 'outside', label: 'Outside processing', kind: 'money' },
      { key: 'reworkCost', label: 'Of which rework', kind: 'money' },
      { key: 'total', label: 'Total', kind: 'money' },
      { key: 'unitCost', label: 'Cost per piece', kind: 'money' },
      { key: 'standardCost', label: 'Standard cost', kind: 'money' },
    ],
    load: async (c) => (await reportsService.costing(c, 'mfg-costing', ALL)).rows,
  },
  plan: {
    page: 'mfg-plan',
    title: 'Daily board',
    cols: [
      { key: 'planDate', label: 'Date', kind: 'date' },
      { key: 'customerPoNo', label: 'Customer PO' },
      { key: 'itemName', label: 'Item' },
      { key: 'deliveryDate', label: 'Delivery', kind: 'date' },
      { key: 'lineQty', label: 'Line qty', kind: 'qty' },
      { key: 'unit2Qty', label: 'Unit 2 qty', kind: 'qty' },
      { key: 'coatingQty', label: 'Coating qty', kind: 'qty' },
      { key: 'dispatchQty', label: 'Dispatch qty', kind: 'qty' },
      { key: 'ownerLine', label: 'Line owner' },
      { key: 'ownerUnit2', label: 'Unit 2 owner' },
      { key: 'ownerCoating', label: 'Coating owner' },
      { key: 'ownerDispatch', label: 'Dispatch owner' },
      { key: 'remark', label: 'Remark' },
    ],
    load: async (c, q) =>
      (
        await boardService.listPlan(c, 'mfg-plan', {
          ...ALL,
          ...(q.from ? { from: q.from } : {}),
          ...(q.to ? { to: q.to } : {}),
        })
      ).rows,
  },
  jobwork: {
    page: 'mfg-orders',
    title: 'Job work: customer PO lines',
    cols: [
      { key: 'customerName', label: 'Customer' },
      { key: 'customerPoNo', label: 'Customer PO' },
      { key: 'poLineNo', label: 'Line' },
      { key: 'part', label: 'Part' },
      { key: 'uom', label: 'Unit' },
      { key: 'poQty', label: 'PO qty', kind: 'qty' },
      { key: 'inwardQty', label: 'Received', kind: 'qty' },
      { key: 'outwardQty', label: 'Sent out', kind: 'qty' },
      { key: 'openQty', label: 'Open qty', kind: 'qty' },
      { key: 'heldQty', label: 'Held', kind: 'qty' },
      { key: 'status', label: 'Status' },
    ],
    load: async (c) => (await boardService.listJwLines(c, 'mfg-orders', ALL)).rows,
  },
  'challan-rework': {
    page: 'mfg-rework',
    title: 'Rework against customer challan',
    cols: [
      { key: 'customerName', label: 'Customer' },
      { key: 'challanNo', label: 'Challan no.' },
      { key: 'challanDate', label: 'Challan date', kind: 'date' },
      { key: 'part', label: 'Part' },
      { key: 'challanQty', label: 'Challan qty', kind: 'qty' },
      { key: 'doneQty', label: 'Reworked', kind: 'qty' },
      { key: 'balanceQty', label: 'Balance', kind: 'qty' },
    ],
    load: async (c) => (await boardService.listChallanRework(c, 'mfg-rework', ALL)).rows,
  },
  boms: {
    page: 'mfg-bom',
    title: 'Bills of materials',
    cols: [
      { key: 'number', label: 'No.' },
      { key: 'itemCode', label: 'Item code' },
      { key: 'itemName', label: 'Item' },
      { key: 'versionNo', label: 'Version' },
      { key: 'baseQty', label: 'Base qty', kind: 'qty' },
      { key: 'lineCount', label: 'Components' },
      { key: 'status', label: 'Status' },
    ],
    load: async (c) => (await masterService.listBoms(c, 'mfg-bom', ALL)).rows,
  },
  routings: {
    page: 'mfg-routing',
    title: 'Routings',
    cols: [
      { key: 'number', label: 'No.' },
      { key: 'itemCode', label: 'Item code' },
      { key: 'itemName', label: 'Item' },
      { key: 'versionNo', label: 'Version' },
      { key: 'opCount', label: 'Operations' },
      { key: 'status', label: 'Status' },
    ],
    load: async (c) => (await masterService.listRoutings(c, 'mfg-routing', ALL)).rows,
  },
};

const FORMAT: Record<Kind, string | undefined> = {
  text: undefined,
  qty: '#,##0.###',
  money: '"₹" #,##0.00',
  date: 'dd-mm-yyyy',
};

function cell(v: unknown, kind: Kind): ExcelJS.CellValue {
  if (v === null || v === undefined || v === '') return null;
  if (kind === 'date') {
    const d = v instanceof Date ? v : new Date(`${S(v).slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? safeCell(S(v)) : d;
  }
  if (kind === 'qty' || kind === 'money') {
    const n = Number(S(v));
    return Number.isNaN(n) ? safeCell(S(v)) : n;
  }
  return safeCell(S(v));
}

export async function reportWorkbook(rep: Report, rows: Row[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sawant Group ERP';
  const sheet = wb.addWorksheet(rep.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  sheet.columns = rep.cols.map((c): Partial<ExcelJS.Column> => {
    const fmt = FORMAT[c.kind ?? 'text'];
    return {
      header: c.label,
      key: c.key,
      width: Math.min(Math.max(c.label.length + 2, 12), 36),
      ...(fmt ? { style: { numFmt: fmt } } : {}),
    };
  });
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) {
    const values: Record<string, ExcelJS.CellValue> = {};
    for (const c of rep.cols) {
      const v = cell(r[c.key], c.kind ?? 'text');
      if (v !== null) values[c.key] = v;
    }
    sheet.addRow(values);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** The Excel file of one MRP run: its lines with the reason for each. */
export async function mrpWorkbook(caller: Caller, id: string): Promise<Buffer> {
  const run = await mrpService.get(caller, 'mfg-mrp', id);
  const rows = (run.lines as Row[]).map((l) => ({
    ...l,
    why: ((l.sources as Row[]) ?? [])
      .map((x) => `${S(x.type)} ${S(x.ref)}: ${S(x.qty)}`)
      .join('; '),
  }));
  return reportWorkbook(
    {
      page: 'mfg-mrp',
      title: `MRP ${S(run.number)}`,
      cols: [
        { key: 'level', label: 'Level', kind: 'qty' },
        { key: 'itemCode', label: 'Item code' },
        { key: 'itemName', label: 'Item' },
        { key: 'bucketStart', label: 'Week / period from', kind: 'date' },
        { key: 'action', label: 'Action' },
        { key: 'grossQty', label: 'Gross need', kind: 'qty' },
        { key: 'onHandQty', label: 'Stock at start', kind: 'qty' },
        { key: 'scheduledQty', label: 'Coming in', kind: 'qty' },
        { key: 'netQty', label: 'To arrange', kind: 'qty' },
        { key: 'needDate', label: 'Needed by', kind: 'date' },
        { key: 'why', label: 'Why' },
      ],
      load: () => Promise.resolve([]),
    },
    rows,
  );
}

// ------------------------------------------------------------------------------------------------ PDF
interface PdfCol {
  label: string;
  w: number;
  right?: boolean;
}
interface PdfDoc {
  title: string;
  subtitle?: string;
  head: [string, string][];
  sections: { heading: string; cols: PdfCol[]; rows: string[][] }[];
  signatures?: string[];
}

async function unitHead(caller: Caller): Promise<{ name: string; address: string }> {
  if (!caller.ctx.unitId) return { name: '', address: '' };
  const u = (
    await query(
      prisma,
      `SELECT name, address, gstin FROM units WHERE id=$1::uuid`,
      caller.ctx.unitId,
    )
  )[0];
  return {
    name: S(u?.name),
    address: `${S(u?.address)}${u?.gstin ? `   GSTIN ${S(u?.gstin)}` : ''}`.trim(),
  };
}

async function renderPdf(caller: Caller, d: PdfDoc): Promise<Buffer> {
  const unit = await unitHead(caller);
  const doc = newPdf({ title: d.title });
  doc
    .fontSize(15)
    .font('Sans-Bold')
    .text(unit.name || d.title, { align: 'center' });
  if (unit.address) doc.fontSize(9).font('Sans').text(unit.address, { align: 'center' });
  doc.moveDown().fontSize(13).font('Sans-Bold').text(d.title.toUpperCase(), { align: 'center' });
  if (d.subtitle) doc.fontSize(9).font('Sans').text(d.subtitle, { align: 'center' });
  doc.moveDown(0.5).fontSize(10).font('Sans');
  for (let i = 0; i < d.head.length; i += 2) {
    const a = d.head[i]!;
    const b = d.head[i + 1];
    doc.text(`${a[0]}: ${a[1]}${b ? `        ${b[0]}: ${b[1]}` : ''}`);
  }
  for (const sec of d.sections) {
    doc.moveDown(0.8).fontSize(11).font('Sans-Bold').text(sec.heading);
    doc.moveDown(0.2);
    const row = (cells: string[], bold = false) => {
      if (doc.y > doc.page.height - 90) doc.addPage();
      let x = 40;
      const y = doc.y;
      doc.font(bold ? 'Sans-Bold' : 'Sans').fontSize(9);
      cells.forEach((c, i) => {
        const col = sec.cols[i]!;
        doc.text(c, x, y, {
          width: col.w - 4,
          lineBreak: false,
          ellipsis: true,
          align: col.right ? 'right' : 'left',
        });
        x += col.w;
      });
      doc.y = y + 15;
      doc.x = 40;
    };
    row(
      sec.cols.map((c) => c.label),
      true,
    );
    doc.moveTo(40, doc.y).lineTo(535, doc.y).stroke();
    if (sec.rows.length === 0) row(['None']);
    for (const r of sec.rows) row(r);
  }
  if (d.signatures?.length) {
    doc.moveDown(3).fontSize(10).font('Sans');
    if (doc.y > doc.page.height - 90) doc.addPage();
    const y = doc.y;
    const w = 515 / d.signatures.length;
    d.signatures.forEach((t, i) =>
      doc.text(`${t}\n\n________________`, 40 + i * w, y, { width: w - 6 }),
    );
  }
  return finishPdf(doc);
}

const dmy = (v: unknown): string => {
  const x = v instanceof Date ? v.toISOString().slice(0, 10) : S(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(x) ? x.split('-').reverse().join('-') : '—';
};

/** The job card of a production order: what to make, the material to draw, the operations in order, and the sign-offs. */
export async function orderPdf(caller: Caller, id: string): Promise<Buffer> {
  const o = await orderService.get(caller, 'mfg-orders', id);
  return renderPdf(caller, {
    title: 'Production order',
    subtitle: S(o.status),
    head: [
      ['Order no', S(o.number)],
      ['Due', dmy(o.dueDate)],
      ['Item', `${S(o.itemCode)} ${S(o.itemName)}`],
      ['Quantity', `${S(o.qty)} ${S(o.uom)}`],
      ['Customer', S(o.customerName) || '—'],
      ['Customer PO', S(o.customerPoNo) || '—'],
    ],
    sections: [
      {
        heading: 'Material',
        cols: [
          { label: 'Item', w: 255 },
          { label: 'Needed', w: 80, right: true },
          { label: 'Issued', w: 80, right: true },
          { label: 'Returned', w: 80, right: true },
        ],
        rows: (o.materials as Row[]).map((m) => [
          `${S(m.itemCode)} ${S(m.itemName)}${m.customerSupplied === true ? ' (customer)' : ''}`,
          S(m.requiredQty),
          S(m.issuedQty),
          S(m.returnedQty),
        ]),
      },
      {
        heading: 'Operations',
        cols: [
          { label: 'No.', w: 35 },
          { label: 'Operation', w: 170 },
          { label: 'Work center', w: 80 },
          { label: 'Setup min', w: 60, right: true },
          { label: 'Run min/pc', w: 70, right: true },
          { label: 'Inspect', w: 100 },
        ],
        rows: (o.ops as Row[]).map((p) => [
          S(p.seq),
          S(p.name),
          S(p.workCentreCode),
          S(p.setupMinutes),
          S(p.runMinutes),
          p.inspectionRequired === true ? 'Inspection first' : '',
        ]),
      },
    ],
    signatures: ['Planned by', 'Issued by (store)', 'Production in-charge', 'Quality'],
  });
}

export async function bomPdf(caller: Caller, id: string): Promise<Buffer> {
  const b = await masterService.getBom(caller, 'mfg-bom', id);
  return renderPdf(caller, {
    title: 'Bill of materials',
    subtitle: S(b.status),
    head: [
      ['BOM no', `${S(b.number)} (version ${S(b.versionNo)})`],
      ['Base quantity', `${S(b.baseQty)} ${S(b.uom)}`],
      ['Item', `${S(b.itemCode)} ${S(b.itemName)}`],
      ['Notes', S(b.notes) || '—'],
    ],
    sections: [
      {
        heading: 'Components (per base quantity)',
        cols: [
          { label: 'No.', w: 35 },
          { label: 'Component', w: 270 },
          { label: 'Quantity', w: 90, right: true },
          { label: 'Scrap %', w: 100, right: true },
        ],
        rows: (b.lines as Row[]).map((l, i) => [
          String(i + 1),
          `${S(l.itemCode)} ${S(l.itemName)}${l.isCustomerSupplied === true ? ' (customer)' : ''}`,
          `${S(l.qtyPer)} ${S(l.uom)}`,
          S(l.scrapPct),
        ]),
      },
    ],
    signatures: ['Prepared by', 'Approved by'],
  });
}

export async function routingPdf(caller: Caller, id: string): Promise<Buffer> {
  const r = await masterService.getRouting(caller, 'mfg-routing', id);
  return renderPdf(caller, {
    title: 'Routing',
    subtitle: S(r.status),
    head: [
      ['Routing no', `${S(r.number)} (version ${S(r.versionNo)})`],
      ['Item', `${S(r.itemCode)} ${S(r.itemName)}`],
    ],
    sections: [
      {
        heading: 'Operations',
        cols: [
          { label: 'No.', w: 35 },
          { label: 'Operation', w: 190 },
          { label: 'Work center', w: 100 },
          { label: 'Setup min', w: 60, right: true },
          { label: 'Run min/pc', w: 70, right: true },
          { label: 'Inspect', w: 60 },
        ],
        rows: (r.ops as Row[]).map((p) => [
          S(p.seq),
          S(p.name),
          S(p.workCentreCode),
          S(p.setupMinutes),
          S(p.runMinutes),
          p.inspectionRequired === true ? 'Yes' : '',
        ]),
      },
    ],
    signatures: ['Prepared by', 'Approved by'],
  });
}

export async function mrpPdf(caller: Caller, id: string): Promise<Buffer> {
  const m = await mrpService.get(caller, 'mfg-mrp', id);
  return renderPdf(caller, {
    title: 'Material requirement plan',
    subtitle: S(m.status),
    head: [
      ['Run', S(m.number)],
      ['Range', `${dmy(m.fromDate)} to ${dmy(m.toDate)}`],
      ['Period', S(m.bucket)],
      ['Requisition', S(m.prNumber) || '—'],
    ],
    sections: [
      {
        heading: 'Proposal',
        cols: [
          { label: 'Item', w: 160 },
          { label: 'Period', w: 62 },
          { label: 'Action', w: 55 },
          { label: 'Gross', w: 56, right: true },
          { label: 'Stock', w: 56, right: true },
          { label: 'Coming', w: 56, right: true },
          { label: 'To arrange', w: 70, right: true },
        ],
        rows: (m.lines as Row[]).map((l) => [
          `${S(l.itemCode)} ${S(l.itemName)}`,
          dmy(l.bucketStart),
          S(l.action),
          S(l.grossQty),
          S(l.onHandQty),
          S(l.scheduledQty),
          S(l.netQty),
        ]),
      },
    ],
  });
}

export function assertReport(name: string): Report {
  const rep = REPORTS[name];
  if (!rep) throw Errors.notFound('Unknown report.');
  return rep;
}
