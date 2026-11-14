// apps/api/src/modules/projects/project-service.ts
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
import { norm, query, exec, insertRow, fyOfCaller } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { computeCpm, computeEvm } from './projects-calc';
import type { CpmTaskInput, CpmDependencyInput } from './projects-calc';

export class ProjectService {
  async listProjects(
    caller: Caller,
    params: { status?: string; customerId?: string; page?: number; size?: number },
  ): Promise<{ rows: Row[]; total: number }> {
    const conds: string[] = ['1=1'];
    const args: unknown[] = [];

    if (params.status) {
      args.push(params.status);
      conds.push(`p.status = $${args.length}`);
    }
    if (params.customerId) {
      args.push(params.customerId);
      conds.push(`p.customer_id = $${args.length}::uuid`);
    }

    const countSql = `SELECT COUNT(*)::int AS count FROM projects p WHERE ${conds.join(' AND ')}`;
    const countRows = await query(prisma, countSql, ...args);
    const total = (countRows[0]?.count as number) ?? 0;

    const page = Math.max(1, params.page ?? 1);
    const size = Math.max(1, Math.min(100, params.size ?? 25));
    const offset = (page - 1) * size;

    const sql = `
      SELECT p.*, p.code AS project_no, p.project_manager_id AS manager_id, p.billing_method AS billing_type, c.name AS customer_name,
        COALESCE((
          SELECT SUM(l.amount)
          FROM project_budgets b
          JOIN project_budget_lines l ON l.budget_id = b.id
          WHERE b.project_id = p.id AND b.status = 'APPROVED'
        ), 0)::numeric AS approved_budget,
        COALESCE((
          SELECT SUM(g.debit - g.credit)
          FROM gl_entries g
          JOIN accounts a ON a.id = g.account_id
          WHERE g.project_id = p.id AND a.root_type = 'Expense'
        ), 0)::numeric AS actual_cost
      FROM projects p
      LEFT JOIN customers c ON c.id = p.customer_id
      WHERE ${conds.join(' AND ')}
      ORDER BY p.created_at DESC
      LIMIT ${size} OFFSET ${offset}
    `;

    const rows = await query(prisma, sql, ...args);
    return { rows: rows.map(norm), total };
  }

  async getProject(caller: Caller, id: string): Promise<Row> {
    const rows = await query(
      prisma,
      `SELECT p.*, p.code AS project_no, p.project_manager_id AS manager_id, p.billing_method AS billing_type,
              c.name AS customer_name, m.first_name || ' ' || m.last_name AS manager_name
       FROM projects p
       LEFT JOIN customers c ON c.id = p.customer_id
       LEFT JOIN employees m ON m.id = p.project_manager_id
       WHERE p.id = $1::uuid`,
      id,
    );
    if (!rows[0]) throw Errors.notFound(`Project not found: ${id}`);
    const project = norm(rows[0]);

    const milestones = await query(
      prisma,
      `SELECT * FROM project_milestones WHERE project_id = $1::uuid ORDER BY target_date ASC`,
      id,
    );
    const team = await query(
      prisma,
      `SELECT pt.*, e.emp_code, e.first_name || ' ' || e.last_name AS employee_name
       FROM project_team pt
       JOIN employees e ON e.id = pt.employee_id
       WHERE pt.project_id = $1::uuid`,
      id,
    );

    project.milestones = milestones.map(norm);
    project.team = team.map(norm);
    return project;
  }

  async createProject(
    caller: Caller,
    input: {
      name: string;
      customerId?: string;
      managerId?: string;
      unitId: string;
      startDate: string;
      endDate: string;
      contractValue?: number;
      /** FIXED_MILESTONE | TIME_MATERIAL | NON_BILLABLE */
      billingType?: string;
    },
  ): Promise<Row> {
    if (input.endDate < input.startDate) {
      throw Errors.validation({ endDate: 'PRJ_DATES: End date cannot be before start date.' });
    }

    const fy = await fyOfCaller(caller);
    const unitId = input.unitId || caller.ctx.unitId || '';
    const projectNo = await NumberingService.allocate(prisma as any, {
      pageId: 'proj-projects',
      unitId,
      fyId: fy.id,
      prefix: 'PRJ',
    });
    const id = await insertRow(prisma, 'projects', {
      code: projectNo,
      name: input.name,
      customer_id: input.customerId ?? null,
      project_manager_id: input.managerId ?? null,
      unit_id: unitId,
      start_date: input.startDate,
      end_date: input.endDate,
      contract_value: input.contractValue ?? 0,
      project_type: 'CUSTOMER',
      billing_method: input.billingType ?? 'FIXED_MILESTONE',
      status: 'DRAFT',
      created_by_id: caller.auth.userId,
    });

    return this.getProject(caller, id);
  }

