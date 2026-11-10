// apps/api/src/modules/logistics/gate-service.ts
import PDFDocument from 'pdfkit';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
import { recordAudit } from '../../core/audit/audit-service';
import { norm, query, exec, fyOfCaller } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { StockService } from '../inventory/stock/stock-service';
import { D } from '../inventory/money';
import { fleetService } from './fleet-service';
import {
  computeStatutoryDueDate,
  computeReturnableOverdue,
  evaluateStatutoryStatus,
  validateChallanNumber,
  validateEwayBill,
  type JobWorkCategory,
} from './logistics-calc';

async function allocateShortGateNumber(
  tx: any,
  pageId: 'gate-in' | 'gate-out' | 'gate-return' | 'gate-nonreturn',
  unitId: string,
  fyId: string,
): Promise<string> {
  const fyRow = await tx.financialYear.findUniqueOrThrow({
    where: { id: fyId },
    select: { code: true },
  });
  // Keep FY token to 2 digits (e.g. '26' from '2026-27') so RGP/SAW/26/00001 <= 16 chars
  const fyShort = fyRow.code.startsWith('20') ? fyRow.code.slice(2, 4) : fyRow.code.slice(0, 2);
  const pattern = `{prefix}/{unit}/${fyShort}/{number:5}`;
  const code = await NumberingService.allocate(tx, {
    pageId,
    unitId,
    fyId,
    pattern,
  });
  const check = validateChallanNumber(code);
  if (!check.valid) {
    // Fallback shorter 4-digit format if unit code is longer
    return NumberingService.allocate(tx, {
      pageId,
      unitId,
      fyId,
      pattern: `{prefix}/{unit}/${fyShort}/{number:4}`,
    });
  }
  return code;
}

export class GateService {
  // ------------------------------------------------------------------------- Queries
  async listPasses(
    caller: Caller,
    filters: { direction?: string; passType?: string; status?: string },
  ): Promise<Row[]> {
    const conds: string[] = ['gp.deleted_at IS NULL'];
    const args: unknown[] = [];

    if (caller.ctx.unitId) {
      args.push(caller.ctx.unitId);
      conds.push(`gp.unit_id = $${args.length}::uuid`);
    }
    if (filters.direction) {
      args.push(filters.direction);
      conds.push(`gp.direction = $${args.length}`);
    }
    if (filters.passType) {
      args.push(filters.passType);
      conds.push(`gp.pass_type = $${args.length}`);
    }
    if (filters.status) {
      args.push(filters.status);
      conds.push(`gp.status = $${args.length}`);
    }

    const rows = await query(
      prisma,
      `SELECT gp.*, s.name AS supplier_name, c.name AS customer_name, u.code AS unit_code,
              COALESCE((SELECT json_agg(gpl.*) FROM gate_pass_lines gpl WHERE gpl.gate_pass_id = gp.id), '[]'::json) AS lines
       FROM gate_passes gp
       JOIN units u ON u.id = gp.unit_id
       LEFT JOIN suppliers s ON s.id = gp.supplier_id
       LEFT JOIN customers c ON c.id = gp.customer_id
       WHERE ${conds.join(' AND ')}
       ORDER BY gp.created_at DESC`,
      ...args,
    );
    return rows.map(norm);
  }

  async getPass(id: string, db: Db = prisma): Promise<Row> {
    const rows = await query(
      db,
      `SELECT gp.*, s.name AS supplier_name, s.gstin AS supplier_gstin,
              c.name AS customer_name, c.gstin AS customer_gstin,
              u.code AS unit_code, u.name AS unit_name
       FROM gate_passes gp
       JOIN units u ON u.id = gp.unit_id
       LEFT JOIN suppliers s ON s.id = gp.supplier_id
       LEFT JOIN customers c ON c.id = gp.customer_id
       WHERE gp.id = $1::uuid AND gp.deleted_at IS NULL`,
      id,
    );
    if (!rows[0]) throw Errors.notFound(`Gate pass not found: ${id}`);
    const gp = norm(rows[0]);
    const lines = await query(
      db,
      `SELECT gpl.*, i.code AS item_code, i.name AS item_name
       FROM gate_pass_lines gpl
       LEFT JOIN items i ON i.id = gpl.item_id
       WHERE gpl.gate_pass_id = $1::uuid`,
      id,
    );
    gp.lines = lines.map(norm);
    return gp;
  }

