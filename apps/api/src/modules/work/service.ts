// Phase 25: Department Work Movement engine. A record travels between departments with a full handover trail:
// SENT -> RECEIVED -> ACCEPTED -> (works) -> FORWARDED / COMPLETED / RETURNED. Every action is one transaction that
// locks the document's open movement first, so two people moving the same record cannot both win (the second gets 409).
// Only the department holding a record may edit it (assertNotRoutedAway). Nothing forwards automatically (R-31).
import { recordAudit } from '../../core/audit/audit-service';
import { NumberingService } from '../../core/numbering/numbering-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { ADMIN_LEVEL } from '../../core/rbac/role-rules';
import { accessUserOf } from '../../core/rbac/access';
import { query } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { notificationService } from '../notifications/service';
import {
  ACTOR_SIDE,
  V18_NEXT,
  addWorkingDays,
  isOpen,
  lateLevel,
  nextState,
  type MovementAction,
} from './calc';

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export interface ForwardInput {
  /** Owner / Admin only: the department that is handing over, when they have no department of their own. */
  fromDepartmentId?: string | null;
  docType: string;
  docId: string;
  docNo?: string;
  toDepartmentId: string;
  assignedManagerId?: string | null;
  routeType?: string;
  priority?: 'Normal' | 'High' | 'Critical';
  requiredBy?: string | null;
  workStatus?: string;
  handoverNote?: string | null;
  toUnitId?: string | null;
  isPhysical?: boolean;
  lines?: { itemId?: string | null; description?: string | null; qty: number; uom?: string | null; batch?: string | null; fromLocation?: string | null; toLocation?: string | null }[];
}

const sel = (alias = 'm') => `
  ${alias}.id::text AS id, ${alias}.number, ${alias}.unit_id::text AS unit_id, ${alias}.to_unit_id::text AS to_unit_id,
  ${alias}.doc_type, ${alias}.doc_id::text AS doc_id, ${alias}.doc_no,
  ${alias}.from_department_id::text AS from_department_id, fd.name AS from_department,
  ${alias}.to_department_id::text AS to_department_id, td.name AS to_department,
  ${alias}.assigned_manager_id::text AS assigned_manager_id, am.name AS assigned_manager,
  ${alias}.route_type, ${alias}.priority, ${alias}.required_by::text AS required_by, ${alias}.work_status,
  ${alias}.handover_note, ${alias}.state, ${alias}.sent_at, ${alias}.received_at, ${alias}.accepted_at,
  ${alias}.completed_at, ${alias}.returned_at, ${alias}.return_reason, ${alias}.sla_due_at,
  (${alias}.late OR (${alias}.sla_due_at IS NOT NULL AND ${alias}.sla_due_at < now()
     AND ${alias}.state IN ('SENT','RECEIVED','ACCEPTED','IN_WORK','WAITING_APPROVAL'))) AS is_late,
  ${alias}.is_physical, ${alias}.version, sb.name AS sent_by, rb.name AS received_by, ab.name AS accepted_by`;
const FROM = `
  FROM work_movements m
  JOIN departments fd ON fd.id = m.from_department_id
  JOIN departments td ON td.id = m.to_department_id
  LEFT JOIN users am ON am.id = m.assigned_manager_id
  LEFT JOIN users sb ON sb.id = m.sent_by_id
  LEFT JOIN users rb ON rb.id = m.received_by_id
  LEFT JOIN users ab ON ab.id = m.accepted_by_id`;

/** Departments (ids) the user belongs to: the home department plus the extra ones. */
async function myDepartmentIds(caller: Caller, db: Tx | typeof prisma = prisma): Promise<string[]> {
  const names = accessUserOf(caller.auth.user).departments;
  if (names.length === 0) return [];
  const rows = await query(db, `SELECT id::text AS id FROM departments WHERE name = ANY($1::text[])`, names);
  return rows.map((r) => String(r.id));
}

export function isElevated(caller: Caller): boolean {
  const u = accessUserOf(caller.auth.user);
  return u.allUnits || u.level >= ADMIN_LEVEL;
}

async function holidaySet(db: Tx | typeof prisma, unitId: string, from: Date): Promise<Set<string>> {
  const rows = await query(
    db,
    `SELECT h.holiday_date::text AS d FROM holidays h JOIN holiday_calendars c ON c.id = h.calendar_id
      WHERE c.unit_id = $1::uuid AND h.holiday_date BETWEEN $2::date AND ($2::date + 90)`,
    unitId,
    from.toISOString().slice(0, 10),
  );
  return new Set(rows.map((r) => String(r.d)));
}

