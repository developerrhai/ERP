// /users endpoints (CONTRACT §7): list/get for ADMIN+, create, PATCH with If-Match optimistic
// locking, deactivate, reset-password, duplicates, strict validation, self-edit bans and audit rows.
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  API,
  PASSWORD,
  XRW,
  auditRows,
  errorOf,
  login,
  makeUser,
  newApp,
  owner,
  prisma,
  signIn,
  signInAs,
  signInOwner,
  uniqueLoginId,
} from './helpers';
import type { Signed } from './helpers';

const app = newApp();
let superAdmin: Signed;
let admin: Signed;

beforeAll(async () => {
  superAdmin = await signInOwner(app);
  admin = await signInAs(app, 'ADMIN');
});

interface UserBody {
  id: string;
  loginId: string;
  email: string | null;
  role: string;
  status: string;
  version: number;
  mustChangePassword: boolean;
  department: string | null;
  name: string;
}

function newUserPayload(overrides: Record<string, unknown> = {}) {
  const loginId = uniqueLoginId('new');
  return {
    loginId,
    email: `${loginId}@corp.local`,
    name: 'New Person',
    role: 'MEMBER',
    department: 'Sales',
    temporaryPassword: 'Temp-Passw0rd!',
    ...overrides,
  };
}

describe('GET /users', () => {
  it('is ADMIN+ only', async () => {
    for (const role of ['MANAGER', 'LEAD', 'MEMBER'] as const) {
      const s = await signInAs(app, role);
      const res = await request(app).get(`${API}/users`).set(s.bearer);
      expect(res.status).toBe(403);
      expect(errorOf(res).code).toBe('FORBIDDEN');
    }
    expect((await request(app).get(`${API}/users`)).status).toBe(401);
    expect((await request(app).get(`${API}/users`).set(admin.bearer)).status).toBe(200);
    expect((await request(app).get(`${API}/users`).set(superAdmin.bearer)).status).toBe(200);
  });

  it('paginates and reports page, size, total', async () => {
    const res = await request(app).get(`${API}/users?page=1&size=2`).set(admin.bearer);
    expect(res.status).toBe(200);
    const body = res.body as {
      data: UserBody[];
      meta: { page: number; size: number; total: number };
    };
    expect(body.data.length).toBeLessThanOrEqual(2);
    expect(body.meta.page).toBe(1);
    expect(body.meta.size).toBe(2);
    expect(body.meta.total).toBe(await prisma.user.count());
  });

  it('filters by q, role, status and department and sorts', async () => {
    const tag = uniqueLoginId('findme');
    await makeUser({ loginId: `${tag}-a`, name: 'Zed Finder', role: 'LEAD', department: 'HR' });
    await makeUser({ loginId: `${tag}-b`, name: 'Amy Finder', role: 'LEAD', department: 'HR' });
    await makeUser({ loginId: `${tag}-c`, role: 'LEAD', department: 'HR', status: 'INACTIVE' });

    const byQ = await request(app)
      .get(`${API}/users`)
      .query({ q: tag.toUpperCase() })
      .set(admin.bearer);
    expect((byQ.body as { data: UserBody[] }).data).toHaveLength(3);

    const filtered = await request(app)
      .get(`${API}/users`)
      .query({ q: tag, role: 'LEAD', status: 'ACTIVE', department: 'HR', sort: 'name' })
      .set(admin.bearer);
    const names = (filtered.body as { data: UserBody[] }).data.map((u) => u.name);
    expect(names).toEqual(['Amy Finder', 'Zed Finder']);

    const desc = await request(app)
      .get(`${API}/users`)
      .query({ q: tag, status: 'ACTIVE', sort: '-name' })
      .set(admin.bearer);
    expect((desc.body as { data: UserBody[] }).data.map((u) => u.name)).toEqual([
      'Zed Finder',
      'Amy Finder',
    ]);
  });

  it('rejects bad query values and unknown query keys with 422', async () => {
    for (const query of [
      { size: 101 },
      { page: 0 },
      { sort: 'passwordHash' },
      { role: 'GOD' },
      { foo: 1 },
    ]) {
      const res = await request(app).get(`${API}/users`).query(query).set(admin.bearer);
      expect(res.status).toBe(422);
      expect(errorOf(res).code).toBe('VALIDATION_ERROR');
    }
  });

  it('never exposes hashes or lockout counters', async () => {
    const res = await request(app).get(`${API}/users`).set(admin.bearer);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('passwordHash');
    expect(text).not.toContain('argon2');
    expect(text).not.toContain('failedLoginCount');
    expect(text).not.toContain('lockedUntil');
  });
});

