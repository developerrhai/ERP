// Stage B fix round: audit tabs scoped to what the caller can see, the four generic Administration
// masters, date-order rules, locked (Cancelled / Completed) records, the schema's module-control
// fields, and the corrected "... Status" enums.
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { datePairsOf } from '../src/engine/date-order';
import type { PageSchema } from '../src/engine/field-schema';
import type { FieldMeta } from '../src/engine/field-types';
import { API, auditRows, errorOf, newApp, prisma, signInAs, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { makeDepartment, restoreGlobal, snapshotGlobal } from './phase2-helpers';
import type { GlobalSnapshot } from './phase2-helpers';
import { unitByCode } from './phase3-helpers';
import { api, dataOf, sampleData, schemaOf } from './phase4-helpers';
import type { RecordBody } from './phase4-helpers';

const app = newApp();
const client = api(app);
const LEADS = 'crm-leads';

let owner: Signed;
let admin: Signed;
let sales1: Signed;
let sales2: Signed;
let salesManager: Signed;
let snap: GlobalSnapshot;
let n = 0;

const lead = (extra: Record<string, unknown> = {}) => ({
  ...sampleData(schemaOf(LEADS), ++n),
  leadName: `Fix ${n} ${Math.random().toString(36).slice(2, 8)}`,
  ...extra,
});

beforeAll(async () => {
  owner = await signInOwner(app);
  admin = await signInAs(app, 'ADMIN');
  sales1 = await signInAs(app, 'MEMBER', { department: 'Sales' });
  sales2 = await signInAs(app, 'MEMBER', { department: 'Sales' });
  salesManager = await signInAs(app, 'MANAGER', { department: 'Sales' });
  snap = await snapshotGlobal();
});

afterEach(async () => {
  await restoreGlobal(snap);
});

afterAll(async () => {
  await prisma.genericRecord.deleteMany({});
  await prisma.idempotencyKey.deleteMany({});
  await prisma.numberSeries.deleteMany({ where: { NOT: { pageId: { startsWith: 'inv-' } } } });
});

async function create(s: Signed, pageId = LEADS, extra: Record<string, unknown> = {}, h = {}) {
  const data = pageId === LEADS ? lead(extra) : { ...sampleData(schemaOf(pageId), ++n), ...extra };
  const res = await client.create(s, pageId, data, h);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return dataOf<RecordBody>(res);
}

interface AuditRow {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  ip: string | null;
  userAgent: string | null;
  detail: { pageId: string };
  actor: { id: string; name: string; loginId: string } | null;
}

const auditOf = (s: Signed, path: string, query: Record<string, unknown> = {}, h = {}) =>
  request(app)
    .get(`${API}${path}`)
    .query(query)
    .set({ ...s.bearer, ...h });

describe('GET /pages/:pageId/audit and /records/:id/audit', () => {
  it('shows the audit of the records the caller can see, in the /audit-logs row shape', async () => {
    const rec = await create(sales1);
    await client.patch(sales1, LEADS, rec.id, rec.version, { campaign: 'changed' }).expect(200);
    const res = await auditOf(sales1, `/pages/${LEADS}/audit`, { size: 100 });
    expect(res.status).toBe(200);
    const body = res.body as {
      data: AuditRow[];
      meta: { page: number; size: number; total: number };
    };
    const mine = body.data.filter((r) => r.targetId === rec.id);
    expect(mine.map((r) => r.action)).toEqual(['RECORD_UPDATED', 'RECORD_CREATED']);
    expect(Object.keys(mine[0] ?? {}).sort()).toEqual(
      ['action', 'actor', 'at', 'detail', 'id', 'ip', 'targetId', 'targetType', 'userAgent'].sort(),
    );
    expect(mine[0]).toMatchObject({
      targetType: 'Record',
      detail: { pageId: LEADS, code: rec.code },
      actor: { id: sales1.user.id, loginId: sales1.user.loginId },
    });
    expect(body.meta.total).toBe(body.data.length);
    expect(body.data.every((r) => r.detail.pageId === LEADS)).toBe(true);
  });

  it('OWN scope: other people records and their audit are invisible (404 for one record)', async () => {
    const mine = await create(sales1);
    const theirs = await create(sales2);
    const seen = (await auditOf(sales1, `/pages/${LEADS}/audit`, { size: 100 })).body as {
      data: AuditRow[];
    };
    const ids = new Set(seen.data.map((r) => r.targetId));
    expect(ids.has(mine.id)).toBe(true);
    expect(ids.has(theirs.id)).toBe(false);
    expect((await auditOf(sales1, `/pages/${LEADS}/records/${theirs.id}/audit`)).status).toBe(404);
    const own = await auditOf(sales1, `/pages/${LEADS}/records/${mine.id}/audit`);
    expect(own.status).toBe(200);
    expect((own.body as { data: AuditRow[] }).data).toHaveLength(1);
    // Sales2 sees their own record's audit but not sales1's.
    const s2 = (await auditOf(sales2, `/pages/${LEADS}/audit`, { size: 100 })).body as {
      data: AuditRow[];
    };
    expect(s2.data.some((r) => r.targetId === theirs.id)).toBe(true);
    expect(s2.data.some((r) => r.targetId === mine.id)).toBe(false);
  });

  it('DEPARTMENT scope follows the department rule; ALL sees everything; ip / user agent only for ADMIN+', async () => {
    const byOwner = await create(owner);
    const byS1 = await create(sales1);
    const crm = await makeDepartment(['CRM']);
    const other = await signInAs(app, 'MANAGER', { department: crm.name });
    const byOther = await create(other);
    const ids = async (s: Signed) =>
      new Set(
        (
          (await auditOf(s, `/pages/${LEADS}/audit`, { size: 100 })).body as { data: AuditRow[] }
        ).data.map((r) => r.targetId),
      );
    // Sales owns the page: its manager sees all of it. Another department sees only its own rows.
    const sm = await ids(salesManager);
    expect([byOwner.id, byS1.id, byOther.id].every((id) => sm.has(id))).toBe(true);
    const om = await ids(other);
    expect(om.has(byOther.id)).toBe(true);
    expect(om.has(byS1.id)).toBe(false);
    expect(om.has(byOwner.id)).toBe(false);
    const all = await ids(admin);
    expect([byOwner.id, byS1.id, byOther.id].every((id) => all.has(id))).toBe(true);

    const asMember = (await auditOf(sales1, `/pages/${LEADS}/records/${byS1.id}/audit`)).body as {
      data: AuditRow[];
    };
    expect(asMember.data[0]).toMatchObject({ ip: null, userAgent: null });
    const asAdmin = (await auditOf(admin, `/pages/${LEADS}/records/${byS1.id}/audit`)).body as {
      data: AuditRow[];
    };
    expect(asAdmin.data[0]?.actor?.id).toBe(sales1.user.id);
    expect(typeof asAdmin.data[0]?.ip).toBe('string');
  });

  it('includes the delete / restore of a record; follows the unit context; excludes exports', async () => {
    const rec = await create(owner);
    const del = await client.remove(owner, LEADS, rec.id);
    expect(del.status).toBe(200);
    await client.restore(owner, LEADS, rec.id).expect(200);
    await client.export(owner, LEADS).then((r) => expect(r.status).toBe(200));
    const rows = (
      (await auditOf(owner, `/pages/${LEADS}/records/${rec.id}/audit`)).body as { data: AuditRow[] }
    ).data;
    expect(rows.map((r) => r.action)).toEqual([
      'RECORD_RESTORED',
      'RECORD_DELETED',
      'RECORD_CREATED',
    ]);
    // A deleted record's audit stays visible (and reachable by id) while it is deleted.
    await client.remove(owner, LEADS, rec.id).expect(200);
    expect((await auditOf(owner, `/pages/${LEADS}/records/${rec.id}/audit`)).status).toBe(200);
    await client.restore(owner, LEADS, rec.id).expect(200);

    const saw = (await unitByCode('SAW')).id;
    const inSaw = await create(owner, LEADS, {}, { unit: saw });
    const inTal = (await auditOf(owner, `/pages/${LEADS}/audit`, { size: 100 })).body as {
      data: AuditRow[];
    };
    expect(inTal.data.some((r) => r.targetId === inSaw.id)).toBe(false);
    const inSawRows = (
      await auditOf(owner, `/pages/${LEADS}/audit`, { size: 100 }, { 'X-Unit-Id': saw })
    ).body as { data: AuditRow[] };
    expect(inSawRows.data.some((r) => r.targetId === inSaw.id)).toBe(true);
    const everything = (
      await auditOf(admin, `/pages/${LEADS}/audit`, { size: 100 }, { 'X-Unit-Id': 'all' })
    ).body as { data: AuditRow[] };
    expect(everything.data.some((r) => r.targetId === inSaw.id)).toBe(true);
    expect(everything.data.some((r) => r.action === 'RECORDS_EXPORTED')).toBe(false);
  });

  it('pages, validates, needs `view` on the page and refuses non-generic pages', async () => {
    for (let i = 0; i < 3; i += 1) await create(owner);
    const p1 = (await auditOf(owner, `/pages/${LEADS}/audit`, { size: 2, page: 1 })).body as {
      data: AuditRow[];
      meta: { total: number };
    };
    const p2 = (await auditOf(owner, `/pages/${LEADS}/audit`, { size: 2, page: 2 })).body as {
      data: AuditRow[];
    };
    expect(p1.data).toHaveLength(2);
    expect(p1.meta.total).toBeGreaterThanOrEqual(3);
    expect(p2.data.map((r) => r.id)).not.toContain(p1.data[0]?.id);
    for (const query of [{ size: 101 }, { page: 0 }, { bogus: 1 }, { page: 5000, size: 100 }]) {
      expect((await auditOf(owner, `/pages/${LEADS}/audit`, query)).status).toBe(422);
    }
    expect((await auditOf(owner, `/pages/${LEADS}/records/not-an-id/audit`)).status).toBe(422);
    expect(
      (await auditOf(owner, `/pages/${LEADS}/records/00000000-0000-4000-8000-000000000000/audit`))
        .status,
    ).toBe(404);
    const finance = await signInAs(app, 'MEMBER', { department: 'Finance' });
    expect((await auditOf(finance, `/pages/${LEADS}/audit`)).status).toBe(403);
    expect((await request(app).get(`${API}/pages/${LEADS}/audit`)).status).toBe(401);
    for (const pageId of ['dashboard', 'admin-users']) {
      const res = await auditOf(owner, `/pages/${pageId}/audit`);
      expect(res.status, pageId).toBe(404);
      expect(errorOf(res).code).toBe('NOT_GENERIC');
    }
    expect((await auditOf(owner, '/pages/no-such-page/audit')).status).toBe(404);
  });
});

describe('Administration masters served by the generic engine', () => {
  const PAGES = ['admin-designations', 'admin-currency', 'admin-uom', 'admin-taxes'];

  it('ADMIN+ can create, edit, delete and restore on the four masters; everyone below gets 403', async () => {
    for (const pageId of PAGES) {
      const schema = schemaOf(pageId);
      expect(schema.kind, pageId).toBe('generic');
      const created = await client.create(admin, pageId, sampleData(schema));
      expect(created.status, `${pageId} ${JSON.stringify(created.body)}`).toBe(201);
      const rec = dataOf<RecordBody>(created);
      expect(rec.status).toBe(schema.master ? 'Active' : 'Draft');
      const text = schema.fields.find((f) => !f.readOnly && f.type === 'text' && !f.required);
      if (text) {
        const patched = await client.patch(admin, pageId, rec.id, rec.version, {
          [text.key]: 'Edited',
        });
        expect(patched.status, pageId).toBe(200);
      }
      expect((await client.get(owner, pageId, rec.id)).status).toBe(200);
      expect((await client.remove(admin, pageId, rec.id)).status).toBe(200);
      expect((await client.restore(admin, pageId, rec.id)).status).toBe(200);
      for (const role of ['MANAGER', 'LEAD', 'MEMBER'] as const) {
        const s = await signInAs(app, role, { department: 'Sales' });
        expect((await client.list(s, pageId)).status, `${pageId} ${role}`).toBe(403);
        expect(
          (await client.create(s, pageId, sampleData(schema))).status,
          `${pageId} ${role}`,
        ).toBe(403);
        expect((await client.schema(s, pageId)).status, `${pageId} ${role}`).toBe(403);
      }
    }
  });

  it('a page-level deny or the allow_* switches still apply; module controls of these pages stay locked', async () => {
    const pageId = 'admin-uom';
    await prisma.rolePermission.create({
      data: { role: 'ADMIN', resource: `page:${pageId}`, add: false },
    });
    invalidateAccessCache();
    expect((await client.create(admin, pageId, sampleData(schemaOf(pageId)))).status).toBe(403);
    expect((await client.create(owner, pageId, sampleData(schemaOf(pageId)))).status).toBe(201);
    const version = (await prisma.moduleControl.findUniqueOrThrow({ where: { pageId } })).version;
    const lock = await request(app)
      .patch(`${API}/module-controls/${pageId}`)
      .set(owner.bearer)
      .set('If-Match', String(version))
      .send({ allowAdd: false });
    expect(lock.status).toBe(409);
    expect(errorOf(lock).code).toBe('PROTECTED');
  });

  it('every other Administration page is still NOT_GENERIC', async () => {
    for (const pageId of [
      'admin-company',
      'admin-branches',
      'admin-fy',
      'admin-departments',
      'admin-users',
      'admin-roles',
      'admin-permissions',
      'admin-approval',
      'admin-numbering',
      'admin-customfields',
      'admin-formbuilder',
      'admin-workflow',
      'admin-import',
      'admin-duplicates',
      'admin-audit',
      'admin-security',
      'admin-backup',
      'admin-api',
      'admin-integrations',
      'admin-settings',
    ]) {
      const res = await client.list(owner, pageId);
      expect(res.status, pageId).toBe(404);
      expect(errorOf(res).code, pageId).toBe('NOT_GENERIC');
    }
  });
});

describe('date-order rules', () => {
  const field = (key: string, label: string, type: FieldMeta['type'] = 'date'): FieldMeta => ({
    key,
    label,
    type,
    required: false,
    readOnly: false,
  });
  const fakeSchema = (labels: string[]): PageSchema =>
    ({ fields: labels.map((l, i) => field(`k${i}`, l)) }) as unknown as PageSchema;

  it('finds the obvious pairs', () => {
    const pairs = (labels: string[]) =>
      datePairsOf(fakeSchema(labels)).map((p) => `${p.start.label} < ${p.end.label}`);
    expect(pairs(['Start Date', 'End Date'])).toEqual(['Start Date < End Date']);
    expect(pairs(['From Date', 'To Date'])).toEqual(['From Date < To Date']);
    expect(pairs(['Valid From', 'Valid Till'])).toEqual(['Valid From < Valid Till']);
    expect(pairs(['Valid From', 'Valid Until'])).toEqual(['Valid From < Valid Until']);
    expect(pairs(['Effective From', 'Effective To'])).toEqual(['Effective From < Effective To']);
    expect(pairs(['Planned Start', 'Planned End'])).toEqual(['Planned Start < Planned End']);
    expect(pairs(['Issue Date', 'Expiry Date'])).toEqual(['Issue Date < Expiry Date']);
    expect(pairs(['Mfg Date', 'Expiry Date'])).toEqual(['Mfg Date < Expiry Date']);
    expect(pairs(['Joining Date', 'Confirmation Date'])).toEqual([
      'Joining Date < Confirmation Date',
    ]);
    expect(pairs(['Resignation Date', 'Last Working Date'])).toEqual([
      'Resignation Date < Last Working Date',
    ]);
    for (const end of ['Due Date', 'Close Date', 'Closing Date', 'Target Date']) {
      expect(pairs(['Start Date', end])).toEqual([`Start Date < ${end}`]);
    }
    // Different prefixes are not a pair.
    expect(pairs(['Planned Start', 'Baseline End', 'Order Date'])).toEqual([]);
    expect(pairs(['Warranty Start', 'Warranty End', 'Baseline Start', 'Baseline End'])).toEqual([
      'Warranty Start < Warranty End',
      'Baseline Start < Baseline End',
    ]);
  });

  it('create: an end before its start -> 422 on the later field; equal is fine', async () => {
    const pageId = 'scm-contracts';
    const schema = schemaOf(pageId);
    const start = schema.fields.find((f) => f.label === 'Start Date')?.key ?? '';
    const end = schema.fields.find((f) => f.label === 'End Date')?.key ?? '';
    const base = sampleData(schema);
    const bad = await client.create(owner, pageId, {
      ...base,
      [start]: '2026-06-15',
      [end]: '2026-06-14',
    });
    expect(bad.status).toBe(422);
    expect(errorOf(bad).fields).toEqual({ [end]: 'Must not be before Start Date.' });
    for (const [s, e] of [
      ['2026-06-15', '2026-06-15'],
      ['2026-06-15', '2027-06-14'],
    ] as const) {
      const ok = await client.create(owner, pageId, { ...base, [start]: s, [end]: e });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    }
  });

  it('patch: checks against the stored other side; only touched pairs are checked', async () => {
    const pageId = 'hr-leave';
    const schema = schemaOf(pageId);
    const from = schema.fields.find((f) => f.label === 'From Date')?.key ?? '';
    const to = schema.fields.find((f) => f.label === 'To Date')?.key ?? '';
    const rec = dataOf<RecordBody>(
      await client.create(owner, pageId, {
        ...sampleData(schema),
        [from]: '2026-07-10',
        [to]: '2026-07-12',
      }),
    );
    const early = await client.patch(owner, pageId, rec.id, rec.version, { [to]: '2026-07-01' });
    expect(early.status).toBe(422);
    expect(errorOf(early).fields?.[to]).toBe('Must not be before From Date.');
    const later = await client.patch(owner, pageId, rec.id, rec.version, { [from]: '2026-07-20' });
    expect(later.status).toBe(422);
    expect(errorOf(later.body ? later : later).fields?.[to]).toBeDefined();
    const both = await client.patch(owner, pageId, rec.id, rec.version, {
      [from]: '2026-07-20',
      [to]: '2026-07-25',
    });
    expect(both.status).toBe(200);
    // A legacy inconsistent row can still be edited elsewhere.
    await prisma.genericRecord.update({
      where: { id: rec.id },
      data: {
        data: JSON.parse(
          JSON.stringify({ ...(both.body as { data: RecordBody }).data.data, [to]: '2026-01-01' }),
        ) as object,
      },
    });
    const fresh = await client.get(owner, pageId, rec.id);
    const reason = schema.fields.find((f) => !f.readOnly && f.type === 'longtext')?.key;
    if (reason) {
      const ok = await client.patch(owner, pageId, rec.id, dataOf<RecordBody>(fresh).version, {
        [reason]: 'unrelated edit',
      });
      expect(ok.status).toBe(200);
    }
    // Clearing the end date is allowed (optional field).
    const cleared = await client.patch(
      owner,
      pageId,
      rec.id,
      dataOf<RecordBody>(await client.get(owner, pageId, rec.id)).version,
      {
        [to]: null,
      },
    );
    expect(cleared.status).toBe(200);
  });

  it('applies to datetimes and to the pairs of every page that has them', async () => {
    const pageId = 'maint-workorders';
    const schema = schemaOf(pageId);
    const start = schema.fields.find((f) => f.label === 'Planned Start')?.key ?? '';
    const end = schema.fields.find((f) => f.label === 'Planned End')?.key ?? '';
    const bad = await client.create(owner, pageId, {
      ...sampleData(schema),
      [start]: '2026-06-20',
      [end]: '2026-06-19',
    });
    expect(errorOf(bad).fields?.[end]).toContain('Planned Start');
    const pages = [
      'sales-pricelist',
      'mfg-bom',
      'tax-hsn',
      'proj-projects',
      'service-amc',
      'proj-team',
    ];
    for (const id of pages) expect(datePairsOf(schemaOf(id)).length, id).toBeGreaterThan(0);
  });
});

describe('locked records, schema extras and status enums', () => {
  it('a Cancelled record cannot be edited (409 RECORD_LOCKED) but can still be deleted and restored', async () => {
    const rec = await create(owner);
    await client.status(owner, LEADS, rec.id, 'Cancelled').expect(200);
    const fresh = dataOf<RecordBody>(await client.get(owner, LEADS, rec.id));
    const res = await client.patch(owner, LEADS, rec.id, fresh.version, { campaign: 'late' });
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('RECORD_LOCKED');
    expect((await client.remove(owner, LEADS, rec.id)).status).toBe(200);
    expect((await client.restore(owner, LEADS, rec.id)).status).toBe(200);
    await prisma.genericRecord.update({ where: { id: rec.id }, data: { status: 'Completed' } });
    const completed = await client.patch(owner, LEADS, rec.id, fresh.version + 3, {
      campaign: 'late',
    });
    expect(completed.status).toBe(409);
    expect(errorOf(completed).code).toBe('RECORD_LOCKED');
    // Inactive masters stay editable.
    const master = dataOf<RecordBody>(
      await client.create(owner, 'crm-sources', sampleData(schemaOf('crm-sources'))),
    );
    await client.status(owner, 'crm-sources', master.id, 'Inactive').expect(200);
    const m = dataOf<RecordBody>(await client.get(owner, 'crm-sources', master.id));
    expect(
      (await client.patch(owner, 'crm-sources', master.id, m.version, { campaign: 'x' })).status,
    ).toBe(200);
  });

  it('the schema carries ownerDepartment, approvalRequired, editableStatuses, readOnly, actions', async () => {
    const res = await client.schema(sales1, LEADS);
    const s = dataOf<PageSchema & { ownerDepartment: string; approvalRequired: boolean }>(res);
    expect(s.ownerDepartment).toBe('Sales');
    expect(s.approvalRequired).toBe(true);
    expect(s.editableStatuses).toEqual(['Draft', 'Active', 'Inactive', 'Open', 'Pending']);
    expect(s.actions).toEqual([]);
    expect(s.fields.every((f) => typeof f.readOnly === 'boolean')).toBe(true);
    await prisma.moduleControl.update({
      where: { pageId: LEADS },
      data: { approvalRequired: false, ownerDepartment: 'Purchase' },
    });
    invalidateAccessCache();
    const changed = dataOf<{ ownerDepartment: string; approvalRequired: boolean }>(
      await client.schema(owner, LEADS),
    );
    expect(changed).toMatchObject({ ownerDepartment: 'Purchase', approvalRequired: false });
  });

  it('"... Status" fields are writable enums with options; only "Status" is the workflow status', async () => {
    const rec = await create(owner, LEADS, { consentStatus: 'Granted' });
    expect(rec.data.consentStatus).toBe('Granted');
    expect(rec.status).toBe('Draft');
    const bad = await client.create(owner, LEADS, lead({ consentStatus: 'Maybe' }));
    expect(bad.status).toBe(422);
    expect(errorOf(bad).fields?.consentStatus).toContain('Pending, Granted, Withdrawn');
    const patched = await client.patch(owner, LEADS, rec.id, rec.version, {
      consentStatus: 'Withdrawn',
    });
    expect(dataOf<RecordBody>(patched).data.consentStatus).toBe('Withdrawn');
    // The workflow status is still not writable through data.
    const sneaky = await client.patch(owner, LEADS, rec.id, 2, { status: 'Active' });
    expect(dataOf<RecordBody>(sneaky).status).toBe('Draft');
    expect(await auditRows('RECORD_UPDATED', { targetId: rec.id })).toHaveLength(1);
  });

  it('Priority is an enum with the default list; amounts like Monthly Cost are money', () => {
    const pages = ['crm-pipeline', 'crm-followups', 'crm-customer360'];
    const withPriority = pages
      .map((id) => schemaOf(id))
      .find((s) => s.fields.some((f) => f.label === 'Priority'));
    const priority = withPriority?.fields.find((f) => f.label === 'Priority');
    expect(priority).toMatchObject({
      type: 'enum',
      options: ['Low', 'Medium', 'High', 'Critical'],
    });
    const sources = schemaOf('crm-sources');
    expect(sources.fields.find((f) => f.label === 'Monthly Cost')?.type).toBe('money');
  });
});
