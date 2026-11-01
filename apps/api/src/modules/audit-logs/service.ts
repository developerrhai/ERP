// Audit Trail viewer (Phase 2 §3): shapes audit rows for the UI (actor name/loginId, detail).
import { Errors } from '../../core/http/errors';
import { auditLogRepository } from './repository';
import type { AuditLogWithActor } from './repository';
import type { ListAuditLogsQuery } from './schemas';

/** Row shape (orchestrator decision): the actor is the joined object, no separate actorId. */
export interface AuditLogDto {
  id: string;
  at: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  userAgent: string | null;
  detail: unknown;
  actor: { id: string; name: string; loginId: string } | null;
}

function toDto(row: AuditLogWithActor): AuditLogDto {
  return {
    id: row.id,
    at: row.at.toISOString(),
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    ip: row.ip,
    userAgent: row.userAgent,
    detail: row.detail,
    actor: row.actor,
  };
}

export const auditLogService = {
  async list(query: ListAuditLogsQuery): Promise<{ rows: AuditLogDto[]; total: number }> {
    const { rows, total } = await auditLogRepository.list(query);
    return { rows: rows.map(toDto), total };
  },

  async get(id: string): Promise<AuditLogDto> {
    const row = await auditLogRepository.findById(id);
    if (!row) throw Errors.notFound('Audit entry not found.');
    return toDto(row);
  },
};
