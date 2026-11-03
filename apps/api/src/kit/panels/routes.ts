// apps/api/src/kit/panels/routes.ts
// Route table for Kit panels: /pages/:pageId/panels/:key & /pages/:pageId/records/:id/panels/:key
// (docs/plans/07-ENGINE-KIT.md §2.4, §6 KR-04)

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { resolveContext } from '../../core/context/resolve-context';
import { prisma } from '../../core/db/prisma';
import { asyncHandler } from '../../core/http/async-handler';
import { AppError, Errors } from '../../core/http/errors';
import { can } from '../../core/rbac/access';
import type { Action } from '../../core/rbac/permission-model';
import { typedHandlerFor } from '../../modules/inventory/typed-pages';
import type { Caller } from '../../modules/records/service';
import { getPanelDef } from './registry';
import { panelDtoSchema } from './schema';
import type { PanelDef } from './types';

function buildQuerySchema(panelDef: PanelDef) {
  const baseShape: Record<string, z.ZodTypeAny> = {
    page: z.coerce.number().int().min(1).default(1),
    size: z.coerce.number().int().min(1).max(100).default(20),
    q: z.string().trim().max(100).optional(),
    from: z.string().trim().max(30).optional(),
    to: z.string().trim().max(30).optional(),
    status: z.string().trim().max(50).optional(),
  };

  for (const param of panelDef.opts?.params ?? []) {
    baseShape[param] = z.string().trim().max(100).optional();
  }

  return z.object(baseShape).strict();
}

export function createKitPanelsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, resolveContext);

  // K2: Page-scoped panel
  router.get(
    '/:pageId/panels/:key',
    asyncHandler(async (req: Request, res: Response) => {
      const pageId = req.params.pageId ?? '';
      const key = req.params.key ?? '';
      const def = getPanelDef(pageId, key);
      if (!def) throw Errors.notFound('Panel not found.');
      if (def.scope !== 'page') throw Errors.notFound('Scope mismatch.');

      if (!req.auth) throw Errors.unauthenticated();
      const user = req.auth.user;
      const requiredPerm: Action = (def.opts?.requires as Action) ?? 'view';
      const allowed = await can(
        { id: user.id, role: user.role, department: user.department },
        pageId,
        requiredPerm,
      );
      if (!allowed) throw Errors.forbidden();

      const querySchema = buildQuerySchema(def);
      const parsedQuery = querySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        const fields: Record<string, string> = {};
        for (const issue of parsedQuery.error.issues) {
          const path = issue.path.join('.') || '_';
          fields[path] = issue.message;
        }
        throw Errors.validation(fields);
      }

      if (!req.ctx) throw Errors.unauthenticated();
      const caller: Caller = {
        auth: requireAuth(req),
        ctx: req.ctx,
        meta: requestMeta(req),
      };

      const dto = await def.builder({
        db: prisma,
        caller,
        pageId,
        query: parsedQuery.data,
      });

      const validatedDto = panelDtoSchema.safeParse(dto);
      if (!validatedDto.success) {
        throw new AppError(500, 'INTERNAL', `Invalid panel DTO: ${validatedDto.error.issues[0]?.message}`);
      }

      res.set('Cache-Control', 'no-store').json({ data: validatedDto.data });
    }),
  );

  // K3: Record-scoped panel
  router.get(
    '/:pageId/records/:id/panels/:key',
    asyncHandler(async (req: Request, res: Response) => {
      const pageId = req.params.pageId ?? '';
      const id = req.params.id ?? '';
      const key = req.params.key ?? '';
      const def = getPanelDef(pageId, key);
      if (!def) throw Errors.notFound('Panel not found.');
      if (def.scope !== 'record') throw Errors.notFound('Scope mismatch.');

      if (!req.auth) throw Errors.unauthenticated();
      const user = req.auth.user;
      const requiredPerm: Action = (def.opts?.requires as Action) ?? 'view';
      const allowed = await can(
        { id: user.id, role: user.role, department: user.department },
        pageId,
        requiredPerm,
      );
      if (!allowed) throw Errors.forbidden();

      if (!req.ctx) throw Errors.unauthenticated();
      const caller: Caller = {
        auth: requireAuth(req),
        ctx: req.ctx,
        meta: requestMeta(req),
      };

      // KR-04 (2): Record scope calls handler.get first; its 404 is returned unchanged
      const typed = typedHandlerFor(pageId);
      if (!typed) throw Errors.notFound('Page handler not found.');
      await typed.get(caller, id);

      const querySchema = buildQuerySchema(def);
      const parsedQuery = querySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        const fields: Record<string, string> = {};
        for (const issue of parsedQuery.error.issues) {
          const path = issue.path.join('.') || '_';
          fields[path] = issue.message;
        }
        throw Errors.validation(fields);
      }

      const dto = await def.builder({
        db: prisma,
        caller,
        pageId,
        recId: id,
        query: parsedQuery.data,
      });

      const validatedDto = panelDtoSchema.safeParse(dto);
      if (!validatedDto.success) {
        throw new AppError(500, 'INTERNAL', `Invalid panel DTO: ${validatedDto.error.issues[0]?.message}`);
      }

      res.set('Cache-Control', 'no-store').json({ data: validatedDto.data });
    }),
  );

  return router;
}
