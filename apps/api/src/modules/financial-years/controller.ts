// HTTP layer for /financial-years: validated input + If-Match in, {data} out. No business rules.
import type { Request, Response } from 'express';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { parseIfMatch, parseOptionalIfMatch } from '../../core/http/if-match';
import { validated } from '../../core/http/validate';
import { createFinancialYearSchema, fyIdParamsSchema, updateFinancialYearSchema } from './schemas';
import { financialYearService } from './service';
import type { FinancialYearDto } from './service';

type Transition = 'setCurrent' | 'close' | 'reopen';

function transition(name: Transition) {
  return async (req: Request, res: Response): Promise<void> => {
    const version = parseOptionalIfMatch(req.get('if-match'));
    const { id } = validated(res, 'params', fyIdParamsSchema);
    const fy: FinancialYearDto = await financialYearService[name](
      requireAuth(req),
      id,
      version,
      requestMeta(req),
    );
    res.set('ETag', `"${fy.version}"`).json({ data: fy });
  };
}

export const financialYearsController = {
  list: async (_req: Request, res: Response): Promise<void> => {
    res.json({ data: await financialYearService.list() });
  },

  create: async (req: Request, res: Response): Promise<void> => {
    const body = validated(res, 'body', createFinancialYearSchema);
    const fy = await financialYearService.create(requireAuth(req), body, requestMeta(req));
    res.status(201).json({ data: fy });
  },

  update: async (req: Request, res: Response): Promise<void> => {
    const version = parseIfMatch(req.get('if-match'));
    const { id } = validated(res, 'params', fyIdParamsSchema);
    const body = validated(res, 'body', updateFinancialYearSchema);
    const fy = await financialYearService.update(
      requireAuth(req),
      id,
      version,
      body,
      requestMeta(req),
    );
    res.set('ETag', `"${fy.version}"`).json({ data: fy });
  },

  setCurrent: transition('setCurrent'),
  close: transition('close'),
  reopen: transition('reopen'),
};
