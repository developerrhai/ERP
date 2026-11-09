// Phase 12 side of the Phase 9 hook (QmsInboundPort): a posted goods receipt line that needs inspection gets an
// Incoming inspection lot (Draft, plan rows pre-filled). The stock itself waits in the Phase 8 status Quality Inspection;
// the Usage Decision (decideInspection) moves it. A missing template must never block a goods receipt, so it is logged
// and the lot can be created later from the screen.
import type { Db } from '../../core/db/prisma';
import { logger } from '../../core/logger';
import { NumberingService } from '../../core/numbering';
import { notificationService } from '../notifications/service';
import { setQmsInboundPort } from '../procurement/qms-port';
import type { GrnPostedEvent } from '../procurement/qms-port';
import { exec, insertRow, pageRecipients, query, todayIst } from '../procurement/core';
import { resolveTemplate, S, planPreview } from './inspection-service';
import type { HeaderField } from './logic';

/** Creates the Incoming inspection lot of one receipt line (idempotent: one live lot per line). */
export async function createLotForGrnLine(
  tx: Db,
  grnLineId: string,
  actorId: string | null,
): Promise<string | null> {
  const l = (
    await query(
      tx,
      `SELECT l.id::text, l.item_id::text, l.received_qty::text AS received_qty, l.qc_required, g.id::text AS grn_id, g.number AS grn_no, g.unit_id::text, g.fy_id::text, g.supplier_id::text,
              g.vendor_invoice_ref, g.created_by_id::text AS created_by_id
         FROM goods_receipt_lines l JOIN goods_receipts g ON g.id=l.grn_id WHERE l.id=$1::uuid`,
      grnLineId,
    )
  )[0];
  if (!l || l.qc_required !== true) return null;
  const have = (
    await query(
      tx,
      `SELECT id::text FROM qms_inspections WHERE source_type='GRN_LINE' AND source_id=$1::uuid AND status <> 'Cancelled' AND deleted_at IS NULL`,
      grnLineId,
    )
  )[0];
  if (have) return S(have.id);
  const tpl = await resolveTemplate(tx, 'INCOMING', null, S(l.unit_id));
  const fields = tpl.header_fields as HeaderField[];
  const header: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.key === 'supplier') header[f.key] = S(l.supplier_id);
    if (f.key === 'item' && l.item_id) header[f.key] = S(l.item_id);
    if (f.key === 'invoice_no' && l.vendor_invoice_ref) header[f.key] = S(l.vendor_invoice_ref);
  }
  const pv = await planPreview(tx, 'INCOMING', l.item_id ? S(l.item_id) : null, null);
  const no = await NumberingService.allocate(tx, {
    pageId: 'qms:INCOMING',
    unitId: S(l.unit_id),
    fyId: S(l.fy_id),
    prefix: 'IQC',
  });
  const id = await insertRow(tx, 'qms_inspections', {
    unitId: S(l.unit_id),
    fyId: S(l.fy_id),
    number: no,
    kind: 'INCOMING',
    status: 'Draft',
    templateId: S(tpl.id),
    templateSnapshot: {
      code: tpl.code,
      name: tpl.name,
      version: tpl.version,
      headerFields: fields,
      rowConfig: tpl.row_config,
    },
    planId: pv.plan ? S(pv.plan.id) : null,
    docDate: todayIst(),
    supplierId: S(l.supplier_id),
    itemId: l.item_id ? S(l.item_id) : null,
    header,
    sourceType: 'GRN_LINE',
    sourceId: grnLineId,
    lotQty: S(l.received_qty),
    createdById: actorId ?? (l.created_by_id ? S(l.created_by_id) : null),
    updatedById: actorId ?? (l.created_by_id ? S(l.created_by_id) : null),
  });
  let n = 0;
  for (const r of pv.rows) {
    n += 1;
    const rowType = r.rowType ?? 'NUMERIC';
    await insertRow(tx, 'qms_inspection_rows', {
      inspectionId: id,
      rowNo: n,
      label: r.label,
      spec: r.spec ?? null,
      method: r.method ?? null,
      unit: r.unit ?? null,
      rowType,
      lsl: r.lsl === null || r.lsl === undefined ? null : String(r.lsl),
      usl: r.usl === null || r.usl === undefined ? null : String(r.usl),
      readings: JSON.stringify([]),
      extra: JSON.stringify({}),
      rowStatus: 'PENDING',
    });
  }
  const to = await pageRecipients(tx, 'qms-incoming');
  await notificationService.notify(tx, to, {
    type: 'QMS_INSPECTION_PENDING',
    title: `Inspect goods receipt ${S(l.grn_no)}`,
    body: `Inspection lot ${no} is waiting. The stock stays in Quality Inspection until the usage decision.`,
    link: '/m/qms-incoming',
    entityType: 'qms_inspection',
    entityId: id,
    dedupeKey: `qms-lot:${grnLineId}`,
  });
  return id;
}

async function onGrnPosted(tx: Db, e: GrnPostedEvent): Promise<void> {
  for (const line of e.lines) {
    if (!line.qcRequired) continue;
    // a savepoint keeps a failure here from poisoning the goods-receipt transaction
    await exec(tx, 'SAVEPOINT qms_lot');
    try {
      await createLotForGrnLine(tx, line.grnLineId, null);
      await exec(tx, 'RELEASE SAVEPOINT qms_lot');
    } catch (err) {
      await exec(tx, 'ROLLBACK TO SAVEPOINT qms_lot');
      // never block a goods receipt on quality set-up; the lot can be created from the Incoming Quality screen
      logger.error({ err, grn: e.grnNo, line: line.grnLineId }, 'qms: inspection lot not created');
    }
  }
}

setQmsInboundPort({ onGrnPosted });
