// HTTP layer for /users: reads validated input and the If-Match header, calls the service and
// shapes the response. No business rules live here.
import type { Request, Response } from 'express';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { parseIfMatch } from '../../core/http/if-match';
import { validated } from '../../core/http/validate';
import {
  createUserSchema,
  listUsersQuerySchema,
  resetPasswordSchema,
  updateUserSchema,
  userIdParamsSchema,
} from './schemas';
import { userService } from './service';

export const usersController = {
  list: async (_req: Request, res: Response): Promise<void> => {
    const query = validated(res, 'query', listUsersQuerySchema);
    const { users, total } = await userService.list(query);
    res.json({ data: users, meta: { page: query.page, size: query.size, total } });
  },

  get: async (_req: Request, res: Response): Promise<void> => {
    const { id } = validated(res, 'params', userIdParamsSchema);
    res.json({ data: await userService.get(id) });
  },

  create: async (req: Request, res: Response): Promise<void> => {
    const body = validated(res, 'body', createUserSchema);
    const user = await userService.create(requireAuth(req), body, requestMeta(req));
    res.status(201).json({ data: user });
  },

  update: async (req: Request, res: Response): Promise<void> => {
    const version = parseIfMatch(req.get('if-match'));
    const { id } = validated(res, 'params', userIdParamsSchema);
    const body = validated(res, 'body', updateUserSchema);
    const user = await userService.update(requireAuth(req), id, version, body, requestMeta(req));
    res.set('ETag', `"${user.version}"`).json({ data: user });
  },

  resetPassword: async (req: Request, res: Response): Promise<void> => {
    const { id } = validated(res, 'params', userIdParamsSchema);
    const body = validated(res, 'body', resetPasswordSchema);
    await userService.resetPassword(requireAuth(req), id, body, requestMeta(req));
    res.status(204).end();
  },
};
