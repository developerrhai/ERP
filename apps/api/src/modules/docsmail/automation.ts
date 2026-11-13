// Phase 27: mail automation. A library of 40 ready automations the Administrator switches on / off (per plant), edits and tests.
// Every send goes through the Phase 21 outbox (queueEmail), is logged in mail_automation_runs and is idempotent:
// the same (automation, record, date) never sends twice. Internal recipients only get the plants they hold (R-37).
import { recordAudit } from '../../core/audit/audit-service';
import { contextRepository } from '../../core/context/context-repository';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { logger } from '../../core/logger';
import { dailyDue } from '../dashboards/calc';
import { companyName, queueEmail, renderEmail, absoluteLink } from '../notifications/email';
import { query } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';

const S = (v: unknown): string => String(v ?? '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const todayIst = (now = new Date()): string => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** Default wording of the automations that run (the Administrator can edit it). {{name}} style merge fields. */
export const DEFAULT_TEMPLATES: Record<string, { subject: string; body: string; link?: string }> = {
  order_ack: { subject: 'Order acknowledgement: {{doc_no}}', body: 'Dear {{party}}, we have received and approved your order {{doc_no}}. We will keep you updated on its progress.', link: '/m/sales-orders' },
  delivery_reminder: { subject: 'Reminder: {{doc_no}} due on {{due_date}}', body: 'Reminder: {{doc_no}} — {{detail}} due on {{due_date}}. Please confirm the delivery date.', link: '/m/scm-po' },
  delivery_overdue: { subject: 'Overdue: {{doc_no}} was due on {{due_date}}', body: 'Our purchase order {{doc_no}} — {{detail}} was due on {{due_date}} and is still open. Please tell us the new delivery date.', link: '/m/scm-po' },
  approval_waiting: { subject: 'Approval waiting: {{doc_no}}', body: '{{doc_no}} ({{detail}}) has been waiting for your approval for more than 24 hours.', link: '/approvals' },
  approval_escalation: { subject: 'Approval escalated: {{doc_no}}', body: '{{doc_no}} ({{detail}}) has been waiting for approval for more than 48 hours and is escalated to you.', link: '/approvals' },
  approval_result: { subject: '{{doc_no}} was {{result}}', body: 'Your document {{doc_no}} was {{result}}. {{detail}}', link: '/approvals' },
  work_sent: { subject: 'Work sent to your department: {{doc_no}}', body: '{{detail}}', link: '/m/dept-inbox' },
  work_late: { subject: 'Work is late: {{doc_no}}', body: '{{detail}}', link: '/m/dept-inbox' },
  work_returned: { subject: 'Work returned to you: {{doc_no}}', body: '{{detail}}', link: '/m/dept-inbox' },
  missed_punch: { subject: 'Missed punch on {{date}}', body: '{{detail}}', link: '/m/hr-ess' },
  daily_attendance: { subject: 'Attendance report for {{date}}: {{doc_no}}', body: '{{detail}}', link: '/m/hr-attendance' },
  owner_daily_summary: { subject: 'Daily summary for {{date}}', body: '{{detail}}', link: '/m/owner-console' },
};

export function merge(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, k: string) => vars[k] ?? '');
}

async function library(code: string): Promise<Row> {
  const r = (await query(prisma, `SELECT * FROM mail_automation_library WHERE code = $1`, code))[0];
  if (!r) throw Errors.notFound('Automation not found.');
  return r;
}

/** On for a plant unless the library switch is off or the plant has its own "off" override. */
export async function plantEnabled(code: string, unitId: string | null): Promise<{ on: boolean; reason?: string }> {
  const lib = await library(code);
  if (!lib.enabled) return { on: false, reason: 'Automation is switched off.' };
  if (unitId) {
    const o = (await query(prisma, `SELECT enabled FROM mail_automation_plants WHERE code = $1 AND unit_id = $2::uuid`, code, unitId))[0];
    if (o && !o.enabled) return { on: false, reason: 'Automation is off for this plant.' };
  }
  return { on: true };
}

export interface DeliverInput {
  code: string;
  unitId: string | null;
  runKey: string;
  docNo?: string | null;
  to: string[];
  cc?: string[];
  vars: Record<string, string>;
}

