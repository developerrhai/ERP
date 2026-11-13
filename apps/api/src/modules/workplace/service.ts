// Phase 29: workplace operations. Tasks (dependencies, recurrence, approval), shift handover, visitors (pass, approval, gate, overstay,
// anonymisation) and the canteen (entitlement, one meal per person per day, money to the paisa, month close to payroll and the GL).
import { createHash, randomBytes } from 'node:crypto';
import { recordAudit } from '../../core/audit/audit-service';
import { NumberingService } from '../../core/numbering/numbering-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { logger } from '../../core/logger';
import { PostingService } from '../finance/posting-service';
import { notificationService } from '../notifications/service';
import { query } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { isElevated, usersOf } from '../work/service';
import { accessUserOf } from '../../core/rbac/access';
import { anonymiseDue, dueOn, handoverLate, isOverdue, mealMoney, monthName, nextDue, overstayed, vendorVariance, workloadColour, wouldCycle } from './calc';
import type { Recurrence } from './calc';

const S = (v: unknown): string => String(v ?? '');
const N = (v: unknown): number => Number(v ?? 0);
const todayIst = (now = new Date()): string => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
/** A DATE column comes back as a Date (UTC midnight): both forms become YYYY-MM-DD. */
const d10 = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : S(v).slice(0, 10));
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

function unitOf(caller: Caller, requested?: string | null): string {
  const u = requested ?? caller.ctx.unitId ?? '';
  if (!caller.ctx.unitIds.includes(u)) throw Errors.forbidden();
  return u;
}

async function tell(tx: Tx, userIds: (string | null | undefined)[], type: string, title: string, body: string, link: string, entity: string, id: string, dedupe: string): Promise<void> {
  const ids = [...new Set(userIds.filter((x): x is string => Boolean(x)))];
  if (ids.length === 0) return;
  await notificationService.notify(tx, ids, { type, title, body, link, entityType: entity, entityId: id, dedupeKey: dedupe });
}

// ================================================================================================ tasks
const TASK_SEL = `t.*, u.name AS assigned_to, b.name AS assigned_by, un.code AS unit_code,
  (SELECT count(*)::int FROM ops_task_dependencies d JOIN tasks p ON p.id = d.pred_id WHERE d.succ_id = t.id AND p.status NOT IN ('Done','Approved')) AS blocked_by_count`;
const TASK_FROM = `FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to_id JOIN users b ON b.id = t.assigned_by_id JOIN units un ON un.id = t.unit_id`;

