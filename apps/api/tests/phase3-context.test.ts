// Phase 3 §A2: the resolveContext middleware (role x headers x unit access x inactive unit x closed
// FY x missing headers -> preference / default / first unit; FY -> current), requireConcreteUnit,
// that the Phase 2/3 routers mount it while /me does not, and GET / PUT /me/context.
import type { Role } from '@prisma/client';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { authenticate } from '../src/core/auth/authenticate';
import { requireConcreteUnit, resolveContext } from '../src/core/context/resolve-context';
import { asyncHandler } from '../src/core/http/async-handler';
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
  unitIds,
} from './helpers';
import type { Signed } from './helpers';
import { ctxHeaders, fyByCode, makeUnit, restorePhase3, snapshotPhase3 } from './phase3-helpers';
import type { Phase3Snapshot } from './phase3-helpers';

interface Ctx {
  companyId: string;
  unitId: string | null;
  fyId: string;
  allUnits: boolean;
}

const app: Express = newApp({
  extraRoutes: (a) => {
    const echo = asyncHandler((req, res) => {
      res.json({ data: req.ctx });
      return Promise.resolve();
    });
    a.get('/test/ctx', authenticate, resolveContext, echo);
    a.post('/test/ctx', authenticate, resolveContext, requireConcreteUnit, echo);
  },
});

let snap: Phase3Snapshot;
let TAL: string;
let SAW: string;
let VAR: string;
let FY2526: string;
let FY2627: string;
let companyId: string;

beforeAll(async () => {
  snap = await snapshotPhase3();
  [TAL, SAW, VAR] = (await unitIds()) as [string, string, string];
  FY2526 = (await fyByCode('2025-26')).id;
  FY2627 = (await fyByCode('2026-27')).id;
  companyId = (await prisma.company.findFirstOrThrow()).id;
});

afterEach(async () => {
  await restorePhase3(snap);
});

afterAll(async () => {
  await restorePhase3(snap);
});

async function ctxOf(s: Signed, headers: Record<string, string> = {}) {
  const res = await request(app).get('/test/ctx').set(s.bearer).set(headers);
  return { res, ctx: (res.body as { data: Ctx }).data };
}

const ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'LEAD', 'MEMBER'];
const ADMINS: Role[] = ['SUPER_ADMIN', 'ADMIN'];
const NON_ADMINS: Role[] = ['MANAGER', 'LEAD', 'MEMBER'];

