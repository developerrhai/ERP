// Phase 3 §A1/§A2 masters: GET/PATCH /company, Unit Master CRUD (409 DUPLICATE / IN_USE /
// VERSION_CONFLICT), Financial Years (Indian FY dates, no overlap, single current, close / reopen),
// the page permissions behind them, the DB rules, the Administration allow_* lock and the seed.
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { seedPhase3Defaults } from '../src/core/seed/phase3-defaults';
import { invalidateAccessCache } from '../src/core/rbac/access';
import {
  API,
  auditRows,
  errorOf,
  makeUser,
  newApp,
  prisma,
  signInAs,
  signInOwner,
} from './helpers';
import type { Signed } from './helpers';
import { controlVersion, restoreGlobal, snapshotGlobal } from './phase2-helpers';
import type { GlobalSnapshot } from './phase2-helpers';
import { fyByCode, makeUnit, restorePhase3, snapshotPhase3, unitByCode } from './phase3-helpers';
import type { Phase3Snapshot } from './phase3-helpers';

const app = newApp();
let owner: Signed;
let admin: Signed;
let manager: Signed;
let snap3: Phase3Snapshot;
let snap2: GlobalSnapshot;

beforeAll(async () => {
  owner = await signInOwner(app);
  admin = await signInAs(app, 'ADMIN');
  manager = await signInAs(app, 'MANAGER');
  snap3 = await snapshotPhase3();
  snap2 = await snapshotGlobal();
});

afterEach(async () => {
  await restorePhase3(snap3);
  await restoreGlobal(snap2);
});

afterAll(async () => {
  await restorePhase3(snap3);
});

const below = ['MANAGER', 'LEAD', 'MEMBER'] as const;

/** A page: row that switches one action off for ADMIN (written straight to the DB). */
async function denyAdmin(pageId: string, action: 'view' | 'controls') {
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMINISTRATOR' } });
  await prisma.rolePermission.upsert({
    where: { roleId_resource: { roleId: adminRole.id, resource: `page:${pageId}` } },
    update: { [action]: false },
    create: { roleId: adminRole.id, resource: `page:${pageId}`, [action]: false },
  });
  invalidateAccessCache();
}