export const taskService = {
  async create(caller: Caller, b: { title: string; description?: string | null; department?: string | null; assignedToId?: string | null; priority?: string; startDate?: string | null; dueDate?: string | null; approvalRequired?: boolean; projectId?: string | null; linkedDocType?: string | null; linkedDocId?: string | null; recurrence?: Recurrence | null; checklist?: string[]; dependsOn?: string[]; unitId?: string }): Promise<Row> {
    const unitId = unitOf(caller, b.unitId);
    if (b.dueDate && b.startDate && b.dueDate < b.startDate) throw Errors.validation({ dueDate: 'The due date cannot be before the start date.' });
    return prisma.$transaction(async (tx) => {
      const no = await NumberingService.next(tx, { docType: 'ops-tasks', unitId, fyId: caller.ctx.fyId });
      const t = (await query(
        tx,
        `INSERT INTO tasks (unit_id, fy_id, task_no, title, description, department, assigned_to_id, assigned_by_id, priority, start_date, due_date, approval_required, project_id, linked_doc_type, linked_doc_id, recurrence, is_template)
         VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7::uuid,$8::uuid,$9,$10::date,$11::date,$12,$13::uuid,$14,$15::uuid,$16::jsonb,$17) RETURNING *`,
        unitId, caller.ctx.fyId, no, b.title, b.description ?? null, b.department ?? null, b.assignedToId ?? null, caller.auth.user.id, b.priority ?? 'Medium', b.startDate ?? null, b.dueDate ?? null,
        b.approvalRequired ?? false, b.projectId ?? null, b.linkedDocType ?? null, b.linkedDocId ?? null, b.recurrence ? JSON.stringify(b.recurrence) : null, Boolean(b.recurrence && !b.dueDate),
      ))[0]!;
      let seq = 1;
      for (const text of b.checklist ?? []) await query(tx, `INSERT INTO task_checklist (task_id, seq, text) VALUES ($1::uuid,$2,$3)`, t.id, seq++, text);
      for (const pred of b.dependsOn ?? []) await taskService.addDependencyTx(tx, S(pred), S(t.id));
      await recordAudit({ action: 'task.created', actorId: caller.auth.user.id, targetType: 'task', targetId: S(t.id), detail: { taskNo: no } }, tx);
      if (b.assignedToId && b.assignedToId !== caller.auth.user.id) await tell(tx, [b.assignedToId], 'task.assigned', `Task ${no}: ${b.title}`.slice(0, 200), `Assigned to you${b.dueDate ? `, due ${b.dueDate}` : ''}.`, '/m/ops-tasks', 'task', S(t.id), `task:${S(t.id)}:assigned`);
      return t;
    });
  },

  async addDependencyTx(tx: Tx, predId: string, succId: string): Promise<void> {
    const both = await query(tx, `SELECT id, task_no FROM tasks WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`, [predId, succId]);
    if (both.length !== 2) throw Errors.validation({ dependsOn: 'That task does not exist.' });
    const edges = (await query(tx, `SELECT pred_id::text AS pred, succ_id::text AS succ FROM ops_task_dependencies`)).map((e) => ({ pred: S(e.pred), succ: S(e.succ) }));
    if (wouldCycle(edges, predId, succId)) throw Errors.validation({ dependsOn: 'This dependency would make a loop of tasks waiting for each other.' });
    await query(tx, `INSERT INTO ops_task_dependencies (pred_id, succ_id) VALUES ($1::uuid,$2::uuid) ON CONFLICT DO NOTHING`, predId, succId);
  },
  async addDependency(caller: Caller, succId: string, predId: string): Promise<Row> {
    await taskService.get(caller, succId);
    await prisma.$transaction((tx) => taskService.addDependencyTx(tx, predId, succId));
    return taskService.get(caller, succId);
  },

  async get(caller: Caller, id: string): Promise<Row> {
    const t = (await query(prisma, `SELECT ${TASK_SEL} ${TASK_FROM} WHERE t.id = $1::uuid AND t.deleted_at IS NULL`, id))[0];
    if (!t || !caller.ctx.unitIds.includes(S(t.unit_id))) throw Errors.notFound('Task not found.');
    return t;
  },
  async detail(caller: Caller, id: string): Promise<Row> {
    const t = await taskService.get(caller, id);
    const [checklist, comments, deps] = await Promise.all([
      query(prisma, `SELECT id, seq, text, done FROM task_checklist WHERE task_id = $1::uuid ORDER BY seq`, id),
      query(prisma, `SELECT c.body, c.created_at, u.name FROM task_comments c JOIN users u ON u.id = c.user_id WHERE c.task_id = $1::uuid ORDER BY c.created_at`, id),
      query(prisma, `SELECT p.id, p.task_no, p.status FROM ops_task_dependencies d JOIN tasks p ON p.id = d.pred_id WHERE d.succ_id = $1::uuid`, id),
    ]);
    return { ...t, checklist, comments, dependsOn: deps };
  },

  async list(caller: Caller, f: { dept?: string; mine?: boolean; status?: string; overdue?: boolean; q?: string; unit?: string; page?: number; size?: number }): Promise<{ rows: Row[]; total: number }> {
    const size = Math.min(100, f.size ?? 50);
    const off = ((f.page ?? 1) - 1) * size;
    const units = f.unit ? [unitOf(caller, f.unit)] : caller.ctx.unitIds;
    const args = [units, f.dept ?? null, f.mine ? caller.auth.user.id : null, f.status ?? null, f.overdue ? todayIst() : null, f.q ? `%${f.q}%` : null];
    const where = `t.deleted_at IS NULL AND NOT t.is_template AND t.unit_id = ANY($1::uuid[]) AND ($2::text IS NULL OR t.department = $2) AND ($3::uuid IS NULL OR t.assigned_to_id = $3::uuid)
      AND ($4::text IS NULL OR t.status = $4) AND ($5::date IS NULL OR (t.due_date < $5::date AND t.status NOT IN ('Done','Approved','Cancelled'))) AND ($6::text IS NULL OR t.task_no ILIKE $6 OR t.title ILIKE $6)`;
    const total = Number((await query(prisma, `SELECT count(*)::int AS n FROM tasks t WHERE ${where}`, ...args))[0]!.n);
    const rows = await query(prisma, `SELECT ${TASK_SEL} ${TASK_FROM} WHERE ${where} ORDER BY t.due_date NULLS LAST, t.created_at DESC LIMIT ${size} OFFSET ${off}`, ...args);
    return { rows, total };
  },

  async board(caller: Caller, f: { dept?: string; unit?: string }): Promise<Record<string, Row[]>> {
    const { rows } = await taskService.list(caller, { ...f, size: 100 });
    const out: Record<string, Row[]> = { Open: [], 'In Progress': [], Blocked: [], Done: [], Approved: [] };
    for (const r of rows) (out[S(r.status)] ??= []).push(r);
    return out;
  },

  async workload(caller: Caller, f: { dept?: string }): Promise<Row[]> {
    const today = todayIst();
    const rows = await query(
      prisma,
      `SELECT u.id::text AS user_id, u.name,
              count(*) FILTER (WHERE t.status IN ('Open','In Progress','Blocked'))::int AS open,
              count(*) FILTER (WHERE t.status IN ('Open','In Progress','Blocked') AND t.due_date < $2::date)::int AS overdue,
              count(*) FILTER (WHERE t.approval_status = 'Pending')::int AS approvals_waiting
         FROM tasks t JOIN users u ON u.id = t.assigned_to_id
        WHERE t.deleted_at IS NULL AND NOT t.is_template AND t.unit_id = ANY($1::uuid[]) AND ($3::text IS NULL OR t.department = $3)
        GROUP BY 1, 2 ORDER BY 3 DESC, 2`,
      caller.ctx.unitIds, today, f.dept ?? null,
    );
    return rows.map((r) => ({ ...r, colour: workloadColour(N(r.open), N(r.overdue)) }));
  },

  /** Start: a finish-to-start dependency that is not done blocks it. */
  async start(caller: Caller, id: string): Promise<Row> {
    const t = await taskService.get(caller, id);
    const blocker = (await query(prisma, `SELECT p.task_no FROM ops_task_dependencies d JOIN tasks p ON p.id = d.pred_id WHERE d.succ_id = $1::uuid AND p.status NOT IN ('Done','Approved') ORDER BY p.task_no LIMIT 1`, id))[0];
    if (blocker) {
      await query(prisma, `UPDATE tasks SET status = 'Blocked', updated_at = now() WHERE id = $1::uuid AND status = 'Open'`, id);
      throw Errors.conflict(`Blocked by ${S(blocker.task_no)} (not done).`);
    }
    if (!['Open', 'Blocked'].includes(S(t.status))) throw Errors.conflict(`A task that is ${S(t.status).toLowerCase()} cannot be started.`);
    const r = await query(prisma, `UPDATE tasks SET status = 'In Progress', start_date = coalesce(start_date, CURRENT_DATE), version = version + 1, updated_at = now() WHERE id = $1::uuid RETURNING *`, id);
    return r[0]!;
  },

  async progress(caller: Caller, id: string, pct: number): Promise<Row> {
    await taskService.get(caller, id);
    const r = await query(prisma, `UPDATE tasks SET progress_pct = $2, updated_at = now() WHERE id = $1::uuid AND status = 'In Progress' RETURNING *`, id, pct);
    if (!r[0]) throw Errors.conflict('Only a task in progress can have its progress changed.');
    return r[0];
  },

  /** Done: with approval required it waits for a different person; a recurring task creates the next one. */
  async done(caller: Caller, id: string): Promise<Row> {
    const t = await taskService.get(caller, id);
    if (['Done', 'Approved', 'Cancelled'].includes(S(t.status))) throw Errors.conflict(`This task is already ${S(t.status).toLowerCase()}.`);
    const open = (await query(prisma, `SELECT count(*)::int AS n FROM task_checklist WHERE task_id = $1::uuid AND NOT done`, id))[0];
    if (N(open?.n) > 0) throw Errors.validation({ checklist: `${N(open!.n)} checklist item(s) are not ticked.` });
    return prisma.$transaction(async (tx) => {
      const needs = Boolean(t.approval_required);
      const r = (await query(tx, `UPDATE tasks SET status = 'Done', progress_pct = 100, done_at = now(), approval_status = $2, version = version + 1, updated_at = now() WHERE id = $1::uuid RETURNING *`, id, needs ? 'Pending' : 'None'))[0]!;
      if (needs) await tell(tx, [S(t.assigned_by_id)], 'task.approval', `Task ${S(t.task_no)} is done`, 'It is waiting for your approval.', '/m/ops-tasks', 'task', id, `task:${id}:approval`);
      if (t.recurrence && t.parent_task_id === null && !t.is_template) await taskService.spawnNext(tx, t);
      await recordAudit({ action: 'task.done', actorId: caller.auth.user.id, targetType: 'task', targetId: id, detail: { taskNo: S(t.task_no) } }, tx);
      return r;
    });
  },

  async approve(caller: Caller, id: string): Promise<Row> {
    const t = await taskService.get(caller, id);
    if (S(t.approval_status) !== 'Pending') throw Errors.conflict('This task is not waiting for approval.');
    if (S(t.assigned_to_id) === caller.auth.user.id) throw Errors.forbidden('You cannot approve your own task.');
    const r = await query(prisma, `UPDATE tasks SET status = 'Approved', approval_status = 'Approved', approved_at = now(), approved_by_id = $2::uuid, version = version + 1 WHERE id = $1::uuid RETURNING *`, id, caller.auth.user.id);
    await recordAudit({ action: 'task.approved', actorId: caller.auth.user.id, targetType: 'task', targetId: id, detail: { taskNo: S(t.task_no) } });
    return r[0]!;
  },
  async reopen(caller: Caller, id: string, reason: string): Promise<Row> {
    if (!reason?.trim()) throw Errors.validation({ reason: 'Give a reason to reopen the task.' });
    await taskService.get(caller, id);
    const r = await query(prisma, `UPDATE tasks SET status = 'Open', approval_status = 'None', done_at = NULL, progress_pct = LEAST(progress_pct, 90), version = version + 1 WHERE id = $1::uuid AND status IN ('Done','Approved','Cancelled') RETURNING *`, id);
    if (!r[0]) throw Errors.conflict('Only a finished task can be reopened.');
    await query(prisma, `INSERT INTO task_comments (task_id, user_id, body) VALUES ($1::uuid,$2::uuid,$3)`, id, caller.auth.user.id, `Reopened: ${reason.trim()}`);
    return r[0];
  },
  async comment(caller: Caller, id: string, body: string): Promise<Row> {
    await taskService.get(caller, id);
    if (!body?.trim()) throw Errors.validation({ body: 'Write a comment.' });
    return (await query(prisma, `INSERT INTO task_comments (task_id, user_id, body) VALUES ($1::uuid,$2::uuid,$3) RETURNING *`, id, caller.auth.user.id, body.trim()))[0]!;
  },
  async tick(caller: Caller, id: string, itemId: string, done: boolean): Promise<Row> {
    await taskService.get(caller, id);
    const r = await query(prisma, `UPDATE task_checklist SET done = $3, done_by_id = $4::uuid, done_at = CASE WHEN $3 THEN now() ELSE NULL END WHERE id = $2::uuid AND task_id = $1::uuid RETURNING *`, id, itemId, done, caller.auth.user.id);
    if (!r[0]) throw Errors.notFound('Checklist item not found.');
    return r[0];
  },

  /** The next task of a recurring series, once per due date. */
  async spawnNext(tx: Tx, t: Row): Promise<Row | null> {
    const rec = t.recurrence as Recurrence;
    const due = nextDue(rec, d10(t.due_date ?? todayIst()));
    const no = await NumberingService.next(tx, { docType: 'ops-tasks', unitId: S(t.unit_id), fyId: S(t.fy_id) });
    const r = await query(
      tx,
      `INSERT INTO tasks (unit_id, fy_id, task_no, title, description, department, assigned_to_id, assigned_by_id, priority, start_date, due_date, approval_required, recurrence, parent_task_id)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7::uuid,$8::uuid,$9,$10::date,$10::date,$11,$12::jsonb,$13::uuid) ON CONFLICT DO NOTHING RETURNING *`,
      t.unit_id, t.fy_id, no, t.title, t.description, t.department, t.assigned_to_id, t.assigned_by_id, t.priority, due, t.approval_required, JSON.stringify(rec), t.parent_task_id ?? t.id,
    );
    return r[0] ?? null;
  },

  /** Job (00:05 IST): each recurring template creates today's task, once per date. */
  async runRecurring(now: Date = new Date()): Promise<{ created: number }> {
    const today = todayIst(now);
    const tpl = await query(prisma, `SELECT * FROM tasks WHERE is_template AND recurrence IS NOT NULL AND deleted_at IS NULL AND status <> 'Cancelled'`);
    let created = 0;
    for (const t of tpl) {
      const start = d10(t.start_date ?? t.created_at);
      if (!dueOn(t.recurrence as Recurrence, today, start)) continue;
      const made = await prisma.$transaction(async (tx) => {
        const no = await NumberingService.next(tx, { docType: 'ops-tasks', unitId: S(t.unit_id), fyId: S(t.fy_id) });
        const r = await query(
          tx,
          `INSERT INTO tasks (unit_id, fy_id, task_no, title, description, department, assigned_to_id, assigned_by_id, priority, start_date, due_date, approval_required, parent_task_id)
           VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7::uuid,$8::uuid,$9,$10::date,$10::date,$11,$12::uuid) ON CONFLICT DO NOTHING RETURNING id`,
          t.unit_id, t.fy_id, no, t.title, t.description, t.department, t.assigned_to_id, t.assigned_by_id, t.priority, today, t.approval_required, t.id,
        );
        if (r[0]) await tell(tx, [S(t.assigned_to_id)], 'task.assigned', `Task ${no}: ${S(t.title)}`.slice(0, 200), `Recurring task for ${today}.`, '/m/ops-tasks', 'task', S(r[0].id), `task:${S(r[0].id)}:assigned`);
        return Boolean(r[0]);
      });
      if (made) created += 1;
    }
    return { created };
  },

  /** Job (every 10 minutes): one notice per overdue task per day. */
  async notifyOverdue(now: Date = new Date()): Promise<{ notified: number }> {
    const today = todayIst(now);
    const rows = await query(prisma, `SELECT id, task_no, title, assigned_to_id, assigned_by_id, due_date::text AS due FROM tasks WHERE deleted_at IS NULL AND NOT is_template AND due_date < $1::date AND status IN ('Open','In Progress','Blocked')`, today);
    let n = 0;
    for (const r of rows) {
      await prisma.$transaction(async (tx) => tell(tx, [S(r.assigned_to_id), S(r.assigned_by_id)], 'task.overdue', `Overdue: ${S(r.task_no)}`, `${S(r.title)} was due on ${S(r.due)}.`, '/m/ops-tasks', 'task', S(r.id), `task:${S(r.id)}:overdue:${today}`));
      n += 1;
    }
    return { notified: n };
  },
};

