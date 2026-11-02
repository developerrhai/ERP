// Phase 3 §A1 User Master units: unitIds (>= 1 active unit for MANAGER/LEAD/MEMBER, optional for
// ADMIN), defaultUnitId (must be one of them), the DTO's units / defaultUnitId, the unitId list
// filter, audit detail, and that unit access changes reach the access decision immediately.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API,
  auditRows,
  errorOf,
  makeUser,
  newApp,
  prisma,
  signIn,
  signInAs,
  signInOwner,
  uniqueLoginId,
  unitIds,
} from './helpers';
import type { Signed } from './helpers';
import { makeUnit, restorePhase3, snapshotPhase3 } from './phase3-helpers';
import type { Phase3Snapshot } from './phase3-helpers';

const app = newApp();
let owner: Signed;
let admin: Signed;
let snap: Phase3Snapshot;
let TAL: string;
let SAW: string;
let VAR: string;

interface UserBody {
  id: string;
  role: string;
  version: number;
  units: { id: string; code: string; name: string }[];
  defaultUnitId: string | null;
}

beforeAll(async () => {
  owner = await signInOwner(app);
  admin = await signInAs(app, 'ADMIN');
  snap = await snapshotPhase3();
  [TAL, SAW, VAR] = (await unitIds()) as [string, string, string];
});

afterAll(async () => {
  await restorePhase3(snap);
});

function payload(overrides: Record<string, unknown> = {}) {
  const loginId = uniqueLoginId('p3');
  return {
    loginId,
    name: 'Unit Person',
    role: 'MEMBER',
    department: 'Sales',
    temporaryPassword: 'Temp-Passw0rd!',
    ...overrides,
  };
}

const create = (s: Signed, body: Record<string, unknown>) =>
  request(app).post(`${API}/users`).set(s.bearer).send(body);

const patch = (s: Signed, id: string, body: Record<string, unknown>, version: number) =>
  request(app)
    .patch(`${API}/users/${id}`)
    .set(s.bearer)
    .set('If-Match', String(version))
    .send(body);

const dataOf = (res: request.Response) => (res.body as { data: UserBody }).data;

describe('POST /users with units', () => {
  it('MANAGER/LEAD/MEMBER need at least one unit', async () => {
    for (const role of ['MANAGER', 'LEAD', 'MEMBER']) {
      for (const extra of [{}, { unitIds: [] }]) {
        const res = await create(admin, payload({ role, ...extra }));
        expect(res.status).toBe(422);
        expect(errorOf(res).fields?.unitIds).toBeDefined();
      }
    }
  });

  it('creates with units in Unit Master order and a default; audited with the unit ids', async () => {
    const res = await create(admin, payload({ unitIds: [VAR, TAL], defaultUnitId: VAR }));
    expect(res.status).toBe(201);
    const user = dataOf(res);
    expect(user.units).toEqual([
      { id: TAL, code: 'TAL', name: 'Talwade' },
      { id: VAR, code: 'VAR', name: 'Varale' },
    ]);
    expect(user.defaultUnitId).toBe(VAR);
    const rows = await auditRows('USER_CREATED', { targetId: user.id });
    expect(rows[0]?.detail).toMatchObject({ unitIds: [VAR, TAL].sort(), defaultUnitId: VAR });
    const get = await request(app).get(`${API}/users/${user.id}`).set(admin.bearer);
    expect(dataOf(get).units.map((u) => u.code)).toEqual(['TAL', 'VAR']);
  });

  it('ADMIN needs no units and may default to any active unit', async () => {
    const res = await create(owner, payload({ role: 'ADMIN', defaultUnitId: SAW }));
    expect(res.status).toBe(201);
    expect(dataOf(res)).toMatchObject({ units: [], defaultUnitId: SAW });
  });

  it('422 for unknown, inactive, duplicate or malformed units and a default outside them', async () => {
    const inactive = await makeUnit('INACTIVE');
    const unknown = '00000000-0000-4000-8000-000000000000';
    for (const [extra, field] of [
      [{ unitIds: [unknown] }, 'unitIds'],
      [{ unitIds: [TAL, inactive.id] }, 'unitIds'],
      [{ unitIds: [TAL, TAL] }, 'unitIds'],
      [{ unitIds: ['TAL'] }, 'unitIds.0'],
      [{ unitIds: 'TAL' }, 'unitIds'],
      [{ unitIds: [TAL], defaultUnitId: SAW }, 'defaultUnitId'],
      [{ unitIds: [TAL], defaultUnitId: 'x' }, 'defaultUnitId'],
    ] as const) {
      const res = await create(admin, payload(extra));
      expect(res.status, JSON.stringify(extra)).toBe(422);
      expect(errorOf(res).fields?.[field], JSON.stringify(extra)).toBeDefined();
    }
    const adminDefault = await create(
      owner,
      payload({ role: 'ADMIN', defaultUnitId: inactive.id }),
    );
    expect(errorOf(adminDefault).fields?.defaultUnitId).toBeDefined();
  });

  it('hierarchy is still checked first: a MANAGER gets 403, not 422', async () => {
    const manager = await signInAs(app, 'MANAGER');
    expect((await create(manager, payload())).status).toBe(403);
  });
});