  async updateProject(caller: Caller, id: string, input: Partial<Row>): Promise<Row> {
    const p = await this.getProject(caller, id);
    if (p.status === 'CLOSED') {
      throw Errors.conflict(`PRJ_CLOSED: Project ${p.code} is closed; reopen it to edit.`);
    }

    const updates: string[] = [];
    const args: unknown[] = [id];

    if (input.name) {
      args.push(input.name);
      updates.push(`name = $${args.length}`);
    }
    if (input.customerId !== undefined) {
      args.push(input.customerId);
      updates.push(`customer_id = $${args.length}::uuid`);
    }
    if (input.managerId !== undefined) {
      args.push(input.managerId);
      updates.push(`project_manager_id = $${args.length}::uuid`);
    }
    if (input.startDate) {
      args.push(input.startDate);
      updates.push(`start_date = $${args.length}::date`);
    }
    if (input.endDate) {
      args.push(input.endDate);
      updates.push(`end_date = $${args.length}::date`);
    }
    if (input.contractValue !== undefined) {
      args.push(input.contractValue);
      updates.push(`contract_value = $${args.length}`);
    }

    if (updates.length > 0) {
      updates.push(`updated_at = now()`);
      await exec(prisma, `UPDATE projects SET ${updates.join(', ')} WHERE id = $1::uuid`, ...args);
    }

    return this.getProject(caller, id);
  }

  async activateProject(caller: Caller, id: string): Promise<Row> {
    const p = await this.getProject(caller, id);
    // Owner check 1: Can't activate a project without an approved budget
    const budgets = await query(
      prisma,
      `SELECT id FROM project_budgets WHERE project_id = $1::uuid AND status = 'APPROVED'`,
      id,
    );
    if (budgets.length === 0) {
      throw Errors.conflict('PRJ_BUDGET_NONE: Approve a budget before activating.');
    }

    await exec(prisma, `UPDATE projects SET status = 'ACTIVE', updated_at = now() WHERE id = $1::uuid`, id);
    return this.getProject(caller, id);
  }

  async holdProject(caller: Caller, id: string): Promise<Row> {
    await exec(prisma, `UPDATE projects SET status = 'ON_HOLD', updated_at = now() WHERE id = $1::uuid`, id);
    return this.getProject(caller, id);
  }

  async completeProject(caller: Caller, id: string): Promise<Row> {
    await exec(prisma, `UPDATE projects SET status = 'COMPLETED', updated_at = now() WHERE id = $1::uuid`, id);
    return this.getProject(caller, id);
  }

  async closeProject(caller: Caller, id: string): Promise<Row> {
    await exec(prisma, `UPDATE projects SET status = 'CLOSED', updated_at = now() WHERE id = $1::uuid`, id);
    return this.getProject(caller, id);
  }

  async setBaseline(caller: Caller, id: string): Promise<Row> {
    await exec(
      prisma,
      `UPDATE project_tasks
       SET baseline_start = planned_start,
           baseline_end = planned_end
       WHERE project_id = $1::uuid`,
      id,
    );
    return this.getProject(caller, id);
  }

  // -------------------------------------------------------------------------- Gantt & CPM
  async getGantt(caller: Caller, projectId: string): Promise<Row> {
    const tasksRows = await query(
      prisma,
      `SELECT t.*, e.first_name || ' ' || e.last_name AS assignee_name
       FROM project_tasks t
       LEFT JOIN employees e ON e.id = t.owner_id
       WHERE t.project_id = $1::uuid
       ORDER BY t.number ASC, t.created_at ASC`,
      projectId,
    );
    const tasks = tasksRows.map(norm);

    const depsRows = await query(
      prisma,
      `SELECT * FROM task_dependencies WHERE predecessor_id IN (
         SELECT id FROM project_tasks WHERE project_id = $1::uuid
       )`,
      projectId,
    );
    const deps = depsRows.map(norm);

    const cpmTasks: CpmTaskInput[] = tasks.map((t) => ({
      id: String(t.id),
      durationDays: Number(t.duration_days ?? 1),
      baselineStart: t.baseline_start ? String(t.baseline_start) : undefined,
      baselineEnd: t.baseline_end ? String(t.baseline_end) : undefined,
    }));

    const cpmDeps: CpmDependencyInput[] = deps.map((d) => ({
      predecessor: String(d.predecessor_id),
      successor: String(d.successor_id),
      type: d.type as any,
      lagDays: Number(d.lag_days ?? 0),
    }));

    const cpmResult = computeCpm(cpmTasks, cpmDeps);

    const enrichedTasks = tasks.map((t) => {
      const c = cpmResult.tasks[String(t.id)];
      return {
        ...t,
        earlyStart: c?.earlyStart ?? 0,
        earlyFinish: c?.earlyFinish ?? 0,
        lateStart: c?.lateStart ?? 0,
        lateFinish: c?.lateFinish ?? 0,
        totalFloat: c?.totalFloat ?? 0,
        isCritical: c?.isCritical ?? false,
      };
    });

    return {
      projectId,
      projectDurationDays: cpmResult.projectDurationDays,
      criticalPathTaskIds: cpmResult.criticalPathTaskIds,
      tasks: enrichedTasks,
      dependencies: deps,
    };
  }

