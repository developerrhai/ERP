// apps/api/src/modules/logistics/logistics-service.ts
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
import { recordAudit } from '../../core/audit/audit-service';
import { norm, query, exec, fyOfCaller } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { PostingService } from '../finance/posting-service';
import { fleetService } from './fleet-service';
import {
  calculateFreight,
  checkFreightVariance,
  validateIso6346Container,
  type FreightBasis,
} from './logistics-calc';

export class LogisticsService {
  // ------------------------------------------------------------------------- Transporters
  async listTransporters(): Promise<Row[]> {
    const rows = await query(
      prisma,
      `SELECT s.id, s.code, s.name, s.gstin, s.pan, stp.transin, stp.vehicle_types, stp.gta_rcm, stp.insurance_valid_till, stp.rating
       FROM suppliers s
       LEFT JOIN supplier_transporter_profiles stp ON stp.supplier_id = s.id
       WHERE s.is_transporter = true AND s.deleted_at IS NULL
       ORDER BY s.name ASC`,
    );
    return rows.map(norm);
  }

  async upsertTransporterProfile(
    caller: Caller,
    supplierId: string,
    input: {
      transin?: string;
      pan?: string;
      vehicleTypes?: string[];
      gtaRcm?: boolean;
      insuranceValidTill?: string;
      rating?: number;
    },
  ): Promise<Row> {
    await exec(prisma, `UPDATE suppliers SET is_transporter = true WHERE id = $1::uuid`, supplierId);
    const rows = await query(
      prisma,
      `INSERT INTO supplier_transporter_profiles (
        supplier_id, transin, pan, vehicle_types, gta_rcm, insurance_valid_till, rating, updated_at
      ) VALUES ($1::uuid, $2, $3, $4::jsonb, $5, $6::date, $7, now())
      ON CONFLICT (supplier_id) DO UPDATE SET
        transin = EXCLUDED.transin,
        pan = EXCLUDED.pan,
        vehicle_types = EXCLUDED.vehicle_types,
        gta_rcm = EXCLUDED.gta_rcm,
        insurance_valid_till = EXCLUDED.insurance_valid_till,
        rating = EXCLUDED.rating,
        updated_at = now()
      RETURNING *`,
      supplierId,
      input.transin ?? null,
      input.pan ?? null,
      JSON.stringify(input.vehicleTypes ?? []),
      input.gtaRcm ?? true,
      input.insuranceValidTill ?? null,
      input.rating ?? 5.0,
    );
    return norm(rows[0]!);
  }

  async addTransporterLane(
    supplierId: string,
    input: { routeId: string; vehicleType: string },
  ): Promise<Row> {
    const rows = await query(
      prisma,
      `INSERT INTO transporter_lanes (supplier_id, route_id, vehicle_type)
       VALUES ($1::uuid, $2::uuid, $3)
       ON CONFLICT (supplier_id, route_id, vehicle_type) DO UPDATE SET vehicle_type = EXCLUDED.vehicle_type
       RETURNING *`,
      supplierId,
      input.routeId,
      input.vehicleType,
    );
    return norm(rows[0]!);
  }

  // ------------------------------------------------------------------------- Routes
  async listRoutes(): Promise<Row[]> {
    const rows = await query(
      prisma,
      `SELECT r.*, s.name AS primary_transporter_name
       FROM routes r
       LEFT JOIN suppliers s ON s.id = r.primary_transporter_id
       WHERE r.deleted_at IS NULL
       ORDER BY r.code ASC`,
    );
    return rows.map(norm);
  }

  async createRoute(
    caller: Caller,
    input: {
      code: string;
      name: string;
      originUnitId?: string;
      originPlace: string;
      destinationPlace: string;
      distanceKm: number;
      stdTransitHrs: number;
      tollCost?: number;
      restrictionText?: string;
      primaryTransporterId?: string;
      stops?: Array<{ seq: number; place: string; kmFromOrigin: number; stdHaltMin: number }>;
    },
  ): Promise<Row> {
    return prisma.$transaction(async (tx) => {
      const rows = await query(
        tx,
        `INSERT INTO routes (
          code, name, origin_unit_id, origin_place, destination_place, distance_km,
          std_transit_hrs, toll_cost, restriction_text, primary_transporter_id, created_by_id
        ) VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10::uuid,$11::uuid)
        RETURNING *`,
        input.code.trim().toUpperCase(),
        input.name,
        input.originUnitId ?? caller.ctx.unitId ?? null,
        input.originPlace,
        input.destinationPlace,
        input.distanceKm,
        input.stdTransitHrs,
        input.tollCost ?? 0,
        input.restrictionText ?? null,
        input.primaryTransporterId ?? null,
        caller.auth.userId,
      );
      const route = norm(rows[0]!);
      for (const st of input.stops ?? []) {
        await exec(
          tx,
          `INSERT INTO route_stops (route_id, seq, place, km_from_origin, std_halt_min)
           VALUES ($1::uuid, $2, $3, $4, $5)`,
          route.id,
          st.seq,
          st.place,
          st.kmFromOrigin,
          st.stdHaltMin,
        );
      }
      return route;
    });
  }

