// Phase 9: purchase orders. Released = Approved and not being amended; fulfilment (Open / Partly received /
// Closed / Delayed) is derived from the line counters, never stored as a status.
import { lineNoGstRate } from '../masters/party-rules';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { AppError, Errors } from '../../core/http/errors';
import { notificationService } from '../notifications/service';
import type { Caller } from '../records/service';
import { D, ZERO, round2, str } from '../inventory/money';
import { UomService } from '../inventory/uom/uom-service';
import { makeCrud } from './crud';
import {
  TX,
  assertBuyable,
  audit,
  exec,
  insertRow,
  loadDoc,
  loadLines,
  loadSupplier,
  norm,
  query,
  registerDoc,
  todayIst,
  updateRow,
} from './core';
import { S, unitState } from './core';
import type { DocDef, Row } from './core';
import { addDays, deliveryStatus, headerTotals, lineTax, netRate } from './math';
import type { LineTax } from './math';
import { CMP_DEF, PR_DEF, prActions, releaseAgainstContract } from './sourcing-service';

export const PO_DEF: DocDef = {
  pageId: 'scm-po',
  table: 'purchase_orders',
  title: 'Purchase Order',
  amountCol: 'grand_total',
  linesTable: 'purchase_order_lines',
  parentCol: 'po_id',
  async afterApproved(tx, id, actor) {
    const po = norm(
      (await query(tx, `SELECT * FROM purchase_orders WHERE id=$1::uuid`, id))[0] as Row,
    );
    const first = Number(po.revisionNo) === 0 && po.amending !== true;
    const lines = await loadLines(tx, PO_DEF, id);
    if (first) {
      for (const l of lines) {
        const n = norm(l);
        if (n.contractLineId)
          await releaseAgainstContract(
            tx,
            S(n.contractLineId),
            D(S(n.baseQty)),
            D(S(n.taxable)),
            S(po.poDate),
          );
        if (n.prLineId) {
          if ((await prActions.openQty(tx, S(n.prLineId))).lt(D(S(n.qty))))
            throw new AppError(
              409,
              'QUANTITY_EXCEEDS_OPEN',
              'The requisition line has already been ordered on another purchase order.',
            );
        }
        if (n.prLineId)
          await insertRow(tx, 'document_links', {
            fromType: 'PR',
            fromId: (
              await query(
                tx,
                `SELECT pr_id::text FROM purchase_requisition_lines WHERE id=$1::uuid`,
                n.prLineId,
              )
            )[0]?.pr_id,
            fromLineId: n.prLineId,
            toType: 'PO',
            toId: id,
            toLineId: n.id,
            qty: n.qty,
            createdById: actor.userId,
          });
      }
    }
    await exec(tx, `UPDATE purchase_orders SET amending = false WHERE id=$1::uuid`, id);
    await notificationService.notify(tx, [S(po.createdById)], {
      type: 'SCM_PO_APPROVED',
      title: `Purchase order ${S(po.number)} is approved`,
      link: '/m/scm-po',
      dedupeKey: `po-approved:${id}:${S(po.revisionNo)}`,
    });
  },
};
registerDoc(PO_DEF);

export async function resolveGstPct(
  tx: Db,
  hsn: string | null,
  on: string,
): Promise<string | null> {
  if (!hsn) return null;
  const r = (
    await query(
      tx,
      `SELECT g.igst_pct::text AS pct FROM hsn_sac_codes h
         JOIN hsn_sac_rates r ON r.hsn_id = h.id JOIN gst_rates g ON g.id = r.gst_rate_id
        WHERE h.code = $1 AND r.effective_from <= $2::date AND (r.effective_to IS NULL OR r.effective_to >= $2::date)
        ORDER BY r.effective_from DESC LIMIT 1`,
      hsn,
      on,
    )
  )[0];
  return (r?.pct as string | undefined) ?? null;
}

