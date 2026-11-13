// Phase 30: contract labour. Contractors, work orders, workers with the deployment checks, the daily muster (from the device punches),
// wage sheets, contractor bills reconciled to the muster, the compliance score with the payment block, safety incidents, the command center.
import ExcelJS from 'exceljs';
import { recordAudit } from '../../core/audit/audit-service';
import { NumberingService } from '../../core/numbering/numbering-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { notificationService } from '../notifications/service';
import { query } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { COMPLIANCE_CHECKS, CHECK_LABEL, budgetLevel, complianceScore, deployBlock, dmy, invoiceMoney, reconcileDays, riskOf, tdsPctFor, wageLine } from './calc';

const S = (v: unknown): string => String(v ?? '');
const N = (v: unknown): number => Number(v ?? 0);
const d10 = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : S(v).slice(0, 10));
const todayIst = (now = new Date()): string => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

function unitOf(caller: Caller, requested?: string | null): string {
  const u = requested ?? caller.ctx.unitId ?? '';
  if (!caller.ctx.unitIds.includes(u)) throw Errors.forbidden();
  return u;
}
const monthEnd = (ym: string): string => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);

async function minWage(skill: string, onDate: string): Promise<number | null> {
  const r = (await query(prisma, `SELECT daily_min FROM cl_min_wages WHERE skill_category = $1 AND effective_from <= $2::date ORDER BY effective_from DESC LIMIT 1`, skill, onDate))[0];
  return r ? N(r.daily_min) : null;
}

