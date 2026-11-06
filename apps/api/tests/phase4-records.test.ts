// The generic records API (docs/phase3-4 B2/B3): create / get / list / patch / delete / restore /
// status / bulk / export, field validation by type, unit + FY from the context, data scope
// OWN / DEPARTMENT / ALL, permissions and module controls, Idempotency-Key, soft delete + undo,
// If-Match, closed financial years, the audit trail and the audit-log pageId filter.
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
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
import { makeDepartment, restoreGlobal, snapshotGlobal } from './phase2-helpers';
import type { GlobalSnapshot } from './phase2-helpers';
import { fyByCode, makeUnit, restorePhase3, snapshotPhase3 } from './phase3-helpers';
import type { Phase3Snapshot } from './phase3-helpers';
import { GSTIN_SAMPLE, api, dataOf, genericPageIds, sampleData, schemaOf } from './phase4-helpers';
import type { RecordBody } from './phase4-helpers';

const app = newApp();
const client = api(app);
const LEADS = 'crm-leads';
const SOURCES = 'crm-sources';

let owner: Signed;
let admin: Signed;
let sales1: Signed;
let sales2: Signed;
let salesManager: Signed;
let TAL: string;
let SAW: string;
let snapGlobal: GlobalSnapshot;
let snap3: Phase3Snapshot;
let n = 0;

const lead = (extra: Record<string, unknown> = {}) => ({
  ...sampleData(schemaOf(LEADS), ++n),
  leadName: `Lead ${n} ${Math.random().toString(36).slice(2, 8)}`,
  ...extra,
});

beforeAll(async () => {
  owner = await signInOwner(app);
  admin = await signInAs(app, 'ADMIN');
  sales1 = await signInAs(app, 'MEMBER', { department: 'Sales' });
  sales2 = await signInAs(app, 'MEMBER', { department: 'Sales' });
  salesManager = await signInAs(app, 'MANAGER', { department: 'Sales' });
  [TAL, SAW] = await unitIds(['TAL', 'SAW']).then((ids) => ids as [string, string]);
  snapGlobal = await snapshotGlobal();
  snap3 = await snapshotPhase3();
});

afterEach(async () => {
  await restoreGlobal(snapGlobal);
  await restorePhase3(snap3);
});

afterAll(async () => {
  await prisma.genericRecord.deleteMany({});
  await prisma.idempotencyKey.deleteMany({});
  await prisma.numberSeries.deleteMany({ where: { NOT: { pageId: { startsWith: 'inv-' } } } });
});

async function create(s: Signed, extra: Record<string, unknown> = {}, h = {}) {
  const res = await client.create(s, LEADS, lead(extra), h);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return dataOf<RecordBody>(res);
}

