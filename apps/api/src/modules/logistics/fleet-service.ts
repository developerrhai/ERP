// apps/api/src/modules/logistics/fleet-service.ts
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
import { recordAudit } from '../../core/audit/audit-service';
import { norm, query, exec, fyOfCaller } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { PostingService } from '../finance/posting-service';
import { StockService } from '../inventory/stock/stock-service';
import { D } from '../inventory/money';
import { analyzeFuelLog, evaluateDocumentExpiry } from './logistics-calc';

function fmtDateIn(d: Date | string): string {
  const iso = typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  const [y, m, day] = iso.split('-');
  return `${day}-${m}-${y}`;
}

export class FleetService {
  // ------------------------------------------------------------------------- Vehicles
  async listVehicles(caller: Caller): Promise<Row[]> {
    const sql = `
      SELECT v.*, u.code AS unit_code,
             COALESCE(
               (SELECT json_agg(json_build_object(
                 'id', vd.id, 'docTypeCode', vd.doc_type_code, 'docNo', vd.doc_no,
                 'expiryDate', vd.expiry_date, 'status', vd.status
               ))
               FROM vehicle_documents vd WHERE vd.vehicle_id = v.id), '[]'::json
             ) AS documents
      FROM vehicles v
      JOIN units u ON u.id = v.unit_id
      WHERE v.deleted_at IS NULL
      ORDER BY v.reg_no ASC
    `;
    const rows = await query(prisma, sql);
    return rows.map(norm);
  }

  async getVehicle(caller: Caller, id: string): Promise<Row> {
    const rows = await query(
      prisma,
      `SELECT v.*, u.code AS unit_code FROM vehicles v JOIN units u ON u.id = v.unit_id WHERE v.id = $1::uuid AND v.deleted_at IS NULL`,
      id,
    );
    if (!rows[0]) throw Errors.notFound(`Vehicle not found: ${id}`);
    const v = norm(rows[0]);
    const docs = await query(
      prisma,
      `SELECT vd.*, vdt.name AS doc_type_name, vdt.required_for
       FROM vehicle_documents vd
       JOIN vehicle_document_types vdt ON vdt.code = vd.doc_type_code
       WHERE vd.vehicle_id = $1::uuid ORDER BY vd.expiry_date ASC`,
      id,
    );
    v.documents = docs.map(norm);
    return v;
  }

  async createVehicle(
    caller: Caller,
    input: {
      regNo: string;
      vehicleType: string;
      ownership?: 'OWN' | 'LEASED';
      isTransport?: boolean;
      unitId?: string;
      makeModel?: string;
      fuelType?: 'DIESEL' | 'PETROL' | 'CNG' | 'ELECTRIC';
      tankCapacityL?: number;
      stdKmpl?: number;
      currentOdometer?: number;
      assetId?: string;
      costCenterId?: string;
    },
  ): Promise<Row> {
    const unitId = input.unitId || caller.ctx.unitId;
    if (!unitId) throw Errors.validation({ unitId: 'Unit is required.' });
    const regNo = input.regNo.trim().toUpperCase();
    const rows = await query(
      prisma,
      `INSERT INTO vehicles (
        reg_no, vehicle_type, ownership, is_transport, unit_id, make_model,
        fuel_type, tank_capacity_l, std_kmpl, current_odometer, asset_id, cost_center_id, created_by_id
      ) VALUES ($1,$2,$3,$4,$5::uuid,$6,$7,$8,$9,$10,$11::uuid,$12::uuid,$13::uuid)
      RETURNING *`,
      regNo,
      input.vehicleType,
      input.ownership ?? 'OWN',
      input.isTransport ?? true,
      unitId,
      input.makeModel ?? null,
      input.fuelType ?? 'DIESEL',
      input.tankCapacityL ?? 60,
      input.stdKmpl ?? 4.5,
      input.currentOdometer ?? 0,
      input.assetId ?? null,
      input.costCenterId ?? null,
      caller.auth.userId,
    );
    const created = norm(rows[0]!);
    await recordAudit(
      {
        actorId: caller.auth.userId,
        action: 'fleet.vehicle.create',
        targetType: 'vehicles',
        targetId: String(created.id),
        detail: { regNo },
      },
      prisma,
    );
    return created;
  }