  // -------------------------------------------------------------------------- EVM & Profitability
  async getEvm(caller: Caller, projectId: string): Promise<Row> {
    // 1. BAC from approved budget
    const bRows = await query(
      prisma,
      `SELECT COALESCE(SUM(l.amount), 0)::numeric AS bac
       FROM project_budgets b
       JOIN project_budget_lines l ON l.budget_id = b.id
       WHERE b.project_id = $1::uuid AND b.status = 'APPROVED'`,
      projectId,
    );
    const bac = Number(bRows[0]?.bac ?? 0);

    // 2. EV from tasks budget * progress
    const tRows = await query(
      prisma,
      `SELECT COALESCE(SUM(COALESCE(NULLIF(weight, 0), 1) * (progress_pct / 100.0))
                       / NULLIF(SUM(COALESCE(NULLIF(weight, 0), 1)), 0), 0)::numeric AS done_fraction
       FROM project_tasks
       WHERE project_id = $1::uuid`,
      projectId,
    );
    // EV = approved budget x weighted share of work done (task weight, default 1).
    const ev = Math.round(Number(tRows[0]?.done_fraction ?? 0) * bac * 100) / 100;

    // 3. AC from gl_entries where project_id = projectId and root_type = 'Expense'
    const glRows = await query(
      prisma,
      `SELECT COALESCE(SUM(g.debit - g.credit), 0)::numeric AS ac
       FROM gl_entries g
       JOIN accounts a ON a.id = g.account_id
       WHERE g.project_id = $1::uuid AND a.root_type = 'Expense'`,
      projectId,
    );
    const ac = Number(glRows[0]?.ac ?? 0);

    // 4. PV: linear across working days from project start to end vs today
    const p = await this.getProject(caller, projectId);
    const start = new Date(String(p.start_date)).getTime();
    const end = new Date(String(p.end_date)).getTime();
    const now = Date.now();
    let pv = 0;
    if (end > start) {
      const elapsed = Math.max(0, Math.min(now - start, end - start));
      pv = Math.round((elapsed / (end - start)) * bac * 100) / 100;
    }

    const evm = computeEvm({ bac, pv, ev, ac });
    return norm(evm as unknown as Row);
  }

  async getProfitability(caller: Caller, projectId: string): Promise<Row> {
    // Section 5: one SQL over gl_entries where project_id = X, grouped by account class.
    const summaryRows = await query(
      prisma,
      `SELECT a.root_type, a.code, a.name,
              SUM(g.debit)::numeric AS total_debit,
              SUM(g.credit)::numeric AS total_credit,
              SUM(CASE WHEN a.root_type = 'Income' THEN (g.credit - g.debit)
                       ELSE (g.debit - g.credit) END)::numeric AS net_amount
       FROM gl_entries g
       JOIN accounts a ON a.id = g.account_id
       WHERE g.project_id = $1::uuid
       GROUP BY a.root_type, a.code, a.name
       ORDER BY a.root_type ASC, a.code ASC`,
      projectId,
    );

    let revenue = 0;
    let cost = 0;
    const directCosts: Row[] = [];
    const directCostByHead = {
      labour: 0,
      material: 0,
      subcontract: 0,
      travel: 0,
      other: 0,
    };

    for (const r of summaryRows) {
      const amt = Number(r.net_amount ?? 0);
      if (r.root_type === 'Income') {
        revenue += amt;
      } else if (r.root_type === 'Expense') {
        cost += amt;
        directCosts.push(norm(r));
        const code = String(r.code ?? '');
        if (code === '5112') {
          directCostByHead.labour += amt;
        } else if (code.startsWith('51') || code.startsWith('14')) {
          directCostByHead.material += amt;
        } else if (code === '6251') {
          directCostByHead.travel += amt;
        } else {
          directCostByHead.other += amt;
        }
      }
    }

    const contribution = revenue - cost;
    const marginPct = revenue > 0 ? Math.round((contribution / revenue) * 10000) / 100 : null;

    // Line drill-down: fetch individual GL entries for transparency
    const glLines = await query(
      prisma,
      `SELECT g.id, g.posting_date, g.voucher_type, g.voucher_no, g.narration,
              a.code AS account_code, a.name AS account_name,
              g.debit, g.credit
       FROM gl_entries g
       JOIN accounts a ON a.id = g.account_id
       WHERE g.project_id = $1::uuid
       ORDER BY g.posting_date DESC, g.created_at DESC`,
      projectId,
    );

    return {
      projectId,
      revenue,
      totalCost: cost,
      contribution,
      marginPct: marginPct !== null ? `${marginPct}%` : '—',
      costByHead: directCostByHead,
      summary: summaryRows.map(norm),
      drillDown: glLines.map(norm),
    };
  }

