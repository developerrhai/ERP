// Import wizard routes: /pages/:pageId/imports (upload) + import-template.xlsx, /imports/:jobId/...
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { readSingleFile } from '../../core/http/multipart';
import { validate, validated } from '../../core/http/validate';
import { callerOf, idempotencyKeyOf } from '../data-jobs/routes';
import { pageParamsSchema } from '../records/schemas';
import { IMPORT_MAX_BYTES } from './parse';
import { importService, mappingBodySchema } from './service';

const importParamsSchema = z.object({ jobId: z.string().uuid('Invalid import id.') }).strict();

export function createImportPagesRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, resolveContext);

  router.get(
    '/:pageId/import-template.xlsx',
    validate({ params: pageParamsSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { pageId } = validated(res, 'params', pageParamsSchema);
      const buffer = await importService.template(callerOf(req), pageId);
      res
        .set({
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${pageId}-import-template.xlsx"`,
          'Cache-Control': 'no-store',
        })
        .send(buffer);
    }),
  );

  router.post(
    '/:pageId/imports',
    validate({ params: pageParamsSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { pageId } = validated(res, 'params', pageParamsSchema);
      const upload = await readSingleFile(req, IMPORT_MAX_BYTES);
      const data = await importService.upload(callerOf(req), pageId, upload.file);
      res.status(201).json({ data });
    }),
  );
  return router;
}

export function createImportsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, resolveContext);

  router.post(
    '/:jobId/validate',
    validate({ params: importParamsSchema, body: mappingBodySchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { jobId } = validated(res, 'params', importParamsSchema);
      const { mapping } = validated(res, 'body', mappingBodySchema);
      const job = await importService.validate(callerOf(req), jobId, mapping);
      res.status(202).json({ data: job });
    }),
  );

  router.post(
    '/:jobId/commit',
    validate({ params: importParamsSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { jobId } = validated(res, 'params', importParamsSchema);
      const { job, replay } = await importService.commit(
        callerOf(req),
        jobId,
        idempotencyKeyOf(req),
      );
      if (replay) res.set('Idempotent-Replay', 'true');
      res.status(202).json({ data: job });
    }),
  );
  return router;
}