  // ------------------------------------------------------------------------- Freight Rate Cards & Calculations
  async listRateCards(): Promise<Row[]> {
    const rows = await query(
      prisma,
      `SELECT frc.*, s.name AS supplier_name, r.name AS route_name,
              COALESCE((SELECT json_agg(frs.* ORDER BY frs.from_qty) FROM freight_rate_slabs frs WHERE frs.rate_card_id = frc.id), '[]'::json) AS slabs
       FROM freight_rate_cards frc
       JOIN suppliers s ON s.id = frc.supplier_id
       JOIN routes r ON r.id = frc.route_id
       WHERE frc.deleted_at IS NULL
       ORDER BY frc.created_at DESC`,
    );
    return rows.map(norm);
  }

  async createRateCard(
    caller: Caller,
    input: {
      code: string;
      supplierId: string;
      routeId: string;
      vehicleType: string;
      basis: FreightBasis;
      flatRate?: number;
      minCharge?: number;
      minKm?: number;
      fuelSurchargePct?: number;
      validFrom: string;
      validTill: string;
      slabs?: Array<{ fromQty: number; toQty: number; rate: number }>;
    },
  ): Promise<Row> {
    return prisma.$transaction(async (tx) => {
      const rows = await query(
        tx,
        `INSERT INTO freight_rate_cards (
          code, supplier_id, route_id, vehicle_type, basis, flat_rate, min_charge, min_km,
          fuel_surcharge_pct, valid_from, valid_till, status, approval_status, created_by_id
        ) VALUES ($1,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10::date,$11::date,'DRAFT','PENDING',$12::uuid)
        RETURNING *`,
        input.code.trim().toUpperCase(),
        input.supplierId,
        input.routeId,
        input.vehicleType,
        input.basis,
        input.flatRate ?? 0,
        input.minCharge ?? 0,
        input.minKm ?? 0,
        input.fuelSurchargePct ?? 0,
        input.validFrom,
        input.validTill,
        caller.auth.userId,
      );
      const card = norm(rows[0]!);
      for (const s of input.slabs ?? []) {
        await exec(
          tx,
          `INSERT INTO freight_rate_slabs (rate_card_id, from_qty, to_qty, rate) VALUES ($1::uuid,$2,$3,$4)`,
          card.id,
          s.fromQty,
          s.toQty,
          s.rate,
        );
      }
      return card;
    });
  }

  async approveRateCard(id: string): Promise<Row> {
    const rows = await query(
      prisma,
      `UPDATE freight_rate_cards SET status = 'APPROVED', approval_status = 'APPROVED', updated_at = now()
       WHERE id = $1::uuid RETURNING *`,
      id,
    );
    if (!rows[0]) throw Errors.notFound(`Rate card not found: ${id}`);
    return norm(rows[0]);
  }

