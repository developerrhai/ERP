import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/core/db/prisma';
import {
  abandonIdempotent,
  beginIdempotent,
  finishIdempotent,
  purgeExpiredIdempotency,
} from '../src/core/http/idempotency';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

async function anyUserId(): Promise<string> {
  const u = await prisma.user.findFirst({ select: { id: true } });
  if (u) return u.id;
  const created = await prisma.user.create({
    data: {
      loginId: `idem-${randomUUID().slice(0, 8)}`,
      email: `idem-${randomUUID().slice(0, 8)}@rhai.local`,
      name: 'Idem',
      passwordHash: 'x',
    } as never,
  });
  return created.id;
}

describe('idempotency v2 (Postgres store)', () => {
  const keys: { userId: string; scope: string; key: string }[] = [];
  afterAll(async () => {
    for (const k of keys) await abandonIdempotent(k.userId, k.scope, k.key);
  });

  it('new -> in_progress -> replay with the stored body (survives a "restart")', async () => {
    const userId = await anyUserId();
    const k = { userId, scope: 'cmd:test:one', key: randomUUID() };
    keys.push(k);
    expect((await beginIdempotent(k.userId, k.scope, k.key, HASH_A)).kind).toBe('new');
    expect((await beginIdempotent(k.userId, k.scope, k.key, HASH_A)).kind).toBe('in_progress');
    await finishIdempotent(k.userId, k.scope, k.key, 200, { data: { n: 1 } });
    // No module state is involved: a fresh call only has the database.
    const replay = await beginIdempotent(k.userId, k.scope, k.key, HASH_A);
    expect(replay).toEqual({ kind: 'replay', code: 200, body: { data: { n: 1 } } });
  });

  it('a different request hash with the same key is a mismatch', async () => {
    const userId = await anyUserId();
    const k = { userId, scope: 'cmd:test:two', key: randomUUID() };
    keys.push(k);
    await beginIdempotent(k.userId, k.scope, k.key, HASH_A);
    expect((await beginIdempotent(k.userId, k.scope, k.key, HASH_B)).kind).toBe('mismatch');
  });

  it('the same key in another scope is independent', async () => {
    const userId = await anyUserId();
    const key = randomUUID();
    const a = { userId, scope: 'cmd:test:a', key };
    const b = { userId, scope: 'cmd:test:b', key };
    keys.push(a, b);
    expect((await beginIdempotent(a.userId, a.scope, key, HASH_A)).kind).toBe('new');
    expect((await beginIdempotent(b.userId, b.scope, key, HASH_B)).kind).toBe('new');
  });

  it('concurrent starts: exactly one runs', async () => {
    const userId = await anyUserId();
    const k = { userId, scope: 'cmd:test:race', key: randomUUID() };
    keys.push(k);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => beginIdempotent(k.userId, k.scope, k.key, HASH_A)),
    );
    expect(results.filter((r) => r.kind === 'new')).toHaveLength(1);
  });

  it('abandon lets the client retry; expired rows are purged', async () => {
    const userId = await anyUserId();
    const k = { userId, scope: 'cmd:test:retry', key: randomUUID() };
    keys.push(k);
    await beginIdempotent(k.userId, k.scope, k.key, HASH_A);
    await abandonIdempotent(k.userId, k.scope, k.key);
    expect((await beginIdempotent(k.userId, k.scope, k.key, HASH_A)).kind).toBe('new');
    await prisma.idempotencyKey.update({
      where: { userId_scope_key: k as never },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await purgeExpiredIdempotency()).toBeGreaterThanOrEqual(1);
  });
});