  async addVehicleDocument(
    caller: Caller,
    vehicleId: string,
    input: {
      docTypeCode: string;
      docNo: string;
      issueDate?: string;
      expiryDate: string;
      authority?: string;
      storedFileId?: string;
    },
  ): Promise<Row> {
    const today = new Date().toISOString().slice(0, 10);
    const expCheck = evaluateDocumentExpiry(input.expiryDate.slice(0, 10), today);
    const rows = await query(
      prisma,
      `INSERT INTO vehicle_documents (
        vehicle_id, doc_type_code, doc_no, issue_date, expiry_date, authority, stored_file_id, status, created_by_id
      ) VALUES ($1::uuid, $2, $3, $4::date, $5::date, $6, $7::uuid, $8, $9::uuid)
      RETURNING *`,
      vehicleId,
      input.docTypeCode,
      input.docNo,
      input.issueDate ?? null,
      input.expiryDate,
      input.authority ?? null,
      input.storedFileId ?? null,
      expCheck.status,
      caller.auth.userId,
    );
    return norm(rows[0]!);
  }

  // ------------------------------------------------------------------------- Drivers
  async listDrivers(caller: Caller): Promise<Row[]> {
    const rows = await query(
      prisma,
      `SELECT d.*, e.emp_code AS employee_code FROM drivers d LEFT JOIN employees e ON e.id = d.employee_id WHERE d.deleted_at IS NULL ORDER BY d.name ASC`,
    );
    return rows.map(norm);
  }

  async createDriver(
    caller: Caller,
    input: {
      employeeId?: string;
      name: string;
      mobile: string;
      licenceNo: string;
      licenceClass?: string;
      licenceExpiry: string;
      hazardousEndorsement?: boolean;
    },
  ): Promise<Row> {
    const rows = await query(
      prisma,
      `INSERT INTO drivers (
        employee_id, name, mobile, licence_no, licence_class, licence_expiry, hazardous_endorsement, created_by_id
      ) VALUES ($1::uuid, $2, $3, $4, $5, $6::date, $7, $8::uuid)
      RETURNING *`,
      input.employeeId ?? null,
      input.name,
      input.mobile,
      input.licenceNo.trim().toUpperCase(),
      input.licenceClass ?? 'HMV',
      input.licenceExpiry,
      input.hazardousEndorsement ?? false,
      caller.auth.userId,
    );
    return norm(rows[0]!);
  }

  /**
   * Motor Vehicles Act / CMVR trip validation:
   * - Own vehicle: no required document expired
   * - Driver: licence not expired
   */
  async assertVehicleAndDriverValid(
    tx: Db,
    vehicleId?: string | null,
    driverId?: string | null,
    asOfDate?: string,
  ): Promise<void> {
    const today = asOfDate ?? new Date().toISOString().slice(0, 10);

    if (vehicleId) {
      const vehRows = await query(
        tx,
        `SELECT * FROM vehicles WHERE id = $1::uuid AND deleted_at IS NULL`,
        vehicleId,
      );
      if (!vehRows[0]) throw Errors.notFound(`Vehicle not found: ${vehicleId}`);
      const veh = vehRows[0];

      const docTypes = await query(
        tx,
        `SELECT code, name, required_for FROM vehicle_document_types`,
      );
      const vehDocs = await query(
        tx,
        `SELECT vd.*, vdt.name AS type_name FROM vehicle_documents vd JOIN vehicle_document_types vdt ON vdt.code = vd.doc_type_code WHERE vd.vehicle_id = $1::uuid ORDER BY vd.expiry_date DESC`,
        vehicleId,
      );

      for (const dt of docTypes) {
        const req = dt.required_for === 'ALL' || (dt.required_for === 'TRANSPORT' && Boolean(veh.is_transport));
        if (!req) continue;
        const latestDoc = vehDocs.find((d) => d.doc_type_code === dt.code);
        if (!latestDoc) {
          const msg = `Vehicle ${veh.reg_no} is missing required ${dt.name}. Trip allocation blocked.`;
          throw Errors.validation({ vehicle: msg }, msg);
        }
        const expIso =
          latestDoc.expiry_date instanceof Date
            ? latestDoc.expiry_date.toISOString().slice(0, 10)
            : String(latestDoc.expiry_date).slice(0, 10);
        if (expIso < today) {
          const msg = `Vehicle ${veh.reg_no} has expired ${dt.name} (${fmtDateIn(expIso)}). Trip allocation blocked.`;
          throw Errors.validation({ vehicle: msg }, msg);
        }
      }
    }

    if (driverId) {
      const drvRows = await query(
        tx,
        `SELECT * FROM drivers WHERE id = $1::uuid AND deleted_at IS NULL`,
        driverId,
      );
      if (!drvRows[0]) throw Errors.notFound(`Driver not found: ${driverId}`);
      const drv = drvRows[0];
      const expIso =
        drv.licence_expiry instanceof Date
          ? drv.licence_expiry.toISOString().slice(0, 10)
          : String(drv.licence_expiry).slice(0, 10);
      if (expIso < today) {
        const msg = `Driver licence expired on ${fmtDateIn(expIso)}.`;
        throw Errors.validation({ driver: msg }, msg);
      }
    }
  }