describe('POST create', () => {
  it('creates with a gap-free code, status Draft, unit / FY from the context, audited', async () => {
    const res = await client.create(owner, LEADS, lead({ mobile: '98765 43210', email: 'A@B.CO' }));
    expect(res.status).toBe(201);
    const rec = dataOf<RecordBody>(res);
    expect(rec.code).toMatch(/^LEA\/TAL\/26-27\/\d{5}$/);
    expect(rec).toMatchObject({ status: 'Draft', unitId: TAL, department: 'Administration' });
    expect(rec.fyId).toBe((await fyByCode('2026-27')).id);
    expect(rec.version).toBe(1);
    expect(res.headers.etag).toBe('"1"');
    expect(rec.data).toMatchObject({
      mobile: '9876543210',
      email: 'a@b.co',
      expectedValue: 1235.5 + (n - 1),
    });
    expect(rec.createdBy).toEqual({ id: owner.user.id, name: owner.user.name });
    const rows = await auditRows('RECORD_CREATED', { targetId: rec.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toMatchObject({ pageId: LEADS, code: rec.code });
    expect(rows[0]?.targetType).toBe('Record');
    const master = await client.create(owner, SOURCES, sampleData(schemaOf(SOURCES)));
    expect(dataOf<RecordBody>(master)).toMatchObject({ status: 'Active' });
    expect(dataOf<RecordBody>(master).code).toMatch(/^LEA\/TAL\/26-27\/\d{5}$/);
  });

  it('uses the user department and the X-Unit-Id / X-FY-Id headers', async () => {
    const fy = await fyByCode('2025-26');
    const rec = await create(sales1, {}, { unit: SAW, fy: fy.id });
    expect(rec).toMatchObject({ department: 'Sales', unitId: SAW, fyId: fy.id });
    expect(rec.code).toMatch(/^LEA\/SAW\/25-26\/\d{5}$/);
  });

  it('ignores read-only keys, rejects unknown keys and bad bodies', async () => {
    const rec = await create(owner, { leadNo: 'HACK/1', status: 'Active' });
    expect(rec.code).not.toBe('HACK/1');
    expect(rec.status).toBe('Draft');
    expect(rec.data).not.toHaveProperty('status');
    expect(rec.data).not.toHaveProperty('leadNo');
    const unknown = await client.create(owner, LEADS, lead({ nope: 1 }));
    expect(unknown.status).toBe(422);
    expect(errorOf(unknown).fields?.nope).toBe('Unknown field.');
    for (const body of [{}, { data: 'x' }, { data: {}, extra: 1 }]) {
      const res = await request(app)
        .post(`${API}/pages/${LEADS}/records`)
        .set(owner.bearer)
        .send(body);
      expect(res.status).toBe(422);
    }
  });

  it('required fields: missing or blank -> 422 with the field key', async () => {
    const missing = await client.create(owner, LEADS, { company: 'Only a company' });
    expect(missing.status).toBe(422);
    expect(errorOf(missing).fields).toEqual({ leadName: 'This field is required.' });
    // A lead can be added without a follow-up date (a planning date is optional).
    const noFollowUp = await client.create(owner, LEADS, { leadName: 'No follow-up yet' });
    expect(noFollowUp.status, JSON.stringify(noFollowUp.body)).toBe(201);
    const blank = await client.create(owner, LEADS, lead({ leadName: '   ' }));
    expect(errorOf(blank).fields?.leadName).toBe('This field is required.');
  });

  it('validates every field type', async () => {
    const bad: [string, unknown][] = [
      ['mobile', '1234567890'],
      ['mobile', '98765'],
      ['email', 'not-an-email'],
      ['nextFollowUp', '2026-02-30'],
      ['nextFollowUp', '15/06/2026'],
      ['qualificationScore', 101],
      ['qualificationScore', -1],
      ['qualificationScore', 'abc'],
      ['expectedValue', -5],
      ['expectedValue', 'lots'],
      ['stage', 'Not A Stage'],
      ['source', 'Not A Source'],
      ['campaign', 'x'.repeat(201)],
    ];
    for (const [key, value] of bad) {
      const res = await client.create(owner, LEADS, lead({ [key]: value }));
      expect(res.status, `${key}=${String(value)}`).toBe(422);
      expect(errorOf(res).fields?.[key], key).toBeDefined();
    }
    const ok = await create(owner, {
      qualificationScore: '72.456',
      expectedValue: '1000.555',
      campaign: '<b>Diwali</b> <script>x</script>',
      stage: 'Contacted',
    });
    expect(ok.data).toMatchObject({ qualificationScore: 72.46, expectedValue: 1000.56 });
    expect(ok.data.campaign).toBe('Diwali x');
    expect(ok.data.stage).toBe('Contacted');
  });

  it('identifier types: GSTIN checksum, PAN, HSN, UAN are checked and normalised', async () => {
    const wrongCheck = `${GSTIN_SAMPLE.slice(0, 14)}${GSTIN_SAMPLE.endsWith('A') ? 'B' : 'A'}`;
    const cases: [string, unknown[], [unknown, unknown]][] = [
      ['gstin', [wrongCheck, 'SHORT'], [GSTIN_SAMPLE.toLowerCase(), GSTIN_SAMPLE]],
      ['pan', ['ABCDE12345', 'abc'], ['abcde1234f', 'ABCDE1234F']],
      ['hsn', ['12345', 'ABCD'], ['8471 30', '847130']],
      ['uan', ['12345', 'ABCDEFGHIJKL'], ['1234 5678 9012', '123456789012']],
    ];
    for (const [type, invalid, [input, stored]] of cases) {
      const pageId = genericPageIds().find((id) =>
        schemaOf(id).fields.some((f) => f.type === type),
      );
      expect(pageId, type).toBeDefined();
      const schema = schemaOf(pageId ?? '');
      const key = schema.fields.find((f) => f.type === type)?.key ?? '';
      const base = sampleData(schema);
      for (const value of invalid) {
        const res = await client.create(owner, pageId ?? '', { ...base, [key]: value });
        expect(res.status, `${type}=${String(value)}`).toBe(422);
        expect(errorOf(res).fields?.[key], type).toBeDefined();
      }
      const good = await client.create(owner, pageId ?? '', { ...base, [key]: input });
      expect(good.status, JSON.stringify(good.body)).toBe(201);
      expect(dataOf<RecordBody>(good).data[key], type).toBe(stored);
    }
  });

  it('Aadhaar is stored masked with a hash and the full number is never returned', async () => {
    const pageId = 'hr-employees';
    const schema = schemaOf(pageId);
    const key = schema.fields.find((f) => f.type === 'aadhaar')?.key ?? '';
    const bad = await client.create(owner, pageId, { ...sampleData(schema), [key]: '123' });
    expect(errorOf(bad).fields?.[key]).toBeDefined();
    const res = await client.create(owner, pageId, {
      ...sampleData(schema),
      [key]: '2345 6789 1234',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const rec = dataOf<RecordBody>(res);
    expect(rec.data[key]).toBe('XXXXXXXX1234');
    expect(JSON.stringify(res.body)).not.toContain('234567891234');
    expect(JSON.stringify(res.body)).not.toContain('_h_');
    const stored = await prisma.genericRecord.findUniqueOrThrow({ where: { id: rec.id } });
    const data = stored.data as Record<string, unknown>;
    expect(data[key]).toBe('XXXXXXXX1234');
    expect(String(data[`_h_${key}`])).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(data)).not.toContain('234567891234');
    // The masked value sent back unchanged is accepted; a different masked value is not.
    const same = await client.patch(owner, pageId, rec.id, rec.version, { [key]: 'XXXXXXXX1234' });
    expect(same.status).toBe(200);
    const other = await client.patch(owner, pageId, rec.id, rec.version, { [key]: 'XXXXXXXX9999' });
    expect(other.status).toBe(422);
    const changed = await client.patch(owner, pageId, rec.id, rec.version, {
      [key]: '987654321098',
    });
    expect(dataOf<RecordBody>(changed).data[key]).toBe('XXXXXXXX1098');
  });
});

describe('unit and FY context', () => {
  it('writes need a concrete unit: "All units" -> 422 CONTEXT_INVALID', async () => {
    const res = await client.create(admin, LEADS, lead(), { unit: 'all' });
    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe('CONTEXT_INVALID');
    const rec = await create(admin);
    for (const res2 of [
      await client.patch(admin, LEADS, rec.id, rec.version, { campaign: 'x' }, { unit: 'all' }),
      await client.remove(admin, LEADS, rec.id, { unit: 'all' }),
      await client.restore(admin, LEADS, rec.id, {}, { unit: 'all' }),
      await client.status(admin, LEADS, rec.id, 'Active', { unit: 'all' }),
      await client.bulk(admin, LEADS, { action: 'delete', ids: [rec.id] }, { unit: 'all' }),
    ]) {
      expect(res2.status).toBe(422);
      expect(errorOf(res2).code).toBe('CONTEXT_INVALID');
    }
  });

  it('a unit the user cannot use -> 403 CONTEXT_FORBIDDEN', async () => {
    const tal = await signInAs(app, 'MEMBER', { department: 'Sales', unitCodes: ['TAL'] });
    const res = await client.create(tal, LEADS, lead(), { unit: SAW });
    expect(res.status).toBe(403);
    expect(errorOf(res).code).toBe('CONTEXT_FORBIDDEN');
    expect((await client.list(tal, LEADS, {}, { unit: SAW })).status).toBe(403);
  });

  it('lists are per unit and per FY; ADMIN+ can read All units; get by id respects the unit', async () => {
    const marker = `Ctx ${Math.random().toString(36).slice(2, 8)}`;
    const inTal = await create(owner, { campaign: marker });
    const inSaw = await create(owner, { campaign: marker }, { unit: SAW });
    const fy = await fyByCode('2025-26');
    const inOld = await create(owner, { campaign: marker }, { fy: fy.id });
    const ids = async (s: Signed, h = {}) =>
      (
        (await client.list(s, LEADS, { q: marker, size: 100 }, h)).body as { data: RecordBody[] }
      ).data.map((r) => r.id);
    expect(await ids(owner)).toEqual([inTal.id]);
    expect(await ids(owner, { unit: SAW })).toEqual([inSaw.id]);
    expect(await ids(owner, { fy: fy.id })).toEqual([inOld.id]);
    expect((await ids(admin, { unit: 'all' })).sort()).toEqual([inTal.id, inSaw.id].sort());
    // A member cannot ask for All units.
    expect((await client.list(sales1, LEADS, {}, { unit: 'all' })).status).toBe(403);
    // By id: the record's unit must be the context unit (or All units for ADMIN+).
    expect((await client.get(owner, LEADS, inSaw.id)).status).toBe(404);
    expect((await client.get(owner, LEADS, inSaw.id, { unit: SAW })).status).toBe(200);
    expect((await client.get(admin, LEADS, inSaw.id, { unit: 'all' })).status).toBe(200);
  });

  it('a non-admin with no unit sees nothing', async () => {
    await create(owner);
    const none = await signIn(app, await makeUser({ department: 'Sales', unitCodes: [] }));
    const res = await client.list(none, LEADS);
    expect(res.status).toBe(200);
    expect((res.body as { meta: { total: number } }).meta.total).toBe(0);
  });
});

describe('Unit Master with records', () => {
  it('a unit that has records cannot be deleted (409 IN_USE) but can be deactivated', async () => {
    const unit = await makeUnit();
    try {
      await create(owner, {}, { unit: unit.id });
      const del = await request(app).delete(`${API}/units/${unit.id}`).set(admin.bearer);
      expect(del.status).toBe(409);
      expect(errorOf(del).code).toBe('IN_USE');
      const off = await request(app)
        .patch(`${API}/units/${unit.id}`)
        .set(admin.bearer)
        .set('If-Match', String(unit.version))
        .send({ status: 'INACTIVE' });
      expect(off.status).toBe(200);
      // An inactive unit is no longer a valid context for new records.
      const res = await client.create(owner, LEADS, lead(), { unit: unit.id });
      expect(res.status).toBe(403);
    } finally {
      await prisma.genericRecord.deleteMany({ where: { unitId: unit.id } });
      await prisma.numberSeries.deleteMany({ where: { unitId: unit.id } });
    }
  });
});

describe('closed financial years (409 PERIOD_CLOSED)', () => {
  it('blocks create, edit, delete, restore, status and bulk in a closed year; reads still work', async () => {
    const fy = await fyByCode('2025-26');
    const old = await create(owner, {}, { fy: fy.id });
    const deleted = await create(owner, {}, { fy: fy.id });
    await client.remove(owner, LEADS, deleted.id).expect(200);
    await prisma.financialYear.update({ where: { id: fy.id }, data: { status: 'CLOSED' } });
    const h = { fy: fy.id };
    const closed = [
      await client.create(owner, LEADS, lead(), h),
      await client.patch(owner, LEADS, old.id, old.version, { campaign: 'late' }, h),
      await client.remove(owner, LEADS, old.id, h),
      await client.restore(owner, LEADS, deleted.id, {}, h),
      await client.status(owner, LEADS, old.id, 'Active', h),
    ];
    for (const res of closed) {
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(errorOf(res).code).toBe('PERIOD_CLOSED');
    }
    const bulk = await client.bulk(owner, LEADS, { action: 'delete', ids: [old.id] }, h);
    expect(bulk.status).toBe(200);
    expect(dataOf<{ ok: boolean; error?: { code: string } }[]>(bulk)[0]).toMatchObject({
      ok: false,
      error: { code: 'PERIOD_CLOSED' },
    });
    expect((await client.get(owner, LEADS, old.id)).status).toBe(200);
    expect(
      ((await client.list(owner, LEADS, {}, h)).body as { meta: { total: number } }).meta.total,
    ).toBeGreaterThan(0);
    // Reopening unblocks writes.
    await prisma.financialYear.update({ where: { id: fy.id }, data: { status: 'OPEN' } });
    expect(
      (await client.patch(owner, LEADS, old.id, old.version, { campaign: 'ok' }, h)).status,
    ).toBe(200);
  });

  it('an edit of a record created in an open year still works when another year is closed', async () => {
    const rec = await create(owner);
    const fy = await fyByCode('2025-26');
    await prisma.financialYear.update({ where: { id: fy.id }, data: { status: 'CLOSED' } });
    expect(
      (await client.patch(owner, LEADS, rec.id, rec.version, { campaign: 'fine' })).status,
    ).toBe(200);
  });
});

describe('data scope OWN / DEPARTMENT / ALL', () => {
  it('OWN sees only own rows, DEPARTMENT sees the owner department or own department, ALL sees all', async () => {
    const mark = `Scope ${Math.random().toString(36).slice(2, 8)}`;
    const byOwner = await create(owner, { campaign: mark });
    const byS1 = await create(sales1, { campaign: mark });
    const byS2 = await create(sales2, { campaign: mark });

    const crm = await makeDepartment(['CRM']);
    const dm1 = await signInAs(app, 'MANAGER', { department: crm.name });
    const dm2 = await signInAs(app, 'MANAGER', { department: crm.name });
    const byDm1 = await create(dm1, { campaign: mark });

    const seen = async (s: Signed) =>
      ((await client.list(s, LEADS, { q: mark, size: 100 })).body as { data: RecordBody[] }).data
        .map((r) => r.id)
        .sort();
    // OWN
    expect(await seen(sales1)).toEqual([byS1.id]);
    expect(await seen(sales2)).toEqual([byS2.id]);
    // DEPARTMENT, the page's owner department (Sales) is the caller's: the whole page.
    expect(await seen(salesManager)).toEqual([byOwner.id, byS1.id, byS2.id, byDm1.id].sort());
    // DEPARTMENT, another department: only rows of that department.
    expect(await seen(dm1)).toEqual([byDm1.id]);
    expect(await seen(dm2)).toEqual([byDm1.id]);
    // ALL
    expect(await seen(admin)).toEqual([byOwner.id, byS1.id, byS2.id, byDm1.id].sort());
    expect(await seen(owner)).toEqual([byOwner.id, byS1.id, byS2.id, byDm1.id].sort());
    // By id and for writes the same rule applies (404, not 403).
    expect((await client.get(sales1, LEADS, byS2.id)).status).toBe(404);
    expect((await client.get(sales1, LEADS, byS1.id)).status).toBe(200);
    expect((await client.get(dm2, LEADS, byS1.id)).status).toBe(404);
    expect((await client.patch(sales1, LEADS, byS2.id, 1, { campaign: 'x' })).status).toBe(404);
    expect((await client.patch(sales1, LEADS, byS1.id, 1, { campaign: 'mine' })).status).toBe(200);
    expect((await client.patch(dm2, LEADS, byDm1.id, 1, { campaign: 'team' })).status).toBe(200);
    expect((await client.remove(dm2, LEADS, byS1.id)).status).toBe(404);
    expect((await client.status(sales2, LEADS, byS1.id, 'Active')).status).toBe(404);
    expect(
      dataOf<{ ok: boolean }[]>(
        await client.bulk(dm2, LEADS, { action: 'delete', ids: [byS1.id, byDm1.id] }),
      ).map((r) => r.ok),
    ).toEqual([false, true]);
  });
});

describe('permissions and module controls', () => {
  it('each action needs its permission: MEMBER cannot delete / export; LEAD cannot delete', async () => {
    const rec = await create(sales1);
    expect((await client.remove(sales1, LEADS, rec.id)).status).toBe(403);
    expect((await client.restore(sales1, LEADS, rec.id)).status).toBe(403);
    expect((await client.bulk(sales1, LEADS, { action: 'delete', ids: [rec.id] })).status).toBe(
      403,
    );
    expect((await client.export(sales1, LEADS)).status).toBe(403);
    expect((await client.status(sales1, LEADS, rec.id, 'Active')).status).toBe(200);
    const lead1 = await signInAs(app, 'LEAD', { department: 'Sales' });
    expect((await client.remove(lead1, LEADS, rec.id)).status).toBe(403);
    expect((await client.export(lead1, LEADS)).status).toBe(200);
    expect((await request(app).get(`${API}/pages/${LEADS}/records`)).status).toBe(401);
  });

  it('a department without the family cannot use the page', async () => {
    const finance = await signInAs(app, 'MEMBER', { department: 'Finance' });
    expect((await client.list(finance, LEADS)).status).toBe(403);
    expect((await client.create(finance, LEADS, lead())).status).toBe(403);
  });

  it('module control switches bind everyone, the owner too (allow_add / allow_edit / allow_delete / allow_export / enabled)', async () => {
    const rec = await create(owner);
    const set = async (data: Record<string, boolean>) => {
      await prisma.moduleControl.update({ where: { pageId: LEADS }, data });
      invalidateAccessCache();
    };
    await set({ allowAdd: false });
    expect((await client.create(owner, LEADS, lead())).status).toBe(403);
    await set({ allowAdd: true, allowEdit: false });
    expect((await client.patch(owner, LEADS, rec.id, rec.version, { campaign: 'x' })).status).toBe(
      403,
    );
    expect((await client.status(owner, LEADS, rec.id, 'Active')).status).toBe(403);
    await set({ allowEdit: true, allowDelete: false });
    expect((await client.remove(owner, LEADS, rec.id)).status).toBe(403);
    await set({ allowDelete: true, allowExport: false });
    expect((await client.export(owner, LEADS)).status).toBe(403);
    await set({ allowExport: true, enabled: false });
    expect((await client.list(owner, LEADS)).status).toBe(403);
    expect((await client.schema(owner, LEADS)).status).toBe(403);
  });

  it('custom and Administration pages -> 404 NOT_GENERIC; unknown page -> 404 NOT_FOUND', async () => {
    // (The seven typed Inventory pages are served by their own handlers: phase5-*.test.ts.)
    for (const pageId of [
      'dashboard',
      'crm-pipeline',
      'ai-sales',
      'admin-users',
      'admin-fy',
      'admin-company',
      'admin-roles',
    ]) {
      for (const res of [
        await client.list(owner, pageId),
        await client.create(owner, pageId, { a: 1 }),
        await client.get(owner, pageId, '00000000-0000-4000-8000-000000000000'),
        await client.bulk(owner, pageId, {
          action: 'delete',
          ids: ['00000000-0000-4000-8000-000000000000'],
        }),
      ]) {
        expect(res.status, pageId).toBe(404);
        expect(errorOf(res).code, pageId).toBe('NOT_GENERIC');
      }
      const exported = await client.export(owner, pageId);
      expect(exported.status, pageId).toBe(404);
      expect((exported.body as Buffer).toString('utf8')).toContain('NOT_GENERIC');
    }
    const unknown = await client.list(owner, 'no-such-page');
    expect(unknown.status).toBe(404);
    expect(errorOf(unknown).code).toBe('NOT_FOUND');
    expect(
      await prisma.genericRecord.count({ where: { pageId: { in: ['dashboard', 'admin-users'] } } }),
    ).toBe(0);
  });
});

describe('GET list', () => {
  it('search (prefix full-text + code ILIKE), status filter, sort, paging', async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    const a = await create(owner, {
      campaign: `Alphacampaign ${tag}`,
      expectedValue: 300,
      leadName: `Zed ${tag}`,
    });
    const b = await create(owner, {
      campaign: `Betacampaign ${tag}`,
      expectedValue: 100,
      leadName: `Amy ${tag}`,
    });
    const c = await create(owner, {
      campaign: `Gammacampaign ${tag}`,
      expectedValue: 200,
      leadName: `Mia ${tag}`,
    });
    await client.status(owner, LEADS, c.id, 'Active').expect(200);
    const list = async (query: Record<string, unknown>) =>
      (await client.list(owner, LEADS, { size: 100, ...query })).body as {
        data: RecordBody[];
        meta: { page: number; size: number; total: number };
      };
    expect((await list({ q: `alpha` })).data.map((r) => r.id)).toContain(a.id);
    expect((await list({ q: `${tag} alphac` })).data.map((r) => r.id)).toEqual([a.id]);
    expect((await list({ q: a.code.toLowerCase() })).data.map((r) => r.id)).toEqual([a.id]);
    expect((await list({ q: a.code.slice(-5) })).data.map((r) => r.id)).toContain(a.id);
    expect((await list({ q: 'no-such-thing-' + tag })).meta.total).toBe(0);
    expect((await list({ q: '%' })).meta.total).toBe(0);
    expect((await list({ q: tag, status: 'Active' })).data.map((r) => r.id)).toEqual([c.id]);
    expect((await list({ q: tag, sort: 'expectedValue' })).data.map((r) => r.id)).toEqual([
      b.id,
      c.id,
      a.id,
    ]);
    expect((await list({ q: tag, sort: '-expectedValue' })).data.map((r) => r.id)).toEqual([
      a.id,
      c.id,
      b.id,
    ]);
    expect((await list({ q: tag, sort: 'leadName' })).data.map((r) => r.id)).toEqual([
      b.id,
      c.id,
      a.id,
    ]);
    expect((await list({ q: tag, sort: 'code' })).data.map((r) => r.id)).toEqual([
      a.id,
      b.id,
      c.id,
    ]);
    expect((await list({ q: tag, sort: '-code' })).data.map((r) => r.id)).toEqual([
      c.id,
      b.id,
      a.id,
    ]);
    expect((await list({ q: tag })).data.map((r) => r.id)).toEqual([c.id, b.id, a.id]);
    const paged = await list({ q: tag, sort: 'code', size: 2, page: 2 });
    expect(paged.meta).toEqual({ page: 2, size: 2, total: 3 });
    expect(paged.data.map((r) => r.id)).toEqual([c.id]);
    const row = (await list({ q: a.code })).data[0];
    expect(row).toMatchObject({
      id: a.id,
      code: a.code,
      status: 'Draft',
      unitId: TAL,
      department: 'Administration',
      version: 1,
      createdBy: { id: owner.user.id },
    });
    expect(Object.keys(row ?? {})).toEqual(
      expect.arrayContaining([
        'id',
        'code',
        'status',
        'unitId',
        'fyId',
        'department',
        'data',
        'version',
        'createdAt',
        'createdBy',
        'updatedAt',
      ]),
    );
  });

  it('rejects bad paging, unknown sort and unknown query keys with 422', async () => {
    for (const query of [
      { size: 101 },
      { size: 0 },
      { page: 0 },
      { page: 5000, size: 100 },
      { sort: 'nope' },
      { sort: '-nope' },
      { bogus: 1 },
      { deleted: 'maybe' },
    ]) {
      const res = await client.list(owner, LEADS, query);
      expect(res.status, JSON.stringify(query)).toBe(422);
    }
  });

  it('deleted=true lists soft-deleted rows for ADMIN+ only', async () => {
    const rec = await create(owner, { campaign: 'to-delete' });
    await client.remove(owner, LEADS, rec.id).expect(200);
    const normal = await client.list(owner, LEADS, { q: rec.code });
    expect((normal.body as { data: unknown[] }).data).toHaveLength(0);
    const deleted = await client.list(admin, LEADS, { deleted: 'true', q: rec.code });
    expect((deleted.body as { data: { id: string; deletedAt: string }[] }).data).toMatchObject([
      { id: rec.id, deletedAt: expect.any(String) as string },
    ]);
    expect((await client.list(salesManager, LEADS, { deleted: 'true' })).status).toBe(403);
  });
});

describe('PATCH', () => {
  it('needs If-Match; stale -> 409 VERSION_CONFLICT; partial update bumps the version and audits before / after', async () => {
    const rec = await create(owner, { campaign: 'before' });
    const noHeader = await request(app)
      .patch(`${API}/pages/${LEADS}/records/${rec.id}`)
      .set(owner.bearer)
      .send({ data: { campaign: 'x' } });
    expect(noHeader.status).toBe(400);
    const stale = await client.patch(owner, LEADS, rec.id, rec.version + 4, { campaign: 'x' });
    expect(stale.status).toBe(409);
    expect(errorOf(stale).code).toBe('VERSION_CONFLICT');
    const ok = await client.patch(owner, LEADS, rec.id, rec.version, {
      campaign: 'after',
      expectedValue: 5,
    });
    expect(ok.status).toBe(200);
    const updated = dataOf<RecordBody>(ok);
    expect(updated.version).toBe(2);
    expect(ok.headers.etag).toBe('"2"');
    expect(updated.data).toMatchObject({
      campaign: 'after',
      expectedValue: 5,
      leadName: rec.data.leadName,
    });
    expect(updated.code).toBe(rec.code);
    const rows = await auditRows('RECORD_UPDATED', { targetId: rec.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toMatchObject({
      pageId: LEADS,
      before: { campaign: 'before' },
      after: { campaign: 'after', expectedValue: 5 },
    });
    const dbRow = await prisma.genericRecord.findUniqueOrThrow({ where: { id: rec.id } });
    expect(Number(dbRow.amount)).toBe(5);
  });

  it('no-op keeps the version and writes no audit row; null / blank clears optional fields, not required ones', async () => {
    const rec = await create(owner, { campaign: 'keep' });
    const noop = await client.patch(owner, LEADS, rec.id, rec.version, { campaign: 'keep' });
    expect(dataOf<RecordBody>(noop).version).toBe(1);
    expect(await auditRows('RECORD_UPDATED', { targetId: rec.id })).toHaveLength(0);
    const cleared = await client.patch(owner, LEADS, rec.id, 1, { campaign: null, company: '' });
    expect(dataOf<RecordBody>(cleared).data).not.toHaveProperty('campaign');
    expect(dataOf<RecordBody>(cleared).data).not.toHaveProperty('company');
    const required = await client.patch(owner, LEADS, rec.id, 2, { leadName: '' });
    expect(required.status).toBe(422);
    expect(errorOf(required).fields?.leadName).toBeDefined();
    const unknown = await client.patch(owner, LEADS, rec.id, 2, { leadNo: 'X', nope: 1 });
    expect(unknown.status).toBe(422);
    expect(errorOf(unknown).fields).toEqual({ nope: 'Unknown field.' });
    // The code field is read-only: its key is accepted and ignored.
    expect((await client.patch(owner, LEADS, rec.id, 2, { leadNo: 'X' })).status).toBe(200);
    expect((await client.get(owner, LEADS, rec.id)).headers.etag).toBe('"2"');
  });

  it('two concurrent edits of one version: exactly one wins', async () => {
    const rec = await create(owner);
    const [a, b] = await Promise.all([
      client.patch(owner, LEADS, rec.id, rec.version, { campaign: 'A' }),
      client.patch(owner, LEADS, rec.id, rec.version, { campaign: 'B' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('unknown id -> 404, malformed id -> 422', async () => {
    expect(
      (
        await client.patch(owner, LEADS, '00000000-0000-4000-8000-000000000000', 1, {
          campaign: 'x',
        })
      ).status,
    ).toBe(404);
    expect((await client.get(owner, LEADS, 'nope')).status).toBe(422);
  });
});

describe('DELETE, restore (undo)', () => {
  it('soft deletes with an undo token, audits, restores with or without the token', async () => {
    const rec = await create(owner);
    const del = await client.remove(owner, LEADS, rec.id);
    expect(del.status).toBe(200);
    const { undoToken } = dataOf<{ undoToken: string }>(del);
    expect(undoToken).toMatch(/^[0-9a-f]{32}$/);
    expect((await client.get(owner, LEADS, rec.id)).status).toBe(404);
    expect((await client.remove(owner, LEADS, rec.id)).status).toBe(404);
    expect(
      await prisma.genericRecord.count({ where: { id: rec.id, deletedAt: { not: null } } }),
    ).toBe(1);
    const wrong = await client.restore(owner, LEADS, rec.id, { undoToken: 'f'.repeat(32) });
    expect(wrong.status).toBe(422);
    const back = await client.restore(owner, LEADS, rec.id, { undoToken });
    expect(back.status).toBe(200);
    expect(dataOf<RecordBody>(back)).toMatchObject({ id: rec.id, code: rec.code });
    expect((await client.get(owner, LEADS, rec.id)).status).toBe(200);
    expect((await client.restore(owner, LEADS, rec.id)).status).toBe(404);
    expect(await auditRows('RECORD_DELETED', { targetId: rec.id })).toHaveLength(1);
    expect(await auditRows('RECORD_RESTORED', { targetId: rec.id })).toHaveLength(1);
    // The code is kept, so a record never loses its number.
    const again = await client.remove(owner, LEADS, rec.id);
    await client
      .restore(owner, LEADS, rec.id, { undoToken: dataOf<{ undoToken: string }>(again).undoToken })
      .expect(200);
  });

  it('optional If-Match is checked when sent', async () => {
    const rec = await create(owner);
    const stale = await request(app)
      .delete(`${API}/pages/${LEADS}/records/${rec.id}`)
      .set(owner.bearer)
      .set('If-Match', '9');
    expect(stale.status).toBe(409);
    const ok = await request(app)
      .delete(`${API}/pages/${LEADS}/records/${rec.id}`)
      .set(owner.bearer)
      .set('If-Match', '1');
    expect(ok.status).toBe(200);
  });
});

describe('POST status', () => {
  it('Draft -> Active -> Inactive -> Active; Draft -> Cancelled; everything else is 422', async () => {
    const rec = await create(owner);
    const to = async (id: string, status: string) => client.status(owner, LEADS, id, status);
    const active = await to(rec.id, 'Active');
    expect(active.status).toBe(200);
    expect(dataOf<RecordBody>(active)).toMatchObject({ status: 'Active', version: 2 });
    for (const bad of ['Draft', 'Completed', 'Nonsense']) {
      const res = await to(rec.id, bad);
      expect(res.status, bad).toBe(422);
      expect(errorOf(res).fields?.to).toBeDefined();
    }
    expect((await to(rec.id, 'Inactive')).status).toBe(200);
    expect((await to(rec.id, 'Active')).status).toBe(200);
    const other = await create(owner);
    expect((await to(other.id, 'Cancelled')).status).toBe(200);
    // Phase 5: a Cancelled document is locked (409 RECORD_LOCKED), like Pending Approval / Approved.
    for (const target of ['Active', 'Draft', 'Inactive']) {
      const locked = await to(other.id, target);
      expect(locked.status, target).toBe(409);
      expect(errorOf(locked).code).toBe('RECORD_LOCKED');
    }
    const rows = await auditRows('RECORD_STATUS_CHANGED', { targetId: rec.id });
    expect(rows.map((r) => r.detail)).toMatchObject([
      { from: 'Draft', to: 'Active' },
      { from: 'Active', to: 'Inactive' },
      { from: 'Inactive', to: 'Active' },
    ]);
  });

  it('Approved / Rejected belong to the approval workflow (422); Open / Pending rows can move on; masters toggle', async () => {
    const rec = await create(owner);
    for (const to of ['Approved', 'Rejected']) {
      const res = await client.status(owner, LEADS, rec.id, to);
      expect(res.status).toBe(422);
      expect(errorOf(res).fields?.to).toContain('approval');
    }
    await prisma.genericRecord.update({ where: { id: rec.id }, data: { status: 'Open' } });
    expect((await client.status(owner, LEADS, rec.id, 'Completed')).status).toBe(200);
    expect((await client.status(owner, LEADS, rec.id, 'Active')).status).toBe(422);
    const master = dataOf<RecordBody>(
      await client.create(owner, SOURCES, sampleData(schemaOf(SOURCES))),
    );
    expect(master.status).toBe('Active');
    expect((await client.status(owner, SOURCES, master.id, 'Inactive')).status).toBe(200);
    expect((await client.status(owner, SOURCES, master.id, 'Active')).status).toBe(200);
    const stale = await request(app)
      .post(`${API}/pages/${SOURCES}/records/${master.id}/status`)
      .set(owner.bearer)
      .set('If-Match', '99')
      .send({ to: 'Inactive' });
    expect(stale.status).toBe(409);
    expect(
      (
        await request(app)
          .post(`${API}/pages/${SOURCES}/records/${master.id}/status`)
          .set(owner.bearer)
          .send({})
      ).status,
    ).toBe(422);
  });
});

describe('POST bulk', () => {
  it('deletes each id with a per-id report; a failure does not stop the rest', async () => {
    const a = await create(owner);
    const b = await create(owner);
    const gone = await create(owner);
    await client.remove(owner, LEADS, gone.id).expect(200);
    const missing = '00000000-0000-4000-8000-000000000000';
    const res = await client.bulk(owner, LEADS, {
      action: 'delete',
      ids: [a.id, missing, gone.id, b.id],
    });
    expect(res.status).toBe(200);
    expect(dataOf<unknown[]>(res)).toEqual([
      { id: a.id, ok: true },
      { id: missing, ok: false, error: { code: 'NOT_FOUND', message: 'Record not found.' } },
      { id: gone.id, ok: false, error: { code: 'NOT_FOUND', message: 'Record not found.' } },
      { id: b.id, ok: true },
    ]);
    expect((await client.get(owner, LEADS, a.id)).status).toBe(404);
    const rows = await auditRows('RECORD_DELETED', { targetId: a.id });
    expect(rows[0]?.detail).toMatchObject({ bulk: true });
  });

  it('validates the body: action, 1..200 unique-format ids', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    for (const body of [
      {},
      { action: 'archive', ids: [id] },
      { action: 'delete', ids: [] },
      { action: 'delete', ids: ['x'] },
      { action: 'delete', ids: Array(201).fill(id) },
      { action: 'delete', ids: [id], extra: 1 },
    ]) {
      expect(
        (await client.bulk(owner, LEADS, body)).status,
        JSON.stringify(body).slice(0, 40),
      ).toBe(422);
    }
    expect(
      (await client.bulk(owner, LEADS, { action: 'delete', ids: Array(200).fill(id) })).status,
    ).toBe(200);
  });
});

describe('Idempotency-Key on POST', () => {
  const post = (s: Signed, key: string | undefined, data: Record<string, unknown>) => {
    const req = request(app).post(`${API}/pages/${LEADS}/records`).set(s.bearer);
    if (key !== undefined) void req.set('Idempotency-Key', key);
    return req.send({ data });
  };

  it('a repeated key returns the first result without creating a second record', async () => {
    const key = `key-${Math.random().toString(36).slice(2)}`;
    const body = lead({ campaign: 'idem' });
    const first = await post(owner, key, body);
    const second = await post(owner, key, body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(first.headers['idempotent-replay']).toBeUndefined();
    expect(dataOf<RecordBody>(second).id).toBe(dataOf<RecordBody>(first).id);
    expect(dataOf<RecordBody>(second).code).toBe(dataOf<RecordBody>(first).code);
    expect(await prisma.genericRecord.count({ where: { id: dataOf<RecordBody>(first).id } })).toBe(
      1,
    );
    expect(
      await auditRows('RECORD_CREATED', { targetId: dataOf<RecordBody>(first).id }),
    ).toHaveLength(1);
  });

  it('parallel requests with one key create exactly one record', async () => {
    const key = `par-${Math.random().toString(36).slice(2)}`;
    const body = lead({ campaign: 'par' });
    const results = await Promise.all(Array.from({ length: 5 }, () => post(owner, key, body)));
    expect(results.map((r) => r.status)).toEqual(Array(5).fill(201));
    expect(new Set(results.map((r) => dataOf<RecordBody>(r).id)).size).toBe(1);
  });

  it('the same key with a different body -> 409 CONFLICT; keys are per user; bad keys -> 400', async () => {
    const key = `diff-${Math.random().toString(36).slice(2)}`;
    await post(owner, key, lead()).expect(201);
    const other = await post(owner, key, lead({ campaign: 'different' }));
    expect(other.status).toBe(409);
    expect(errorOf(other).code).toBe('CONFLICT');
    const mine = await post(admin, key, lead());
    expect(mine.status).toBe(201);
    expect(mine.headers['idempotent-replay']).toBeUndefined();
    for (const bad of ['has space', 'x'.repeat(129), '']) {
      expect((await post(owner, bad, lead())).status, bad).toBe(400);
    }
    const noKey = await post(owner, undefined, lead());
    expect(noKey.status).toBe(201);
  });

  it('a failed validation does not burn the key', async () => {
    const key = `bad-${Math.random().toString(36).slice(2)}`;
    expect((await post(owner, key, { company: 'x' })).status).toBe(422);
    expect((await post(owner, key, lead())).status).toBe(201);
  });
});

describe('GET export.xlsx', () => {
  async function workbook(buffer: Buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = wb.worksheets[0];
    if (!sheet) throw new Error('no sheet');
    return sheet;
  }

  it('exports the filtered rows with a bold header, ₹ money format and escaped formulas; audited', async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    const evil = await create(owner, {
      leadName: '=HYPERLINK("http://x")',
      campaign: `+cmd ${tag}`,
      company: '@SUM(A1)',
      expectedValue: 2500.5,
    });
    await create(owner, { campaign: `plain ${tag}`, leadName: `-dash ${tag}` });
    const res = await client.export(owner, LEADS, { q: tag });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="crm-leads-\d{4}-\d{2}-\d{2}\.xlsx"$/,
    );
    const sheet = await workbook(res.body as Buffer);
    expect(sheet.rowCount).toBe(3);
    const header = sheet.getRow(1);
    expect(header.font?.bold).toBe(true);
    const headers = (header.values as unknown[]).slice(1);
    expect(headers.slice(0, 5)).toEqual(['Code', 'Status', 'Unit', 'FY', 'Department']);
    expect(headers).toContain('Lead Name');
    expect(headers).not.toContain('Lead No');
    const col = (label: string) => headers.indexOf(label) + 1;
    const rows = [sheet.getRow(2), sheet.getRow(3)];
    const evilRow = rows.find((r) => r.getCell(1).value === evil.code);
    expect(evilRow).toBeDefined();
    expect(evilRow?.getCell(col('Lead Name')).value).toBe('\'=HYPERLINK("http://x")');
    expect(evilRow?.getCell(col('Campaign')).value).toBe(`'+cmd ${tag}`);
    expect(evilRow?.getCell(col('Company')).value).toBe("'@SUM(A1)");
    const other = rows.find((r) => r !== evilRow);
    expect(other?.getCell(col('Lead Name')).value).toBe(`'-dash ${tag}`);
    expect(evilRow?.getCell(col('Expected Value')).value).toBe(2500.5);
    expect(evilRow?.getCell(col('Expected Value')).numFmt).toContain('₹');
    expect(evilRow?.getCell(col('Next Follow-up')).value).toBeInstanceOf(Date);
    expect(evilRow?.getCell(2).value).toBe('Draft');
    expect(evilRow?.getCell(3).value).toBe('TAL');
    const audit = (await auditRows('RECORDS_EXPORTED')).filter(
      (r) => (r.detail as { pageId?: string }).pageId === LEADS,
    );
    expect(audit.at(-1)?.detail).toMatchObject({ pageId: LEADS, count: 2, filters: { q: tag } });
  });

  it('honours the filters, ids (Export Selected), scope and the unit', async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    const a = await create(sales1, { campaign: tag });
    await create(sales2, { campaign: tag });
    const exp = async (s: Signed, query: Record<string, unknown>, h = {}) => {
      const res = await client.export(s, LEADS, query, h);
      expect(res.status).toBe(200);
      return (await workbook(res.body as Buffer)).rowCount - 1;
    };
    const lead2 = await signInAs(app, 'LEAD', { department: 'Sales' });
    expect(await exp(lead2, { q: tag })).toBe(2);
    expect(await exp(lead2, { ids: a.id })).toBe(1);
    expect(await exp(lead2, { q: tag, status: 'Active' })).toBe(0);
    expect(await exp(lead2, { q: tag }, { unit: SAW })).toBe(0);
    expect(await exp(admin, { q: tag }, { unit: 'all' })).toBe(2);
    expect((await client.export(lead2, LEADS, { ids: 'nope' })).status).toBe(422);
    expect((await client.export(lead2, LEADS, { sort: 'bogus' })).status).toBe(422);
    expect((await client.export(lead2, LEADS, { deleted: 'true' })).status).toBe(403);
  });

  it('refuses more than 10,000 rows with 422', async () => {
    const pageId = 'crm-feedback';
    await prisma.$executeRaw`
      INSERT INTO generic_records (id, page_id, unit_id, fy_id, department, code, status, data, version, created_by_id, created_at, updated_at)
      SELECT gen_random_uuid(), ${pageId}, ${TAL}::uuid, ${(await fyByCode('2026-27')).id}::uuid, 'Sales',
             'BULK/' || i, 'Draft', '{}'::jsonb, 1, ${owner.user.id}::uuid, now(), now()
      FROM generate_series(1, 10001) AS i`;
    try {
      const res = await client.export(owner, pageId);
      expect(res.status).toBe(422);
      const ids = (await client.list(owner, pageId, { size: 3 })).body as {
        data: RecordBody[];
        meta: { total: number };
      };
      expect(ids.meta.total).toBe(10001);
      const one = await client.export(owner, pageId, { ids: ids.data.map((r) => r.id).join(',') });
      expect(one.status).toBe(200);
    } finally {
      await prisma.genericRecord.deleteMany({ where: { pageId, code: { startsWith: 'BULK/' } } });
    }
  });
});

describe('audit trail of records', () => {
  it('GET /audit-logs filters by targetType=record (any case) and pageId', async () => {
    const a = await create(owner);
    const m = dataOf<RecordBody>(
      await client.create(owner, SOURCES, sampleData(schemaOf(SOURCES))),
    );
    const get = (query: Record<string, string>) =>
      request(app)
        .get(`${API}/audit-logs`)
        .query({ size: 100, ...query })
        .set(admin.bearer);
    const leads = (await get({ targetType: 'record', pageId: LEADS })).body as {
      data: { targetId: string; targetType: string; action: string; detail: { pageId: string } }[];
    };
    expect(leads.data.length).toBeGreaterThan(0);
    expect(leads.data.every((r) => r.targetType === 'Record' && r.detail.pageId === LEADS)).toBe(
      true,
    );
    expect(leads.data.map((r) => r.targetId)).toContain(a.id);
    expect(leads.data.map((r) => r.targetId)).not.toContain(m.id);
    const sources = (await get({ targetType: 'Record', pageId: SOURCES })).body as typeof leads;
    expect(sources.data.map((r) => r.targetId)).toContain(m.id);
    const all = (await get({ pageId: 'does-not-exist' })).body as typeof leads;
    expect(all.data).toHaveLength(0);
    const actions = (await request(app).get(`${API}/audit-logs/actions`).set(admin.bearer))
      .body as { data: string[] };
    expect(actions.data).toEqual(
      expect.arrayContaining([
        'RECORD_CREATED',
        'RECORD_UPDATED',
        'RECORD_DELETED',
        'RECORD_RESTORED',
        'RECORD_STATUS_CHANGED',
        'RECORDS_EXPORTED',
      ]),
    );
  });
});