  async calculateAndSaveFreight(
    caller: Caller,
    input: {
      rateCardId: string;
      shipmentId?: string;
      weightKg?: number;
      volumeCbm?: number;
      distanceKm?: number;
      tollAmount?: number;
      loadingAmount?: number;
      otherAmount?: number;
      billedAmount?: number;
      gtaRcmApplicable?: boolean;
      save?: boolean;
    },
  ): Promise<Row> {
    const cardRows = await query(
      prisma,
      `SELECT frc.*, r.distance_km AS route_dist, r.toll_cost AS route_toll
       FROM freight_rate_cards frc
       JOIN routes r ON r.id = frc.route_id
       WHERE frc.id = $1::uuid`,
      input.rateCardId,
    );
    if (!cardRows[0]) throw Errors.notFound(`Rate card not found: ${input.rateCardId}`);
    const card = cardRows[0];

    const slabRows = await query(
      prisma,
      `SELECT from_qty, to_qty, rate FROM freight_rate_slabs WHERE rate_card_id = $1::uuid ORDER BY from_qty ASC`,
      input.rateCardId,
    );

    const calc = calculateFreight({
      basis: card.basis as FreightBasis,
      weightKg: input.weightKg,
      volumeCbm: input.volumeCbm,
      distanceKm: input.distanceKm ?? Number(card.route_dist),
      flatRate: Number(card.flat_rate),
      minCharge: Number(card.min_charge),
      minKm: Number(card.min_km),
      fuelSurchargePct: Number(card.fuel_surcharge_pct),
      tollAmount: input.tollAmount ?? Number(card.route_toll),
      loadingAmount: input.loadingAmount ?? 0,
      otherAmount: input.otherAmount ?? 0,
      gtaRcmApplicable: input.gtaRcmApplicable ?? true,
      slabs: slabRows.map((s) => ({
        fromQty: Number(s.from_qty),
        toQty: Number(s.to_qty),
        rate: Number(s.rate),
      })),
    });

    const variance =
      input.billedAmount !== undefined
        ? checkFreightVariance(calc.totalAmount, input.billedAmount)
        : { varianceAmount: 0, variancePct: 0, requiresApproval: false };

    if (!input.save) {
      return {
        ...calc,
        ...variance,
      };
    }

    const unitId = caller.ctx.unitId || '';
    const { id: fyId } = await fyOfCaller(caller);
    const calcNo = await NumberingService.allocate(prisma as any, {
      pageId: 'log-freight',
      unitId,
      fyId,
    });

    const saved = await query(
      prisma,
      `INSERT INTO freight_calculations (
        calc_no, unit_id, shipment_id, rate_card_id, weight_kg, volume_cbm, distance_km,
        base_amount, fuel_surcharge, toll_amount, loading_amount, other_amount, total_amount,
        gta_rcm_amount, billed_amount, variance_amount, variance_pct, approval_status, status, created_by_id
      ) VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'CALCULATED',$19::uuid)
      RETURNING *`,
      calcNo,
      unitId,
      input.shipmentId ?? null,
      input.rateCardId,
      input.weightKg ?? 0,
      input.volumeCbm ?? 0,
      input.distanceKm ?? Number(card.route_dist),
      calc.baseAmount,
      calc.fuelSurcharge,
      calc.tollAmount,
      calc.loadingAmount,
      calc.otherAmount,
      calc.totalAmount,
      calc.gtaRcmAmount,
      input.billedAmount ?? null,
      variance.varianceAmount,
      variance.variancePct,
      variance.requiresApproval ? 'PENDING' : 'NONE',
      caller.auth.userId,
    );

    return norm(saved[0]!);
  }

  // ------------------------------------------------------------------------- Shipments & Tracking
  async listShipments(caller: Caller, status?: string): Promise<Row[]> {
    const cond = status ? `AND s.status = $1` : '';
    const args = status ? [status] : [];
    const rows = await query(
      prisma,
      `SELECT s.*, c.name AS customer_name, sup.name AS transporter_name,
              v.reg_no AS vehicle_reg_no, d.name AS driver_name, r.name AS route_name
       FROM shipments s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN suppliers sup ON sup.id = s.transporter_id
       LEFT JOIN vehicles v ON v.id = s.vehicle_id
       LEFT JOIN drivers d ON d.id = s.driver_id
       LEFT JOIN routes r ON r.id = s.route_id
       WHERE s.deleted_at IS NULL ${cond}
       ORDER BY s.created_at DESC`,
      ...args,
    );
    return rows.map(norm);
  }

