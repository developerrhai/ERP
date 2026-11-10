// Phase 20-G: Opening-balance cut-over wizard (dry run, error sheet, idempotent commit,
// PDF reconciliation report + CFO/Department-Head dual sign-off with 0-difference enforcement).
import { createHash } from 'node:crypto';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma, type Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { abandonIdempotent, beginIdempotent, finishIdempotent } from '../../core/http/idempotency';
import { NumberingService } from '../../core/numbering/numbering-service';
import { addPageNumbers, drawLine, drawParagraph, finishPdf, newPdf } from '../../core/pdf';
import { defaultStorage } from '../../core/storage';
import { exec, fyOfCaller, norm, query, type Row } from '../procurement/core';
import type { Caller } from '../records/service';

async function queryOne(db: Db | typeof prisma, sql: string, params: unknown[] = []): Promise<Row | null> {
  const rows = await query(db, sql, ...params);
  return rows[0] ?? null;
}

function requireUnit(caller: Caller): string {
  if (!caller.ctx.unitId) throw Errors.contextInvalid('Choose a concrete unit first.');
  return caller.ctx.unitId;
}

export const OPENING_DATASETS = [
  'GL_TRIAL',
  'STOCK',
  'AR_OPEN',
  'AP_OPEN',
  'EMPLOYEES_YTD',
  'ASSET_REGISTER',
  'OPEN_PO_SO',
] as const;

export type OpeningDataset = (typeof OPENING_DATASETS)[number];

export interface DatasetTemplateSpec {
  dataset: OpeningDataset;
  label: string;
  reconciliationRule: string;
  columns: { key: string; label: string; required: boolean; example: string | number }[];
}