// ------------------------------------------------------------------------------------------------
describe('GET / PATCH /company', () => {
  interface CompanyBody {
    id: string;
    code: string;
    legalName: string;
    tradeName: string;
    pan: string | null;
    cin: string | null;
    gstin: string | null;
    address: string | null;
    currency: string;
    timezone: string;
    version: number;
  }
  const getCompany = async (s: Signed) => {
    const res = await request(app).get(`${API}/company`).set(s.bearer);
    return { res, body: (res.body as { data: CompanyBody }).data };
  };
  const patch = (s: Signed, body: Record<string, unknown>, version?: number) => {
    const req = request(app).patch(`${API}/company`).set(s.bearer);
    if (version !== undefined) void req.set('If-Match', String(version));
    return req.send(body);
  };

  it('returns the seeded single company with an ETag', async () => {
    const { res, body } = await getCompany(admin);
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe(`"${body.version}"`);
    expect(body).toMatchObject({
      code: 'SAWANT',
      legalName: 'Sawant Group (Ready Hand)',
      tradeName: 'Sawant Group',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      pan: null,
      gstin: null,
    });
    expect(await prisma.company.count()).toBe(1);
  });

  it('PATCH validates like the letterhead, upper-cases ids, bumps the version, audits', async () => {
    const { body: before } = await getCompany(admin);
    const res = await patch(
      admin,
      {
        tradeName: 'Sawant Group Pune',
        gstin: '27aapfu0939f1zv',
        pan: 'aapfu0939f',
        cin: 'u12345mh2020ptc123456',
        address: '  Plot 4, Talwade MIDC  ',
      },
      before.version,
    );
    expect(res.status).toBe(200);
    const after = (res.body as { data: CompanyBody }).data;
    expect(after).toMatchObject({
      tradeName: 'Sawant Group Pune',
      gstin: '27AAPFU0939F1ZV',
      pan: 'AAPFU0939F',
      cin: 'U12345MH2020PTC123456',
      address: 'Plot 4, Talwade MIDC',
      version: before.version + 1,
    });
    expect(res.headers.etag).toBe(`"${after.version}"`);
    const rows = await auditRows('COMPANY_UPDATED', { targetId: before.id });
    expect(rows.at(-1)?.detail).toMatchObject({
      before: { tradeName: 'Sawant Group' },
      after: { tradeName: 'Sawant Group Pune' },
    });
    // Empty strings clear optional ids.
    const cleared = await patch(admin, { gstin: '', pan: ' ' }, after.version);
    expect((cleared.body as { data: CompanyBody }).data).toMatchObject({ gstin: null, pan: null });
  });

  it('no-op PATCH keeps the version and writes no audit row', async () => {
    const { body } = await getCompany(admin);
    const auditBefore = (await auditRows('COMPANY_UPDATED')).length;
    const res = await patch(admin, { tradeName: body.tradeName }, body.version);
    expect(res.status).toBe(200);
    expect((res.body as { data: CompanyBody }).data.version).toBe(body.version);
    expect(await auditRows('COMPANY_UPDATED')).toHaveLength(auditBefore);
  });

  it('400 without If-Match, 409 VERSION_CONFLICT when stale, 422 for bad fields', async () => {
    const { body } = await getCompany(admin);
    expect((await patch(admin, { tradeName: 'X Y' })).status).toBe(400);
    const stale = await patch(admin, { tradeName: 'Other Name' }, body.version + 5);
    expect(stale.status).toBe(409);
    expect(errorOf(stale).code).toBe('VERSION_CONFLICT');
    for (const [field, value] of [
      ['gstin', '27AAPFU0939F1Z'],
      ['pan', 'ABCDE12345'],
      ['cin', 'X12345MH2020PTC123456'],
      ['currency', 'USD'],
      ['timezone', 'Asia/Dubai'],
      ['legalName', 'A'],
      ['code', 'OTHER'],
    ] as const) {
      const res = await patch(admin, { [field]: value }, body.version);
      expect(res.status, field).toBe(422);
      expect(errorOf(res).fields?.[field], field).toBeDefined();
    }
    expect((await patch(admin, {}, body.version)).status).toBe(422);
  });

  it('needs view / controls on admin-company: below ADMIN 403, and the page row binds ADMIN', async () => {
    for (const role of below) {
      const s = await signInAs(app, role);
      expect((await request(app).get(`${API}/company`).set(s.bearer)).status).toBe(403);
      expect((await patch(s, { tradeName: 'Nope Co' }, 1)).status).toBe(403);
    }
    expect((await request(app).get(`${API}/company`)).status).toBe(401);
    await denyAdmin('admin-company', 'controls');
    const { body } = await getCompany(admin);
    expect((await patch(admin, { tradeName: 'Blocked Co' }, body.version)).status).toBe(403);
    await denyAdmin('admin-company', 'view');
    expect((await request(app).get(`${API}/company`).set(admin.bearer)).status).toBe(403);
  });
});