  // ------------------------------------------------------------------------- Fuel Logs
  async listFuelLogs(caller: Caller, vehicleId?: string): Promise<Row[]> {
    const cond = vehicleId ? `AND f.vehicle_id = $1::uuid` : '';
    const args = vehicleId ? [vehicleId] : [];
    const rows = await query(
      prisma,
      `SELECT f.*, v.reg_no, d.name AS driver_name
       FROM fuel_logs f
       JOIN vehicles v ON v.id = f.vehicle_id
       LEFT JOIN drivers d ON d.id = f.driver_id
       WHERE 1=1 ${cond}
       ORDER BY f.filled_at DESC`,
      ...args,
    );
    return rows.map(norm);
  }

  async createFuelLog(
    caller: Caller,
    input: {
      vehicleId: string;
      driverId?: string;
      filledAt?: string;
      odometer: number;
      litres: number;
      rate: number;
      isFullTank?: boolean;
      vendorId?: string;
    },
  ): Promise<Row> {
    const unitId = caller.ctx.unitId;
    const { id: fyId } = await fyOfCaller(caller);

    const vehRows = await query(prisma, `SELECT * FROM vehicles WHERE id = $1::uuid`, input.vehicleId);
    if (!vehRows[0]) throw Errors.notFound(`Vehicle not found: ${input.vehicleId}`);
    const veh = vehRows[0];

    const prevRows = await query(
      prisma,
      `SELECT odometer, litres, filled_at, is_full_tank FROM fuel_logs
       WHERE vehicle_id = $1::uuid AND status != 'CANCELLED'
       ORDER BY filled_at ASC`,
      input.vehicleId,
    );

    const filledAt = input.filledAt || new Date().toISOString();
    const analysis = analyzeFuelLog({
      odometer: Number(input.odometer),
      litres: Number(input.litres),
      filledAt,
      isFullTank: input.isFullTank ?? true,
      tankCapacity: Number(veh.tank_capacity_l),
      stdKmpl: Number(veh.std_kmpl),
      prevLogs: prevRows.map((p) => ({
        odometer: Number(p.odometer),
        litres: Number(p.litres),
        filledAt: p.filled_at instanceof Date ? p.filled_at.toISOString() : String(p.filled_at),
        isFullTank: Boolean(p.is_full_tank),
      })),
    });

    if (analysis.blocked) {
      throw Errors.validation({ fuel: analysis.blockReason || 'Fuel entry blocked by anomaly check.' });
    }

    const fuelNo = await NumberingService.allocate(prisma as any, {
      pageId: 'fleet-fuel',
      unitId: unitId || '',
      fyId,
    });
    const amount = Math.round(input.litres * input.rate * 100) / 100;

    const rows = await query(
      prisma,
      `INSERT INTO fuel_logs (
        fuel_no, unit_id, vehicle_id, driver_id, filled_at, odometer, litres, rate, amount,
        is_full_tank, vendor_id, kmpl, variance_pct, anomaly_codes, status, created_by_id
      ) VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5::timestamptz,$6,$7,$8,$9,$10,$11::uuid,$12,$13,$14::jsonb,'DRAFT',$15::uuid)
      RETURNING *`,
      fuelNo,
      unitId,
      input.vehicleId,
      input.driverId ?? null,
      filledAt,
      input.odometer,
      input.litres,
      input.rate,
      amount,
      input.isFullTank ?? true,
      input.vendorId ?? null,
      analysis.kmpl,
      analysis.variancePct,
      JSON.stringify(analysis.anomalies),
      caller.auth.userId,
    );
    return norm(rows[0]!);
  }