export const clService = {
  // ------------------------------------------------------------------------------------------ contractors
  async contractors(caller: Caller, q?: string): Promise<Row[]> {
    void caller;
    return query(prisma, `SELECT c.*, (SELECT count(*)::int FROM cl_workers w WHERE w.contractor_id = c.id AND w.status = 'Deployed') AS deployed FROM contractors c WHERE ($1::text IS NULL OR c.code ILIKE $1 OR c.name ILIKE $1) ORDER BY c.code`, q ? `%${q}%` : null);
  },
  async createContractor(caller: Caller, b: Record<string, unknown>): Promise<Row> {
    const r = await query(
      prisma,
      `INSERT INTO contractors (code, name, legal_entity, pan, gstin, labour_licence_no, licence_valid_until, pf_code, esic_code, insurance_policy, insurance_expiry, agreement_no, agreement_start, agreement_end, contact_person, mobile, email, bank_account_last4, ifsc, risk_rating, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11::date,$12,$13::date,$14::date,$15,$16,$17,$18,$19,coalesce($20,'Medium'),$21::uuid) RETURNING *`,
      b.code, b.name, b.legalEntity ?? null, b.pan ?? null, b.gstin ?? null, b.labourLicenceNo ?? null, b.licenceValidUntil ?? null, b.pfCode ?? null, b.esicCode ?? null, b.insurancePolicy ?? null, b.insuranceExpiry ?? null,
      b.agreementNo ?? null, b.agreementStart ?? null, b.agreementEnd ?? null, b.contactPerson ?? null, b.mobile ?? null, b.email ?? null, b.bankAccountLast4 ?? null, b.ifsc ?? null, b.riskRating ?? null, caller.auth.user.id,
    ).catch((e: { meta?: { code?: string }; message?: string }) => {
      if (e.meta?.code === '23505') throw Errors.conflict('A contractor with this code already exists.');
      throw e;
    });
    await recordAudit({ action: 'cl.contractor_created', actorId: caller.auth.user.id, targetType: 'contractor', targetId: S(r[0]!.id), detail: { code: S(b.code) } });
    return r[0]!;
  },
  async approveContractor(caller: Caller, id: string): Promise<Row> {
    const c = (await query(prisma, `SELECT * FROM contractors WHERE id = $1::uuid`, id))[0];
    if (!c) throw Errors.notFound('Contractor not found.');
    if (S(c.created_by_id) === caller.auth.user.id) throw Errors.forbidden('The person who entered the contractor cannot approve it.');
    const r = await query(prisma, `UPDATE contractors SET approval_status = 'Approved', updated_at = now() WHERE id = $1::uuid AND approval_status = 'Pending' RETURNING *`, id);
    if (!r[0]) throw Errors.conflict('This contractor was already decided.');
    await recordAudit({ action: 'cl.contractor_approved', actorId: caller.auth.user.id, targetType: 'contractor', targetId: id });
    return r[0];
  },

  // ------------------------------------------------------------------------------------------ work orders
  async workOrders(caller: Caller): Promise<Row[]> {
    const rows = await query(prisma, `SELECT w.*, c.name AS contractor, u.code AS unit_code, (SELECT count(*)::int FROM cl_deployments d WHERE d.work_order_id = w.id AND d.released_at IS NULL) AS deployed FROM cl_work_orders w JOIN contractors c ON c.id = w.contractor_id JOIN units u ON u.id = w.unit_id WHERE w.unit_id = ANY($1::uuid[]) ORDER BY w.number DESC`, caller.ctx.unitIds);
    return rows.map((r) => ({ ...r, budget_pct: budgetLevel(N(r.utilized), N(r.budget)).pct, budget_level: budgetLevel(N(r.utilized), N(r.budget)).level }));
  },
  async createWorkOrder(caller: Caller, b: { contractorId: string; unitId?: string; poNo?: string | null; department?: string | null; scope?: string | null; skillCategory?: string; requiredHeadcount: number; rateType?: string; rate: number; otRate?: number | null; serviceChargePct?: number; startDate: string; endDate: string; budget: number }): Promise<Row> {
    const unitId = unitOf(caller, b.unitId);
    const skill = b.skillCategory ?? 'Unskilled';
    const min = await minWage(skill, b.startDate);
    if (b.rateType !== 'MONTHLY' && b.rateType !== 'PIECE' && min !== null && b.rate < min) throw Errors.validation({ rate: `Wage rate ₹${b.rate} is below the minimum wage ₹${min} for ${skill}.` });
    return prisma.$transaction(async (tx) => {
      const no = await NumberingService.next(tx, { docType: 'cl-workorders', unitId, fyId: caller.ctx.fyId });
      const r = await query(
        tx,
        `INSERT INTO cl_work_orders (unit_id, number, contractor_id, po_no, department, scope, skill_category, required_headcount, rate_type, rate, ot_rate, service_charge_pct, start_date, end_date, budget, created_by_id)
         VALUES ($1::uuid,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::date,$14::date,$15,$16::uuid) RETURNING *`,
        unitId, no, b.contractorId, b.poNo ?? null, b.department ?? null, b.scope ?? null, skill, b.requiredHeadcount, b.rateType ?? 'DAILY', b.rate, b.otRate ?? null, b.serviceChargePct ?? 0, b.startDate, b.endDate, b.budget, caller.auth.user.id,
      );
      await recordAudit({ action: 'cl.workorder_created', actorId: caller.auth.user.id, targetType: 'cl_work_order', targetId: S(r[0]!.id), detail: { number: no } }, tx);
      return r[0]!;
    });
  },
  async activateWorkOrder(caller: Caller, id: string): Promise<Row> {
    const w = (await query(prisma, `SELECT * FROM cl_work_orders WHERE id = $1::uuid`, id))[0];
    if (!w || !caller.ctx.unitIds.includes(S(w.unit_id))) throw Errors.notFound('Work order not found.');
    if (S(w.created_by_id) === caller.auth.user.id) throw Errors.forbidden('The person who made the work order cannot activate it.');
    const r = await query(prisma, `UPDATE cl_work_orders SET status = 'Active' WHERE id = $1::uuid AND status = 'Draft' RETURNING *`, id);
    if (!r[0]) throw Errors.conflict('Only a draft work order can be activated.');
    return r[0];
  },
  /** Utilisation follows the locked wage sheets and bills; amber from 90 %, blocked at 100 %. */
  async addUtilised(workOrderId: string, amount: number, actorId: string | null): Promise<{ pct: number; level: string }> {
    const w = (await query(prisma, `UPDATE cl_work_orders SET utilized = utilized + $2 WHERE id = $1::uuid RETURNING *`, workOrderId, amount))[0];
    if (!w) throw Errors.notFound('Work order not found.');
    const lvl = budgetLevel(N(w.utilized), N(w.budget));
    if (lvl.level !== 'OK' && actorId) {
      await prisma.$transaction(async (tx) => notificationService.notify(tx, [actorId], { type: 'cl.budget', title: `Work order ${S(w.number)} budget used ${lvl.pct} %`, body: lvl.level === 'BLOCKED' ? 'New deployments and bills above the balance are blocked.' : 'Amber: 90 % or more of the budget is used.', link: '/m/cl-workorders', entityType: 'cl_work_order', entityId: workOrderId, dedupeKey: `cl:${workOrderId}:${lvl.level}` }));
    }
    return lvl;
  },

  // ------------------------------------------------------------------------------------------ workers, checks, deployment
  async workers(caller: Caller, f: { contractor?: string; status?: string; q?: string }): Promise<Row[]> {
    return query(
      prisma,
      `SELECT w.id, w.worker_no, w.name, w.mobile, w.aadhaar_last4, w.skill_category, w.trade, w.wage_rate, w.status, w.biometric_code, w.police_required, c.name AS contractor, c.code AS contractor_code,
              (SELECT string_agg(k.check_kind, ',' ORDER BY k.check_kind) FROM cl_onboarding_checks k WHERE k.worker_id = w.id) AS checks
         FROM cl_workers w JOIN contractors c ON c.id = w.contractor_id
        WHERE ($1::uuid IS NULL OR w.contractor_id = $1::uuid) AND ($2::text IS NULL OR w.status = $2) AND ($3::text IS NULL OR w.name ILIKE $3 OR w.worker_no ILIKE $3) AND (w.unit_id IS NULL OR w.unit_id = ANY($4::uuid[])) ORDER BY w.worker_no LIMIT 300`,
      f.contractor ?? null, f.status ?? null, f.q ? `%${f.q}%` : null, caller.ctx.unitIds,
    );
  },
  async createWorker(caller: Caller, b: { name: string; contractorId: string; aadhaarLast4?: string | null; mobile?: string | null; dob?: string | null; gender?: 'M' | 'F' | 'O' | null; skillCategory?: string; trade?: string | null; department?: string | null; unitId?: string | null; joiningDate?: string | null; contractEnd?: string | null; wageRate: number; pfUan?: string | null; esicIpNo?: string | null; policeRequired?: boolean; biometricCode?: string | null }): Promise<Row> {
    const skill = b.skillCategory ?? 'Unskilled';
    const min = await minWage(skill, b.joiningDate ?? todayIst());
    if (min !== null && b.wageRate < min) throw Errors.validation({ wageRate: `Wage rate ₹${b.wageRate} is below the minimum wage ₹${min} for ${skill}.` });
    return prisma.$transaction(async (tx) => {
      const unitId = b.unitId ? unitOf(caller, b.unitId) : null;
      const no = await NumberingService.next(tx, { docType: 'cl-workers', unitId: unitId ?? unitOf(caller), fyId: caller.ctx.fyId });
      const r = await query(
        tx,
        `INSERT INTO cl_workers (worker_no, name, contractor_id, aadhaar_last4, mobile, dob, gender, skill_category, trade, department, unit_id, joining_date, contract_end, wage_rate, pf_uan, esic_ip_no, police_required, biometric_code, created_by_id)
         VALUES ($1,$2,$3::uuid,$4,$5,$6::date,$7,$8,$9,$10,$11::uuid,$12::date,$13::date,$14,$15,$16,$17,$18,$19::uuid) RETURNING id, worker_no, name, status, aadhaar_last4`,
        no, b.name, b.contractorId, b.aadhaarLast4 ?? null, b.mobile ?? null, b.dob ?? null, b.gender ?? null, skill, b.trade ?? null, b.department ?? null, unitId, b.joiningDate ?? null, b.contractEnd ?? null, b.wageRate, b.pfUan ?? null, b.esicIpNo ?? null, b.policeRequired ?? false, b.biometricCode ?? null, caller.auth.user.id,
      ).catch((e: { meta?: { code?: string } }) => { if (e.meta?.code === '23505') throw Errors.conflict('This biometric code is already used by another worker.'); throw e; });
      await recordAudit({ action: 'cl.worker_created', actorId: caller.auth.user.id, targetType: 'cl_worker', targetId: S(r[0]!.id), detail: { workerNo: no } }, tx);
      return r[0]!;
    });
  },
  async recordCheck(caller: Caller, workerId: string, b: { kind: 'KYC' | 'MEDICAL' | 'INDUCTION' | 'POLICE' | 'PPE' | 'ID_CARD'; doneAt?: string; validUntil?: string | null; note?: string | null }): Promise<Row> {
    const w = (await query(prisma, `SELECT id FROM cl_workers WHERE id = $1::uuid`, workerId))[0];
    if (!w) throw Errors.notFound('Worker not found.');
    const r = await query(prisma, `INSERT INTO cl_onboarding_checks (worker_id, check_kind, done_at, valid_until, verified_by_id, note) VALUES ($1::uuid,$2,COALESCE($3::date, CURRENT_DATE),$4::date,$5::uuid,$6) ON CONFLICT (worker_id, check_kind) DO UPDATE SET done_at = EXCLUDED.done_at, valid_until = EXCLUDED.valid_until, verified_by_id = EXCLUDED.verified_by_id, note = EXCLUDED.note RETURNING *`, workerId, b.kind, b.doneAt ?? null, b.validUntil ?? null, caller.auth.user.id, b.note ?? null);
    await recordAudit({ action: 'cl.check_recorded', actorId: caller.auth.user.id, targetType: 'cl_worker', targetId: workerId, detail: { kind: b.kind, validUntil: b.validUntil ?? null } });
    return r[0]!;
  },

  /** Deployment is allowed only when everything is valid on the date; the first failing reason is returned. */
  async deployCheck(workerId: string, workOrderId: string, date: string): Promise<string | null> {
    const w = (await query(prisma, `SELECT * FROM cl_workers WHERE id = $1::uuid`, workerId))[0];
    const wo = (await query(prisma, `SELECT w.*, (SELECT count(*)::int FROM cl_deployments d WHERE d.work_order_id = w.id AND d.released_at IS NULL) AS deployed FROM cl_work_orders w WHERE w.id = $1::uuid`, workOrderId))[0];
    if (!w || !wo) throw Errors.notFound('Worker or work order not found.');
    const c = (await query(prisma, `SELECT * FROM contractors WHERE id = $1::uuid`, w.contractor_id))[0]!;
    if (S(c.id) !== S(wo.contractor_id)) return "Can't deploy: the worker belongs to another contractor than this work order.";
    const checks = Object.fromEntries((await query(prisma, `SELECT check_kind, valid_until FROM cl_onboarding_checks WHERE worker_id = $1::uuid`, workerId)).map((k) => [S(k.check_kind), { validUntil: d10(k.valid_until) }]));
    const busy = (await query(prisma, `SELECT 1 FROM cl_deployments WHERE worker_id = $1::uuid AND released_at IS NULL LIMIT 1`, workerId))[0];
    if (busy) return "Can't deploy: the worker is already deployed. Release first.";
    return deployBlock({
      date,
      contractor: { licenceValidUntil: d10(c.licence_valid_until), agreementEnd: d10(c.agreement_end), insuranceExpiry: d10(c.insurance_expiry), status: S(c.status), approval: S(c.approval_status) },
      workOrder: { status: S(wo.status), headcount: N(wo.required_headcount), deployed: N(wo.deployed), budgetPct: budgetLevel(N(wo.utilized), N(wo.budget)).pct, start: d10(wo.start_date)!, end: d10(wo.end_date)! },
      checks, policeRequired: Boolean(w.police_required),
    });
  },
  async deploy(caller: Caller, workerId: string, b: { workOrderId: string; fromDate?: string; department?: string | null }): Promise<Row> {
    const date = b.fromDate ?? todayIst();
    const wo = (await query(prisma, `SELECT * FROM cl_work_orders WHERE id = $1::uuid`, b.workOrderId))[0];
    if (!wo || !caller.ctx.unitIds.includes(S(wo.unit_id))) throw Errors.notFound('Work order not found.');
    const block = await clService.deployCheck(workerId, b.workOrderId, date);
    if (block) throw Errors.conflict(block);
    return prisma.$transaction(async (tx) => {
      const d = (await query(tx, `INSERT INTO cl_deployments (worker_id, work_order_id, unit_id, department, from_date, created_by_id) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::date,$6::uuid) RETURNING *`, workerId, b.workOrderId, wo.unit_id, b.department ?? wo.department, date, caller.auth.user.id))[0]!;
      await query(tx, `UPDATE cl_workers SET status = 'Deployed', unit_id = $2::uuid WHERE id = $1::uuid`, workerId, wo.unit_id);
      await recordAudit({ action: 'cl.worker_deployed', actorId: caller.auth.user.id, targetType: 'cl_worker', targetId: workerId, detail: { workOrder: S(wo.number), from: date } }, tx);
      return d;
    });
  },
  async release(caller: Caller, workerId: string, toDate?: string): Promise<Row> {
    const r = await query(prisma, `UPDATE cl_deployments SET released_at = now(), to_date = $2::date WHERE worker_id = $1::uuid AND released_at IS NULL RETURNING *`, workerId, toDate ?? todayIst());
    if (!r[0]) throw Errors.conflict('This worker is not deployed.');
    await query(prisma, `UPDATE cl_workers SET status = 'Released' WHERE id = $1::uuid`, workerId);
    await recordAudit({ action: 'cl.worker_released', actorId: caller.auth.user.id, targetType: 'cl_worker', targetId: workerId });
    return r[0];
  },

  // ------------------------------------------------------------------------------------------ attendance (the daily muster from the device punches)
  /** One row per deployed worker for the date: first and last punch, hours, overtime. Safe to run again. */
  async generateMuster(caller: Caller, date: string): Promise<{ rows: number }> {
    const workers = await query(prisma, `SELECT w.id, w.biometric_code, d.work_order_id, d.unit_id FROM cl_workers w JOIN cl_deployments d ON d.worker_id = w.id AND d.from_date <= $1::date AND (d.to_date IS NULL OR d.to_date >= $1::date) WHERE d.unit_id = ANY($2::uuid[])`, date, caller.ctx.unitIds);
    let n = 0;
    for (const w of workers) {
      const p = w.biometric_code
        ? (await query(prisma, `SELECT min(punch_at) AS first, max(punch_at) AS last, count(*)::int AS n FROM attendance_punches WHERE biometric_code = $1 AND (punch_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date`, w.biometric_code, date))[0]
        : null;
      let hours = 0;
      if (p && p.first && N(p.n) >= 2) {
        hours = (new Date(S(p.last)).getTime() - new Date(S(p.first)).getTime()) / 3_600_000;
        if (hours > 5) hours -= 0.5; // break
      }
      hours = Math.round(hours * 4) / 4;
      const regular = Math.min(8, hours);
      const ot = Math.max(0, Math.round((hours - 8) * 4) / 4);
      const status = hours >= 7 ? 'P' : hours >= 4 ? 'HD' : 'A';
      await query(
        prisma,
        `INSERT INTO cl_attendance (worker_id, work_order_id, unit_id, att_date, punch_in, punch_out, regular_hours, ot_hours, status, payable_days)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::date,$5::timestamptz,$6::timestamptz,$7,$8,$9,$10) ON CONFLICT (worker_id, att_date) DO UPDATE SET punch_in = EXCLUDED.punch_in, punch_out = EXCLUDED.punch_out, regular_hours = EXCLUDED.regular_hours, ot_hours = EXCLUDED.ot_hours, status = EXCLUDED.status, payable_days = EXCLUDED.payable_days WHERE NOT EXISTS (SELECT 1 FROM cl_wage_lines l JOIN cl_wage_sheets s ON s.id = l.sheet_id WHERE l.worker_id = cl_attendance.worker_id AND s.status = 'LOCKED' AND to_char(cl_attendance.att_date,'YYYY-MM') = s.month)`,
        w.id, w.work_order_id, w.unit_id, date, p?.first ?? null, p?.last ?? null, regular, ot, status, status === 'P' ? 1 : status === 'HD' ? 0.5 : 0,
      );
      n += 1;
    }
    return { rows: n };
  },
  async attendance(caller: Caller, f: { month?: string; contractor?: string; date?: string }): Promise<Row[]> {
    return query(prisma, `SELECT a.*, w.worker_no, w.name, c.name AS contractor FROM cl_attendance a JOIN cl_workers w ON w.id = a.worker_id JOIN contractors c ON c.id = w.contractor_id WHERE (a.unit_id IS NULL OR a.unit_id = ANY($1::uuid[])) AND ($2::text IS NULL OR to_char(a.att_date,'YYYY-MM') = $2) AND ($3::uuid IS NULL OR w.contractor_id = $3::uuid) AND ($4::date IS NULL OR a.att_date = $4::date) ORDER BY a.att_date DESC, w.worker_no LIMIT 1000`, caller.ctx.unitIds, f.month ?? null, f.contractor ?? null, f.date ?? null);
  },
  async approveDay(caller: Caller, id: string): Promise<Row> {
    const r = await query(prisma, `UPDATE cl_attendance SET supervisor_approved = true WHERE id = $1::uuid RETURNING *`, id);
    if (!r[0]) throw Errors.notFound('Attendance row not found.');
    await recordAudit({ action: 'cl.day_approved', actorId: caller.auth.user.id, targetType: 'cl_attendance', targetId: id });
    return r[0];
  },

  // ------------------------------------------------------------------------------------------ wages
  async computeWages(caller: Caller, b: { unitId?: string; month: string; contractorId: string }): Promise<Row> {
    const unitId = unitOf(caller, b.unitId);
    const sheet0 = (await query(prisma, `SELECT * FROM cl_wage_sheets WHERE unit_id = $1::uuid AND month = $2 AND contractor_id = $3::uuid`, unitId, b.month, b.contractorId))[0];
    if (sheet0?.status === 'LOCKED') throw Errors.conflict('This wage sheet is locked.');
    const monthNum = Number(b.month.slice(5, 7));
    const workers = await query(prisma, `SELECT * FROM cl_workers w WHERE w.contractor_id = $1::uuid AND EXISTS (SELECT 1 FROM cl_attendance a WHERE a.worker_id = w.id AND to_char(a.att_date,'YYYY-MM') = $2 AND (a.unit_id = $3::uuid OR a.unit_id IS NULL))`, b.contractorId, b.month, unitId);
    if (workers.length === 0) throw Errors.validation({ month: 'There is no attendance for this contractor in this month.' });
    return prisma.$transaction(async (tx) => {
      const sheet = sheet0 ?? (await query(tx, `INSERT INTO cl_wage_sheets (unit_id, month, contractor_id) VALUES ($1::uuid,$2,$3::uuid) RETURNING *`, unitId, b.month, b.contractorId))[0]!;
      await query(tx, `DELETE FROM cl_wage_lines WHERE sheet_id = $1::uuid`, sheet.id);
      let gross = 0;
      let net = 0;
      for (const w of workers) {
        const t = (await query(tx, `SELECT coalesce(sum(payable_days) FILTER (WHERE gate_match IS NOT FALSE OR supervisor_approved),0)::float AS days, coalesce(sum(ot_hours) FILTER (WHERE gate_match IS NOT FALSE OR supervisor_approved),0)::float AS ot FROM cl_attendance WHERE worker_id = $1::uuid AND to_char(att_date,'YYYY-MM') = $2`, w.id, b.month))[0]!;
        const min = await minWage(S(w.skill_category), monthEnd(b.month));
        if (min !== null && N(w.wage_rate) < min) throw Errors.validation({ wageRate: `Wage rate ₹${N(w.wage_rate)} is below the minimum wage ₹${min} for ${S(w.skill_category)}.` });
        const l = wageLine({ days: N(t.days), dailyRate: N(w.wage_rate), otHours: N(t.ot), gender: (w.gender as 'M' | 'F' | 'O' | null) ?? null, month: monthNum });
        await query(tx, `INSERT INTO cl_wage_lines (sheet_id, worker_id, payable_days, daily_rate, basic_wages, ot_hours, ot_rate, ot_amount, gross_wages, pf_employee, esic_employee, prof_tax, total_deduction, net_pay) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, sheet.id, w.id, N(t.days), N(w.wage_rate), l.basic, N(t.ot), l.otRate, l.otAmount, l.gross, l.pf, l.esic, l.pt, l.totalDeduction, l.net);
        gross += l.gross;
        net += l.net;
      }
      const r = await query(tx, `UPDATE cl_wage_sheets SET status = 'COMPUTED', total_gross = $2, total_net = $3, computed_at = now() WHERE id = $1::uuid RETURNING *`, sheet.id, Math.round(gross * 100) / 100, Math.round(net * 100) / 100);
      await recordAudit({ action: 'cl.wages_computed', actorId: caller.auth.user.id, targetType: 'cl_wage_sheet', targetId: S(sheet.id), detail: { month: b.month, workers: workers.length } }, tx);
      return r[0]!;
    });
  },
  async lockWages(caller: Caller, sheetId: string): Promise<Row> {
    const s = (await query(prisma, `SELECT * FROM cl_wage_sheets WHERE id = $1::uuid`, sheetId))[0];
    if (!s || !caller.ctx.unitIds.includes(S(s.unit_id))) throw Errors.notFound('Wage sheet not found.');
    const r = await query(prisma, `UPDATE cl_wage_sheets SET status = 'LOCKED', locked_at = now(), locked_by_id = $2::uuid WHERE id = $1::uuid AND status = 'COMPUTED' RETURNING *`, sheetId, caller.auth.user.id);
    if (!r[0]) throw Errors.conflict('Compute the wage sheet before locking it.');
    await recordAudit({ action: 'cl.wages_locked', actorId: caller.auth.user.id, targetType: 'cl_wage_sheet', targetId: sheetId, detail: { month: S(s.month) } });
    return r[0];
  },
  async wageSheets(caller: Caller): Promise<Row[]> {
    return query(prisma, `SELECT s.*, c.name AS contractor, u.code AS unit_code, (SELECT count(*)::int FROM cl_wage_lines l WHERE l.sheet_id = s.id) AS workers FROM cl_wage_sheets s JOIN contractors c ON c.id = s.contractor_id JOIN units u ON u.id = s.unit_id WHERE s.unit_id = ANY($1::uuid[]) ORDER BY s.month DESC, c.name`, caller.ctx.unitIds);
  },
  async wageLines(caller: Caller, sheetId: string): Promise<Row[]> {
    const s = (await query(prisma, `SELECT unit_id FROM cl_wage_sheets WHERE id = $1::uuid`, sheetId))[0];
    if (!s || !caller.ctx.unitIds.includes(S(s.unit_id))) throw Errors.notFound('Wage sheet not found.');
    return query(prisma, `SELECT l.*, w.worker_no, w.name FROM cl_wage_lines l JOIN cl_workers w ON w.id = l.worker_id WHERE l.sheet_id = $1::uuid ORDER BY w.worker_no`, sheetId);
  },
  async bankAdvice(caller: Caller, sheetId: string): Promise<Buffer> {
    const lines = await clService.wageLines(caller, sheetId);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Bank advice');
    ws.columns = [{ header: 'Worker', key: 'worker_no', width: 14 }, { header: 'Name', key: 'name', width: 28 }, { header: 'Net pay', key: 'net_pay', width: 14 }];
    for (const l of lines) ws.addRow({ worker_no: l.worker_no, name: l.name, net_pay: N(l.net_pay) });
    ws.getRow(1).font = { bold: true };
    return Buffer.from(await wb.xlsx.writeBuffer());
  },

  // ------------------------------------------------------------------------------------------ compliance
  async compliance(caller: Caller, contractorId: string, month: string, unitIdIn?: string): Promise<Row> {
    const unitId = unitOf(caller, unitIdIn);
    const c = (await query(prisma, `SELECT * FROM contractors WHERE id = $1::uuid`, contractorId))[0];
    if (!c) throw Errors.notFound('Contractor not found.');
    const m = (await query(prisma, `INSERT INTO cl_compliance_months (unit_id, contractor_id, month) VALUES ($1::uuid,$2::uuid,$3) ON CONFLICT (unit_id, contractor_id, month) DO UPDATE SET updated_at = now() RETURNING *`, unitId, contractorId, month))[0]!;
    const docs = await query(prisma, `SELECT kind, reference, uploaded_at, verified_at FROM cl_compliance_docs WHERE compliance_id = $1::uuid`, m.id);
    const end = monthEnd(month);
    const valid = (v: unknown): boolean => d10(v) !== null && (d10(v) as string) >= end;
    const checks = COMPLIANCE_CHECKS.map((k) => {
      let passed = false;
      if (k === 'LICENCE') passed = valid(c.licence_valid_until);
      else if (k === 'AGREEMENT') passed = valid(c.agreement_end);
      else if (k === 'INSURANCE') passed = valid(c.insurance_expiry);
      else passed = docs.some((d) => S(d.kind) === k && d.verified_at);
      return { kind: k, label: CHECK_LABEL[k] ?? k, passed, uploaded: docs.some((d) => S(d.kind) === k) };
    });
    const passedN = checks.filter((x) => x.passed).length;
    const score = complianceScore(passedN, checks.length);
    await query(prisma, `UPDATE cl_compliance_months SET score_pct = $2, risk_level = $3, updated_at = now() WHERE id = $1::uuid`, m.id, score, riskOf(score));
    const missing = checks.find((x) => !x.passed);
    return { id: m.id, month, contractor: c.name, scorePct: score, risk: riskOf(score), passed: passedN, required: checks.length, checks, blocked: score < 100, blockReason: missing ? blockMessage(missing.kind, month, missing.uploaded) : null };
  },
  async uploadDoc(caller: Caller, b: { contractorId: string; month: string; kind: string; reference?: string | null; unitId?: string }): Promise<Row> {
    if (!(COMPLIANCE_CHECKS as readonly string[]).includes(b.kind) || ['LICENCE', 'AGREEMENT', 'INSURANCE'].includes(b.kind)) throw Errors.validation({ kind: 'Choose a document kind (the licence, agreement and insurance come from the contractor record).' });
    const unitId = unitOf(caller, b.unitId);
    const m = (await query(prisma, `INSERT INTO cl_compliance_months (unit_id, contractor_id, month) VALUES ($1::uuid,$2::uuid,$3) ON CONFLICT (unit_id, contractor_id, month) DO UPDATE SET updated_at = now() RETURNING id`, unitId, b.contractorId, b.month))[0]!;
    const r = await query(prisma, `INSERT INTO cl_compliance_docs (compliance_id, kind, reference, uploaded_by_id) VALUES ($1::uuid,$2,$3,$4::uuid) ON CONFLICT (compliance_id, kind) DO UPDATE SET reference = EXCLUDED.reference, uploaded_by_id = EXCLUDED.uploaded_by_id, uploaded_at = now(), verified_by_id = NULL, verified_at = NULL RETURNING *`, m.id, b.kind, b.reference ?? null, caller.auth.user.id);
    await recordAudit({ action: 'cl.doc_uploaded', actorId: caller.auth.user.id, targetType: 'cl_compliance', targetId: S(m.id), detail: { kind: b.kind, month: b.month } });
    return r[0]!;
  },
  /** Verified by a different person than the one who uploaded it. */
  async verifyDoc(caller: Caller, docId: string): Promise<Row> {
    const d = (await query(prisma, `SELECT * FROM cl_compliance_docs WHERE id = $1::uuid`, docId))[0];
    if (!d) throw Errors.notFound('Document not found.');
    if (S(d.uploaded_by_id) === caller.auth.user.id) throw Errors.forbidden('The person who uploaded the document cannot verify it.');
    const r = await query(prisma, `UPDATE cl_compliance_docs SET verified_by_id = $2::uuid, verified_at = now() WHERE id = $1::uuid RETURNING *`, docId, caller.auth.user.id);
    await recordAudit({ action: 'cl.doc_verified', actorId: caller.auth.user.id, targetType: 'cl_compliance_doc', targetId: docId, detail: { kind: S(d.kind) } });
    return r[0]!;
  },
  async docs(caller: Caller, contractorId: string, month: string, unitIdIn?: string): Promise<Row[]> {
    const unitId = unitOf(caller, unitIdIn);
    return query(prisma, `SELECT d.* FROM cl_compliance_docs d JOIN cl_compliance_months m ON m.id = d.compliance_id WHERE m.unit_id = $1::uuid AND m.contractor_id = $2::uuid AND m.month = $3 ORDER BY d.kind`, unitId, contractorId, month);
  },

  // ------------------------------------------------------------------------------------------ bills
  async createInvoice(caller: Caller, b: { unitId?: string; invoiceNo: string; invoiceDate: string; contractorId: string; workOrderId: string; billingMonth: string; headcount: number; billedManDays: number; otValue?: number; gstRatePct?: number }): Promise<Row> {
    const unitId = unitOf(caller, b.unitId);
    const wo = (await query(prisma, `SELECT * FROM cl_work_orders WHERE id = $1::uuid`, b.workOrderId))[0];
    const c = (await query(prisma, `SELECT * FROM contractors WHERE id = $1::uuid`, b.contractorId))[0];
    if (!wo || !c || S(wo.contractor_id) !== b.contractorId) throw Errors.validation({ workOrderId: 'Choose a work order of this contractor.' });
    const money = invoiceMoney({ manDays: b.billedManDays, rate: N(wo.rate), otValue: b.otValue ?? 0, serviceChargePct: N(wo.service_charge_pct), gstPct: b.gstRatePct ?? 18, tdsPct: tdsPctFor(c.pan ? S(c.pan) : null) });
    const bal = N(wo.balance);
    if (money.taxable > bal) throw Errors.validation({ billedManDays: `This bill (₹${money.taxable}) is above the work order balance (₹${bal}).` });
    const r = await query(
      prisma,
      `INSERT INTO cl_invoices (unit_id, invoice_no, invoice_date, contractor_id, work_order_id, billing_month, headcount, billed_man_days, basic_labour_value, ot_value, service_charge_pct, service_charge, taxable_value, gst_rate_pct, gst_amount, gross_invoice, tds_pct, tds_amount, net_payable, created_by_id)
       VALUES ($1::uuid,$2,$3::date,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::uuid) RETURNING *`,
      unitId, b.invoiceNo, b.invoiceDate, b.contractorId, b.workOrderId, b.billingMonth, b.headcount, b.billedManDays, money.basic, b.otValue ?? 0, N(wo.service_charge_pct), money.serviceCharge, money.taxable, b.gstRatePct ?? 18, money.gst, money.gross, tdsPctFor(c.pan ? S(c.pan) : null), money.tds, money.net, caller.auth.user.id,
    ).catch((e: { meta?: { code?: string } }) => { if (e.meta?.code === '23505') throw Errors.conflict('This contractor already has a bill with this number.'); throw e; });
    return r[0]!;
  },
  async invoices(caller: Caller): Promise<Row[]> {
    return query(prisma, `SELECT i.*, c.name AS contractor, u.code AS unit_code FROM cl_invoices i JOIN contractors c ON c.id = i.contractor_id JOIN units u ON u.id = i.unit_id WHERE i.unit_id = ANY($1::uuid[]) ORDER BY i.invoice_date DESC LIMIT 200`, caller.ctx.unitIds);
  },
  /** Billed man-days against the muster, and the wage component against the locked wage sheet. */
  async reconcile(caller: Caller, id: string): Promise<Row> {
    const i = (await query(prisma, `SELECT i.*, w.rate FROM cl_invoices i JOIN cl_work_orders w ON w.id = i.work_order_id WHERE i.id = $1::uuid`, id))[0];
    if (!i || !caller.ctx.unitIds.includes(S(i.unit_id))) throw Errors.notFound('Bill not found.');
    const muster = N((await query(prisma, `SELECT coalesce(sum(a.payable_days) FILTER (WHERE a.gate_match IS NOT FALSE OR a.supervisor_approved),0)::float AS d FROM cl_attendance a JOIN cl_workers w ON w.id = a.worker_id WHERE w.contractor_id = $1::uuid AND a.work_order_id = $2::uuid AND to_char(a.att_date,'YYYY-MM') = $3`, i.contractor_id, i.work_order_id, i.billing_month))[0]!.d);
    const sheet = (await query(prisma, `SELECT * FROM cl_wage_sheets WHERE unit_id = $1::uuid AND contractor_id = $2::uuid AND month = $3`, i.unit_id, i.contractor_id, i.billing_month))[0];
    const rc = reconcileDays(N(i.billed_man_days), muster, N(i.rate));
    const disputedWithGst = Math.round(rc.disputed * (1 + N(i.gst_rate_pct) / 100) * 100) / 100;
    const recon = { billedManDays: N(i.billed_man_days), musterManDays: muster, diffDays: rc.diffDays, disputedValue: rc.disputed, disputedWithGst, wageSheet: sheet ? { status: S(sheet.status), totalGross: N(sheet.total_gross) } : null, wageSheetLocked: S(sheet?.status) === 'LOCKED' };
    const r = await query(prisma, `UPDATE cl_invoices SET recon = $2::jsonb, disputed_amount = $3, status = CASE WHEN status = 'DRAFT' THEN 'RECONCILED' ELSE status END WHERE id = $1::uuid RETURNING *`, id, JSON.stringify(recon), disputedWithGst);
    await recordAudit({ action: 'cl.invoice_reconciled', actorId: caller.auth.user.id, targetType: 'cl_invoice', targetId: id, detail: { diffDays: rc.diffDays, disputed: disputedWithGst } });
    return { ...r[0]!, recon };
  },
  /** Payment approval: all compliance proofs for the month, and only the undisputed part. */
  async approvePayment(caller: Caller, id: string, amount?: number): Promise<Row> {
    const i = (await query(prisma, `SELECT * FROM cl_invoices WHERE id = $1::uuid`, id))[0];
    if (!i || !caller.ctx.unitIds.includes(S(i.unit_id))) throw Errors.notFound('Bill not found.');
    if (S(i.status) === 'DRAFT') throw Errors.conflict('Reconcile the bill before approving it for payment.');
    if (S(i.created_by_id) === caller.auth.user.id) throw Errors.forbidden('The person who entered the bill cannot approve it for payment.');
    const comp = (await clService.compliance(caller, S(i.contractor_id), S(i.billing_month), S(i.unit_id))) as { blocked: boolean; blockReason: string | null; scorePct: number };
    if (comp.blocked) {
      await query(prisma, `UPDATE cl_invoices SET status = 'PAYMENT_BLOCKED', block_reason = $2 WHERE id = $1::uuid`, id, comp.blockReason);
      await recordAudit({ action: 'cl.payment_blocked', actorId: caller.auth.user.id, targetType: 'cl_invoice', targetId: id, detail: { reason: comp.blockReason, score: comp.scorePct } });
      await prisma.$transaction(async (tx) => notificationService.notify(tx, [caller.auth.user.id], { type: 'cl.payment_blocked', title: `Payment blocked: ${S(i.invoice_no)}`, body: S(comp.blockReason), link: '/m/cl-invoices', entityType: 'cl_invoice', entityId: id, dedupeKey: `cl:${id}:blocked` }));
      throw Errors.conflict(S(comp.blockReason));
    }
    const undisputed = Math.round((N(i.net_payable) - N(i.disputed_amount)) * 100) / 100;
    const pay = amount ?? undisputed;
    if (pay > undisputed + 0.005) throw Errors.validation({ amount: `Only the undisputed part (₹${undisputed.toFixed(2)}) can be approved for payment.` });
    const r = await query(prisma, `UPDATE cl_invoices SET status = 'APPROVED', approved_amount = $2, block_reason = NULL, approved_by_id = $3::uuid, approved_at = now() WHERE id = $1::uuid RETURNING *`, id, pay, caller.auth.user.id);
    if (i.work_order_id) await clService.addUtilised(S(i.work_order_id), N(i.taxable_value), caller.auth.user.id);
    await recordAudit({ action: 'cl.payment_approved', actorId: caller.auth.user.id, targetType: 'cl_invoice', targetId: id, detail: { amount: pay, undisputed } });
    return r[0]!;
  },

  // ------------------------------------------------------------------------------------------ incidents, command center
  async addIncident(caller: Caller, b: { unitId?: string; incidentDate: string; workerId?: string | null; contractorId?: string | null; severity: 'Near miss' | 'Minor' | 'Major' | 'Fatal'; description: string; lostTimeHours?: number }): Promise<Row> {
    const unitId = unitOf(caller, b.unitId);
    return prisma.$transaction(async (tx) => {
      const no = await NumberingService.next(tx, { docType: 'cl-incidents', unitId, fyId: caller.ctx.fyId });
      const r = await query(tx, `INSERT INTO cl_incidents (unit_id, incident_no, incident_date, worker_id, contractor_id, severity, description, lost_time_hours, created_by_id) VALUES ($1::uuid,$2,$3::date,$4::uuid,$5::uuid,$6,$7,$8,$9::uuid) RETURNING *`, unitId, no, b.incidentDate, b.workerId ?? null, b.contractorId ?? null, b.severity, b.description, b.lostTimeHours ?? 0, caller.auth.user.id);
      await recordAudit({ action: 'cl.incident_raised', actorId: caller.auth.user.id, targetType: 'cl_incident', targetId: S(r[0]!.id), detail: { severity: b.severity } }, tx);
      return r[0]!;
    });
  },
  async incidents(caller: Caller): Promise<Row[]> {
    return query(prisma, `SELECT i.*, u.code AS unit_code FROM cl_incidents i JOIN units u ON u.id = i.unit_id WHERE i.unit_id = ANY($1::uuid[]) ORDER BY i.incident_date DESC LIMIT 200`, caller.ctx.unitIds);
  },

  async commandCenter(caller: Caller): Promise<Row> {
    const units = caller.ctx.unitIds;
    const today = todayIst();
    const month = today.slice(0, 7);
    const one = async (sql: string, ...args: unknown[]): Promise<number> => N((await query(prisma, sql, ...args))[0]?.n);
    const [onSite, contractors, licences, sheets, blocked, incidents] = await Promise.all([
      one(`SELECT count(*)::int AS n FROM cl_deployments WHERE released_at IS NULL AND unit_id = ANY($1::uuid[])`, units),
      one(`SELECT count(*)::int AS n FROM contractors WHERE status = 'Active'`),
      one(`SELECT count(*)::int AS n FROM contractors WHERE status = 'Active' AND licence_valid_until BETWEEN $1::date AND $1::date + 30`, today),
      one(`SELECT count(*)::int AS n FROM cl_wage_sheets WHERE unit_id = ANY($1::uuid[]) AND status <> 'LOCKED'`, units),
      one(`SELECT count(*)::int AS n FROM cl_invoices WHERE unit_id = ANY($1::uuid[]) AND status = 'PAYMENT_BLOCKED'`, units),
      one(`SELECT count(*)::int AS n FROM cl_incidents WHERE unit_id = ANY($1::uuid[]) AND to_char(incident_date,'YYYY-MM') = $2`, units, month),
    ]);
    const headcount = await query(prisma, `SELECT u.code AS unit_code, c.name AS contractor, count(*)::int AS headcount FROM cl_deployments d JOIN cl_workers w ON w.id = d.worker_id JOIN contractors c ON c.id = w.contractor_id JOIN units u ON u.id = d.unit_id WHERE d.released_at IS NULL AND d.unit_id = ANY($1::uuid[]) GROUP BY 1, 2 ORDER BY 1, 2`, units);
    const expiries = await query(prisma, `SELECT name, 'Licence' AS what, licence_valid_until AS on_date FROM contractors WHERE status = 'Active' AND licence_valid_until BETWEEN $1::date AND $1::date + 30 UNION ALL SELECT name, 'Insurance', insurance_expiry FROM contractors WHERE status = 'Active' AND insurance_expiry BETWEEN $1::date AND $1::date + 30 UNION ALL SELECT name, 'Agreement', agreement_end FROM contractors WHERE status = 'Active' AND agreement_end BETWEEN $1::date AND $1::date + 30 ORDER BY 3`, today);
    const blockers = await query(prisma, `SELECT i.invoice_no, c.name AS contractor, i.block_reason FROM cl_invoices i JOIN contractors c ON c.id = i.contractor_id WHERE i.unit_id = ANY($1::uuid[]) AND i.status = 'PAYMENT_BLOCKED'`, units);
    return { tiles: { workersOnSite: onSite, contractorsActive: contractors, licencesExpiring30: licences, wageSheetsPending: sheets, billsBlocked: blocked, incidentsThisMonth: incidents }, headcount, expiries, blockers };
  },
};

function blockMessage(kind: string, month: string, uploaded: boolean): string {
  if (['LICENCE', 'AGREEMENT', 'INSURANCE'].includes(kind)) return `Payment blocked: ${CHECK_LABEL[kind]} is not valid for ${month}.`;
  const what = (CHECK_LABEL[kind] ?? kind).replace(/^./, (c) => c.toUpperCase());
  return `Payment blocked: ${what} for ${month} ${uploaded ? 'is not verified yet' : 'not uploaded'}.`;
}
export { dmy };