describe('GET /users/:id', () => {
  it('returns one user, 404 for unknown id, 422 for a malformed id', async () => {
    const user = await makeUser();
    const ok = await request(app).get(`${API}/users/${user.id}`).set(admin.bearer);
    expect(ok.status).toBe(200);
    expect((ok.body as { data: UserBody }).data.loginId).toBe(user.loginId);
    const missing = await request(app)
      .get(`${API}/users/00000000-0000-4000-8000-000000000000`)
      .set(admin.bearer);
    expect(missing.status).toBe(404);
    const bad = await request(app).get(`${API}/users/not-a-uuid`).set(admin.bearer);
    expect(bad.status).toBe(422);
  });

  it('is forbidden below ADMIN', async () => {
    const user = await makeUser();
    const lead = await signInAs(app, 'LEAD');
    expect((await request(app).get(`${API}/users/${user.id}`).set(lead.bearer)).status).toBe(403);
  });
});

describe('POST /users', () => {
  it('creates a user with mustChangePassword=true, lowercased, audited without secrets', async () => {
    const payload = newUserPayload({ loginId: `  ${uniqueLoginId('MixedCase').toUpperCase()} ` });
    const res = await request(app).post(`${API}/users`).set(admin.bearer).send(payload);
    expect(res.status).toBe(201);
    const user = (res.body as { data: UserBody }).data;
    expect(user.loginId).toBe(String(payload.loginId).trim().toLowerCase());
    expect(user.mustChangePassword).toBe(true);
    expect(user.version).toBe(1);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.createdById).toBe(admin.user.id);
    const rows = await auditRows('USER_CREATED', { targetId: user.id });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('Temp-Passw0rd!');
    expect(JSON.stringify(rows)).not.toContain('argon2');
    // The new user can sign in with the temporary password and is gated.
    const signed = await login(app, user.loginId, 'Temp-Passw0rd!');
    expect(signed.status).toBe(200);
  });

  it('allows a null/empty email', async () => {
    const res = await request(app)
      .post(`${API}/users`)
      .set(admin.bearer)
      .send(newUserPayload({ email: '' }));
    expect(res.status).toBe(201);
    expect((res.body as { data: UserBody }).data.email).toBeNull();
  });

  it('returns 409 DUPLICATE with fields for a taken loginId or email', async () => {
    const existing = await makeUser();
    const dupLogin = await request(app)
      .post(`${API}/users`)
      .set(admin.bearer)
      .send(newUserPayload({ loginId: existing.loginId.toUpperCase() }));
    expect(dupLogin.status).toBe(409);
    expect(errorOf(dupLogin).code).toBe('DUPLICATE');
    expect(errorOf(dupLogin).fields?.loginId).toBeDefined();

    const dupEmail = await request(app)
      .post(`${API}/users`)
      .set(admin.bearer)
      .send(newUserPayload({ email: existing.email?.toUpperCase() }));
    expect(dupEmail.status).toBe(409);
    expect(errorOf(dupEmail).fields?.email).toBeDefined();

    // loginId and email share one namespace because login accepts either.
    const crossed = await request(app)
      .post(`${API}/users`)
      .set(admin.bearer)
      .send(newUserPayload({ loginId: existing.email }));
    expect(crossed.status).toBe(409);
    expect(errorOf(crossed).fields?.loginId).toBeDefined();
  });

  it('validates fields: strict keys, loginId format, name, department, password policy', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [newUserPayload({ isAdmin: true }), 'isAdmin'],
      [newUserPayload({ loginId: 'a!' }), 'loginId'],
      [newUserPayload({ name: 'A' }), 'name'],
      [newUserPayload({ email: 'not-an-email' }), 'email'],
      [newUserPayload({ department: 'Marketing' }), 'department'],
      [newUserPayload({ department: undefined }), 'department'],
      [newUserPayload({ role: 'OWNER' }), 'role'],
      [newUserPayload({ temporaryPassword: 'weakpass' }), 'temporaryPassword'],
    ];
    for (const [payload, field] of cases) {
      const res = await request(app).post(`${API}/users`).set(admin.bearer).send(payload);
      expect(res.status, field).toBe(422);
      expect(errorOf(res).fields?.[field], field).toBeDefined();
    }
  });

  it('nobody can create a SUPER_ADMIN, and the DB allows only one', async () => {
    const res = await request(app)
      .post(`${API}/users`)
      .set(superAdmin.bearer)
      .send(newUserPayload({ role: 'SUPER_ADMIN' }));
    expect(res.status).toBe(403);
    await expect(makeUser({ role: 'SUPER_ADMIN' })).rejects.toThrow();
    expect(await prisma.user.count({ where: { role: 'SUPER_ADMIN' } })).toBe(1);
  });
});