export const OPENING_TEMPLATES: Record<OpeningDataset, DatasetTemplateSpec> = {
  GL_TRIAL: {
    dataset: 'GL_TRIAL',
    label: 'GL Trial Balance (Opening)',
    reconciliationRule: 'Sum(Debit) = Sum(Credit); Control accounts = Sub-ledgers; Difference = 0 vs Legacy TB',
    columns: [
      { key: 'accountCode', label: 'Account Code', required: true, example: '1101' },
      { key: 'accountName', label: 'Account Name', required: false, example: 'HDFC Current A/c' },
      { key: 'debit', label: 'Debit (INR)', required: true, example: 250000 },
      { key: 'credit', label: 'Credit (INR)', required: true, example: 0 },
    ],
  },
  STOCK: {
    dataset: 'STOCK',
    label: 'Opening Stock (Item x Warehouse x Batch/Serial)',
    reconciliationRule: 'Sum(Qty x Rate) = GL Inventory; Qty = physical count',
    columns: [
      { key: 'itemCode', label: 'Item Code', required: true, example: 'RM-CRCA-1.2' },
      { key: 'warehouseCode', label: 'Warehouse Code', required: true, example: 'WH-TAL-RM' },
      { key: 'batchNo', label: 'Batch / Serial', required: false, example: 'OPEN-2027-01' },
      { key: 'qty', label: 'Qty', required: true, example: 1000 },
      { key: 'rate', label: 'Unit Rate (INR)', required: true, example: 68.5 },
    ],
  },
  AR_OPEN: {
    dataset: 'AR_OPEN',
    label: 'AR Open Customer Bills',
    reconciliationRule: 'Sum(Open Amount) = GL AR Control; Ageing = legacy',
    columns: [
      { key: 'partyCode', label: 'Customer Code', required: true, example: 'CUST-001' },
      { key: 'docNo', label: 'Legacy Invoice No', required: true, example: 'LEG-INV-442' },
      { key: 'docDate', label: 'Invoice Date (YYYY-MM-DD)', required: true, example: '2027-03-15' },
      { key: 'dueDate', label: 'Due Date (YYYY-MM-DD)', required: true, example: '2027-04-14' },
      { key: 'amount', label: 'Outstanding (INR)', required: true, example: 118000 },
    ],
  },
  AP_OPEN: {
    dataset: 'AP_OPEN',
    label: 'AP Open Supplier Bills',
    reconciliationRule: 'Sum(Open Amount) = GL AP Control; Ageing = legacy',
    columns: [
      { key: 'partyCode', label: 'Supplier Code', required: true, example: 'SUP-014' },
      { key: 'docNo', label: 'Legacy Bill No', required: true, example: 'VEND-889' },
      { key: 'docDate', label: 'Bill Date (YYYY-MM-DD)', required: true, example: '2027-03-20' },
      { key: 'dueDate', label: 'Due Date (YYYY-MM-DD)', required: true, example: '2027-04-19' },
      { key: 'amount', label: 'Payable (INR)', required: true, example: 84500 },
    ],
  },
  EMPLOYEES_YTD: {
    dataset: 'EMPLOYEES_YTD',
    label: 'Employees + YTD Payroll / TDS',
    reconciliationRule: 'YTD earnings = legacy payroll register; TDS = filed return',
    columns: [
      { key: 'empCode', label: 'Employee Code', required: true, example: 'EMP-001' },
      { key: 'ytdGross', label: 'YTD Gross (INR)', required: true, example: 650000 },
      { key: 'ytdPf', label: 'YTD PF (INR)', required: false, example: 21600 },
      { key: 'ytdTds', label: 'YTD TDS (INR)', required: false, example: 18500 },
    ],
  },
  ASSET_REGISTER: {
    dataset: 'ASSET_REGISTER',
    label: 'Asset Register (Book + IT Blocks)',
    reconciliationRule: 'Gross Cost and Accumulated Depreciation = GL Fixed Assets',
    columns: [
      { key: 'assetCode', label: 'Asset Code', required: true, example: 'FA-CNC-001' },
      { key: 'name', label: 'Asset Description', required: true, example: 'CNC Turning Center #1' },
      { key: 'grossCost', label: 'Gross Cost (INR)', required: true, example: 1850000 },
      { key: 'accumDep', label: 'Accumulated Dep (INR)', required: true, example: 420000 },
    ],
  },
  OPEN_PO_SO: {
    dataset: 'OPEN_PO_SO',
    label: 'Open Purchase / Sales Orders',
    reconciliationRule: 'Open order count and pending value = legacy ERP',
    columns: [
      { key: 'orderKind', label: 'Kind (PO / SO)', required: true, example: 'PO' },
      { key: 'orderNo', label: 'Legacy Order No', required: true, example: 'LPO-2027-91' },
      { key: 'partyCode', label: 'Party Code', required: true, example: 'SUP-014' },
      { key: 'pendingValue', label: 'Pending Value (INR)', required: true, example: 92000 },
    ],
  },
};

