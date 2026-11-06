// /pages/:pageId/exports (start a background export) and /jobs (status, list, download).
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { Errors } from '../../core/http/errors';
import { validate, validated } from '../../core/http/validate';
import { requireParamPageAction } from '../../core/rbac/access';
import { idempotencyKeySchema, pageParamsSchema } from '../records/schemas';
import type { Caller } from '../records/service';
import { dataJobService, exportJobBodySchema } from './service';

const jobParamsSchema = z.object({ jobId: z.string().uuid('Invalid job id.') }).strict();
const jobListQuerySchema = z
  .object({ pageId: z.string().trim().min(1).max(80).optional() })
  .strict();

export function callerOf(req: Request): Caller {
  if (!req.ctx) throw Errors.unauthenticated();
  return { auth: requireAuth(req), ctx: req.ctx, meta: requestMeta(req) };
}

export function idempotencyKeyOf(req: Request): string | undefined {
  const header = req.get('idempotency-key');
  if (header === undefined) return undefined;
  const parsed = idempotencyKeySchema.safeParse(header);
  if (!parsed.success) {
    throw Errors.badRequest(parsed.error.issues[0]?.message ?? 'Invalid Idempotency-Key header.');
  }
  return parsed.data;
}

export function createExportsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, resolveContext);
  router.post(
    '/:pageId/exports',
    validate({ params: pageParamsSchema, body: exportJobBodySchema }),
    requireParamPageAction('export'),
    asyncHandler(async (req: Request, res: Response) => {
      const { pageId } = validated(res, 'params', pageParamsSchema);
      const body = validated(res, 'body', exportJobBodySchema);
      const { job, replay } = await dataJobService.createExport(
        callerOf(req),
        pageId,
        body,
        idempotencyKeyOf(req),
      );
      if (replay) res.set('Idempotent-Replay', 'true');
      res.status(202).json({ data: job });
    }),
  );
  return router;
}

export function createJobsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, resolveContext);

  router.get(
    '/',
    validate({ query: jobListQuerySchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { pageId } = validated(res, 'query', jobListQuerySchema);
      const rows = await dataJobService.listMine(callerOf(req), pageId);
      res.json({ data: rows, meta: { total: rows.length } });
    }),
  );

  router.get(
    '/:jobId',
    validate({ params: jobParamsSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { jobId } = validated(res, 'params', jobParamsSchema);
      res
        .set('Cache-Control', 'no-store')
        .json({ data: await dataJobService.get(callerOf(req), jobId) });
    }),
  );

  router.get(
    '/:jobId/download',
    validate({ params: jobParamsSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { jobId } = validated(res, 'params', jobParamsSchema);
      const file = await dataJobService.download(callerOf(req), jobId);
      res
        .set({
          'Content-Type': file.mimeType,
          'Content-Length': String(file.buffer.length),
          'Content-Disposition': `attachment; filename="${file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}"`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, no-store',
        })
        .send(file.buffer);
    }),
  );

  return router;
}