  async getOpenPosForSupplier(caller: Caller, supplierId: string): Promise<Row[]> {
    const unitId = caller.ctx.unitId;
    const rows = await query(
      prisma,
      `SELECT po.id AS po_id, po.number AS po_no, po.po_date, po.status,
              pol.id AS po_line_id, pol.item_id, i.code AS item_code, i.name AS item_name,
              pol.qty, pol.received_qty, (pol.qty - pol.received_qty) AS pending_qty, pol.uom
       FROM purchase_orders po
       JOIN purchase_order_lines pol ON pol.po_id = po.id
       LEFT JOIN items i ON i.id = pol.item_id
       WHERE po.supplier_id = $1::uuid
         AND ($2::uuid IS NULL OR po.unit_id = $2::uuid)
         AND po.status IN ('APPROVED','PARTIALLY_RECEIVED','ISSUED','Posted')
         AND (pol.qty - pol.received_qty) > 0
       ORDER BY po.po_date DESC`,
      supplierId,
      unitId ?? null,
    );
    return rows.map(norm);
  }

  async getPendingDispatchLines(caller: Caller): Promise<Row[]> {
    const unitId = caller.ctx.unitId;
    const rows = await query(
      prisma,
      `SELECT sd.id AS dispatch_id, sd.number AS dispatch_no, sd.dispatch_date, sd.customer_id, c.name AS customer_name,
              sdl.id AS dispatch_line_id, sdl.item_id, i.code AS item_code, i.name AS item_name,
              sdl.qty AS dispatched_qty,
              COALESCE((
                SELECT SUM(gpl.qty) FROM gate_pass_lines gpl
                JOIN gate_passes gp ON gp.id = gpl.gate_pass_id
                WHERE gpl.dispatch_line_id = sdl.id AND gp.status IN ('INSIDE','EXITED','CLOSED')
              ), 0) AS gated_qty
       FROM sales_dispatches sd
       JOIN sales_dispatch_lines sdl ON sdl.dispatch_id = sd.id
       JOIN customers c ON c.id = sd.customer_id
       LEFT JOIN items i ON i.id = sdl.item_id
       WHERE ($1::uuid IS NULL OR sd.unit_id = $1::uuid)
         AND UPPER(sd.status) = 'POSTED'
       ORDER BY sd.dispatch_date DESC`,
      unitId ?? null,
    );
    return rows.map(norm).filter((r) => Number(r.dispatchedQty) > Number(r.gatedQty));
  }

  async getOverdueReturnables(caller: Caller): Promise<Row[]> {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await query(
      prisma,
      `SELECT gp.id AS pass_id, gp.pass_no, gp.expected_return_date, gp.supplier_id, s.name AS supplier_name,
              gpl.id AS line_id, gpl.item_id, i.code AS item_code, gpl.description,
              gpl.qty, gpl.returned_qty, gpl.balance_qty, gpl.jobwork_category, gpl.statutory_due_date, gpl.deemed_supply_risk
       FROM gate_pass_lines gpl
       JOIN gate_passes gp ON gp.id = gpl.gate_pass_id
       LEFT JOIN suppliers s ON s.id = gp.supplier_id
       LEFT JOIN items i ON i.id = gpl.item_id
       WHERE gp.pass_type = 'RETURNABLE'
         AND gp.status IN ('EXITED','CLOSED')
         AND gpl.balance_qty > 0
         AND ($1::uuid IS NULL OR gp.unit_id = $1::uuid)
       ORDER BY gp.expected_return_date ASC`,
      caller.ctx.unitId ?? null,
    );
    return rows.map((r) => {
      const row = norm(r);
      const ov = computeReturnableOverdue(
        row.expected_return_date ? String(row.expected_return_date).slice(0, 10) : null,
        today,
        Number(row.balance_qty),
      );
      const stat = evaluateStatutoryStatus(
        row.statutory_due_date ? String(row.statutory_due_date).slice(0, 10) : null,
        today,
      );
      return {
        ...row,
        overdue_days: ov.overdueDays,
        overdue_alert: ov.alertThreshold,
        statutory_days_remaining: stat.daysRemaining,
        statutory_alert: stat.alertThreshold,
      };
    });
  }

