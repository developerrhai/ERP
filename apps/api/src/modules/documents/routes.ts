// /pages/:pageId/records/:id/documents (docs/phases/PHASE-04.md §5 C8). Mounted before the generic
// records router; multipart is read by busboy, not express.json.
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { requestMeta, requireAuth } from '../../core/auth/auth-context';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { Errors } from '../../core/http/errors';
import { readSingleFile } from '../../core/http/multipart';
import { validate, validated } from '../../core/http/validate';
import { MAX_FILE_BYTES } from '../../core/scan';
import { idempotencyKeySchema, recordParamsSchema } from '../records/schemas';
import type { Caller } from '../records/service';
import { documentService } from './service';

const docParamsSchema = recordParamsSchema.extend({ docId: z.string().uuid() }).strict();

function callerOf(req: Request): Caller {
  if (!req.ctx) throw Errors.unauthenticated();
  return { auth: requireAuth(req), ctx: req.ctx, meta: requestMeta(req) };
}

function idempotencyKeyOf(req: Request): string | undefined {
  const header = req.get('idempotency-key');
  if (header === undefined) return undefined;
  const parsed = idempotencyKeySchema.safeParse(header);
  if (!parsed.success) {
    throw Errors.badRequest(parsed.error.issues[0]?.message ?? 'Invalid Idempotency-Key header.');
  }
  return parsed.data;
}

/** Content-Disposition with an ASCII fallback and the UTF-8 name (RFC 6266), safe for Hindi names. */
function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function createDocumentsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, resolveContext);
  const base = '/:pageId/records/:id/documents';

  router.get(
    base,
    validate({ params: recordParamsSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { pageId, id } = validated(res, 'params', recordParamsSchema);
      const rows = await documentService.list(callerOf(req), pageId, id);
      res.json({ data: rows, meta: { total: rows.length } });
    }),
  );

  router.post(
    base,
    validate({ params: recordParamsSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { pageId, id } = validated(res, 'params', recordParamsSchema);
      const upload = await readSingleFile(req, MAX_FILE_BYTES);
      const { document, replay } = await documentService.upload(
        callerOf(req),
        pageId,
        id,
        upload.file,
        upload.fields,
        idempotencyKeyOf(req),
      );
      if (replay) res.set('Idempotent-Replay', 'true');
      res.status(replay ? 200 : 201).json({ data: document });
    }),
  );

  router.get(
    `${base}/:docId/download`,
    validate({ params: docParamsSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { pageId, id, docId } = validated(res, 'params', docParamsSchema);
      const file = await documentService.download(callerOf(req), pageId, id, docId);
      if (file.presignedUrl) {
        if (req.query.mode === 'json') {
          res.json({
            data: {
              url: file.presignedUrl,
              expiresInSeconds: file.expiresInSeconds,
              fileName: file.fileName,
              mimeType: file.mimeType,
              sha256: file.sha256,
            },
          });
          return;
        }
        res.setHeader('Cache-Control', 'private, no-store');
        res.redirect(302, file.presignedUrl);
        return;
      }
      if (!file.buffer) throw Errors.notFound('Document not found.');
      res
        .set({
          'Content-Type': file.mimeType,
          'Content-Length': String(file.buffer.length),
          'Content-Disposition': attachment(file.fileName),
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, no-store',
        })
        .send(file.buffer);
    }),
  );

  router.delete(
    `${base}/:docId`,
    validate({ params: docParamsSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { pageId, id, docId } = validated(res, 'params', docParamsSchema);
      await documentService.remove(callerOf(req), pageId, id, docId);
      res.json({ data: { id: docId, removed: true } });
    }),
  );

  return router;
}
