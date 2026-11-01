// HTTP layer for /department-access: the matrix, and replacing one department's families.
import type { Request, Response } from 'express';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { validated } from '../../core/http/validate';
import { departmentParamsSchema, putDepartmentAccessSchema } from './schemas';
import { departmentAccessService } from './service';

export const departmentAccessController = {
  matrix: async (_req: Request, res: Response): Promise<void> => {
    res.json({ data: await departmentAccessService.matrix() });
  },
  replace: async (req: Request, res: Response): Promise<void> => {
    const { department } = validated(res, 'params', departmentParamsSchema);
    const { families } = validated(res, 'body', putDepartmentAccessSchema);
    const updated = await departmentAccessService.replace(
      requireAuth(req),
      department,
      families,
      requestMeta(req),
    );
    res.json({ data: updated });
  },
};