export const poCrud = makeCrud({
  def: PO_DEF,
  hasSupplier: true,
  headerKeys: [
    'supplierId',
    'poDate',
    'poType',
    'supplierType',
    'shipToWarehouseId',
    'paymentTermId',
    'contractId',
    'comparisonId',
    'notes',
  ],
  lineKeys: [
    'id',
    'itemId',
    'serviceText',
    'qty',
    'uom',
    'rate',
    'discountPct',
    'gstPct',
    'deliveryDate',
    'leadDays',
    'model',
    'partNo',
    'costCenterId',
    'prLineId',
    'contractLineId',
    'overReceiptPct',
  ],
  async prepare(c) {
    const supplierId = S(c.header.supplierId ?? c.existing?.supplier_id ?? '');
    if (!supplierId) throw Errors.validation({ supplierId: 'Choose a supplier.' });
    const sup = await loadSupplier(c.tx, supplierId);
    if (c.header.supplierId || !c.existing) assertBuyable(sup);
    const stype = S(c.header.supplierType ?? c.existing?.supplier_type ?? 'MATERIAL');
    if (sup.supplierType !== stype)
      throw Errors.validation({
        supplierId: `This is a ${stype.toLowerCase()} purchase order; the supplier is a ${sup.supplierType.toLowerCase()} supplier.`,
      });
    if (c.header.shipToWarehouseId) {
      const w = (
        await query(
          c.tx,
          `SELECT unit_id::text FROM warehouses WHERE id=$1::uuid AND deleted_at IS NULL`,
          c.header.shipToWarehouseId,
        )
      )[0];
      if (!w || w.unit_id !== c.unitId)
        throw Errors.validation({ shipToWarehouseId: 'Choose a warehouse of this unit.' });
    }
    const posState = await unitState(c.tx, c.unitId);
    const intra = sup.stateCode === posState;
    const poDate = S(c.header.poDate ?? c.existing?.po_date ?? todayIst());
    const out: Row[] = [];
    const taxes: LineTax[] = [];
    for (let i = 0; i < c.lines.length; i += 1) {
      const l = { ...c.lines[i]! };
      const at = (f: string) => `lines.${i}.${f}`;
      if (!l.itemId && !l.serviceText)
        throw Errors.validation({ [at('itemId')]: 'Choose an item or describe the service.' });
      let qty = D(S(l.qty ?? 0));
      if (qty.lte(0)) throw Errors.validation({ [at('qty')]: 'Enter a quantity greater than 0.' });
      let hsn: string | null = null;
      let baseQty = qty;
      if (l.itemId) {
        const it = (
          await query(
            c.tx,
            `SELECT COALESCE(i.hsn_sac, h.code) AS hsn_sac, i.base_uom FROM items i LEFT JOIN hsn_sac_codes h ON h.id = i.hsn_id WHERE i.id=$1::uuid AND i.deleted_at IS NULL`,
            l.itemId,
          )
        )[0];
        if (!it) throw Errors.validation({ [at('itemId')]: 'Choose an item.' });
        hsn = (it.hsn_sac as string | null) ?? null;
        l.uom = l.uom ?? it.base_uom;
        baseQty = (await UomService.toBase(c.tx, { itemId: S(l.itemId), uom: S(l.uom), qty }))
          .baseQty;
      } else if (!l.uom) l.uom = 'NOS';
      qty = D(S(l.qty));
      if (l.contractLineId) {
        const cl = (
          await query(
            c.tx,
            `SELECT l.rate::text, l.discount_pct::text, c.supplier_id::text FROM purchase_contract_lines l JOIN purchase_contracts c ON c.id=l.contract_id WHERE l.id=$1::uuid`,
            l.contractLineId,
          )
        )[0];
        if (!cl || cl.supplier_id !== supplierId)
          throw Errors.validation({
            [at('contractLineId')]: 'This contract line belongs to another supplier.',
          });
        if (l.rate === undefined || l.rate === null) l.rate = cl.rate;
        if (l.discountPct === undefined || l.discountPct === null) l.discountPct = cl.discount_pct;
      }
      if (l.rate === undefined || l.rate === null)
        throw Errors.validation({ [at('rate')]: 'Enter a rate.' });
      let gst = l.gstPct === undefined || l.gstPct === null ? null : S(l.gstPct);
      if (gst === null) gst = await resolveGstPct(c.tx, hsn, poDate);
      if (gst === null)
        throw Errors.validation({
          [at('gstPct')]: lineNoGstRate(hsn),
        });
      const t = lineTax({
        qty,
        rate: D(S(l.rate)),
        discountPct: D(S(l.discountPct ?? 0)),
        gstPct: D(gst),
        intra,
      });
      taxes.push(t);
      const delivery =
        l.deliveryDate ??
        (l.leadDays !== undefined && l.leadDays !== null
          ? addDays(poDate, Number(l.leadDays))
          : null);
      out.push({
        ...l,
        hsnSac: hsn,
        baseQty: str(baseQty),
        gstPct: gst,
        discountPct: S(l.discountPct ?? 0),
        taxable: str(t.taxable),
        cgst: str(t.cgst),
        sgst: str(t.sgst),
        igst: str(t.igst),
        netRate: str(netRate(D(S(l.rate)), D(S(l.discountPct ?? 0)))),
        deliveryDate: delivery,
      });
    }
    const h = headerTotals(taxes);
    return {
      header: {
        ...c.header,
        supplierId,
        posState,
        regime: intra ? 'INTRA' : 'INTER',
        taxableTotal: str(h.taxable),
        cgstTotal: str(h.cgst),
        sgstTotal: str(h.sgst),
        igstTotal: str(h.igst),
        roundOff: str(h.roundOff),
        grandTotal: str(h.grand),
      },
      lines: out,
    };
  },
  async saveLines(c) {
    const existing = await query(
      c.tx,
      `SELECT id::text, line_no, received_qty::text, billed_qty::text FROM purchase_order_lines WHERE po_id=$1::uuid FOR UPDATE`,
      c.id,
    );
    const byId = new Map(existing.map((e) => [S(e.id), e]));
    const keep = new Set<string>();
    let maxNo = existing.reduce((m, e) => Math.max(m, Number(e.line_no)), 0);
    const cols = [
      'itemId',
      'serviceText',
      'hsnSac',
      'qty',
      'uom',
      'baseQty',
      'rate',
      'discountPct',
      'gstPct',
      'taxable',
      'cgst',
      'sgst',
      'igst',
      'netRate',
      'deliveryDate',
      'leadDays',
      'model',
      'partNo',
      'costCenterId',
      'prLineId',
      'contractLineId',
      'overReceiptPct',
    ];
    for (const l of c.lines) {
      const patch: Row = {};
      for (const k of cols) if (l[k] !== undefined) patch[k] = l[k];
      const cur = l.id ? byId.get(S(l.id)) : undefined;
      if (cur) {
        keep.add(S(cur.id));
        if (D(S(l.qty)).lt(D(S(cur.received_qty))))
          throw Errors.validation({
            qty: `Line ${S(cur.line_no)}: ${D(S(cur.received_qty)).toFixed()} already received; the quantity cannot go below that.`,
          });
        await updateRow(c.tx, 'purchase_order_lines', S(cur.id), patch);
      } else {
        maxNo += 1;
        await insertRow(c.tx, 'purchase_order_lines', { ...patch, poId: c.id, lineNo: maxNo });
      }
    }
    for (const e of existing) {
      if (keep.has(S(e.id))) continue;
      if (D(S(e.received_qty)).gt(0) || D(S(e.billed_qty)).gt(0))
        throw Errors.conflict(
          `Line ${S(e.line_no)} already has goods received or billed; it cannot be removed. Short-close it instead.`,
        );
      await exec(c.tx, `DELETE FROM purchase_order_lines WHERE id=$1::uuid`, S(e.id));
    }
  },
});