  // ------------------------------------------------------------------------- Mutations
  async createPass(
    caller: Caller,
    input: {
      direction: 'IN' | 'OUT';
      passType: 'INWARD_PO' | 'INWARD_RETURN' | 'INWARD_OTHER' | 'OUTWARD_DISPATCH' | 'RETURNABLE' | 'NON_RETURNABLE';
      gateName?: string;
      partyType?: 'SUPPLIER' | 'CUSTOMER' | 'OTHER';
      supplierId?: string;
      customerId?: string;
      partyName?: string;
      vehicleNo: string;
      vehicleId?: string;
      driverName?: string;
      driverMobile?: string;
      driverId?: string;
      photoFileId?: string;
      challanRef?: string;
      challanWeightKg?: number;
      purpose?: string;
      expectedReturnDate?: string;
      isChallan?: boolean;
      isInterState?: boolean;
      ewayBillNo?: string;
      ewayVehicleNo?: string;
      shipmentId?: string;
      visitorNote?: string;
      lines: Array<{
        itemId?: string;
        description: string;
        uom?: string;
        qty: number;
        unitRate?: number;
        value?: number;
        taxAmount?: number;
        hsnCode?: string;
        poId?: string;
        poLineId?: string;
        dispatchId?: string;
        dispatchLineId?: string;
        jobworkCategory?: JobWorkCategory;
        sourceWarehouseId?: string;
        outWarehouseId?: string;
      }>;
    },
  ): Promise<Row> {
    const unitId = caller.ctx.unitId;
    if (!unitId) throw Errors.validation({ unitId: 'Active unit context is required.' });
    const { id: fyId } = await fyOfCaller(caller);

    const pageId =
      input.direction === 'IN'
        ? 'gate-in'
        : input.passType === 'RETURNABLE'
          ? 'gate-return'
          : input.passType === 'NON_RETURNABLE'
            ? 'gate-nonreturn'
            : 'gate-out';

    return prisma.$transaction(async (tx) => {
      const passNo = await allocateShortGateNumber(tx, pageId, unitId, fyId);

      // OUTWARD_DISPATCH doesn't need separate pass approval since dispatch is already posted;
      // RETURNABLE & NON_RETURNABLE start as PENDING unless explicitly auto-approved below threshold
      const approvalStatus = input.passType === 'OUTWARD_DISPATCH' || input.direction === 'IN' ? 'APPROVED' : 'PENDING';

      const gpRows = await query(
        tx,
        `INSERT INTO gate_passes (
          pass_no, unit_id, gate_name, direction, pass_type, party_type, supplier_id, customer_id,
          party_name, vehicle_no, vehicle_id, driver_name, driver_mobile, driver_id, photo_file_id,
          challan_ref, challan_weight_kg, purpose, expected_return_date, is_challan, is_inter_state,
          eway_bill_no, eway_vehicle_no, shipment_id, visitor_note, approval_status, status, created_by_id
        ) VALUES (
          $1,$2::uuid,$3,$4,$5,$6,$7::uuid,$8::uuid,$9,$10,$11::uuid,$12,$13,$14::uuid,$15::uuid,
          $16,$17,$18,$19::date,$20,$21,$22,$23,$24::uuid,$25,$26,'DRAFT',$27::uuid
        ) RETURNING *`,
        passNo,
        unitId,
        input.gateName ?? 'MAIN_GATE',
        input.direction,
        input.passType,
        input.partyType ?? (input.supplierId ? 'SUPPLIER' : input.customerId ? 'CUSTOMER' : 'OTHER'),
        input.supplierId ?? null,
        input.customerId ?? null,
        input.partyName ?? null,
        input.vehicleNo.trim().toUpperCase(),
        input.vehicleId ?? null,
        input.driverName ?? null,
        input.driverMobile ?? null,
        input.driverId ?? null,
        input.photoFileId ?? null,
        input.challanRef ?? null,
        input.challanWeightKg ?? null,
        input.purpose ?? null,
        input.expectedReturnDate ?? null,
        input.isChallan ?? (input.passType === 'RETURNABLE' || input.passType === 'NON_RETURNABLE'),
        input.isInterState ?? false,
        input.ewayBillNo ?? null,
        input.ewayVehicleNo ?? null,
        input.shipmentId ?? null,
        input.visitorNote ?? null,
        approvalStatus,
        caller.auth.userId,
      );
      const gp = norm(gpRows[0]!);

      const dispatchDate = new Date().toISOString().slice(0, 10);
      for (const l of input.lines) {
        const jwCat: JobWorkCategory = l.jobworkCategory ?? 'NONE';
        const statDue =
          input.passType === 'RETURNABLE' ? computeStatutoryDueDate(dispatchDate, jwCat) : null;
        const val = l.value ?? Math.round((l.qty * (l.unitRate ?? 0)) * 100) / 100;

        await exec(
          tx,
          `INSERT INTO gate_pass_lines (
            gate_pass_id, item_id, description, uom, qty, unit_rate, value, tax_amount, hsn_code,
            po_id, po_line_id, dispatch_id, dispatch_line_id, jobwork_category, statutory_due_date,
            source_warehouse_id, out_warehouse_id
          ) VALUES (
            $1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10::uuid,$11::uuid,$12::uuid,$13::uuid,$14,$15::date,$16::uuid,$17::uuid
          )`,
          gp.id,
          l.itemId ?? null,
          l.description,
          l.uom ?? 'NOS',
          l.qty,
          l.unitRate ?? 0,
          val,
          l.taxAmount ?? 0,
          l.hsnCode ?? null,
          l.poId ?? null,
          l.poLineId ?? null,
          l.dispatchId ?? null,
          l.dispatchLineId ?? null,
          jwCat,
          statDue,
          l.sourceWarehouseId ?? null,
          l.outWarehouseId ?? null,
        );
      }

      return this.getPass(String(gp.id), tx);
    });
  }

