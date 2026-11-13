// Phase 9: goods receipt against a PO (batch / serial, landed cost, Quality Inspection hold), the QC decision
// (qcDecide) and put-away tasks. One transaction per action; stock through StockService, GL through
// PostingService, numbers through NumberingService (allocated when the draft is created).
//
// Where stock waits for inspection: Phase 8 stock STATUS "Quality Inspection" in the receiving warehouse
// (client requirement 4 / Phase 8 report), not a separate QC-hold warehouse. Accepted -> Unrestricted,
// rejected -> Blocked. scm_unit_settings.qc_hold_warehouse_id is kept for Phase 12 but is not used here.
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { AppError, Errors } from '../../core/http/errors';
import { assertCanPost } from '../../core/posting';
import { PostingService } from '../finance/posting-service';
import type { EventLine } from '../finance/posting-service';
import { notificationService } from '../notifications/service';
import type { Caller } from '../records/service';
import { D, ZERO, round2, round3, str } from '../inventory/money';
import type { Dec } from '../inventory/money';
import { StockService } from '../inventory/stock/stock-service';
import type { StockMoveInput } from '../inventory/stock/stock-service';
import { NO_ID } from '../inventory/stock/stock-service';
import { UomService } from '../inventory/uom/uom-service';
import { concreteUnit } from '../inventory/typed';
import {
  TX,
  allocateNumber,
  assertEditable,
  audit,
  checkVersion,
  departmentOf,
  exec,
  fyOfCaller,
  insertRow,
  loadDoc,
  loadLines,
  norm,
  pageRecipients,
  query,
  registerDoc,
  scopeSql,
  settings,
  updateRow,
} from './core';
import { S } from './core';
import type { DocDef, Actor, Row } from './core';
import { maxReceivable, splitAmount } from './math';
import { QmsInboundPort } from './qms-port';
import { assertReleased } from './po-service';

/** Receipts of one PO are posted one after the other: the first statement of every GRN transaction. */
export async function lockPoOfGrn(tx: Db, grnId: string): Promise<void> {
  const r = (await query(tx, `SELECT po_id::text FROM goods_receipts WHERE id=$1::uuid`, grnId))[0];
  if (r)
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `po:${S(r.po_id)}`);
}

export const GRN_DEF: DocDef = {
  pageId: 'scm-grn',
  table: 'goods_receipts',
  title: 'Goods Receipt',
  amountCol: 'total_value',
  preLock: (tx, id) => lockPoOfGrn(tx, id),
  linesTable: 'goods_receipt_lines',
  parentCol: 'grn_id',
  async afterApproved(tx, id, actor) {
    if ((await settings(tx)).postOnApprove) await postGrn(tx, id, actor);
  },
};
registerDoc(GRN_DEF);

export interface GrnBatchIn {
  batchNo: string;
  mfgDate?: string | null;
  expiryDate?: string | null;
  qty: string;
  serialNos?: string[] | null;
}
export interface GrnLineIn {
  poLineId: string;
  receivedQty: string;
  weight?: string | null;
  batches?: GrnBatchIn[];
  serialNos?: string[] | null;
}
export interface GrnChargeIn {
  chargeType: string;
  amount: string;
  basis?: 'VALUE' | 'QTY' | 'WEIGHT';
  capitalize?: boolean;
  supplierId?: string | null;
}
export interface GrnBody {
  poId: string;
  warehouseId: string;
  receiptDate?: string;
  vehicleNo?: string | null;
  lrNo?: string | null;
  vendorInvoiceRef?: string | null;
  notes?: string | null;
  lines: GrnLineIn[];
  charges?: GrnChargeIn[];
}

interface ItemInfo {
  id: string;
  code: string;
  item_type: string;
  batch_tracked: boolean;
  serial_tracked: boolean;
  qc_required: boolean;
}

/** Batch / serial rules (BATCH_REQUIRED, BATCH_QTY_MISMATCH, SERIAL_MISMATCH). baseQty is the received base quantity. */
export function checkTracking(item: ItemInfo, baseQty: Dec, line: GrnLineIn): void {
  if (item.batch_tracked) {
    const batches = line.batches ?? [];
    if (batches.length === 0)
      throw new AppError(422, 'BATCH_REQUIRED', `Enter batch numbers for ${item.code}.`, {
        batches: `Enter batch numbers for ${item.code}.`,
      });
    const sum = batches.reduce((a, b) => a.plus(D(b.qty)), ZERO);
    if (!sum.equals(baseQty))
      throw new AppError(
        422,
        'BATCH_QTY_MISMATCH',
        `Batch quantities add up to ${str(sum)}, received is ${str(baseQty)}.`,
        { batches: `Batch quantities add up to ${str(sum)}, received is ${str(baseQty)}.` },
      );
  } else if (item.serial_tracked) {
    const serials = line.serialNos ?? [];
    const uniq = new Set(serials.map((s) => s.trim()));
    if (
      serials.length !== Number(baseQty.toFixed(0)) ||
      !baseQty.isInteger() ||
      uniq.size !== serials.length
    )
      throw new AppError(422, 'SERIAL_MISMATCH', `Enter exactly ${str(baseQty)} serial numbers.`, {
        serialNos: `Enter exactly ${str(baseQty)} serial numbers.`,
      });
  }
}

async function itemInfo(db: Db, itemId: string): Promise<ItemInfo> {
  const r = (
    await query(
      db,
      `SELECT id::text, code, item_type, batch_tracked, serial_tracked, qc_required FROM items WHERE id=$1::uuid`,
      itemId,
    )
  )[0];
  if (!r) throw Errors.validation({ itemId: 'Unknown item.' });
  return r as unknown as ItemInfo;
}

async function qcRequiredFor(db: Db, item: ItemInfo, supplierId: string): Promise<boolean> {
  if (item.qc_required) return true;
  const r = (
    await query(
      db,
      `SELECT quality_hold FROM supplier_items WHERE supplier_id=$1::uuid AND item_id=$2::uuid`,
      supplierId,
      item.id,
    )
  )[0];
  return r?.quality_hold === true;
}

