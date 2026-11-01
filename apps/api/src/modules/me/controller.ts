// HTTP layer for /me: calls the me service and shapes {data:...}. Never cached by the browser,
// because the answer changes as soon as an admin edits permissions.
import type { Request, Response } from 'express';
import { requireAuth } from '../../core/auth/auth-context';
import { validated } from '../../core/http/validate';
import { mePermissionsQuerySchema } from './schemas';
import { meService } from './service';

export const meController = {
  menu: async (req: Request, res: Response): Promise<void> => {
    res.set('Cache-Control', 'no-store');
    res.json({ data: await meService.menu(requireAuth(req).user) });
  },
  permissions: async (req: Request, res: Response): Promise<void> => {
    const { pageId } = validated(res, 'query', mePermissionsQuerySchema);
    res.set('Cache-Control', 'no-store');
    res.json({ data: await meService.permissions(requireAuth(req).user, pageId) });
  },
};
