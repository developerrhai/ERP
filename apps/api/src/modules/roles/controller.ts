// HTTP layer for /roles (Phase 02 §6).
import type { Request, Response } from 'express';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { Errors } from '../../core/http/errors';
import { roleService } from './service';
import { CreateRoleSchema, UpdateRoleSchema } from './schemas';

function parseIfMatch(header: string | undefined): number {
  if (!header) throw Errors.versionConflict();
  const raw = header.replace(/^"|"$/g, '').trim();
  const v = Number.parseInt(raw, 10);
  if (Number.isNaN(v)) {
    throw Errors.versionConflict();
  }
  return v;
}

export const rolesController = {
  list: async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    res.json({ data: await roleService.list({ level: auth.level }) });
  },

  get: async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const role = await roleService.getById(req.params.id || '', { level: auth.level });
    res.setHeader('ETag', `"${role.version}"`);
    res.json({ data: role });
  },

  create: async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const input = CreateRoleSchema.parse(req.body);
    const role = await roleService.create(
      { id: auth.userId, level: auth.level },
      input,
      requestMeta(req),
    );
    res.status(201).json({ data: role });
  },

  update: async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const version = parseIfMatch(req.get('if-match'));
    const input = UpdateRoleSchema.parse(req.body);
    const role = await roleService.update(
      req.params.id || '',
      { id: auth.userId, level: auth.level },
      input,
      version,
      requestMeta(req),
    );
    res.setHeader('ETag', `"${role.version}"`);
    res.json({ data: role });
  },

  delete: async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const ifMatch = req.get('if-match');
    const version = ifMatch ? parseIfMatch(ifMatch) : null;
    await roleService.delete(
      req.params.id || '',
      { id: auth.userId, level: auth.level },
      version,
      requestMeta(req),
    );
    res.status(204).end();
  },
};