describe('PATCH /users/:id units', () => {
  it('replaces the units, bumps the version, audits before/after; drops a default that left', async () => {
    const user = await makeUser({ unitCodes: ['TAL', 'SAW'], defaultUnitCode: 'SAW' });
    const res = await patch(admin, user.id, { unitIds: [TAL, VAR] }, user.version);
    expect(res.status).toBe(200);
    const body = dataOf(res);
    expect(body.units.map((u) => u.code)).toEqual(['TAL', 'VAR']);
    expect(body.defaultUnitId).toBeNull();
    expect(body.version).toBe(user.version + 1);
    const rows = await auditRows('USER_UPDATED', { targetId: user.id });
    expect(rows.at(-1)?.detail).toMatchObject({
      before: { unitIds: [TAL, SAW].sort(), defaultUnitId: SAW },
      after: { unitIds: [TAL, VAR].sort(), defaultUnitId: null },
    });
    expect(
      (await prisma.userUnit.findMany({ where: { userId: user.id } })).map((r) => r.unitId).sort(),
    ).toEqual([TAL, VAR].sort());

    const setDefault = await patch(admin, user.id, { defaultUnitId: VAR }, body.version);
    expect(dataOf(setDefault).defaultUnitId).toBe(VAR);
    const outside = await patch(admin, user.id, { defaultUnitId: SAW }, body.version + 1);
    expect(outside.status).toBe(422);
    expect(errorOf(outside).fields?.defaultUnitId).toBeDefined();
    const cleared = await patch(admin, user.id, { defaultUnitId: null }, body.version + 1);
    expect(dataOf(cleared).defaultUnitId).toBeNull();
  });

  it('a non-admin cannot end up with no unit (also when demoted from ADMIN)', async () => {
    const member = await makeUser();
    const empty = await patch(admin, member.id, { unitIds: [] }, member.version);
    expect(empty.status).toBe(422);
    expect(errorOf(empty).fields?.unitIds).toBeDefined();

    const otherAdmin = await makeUser({ role: 'ADMIN' });
    const demote = await patch(owner, otherAdmin.id, { role: 'MANAGER' }, otherAdmin.version);
    expect(demote.status).toBe(422);
    expect(errorOf(demote).fields?.unitIds).toBeDefined();
    const ok = await patch(
      owner,
      otherAdmin.id,
      { role: 'MANAGER', unitIds: [SAW], defaultUnitId: SAW },
      otherAdmin.version,
    );
    expect(ok.status).toBe(200);
    expect(dataOf(ok)).toMatchObject({ role: 'MANAGER', defaultUnitId: SAW });
  });

  it('an assigned unit that was deactivated may stay; a newly added inactive unit is refused', async () => {
    const unit = await makeUnit();
    const user = await makeUser({ unitCodes: ['TAL', unit.code] });
    await prisma.unit.update({ where: { id: unit.id }, data: { status: 'INACTIVE' } });
    const keep = await patch(admin, user.id, { unitIds: [unit.id, TAL, SAW] }, user.version);
    expect(keep.status).toBe(200);
    const other = await makeUnit('INACTIVE');
    const add = await patch(admin, user.id, { unitIds: [TAL, other.id] }, user.version + 1);
    expect(add.status).toBe(422);
    expect(errorOf(add).fields?.unitIds).toContain(other.code);
  });

  it('removing a unit takes effect for that user at once (/me/context)', async () => {
    const user = await makeUser({ unitCodes: ['TAL', 'SAW'] });
    const s = await signIn(app, user);
    const read = () => request(app).get(`${API}/me/context`).set(s.bearer);
    expect(
      ((await read()).body as { data: { units: { code: string }[] } }).data.units.map(
        (u) => u.code,
      ),
    ).toEqual(['TAL', 'SAW']);
    await patch(admin, user.id, { unitIds: [SAW] }, user.version).expect(200);
    expect(
      ((await read()).body as { data: { units: { code: string }[] } }).data.units.map(
        (u) => u.code,
      ),
    ).toEqual(['SAW']);
  });
});

describe('GET /users?unitId=', () => {
  it('lists users assigned to the unit plus ADMIN+; 422 for a bad id', async () => {
    const unit = await makeUnit();
    const inUnit = await makeUser({ unitCodes: [unit.code] });
    const elsewhere = await makeUser({ unitCodes: ['TAL'] });
    const res = await request(app)
      .get(`${API}/users`)
      .query({ unitId: unit.id, size: 100 })
      .set(admin.bearer);
    expect(res.status).toBe(200);
    const body = res.body as { data: UserBody[]; meta: { total: number } };
    const ids = body.data.map((u) => u.id);
    expect(ids).toContain(inUnit.id);
    expect(ids).not.toContain(elsewhere.id);
    expect(
      body.data.every((u) => ['SUPER_ADMIN', 'ADMIN'].includes(u.role) || u.id === inUnit.id),
    ).toBe(true);
    expect(body.meta.total).toBe(
      await prisma.user.count({
        where: {
          OR: [
            { units: { some: { unitId: unit.id } } },
            { role: { in: ['SUPER_ADMIN', 'ADMIN'] } },
          ],
        },
      }),
    );
    expect((await request(app).get(`${API}/users?unitId=TAL`).set(admin.bearer)).status).toBe(422);
  });

  it('list rows and /auth/me carry units and defaultUnitId', async () => {
    const user = await makeUser({ unitCodes: ['VAR'], defaultUnitCode: 'VAR' });
    const s = await signIn(app, user);
    const me = await request(app).get(`${API}/auth/me`).set(s.bearer);
    expect((me.body as { data: UserBody }).data).toMatchObject({
      units: [{ id: VAR, code: 'VAR', name: 'Varale' }],
      defaultUnitId: VAR,
    });
    const list = await request(app)
      .get(`${API}/users`)
      .query({ q: user.loginId })
      .set(admin.bearer);
    expect((list.body as { data: UserBody[] }).data[0]?.units.map((u) => u.code)).toEqual(['VAR']);
  });
});