  async approvePass(caller: Caller, id: string): Promise<Row> {
    const rows = await query(
      prisma,
      `UPDATE gate_passes SET approval_status = 'APPROVED', updated_at = now() WHERE id = $1::uuid RETURNING *`,
      id,
    );
    if (!rows[0]) throw Errors.notFound(`Gate pass not found: ${id}`);
    return norm(rows[0]);
  }

  /**
   * Gate IN enter: stamps entry_at, weigh_in_kg, marks INSIDE, and creates pre-filled GRN draft for INWARD_PO.
   */
  async enterPass(caller: Caller, id: string, weighInKg?: number): Promise<Row> {
    return prisma.$transaction(async (tx) => {
      const gpRows = await query(
        tx,
        `SELECT * FROM gate_passes WHERE id = $1::uuid FOR UPDATE`,
        id,
      );
      if (!gpRows[0]) throw Errors.notFound(`Gate pass not found: ${id}`);
      const gp = gpRows[0];
      if (gp.direction !== 'IN') throw Errors.validation({ direction: 'Only IN passes can enter.' });

      await exec(
        tx,
        `UPDATE gate_passes SET status = 'INSIDE', entry_at = now(), weigh_in_kg = COALESCE($1, weigh_in_kg), updated_at = now() WHERE id = $2::uuid`,
        weighInKg ?? null,
        id,
      );

      if (gp.pass_type === 'INWARD_PO' && gp.supplier_id) {
        const lines = await query(tx, `SELECT * FROM gate_pass_lines WHERE gate_pass_id = $1::uuid`, id);
        const poLine = lines.find((l) => l.po_id);
        if (poLine) {
          const { id: fyId } = await fyOfCaller(caller);
          const grnNo = await NumberingService.allocate(tx as any, {
            pageId: 'scm-grn',
            unitId: String(gp.unit_id),
            fyId,
          });
          // Find default warehouse for unit
          const whRows = await query(
            tx,
            `SELECT id FROM warehouses WHERE unit_id = $1::uuid AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
            gp.unit_id,
          );
          if (whRows[0]) {
            const grnRows = await query(
              tx,
              `INSERT INTO goods_receipts (
                number, unit_id, fy_id, department, warehouse_id, po_id, supplier_id, receipt_date, lr_no, vehicle_no, status, created_by_id
              ) VALUES ($1, $2::uuid, $3::uuid, 'Stores', $4::uuid, $5::uuid, $6::uuid, CURRENT_DATE, $7, $8, 'Draft', $9::uuid)
              RETURNING id`,
              grnNo,
              gp.unit_id,
              fyId,
              whRows[0].id,
              poLine.po_id,
              gp.supplier_id,
              gp.challan_ref ?? gp.pass_no,
              gp.vehicle_no,
              caller.auth.userId,
            );
            const grnId = grnRows[0]?.id;
            if (grnId) {
              for (const l of lines) {
                if (!l.item_id) continue;
                await exec(
                  tx,
                  `INSERT INTO goods_receipt_lines (grn_id, po_line_id, item_id, received_qty, accepted_qty, rejected_qty)
                   VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 0, 0)`,
                  grnId,
                  l.po_line_id ?? null,
                  l.item_id,
                  l.qty,
                );
                await exec(
                  tx,
                  `UPDATE gate_pass_lines SET grn_id = $1::uuid WHERE id = $2::uuid`,
                  grnId,
                  l.id,
                );
              }
            }
          }
        }
      }

      return this.getPass(id, tx);
    });
  }

  /**
   * Weigh-out: records weigh_out_kg, net_kg generated automatically, warns if > 1% diff from challan_weight_kg.
   */
  async weighPass(id: string, weighOutKg: number): Promise<Row> {
    const rows = await query(
      prisma,
      `UPDATE gate_passes SET weigh_out_kg = $1, updated_at = now() WHERE id = $2::uuid RETURNING *`,
      weighOutKg,
      id,
    );
    if (!rows[0]) throw Errors.notFound(`Gate pass not found: ${id}`);
    const gp = norm(rows[0]);
    const netKg = gp.net_kg !== null ? Number(gp.net_kg) : null;
    const chKg = gp.challan_weight_kg !== null ? Number(gp.challan_weight_kg) : null;
    let weightWarning: string | null = null;
    if (netKg !== null && chKg && chKg > 0) {
      const diffPct = Math.abs(netKg - chKg) / chKg;
      if (diffPct > 0.01) {
        weightWarning = `Net weight ${netKg} kg differs from challan weight ${chKg} kg by ${(diffPct * 100).toFixed(2)}% (> 1%).`;
      }
    }
    return { ...gp, weight_warning: weightWarning };
  }

  /**
   * Gate EXIT: validates in a single atomic transaction:
   * - approval_status === 'APPROVED' (or posted dispatch)
   * - line qty <= pending source qty (locks source dispatch line FOR UPDATE to prevent race conditions)
   * - E-way bill required > ₹50,000 or inter-state job work + Part B vehicle match
   * - Own vehicle unexpired documents + driver unexpired licence
   * - StockService transfers (RETURNABLE) or issues (NON_RETURNABLE), or updates shipment DISPATCHED
   */
  async exitPass(caller: Caller, id: string): Promise<Row> {
    return prisma.$transaction(async (tx) => {
      const gpRows = await query(
        tx,
        `SELECT * FROM gate_passes WHERE id = $1::uuid FOR UPDATE`,
        id,
      );
      if (!gpRows[0]) throw Errors.notFound(`Gate pass not found: ${id}`);
      const gp = gpRows[0];

      if (gp.status === 'EXITED' || gp.status === 'CLOSED') {
        throw Errors.conflict('Gate pass has already exited.');
      }

      if (gp.direction === 'IN') {
        await exec(
          tx,
          `UPDATE gate_passes SET status = 'CLOSED', exit_at = now(), updated_at = now() WHERE id = $1::uuid`,
          id,
        );
        return this.getPass(id);
      }

      // Direction OUT checks:
      if (gp.approval_status !== 'APPROVED') {
        throw Errors.validation({ approval: 'Pass not approved — cannot exit.' });
      }

      const lines = await query(
        tx,
        `SELECT * FROM gate_pass_lines WHERE gate_pass_id = $1::uuid`,
        id,
      );

      // 1. Validate line quantities against source dispatch with FOR UPDATE lock
      let totalValue = 0;
      for (const l of lines) {
        totalValue += Number(l.value ?? 0);

        if (gp.pass_type === 'OUTWARD_DISPATCH') {
          if (!l.dispatch_line_id) {
            throw Errors.validation({ line: 'Outward dispatch line must reference a posted delivery.' });
          }
          // Lock the dispatch line to serialize concurrent exits!
          const dlRows = await query(
            tx,
            `SELECT sdl.id, sdl.qty, sd.number AS dispatch_no, sd.status
             FROM sales_dispatch_lines sdl
             JOIN sales_dispatches sd ON sd.id = sdl.dispatch_id
             WHERE sdl.id = $1::uuid FOR UPDATE`,
            l.dispatch_line_id,
          );
          if (!dlRows[0]) throw Errors.notFound('Referenced dispatch line not found.');
          const dl = dlRows[0];
          if (String(dl.status).toUpperCase() !== 'POSTED') {
            const msg = `Delivery ${dl.dispatch_no} is not posted.`;
            throw Errors.validation({ dispatch: msg }, msg);
          }

          const gatedRows = await query(
            tx,
            `SELECT COALESCE(SUM(gpl.qty), 0) AS gated
             FROM gate_pass_lines gpl
             JOIN gate_passes p ON p.id = gpl.gate_pass_id
             WHERE gpl.dispatch_line_id = $1::uuid
               AND p.status IN ('EXITED','CLOSED')
               AND p.id <> $2::uuid`,
            l.dispatch_line_id,
            id,
          );
          const alreadyGated = Number(gatedRows[0]?.gated ?? 0);
          const pending = Math.max(0, Number(dl.qty) - alreadyGated);
          if (Number(l.qty) > pending) {
            const msg = `Quantity ${Number(l.qty)} exceeds pending dispatch quantity ${pending} for ${dl.dispatch_no}.`;
            throw Errors.validation({ qty: msg }, msg);
          }
        }
      }

      // 2. E-way bill check
      const ewCheck = validateEwayBill({
        totalValueInr: totalValue,
        isInterStateJobWork: Boolean(gp.is_inter_state && gp.pass_type === 'RETURNABLE'),
        ewayBillNo: gp.eway_bill_no ? String(gp.eway_bill_no) : null,
        ewayVehicleNo: gp.eway_vehicle_no ? String(gp.eway_vehicle_no) : null,
        gateVehicleNo: gp.vehicle_no ? String(gp.vehicle_no) : null,
      });
      if (!ewCheck.valid) {
        const msg = ewCheck.reason || 'E-way bill validation failed.';
        throw Errors.validation({ ewayBill: msg }, msg);
      }

      // 3. Own vehicle & driver validation
      if (gp.vehicle_id || gp.driver_id) {
        await fleetService.assertVehicleAndDriverValid(
          tx,
          gp.vehicle_id ? String(gp.vehicle_id) : null,
          gp.driver_id ? String(gp.driver_id) : null,
        );
      }

      const postingDate = new Date().toISOString().slice(0, 10);

      // 4. Side effects on stock & shipments
      if (gp.pass_type === 'OUTWARD_DISPATCH' && gp.shipment_id) {
        await exec(
          tx,
          `UPDATE shipments SET status = 'DISPATCHED', actual_dispatch_at = now(), updated_at = now() WHERE id = $1::uuid`,
          gp.shipment_id,
        );
        await exec(
          tx,
          `INSERT INTO tracking_events (shipment_id, milestone, note, source, recorded_by_id)
           VALUES ($1::uuid, 'DISPATCHED', $2, 'MANUAL', $3::uuid)`,
          gp.shipment_id,
          `Exited via Gate Pass ${gp.pass_no}`,
          caller.auth.userId,
        );
      } else if (gp.pass_type === 'RETURNABLE') {
        // Transfer stock from source_warehouse to out_warehouse (Returnable warehouse)
        for (const l of lines) {
          if (l.item_id && l.source_warehouse_id && l.out_warehouse_id) {
            await StockService.postMany(tx, [
              {
                warehouseId: String(l.source_warehouse_id),
                itemId: String(l.item_id),
                direction: 'OUT',
                qty: D(Number(l.qty)),
                postingDate,
                voucherType: 'TRANSFER_OUT',
                voucherId: String(gp.id),
                voucherNo: String(gp.pass_no),
                lineId: String(l.id),
                createdById: caller.auth.userId,
              },
              {
                warehouseId: String(l.out_warehouse_id),
                itemId: String(l.item_id),
                direction: 'IN',
                qty: D(Number(l.qty)),
                postingDate,
                voucherType: 'TRANSFER_IN',
                voucherId: String(gp.id),
                voucherNo: String(gp.pass_no),
                lineId: String(l.id),
                rate: D(Number(l.unit_rate ?? 0)),
                createdById: caller.auth.userId,
              },
            ]);
          }
        }
      } else if (gp.pass_type === 'NON_RETURNABLE') {
        for (const l of lines) {
          if (l.item_id && l.source_warehouse_id) {
            await StockService.postMovement(tx, {
              warehouseId: String(l.source_warehouse_id),
              itemId: String(l.item_id),
              direction: 'OUT',
              qty: D(Number(l.qty)),
              postingDate,
              voucherType: 'ISSUE',
              voucherId: String(gp.id),
              voucherNo: String(gp.pass_no),
              lineId: String(l.id),
              createdById: caller.auth.userId,
            });
          }
        }
      }

      await exec(
        tx,
        `UPDATE gate_passes SET status = 'EXITED', exit_at = now(), updated_at = now() WHERE id = $1::uuid`,
        id,
      );
      await recordAudit(
        {
          actorId: caller.auth.userId,
          action: 'gate.pass.exit',
          targetType: 'gate_passes',
          targetId: String(gp.id),
          detail: { passNo: String(gp.pass_no), passType: String(gp.pass_type) },
        },
        tx,
      );

      return this.getPass(id, tx);
    });
  }

  /**
   * Partial return against a RETURNABLE gate pass line.
   * Updates returned_qty (balance_qty computed) & moves stock back from returnable warehouse to origin.
   */
  async recordReturn(
    caller: Caller,
    inPassId: string,
    returns: Array<{ outLineId: string; qty: number; condition?: string; remarks?: string }>,
  ): Promise<Row> {
    return prisma.$transaction(async (tx) => {
      const inPassRows = await query(tx, `SELECT * FROM gate_passes WHERE id = $1::uuid FOR UPDATE`, inPassId);
      if (!inPassRows[0]) throw Errors.notFound(`Inward return pass not found: ${inPassId}`);

      const postingDate = new Date().toISOString().slice(0, 10);
      const createdReceipts: Row[] = [];

      for (const r of returns) {
        const lineRows = await query(
          tx,
          `SELECT gpl.*, gp.pass_no AS out_pass_no FROM gate_pass_lines gpl JOIN gate_passes gp ON gp.id = gpl.gate_pass_id WHERE gpl.id = $1::uuid FOR UPDATE`,
          r.outLineId,
        );
        if (!lineRows[0]) throw Errors.notFound(`Outward line not found: ${r.outLineId}`);
        const outLine = lineRows[0];
        const balance = Number(outLine.balance_qty);

        if (r.qty > balance) {
          const msg = `Return quantity exceeds balance ${balance}.`;
          throw Errors.validation({ qty: msg }, msg);
        }

        const recRows = await query(
          tx,
          `INSERT INTO gate_return_receipts (out_line_id, in_pass_id, qty, condition, remarks, created_by_id)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid) RETURNING *`,
          r.outLineId,
          inPassId,
          r.qty,
          r.condition ?? 'GOOD',
          r.remarks ?? null,
          caller.auth.userId,
        );
        createdReceipts.push(norm(recRows[0]!));

        await exec(
          tx,
          `UPDATE gate_pass_lines SET returned_qty = returned_qty + $1 WHERE id = $2::uuid`,
          r.qty,
          r.outLineId,
        );

        // Return stock from out_warehouse back to source_warehouse
        if (outLine.item_id && outLine.out_warehouse_id && outLine.source_warehouse_id) {
          await StockService.postMany(tx, [
            {
              warehouseId: String(outLine.out_warehouse_id),
              itemId: String(outLine.item_id),
              direction: 'OUT',
              qty: D(r.qty),
              postingDate,
              voucherType: 'TRANSFER_OUT',
              voucherId: inPassId,
              voucherNo: String(inPassRows[0].pass_no),
              lineId: String(outLine.id),
              createdById: caller.auth.userId,
            },
            {
              warehouseId: String(outLine.source_warehouse_id),
              itemId: String(outLine.item_id),
              direction: 'IN',
              qty: D(r.qty),
              postingDate,
              voucherType: 'TRANSFER_IN',
              voucherId: inPassId,
              voucherNo: String(inPassRows[0].pass_no),
              lineId: String(outLine.id),
              rate: D(Number(outLine.unit_rate ?? 0)),
              createdById: caller.auth.userId,
            },
          ]);
        }
      }

      await exec(tx, `UPDATE gate_passes SET status = 'CLOSED', exit_at = COALESCE(exit_at, now()) WHERE id = $1::uuid`, inPassId);
      return { inPassId, receipts: createdReceipts };
    });
  }

  /**
   * Generates Triplicate CGST Rule 55 Delivery Challan PDF & records audit log with copy name.
   */
  async printChallanPdf(caller: Caller, id: string): Promise<Buffer> {
    const gp = await this.getPass(id);
    const copies = [
      'ORIGINAL FOR CONSIGNEE',
      'DUPLICATE FOR TRANSPORTER',
      'TRIPLICATE FOR CONSIGNOR',
    ];

    await recordAudit(
      {
        actorId: caller.auth.userId,
        action: 'gate.challan.print',
        targetType: 'gate_passes',
        targetId: String(gp.id),
        detail: { passNo: String(gp.pass_no), copies },
      },
      prisma,
    );

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      copies.forEach((copyTitle, idx) => {
        if (idx > 0) doc.addPage();
        doc.fontSize(10).text(copyTitle, { align: 'right' });
        doc.fontSize(16).text('DELIVERY CHALLAN (CGST Rule 55)', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(10);
        doc.text(`Challan No: ${gp.pass_no}   |   Date: ${String(gp.created_at).slice(0, 10)}`);
        doc.text(`Unit: ${gp.unit_name} (${gp.unit_code})`);
        doc.text(`Consignee: ${gp.supplier_name || gp.customer_name || gp.party_name || '-'}`);
        doc.text(`Vehicle No: ${gp.vehicle_no}   |   E-Way Bill: ${gp.eway_bill_no || 'N/A'}`);
        doc.text(`Purpose: ${gp.purpose || gp.pass_type}`);
        doc.moveDown(1);

        doc.fontSize(10).text('Item Details:', { underline: true });
        doc.moveDown(0.3);
        const lines = Array.isArray(gp.lines) ? gp.lines : [];
        for (const l of lines) {
          doc.text(
            `• ${l.description} (HSN: ${l.hsn_code || '-'}) — Qty: ${l.qty} ${l.uom}   Value: INR ${Number(l.value).toFixed(2)}`,
          );
        }
        doc.moveDown(2);
        doc.text('Authorized Signatory', { align: 'right' });
      });

      doc.end();
    });
  }

  /**
   * Background Job: gate.returnable.overdue (daily 07:00)
   * Updates deemed_supply_risk on expired s.143 statutory dates and counts overdue alerts.
   */
  async runOverdueJob(asOfDate?: string): Promise<{ overdueCount: number; statutoryDeemedSupply: number }> {
    const today = asOfDate || new Date().toISOString().slice(0, 10);
    const lines = await query(
      prisma,
      `SELECT gpl.id, gpl.balance_qty, gpl.statutory_due_date, gpl.deemed_supply_risk, gp.expected_return_date
       FROM gate_pass_lines gpl
       JOIN gate_passes gp ON gp.id = gpl.gate_pass_id
       WHERE gp.pass_type = 'RETURNABLE' AND gpl.balance_qty > 0`,
    );

    let overdueCount = 0;
    let statutoryDeemedSupply = 0;

    for (const l of lines) {
      if (l.expected_return_date) {
        const expIso =
          l.expected_return_date instanceof Date
            ? l.expected_return_date.toISOString().slice(0, 10)
            : String(l.expected_return_date).slice(0, 10);
        const ov = computeReturnableOverdue(expIso, today, Number(l.balance_qty));
        if (ov.alertThreshold !== null) overdueCount++;
      }
      if (l.statutory_due_date) {
        const statIso =
          l.statutory_due_date instanceof Date
            ? l.statutory_due_date.toISOString().slice(0, 10)
            : String(l.statutory_due_date).slice(0, 10);
        const stat = evaluateStatutoryStatus(statIso, today);
        if (stat.deemedSupplyRisk && !l.deemed_supply_risk) {
          await exec(
            prisma,
            `UPDATE gate_pass_lines SET deemed_supply_risk = true WHERE id = $1::uuid`,
            l.id,
          );
          statutoryDeemedSupply++;
        }
      }
    }

    return { overdueCount, statutoryDeemedSupply };
  }
}

export const gateService = new GateService();

