// apps/api/src/modules/service/technician-service.ts
// Technician master: create / update / deactivate. A technician is an HR employee, scoped to the caller's plant through
// the employee's current assignment. Writes are audited like the sibling service endpoints.
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { audit, norm, query, exec, insertRow } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';

const PAGE = 'service-technicians';

export interface TechnicianInput {
  employeeId?: string | undefined;
  territoryIds?: string[] | undefined;
  maxOpenJobs?: number | undefined;
  vanWarehouseId?: string | null | undefined;
  homeLat?: number | null | undefined;
  homeLng?: number | null | undefined;
  skills?: Array<{ skillCode: string; level: number }> | undefined;
}

/** SQL fragment: the employee has a current assignment in the caller's plant (no filter when the caller spans all plants). */
function plantSql(caller: Caller, args: unknown[], alias = 'e'): string {
  const unitId = caller.ctx.unitId;
  if (!unitId || caller.ctx.allUnits) return 'TRUE';
  args.push(unitId);
  return `EXISTS (SELECT 1 FROM employee_assignments ea WHERE ea.employee_id = ${alias}.id AND ea.unit_id = $${args.length}::uuid AND ea.effective_from <= CURRENT_DATE AND (ea.effective_to IS NULL OR ea.effective_to >= CURRENT_DATE))`;
}

export class TechnicianService {
  async get(caller: Caller, id: string): Promise<Row> {
    const args: unknown[] = [id];
    const rows = await query(
      prisma,
      `SELECT tech.*, e.emp_code, e.first_name || ' ' || e.last_name AS name, e.mobile AS mobile_phone,
              COALESCE((SELECT json_agg(json_build_object('skillCode', ts.skill_code, 'level', ts.level) ORDER BY ts.skill_code)
                        FROM technician_skills ts WHERE ts.technician_id = tech.id), '[]'::json) AS skills
       FROM technicians tech JOIN employees e ON e.id = tech.employee_id
       WHERE tech.id = $1::uuid AND ${plantSql(caller, args)}`,
      ...args,
    );
    if (!rows[0]) throw Errors.notFound('Technician not found.');
    return norm(rows[0]);
  }

  /** Active employees of this plant who are not technicians yet: feeds the picker on the form. */
  async employeeOptions(caller: Caller): Promise<Array<{ id: string; label: string }>> {
    const args: unknown[] = [];
    const rows = await query(
      prisma,
      `SELECT e.id::text AS id, e.emp_code || ' - ' || e.first_name || ' ' || e.last_name AS label
       FROM employees e
       WHERE NOT EXISTS (SELECT 1 FROM technicians t WHERE t.employee_id = e.id)
         AND e.status = 'ACTIVE' AND ${plantSql(caller, args)}
       ORDER BY e.emp_code LIMIT 500`,
      ...args,
    );
    return rows.map((r) => ({ id: String(r.id), label: String(r.label) }));
  }

  private async checkRefs(b: TechnicianInput): Promise<void> {
    if (b.vanWarehouseId) {
      const w = await query(prisma, `SELECT 1 FROM warehouses WHERE id = $1::uuid`, b.vanWarehouseId);
      if (!w.length) throw Errors.validation({ vanWarehouseId: 'Warehouse not found.' });
    }
    if (b.territoryIds?.length) {
      const t = await query(prisma, `SELECT id::text FROM territories WHERE id = ANY($1::uuid[])`, b.territoryIds);
      if (t.length !== new Set(b.territoryIds).size)
        throw Errors.validation({ territoryIds: 'One of the territories was not found.' });
    }
    const seen = new Set<string>();
    for (const s of b.skills ?? []) {
      if (seen.has(s.skillCode)) throw Errors.validation({ skills: `Skill ${s.skillCode} is listed twice.` });
      seen.add(s.skillCode);
    }
  }

  private async writeSkills(tx: Db, techId: string, skills: TechnicianInput['skills']): Promise<void> {
    if (!skills) return;
    await exec(tx, `DELETE FROM technician_skills WHERE technician_id = $1::uuid`, techId);
    for (const s of skills)
      await insertRow(tx, 'technician_skills', { technicianId: techId, skillCode: s.skillCode, level: s.level });
  }