/** Claim the run key first (a second call with the same key is a no-op), then queue one email per recipient. */
export async function deliver(i: DeliverInput): Promise<'SENT' | 'DUPLICATE' | 'OFF' | 'NO_RECIPIENT'> {
  const on = await plantEnabled(i.code, i.unitId);
  if (!on.on) return 'OFF';
  const emails = [...new Set([...i.to, ...(i.cc ?? [])].map((e) => e.trim().toLowerCase()).filter((e) => EMAIL.test(e)))];
  if (emails.length === 0) {
    await query(prisma, `INSERT INTO mail_automation_runs (code, unit_id, run_key, status, reason, doc_no) VALUES ($1,$2::uuid,$3,'SKIPPED','No recipient with an email address.',$4) ON CONFLICT DO NOTHING`, i.code, i.unitId, i.runKey, i.docNo ?? null);
    return 'NO_RECIPIENT';
  }
  const claim = await query(prisma, `INSERT INTO mail_automation_runs (code, unit_id, run_key, status, recipients, doc_no) VALUES ($1,$2::uuid,$3,'SENT',$4,$5) ON CONFLICT DO NOTHING RETURNING id`, i.code, i.unitId, i.runKey, emails.length, i.docNo ?? null);
  if (!claim[0]) return 'DUPLICATE';
  const lib = await library(i.code);
  const def = DEFAULT_TEMPLATES[i.code] ?? { subject: S(lib.name), body: S(lib.description) };
  const subject = merge(S(lib.subject_tpl) || def.subject, i.vars).slice(0, 300);
  const body = merge(S(lib.body_tpl) || def.body, i.vars);
  const company = await companyName();
  const content = renderEmail(company, { title: subject, body, link: def.link ? absoluteLink(def.link) : null, docCode: i.docNo ?? null });
  try {
    await prisma.$transaction(async (tx) => {
      for (const e of emails) await queueEmail(tx, e, subject, content);
    });
  } catch (err) {
    await query(prisma, `UPDATE mail_automation_runs SET status = 'FAILED', reason = $2 WHERE id = $1::uuid`, claim[0].id, String((err as Error).message).slice(0, 300));
    throw err;
  }
  return 'SENT';
}

async function emailsOfUsers(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  return (await query(prisma, `SELECT email FROM users WHERE id = ANY($1::uuid[]) AND status = 'ACTIVE' AND email IS NOT NULL`, userIds)).map((r) => S(r.email));
}

async function usersHoldingPlant(unitId: string, minLevel: number): Promise<string[]> {
  return (
    await query(
      prisma,
      `SELECT u.id::text AS id FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.status = 'ACTIVE' AND r.level >= $2
          AND (EXISTS (SELECT 1 FROM user_units uu WHERE uu.user_id = u.id AND uu.unit_id = $1::uuid) OR r.all_units OR u.all_units_access)`,
      unitId,
      minLevel,
    )
  ).map((r) => S(r.id));
}

