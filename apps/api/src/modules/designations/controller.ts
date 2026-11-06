// apps/api/src/modules/designations/controller.ts
// HTTP layer for /designations (Phase 03 Order 3)
import type { Request, Response } from 'express';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { parseIfMatch, parseOptionalIfMatch } from '../../core/http/if-match';
import { validated } from '../../core/http/validate';
import {
  createDesignationSchema,
  designationIdParamsSchema,
  listDesignationsQuerySchema,
  updateDesignationSchema,
} from './schemas';
import { designationService } from './service';

export const designationsController = {
  list: async (_req: Request, res: Response): Promise<void> => {
    const query = validated(res, 'query', listDesignationsQuerySchema);
    res.json({ data: await designationService.list(query) });
  },

  get: async (_req: Request, res: Response): Promise<void> => {
    const { id } = validated(res, 'params', designationIdParamsSchema);
    res.json({ data: await designationService.get(id) });
  },

  create: async (req: Request, res: Response): Promise<void> => {
    const body = validated(res, 'body', createDesignationSchema);
    const created = await designationService.create(requireAuth(req), body, requestMeta(req));
    res.status(201).json({ data: created });
  },

  update: async (req: Request, res: Response): Promise<void> => {
    const version = parseIfMatch(req.get('if-match'));
    const { id } = validated(res, 'params', designationIdParamsSchema);
    const body = validated(res, 'body', updateDesignationSchema);
    const updated = await designationService.update(
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
    const { id } = validated(res, 'params', designationIdParamsSchema);
    await designationService.remove(requireAuth(req), id, version, requestMeta(req));
    res.status(204).end();
  },
};