  async create(caller: Caller, b: TechnicianInput): Promise<Row> {
    if (!b.employeeId) throw Errors.validation({ employeeId: 'Choose the employee.' });
    const emp = (
      await query(prisma, `SELECT e.emp_code, e.status FROM employees e WHERE e.id = $1::uuid`, b.employeeId)
    )[0];
    if (!emp) throw Errors.validation({ employeeId: 'Employee not found.' });
    const a: unknown[] = [b.employeeId];
    const inPlant = await query(
      prisma,
      `SELECT 1 FROM employees e WHERE e.id = $1::uuid AND ${plantSql(caller, a)}`,
      ...a,
    );
    if (!inPlant.length)
      throw Errors.validation({ employeeId: 'This employee does not work in the plant you are signed in to.' });
    if (String(emp.status) !== 'ACTIVE')
      throw Errors.validation({ employeeId: 'Only an active employee can be a technician.' });
    if ((await query(prisma, `SELECT 1 FROM technicians WHERE employee_id = $1::uuid`, b.employeeId)).length)
      throw Errors.conflict('This employee is already a technician.');
    await this.checkRefs(b);
    const id = await prisma.$transaction(async (tx) => {
      const tid = await insertRow(tx, 'technicians', {
        employeeId: b.employeeId,
        territoryIds: JSON.stringify(b.territoryIds ?? []),
        maxOpenJobs: b.maxOpenJobs ?? 5,
        vanWarehouseId: b.vanWarehouseId ?? null,
        homeLat: b.homeLat ?? null,
        homeLng: b.homeLng ?? null,
        active: true,
      });
      await this.writeSkills(tx, tid, b.skills);
      await audit(tx, caller, caller.auth.userId, 'TECHNICIAN_CREATED', 'technician', { id: tid, code: String(emp.emp_code) }, PAGE, {});
      return tid;
    });
    return this.get(caller, id);
  }

  async update(caller: Caller, id: string, b: TechnicianInput): Promise<Row> {
    const cur = await this.get(caller, id);
    if (b.employeeId && b.employeeId !== cur.employeeId)
      throw Errors.validation({
        employeeId: 'A technician cannot be moved to another employee. Deactivate this one and add a new one.',
      });
    await this.checkRefs(b);
    await prisma.$transaction(async (tx) => {
      const sets: string[] = [];
      const args: unknown[] = [];
      const add = (col: string, v: unknown, cast = '') => {
        args.push(v);
        sets.push(`${col} = $${args.length}${cast}`);
      };
      if (b.territoryIds !== undefined) add('territory_ids', JSON.stringify(b.territoryIds), '::jsonb');
      if (b.maxOpenJobs !== undefined) add('max_open_jobs', b.maxOpenJobs);
      if (b.vanWarehouseId !== undefined) add('van_warehouse_id', b.vanWarehouseId, '::uuid');
      if (b.homeLat !== undefined) add('home_lat', b.homeLat);
      if (b.homeLng !== undefined) add('home_lng', b.homeLng);
      if (sets.length)
        await exec(tx, `UPDATE technicians SET ${sets.join(', ')} WHERE id = $${args.length + 1}::uuid`, ...args, id);
      await this.writeSkills(tx, id, b.skills);
      await audit(tx, caller, caller.auth.userId, 'TECHNICIAN_UPDATED', 'technician', { id, code: String(cur.empCode) }, PAGE, {});
    });
    return this.get(caller, id);
  }

  async deactivate(caller: Caller, id: string): Promise<Row> {
    const cur = await this.get(caller, id);
    const open = await query(
      prisma,
      `SELECT COUNT(*)::int AS n FROM service_tickets WHERE assigned_technician_id = $1::uuid AND status IN ('ASSIGNED','IN_PROGRESS','AWAITING_CUSTOMER','AWAITING_PARTS')`,
      id,
    );
    if (Number(open[0]?.n ?? 0) > 0)
      throw Errors.conflict('This technician still has open tickets. Reassign them first.');
    await prisma.$transaction(async (tx) => {
      await exec(tx, `UPDATE technicians SET active = false WHERE id = $1::uuid`, id);
      await audit(tx, caller, caller.auth.userId, 'TECHNICIAN_DEACTIVATED', 'technician', { id, code: String(cur.empCode) }, PAGE, {});
    });
    return this.get(caller, id);
  }
}

export const technicianService = new TechnicianService();