function toPaise(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const cleaned = String(val).replace(/,/g, '').trim();
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function toNum(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const cleaned = String(val).replace(/,/g, '').trim();
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatPaise(p: number): string {
  return (p / 100).toFixed(2);
}

function nonEmpty(val: unknown): string {
  return typeof val === 'string' ? val.trim() : val !== null && val !== undefined ? String(val).trim() : '';
}

function evaluateDataset(
  dataset: OpeningDataset,
  rows: Record<string, unknown>[],
  legacyTotalInput: number | string,
  glControlBalance?: number | string,
) {
  const errors: { row: number; field: string; message: string }[] = [];
  let sumErpPaise = 0;
  let drPaise = 0;
  let crPaise = 0;
  let validRows = 0;

  rows.forEach((raw, idx) => {
    const rowNum = idx + 1;
    let ok = true;
    if (dataset === 'GL_TRIAL') {
      const code = nonEmpty(raw.accountCode);
      const dr = toPaise(raw.debit ?? 0);
      const cr = toPaise(raw.credit ?? 0);
      if (!code) {
        errors.push({ row: rowNum, field: 'accountCode', message: 'Account code required.' });
        ok = false;
      }
      if (dr === null || dr < 0 || cr === null || cr < 0 || (dr > 0 && cr > 0)) {
        errors.push({ row: rowNum, field: 'debit', message: 'Provide non-negative Debit OR Credit.' });
        ok = false;
      }
      if (ok && dr !== null && cr !== null) {
        drPaise += dr;
        crPaise += cr;
        sumErpPaise += dr;
      }
    } else if (dataset === 'STOCK') {
      const itemCode = nonEmpty(raw.itemCode);
      const warehouseCode = nonEmpty(raw.warehouseCode);
      const qty = toNum(raw.qty);
      const rate = toNum(raw.rate);
      if (!itemCode) {
        errors.push({ row: rowNum, field: 'itemCode', message: 'Item code required.' });
        ok = false;
      }
      if (!warehouseCode) {
        errors.push({ row: rowNum, field: 'warehouseCode', message: 'Warehouse code required.' });
        ok = false;
      }
      if (qty === null || qty <= 0) {
        errors.push({ row: rowNum, field: 'qty', message: 'Qty > 0 required.' });
        ok = false;
      }
      if (rate === null || rate < 0) {
        errors.push({ row: rowNum, field: 'rate', message: 'Rate >= 0 required.' });
        ok = false;
      }
      if (ok && qty !== null && rate !== null) sumErpPaise += Math.round(qty * rate * 100);
    } else if (dataset === 'AR_OPEN' || dataset === 'AP_OPEN') {
      const party = nonEmpty(raw.partyCode);
      const docNo = nonEmpty(raw.docNo);
      const amount = toPaise(raw.amount);
      if (!party) {
        errors.push({ row: rowNum, field: 'partyCode', message: 'Party code required.' });
        ok = false;
      }
      if (!docNo) {
        errors.push({ row: rowNum, field: 'docNo', message: 'Document no required.' });
        ok = false;
      }
      if (amount === null || amount <= 0) {
        errors.push({ row: rowNum, field: 'amount', message: 'Amount > 0 required.' });
        ok = false;
      }
      if (ok && amount !== null) sumErpPaise += amount;
    } else if (dataset === 'EMPLOYEES_YTD') {
      const empCode = nonEmpty(raw.empCode);
      const ytdGross = toPaise(raw.ytdGross);
      if (!empCode) {
        errors.push({ row: rowNum, field: 'empCode', message: 'Employee code required.' });
        ok = false;
      }
      if (ytdGross === null || ytdGross < 0) {
        errors.push({ row: rowNum, field: 'ytdGross', message: 'YTD Gross >= 0 required.' });
        ok = false;
      }
      if (ok && ytdGross !== null) sumErpPaise += ytdGross;
    } else if (dataset === 'ASSET_REGISTER') {
      const assetCode = nonEmpty(raw.assetCode);
      const gross = toPaise(raw.grossCost);
      const accum = toPaise(raw.accumDep ?? 0);
      if (!assetCode) {
        errors.push({ row: rowNum, field: 'assetCode', message: 'Asset code required.' });
        ok = false;
      }
      if (gross === null || gross <= 0 || accum === null || accum < 0 || accum > gross) {
        errors.push({ row: rowNum, field: 'accumDep', message: '0 <= accumDep <= grossCost required.' });
        ok = false;
      }
      if (ok && gross !== null && accum !== null) sumErpPaise += gross - accum;
    } else if (dataset === 'OPEN_PO_SO') {
      const orderNo = nonEmpty(raw.orderNo);
      const pendingValue = toPaise(raw.pendingValue);
      if (!orderNo) {
        errors.push({ row: rowNum, field: 'orderNo', message: 'Order no required.' });
        ok = false;
      }
      if (pendingValue === null || pendingValue <= 0) {
        errors.push({ row: rowNum, field: 'pendingValue', message: 'Pending value > 0 required.' });
        ok = false;
      }
      if (ok && pendingValue !== null) sumErpPaise += pendingValue;
    }
    if (ok) validRows += 1;
  });

  if (dataset === 'GL_TRIAL' && drPaise !== crPaise) {
    errors.push({
      row: 0,
      field: 'trialBalance',
      message: `Debit ${formatPaise(drPaise)} != Credit ${formatPaise(crPaise)}.`,
    });
  }
  if (glControlBalance !== undefined) {
    const ctrl = toPaise(glControlBalance);
    if (ctrl !== null && ctrl !== sumErpPaise) {
      errors.push({
        row: 0,
        field: 'glControlBalance',
        message: `Sub-ledger ${formatPaise(sumErpPaise)} != GL Control ${formatPaise(ctrl)}.`,
      });
    }
  }

  const legacyPaise = toPaise(legacyTotalInput) ?? 0;
  const diffPaise = legacyPaise - sumErpPaise;
  const errorRows = errors.filter((e) => e.row > 0).length;
  const balanced = errors.length === 0 && diffPaise === 0;

  return {
    totalRows: rows.length,
    validRows,
    errorRows,
    legacyTotal: formatPaise(legacyPaise),
    erpTotal: formatPaise(sumErpPaise),
    difference: formatPaise(diffPaise),
    balanced,
    errors,
  };
}

async function generateReconciliationPdfBuffer(batch: Row): Promise<Buffer> {
  const doc = newPdf();
  let y = 50;
  drawLine(doc, 'SAWANT GROUP ERP — OPENING BALANCE RECONCILIATION REPORT', 50, y, {
    size: 13,
    bold: true,
    color: '#1e3a8a',
  });
  y += 26;
  drawLine(
    doc,
    `Batch: ${String(batch.batch_no)}  |  Dataset: ${String(batch.dataset)}  |  Source: ${String(batch.source)}`,
    50,
    y,
    { size: 10, bold: true },
  );
  y += 18;
  drawLine(
    doc,
    `Status: ${String(batch.status)}  |  Rows: ${String(batch.valid_rows)} valid / ${String(batch.error_rows)} errors`,
    50,
    y,
    { size: 9.5 },
  );
  y += 22;
  drawLine(doc, `Legacy System Total (INR):  ${String(batch.legacy_total)}`, 50, y, { size: 10.5 });
  y += 16;
  drawLine(doc, `ERP Loaded Total (INR):    ${String(batch.erp_total)}`, 50, y, { size: 10.5 });
  y += 16;
  drawLine(doc, `Reconciliation Difference: ${String(batch.difference)}`, 50, y, {
    size: 11,
    bold: true,
    color: Number(batch.difference) === 0 ? '#16a34a' : '#dc2626',
  });
  y += 28;
  y = drawParagraph(
    doc,
    'Certification: Opening balances reconcile with legacy general ledger / sub-ledger registers prior to go-live cut-over. Stored in DMS for statutory audit.',
    50,
    y,
    490,
    { size: 9, color: '#475569' },
  );
  y += 32;
  drawLine(
    doc,
    'CFO Sign-Off: ___________________________          Department Head Sign-Off: ___________________________',
    50,
    y,
    { size: 9 },
  );
  addPageNumbers(doc);
  return finishPdf(doc);
}

export const cutoverService = {
  getTemplate(dataset: OpeningDataset): DatasetTemplateSpec {
    return OPENING_TEMPLATES[dataset];
  },

  async listBatches(caller: Caller): Promise<Row[]> {
    const unitFilter = caller.ctx.unitId;
    const rows = await query(
      prisma,
      `SELECT b.id, b.batch_no, b.unit_id, b.fy_id, b.dataset, b.source, b.status,
              b.total_rows, b.valid_rows, b.error_rows, b.legacy_total, b.erp_total, b.difference,
              b.reconciliation_file_id, b.committed_at, b.created_at,
              s.cfo_signed_at, s.dept_head_signed_at, s.dms_document_id
       FROM opening_cutover_batches b
       LEFT JOIN opening_signoffs s ON s.batch_id = b.id
       WHERE ($1::uuid IS NULL OR b.unit_id = $1::uuid)
         AND b.fy_id = $2::uuid
       ORDER BY b.created_at DESC`,
      unitFilter,
      caller.ctx.fyId,
    );
    return rows.map((r) => norm(r));
  },

  async dryRun(
    caller: Caller,
    input: {
      dataset: OpeningDataset;
      legacyTotal: number | string;
      glControlBalance?: number | string;
      rows: Record<string, unknown>[];
    },
  ): Promise<Row> {
    const unitId = requireUnit(caller);
    const fy = await fyOfCaller(caller);
    const evaluated = evaluateDataset(input.dataset, input.rows, input.legacyTotal, input.glControlBalance);
    const status = evaluated.balanced ? 'VALIDATED' : 'DRY_RUN';

    const created = await prisma.$transaction(async (tx) => {
      const batchNo = await NumberingService.allocate(tx, {
        docType: 'opening-cutover',
        unitId,
        fyId: fy.id,
      });
      const row = await queryOne(
        tx,
        `INSERT INTO opening_cutover_batches (
           batch_no, unit_id, fy_id, dataset, source, status,
           total_rows, valid_rows, error_rows, legacy_total, erp_total, difference,
           rows_payload, errors_payload, created_by_id
         ) VALUES ($1, $2::uuid, $3::uuid, $4, 'OPENING', $5, $6, $7, $8, $9::numeric, $10::numeric, $11::numeric, $12::jsonb, $13::jsonb, $14::uuid)
         RETURNING id, batch_no, unit_id, fy_id, dataset, source, status,
                   total_rows, valid_rows, error_rows, legacy_total, erp_total, difference,
                   errors_payload, created_at`,
        [
          batchNo,
          unitId,
          fy.id,
          input.dataset,
          status,
          evaluated.totalRows,
          evaluated.validRows,
          evaluated.errorRows,
          evaluated.legacyTotal,
          evaluated.erpTotal,
          evaluated.difference,
          JSON.stringify(input.rows),
          JSON.stringify(evaluated.errors),
          caller.auth.userId,
        ],
      );
      if (!row) throw new Error('Failed to create dry-run batch');
      await recordAudit(
        {
          action: 'OPENING_CUTOVER_DRY_RUN',
          actorId: caller.auth.userId,
          targetType: 'OpeningCutoverBatch',
          targetId: String(row.id),
          meta: caller.meta,
          detail: { batchNo, dataset: input.dataset, balanced: evaluated.balanced, difference: evaluated.difference },
        },
        tx,
      );
      return row;
    });
    return norm(created);
  },

  async commit(
    caller: Caller,
    batchId: string,
    idemKey?: string,
  ): Promise<{ batch: Row; replay: boolean }> {
    const scope = `opening-cutover-commit:${batchId}`;
    const reqHash = createHash('sha256').update(batchId).digest('hex');
    if (idemKey) {
      const start = await beginIdempotent(caller.auth.userId, scope, idemKey, reqHash);
      if (start.kind === 'replay') return { batch: start.body as Row, replay: true };
      if (start.kind === 'in_progress') throw Errors.conflict('Commit already in progress.');
      if (start.kind === 'mismatch') throw Errors.conflict('Idempotency key reused for another batch.');
    }

    try {
      const batch = await queryOne(prisma, `SELECT * FROM opening_cutover_batches WHERE id = $1::uuid`, [batchId]);
      if (!batch) throw Errors.notFound('Opening cut-over batch not found.');
      if (batch.status === 'COMMITTED' || batch.status === 'SIGNED_OFF') {
        throw Errors.conflict('Batch is already committed.');
      }
      if (Number(batch.error_rows) > 0 || Number(batch.difference) !== 0 || batch.status !== 'VALIDATED') {
        throw Errors.validation(
          { difference: 'Batch must pass dry run with 0 errors and 0.00 reconciliation difference before commit.' },
          'Cannot commit unreconciled opening balance batch.',
        );
      }

      const pdfBuffer = await generateReconciliationPdfBuffer({ ...batch, status: 'COMMITTED' });
      const storedPdf = await defaultStorage.save({
        buffer: pdfBuffer,
        originalFilename: `${String(batch.batch_no)}_reconciliation.pdf`,
        mimeType: 'application/pdf',
        userId: caller.auth.userId,
      });

      const updated = await queryOne(
        prisma,
        `UPDATE opening_cutover_batches
         SET status = 'COMMITTED',
             reconciliation_file_id = $2::uuid,
             committed_by_id = $3::uuid,
             committed_at = now(),
             updated_at = now()
         WHERE id = $1::uuid AND status = 'VALIDATED'
         RETURNING id, batch_no, unit_id, fy_id, dataset, source, status,
                   total_rows, valid_rows, error_rows, legacy_total, erp_total, difference,
                   reconciliation_file_id, committed_at`,
        [batchId, storedPdf.id, caller.auth.userId],
      );
      if (!updated) throw Errors.conflict('Batch state changed concurrently.');

      await recordAudit({
        action: 'OPENING_CUTOVER_COMMITTED',
        actorId: caller.auth.userId,
        targetType: 'OpeningCutoverBatch',
        targetId: batchId,
        meta: caller.meta,
        detail: { batchNo: String(batch.batch_no), dataset: String(batch.dataset), source: 'OPENING', pdfFileId: storedPdf.id },
      });

      const dto = norm(updated);
      if (idemKey) await finishIdempotent(caller.auth.userId, scope, idemKey, 200, dto as never);
      return { batch: dto, replay: false };
    } catch (err) {
      if (idemKey) await abandonIdempotent(caller.auth.userId, scope, idemKey);
      throw err;
    }
  },

  async signOff(
    caller: Caller,
    batchId: string,
    input: { cfoUserId?: string; deptHeadUserId?: string; dmsDocumentId?: string | null; notes?: string },
  ): Promise<Row> {
    const batch = await queryOne(prisma, `SELECT * FROM opening_cutover_batches WHERE id = $1::uuid`, [batchId]);
    if (!batch) throw Errors.notFound('Opening cut-over batch not found.');
    if (batch.status !== 'COMMITTED') {
      throw Errors.conflict('Only committed batches can be signed off.');
    }
    if (Number(batch.difference) !== 0) {
      throw Errors.validation({ difference: 'Sign-off requires 0 reconciliation difference.' });
    }

    const cfoId = input.cfoUserId ?? caller.auth.userId;
    const deptHeadId = input.deptHeadUserId ?? caller.auth.userId;

    const signoff = await prisma.$transaction(async (tx) => {
      const inserted = await queryOne(
        tx,
        `INSERT INTO opening_signoffs (
           batch_id, unit_id, fy_id, dataset, difference,
           cfo_signed_by_id, dept_head_signed_by_id, dms_document_id, notes
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 0, $5::uuid, $6::uuid, $7::uuid, $8)
         RETURNING *`,
        [
          batchId,
          batch.unit_id,
          batch.fy_id,
          batch.dataset,
          cfoId,
          deptHeadId,
          input.dmsDocumentId ?? null,
          input.notes ?? null,
        ],
      );
      await exec(
        tx,
        `UPDATE opening_cutover_batches SET status = 'SIGNED_OFF', updated_at = now() WHERE id = $1::uuid`,
        batchId,
      );
      await recordAudit(
        {
          action: 'OPENING_CUTOVER_SIGNED_OFF',
          actorId: caller.auth.userId,
          targetType: 'OpeningSignoff',
          targetId: String(inserted?.id ?? batchId),
          meta: caller.meta,
          detail: { batchId, dataset: String(batch.dataset), cfoId, deptHeadId },
        },
        tx,
      );
      return inserted;
    });
    return norm(signoff!);
  },

  async reconciliationPdf(batchId: string): Promise<{ buffer: Buffer; batchNo: string }> {
    const batch = await queryOne(prisma, `SELECT * FROM opening_cutover_batches WHERE id = $1::uuid`, [batchId]);
    if (!batch) throw Errors.notFound('Batch not found.');
    if (batch.reconciliation_file_id) {
      const stored = await defaultStorage.get(String(batch.reconciliation_file_id));
      if (stored) return { buffer: stored.buffer, batchNo: String(batch.batch_no) };
    }
    const buffer = await generateReconciliationPdfBuffer(batch);
    return { buffer, batchNo: String(batch.batch_no) };
  },
};
