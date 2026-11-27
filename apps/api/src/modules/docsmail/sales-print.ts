// The printed / Word / Excel form of the Sales records. The generic row dump printed internal columns (our unit cost,
// cost value, warehouse counters), left out every quantity and amount held as a decimal, and showed codes such as
// SALES_ORDER. Each Sales document therefore names exactly what it shows.
import type { PrintDto } from '../../kit/print';
import { formatInr, groupIndian, rupeesInWords } from '../../core/pdf/amount-words';
import { prisma } from '../../core/db/prisma';
import { query } from '../procurement/core';
import type { Row } from '../procurement/core';

export interface SalesPrint {
  facts: { label: string; value: string }[];
  lines: PrintDto['lines'];
  totals: PrintDto['totals'];
  amountInWords?: string;
}

const text = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v as string | number).trim();
};
const filled = (v: unknown): boolean => v !== null && v !== undefined && String(v as string).trim() !== '';
/** 12.000 -> 12, 2.500 -> 2.5, grouped the Indian way */
const num = (v: unknown, places = 3): string => {
  if (!filled(v)) return '';
  const n = Number(text(v));
  if (Number.isNaN(n)) return text(v);
  const used = (n.toFixed(places).split('.')[1] ?? '').replace(/0+$/, '').length;
  return groupIndian(n, used);
};
/** whole rupees as "₹ 1,250", otherwise with the paise, so that the printed parts add up */
const rupees = (n: number): string => (Number.isInteger(Math.round(n * 100) / 100) ? formatInr(n) : `₹ ${groupIndian(n, 2)}`);
const money = (v: unknown): string => (filled(v) ? rupees(Number(text(v))) : '');
/** an amount in a table: whole rupees as "1,250", otherwise "9,172.80" */
const cellAmount = (v: unknown): string => {
  if (!filled(v)) return '';
  const n = Math.round(Number(text(v)) * 100) / 100;
  return groupIndian(n, Number.isInteger(n) ? 0 : 2);
};
/** SALES_ORDER -> Sales order, UNPAID -> Unpaid */
const words = (v: unknown): string => text(v).toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

type Fact = [label: string, value: unknown];
const facts = (list: Fact[]): { label: string; value: string }[] =>
  list.filter(([, v]) => filled(v)).map(([label, v]) => ({ label, value: text(v) }));

interface Col {
  key: string;
  label: string;
  /** share of the page width */
  weight: number;
  right?: boolean;
  /** a column that is left out when no line holds a value */
  optional?: boolean;
}
function table(cols: Col[], rows: Record<string, string>[]): PrintDto['lines'] {
  if (rows.length === 0) return null;
  const used = cols.filter((c) => !c.optional || rows.some((r) => r[c.key]));
  return {
    columns: used.map((c) => ({ key: c.key, label: c.label, format: 'text', align: c.right ? ('right' as const) : ('left' as const), weight: c.weight })),
    rows: rows.map((r) => Object.fromEntries(used.map((c) => [c.key, r[c.key] ?? '']))),
  };
}

const one = async (sql: string, ...args: unknown[]): Promise<Row | undefined> => (await query(prisma, sql, ...args))[0];
const nameOf = async (sql: string, id: unknown): Promise<string> => (filled(id) ? text((await one(sql, text(id)))?.label) : '');
const customerOf = (id: unknown) => nameOf('SELECT name AS label FROM customers WHERE id = $1::uuid', id);
const warehouseOf = (id: unknown) => nameOf("SELECT code || ' - ' || name AS label FROM warehouses WHERE id = $1::uuid", id);
const itemOf = (id: unknown) => nameOf("SELECT code || ' - ' || name AS label FROM items WHERE id = $1::uuid", id);
const termOf = (id: unknown) => nameOf("SELECT code || ' - ' || name AS label FROM payment_terms WHERE id = $1::uuid", id);
const projectOf = (id: unknown) => nameOf('SELECT code AS label FROM projects WHERE id = $1::uuid', id);
const userOf = (id: unknown) => nameOf('SELECT name AS label FROM users WHERE id = $1::uuid', id);