describe('PATCH /users/:id', () => {
  const patch = (s: Signed, id: string, body: Record<string, unknown>, version?: string) => {
    const req = request(app).patch(`${API}/users/${id}`).set(s.bearer);
    return (version === undefined ? req : req.set('If-Match', version)).send(body);
  };

  it('requires If-Match (400) and rejects a stale version (409)', async () => {
    const user = await makeUser();
    const missing = await patch(admin, user.id, { name: 'Changed Name' });
    expect(missing.status).toBe(400);
    expect(errorOf(missing)).toMatchObject({
      code: 'BAD_REQUEST',
      message: 'If-Match header required',
    });
    const garbage = await patch(admin, user.id, { name: 'Changed Name' }, 'abc');
    expect(garbage.status).toBe(400);
    const stale = await patch(admin, user.id, { name: 'Changed Name' }, String(user.version + 5));
    expect(stale.status).toBe(409);
    expect(errorOf(stale).code).toBe('VERSION_CONFLICT');
  });

  it('updates, bumps the version, accepts quoted ETags and audits before/after', async () => {
    const user = await makeUser({ name: 'Old Name' });
    const res = await patch(
      admin,
      user.id,
      { name: 'New Name', department: 'Finance' },
      `"${user.version}"`,
    );
    expect(res.status).toBe(200);
    const body = (res.body as { data: UserBody }).data;
    expect(body.name).toBe('New Name');
    expect(body.department).toBe('Finance');
    expect(body.version).toBe(user.version + 1);
    expect(res.headers.etag).toBe(`"${body.version}"`);

    const again = await patch(admin, user.id, { name: 'Third Name' }, String(user.version));
    expect(again.status).toBe(409);

    const rows = await auditRows('USER_UPDATED', { targetId: user.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toMatchObject({
      before: { name: 'Old Name', department: 'Sales' },
      after: { name: 'New Name', department: 'Finance' },
    });
    expect(JSON.stringify(rows)).not.toContain('argon2');
  });

  it('rejects unknown keys, empty bodies and null department with 422', async () => {
    const user = await makeUser();
    for (const body of [
      { passwordHash: 'x' },
      {},
      { department: null },
      { loginId: 'new-login' },
    ]) {
      const res = await patch(admin, user.id, body, String(user.version));
      expect(res.status).toBe(422);
    }
  });

  it('returns 409 DUPLICATE for an email already in use', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const res = await patch(admin, b.id, { email: a.email }, String(b.version));
    expect(res.status).toBe(409);
    expect(errorOf(res).fields?.email).toBeDefined();
  });

  it('returns 404 for an unknown user', async () => {
    const res = await patch(
      admin,
      '00000000-0000-4000-8000-000000000000',
      { name: 'Nobody Here' },
      '1',
    );
    expect(res.status).toBe(404);
  });

  it('deactivating revokes every session of that user', async () => {
    const user = await makeUser();
    const s1 = await signIn(app, user);
    const s2 = await signIn(app, user);
    const res = await patch(admin, user.id, { status: 'INACTIVE' }, String(user.version));
    expect(res.status).toBe(200);
    expect((res.body as { data: UserBody }).data.status).toBe('INACTIVE');
    for (const s of [s1, s2]) {
      expect((await request(app).get(`${API}/auth/me`).set(s.bearer)).status).toBe(401);
      expect(
        (await request(app).post(`${API}/auth/refresh`).set(XRW).set('Cookie', s.cookie)).status,
      ).toBe(401);
    }
    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions.every((x) => x.revokedReason === 'deactivated')).toBe(true);
    expect((await login(app, user.loginId)).status).toBe(401);

    // Reactivation lets them sign in again.
    const back = await patch(admin, user.id, { status: 'ACTIVE' }, String(user.version + 1));
    expect(back.status).toBe(200);
    expect((await login(app, user.loginId)).status).toBe(200);
  });

  it('a user can never change their own role or status', async () => {
    const me = admin.user;
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
    for (const body of [{ role: 'MANAGER' }, { status: 'INACTIVE' }, { name: 'Self Rename' }]) {
      const res = await patch(admin, me.id, body, String(fresh.version));
      expect(res.status).toBe(403);
    }
    const ownerUser = await owner();
    const selfOwner = await patch(
      superAdmin,
      ownerUser.id,
      { role: 'ADMIN' },
      String(ownerUser.version),
    );
    expect(selfOwner.status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ownerUser.id } })).role).toBe(
      'SUPER_ADMIN',
    );
  });

  it('a role change needs both the old and the new role to be manageable', async () => {
    const member = await makeUser({ role: 'MEMBER' });
    const promote = await patch(admin, member.id, { role: 'ADMIN' }, String(member.version));
    expect(promote.status).toBe(403);
    const otherAdmin = await makeUser({ role: 'ADMIN' });
    const demote = await patch(
      admin,
      otherAdmin.id,
      { role: 'MEMBER' },
      String(otherAdmin.version),
    );
    expect(demote.status).toBe(403);
    const toSuper = await patch(
      superAdmin,
      member.id,
      { role: 'SUPER_ADMIN' },
      String(member.version),
    );
    expect(toSuper.status).toBe(403);
    const ok = await patch(admin, member.id, { role: 'MANAGER' }, String(member.version));
    expect(ok.status).toBe(200);
    const byOwner = await patch(
      superAdmin,
      otherAdmin.id,
      { role: 'LEAD' },
      String(otherAdmin.version),
    );
    expect(byOwner.status).toBe(200);
  });
});