describe('resolveContext: missing headers', () => {
  it.each(ROLES)('%s: first accessible unit (TAL) and the current FY', async (role) => {
    const s = await signInAs(app, role);
    const { res, ctx } = await ctxOf(s);
    expect(res.status).toBe(200);
    expect(ctx).toEqual({ companyId, unitId: TAL, fyId: FY2627, allUnits: false });
  });

  it('MEMBER with only SAW and VAR: SAW (first accessible in Unit Master order)', async () => {
    const s = await signIn(app, await makeUser({ unitCodes: ['VAR', 'SAW'] }));
    expect((await ctxOf(s)).ctx.unitId).toBe(SAW);
  });

  it('the default unit beats the first unit; the preference beats the default', async () => {
    const s = await signIn(app, await makeUser({ defaultUnitCode: 'VAR' }));
    expect((await ctxOf(s)).ctx.unitId).toBe(VAR);
    const put = await request(app)
      .put(`${API}/me/context`)
      .set(s.bearer)
      .send({ unitId: SAW, fyId: FY2526 });
    expect(put.status).toBe(200);
    expect((await ctxOf(s)).ctx).toMatchObject({ unitId: SAW, fyId: FY2526 });
  });

  it('a preference for a unit the user lost, or that became inactive, falls back to the default', async () => {
    const extra = await makeUnit();
    const user = await makeUser({ unitCodes: ['TAL', 'SAW', extra.code], defaultUnitCode: 'SAW' });
    const s = await signIn(app, user);
    await request(app)
      .put(`${API}/me/context`)
      .set(s.bearer)
      .send({ unitId: extra.id, fyId: FY2627 })
      .expect(200);
    expect((await ctxOf(s)).ctx.unitId).toBe(extra.id);
    await prisma.unit.update({ where: { id: extra.id }, data: { status: 'INACTIVE' } });
    expect((await ctxOf(s)).ctx.unitId).toBe(SAW);
    await prisma.unit.update({ where: { id: extra.id }, data: { status: 'ACTIVE' } });
    await prisma.userUnit.delete({
      where: { userId_unitId: { userId: user.id, unitId: extra.id } },
    });
    expect((await ctxOf(s)).ctx.unitId).toBe(SAW);
  });

  it('an inactive default unit is skipped (first accessible unit instead)', async () => {
    const s = await signIn(app, await makeUser({ defaultUnitCode: 'VAR' }));
    await prisma.unit.update({ where: { id: VAR }, data: { status: 'INACTIVE' } });
    expect((await ctxOf(s)).ctx.unitId).toBe(TAL);
  });

  it('a non-admin without any active unit gets unitId null, allUnits false', async () => {
    const s = await signIn(app, await makeUser({ unitCodes: [] }));
    expect((await ctxOf(s)).ctx).toMatchObject({ unitId: null, allUnits: false });
    const write = await request(app).post('/test/ctx').set(s.bearer);
    expect(write.status).toBe(422);
    expect(errorOf(write).code).toBe('CONTEXT_INVALID');
  });

  it('an admin whose preference is "All units" gets null / allUnits true', async () => {
    const s = await signInAs(app, 'ADMIN');
    await request(app)
      .put(`${API}/me/context`)
      .set(s.bearer)
      .send({ unitId: null, fyId: FY2627 })
      .expect(200);
    expect((await ctxOf(s)).ctx).toMatchObject({ unitId: null, allUnits: true });
  });

  it('a stored "All units" preference does not apply after a demotion', async () => {
    const user = await makeUser({ role: 'ADMIN', unitCodes: ['VAR'] });
    const s = await signIn(app, user);
    await request(app)
      .put(`${API}/me/context`)
      .set(s.bearer)
      .send({ unitId: null, fyId: FY2627 })
      .expect(200);
    await prisma.user.update({ where: { id: user.id }, data: { role: 'MEMBER' } });
    expect((await ctxOf(s)).ctx).toMatchObject({ unitId: VAR, allUnits: false });
  });

  it('empty header values count as missing', async () => {
    const s = await signInAs(app, 'MEMBER');
    const { res, ctx } = await ctxOf(s, ctxHeaders('', ' '));
    expect(res.status).toBe(200);
    expect(ctx).toMatchObject({ unitId: TAL, fyId: FY2627 });
  });
});

