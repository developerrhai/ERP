// Barcode scan + GS1 (Phase 8 step 10, BR-INV-59/60). The endpoint reads one scanned text and says what it is
// (item / batch / serial / bin), checks the context rule and logs a scan event. It NEVER posts stock: the screen
// that called it does that through the normal vouchers.
import { prisma } from '../../core/db/prisma';
import type { Caller } from '../records/service';

/** EAN-13 / UPC-A / GTIN-14 / GTIN-8 check digit: weights 3,1,3,1,... from the digit left of the check digit. */
export function checkDigitOk(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const body = code.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === Number(code[code.length - 1]);
}

/** FNC1 / group separator (ASCII 29) in machine-read GS1 strings. */
const GS = String.fromCharCode(29);

export interface Gs1 {
  gtin?: string;
  batch?: string;
  expiry?: string;
  bestBefore?: string;
  serial?: string;
  count?: number;
}

const FIXED: Record<string, number> = { '01': 14, '17': 6, '15': 6 };
const VARIABLE: Record<string, number> = { '10': 20, '21': 20, '30': 8, '37': 8 };

/** YYMMDD -> YYYY-MM-DD. YY 00-50 -> 20YY, 51-99 -> 19YY. DD 00 = last day of the month. null when not a real date. */
export function gs1Date(yymmdd: string): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  let dd = Number(yymmdd.slice(4, 6));
  const year = yy <= 50 ? 2000 + yy : 1900 + yy;
  if (mm < 1 || mm > 12) return null;
  const last = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  if (dd === 0) dd = last;
  if (dd > last) return null;
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** Parse a GS1 element string, human "(01)...(10)..." or machine "01...10<GS>..."; null if it is not one; throws on a bad AI. */
export function parseGs1(raw: string): Gs1 | null {
  const text = raw.replace(/<GS>|\]d2/g, GS).trim();
  const out: Gs1 = {};
  const set = (ai: string, v: string) => {
    if (ai === '01') out.gtin = v;
    else if (ai === '10') out.batch = v;
    else if (ai === '17') out.expiry = gs1Date(v) ?? undefined;
    else if (ai === '15') out.bestBefore = gs1Date(v) ?? undefined;
    else if (ai === '21') out.serial = v;
    else out.count = Number(v);
  };
  if (/^\(\d{2}\)/.test(text)) {
    const re = /\((\d{2})\)([^(]*)/g;
    let m: RegExpExecArray | null;
    let any = false;
    while ((m = re.exec(text))) {
      any = true;
      const ai = m[1]!;
      if (!(ai in FIXED) && !(ai in VARIABLE)) throw new Error(`Unsupported AI ${ai}`);
      set(ai, m[2]!.split(GS).join(''));
    }
    return any ? out : null;
  }
  if (!/^01\d{14}/.test(text) && !text.includes(GS)) return null;
  let i = 0;
  while (i < text.length) {
    if (text[i] === GS) {
      i += 1;
      continue;
    }
    const ai = text.slice(i, i + 2);
    i += 2;
    if (ai in FIXED) {
      const len = FIXED[ai]!;
      set(ai, text.slice(i, i + len));
      i += len;
    } else if (ai in VARIABLE) {
      let end = text.indexOf(GS, i);
      if (end === -1) end = text.length;
      set(ai, text.slice(i, Math.min(end, i + VARIABLE[ai]!)));
      i = Math.min(end, i + VARIABLE[ai]!);
    } else {
      throw new Error(`Unsupported AI ${ai}`);
    }
  }
  return out;
}

export type ScanContext = 'LOOKUP' | 'RECEIVE' | 'COUNT' | 'TRANSFER' | 'ISSUE';

export interface ScanResult {
  valid: boolean;
  kind: 'ITEM' | 'BATCH' | 'SERIAL' | 'BIN' | 'UNKNOWN';
  message: string;
  item?: { id: string; code: string; name: string; baseUom: string };
  batch?: { id: string; batchNo: string; expiryDate: string | null; qcStatus: string };
  serial?: { id: string; serialNo: string; status: string };
  bin?: { id: string; code: string; warehouseId: string };
  gs1?: Gs1;
}

