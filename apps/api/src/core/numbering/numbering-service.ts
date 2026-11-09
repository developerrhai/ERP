// apps/api/src/core/numbering/numbering-service.ts
// Gap-free document numbering service per BR-INV-63 and Phase 03 Order 2.
// Uses number_series table with SELECT FOR UPDATE to prevent duplicates or gaps.
// Unified allocate(tx, options) for typed inventory vouchers, generic records, and custom patterns.

import type { Db } from '../db/prisma';

export const DOC_PREFIX: Record<string, string> = {
  // Inventory core vouchers
  'inv-opening': 'OPN',
  'inv-transactions': 'TXN',
  'inv-adjustment': 'ADJ',
  'inv-transfer': 'TRF',
  // Inventory extended
  'inv-reservation': 'RES',
  'inv-reconciliation': 'RCN',
  'inv-valuation': 'VAL',
  'inv-valuation:reval': 'REV',
  'inv-reorder:suggestion': 'RSG',
  'inv-holds': 'HLD',
  'inv-batch': 'BT',
  // WMS operations
  'wms-putaway': 'PUT',
  'wms-pick': 'PCK',
  'wms-pick:wave': 'WAV',
  'wms-packing': 'PAK',
  'wms-cycle': 'CYC',
  'wms-physical': 'PHY',
  'wms-transfer': 'WTR',
  // Procurement (Phase 9)
  'scm-pr': 'PR',
  'scm-rfq': 'RFQ',
  'scm-vendorquote': 'VQ',
  'scm-comparison': 'CMP',
  'scm-po': 'PO',
  'scm-contracts': 'CON',
  'scm-grn': 'GRN',
  'scm-purchaseinvoice': 'PINV',
  'scm-purchaseinvoice:rcm': 'SINV',
  'scm-debitnote': 'PDN',
  'fin-ap': 'SPP',
  'fin-ap:pay': 'SPAY',
  'scm-evaluation': 'EVL',
  // CRM & Sales (Phase 10)
  'crm-leads': 'LD',
  'crm-opportunities': 'OPP',
  'crm-followups': 'FU',
  'crm-meetings': 'MTG',
  'crm-feedback': 'FB',
  'sales-rfq': 'CRFQ',
  'sales-quotations': 'QT',
  'sales-orders': 'SO',
  'sales-dispatch': 'DC',
  'sales-invoices': 'INV',
  'sales-collections': 'RCT',
  'sales-returns': 'SRT',
  'sales-returns:cn': 'CN',
};

export interface AllocateOptions {
  docType?: string;
  pageId?: string;
  unitId: string;
  fyId: string;
  prefix?: string;
  suffix?: string;
  padding?: number;
  pattern?: string;
  date?: Date | string;
}

export interface AllocateDetails {
  code: string;
  number: number;
  prefix: string;
  suffix: string;
  pattern: string;
  padding: number;
  unitCode: string;
  fyCode: string;
}

interface NumberSeriesRow {
  next_value: number;
  prefix: string | null;
  suffix: string | null;
  pattern: string | null;
  padding: number | null;
  reset_frequency: string | null;
}

/**
 * Replaces placeholders in a numbering pattern:
 * - {prefix}
 * - {suffix}
 * - {unit}
 * - {fy}
 * - {number} or {number:N}
 * - {year}, {month}, {date} / {day}
 */