// ------------------------------------------------------------------------------------------------
describe('Unit Master /units', () => {
  interface UnitBody {
    id: string;
    code: string;
    name: string;
    address: string | null;
    gstin: string | null;
    status: string;
    userCount: number;
    version: number;
  }
  const code = () =>
    `Q${Math.random().toString(36).slice(2, 8).toUpperCase()}`.replace(/[^A-Z0-9]/g, 'X');
  const create = (s: Signed, body: Record<string, unknown>) =>
    request(app).post(`${API}/units`).set(s.bearer).send(body);
  const patch = (s: Signed, id: string, body: Record<string, unknown>, version?: number) => {
    const req = request(app).patch(`${API}/units/${id}`).set(s.bearer);
    if (version !== undefined) void req.set('If-Match', String(version));
    return req.send(body);
  };
  const remove = (s: Signed, id: string, version?: number) => {
    const req = request(app).delete(`${API}/units/${id}`).set(s.bearer);
    if (version !== undefined) void req.set('If-Match', String(version));
    return req;
  };

  it('lists TAL, SAW, VAR first (prototype order) with user counts; status filter', async () => {
    const inactive = await makeUnit('INACTIVE');
    const res = await request(app).get(`${API}/units`).set(admin.bearer);
    expect(res.status).toBe(200);
    const rows = (res.body as { data: UnitBody[] }).data;
    expect(rows.slice(0, 3).map((u) => [u.code, u.name])).toEqual([
      ['TAL', 'Talwade'],
      ['SAW', 'Sawardari'],
      ['VAR', 'Varale'],
    ]);
    const tal = rows[0];
    expect(tal?.userCount).toBe(
      await prisma.userUnit.count({ where: { unitId: (await unitByCode('TAL')).id } }),
    );
    expect(rows.map((u) => u.code)).toContain(inactive.code);
    const active = await request(app).get(`${API}/units?status=ACTIVE`).set(admin.bearer);
    expect((active.body as { data: UnitBody[] }).data.map((u) => u.code)).not.toContain(
      inactive.code,
    );
    expect((await request(app).get(`${API}/units?x=1`).set(admin.bearer)).status).toBe(422);
  });

  it('POST creates (code upper-cased, GSTIN validated), audits; GET/POST need admin-branches', async () => {
    const c = code();
    const res = await create(admin, {
      code: c.toLowerCase(),
      stateCode: '27',
      name: `Chakan ${c}`,
      address: 'Chakan MIDC',
      gstin: '27aapfu0939f1zv',
    });
    expect(res.status).toBe(201);
    const unit = (res.body as { data: UnitBody }).data;
    expect(unit).toMatchObject({
      code: c,
      status: 'ACTIVE',
      gstin: '27AAPFU0939F1ZV',
      userCount: 0,
      version: 1,
    });
    expect(await auditRows('UNIT_CREATED', { targetId: unit.id })).toHaveLength(1);
    for (const role of below) {
      const s = await signInAs(app, role);
      expect((await request(app).get(`${API}/units`).set(s.bearer)).status).toBe(403);
      expect((await create(s, { code: code(), name: 'Nope Unit' })).status).toBe(403);
    }
    await denyAdmin('admin-branches', 'controls');
    expect((await create(admin, { code: code(), name: `Blocked ${code()}` })).status).toBe(403);
  });

  it('409 DUPLICATE for a taken code or (case-insensitive) name; 422 for bad input', async () => {
    const dupCode = await create(admin, { code: 'tal', name: `Other ${code()}`, stateCode: '27' });
    expect(dupCode.status).toBe(409);
    expect(errorOf(dupCode)).toMatchObject({ code: 'DUPLICATE' });
    expect(errorOf(dupCode).fields?.code).toBeDefined();
    const dupName = await create(admin, { code: code(), name: 'talwade', stateCode: '27' });
    expect(dupName.status).toBe(409);
    expect(errorOf(dupName).fields?.name).toBeDefined();
    for (const [body, field] of [
      [{ code: 'A', name: 'Valid Name' }, 'code'],
      [{ code: 'AB-1', name: 'Valid Name' }, 'code'],
      [{ code: code(), name: 'X' }, 'name'],
      [{ code: code(), name: 'Valid Name', gstin: 'BAD' }, 'gstin'],
      [{ code: code(), name: 'Valid Name', status: 'ACTIVE' }, 'status'],
    ] as const) {
      const res = await create(admin, body);
      expect(res.status).toBe(422);
      expect(errorOf(res).fields?.[field]).toBeDefined();
    }
  });

  it('PATCH with If-Match renames / deactivates and audits; stale -> 409; no-op keeps the version', async () => {
    const unit = await makeUnit();
    const res = await patch(admin, unit.id, { name: `Renamed ${unit.code}` }, unit.version);
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe(`"${unit.version + 1}"`);
    const stale = await patch(admin, unit.id, { status: 'INACTIVE' }, unit.version);
    expect(stale.status).toBe(409);
    expect(errorOf(stale).code).toBe('VERSION_CONFLICT');
    const off = await patch(admin, unit.id, { status: 'INACTIVE' }, unit.version + 1);
    expect((off.body as { data: UnitBody }).data.status).toBe('INACTIVE');
    const rows = await auditRows('UNIT_UPDATED', { targetId: unit.id });
    expect(rows).toHaveLength(2);
    expect(rows[1]?.detail).toMatchObject({
      before: { status: 'ACTIVE' },
      after: { status: 'INACTIVE' },
    });
    const same = await patch(admin, unit.id, { status: 'INACTIVE' }, unit.version + 2);
    expect((same.body as { data: UnitBody }).data.version).toBe(unit.version + 2);
    expect(await auditRows('UNIT_UPDATED', { targetId: unit.id })).toHaveLength(2);
    expect((await patch(admin, unit.id, { name: 'No Header' })).status).toBe(400);
    const dup = await patch(admin, unit.id, { code: 'SAW' }, unit.version + 2);
    expect(dup.status).toBe(409);
    expect(errorOf(dup).code).toBe('DUPLICATE');
    expect((await patch(admin, unit.id, {}, unit.version + 2)).status).toBe(422);
  });

  it('DELETE: 204 + audit when unused; 409 IN_USE while a user has it (or as default); 404 / 409 stale', async () => {
    const unused = await makeUnit();
    const stale = await remove(admin, unused.id, unused.version + 1);
    expect(stale.status).toBe(409);
    expect(errorOf(stale).code).toBe('VERSION_CONFLICT');
    expect((await remove(admin, unused.id, unused.version)).status).toBe(204);
    expect(await prisma.unit.findUnique({ where: { id: unused.id } })).toBeNull();
    expect(await auditRows('UNIT_DELETED', { targetId: unused.id })).toHaveLength(1);
    expect((await remove(admin, unused.id)).status).toBe(404);

    const assigned = await makeUnit();
    await makeUser({ unitCodes: [assigned.code] });
    const inUse = await remove(admin, assigned.id);
    expect(inUse.status).toBe(409);
    expect(errorOf(inUse).code).toBe('IN_USE');

    const asDefault = await makeUnit();
    await makeUser({ role: 'ADMIN', unitCodes: [], defaultUnitCode: asDefault.code });
    expect(errorOf(await remove(admin, asDefault.id)).code).toBe('IN_USE');

    expect((await remove(admin, 'not-a-uuid')).status).toBe(422);
    expect((await remove(manager, assigned.id)).status).toBe(403);
  });

  it('a deactivated unit disappears from /me/context and cannot be assigned', async () => {
    const unit = await makeUnit();
    const member = await signInAs(app, 'MEMBER', { unitCodes: ['TAL', unit.code] });
    const ctx = async () =>
      (
        (await request(app).get(`${API}/me/context`).set(member.bearer)).body as {
          data: { units: { code: string }[] };
        }
      ).data.units.map((u) => u.code);
    expect(await ctx()).toContain(unit.code);
    await patch(admin, unit.id, { status: 'INACTIVE' }, unit.version).expect(200);
    expect(await ctx()).not.toContain(unit.code);
  });
});