describe('resolveContext: explicit headers', () => {
  it.each(ROLES)('%s: an accessible active unit and any FY are accepted', async (role) => {
    const s = await signInAs(app, role);
    const { res, ctx } = await ctxOf(s, ctxHeaders(VAR, FY2526));
    expect(res.status).toBe(200);
    expect(ctx).toEqual({ companyId, unitId: VAR, fyId: FY2526, allUnits: false });
  });

  it.each(NON_ADMINS)('%s: a unit without access -> 403 CONTEXT_FORBIDDEN', async (role) => {
    const s = await signInAs(app, role, { unitCodes: ['TAL'] });
    const { res } = await ctxOf(s, ctxHeaders(SAW));
    expect(res.status).toBe(403);
    expect(errorOf(res).code).toBe('CONTEXT_FORBIDDEN');
  });

  it.each(ADMINS)('%s: any active unit without unit rows', async (role) => {
    const extra = await makeUnit();
    const s = await signInAs(app, role);
    expect((await ctxOf(s, ctxHeaders(extra.id))).ctx.unitId).toBe(extra.id);
  });

  it.each(ROLES)('%s: an inactive unit -> 403 CONTEXT_FORBIDDEN', async (role) => {
    const inactive = await makeUnit('INACTIVE');
    const s = await signInAs(app, role, { unitCodes: ['TAL', inactive.code] });
    const { res } = await ctxOf(s, ctxHeaders(inactive.id));
    expect(res.status).toBe(403);
    expect(errorOf(res).code).toBe('CONTEXT_FORBIDDEN');
  });

  it.each(ADMINS)('%s: X-Unit-Id "all" (any case) -> All units', async (role) => {
    const s = await signInAs(app, role);
    for (const value of ['all', 'ALL', 'All']) {
      const { res, ctx } = await ctxOf(s, ctxHeaders(value));
      expect(res.status).toBe(200);
      expect(ctx).toMatchObject({ unitId: null, allUnits: true });
    }
  });

  it.each(NON_ADMINS)('%s: X-Unit-Id "all" -> 403 CONTEXT_FORBIDDEN', async (role) => {
    const s = await signInAs(app, role);
    const { res } = await ctxOf(s, ctxHeaders('all'));
    expect(res.status).toBe(403);
    expect(errorOf(res).code).toBe('CONTEXT_FORBIDDEN');
  });

  it.each(ROLES)('%s: unknown or malformed ids -> 422 CONTEXT_INVALID', async (role) => {
    const s = await signInAs(app, role);
    const unknown = '00000000-0000-4000-8000-000000000000';
    for (const headers of [
      ctxHeaders(unknown),
      ctxHeaders('TAL'),
      ctxHeaders(undefined, unknown),
      ctxHeaders(undefined, '2026-27'),
      ctxHeaders(TAL, 'not-a-uuid'),
    ]) {
      const { res } = await ctxOf(s, headers);
      expect(res.status).toBe(422);
      expect(errorOf(res).code).toBe('CONTEXT_INVALID');
    }
  });

  it('a closed FY is still valid context (reads); the preference FY is used when the header is missing', async () => {
    await prisma.financialYear.update({ where: { id: FY2526 }, data: { status: 'CLOSED' } });
    const s = await signInAs(app, 'MEMBER');
    expect((await ctxOf(s, ctxHeaders(undefined, FY2526))).ctx.fyId).toBe(FY2526);
    await request(app)
      .put(`${API}/me/context`)
      .set(s.bearer)
      .send({ unitId: TAL, fyId: FY2526 })
      .expect(200);
    expect((await ctxOf(s)).ctx.fyId).toBe(FY2526);
    expect((await ctxOf(s, ctxHeaders(undefined, FY2627))).ctx.fyId).toBe(FY2627);
  });

  it('requireConcreteUnit: "All units" cannot write (422), a concrete unit can', async () => {
    const s = await signInAs(app, 'ADMIN');
    const all = await request(app).post('/test/ctx').set(s.bearer).set(ctxHeaders('all'));
    expect(all.status).toBe(422);
    expect(errorOf(all).code).toBe('CONTEXT_INVALID');
    const one = await request(app).post('/test/ctx').set(s.bearer).set(ctxHeaders(SAW));
    expect(one.status).toBe(200);
  });

  it('removing a unit from a user applies on the next request', async () => {
    const user = await makeUser({ role: 'MEMBER' });
    const s = await signIn(app, user);
    expect((await ctxOf(s, ctxHeaders(SAW))).res.status).toBe(200);
    const owner = await signInOwner(app);
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await request(app)
      .patch(`${API}/users/${user.id}`)
      .set(owner.bearer)
      .set('If-Match', String(fresh.version))
      .send({ unitIds: [TAL] })
      .expect(200);
    expect((await ctxOf(s, ctxHeaders(SAW))).res.status).toBe(403);
  });
});

