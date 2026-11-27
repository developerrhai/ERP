// Customer NCR (complaint registration, the D1-D8 corrective workflow, gates, summary) and Conformance NCR (internal
// conformance / non-conformance with root cause and closure). Open -> Pending Acceptance -> Closed; Return sends it back
// with a compulsory comment.
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { AppError, Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
import { D } from '../inventory/money';
import { TX, audit, checkVersion, exec, fyOfCaller, insertRow, norm, query, scopeSql, todayIst, updateRow } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { alertPeople, assertCriticalAllowed, escalate, event, qualityLeads, trail } from './common';
import type { Priority } from './common';
import { S } from './inspection-service';

export type NcrType = 'CUSTOMER' | 'CONFORMANCE';
export const PAGE_OF_NCR: Record<NcrType, string> = { CUSTOMER: 'qms-customer-ncr', CONFORMANCE: 'qms-conformance-ncr' };
const PREFIX: Record<NcrType, string> = { CUSTOMER: 'CNCR', CONFORMANCE: 'CONF' };

export const STAGES = [
  ['d1', 'D1 Team'],
  ['d2', 'D2 Problem description'],
  ['d3', 'D3 Containment action'],
  ['d4', 'D4 Root cause'],
  ['d5', 'D5 Corrective action'],
  ['d6', 'D6 Implementation and check'],
  ['d7', 'D7 Prevent recurrence'],
  ['d8', 'D8 Team recognition'],
] as const;
export type StageKey = (typeof STAGES)[number][0];
export const STAGE_KEYS = STAGES.map((s) => s[0]) as [StageKey, ...StageKey[]];
interface Stage {
  text?: string;
  done?: boolean;
  doneOn?: string | null;
  doneBy?: string | null;
}
const stagesOf = (r: Row): Record<string, Stage> => (r.eight_d as Record<string, Stage> | null) ?? {};
/** The stage that also fills a column of the record itself. */
const STAGE_COLUMN: Partial<Record<StageKey, string>> = { d4: 'root_cause', d5: 'corrective_action', d7: 'preventive_action' };

export interface NcrInput {
  type: NcrType;
  ncrDate?: string | undefined;
  department?: string | undefined;
  priority?: Priority | undefined;
  result?: 'CONFORMANCE' | 'NON_CONFORMANCE' | undefined;
  customerId?: string | null | undefined;
  itemId?: string | null | undefined;
  reference?: string | null | undefined;
  process?: string | null | undefined;
  title: string;
  description: string;
  qty?: string | null | undefined;
  claimAmount?: string | null | undefined;
  rootCause?: string | null | undefined;
  correctiveAction?: string | null | undefined;
  preventiveAction?: string | null | undefined;
  ownerName?: string | null | undefined;
  targetDate?: string | null | undefined;
}

const SELECT = `SELECT t.*, c.name AS customer_name, c.code AS customer_code, i.name AS item_name, i.code AS item_code,
    (SELECT x.name FROM users x WHERE x.id=t.returned_by_id) AS returned_by_name,
    (SELECT x.name FROM users x WHERE x.id=t.closed_by_id) AS closed_by_name
  FROM qms_ncrs t LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN items i ON i.id=t.item_id`;

const blank = (v: string | null | undefined): string | null => (v === undefined || v === null || v.trim() === '' ? null : v.trim());

async function assertRefs(db: Db, b: Partial<NcrInput>): Promise<void> {
  const bad: Record<string, string> = {};
  if (b.customerId && !(await query(db, `SELECT 1 FROM customers WHERE id=$1::uuid AND deleted_at IS NULL`, b.customerId))[0])
    bad.customerId = 'This customer does not exist.';
  if (b.itemId && !(await query(db, `SELECT 1 FROM items WHERE id=$1::uuid`, b.itemId))[0]) bad.itemId = 'This item does not exist.';
  if (b.department && !(await query(db, `SELECT 1 FROM departments WHERE name=$1`, b.department))[0]) bad.department = 'Choose a department from the list.';
  if (Object.keys(bad).length) throw Errors.validation(bad);
}

async function lock(tx: Db, caller: Caller, pageId: string, type: NcrType, id: string): Promise<Row> {
  const sc = await scopeSql(caller, pageId);
  const cur = (
    await query(
      tx,
      `SELECT t.* FROM qms_ncrs t WHERE t.id=$${sc.args.length + 1}::uuid AND t.type=$${sc.args.length + 2} AND ${sc.sql} FOR UPDATE OF t`,
      ...sc.args,
      id,
      type,
    )
  )[0];
  if (!cur) throw Errors.notFound('NCR not found.');
  return cur;
}

const open = (cur: Row): void => {
  if (S(cur.status) === 'Pending Acceptance')
    throw Errors.conflict('This NCR is waiting for acceptance. It can be changed after it is returned.');
  if (S(cur.status) !== 'Open') throw Errors.conflict('Only an open NCR can be changed.');
};

const critical = (db: Db, r: { id: string; number: string; unitId: string; type: NcrType; title: string }): Promise<void> =>
  escalate(db, {
    id: r.id,
    number: r.number,
    unitId: r.unitId,
    type: 'qms_ncr',
    what: `${r.type === 'CUSTOMER' ? 'Customer complaint' : 'Non-conformance'} marked Critical: ${r.title}`,
    link: `/m/${PAGE_OF_NCR[r.type]}`,
  });

export const ncrService = {
  async typeOf(id: string): Promise<NcrType> {
    const r = (await query(prisma, `SELECT type FROM qms_ncrs WHERE id=$1::uuid AND deleted_at IS NULL`, id))[0];
    if (!r) throw Errors.notFound('NCR not found.');
    return S(r.type) as NcrType;
  },

  async get(caller: Caller, type: NcrType, id: string): Promise<Row> {
    const sc = await scopeSql(caller, PAGE_OF_NCR[type]);
    const r = (
      await query(prisma, `${SELECT} WHERE t.id=$${sc.args.length + 1}::uuid AND t.type=$${sc.args.length + 2} AND ${sc.sql}`, ...sc.args, id, type)
    )[0];
    if (!r) throw Errors.notFound('NCR not found.');
    const out = norm(r);
    const st = stagesOf(r);
    out.stages = STAGES.map(([key, label]) => ({
      key,
      label,
      text: st[key]?.text ?? '',
      done: Boolean(st[key]?.done),
      doneOn: st[key]?.doneOn ?? null,
      doneBy: st[key]?.doneBy ?? null,
    }));
    delete out.eightD;
    out.events = await trail('NCR', id);
    return out;
  },

  async create(caller: Caller, b: NcrInput): Promise<Row> {
    const unitId = caller.ctx.unitId;
    if (!unitId) throw Errors.validation({ unit: 'Choose one unit in the top bar first.' });
    if (b.type === 'CUSTOMER' && !b.customerId) throw Errors.validation({ customerId: 'Choose the customer who complained.' });
    const date = b.ncrDate ?? todayIst();
    const target = blank(b.targetDate);
    if (target && target < date) throw Errors.validation({ targetDate: 'The target date is before the NCR date.' });
    const fy = await fyOfCaller(caller);
    const page = PAGE_OF_NCR[b.type];
    const id = await prisma.$transaction(async (tx) => {
      await assertRefs(tx, b);
      const no = await NumberingService.allocate(tx, { pageId: `qms:${PREFIX[b.type]}`, unitId, fyId: fy.id, prefix: PREFIX[b.type] });
      const nid = await insertRow(tx, 'qms_ncrs', {
        unitId,
        fyId: fy.id,
        number: no,
        type: b.type,
        ncrDate: date,
        department: b.department ?? 'Quality',
        priority: b.priority ?? 'MINOR',
        result: b.type === 'CUSTOMER' ? 'NON_CONFORMANCE' : (b.result ?? 'NON_CONFORMANCE'),
        customerId: b.type === 'CUSTOMER' ? b.customerId : null,
        itemId: b.itemId ?? null,
        reference: blank(b.reference),
        process: blank(b.process),
        title: b.title.trim(),
        description: b.description.trim(),
        qty: blank(b.qty),
        claimAmount: D(blank(b.claimAmount) ?? '0').toFixed(2),
        rootCause: blank(b.rootCause),
        correctiveAction: blank(b.correctiveAction),
        preventiveAction: blank(b.preventiveAction),
        ownerName: blank(b.ownerName),
        targetDate: target,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      await event(tx, 'NCR', nid, 'REGISTERED', caller.auth.userId);
      await audit(tx, caller, caller.auth.userId, 'QMS_NCR_CREATED', 'qms_ncr', { id: nid, code: no }, page, { type: b.type });
      if (b.priority === 'CRITICAL') await critical(tx, { id: nid, number: no, unitId, type: b.type, title: b.title });
      return nid;
    }, TX);
    return this.get(caller, b.type, id);
  },

  async update(caller: Caller, type: NcrType, id: string, ifMatch: number, b: Partial<Omit<NcrInput, 'type'>>): Promise<Row> {
    const page = PAGE_OF_NCR[type];
    await prisma.$transaction(async (tx) => {
      const cur = await lock(tx, caller, page, type, id);
      checkVersion(cur, ifMatch);
      open(cur);
      await assertRefs(tx, b);
      if (type === 'CUSTOMER' && b.customerId === null) throw Errors.validation({ customerId: 'Choose the customer who complained.' });
      const before = S(cur.priority) as Priority;
      if (b.priority && b.priority !== before && before === 'CRITICAL') await assertCriticalAllowed(tx, caller, before);
      const date = b.ncrDate ?? new Date(cur.ncr_date as string | Date).toISOString().slice(0, 10);
      const target = b.targetDate === undefined ? undefined : blank(b.targetDate);
      if (target && target < date) throw Errors.validation({ targetDate: 'The target date is before the NCR date.' });
      const opt = (v: string | null | undefined): string | null | undefined => (v === undefined ? undefined : blank(v));
      await updateRow(tx, 'qms_ncrs', id, {
        ncrDate: b.ncrDate,
        department: b.department,
        priority: b.priority,
        result: type === 'CONFORMANCE' ? b.result : undefined,
        customerId: type === 'CUSTOMER' ? (b.customerId ?? undefined) : undefined,
        itemId: b.itemId,
        reference: opt(b.reference),
        process: opt(b.process),
        title: b.title?.trim(),
        description: b.description?.trim(),
        qty: opt(b.qty),
        claimAmount: b.claimAmount === undefined ? undefined : D(blank(b.claimAmount) ?? '0').toFixed(2),
        // a customer NCR takes these three from its D4, D5 and D7 stages
        rootCause: type === 'CONFORMANCE' ? opt(b.rootCause) : undefined,
        correctiveAction: type === 'CONFORMANCE' ? opt(b.correctiveAction) : undefined,
        preventiveAction: type === 'CONFORMANCE' ? opt(b.preventiveAction) : undefined,
        ownerName: opt(b.ownerName),
        targetDate: target,
        updatedById: caller.auth.userId,
      });
      await exec(tx, `UPDATE qms_ncrs SET updated_at=now(), version=version+1 WHERE id=$1::uuid`, id);
      if (b.priority && b.priority !== before) {
        await event(tx, 'NCR', id, 'PRIORITY', caller.auth.userId, b.priority);
        if (b.priority === 'CRITICAL')
          await critical(tx, { id, number: S(cur.number), unitId: S(cur.unit_id), type, title: b.title ?? S(cur.title) });
      }
      await audit(tx, caller, caller.auth.userId, 'QMS_NCR_UPDATED', 'qms_ncr', { id, code: S(cur.number) }, page);
    }, TX);
    return this.get(caller, type, id);
  },

  /** One D stage: save its text, complete it, or reopen it. A gate opens only when every gate before it is passed. */
  async stage(caller: Caller, id: string, ifMatch: number, key: StageKey, b: { text: string; done: boolean }): Promise<Row> {
    const page = PAGE_OF_NCR.CUSTOMER;
    await prisma.$transaction(async (tx) => {
      const cur = await lock(tx, caller, page, 'CUSTOMER', id);
      checkVersion(cur, ifMatch);
      open(cur);
      const all = stagesOf(cur);
      const n = STAGE_KEYS.indexOf(key);
      const label = STAGES[n]![1];
      const text = b.text.trim();
      const was = Boolean(all[key]?.done);
      if (b.done) {
        if (text.length < 3) throw Errors.validation({ text: `Write what was done for ${label} before completing it.` });
        const waiting = STAGES.slice(0, n).find(([k]) => !all[k]?.done);
        if (waiting) throw Errors.validation({ done: `Complete ${waiting[1]} first.` });
      } else if (was) {
        const later = STAGES.slice(n + 1).find(([k]) => all[k]?.done);
        if (later) throw Errors.validation({ done: `Reopen ${later[1]} first.` });
      }
      const me = (await query(tx, `SELECT name FROM users WHERE id=$1::uuid`, caller.auth.userId))[0];
      all[key] = {
        text,
        done: b.done,
        doneOn: b.done ? (was ? (all[key]?.doneOn ?? todayIst()) : todayIst()) : null,
        doneBy: b.done ? (was ? (all[key]?.doneBy ?? S(me?.name)) : S(me?.name)) : null,
      };
      const column = STAGE_COLUMN[key];
      await exec(
        tx,
        `UPDATE qms_ncrs SET eight_d=$1::jsonb${column ? `, ${column}=$4` : ''}, updated_by_id=$2::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
        JSON.stringify(all),
        caller.auth.userId,
        id,
        ...(column ? [text || null] : []),
      );
      if (b.done !== was) await event(tx, 'NCR', id, b.done ? 'GATE PASSED' : 'GATE REOPENED', caller.auth.userId, label);
      await audit(tx, caller, caller.auth.userId, 'QMS_NCR_STAGE', 'qms_ncr', { id, code: S(cur.number) }, page, { stage: key, done: b.done });
    }, TX);
    return this.get(caller, 'CUSTOMER', id);
  },

  /** Send for acceptance: the work the closure needs must be there. */
  async submit(caller: Caller, type: NcrType, id: string, note?: string): Promise<Row> {
    const page = PAGE_OF_NCR[type];
    await prisma.$transaction(async (tx) => {
      const cur = await lock(tx, caller, page, type, id);
      open(cur);
      if (type === 'CUSTOMER') {
        const st = stagesOf(cur);
        const missing = STAGES.filter(([k]) => !st[k]?.done);
        if (missing.length) {
          const why = `Complete the 8D first: ${missing[0]![1]} is not done (${missing.length} of 8 left).`;
          throw new AppError(422, 'QMS_8D_INCOMPLETE', why, { stages: why });
        }
      } else if (S(cur.result) === 'NON_CONFORMANCE') {
        const errs: Record<string, string> = {};
        if (!S(cur.root_cause).trim()) errs.rootCause = 'Enter the root cause before sending for acceptance.';
        if (!S(cur.corrective_action).trim()) errs.correctiveAction = 'Enter the corrective action before sending for acceptance.';
        if (Object.keys(errs).length) throw Errors.validation(errs);
      }
      await exec(
        tx,
        `UPDATE qms_ncrs SET status='Pending Acceptance', submitted_at=now(), submitted_by_id=$1::uuid, return_comment=NULL, returned_at=NULL, returned_by_id=NULL,
           updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
        caller.auth.userId,
        id,
      );
      await event(tx, 'NCR', id, 'SUBMITTED', caller.auth.userId, note);
      await alertPeople(
        tx,
        (await qualityLeads(tx, S(cur.unit_id))).filter((u) => u !== caller.auth.userId),
        'quality.pending',
        `${S(cur.number)} is waiting for acceptance`,
        S(cur.title),
        { type: 'qms_ncr', id },
        `/m/${page}`,
        `quality-pending:${id}:${Number(cur.version)}`,
      );
      await audit(tx, caller, caller.auth.userId, 'QMS_NCR_SUBMITTED', 'qms_ncr', { id, code: S(cur.number) }, page);
    }, TX);
    return this.get(caller, type, id);
  },

  async accept(caller: Caller, type: NcrType, id: string, note?: string): Promise<Row> {
    const page = PAGE_OF_NCR[type];
    await prisma.$transaction(async (tx) => {
      const cur = await lock(tx, caller, page, type, id);
      if (S(cur.status) !== 'Pending Acceptance') throw Errors.conflict('Only an NCR waiting for acceptance can be accepted.');
      await assertCriticalAllowed(tx, caller, cur.priority);
      await exec(
        tx,
        `UPDATE qms_ncrs SET status='Closed', closed_at=now(), closed_by_id=$1::uuid, closure_note=$2, updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
        caller.auth.userId,
        blank(note),
        id,
      );
      await event(tx, 'NCR', id, 'ACCEPTED AND CLOSED', caller.auth.userId, note);
      await audit(tx, caller, caller.auth.userId, 'QMS_NCR_CLOSED', 'qms_ncr', { id, code: S(cur.number) }, page);
    }, TX);
    return this.get(caller, type, id);
  },

  async giveBack(caller: Caller, type: NcrType, id: string, comment: string): Promise<Row> {
    const text = comment.trim();
    if (text.length < 3) throw Errors.validation({ comment: 'Add a comment saying why the record is returned.' });
    const page = PAGE_OF_NCR[type];
    await prisma.$transaction(async (tx) => {
      const cur = await lock(tx, caller, page, type, id);
      if (S(cur.status) !== 'Pending Acceptance') throw Errors.conflict('Only an NCR waiting for acceptance can be returned.');
      await exec(
        tx,
        `UPDATE qms_ncrs SET status='Open', submitted_at=NULL, return_comment=$1, returned_at=now(), returned_by_id=$2::uuid,
           updated_by_id=$2::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
        text,
        caller.auth.userId,
        id,
      );
      await event(tx, 'NCR', id, 'RETURNED', caller.auth.userId, text);
      await alertPeople(
        tx,
        [cur.submitted_by_id, cur.created_by_id].filter(Boolean).map((x) => S(x)),
        'quality.returned',
        `${S(cur.number)} was returned to you`,
        text,
        { type: 'qms_ncr', id },
        `/m/${page}`,
        `quality-returned:${id}:${Number(cur.version)}`,
      );
      await audit(tx, caller, caller.auth.userId, 'QMS_NCR_RETURNED', 'qms_ncr', { id, code: S(cur.number) }, page, { comment: text });
    }, TX);
    return this.get(caller, type, id);
  },

  async cancel(caller: Caller, type: NcrType, id: string, reason: string): Promise<Row> {
    const page = PAGE_OF_NCR[type];
    await prisma.$transaction(async (tx) => {
      const cur = await lock(tx, caller, page, type, id);
      if (!['Open', 'Pending Acceptance'].includes(S(cur.status))) throw Errors.conflict('A closed or cancelled NCR cannot be cancelled.');
      await assertCriticalAllowed(tx, caller, cur.priority);
      await exec(
        tx,
        `UPDATE qms_ncrs SET status='Cancelled', cancel_reason=$1, updated_by_id=$2::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
        reason,
        caller.auth.userId,
        id,
      );
      await event(tx, 'NCR', id, 'CANCELLED', caller.auth.userId, reason);
      await audit(tx, caller, caller.auth.userId, 'QMS_NCR_CANCELLED', 'qms_ncr', { id, code: S(cur.number) }, page, { reason });
    }, TX);
    return this.get(caller, type, id);
  },

  /** The records behind the Pending Acceptance, Priority, 8D and gauge views. */
  async list(
    caller: Caller,
    type: NcrType,
    q: { status?: string | undefined; priority?: string | undefined; customerId?: string | undefined; page: number; size: number },
  ) {
    const sc = await scopeSql(caller, PAGE_OF_NCR[type]);
    const args = [...sc.args, type];
    let where = `${sc.sql} AND t.type=$${args.length}`;
    const eq = (sql: string, v: string) => {
      args.push(v);
      where += ` AND ${sql.replace('?', `$${args.length}`)}`;
    };
    // "open" and "closed" are the two sides of the gauge: open includes the records waiting for acceptance
    if (q.status === 'open') where += ` AND t.status IN ('Open','Pending Acceptance')`;
    else if (q.status) eq('t.status = ?', q.status);
    else where += ` AND t.status <> 'Cancelled'`;
    if (q.priority) eq('t.priority = ?', q.priority);
    if (q.customerId) eq('t.customer_id = ?::uuid', q.customerId);
    const total = Number((await query(prisma, `SELECT count(*)::int AS n FROM qms_ncrs t WHERE ${where}`, ...args))[0]!.n);
    const rows = await query(
      prisma,
      `${SELECT} WHERE ${where} ORDER BY CASE t.priority WHEN 'CRITICAL' THEN 0 WHEN 'MAJOR' THEN 1 ELSE 2 END, t.ncr_date DESC, t.number DESC
        LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return {
      total,
      rows: rows.map((r) => {
        const { eightD: _e, ...rest } = norm(r);
        void _e;
        return rest as Row;
      }),
    };
  },

  /** Summary sheet: open against closed, by priority, and how far the open ones are through the eight gates. */
  async counts(caller: Caller, type: NcrType, customerId?: string) {
    const sc = await scopeSql(caller, PAGE_OF_NCR[type]);
    const args = [...sc.args, type];
    let where = `${sc.sql} AND t.type=$${args.length}`;
    if (customerId) {
      args.push(customerId);
      where += ` AND t.customer_id=$${args.length}::uuid`;
    }
    const r = (
      await query(
        prisma,
        `SELECT count(*) FILTER (WHERE t.status='Open')::int AS open,
            count(*) FILTER (WHERE t.status='Pending Acceptance')::int AS pending,
            count(*) FILTER (WHERE t.status='Closed')::int AS closed,
            count(*) FILTER (WHERE t.status <> 'Cancelled' AND t.priority='MINOR')::int AS minor,
            count(*) FILTER (WHERE t.status <> 'Cancelled' AND t.priority='MAJOR')::int AS major,
            count(*) FILTER (WHERE t.status <> 'Cancelled' AND t.priority='CRITICAL')::int AS critical,
            count(*) FILTER (WHERE t.status IN ('Open','Pending Acceptance') AND t.priority='CRITICAL')::int AS critical_open,
            count(*) FILTER (WHERE t.status IN ('Open','Pending Acceptance') AND t.target_date < $${args.length + 1}::date)::int AS overdue
          FROM qms_ncrs t WHERE ${where}`,
        ...args,
        todayIst(),
      )
    )[0]!;
    const c = norm<Record<string, number>>(r);
    return { ...c, total: (c.open ?? 0) + (c.pending ?? 0) + (c.closed ?? 0) };
  },

  /** Customer No. + All Summary: one line per customer. */
  async customerSummary(caller: Caller) {
    const sc = await scopeSql(caller, PAGE_OF_NCR.CUSTOMER);
    // unpaginated: one row per customer that has a complaint
    const rows = await query(
      prisma,
      `SELECT c.id::text AS customer_id, c.code AS customer_no, c.name AS customer_name,
          count(*)::int AS total,
          count(*) FILTER (WHERE t.status='Open')::int AS open,
          count(*) FILTER (WHERE t.status='Pending Acceptance')::int AS pending,
          count(*) FILTER (WHERE t.status='Closed')::int AS closed,
          count(*) FILTER (WHERE t.priority='MINOR')::int AS minor,
          count(*) FILTER (WHERE t.priority='MAJOR')::int AS major,
          count(*) FILTER (WHERE t.priority='CRITICAL')::int AS critical,
          trim_scale(COALESCE(sum(t.qty),0))::text AS qty,
          COALESCE(sum(t.claim_amount),0)::text AS claim_amount,
          to_char(max(t.ncr_date),'YYYY-MM-DD') AS last_date
        FROM qms_ncrs t JOIN customers c ON c.id=t.customer_id
       WHERE ${sc.sql} AND t.type='CUSTOMER' AND t.status <> 'Cancelled'
       GROUP BY c.id, c.code, c.name ORDER BY count(*) DESC, c.name`,
      ...sc.args,
    );
    return rows.map((r) => norm(r));
  },

  /** Gate chart: every live customer NCR with its eight gates, newest first. */
  async gates(caller: Caller, q: { customerId?: string | undefined; page: number; size: number }) {
    const sc = await scopeSql(caller, PAGE_OF_NCR.CUSTOMER);
    const args = [...sc.args];
    let where = `${sc.sql} AND t.type='CUSTOMER' AND t.status <> 'Cancelled'`;
    if (q.customerId) {
      args.push(q.customerId);
      where += ` AND t.customer_id=$${args.length}::uuid`;
    }
    const total = Number((await query(prisma, `SELECT count(*)::int AS n FROM qms_ncrs t WHERE ${where}`, ...args))[0]!.n);
    const rows = await query(
      prisma,
      `${SELECT} WHERE ${where} ORDER BY (t.status='Closed'), t.ncr_date DESC, t.number DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return {
      total,
      rows: rows.map((r) => {
        const st = stagesOf(r);
        const done = STAGE_KEYS.filter((k) => st[k]?.done).length;
        return {
          id: S(r.id),
          number: S(r.number),
          customerName: S(r.customer_name),
          title: S(r.title),
          priority: S(r.priority),
          status: S(r.status),
          done,
          gates: STAGES.map(([key, label]) => ({ key, label, done: Boolean(st[key]?.done), doneOn: st[key]?.doneOn ?? null })),
        };
      }),
    };
  },
};