export const mailAutomation = {
  async list(): Promise<Row[]> {
    const rows = await query(
      prisma,
      `SELECT l.*, (SELECT count(*)::int FROM mail_automation_runs r WHERE r.code = l.code AND r.status = 'SENT') AS sent_count,
              (SELECT max(at) FROM mail_automation_runs r WHERE r.code = l.code) AS last_run,
              coalesce((SELECT json_agg(json_build_object('unitId', p.unit_id, 'enabled', p.enabled)) FROM mail_automation_plants p WHERE p.code = l.code), '[]'::json) AS plants
         FROM mail_automation_library l ORDER BY l.seq`,
    );
    return rows.map((r) => ({ ...r, defaults: DEFAULT_TEMPLATES[S(r.code)] ?? null }));
  },

  async update(caller: Caller, code: string, patch: { enabled?: boolean; subjectTpl?: string | null; bodyTpl?: string | null; runTime?: string | null; offsetDays?: number | null }): Promise<Row> {
    await library(code);
    if (patch.runTime !== undefined && patch.runTime !== null && patch.runTime !== '*' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.runTime)) throw Errors.validation({ runTime: 'Use a time like 09:00.' });
    const r = await query(
      prisma,
      `UPDATE mail_automation_library SET enabled = COALESCE($2, enabled),
              subject_tpl = CASE WHEN $3::boolean THEN $4 ELSE subject_tpl END, body_tpl = CASE WHEN $5::boolean THEN $6 ELSE body_tpl END,
              run_time = CASE WHEN $7::boolean THEN $8 ELSE run_time END, offset_days = CASE WHEN $9::boolean THEN $10::int ELSE offset_days END,
              updated_at = now(), updated_by_id = $11::uuid WHERE code = $1 RETURNING *`,
      code, patch.enabled ?? null, patch.subjectTpl !== undefined, patch.subjectTpl ?? null, patch.bodyTpl !== undefined, patch.bodyTpl ?? null,
      patch.runTime !== undefined, patch.runTime ?? null, patch.offsetDays !== undefined, patch.offsetDays ?? null, caller.auth.user.id,
    );
    await recordAudit({ action: 'mail.automation_changed', actorId: caller.auth.user.id, targetType: 'mail_automation', targetId: code, detail: patch });
    return r[0]!;
  },

  async setPlant(caller: Caller, code: string, unitId: string, enabled: boolean): Promise<void> {
    await library(code);
    await query(prisma, `INSERT INTO mail_automation_plants (code, unit_id, enabled) VALUES ($1, $2::uuid, $3) ON CONFLICT (code, unit_id) DO UPDATE SET enabled = EXCLUDED.enabled`, code, unitId, enabled);
    await recordAudit({ action: 'mail.automation_changed', actorId: caller.auth.user.id, targetType: 'mail_automation', targetId: code, detail: { unitId, enabled } });
  },

  async runs(code: string): Promise<Row[]> {
    return query(prisma, `SELECT r.*, u.code AS unit_code FROM mail_automation_runs r LEFT JOIN units u ON u.id = r.unit_id WHERE r.code = $1 ORDER BY r.at DESC LIMIT 10`, code);
  },

  /** "Send test to me": renders the template with sample data and mails only the caller. No idempotency, no side effects. */
  async sendTest(caller: Caller, code: string): Promise<{ queued: boolean; to: string }> {
    const lib = await library(code);
    const to = S(caller.auth.user.email);
    if (!EMAIL.test(to)) throw Errors.validation({ email: 'Your user has no email address. Add it in your profile.' });
    const def = DEFAULT_TEMPLATES[code] ?? { subject: S(lib.name), body: S(lib.description) };
    const vars = { doc_no: 'SAMPLE/0001', party: 'Sample Customer', due_date: '15-12-2026', detail: 'Sample line: 200 nos BRK-14', result: 'approved', date: todayIst() };
    const subject = `[TEST] ${merge(S(lib.subject_tpl) || def.subject, vars)}`;
    const content = renderEmail(await companyName(), { title: subject, body: merge(S(lib.body_tpl) || def.body, vars), link: null });
    await queueEmail(prisma, to, subject, content);
    await query(prisma, `INSERT INTO mail_automation_runs (code, run_key, status, recipients, doc_no) VALUES ($1, $2, 'TEST', 1, 'SAMPLE')`, code, `test:${Date.now()}`);
    return { queued: true, to };
  },

  // ------------------------------------------------------------------------------------------ event hooks
  /** After an approval is decided: the requester is told (#22); an approved sales order is acknowledged to the customer (#4). */
  async onApprovalResult(i: { docType: string; docId: string; docNo: string; unitId: string; requesterId: string; approved: boolean; detail?: string }): Promise<void> {
    try {
      const requester = await emailsOfUsers([i.requesterId]);
      await deliver({ code: 'approval_result', unitId: i.unitId, runKey: `${i.docType}:${i.docId}:${i.approved ? 'A' : 'R'}:${Date.now()}`.slice(0, 120), docNo: i.docNo, to: requester, vars: { doc_no: i.docNo, result: i.approved ? 'approved' : 'rejected', detail: i.detail ?? '' } });
      if (i.approved && (i.docType === 'sales-orders' || i.docType === 'SALES_ORDER')) {
        const so = (await query(prisma, `SELECT so.customer_id, c.name FROM sales_orders so JOIN customers c ON c.id = so.customer_id WHERE so.id = $1::uuid`, i.docId))[0];
        if (so) {
          const to = (await query(prisma, `SELECT email FROM customer_contacts WHERE customer_id = $1::uuid AND email IS NOT NULL AND coalesce(email_status,'') <> 'BOUNCED' AND (receives_invoices OR is_primary)`, so.customer_id)).map((r) => S(r.email));
          await deliver({ code: 'order_ack', unitId: i.unitId, runKey: `so:${i.docId}`, docNo: i.docNo, to, vars: { doc_no: i.docNo, party: S(so.name) } });
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Mail automation: approval hook failed');
    }
  },

  /** Work movement events (#23 sent, #24 late, #25 returned) to the users already chosen for the in-app notice. */
  async onWork(i: { type: 'work.sent' | 'work.returned' | 'work.late' | 'work.accepted'; userIds: string[]; title: string; body: string; dedupe: string; unitId?: string | null }): Promise<void> {
    const code = i.type === 'work.sent' ? 'work_sent' : i.type === 'work.returned' ? 'work_returned' : i.type === 'work.late' ? 'work_late' : null;
    if (!code) return;
    try {
      await deliver({ code, unitId: i.unitId ?? null, runKey: i.dedupe, docNo: i.title.slice(0, 60), to: await emailsOfUsers(i.userIds), vars: { doc_no: i.title, detail: i.body } });
    } catch (err) {
      logger.warn({ err }, 'Mail automation: work hook failed');
    }
  },

  // ------------------------------------------------------------------------------------------ date / schedule runner
  /** Job body (every 5 minutes): runs each wired DATE / SCHEDULE automation that is due. Safe to run again: runs are idempotent. */
  async runDue(now: Date = new Date()): Promise<{ sent: number; checked: number }> {
    const libs = await query(prisma, `SELECT * FROM mail_automation_library WHERE enabled AND wired AND trigger_kind IN ('DATE','SCHEDULE') AND p21_rule_code IS NULL AND code NOT IN ('missed_punch','daily_attendance')`);
    let sent = 0;
    let checked = 0;
    for (const l of libs) {
      const code = S(l.code);
      if (S(l.run_time) !== '*') {
        const m = /^(\d{2}):(\d{2})$/.exec(S(l.run_time));
        if (!m) continue;
        const last = (await query(prisma, `SELECT max(at) AS at FROM mail_automation_runs WHERE code = $1 AND status IN ('SENT','SKIPPED')`, code))[0]?.at;
        if (!dailyDue({ hour: Number(m[1]), minute: Number(m[2]) }, now, last ? new Date(S(last)) : null)) continue;
      }
      checked += 1;
      try {
        sent += await mailAutomation.collect(code, l, now);
      } catch (err) {
        logger.warn({ err, code }, 'Mail automation run failed');
      }
    }
    return { sent, checked };
  },

  async collect(code: string, lib: Row, now: Date): Promise<number> {
    const day = todayIst(now);
    let sent = 0;
    const ok = (r: string) => (r === 'SENT' ? 1 : 0);
    if (code === 'delivery_reminder' || code === 'delivery_overdue') {
      const offset = Number(lib.offset_days ?? (code === 'delivery_reminder' ? -3 : 1));
      const rows = await query(
        prisma,
        `SELECT l.id AS line_id, po.number, po.unit_id, po.supplier_id, po.created_by_id, l.delivery_date, (l.qty - l.received_qty) AS open_qty, coalesce(i.name, l.service_text, 'item') AS item
           FROM purchase_orders po JOIN purchase_order_lines l ON l.po_id = po.id LEFT JOIN items i ON i.id = l.item_id
          WHERE po.deleted_at IS NULL AND po.status NOT IN ('Draft','Cancelled','Closed','Rejected') AND l.received_qty < l.qty AND l.delivery_date = (CURRENT_DATE - $1::int)`,
        offset,
      );
      for (const r of rows) {
        const to = (await query(prisma, `SELECT email FROM supplier_contacts WHERE supplier_id = $1::uuid AND email IS NOT NULL AND coalesce(email_status,'') <> 'BOUNCED' AND (receives_reminders OR receives_po)`, r.supplier_id)).map((x) => S(x.email));
        const cc = await emailsOfUsers([S(r.created_by_id)]);
        const due = S(fmt(r.delivery_date));
        sent += ok(await deliver({ code, unitId: S(r.unit_id), runKey: `${S(r.line_id)}:${day}`, docNo: S(r.number), to, cc, vars: { doc_no: S(r.number), detail: `${S(Number(r.open_qty))} nos ${S(r.item)}`, due_date: due } }));
      }
    } else if (code === 'approval_waiting' || code === 'approval_escalation') {
      const hours = Number(lib.offset_days ?? (code === 'approval_waiting' ? 1 : 2)) * 24;
      const rows = await query(
        prisma,
        `SELECT s.id AS step_id, s.approver_user_id, s.approver_role_id, r.doc_code, r.doc_title, r.unit_id
           FROM approval_steps s JOIN approval_requests r ON r.id = s.request_id
          WHERE s.status = 'PENDING' AND r.status = 'PENDING' AND s.activated_at IS NOT NULL AND s.activated_at < now() - ($1::int || ' hours')::interval`,
        hours,
      );
      for (const r of rows) {
        let ids: string[] = [];
        if (code === 'approval_escalation') ids = await usersHoldingPlant(S(r.unit_id), 80);
        else if (r.approver_user_id) ids = [S(r.approver_user_id)];
        else if (r.approver_role_id) ids = (await query(prisma, `SELECT u.id::text AS id FROM users u WHERE u.role_id = $1::uuid AND u.status = 'ACTIVE'`, r.approver_role_id)).map((x) => S(x.id));
        sent += ok(await deliver({ code, unitId: S(r.unit_id), runKey: `${S(r.step_id)}`, docNo: S(r.doc_code), to: await emailsOfUsers(ids), vars: { doc_no: S(r.doc_code), detail: S(r.doc_title) } }));
      }
    } else if (code === 'owner_daily_summary') {
      const people = await query(prisma, `SELECT u.id, u.name, u.email FROM users u JOIN roles r ON r.id = u.role_id WHERE u.status = 'ACTIVE' AND r.level >= 90 AND u.email IS NOT NULL`);
      for (const p of people) {
        const units = await contextRepository.accessibleUnits({ id: S(p.id) }, prisma);
        const ids = units.map((u) => u.id);
        if (ids.length === 0) continue;
        const detail = await summaryText(ids, units.map((u) => u.code));
        sent += ok(await deliver({ code, unitId: null, runKey: `${S(p.id)}:${day}`, docNo: day, to: [S(p.email)], vars: { date: day, detail } }));
      }
    }
    return sent;
  },
};

const fmt = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : S(v).slice(0, 10));

