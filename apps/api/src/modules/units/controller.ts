// HTTP layer for /units: validated input + If-Match in, {data} out. No business rules here.
import type { Request, Response } from 'express';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { parseIfMatch, parseOptionalIfMatch } from '../../core/http/if-match';
import { validated } from '../../core/http/validate';
import {
  createUnitSchema,
  listUnitsQuerySchema,
  unitIdParamsSchema,
  updateUnitSchema,
} from './schemas';
import { unitService } from './service';

export const unitsController = {
  list: async (_req: Request, res: Response): Promise<void> => {
    const query = validated(res, 'query', listUnitsQuerySchema);
    res.json({ data: await unitService.list(query) });
  },

  create: async (req: Request, res: Response): Promise<void> => {
    const body = validated(res, 'body', createUnitSchema);
    const created = await unitService.create(requireAuth(req), body, requestMeta(req));
    res.status(201).json({ data: created });
  },

  update: async (req: Request, res: Response): Promise<void> => {
    const version = parseIfMatch(req.get('if-match'));
    const { id } = validated(res, 'params', unitIdParamsSchema);
    const body = validated(res, 'body', updateUnitSchema);
    const updated = await unitService.update(requireAuth(req), id, version, body, requestMeta(req));
    res.set('ETag', `"${updated.version}"`).json({ data: updated });
  },

  remove: async (req: Request, res: Response): Promise<void> => {
    const version = parseOptionalIfMatch(req.get('if-match'));
    const { id } = validated(res, 'params', unitIdParamsSchema);
    await unitService.remove(requireAuth(req), id, version, requestMeta(req));
    res.status(204).end();
  },
};