/** The taxable / GST / round-off / total block of a priced document. */
function taxTotals(r: Row, extra: [string, unknown][] = []): { totals: PrintDto['totals']; amountInWords?: string } {
  const part = (label: string, v: unknown) => (filled(v) && Number(text(v)) !== 0 ? [{ label, value: money(v) }] : []);
  const grand = Number(text(r.grand_total) || '0');
  return {
    totals: [
      { label: 'Taxable value', value: money(r.taxable ?? 0) },
      ...extra.flatMap(([label, v]) => part(label, v)),
      ...part('CGST', r.cgst),
      ...part('SGST', r.sgst),
      ...part('IGST', r.igst),
      ...part('Round off', r.round_off),
      { label: 'Total', value: rupees(grand), bold: true },
    ],
    amountInWords: rupeesInWords(grand),
  };
}

/** Lines of a priced document: what the customer is quoted or billed, never what it costs us. */
async function pricedLines(tableName: string, fk: string, id: string, extra: Col[] = [], gstSplit = false): Promise<PrintDto['lines']> {
  const ls = await query(
    prisma,
    `SELECT l.*, i.code AS item_code, i.name AS item_name FROM ${tableName} l LEFT JOIN items i ON i.id = l.item_id WHERE l.${fk} = $1::uuid ORDER BY l.line_no`,
    id,
  );
  return table(
    [
      { key: 'no', label: '#', weight: 3 },
      { key: 'item', label: 'Item', weight: gstSplit ? 15 : 20 },
      { key: 'hsn', label: 'HSN/SAC', weight: 8, optional: true },
      ...extra,
      { key: 'qty', label: 'Qty', weight: 7, right: true },
      { key: 'uom', label: 'Unit', weight: 5, optional: true },
      { key: 'rate', label: 'Rate', weight: 9, right: true },
      { key: 'disc', label: 'Disc %', weight: 6, right: true, optional: true },
      { key: 'gst', label: 'GST %', weight: 6, right: true },
      { key: 'taxable', label: 'Taxable', weight: 11, right: true },
      ...(gstSplit
        ? [
            { key: 'cgst', label: 'CGST', weight: 8, right: true, optional: true },
            { key: 'sgst', label: 'SGST', weight: 8, right: true, optional: true },
            { key: 'igst', label: 'IGST', weight: 9, right: true, optional: true },
          ]
        : []),
    ],
    ls.map((l) => {
      const tax = (v: unknown) => (filled(v) && Number(text(v)) !== 0 ? cellAmount(v) : '');
      const named = [text(l.item_code), text(l.item_name)].filter(Boolean).join(' - ');
      return {
        no: text(l.line_no),
        item: [named, text(l.description)].filter(Boolean).join(' · '),
        hsn: text(l.hsn_sac),
        part: text(l.part_no),
        colour: text(l.colour),
        due: text(l.delivery_date),
        qty: num(l.qty),
        uom: text(l.uom),
        rate: cellAmount(l.rate),
        disc: filled(l.discount_pct) && Number(text(l.discount_pct)) !== 0 ? num(l.discount_pct, 2) : '',
        gst: num(l.gst_pct, 2),
        taxable: cellAmount(l.taxable),
        cgst: tax(l.cgst),
        sgst: tax(l.sgst),
        igst: tax(l.igst),
      };
    }),
  );
}

type Builder = (r: Row, id: string, status: string) => Promise<SalesPrint>;
const noTotals = { totals: [] as PrintDto['totals'] };

const quotation: Builder = async (r, id, status) => ({
  facts: facts([
    ['Status', status],
    ['Customer', await customerOf(r.customer_id)],
    ['Customer reference / enquiry no.', r.customer_ref],
    ['Quotation date', r.quote_date],
    ['Valid until', r.valid_until],
    ['Delivery date', r.delivery_date],
    ['Customer PO no.', r.customer_po_no],
    ['Payment terms', await termOf(r.payment_term_id)],
    ['Revision', r.revision_no],
    ['Customer decision', filled(r.customer_status) && r.customer_status !== 'PENDING' ? words(r.customer_status) : ''],
    ['Quotation format', r.format_code],
    ['Project Number', await projectOf(r.project_id)],
    ['Notes', r.notes],
  ]),
  lines: await pricedLines('sales_quotation_lines', 'quotation_id', id),
  ...taxTotals(r),
});

const order: Builder = async (r, id, status) => ({
  facts: facts([
    ['Status', status],
    ['Customer', await customerOf(r.customer_id)],
    ['Customer PO no.', r.customer_po_no],
    ['Customer PO date', r.customer_po_date],
    ['Order date', r.order_date],
    ['Deliver by', r.delivery_date],
    ['Payment terms', await termOf(r.payment_term_id)],
    ['Quotation', await nameOf('SELECT number AS label FROM sales_quotations WHERE id = $1::uuid', r.quotation_id)],
    ['Ship to', r.ship_to],
    ['Project Number', await projectOf(r.project_id)],
    ['Notes', r.notes],
  ]),
  lines: await pricedLines('sales_order_lines', 'order_id', id, [
    { key: 'part', label: 'Part no.', weight: 8, optional: true },
    { key: 'colour', label: 'Colour', weight: 8, optional: true },
    { key: 'due', label: 'Delivery', weight: 10, optional: true },
  ]),
  ...taxTotals(r),
});