/** A PO is released when Approved and not being amended. Throws PO_NOT_RELEASED otherwise. */
export function assertReleased(po: Row): void {
  if (po.status !== 'Approved' || po.amending === true)
    throw new AppError(409, 'PO_NOT_RELEASED', 'This PO is not approved or is being amended.');
}

export const poActions = {
  async amend(caller: Caller, id: string, reason: string) {
    return prisma.$transaction(async (tx) => {
      const po = await loadDoc(tx, caller, PO_DEF, id, { lock: true });
      if (po.status !== 'Approved')
        throw Errors.conflict('Only an Approved purchase order can be amended.');
      if (reason.trim().length < 5)
        throw Errors.validation({ reason: 'Give a reason of at least 5 letters.' });
      const snapshot = {
        header: norm(po),
        lines: (await loadLines(tx, PO_DEF, id)).map((l) => norm(l)),
      };
      await insertRow(tx, 'purchase_order_revisions', {
        poId: id,
        revisionNo: po.revision_no,
        snapshot,
        reason: reason.trim(),
        createdById: caller.auth.userId,
      });
      await exec(
        tx,
        `UPDATE purchase_orders SET status='Draft', amending=true, revision_no = revision_no + 1, version = version + 1, updated_by_id=$2::uuid, updated_at=now() WHERE id=$1::uuid`,
        id,
        caller.auth.userId,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_UPDATED',
        PO_DEF.title,
        { id, code: S(po.number) },
        PO_DEF.pageId,
        { amend: true, reason, fromRevision: Number(po.revision_no) },
      );
      return poCrud.getIn(tx, caller, id);
    }, TX);
  },
  async revisions(caller: Caller, id: string) {
    await loadDoc(prisma, caller, PO_DEF, id);
    const rows = await query(
      prisma,
      `SELECT * FROM purchase_order_revisions WHERE po_id=$1::uuid ORDER BY revision_no`,
      id,
    );
    return rows.map((r) => norm(r));
  },
  async shortClose(caller: Caller, id: string, body: { lineIds?: string[]; reason: string }) {
    return prisma.$transaction(async (tx) => {
      const po = await loadDoc(tx, caller, PO_DEF, id, { lock: true });
      if (po.status !== 'Approved')
        throw Errors.conflict('Only an Approved purchase order can be short-closed.');
      if (body.reason.trim().length < 5)
        throw Errors.validation({ reason: 'Give a reason of at least 5 letters.' });
      const lines = await query(
        tx,
        `SELECT id::text, qty::text, received_qty::text, closed_qty::text FROM purchase_order_lines WHERE po_id=$1::uuid FOR UPDATE`,
        id,
      );
      for (const l of lines) {
        if (body.lineIds && !body.lineIds.includes(S(l.id))) continue;
        const bal = D(S(l.qty)).minus(D(S(l.received_qty)));
        if (bal.gt(0))
          await exec(
            tx,
            `UPDATE purchase_order_lines SET closed_qty = $1::numeric WHERE id=$2::uuid`,
            str(bal),
            S(l.id),
          );
      }
      const open = Number(
        (
          await query(
            tx,
            `SELECT count(*)::int AS n FROM purchase_order_lines WHERE po_id=$1::uuid AND qty - received_qty - closed_qty > 0`,
            id,
          )
        )[0]?.n ?? 0,
      );
      if (open === 0)
        await exec(tx, `UPDATE purchase_orders SET closed_at = now() WHERE id=$1::uuid`, id);
      await exec(tx, `UPDATE purchase_orders SET version = version + 1 WHERE id=$1::uuid`, id);
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_UPDATED',
        PO_DEF.title,
        { id, code: S(po.number) },
        PO_DEF.pageId,
        { shortClose: true, reason: body.reason },
      );
      return poCrud.getIn(tx, caller, id);
    }, TX);
  },
  async fromComparison(caller: Caller, cmpId: string) {
    const c = await prisma.$transaction(async (tx) => {
      const cmp = await loadDoc(tx, caller, CMP_DEF, cmpId);
      if (!cmp.locked_at || !cmp.awarded_quote_id)
        throw Errors.conflict('Award the comparison before creating a purchase order.');
      const q = (
        await query(
          tx,
          `SELECT q.*, r.supplier_type FROM vendor_quotes q JOIN rfqs r ON r.id=q.rfq_id WHERE q.id=$1::uuid`,
          cmp.awarded_quote_id,
        )
      )[0]!;
      const lines = await query(
        tx,
        `SELECT l.*, rl.pr_line_id FROM vendor_quote_lines l LEFT JOIN rfq_lines rl ON rl.id=l.rfq_line_id WHERE l.quote_id=$1::uuid ORDER BY l.line_no`,
        q.id,
      );
      return { cmp, q, lines };
    });
    const po = await poCrud
      .create(caller, {
        header: {
          supplierId: c.q.supplier_id,
          supplierType: c.q.supplier_type,
          paymentTermId: c.q.payment_term_id,
          comparisonId: cmpId,
        },
        lines: c.lines.map((l) => {
          const n = norm(l);
          return {
            itemId: n.itemId,
            qty: n.qty,
            uom: n.uom,
            rate: n.rate,
            discountPct: n.discountPct,
            gstPct: n.gstPct,
            leadDays: n.leadDays,
            prLineId: n.prLineId,
          };
        }),
      })
      .catch((err: unknown) => {
        if (S((err as { message?: unknown }).message).includes('comparison_id'))
          throw Errors.conflict('A purchase order was already created from this comparison.');
        throw err;
      });
    await prisma.$transaction(async (tx) => {
      await insertRow(tx, 'document_links', {
        fromType: 'CMP',
        fromId: cmpId,
        toType: 'PO',
        toId: po.id,
        createdById: caller.auth.userId,
      });
    });
    return po;
  },
  async fromPr(
    caller: Caller,
    prId: string,
    body: { supplierId: string; lineIds?: string[]; shipToWarehouseId?: string },
  ) {
    const lines = await prisma.$transaction(async (tx) => {
      const pr = await loadDoc(tx, caller, PR_DEF, prId, { lock: true });
      if (pr.status !== 'Approved')
        throw Errors.conflict('Approve the requisition before ordering.');
      const ls = (await loadLines(tx, PR_DEF, prId)).filter(
        (l) => !body.lineIds || body.lineIds.includes(S(l.id)),
      );
      const out: Row[] = [];
      for (const l of ls) {
        const open = await prActions.openQty(tx, S(l.id));
        if (open.lte(0))
          throw new AppError(
            409,
            'QUANTITY_EXCEEDS_OPEN',
            `Only 0 left on ${S(pr.number)} line ${S(l.line_no)}.`,
          );
        const n = norm(l);
        out.push({
          itemId: n.itemId,
          serviceText: n.serviceText,
          qty: str(open),
          uom: n.uom,
          rate: n.estRate,
          costCenterId: n.costCenterId,
          prLineId: n.id,
          deliveryDate: n.requiredDate,
        });
      }
      return { out, type: S(pr.supplier_type) };
    });
    return poCrud.create(caller, {
      header: {
        supplierId: body.supplierId,
        supplierType: lines.type,
        shipToWarehouseId: body.shipToWarehouseId,
      },
      lines: lines.out,
    });
  },
};