export function formatNumberPattern(
  pattern: string,
  tokens: {
    prefix: string;
    suffix: string;
    unit: string;
    fy: string;
    number: number;
    defaultPadding?: number;
    date?: Date;
  },
): string {
  const pad = tokens.defaultPadding ?? 4;
  let result = pattern;

  result = result.replace(/\{prefix\}/g, tokens.prefix);
  result = result.replace(/\{suffix\}/g, tokens.suffix);
  result = result.replace(/\{unit\}/g, tokens.unit);
  result = result.replace(/\{fy\}/g, tokens.fy);

  result = result.replace(/\{number(?::(\d+))?\}/g, (_match, digits) => {
    const p = digits ? parseInt(digits, 10) : pad;
    return String(tokens.number).padStart(p, '0');
  });

  if (tokens.date) {
    const y = tokens.date.getUTCFullYear();
    const m = String(tokens.date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(tokens.date.getUTCDate()).padStart(2, '0');
    result = result.replace(/\{year\}/g, String(y));
    result = result.replace(/\{month\}/g, m);
    result = result.replace(/\{date\}|\{day\}/g, d);
  }

  return result;
}

export const NumberingService = {
  /**
   * Allocates the next gap-free document number in a transaction with SELECT FOR UPDATE.
   * Returns the formatted document code string (e.g. OPN/TAL/26-27/0001).
   */
  async allocate(tx: Db, opts: AllocateOptions): Promise<string> {
    const details = await this.allocateDetails(tx, opts);
    return details.code;
  },

  /**
   * Allocates the next number and returns full breakdown including the sequence number.
   */
  async allocateDetails(tx: Db, opts: AllocateOptions): Promise<AllocateDetails> {
    const pageId = opts.pageId ?? opts.docType;
    if (!pageId) {
      throw new Error('allocate requires either pageId or docType');
    }

    // 1. Ensure series row exists
    await tx.$executeRaw`
      INSERT INTO number_series (page_id, unit_id, fy_id, next_value)
      VALUES (${pageId}, ${opts.unitId}::uuid, ${opts.fyId}::uuid, 1)
      ON CONFLICT (page_id, unit_id, fy_id) DO NOTHING`;

    // 2. Lock and retrieve current value + settings
    const rows = await tx.$queryRaw<NumberSeriesRow[]>`
      SELECT next_value, prefix, suffix, pattern, padding, reset_frequency
      FROM number_series
      WHERE page_id = ${pageId} AND unit_id = ${opts.unitId}::uuid AND fy_id = ${opts.fyId}::uuid
      FOR UPDATE`;

    const row = rows[0];
    const seq = row?.next_value ?? 1;

    // 3. Bump the sequence
    await tx.$executeRaw`
      UPDATE number_series
      SET next_value = ${seq + 1}, updated_at = NOW()
      WHERE page_id = ${pageId} AND unit_id = ${opts.unitId}::uuid AND fy_id = ${opts.fyId}::uuid`;

    // 4. Resolve Unit code and FY code
    const [unit, fy] = await Promise.all([
      tx.unit.findUniqueOrThrow({
        where: { id: opts.unitId },
        select: { code: true },
      }),
      tx.financialYear.findUniqueOrThrow({
        where: { id: opts.fyId },
        select: { code: true },
      }),
    ]);

    const prefix = opts.prefix || row?.prefix || DOC_PREFIX[pageId] || pageId.toUpperCase();
    const suffix = opts.suffix || row?.suffix || '';
    const padding = opts.padding ?? row?.padding ?? 4;
    const fyPart = fy.code.length > 4 && fy.code.startsWith('20') ? fy.code.slice(2) : fy.code;

    const dateObj = opts.date
      ? typeof opts.date === 'string'
        ? new Date(opts.date)
        : opts.date
      : undefined;

    let code: string;
    const customDbPattern =
      row?.pattern && row.pattern !== '{prefix}/{unit}/{fy}/{number:4}' ? row.pattern : null;
    const pattern = customDbPattern || opts.pattern;
    if (pattern && pattern !== '{prefix}/{unit}/{fy}/{number:4}') {
      code = formatNumberPattern(pattern, {
        prefix,
        suffix,
        unit: unit.code,
        fy: fyPart,
        number: seq,
        defaultPadding: padding,
        date: dateObj,
      });
    } else {
      // Standard format: <PFX>/<UNIT>/<FY>/<0001>
      code = `${prefix}/${unit.code}/${fyPart}/${String(seq).padStart(padding, '0')}`;
    }

    return {
      code,
      number: seq,
      prefix,
      suffix,
      pattern: pattern ?? '{prefix}/{unit}/{fy}/{number:4}',
      padding,
      unitCode: unit.code,
      fyCode: fy.code,
    };
  },

  /**
   * Backwards compatible next() function.
   */
  async next(tx: Db, a: { docType: string; unitId: string; fyId: string }): Promise<string> {
    return this.allocate(tx, { docType: a.docType, unitId: a.unitId, fyId: a.fyId });
  },
};
