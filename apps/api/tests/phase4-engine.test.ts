// The metadata engine over ALL generic registry pages (docs/phase3-4 Tests, Stage B): the schema
// builds, a record made from generated sample data goes create -> get -> list -> patch -> soft delete
// -> restore, and parallel creates get distinct consecutive gap-free codes. Also the page counts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registry } from '../src/core/registry';
import { fieldTypeCounts } from '../src/engine/field-schema';
import { CUSTOM_PAGES, TYPED_PAGES, kindOf } from '../src/engine/kinds';
import { newApp, prisma, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { api, dataOf, genericPageIds, sampleData, schemaOf } from './phase4-helpers';
import type { RecordBody } from './phase4-helpers';

const app = newApp();
const client = api(app);
let owner: Signed;

beforeAll(async () => {
  owner = await signInOwner(app);
});

afterAll(async () => {
  await prisma.genericRecord.deleteMany({ where: { createdById: owner.user.id } });
  await prisma.numberSeries.deleteMany({ where: { NOT: { pageId: { startsWith: 'inv-' } } } });
  await prisma.idempotencyKey.deleteMany({});
});

describe('page kinds and counts', () => {
  it('248 pages: 21 custom prototype pages, 24 Administration (4 of them generic), 7 typed, the rest generic', () => {
    const kinds: Record<string, number> = { generic: 0, typed: 0, custom: 0 };
    for (const id of registry.pages.keys())
      kinds[kindOf(id) ?? 'none'] = (kinds[kindOf(id) ?? 'none'] ?? 0) + 1;
    expect(registry.pages.size).toBe(248);
    expect(CUSTOM_PAGES.size).toBe(21);
    expect(TYPED_PAGES.size).toBe(7);
    // 248 - 21 custom - 14 other Administration - 7 typed = 206 pages served by the generic engine
    // (the 202 other pages plus admin-designations / -currency / -uom / -taxes).
    expect(kinds).toEqual({ generic: 206, typed: 7, custom: 35 });
    expect(genericPageIds()).toHaveLength(206);
    for (const id of ['admin-designations', 'admin-currency', 'admin-uom', 'admin-taxes']) {
      expect(kindOf(id)).toBe('generic');
    }
  });

  it('every page of the registry builds a schema; field type counts equal the reviewed fixture', () => {
    const schemas = [...registry.pages.keys()].map((id) => schemaOf(id));
    expect(fieldTypeCounts(schemas)).toEqual({
      code: 207,
      status: 239,
      date: 253,
      datetime: 63,
      money: 348,
      pct: 94,
      qty: 324,
      ref: 500,
      email: 5,
      phone: 6,
      gstin: 13,
      pan: 7,
      ifsc: 0,
      hsn: 2,
      aadhaar: 1,
      uan: 3,
      bool: 47,
      enum: 211,
      text: 357,
      longtext: 93,
    });
    for (const schema of schemas) {
      const keys = schema.fields.map((f) => f.key);
      expect(new Set(keys).size, schema.pageId).toBe(keys.length);
      expect(schema.listColumns.length).toBeLessThanOrEqual(12);
      expect(schema.listColumns, schema.pageId).toEqual(keys.slice(0, 12));
    }
  });
});

describe('every generic page: create -> get -> list -> patch -> delete -> restore', () => {
  it('works for all 206 pages', { timeout: 280_000 }, async () => {
    const failures: string[] = [];
    for (const pageId of genericPageIds()) {
      const schema = schemaOf(pageId);
      const fail = (step: string, detail: unknown) =>
        failures.push(`${pageId} ${step}: ${JSON.stringify(detail)}`);
      const data = sampleData(schema);

      const created = await client.create(owner, pageId, data);
      if (created.status !== 201) {
        fail('create', created.body);
        continue;
      }
      const rec = dataOf<RecordBody>(created);
      if (rec.status !== (schema.master ? 'Active' : 'Draft')) fail('status', rec.status);
      if (!/^[A-Z]{3}\/TAL\/26-27\/\d{5}$/.test(rec.code)) fail('code', rec.code);

      const got = await client.get(owner, pageId, rec.id);
      if (got.status !== 200 || dataOf<RecordBody>(got).code !== rec.code) fail('get', got.body);

      const listed = await client.list(owner, pageId, { q: rec.code, size: 5 });
      const ids = (listed.body as { data: RecordBody[] }).data.map((r) => r.id);
      if (listed.status !== 200 || !ids.includes(rec.id)) fail('list', listed.body);

      const textField = schema.fields.find((f) => !f.readOnly && f.type === 'text');
      const numberField = schema.fields.find((f) => !f.readOnly && f.type === 'qty');
      const change: Record<string, unknown> = textField
        ? { [textField.key]: 'Changed text' }
        : numberField
          ? { [numberField.key]: 99 }
          : {};
      if (Object.keys(change).length > 0) {
        const patched = await client.patch(owner, pageId, rec.id, rec.version, change);
        if (patched.status !== 200 || dataOf<RecordBody>(patched).version !== rec.version + 1) {
          fail('patch', patched.body);
          continue;
        }
      }

      const deleted = await client.remove(owner, pageId, rec.id);
      if (
        deleted.status !== 200 ||
        typeof dataOf<{ undoToken: string }>(deleted).undoToken !== 'string'
      ) {
        fail('delete', deleted.body);
        continue;
      }
      if ((await client.get(owner, pageId, rec.id)).status !== 404) fail('get-after-delete', '');
      const restored = await client.restore(owner, pageId, rec.id);
      if (restored.status !== 200) fail('restore', restored.body);
      if ((await client.get(owner, pageId, rec.id)).status !== 200) fail('get-after-restore', '');
    }
    expect(failures).toEqual([]);
  });
});

describe('number series', () => {
  it('20 parallel creates give 20 distinct consecutive codes', async () => {
    const pageId = 'crm-leads';
    const schema = schemaOf(pageId);
    const before = await prisma.genericRecord.count({ where: { pageId } });
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => client.create(owner, pageId, sampleData(schema, i))),
    );
    expect(results.map((r) => r.status)).toEqual(Array(20).fill(201));
    const numbers = results
      .map((r) => Number(dataOf<RecordBody>(r).code.split('/').at(-1)))
      .sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(20);
    const first = numbers[0] ?? 0;
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => first + i));
    expect(await prisma.genericRecord.count({ where: { pageId } })).toBe(before + 20);
  });

  it('a rolled-back create gives its number back (gap-free) and series are per page, unit and FY', async () => {
    const pageId = 'crm-opportunities';
    const schema = schemaOf(pageId);
    const ok1 = await client.create(owner, pageId, sampleData(schema));
    // Missing required fields fail validation before any number is taken.
    const bad = await client.create(owner, pageId, { notAField: 1 });
    expect(bad.status).toBe(422);
    const ok2 = await client.create(owner, pageId, sampleData(schema, 2));
    const n = (r: unknown) =>
      Number(
        dataOf<RecordBody>(r as never)
          .code.split('/')
          .at(-1),
      );
    expect(n(ok2)).toBe(n(ok1) + 1);

    const sawId = (await prisma.unit.findUniqueOrThrow({ where: { code: 'SAW' } })).id;
    const inSaw = await client.create(owner, pageId, sampleData(schema, 3), { unit: sawId });
    expect(dataOf<RecordBody>(inSaw).code).toMatch(/^OPP\/SAW\/26-27\/00001$/);
    const fy2526 = (await prisma.financialYear.findUniqueOrThrow({ where: { code: '2025-26' } }))
      .id;
    const inOld = await client.create(owner, pageId, sampleData(schema, 4), { fy: fy2526 });
    expect(dataOf<RecordBody>(inOld).code).toMatch(/^OPP\/TAL\/25-26\/00001$/);
  });
});
