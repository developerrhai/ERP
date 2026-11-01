// HTTP layer for /audit-logs: list with {data, meta:{page,size,total}} and get by id.
import type { Request, Response } from 'express';
import { validated } from '../../core/http/validate';
import { auditLogIdParamsSchema, listAuditLogsQuerySchema } from './schemas';
import { auditLogService } from './service';

export const auditLogsController = {
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
