// Feeds the tax register (tax_documents + lines, Phase 7) from the Phase 9 and 10 producers. The producer already
// computed every amount and posted its own journal; this only copies the posted figures so GSTR-1, GSTR-3B and the
// registers read ONE source. Nothing is computed here. A document in a filed GST period is refused (11-A10).
import type { Db } from '../../core/db/prisma';
import { assertGstPeriodOpen } from './period-lock';

type Row = Record<string, unknown>;

/** GST unit quantity codes; anything unknown is OTH (the offline tool accepts it) */
const UQC: Record<string, string> = {
  KG: 'KGS',
  KGS: 'KGS',
  KILOGRAM: 'KGS',
  GM: 'GMS',
  GMS: 'GMS',
  GRAM: 'GMS',
  MT: 'MTS',
  TON: 'TON',
  TONNE: 'TON',
  PCS: 'PCS',
  PC: 'PCS',
  PIECE: 'PCS',
  NOS: 'NOS',
  NO: 'NOS',
  NUMBER: 'NOS',
  EA: 'NOS',
  EACH: 'NOS',
  UNIT: 'UNT',
  UNITS: 'UNT',
  M: 'MTR',
  MTR: 'MTR',
  METER: 'MTR',
  METRE: 'MTR',
  CM: 'CMS',
  L: 'LTR',
  LTR: 'LTR',
  LITRE: 'LTR',
  LITER: 'LTR',
  ML: 'MLT',
  BOX: 'BOX',
  BOXES: 'BOX',
  SET: 'SET',
  SETS: 'SET',
  PAIR: 'PRS',
  PRS: 'PRS',
  ROLL: 'ROL',
  ROL: 'ROL',
  BAG: 'BAG',
  BAGS: 'BAG',
  SQM: 'SQM',
  SQFT: 'SQF',
  CBM: 'CBM',
  DOZ: 'DOZ',
  BTL: 'BTL',
  CAN: 'CAN',
  DRM: 'DRM',
  PKT: 'PAC',
  PAC: 'PAC',
  PACK: 'PAC',
};
export const toUqc = (u: unknown): string => UQC[S(u).trim().toUpperCase()] ?? 'OTH';
const S = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  // Decimals and Dates have their own toString; only plain objects are JSON
  if (typeof v === 'object' && v.toString === Object.prototype.toString) return JSON.stringify(v);
  return String(v as string);
};
const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : S(v).slice(0, 10);

interface DocIn {
  unitId: string;
  direction: 'OUTWARD' | 'INWARD';
  docKind: 'INV' | 'CRN' | 'DBN';
  docNo: string;
  docDate: string;
  refNo?: string | null;
  partyType: 'CUSTOMER' | 'SUPPLIER';
  partyId: string;
  partyName: string;
  partyGstin: string | null;
  partyState: string | null;
  placeOfSupply: string;
  reverseCharge: boolean;
  origDocNo?: string | null;
  origDocDate?: string | null;
  sourceType: string;
  sourceId: string;
  journalId: string;
  actorId: string;
  head: { taxable: string; cgst: string; sgst: string; igst: string };
  lines: Row[];
}

async function unitInfo(tx: Db, unitId: string): Promise<{ gstin: string | null; state: string }> {
  const u = (
    await tx.$queryRawUnsafe<Row[]>(`SELECT gstin, state_code FROM units WHERE id=$1::uuid`, unitId)
  )[0];
  const gstin = u?.gstin ? S(u.gstin) : null;
  return { gstin, state: S(u?.state_code ?? (gstin ? gstin.slice(0, 2) : '27')) };
}

async function insertDoc(tx: Db, d: DocIn, gstin: string | null): Promise<void> {
  await assertGstPeriodOpen(tx, { gstin, docDate: d.docDate, direction: d.direction });
  const rows = await tx.$queryRawUnsafe<Row[]>(
    `INSERT INTO tax_documents (unit_id, direction, doc_kind, doc_no, doc_date, party_type, party_id, party_name,
        party_gstin, party_state_code, place_of_supply, reverse_charge, taxable, cgst, sgst, igst, cess, journal_id,
        created_by_id, orig_doc_no, orig_doc_date, source_type, source_id, gstin, ref_no)
     VALUES ($1::uuid,$2,$3,$4,$5::date,$6,$7::uuid,$8,$9,$10,$11,$12,$13::numeric,$14::numeric,$15::numeric,$16::numeric,0,
        $17::uuid,$18::uuid,$19,$20::date,$21,$22::uuid,$23,$24) RETURNING id`,
    d.unitId,
    d.direction,
    d.docKind,
    d.docNo,
    d.docDate,
    d.partyType,
    d.partyId,
    d.partyName.slice(0, 150),
    d.partyGstin,
    d.partyState,
    d.placeOfSupply,
    d.reverseCharge,
    d.head.taxable,
    d.head.cgst,
    d.head.sgst,
    d.head.igst,
    d.journalId,
    d.actorId,
    d.origDocNo ?? null,
    d.origDocDate ?? null,
    d.sourceType,
    d.sourceId,
    gstin,
    d.refNo ?? null,
  );
  const id = S(rows[0]?.id);
  let n = 0;
  for (const l of d.lines) {
    n += 1;
    await tx.$executeRawUnsafe(
      `INSERT INTO tax_document_lines (tax_document_id, line_no, hsn, uqc, qty, taxable, rate_pct, cgst, sgst, igst, cess)
       VALUES ($1::uuid,$2,$3,$4,$5::numeric,$6::numeric,$7::numeric,$8::numeric,$9::numeric,$10::numeric,0)`,
      id,
      n,
      S(l.hsn_sac).slice(0, 8),
      toUqc(l.uom),
      S(l.qty || '0'),
      S(l.taxable),
      S(l.gst_pct || '0'),
      S(l.cgst),
      S(l.sgst),
      S(l.igst),
    );
  }
}

