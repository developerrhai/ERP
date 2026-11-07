// Phase 06 simple masters through the API: payment terms (sum = 100), banks, HSN with dated rates, GST rates,
// GST registrations, item groups, price lists, UOM conversions; ETag / If-Match, idempotent replay,
// permissions and the audit rows.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { gstinCheckChar } from '../src/engine/validators';
import {
  API,
  auditRows,
  errorOf,
  makeUser,
  newApp,
  prisma,
  signIn,
  signInOwner,
  unitIds,
} from './helpers';
import type { Signed } from './helpers';
import { dataOf } from './phase4-helpers';

const app = newApp();
let owner: Signed;
let emp: Signed;
let n = 0;
const tag = () => `${Date.now().toString(36)}${(n += 1)}`.toUpperCase().replace(/[^A-Z0-9]/g, '');

const post = (s: Signed, path: string, body: unknown, key?: string) => {
  const r = request(app).post(`${API}${path}`).set(s.bearer);
  return (key ? r.set('Idempotency-Key', key) : r).send(body as object);
};
const get = (s: Signed, path: string) => request(app).get(`${API}${path}`).set(s.bearer);
const patch = (s: Signed, path: string, version: number, body: unknown) =>
  request(app)
    .patch(`${API}${path}`)
    .set(s.bearer)
    .set('If-Match', String(version))
    .send(body as object);

