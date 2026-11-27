// Rejection & Revoke Register: the rejected batches and the controlled requests to revoke a rejection. A request carries a
// compulsory reason; somebody else approves or refuses it with a note (the MR / Quality Head may override). Revoking marks
// the rejection Revoked so it stops counting; it moves no stock.
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { AppError, Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
import { TX, audit, exec, fyOfCaller, insertRow, norm, query, scopeSql } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { alertPeople, assertCriticalAllowed, event, hasQualityOverride, qualityLeads, trail } from './common';
import { S } from './inspection-service';

export const REVOKE_PAGE = 'qms-rejection-revoke';

const need = (text: string, field: string, message: string): string => {
  const t = text.trim();
  if (t.length < 5) throw Errors.validation({ [field]: message });
  return t;
};

async function lockRejection(tx: Db, caller: Caller, id: string): Promise<Row> {
  const sc = await scopeSql(caller, REVOKE_PAGE);
  const r = (
    await query(tx, `SELECT t.* FROM qms_rejections t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`, ...sc.args, id)
  )[0];
  if (!r) throw Errors.notFound('Rejection not found.');
  return r;
}

/** A rejection that has already been acted on (scrapped or reworked) cannot be revoked. */
async function assertRevocable(tx: Db, r: Row): Promise<void> {
  if (S(r.status) === 'Cancelled') throw Errors.conflict('This rejection is cancelled.');
  if (S(r.status) === 'Revoked') throw Errors.conflict('This rejection is already revoked.');
  const used = (
    await query(
      tx,
      `SELECT (SELECT s.number FROM mfg_scrap s WHERE s.rejection_id=$1::uuid AND s.deleted_at IS NULL AND s.status <> 'Cancelled' LIMIT 1) AS scrap,
              (SELECT w.number FROM mfg_rework w WHERE w.rejection_id=$1::uuid AND w.deleted_at IS NULL AND w.status <> 'Cancelled' LIMIT 1) AS rework`,
      S(r.id),
    )
  )[0]!;
  if (used.scrap || used.rework)
    throw Errors.conflict(
      `This rejection already has ${used.scrap ? `scrap entry ${S(used.scrap)}` : `rework ${S(used.rework)}`}: cancel that first.`,
    );
}

async function addRequest(tx: Db, caller: Caller, r: Row, reason: string): Promise<{ id: string; number: string }> {
  if ((await query(tx, `SELECT 1 FROM qms_revoke_requests WHERE rejection_id=$1::uuid AND status='Pending'`, S(r.id)))[0])
    throw Errors.conflict('A revoke request for this rejection is already waiting.');
  const no = await NumberingService.allocate(tx, { pageId: 'qms:REV', unitId: S(r.unit_id), fyId: caller.ctx.fyId, prefix: 'REV' });
  const id = await insertRow(tx, 'qms_revoke_requests', {
    unitId: S(r.unit_id),
    fyId: caller.ctx.fyId,
    number: no,
    rejectionId: S(r.id),
    reason,
    status: 'Pending',
    previousStatus: S(r.status),
    requestedById: caller.auth.userId,
  });
  await event(tx, 'REVOKE', id, 'REQUESTED', caller.auth.userId, reason);
  return { id, number: no };
}

async function lockRequest(tx: Db, caller: Caller, id: string): Promise<{ q: Row; r: Row }> {
  const q = (await query(tx, `SELECT * FROM qms_revoke_requests WHERE id=$1::uuid FOR UPDATE`, id))[0];
  if (!q) throw Errors.notFound('Revoke request not found.');
  // the rejection behind it must be one the caller may see
  const r = await lockRejection(tx, caller, S(q.rejection_id));
  if (S(q.status) !== 'Pending') throw Errors.conflict(`This request is already ${S(q.status).toLowerCase()}.`);
  return { q, r };
}

async function approve(tx: Db, caller: Caller, q: { id: string; number: string }, r: Row, note: string, override: boolean): Promise<void> {
  await assertRevocable(tx, r);
  await exec(
    tx,
    `UPDATE qms_revoke_requests SET status='Approved', decided_by_id=$1::uuid, decided_at=now(), decision_note=$2, override=$3::boolean WHERE id=$4::uuid`,
    caller.auth.userId,
    note,
    override,
    q.id,
  );
  await exec(
    tx,
    `UPDATE qms_rejections SET status='Revoked', updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
    caller.auth.userId,
    S(r.id),
  );
  await event(tx, 'REVOKE', q.id, override ? 'APPROVED BY OVERRIDE' : 'APPROVED', caller.auth.userId, note);
  await audit(tx, caller, caller.auth.userId, 'QMS_REJECTION_REVOKED', 'qms_rejection', { id: S(r.id), code: S(r.number) }, REVOKE_PAGE, {
    request: q.number,
    note,
    override,
  });
}

export const revokeService = {
  async request(caller: Caller, rejectionId: string, reason: string) {
    const text = need(reason, 'reason', 'Give the reason for revoking (at least 5 letters).');
    await fyOfCaller(caller);
    return prisma.$transaction(async (tx) => {
      const r = await lockRejection(tx, caller, rejectionId);
      await assertRevocable(tx, r);
      const q = await addRequest(tx, caller, r, text);
      await alertPeople(
        tx,
        (await qualityLeads(tx, S(r.unit_id))).filter((u) => u !== caller.auth.userId),
        'quality.pending',
        `${q.number}: revoke of ${S(r.number)} requested`,
        text,
        { type: 'qms_revoke', id: q.id },
        '/m/qms-rejection-revoke',
        `quality-pending:${q.id}`,
      );
      await audit(tx, caller, caller.auth.userId, 'QMS_REVOKE_REQUESTED', 'qms_rejection', { id: S(r.id), code: S(r.number) }, REVOKE_PAGE, {
        request: q.number,
        reason: text,
      });
      return q;
    }, TX);
  },

  async decide(caller: Caller, requestId: string, approved: boolean, note: string) {
    const text = need(note, 'note', 'Write why you approve or refuse (at least 5 letters).');
    await prisma.$transaction(async (tx) => {
      const { q, r } = await lockRequest(tx, caller, requestId);
      const own = S(q.requested_by_id) === caller.auth.userId;
      if (own && !hasQualityOverride(caller))
        throw new AppError(422, 'QMS_REVOKE_OWN', 'Somebody else must decide your own request.', { note: 'Somebody else must decide your own request.' });
      await assertCriticalAllowed(tx, caller, r.priority);
      if (approved) await approve(tx, caller, { id: requestId, number: S(q.number) }, r, text, own);
      else {
        await exec(
          tx,
          `UPDATE qms_revoke_requests SET status='Refused', decided_by_id=$1::uuid, decided_at=now(), decision_note=$2 WHERE id=$3::uuid`,
          caller.auth.userId,
          text,
          requestId,
        );
        await event(tx, 'REVOKE', requestId, 'REFUSED', caller.auth.userId, text);
        await audit(tx, caller, caller.auth.userId, 'QMS_REVOKE_REFUSED', 'qms_rejection', { id: S(r.id), code: S(r.number) }, REVOKE_PAGE, {
          request: S(q.number),
          note: text,
        });
      }
      await alertPeople(
        tx,
        [S(q.requested_by_id)].filter((u) => u && u !== caller.auth.userId),
        'quality.returned',
        `${S(q.number)} was ${approved ? 'approved' : 'refused'}`,
        text,
        { type: 'qms_revoke', id: requestId },
        '/m/qms-rejection-revoke',
        `quality-revoke:${requestId}`,
      );
    }, TX);
    return this.get(caller, requestId);
  },

  /** Rejection Revoke Override: the MR / Quality Head revokes in one step, still with a reason. */
  async override(caller: Caller, rejectionId: string, reason: string) {
    if (!hasQualityOverride(caller))
      throw Errors.forbidden('Only the Quality Head, the Management Representative or an administrator can override.');
    const text = need(reason, 'reason', 'Give the reason for revoking (at least 5 letters).');
    await fyOfCaller(caller);
    const id = await prisma.$transaction(async (tx) => {
      const r = await lockRejection(tx, caller, rejectionId);
      await assertRevocable(tx, r);
      const waiting = (await query(tx, `SELECT id::text AS id, number FROM qms_revoke_requests WHERE rejection_id=$1::uuid AND status='Pending'`, rejectionId))[0];
      const q = waiting ? { id: S(waiting.id), number: S(waiting.number) } : await addRequest(tx, caller, r, text);
      await approve(tx, caller, q, r, text, true);
      return q.id;
    }, TX);
    return this.get(caller, id);
  },

  async withdraw(caller: Caller, requestId: string) {
    await prisma.$transaction(async (tx) => {
      const { q, r } = await lockRequest(tx, caller, requestId);
      if (S(q.requested_by_id) !== caller.auth.userId && !hasQualityOverride(caller))
        throw Errors.forbidden('Only the person who asked can withdraw the request.');
      await exec(tx, `UPDATE qms_revoke_requests SET status='Withdrawn', decided_by_id=$1::uuid, decided_at=now() WHERE id=$2::uuid`, caller.auth.userId, requestId);
      await event(tx, 'REVOKE', requestId, 'WITHDRAWN', caller.auth.userId);
      await audit(tx, caller, caller.auth.userId, 'QMS_REVOKE_WITHDRAWN', 'qms_rejection', { id: S(r.id), code: S(r.number) }, REVOKE_PAGE, {
        request: S(q.number),
      });
    }, TX);
    return this.get(caller, requestId);
  },

  async get(caller: Caller, requestId: string) {
    const sc = await scopeSql(caller, REVOKE_PAGE);
    const r = (
      await query(
        prisma,
        `SELECT q.*, t.number AS rejection_number, t.part, t.hold_qty::text AS hold_qty, t.defect,
            a.name AS requested_by_name, b.name AS decided_by_name
           FROM qms_revoke_requests q JOIN qms_rejections t ON t.id=q.rejection_id
           LEFT JOIN users a ON a.id=q.requested_by_id LEFT JOIN users b ON b.id=q.decided_by_id
          WHERE q.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        requestId,
      )
    )[0];
    if (!r) throw Errors.notFound('Revoke request not found.');
    return { ...norm(r), events: await trail('REVOKE', requestId) };
  },

  /** One rejection with every revoke request made for it and the trail of each. */
  async history(caller: Caller, rejectionId: string) {
    const sc = await scopeSql(caller, REVOKE_PAGE);
    const r = (
      await query(
        prisma,
        `SELECT t.*, i.name AS item_name FROM qms_rejections t LEFT JOIN items i ON i.id=t.item_id WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        rejectionId,
      )
    )[0];
    if (!r) throw Errors.notFound('Rejection not found.');
    // unpaginated: the requests of one rejection
    const requests = await query(
      prisma,
      `SELECT q.*, a.name AS requested_by_name, b.name AS decided_by_name FROM qms_revoke_requests q
         LEFT JOIN users a ON a.id=q.requested_by_id LEFT JOIN users b ON b.id=q.decided_by_id
        WHERE q.rejection_id=$1::uuid ORDER BY q.requested_at DESC`,
      rejectionId,
    );
    return {
      rejection: norm(r),
      requests: await Promise.all(requests.map(async (q) => ({ ...norm(q), events: await trail('REVOKE', S(q.id)) }))),
    };
  },

  /** Rejected lots, requests waiting and the share of rejections revoked. */
  async counts(caller: Caller) {
    const sc = await scopeSql(caller, REVOKE_PAGE);
    const r = (
      await query(
        prisma,
        `SELECT count(*) FILTER (WHERE t.status <> 'Cancelled')::int AS rejected,
            count(*) FILTER (WHERE t.status='Revoked')::int AS revoked,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM qms_revoke_requests q WHERE q.rejection_id=t.id AND q.status='Pending'))::int AS pending
          FROM qms_rejections t WHERE ${sc.sql}`,
        ...sc.args,
      )
    )[0]!;
    const c = norm<{ rejected: number; revoked: number; pending: number }>(r);
    return { ...c, revokedPct: c.rejected ? Math.round((c.revoked / c.rejected) * 1000) / 10 : 0 };
  },
};
