// HTTP layer for /permissions: list all roles' rows; replace one role's rows (If-Match = the
// role-level version). No business rules here.
import type { Request, Response } from 'express';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { parseIfMatch } from '../../core/http/if-match';
import { validated } from '../../core/http/validate';
import { putPermissionsSchema, roleParamsSchema } from './schemas';
import { permissionService } from './service';

export const permissionsController = {
  list: async (req: Request, res: Response): Promise<void> => {
    res.json({ data: await permissionService.list(requireAuth(req).role) });
  },

  replace: async (req: Request, res: Response): Promise<void> => {
    const version = parseIfMatch(req.get('if-match'));
    const { role } = validated(res, 'params', roleParamsSchema);
    const body = validated(res, 'body', putPermissionsSchema);
    const updated = await permissionService.replace(
      requireAuth(req),
      role,
      version,
      body,
      requestMeta(req),
    );
    res.set('ETag', `"${updated.version}"`).json({ data: updated });
  },
};
