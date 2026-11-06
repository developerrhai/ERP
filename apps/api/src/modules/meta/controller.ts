// Serves reference data for web forms (Phase 02 §6).
import type { Request, Response } from 'express';
import { requireAuth } from '../../core/auth/auth-context';
import { Errors } from '../../core/http/errors';
import { departmentService } from '../departments/service';
import { roleRepository } from '../roles/repository';

export const metaController = {
  roles: async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    if (auth.level < 95) {
      throw Errors.forbidden();
    }
    const allRoles = await roleRepository.findAll();
    const activeRoles = allRoles.filter((r) => r.status === 'ACTIVE');
    const assignable = activeRoles.filter(
      (r) => auth.level >= 99 || r.level < auth.level,
    );
    res.json({
      data: assignable.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        label: r.name,
        level: r.level,
        allUnits: r.allUnits,
        canManage: auth.level > r.level,
      })),
    });
  },

  departments: async (_req: Request, res: Response): Promise<void> => {
    res.json({ data: await departmentService.activeNames() });
  },
};