describe('where resolveContext is mounted', () => {
  it('Phase 2/3 admin routers validate the headers (403 / 422 for bad ones)', async () => {
    const admin = await signInAs(app, 'ADMIN');
    const inactive = await makeUnit('INACTIVE');
    for (const path of ['/units', '/financial-years', '/company', '/users', '/departments']) {
      const ok = await request(app).get(`${API}${path}`).set(admin.bearer).set(ctxHeaders(TAL));
      expect(ok.status).toBe(200);
      const forbidden = await request(app)
        .get(`${API}${path}`)
        .set(admin.bearer)
        .set(ctxHeaders(inactive.id));
      expect(forbidden.status).toBe(403);
      expect(errorOf(forbidden).code).toBe('CONTEXT_FORBIDDEN');
      const invalid = await request(app)
        .get(`${API}${path}`)
        .set(admin.bearer)
        .set(ctxHeaders(TAL, 'x'));
      expect(invalid.status).toBe(422);
      expect(errorOf(invalid).code).toBe('CONTEXT_INVALID');
    }
  });

  it('/me/* and /auth/me ignore the headers, so the web can always recover', async () => {
    const s = await signInAs(app, 'MEMBER', { unitCodes: ['TAL'] });
    const bad = ctxHeaders(SAW, 'garbage');
    for (const path of ['/me/context', '/me/menu', '/auth/me']) {
      expect((await request(app).get(`${API}${path}`).set(s.bearer).set(bad)).status).toBe(200);
    }
  });

  it('CORS allows the context headers', async () => {
    const res = await request(app)
      .options(`${API}/units`)
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'x-unit-id,x-fy-id');
    const allowed = String(res.headers['access-control-allow-headers']).toLowerCase();
    expect(allowed).toContain('x-unit-id');
    expect(allowed).toContain('x-fy-id');
  });
});

interface MeContext {
  company: { id: string; code: string; tradeName: string };
  units: { id: string; code: string; name: string }[];
  allUnitsAllowed: boolean;
  fys: { id: string; code: string; label: string; status: string; isCurrent: boolean }[];
  current: { unitId: string | null; fyId: string };
}

const meContext = async (s: Signed) =>
  (await request(app).get(`${API}/me/context`).set(s.bearer)).body as { data: MeContext };

describe('GET /me/context', () => {
  it('MEMBER: own active units only, no "All units", every FY, the resolved current', async () => {
    const inactive = await makeUnit('INACTIVE');
    const s = await signInAs(app, 'MEMBER', { unitCodes: ['SAW', 'VAR', inactive.code] });
    const res = await request(app).get(`${API}/me/context`).set(s.bearer);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const data = (res.body as { data: MeContext }).data;
    expect(data.company).toEqual({ id: companyId, code: 'SAWANT', tradeName: 'Sawant Group' });
    expect(data.units.map((u) => u.code)).toEqual(['SAW', 'VAR']);
    expect(data.units[0]).toEqual({ id: SAW, code: 'SAW', name: 'Sawardari' });
    expect(data.allUnitsAllowed).toBe(false);
    expect(data.fys.map((f) => [f.code, f.label, f.status, f.isCurrent])).toEqual([
      ['2026-27', 'FY 2026-27', 'OPEN', true],
      ['2025-26', 'FY 2025-26', 'OPEN', false],
    ]);
    expect(data.current).toEqual({ unitId: SAW, fyId: FY2627 });
  });

  it('ADMIN: every active unit and "All units"', async () => {
    const s = await signInAs(app, 'ADMIN');
    const data = (await meContext(s)).data;
    expect(data.allUnitsAllowed).toBe(true);
    expect(data.units.slice(0, 3).map((u) => u.code)).toEqual(['TAL', 'SAW', 'VAR']);
    expect(data.current.unitId).toBe(TAL);
  });

  it('401 without a token; 403 while a password change is pending', async () => {
    expect((await request(app).get(`${API}/me/context`)).status).toBe(401);
    const s = await signIn(app, await makeUser({ mustChangePassword: true }));
    const res = await request(app).get(`${API}/me/context`).set(s.bearer);
    expect(res.status).toBe(403);
    expect(errorOf(res).code).toBe('PASSWORD_CHANGE_REQUIRED');
  });
});

