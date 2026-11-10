// Phase 20-J: DPDP Rules compliance — Privacy Notice (En/Hi/Mr), Data-Principal Request Register
// (30-day SLA), Retention policies, and automated candidate anonymisation sweep.
import { recordAudit } from '../../core/audit/audit-service';
import { prisma, type Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering/numbering-service';
import { exec, fyOfCaller, norm, query, type Row } from '../procurement/core';
import type { Caller } from '../records/service';

async function queryOne(db: Db | typeof prisma, sql: string, params: unknown[] = []): Promise<Row | null> {
  const rows = await query(db, sql, ...params);
  return rows[0] ?? null;
}

function requireUnit(caller: Caller): string {
  if (!caller.ctx.unitId) throw Errors.contextInvalid('Choose a concrete unit first.');
  return caller.ctx.unitId;
}

export const DPDP_SLA_DAYS = 30;

export interface CreateDpdpRequestInput {
  requestType: 'ACCESS' | 'CORRECTION' | 'ERASURE';
  principalType: 'EMPLOYEE' | 'CUSTOMER' | 'SUPPLIER' | 'CONTACT';
  principalId?: string | null;
  principalName: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  description: string;
}

export interface UpdateDpdpRequestInput {
  status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED';
  resolutionNotes?: string;
}

export const dpdpService = {
  async getNotice(userId: string, locale: 'en' | 'hi' | 'mr' = 'en'): Promise<Row> {
    const notice = await queryOne(
      prisma,
      `SELECT id, version, title, text_md, effective_from, grievance_officer_name, grievance_officer_email, grievance_officer_phone, needs_review
       FROM privacy_notices
       ORDER BY effective_from DESC, created_at DESC
       LIMIT 1`,
    );
    if (!notice) throw Errors.notFound('No active privacy notice found.');

    const tr = await queryOne(
      prisma,
      `SELECT title, text_md FROM privacy_notice_translations WHERE notice_id = $1::uuid AND locale = $2`,
      [notice.id, locale],
    );
    const acc = await queryOne(
      prisma,
      `SELECT accepted_at FROM privacy_notice_acceptances WHERE notice_id = $1::uuid AND user_id = $2::uuid`,
      [notice.id, userId],
    );

    const n = norm(notice);
    return {
      ...n,
      locale,
      localizedTitle: tr ? String(tr.title) : String(n.title),
      localizedTextMd: tr ? String(tr.text_md) : String(n.textMd),
      accepted: Boolean(acc),
      acceptedAt: acc ? acc.accepted_at : null,
    };
  },

  async acknowledgeNotice(userId: string, noticeId: string, ip: string | null): Promise<Row> {
    const notice = await queryOne(prisma, `SELECT id, version FROM privacy_notices WHERE id = $1::uuid`, [noticeId]);
    if (!notice) throw Errors.notFound('Privacy notice not found.');
    await exec(
      prisma,
      `INSERT INTO privacy_notice_acceptances (notice_id, user_id, ip)
       VALUES ($1::uuid, $2::uuid, $3)
       ON CONFLICT (notice_id, user_id) DO NOTHING`,
      noticeId,
      userId,
      ip,
    );
    await recordAudit({
      action: 'DPDP_NOTICE_ACCEPTED',
      actorId: userId,
      targetType: 'PrivacyNotice',
      targetId: noticeId,
      detail: { version: String(notice.version) },
    });
    return { accepted: true, noticeId };
  },

  async listRequests(status?: string): Promise<Row[]> {
    const rows = await query(
      prisma,
      `SELECT r.*,
              (r.due_at < now() AND r.status IN ('OPEN', 'IN_PROGRESS')) AS is_overdue,
              GREATEST(0, CEIL(EXTRACT(EPOCH FROM (r.due_at - now())) / 86400))::int AS days_remaining
       FROM dpdp_requests r
       WHERE ($1::text IS NULL OR r.status = $1)
       ORDER BY r.due_at ASC, r.created_at DESC`,
      status ?? null,
    );
    return rows.map((r) => norm(r));
  },

  async createRequest(caller: Caller, input: CreateDpdpRequestInput): Promise<Row> {
    const fy = await fyOfCaller(caller);
    const unitId = requireUnit(caller);
    const created = await prisma.$transaction(async (tx) => {
      const requestNo = await NumberingService.allocate(tx, {
        docType: 'dpdp-requests',
        unitId,
        fyId: fy.id,
      });
      const dueAt = new Date(Date.now() + DPDP_SLA_DAYS * 86_400_000);
      const inserted = await queryOne(
        tx,
        `INSERT INTO dpdp_requests (
           request_no, request_type, principal_type, principal_id, principal_name,
           contact_email, contact_phone, description, due_at, created_by_id
         ) VALUES ($1, $2, $3, $4::uuid, $5, $6, $7, $8, $9, $10::uuid)
         RETURNING *`,
        [
          requestNo,
          input.requestType,
          input.principalType,
          input.principalId ?? null,
          input.principalName,
          input.contactEmail ?? null,
          input.contactPhone ?? null,
          input.description,
          dueAt,
          caller.auth.userId,
        ],
      );
      if (!inserted) throw new Error('Failed to create DPDP request');
      await recordAudit(
        {
          action: 'DPDP_REQUEST_CREATED',
          actorId: caller.auth.userId,
          targetType: 'DpdpRequest',
          targetId: String(inserted.id),
          meta: caller.meta,
          detail: { requestNo, requestType: input.requestType, dueAt: dueAt.toISOString() },
        },
        tx,
      );
      return inserted;
    });
    return norm(created);
  },

  async updateRequest(caller: Caller, id: string, input: UpdateDpdpRequestInput): Promise<Row> {
    const existing = await queryOne(prisma, `SELECT * FROM dpdp_requests WHERE id = $1::uuid`, [id]);
    if (!existing) throw Errors.notFound('DPDP request not found.');
    const resolvedAt =
      input.status === 'COMPLETED' || input.status === 'REJECTED' ? new Date() : null;
    const updated = await queryOne(
      prisma,
      `UPDATE dpdp_requests
       SET status = $2,
           resolution_notes = COALESCE($3, resolution_notes),
           resolved_at = COALESCE($4, resolved_at),
           handled_by_id = $5::uuid,
           updated_at = now(),
           version = version + 1
       WHERE id = $1::uuid
       RETURNING *`,
      [id, input.status, input.resolutionNotes ?? null, resolvedAt, caller.auth.userId],
    );
    if (!updated) throw Errors.notFound('DPDP request not found.');
    await recordAudit({
      action: 'DPDP_REQUEST_UPDATED',
      actorId: caller.auth.userId,
      targetType: 'DpdpRequest',
      targetId: id,
      meta: caller.meta,
      detail: { status: input.status },
    });
    return norm(updated);
  },

  async listRetentionPolicies(): Promise<Row[]> {
    const rows = await query(prisma, `SELECT * FROM dpdp_retention_policies ORDER BY data_category`);
    return rows.map((r) => norm(r));
  },

  /** Anonymises non-statutory candidate PII past retention window; statutory ledgers remain intact. */
  async runRetentionSweep(actorId?: string | null): Promise<{ anonymizedCandidates: number; checkedAt: string }> {
    const policy = await queryOne(
      prisma,
      `SELECT retention_days, anonymize_enabled FROM dpdp_retention_policies WHERE data_category = 'RECRUITMENT_CANDIDATES'`,
    );
    const days = Number(policy?.retention_days ?? 365);
    let anonymizedCandidates = 0;

    if (policy?.anonymize_enabled) {
      const updated = await prisma.$executeRaw`
        UPDATE candidates c
        SET name = 'Anonymised Candidate',
            email = NULL,
            mobile = NULL
        WHERE c.name <> 'Anonymised Candidate'
          AND (
            (c.purge_after IS NOT NULL AND c.purge_after <= CURRENT_DATE)
            OR (
              c.created_at < now() - (${days}::int * interval '1 day')
              AND EXISTS (
                SELECT 1 FROM candidate_applications ca
                WHERE ca.candidate_id = c.id AND ca.stage IN ('REJECTED', 'WITHDRAWN')
              )
            )
          )
      `;
      anonymizedCandidates = Number(updated);
    }

    await exec(
      prisma,
      `UPDATE dpdp_retention_policies
       SET last_run_at = now(),
           last_affected_count = CASE WHEN data_category = 'RECRUITMENT_CANDIDATES' THEN $1 ELSE 0 END,
           updated_at = now()`,
      anonymizedCandidates,
    );

    await recordAudit({
      action: 'DPDP_RETENTION_SWEEP',
      actorId: actorId ?? null,
      targetType: 'DpdpRetention',
      detail: { anonymizedCandidates, candidateRetentionDays: days },
    });

    return { anonymizedCandidates, checkedAt: new Date().toISOString() };
  },
};
