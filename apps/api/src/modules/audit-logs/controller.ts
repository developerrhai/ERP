// HTTP layer for /audit-logs: the known action codes, the list with {data, meta:{page,size,total}},
// and get by id.
import type { Request, Response } from 'express';
import { AUDIT_ACTIONS } from '../../core/audit/audit-service';
import { validated } from '../../core/http/validate';
import { auditLogIdParamsSchema, listAuditLogsQuerySchema } from './schemas';
import { auditLogService } from './service';

export const auditLogsController = {
  /** Known action codes, for the viewer's action filter. */
  actions: (_req: Request, res: Response): Promise<void> => {
    res.json({ data: [...AUDIT_ACTIONS] });
    return Promise.resolve();
  },
  list: async (_req: Request, res: Response): Promise<void> => {
    const query = validated(res, 'query', listAuditLogsQuerySchema);
    const { rows, total } = await auditLogService.list(query);
    res.json({ data: rows, meta: { page: query.page, size: query.size, total } });
  },
  get: async (_req: Request, res: Response): Promise<void> => {
    const { id } = validated(res, 'params', auditLogIdParamsSchema);
    res.json({ data: await auditLogService.get(id) });
  },
};
