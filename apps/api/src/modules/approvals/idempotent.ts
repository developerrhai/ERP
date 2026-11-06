// Idempotency-Key for the approval verbs (docs/phases/PHASE-05.md §5 Concurrency): the same key
// twice answers the stored response with `Idempotent-Replay: true` and never acts again, so a double
// click on Approve can never approve level 2. The key is optional on the wire; the web always sends it.
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { abandonIdempotent, beginIdempotent, finishIdempotent } from '../../core/http/idempotency';
import { Errors } from '../../core/http/errors';
import { idempotencyKeySchema } from '../records/schemas';

export function idempotencyKeyOf(req: Request): string | undefined {
  const header = req.get('idempotency-key');
  if (header === undefined) return undefined;
  const parsed = idempotencyKeySchema.safeParse(header);
  if (!parsed.success) {
    throw Errors.badRequest(parsed.error.issues[0]?.message ?? 'Invalid Idempotency-Key header.');
  }
  return parsed.data;
}

/** Runs `run` once per (user, scope, key); the response is `{ data }` with an ETag of data.version. */
export async function runIdempotent(
  req: Request,
  res: Response,
  userId: string,
  scope: string,
  hashParts: unknown[],
  run: (key: string | undefined) => Promise<{ version: number } & object>,
): Promise<void> {
  const key = idempotencyKeyOf(req);
  if (key) {
    const hash = createHash('sha256').update(JSON.stringify(hashParts)).digest('hex');
    const start = await beginIdempotent(userId, scope, key, hash);
    if (start.kind === 'mismatch') {
      throw Errors.conflict('This Idempotency-Key was already used for a different request.');
    }
    if (start.kind === 'in_progress') throw Errors.inProgress();
    if (start.kind === 'replay') {
      const stored = start.body as { data?: { version?: number } } | null;
      res.set('Idempotent-Replay', 'true');
      if (stored?.data?.version !== undefined) res.set('ETag', `"${stored.data.version}"`);
      res.status(start.code).json({ data: stored?.data ?? {} });
      return;
    }
  }
  try {
    const data = await run(key);
    if (key) {
      await finishIdempotent(userId, scope, key, 200, {
        data: JSON.parse(JSON.stringify(data)) as Prisma.InputJsonObject,
      });
    }
    res.set('ETag', `"${data.version}"`).json({ data });
  } catch (err) {
    if (key) await abandonIdempotent(userId, scope, key);
    throw err;
  }
}