describe('PUT /me/context', () => {
  it('saves the preference, audits CONTEXT_CHANGED once, returns the new context', async () => {
    const s = await signInAs(app, 'MEMBER');
    const res = await request(app)
      .put(`${API}/me/context`)
      .set(s.bearer)
      .send({ unitId: VAR, fyId: FY2526 });
    expect(res.status).toBe(200);
    expect((res.body as { data: MeContext }).data.current).toEqual({ unitId: VAR, fyId: FY2526 });
    expect(await prisma.userPreference.findUnique({ where: { userId: s.user.id } })).toMatchObject({
      unitId: VAR,
      fyId: FY2526,
      allUnits: false,
    });
    const rows = await auditRows('CONTEXT_CHANGED', { targetId: s.user.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toMatchObject({ before: null, after: { unitId: VAR, fyId: FY2526 } });
    // Same choice again: no new audit row.
    await request(app)
      .put(`${API}/me/context`)
      .set(s.bearer)
      .send({ unitId: VAR, fyId: FY2526 })
      .expect(200);
    expect(await auditRows('CONTEXT_CHANGED', { targetId: s.user.id })).toHaveLength(1);
    expect((await meContext(s)).data.current).toEqual({ unitId: VAR, fyId: FY2526 });
  });

  it('ADMIN may choose "All units" (null); non-admins get 403 CONTEXT_FORBIDDEN', async () => {
    const admin = await signInAs(app, 'ADMIN');
    const ok = await request(app)
      .put(`${API}/me/context`)
      .set(admin.bearer)
      .send({ unitId: null, fyId: FY2627 });
    expect(ok.status).toBe(200);
    expect((ok.body as { data: MeContext }).data.current.unitId).toBeNull();
    for (const role of NON_ADMINS) {
      const s = await signInAs(app, role);
      const res = await request(app)
        .put(`${API}/me/context`)
        .set(s.bearer)
        .send({ unitId: null, fyId: FY2627 });
      expect(res.status).toBe(403);
      expect(errorOf(res).code).toBe('CONTEXT_FORBIDDEN');
    }
  });

  it('403 for an inaccessible or inactive unit; 422 for unknown ids or a bad body', async () => {
    const inactive = await makeUnit('INACTIVE');
    const s = await signInAs(app, 'LEAD', { unitCodes: ['TAL', inactive.code] });
    const put = (body: Record<string, unknown>) =>
      request(app).put(`${API}/me/context`).set(s.bearer).send(body);
    for (const unitId of [SAW, inactive.id]) {
      const res = await put({ unitId, fyId: FY2627 });
      expect(res.status).toBe(403);
      expect(errorOf(res).code).toBe('CONTEXT_FORBIDDEN');
    }
    const unknown = '00000000-0000-4000-8000-000000000000';
    for (const body of [
      { unitId: unknown, fyId: FY2627 },
      { unitId: 'TAL', fyId: FY2627 },
      { unitId: TAL, fyId: unknown },
    ]) {
      const res = await put(body);
      expect(res.status).toBe(422);
      expect(errorOf(res).code).toBe('CONTEXT_INVALID');
    }
    for (const body of [{ unitId: TAL }, { fyId: FY2627 }, { unitId: TAL, fyId: FY2627, x: 1 }]) {
      const res = await put(body);
      expect(res.status).toBe(422);
      expect(errorOf(res).code).toBe('VALIDATION_ERROR');
    }
    expect(await prisma.userPreference.findUnique({ where: { userId: s.user.id } })).toBeNull();
  });
});
