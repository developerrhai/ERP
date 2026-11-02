// HTTP layer for /company: GET (with ETag) and PATCH (If-Match). No business rules here.
import type { Request, Response } from 'express';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { parseIfMatch } from '../../core/http/if-match';
import { validated } from '../../core/http/validate';
import { updateCompanySchema } from './schemas';
import { companyService } from './service';

export const companyController = {
  get: async (_req: Request, res: Response): Promise<void> => {
    const company = await companyService.get();
    res.set('ETag', `"${company.version}"`).json({ data: company });
  },

  update: async (req: Request, res: Response): Promise<void> => {
    const version = parseIfMatch(req.get('if-match'));
    const body = validated(res, 'body', updateCompanySchema);
    const company = await companyService.update(requireAuth(req), version, body, requestMeta(req));
    res.set('ETag', `"${company.version}"`).json({ data: company });
  },
};
