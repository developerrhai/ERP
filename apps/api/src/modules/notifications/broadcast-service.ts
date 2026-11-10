// Phase 21 §5.6: Admin Broadcast Announcements — audience resolution, Director+ approval
// (threshold > 50 or EMAIL/SMS or CRITICAL), Emergency bypass for Super User / Administrator,
// 500-user batch delivery with pg_notify('erp_rt'), pinned banners, blocking acks, withdraw & cancel.
import { recordAudit } from '../../core/audit/audit-service';
import { prisma, type Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering/numbering-service';
import { approvalService } from '../approvals/service';
import { notificationService } from './service';
import { emitRealtimeNotify } from './realtime';

export interface BroadcastAudienceSpec {
  all?: boolean;
  unitIds?: string[];
  departments?: string[];
  roles?: string[];
  userIds?: string[];
}

export interface BroadcastInput {
  title: string;
  bodyMd: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  audience: BroadcastAudienceSpec;
  channels?: ('IN_APP' | 'PUSH' | 'EMAIL' | 'SMS')[];
  emergency?: boolean;
  reason?: string;
  scheduledAt?: string | null;
  expiresAt?: string | null;
  pinBanner?: boolean;
  requireAck?: boolean;
}

const VALID_SEVERITIES = new Set(['INFO', 'WARNING', 'CRITICAL']);
const VALID_CHANNELS = new Set(['IN_APP', 'PUSH', 'EMAIL', 'SMS']);

async function resolveAudienceQuery(db: Db | typeof prisma, audience: BroadcastAudienceSpec): Promise<{
  userIds: string[];
  count: number;
  byUnit: { unitId: string | null; unitCode: string; count: number }[];
}> {
  if (audience.all) {
    const users = await db.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM users WHERE status = 'ACTIVE' ORDER BY id
    `;
    const byUnit = await db.$queryRaw<{ unit_id: string | null; unit_code: string; cnt: number }[]>`
      SELECT un.id::text AS unit_id, COALESCE(un.code, 'UNASSIGNED') AS unit_code, count(DISTINCT u.id)::int AS cnt
      FROM users u
      LEFT JOIN user_units uu ON uu.user_id = u.id
      LEFT JOIN units un ON un.id = uu.unit_id
      WHERE u.status = 'ACTIVE'
      GROUP BY un.id, un.code
      ORDER BY unit_code
    `;
    return {
      userIds: users.map((u) => u.id),
      count: users.length,
      byUnit: byUnit.map((r) => ({ unitId: r.unit_id, unitCode: r.unit_code, count: r.cnt })),
    };
  }

  const unitIds = Array.isArray(audience.unitIds) ? audience.unitIds.filter(Boolean) : [];
  const departments = Array.isArray(audience.departments) ? audience.departments.filter(Boolean) : [];
  const roles = Array.isArray(audience.roles) ? audience.roles.filter(Boolean) : [];
  const explicitUserIds = Array.isArray(audience.userIds) ? audience.userIds.filter(Boolean) : [];

  if (unitIds.length === 0 && departments.length === 0 && roles.length === 0 && explicitUserIds.length === 0) {
    return { userIds: [], count: 0, byUnit: [] };
  }

  const userRows = await db.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT u.id::text AS id
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.status = 'ACTIVE'
      AND (
        (${explicitUserIds.length > 0} AND u.id = ANY(${explicitUserIds}::uuid[]))
        OR (${roles.length > 0} AND (r.name = ANY(${roles}::text[]) OR r.id::text = ANY(${roles}::text[])))
        OR (${unitIds.length > 0} AND (
          EXISTS (SELECT 1 FROM user_units uu WHERE uu.user_id = u.id AND uu.unit_id = ANY(${unitIds}::uuid[]))
          OR EXISTS (
            SELECT 1 FROM employees e
            JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.effective_to IS NULL
            WHERE e.user_id = u.id AND e.deleted_at IS NULL AND ea.unit_id = ANY(${unitIds}::uuid[])
          )
        ))
        OR (${departments.length > 0} AND EXISTS (
          SELECT 1 FROM employees e
          JOIN employee_assignments ea ON ea.employee_id = e.id AND ea.effective_to IS NULL
          WHERE e.user_id = u.id AND e.deleted_at IS NULL AND ea.department = ANY(${departments}::text[])
        ))
      )
    ORDER BY id
  `;

  const userIds = userRows.map((u) => u.id);
  if (userIds.length === 0) {
    return { userIds: [], count: 0, byUnit: [] };
  }

  const byUnit = await db.$queryRaw<{ unit_id: string | null; unit_code: string; cnt: number }[]>`
    SELECT un.id::text AS unit_id, COALESCE(un.code, 'UNASSIGNED') AS unit_code, count(DISTINCT u.id)::int AS cnt
    FROM users u
    LEFT JOIN user_units uu ON uu.user_id = u.id
    LEFT JOIN units un ON un.id = uu.unit_id
    WHERE u.id = ANY(${userIds}::uuid[])
    GROUP BY un.id, un.code
    ORDER BY unit_code
  `;

  return {
    userIds,
    count: userIds.length,
    byUnit: byUnit.map((r) => ({ unitId: r.unit_id, unitCode: r.unit_code, count: r.cnt })),
  };
}

let handlerRegistered = false;
export function ensureBroadcastApprovalHandler(): void {
  if (handlerRegistered) return;
  handlerRegistered = true;
  approvalService.register('BROADCAST', {
    async snapshot(tx, docId) {
      const rows = await tx.$queryRaw<
        { id: string; number: string; title: string; status: string; created_by_id: string; version: number }[]
      >`SELECT id, number, title, status, created_by_id, version FROM broadcasts WHERE id = ${docId}::uuid FOR UPDATE`;
      const b = rows[0];
      if (!b) return null;
      const unitRow = await tx.unit.findFirst({ select: { id: true } });
      return {
        code: b.number,
        title: b.title,
        amount: null,
        department: 'Admin',
        unitId: unitRow?.id ?? '00000000-0000-0000-0000-000000000000',
        createdBy: b.created_by_id,
        status: b.status === 'PENDING_APPROVAL' ? 'Pending Approval' : b.status === 'DRAFT' ? 'Draft' : b.status,
        version: b.version,
        fyOpen: true,
      };
    },
    async onSubmitted(tx, docId, req) {
      await tx.$executeRaw`
        UPDATE broadcasts SET status = 'PENDING_APPROVAL', approval_request_id = ${req.id}::uuid, updated_at = now()
        WHERE id = ${docId}::uuid
      `;
    },
    async onApproved(tx, docId) {
      await tx.$executeRaw`
        UPDATE broadcasts SET status = 'SCHEDULED', updated_at = now()
        WHERE id = ${docId}::uuid AND status = 'PENDING_APPROVAL'
      `;
    },
    async onRejected(tx, docId) {
      await tx.$executeRaw`
        UPDATE broadcasts SET status = 'CANCELLED', updated_at = now()
        WHERE id = ${docId}::uuid AND status = 'PENDING_APPROVAL'
      `;
    },
    async onReturned(tx, docId) {
      await tx.$executeRaw`
        UPDATE broadcasts SET status = 'DRAFT', updated_at = now()
        WHERE id = ${docId}::uuid AND status = 'PENDING_APPROVAL'
      `;
    },
  });
}

export const broadcastService = {
  async previewAudience(audience: BroadcastAudienceSpec) {
    return resolveAudienceQuery(prisma, audience);
  },

  async listAdmin() {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT b.*, u.full_name AS created_by_name,
             (SELECT count(*)::int FROM broadcast_recipients br WHERE br.broadcast_id = b.id) AS delivered_count,
             (SELECT count(*)::int FROM broadcast_recipients br WHERE br.broadcast_id = b.id AND br.read_at IS NOT NULL) AS read_count,
             (SELECT count(*)::int FROM broadcast_recipients br WHERE br.broadcast_id = b.id AND br.acked_at IS NOT NULL) AS acked_count
      FROM broadcasts b
      JOIN users u ON u.id = b.created_by_id
      ORDER BY b.created_at DESC
      LIMIT 200
    `;
    return rows;
  },

  async getById(id: string) {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT b.*, u.full_name AS created_by_name
      FROM broadcasts b
      JOIN users u ON u.id = b.created_by_id
      WHERE b.id = ${id}::uuid
    `;
    return rows[0] ?? null;
  },

  async createDraft(caller: { userId: string; roleLevel: number; unitId?: string }, input: BroadcastInput) {
    const title = (input.title ?? '').trim();
    const bodyMd = (input.bodyMd ?? '').trim();
    if (!title || title.length > 120) throw Errors.validation({ title: 'Title is required (max 120 chars).' });
    if (!bodyMd || bodyMd.length > 4000) throw Errors.validation({ bodyMd: 'Message is required (max 4000 chars).' });

    const emergency = Boolean(input.emergency);
    if (emergency) {
      if (caller.roleLevel < 95) {
        throw Errors.forbidden('Emergency broadcast bypass requires Administrator or Super User.');
      }
      if (!input.reason || input.reason.trim().length < 5) {
        throw Errors.validation({ reason: 'Emergency broadcasts require a mandatory audit reason (min 5 chars).' });
      }
    }

    const severity = emergency ? 'CRITICAL' : (input.severity ?? 'INFO');
    if (!VALID_SEVERITIES.has(severity)) {
      throw Errors.validation({ severity: 'Invalid severity.' });
    }

    let channels = (input.channels && input.channels.length > 0 ? input.channels : ['IN_APP']).filter((c) =>
      VALID_CHANNELS.has(c),
    );
    if (!channels.includes('IN_APP')) channels = ['IN_APP', ...channels];
    if (emergency) {
      channels = ['IN_APP', 'PUSH'];
    }

    const resolved = await resolveAudienceQuery(prisma, input.audience ?? { all: true });
    if (resolved.count === 0) {
      throw Errors.validation({ audience: 'Target audience matches 0 active users.' });
    }

    return prisma.$transaction(async (tx) => {
      const unitRow = caller.unitId
        ? { id: caller.unitId }
        : await tx.unit.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } });
      let brcNumber = `BRC-${Date.now().toString().slice(-6)}`;
      if (unitRow) {
        const fyRow = await tx.financialYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
        if (fyRow) {
          brcNumber = await NumberingService.next(tx, {
            docType: 'admin-notif-broadcast',
            unitId: unitRow.id,
            fyId: fyRow.id,
          });
        }
      }

      const rows = await tx.$queryRaw<any[]>`
        INSERT INTO broadcasts (
          number, title, body_md, severity, audience, channels, emergency,
          scheduled_at, expires_at, pin_banner, require_ack, status,
          recipient_count, created_by_id, reason
        )
        VALUES (
          ${brcNumber},
          ${title},
          ${bodyMd},
          ${severity},
          ${JSON.stringify(input.audience ?? { all: true })}::jsonb,
          ${channels}::text[],
          ${emergency},
          ${input.scheduledAt ? new Date(input.scheduledAt) : null},
          ${input.expiresAt ? new Date(input.expiresAt) : null},
          ${Boolean(input.pinBanner)},
          ${Boolean(input.requireAck)},
          'DRAFT',
          ${resolved.count},
          ${caller.userId}::uuid,
          ${input.reason?.trim() ?? null}
        )
        RETURNING *
      `;
      await recordAudit({
        action: 'BROADCAST_CREATED',
        actorId: caller.userId,
        targetType: 'Broadcast',
        targetId: rows[0].id,
        detail: { number: brcNumber, recipientCount: resolved.count, emergency },
      });
      return rows[0];
    });
  },

  async submit(caller: { userId: string; roleLevel: number }, id: string) {
    ensureBroadcastApprovalHandler();
    const row = await this.getById(id);
    if (!row) throw Errors.notFound('Broadcast not found.');
    if (row.status !== 'DRAFT') {
      throw Errors.validation({ status: `Cannot submit broadcast in status ${row.status}.` });
    }

    const audience = (row.audience ?? { all: true }) as BroadcastAudienceSpec;
    const resolved = await resolveAudienceQuery(prisma, audience);
    const channels = (row.channels ?? ['IN_APP']) as string[];

    const settingsRows = await prisma.$queryRaw<{ broadcast_approval_threshold_users: number }[]>`
      SELECT broadcast_approval_threshold_users FROM notification_settings WHERE id = 1
    `;
    const threshold = settingsRows[0]?.broadcast_approval_threshold_users ?? 50;

    if (row.emergency) {
      if (caller.roleLevel < 95) {
        throw Errors.forbidden('Emergency broadcast bypass requires Administrator or Super User.');
      }
      await prisma.$executeRaw`
        UPDATE broadcasts
        SET status = 'SCHEDULED', recipient_count = ${resolved.count}, updated_at = now()
        WHERE id = ${id}::uuid
      `;
      await recordAudit({
        action: 'BROADCAST_EMERGENCY_BYPASS',
        actorId: caller.userId,
        targetType: 'Broadcast',
        targetId: id,
        detail: { reason: row.reason, recipientCount: resolved.count },
      });
      const scheduledAt = row.scheduled_at ? new Date(row.scheduled_at) : null;
      if (!scheduledAt || scheduledAt.getTime() <= Date.now()) {
        await this.deliverBroadcast(id);
      }
      return this.getById(id);
    }

    const needsApproval =
      resolved.count > threshold ||
      channels.includes('EMAIL') ||
      channels.includes('SMS') ||
      row.severity === 'CRITICAL';

    if (needsApproval) {
      const approvalReqId = await prisma.$transaction(async (tx) => {
        const approvers = await tx.$queryRaw<{ id: string }[]>`
          SELECT u.id::text AS id
          FROM users u
          JOIN roles r ON r.id = u.role_id
          WHERE u.status = 'ACTIVE' AND r.level >= 90 AND u.id <> ${row.created_by_id}::uuid
        `;
        if (approvers.length === 0) {
          throw Errors.validation({
            approval: 'No eligible Director+ approver (other than creator) is active in the system.',
          });
        }
        const unitRow = await tx.unit.findFirst({ select: { id: true } });
        const deptRow = await tx.department.findFirst({ select: { id: true } });
        if (!unitRow || !deptRow) {
          throw Errors.validation({ approval: 'Default unit/department missing for approval workflow.' });
        }
        const req = await tx.approvalRequest.create({
          data: {
            docType: 'BROADCAST',
            docId: id,
            docCode: row.number,
            docTitle: row.title,
            unitId: unitRow.id,
            departmentId: deptRow.id,
            status: 'PENDING',
            currentLevel: 1,
            totalLevels: 1,
            requestedBy: caller.userId,
            createdById: row.created_by_id,
          },
        });
        const step = await tx.approvalStep.create({
          data: {
            requestId: req.id,
            level: 1,
            status: 'ACTIVE',
            activatedAt: new Date(),
            dueAt: new Date(Date.now() + 24 * 3600 * 1000),
          },
        });
        await tx.approvalStepAssignee.createMany({
          data: approvers.map((a) => ({ stepId: step.id, userId: a.id, via: 'ROLE' })),
          skipDuplicates: true,
        });
        await tx.$executeRaw`
          UPDATE broadcasts
          SET status = 'PENDING_APPROVAL', approval_request_id = ${req.id}::uuid,
              recipient_count = ${resolved.count}, updated_at = now()
          WHERE id = ${id}::uuid
        `;
        await notificationService.notify(
          tx,
          approvers.map((a) => a.id),
          {
            type: 'APPROVAL_ASSIGNED',
            title: `Broadcast approval needed: ${row.title}`,
            body: `${row.number} reaches ${resolved.count} active users (${channels.join(', ')}).`,
            link: `/m/admin-notif-broadcast`,
            entityType: 'BROADCAST',
            entityId: id,
            docCode: row.number,
          },
        );
        return req.id;
      });
      await recordAudit({
        action: 'BROADCAST_SUBMITTED_FOR_APPROVAL',
        actorId: caller.userId,
        targetType: 'Broadcast',
        targetId: id,
        detail: { approvalRequestId: approvalReqId, recipientCount: resolved.count },
      });
      return this.getById(id);
    }

    await prisma.$executeRaw`
      UPDATE broadcasts
      SET status = 'SCHEDULED', recipient_count = ${resolved.count}, updated_at = now()
      WHERE id = ${id}::uuid
    `;
    const scheduledAt = row.scheduled_at ? new Date(row.scheduled_at) : null;
    if (!scheduledAt || scheduledAt.getTime() <= Date.now()) {
      await this.deliverBroadcast(id);
    }
    return this.getById(id);
  },

  /** Director+ direct approval helper (checks creator != approver & Director+ level >= 90). */
  async decideApproval(
    caller: { userId: string; roleLevel: number },
    id: string,
    decision: 'APPROVE' | 'REJECT',
    comment?: string,
  ) {
    if (caller.roleLevel < 90) {
      throw Errors.forbidden('Director or higher role is required to approve broadcasts.');
    }
    const row = await this.getById(id);
    if (!row) throw Errors.notFound('Broadcast not found.');
    if (row.status !== 'PENDING_APPROVAL') {
      throw Errors.validation({ status: `Broadcast is not pending approval (${row.status}).` });
    }
    if (row.created_by_id === caller.userId) {
      throw Errors.forbidden('Creator of a broadcast cannot approve it.');
    }

    if (row.approval_request_id) {
      await prisma.$transaction(async (tx) => {
        await tx.approvalRequest.update({
          where: { id: row.approval_request_id },
          data: { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedAt: new Date() },
        });
        await tx.approvalStep.updateMany({
          where: { requestId: row.approval_request_id, status: 'ACTIVE' },
          data: {
            status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
            actedBy: caller.userId,
            actedAt: new Date(),
            comment: comment ?? null,
          },
        });
        await tx.$executeRaw`
          UPDATE broadcasts
          SET status = ${decision === 'APPROVE' ? 'SCHEDULED' : 'CANCELLED'}, updated_at = now()
          WHERE id = ${id}::uuid
        `;
      });
    } else {
      await prisma.$executeRaw`
        UPDATE broadcasts
        SET status = ${decision === 'APPROVE' ? 'SCHEDULED' : 'CANCELLED'}, updated_at = now()
        WHERE id = ${id}::uuid
      `;
    }

    await recordAudit({
      action: decision === 'APPROVE' ? 'BROADCAST_APPROVED' : 'BROADCAST_REJECTED',
      actorId: caller.userId,
      targetType: 'Broadcast',
      targetId: id,
      detail: { comment },
    });

    if (decision === 'APPROVE') {
      const scheduledAt = row.scheduled_at ? new Date(row.scheduled_at) : null;
      if (!scheduledAt || scheduledAt.getTime() <= Date.now()) {
        await this.deliverBroadcast(id);
      }
    }
    return this.getById(id);
  },

  /** Delivers a SCHEDULED broadcast in 500-user batches with per-batch NOTIFY. */
  async deliverBroadcast(id: string): Promise<{ delivered: number }> {
    const claimed = await prisma.$queryRaw<any[]>`
      UPDATE broadcasts
      SET status = 'SENDING', updated_at = now()
      WHERE id = ${id}::uuid AND status = 'SCHEDULED'
      RETURNING *
    `;
    const b = claimed[0];
    if (!b) return { delivered: 0 };

    const resolved = await resolveAudienceQuery(prisma, (b.audience ?? { all: true }) as BroadcastAudienceSpec);
    const recipients = resolved.userIds;
    const priority = b.emergency || b.severity === 'CRITICAL' ? 'URGENT' : b.severity === 'WARNING' ? 'HIGH' : 'NORMAL';
    const severity: 'INFO' | 'ACTION' | 'WARN' =
      b.severity === 'CRITICAL' || b.severity === 'WARNING' ? 'WARN' : 'INFO';
    const expiresAt = b.expires_at ? new Date(b.expires_at) : undefined;
    let totalDelivered = 0;

    for (let i = 0; i < recipients.length; i += 500) {
      const batch = recipients.slice(i, i + 500);
      await prisma.$transaction(async (tx) => {
        const sentUsers = await notificationService.notify(tx, batch, {
          type: 'BROADCAST_ANNOUNCEMENT',
          title: b.title,
          body: String(b.body_md).slice(0, 900),
          severity,
          priority,
          link: '/notifications',
          entityType: 'BROADCAST',
          entityId: b.id,
          broadcastId: b.id,
          expiresAt,
          dedupeKey: `brc:${b.id}`,
        });
        for (const uid of batch) {
          const notifRows = await tx.$queryRaw<{ id: string }[]>`
            SELECT id::text AS id FROM notifications
            WHERE broadcast_id = ${b.id}::uuid AND user_id = ${uid}::uuid
            LIMIT 1
          `;
          await tx.$executeRaw`
            INSERT INTO broadcast_recipients (broadcast_id, user_id, notification_id)
            VALUES (${b.id}::uuid, ${uid}::uuid, ${notifRows[0]?.id ?? null}::uuid)
            ON CONFLICT (broadcast_id, user_id) DO NOTHING
          `;
        }
        if (sentUsers.length > 0 && b.pin_banner) {
          await emitRealtimeNotify(tx, { u: sentUsers, k: 'b', ids: [b.id] });
        }
        totalDelivered += batch.length;
      });
    }

    await prisma.$executeRaw`
      UPDATE broadcasts
      SET status = 'SENT', sent_at = now(), recipient_count = ${totalDelivered}, updated_at = now()
      WHERE id = ${b.id}::uuid
    `;
    return { delivered: totalDelivered };
  },

  async processDueScheduledBroadcasts(): Promise<number> {
    const due = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM broadcasts
      WHERE status = 'SCHEDULED' AND (scheduled_at IS NULL OR scheduled_at <= now())
      ORDER BY scheduled_at ASC NULLS FIRST
      LIMIT 20
    `;
    let processed = 0;
    for (const row of due) {
      await this.deliverBroadcast(row.id);
      processed += 1;
    }
    return processed;
  },

  async withdraw(caller: { userId: string }, id: string, reason?: string) {
    const row = await this.getById(id);
    if (!row) throw Errors.notFound('Broadcast not found.');
    if (row.status !== 'SENT' && row.status !== 'SENDING') {
      throw Errors.validation({ status: 'Only SENT broadcasts can be withdrawn. Use Cancel for scheduled ones.' });
    }
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE broadcasts
        SET status = 'WITHDRAWN', withdrawn_by_id = ${caller.userId}::uuid, withdrawn_at = now(),
            reason = COALESCE(${reason ?? null}, reason), updated_at = now()
        WHERE id = ${id}::uuid
      `;
      await tx.$executeRaw`
        UPDATE notifications
        SET archived_at = COALESCE(archived_at, now()), expires_at = now()
        WHERE broadcast_id = ${id}::uuid
      `;
      const recips = await tx.$queryRaw<{ user_id: string }[]>`
        SELECT user_id::text AS user_id FROM broadcast_recipients WHERE broadcast_id = ${id}::uuid
      `;
      for (let i = 0; i < recips.length; i += 400) {
        const chunk = recips.slice(i, i + 400).map((r) => r.user_id);
        await emitRealtimeNotify(tx, { u: chunk, k: 'b', ids: [id] });
      }
    });
    await recordAudit({
      action: 'BROADCAST_WITHDRAWN',
      actorId: caller.userId,
      targetType: 'Broadcast',
      targetId: id,
      detail: { reason },
    });
    return this.getById(id);
  },

  async cancel(caller: { userId: string }, id: string, reason?: string) {
    const row = await this.getById(id);
    if (!row) throw Errors.notFound('Broadcast not found.');
    if (!['DRAFT', 'PENDING_APPROVAL', 'SCHEDULED'].includes(row.status)) {
      throw Errors.validation({ status: `Cannot cancel broadcast in status ${row.status}.` });
    }
    await prisma.$executeRaw`
      UPDATE broadcasts
      SET status = 'CANCELLED', reason = COALESCE(${reason ?? null}, reason), updated_at = now()
      WHERE id = ${id}::uuid
    `;
    await recordAudit({
      action: 'BROADCAST_CANCELLED',
      actorId: caller.userId,
      targetType: 'Broadcast',
      targetId: id,
      detail: { reason },
    });
    return this.getById(id);
  },

  async report(id: string) {
    const row = await this.getById(id);
    if (!row) throw Errors.notFound('Broadcast not found.');
    const totals = await prisma.$queryRaw<{ delivered: number; read: number; acked: number }[]>`
      SELECT count(*)::int AS delivered,
             count(*) FILTER (WHERE read_at IS NOT NULL)::int AS read,
             count(*) FILTER (WHERE acked_at IS NOT NULL)::int AS acked
      FROM broadcast_recipients
      WHERE broadcast_id = ${id}::uuid
    `;
    const byUnit = await prisma.$queryRaw<
      { unit_code: string; delivered: number; read: number; acked: number }[]
    >`
      SELECT COALESCE(un.code, 'UNASSIGNED') AS unit_code,
             count(DISTINCT br.user_id)::int AS delivered,
             count(DISTINCT br.user_id) FILTER (WHERE br.read_at IS NOT NULL)::int AS read,
             count(DISTINCT br.user_id) FILTER (WHERE br.acked_at IS NOT NULL)::int AS acked
      FROM broadcast_recipients br
      LEFT JOIN user_units uu ON uu.user_id = br.user_id
      LEFT JOIN units un ON un.id = uu.unit_id
      WHERE br.broadcast_id = ${id}::uuid
      GROUP BY un.code
      ORDER BY unit_code
    `;
    return {
      broadcast: row,
      totals: totals[0] ?? { delivered: 0, read: 0, acked: 0 },
      byUnit,
    };
  },

  async listActiveForUser(userId: string) {
    return prisma.$queryRaw<
      {
        id: string;
        number: string;
        title: string;
        body_md: string;
        severity: string;
        pin_banner: boolean;
        require_ack: boolean;
        sent_at: Date | null;
        expires_at: Date | null;
        read_at: Date | null;
        acked_at: Date | null;
      }[]
    >`
      SELECT b.id, b.number, b.title, b.body_md, b.severity, b.pin_banner, b.require_ack,
             b.sent_at, b.expires_at, br.read_at, br.acked_at
      FROM broadcast_recipients br
      JOIN broadcasts b ON b.id = br.broadcast_id
      WHERE br.user_id = ${userId}::uuid
        AND b.status = 'SENT'
        AND (b.expires_at IS NULL OR b.expires_at > now())
        AND (b.pin_banner = true OR (b.require_ack = true AND br.acked_at IS NULL))
      ORDER BY CASE b.severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END, b.sent_at DESC
    `;
  },

  async acknowledge(userId: string, broadcastId: string) {
    const res = await prisma.$executeRaw`
      UPDATE broadcast_recipients
      SET acked_at = COALESCE(acked_at, now()),
          read_at = COALESCE(read_at, now())
      WHERE broadcast_id = ${broadcastId}::uuid AND user_id = ${userId}::uuid
    `;
    if (Number(res) === 0) throw Errors.notFound('Broadcast announcement not found for user.');
    await prisma.$executeRaw`
      UPDATE notifications
      SET read_at = COALESCE(read_at, now())
      WHERE broadcast_id = ${broadcastId}::uuid AND user_id = ${userId}::uuid AND read_at IS NULL
    `;
    await emitRealtimeNotify(prisma, { u: [userId], k: 'b', ids: [broadcastId] });
    return { ok: true };
  },
};