const invoice: Builder = async (r, id, status) => ({
  facts: facts([
    ['Status', status],
    ['Customer', await customerOf(r.customer_id)],
    ['Sales order', await nameOf('SELECT number AS label FROM sales_orders WHERE id = $1::uuid', r.order_id)],
    ['Delivery challan', await nameOf('SELECT number AS label FROM sales_dispatches WHERE id = $1::uuid', r.dispatch_id)],
    ['Invoice date', r.invoice_date],
    ['Due date', r.due_date],
    ['Place of supply (state code)', r.customer_state],
    ['Payment status', filled(r.receipt_status) ? words(r.receipt_status) : ''],
    ['Notes', r.notes],
  ]),
  lines: await pricedLines('sales_invoice_lines', 'invoice_id', id, [], true),
  ...taxTotals(r, [['Freight', r.freight]]),
});

const salesReturn: Builder = async (r, id, status) => ({
  facts: facts([
    ['Status', status],
    ['Customer', await customerOf(r.customer_id)],
    ['Invoice', await nameOf('SELECT number AS label FROM sales_invoices WHERE id = $1::uuid', r.invoice_id)],
    ['Received into', await warehouseOf(r.warehouse_id)],
    ['Return date', r.return_date],
    ['Reason', r.reason],
    ['Credit note no.', r.credit_note_no],
  ]),
  lines: await pricedLines('sales_return_lines', 'return_id', id, [], true),
  ...taxTotals(r),
});

const dispatch: Builder = async (r, id, status) => {
  const ls = await query(
    prisma,
    `SELECT l.*, i.code AS item_code, i.name AS item_name, ol.uom FROM sales_dispatch_lines l
       LEFT JOIN sales_order_lines ol ON ol.id = l.order_line_id LEFT JOIN items i ON i.id = COALESCE(l.item_id, ol.item_id)
      WHERE l.dispatch_id = $1::uuid ORDER BY l.line_no`,
    id,
  );
  return {
    facts: facts([
      ['Status', status],
      ['Customer', await customerOf(r.customer_id)],
      ['Sales order', await nameOf('SELECT number AS label FROM sales_orders WHERE id = $1::uuid', r.order_id)],
      ['Warehouse', await warehouseOf(r.warehouse_id)],
      ['Dispatch date', r.dispatch_date],
      ['Vehicle no.', r.vehicle_no],
      ['Transporter', r.transporter],
      ['LR no.', r.lr_no],
      ['Driver', r.driver],
      ['Weight (kg)', num(r.weight_kg)],
      ['Ship to', r.ship_to],
      ['Remark', r.remark],
    ]),
    lines: table(
      [
        { key: 'no', label: '#', weight: 4 },
        { key: 'item', label: 'Item', weight: 40 },
        { key: 'qty', label: 'Qty', weight: 10, right: true },
        { key: 'uom', label: 'Unit', weight: 8, optional: true },
        { key: 'batch', label: 'Batch', weight: 14, optional: true },
        { key: 'serial', label: 'Serial numbers', weight: 20, optional: true },
        { key: 'remark', label: 'Remark', weight: 16, optional: true },
      ],
      ls.map((l) => ({
        no: text(l.line_no),
        item: [text(l.item_code), text(l.item_name)].filter(Boolean).join(' - '),
        qty: num(l.qty),
        uom: text(l.uom),
        batch: text(l.batch_no),
        serial: Array.isArray(l.serial_nos) ? (l.serial_nos as string[]).join(', ') : '',
        remark: text(l.remark),
      })),
    ),
    ...noTotals,
  };
};

