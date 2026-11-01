// HTTP layer for /departments: validated input + If-Match in, {data} out. No business rules here.
import type { Request, Response } from 'express';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { parseIfMatch, parseOptionalIfMatch } from '../../core/http/if-match';
import { validated } from '../../core/http/validate';
import {
  createDepartmentSchema,
  departmentIdParamsSchema,
  updateDepartmentSchema,
} from './schemas';
import { departmentService } from './service';

export const departmentsController = {
  list: async (_req: Request, res: Response): Promise<void> => {
    res.json({ data: await departmentService.list() });
  },

  create: async (req: Request, res: Response): Promise<void> => {
    const body = validated(res, 'body', createDepartmentSchema);
    const created = await departmentService.create(requireAuth(req), body, requestMeta(req));
    res.status(201).json({ data: created });
  },

  update: async (req: Request, res: Response): Promise<void> => {
    const version = parseIfMatch(req.get('if-match'));
    const { id } = validated(res, 'params', departmentIdParamsSchema);
    const body = validated(res, 'body', updateDepartmentSchema);
    const updated = await departmentService.update(
      requireAuth(req),
      id,
      version,
      body,
      requestMeta(req),
    );
    res.set('ETag', `"${updated.version}"`).json({ data: updated });
  },

  remove: async (req: Request, res: Response): Promise<void> => {
    const version = parseOptionalIfMatch(req.get('if-match'));
    const { id } = validated(res, 'params', departmentIdParamsSchema);
    await departmentService.remove(requireAuth(req), id, version, requestMeta(req));
    res.status(204).end();
  },
};