/** Yesterday's figures for the plants a person holds - never another plant's data (R-37). */
export async function summaryText(unitIds: string[], codes: string[]): Promise<string> {
  const one = async (sql: string): Promise<number> => Number((await query(prisma, sql, unitIds).catch(() => [{ n: 0 }]))[0]?.n ?? 0);
  const sales = await one(`SELECT coalesce(sum(grand_total),0)::float AS n FROM sales_invoices WHERE unit_id = ANY($1::uuid[]) AND status = 'Posted' AND invoice_date = CURRENT_DATE - 1 AND deleted_at IS NULL`);
  const dispatches = await one(`SELECT count(*)::int AS n FROM sales_dispatches WHERE unit_id = ANY($1::uuid[]) AND status = 'Posted' AND posted_at::date = CURRENT_DATE - 1`);
  const orders = await one(`SELECT count(*)::int AS n FROM sales_orders WHERE unit_id = ANY($1::uuid[]) AND created_at::date = CURRENT_DATE - 1 AND deleted_at IS NULL`);
  const approvals = await one(`SELECT count(*)::int AS n FROM approval_requests WHERE unit_id = ANY($1::uuid[]) AND status = 'PENDING'`);
  const late = await one(`SELECT count(*)::int AS n FROM work_movements WHERE unit_id = ANY($1::uuid[]) AND late = true AND state IN ('SENT','RECEIVED','ACCEPTED','IN_WORK')`);
  const exceptions = await one(`SELECT count(*)::int AS n FROM process_exceptions WHERE (unit_id IS NULL OR unit_id = ANY($1::uuid[])) AND resolved_at IS NULL`);
  const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(sales);
  return [`Plants: ${codes.join(', ')}`, `Sales invoiced yesterday: ₹ ${inr}`, `Dispatches posted: ${dispatches}`, `New orders: ${orders}`, `Approvals pending: ${approvals}`, `Late movements: ${late}`, `Open exceptions: ${exceptions}`].join('\n');
}

export type { Caller };