  async createShipment(
    caller: Caller,
    input: {
      customerId?: string;
      transporterId?: string;
      vehicleId?: string;
      hiredVehicleNo?: string;
      driverId?: string;
      hiredDriverName?: string;
      hiredDriverMobile?: string;
      routeId?: string;
      plannedDispatchAt?: string;
      plannedDeliveryAt?: string;
      lrNo?: string;
      lrDate?: string;
      ewayBillNo?: string;
      ewayValidTill?: string;
      weightKg?: number;
      volumeCbm?: number;
      lines?: Array<{ dispatchId?: string; salesOrderId?: string; weightKg?: number; volumeCbm?: number }>;
    },
  ): Promise<Row> {
    return prisma.$transaction(async (tx) => {
      if (input.vehicleId || input.driverId) {
        await fleetService.assertVehicleAndDriverValid(tx, input.vehicleId, input.driverId);
      }

      const unitId = caller.ctx.unitId || '';
      const { id: fyId } = await fyOfCaller(caller);
      const shipmentNo = await NumberingService.allocate(tx as any, {
        pageId: 'log-shipments',
        unitId,
        fyId,
      });

      const sRows = await query(
        tx,
        `INSERT INTO shipments (
          shipment_no, unit_id, customer_id, transporter_id, vehicle_id, hired_vehicle_no,
          driver_id, hired_driver_name, hired_driver_mobile, route_id, planned_dispatch_at,
          planned_delivery_at, lr_no, lr_date, eway_bill_no, eway_valid_till, weight_kg, volume_cbm,
          status, created_by_id
        ) VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7::uuid,$8,$9,$10::uuid,$11::timestamptz,$12::timestamptz,$13,$14::date,$15,$16::timestamptz,$17,$18,'PLANNED',$19::uuid)
        RETURNING *`,
        shipmentNo,
        unitId,
        input.customerId ?? null,
        input.transporterId ?? null,
        input.vehicleId ?? null,
        input.hiredVehicleNo ?? null,
        input.driverId ?? null,
        input.hiredDriverName ?? null,
        input.hiredDriverMobile ?? null,
        input.routeId ?? null,
        input.plannedDispatchAt ?? null,
        input.plannedDeliveryAt ?? null,
        input.lrNo ?? null,
        input.lrDate ?? null,
        input.ewayBillNo ?? null,
        input.ewayValidTill ?? null,
        input.weightKg ?? 0,
        input.volumeCbm ?? 0,
        caller.auth.userId,
      );
      const shp = norm(sRows[0]!);

      for (const l of input.lines ?? []) {
        await exec(
          tx,
          `INSERT INTO shipment_lines (shipment_id, dispatch_id, sales_order_id, weight_kg, volume_cbm)
           VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5)`,
          shp.id,
          l.dispatchId ?? null,
          l.salesOrderId ?? null,
          l.weightKg ?? 0,
          l.volumeCbm ?? 0,
        );
      }

      await exec(
        tx,
        `INSERT INTO tracking_events (shipment_id, milestone, note, source, recorded_by_id)
         VALUES ($1::uuid, 'PLANNED', 'Shipment created', 'MANUAL', $2::uuid)`,
        shp.id,
        caller.auth.userId,
      );

      return shp;
    });
  }

  async allocateShipment(
    caller: Caller,
    id: string,
    input: { vehicleId?: string; driverId?: string; transporterId?: string; hiredVehicleNo?: string },
  ): Promise<Row> {
    return prisma.$transaction(async (tx) => {
      await fleetService.assertVehicleAndDriverValid(tx, input.vehicleId, input.driverId);
      const rows = await query(
        tx,
        `UPDATE shipments SET
          vehicle_id = COALESCE($1::uuid, vehicle_id),
          driver_id = COALESCE($2::uuid, driver_id),
          transporter_id = COALESCE($3::uuid, transporter_id),
          hired_vehicle_no = COALESCE($4, hired_vehicle_no),
          status = 'LOADING',
          updated_at = now()
         WHERE id = $5::uuid RETURNING *`,
        input.vehicleId ?? null,
        input.driverId ?? null,
        input.transporterId ?? null,
        input.hiredVehicleNo ?? null,
        id,
      );
      if (!rows[0]) throw Errors.notFound(`Shipment not found: ${id}`);
      await exec(
        tx,
        `INSERT INTO tracking_events (shipment_id, milestone, note, source, recorded_by_id)
         VALUES ($1::uuid, 'LOADING', 'Vehicle allocated for loading', 'MANUAL', $2::uuid)`,
        id,
        caller.auth.userId,
      );
      return norm(rows[0]);
    });
  }

  async addTrackingEvent(
    caller: Caller,
    shipmentId: string,
    input: { milestone: string; location?: string; etaAt?: string; delayMins?: number; note?: string },
  ): Promise<Row> {
    const rows = await query(
      prisma,
      `INSERT INTO tracking_events (shipment_id, milestone, location, eta_at, delay_mins, note, source, recorded_by_id)
       VALUES ($1::uuid, $2, $3, $4::timestamptz, $5, $6, 'MANUAL', $7::uuid)
       RETURNING *`,
      shipmentId,
      input.milestone,
      input.location ?? null,
      input.etaAt ?? null,
      input.delayMins ?? 0,
      input.note ?? null,
      caller.auth.userId,
    );
    return norm(rows[0]!);
  }

