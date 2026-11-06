// apps/api/src/modules/uoms/controller.ts
// HTTP layer for /uoms (Phase 03 Order 3)
import type { Request, Response } from 'express';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { parseIfMatch, parseOptionalIfMatch } from '../../core/http/if-match';
import { validated } from '../../core/http/validate';
import {
  createUomSchema,
  listUomsQuerySchema,
  uomIdParamsSchema,
  updateUomSchema,
} from './schemas';
import { uomModuleService } from './service';

export const uomsController = {
  list: async (_req: Request, res: Response): Promise<void> => {
    const query = validated(res, 'query', listUomsQuerySchema);
    res.json({ data: await uomModuleService.list(query) });
  },

  get: async (_req: Request, res: Response): Promise<void> => {
    const { id } = validated(res, 'params', uomIdParamsSchema);
    res.json({ data: await uomModuleService.get(id) });
  },

  create: async (req: Request, res: Response): Promise<void> => {
    const body = validated(res, 'body', createUomSchema);
    const created = await uomModuleService.create(requireAuth(req), body, requestMeta(req));
    res.status(201).json({ data: created });
  },

  update: async (req: Request, res: Response): Promise<void> => {
    const version = parseIfMatch(req.get('if-match'));
    const { id } = validated(res, 'params', uomIdParamsSchema);
    const body = validated(res, 'body', updateUomSchema);
    const updated = await uomModuleService.update(
      requireAuth(req),
      id,
      version,
      body,
      requestMeta(req),
    );
    res.set('ETag', `"${updated.version}"`).json({ data: updated });
  },

  remove: async (req: Request, res: Response): Promise<void> => {
    const version = parseOptionalIfMatch(req.get('if-match'));
    const { id } = validated(res, 'params', uomIdParamsSchema);
    await uomModuleService.remove(requireAuth(req), id, version, requestMeta(req));
    res.status(204).end();
  },
};