/** sales invoice posted -> outward INV */
export async function feedSalesInvoice(tx: Db, invoiceId: string, actorId: string): Promise<void> {
  const inv = (
    await tx.$queryRawUnsafe<Row[]>(
      `SELECT i.*, c.name AS cust_name, c.gstin AS cust_gstin, c.state_code AS cust_state
         FROM sales_invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id=$1::uuid`,
      invoiceId,
    )
  )[0];
  if (!inv) return;
  const u = await unitInfo(tx, S(inv.unit_id));
  const lines = await tx.$queryRawUnsafe<Row[]>(
    `SELECT hsn_sac, uom, qty::text, taxable::text, gst_pct::text, cgst::text, sgst::text, igst::text
       FROM sales_invoice_lines WHERE invoice_id=$1::uuid ORDER BY line_no`,
    invoiceId,
  );
  await insertDoc(
    tx,
    {
      unitId: S(inv.unit_id),
      direction: 'OUTWARD',
      docKind: 'INV',
      docNo: S(inv.number),
      docDate: iso(inv.invoice_date),
      partyType: 'CUSTOMER',
      partyId: S(inv.customer_id),
      partyName: S(inv.cust_name),
      partyGstin: inv.cust_gstin ? S(inv.cust_gstin) : null,
      partyState: inv.cust_state ? S(inv.cust_state) : null,
      placeOfSupply: S(inv.customer_state || inv.cust_state || u.state),
      reverseCharge: false,
      sourceType: 'sales_invoice',
      sourceId: invoiceId,
      journalId: S(inv.journal_id),
      actorId,
      head: { taxable: S(inv.taxable), cgst: S(inv.cgst), sgst: S(inv.sgst), igst: S(inv.igst) },
      lines,
    },
    u.gstin,
  );
}

/** sales return posted -> outward CRN against its invoice */
export async function feedSalesCreditNote(
  tx: Db,
  returnId: string,
  actorId: string,
): Promise<void> {
  const r = (
    await tx.$queryRawUnsafe<Row[]>(
      `SELECT r.*, i.number AS inv_no, i.invoice_date AS inv_date, i.customer_state,
              c.name AS cust_name, c.gstin AS cust_gstin, c.state_code AS cust_state
         FROM sales_returns r JOIN sales_invoices i ON i.id = r.invoice_id JOIN customers c ON c.id = r.customer_id
        WHERE r.id=$1::uuid`,
      returnId,
    )
  )[0];
  if (!r) return;
  const u = await unitInfo(tx, S(r.unit_id));
  const lines = await tx.$queryRawUnsafe<Row[]>(
    `SELECT l.qty::text, l.taxable::text, l.gst_pct::text, l.cgst::text, l.sgst::text, l.igst::text,
            il.hsn_sac, il.uom
       FROM sales_return_lines l JOIN sales_invoice_lines il ON il.id = l.invoice_line_id
      WHERE l.return_id=$1::uuid ORDER BY l.line_no`,
    returnId,
  );
  await insertDoc(
    tx,
    {
      unitId: S(r.unit_id),
      direction: 'OUTWARD',
      docKind: 'CRN',
      docNo: S(r.credit_note_no),
      docDate: iso(r.return_date),
      partyType: 'CUSTOMER',
      partyId: S(r.customer_id),
      partyName: S(r.cust_name),
      partyGstin: r.cust_gstin ? S(r.cust_gstin) : null,
      partyState: r.cust_state ? S(r.cust_state) : null,
      placeOfSupply: S(r.customer_state || r.cust_state || u.state),
      reverseCharge: false,
      origDocNo: S(r.inv_no),
      origDocDate: iso(r.inv_date),
      sourceType: 'sales_return',
      sourceId: returnId,
      journalId: S(r.journal_id),
      actorId,
      head: { taxable: S(r.taxable), cgst: S(r.cgst), sgst: S(r.sgst), igst: S(r.igst) },
      lines,
    },
    u.gstin,
  );
}

