// HTTP layer for /settings/letterhead: GET and PUT (If-Match). No business rules here.
import type { Request, Response } from 'express';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { parseIfMatch } from '../../core/http/if-match';
import { validated } from '../../core/http/validate';
import { letterheadSchema } from './schemas';
import { settingsService } from './service';

export const settingsController = {
  getLetterhead: async (_req: Request, res: Response): Promise<void> => {
    const letterhead = await settingsService.getLetterhead();
    res.set('ETag', `"${letterhead.version}"`).json({ data: letterhead });
  },

  putLetterhead: async (req: Request, res: Response): Promise<void> => {
    const version = parseIfMatch(req.get('if-match'));
    const body = validated(res, 'body', letterheadSchema);
    const saved = await settingsService.putLetterhead(
      requireAuth(req),
      version,
      body,
      requestMeta(req),
    );
    res.set('ETag', `"${saved.version}"`).json({ data: saved });
  },
};
