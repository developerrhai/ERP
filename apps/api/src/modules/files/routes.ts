// apps/api/src/modules/files/routes.ts
// Routes for /files upload and retrieval (Phase 03 Order 4)
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { requireAuth } from '../../core/auth/auth-context';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { Errors } from '../../core/http/errors';
import { validate } from '../../core/http/validate';
import { defaultStorage } from '../../core/storage';

const uploadFileSchema = z
  .object({
    filename: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(100),
    dataBase64: z.string().min(1),
  })
  .strict();

export function createFilesRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, resolveContext);

  // Upload file
  router.post(
    '/',
    validate({ body: uploadFileSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAuth(req);
      const { filename, mimeType, dataBase64 } = req.body;
      const buffer = Buffer.from(dataBase64, 'base64');
      if (buffer.length > 10 * 1024 * 1024) {
        throw Errors.payloadTooLarge();
      }

      const file = await defaultStorage.save({
        buffer,
        originalFilename: filename,
        mimeType,
        userId: auth.userId,
      });

      res.status(201).json({ data: file });
    }),
  );

  // Get/download file
  router.get(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id;
      if (!id) throw Errors.notFound('File not found.');

      const result = await defaultStorage.get(id);
      if (!result) throw Errors.notFound('File not found.');

      res.setHeader('Content-Type', result.record.mimeType);
      res.setHeader('Content-Length', result.buffer.length);
      res.setHeader('ETag', `"${result.record.sha256Hash}"`);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(result.buffer);
    }),
  );

  return router;
}