  // -------------------------------------------------------------------------- Tasks & Dependencies
  async listTasks(caller: Caller, projectId: string): Promise<Row[]> {
    const rows = await query(
      prisma,
      `SELECT t.*, e.first_name || ' ' || e.last_name AS assignee_name
       FROM project_tasks t
       LEFT JOIN employees e ON e.id = t.owner_id
       WHERE t.project_id = $1::uuid
       ORDER BY t.number ASC, t.created_at ASC`,
      projectId,
    );
    return rows.map(norm);
  }

  async createTask(
    caller: Caller,
    input: {
      projectId: string;
      name: string;
      wbsCode?: string;
      assignedToId?: string;
      plannedStart: string;
      plannedEnd: string;
      durationDays?: number;
      estimatedHours?: number;
    },
  ): Promise<Row> {
    const id = await insertRow(prisma, 'project_tasks', {
      project_id: input.projectId,
      name: input.name,
      number: input.wbsCode ?? '1.0',
      owner_id: input.assignedToId ?? null,
      planned_start: input.plannedStart,
      planned_end: input.plannedEnd,
      duration_days: input.durationDays ?? 1,
      estimated_hrs: input.estimatedHours ?? 0,
      status: 'OPEN',
    });
    const rows = await query(prisma, `SELECT * FROM project_tasks WHERE id = $1::uuid`, id);
    return norm(rows[0]!);
  }

  async updateTaskProgress(caller: Caller, taskId: string, progressPct: number): Promise<Row> {
    const pct = Math.max(0, Math.min(100, progressPct));
    let status = 'IN_PROGRESS';
    if (pct === 0) status = 'OPEN';
    if (pct === 100) status = 'DONE';

    await exec(
      prisma,
      `UPDATE project_tasks
       SET progress_pct = $1, status = $2, updated_at = now()
       WHERE id = $3::uuid`,
      pct,
      status,
      taskId,
    );
    const rows = await query(prisma, `SELECT * FROM project_tasks WHERE id = $1::uuid`, taskId);
    return norm(rows[0]!);
  }

  async addDependency(
    caller: Caller,
    input: { predecessorId: string; successorId: string; type?: string; lagDays?: number },
  ): Promise<Row> {
    if (input.predecessorId === input.successorId) {
      throw Errors.validation({ predecessorId: 'PRJ_DEP_CYCLE: Self-dependency detected.' });
    }

    // Check project of predecessor to run CPM cycle validation
    const pRows = await query(
      prisma,
      `SELECT project_id FROM project_tasks WHERE id = $1::uuid`,
      input.predecessorId,
    );
    if (!pRows[0]) throw Errors.notFound('Predecessor task not found');
    const projectId = pRows[0].project_id as string;

    const tasksRows = await query(
      prisma,
      `SELECT id, duration_days FROM project_tasks WHERE project_id = $1::uuid`,
      projectId,
    );
    const existingDeps = await query(
      prisma,
      `SELECT predecessor_id, successor_id, type, lag_days FROM task_dependencies
       WHERE predecessor_id IN (SELECT id FROM project_tasks WHERE project_id = $1::uuid)`,
      projectId,
    );

    const cpmTasks: CpmTaskInput[] = tasksRows.map((t) => ({
      id: t.id as string,
      durationDays: Number(t.duration_days ?? 1),
    }));

    const cpmDeps: CpmDependencyInput[] = existingDeps.map((d) => ({
      predecessor: d.predecessor_id as string,
      successor: d.successor_id as string,
      type: d.type as any,
      lagDays: Number(d.lag_days ?? 0),
    }));

    cpmDeps.push({
      predecessor: input.predecessorId,
      successor: input.successorId,
      type: (input.type as any) ?? 'FS',
      lagDays: input.lagDays ?? 0,
    });

    // Validate acyclicity with CPM
    computeCpm(cpmTasks, cpmDeps);

    const id = await insertRow(prisma, 'task_dependencies', {
      predecessor_id: input.predecessorId,
      successor_id: input.successorId,
      type: input.type ?? 'FS',
      lag_days: input.lagDays ?? 0,
    });

    const rows = await query(prisma, `SELECT * FROM task_dependencies WHERE id = $1::uuid`, id);
    return norm(rows[0]!);
  }
}

export const projectService = new ProjectService();