/** Delivery tracking (client requirement 1): one row per PO line with a derived status. */
export async function deliveryTracking(
  caller: Caller,
  q: { supplierId?: string | undefined; status?: string | undefined; page: number; size: number },
) {
  const args: unknown[] = [];
  const where = [`p.deleted_at IS NULL`, `p.status = 'Approved'`, `p.amending = false`];
  if (caller.ctx.unitId) {
    args.push(caller.ctx.unitId);
    where.push(`p.unit_id = $${args.length}::uuid`);
  } else if (!caller.ctx.allUnits) where.push('false');
  if (q.supplierId) {
    args.push(q.supplierId);
    where.push(`p.supplier_id = $${args.length}::uuid`);
  }
  const rows = await query(
    prisma,
    `SELECT l.id::text, p.id::text AS po_id, p.number AS po_no, p.po_date, s.name AS supplier_name, i.code AS item_code, i.name AS item_name,
            l.lead_days, l.delivery_date AS expected_date, l.model, l.part_no, l.qty::text AS po_qty, l.received_qty::text, l.closed_qty::text
       FROM purchase_order_lines l JOIN purchase_orders p ON p.id = l.po_id JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN items i ON i.id = l.item_id
      WHERE ${where.join(' AND ')} ORDER BY l.delivery_date NULLS LAST, p.number, l.line_no`,
    ...args,
  );
  const today = todayIst();
  const all = rows.map((r) => {
    const n = norm<Row>(r);
    const d = deliveryStatus({
      poQty: D(S(n.poQty)),
      receivedQty: D(S(n.receivedQty)),
      closedQty: D(S(n.closedQty)),
      expectedDate: (n.expectedDate as string | null) ?? null,
      today,
    });
    return { ...n, balanceQty: str(d.balance), status: d.status };
  });
  const filtered = q.status ? all.filter((r) => r.status === q.status) : all;
  return { rows: filtered.slice((q.page - 1) * q.size, q.page * q.size), total: filtered.length };
}

export { round2, ZERO };
