// Serves reference data the web app needs to render forms: the role list with canManage for the
// caller (from role-rules.ts, so the UI never re-implements §1.2) and the active departments from the DB
// (Phase 2 §3), still as an array of names.
import type { Request, Response } from 'express';
import { requireAuth } from '../../core/auth/auth-context';
import { departmentService } from '../departments/service';
import { ROLES, ROLE_LABELS, ROLE_LEVELS, canManage } from '../../core/rbac/role-rules';

export const metaController = {
  roles: (req: Request, res: Response): void => {
    const { role } = requireAuth(req);
    res.json({
      data: ROLES.map((code) => ({
        code,
        label: ROLE_LABELS[code],
        level: ROLE_LEVELS[code],
        canManage: canManage(role, code),
      })),
    });
  },

  departments: async (_req: Request, res: Response): Promise<void> => {
    res.json({ data: await departmentService.activeNames() });
  },
};