// ================================================================================================ shift handover
export const handoverService = {
  async create(caller: Caller, b: { department: string; handoverDate: string; fromShiftId?: string | null; toShiftId?: string | null; incomingUserId?: string | null; lines?: unknown[]; issues?: string | null; safetyNote?: string | null; pendingJobs?: unknown[]; materialsShort?: string | null; unitId?: string }): Promise<Row> {
    const unitId = unitOf(caller, b.unitId);
    return (await query(
      prisma,
      `INSERT INTO shift_handovers (unit_id, department, handover_date, from_shift_id, to_shift_id, outgoing_user_id, incoming_user_id, lines, issues, safety_note, pending_jobs, materials_short)
       VALUES ($1::uuid,$2,$3::date,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::jsonb,$9,$10,$11::jsonb,$12) RETURNING *`,
      unitId, b.department, b.handoverDate, b.fromShiftId ?? null, b.toShiftId ?? null, caller.auth.user.id, b.incomingUserId ?? null, JSON.stringify(b.lines ?? []), b.issues ?? null, b.safetyNote ?? null, JSON.stringify(b.pendingJobs ?? []), b.materialsShort ?? null,
    ))[0]!;
  },
  async get(caller: Caller, id: string): Promise<Row> {
    const h = (await query(prisma, `SELECT h.*, o.name AS outgoing, i.name AS incoming, u.code AS unit_code FROM shift_handovers h JOIN users o ON o.id = h.outgoing_user_id LEFT JOIN users i ON i.id = h.incoming_user_id JOIN units u ON u.id = h.unit_id WHERE h.id = $1::uuid`, id))[0];
    if (!h || !caller.ctx.unitIds.includes(S(h.unit_id))) throw Errors.notFound('Handover not found.');
    return h;
  },
  async list(caller: Caller, status?: string): Promise<Row[]> {
    return query(prisma, `SELECT h.*, o.name AS outgoing, i.name AS incoming, u.code AS unit_code FROM shift_handovers h JOIN users o ON o.id = h.outgoing_user_id LEFT JOIN users i ON i.id = h.incoming_user_id JOIN units u ON u.id = h.unit_id WHERE h.unit_id = ANY($1::uuid[]) AND ($2::text IS NULL OR h.status = $2) ORDER BY h.handover_date DESC, h.created_at DESC LIMIT 100`, caller.ctx.unitIds, status ?? null);
  },
  /** Submit: the incoming in-charge must accept within 30 minutes of the next shift's start. */
  async submit(caller: Caller, id: string, now: Date = new Date()): Promise<Row> {
    const h = await handoverService.get(caller, id);
    if (S(h.outgoing_user_id) !== caller.auth.user.id && !isElevated(caller)) throw Errors.forbidden('Only the outgoing in-charge can submit this handover.');
    if (!h.incoming_user_id) throw Errors.validation({ incomingUserId: 'Choose the incoming in-charge.' });
    const shift = h.to_shift_id ? (await query(prisma, `SELECT start_time::text AS st FROM shifts WHERE id = $1::uuid`, h.to_shift_id))[0] : null;
    let acceptBy = new Date(now.getTime() + 30 * 60_000);
    if (shift?.st) {
      const [hh, mm] = S(shift.st).split(':').map(Number) as [number, number];
      const start = new Date(`${d10(h.handover_date)}T00:00:00Z`).getTime() + (hh * 60 + mm - 330) * 60_000;
      acceptBy = new Date(Math.max(now.getTime(), start) + 30 * 60_000);
    }
    const r = await query(prisma, `UPDATE shift_handovers SET status = 'SUBMITTED', submitted_at = $2::timestamptz, accept_by = $3::timestamptz WHERE id = $1::uuid AND status IN ('DRAFT','REJECTED') RETURNING *`, id, now.toISOString(), acceptBy.toISOString());
    if (!r[0]) throw Errors.conflict('This handover was already submitted.');
    await prisma.$transaction(async (tx) => tell(tx, [S(h.incoming_user_id)], 'handover.submitted', `Handover from ${S(h.outgoing)}`, `${S(h.department)}: accept it within 30 minutes of your shift start.`, '/m/ops-shift-roster', 'shift_handover', id, `ho:${id}:submitted`));
    return r[0];
  },
  async accept(caller: Caller, id: string): Promise<Row> {
    const h = await handoverService.get(caller, id);
    if (S(h.incoming_user_id) !== caller.auth.user.id && !isElevated(caller)) throw Errors.forbidden('Only the incoming in-charge can accept this handover.');
    const r = await query(prisma, `UPDATE shift_handovers SET status = 'ACCEPTED', accepted_at = now() WHERE id = $1::uuid AND status = 'SUBMITTED' RETURNING *`, id);
    if (!r[0]) throw Errors.conflict('This handover is not waiting for acceptance.');
    await recordAudit({ action: 'handover.accepted', actorId: caller.auth.user.id, targetType: 'shift_handover', targetId: id });
    return r[0];
  },
  async reject(caller: Caller, id: string, reason: string): Promise<Row> {
    if (!reason?.trim()) throw Errors.validation({ reason: 'Give a reason for rejecting the handover.' });
    const h = await handoverService.get(caller, id);
    if (S(h.incoming_user_id) !== caller.auth.user.id && !isElevated(caller)) throw Errors.forbidden('Only the incoming in-charge can reject this handover.');
    const r = await query(prisma, `UPDATE shift_handovers SET status = 'REJECTED', reject_reason = $2 WHERE id = $1::uuid AND status = 'SUBMITTED' RETURNING *`, id, reason.trim());
    if (!r[0]) throw Errors.conflict('This handover is not waiting for acceptance.');
    await prisma.$transaction(async (tx) => tell(tx, [S(h.outgoing_user_id)], 'handover.submitted', 'Handover rejected', reason.trim(), '/m/ops-shift-roster', 'shift_handover', id, `ho:${id}:rejected`));
    return r[0];
  },
  /** Job: a submitted handover not accepted by its deadline alerts the department manager (once). */
  async alertLate(now: Date = new Date()): Promise<{ alerted: number }> {
    const rows = await query(prisma, `SELECT h.*, o.name AS outgoing FROM shift_handovers h JOIN users o ON o.id = h.outgoing_user_id WHERE h.status = 'SUBMITTED' AND h.late_alerted_at IS NULL AND h.accept_by < $1::timestamptz`, now.toISOString());
    let alerted = 0;
    for (const h of rows) {
      if (!handoverLate(new Date(S(h.accept_by)), now)) continue;
      const dept = (await query(prisma, `SELECT id::text AS id FROM departments WHERE name = $1`, h.department))[0];
      const managers = dept ? (await usersOf(prisma, S(dept.id), S(h.unit_id))).map((u) => u.id) : [];
      await prisma.$transaction(async (tx) => {
        await query(tx, `UPDATE shift_handovers SET late_alerted_at = now() WHERE id = $1::uuid`, h.id);
        await tell(tx, [...managers, S(h.incoming_user_id)], 'handover.late', `Handover from ${S(h.outgoing)} not accepted`, `${S(h.department)} handover was not accepted in time.`, '/m/ops-shift-roster', 'shift_handover', S(h.id), `ho:${S(h.id)}:late`);
      });
      alerted += 1;
    }
    return { alerted };
  },
};