  async postFuelLog(caller: Caller, id: string): Promise<Row> {
    return prisma.$transaction(async (tx) => {
      const rows = await query(
        tx,
        `SELECT f.*, v.reg_no, v.cost_center_id, v.current_odometer
         FROM fuel_logs f JOIN vehicles v ON v.id = f.vehicle_id
         WHERE f.id = $1::uuid FOR UPDATE`,
        id,
      );
      if (!rows[0]) throw Errors.notFound(`Fuel log not found: ${id}`);
      const f = rows[0];
      if (f.status === 'POSTED') throw Errors.conflict('Fuel log already posted.');

      const amount = Number(f.amount);
      let journalId: string | null = null;
      if (amount > 0) {
        try {
          const jRes = await PostingService.postJournal(
            tx,
            {
              unitId: String(f.unit_id),
              docDate: new Date().toISOString().slice(0, 10),
              voucherType: 'Journal',
              source: 'EVENT',
              sourceDocType: 'FLEET_FUEL',
              sourceDocId: String(f.id),
              sourceDocNo: String(f.fuel_no),
              narration: `Fuel log ${f.fuel_no} for vehicle ${f.reg_no}`,
              lines: [
                {
                  accountCode: '6219', // Fleet Fuel Expense
                  debit: amount.toFixed(2),
                  credit: '0.00',
                  costCenterId: f.cost_center_id ? String(f.cost_center_id) : undefined,
                  narration: `Fuel ${f.litres} L @ ${f.rate} (${f.reg_no})`,
                },
                {
                  accountCode: f.vendor_id ? '2101' : '1101', // Accounts Payable or Cash/Bank
                  debit: '0.00',
                  credit: amount.toFixed(2),
                  partyType: f.vendor_id ? 'SUPPLIER' : undefined,
                  partyId: f.vendor_id ? String(f.vendor_id) : undefined,
                  narration: `Fuel payment/payable (${f.fuel_no})`,
                },
              ],
            },
            { userId: caller.auth.userId },
          );
          journalId = jRes?.id ?? null;
        } catch (err: any) {
          console.warn('Fuel journal posting note:', err.message);
        }
      }

      if (Number(f.odometer) > Number(f.current_odometer)) {
        await exec(
          tx,
          `UPDATE vehicles SET current_odometer = $1, updated_at = now() WHERE id = $2::uuid`,
          f.odometer,
          f.vehicle_id,
        );
      }

      const updated = await query(
        tx,
        `UPDATE fuel_logs SET status = 'POSTED', journal_id = $1::uuid, updated_at = now() WHERE id = $2::uuid RETURNING *`,
        journalId,
        id,
      );
      return norm(updated[0]!);
    });
  }

  // ------------------------------------------------------------------------- Vehicle Services
  async listServices(caller: Caller, vehicleId?: string): Promise<Row[]> {
    const cond = vehicleId ? `AND vs.vehicle_id = $1::uuid` : '';
    const args = vehicleId ? [vehicleId] : [];
    const rows = await query(
      prisma,
      `SELECT vs.*, v.reg_no FROM vehicle_services vs JOIN vehicles v ON v.id = vs.vehicle_id WHERE 1=1 ${cond} ORDER BY vs.created_at DESC`,
      ...args,
    );
    return rows.map(norm);
  }

  async createService(
    caller: Caller,
    input: {
      vehicleId: string;
      serviceType: string;
      dueKm?: number;
      dueDate?: string;
      serviceDate?: string;
      odometer?: number;
      vendorId?: string;
      downtimeHrs?: number;
      nextDueKm?: number;
      nextDueDate?: string;
      lines: Array<{ lineType: 'PART' | 'LABOUR'; itemId?: string; description: string; qty: number; rate: number }>;
    },
  ): Promise<Row> {
    const unitId = caller.ctx.unitId || '';
    const { id: fyId } = await fyOfCaller(caller);
    const serviceNo = await NumberingService.allocate(prisma as any, {
      pageId: 'fleet-service',
      unitId,
      fyId,
    });
    const total = input.lines.reduce((s, l) => s + l.qty * l.rate, 0);

    return prisma.$transaction(async (tx) => {
      const sRows = await query(
        tx,
        `INSERT INTO vehicle_services (
          service_no, unit_id, vehicle_id, service_type, due_km, due_date, service_date, odometer,
          vendor_id, downtime_hrs, next_due_km, next_due_date, total_amount, status, created_by_id
        ) VALUES ($1,$2::uuid,$3::uuid,$4,$5,$6::date,$7::date,$8,$9::uuid,$10,$11,$12::date,$13,'SCHEDULED',$14::uuid)
        RETURNING *`,
        serviceNo,
        unitId,
        input.vehicleId,
        input.serviceType,
        input.dueKm ?? null,
        input.dueDate ?? null,
        input.serviceDate ?? null,
        input.odometer ?? null,
        input.vendorId ?? null,
        input.downtimeHrs ?? 0,
        input.nextDueKm ?? null,
        input.nextDueDate ?? null,
        Math.round(total * 100) / 100,
        caller.auth.userId,
      );
      const srv = norm(sRows[0]!);
      for (const l of input.lines) {
        await exec(
          tx,
          `INSERT INTO vehicle_service_lines (service_id, line_type, item_id, description, qty, rate, amount)
           VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7)`,
          srv.id,
          l.lineType,
          l.itemId ?? null,
          l.description,
          l.qty,
          l.rate,
          Math.round(l.qty * l.rate * 100) / 100,
        );
      }
      return srv;
    });
  }