export async function scan(
  caller: Caller,
  p: { raw: string; context: ScanContext; warehouseId?: string; expectItemId?: string },
): Promise<ScanResult> {
  const raw = p.raw.trim();
  const log = async (r: ScanResult) => {
    await prisma.scanEvent.create({
      data: {
        raw: raw.slice(0, 300),
        context: p.context,
        resultKind: r.kind,
        valid: r.valid,
        message: r.message.slice(0, 200),
        itemId: r.item?.id ?? null,
        batchId: r.batch?.id ?? null,
        binId: r.bin?.id ?? null,
        createdById: caller.auth.userId,
      },
    });
    return r;
  };
  if (!raw) return log({ valid: false, kind: 'UNKNOWN', message: 'Nothing was scanned.' });

  // 1. A bin code in the warehouse.
  if (p.warehouseId) {
    const bin = await prisma.wmsBin.findFirst({
      where: { warehouseId: p.warehouseId, code: raw.toUpperCase(), deletedAt: null },
    });
    if (bin)
      return log({
        valid: true,
        kind: 'BIN',
        message: `Bin ${bin.code}`,
        bin: { id: bin.id, code: bin.code, warehouseId: bin.warehouseId },
      });
  }

  // 2. A GS1 element string.
  let gs1: Gs1 | null = null;
  try {
    gs1 = parseGs1(raw);
  } catch (e) {
    return log({
      valid: false,
      kind: 'UNKNOWN',
      message: e instanceof Error ? e.message : 'Unreadable GS1 code.',
    });
  }
  const code = gs1?.gtin ?? raw;
  if (gs1?.gtin && !checkDigitOk(gs1.gtin))
    return log({
      valid: false,
      kind: 'UNKNOWN',
      message: 'The barcode check digit is wrong.',
      gs1,
    });

  const item = await findItem(code, gs1?.gtin);
  const result: ScanResult = {
    valid: true,
    kind: 'UNKNOWN',
    message: 'Unknown code.',
    ...(gs1 ? { gs1 } : {}),
  };
  if (item) {
    result.kind = 'ITEM';
    result.item = { id: item.id, code: item.code, name: item.name, baseUom: item.baseUom };
    result.message = `${item.code} · ${item.name}`;
    if (gs1?.batch) {
      const b = await prisma.batch.findFirst({ where: { itemId: item.id, batchNo: gs1.batch } });
      if (b) {
        result.kind = 'BATCH';
        result.batch = {
          id: b.id,
          batchNo: b.batchNo,
          expiryDate: b.expiryDate ? b.expiryDate.toISOString().slice(0, 10) : null,
          qcStatus: b.qcStatus,
        };
        if (gs1.expiry && result.batch.expiryDate && gs1.expiry !== result.batch.expiryDate) {
          result.valid = false;
          result.message = 'Expiry does not match the batch.';
        } else result.message += ` · batch ${b.batchNo}`;
      } else {
        result.message += ` · new batch ${gs1.batch}`;
      }
    }
    if (gs1?.serial) {
      const s = await prisma.serialNumber.findUnique({
        where: { itemId_serialNo: { itemId: item.id, serialNo: gs1.serial } },
      });
      if (s) {
        result.kind = 'SERIAL';
        result.serial = { id: s.id, serialNo: s.serialNo, status: s.status };
      }
    }
  } else {
    // 3. A batch number (RECEIVE/COUNT), a serial number or an item code typed in full.
    const batch = await prisma.batch.findFirst({ where: { batchNo: raw } });
    const serial = await prisma.serialNumber.findFirst({ where: { serialNo: raw } });
    if (serial) {
      const it = await prisma.item.findUnique({ where: { id: serial.itemId } });
      result.kind = 'SERIAL';
      result.serial = { id: serial.id, serialNo: serial.serialNo, status: serial.status };
      if (it) result.item = { id: it.id, code: it.code, name: it.name, baseUom: it.baseUom };
      result.message = `Serial ${serial.serialNo} · ${serial.status}`;
    } else if (batch) {
      const it = await prisma.item.findUnique({ where: { id: batch.itemId } });
      result.kind = 'BATCH';
      result.batch = {
        id: batch.id,
        batchNo: batch.batchNo,
        expiryDate: batch.expiryDate ? batch.expiryDate.toISOString().slice(0, 10) : null,
        qcStatus: batch.qcStatus,
      };
      if (it) result.item = { id: it.id, code: it.code, name: it.name, baseUom: it.baseUom };
      result.message = `Batch ${batch.batchNo}`;
    }
  }
  // Context rules.
  if (result.valid && result.item) {
    if (
      result.item &&
      p.context === 'RECEIVE' &&
      !(await prisma.item.findFirst({
        where: { id: result.item.id, status: 'ACTIVE', deletedAt: null },
      }))
    ) {
      result.valid = false;
      result.message = 'This item is inactive.';
    }
    if (result.valid && p.expectItemId && result.item.id !== p.expectItemId) {
      result.valid = false;
      result.message = 'Wrong item for this line.';
    }
  }
  if (result.kind === 'UNKNOWN') result.valid = false;
  return log(result);
}

async function findItem(code: string, gtin?: string) {
  const candidates = new Set<string>([code]);
  if (gtin && gtin.length === 14 && gtin.startsWith('0')) candidates.add(gtin.slice(1));
  for (const c of candidates) {
    const byItem = await prisma.item.findFirst({ where: { barcode: c, deletedAt: null } });
    if (byItem) return byItem;
  }
  return prisma.item.findFirst({ where: { code: code.toUpperCase(), deletedAt: null } });
}