const enquiry: Builder = async (r, _id, status) => ({
  facts: facts([
    ['Status', status],
    ['Customer', (await customerOf(r.customer_id)) || r.prospect_name],
    ['Contact', r.contact],
    ['Enquiry date', r.enq_date],
    ['Item', await itemOf(r.item_id)],
    ['Product', r.product],
    ['Quantity', num(r.qty)],
    ['Application', r.application],
    ['Required date', r.required_date],
    ['Source', r.source],
    ['Owner', await userOf(r.assigned_to_id)],
    ['Price discussion', r.price_discussion],
    ['Next follow-up', r.next_follow_up],
    ['Quotation', await nameOf('SELECT number AS label FROM sales_quotations WHERE id = $1::uuid', r.quotation_id)],
    ['Project Number', await projectOf(r.project_id)],
    ['Remarks', r.remarks],
    ['Lost reason', r.lost_reason],
  ]),
  lines: null,
  ...noTotals,
});

const receipt: Builder = async (r, id, status) => {
  const ls = await query(
    prisma,
    `SELECT i.number, i.invoice_date, i.grand_total, a.amount FROM sales_receipt_allocations a JOIN sales_invoices i ON i.id = a.invoice_id WHERE a.receipt_id = $1::uuid ORDER BY i.invoice_date, i.number`,
    id,
  );
  const amount = Number(text(r.amount) || '0');
  const used = ls.reduce((n, l) => n + Number(text(l.amount) || '0'), 0);
  return {
    facts: facts([
      ['Status', status],
      ['Customer', await customerOf(r.customer_id)],
      ['Receipt date', r.receipt_date],
      ['Amount received', money(r.amount)],
      ['Payment mode', r.mode],
      ['Bank / cash reference', r.reference],
      ['Received in', await nameOf('SELECT name AS label FROM bank_accounts WHERE id = $1::uuid', r.bank_account_id)],
    ]),
    lines: table(
      [
        { key: 'invoice', label: 'Invoice', weight: 34 },
        { key: 'date', label: 'Invoice date', weight: 22 },
        { key: 'total', label: 'Invoice amount', weight: 22, right: true },
        { key: 'paid', label: 'Paid by this receipt', weight: 22, right: true },
      ],
      ls.map((l) => ({ invoice: text(l.number), date: text(l.invoice_date), total: cellAmount(l.grand_total), paid: cellAmount(l.amount) })),
    ),
    totals: [
      ...(amount - used > 0.004 && ls.length > 0 ? [{ label: 'Kept as advance', value: rupees(amount - used) }] : []),
      { label: 'Total', value: rupees(amount), bold: true },
    ],
    amountInWords: rupeesInWords(amount),
  };
};

const reservation: Builder = async (r, _id, status) => {
  const open = ['Waiting', 'Partial', 'Reserved'].includes(text(r.status));
  const short = open ? Math.max(Number(text(r.required_qty)) - Number(text(r.reserved_qty)) - Number(text(r.fulfilled_qty)), 0) : 0;
  const demandCustomer =
    r.demand_type === 'SALES_ORDER' && filled(r.demand_ref)
      ? text((await one('SELECT c.name AS label FROM sales_orders so JOIN customers c ON c.id = so.customer_id WHERE so.number = $1 OR so.id::text = $1 LIMIT 1', text(r.demand_ref)))?.label)
      : '';
  return {
    facts: facts([
      ['Status', status],
      ['Item', await itemOf(r.item_id)],
      ['Warehouse', await warehouseOf(r.warehouse_id)],
      ['Batch', await nameOf('SELECT batch_no AS label FROM batches WHERE id = $1::uuid', r.batch_id)],
      ['Required quantity', num(r.required_qty)],
      ['Reserved quantity', num(r.reserved_qty)],
      ['Issued quantity', num(r.fulfilled_qty)],
      ['Short quantity', num(short)],
      ['Demand', [filled(r.demand_type) ? words(r.demand_type) : '', text(r.demand_ref)].filter(Boolean).join(' · ')],
      ['Customer', demandCustomer],
      ['Priority', r.priority],
      ['Reserved until', r.reserved_until],
      ['Release reason', r.release_reason],
      ['Department', r.department],
    ]),
    lines: null,
    ...noTotals,
  };
};