/** purchase invoice posted -> inward INV (reverse charge flagged) */
export async function feedPurchaseInvoice(
  tx: Db,
  invoiceId: string,
  actorId: string,
): Promise<void> {
  const inv = (
    await tx.$queryRawUnsafe<Row[]>(
      `SELECT i.*, s.name AS sup_name, s.state_code AS sup_state
         FROM purchase_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.id=$1::uuid`,
      invoiceId,
    )
  )[0];
  if (!inv) return;
  const u = await unitInfo(tx, S(inv.unit_id));
  const lines = await tx.$queryRawUnsafe<Row[]>(
    `SELECT hsn_sac, uom, qty::text, taxable::text, gst_pct::text, cgst::text, sgst::text, igst::text
       FROM purchase_invoice_lines WHERE invoice_id=$1::uuid ORDER BY line_no`,
    invoiceId,
  );
  await insertDoc(
    tx,
    {
      unitId: S(inv.unit_id),
      direction: 'INWARD',
      docKind: 'INV',
      docNo: S(inv.number),
      refNo: S(inv.vendor_invoice_no),
      docDate: iso(inv.invoice_date),
      partyType: 'SUPPLIER',
      partyId: S(inv.supplier_id),
      partyName: S(inv.sup_name),
      partyGstin: inv.supplier_gstin ? S(inv.supplier_gstin) : null,
      partyState: inv.supplier_state
        ? S(inv.supplier_state)
        : inv.sup_state
          ? S(inv.sup_state)
          : null,
      placeOfSupply: u.state,
      reverseCharge: inv.is_rcm === true,
      sourceType: 'purchase_invoice',
      sourceId: invoiceId,
      journalId: S(inv.journal_id),
      actorId,
      head: { taxable: S(inv.taxable), cgst: S(inv.cgst), sgst: S(inv.sgst), igst: S(inv.igst) },
      lines,
    },
    u.gstin,
  );
}

/** supplier debit note posted -> inward DBN (reduces ITC) */
export async function feedDebitNote(tx: Db, noteId: string, actorId: string): Promise<void> {
  const n = (
    await tx.$queryRawUnsafe<Row[]>(
      `SELECT n.*, s.name AS sup_name, s.gstin AS sup_gstin, s.state_code AS sup_state,
              i.number AS inv_no, i.vendor_invoice_no, i.invoice_date AS inv_date
         FROM debit_notes n JOIN suppliers s ON s.id = n.supplier_id
         LEFT JOIN purchase_invoices i ON i.id = n.invoice_id WHERE n.id=$1::uuid`,
      noteId,
    )
  )[0];
  if (!n) return;
  const tax = D3(n);
  if (tax === 0 && D2(n.taxable) === 0) return; // a note with no value and no tax has nothing to report
  const u = await unitInfo(tx, S(n.unit_id));
  const lines = await tx.$queryRawUnsafe<Row[]>(
    `SELECT COALESCE(il.hsn_sac,'') AS hsn_sac, il.uom, l.qty::text, l.taxable::text, l.gst_pct::text,
            l.cgst::text, l.sgst::text, l.igst::text
       FROM debit_note_lines l LEFT JOIN purchase_invoice_lines il ON il.id = l.invoice_line_id
      WHERE l.note_id=$1::uuid ORDER BY l.line_no`,
    noteId,
  );
  await insertDoc(
    tx,
    {
      unitId: S(n.unit_id),
      direction: 'INWARD',
      docKind: 'DBN',
      docNo: S(n.number),
      docDate: iso(n.note_date),
      partyType: 'SUPPLIER',
      partyId: S(n.supplier_id),
      partyName: S(n.sup_name),
      partyGstin: n.sup_gstin ? S(n.sup_gstin) : null,
      partyState: n.sup_state ? S(n.sup_state) : null,
      placeOfSupply: u.state,
      reverseCharge: false,
      origDocNo: n.vendor_invoice_no ? S(n.vendor_invoice_no) : null,
      origDocDate: n.inv_date ? iso(n.inv_date) : null,
      sourceType: 'debit_note',
      sourceId: noteId,
      journalId: S(n.journal_id),
      actorId,
      head: { taxable: S(n.taxable), cgst: S(n.cgst), sgst: S(n.sgst), igst: S(n.igst) },
      lines,
    },
    u.gstin,
  );
}

const D2 = (v: unknown): number => Number(S(v) || 0);
const D3 = (n: Row): number => D2(n.cgst) + D2(n.sgst) + D2(n.igst);
