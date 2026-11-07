// Phase 06 integration (docs/phases/PHASE-06.md §10, §11): offline GSTIN / PAN decode, duplicate BLOCK and
// WARN, customer and supplier creation, supplier approval, the two-person bank check (service AND database),
// credit increase vs decrease, dated GST rates across 22-09-2025, overlapping HSN rates, price lookup.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { gstinCheckChar } from '../src/engine/validators';
import { partyService } from '../src/modules/masters/party-service';
import { taxService } from '../src/modules/masters/tax-service';
import { API, errorOf, makeUser, newApp, prisma, signIn, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { dataOf } from './phase4-helpers';

const app = newApp();
let owner: Signed;
let mgr: Signed;
let salesMgr: Signed;
let salesHead: Signed;
let emp: Signed;
let n = 0;

const gstinFor = (stateCode: string, pan: string): string => {
  const first14 = `${stateCode}${pan}1Z`;
  return first14 + gstinCheckChar(first14);
};
const uniquePan = (): string => {
  n += 1;
  return `AAAPA${String(1000 + n).padStart(4, '0')}A`;
};

const post = (s: Signed, path: string, body: unknown) =>
  request(app)
    .post(`${API}${path}`)
    .set(s.bearer)
    .send(body as object);
const get = (s: Signed, path: string) => request(app).get(`${API}${path}`).set(s.bearer);

beforeAll(async () => {
  owner = await signInOwner(app);
  mgr = await signIn(
    app,
    await makeUser({ role: 'DEPT_MANAGER', department: 'Purchase', approvalLimit: 100_000 }),
  );
  salesMgr = await signIn(
    app,
    await makeUser({ role: 'DEPT_MANAGER', department: 'Sales', approvalLimit: 100_000 }),
  );
  salesHead = await signIn(
    app,
    await makeUser({ role: 'DEPT_HEAD', department: 'Sales', approvalLimit: 100_000 }),
  );
  emp = await signIn(app, await makeUser({ role: 'EMPLOYEE', department: 'Purchase' }));
  invalidateAccessCache();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeItem(hsnCode = '99950001') {
  const hsn =
    (await prisma.hsnSacCode.findUnique({ where: { code: hsnCode } })) ??
    (await prisma.hsnSacCode.create({ data: { code: hsnCode, description: 'Test HSN' } }));
  const owner0 = await prisma.user.findFirstOrThrow({ where: { loginId: 'owner' } });
  n += 1;
  return prisma.item.create({
    data: {
      code: `T6-${Date.now()}-${n}`,
      name: `Test item ${n}`,
      itemType: 'Raw Material',
      baseUom: 'NOS',
      hsnSac: hsnCode,
      hsnId: hsn.id,
      createdById: owner0.id,
    },
  });
}

describe('migration and seed', () => {
  it('has the 39 states, the GST slabs flagged needs_review, the starter terms and banks, and NO demo parties', async () => {
    expect(await prisma.gstState.count()).toBeGreaterThanOrEqual(39);
    expect(await prisma.gstState.findUnique({ where: { code: '27' } })).toMatchObject({
      name: 'Maharashtra',
    });
    expect(await prisma.gstState.findUnique({ where: { code: '25' } })).toBeNull();
    const slabs = await prisma.gstRate.findMany();
    expect(slabs.length).toBeGreaterThanOrEqual(10);
    expect(slabs.every((s) => s.needsReview)).toBe(true);
    const g18 = slabs.find((s) => s.code === 'GST18');
    expect(g18?.igstPct.toString()).toBe('18');
    expect(g18?.cgstPct?.toString()).toBe('9');
    expect((await prisma.paymentTerm.findMany()).map((t) => t.code)).toEqual(
      expect.arrayContaining(['IMMEDIATE', 'NET30', 'NET45']),
    );
    expect(await prisma.bank.count()).toBeGreaterThan(5);
    // no rate mapping is decided by the builder
    expect(await prisma.hsnSacRate.count()).toBe(0);
  });
});

describe('offline decode', () => {
  it('27AAPFU0939F1ZV decodes to Maharashtra and PAN AAPFU0939F; a typing mistake is explained', async () => {
    const ok = dataOf<{ ok: boolean; state: string; pan: string; stateCode: string }>(
      await get(owner, '/statutory/gstin/27AAPFU0939F1ZV'),
    );
    expect(ok).toMatchObject({
      ok: true,
      state: 'Maharashtra',
      pan: 'AAPFU0939F',
      stateCode: '27',
    });
    const bad = dataOf<{ ok: boolean; code: string; message: string }>(
      await get(owner, '/statutory/gstin/27AAPFU0939F1ZO'),
    );
    expect(bad).toMatchObject({ ok: false, code: 'GSTIN_CHECKSUM' });
    const pan = dataOf<{ ok: boolean; holder: string }>(
      await get(owner, '/statutory/pan/AAPFU0939F'),
    );
    expect(pan).toEqual({ ok: true, pan: 'AAPFU0939F', holder: 'Firm / LLP' });
    expect((await request(app).get(`${API}/statutory/gstin/27AAPFU0939F1ZV`)).status).toBe(401);
  });
});

describe('customers', () => {
  const body = (extra: Record<string, unknown> = {}) => {
    const pan = uniquePan();
    return {
      name: `Test Customer ${n}`,
      gstRegistrationType: 'REGULAR',
      gstin: gstinFor('27', pan),
      city: 'Pune',
      ...extra,
    };
  };

  it('creates a customer with PAN and state taken from the GSTIN; no approval is needed', async () => {
    const res = await post(owner, '/customers', body());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const c = dataOf<{ code: string; pan: string; stateCode: string; approvalStatus: string }>(res);
    expect(c.code).toMatch(/^CUS\/\d{5}$/);
    expect(c.stateCode).toBe('27');
    expect(c.pan).toMatch(/^AAAPA\d{4}A$/);
    expect(c.approvalStatus).toBe('APPROVED');
  });

  it('refuses the same GSTIN with the exact message (BLOCK) and a PAN mismatch / wrong state', async () => {
    const first = body();
    expect((await post(owner, '/customers', first)).status).toBe(200);
    const dup = await post(owner, '/customers', { ...first, name: 'Another name' });
    expect(dup.status).toBe(409);
    expect(errorOf(dup).code).toBe('GSTIN_DUPLICATE');
    expect(errorOf(dup).message).toMatch(
      /^Customer CUS\/\d{5} – Test Customer \d+ already has this GSTIN\.$/,
    );
    const mismatch = await post(owner, '/customers', body({ pan: 'ABCPE1234F' }));
    expect(errorOf(mismatch).code).toBe('GSTIN_PAN_MISMATCH');
    const state = await post(owner, '/customers', body({ stateCode: '24' }));
    expect(errorOf(state).code).toBe('GSTIN_STATE_MISMATCH');
    const none = await post(owner, '/customers', {
      name: 'No GSTIN',
      gstRegistrationType: 'REGULAR',
      city: 'Pune',
    });
    expect(errorOf(none).message).toBe('Enter the GSTIN for a Regular, Composition or SEZ party.');
  });

  it('a similar name in the same city is a WARN that needs "This is a different party"; it is audited', async () => {
    const a = await post(owner, '/customers', {
      ...body(),
      name: 'Sawant Engineering Works Pvt Ltd',
    });
    expect(a.status).toBe(200);
    await prisma.customerAddress.create({
      data: {
        customerId: dataOf<{ id: string }>(a).id,
        type: 'BILLING',
        line1: 'Plot 1',
        city: 'Pune',
        stateCode: '27',
      },
    });
    const warnBody = { ...body(), name: 'M/s. Sawant Engineering Works Private Limited' };
    const warn = await post(owner, '/parties/check-duplicates', {
      kind: 'CUSTOMER',
      name: warnBody.name,
      city: 'Pune',
    });
    expect(dataOf<{ level: string }[]>(warn).some((h) => h.level === 'WARN')).toBe(true);
  });

  it('a credit INCREASE waits for approval and leaves the limit unchanged; a DECREASE applies at once', async () => {
    const created = dataOf<{ id: string }>(
      await post(owner, '/customers', { ...body(), creditLimit: 100000 }),
    );
    const decrease = await post(owner, `/customers/${created.id}/credit-requests`, {
      newLimit: 50000,
      reason: 'Late payments last quarter',
    });
    expect(decrease.status).toBe(200);
    expect(
      (
        await prisma.customer.findUniqueOrThrow({ where: { id: created.id } })
      ).creditLimit?.toString(),
    ).toBe('50000');

    const up = await post(owner, `/customers/${created.id}/credit-requests`, {
      newLimit: 70000,
      reason: 'Order book has grown a lot',
    });
    expect(up.status, JSON.stringify(up.body)).toBe(202);
    expect(
      (
        await prisma.customer.findUniqueOrThrow({ where: { id: created.id } })
      ).creditLimit?.toString(),
    ).toBe('50000');
    const again = await post(owner, `/customers/${created.id}/credit-requests`, {
      newLimit: 80000,
      reason: 'Trying once more please',
    });
    expect(again.status).toBe(409);
    expect(errorOf(again).code).toBe('CREDIT_PENDING');
    expect(errorOf(again).message).toBe('A credit-limit change is already waiting for approval.');
    // the Sales manager approves it: only now does the limit change
    const cr = await prisma.customerCreditRequest.findFirstOrThrow({
      where: { customerId: created.id, status: 'PENDING' },
    });
    const ar = await prisma.approvalRequest.findFirstOrThrow({
      where: { docType: 'crm-customer360', docId: cr.id },
    });
    const ok = await request(app)
      .post(`${API}/approvals/requests/${ar.id}/approve`)
      .set(salesMgr.bearer)
      .set('If-Match', String(ar.version))
      .send({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(
      (
        await prisma.customer.findUniqueOrThrow({ where: { id: created.id } })
      ).creditLimit?.toString(),
    ).toBe('50000');
    const ar2 = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: ar.id } });
    const ok2 = await request(app)
      .post(`${API}/approvals/requests/${ar.id}/approve`)
      .set(salesHead.bearer)
      .set('If-Match', String(ar2.version))
      .send({});
    expect(ok2.status, JSON.stringify(ok2.body)).toBe(200);
    expect(
      (
        await prisma.customer.findUniqueOrThrow({ where: { id: created.id } })
      ).creditLimit?.toString(),
    ).toBe('70000');
  });
});

describe('suppliers', () => {
  const body = (extra: Record<string, unknown> = {}) => {
    const pan = uniquePan();
    return {
      name: `Test Supplier ${n}`,
      gstRegistrationType: 'REGULAR',
      gstin: gstinFor('27', pan),
      city: 'Pune',
      ...extra,
    };
  };

  it('a new supplier is PENDING, cannot be used until approved, and the approval engine approves it', async () => {
    const created = dataOf<{ id: string; code: string; approvalStatus: string }>(
      await post(owner, '/suppliers', body({ supplierType: 'CONTRACTOR' })),
    );
    expect(created.code).toMatch(/^SUP\/\d{5}$/);
    expect(created.approvalStatus).toBe('PENDING');
    await expect(partyService.assertSupplierUsable(created.id)).rejects.toMatchObject({
      code: 'SUPPLIER_NOT_APPROVED',
      message: `Supplier ${created.code} is not approved yet.`,
    });
    const submitted = await post(owner, `/suppliers/${created.id}/submit`, {});
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    const reqRow = await prisma.approvalRequest.findFirstOrThrow({
      where: { docType: 'scm-suppliers', docId: created.id },
    });
    const approve = await request(app)
      .post(`${API}/approvals/requests/${reqRow.id}/approve`)
      .set(mgr.bearer)
      .set('If-Match', String(reqRow.version))
      .send({});
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);
    await partyService.assertSupplierUsable(created.id);
    expect(
      (await prisma.supplier.findUniqueOrThrow({ where: { id: created.id } })).approvalStatus,
    ).toBe('APPROVED');
  });

  it('MSME: Udyam format and 1-45 agreed days; the 45-day flag follows category and activity', async () => {
    const badUdyam = await post(
      owner,
      '/suppliers',
      body({ msmeUdyamNo: 'UDYAM-MH-26-123', msmeCategory: 'MICRO' }),
    );
    expect(errorOf(badUdyam).message).toBe('Udyam number looks like UDYAM-MH-26-0012345.');
    const ok = dataOf<{ id: string }>(
      await post(
        owner,
        '/suppliers',
        body({
          msmeUdyamNo: 'UDYAM-MH-26-0012345',
          msmeCategory: 'SMALL',
          msmeActivity: 'MANUFACTURING',
          msmeAgreedDays: 30,
        }),
      ),
    );
    const row = await prisma.supplier.findUniqueOrThrow({ where: { id: ok.id } });
    expect(row.msme45dayApplies).toBe(true);
    const trader = dataOf<{ id: string }>(
      await post(
        owner,
        '/suppliers',
        body({
          msmeUdyamNo: 'UDYAM-MH-26-0012346',
          msmeCategory: 'MICRO',
          msmeActivity: 'TRADING',
        }),
      ),
    );
    expect(
      (await prisma.supplier.findUniqueOrThrow({ where: { id: trader.id } })).msme45dayApplies,
    ).toBe(false);
  });

  it('bank account: typed twice, only the last 4 shown, a second person verifies, the database refuses self-verification', async () => {
    const s = dataOf<{ id: string }>(await post(owner, '/suppliers', body()));
    const mismatch = await post(owner, `/suppliers/${s.id}/bank-accounts`, {
      ifsc: 'HDFC0001234',
      holderName: 'Test',
      accountNo: '123456789012',
      accountNoConfirm: '123456789013',
    });
    expect(errorOf(mismatch).message).toBe('The two account numbers do not match.');
    const badIfsc = await post(owner, `/suppliers/${s.id}/bank-accounts`, {
      ifsc: 'HDFC1001234',
      holderName: 'Test',
      accountNo: '123456789012',
      accountNoConfirm: '123456789012',
    });
    expect(errorOf(badIfsc).message).toBe(
      'IFSC is 11 characters: 4 letters, 0, then 6 letters/digits.',
    );
    const added = await post(owner, `/suppliers/${s.id}/bank-accounts`, {
      ifsc: 'HDFC0001234',
      holderName: 'Test Holder',
      accountNo: '123456789012',
      accountNoConfirm: '123456789012',
    });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const acct = dataOf<{ id: string; accountNo: string; verified: boolean }>(added);
    expect(acct.accountNo).toBe('XXXXXX9012');
    expect(acct.verified).toBe(false);
    const stored = await prisma.supplierBankAccount.findUniqueOrThrow({ where: { id: acct.id } });
    expect(stored.accountNoEnc).not.toContain('123456789012');
    expect(stored.accountHash).toMatch(/^[0-9a-f]{64}$/);
    const self = await post(owner, `/suppliers/${s.id}/bank-accounts/${acct.id}/verify`, {});
    expect(self.status).toBe(403);
    expect(errorOf(self).message).toBe('Another user must verify a bank account you changed.');
    await expect(
      prisma.supplierBankAccount.update({
        where: { id: acct.id },
        data: { verifiedById: owner.user.id },
      }),
    ).rejects.toThrow();
    // a second person may verify (the Purchase manager needs "approve" on the page)
    const second = await post(mgr, `/suppliers/${s.id}/bank-accounts/${acct.id}/verify`, {});
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    // the same account on another supplier is a BLOCK for users without approve
    const other = dataOf<{ id: string }>(await post(owner, '/suppliers', body()));
    const same = {
      ifsc: 'HDFC0001234',
      holderName: 'Other',
      accountNo: '123456789012',
      accountNoConfirm: '123456789012',
    };
    const clash = await post(emp, `/suppliers/${other.id}/bank-accounts`, same);
    expect(clash.status).toBe(409);
    expect(errorOf(clash).code).toBe('BANK_DUPLICATE');
    expect(errorOf(clash).message).toMatch(
      /^This bank account belongs to supplier SUP\/\d{5}\. Ask an approver\.$/,
    );
    // a user with "approve" may override (it is then only a warning)
    expect((await post(mgr, `/suppliers/${other.id}/bank-accounts`, same)).status).toBe(201);
  });
});

describe('dated GST rates and HSN', () => {
  it('rate on 21-09-2025 is 18 % (old) and on 22-09-2025 is the new slab; overlapping rows are refused', async () => {
    const owner0 = await prisma.user.findFirstOrThrow({ where: { loginId: 'owner' } });
    const hsn = await prisma.hsnSacCode.create({
      data: { code: '99940001', description: 'Test HSN for rate history' },
    });
    const old = await prisma.gstRate.findUniqueOrThrow({ where: { code: 'GST12_OLD' } });
    const fresh = await prisma.gstRate.findUniqueOrThrow({ where: { code: 'GST5' } });
    await taxService.addHsnRate(
      hsn.id,
      { gstRateId: old.id, effectiveFrom: '2017-07-01' },
      owner0.id,
    );
    await taxService.addHsnRate(
      hsn.id,
      { gstRateId: fresh.id, effectiveFrom: '2025-09-22' },
      owner0.id,
    );
    // adding the new row ended the open one the day before
    const rows = await prisma.hsnSacRate.findMany({
      where: { hsnId: hsn.id },
      orderBy: { effectiveFrom: 'asc' },
    });
    expect(rows[0]?.effectiveTo?.toISOString().slice(0, 10)).toBe('2025-09-21');
    const item = await makeItem();
    await prisma.item.update({ where: { id: item.id }, data: { hsnId: hsn.id } });
    const before = await taxService.rateFor(item.id, '2025-09-21');
    const after = await taxService.rateFor(item.id, '2025-09-22');
    expect(before[0]?.igstPct).toBe('12');
    expect(after[0]?.igstPct).toBe('5');
    await expect(
      taxService.addHsnRate(
        hsn.id,
        { gstRateId: fresh.id, effectiveFrom: '2025-09-01', effectiveTo: '2025-09-30' },
        owner0.id,
      ),
    ).rejects.toMatchObject({ code: 'RATE_OVERLAP' });
    // the NOT VALID check on items refuses an item without an HSN even by direct SQL
    await expect(
      prisma.item.update({ where: { id: item.id }, data: { hsnId: null } }),
    ).rejects.toThrow();
  });
});

describe('pricing lookup', () => {
  it('uses the customer list over the company default, picks the right slab, converts Box = 12 Nos and falls back to the item price', async () => {
    const owner0 = await prisma.user.findFirstOrThrow({ where: { loginId: 'owner' } });
    const item = await makeItem('99950002');
    await prisma.item.update({ where: { id: item.id }, data: { sellingPrice: 55 } });
    await prisma.itemUomConversion.upsert({
      where: { itemId_uomCode: { itemId: item.id, uomCode: 'BOX' } },
      create: { itemId: item.id, uomCode: 'BOX', factor: 12 },
      update: { factor: 12 },
    });
    const customer = dataOf<{ id: string }>(
      await post(owner, '/customers', {
        name: 'Price Test',
        gstRegistrationType: 'REGULAR',
        gstin: gstinFor('27', uniquePan()),
      }),
    );
    const list = await prisma.priceList.create({
      data: {
        code: `PL-${Date.now()}`,
        name: 'Customer list',
        kind: 'SELLING',
        customerId: customer.id,
        createdById: owner0.id,
      },
    });
    await prisma.priceListItem.createMany({
      data: [
        { priceListId: list.id, itemId: item.id, uomCode: item.baseUom, minQty: 0, rate: 100 },
        {
          priceListId: list.id,
          itemId: item.id,
          uomCode: item.baseUom,
          minQty: 100,
          rate: 90,
          discountPct: 10,
        },
        { priceListId: list.id, itemId: item.id, uomCode: item.baseUom, minQty: 500, rate: 80 },
      ],
    });
    const q = (qty: number, uom?: string) =>
      get(
        owner,
        `/pricing/lookup?customerId=${customer.id}&itemId=${item.id}&qty=${qty}&date=2026-11-06${uom ? `&uom=${uom}` : ''}`,
      ).then((r) => dataOf<{ rate: string; net: string; source: string; priceListId: string }>(r));
    expect((await q(99)).rate).toBe('100');
    const s100 = await q(100);
    expect(s100.rate).toBe('90');
    expect(s100.net).toBe('81');
    expect(s100.source).toBe('CUSTOMER_LIST');
    expect((await q(1000)).rate).toBe('80');
    // 10 BOX = 120 base units -> the 100 slab
    expect((await q(10, 'BOX')).rate).toBe('90');
    // an unknown customer falls back to the item default
    const other = await get(owner, `/pricing/lookup?itemId=${item.id}&qty=1&date=2026-11-06`).then(
      (r) => dataOf<{ source: string; rate: string }>(r),
    );
    expect(other).toMatchObject({ source: 'ITEM_DEFAULT', rate: '55' });
  });
});

describe('item master and HSN', () => {
  const itemBody = (extra: Record<string, unknown> = {}) => ({
    itemName: `HSN test ${Date.now()}`,
    itemType: 'Consumable',
    baseUom: 'Nos',
    ...extra,
  });
  const create = (body: Record<string, unknown>) =>
    post(owner, '/pages/inv-items/records', { data: body });

  it('an item without an HSN is refused; short or unknown HSN too; a known 6-digit HSN works', async () => {
    const none = await create(itemBody());
    expect(none.status).toBe(422);
    expect(errorOf(none).code).toBe('HSN_REQUIRED');
    expect(errorOf(none).message).toBe('Choose the HSN/SAC code for this item.');
    await prisma.hsnSacCode.upsert({
      where: { code: '8480' },
      create: { code: '8480', description: 'Four digit test' },
      update: {},
    });
    const short = await create(itemBody({ hsnSac: '8480' }));
    expect(errorOf(short).code).toBe('HSN_DIGITS');
    expect(errorOf(short).message).toBe('Use at least 6 digits of HSN (your turnover rule).');
    const unknown = await create(itemBody({ hsnSac: '999999' }));
    expect(errorOf(unknown).code).toBe('HSN_REQUIRED');
    const ok = await create(itemBody({ hsnSac: '847130' }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const row = await prisma.item.findFirstOrThrow({
      where: { id: dataOf<{ id: string }>(ok).id },
    });
    expect(row.hsnId).not.toBeNull();
  });
});

describe('item data migration (docs/phases/PHASE-06.md §4.6)', () => {
  it('creates HSN rows and item groups from legacy items and copies the alternate UOM; the constraint stays NOT VALID', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const sql = fs
      .readFileSync(
        path.join(
          __dirname,
          '../prisma/migrations/20261112060000_phase06_item_data_migration/migration.sql',
        ),
        'utf8',
      )
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .split(/;\s*\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    const owner0 = await prisma.user.findFirstOrThrow({ where: { loginId: 'owner' } });
    class Rollback extends Error {}
    const rolledBack = new Rollback('rollback');
    await expect(
      prisma.$transaction(async (tx) => {
        // Legacy rows have no hsn_id: lift the check inside this transaction only (it is rolled back).
        await tx.$executeRawUnsafe('ALTER TABLE "items" DROP CONSTRAINT "items_hsn_required"');
        const mk = (code: string, extra: Record<string, unknown>) =>
          tx.item.create({
            data: {
              code,
              name: code,
              itemType: 'Raw Material',
              baseUom: 'Nos',
              createdById: owner0.id,
              ...extra,
            },
          });
        const a = await mk('LEG-A', {
          hsnSac: '730890',
          category: 'Steel Plates',
          altUom: 'Box',
          altUomFactor: 12,
        });
        const b = await mk('LEG-B', { hsnSac: '730890', category: 'steel  plates' });
        const c = await mk('LEG-C', {});
        for (const stmt of sql) await tx.$executeRawUnsafe(stmt);
        const [ra, rb, rc] = await Promise.all(
          [a, b, c].map((i) => tx.item.findUniqueOrThrow({ where: { id: i.id } })),
        );
        expect(ra?.hsnId).not.toBeNull();
        expect(ra?.hsnId).toBe(rb?.hsnId);
        expect(rc?.hsnId).toBeNull(); // no HSN stays visible in the "Missing HSN" filter
        const hsn = await tx.hsnSacCode.findUniqueOrThrow({ where: { code: '730890' } });
        expect(hsn.needsReview).toBe(true);
        expect(hsn.description).toContain('Imported from item master');
        expect(ra?.itemGroupId).not.toBeNull();
        expect(ra?.itemGroupId).toBe(rb?.itemGroupId);
        expect(
          await tx.itemUomConversion.findFirst({ where: { itemId: a.id, uomCode: 'Box' } }),
        ).toMatchObject({ factor: expect.anything() as never });
        throw rolledBack;
      }),
    ).rejects.toBe(rolledBack);
    // the constraint is back (rolled back) and still NOT VALID
    const rows = await prisma.$queryRaw<
      { convalidated: boolean }[]
    >`SELECT convalidated FROM pg_constraint WHERE conname = 'items_hsn_required'`;
    expect(rows[0]?.convalidated).toBe(false);
  });
});