const delivery: Builder = async (r, id, status) => {
  const ls = await query(
    prisma,
    `SELECT l.line_no, i.code, i.name, l.uom, l.qty, l.dispatched_qty, l.closed_qty, COALESCE(l.delivery_date, so.delivery_date) AS due
       FROM sales_order_lines l JOIN sales_orders so ON so.id = l.order_id LEFT JOIN items i ON i.id = l.item_id WHERE l.order_id = $1::uuid ORDER BY l.line_no`,
    id,
  );
  return {
    facts: facts([
      ['Status', status],
      ['Customer', await customerOf(r.customer_id)],
      ['Sales order', r.number],
      ['Customer PO no.', r.customer_po_no],
      ['Order date', r.order_date],
      ['Promise date', r.delivery_date],
      ['Ship to', r.ship_to],
    ]),
    lines: table(
      [
        { key: 'no', label: '#', weight: 4 },
        { key: 'item', label: 'Item', weight: 38 },
        { key: 'due', label: 'Promise date', weight: 14, optional: true },
        { key: 'qty', label: 'Ordered', weight: 11, right: true },
        { key: 'sent', label: 'Delivered', weight: 11, right: true },
        { key: 'left', label: 'Balance', weight: 11, right: true },
        { key: 'uom', label: 'Unit', weight: 8, optional: true },
      ],
      ls.map((l) => ({
        no: text(l.line_no),
        item: [text(l.code), text(l.name)].filter(Boolean).join(' - '),
        due: text(l.due),
        qty: num(l.qty),
        sent: num(l.dispatched_qty),
        left: num(Math.max(Number(text(l.qty)) - Number(text(l.dispatched_qty)) - Number(text(l.closed_qty)), 0)),
        uom: text(l.uom),
      })),
    ),
    ...noTotals,
  };
};

const credit: Builder = async (r, id, status) => {
  const m = await one(
    `SELECT (SELECT COALESCE(sum(o.outstanding),0) FROM open_items o WHERE o.party_type='CUSTOMER' AND o.party_id=$1::uuid AND o.status NOT IN ('Settled','Cancelled')) AS due,
            (SELECT COALESCE(sum(o.outstanding),0) FROM open_items o WHERE o.party_type='CUSTOMER' AND o.party_id=$1::uuid AND o.status NOT IN ('Settled','Cancelled') AND o.due_date < CURRENT_DATE) AS overdue,
            COALESCE((SELECT sum((l.qty - l.dispatched_qty - l.closed_qty) * l.rate * (1 - l.discount_pct/100)) FROM sales_order_lines l JOIN sales_orders so ON so.id=l.order_id
              WHERE so.customer_id=$1::uuid AND so.status='Approved' AND so.deleted_at IS NULL AND l.qty - l.dispatched_qty - l.closed_qty > 0),0) AS on_order`,
    id,
  );
  const notes = await one('SELECT risk_grade, review_date, project_id FROM customer_credit_profiles WHERE customer_id = $1::uuid', id);
  const used = Number(text(m?.due)) + Number(text(m?.on_order));
  const limit = filled(r.credit_limit) ? Number(text(r.credit_limit)) : null;
  return {
    facts: facts([
      ['Status', status],
      ['Customer', r.name],
      ['Customer code', r.code],
      ['GSTIN', r.gstin],
      ['Credit limit', limit === null ? 'No limit' : rupees(limit)],
      ['Used limit', rupees(used)],
      ['Available limit', limit === null ? '' : rupees(limit - used)],
      ['Unpaid invoices', money(m?.due)],
      ['On order', money(m?.on_order)],
      ['Overdue', money(m?.overdue)],
      ['Credit days', r.credit_days],
      ['Tier', r.tier],
      ['Risk grade', notes?.risk_grade],
      ['Review date', notes?.review_date],
      ['Project Number', await projectOf(notes?.project_id)],
    ]),
    lines: null,
    ...noTotals,
  };
};

const BUILDERS: Record<string, Builder> = {
  'sales-quotations': quotation,
  'sales-orders': order,
  'sales-invoices': invoice,
  'sales-returns': salesReturn,
  'sales-dispatch': dispatch,
  'sales-enquiries': enquiry,
  'sales-collections': receipt,
  'sales-reservations': reservation,
  'inv-reservation': reservation,
  'sales-delivery': delivery,
  'sales-credit': credit,
};

/** The Sales form of a record, or null for a page that keeps the generic one. */
export async function salesPrint(pageId: string, r: Row, id: string, status: string): Promise<SalesPrint | null> {
  const build = BUILDERS[pageId];
  return build ? build(r, id, status) : null;
}

/** A Sales record is a draft only while it still waits to be made final; Fulfilled, Quoted or Within limit are not drafts. */
export function salesCopyMark(pageId: string, status: string): 'DRAFT' | 'CANCELLED' | 'FINAL' | null {
  if (!BUILDERS[pageId]) return null;
  if (/^(draft|rejected|pending|pending approval|submitted)?$/i.test(status)) return 'DRAFT';
  if (/^(cancelled|released|expired)$/i.test(status)) return 'CANCELLED';
  return 'FINAL';
}
