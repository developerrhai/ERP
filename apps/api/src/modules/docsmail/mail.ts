// Phase 27: Department Mail. Internal mail between departments (a message row + an in-app notification; a recipient only
// gets mail of plants they hold - R-37) and external mail through the Phase 21 outbox.
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { accessUserOf } from '../../core/rbac/access';
import { companyName, queueEmail, renderEmail, absoluteLink } from '../notifications/email';
import { notificationService } from '../notifications/service';
import { query } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { isElevated, usersOf } from '../work/service';

const S = (v: unknown): string => String(v ?? '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const DEFAULT_SUBJECT = 'Department Document • Review / Action';
export const DEFAULT_BODY = 'Please review the attached ERP document(s) and complete the required action.';

export interface Attachment { label: string; pageId?: string | null; recordId?: string | null; format?: 'pdf' | 'word' | 'excel' | null }



async function holdsPlant(userId: string, unitId: string): Promise<boolean> {
  const r = await query(
    prisma,
    `SELECT 1 FROM users u WHERE u.id = $1::uuid AND u.status = 'ACTIVE'
        AND (EXISTS (SELECT 1 FROM user_units uu WHERE uu.user_id = u.id AND uu.unit_id = $2::uuid)
             OR EXISTS (SELECT 1 FROM roles r WHERE r.id = u.role_id AND r.all_units) OR u.all_units_access)`,
    userId,
    unitId,
  );
  return r.length > 0;
}

export const mailService27 = {
  async departments(): Promise<{ id: string; name: string }[]> {
    return (await query(prisma, `SELECT id::text AS id, name FROM departments ORDER BY name`)).map((d) => ({ id: S(d.id), name: S(d.name) }));
  },

  /** Compose and send an internal message. */
  async sendInternal(
    caller: Caller,
    b: { fromDepartment?: string | null; toDepartmentIds?: string[]; toUserIds?: string[]; subject?: string; body?: string; attachments?: Attachment[]; unitId?: string },
  ): Promise<Row> {
    const user = caller.auth.user;
    const unitId = b.unitId ?? caller.ctx.unitId ?? '';
    if (!caller.ctx.unitIds.includes(unitId)) throw Errors.forbidden();
    if ((b.toDepartmentIds ?? []).length === 0 && (b.toUserIds ?? []).length === 0) throw Errors.validation({ to: 'Choose at least one department or person.' });
    const subject = (b.subject ?? '').trim() || DEFAULT_SUBJECT;
    const body = (b.body ?? '').trim() || DEFAULT_BODY;
    const own = accessUserOf(user).departments[0] ?? '';
    const from = isElevated(caller) && b.fromDepartment ? b.fromDepartment : own || S(b.fromDepartment ?? '');
    const recipients = new Map<string, string>();
    const toNames: string[] = [];
    for (const dep of b.toDepartmentIds ?? []) {
      const d = (await query(prisma, `SELECT id::text AS id, name FROM departments WHERE id = $1::uuid`, dep))[0];
      if (!d) throw Errors.validation({ to: 'That department does not exist.' });
      toNames.push(S(d.name));
      for (const u of await usersOf(prisma, S(d.id), unitId)) recipients.set(u.id, u.name);
      if (![...recipients.keys()].length) continue;
    }
    for (const uid of b.toUserIds ?? []) {
      if (!(await holdsPlant(uid, unitId))) throw Errors.validation({ to: 'One of the people you chose does not work in this plant.' });
      recipients.set(uid, uid);
    }
    recipients.delete(user.id);
    if (recipients.size === 0) throw Errors.validation({ to: 'Nobody in the chosen department works in this plant.' });
    const ids = [...recipients.keys()];
    return prisma.$transaction(async (tx) => {
      const m = (await query(
        tx,
        `INSERT INTO internal_messages (unit_id, from_user_id, from_department, to_department, to_user_ids, subject, body)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid[], $6, $7) RETURNING *`,
        unitId, user.id, from || null, toNames.join(', ') || null, ids, subject.slice(0, 200), body.slice(0, 5000),
      ))[0]!;
      for (const a of b.attachments ?? []) {
        await query(tx, `INSERT INTO internal_message_attachments (message_id, label, page_id, record_id, format) VALUES ($1::uuid, $2, $3, $4::uuid, $5)`, m.id, a.label.slice(0, 200), a.pageId ?? null, a.recordId ?? null, a.format ?? null);
      }
      await notificationService.notify(tx, ids, { type: 'mail.internal', title: `${from || user.name}: ${subject}`.slice(0, 200), body: body.slice(0, 300), link: '/m/dept-mail', entityType: 'internal_message', entityId: S(m.id), dedupeKey: `mail:${S(m.id)}` });
      await recordAudit({ action: 'mail.internal_sent', actorId: user.id, targetType: 'internal_message', targetId: S(m.id), detail: { to: toNames, recipients: ids.length } }, tx);
      return m;
    });
  },

  async inbox(caller: Caller): Promise<Row[]> {
    return query(
      prisma,
      `SELECT m.id, m.subject, m.body, m.from_department, m.created_at, u.name AS from_name,
              EXISTS (SELECT 1 FROM internal_message_reads r WHERE r.message_id = m.id AND r.user_id = $1::uuid) AS read,
              (SELECT count(*)::int FROM internal_message_attachments a WHERE a.message_id = m.id) AS attachments
         FROM internal_messages m JOIN users u ON u.id = m.from_user_id
        WHERE $1::uuid = ANY(m.to_user_ids) AND m.unit_id = ANY($2::uuid[]) ORDER BY m.created_at DESC LIMIT 100`,
      caller.auth.user.id,
      caller.ctx.unitIds,
    );
  },
  async sent(caller: Caller): Promise<Row[]> {
    return query(
      prisma,
      `SELECT m.id, m.subject, m.to_department, m.created_at, cardinality(m.to_user_ids) AS recipients,
              (SELECT count(*)::int FROM internal_message_reads r WHERE r.message_id = m.id) AS read_by,
              (SELECT count(*)::int FROM internal_message_attachments a WHERE a.message_id = m.id) AS attachments
         FROM internal_messages m WHERE m.from_user_id = $1::uuid AND m.unit_id = ANY($2::uuid[]) ORDER BY m.created_at DESC LIMIT 100`,
      caller.auth.user.id,
      caller.ctx.unitIds,
    );
  },
  /** One message; opening it as a recipient marks it read. */
  async open(caller: Caller, id: string): Promise<Row> {
    const m = (await query(prisma, `SELECT m.*, u.name AS from_name FROM internal_messages m JOIN users u ON u.id = m.from_user_id WHERE m.id = $1::uuid`, id))[0];
    const me = caller.auth.user.id;
    if (!m || !caller.ctx.unitIds.includes(S(m.unit_id)) || (S(m.from_user_id) !== me && !(m.to_user_ids as string[]).includes(me))) throw Errors.notFound('Message not found.');
    if ((m.to_user_ids as string[]).includes(me)) await query(prisma, `INSERT INTO internal_message_reads (message_id, user_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`, id, me);
    const attachments = await query(prisma, `SELECT label, page_id, record_id, format FROM internal_message_attachments WHERE message_id = $1::uuid`, id);
    const { to_user_ids: _omit, ...rest } = m;
    void _omit;
    return { ...rest, attachments };
  },

  /** External mail through the Phase 21 outbox (an HTML mail with an "Open in ERP" link per attachment). */
  async sendExternal(caller: Caller, b: { to: string[]; subject?: string; body?: string; attachments?: Attachment[] }): Promise<{ queued: number }> {
    const to = [...new Set(b.to.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    if (to.length === 0) throw Errors.validation({ to: 'Type at least one email address.' });
    const bad = to.filter((e) => !EMAIL.test(e));
    if (bad.length > 0) throw Errors.validation({ to: `Not a valid email address: ${bad.join(', ')}.` });
    const subject = (b.subject ?? '').trim() || DEFAULT_SUBJECT;
    const body = (b.body ?? '').trim() || DEFAULT_BODY;
    const company = await companyName();
    const links = (b.attachments ?? []).filter((a) => a.pageId && a.recordId).map((a) => `${a.label}: ${absoluteLink(`/m/${S(a.pageId)}`) ?? ''}`);
    const content = renderEmail(company, { title: subject, body: [body, ...links].join('\n\n'), link: null });
    await prisma.$transaction(async (tx) => {
      for (const addr of to) await queueEmail(tx, addr, subject, content);
      await recordAudit({ action: 'mail.external_sent', actorId: caller.auth.user.id, targetType: 'mail', targetId: caller.auth.user.id, detail: { to, subject } }, tx);
    });
    return { queued: to.length };
  },
};