  async postService(caller: Caller, id: string, warehouseId?: string): Promise<Row> {
    return prisma.$transaction(async (tx) => {
      const rows = await query(
        tx,
        `SELECT vs.*, v.reg_no, v.cost_center_id FROM vehicle_services vs JOIN vehicles v ON v.id = vs.vehicle_id WHERE vs.id = $1::uuid FOR UPDATE`,
        id,
      );
      if (!rows[0]) throw Errors.notFound(`Service not found: ${id}`);
      const vs = rows[0];
      if (vs.status === 'POSTED') throw Errors.conflict('Service already posted.');

      const lines = await query(tx, `SELECT * FROM vehicle_service_lines WHERE service_id = $1::uuid`, id);
      const docDate = new Date().toISOString().slice(0, 10);

      // Issue PART lines from warehouse if warehouseId is supplied
      if (warehouseId) {
        const partLines = lines.filter((l) => l.line_type === 'PART' && l.item_id);
        if (partLines.length > 0) {
          await StockService.postMany(
            tx,
            partLines.map((pl) => ({
              warehouseId,
              itemId: String(pl.item_id),
              direction: 'OUT',
              qty: D(Number(pl.qty)),
              postingDate: docDate,
              voucherType: 'ISSUE',
              voucherId: String(vs.id),
              voucherNo: String(vs.service_no),
              createdById: caller.auth.userId,
            })),
          );
        }
      }

      const total = Number(vs.total_amount);
      let journalId: string | null = null;
      if (total > 0) {
        try {
          const jRes = await PostingService.postJournal(
            tx,
            {
              unitId: String(vs.unit_id),
              docDate,
              voucherType: 'Journal',
              source: 'EVENT',
              sourceDocType: 'VEHICLE_SERVICE',
              sourceDocId: String(vs.id),
              sourceDocNo: String(vs.service_no),
              narration: `Vehicle R&M ${vs.service_no} (${vs.reg_no})`,
              lines: [
                {
                  accountCode: '6220', // Vehicle Repair & Maintenance
                  debit: total.toFixed(2),
                  credit: '0.00',
                  costCenterId: vs.cost_center_id ? String(vs.cost_center_id) : undefined,
                  narration: `Service ${vs.service_type} (${vs.reg_no})`,
                },
                {
                  accountCode: vs.vendor_id ? '2101' : '1101',
                  debit: '0.00',
                  credit: total.toFixed(2),
                  partyType: vs.vendor_id ? 'SUPPLIER' : undefined,
                  partyId: vs.vendor_id ? String(vs.vendor_id) : undefined,
                  narration: `Service payable (${vs.service_no})`,
                },
              ],
            },
            { userId: caller.auth.userId },
          );
          journalId = jRes?.id ?? null;
        } catch (err: any) {
          console.warn('Service journal posting note:', err.message);
        }
      }

      const updated = await query(
        tx,
        `UPDATE vehicle_services SET status = 'POSTED', journal_id = $1::uuid, service_date = COALESCE(service_date, CURRENT_DATE), updated_at = now() WHERE id = $2::uuid RETURNING *`,
        journalId,
        id,
      );
      return norm(updated[0]!);
    });
  }

  // ------------------------------------------------------------------------- Daily Expiry Scan Job
  async runExpiryScan(asOfDate?: string): Promise<{ updated: number; alerts: number }> {
    const today = asOfDate || new Date().toISOString().slice(0, 10);
    const docs = await query(prisma, `SELECT id, vehicle_id, doc_type_code, expiry_date, status FROM vehicle_documents`);
    let updated = 0;
    let alerts = 0;

    for (const d of docs) {
      const exp =
        d.expiry_date instanceof Date
          ? d.expiry_date.toISOString().slice(0, 10)
          : String(d.expiry_date).slice(0, 10);
      const evalRes = evaluateDocumentExpiry(exp, today);
      if (evalRes.status !== d.status) {
        await exec(
          prisma,
          `UPDATE vehicle_documents SET status = $1 WHERE id = $2::uuid`,
          evalRes.status,
          d.id,
        );
        updated++;
      }
      if (evalRes.alertThreshold !== null) {
        alerts++;
      }
    }

    return { updated, alerts };
  }
}

export const fleetService = new FleetService();