  async listTrackingEvents(shipmentId: string): Promise<Row[]> {
    const rows = await query(
      prisma,
      `SELECT * FROM tracking_events WHERE shipment_id = $1::uuid ORDER BY recorded_at ASC`,
      shipmentId,
    );
    return rows.map(norm);
  }

  // ------------------------------------------------------------------------- PODs
  async recordPod(
    caller: Caller,
    input: {
      shipmentId: string;
      deliveredAt?: string;
      receiverName: string;
      receiverMobile?: string;
      storedFileId?: string;
      remarks?: string;
      lines?: Array<{ itemId?: string; shortQty: number; damageQty: number; remark?: string }>;
    },
  ): Promise<Row> {
    return prisma.$transaction(async (tx) => {
      const podRows = await query(
        tx,
        `INSERT INTO pods (
          shipment_id, delivered_at, receiver_name, receiver_mobile, stored_file_id, remarks, created_by_id
        ) VALUES ($1::uuid, $2::timestamptz, $3, $4, $5::uuid, $6, $7::uuid)
        RETURNING *`,
        input.shipmentId,
        input.deliveredAt ?? new Date().toISOString(),
        input.receiverName,
        input.receiverMobile ?? null,
        input.storedFileId ?? null,
        input.remarks ?? null,
        caller.auth.userId,
      );
      const pod = norm(podRows[0]!);
      for (const l of input.lines ?? []) {
        await exec(
          tx,
          `INSERT INTO pod_lines (pod_id, item_id, short_qty, damage_qty, remark)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5)`,
          pod.id,
          l.itemId ?? null,
          l.shortQty,
          l.damageQty,
          l.remark ?? null,
        );
      }
      await exec(
        tx,
        `UPDATE shipments SET status = 'POD_RECEIVED', actual_delivery_at = $1::timestamptz, updated_at = now() WHERE id = $2::uuid`,
        input.deliveredAt ?? new Date().toISOString(),
        input.shipmentId,
      );
      return pod;
    });
  }

  async releasePodBilling(caller: Caller, podId: string): Promise<Row> {
    const rows = await query(
      prisma,
      `UPDATE pods SET billing_released = true WHERE id = $1::uuid RETURNING *`,
      podId,
    );
    if (!rows[0]) throw Errors.notFound(`POD not found: ${podId}`);
    return norm(rows[0]);
  }

  // ------------------------------------------------------------------------- Containers (ISO 6346)
  async listContainers(): Promise<Row[]> {
    const rows = await query(prisma, `SELECT * FROM containers ORDER BY created_at DESC`);
    return rows.map(norm);
  }

  async createContainer(
    input: { containerNo: string; containerType?: string; owner?: string; freeDays?: number },
  ): Promise<Row> {
    const check = validateIso6346Container(input.containerNo);
    if (!check.valid) {
      const msg = check.reason || 'Container number check digit invalid.';
      throw Errors.validation({ containerNo: msg }, msg);
    }
    const rows = await query(
      prisma,
      `INSERT INTO containers (container_no, container_type, owner, free_days)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      input.containerNo.trim().toUpperCase(),
      input.containerType ?? '20GP',
      input.owner ?? null,
      input.freeDays ?? 7,
    );
    return norm(rows[0]!);
  }

  async recordContainerMovement(
    caller: Caller,
    containerId: string,
    input: { eventType: string; shipmentId?: string; location?: string; demurrageDays?: number; remarks?: string },
  ): Promise<Row> {
    return prisma.$transaction(async (tx) => {
      const rows = await query(
        tx,
        `INSERT INTO container_movements (container_id, shipment_id, event_type, location, demurrage_days, remarks, created_by_id)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid) RETURNING *`,
        containerId,
        input.shipmentId ?? null,
        input.eventType,
        input.location ?? null,
        input.demurrageDays ?? 0,
        input.remarks ?? null,
        caller.auth.userId,
      );
      await exec(
        tx,
        `UPDATE containers SET current_status = $1, current_location = $2, last_move_at = now() WHERE id = $3::uuid`,
        input.eventType,
        input.location ?? null,
        containerId,
      );
      return norm(rows[0]!);
    });
  }
}

export const logisticsService = new LogisticsService();

