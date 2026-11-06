// Idempotency-Key store in Postgres (docs/phases/PHASE-04.md §5 C2). Nothing is kept in memory, so a
// replay after an API restart returns the stored response. Key = (user, scope, key); the request hash
// guards against the same key being reused for a different request.
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';

export type IdempotencyStart =
  | { kind: 'new' }
  | { kind: 'replay'; code: number; body: Prisma.JsonValue }
  | { kind: 'in_progress' }
  | { kind: 'mismatch' };

/** A RUNNING row older than this belongs to a crashed worker and may be taken over. */
export const RUNNING_STALE_MS = 60_000;
const TTL_MS = 24 * 60 * 60 * 1000;

export async function beginIdempotent(
  userId: string,
  scope: string,
  key: string,
  requestHash: string,
): Promise<IdempotencyStart> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const created = await prisma.idempotencyKey.createMany({
      data: [
        {
          userId,
          scope,
          key,
          requestHash,
          state: 'RUNNING',
          expiresAt: new Date(Date.now() + TTL_MS),
        },
      ],
      skipDuplicates: true,
    });
    if (created.count === 1) return { kind: 'new' };

    const row = await prisma.idempotencyKey.findUnique({
      where: { userId_scope_key: { userId, scope, key } },
    });
    if (!row) continue; // deleted between the insert and the read: try again
    if (row.expiresAt.getTime() <= Date.now()) {
      await prisma.idempotencyKey.deleteMany({
        where: { userId, scope, key, expiresAt: { lte: new Date() } },
      });
      continue;
    }
    if (row.requestHash !== requestHash) return { kind: 'mismatch' };
    if (row.state === 'DONE') {
      return { kind: 'replay', code: row.responseCode ?? 200, body: row.responseBody ?? {} };
    }
    const stale = Date.now() - row.createdAt.getTime() > RUNNING_STALE_MS;
    if (row.state === 'RUNNING' && !stale) return { kind: 'in_progress' };
    // FAILED, or RUNNING and stale: exactly one caller wins the takeover.
    const taken = await prisma.idempotencyKey.updateMany({
      where: { userId, scope, key, state: row.state, createdAt: row.createdAt },
      data: { state: 'RUNNING', createdAt: new Date() },
    });
    if (taken.count === 1) return { kind: 'new' };
  }
  return { kind: 'in_progress' };
}

export async function finishIdempotent(
  userId: string,
  scope: string,
  key: string,
  code: number,
  body: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.idempotencyKey.update({
    where: { userId_scope_key: { userId, scope, key } },
    data: { state: 'DONE', responseCode: code, responseBody: body },
  });
}

/** The run failed: forget the key so the client can retry with the same one. */
export async function abandonIdempotent(userId: string, scope: string, key: string): Promise<void> {
  await prisma.idempotencyKey.deleteMany({ where: { userId, scope, key } });
}

export async function purgeExpiredIdempotency(): Promise<number> {
  const result = await prisma.idempotencyKey.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return result.count;
}
