// Phase 20-G & 20-J pure calculators: Opening-balance dataset reconciliation (exact paise) & DPDP SLA helpers.

export type OpeningDataset =
  | 'GL_TRIAL'
  | 'STOCK'
  | 'AR_OPEN'
  | 'AP_OPEN'
  | 'EMPLOYEES_YTD'
  | 'ASSET_REGISTER'
  | 'OPEN_PO_SO';

export interface OpeningReconciliationInput {
  dataset: OpeningDataset;
  rows: Record<string, unknown>[];
  legacyTotal: string | number;
  glControlBalance?: string | number;
}

export interface OpeningReconciliationResult {
  validRows: number;
  errorRows: number;
  erpTotal: string;
  legacyTotal: string;
  difference: string;
  balanced: boolean;
  errors: { row: number; field: string; message: string }[];
}

function toPaise(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const cleaned = String(val).replace(/,/g, '').trim();
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
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

function nonEmptyStr(val: unknown): string {
  return typeof val === 'string' ? val.trim() : val !== null && val !== undefined ? String(val).trim() : '';
}

export function validateOpeningDataset(input: OpeningReconciliationInput): OpeningReconciliationResult {
  const errors: { row: number; field: string; message: string }[] = [];
  let sumErpPaise = 0;
  let totalDrPaise = 0;
  let totalCrPaise = 0;
  let validRows = 0;

  input.rows.forEach((raw, idx) => {
    const rowNum = idx + 1;
    let rowOk = true;

    if (input.dataset === 'GL_TRIAL') {
      const code = nonEmptyStr(raw.accountCode);
      const dr = toPaise(raw.debit ?? 0);
      const cr = toPaise(raw.credit ?? 0);
      if (!code) {
        errors.push({ row: rowNum, field: 'accountCode', message: 'Account code is required.' });
        rowOk = false;
      }
      if (dr === null || dr < 0 || cr === null || cr < 0 || (dr > 0 && cr > 0)) {
        errors.push({ row: rowNum, field: 'debit', message: 'Specify non-negative Debit OR Credit (not both).' });
        rowOk = false;
      }
      if (rowOk && dr !== null && cr !== null) {
        totalDrPaise += dr;
        totalCrPaise += cr;
        sumErpPaise += dr;
      }
    } else if (input.dataset === 'STOCK') {
      const itemCode = nonEmptyStr(raw.itemCode);
      const warehouseCode = nonEmptyStr(raw.warehouseCode);
      const qty = toNum(raw.qty);
      const rate = toNum(raw.rate);
      if (!itemCode) {
        errors.push({ row: rowNum, field: 'itemCode', message: 'Item code is required.' });
        rowOk = false;
      }
      if (!warehouseCode) {
        errors.push({ row: rowNum, field: 'warehouseCode', message: 'Warehouse code is required.' });
        rowOk = false;
      }
      if (qty === null || qty <= 0) {
        errors.push({ row: rowNum, field: 'qty', message: 'Quantity must be > 0.' });
        rowOk = false;
      }
      if (rate === null || rate < 0) {
        errors.push({ row: rowNum, field: 'rate', message: 'Rate must be >= 0.' });
        rowOk = false;
      }
      if (rowOk && qty !== null && rate !== null) {
        sumErpPaise += Math.round(qty * rate * 100);
      }
    } else if (input.dataset === 'AR_OPEN' || input.dataset === 'AP_OPEN') {
      const party = nonEmptyStr(raw.partyCode);
      const docNo = nonEmptyStr(raw.docNo);
      const amt = toPaise(raw.amount);
      if (!party) {
        errors.push({ row: rowNum, field: 'partyCode', message: 'Party code is required.' });
        rowOk = false;
      }
      if (!docNo) {
        errors.push({ row: rowNum, field: 'docNo', message: 'Open document number is required.' });
        rowOk = false;
      }
      if (amt === null || amt <= 0) {
        errors.push({ row: rowNum, field: 'amount', message: 'Open amount must be > 0.' });
        rowOk = false;
      }
      if (rowOk && amt !== null) sumErpPaise += amt;
    } else if (input.dataset === 'EMPLOYEES_YTD') {
      const empCode = nonEmptyStr(raw.empCode);
      const ytdGross = toPaise(raw.ytdGross);
      if (!empCode) {
        errors.push({ row: rowNum, field: 'empCode', message: 'Employee code is required.' });
        rowOk = false;
      }
      if (ytdGross === null || ytdGross < 0) {
        errors.push({ row: rowNum, field: 'ytdGross', message: 'YTD gross must be >= 0.' });
        rowOk = false;
      }
      if (rowOk && ytdGross !== null) sumErpPaise += ytdGross;
    } else if (input.dataset === 'ASSET_REGISTER') {
      const assetCode = nonEmptyStr(raw.assetCode);
      const gross = toPaise(raw.grossCost);
      const accum = toPaise(raw.accumDep ?? 0);
      if (!assetCode) {
        errors.push({ row: rowNum, field: 'assetCode', message: 'Asset code is required.' });
        rowOk = false;
      }
      if (gross === null || gross <= 0 || accum === null || accum < 0 || accum > gross) {
        errors.push({ row: rowNum, field: 'accumDep', message: '0 <= accumDep <= grossCost required.' });
        rowOk = false;
      }
      if (rowOk && gross !== null && accum !== null) {
        sumErpPaise += gross - accum;
      }
    } else if (input.dataset === 'OPEN_PO_SO') {
      const orderNo = nonEmptyStr(raw.orderNo);
      const pendingValue = toPaise(raw.pendingValue);
      if (!orderNo) {
        errors.push({ row: rowNum, field: 'orderNo', message: 'Order no required.' });
        rowOk = false;
      }
      if (pendingValue === null || pendingValue <= 0) {
        errors.push({ row: rowNum, field: 'pendingValue', message: 'Pending value must be > 0.' });
        rowOk = false;
      }
      if (rowOk && pendingValue !== null) sumErpPaise += pendingValue;
    }

    if (rowOk) validRows += 1;
  });

  if (input.dataset === 'GL_TRIAL' && totalDrPaise !== totalCrPaise) {
    errors.push({
      row: 0,
      field: 'trialBalance',
      message: `Trial balance unbalanced: Dr ${formatPaise(totalDrPaise)} != Cr ${formatPaise(totalCrPaise)}.`,
    });
  }

  const legacyPaise = toPaise(input.legacyTotal) ?? 0;
  const diffPaise = legacyPaise - sumErpPaise;

  let controlMismatch = false;
  if (input.glControlBalance !== undefined) {
    const ctrl = toPaise(input.glControlBalance);
    if (ctrl !== null && ctrl !== sumErpPaise) {
      controlMismatch = true;
      errors.push({
        row: 0,
        field: 'glControlBalance',
        message: `Sub-ledger total ${formatPaise(sumErpPaise)} differs from GL control ${formatPaise(ctrl)}.`,
      });
    }
  }

  const errorRows = errors.filter((e) => e.row > 0).length;
  const balanced = errors.length === 0 && diffPaise === 0 && !controlMismatch;

  return {
    validRows,
    errorRows,
    erpTotal: formatPaise(sumErpPaise),
    legacyTotal: formatPaise(legacyPaise),
    difference: formatPaise(diffPaise),
    balanced,
    errors,
  };
}

/** DPDP 30-day statutory SLA due date calculation (DPDP Rules 2025). */
export function computeDpdpSlaDueDate(submittedAt: Date, slaDays = 30): Date {
  return new Date(submittedAt.getTime() + slaDays * 24 * 60 * 60 * 1000);
}