/** Refreshes the department x plant counters that Home and the dashboards read (same transaction as the change). */
async function refreshCounters(tx: Tx, departmentIds: string[], unitIds: (string | null)[]): Promise<void> {
  const depts = [...new Set(departmentIds)];
  const units = [...new Set(unitIds.filter((u): u is string => !!u))];
  for (const d of depts) {
    for (const u of units) {
      await tx.$executeRaw`
        INSERT INTO dept_work_counters (department_id, unit_id, receipt, accept, work, updated_at)
        SELECT ${d}::uuid, ${u}::uuid,
               count(*) FILTER (WHERE state = 'SENT'),
               count(*) FILTER (WHERE state = 'RECEIVED'),
               count(*) FILTER (WHERE state IN ('ACCEPTED','IN_WORK','WAITING_APPROVAL')),
               now()
          FROM work_movements WHERE to_department_id = ${d}::uuid AND (unit_id = ${u}::uuid OR to_unit_id = ${u}::uuid)
        ON CONFLICT (department_id, unit_id) DO UPDATE
          SET receipt = EXCLUDED.receipt, accept = EXCLUDED.accept, work = EXCLUDED.work, updated_at = now()`;
    }
  }
}

async function event(
  tx: Tx,
  m: { id: string; doc_type: string; doc_id: string },
  ev: string,
  from: string | null,
  to: string | null,
  departmentId: string | null,
  actorId: string,
  note?: string | null,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO movement_events (movement_id, doc_type, doc_id, event, from_state, to_state, department_id, actor_id, note)
    VALUES (${m.id}::uuid, ${m.doc_type}, ${m.doc_id}::uuid, ${ev}, ${from}, ${to}, ${departmentId}::uuid, ${actorId}::uuid, ${note ?? null})`;
}

/** Active users of a department who can work in the plant (their plants include it, or they have every plant). */
async function usersOf(db: Tx | typeof prisma, departmentId: string, unitId: string): Promise<{ id: string; name: string }[]> {
  const rows = await query(
    db,
    `SELECT u.id::text AS id, u.name FROM users u
       JOIN departments d ON d.id = $1::uuid
      WHERE u.status = 'ACTIVE'
        AND (u.department = d.name OR EXISTS (SELECT 1 FROM user_departments ud WHERE ud.user_id = u.id AND ud.department_name = d.name))
        AND (EXISTS (SELECT 1 FROM user_units uu WHERE uu.user_id = u.id AND uu.unit_id = $2::uuid)
             OR EXISTS (SELECT 1 FROM roles r WHERE r.id = u.role_id AND r.all_units) OR u.all_units_access)
      ORDER BY u.name`,
    departmentId,
    unitId,
  );
  return rows.map((r) => ({ id: String(r.id), name: String(r.name) }));
}

async function notifyDept(
  tx: Tx,
  userIds: string[],
  type: 'work.sent' | 'work.returned' | 'work.late' | 'work.accepted',
  title: string,
  body: string,
  movementId: string,
  dedupe: string,
): Promise<void> {
  if (userIds.length === 0) return;
  await notificationService.notify(tx, userIds, {
    type,
    title,
    body,
    link: '/m/dept-inbox',
    entityType: 'work_movement',
    entityId: movementId,
    dedupeKey: dedupe,
  });
}

async function loadLocked(tx: Tx, id: string): Promise<Row> {
  const rows = await query(tx, `SELECT * FROM work_movements WHERE id = $1::uuid FOR UPDATE`, id);
  if (!rows[0]) throw Errors.notFound('Movement not found.');
  return rows[0];
}

export const workService = {
  // -------------------------------------------------------------------------------------------- Move Forward
  async forward(caller: Caller, input: ForwardInput): Promise<Row> {
    const user = caller.auth.user;
    const mine = await myDepartmentIds(caller);
    const elevated = isElevated(caller);
    return prisma.$transaction(async (tx) => {
      // 1. lock the document's open movement (the partial unique index also stops a second open one)
      const open = (
        await query(
          tx,
          `SELECT * FROM work_movements WHERE doc_type = $1 AND doc_id = $2::uuid
             AND state IN ('SENT','RECEIVED','ACCEPTED','IN_WORK','WAITING_APPROVAL') FOR UPDATE`,
          input.docType,
          input.docId,
        )
      )[0];

      const rule = (await query(tx, `SELECT * FROM workflow_rules WHERE module_id = $1 AND active`, input.docType))[0];
      const record = (
        await query(tx, `SELECT unit_id::text AS unit_id, department, data FROM generic_records WHERE id = $1::uuid`, input.docId)
      )[0];
      const unitId = String(record?.unit_id ?? open?.unit_id ?? caller.ctx.unitId ?? '');
      if (!unitId) throw Errors.contextInvalid('Choose a plant first.');
      if (!elevated && !caller.ctx.unitIds.includes(unitId)) throw Errors.unitNotAllowed('that plant');

      // 2. who is handing over?
      let fromDept: string;
      if (open) {
        if (!isOpen(String(open.state))) throw Errors.conflict('This record is not open.');
        if (!['ACCEPTED', 'IN_WORK'].includes(String(open.state))) {
          const holder = (await query(tx, `SELECT name FROM departments WHERE id = $1::uuid`, open.to_department_id))[0];
          throw Errors.conflict(`This record is with ${String(holder?.name)}. Only they can move it.`);
        }
        if (!elevated && !mine.includes(String(open.to_department_id))) {
          const holder = (await query(tx, `SELECT name FROM departments WHERE id = $1::uuid`, open.to_department_id))[0];
          throw Errors.forbidden(`This record is with ${String(holder?.name)}. Only they can move it.`);
        }
        fromDept = String(open.to_department_id);
      } else {
        const owner = rule?.owner_department_id ? String(rule.owner_department_id) : null;
        const home = mine[0] ?? null;
        const recordDept = record?.department
          ? String((await query(tx, `SELECT id::text AS id FROM departments WHERE name = $1`, record.department))[0]?.id ?? '')
          : '';
        const holder = owner && mine.includes(owner) ? owner : recordDept && mine.includes(recordDept) ? recordDept : null;
        if (!holder && !elevated) {
          throw Errors.forbidden('Only the department that owns this record can send it on.');
        }
        fromDept = (elevated ? input.fromDepartmentId : null) ?? holder ?? owner ?? home ?? '';
        if (!fromDept) throw Errors.validation({ fromDepartment: 'Choose the department that is sending this.' });
      }

      // 3. checks
      if (input.toDepartmentId === fromDept) {
        throw Errors.validation({ toDepartmentId: 'Select a different next department' });
      }
      const toDept = (await query(tx, `SELECT id::text AS id, name FROM departments WHERE id = $1::uuid`, input.toDepartmentId))[0];
      if (!toDept) throw Errors.validation({ toDepartmentId: 'Choose a department from the list.' });
      const targetUnit = input.toUnitId ?? unitId;
      const targets = await usersOf(tx, input.toDepartmentId, targetUnit);
      const unitName = String((await query(tx, `SELECT name FROM units WHERE id = $1::uuid`, targetUnit))[0]?.name ?? 'that plant');
      if (targets.length === 0) throw Errors.validation({ toDepartmentId: `${String(toDept.name)} has no active user in ${unitName}. Ask Admin.` });
      if (input.assignedManagerId && !targets.some((t) => t.id === input.assignedManagerId)) {
        throw Errors.validation({ assignedManagerId: `Choose a person from ${String(toDept.name)} who works in ${unitName}.` });
      }
      const requiredFields = (rule?.required_fields as string[] | undefined) ?? [];
      const data = (record?.data ?? {}) as Record<string, unknown>;
      for (const f of requiredFields) {
        const v = data[f];
        if (v === undefined || v === null || String(v).trim() === '') {
          throw Errors.validation({ [f]: `Fill ${f} before moving forward.` });
        }
      }
      const physical = input.isPhysical === true;
      if (physical && (!input.lines || input.lines.length === 0)) {
        throw Errors.validation({ lines: 'Add the items you are sending.' });
      }
      if (physical && input.toUnitId && input.toUnitId === unitId) {
        throw Errors.validation({ toUnitId: 'A plant-to-plant move needs a different plant.' });
      }

      // 4. close the current movement, open the next
      if (open) {
        await tx.$executeRaw`
          UPDATE work_movements SET state = 'FORWARDED', completed_by_id = ${user.id}::uuid, completed_at = now(), version = version + 1
           WHERE id = ${String(open.id)}::uuid`;
        await event(tx, { id: String(open.id), doc_type: input.docType, doc_id: input.docId }, 'FORWARDED', String(open.state), 'FORWARDED', fromDept, user.id);
      }
      const now = new Date();
      const days = Number(rule?.sla_days ?? 2);
      const due = addWorkingDays(now, days, await holidaySet(tx, unitId, now));
      const number = await NumberingService.next(tx, { docType: 'work-movement', unitId, fyId: caller.ctx.fyId });
      const ins = await query(
        tx,
        `INSERT INTO work_movements
           (number, unit_id, to_unit_id, doc_type, doc_id, doc_no, parent_movement_id, from_department_id, to_department_id,
            assigned_manager_id, route_type, priority, required_by, work_status, handover_note, state, sent_by_id,
            sla_due_at, is_physical)
         VALUES ($1, $2::uuid, $3::uuid, $4, $5::uuid, $6, $7::uuid, $8::uuid, $9::uuid, $10::uuid, $11, $12, $13::date, $14, $15,
                 'SENT', $16::uuid, $17::timestamptz, $18)
         RETURNING id::text AS id`,
        number,
        unitId,
        input.toUnitId ?? null,
        input.docType,
        input.docId,
        input.docNo ?? null,
        open ? String(open.id) : null,
        fromDept,
        input.toDepartmentId,
        input.assignedManagerId ?? null,
        input.routeType ?? 'Department Work Handover',
        input.priority ?? 'Normal',
        input.requiredBy ?? null,
        input.workStatus ?? 'Work Required',
        input.handoverNote ?? null,
        user.id,
        due,
        physical,
      );
      const id = String(ins[0]?.id);
      let n = 0;
      for (const l of input.lines ?? []) {
        n += 1;
        await tx.$executeRaw`
          INSERT INTO movement_lines (movement_id, line_no, item_id, description, qty, uom, batch, from_location, to_location)
          VALUES (${id}::uuid, ${n}, ${l.itemId ?? null}::uuid, ${l.description ?? null}, ${l.qty}::numeric, ${l.uom ?? null},
                  ${l.batch ?? null}, ${l.fromLocation ?? null}, ${l.toLocation ?? null})`;
      }
      await event(tx, { id, doc_type: input.docType, doc_id: input.docId }, 'SENT', null, 'SENT', fromDept, user.id, input.handoverNote ?? null);
      await refreshCounters(tx, [fromDept, input.toDepartmentId], [unitId, input.toUnitId ?? null]);
      await recordAudit(
        { action: 'work.sent', actorId: user.id, targetType: 'work_movement', targetId: id, detail: { number, docType: input.docType, docId: input.docId, to: String(toDept.name) } },
        tx,
      );
      const who = input.assignedManagerId ? [input.assignedManagerId] : targets.map((t) => t.id);
      await notifyDept(tx, who, 'work.sent', `${input.docNo ?? input.docType} sent to ${String(toDept.name)}`, `${number}: ${input.handoverNote ?? 'New work for your department.'}`, id, `work:${id}:sent`);
      return (await query(tx, `SELECT ${sel()} ${FROM} WHERE m.id = $1::uuid`, id))[0]!;
    });
  },

  // -------------------------------------------------------------------------------------------- Receive / Accept / Return / Recall / Complete
  async act(
    caller: Caller,
    id: string,
    action: MovementAction,
    body: { reason?: string; lines?: { lineNo: number; receivedQty: number; shortReason?: string }[] } = {},
  ): Promise<Row> {
    const user = caller.auth.user;
    const mine = await myDepartmentIds(caller);
    const elevated = isElevated(caller);
    return prisma.$transaction(async (tx) => {
      const m = await loadLocked(tx, id);
      const state = String(m.state);
      const side = ACTOR_SIDE[action];
      const depId = String(side === 'target' ? m.to_department_id : m.from_department_id);
      const depName = String((await query(tx, `SELECT name FROM departments WHERE id = $1::uuid`, depId))[0]?.name);
      const allowed = elevated || mine.includes(depId) || (side === 'sender' && String(m.sent_by_id) === user.id);
      if (!allowed) {
        throw Errors.forbidden(
          action === 'receive'
            ? `Only ${depName} can mark this Received.`
            : action === 'recall'
              ? 'Only the sender can recall this.'
              : `Only ${depName} can do this.`,
        );
      }
      if (action === 'receive' && state !== 'SENT' && m.received_at) {
        const by = (await query(tx, `SELECT name FROM users WHERE id = $1::uuid`, m.received_by_id))[0];
        throw Errors.conflict(`Already received by ${String(by?.name ?? 'someone')} at ${new Date(String(m.received_at)).toLocaleString('en-IN')}.`);
      }
      const to = nextState(state, action);
      if (!to) throw Errors.conflict(`This movement is ${state.toLowerCase().replace('_', ' ')}; ${action} is not possible now.`);
      if (action === 'return' && (body.reason ?? '').trim().length < 10) {
        throw Errors.validation({ reason: 'Write at least 10 characters for the reason.' });
      }

      // short receipt: every line needs a reason when fewer pieces arrived than were sent
      let shortTotal = 0;
      if (action === 'receive' && body.lines && body.lines.length > 0) {
        for (const l of body.lines) {
          const line = (await query(tx, `SELECT qty::float8 AS qty FROM movement_lines WHERE movement_id = $1::uuid AND line_no = $2`, id, l.lineNo))[0];
          if (!line) throw Errors.validation({ lines: `Line ${l.lineNo} is not on this movement.` });
          const sent = Number(line.qty);
          if (l.receivedQty < 0 || l.receivedQty > sent) throw Errors.validation({ lines: `Line ${l.lineNo}: received quantity must be between 0 and ${sent}.` });
          const short = sent - l.receivedQty;
          if (short > 0 && !(l.shortReason ?? '').trim()) throw Errors.validation({ lines: `Enter a reason for the short quantity (${short}).` });
          shortTotal += short;
          await tx.$executeRaw`
            UPDATE movement_lines SET received_qty = ${l.receivedQty}::numeric, short_qty = ${short}::numeric, short_reason = ${l.shortReason ?? null}
             WHERE movement_id = ${id}::uuid AND line_no = ${l.lineNo}`;
        }
      }

      const col =
        action === 'receive' ? 'received' : action === 'accept' ? 'accepted' : action === 'return' ? 'returned' : action === 'recall' ? 'recalled' : 'completed';
      await tx.$executeRawUnsafe(
        `UPDATE work_movements SET state = $1, ${col}_by_id = $2::uuid, ${col}_at = now(),
                return_reason = CASE WHEN $1 = 'RETURNED' THEN $3 ELSE return_reason END, version = version + 1
          WHERE id = $4::uuid`,
        to,
        user.id,
        body.reason ?? null,
        id,
      );
      const ref = { id, doc_type: String(m.doc_type), doc_id: String(m.doc_id) };
      await event(tx, ref, action.toUpperCase(), state, to, depId, user.id, body.reason ?? (shortTotal > 0 ? `Short receipt ${shortTotal}` : null));
      if (shortTotal > 0) {
        await event(tx, ref, 'SHORT_RECEIPT', to, to, depId, user.id, `Short receipt ${shortTotal} - ${String(m.number)}`);
      }

      const unitId = String(m.unit_id);
      const fromId = String(m.from_department_id);
      const toId = String(m.to_department_id);
      const docName = String(m.doc_no ?? m.doc_type);
      if (action === 'return') {
        // a new SENT movement goes back to the sender; the edit lock goes back with it
        const number = await NumberingService.next(tx, { docType: 'work-movement', unitId, fyId: caller.ctx.fyId });
        const back = await query(
          tx,
          `INSERT INTO work_movements
             (number, unit_id, to_unit_id, doc_type, doc_id, doc_no, parent_movement_id, from_department_id, to_department_id,
              assigned_manager_id, route_type, priority, work_status, handover_note, state, sent_by_id, sla_due_at, is_physical)
           VALUES ($1, $2::uuid, $3::uuid, $4, $5::uuid, $6, $7::uuid, $8::uuid, $9::uuid, $10::uuid, 'Correction', $11, 'Correction Required',
                   $12, 'SENT', $13::uuid, now() + interval '2 days', $14)
           RETURNING id::text AS id`,
          number, unitId, m.to_unit_id ?? null, m.doc_type, m.doc_id, m.doc_no ?? null, id, toId, fromId,
          m.sent_by_id ?? null, m.priority, `Returned: ${body.reason}`, user.id, m.is_physical,
        );
        const backId = String(back[0]?.id);
        await event(tx, { id: backId, doc_type: ref.doc_type, doc_id: ref.doc_id }, 'SENT', null, 'SENT', toId, user.id, `Returned: ${body.reason}`);
        const senderUsers = m.sent_by_id ? [String(m.sent_by_id)] : (await usersOf(tx, fromId, unitId)).map((u) => u.id);
        await notifyDept(tx, senderUsers, 'work.returned', `${docName} returned to you`, `${body.reason ?? ''}`, backId, `work:${backId}:returned`);
      }
      if (action === 'accept' && m.sent_by_id) {
        await notifyDept(tx, [String(m.sent_by_id)], 'work.accepted', `${docName} accepted by ${depName}`, `${String(m.number)} was accepted.`, id, `work:${id}:accepted`);
      }
      await refreshCounters(tx, [fromId, toId], [unitId, m.to_unit_id ? String(m.to_unit_id) : null]);
      await recordAudit({ action: `work.${action}`, actorId: user.id, targetType: 'work_movement', targetId: id, detail: { number: String(m.number), state: to } }, tx);
      return (await query(tx, `SELECT ${sel()} ${FROM} WHERE m.id = $1::uuid`, id))[0]!;
    });
  },

  // -------------------------------------------------------------------------------------------- Reads
  /** Department Inbox. Tabs: receive, accept, work, returned, sent, all. Newest first, 25 per page (keyset). */
  async inbox(
    caller: Caller,
    p: { dept?: string; tab?: string; docType?: string; late?: boolean; q?: string; cursor?: string; limit?: number },
  ) {
    const mine = await myDepartmentIds(caller);
    const dept = p.dept ?? mine[0];
    if (!dept) return { rows: [], nextCursor: null, hasMore: false };
    if (!isElevated(caller) && !mine.includes(dept)) throw Errors.forbidden('You can only open your own department inbox.');
    const limit = Math.min(Math.max(p.limit ?? 25, 1), 100);
    const conds: string[] = [`(m.unit_id = ANY($1::uuid[]) OR m.to_unit_id = ANY($1::uuid[]))`];
    const args: unknown[] = [caller.ctx.unitIds];
    const arg = (v: unknown) => {
      args.push(v);
      return `$${args.length}`;
    };
    const d = arg(dept);
    switch (p.tab ?? 'receive') {
      case 'receive': conds.push(`m.to_department_id = ${d}::uuid AND m.state = 'SENT'`); break;
      case 'accept': conds.push(`m.to_department_id = ${d}::uuid AND m.state = 'RECEIVED'`); break;
      case 'work': conds.push(`m.to_department_id = ${d}::uuid AND m.state IN ('ACCEPTED','IN_WORK','WAITING_APPROVAL')`); break;
      case 'returned': conds.push(`m.from_department_id = ${d}::uuid AND m.state = 'RETURNED'`); break;
      case 'sent': conds.push(`m.from_department_id = ${d}::uuid AND m.state IN ('SENT','RECEIVED','ACCEPTED','IN_WORK','WAITING_APPROVAL')`); break;
      default: conds.push(`(m.to_department_id = ${d}::uuid OR m.from_department_id = ${d}::uuid)`);
    }
    if (p.docType) conds.push(`m.doc_type = ${arg(p.docType)}`);
    if (p.late) conds.push(`m.sla_due_at < now() AND m.state IN ('SENT','RECEIVED','ACCEPTED','IN_WORK','WAITING_APPROVAL')`);
    if (p.q) conds.push(`(m.number ILIKE ${arg(`%${p.q.replace(/[%_\\]/g, '\\$&')}%`)} OR m.doc_no ILIKE ${arg(`%${p.q.replace(/[%_\\]/g, '\\$&')}%`)})`);
    if (p.cursor) {
      const [at, cid] = Buffer.from(p.cursor, 'base64url').toString('utf8').split('|');
      if (!at || !cid) throw Errors.validation({ cursor: 'The list changed, showing the latest.' });
      conds.push(`(m.sent_at, m.id) < (${arg(at)}::timestamptz, ${arg(cid)}::uuid)`);
    }
    const rows = await query(
      prisma,
      `SELECT ${sel()} ${FROM} WHERE ${conds.join(' AND ')} ORDER BY m.sent_at DESC, m.id DESC LIMIT ${limit + 1}`,
      ...args,
    );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      rows: page,
      hasMore,
      nextCursor: hasMore && last ? Buffer.from(`${new Date(String(last.sent_at)).toISOString()}|${String(last.id)}`).toString('base64url') : null,
    };
  },

  /** Work Center: accepted items of a department, grouped by document type. */
  async workCenter(caller: Caller, deptId?: string) {
    const mine = await myDepartmentIds(caller);
    const dept = deptId ?? mine[0];
    if (!dept) return { groups: [] };
    if (!isElevated(caller) && !mine.includes(dept)) throw Errors.forbidden('You can only open your own department.');
    const rows = await query(
      prisma,
      `SELECT ${sel()} ${FROM}
        WHERE m.to_department_id = $1::uuid AND m.state IN ('ACCEPTED','IN_WORK','WAITING_APPROVAL')
          AND (m.unit_id = ANY($2::uuid[]) OR m.to_unit_id = ANY($2::uuid[]))
        ORDER BY m.doc_type, m.accepted_at DESC LIMIT 500`,
      dept,
      caller.ctx.unitIds,
    );
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const k = String(r.doc_type);
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    return { groups: [...groups.entries()].map(([docType, items]) => ({ docType, items })) };
  },

  /** The history of one document (every handover, oldest first) and its current holder. */
  async history(docType: string, docId: string) {
    const events = await query(
      prisma,
      `SELECT e.event, e.from_state, e.to_state, e.at, e.note, d.name AS department, u.name AS actor, m.number
         FROM movement_events e
         JOIN work_movements m ON m.id = e.movement_id
         LEFT JOIN departments d ON d.id = e.department_id
         LEFT JOIN users u ON u.id = e.actor_id
        WHERE e.doc_type = $1 AND e.doc_id = $2::uuid ORDER BY e.at, e.id LIMIT 500`,
      docType,
      docId,
    );
    const movements = await query(prisma, `SELECT ${sel()} ${FROM} WHERE m.doc_type = $1 AND m.doc_id = $2::uuid ORDER BY m.sent_at LIMIT 200`, docType, docId);
    return { events, movements };
  },

  async lines(movementId: string): Promise<Row[]> {
    return query(
      prisma,
      `SELECT line_no, item_id::text AS item_id, description, qty::float8 AS qty, uom, batch, from_location, to_location,
              received_qty::float8 AS received_qty, short_qty::float8 AS short_qty, short_reason
         FROM movement_lines WHERE movement_id = $1::uuid ORDER BY line_no LIMIT 500`,
      movementId,
    );
  },

  /** Who holds the record now ("Currently with Production since 10:30"), or null when nobody. */
  async holder(docType: string, docId: string, db: Tx | typeof prisma = prisma) {
    const r = (
      await query(
        db,
        `SELECT m.id::text AS id, m.state, td.name AS department, m.to_department_id::text AS department_id, m.sent_at, m.accepted_at
           FROM work_movements m JOIN departments td ON td.id = m.to_department_id
          WHERE m.doc_type = $1 AND m.doc_id = $2::uuid AND m.state IN ('SENT','RECEIVED','ACCEPTED','IN_WORK','WAITING_APPROVAL')`,
        docType,
        docId,
      )
    )[0];
    return r ?? null;
  },

  /**
   * The edit lock (routed_edit): while a movement is open, only the department holding the record may edit it.
   * Called by the records engine before an update or delete.
   */
  async assertNotRoutedAway(caller: Caller, docType: string, docId: string): Promise<void> {
    const h = await this.holder(docType, docId);
    if (!h) return;
    const rule = (await query(prisma, `SELECT routed_edit FROM workflow_rules WHERE module_id = $1`, docType))[0];
    if (rule && rule.routed_edit === false) return;
    if (isElevated(caller)) return;
    const mine = await myDepartmentIds(caller);
    if (mine.includes(String(h.department_id))) return;
    const since = new Date(String(h.sent_at)).toLocaleString('en-IN');
    throw Errors.forbidden(`Currently with ${String(h.department)} since ${since}. Only they can edit it.`);
  },

  // -------------------------------------------------------------------------------------------- Workflow Matrix
  async listRules(): Promise<Row[]> {
    // unpaginated: admin-defined config table, a few hundred rows at most; page UIs read it whole
    return query(
      prisma,
      `SELECT r.module_id, r.owner_department_id::text AS owner_department_id, od.name AS owner_department,
              r.next_department_id::text AS next_department_id, nd.name AS next_department,
              r.approval_department_id::text AS approval_department_id, ad.name AS approval_department,
              r.route_mode, r.sla_days::float8 AS sla_days, r.routed_edit, r.active,
              r.required_attachment_types, r.required_fields
         FROM workflow_rules r
         LEFT JOIN departments od ON od.id = r.owner_department_id
         LEFT JOIN departments nd ON nd.id = r.next_department_id
         LEFT JOIN departments ad ON ad.id = r.approval_department_id
        ORDER BY r.module_id LIMIT 1000`,
    );
  },

  async putRule(
    caller: Caller,
    moduleId: string,
    r: {
      ownerDepartmentId?: string | null;
      nextDepartmentId?: string | null;
      approvalDepartmentId?: string | null;
      routeMode?: 'MANUAL' | 'SUGGEST';
      slaDays?: number;
      routedEdit?: boolean;
      active?: boolean;
      requiredAttachmentTypes?: string[];
      requiredFields?: string[];
    },
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const before = (await query(tx, `SELECT * FROM workflow_rules WHERE module_id = $1`, moduleId))[0] ?? null;
      await tx.$executeRaw`
        INSERT INTO workflow_rules (module_id, owner_department_id, next_department_id, approval_department_id, route_mode, sla_days,
                                    routed_edit, active, required_attachment_types, required_fields, updated_by_id, updated_at)
        VALUES (${moduleId}, ${r.ownerDepartmentId ?? null}::uuid, ${r.nextDepartmentId ?? null}::uuid, ${r.approvalDepartmentId ?? null}::uuid,
                ${r.routeMode ?? 'SUGGEST'}, ${r.slaDays ?? 2}::numeric, ${r.routedEdit ?? true}, ${r.active ?? true},
                ${r.requiredAttachmentTypes ?? []}::text[], ${r.requiredFields ?? []}::text[], ${caller.auth.userId}::uuid, now())
        ON CONFLICT (module_id) DO UPDATE SET owner_department_id = EXCLUDED.owner_department_id,
          next_department_id = EXCLUDED.next_department_id, approval_department_id = EXCLUDED.approval_department_id,
          route_mode = EXCLUDED.route_mode, sla_days = EXCLUDED.sla_days, routed_edit = EXCLUDED.routed_edit, active = EXCLUDED.active,
          required_attachment_types = EXCLUDED.required_attachment_types, required_fields = EXCLUDED.required_fields,
          updated_by_id = EXCLUDED.updated_by_id, updated_at = now()`;
      await recordAudit({ action: 'work.rule_saved', actorId: caller.auth.userId, targetType: 'workflow_rule', targetId: moduleId, detail: JSON.parse(JSON.stringify({ before, after: r })) as Record<string, never> }, tx);
    });
  },

  /** The department the matrix suggests next for a document; falls back to the V18 map. */
  async suggest(docType: string): Promise<{ departmentId: string | null; department: string | null; source: 'RULE' | 'V18' | 'NONE' }> {
    const rule = (
      await query(
        prisma,
        `SELECT r.next_department_id::text AS id, d.name FROM workflow_rules r JOIN departments d ON d.id = r.next_department_id
          WHERE r.module_id = $1 AND r.active AND r.route_mode = 'SUGGEST'`,
        docType,
      )
    )[0];
    if (rule) return { departmentId: String(rule.id), department: String(rule.name), source: 'RULE' };
    const name = V18_NEXT[docType];
    if (name) {
      const d = (await query(prisma, `SELECT id::text AS id, name FROM departments WHERE lower(name) = lower($1)`, name))[0];
      if (d) return { departmentId: String(d.id), department: String(d.name), source: 'V18' };
    }
    return { departmentId: null, department: null, source: 'NONE' };
  },

  async departments(): Promise<Row[]> {
    // unpaginated: admin-defined config table, a few hundred rows at most; page UIs read it whole
    return query(prisma, `SELECT id::text AS id, name FROM departments WHERE status = 'ACTIVE' ORDER BY name LIMIT 200`);
  },

  async managers(departmentId: string, unitId: string): Promise<{ id: string; name: string }[]> {
    return usersOf(prisma, departmentId, unitId);
  },

  // -------------------------------------------------------------------------------------------- Job: late movements
  /** Marks movements past their SLA as late and tells the target (level 1) or the department head (level 2). */
  async markLate(now = new Date()): Promise<{ marked: number; escalated: number }> {
    // unpaginated: system fan-out/queue worker: must visit every eligible row, runs in a job in batches or per event
    const rows = await query(
      prisma,
      `SELECT m.id::text AS id, m.number, m.doc_no, m.doc_type, m.unit_id::text AS unit_id, m.to_department_id::text AS to_department_id,
              m.assigned_manager_id::text AS assigned_manager_id, m.sent_at, m.sla_due_at, m.late, d.head
         FROM work_movements m JOIN departments d ON d.id = m.to_department_id
        WHERE m.sla_due_at < $1::timestamptz AND m.state IN ('SENT','RECEIVED','ACCEPTED','IN_WORK','WAITING_APPROVAL')`,
      now,
    );
    let marked = 0;
    let escalated = 0;
    for (const m of rows) {
      const level = lateLevel(new Date(String(m.sent_at)), new Date(String(m.sla_due_at)), now);
      if (level === 0) continue;
      await prisma.$transaction(async (tx) => {
        if (!m.late) {
          await tx.$executeRaw`UPDATE work_movements SET late = true WHERE id = ${String(m.id)}::uuid`;
          const who = m.assigned_manager_id ? [String(m.assigned_manager_id)] : (await usersOf(tx, String(m.to_department_id), String(m.unit_id))).map((u) => u.id);
          await notifyDept(tx, who, 'work.late', `${String(m.doc_no ?? m.doc_type)} is late`, `${String(m.number)} passed its due time.`, String(m.id), `work:${String(m.id)}:late1`);
          marked += 1;
        }
        if (level === 2 && m.head) {
          const head = (await query(tx, `SELECT id::text AS id FROM users WHERE name = $1 AND status = 'ACTIVE' LIMIT 1`, m.head))[0];
          if (head) {
            await notifyDept(tx, [String(head.id)], 'work.late', `${String(m.doc_no ?? m.doc_type)} is very late`, `${String(m.number)} is twice past its allowed time.`, String(m.id), `work:${String(m.id)}:late2`);
            escalated += 1;
          }
        }
      });
    }
    return { marked, escalated };
  },
};
