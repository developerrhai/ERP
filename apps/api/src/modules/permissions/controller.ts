// HTTP layer for /permissions (Phase 02 §6).
import type { Request, Response } from 'express';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { parseIfMatch } from '../../core/http/if-match';
import { putPermissionsSchema } from './schemas';
import { permissionService } from './service';

export const permissionsController = {
  list: async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    res.json({ data: await permissionService.list({ level: auth.level, roleId: auth.roleId }) });
  },

  replace: async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const version = parseIfMatch(req.get('if-match'));
    const roleId = req.params.roleId || req.params.role || '';
    const body = putPermissionsSchema.parse(req.body);
    const updated = await permissionService.replace(
      auth,
      roleId,
      version,
      body,
      requestMeta(req),
    );
    res.set('ETag', `"${updated.version}"`).json({ data: updated });
  },
};