beforeAll(async () => {
  owner = await signInOwner(app);
  emp = await signIn(app, await makeUser({ role: 'EMPLOYEE', department: 'Purchase' }));
  invalidateAccessCache();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('payment terms', () => {
  it('percentages must add up to 100; a good term is created, patched with If-Match, and deleted', async () => {
    const code = `T${tag()}`.slice(0, 18);
    const lines = [
      { portionPct: 30, dueBasis: 'ADVANCE', days: 0 },
      { portionPct: 70, dueBasis: 'INVOICE_DATE', days: 30 },
    ];
    const bad = await post(owner, '/payment-terms', {
      code,
      name: 'Bad split',
      lines: [lines[0], { portionPct: 60, dueBasis: 'INVOICE_DATE', days: 30 }],
    });
    expect(bad.status).toBe(422);
    expect(errorOf(bad).code).toBe('TERMS_SUM');
    expect(errorOf(bad).message).toBe('Instalment percentages must add up to 100 % (now 90 %).');
    const ok = await post(owner, '/payment-terms', { code, name: '30 / 70', lines }, `k-${code}`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const row = dataOf<{ id: string; version: number; lines: unknown[] }>(ok);
    expect(row.lines).toHaveLength(2);
    const replay = await post(
      owner,
      '/payment-terms',
      { code, name: '30 / 70', lines },
      `k-${code}`,
    );
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(await prisma.paymentTerm.count({ where: { code } })).toBe(1);
    expect(
      (
        await request(app)
          .patch(`${API}/payment-terms/${row.id}`)
          .set(owner.bearer)
          .send({ name: 'x1' })
      ).status,
    ).toBe(400);
    const stale = await patch(owner, `/payment-terms/${row.id}`, row.version + 3, {
      name: 'Renamed',
    });
    expect(stale.status).toBe(409);
    const upd = await patch(owner, `/payment-terms/${row.id}`, row.version, {
      name: 'Renamed term',
    });
    expect(upd.status).toBe(200);
    expect(upd.headers.etag).toBe(`"${row.version + 1}"`);
    expect((await auditRows('PAYMENT_TERM_CREATED')).length).toBeGreaterThanOrEqual(1);
    expect(
      (await request(app).delete(`${API}/payment-terms/${row.id}`).set(owner.bearer)).status,
    ).toBe(204);
    expect((await get(owner, `/payment-terms/${row.id}`)).status).toBe(404);
  });

  it('needs the Controls right: a normal user gets 403 and anonymous gets 401', async () => {
    const body = {
      code: 'ZZ',
      name: 'No',
      lines: [{ portionPct: 100, dueBasis: 'INVOICE_DATE', days: 0 }],
    };
    expect((await post(emp, '/payment-terms', body)).status).toBe(403);
    expect((await request(app).get(`${API}/payment-terms`)).status).toBe(401);
  });
});

describe('banks, HSN, GST rates', () => {
  it('banks use the first 4 letters of the IFSC; duplicates are refused', async () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const pickLetter = () => letters.charAt(Math.floor(Math.random() * 26));
    const code = `ZZ${pickLetter()}${pickLetter()}`;
    const a = await post(owner, '/banks', { code, name: 'Test Bank' });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect((await post(owner, '/banks', { code, name: 'Test Bank Again' })).status).toBe(409);
    expect((await post(owner, '/banks', { code: 'abc', name: 'Bad' })).status).toBe(422);
  });

  it('HSN rates: adding one ends the open rate the day before; an overlap is refused with the exact message', async () => {
    const hsn = dataOf<{ id: string }>(
      await post(owner, '/hsn-sac', {
        code: `99${String(Date.now()).slice(-6)}`,
        description: 'Rate history test',
      }),
    );
    const g12 = await prisma.gstRate.findUniqueOrThrow({ where: { code: 'GST12_OLD' } });
    const g5 = await prisma.gstRate.findUniqueOrThrow({ where: { code: 'GST5' } });
    expect(
      (
        await post(owner, `/hsn-sac/${hsn.id}/rates`, {
          gstRateId: g12.id,
          effectiveFrom: '2017-07-01',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post(owner, `/hsn-sac/${hsn.id}/rates`, {
          gstRateId: g5.id,
          effectiveFrom: '2025-09-22',
        })
      ).status,
    ).toBe(201);
    const rates = dataOf<{ effectiveTo: string | null }[]>(
      await get(owner, `/hsn-sac/${hsn.id}/rates`),
    );
    expect(rates.map((r) => r.effectiveTo?.slice(0, 10) ?? null).sort()).toEqual([
      '2025-09-21',
      null,
    ]);
    const overlap = await post(owner, `/hsn-sac/${hsn.id}/rates`, {
      gstRateId: g5.id,
      effectiveFrom: '2025-09-01',
      effectiveTo: '2025-09-30',
    });
    expect(overlap.status).toBe(409);
    expect(errorOf(overlap).code).toBe('RATE_OVERLAP');
    expect(errorOf(overlap).message).toBe(
      'This date overlaps the rate valid 2017-07-01–2025-09-21.',
    );
    expect((await post(owner, '/hsn-sac', { code: '123', description: 'short' })).status).toBe(422);
  });

  it('GST rates: CGST and SGST are half of IGST; the end date cannot precede the start', async () => {
    const code = `T_${tag()}`.slice(0, 28);
    const ok = await post(owner, '/gst-rates', {
      code,
      name: 'Test 6 %',
      igstPct: 6,
      effectiveFrom: '2026-01-01',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const row = await prisma.gstRate.findUniqueOrThrow({ where: { code } });
    expect(row.cgstPct?.toString()).toBe('3');
    const bad = await post(owner, '/gst-rates', {
      code: `${code}X`.slice(0, 30),
      name: 'Bad',
      igstPct: 6,
      effectiveFrom: '2026-02-01',
      effectiveTo: '2026-01-01',
    });
    expect(bad.status).toBe(422);
  });
});

describe('GST registrations, item groups, price lists, UOM conversions', () => {
  it('a registration takes its state from a checksum-valid GSTIN and refuses a typing mistake', async () => {
    const [unit] = await unitIds(['TAL']);
    const first14 = '27AAPFU0939F1Z';
    const good = first14 + gstinCheckChar(first14);
    const reg = {
      unitId: unit,
      legalName: 'Test Co',
      registrationType: 'REGULAR',
      effectiveFrom: '2026-04-01',
    };
    const bad = await post(owner, '/gst-registrations', { ...reg, gstin: `${first14}O` });
    expect(errorOf(bad).code).toBe('GSTIN_CHECKSUM');
    const ok = await post(owner, '/gst-registrations', { ...reg, gstin: good });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(dataOf<{ stateCode: string; minHsnDigits: number }>(ok)).toMatchObject({
      stateCode: '27',
      minHsnDigits: 6,
    });
    expect(
      (await post(owner, '/gst-registrations', { ...reg, gstin: good, legalName: 'Dup' })).status,
    ).toBe(409);
  });

  it('item groups and price lists (dates checked) and UOM conversions', async () => {
    const code = `G${tag()}`.slice(0, 30);
    expect((await post(owner, '/item-groups', { code, name: 'Test group' })).status).toBe(200);
    const bad = await post(owner, '/price-lists', {
      code: `P${tag()}`.slice(0, 28),
      name: 'Bad dates',
      validFrom: '2026-12-01',
      validTo: '2026-01-01',
    });
    expect(errorOf(bad).message).toBe('Valid To must be on or after Valid From.');
    const hsn = await prisma.hsnSacCode.findUniqueOrThrow({ where: { code: '847130' } });
    const o = await prisma.user.findFirstOrThrow({ where: { loginId: 'owner' } });
    const item = await prisma.item.create({
      data: {
        code: `SM-${tag()}`,
        name: 'SM item',
        itemType: 'Consumable',
        baseUom: 'Nos',
        hsnSac: '847130',
        hsnId: hsn.id,
        createdById: o.id,
      },
    });
    const list = await post(owner, '/price-lists', {
      code: `P${tag()}`.slice(0, 28),
      name: 'Test list',
      items: [
        { itemId: item.id, uomCode: 'Nos', minQty: 0, rate: 10 },
        { itemId: item.id, uomCode: 'Nos', minQty: 100, rate: 9 },
      ],
    });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(dataOf<{ items: unknown[] }>(list).items).toHaveLength(2);
    const codeA = `UA${tag()}`.slice(0, 12);
    const codeB = `UB${tag()}`.slice(0, 12);
    for (const c of [codeA, codeB]) {
      expect(
        (await post(owner, '/uoms', { code: c, name: `Unit ${c}`, uomClass: 'Count', decimals: 0 }))
          .status,
      ).toBe(201);
    }
    const uomA = { code: codeA };
    const uomB = { code: codeB };
    await prisma.item.update({ where: { id: item.id }, data: { baseUom: uomA.code } });
    const conv = await request(app)
      .put(`${API}/items/${item.id}/uom-conversions`)
      .set(owner.bearer)
      .send({ conversions: [{ uomCode: uomB.code, factor: 12 }] });
    expect(conv.status, JSON.stringify(conv.body)).toBe(200);
    const same = await request(app)
      .put(`${API}/items/${item.id}/uom-conversions`)
      .set(owner.bearer)
      .send({ conversions: [{ uomCode: uomA.code, factor: 1 }] });
    expect(same.status).toBe(422);
  });
});