// ================================================================================================ visitors
const hashToken = (t: string): string => createHash('sha256').update(t).digest('hex');
const VIS_SEL = `v.*, h.name AS host, un.code AS unit_code`;
const VIS_FROM = `FROM visitor_passes v JOIN users h ON h.id = v.host_user_id JOIN units un ON un.id = v.unit_id`;

export const visitorService = {
  async create(caller: Caller, b: { visitorName: string; mobile?: string | null; company?: string | null; hostUserId?: string | null; department?: string | null; visitDate: string; plannedIn?: string | null; plannedOut?: string | null; purpose: string; vehicleNo?: string | null; idType?: string | null; idLast4?: string | null; items?: unknown[]; unitId?: string }): Promise<Row> {
    const unitId = unitOf(caller, b.unitId);
    const host = b.hostUserId ?? caller.auth.user.id;
    if (b.plannedIn && b.plannedOut && b.plannedOut <= b.plannedIn) throw Errors.validation({ plannedOut: 'The planned out time must be after the planned in time.' });
    return prisma.$transaction(async (tx) => {
      const no = await NumberingService.next(tx, { docType: 'ops-visitors', unitId, fyId: caller.ctx.fyId });
      const v = (await query(
        tx,
        `INSERT INTO visitor_passes (unit_id, fy_id, pass_no, visitor_name, mobile, company, host_user_id, department, visit_date, planned_in, planned_out, purpose, vehicle_no, id_type, id_last4, items, created_by_id)
         VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7::uuid,$8,$9::date,$10::timestamptz,$11::timestamptz,$12,$13,$14,$15,$16::jsonb,$17::uuid) RETURNING *`,
        unitId, caller.ctx.fyId, no, b.visitorName, b.mobile ?? null, b.company ?? null, host, b.department ?? null, b.visitDate, b.plannedIn ?? null, b.plannedOut ?? null, b.purpose, b.vehicleNo ?? null, b.idType ?? null, b.idLast4 ?? null, JSON.stringify(b.items ?? []), caller.auth.user.id,
      ))[0]!;
      // a host who made the pass needs no approval; a gate registration asks the host (push)
      if (host === caller.auth.user.id) {
        await query(tx, `UPDATE visitor_passes SET status = 'APPROVED', approved_by_id = $2::uuid, approved_at = now() WHERE id = $1::uuid`, v.id, host);
      } else {
        await tell(tx, [host], 'visitor.approval', `${b.visitorName} wants to meet you`, `${b.purpose}. Approve or reject the visit.`, '/m/ops-visitors', 'visitor_pass', S(v.id), `vis:${S(v.id)}:approval`);
      }
      await recordAudit({ action: 'visitor.registered', actorId: caller.auth.user.id, targetType: 'visitor_pass', targetId: S(v.id), detail: { passNo: no } }, tx);
      return (await query(tx, `SELECT ${VIS_SEL} ${VIS_FROM} WHERE v.id = $1::uuid`, v.id))[0]!;
    });
  },
  async get(caller: Caller, id: string): Promise<Row> {
    const v = (await query(prisma, `SELECT ${VIS_SEL} ${VIS_FROM} WHERE v.id = $1::uuid`, id))[0];
    if (!v || !caller.ctx.unitIds.includes(S(v.unit_id))) throw Errors.notFound('Visitor pass not found.');
    return v;
  },
  async list(caller: Caller, f: { status?: string; date?: string; q?: string }): Promise<Row[]> {
    return query(prisma, `SELECT ${VIS_SEL} ${VIS_FROM} WHERE v.unit_id = ANY($1::uuid[]) AND ($2::text IS NULL OR v.status = $2) AND ($3::date IS NULL OR v.visit_date = $3::date) AND ($4::text IS NULL OR v.pass_no ILIKE $4 OR v.visitor_name ILIKE $4) ORDER BY v.visit_date DESC, v.created_at DESC LIMIT 200`, caller.ctx.unitIds, f.status ?? null, f.date ?? null, f.q ? `%${f.q}%` : null);
  },
  async inside(caller: Caller, now: Date = new Date()): Promise<Row[]> {
    const rows = await query(prisma, `SELECT ${VIS_SEL} ${VIS_FROM} WHERE v.unit_id = ANY($1::uuid[]) AND v.status = 'INSIDE' ORDER BY v.in_time`, caller.ctx.unitIds);
    return rows.map((r) => ({ ...r, minutes_inside: Math.round((now.getTime() - new Date(S(r.in_time)).getTime()) / 60_000), overstay: overstayed(r.planned_out ? new Date(S(r.planned_out)) : null, now) }));
  },
  async decide(caller: Caller, id: string, approve: boolean): Promise<Row> {
    const v = await visitorService.get(caller, id);
    if (S(v.host_user_id) !== caller.auth.user.id && !isElevated(caller)) throw Errors.forbidden('Only the host can decide this visit.');
    const r = await query(prisma, `UPDATE visitor_passes SET status = $2, approved_by_id = $3::uuid, approved_at = now() WHERE id = $1::uuid AND status = 'PRE_REGISTERED' RETURNING *`, id, approve ? 'APPROVED' : 'REJECTED', caller.auth.user.id);
    if (!r[0]) throw Errors.conflict('This visit was already decided.');
    return visitorService.get(caller, id);
  },
  /** The QR token is shown once on the pass; only its hash is stored. */
  async issueQr(caller: Caller, id: string): Promise<{ token: string }> {
    const v = await visitorService.get(caller, id);
    if (!['APPROVED', 'INSIDE'].includes(S(v.status))) throw Errors.conflict(`${S(v.host)} has not approved this visit yet.`);
    const token = randomBytes(18).toString('hex');
    await query(prisma, `UPDATE visitor_passes SET qr_token_hash = $2 WHERE id = $1::uuid`, id, hashToken(token));
    return { token };
  },
  /** Gate check-in by pass id or by the QR token. */
  async checkIn(caller: Caller, f: { id?: string; token?: string; idLast4?: string | null; vehicleNo?: string | null }, now: Date = new Date()): Promise<Row> {
    const v = f.token
      ? (await query(prisma, `SELECT ${VIS_SEL} ${VIS_FROM} WHERE v.qr_token_hash = $1`, hashToken(f.token)))[0]
      : f.id ? (await query(prisma, `SELECT ${VIS_SEL} ${VIS_FROM} WHERE v.id = $1::uuid`, f.id))[0] : null;
    if (!v || !caller.ctx.unitIds.includes(S(v.unit_id))) throw Errors.notFound('Visitor pass not found.');
    if (S(v.status) === 'PRE_REGISTERED') throw Errors.conflict(`${S(v.host)} has not approved this visit yet.`);
    if (S(v.status) === 'INSIDE') throw Errors.conflict('This visitor is already inside.');
    if (S(v.status) !== 'APPROVED') throw Errors.conflict(`This pass is ${S(v.status).toLowerCase()}.`);
    if (d10(v.visit_date) !== todayIst(now)) throw Errors.conflict(`This pass is for ${d10(v.visit_date)}, not today.`);
    const r = await query(prisma, `UPDATE visitor_passes SET status = 'INSIDE', in_time = $2::timestamptz, id_last4 = coalesce($3, id_last4), vehicle_no = coalesce($4, vehicle_no) WHERE id = $1::uuid AND status = 'APPROVED' RETURNING id`, v.id, now.toISOString(), f.idLast4 ?? null, f.vehicleNo ?? null);
    if (!r[0]) throw Errors.conflict('This visitor is already inside.');
    await prisma.$transaction(async (tx) => tell(tx, [S(v.host_user_id)], 'visitor.arrived', `${S(v.visitor_name)} has arrived`, `Pass ${S(v.pass_no)} is checked in at the gate.`, '/m/ops-visitors', 'visitor_pass', S(v.id), `vis:${S(v.id)}:arrived`));
    return visitorService.get(caller, S(v.id));
  },
  async checkOut(caller: Caller, id: string, now: Date = new Date()): Promise<Row> {
    await visitorService.get(caller, id);
    const r = await query(prisma, `UPDATE visitor_passes SET status = 'OUT', out_time = $2::timestamptz WHERE id = $1::uuid AND status = 'INSIDE' RETURNING id`, id, now.toISOString());
    if (!r[0]) throw Errors.conflict('This visitor is not inside.');
    return visitorService.get(caller, id);
  },
  /** Job: still inside 30 minutes after the planned out time alerts the host and security (once). */
  async alertOverstay(now: Date = new Date()): Promise<{ alerted: number }> {
    const rows = await query(prisma, `SELECT * FROM visitor_passes WHERE status = 'INSIDE' AND planned_out IS NOT NULL AND overstay_alerted_at IS NULL`);
    let alerted = 0;
    for (const v of rows) {
      if (!overstayed(new Date(S(v.planned_out)), now)) continue;
      const sec = (await query(prisma, `SELECT id::text AS id FROM departments WHERE name = 'Security'`))[0];
      const guards = sec ? (await usersOf(prisma, S(sec.id), S(v.unit_id))).map((u) => u.id) : [];
      await prisma.$transaction(async (tx) => {
        await query(tx, `UPDATE visitor_passes SET overstay_alerted_at = now() WHERE id = $1::uuid`, v.id);
        await tell(tx, [S(v.host_user_id), ...guards], 'visitor.overstay', `${S(v.visitor_name)} has overstayed`, `Planned out ${S(v.planned_out)}. Pass ${S(v.pass_no)}.`, '/m/ops-visitors', 'visitor_pass', S(v.id), `vis:${S(v.id)}:overstay`);
      });
      alerted += 1;
    }
    return { alerted };
  },
  /** Job: visits older than one year lose their personal details (DPDP); the pass number stays. */
  async anonymise(now: Date = new Date()): Promise<{ anonymised: number }> {
    const rows = await query(prisma, `SELECT id, coalesce(out_time, created_at) AS at FROM visitor_passes WHERE anonymised_at IS NULL AND status IN ('OUT','REJECTED','NO_SHOW','CANCELLED') AND coalesce(out_time, created_at) < $1::timestamptz`, new Date(now.getTime() - 365 * 86_400_000).toISOString());
    let n = 0;
    for (const r of rows) {
      if (!anonymiseDue(new Date(S(r.at)), now)) continue;
      await query(prisma, `UPDATE visitor_passes SET visitor_name = 'Anonymised', mobile = NULL, company = NULL, id_type = NULL, id_last4 = NULL, vehicle_no = NULL, photo_document_id = NULL, qr_token_hash = NULL, anonymised_at = now() WHERE id = $1::uuid`, r.id);
      n += 1;
    }
    return { anonymised: n };
  },
  /** Visitors still waiting past the visit day become NO_SHOW. */
  async markNoShow(now: Date = new Date()): Promise<number> {
    const r = await query(prisma, `UPDATE visitor_passes SET status = 'NO_SHOW' WHERE status IN ('PRE_REGISTERED','APPROVED') AND visit_date < $1::date RETURNING id`, todayIst(now));
    return r.length;
  },
};