// ------------------------------------------------------------------------------------------------
describe('Financial Years /financial-years', () => {
  interface FyBody {
    id: string;
    code: string;
    label: string;
    startDate: string;
    endDate: string;
    status: string;
    isCurrent: boolean;
    version: number;
  }
  const create = (s: Signed, body: Record<string, unknown>) =>
    request(app).post(`${API}/financial-years`).set(s.bearer).send(body);
  const action = (s: Signed, id: string, name: string, version?: number) => {
    const req = request(app).post(`${API}/financial-years/${id}/${name}`).set(s.bearer);
    if (version !== undefined) void req.set('If-Match', String(version));
    return req;
  };
  const currentCodes = async () =>
    (await prisma.financialYear.findMany({ where: { isCurrent: true } })).map((f) => f.code);

  it('POST {} adds the year after the latest (Indian FY dates), OPEN, not current, audited', async () => {
    const res = await create(admin, {});
    expect(res.status).toBe(201);
    const fy = (res.body as { data: FyBody }).data;
    expect(fy).toMatchObject({
      code: '2027-28',
      label: 'FY 2027-28',
      startDate: '2027-04-01',
      endDate: '2028-03-31',
      status: 'OPEN',
      isCurrent: false,
      version: 1,
    });
    expect(await auditRows('FINANCIAL_YEAR_CREATED', { targetId: fy.id })).toHaveLength(1);
    const next = await create(admin, { code: '2028-29', label: 'Year 28/29' });
    expect((next.body as { data: FyBody }).data).toMatchObject({
      code: '2028-29',
      label: 'Year 28/29',
      startDate: '2028-04-01',
    });
    const past = await create(admin, { startDate: '2024-04-01', endDate: '2025-03-31' });
    expect(past.status).toBe(201);
    expect((past.body as { data: FyBody }).data.code).toBe('2024-25');
  });

  it('no overlap: an existing year (by code or start date) -> 409 DUPLICATE', async () => {
    for (const body of [{ code: '2026-27' }, { startDate: '2025-04-01' }]) {
      const res = await create(admin, body);
      expect(res.status).toBe(409);
      expect(errorOf(res).code).toBe('DUPLICATE');
      expect(errorOf(res).fields?.code).toBeDefined();
    }
  });

  it('422 for dates or codes that are not an Indian FY, or that disagree', async () => {
    for (const [body, field] of [
      [{ startDate: '2027-05-01' }, 'startDate'],
      [{ startDate: '2027-04-02' }, 'startDate'],
      [{ startDate: '2027-02-30' }, 'startDate'],
      [{ startDate: '01-04-2027' }, 'startDate'],
      [{ code: '2027-29' }, 'code'],
      [{ code: '27-28' }, 'code'],
      [{ code: '2027-28', startDate: '2028-04-01' }, 'code'],
      [{ code: '2027-28', endDate: '2028-04-01' }, 'endDate'],
      [{ startDate: '2027-04-01', endDate: '2028-03-30' }, 'endDate'],
      [{ code: '1999-00' }, 'code'],
      [{ label: 'X' }, 'label'],
      [{ status: 'CLOSED' }, 'status'],
    ] as const) {
      const res = await create(admin, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(errorOf(res).fields?.[field], JSON.stringify(body)).toBeDefined();
    }
  });

  it('set-current moves the single current flag and audits; closed years cannot be current', async () => {
    const next = (await create(admin, {}).expect(201)).body as { data: FyBody };
    const res = await action(admin, next.data.id, 'set-current');
    expect(res.status).toBe(200);
    expect((res.body as { data: FyBody }).data).toMatchObject({ isCurrent: true, version: 2 });
    expect(await currentCodes()).toEqual(['2027-28']);
    const rows = await auditRows('FINANCIAL_YEAR_SET_CURRENT', { targetId: next.data.id });
    expect(rows[0]?.detail).toMatchObject({ code: '2027-28', previous: '2026-27' });
    // Already current: no-op.
    expect((await action(admin, next.data.id, 'set-current')).status).toBe(200);
    expect(await auditRows('FINANCIAL_YEAR_SET_CURRENT', { targetId: next.data.id })).toHaveLength(
      1,
    );

    const old = await fyByCode('2025-26');
    await action(admin, old.id, 'close').expect(200);
    const blocked = await action(admin, old.id, 'set-current');
    expect(blocked.status).toBe(409);
    expect(errorOf(blocked).code).toBe('CONFLICT');
    expect(await currentCodes()).toEqual(['2027-28']);
  });

  it('two parallel set-current calls leave exactly one current year', async () => {
    const a = await fyByCode('2025-26');
    const b = (await create(admin, {}).expect(201)).body as { data: FyBody };
    const results = await Promise.all([
      action(admin, a.id, 'set-current'),
      action(owner, b.data.id, 'set-current'),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await currentCodes()).toHaveLength(1);
  });

  it('close / reopen: the current year cannot be closed; audited; If-Match optional but checked', async () => {
    const current = await fyByCode('2026-27');
    const refused = await action(admin, current.id, 'close');
    expect(refused.status).toBe(409);
    expect(errorOf(refused).code).toBe('CONFLICT');

    const old = await fyByCode('2025-26');
    const count = async (action: string) => (await auditRows(action, { targetId: old.id })).length;
    const closedBefore = await count('FINANCIAL_YEAR_CLOSED');
    const reopenedBefore = await count('FINANCIAL_YEAR_REOPENED');
    const stale = await action(admin, old.id, 'close', old.version + 3);
    expect(stale.status).toBe(409);
    expect(errorOf(stale).code).toBe('VERSION_CONFLICT');
    const closed = await action(admin, old.id, 'close', old.version);
    expect(closed.status).toBe(200);
    expect((closed.body as { data: FyBody }).data).toMatchObject({ status: 'CLOSED' });
    expect(closed.headers.etag).toBe(`"${old.version + 1}"`);
    expect(await count('FINANCIAL_YEAR_CLOSED')).toBe(closedBefore + 1);
    // Closing again is a no-op.
    await action(admin, old.id, 'close').expect(200);
    expect(await count('FINANCIAL_YEAR_CLOSED')).toBe(closedBefore + 1);

    const reopened = await action(admin, old.id, 'reopen');
    expect((reopened.body as { data: FyBody }).data.status).toBe('OPEN');
    expect(await count('FINANCIAL_YEAR_REOPENED')).toBe(reopenedBefore + 1);

    expect((await action(manager, old.id, 'close')).status).toBe(403);
    expect((await action(admin, '00000000-0000-4000-8000-000000000000', 'close')).status).toBe(404);
    expect((await action(admin, 'nope', 'reopen')).status).toBe(422);
  });

  it('PATCH changes the label only, with If-Match; audited', async () => {
    const fy = await fyByCode('2025-26');
    const updatedBefore = (await auditRows('FINANCIAL_YEAR_UPDATED', { targetId: fy.id })).length;
    const url = `${API}/financial-years/${fy.id}`;
    expect(
      (await request(app).patch(url).set(admin.bearer).send({ label: 'Old Year' })).status,
    ).toBe(400);
    const res = await request(app)
      .patch(url)
      .set(admin.bearer)
      .set('If-Match', String(fy.version))
      .send({ label: 'Old Year' });
    expect(res.status).toBe(200);
    expect((res.body as { data: FyBody }).data).toMatchObject({ label: 'Old Year' });
    expect(await auditRows('FINANCIAL_YEAR_UPDATED', { targetId: fy.id })).toHaveLength(
      updatedBefore + 1,
    );
    const bad = await request(app)
      .patch(url)
      .set(admin.bearer)
      .set('If-Match', String(fy.version + 1))
      .send({ startDate: '2025-04-01' });
    expect(bad.status).toBe(422);
    const stale = await request(app)
      .patch(url)
      .set(admin.bearer)
      .set('If-Match', String(fy.version))
      .send({ label: 'Stale' });
    expect(errorOf(stale).code).toBe('VERSION_CONFLICT');
    await denyAdmin('admin-fy', 'controls');
    expect((await create(admin, {})).status).toBe(403);
  });
});

// ------------------------------------------------------------------------------------------------
describe('DB rules (raw SQL constraints)', () => {
  it('a second company row is refused', async () => {
    await expect(
      prisma.company.create({
        data: { code: 'OTHER', legalName: 'Other Ltd', tradeName: 'Other' },
      }),
    ).rejects.toThrow();
  });

  it('financial years must be 1 Apr - 31 Mar with a matching code; one current; closed is never current', async () => {
    const bad = [
      {
        code: '2030-31',
        label: 'x',
        startDate: new Date('2030-05-01'),
        endDate: new Date('2031-04-30'),
      },
      {
        code: '2030-31',
        label: 'x',
        startDate: new Date('2030-04-01'),
        endDate: new Date('2031-04-30'),
      },
      {
        code: '2030-32',
        label: 'x',
        startDate: new Date('2030-04-01'),
        endDate: new Date('2031-03-31'),
      },
      {
        code: '2030-31',
        label: 'x',
        startDate: new Date('2030-04-01'),
        endDate: new Date('2031-03-31'),
        isCurrent: true,
      },
      {
        code: '2030-31',
        label: 'x',
        startDate: new Date('2030-04-01'),
        endDate: new Date('2031-03-31'),
        status: 'CLOSED' as const,
        isCurrent: true,
      },
    ];
    for (const data of bad) {
      await expect(prisma.financialYear.create({ data }), JSON.stringify(data)).rejects.toThrow();
    }
  });

  it('units code format is enforced by the DB too', async () => {
    await expect(
      prisma.unit.create({ data: { code: 'bad-code', name: 'Bad Code' } }),
    ).rejects.toThrow();
  });
});

// ------------------------------------------------------------------------------------------------
describe('Administration module controls: allow_* cannot be switched off (orchestrator decision)', () => {
  const patch = async (s: Signed, pageId: string, body: Record<string, unknown>) =>
    request(app)
      .patch(`${API}/module-controls/${pageId}`)
      .set(s.bearer)
      .set('If-Match', String(await controlVersion(pageId)))
      .send(body);

  it.each(['allowAdd', 'allowEdit', 'allowDelete', 'allowExport'])(
    '%s=false on admin pages -> 409 PROTECTED, for the owner too',
    async (flag) => {
      for (const pageId of ['admin-users', 'admin-branches', 'admin-fy', 'admin-company']) {
        for (const s of [owner, admin]) {
          const res = await patch(s, pageId, { [flag]: false });
          expect(res.status).toBe(409);
          expect(errorOf(res).code).toBe('PROTECTED');
        }
      }
      const control = await prisma.moduleControl.findUniqueOrThrow({
        where: { pageId: 'admin-users' },
      });
      expect(control[flag as 'allowAdd']).toBe(true);
    },
  );

  it('true is fine (no-op), other admin settings still change, other families are not locked', async () => {
    expect((await patch(owner, 'admin-users', { allowAdd: true, allowExport: true })).status).toBe(
      200,
    );
    expect((await patch(owner, 'admin-users', { approvalRequired: true })).status).toBe(200);
    expect((await patch(owner, 'crm-leads', { allowDelete: false })).status).toBe(200);
  });
});

// ------------------------------------------------------------------------------------------------
describe('Phase 3 seed', () => {
  it('is idempotent: a re-run inserts nothing and keeps one company, 3 units, one current FY', async () => {
    const report = await seedPhase3Defaults(prisma);
    expect(report).toEqual({ company: 0, units: 0, financialYears: 0 });
    expect(await prisma.company.count()).toBe(1);
    for (const c of ['TAL', 'SAW', 'VAR']) expect((await unitByCode(c)).status).toBe('ACTIVE');
    expect(
      (await prisma.financialYear.findMany({ where: { isCurrent: true } })).map((f) => f.code),
    ).toEqual(['2026-27']);
    const state = await prisma.setting.findUniqueOrThrow({ where: { key: 'system.seed' } });
    expect((state.value as { applied: string[] }).applied).toEqual(
      expect.arrayContaining(['units', 'financialYears', 'departments', 'rolesV2']),
    );
  });

  it('never overwrites admin edits to seeded units', async () => {
    const tal = await unitByCode('TAL');
    await prisma.unit.update({ where: { id: tal.id }, data: { name: 'Talwade Plant' } });
    await seedPhase3Defaults(prisma);
    expect((await unitByCode('TAL')).name).toBe('Talwade Plant');
  });
});
