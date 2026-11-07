// GET /meta/roles and /meta/departments (CONTRACT §7), the append-only audit_logs trigger
// (CONTRACT §5), and log redaction of secrets (CONTRACT §6 Logging).
import { Writable } from 'node:stream';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { recordAudit } from '../src/core/audit/audit-service';
import { DEPARTMENTS } from '../src/core/departments';
import { createLogger } from '../src/core/logger';
import { ROLES } from '../src/core/rbac/role-rules';
import type { RoleCode } from '../src/core/rbac/role-rules';
import { API, newApp, prisma, signInAs } from './helpers';

const app = newApp();

describe('GET /meta/roles', () => {
  it('requires a Bearer token', async () => {
    expect((await request(app).get(`${API}/meta/roles`)).status).toBe(401);
  });
});

describe('GET /meta/departments', () => {
  it('returns the active DB departments, the 11 seeded ones first in prototype order', async () => {
    const s = await signInAs(app, 'MEMBER');
    const res = await request(app).get(`${API}/meta/departments`).set(s.bearer);
    expect(res.status).toBe(200);
    const names = (res.body as { data: string[] }).data;
    const active = await prisma.department.findMany({ where: { status: 'ACTIVE' } });
    expect([...names].sort()).toEqual(active.map((d) => d.name).sort());
    expect(names.slice(0, 11)).toEqual([
      'Administration',
      'Sales',
      'Purchase',
      'Finance',
      'HR',
      'Production',
      'Quality',
      'Maintenance',
      'Warehouse',
      'Projects',
      'Service',
    ]);
    expect(DEPARTMENTS).toHaveLength(11);
  });

  it('requires a Bearer token', async () => {
    expect((await request(app).get(`${API}/meta/departments`)).status).toBe(401);
  });
});

describe('audit_logs is append-only', () => {
  it('raises on UPDATE, DELETE and TRUNCATE', async () => {
    await recordAudit({ action: 'LOGOUT', detail: { probe: true } });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'LOGOUT' } });
    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { action: 'TAMPERED' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe('DELETE FROM audit_logs')).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe('TRUNCATE audit_logs')).rejects.toThrow(/append-only/);
    expect(await prisma.auditLog.findUnique({ where: { id: row.id } })).not.toBeNull();
  });
});

describe('logger redaction', () => {
  it('redacts passwords, hashes, auth headers and cookies', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const log = createLogger('info', sink);
    log.info(
      {
        password: 'p1-secret',
        body: { newPassword: 'p2-secret', currentPassword: 'p3-secret', temporaryPassword: 'p4' },
        user: { passwordHash: '$argon2id$secret' },
        req: { headers: { authorization: 'Bearer tok-secret', cookie: 'rt=cookie-secret' } },
      },
      'probe',
    );
    const out = lines.join('');
    for (const secret of [
      'p1-secret',
      'p2-secret',
      'p3-secret',
      '$argon2id$secret',
      'tok-secret',
      'cookie-secret',
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('[REDACTED]');
  });
});