// ----------------------------------------------------------------------------------------------- save
async function saveGrn(caller: Caller, id: string | null, ifMatch: number | undefined, b: GrnBody) {
  const unitId = concreteUnit(caller);
  const fy = await fyOfCaller(caller);
  const outId = await prisma.$transaction(async (tx) => {
    let cur: Row | null = null;
    if (id) {
      cur = await loadDoc(tx, caller, GRN_DEF, id, { lock: true });
      assertEditable(cur, 'goods receipt');
      checkVersion(cur, ifMatch);
    }
    const po = (
      await query(
        tx,
        `SELECT * FROM purchase_orders WHERE id=$1::uuid AND deleted_at IS NULL AND unit_id=$2::uuid`,
        b.poId,
        unitId,
      )
    )[0];
    if (!po)
      throw new AppError(
        422,
        'GRN_PO_REQUIRED',
        'Receive against a Purchase Order. Ask Purchase to create one first.',
        { poId: 'Choose a purchase order.' },
      );
    assertReleased(po);
    const wh = (
      await query(
        tx,
        `SELECT unit_id::text FROM warehouses WHERE id=$1::uuid AND deleted_at IS NULL`,
        b.warehouseId,
      )
    )[0];
    if (!wh || wh.unit_id !== unitId)
      throw Errors.validation({ warehouseId: 'Choose a warehouse of this unit.' });
    if (b.lines.length === 0) throw Errors.validation({ lines: 'Add at least one line.' });
    const out: Row[] = [];
    let total = ZERO;
    const seen = new Set<string>();
    for (let i = 0; i < b.lines.length; i += 1) {
      const l = b.lines[i]!;
      const at = (f: string) => `lines.${i}.${f}`;
      if (seen.has(l.poLineId))
        throw Errors.validation({ [at('poLineId')]: 'This PO line is already on the receipt.' });
      seen.add(l.poLineId);
      const pl = (
        await query(
          tx,
          `SELECT * FROM purchase_order_lines WHERE id=$1::uuid AND po_id=$2::uuid`,
          l.poLineId,
          b.poId,
        )
      )[0];
      if (!pl)
        throw Errors.validation({ [at('poLineId')]: 'This line is not on the purchase order.' });
      if (!pl.item_id)
        throw Errors.validation({
          [at('poLineId')]: 'A service line is not received; bill it directly.',
        });
      const rq = D(l.receivedQty);
      if (rq.lte(0))
        throw Errors.validation({ [at('receivedQty')]: 'Enter a quantity greater than 0.' });
      const item = await itemInfo(tx, S(pl.item_id));
      const conv = await UomService.toBase(tx, { itemId: item.id, uom: S(pl.uom), qty: rq });
      checkTracking(item, conv.baseQty, l);
      const taxable = round2(rq.mul(D(S(norm(pl).netRate))));
      total = total.plus(taxable);
      out.push({
        poLineId: l.poLineId,
        itemId: item.id,
        uom: pl.uom,
        receivedQty: str(rq),
        baseQty: str(conv.baseQty),
        qcRequired: await qcRequiredFor(tx, item, S(po.supplier_id)),
        qcState: (await qcRequiredFor(tx, item, S(po.supplier_id))) ? 'PENDING' : 'NOT_REQUIRED',
        rate: norm(pl).netRate,
        taxableValue: str(taxable),
        stockValue: str(taxable),
        weight: l.weight ?? null,
        _batches: l.batches ?? [],
        _serials: l.serialNos ?? [],
      });
    }
    const header: Row = {
      poId: b.poId,
      supplierId: po.supplier_id,
      warehouseId: b.warehouseId,
      receiptDate: b.receiptDate ?? new Date().toISOString().slice(0, 10),
      vehicleNo: b.vehicleNo ?? null,
      lrNo: b.lrNo ?? null,
      vendorInvoiceRef: b.vendorInvoiceRef ?? null,
      notes: b.notes ?? null,
      totalValue: str(total),
    };
    let grnId = id;
    let number = cur ? S(cur.number) : '';
    if (!grnId) {
      number = await allocateNumber(tx, GRN_DEF, unitId, fy.id);
      grnId = await insertRow(tx, 'goods_receipts', {
        ...header,
        unitId,
        fyId: fy.id,
        number,
        department: await departmentOf(tx, GRN_DEF.pageId, caller),
        status: 'Draft',
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
    } else {
      await updateRow(tx, 'goods_receipts', grnId, {
        ...header,
        updatedAt: new Date(),
        updatedById: caller.auth.userId,
      });
      await exec(tx, `UPDATE goods_receipts SET version = version + 1 WHERE id=$1::uuid`, grnId);
      await exec(tx, `DELETE FROM goods_receipt_lines WHERE grn_id=$1::uuid`, grnId);
      await exec(tx, `DELETE FROM goods_receipt_charges WHERE grn_id=$1::uuid`, grnId);
    }
    let n = 0;
    for (const l of out) {
      n += 1;
      const { _batches, _serials, ...cols } = l as Row & {
        _batches: GrnBatchIn[];
        _serials: string[];
      };
      const lid = await insertRow(tx, 'goods_receipt_lines', { ...cols, grnId, lineNo: n });
      const item = await itemInfo(tx, S(cols.itemId));
      if (item.batch_tracked)
        for (const bt of _batches)
          await insertRow(tx, 'goods_receipt_batches', {
            grnLineId: lid,
            batchNo: bt.batchNo.trim(),
            mfgDate: bt.mfgDate ?? null,
            expiryDate: bt.expiryDate ?? null,
            qty: bt.qty,
            serialNos: null,
          });
      else if (item.serial_tracked)
        await insertRow(tx, 'goods_receipt_batches', {
          grnLineId: lid,
          batchNo: '-',
          qty: S(cols.baseQty),
          serialNos: _serials.map((s) => s.trim()),
        });
    }
    for (const c of b.charges ?? []) {
      if (D(c.amount).lt(0)) throw Errors.validation({ charges: 'A charge cannot be negative.' });
      await insertRow(tx, 'goods_receipt_charges', {
        grnId,
        chargeType: c.chargeType,
        amount: c.amount,
        basis: c.basis ?? 'VALUE',
        capitalize: c.capitalize ?? true,
        supplierId: c.supplierId ?? null,
      });
    }
    await audit(
      tx,
      caller,
      caller.auth.userId,
      id ? 'SCM_UPDATED' : 'SCM_CREATED',
      GRN_DEF.title,
      { id: grnId, code: number },
      GRN_DEF.pageId,
      { unitId },
    );
    return grnId;
  }, TX);
  return getGrn(prisma, caller, outId);
}

export async function getGrn(db: Db, caller: Caller, id: string) {
  const h = await loadDoc(db, caller, GRN_DEF, id);
  const lines = await loadLines(db, GRN_DEF, id);
  const out = [];
  for (const l of lines) {
    const batches = await query(
      db,
      `SELECT * FROM goods_receipt_batches WHERE grn_line_id=$1::uuid ORDER BY batch_no`,
      l.id,
    );
    out.push({ ...norm<Row>(l), batches: batches.map((x) => norm<Row>(x)) });
  }
  const charges = await query(
    db,
    `SELECT * FROM goods_receipt_charges WHERE grn_id=$1::uuid ORDER BY created_at`,
    id,
  );
  const s = (await query(db, `SELECT name FROM suppliers WHERE id=$1::uuid`, h.supplier_id))[0];
  const p = (await query(db, `SELECT number FROM purchase_orders WHERE id=$1::uuid`, h.po_id))[0];
  return {
    ...norm<Row>(h),
    supplierName: s?.name,
    poNo: p?.number,
    lines: out,
    charges: charges.map((c) => norm<Row>(c)),
  };
}

// ----------------------------------------------------------------------------------------------- post
async function inventoryKeys(tx: Db): Promise<Map<string, string>> {
  // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
  const rows = await tx.itemTypeAccount.findMany();
  return new Map(rows.map((r) => [r.itemType, r.inventoryKey]));
}

export async function postGrn(tx: Db, id: string, actor: Actor): Promise<void> {
  await lockPoOfGrn(tx, id);
  const g = (
    await query(
      tx,
      `SELECT * FROM goods_receipts WHERE id=$1::uuid AND deleted_at IS NULL FOR UPDATE`,
      id,
    )
  )[0];
  if (!g) throw Errors.notFound('Record not found.');
  if (g.status === 'Posted') return;
  if (g.status !== 'Approved')
    throw Errors.conflict(
      'Submit the receipt for approval first; only an Approved receipt can be posted.',
    );
  const unitId = S(g.unit_id);
  const date = S(norm<Row>(g).receiptDate);
  await assertCanPost(tx, {
    unitId,
    fyId: S(g.fy_id),
    postingDate: date,
    documentStatus: 'Approved',
    allowedStatuses: ['Approved'],
    action: 'post',
  });
  const po = (
    await query(tx, `SELECT * FROM purchase_orders WHERE id=$1::uuid FOR UPDATE`, g.po_id)
  )[0]!;
  assertReleased(po);
  const lines = await loadLines(tx, GRN_DEF, id);
  // lock the PO lines in a fixed order
  await query(
    tx,
    `SELECT id FROM purchase_order_lines WHERE po_id=$1::uuid ORDER BY id FOR UPDATE`,
    g.po_id,
  );
  const set = await settings(tx);
  const charges = await query(tx, `SELECT * FROM goods_receipt_charges WHERE grn_id=$1::uuid`, id);

  // 1. over-receipt, tracking, landed cost
  const prepared: { l: Row; pl: Row; item: ItemInfo; batches: Row[]; conv: Dec }[] = [];
  for (const l of lines) {
    const pl = (
      await query(tx, `SELECT * FROM purchase_order_lines WHERE id=$1::uuid`, l.po_line_id)
    )[0]!;
    const pn = norm<Row>(pl);
    const tol =
      pn.overReceiptPct !== null && pn.overReceiptPct !== undefined
        ? S(pn.overReceiptPct)
        : set.overReceiptPct;
    const cap = maxReceivable(D(S(pn.qty)), D(S(pn.closedQty)), D(tol));
    const afterQty = D(S(pn.receivedQty)).plus(D(S(norm<Row>(l).receivedQty)));
    if (afterQty.gt(cap))
      throw new AppError(
        409,
        'OVER_RECEIPT',
        `Received ${str(afterQty)} would exceed the allowed ${str(cap)} (ordered ${S(pn.qty)}, tolerance ${tol} %). Ask the buyer to amend the PO.`,
      );
    const item = await itemInfo(tx, S(l.item_id));
    const batches = await query(
      tx,
      `SELECT * FROM goods_receipt_batches WHERE grn_line_id=$1::uuid ORDER BY batch_no`,
      l.id,
    );
    const lin = norm<Row>(l);
    checkTracking(item, D(S(lin.baseQty)), {
      poLineId: S(l.po_line_id),
      receivedQty: S(lin.receivedQty),
      batches: batches.map((x) => {
        const b = norm<Row>(x);
        return { batchNo: S(b.batchNo), qty: S(b.qty) };
      }),
      serialNos: batches.flatMap((x) => (x.serial_nos as string[] | null) ?? []),
    });
    prepared.push({ l, pl, item, batches, conv: D(S(lin.baseQty)) });
  }
  const capitalised = charges.filter((c) => c.capitalize === true);
  const landedShare = new Map<string, Dec>();
  for (const c of capitalised) {
    const cn = norm<Row>(c);
    const weights = prepared.map((p) => {
      const ln = norm<Row>(p.l);
      return cn.basis === 'QTY'
        ? D(S(ln.baseQty))
        : cn.basis === 'WEIGHT'
          ? D(S(ln.weight ?? 0))
          : D(S(ln.taxableValue));
    });
    if (weights.every((w) => w.isZero()))
      throw Errors.validation({
        charges: `Cannot split the ${S(cn.chargeType)} charge: the ${S(cn.basis).toLowerCase()} is zero on every line.`,
      });
    const shares = splitAmount(D(S(cn.amount)), weights);
    prepared.forEach((p, i) =>
      landedShare.set(S(p.l.id), (landedShare.get(S(p.l.id)) ?? ZERO).plus(shares[i]!)),
    );
  }

  // 2. stock IN (QI hold or unrestricted) + journal legs
  const keyMap = await inventoryKeys(tx);
  const invByKey = new Map<string, Dec>();
  let grirTotal = ZERO;
  let landedTotal = ZERO;
  const qcLines: string[] = [];
  const posted: {
    grnLineId: string;
    itemId: string;
    baseQty: string;
    qcRequired: boolean;
    batchIds: string[];
  }[] = [];
  let ledgerValue = ZERO;
  for (const p of prepared) {
    const ln = norm<Row>(p.l);
    const landed = landedShare.get(S(p.l.id)) ?? ZERO;
    const taxable = D(S(ln.taxableValue));
    const stockValue = taxable.plus(landed);
    const unitCost = stockValue.div(p.conv).toDecimalPlaces(6, 4);
    const qc = p.l.qc_required === true;
    const status = qc ? 'QUALITY_INSPECTION' : 'UNRESTRICTED';
    const parts = p.item.batch_tracked
      ? p.batches.map((b) => ({ b, qty: D(S(norm<Row>(b).qty)) }))
      : [{ b: null as Row | null, qty: p.conv }];
    const values = splitAmount(
      stockValue,
      parts.map((x) => x.qty),
    );
    const batchIds: string[] = [];
    for (let k = 0; k < parts.length; k += 1) {
      const part = parts[k]!;
      const bn = part.b ? norm<Row>(part.b) : null;
      const move: StockMoveInput = {
        warehouseId: S(g.warehouse_id),
        itemId: p.item.id,
        direction: 'IN',
        qty: part.qty,
        postingDate: date,
        voucherType: 'GRN',
        voucherId: id,
        voucherNo: S(g.number),
        createdById: actor.userId,
        value: values[k]!,
        rate: unitCost,
        stockStatus: status,
        ...(bn && p.item.batch_tracked
          ? {
              batch: {
                batchNo: S(bn.batchNo),
                mfgDate: (bn.mfgDate as string | null) ?? null,
                expiryDate: (bn.expiryDate as string | null) ?? null,
                grnRef: S(g.number),
              },
            }
          : {}),
        ...(p.item.serial_tracked
          ? { serialNos: p.batches.flatMap((x) => (x.serial_nos as string[] | null) ?? []) }
          : {}),
      };
      const res = await StockService.postMovement(tx, move);
      const e = res.entries[0]!;
      ledgerValue = ledgerValue.plus(e.value);
      if (e.batchId) {
        batchIds.push(e.batchId);
        if (part.b)
          await exec(
            tx,
            `UPDATE goods_receipt_batches SET batch_id=$1::uuid WHERE id=$2::uuid`,
            e.batchId,
            S(part.b.id),
          );
        if (qc)
          await exec(
            tx,
            `UPDATE batches SET qc_status='Pending QC' WHERE id=$1::uuid AND qc_status='Released' AND NOT EXISTS (SELECT 1 FROM stock_slices s WHERE s.batch_id = batches.id AND s.stock_status='UNRESTRICTED' AND s.qty > 0)`,
            e.batchId,
          );
      }
    }
    const key = keyMap.get(p.item.item_type) ?? 'INVENTORY_RM';
    invByKey.set(key, (invByKey.get(key) ?? ZERO).plus(stockValue));
    grirTotal = grirTotal.plus(taxable);
    landedTotal = landedTotal.plus(landed);
    await exec(
      tx,
      `UPDATE goods_receipt_lines SET landed_charge=$1::numeric, stock_value=$2::numeric, unit_cost=$3::numeric,
              accepted_qty = $4::numeric, qc_state = $5 WHERE id=$6::uuid`,
      str(landed),
      str(stockValue),
      str(unitCost),
      qc ? '0' : str(D(S(ln.receivedQty))),
      qc ? 'PENDING' : 'NOT_REQUIRED',
      S(p.l.id),
    );
    await exec(
      tx,
      `UPDATE purchase_order_lines SET received_qty = received_qty + $1::numeric, accepted_qty = accepted_qty + $2::numeric WHERE id=$3::uuid`,
      str(D(S(ln.receivedQty))),
      qc ? '0' : str(D(S(ln.receivedQty))),
      S(p.pl.id),
    );
    if (qc) qcLines.push(S(p.item.code));
    posted.push({
      grnLineId: S(p.l.id),
      itemId: p.item.id,
      baseQty: str(p.conv),
      qcRequired: qc,
      batchIds,
    });
  }

  // 3. journal: Dr INVENTORY_* stock value / Cr GRIR (PO value) / Cr LANDED_COST_CLEARING
  const total = [...invByKey.values()].reduce((a, v) => a.plus(v), ZERO);
  if (!round2(total).equals(round2(ledgerValue)))
    throw new Error(
      `GRN ${S(g.number)}: stock ledger ${str(ledgerValue)} differs from journal ${str(total)}`,
    );
  const jl: EventLine[] = [];
  for (const [key, v] of invByKey)
    jl.push({ account: key, debit: str(round2(v)), credit: '0.00', unitId });
  jl.push({ account: 'GRIR', debit: '0.00', credit: str(round2(grirTotal)), unitId });
  if (landedTotal.gt(0))
    jl.push({
      account: 'LANDED_COST_CLEARING',
      debit: '0.00',
      credit: str(round2(landedTotal)),
      unitId,
    });
  const journal = await PostingService.postJournal(
    tx,
    {
      unitId,
      docDate: date,
      voucherType: 'Goods Receipt',
      source: 'EVENT',
      narration: `Goods receipt ${S(g.number)}`,
      sourceDocType: 'goods_receipt',
      sourceDocId: id,
      sourceDocNo: S(g.number),
      event: 'GRN_POST',
      payload: { docNo: S(g.number), lines: jl },
    },
    { userId: actor.userId },
  );

  // 4. put-away tasks for stock that is already usable
  let tasks = 0;
  for (const p of prepared) {
    if (p.l.qc_required === true) continue;
    tasks += await createPutawayTasks(
      tx,
      g,
      p.l,
      actor.userId,
      posted.find((x) => x.grnLineId === S(p.l.id))?.batchIds ?? [],
      D(S(norm<Row>(p.l).receivedQty)),
      p.conv,
    );
  }
  await exec(
    tx,
    `UPDATE goods_receipts SET status='Posted', posted_at=now(), journal_id=$1::uuid, total_value=$2::numeric, qc_status=$3, putaway_status=$4,
            updated_by_id=$5::uuid, updated_at=now(), version=version+1 WHERE id=$6::uuid`,
    journal.id,
    str(round2(total)),
    qcLines.length ? 'PENDING' : 'NONE',
    tasks ? 'PENDING' : 'NONE',
    actor.userId,
    id,
  );
  await QmsInboundPort.onGrnPosted(tx, { grnId: id, grnNo: S(g.number), unitId, lines: posted });
  await audit(
    tx,
    null,
    actor.userId,
    'SCM_POSTED',
    GRN_DEF.title,
    { id, code: S(g.number) },
    GRN_DEF.pageId,
    { journal: journal.code, qcLines: qcLines.length, putawayTasks: tasks },
  );
  const to = new Set<string>([S(po.created_by_id)]);
  if (qcLines.length) for (const u of await pageRecipients(tx, 'qms-incoming')) to.add(u);
  await notificationService.notify(tx, [...to], {
    type: 'SCM_GRN_POSTED',
    title: qcLines.length
      ? `Goods receipt ${S(g.number)}: stock in Quality Inspection (${qcLines.length} line(s))`
      : `Goods receipt ${S(g.number)} posted`,
    link: '/m/scm-grn',
    dedupeKey: `grn-posted:${id}`,
  });
}

// ----------------------------------------------------------------------------------------------- put-away
export async function suggestBin(
  tx: Db,
  warehouseId: string,
  itemId: string,
): Promise<string | null> {
  const r = (
    await query(
      tx,
      `SELECT b.id::text FROM wms_bins b
        LEFT JOIN stock_slices s ON s.bin_id = b.id AND s.item_id = $2::uuid AND s.qty > 0
       WHERE b.warehouse_id = $1::uuid AND b.status='Active' AND b.deleted_at IS NULL AND b.bin_type = 'Storage'
       GROUP BY b.id, b.code ORDER BY max(s.qty) DESC NULLS LAST, b.code LIMIT 1`,
      warehouseId,
      itemId,
    )
  )[0];
  return (r?.id as string | undefined) ?? null;
}

async function createPutawayTasks(
  tx: Db,
  g: Row,
  l: Row,
  userId: string,
  batchIds: string[],
  _recv: Dec,
  baseQty: Dec,
  only?: { batchId: string | null; qty: Dec }[],
): Promise<number> {
  const sug = await suggestBin(tx, S(g.warehouse_id), S(l.item_id));
  const targets =
    only ??
    (batchIds.length
      ? (
          await query(
            tx,
            `SELECT batch_id::text, qty::text FROM goods_receipt_batches WHERE grn_line_id=$1::uuid`,
            l.id,
          )
        ).map((x) => ({ batchId: x.batch_id as string | null, qty: D(S(x.qty)) }))
      : [{ batchId: null as string | null, qty: baseQty }]);
  let n = 0;
  for (const t of targets) {
    const taskNo = await allocateNumber(
      tx,
      { pageId: 'wms-putaway' } as DocDef,
      S(g.unit_id),
      S(g.fy_id),
    );
    await insertRow(tx, 'putaway_tasks', {
      unitId: g.unit_id,
      taskNo,
      grnId: g.id,
      grnLineId: l.id,
      itemId: l.item_id,
      batchId: t.batchId,
      qty: str(t.qty),
      warehouseId: g.warehouse_id,
      suggestedBinId: sug,
      status: 'Open',
      createdById: userId,
      updatedById: userId,
    });
    n += 1;
  }
  return n;
}

export const putaway = {
  async list(caller: Caller, q: { status?: string | undefined; page: number; size: number }) {
    const args: unknown[] = [];
    const where = [`t.unit_id IS NOT NULL`];
    if (caller.ctx.unitId) {
      args.push(caller.ctx.unitId);
      where.push(`t.unit_id = $${args.length}::uuid`);
    } else if (!caller.ctx.allUnits) where.push('false');
    if (q.status) {
      args.push(q.status);
      where.push(`t.status = $${args.length}`);
    }
    const rows = await query(
      prisma,
      `SELECT t.*, i.code AS item_code, i.name AS item_name, w.code AS warehouse_code, sb.code AS suggested_bin_code, ab.code AS actual_bin_code, g.number AS grn_no, g.posted_at AS grn_posted_at
        FROM putaway_tasks t JOIN items i ON i.id=t.item_id JOIN warehouses w ON w.id=t.warehouse_id JOIN goods_receipts g ON g.id=t.grn_id
        LEFT JOIN wms_bins sb ON sb.id=t.suggested_bin_id LEFT JOIN wms_bins ab ON ab.id=t.actual_bin_id
        WHERE ${where.join(' AND ')} ORDER BY t.priority, t.created_at LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    const total = Number(
      (
        await query(
          prisma,
          `SELECT count(*)::int AS n FROM putaway_tasks t WHERE ${where.join(' AND ')}`,
          ...args,
        )
      )[0]?.n ?? 0,
    );
    return { rows: rows.map((r) => norm(r)), total };
  },

  /** Claiming is one UPDATE ... WHERE status='Open' RETURNING: exactly one person wins. */
  async claim(caller: Caller, id: string) {
    const unitId = concreteUnit(caller);
    const r = await query(
      prisma,
      `UPDATE putaway_tasks SET status='Assigned', operator_id=$2::uuid, claimed_at=now(), version=version+1, updated_at=now(), updated_by_id=$2::uuid
        WHERE id=$1::uuid AND unit_id=$3::uuid AND status='Open' RETURNING id::text`,
      id,
      caller.auth.userId,
      unitId,
    );
    if (!r[0]) {
      const ex = (
        await query(
          prisma,
          `SELECT status FROM putaway_tasks WHERE id=$1::uuid AND unit_id=$2::uuid`,
          id,
          unitId,
        )
      )[0];
      if (!ex) throw Errors.notFound('Task not found.');
      throw Errors.conflict('Someone else already took this put-away task.');
    }
    return norm((await query(prisma, `SELECT * FROM putaway_tasks WHERE id=$1::uuid`, id))[0]!);
  },

  async complete(caller: Caller, id: string, body: { binId: string }) {
    const unitId = concreteUnit(caller);
    return prisma.$transaction(async (tx) => {
      const t = (
        await query(
          tx,
          `SELECT * FROM putaway_tasks WHERE id=$1::uuid AND unit_id=$2::uuid FOR UPDATE`,
          id,
          unitId,
        )
      )[0];
      if (!t) throw Errors.notFound('Task not found.');
      if (t.status !== 'Assigned' || t.operator_id !== caller.auth.userId)
        throw Errors.conflict(
          'Claim this task first; only the person who claimed it can complete it.',
        );
      const bin = (
        await query(
          tx,
          `SELECT warehouse_id::text, status FROM wms_bins WHERE id=$1::uuid AND deleted_at IS NULL`,
          body.binId,
        )
      )[0];
      if (!bin || bin.warehouse_id !== t.warehouse_id || bin.status !== 'Active')
        throw Errors.validation({ binId: 'Scan a bin of this warehouse.' });
      const g = (await query(tx, `SELECT * FROM goods_receipts WHERE id=$1::uuid`, t.grn_id))[0]!;
      const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
      const common = {
        warehouseId: S(t.warehouse_id),
        itemId: S(t.item_id),
        qty: D(S(t.qty)),
        postingDate: today,
        voucherType: 'PUTAWAY' as const,
        voucherId: id,
        voucherNo: S(t.task_no),
        createdById: caller.auth.userId,
        batchId: (t.batch_id as string | null) ?? null,
        corrective: true,
      };
      const item = await itemInfo(tx, S(t.item_id));
      const serials = item.serial_tracked
        ? (
            await query(
              tx,
              `SELECT serial_nos FROM goods_receipt_batches WHERE grn_line_id=$1::uuid`,
              t.grn_line_id,
            )
          ).flatMap((x) => (x.serial_nos as string[] | null) ?? [])
        : null;
      const out = await StockService.postMovement(tx, {
        ...common,
        direction: 'OUT',
        binId: (t.from_bin_id as string | null) ?? null,
        ...(serials ? { serialNos: serials } : {}),
      });
      await StockService.postMovement(tx, {
        ...common,
        direction: 'IN',
        binId: body.binId,
        value: out.entries[0]!.value,
        rate: out.entries[0]!.rate,
        stockStatus: 'UNRESTRICTED',
        ...(serials ? { serialNos: serials } : {}),
      });
      await exec(
        tx,
        `UPDATE putaway_tasks SET status='Done', actual_bin_id=$2::uuid, completed_at=now(), version=version+1, updated_at=now(), updated_by_id=$3::uuid WHERE id=$1::uuid`,
        id,
        body.binId,
        caller.auth.userId,
      );
      await exec(
        tx,
        `UPDATE goods_receipt_lines SET putaway_qty = putaway_qty + $1::numeric WHERE id=$2::uuid`,
        str(D(S(t.qty))),
        S(t.grn_line_id),
      );
      const open = Number(
        (
          await query(
            tx,
            `SELECT count(*)::int AS n FROM putaway_tasks WHERE grn_id=$1::uuid AND status IN ('Open','Assigned','Exception')`,
            t.grn_id,
          )
        )[0]?.n ?? 0,
      );
      await exec(
        tx,
        `UPDATE goods_receipts SET putaway_status=$2 WHERE id=$1::uuid`,
        t.grn_id,
        open === 0 ? 'DONE' : 'PARTIAL',
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_PUTAWAY',
        'Put-away',
        { id, code: S(t.task_no) },
        'wms-putaway',
        { grn: S(g.number), bin: body.binId },
      );
      return norm((await query(tx, `SELECT * FROM putaway_tasks WHERE id=$1::uuid`, id))[0]!);
    }, TX);
  },

  async exception(caller: Caller, id: string, reason: string) {
    const unitId = concreteUnit(caller);
    if (reason.trim().length < 5)
      throw Errors.validation({
        reason: 'Tell the supervisor what went wrong (at least 5 letters).',
      });
    return prisma.$transaction(async (tx) => {
      const t = (
        await query(
          tx,
          `SELECT * FROM putaway_tasks WHERE id=$1::uuid AND unit_id=$2::uuid FOR UPDATE`,
          id,
          unitId,
        )
      )[0];
      if (!t) throw Errors.notFound('Task not found.');
      if (t.status !== 'Assigned' && t.status !== 'Open')
        throw Errors.conflict(`A ${S(t.status)} task cannot be reported.`);
      await exec(
        tx,
        `UPDATE putaway_tasks SET status='Exception', exception_reason=$2, version=version+1, updated_at=now(), updated_by_id=$3::uuid WHERE id=$1::uuid`,
        id,
        reason.trim(),
        caller.auth.userId,
      );
      await notificationService.notify(tx, await pageRecipients(tx, 'wms-putaway'), {
        type: 'SCM_PUTAWAY_EXCEPTION',
        title: `Put-away problem on ${S(t.task_no)}`,
        body: reason.trim(),
        link: '/m/wms-putaway',
        dedupeKey: `putaway-exc:${id}`,
      });
      return norm((await query(tx, `SELECT * FROM putaway_tasks WHERE id=$1::uuid`, id))[0]!);
    }, TX);
  },
};

// ----------------------------------------------------------------------------------------------- qcDecide
export interface QcDecideInput {
  grnLineId: string;
  acceptedQty: string;
  rejectedQty: string;
  rejectReason?: string | undefined;
  actorId: string;
}
/** Phase 12 calls this on a usage decision. No GL: only the stock STATUS changes. */
export async function qcDecide(
  tx: Db,
  p: QcDecideInput,
): Promise<{ accepted: string; rejected: string }> {
  const l = (
    await query(tx, `SELECT * FROM goods_receipt_lines WHERE id=$1::uuid FOR UPDATE`, p.grnLineId)
  )[0];
  if (!l) throw Errors.notFound('Receipt line not found.');
  const g = (
    await query(tx, `SELECT * FROM goods_receipts WHERE id=$1::uuid FOR UPDATE`, l.grn_id)
  )[0]!;
  if (g.status !== 'Posted') throw Errors.conflict('Only a posted receipt can be inspected.');
  if (l.qc_required !== true) throw Errors.conflict('This line did not need inspection.');
  const ln = norm<Row>(l);
  const recv = D(S(ln.receivedQty));
  const a = D(p.acceptedQty);
  const r = D(p.rejectedQty);
  if (a.lt(0) || r.lt(0) || a.plus(r).lte(0))
    throw Errors.validation({ acceptedQty: 'Enter the accepted and rejected quantity.' });
  const done = D(S(ln.acceptedQty)).plus(D(S(ln.rejectedQty)));
  if (done.plus(a).plus(r).gt(recv))
    throw new AppError(422, 'QC_QTY_MISMATCH', `Accepted + rejected must equal ${str(recv)}.`, {
      acceptedQty: `Accepted + rejected must equal ${str(recv)}.`,
    });
  if (r.gt(0) && (p.rejectReason ?? '').trim().length < 3)
    throw Errors.validation({ rejectReason: 'Give the reason for rejecting.' });
  const ratio = D(S(ln.baseQty)).div(recv);
  const baseA = round3(a.mul(ratio));
  const baseR = round3(r.mul(ratio));
  const item = await itemInfo(tx, S(l.item_id));
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  // the slices still waiting in Quality Inspection for this line
  const slices = item.batch_tracked
    ? (
        await query(
          tx,
          `SELECT gb.batch_id::text AS batch_id, s.qty::text AS qty FROM goods_receipt_batches gb JOIN stock_slices s ON s.batch_id = gb.batch_id AND s.item_id=$2::uuid AND s.warehouse_id=$3::uuid AND s.stock_status='QUALITY_INSPECTION' AND s.bin_id=$4::uuid WHERE gb.grn_line_id=$1::uuid AND s.qty > 0 ORDER BY gb.batch_no`,
          p.grnLineId,
          item.id,
          g.warehouse_id,
          NO_ID,
        )
      ).map((x) => ({ batchId: S(x.batch_id), qty: D(S(x.qty)) }))
    : [{ batchId: null as string | null, qty: baseA.plus(baseR) }];
  const move = async (qty: Dec, to: 'UNRESTRICTED' | 'BLOCKED') => {
    let left = qty;
    const used: { batchId: string | null; qty: Dec }[] = [];
    for (const s of slices) {
      if (left.lte(0)) break;
      const take = left.lt(s.qty) ? left : s.qty;
      if (take.lte(0)) continue;
      await StockService.changeStatus(tx, {
        warehouseId: S(g.warehouse_id),
        itemId: item.id,
        qty: take,
        batchId: s.batchId,
        binId: null,
        from: 'QUALITY_INSPECTION',
        to,
        postingDate: today,
        voucherId: S(l.grn_id),
        voucherNo: S(g.number),
        createdById: p.actorId,
      });
      s.qty = s.qty.minus(take);
      left = left.minus(take);
      used.push({ batchId: s.batchId, qty: take });
    }
    if (left.gt(0))
      throw Errors.conflict('The inspection stock is no longer there (it was used or moved).');
    return used;
  };
  let usedA: { batchId: string | null; qty: Dec }[] = [];
  if (baseA.gt(0)) usedA = await move(baseA, 'UNRESTRICTED');
  if (baseR.gt(0)) await move(baseR, 'BLOCKED');
  for (const u of usedA)
    if (u.batchId) {
      await exec(
        tx,
        `UPDATE batches SET qc_status='Released', version=version+1, updated_at=now() WHERE id=$1::uuid AND qc_status='Pending QC'`,
        u.batchId,
      );
      await exec(
        tx,
        `INSERT INTO batch_events (batch_id, event, from_value, to_value, reason, created_by_id) VALUES ($1::uuid,'QC_RELEASED','Pending QC','Released','GRN inspection',$2::uuid)`,
        u.batchId,
        p.actorId,
      );
    }
  const newA = D(S(ln.acceptedQty)).plus(a);
  const newR = D(S(ln.rejectedQty)).plus(r);
  const complete = newA.plus(newR).equals(recv);
  await exec(
    tx,
    `UPDATE goods_receipt_lines SET accepted_qty=$1::numeric, rejected_qty=$2::numeric, reject_reason=COALESCE($3, reject_reason), qc_state=$4 WHERE id=$5::uuid`,
    str(newA),
    str(newR),
    r.gt(0) ? (p.rejectReason ?? '').trim() : null,
    complete ? 'DONE' : 'PENDING',
    p.grnLineId,
  );
  await exec(
    tx,
    `UPDATE purchase_order_lines SET accepted_qty = accepted_qty + $1::numeric WHERE id=$2::uuid`,
    str(a),
    S(l.po_line_id),
  );
  if (a.gt(0))
    await createPutawayTasks(
      tx,
      g,
      { ...l, id: l.id },
      p.actorId,
      usedA.map((u) => u.batchId).filter((x): x is string => !!x),
      a,
      baseA,
      usedA,
    );
  const pending = Number(
    (
      await query(
        tx,
        `SELECT count(*)::int AS n FROM goods_receipt_lines WHERE grn_id=$1::uuid AND qc_state='PENDING'`,
        l.grn_id,
      )
    )[0]?.n ?? 0,
  );
  await exec(
    tx,
    `UPDATE goods_receipts SET qc_status=$2, putaway_status = CASE WHEN $3 THEN 'PENDING' ELSE putaway_status END WHERE id=$1::uuid`,
    l.grn_id,
    pending === 0 ? 'DONE' : 'PARTIAL',
    a.gt(0),
  );
  await audit(
    tx,
    null,
    p.actorId,
    'SCM_QC_DECIDED',
    GRN_DEF.title,
    { id: S(l.grn_id), code: S(g.number) },
    GRN_DEF.pageId,
    { grnLine: p.grnLineId, accepted: str(a), rejected: str(r) },
  );
  return { accepted: str(newA), rejected: str(newR) };
}

// ----------------------------------------------------------------------------------------------- cancel
async function cancelGrn(caller: Caller, id: string, reason: string) {
  if (reason.trim().length < 5)
    throw Errors.validation({ reason: 'Give a reason of at least 5 letters.' });
  await prisma.$transaction(async (tx) => {
    const g = await loadDoc(tx, caller, GRN_DEF, id, { lock: true });
    if (g.status === 'Cancelled') throw Errors.conflict('This receipt is already cancelled.');
    if (g.status !== 'Posted')
      throw Errors.conflict(
        'Only a posted receipt is cancelled; delete or return a draft instead.',
      );
    const used = (
      await query(
        tx,
        `SELECT count(*)::int AS n FROM goods_receipt_lines WHERE grn_id=$1::uuid AND (billed_qty > 0 OR returned_qty > 0 OR putaway_qty > 0 OR qc_state = 'DONE')`,
        id,
      )
    )[0];
    if (Number(used?.n ?? 0) > 0)
      throw Errors.conflict(
        'This receipt was already billed, returned, inspected or put away. Return the goods with a debit note instead.',
      );
    const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    await StockService.reverseVoucher(tx, id, {
      voucherNo: S(g.number),
      postingDate: today,
      createdById: caller.auth.userId,
    });
    const rev = await PostingService.reverse(
      tx,
      S(g.journal_id),
      reason.trim(),
      { userId: caller.auth.userId },
      { reversalDate: today },
    );
    for (const l of await loadLines(tx, GRN_DEF, id))
      await exec(
        tx,
        `UPDATE purchase_order_lines SET received_qty = received_qty - $1::numeric, accepted_qty = accepted_qty - $2::numeric WHERE id=$3::uuid`,
        S(norm<Row>(l).receivedQty),
        S(norm<Row>(l).acceptedQty),
        S(l.po_line_id),
      );
    await exec(
      tx,
      `UPDATE putaway_tasks SET status='Cancelled', version=version+1 WHERE grn_id=$1::uuid AND status IN ('Open','Assigned','Exception')`,
      id,
    );
    await exec(
      tx,
      `UPDATE goods_receipts SET status='Cancelled', cancelled_at=now(), cancel_reason=$2, cancel_journal_id=$3::uuid, version=version+1, updated_by_id=$4::uuid, updated_at=now() WHERE id=$1::uuid`,
      id,
      reason.trim(),
      rev.id,
      caller.auth.userId,
    );
    await audit(
      tx,
      caller,
      caller.auth.userId,
      'SCM_CANCELLED',
      GRN_DEF.title,
      { id, code: S(g.number) },
      GRN_DEF.pageId,
      { reason },
    );
  }, TX);
  return getGrn(prisma, caller, id);
}

export const grnService = {
  list: async (
    caller: Caller,
    q: {
      q?: string | undefined;
      status?: string | undefined;
      supplierId?: string | undefined;
      page: number;
      size: number;
    },
  ) => {
    const sc = await scopeSql(caller, GRN_DEF.pageId);
    const args = [...sc.args];
    const where = [sc.sql];
    if (q.q) {
      args.push(`%${q.q}%`);
      where.push(`t.number ILIKE $${args.length}`);
    }
    if (q.status) {
      args.push(q.status);
      where.push(`t.status = $${args.length}`);
    }
    if (q.supplierId) {
      args.push(q.supplierId);
      where.push(`t.supplier_id = $${args.length}::uuid`);
    }
    const total = Number(
      (
        await query(
          prisma,
          `SELECT count(*)::int AS n FROM goods_receipts t WHERE ${where.join(' AND ')}`,
          ...args,
        )
      )[0]?.n ?? 0,
    );
    const rows = await query(
      prisma,
      `SELECT t.*, s.name AS supplier_name, p.number AS po_no FROM goods_receipts t JOIN suppliers s ON s.id=t.supplier_id JOIN purchase_orders p ON p.id=t.po_id WHERE ${where.join(' AND ')} ORDER BY t.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm(r)), total };
  },
  get: (caller: Caller, id: string) => getGrn(prisma, caller, id),
  create: (caller: Caller, body: GrnBody) => saveGrn(caller, null, undefined, body),
  update: (caller: Caller, id: string, ifMatch: number | undefined, body: GrnBody) =>
    saveGrn(caller, id, ifMatch, body),
  /** "Receive against PO": the lines pre-filled with the open quantity. */
  async fromPo(caller: Caller, poId: string) {
    const po = await loadDoc(
      prisma,
      caller,
      { pageId: 'scm-po', table: 'purchase_orders', title: 'Purchase Order', amountCol: null },
      poId,
    );
    assertReleased(po);
    const lines = await query(
      prisma,
      `SELECT l.id::text, l.line_no, l.item_id::text, l.qty::text, l.received_qty::text, l.closed_qty::text, l.uom, i.code AS item_code, i.name AS item_name, i.batch_tracked, i.serial_tracked
        FROM purchase_order_lines l JOIN items i ON i.id=l.item_id WHERE l.po_id=$1::uuid AND l.qty - l.received_qty - l.closed_qty > 0 ORDER BY l.line_no`,
      poId,
    );
    return {
      poId,
      poNo: po.number,
      supplierId: po.supplier_id,
      warehouseId: po.ship_to_warehouse_id,
      lines: lines.map((l) => ({
        ...norm<Row>(l),
        openQty: str(
          D(S(l.qty))
            .minus(D(S(l.received_qty)))
            .minus(D(S(l.closed_qty))),
        ),
      })),
    };
  },
  post: async (caller: Caller, id: string) => {
    await prisma.$transaction(async (tx) => {
      await loadDoc(tx, caller, GRN_DEF, id);
      await postGrn(tx, id, { userId: caller.auth.userId });
    }, TX);
    return getGrn(prisma, caller, id);
  },
  cancel: cancelGrn,
  async qcDecision(
    caller: Caller,
    grnLineId: string,
    body: { acceptedQty: string; rejectedQty: string; rejectReason?: string },
  ) {
    const lr = (
      await query(
        prisma,
        `SELECT grn_id::text FROM goods_receipt_lines WHERE id=$1::uuid`,
        grnLineId,
      )
    )[0];
    if (!lr) throw Errors.notFound('Receipt line not found.');
    await loadDoc(prisma, caller, GRN_DEF, S(lr.grn_id));
    await prisma.$transaction(
      (tx) =>
        qcDecide(tx, {
          grnLineId,
          acceptedQty: body.acceptedQty,
          rejectedQty: body.rejectedQty,
          rejectReason: body.rejectReason,
          actorId: caller.auth.userId,
        }),
      TX,
    );
    return getGrn(prisma, caller, S(lr.grn_id));
  },
};
