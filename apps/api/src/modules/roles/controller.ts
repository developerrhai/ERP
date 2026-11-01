// HTTP layer for GET /roles.
import type { Request, Response } from 'express';
import { requireAuth } from '../../core/auth/auth-context';
import { roleService } from './service';

export const rolesController = {
  list: async (req: Request, res: Response): Promise<void> => {
    res.json({ data: await roleService.list(requireAuth(req).role) });
  },
};