// ================================================================================================ canteen
async function rateFor(unitId: string, meal: string, date: string): Promise<Row | null> {
  return (await query(prisma, `SELECT * FROM canteen_rates WHERE unit_id = $1::uuid AND meal_type = $2 AND effective_from <= $3::date ORDER BY effective_from DESC LIMIT 1`, unitId, meal, date))[0] ?? null;
}
const hhmmIst = (d: Date): string => new Date(d.getTime() + 330 * 60_000).toISOString().slice(11, 16);

export const canteenService = {
  async rates(caller: Caller): Promise<Row[]> {
    return query(prisma, `SELECT r.*, u.code AS unit_code, m.name AS meal FROM canteen_rates r JOIN units u ON u.id = r.unit_id JOIN canteen_meal_types m ON m.code = r.meal_type WHERE r.unit_id = ANY($1::uuid[]) ORDER BY u.code, m.sort, r.effective_from DESC`, caller.ctx.unitIds);
  },
  async setRate(caller: Caller, b: { unitId?: string; mealType: string; rate: number; gstPct?: number; employeeSharePct?: number; effectiveFrom?: string }): Promise<Row> {
    const unitId = unitOf(caller, b.unitId);
    const r = await query(
      prisma,
      `INSERT INTO canteen_rates (unit_id, meal_type, rate, gst_pct, employee_share_pct, effective_from, created_by_id) VALUES ($1::uuid,$2,$3,$4,$5,COALESCE($6::date, CURRENT_DATE),$7::uuid)
       ON CONFLICT (unit_id, meal_type, effective_from) DO UPDATE SET rate = EXCLUDED.rate, gst_pct = EXCLUDED.gst_pct, employee_share_pct = EXCLUDED.employee_share_pct RETURNING *`,
      unitId, b.mealType, b.rate, b.gstPct ?? 5, b.employeeSharePct ?? 40, b.effectiveFrom ?? null, caller.auth.user.id,
    ).catch((e: { meta?: { code?: string } }) => { if (e.meta?.code === '23503') throw Errors.validation({ mealType: 'Unknown meal type.' }); throw e; });
    await recordAudit({ action: 'canteen.rate_set', actorId: caller.auth.user.id, targetType: 'canteen_rate', targetId: S(r[0]!.id), detail: { meal: b.mealType, rate: b.rate } });
    return r[0]!;
  },
  async entitlements(caller: Caller): Promise<Row[]> {
    return query(prisma, `SELECT e.unit_id, e.shift_id, e.meal_type, s.code AS shift, u.code AS unit_code FROM canteen_entitlements e JOIN shifts s ON s.id = e.shift_id JOIN units u ON u.id = e.unit_id WHERE e.unit_id = ANY($1::uuid[]) ORDER BY u.code, s.code, e.meal_type`, caller.ctx.unitIds);
  },
  async setEntitlement(caller: Caller, b: { unitId?: string; shiftId: string; mealType: string; on: boolean }): Promise<{ ok: true }> {
    const unitId = unitOf(caller, b.unitId);
    if (b.on) await query(prisma, `INSERT INTO canteen_entitlements (unit_id, shift_id, meal_type) VALUES ($1::uuid,$2::uuid,$3) ON CONFLICT DO NOTHING`, unitId, b.shiftId, b.mealType);
    else await query(prisma, `DELETE FROM canteen_entitlements WHERE unit_id = $1::uuid AND shift_id = $2::uuid AND meal_type = $3`, unitId, b.shiftId, b.mealType);
    return { ok: true };
  },

  /** Counter scan: one meal of a type per person per day unless an extra coupon is allowed. */
  async scan(caller: Caller, b: { code: string; mealType: string; extra?: boolean; unitId?: string }, now: Date = new Date()): Promise<Row> {
    const unitId = unitOf(caller, b.unitId);
    const date = todayIst(now);
    const month = date.slice(0, 7);
    const mth = (await query(prisma, `SELECT status FROM canteen_months WHERE unit_id = $1::uuid AND month = $2`, unitId, month))[0];
    if (mth?.status === 'CLOSED') throw Errors.conflict(`${monthName(month)} canteen is closed.`);
    const emp = (await query(prisma, `SELECT e.id, e.emp_code, trim(concat(e.first_name,' ',e.last_name)) AS name FROM employees e WHERE e.emp_code = $1 AND e.status != 'SEPARATED' AND e.deleted_at IS NULL`, b.code.trim()))[0];
    if (!emp) throw Errors.validation({ code: `No active employee has the code ${b.code}.` });
    const asg = (await query(prisma, `SELECT unit_id FROM employee_assignments WHERE employee_id = $1::uuid AND effective_from <= $2::date AND (effective_to IS NULL OR effective_to >= $2::date) ORDER BY effective_from DESC LIMIT 1`, emp.id, date))[0];
    if (!asg || S(asg.unit_id) !== unitId) throw Errors.validation({ code: `${S(emp.name)} does not work in this plant.` });
    // entitlement by shift (the roster of today, else the general shift)
    const shift = (await query(prisma, `SELECT s.id, s.code FROM shifts s WHERE s.id = coalesce((SELECT r.shift_id FROM shift_rosters r WHERE r.employee_id = $1::uuid AND r.roster_date = $2::date AND NOT r.is_off), (SELECT id FROM shifts WHERE code = 'GEN' LIMIT 1))`, emp.id, date))[0];
    const ent = shift ? (await query(prisma, `SELECT 1 FROM canteen_entitlements WHERE unit_id = $1::uuid AND shift_id = $2::uuid AND meal_type = $3`, unitId, shift.id, b.mealType))[0] : null;
    const meal = (await query(prisma, `SELECT name FROM canteen_meal_types WHERE code = $1`, b.mealType))[0];
    if (!meal) throw Errors.validation({ mealType: 'Unknown meal type.' });
    if (!ent) throw Errors.conflict(`No ${S(meal.name).toLowerCase()} entitlement for shift ${S(shift?.code ?? '—')}.`);
    const rate = await rateFor(unitId, b.mealType, date);
    if (!rate) throw Errors.conflict(`No rate is set for ${S(meal.name).toLowerCase()}. Ask HR.`);
    const done = await query(prisma, `SELECT served_at, seq FROM canteen_coupons WHERE person_kind = 'EMPLOYEE' AND person_id = $1::uuid AND date = $2::date AND meal_type = $3 AND status = 'SERVED' ORDER BY seq DESC`, emp.id, date, b.mealType);
    if (done.length > 0 && !b.extra) throw Errors.conflict(`Already served ${S(meal.name).toLowerCase()} today at ${hhmmIst(new Date(S(done[0]!.served_at)))}.`);
    const money = mealMoney(N(rate.rate), N(rate.gst_pct), N(rate.employee_share_pct));
    return prisma.$transaction(async (tx) => {
      const no = await NumberingService.next(tx, { docType: 'ops-canteen', unitId, fyId: caller.ctx.fyId });
      const c = (await query(
        tx,
        `INSERT INTO canteen_coupons (unit_id, coupon_no, person_kind, person_id, person_name, date, meal_type, seq, rate, gst, total, employee_share, company_share, served_at, served_by_id)
         VALUES ($1::uuid,$2,'EMPLOYEE',$3::uuid,$4,$5::date,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz,$14::uuid) RETURNING *`,
        unitId, no, emp.id, emp.name, date, b.mealType, done.length + 1, money.rate, money.gst, money.total, money.employee, money.company, now.toISOString(), caller.auth.user.id,
      ))[0]!;
      return { ...c, meal: S(meal.name), shift: S(shift?.code ?? '') };
    }).catch((e: { meta?: { code?: string } }) => {
      if (e.meta?.code === '23505') throw Errors.conflict(`Already served ${S(meal.name).toLowerCase()} today.`);
      throw e;
    });
  },

  async today(caller: Caller, unit?: string): Promise<{ last: Row[]; counts: Row[] }> {
    const units = unit ? [unitOf(caller, unit)] : caller.ctx.unitIds;
    const date = todayIst();
    return {
      last: await query(prisma, `SELECT coupon_no, person_name, meal_type, served_at FROM canteen_coupons WHERE unit_id = ANY($1::uuid[]) AND date = $2::date AND status = 'SERVED' ORDER BY served_at DESC LIMIT 5`, units, date),
      counts: await query(prisma, `SELECT meal_type, count(*)::int AS n FROM canteen_coupons WHERE unit_id = ANY($1::uuid[]) AND date = $2::date AND status = 'SERVED' GROUP BY 1 ORDER BY 1`, units, date),
    };
  },
  async register(caller: Caller, f: { month?: string; date?: string; q?: string }): Promise<Row[]> {
    return query(prisma, `SELECT c.*, u.code AS unit_code FROM canteen_coupons c JOIN units u ON u.id = c.unit_id WHERE c.unit_id = ANY($1::uuid[]) AND ($2::text IS NULL OR to_char(c.date,'YYYY-MM') = $2) AND ($3::date IS NULL OR c.date = $3::date) AND ($4::text IS NULL OR c.person_name ILIKE $4 OR c.coupon_no ILIKE $4) ORDER BY c.served_at DESC LIMIT 300`, caller.ctx.unitIds, f.month ?? null, f.date ?? null, f.q ? `%${f.q}%` : null);
  },
  /** Cost per department for a month (the employee share and the company share). */
  async departmentCost(caller: Caller, month: string): Promise<Row[]> {
    return query(
      prisma,
      `SELECT coalesce(a.department, 'No department') AS department, count(*)::int AS meals, sum(c.total)::numeric(12,2) AS total, sum(c.employee_share)::numeric(12,2) AS employee_share, sum(c.company_share)::numeric(12,2) AS company_share
         FROM canteen_coupons c LEFT JOIN employee_assignments a ON a.employee_id = c.person_id AND a.effective_from <= c.date AND (a.effective_to IS NULL OR a.effective_to >= c.date)
        WHERE c.unit_id = ANY($1::uuid[]) AND to_char(c.date,'YYYY-MM') = $2 AND c.status = 'SERVED' GROUP BY 1 ORDER BY 1`,
      caller.ctx.unitIds, month,
    );
  },
  async addWaste(caller: Caller, b: { unitId?: string; date: string; mealType: string; kg: number; reason?: string | null }): Promise<Row> {
    const unitId = unitOf(caller, b.unitId);
    return (await query(prisma, `INSERT INTO canteen_waste (unit_id, date, meal_type, kg, reason, created_by_id) VALUES ($1::uuid,$2::date,$3,$4,$5,$6::uuid) RETURNING *`, unitId, b.date, b.mealType, b.kg, b.reason ?? null, caller.auth.user.id))[0]!;
  },

  /** Month close: totals, the payroll deduction (read by the payroll run as CANTEEN_DED) and the GL journal. */
  async closeMonth(caller: Caller, month: string, unitIdIn?: string): Promise<Row> {
    const unitId = unitOf(caller, unitIdIn);
    const cur = (await query(prisma, `SELECT status FROM canteen_months WHERE unit_id = $1::uuid AND month = $2`, unitId, month))[0];
    if (cur?.status === 'CLOSED') throw Errors.conflict(`${monthName(month)} canteen is already closed.`);
    const sum = (await query(prisma, `SELECT count(*)::int AS meals, coalesce(sum(employee_share) FILTER (WHERE payment_mode = 'PAYROLL'),0)::numeric(12,2) AS emp, coalesce(sum(company_share),0)::numeric(12,2) AS comp, coalesce(sum(total),0)::numeric(12,2) AS total FROM canteen_coupons WHERE unit_id = $1::uuid AND to_char(date,'YYYY-MM') = $2 AND status = 'SERVED'`, unitId, month))[0]!;
    return prisma.$transaction(async (tx) => {
      let journalId: string | null = null;
      if (N(sum.total) > 0) {
        const lines = [
          { accountCode: '6103', debit: N(sum.comp).toFixed(2), credit: '0.00', unitId, narration: `Canteen company share ${month}` },
          { accountCode: '1502', debit: N(sum.emp).toFixed(2), credit: '0.00', unitId, narration: `Canteen recovery through payroll ${month}` },
          { accountCode: '2103', debit: '0.00', credit: N(sum.total).toFixed(2), unitId, narration: `Canteen payable ${month}` },
        ].filter((l) => N(l.debit) > 0 || N(l.credit) > 0);
        const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
        const docDate = last > todayIst() ? todayIst() : last; // a journal cannot be dated in the future
        const posted = await PostingService.postJournal(tx, { unitId, docDate, voucherType: 'Journal', source: 'SYSTEM', narration: `Canteen ${month}`, sourceDocType: 'CANTEEN_MONTH', sourceDocId: unitId, sourceDocNo: `CANTEEN/${month}`, lines } as never, { userId: caller.auth.userId });
        journalId = S((posted as { id: string }).id);
      }
      await query(tx, `INSERT INTO canteen_months (unit_id, month, status, meals, employee_total, company_total, closed_at, closed_by_id) VALUES ($1::uuid,$2,'CLOSED',$3,$4,$5,now(),$6::uuid) ON CONFLICT (unit_id, month) DO UPDATE SET status = 'CLOSED', meals = EXCLUDED.meals, employee_total = EXCLUDED.employee_total, company_total = EXCLUDED.company_total, closed_at = now(), closed_by_id = EXCLUDED.closed_by_id`, unitId, month, sum.meals, sum.emp, sum.comp, caller.auth.user.id);
      const hr = (await query(tx, `SELECT u.id::text AS id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.status = 'ACTIVE' AND (u.department IN ('HR','Finance') OR r.level >= 90) AND (EXISTS (SELECT 1 FROM user_units uu WHERE uu.user_id = u.id AND uu.unit_id = $1::uuid) OR r.all_units OR u.all_units_access)`, unitId)).map((r) => S(r.id));
      await tell(tx, hr, 'canteen.closed', `${monthName(month)} canteen closed`, `${N(sum.meals)} meals. Employee share ₹ ${N(sum.emp).toFixed(2)} goes to payroll; company share ₹ ${N(sum.comp).toFixed(2)}.`, '/m/ops-canteen', 'canteen_month', unitId, `can:${unitId}:${month}`);
      await recordAudit({ action: 'canteen.month_closed', actorId: caller.auth.user.id, targetType: 'unit', targetId: unitId, detail: { month, meals: N(sum.meals), employee: N(sum.emp), company: N(sum.comp), journalId } }, tx);
      return { unitId, month, status: 'CLOSED', meals: N(sum.meals), employeeTotal: N(sum.emp), companyTotal: N(sum.comp), total: N(sum.total), journalId };
    });
  },
  async months(caller: Caller): Promise<Row[]> {
    return query(prisma, `SELECT m.*, u.code AS unit_code FROM canteen_months m JOIN units u ON u.id = m.unit_id WHERE m.unit_id = ANY($1::uuid[]) ORDER BY m.month DESC, u.code`, caller.ctx.unitIds);
  },

  async addVendorBill(caller: Caller, b: { unitId?: string; month: string; vendorName?: string | null; supplierId?: string | null; mealsBilled: number }): Promise<Row> {
    const unitId = unitOf(caller, b.unitId);
    const served = N((await query(prisma, `SELECT count(*)::int AS n FROM canteen_coupons WHERE unit_id = $1::uuid AND to_char(date,'YYYY-MM') = $2 AND status = 'SERVED'`, unitId, b.month))[0]!.n);
    const v = vendorVariance(b.mealsBilled, served);
    return (await query(prisma, `INSERT INTO canteen_vendor_bills (unit_id, month, supplier_id, vendor_name, meals_billed, meals_served, variance_pct, needs_approval, status, created_by_id) VALUES ($1::uuid,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10::uuid) RETURNING *`, unitId, b.month, b.supplierId ?? null, b.vendorName ?? null, b.mealsBilled, served, v.pct, v.needsApproval, v.needsApproval ? 'PENDING_APPROVAL' : 'OK', caller.auth.user.id))[0]!;
  },
  async vendorBills(caller: Caller): Promise<Row[]> {
    return query(prisma, `SELECT b.*, u.code AS unit_code FROM canteen_vendor_bills b JOIN units u ON u.id = b.unit_id WHERE b.unit_id = ANY($1::uuid[]) ORDER BY b.created_at DESC LIMIT 100`, caller.ctx.unitIds);
  },
  async approveVendorBill(caller: Caller, id: string): Promise<Row> {
    const b = (await query(prisma, `SELECT * FROM canteen_vendor_bills WHERE id = $1::uuid`, id))[0];
    if (!b || !caller.ctx.unitIds.includes(S(b.unit_id))) throw Errors.notFound('Vendor bill not found.');
    if (S(b.created_by_id) === caller.auth.user.id) throw Errors.forbidden('The person who entered the bill cannot approve it.');
    const r = await query(prisma, `UPDATE canteen_vendor_bills SET status = 'APPROVED', approved_by_id = $2::uuid, approved_at = now() WHERE id = $1::uuid AND status = 'PENDING_APPROVAL' RETURNING *`, id, caller.auth.user.id);
    if (!r[0]) throw Errors.conflict('This bill does not need approval or was already approved.');
    return r[0];
  },
};

export { accessUserOf, isOverdue, logger };
