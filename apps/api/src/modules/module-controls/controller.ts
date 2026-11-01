// HTTP layer for /module-controls: list with filters; PATCH one row with If-Match.
import type { Request, Response } from 'express';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { parseIfMatch } from '../../core/http/if-match';
import { validated } from '../../core/http/validate';
import {
  listModuleControlsQuerySchema,
  pageIdParamsSchema,
  updateModuleControlSchema,
} from './schemas';
import { moduleControlService } from './service';

export const moduleControlsController = {
  list: async (_req: Request, res: Response): Promise<void> => {
    const query = validated(res, 'query', listModuleControlsQuerySchema);
    const rows = await moduleControlService.list(query);
    res.json({ data: rows, meta: { total: rows.length } });
  },
  update: async (req: Request, res: Response): Promise<void> => {
    const version = parseIfMatch(req.get('if-match'));
    const { pageId } = validated(res, 'params', pageIdParamsSchema);
    const body = validated(res, 'body', updateModuleControlSchema);
    const updated = await moduleControlService.update(
      requireAuth(req),
      pageId,
      version,
      body,
      requestMeta(req),
    );
    res.set('ETag', `"${updated.version}"`).json({ data: updated });
  },
};
