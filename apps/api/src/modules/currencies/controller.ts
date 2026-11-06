// apps/api/src/modules/currencies/controller.ts
// HTTP layer for /currencies (Phase 03 Order 3)
import type { Request, Response } from 'express';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { parseIfMatch, parseOptionalIfMatch } from '../../core/http/if-match';
import { validated } from '../../core/http/validate';
import {
  createCurrencySchema,
  currencyIdParamsSchema,
  listCurrenciesQuerySchema,
  updateCurrencySchema,
} from './schemas';
import { currencyService } from './service';

export const currenciesController = {
  list: async (_req: Request, res: Response): Promise<void> => {
    const query = validated(res, 'query', listCurrenciesQuerySchema);
    res.json({ data: await currencyService.list(query) });
  },

  get: async (_req: Request, res: Response): Promise<void> => {
    const { id } = validated(res, 'params', currencyIdParamsSchema);
    res.json({ data: await currencyService.get(id) });
  },

  create: async (req: Request, res: Response): Promise<void> => {
    const body = validated(res, 'body', createCurrencySchema);
    const created = await currencyService.create(requireAuth(req), body, requestMeta(req));
    res.status(201).json({ data: created });
  },

  update: async (req: Request, res: Response): Promise<void> => {
    const version = parseIfMatch(req.get('if-match'));
    const { id } = validated(res, 'params', currencyIdParamsSchema);
    const body = validated(res, 'body', updateCurrencySchema);
    const updated = await currencyService.update(
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
    const { id } = validated(res, 'params', currencyIdParamsSchema);
    await currencyService.remove(requireAuth(req), id, version, requestMeta(req));
    res.status(204).end();
  },
};