describe('POST /users/:id/reset-password', () => {
  const reset = (s: Signed, id: string, body: Record<string, unknown>) =>
    request(app).post(`${API}/users/${id}/reset-password`).set(s.bearer).send(body);

  it('sets mustChangePassword, revokes sessions, clears lockout, returns 204 and is audited', async () => {
    const user = await makeUser();
    const s = await signIn(app, user);
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 4, lockedUntil: new Date(Date.now() + 60_000) },
    });
    const res = await reset(admin, user.id, { temporaryPassword: 'Reset-Passw0rd!' });
    expect(res.status).toBe(204);
    expect((await request(app).get(`${API}/auth/me`).set(s.bearer)).status).toBe(401);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.mustChangePassword).toBe(true);
    expect(stored.failedLoginCount).toBe(0);
    expect(stored.lockedUntil).toBeNull();
    expect((await login(app, user.loginId, PASSWORD)).status).toBe(401);
    expect((await login(app, user.loginId, 'Reset-Passw0rd!')).status).toBe(200);
    const rows = await auditRows('USER_PASSWORD_RESET', { targetId: user.id });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('Reset-Passw0rd!');
  });

  it('applies the password policy and strict validation', async () => {
    const user = await makeUser();
    expect((await reset(admin, user.id, { temporaryPassword: 'weak' })).status).toBe(422);
    expect((await reset(admin, user.id, { temporaryPassword: user.loginId })).status).toBe(422);
    expect((await reset(admin, user.id, {})).status).toBe(422);
    expect(
      (await reset(admin, user.id, { temporaryPassword: 'Reset-Passw0rd!', notify: true })).status,
    ).toBe(422);
  });

  it('cannot reset your own password through the admin endpoint', async () => {
    const res = await reset(admin, admin.user.id, { temporaryPassword: 'Reset-Passw0rd!' });
    expect(res.status).toBe(403);
    const self = await reset(superAdmin, superAdmin.user.id, {
      temporaryPassword: 'Reset-Passw0rd!',
    });
    expect(self.status).toBe(403);
  });

  it('returns 404 for an unknown user', async () => {
    const res = await reset(admin, '00000000-0000-4000-8000-000000000000', {
      temporaryPassword: 'Reset-Passw0rd!',
    });
    expect(res.status).toBe(404);
  });
});
