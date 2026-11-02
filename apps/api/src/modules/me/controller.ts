// HTTP layer for /me: calls the me / context services and shapes {data:...}. Never cached by the
// browser, because the answer changes as soon as an admin edits permissions or unit access.
import type { Request, Response } from 'express';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { validated } from '../../core/http/validate';
import { contextService } from './context-service';
import { mePermissionsQuerySchema, putContextSchema } from './schemas';
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
  getContext: async (req: Request, res: Response): Promise<void> => {
    res.set('Cache-Control', 'no-store');
    res.json({ data: await contextService.get(requireAuth(req).user) });
  },
  putContext: async (req: Request, res: Response): Promise<void> => {
    const body = validated(res, 'body', putContextSchema);
    res.set('Cache-Control', 'no-store');
    res.json({ data: await contextService.put(requireAuth(req), body, requestMeta(req)) });
  },
};
