// Phase 07 integration (docs/phases/PHASE-07.md; STANDARDS §11): chart of accounts, dimensions, journals
// (draft -> submit -> post -> reverse, approval above the owner's threshold), the immutable ledger and its
// triggers, per-unit balance, sub-ledger, cash & bank, budgets, reports, period close and year-end, bank
// reconciliation, event posting. Every endpoint: 401, 403, 404, 422, happy path, illegal transition, audit row.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { PostingService } from '../src/modules/finance/posting-service';
import { openItemService } from '../src/modules/finance/open-items-service';
import { prisma as db } from '../src/core/db/prisma';
import { API, errorOf, makeUser, newApp, prisma, signIn, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { makeUnit } from './phase3-helpers';
import { dataOf as rawDataOf } from './phase4-helpers';

/** like dataOf, but a missing body.data fails with the whole response (status + error) */
function dataOf<T>(res: request.Response): T {
  if ((res.body as { data?: unknown } | undefined)?.data === undefined)
    throw new Error(`No data in the response: ${res.status} ${JSON.stringify(res.body)}`);
  return rawDataOf<T>(res);
}

const app = newApp();
let owner: Signed;
let emp: Signed;
let maker: Signed;
let checker: Signed;
let seq = 0;
const today = new Date().toISOString().slice(0, 10);
const rid = () => `${Date.now().toString(36)}${(seq += 1).toString(36)}`.toUpperCase();

type M = 'get' | 'post' | 'patch' | 'put' | 'delete';
function call(
  s: Signed | null,
  method: M,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  let r = request(app)[method](`${API}${path}`);
  if (s) r = r.set(s.bearer);
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return body === undefined ? r : r.send(body as object);
}
const U = (unitId: string) => ({ 'X-Unit-Id': unitId });
const IM = (version: number) => ({ 'If-Match': `"${version}"` });

const codeCache = new Map<string, string>();
async function acc(code: string): Promise<string> {
  const hit = codeCache.get(code);
  if (hit) return hit;
  const a = await prisma.account.findUniqueOrThrow({ where: { code } });
  codeCache.set(code, a.id);
  return a.id;
}
const line = async (
  code: string,
  debit: string,
  credit: string,
  extra: Record<string, unknown> = {},
) => ({
  accountId: await acc(code),
  debit,
  credit,
  ...extra,
});

/** A fresh unit with its own cost centre, so report numbers are exact. */
async function freshUnit() {
  const unit = await makeUnit();
  const cc = await prisma.costCenter.create({
    data: { code: `T${rid()}`.slice(0, 20), name: 'Test cost centre', unitId: unit.id },
  });
  return { unit, cc };
}

async function mkSupplier(name = `Supplier ${rid()}`) {
  return prisma.supplier.create({
    data: {
      code: `S${rid()}`,
      name,
      nameKey: `${name}-${rid()}`.toLowerCase(),
      stateCode: '27',
      gstRegistrationType: 'UNREGISTERED',
      approvalStatus: 'APPROVED',
    },
  });
}
async function mkCustomer(name = `Customer ${rid()}`) {
  return prisma.customer.create({
    data: {
      code: `C${rid()}`,
      name,
      nameKey: `${name}-${rid()}`.toLowerCase(),
      stateCode: '27',
      gstRegistrationType: 'UNREGISTERED',
      approvalStatus: 'APPROVED',
    },
  });
}

async function draft(
  s: Signed,
  unitId: string,
  lines: unknown[],
  extra: Record<string, unknown> = {},
) {
  const res = await call(s, 'post', '/finance/journals', {
    unitId,
    docDate: today,
    voucherType: 'Journal',
    narration: 'test',
    lines,
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return dataOf<{ id: string; version: number; code: string }>(res);
}
async function postJournal(
  s: Signed,
  unitId: string,
  lines: unknown[],
  extra: Record<string, unknown> = {},
) {
  const d = await draft(s, unitId, lines, extra);
  const sub = await call(s, 'post', `/finance/journals/${d.id}/submit`, undefined, {
    ...IM(d.version),
    ...U(unitId),
  });
  expect(sub.status, JSON.stringify(sub.body)).toBe(200);
  const v = dataOf<{ version: number }>(sub).version;
  const post = await call(
    s,
    'post',
    `/finance/journals/${d.id}/post`,
    {},
    { ...IM(v), ...U(unitId) },
  );
  expect(post.status, JSON.stringify(post.body)).toBe(200);
  return dataOf<{
    id: string;
    code: string;
    version: number;
    glEntryIds: string[];
    openItemIds: string[];
  }>(post);
}
const tb = async (unitId: string) =>
  dataOf<{
    balanced: boolean;
    totalDebit: string;
    totalCredit: string;
    lines: {
      code: string;
      debit: string;
      credit: string;
      closingDebit: string;
      closingCredit: string;
    }[];
  }>(
    await call(owner, 'get', `/finance/reports/trial-balance?asOf=${today}`, undefined, U(unitId)),
  );

beforeAll(async () => {
  owner = await signInOwner(app);
  emp = await signIn(app, await makeUser({ role: 'EMPLOYEE', department: 'Purchase' }));
  maker = await signIn(
    app,
    await makeUser({ role: 'DEPT_MANAGER', department: 'Finance', approvalLimit: 1_000_000 }),
  );
  checker = await signIn(
    app,
    await makeUser({ role: 'DEPT_MANAGER', department: 'Finance', approvalLimit: 1_000_000 }),
  );
  invalidateAccessCache();
});
afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: { startsWith: 'fin.' } } });
  await prisma.$disconnect();
});

// ===========================================================================================================
describe('M1/M2 schema: seed and database guards', () => {
  it('seeds the chart of accounts, the defaults, 3 unit cost-centre groups, profit centres and 22 voucher types', async () => {
    expect(await prisma.account.count()).toBeGreaterThanOrEqual(200);
    for (const k of [
      'INVENTORY_RM',
      'INVENTORY_WIP',
      'INVENTORY_FG',
      'STOCK_IN_TRANSIT',
      'STOCK_ADJUSTMENT',
      'CONSUMPTION_EXPENSE',
      'OPENING_BALANCE_EQUITY',
      'RETAINED_EARNINGS',
      'DEFAULT_BANK',
    ]) {
      expect(await prisma.accountDefault.findUnique({ where: { key: k } }), k).not.toBeNull();
    }
    const transit = await prisma.account.findUniqueOrThrow({ where: { code: '1309' } });
    expect(transit.name).toBe('Materials in Transit');
    expect(await prisma.voucherType.count()).toBe(22);
    expect(
      await prisma.costCenter.count({
        where: { code: { in: ['HO', 'TAL', 'SAW', 'VAR', 'TAL-PROD', 'HO-FIN'] } },
      }),
    ).toBe(6);
    expect(
      await prisma.profitCenter.count({
        where: { code: { in: ['PC-TAL', 'PC-SAW', 'PC-VAR'] }, isDefault: true },
      }),
    ).toBe(3);
  });

  it('every account obeys the structural CHECKs (group never postable, party needs a side)', async () => {
    const groupPostable = await prisma.account.count({
      where: { isGroup: true, postingAllowed: true },
    });
    expect(groupPostable).toBe(0);
    const partyNoSide = await prisma.account.count({
      where: { partyRequired: true, controlSide: null },
    });
    expect(partyNoSide).toBe(0);
    await expect(
      prisma.$executeRawUnsafe(`UPDATE accounts SET normal_balance = 'Credit' WHERE code = '1101'`),
    ).rejects.toThrow();
  });

  it('gl_entries and allocations are append-only (UPDATE and DELETE are refused by the database)', async () => {
    const { unit, cc } = await freshUnit();
    const p = await postJournal(owner, unit.id, [
      await line('6201', '100.00', '0.00', { costCenterId: cc.id }),
      await line('1111', '0.00', '100.00'),
    ]);
    await expect(
      prisma.$executeRawUnsafe(`UPDATE gl_entries SET debit = 1 WHERE id = '${p.glEntryIds[0]}'`),
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM gl_entries WHERE id = '${p.glEntryIds[0]}'`),
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.$executeRawUnsafe(`UPDATE journals SET narration = 'edited' WHERE id = '${p.id}'`),
    ).rejects.toThrow(/immutable/);
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM journals WHERE id = '${p.id}'`),
    ).rejects.toThrow(/cannot be deleted/);
    await expect(
      prisma.$executeRawUnsafe(`UPDATE journal_lines SET debit = 5 WHERE journal_id = '${p.id}'`),
    ).rejects.toThrow(/cannot be changed/);
  });

  it('the database refuses an unbalanced ledger at COMMIT, per unit (safety net behind the service)', async () => {
    const { unit, cc } = await freshUnit();
    const other = await makeUnit();
    const j = await draft(owner, unit.id, [
      await line('6201', '50.00', '0.00', { costCenterId: cc.id }),
      await line('1111', '0.00', '50.00'),
    ]);
    const lines = await prisma.journalLine.findMany({
      where: { journalId: j.id },
      orderBy: { lineNo: 'asc' },
    });
    const fy = await prisma.financialYear.findFirstOrThrow({ where: { isCurrent: true } });
    const period = await prisma.financialYearPeriod.findFirstOrThrow({
      where: {
        fyId: fy.id,
        startDate: { lte: new Date(`${today}T00:00:00Z`) },
        endDate: { gte: new Date(`${today}T00:00:00Z`) },
      },
    });
    const me = await prisma.user.findFirstOrThrow({ where: { loginId: 'owner' } });
    const write = (unitId: string, lineIdx: number, debit: number, credit: number) =>
      prisma.glEntry.create({
        data: {
          unitId,
          journalId: j.id,
          journalLineId: (lines[lineIdx] as { id: string }).id,
          postingDate: new Date(`${today}T00:00:00Z`),
          fyId: fy.id,
          periodId: period.id,
          accountId: (lines[lineIdx] as { accountId: string }).accountId,
          debit,
          credit,
          voucherType: 'Journal',
          voucherNo: 'X',
          createdById: me.id,
        },
      });
    // balanced overall (50 = 50) but split across two units -> each unit is out
    await expect(
      prisma.$transaction(async (tx) => {
        void tx;
        await write(unit.id, 0, 50, 0);
        await write(other.id, 1, 0, 50);
        await prisma.$executeRawUnsafe(`SET CONSTRAINTS ALL IMMEDIATE`);
      }),
    ).rejects.toThrow();
    expect(await prisma.glEntry.count({ where: { journalId: j.id } })).toBe(0);
  });
});

// ===========================================================================================================
describe('chart of accounts', () => {
  it('401 without a token, 403 without permission', async () => {
    expect((await call(null, 'get', '/finance/accounts')).status).toBe(401);
    expect(
      (await call(emp, 'post', '/finance/accounts', { code: '9001', name: 'X', rootType: 'Asset' }))
        .status,
    ).toBe(403);
  });

  it('creates, rejects a duplicate code, a wrong parent type, a non-group parent; updates with If-Match; audit rows', async () => {
    const parent = await acc('1000');
    const code = String(70000 + (seq += 1));
    const ok = await call(owner, 'post', '/finance/accounts', {
      code,
      name: 'Test petty advances',
      parentId: parent,
      subType: 'Other',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const a = dataOf<{ id: string; version: number; rootType: string; normalBalance: string }>(ok);
    expect(a.rootType).toBe('Asset');
    expect(a.normalBalance).toBe('Debit');
    expect(
      (await call(owner, 'post', '/finance/accounts', { code, name: 'Again', parentId: parent }))
        .status,
    ).toBe(409);
    const mismatch = await call(owner, 'post', '/finance/accounts', {
      code: String(80000 + seq),
      name: 'Wrong',
      parentId: parent,
      rootType: 'Income',
    });
    expect(mismatch.status).toBe(422);
    expect(errorOf(mismatch).code).toBe('PARENT_TYPE_MISMATCH');
    const leafParent = await call(owner, 'post', '/finance/accounts', {
      code: String(81000 + seq),
      name: 'Under a leaf',
      parentId: await acc('1101'),
    });
    expect(leafParent.status).toBe(422);
    expect(
      (
        await call(owner, 'post', '/finance/accounts', {
          code: 'abc',
          name: 'Bad code',
          rootType: 'Asset',
        })
      ).status,
    ).toBe(422);

    const upd = await call(
      owner,
      'patch',
      `/finance/accounts/${a.id}`,
      { name: 'Renamed' },
      IM(a.version),
    );
    expect(upd.status).toBe(200);
    expect(
      (await call(owner, 'patch', `/finance/accounts/${a.id}`, { name: 'Stale' }, IM(a.version)))
        .status,
    ).toBe(409);
    expect(
      (await call(owner, 'patch', `/finance/accounts/${a.id}`, { name: 'No header' })).status,
    ).toBe(400);
    expect((await call(owner, 'get', `/finance/accounts/${a.id}`)).status).toBe(200);
    expect(
      (await call(owner, 'get', `/finance/accounts/00000000-0000-4000-8000-000000000000`)).status,
    ).toBe(404);
    const audit = await prisma.auditLog.findMany({ where: { targetId: a.id } });
    expect(audit.map((x) => x.action)).toEqual(
      expect.arrayContaining(['ACCOUNT_CREATED', 'ACCOUNT_UPDATED']),
    );
  });

  it('a system account cannot be deleted; an account with ledger rows cannot change its type; a child cannot be moved under itself', async () => {
    const sys = await call(owner, 'delete', `/finance/accounts/${await acc('1101')}`);
    expect(sys.status).toBe(409);
    const { unit, cc } = await freshUnit();
    await postJournal(owner, unit.id, [
      await line('6201', '10.00', '0.00', { costCenterId: cc.id }),
      await line('1101', '0.00', '10.00'),
    ]);
    const cash = await prisma.account.findUniqueOrThrow({ where: { code: '1101' } });
    const t = await call(
      owner,
      'patch',
      `/finance/accounts/${cash.id}`,
      { subType: 'Bank' },
      IM(cash.version),
    );
    expect(t.status).toBe(409);
    expect(errorOf(t).code).toBe('ACCOUNT_HAS_BALANCE');
    const g1 = dataOf<{ id: string; version: number }>(
      await call(owner, 'post', '/finance/accounts', {
        code: String(90000 + (seq += 1)),
        name: 'G1',
        parentId: await acc('1000'),
        isGroup: true,
      }),
    );
    const g2 = dataOf<{ id: string }>(
      await call(owner, 'post', '/finance/accounts', {
        code: String(91000 + seq),
        name: 'G2',
        parentId: g1.id,
        isGroup: true,
      }),
    );
    const cyc = await call(
      owner,
      'patch',
      `/finance/accounts/${g1.id}`,
      { parentId: g2.id },
      IM(g1.version),
    );
    expect(cyc.status).toBe(422);
    expect(errorOf(cyc).code).toBe('CYCLE');
    const del = await call(owner, 'delete', `/finance/accounts/${g2.id}`);
    expect(del.status).toBe(204);
  });

  it('account defaults can be listed and re-pointed to an active ledger account only', async () => {
    const list = dataOf<{ key: string }[]>(await call(owner, 'get', '/finance/account-defaults'));
    expect(list.map((d) => d.key)).toContain('AR_DOMESTIC');
    expect(
      (
        await call(owner, 'put', '/finance/account-defaults/AR_DOMESTIC', {
          accountId: await acc('1000'),
        })
      ).status,
    ).toBe(422);
    const ok = await call(owner, 'put', '/finance/account-defaults/AR_DOMESTIC', {
      accountId: await acc('1201'),
    });
    expect(ok.status).toBe(200);
  });
});

// ===========================================================================================================
describe('cost centres and profit centres', () => {
  it('CRUD with 401 / 403 / 404 / 422 / 409 and the cycle rule', async () => {
    expect((await call(null, 'get', '/finance/cost-centers')).status).toBe(401);
    expect(
      (await call(emp, 'post', '/finance/cost-centers', { code: 'XX1', name: 'No' })).status,
    ).toBe(403);
    const ho = await prisma.costCenter.findUniqueOrThrow({ where: { code: 'HO' } });
    const code = `T-${rid()}`.slice(0, 20);
    const created = await call(owner, 'post', '/finance/cost-centers', {
      code,
      name: 'Test CC',
      parentId: ho.id,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const cc = dataOf<{ id: string; version: number }>(created);
    expect(
      (await call(owner, 'post', '/finance/cost-centers', { code, name: 'Dup', parentId: ho.id }))
        .status,
    ).toBe(409);
    expect(
      (await call(owner, 'post', '/finance/cost-centers', { code: 'lower', name: 'Bad' })).status,
    ).toBe(422);
    const leaf = await call(owner, 'post', '/finance/cost-centers', {
      code: `L-${rid()}`.slice(0, 20),
      name: 'Under leaf',
      parentId: cc.id,
    });
    expect(leaf.status).toBe(422);
    const upd = await call(
      owner,
      'patch',
      `/finance/cost-centers/${cc.id}`,
      { name: 'Renamed CC' },
      IM(cc.version),
    );
    expect(upd.status).toBe(200);
    expect(
      (
        await call(
          owner,
          'patch',
          `/finance/cost-centers/${cc.id}`,
          { name: 'Stale' },
          IM(cc.version),
        )
      ).status,
    ).toBe(409);
    const hoV = (await prisma.costCenter.findUniqueOrThrow({ where: { code: 'HO' } })).version;
    const cyc = await call(
      owner,
      'patch',
      `/finance/cost-centers/${ho.id}`,
      { parentId: cc.id },
      IM(hoV),
    );
    expect(cyc.status).toBe(422);
    expect((await call(owner, 'delete', `/finance/cost-centers/${cc.id}`)).status).toBe(204);
    expect((await call(owner, 'delete', `/finance/cost-centers/${cc.id}`)).status).toBe(404);
  });

  it('a cost centre used by the ledger cannot be deleted (409 IN_USE)', async () => {
    const { unit, cc } = await freshUnit();
    await postJournal(owner, unit.id, [
      await line('6201', '10.00', '0.00', { costCenterId: cc.id }),
      await line('1111', '0.00', '10.00'),
    ]);
    const del = await call(owner, 'delete', `/finance/cost-centers/${cc.id}`);
    expect(del.status).toBe(409);
  });

  it('profit centres: one default per unit; the default cannot be deleted or deactivated', async () => {
    const unit = await makeUnit();
    const a = dataOf<{ id: string; isDefault: boolean; version: number }>(
      await call(owner, 'post', '/finance/profit-centers', {
        code: `PA${rid()}`.slice(0, 20),
        name: 'Centre A',
        unitId: unit.id,
      }),
    );
    expect(a.isDefault).toBe(true);
    const b = dataOf<{ id: string; isDefault: boolean; version: number }>(
      await call(owner, 'post', '/finance/profit-centers', {
        code: `PB${rid()}`.slice(0, 20),
        name: 'Centre B',
        unitId: unit.id,
      }),
    );
    expect(b.isDefault).toBe(false);
    const swap = await call(
      owner,
      'patch',
      `/finance/profit-centers/${b.id}`,
      { isDefault: true },
      IM(b.version),
    );
    expect(swap.status).toBe(200);
    expect((await prisma.profitCenter.findUniqueOrThrow({ where: { id: a.id } })).isDefault).toBe(
      false,
    );
    expect((await call(owner, 'delete', `/finance/profit-centers/${b.id}`)).status).toBe(409);
    expect((await call(owner, 'delete', `/finance/profit-centers/${a.id}`)).status).toBe(204);
    expect((await call(emp, 'get', '/finance/profit-centers')).status).toBeGreaterThanOrEqual(200);
  });
});

// ===========================================================================================================
describe('journals: draft -> submit -> post -> reverse', () => {
  it('401 / 403 / 404 / 422 on the journal endpoints', async () => {
    expect((await call(null, 'get', '/finance/journals')).status).toBe(401);
    expect((await call(emp, 'post', '/finance/journals', { unitId: 'x' })).status).toBe(403);
    expect(
      (await call(owner, 'get', '/finance/journals/00000000-0000-4000-8000-000000000000')).status,
    ).toBe(404);
    const { unit } = await freshUnit();
    expect(
      (
        await call(owner, 'post', '/finance/journals', {
          unitId: unit.id,
          docDate: today,
          lines: [],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call(owner, 'post', '/finance/journals', {
          unitId: unit.id,
          docDate: today,
          lines: [{ accountId: await acc('1101'), debit: '1.005', credit: '0' }],
        })
      ).status,
    ).toBe(422);
    const both = await call(owner, 'post', '/finance/journals', {
      unitId: unit.id,
      docDate: today,
      lines: [
        { accountId: await acc('1101'), debit: '5', credit: '5' },
        { accountId: await acc('1111'), debit: '0', credit: '5' },
      ],
    });
    expect(both.status).toBe(422);
  });

  it('the full life: a Draft may be unbalanced, submit refuses it, post numbers it JV/<UNIT>/<FY>/<n> only now', async () => {
    const { unit, cc } = await freshUnit();
    const d = await draft(owner, unit.id, [
      await line('6201', '5000.00', '0.00', { costCenterId: cc.id }),
      await line('1111', '0.00', '4999.99'),
    ]);
    expect(d.code.startsWith('DRAFT-')).toBe(true);
    const bad = await call(
      owner,
      'post',
      `/finance/journals/${d.id}/submit`,
      undefined,
      IM(d.version),
    );
    expect(bad.status).toBe(422);
    expect(errorOf(bad).code).toBe('JOURNAL_UNBALANCED');
    expect(errorOf(bad).fields).toMatchObject({ difference: '0.01' });
    const fixed = await call(
      owner,
      'patch',
      `/finance/journals/${d.id}`,
      {
        lines: [
          await line('6201', '5000.00', '0.00', { costCenterId: cc.id }),
          await line('1111', '0.00', '5000.00'),
        ],
      },
      IM(d.version),
    );
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);
    const v1 = dataOf<{ version: number }>(fixed).version;
    const sub = await call(owner, 'post', `/finance/journals/${d.id}/submit`, undefined, {
      ...IM(v1),
      ...U(unit.id),
    });
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(dataOf<{ needsApproval: boolean }>(sub).needsApproval).toBe(false);
    const post = await call(
      owner,
      'post',
      `/finance/journals/${d.id}/post`,
      {},
      { ...IM(dataOf<{ version: number }>(sub).version), ...U(unit.id) },
    );
    expect(post.status, JSON.stringify(post.body)).toBe(200);
    const posted = dataOf<{ code: string; totalDebit: string; glEntryIds: string[] }>(post);
    expect(posted.code).toMatch(new RegExp(`^JV/${unit.code}/\\d{2}-\\d{2}/0001$`));
    expect(posted.totalDebit).toBe('5000.00');
    expect(posted.glEntryIds).toHaveLength(2);
    // the posted journal can no longer be edited or deleted
    const g = dataOf<{ version: number; status: string }>(
      await call(owner, 'get', `/finance/journals/${d.id}`, undefined, U(unit.id)),
    );
    expect(g.status).toBe('Posted');
    expect(
      (
        await call(
          owner,
          'patch',
          `/finance/journals/${d.id}`,
          { narration: 'late edit' },
          IM(g.version),
        )
      ).status,
    ).toBe(409);
    expect((await call(owner, 'delete', `/finance/journals/${d.id}`)).status).toBe(409);
    expect(
      (await call(owner, 'post', `/finance/journals/${d.id}/post`, {}, IM(g.version))).status,
    ).toBe(409);
    const audit = await prisma.auditLog.findMany({ where: { targetId: d.id } });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'JOURNAL_CREATED',
        'JOURNAL_UPDATED',
        'JOURNAL_SUBMITTED',
        'JOURNAL_POSTED',
      ]),
    );
    // numbers are gap-free: the failed submit above did not burn one
    const next = await postJournal(owner, unit.id, [
      await line('6201', '1.00', '0.00', { costCenterId: cc.id }),
      await line('1111', '0.00', '1.00'),
    ]);
    expect(next.code.endsWith('/0002')).toBe(true);
  });

  it('a Draft can be soft-deleted; a missing account, a group account and a missing cost centre are 422', async () => {
    const { unit, cc } = await freshUnit();
    const d = await draft(owner, unit.id, [
      await line('6201', '9.00', '0.00', { costCenterId: cc.id }),
      await line('1111', '0.00', '9.00'),
    ]);
    expect((await call(owner, 'delete', `/finance/journals/${d.id}`)).status).toBe(204);
    expect((await call(owner, 'get', `/finance/journals/${d.id}`)).status).toBe(404);
    const grp = await draft(owner, unit.id, [
      await line('1100', '9.00', '0.00'),
      await line('1111', '0.00', '9.00'),
    ]);
    const s1 = await call(
      owner,
      'post',
      `/finance/journals/${grp.id}/submit`,
      undefined,
      IM(grp.version),
    );
    expect(errorOf(s1).code).toBe('ACCOUNT_NOT_POSTABLE');
    const noCc = await draft(owner, unit.id, [
      await line('6201', '9.00', '0.00'),
      await line('1111', '0.00', '9.00'),
    ]);
    const s2 = await call(
      owner,
      'post',
      `/finance/journals/${noCc.id}/submit`,
      undefined,
      IM(noCc.version),
    );
    expect(errorOf(s2).code).toBe('COST_CENTER_REQUIRED');
  });

  it('reverse: mirror journal, original Cancelled/Reversed, net zero; once only; a reversal cannot be reversed; reason 5-300', async () => {
    const { unit, cc } = await freshUnit();
    const p = await postJournal(owner, unit.id, [
      await line('6201', '10000.00', '0.00', { costCenterId: cc.id }),
      await line('1111', '0.00', '10000.00'),
    ]);
    expect(
      (await call(owner, 'post', `/finance/journals/${p.id}/reverse`, { reason: 'abc' })).status,
    ).toBe(422);
    expect(
      (await call(emp, 'post', `/finance/journals/${p.id}/reverse`, { reason: 'valid reason' }))
        .status,
    ).toBe(403);
    const rev = await call(owner, 'post', `/finance/journals/${p.id}/reverse`, {
      reason: 'Booked to the wrong account',
    });
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);
    const r = dataOf<{ id: string; code: string; totalDebit: string }>(rev);
    expect(r.totalDebit).toBe('10000.00');
    const orig = await prisma.journal.findUniqueOrThrow({ where: { id: p.id } });
    expect(orig.status).toBe('Cancelled');
    expect(orig.postingStatus).toBe('Reversed');
    expect(orig.reversedById).toBe(r.id);
    const net = await prisma.$queryRaw<
      { n: string }[]
    >`SELECT COALESCE(SUM(debit - credit),0)::text AS n FROM gl_entries WHERE journal_id IN (${p.id}::uuid, ${r.id}::uuid)`;
    expect(net[0]?.n).toBe('0.00');
    const rows = await prisma.glEntry.findMany({ where: { journalId: r.id } });
    expect(rows.every((x) => x.isReversal && x.reversesGlId !== null)).toBe(true);
    const again = await call(owner, 'post', `/finance/journals/${p.id}/reverse`, {
      reason: 'Second attempt here',
    });
    expect(again.status).toBe(409);
    expect(errorOf(again).code).toBe('ALREADY_REVERSED');
    const ofRev = await call(owner, 'post', `/finance/journals/${r.id}/reverse`, {
      reason: 'Reverse the reversal',
    });
    expect(ofRev.status).toBe(409);
    expect(errorOf(ofRev).code).toBe('CANNOT_REVERSE_REVERSAL');
    expect(
      await prisma.auditLog.count({ where: { action: 'JOURNAL_REVERSED', targetId: p.id } }),
    ).toBe(1);
  });

  it('a double click on Post posts once (two parallel requests: one wins, one is refused)', async () => {
    const { unit, cc } = await freshUnit();
    const d = await draft(owner, unit.id, [
      await line('6201', '77.00', '0.00', { costCenterId: cc.id }),
      await line('1111', '0.00', '77.00'),
    ]);
    const sub = dataOf<{ version: number }>(
      await call(owner, 'post', `/finance/journals/${d.id}/submit`, undefined, {
        ...IM(d.version),
        ...U(unit.id),
      }),
    );
    const results = await Promise.all(
      [0, 1, 2].map(() =>
        call(
          owner,
          'post',
          `/finance/journals/${d.id}/post`,
          {},
          { ...IM(sub.version), ...U(unit.id) },
        ),
      ),
    );
    const ok = results.filter((x) => x.status === 200);
    expect(ok).toHaveLength(1);
    expect(results.filter((x) => x.status === 409)).toHaveLength(2);
    expect(await prisma.glEntry.count({ where: { journalId: d.id } })).toBe(2);
  });

  it('the same Idempotency-Key replays the stored answer and posts nothing twice', async () => {
    const { unit, cc } = await freshUnit();
    const d = await draft(owner, unit.id, [
      await line('6201', '31.00', '0.00', { costCenterId: cc.id }),
      await line('1111', '0.00', '31.00'),
    ]);
    const sub = dataOf<{ version: number }>(
      await call(owner, 'post', `/finance/journals/${d.id}/submit`, undefined, {
        ...IM(d.version),
        ...U(unit.id),
      }),
    );
    const h = { ...IM(sub.version), ...U(unit.id), 'Idempotency-Key': `idem-${rid()}-aaaaaaaa` };
    const a = await call(owner, 'post', `/finance/journals/${d.id}/post`, {}, h);
    const b = await call(owner, 'post', `/finance/journals/${d.id}/post`, {}, h);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.headers['idempotent-replay']).toBe('true');
    expect(await prisma.glEntry.count({ where: { journalId: d.id } })).toBe(2);
  });

  it('the period gate: a closed financial year or period refuses posting (409 PERIOD_CLOSED)', async () => {
    const { unit, cc } = await freshUnit();
    const prev = await prisma.financialYear.findUniqueOrThrow({ where: { code: '2025-26' } });
    const period = await prisma.financialYearPeriod.findFirstOrThrow({
      where: { fyId: prev.id, periodNo: 1 },
    });
    await prisma.financialYearPeriod.update({
      where: { id: period.id },
      data: { status: 'CLOSED' },
    });
    try {
      const res = await call(owner, 'post', '/finance/journals', {
        unitId: unit.id,
        docDate: '2025-04-10',
        lines: [
          await line('6201', '5.00', '0.00', { costCenterId: cc.id }),
          await line('1111', '0.00', '5.00'),
        ],
      });
      const d = dataOf<{ id: string; version: number }>(res);
      const sub = await call(
        owner,
        'post',
        `/finance/journals/${d.id}/submit`,
        undefined,
        IM(d.version),
      );
      expect(sub.status).toBe(409);
      expect(errorOf(sub).code).toBe('PERIOD_CLOSED');
      const none = await call(owner, 'post', '/finance/journals', {
        unitId: unit.id,
        docDate: '2019-04-10',
        lines: [await line('1101', '5.00', '0.00'), await line('1111', '0.00', '5.00')],
      });
      expect(none.status).toBe(422);
      expect(errorOf(none).code).toBe('NO_PERIOD');
    } finally {
      await prisma.financialYearPeriod.update({
        where: { id: period.id },
        data: { status: 'OPEN' },
      });
    }
  });

  it('a journal dated far in the future is refused (FUTURE_DATE)', async () => {
    const { unit, cc } = await freshUnit();
    const d = await draft(
      owner,
      unit.id,
      [
        await line('6201', '5.00', '0.00', { costCenterId: cc.id }),
        await line('1111', '0.00', '5.00'),
      ],
      { docDate: '2027-03-30' },
    );
    const sub = await call(
      owner,
      'post',
      `/finance/journals/${d.id}/submit`,
      undefined,
      IM(d.version),
    );
    expect(sub.status).toBe(422);
    expect(errorOf(sub).code).toBe('FUTURE_DATE');
  });
});

// ===========================================================================================================
describe('balance per unit (owner rule)', () => {
  it('a journal that balances overall but not inside each unit is refused; adding due-to / due-from lines makes it post', async () => {
    const a = await freshUnit();
    const b = await freshUnit();
    const bad = await draft(owner, a.unit.id, [
      await line('6201', '100.00', '0.00', { costCenterId: a.cc.id }),
      await line('1111', '0.00', '100.00', { unitId: b.unit.id }),
    ]);
    const res = await call(
      owner,
      'post',
      `/finance/journals/${bad.id}/submit`,
      undefined,
      IM(bad.version),
    );
    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe('JOURNAL_UNBALANCED');
    expect(errorOf(res).message).toMatch(/Each unit must balance/);
    const ok = await postJournal(owner, a.unit.id, [
      await line('6201', '100.00', '0.00', { costCenterId: a.cc.id }),
      await line('2103', '0.00', '100.00'), // due to unit B (accrual account used as the clearing line) in A
      await line('1503', '100.00', '0.00', { unitId: b.unit.id }), // due from A in B
      await line('1111', '0.00', '100.00', { unitId: b.unit.id }),
    ]);
    expect(ok.glEntryIds).toHaveLength(4);
    const ta = await tb(a.unit.id);
    const tbb = await tb(b.unit.id);
    expect(ta.balanced).toBe(true);
    expect(tbb.balanced).toBe(true);
  });
});

// ===========================================================================================================
describe('sub-ledger: parties, bills, allocation', () => {
  it('a control account needs a party; the party must match the side; the bill number is required', async () => {
    const { unit } = await freshUnit();
    const cust = await mkCustomer();
    const sup = await mkSupplier();
    const noParty = await draft(owner, unit.id, [
      await line('1201', '100.00', '0.00'),
      await line('4101', '0.00', '100.00'),
    ]);
    expect(
      errorOf(
        await call(
          owner,
          'post',
          `/finance/journals/${noParty.id}/submit`,
          undefined,
          IM(noParty.version),
        ),
      ).code,
    ).toBe('PARTY_REQUIRED');
    const wrong = await draft(owner, unit.id, [
      await line('1201', '100.00', '0.00', {
        partyId: sup.id,
        billDocNo: 'B1',
        billDueDate: today,
      }),
      await line('4101', '0.00', '100.00'),
    ]);
    expect(
      errorOf(
        await call(
          owner,
          'post',
          `/finance/journals/${wrong.id}/submit`,
          undefined,
          IM(wrong.version),
        ),
      ).code,
    ).toBe('PARTY_ROLE_MISMATCH');
    const noBill = await draft(owner, unit.id, [
      await line('1201', '100.00', '0.00', { partyId: cust.id }),
      await line('4101', '0.00', '100.00'),
    ]);
    expect(
      errorOf(
        await call(
          owner,
          'post',
          `/finance/journals/${noBill.id}/submit`,
          undefined,
          IM(noBill.version),
        ),
      ).code,
    ).toBe('BILL_REF_REQUIRED');
    const notAllowed = await draft(owner, unit.id, [
      await line('1101', '100.00', '0.00', { partyId: cust.id }),
      await line('4101', '0.00', '100.00'),
    ]);
    expect(
      errorOf(
        await call(
          owner,
          'post',
          `/finance/journals/${notAllowed.id}/submit`,
          undefined,
          IM(notAllowed.version),
        ),
      ).code,
    ).toBe('PARTY_NOT_ALLOWED');
  });

  it('a posted invoice creates an open item; the sub-ledger agrees with the control account (BR-FIN-36); reversal cancels it', async () => {
    const { unit } = await freshUnit();
    const cust = await mkCustomer();
    const inv = `INV-${rid()}`;
    const p = await postJournal(owner, unit.id, [
      await line('1201', '40000.00', '0.00', {
        partyId: cust.id,
        billDocNo: inv,
        billDueDate: today,
      }),
      await line('4101', '0.00', '40000.00'),
    ]);
    expect(p.openItemIds).toHaveLength(1);
    const item = await prisma.openItem.findUniqueOrThrow({
      where: { id: p.openItemIds[0] as string },
    });
    expect(item.side).toBe('RECEIVABLE');
    expect(item.amount.toFixed(2)).toBe('40000.00');
    expect(item.outstanding?.toFixed(2)).toBe('40000.00');
    const agree = await openItemService.agreement(db, 'RECEIVABLE', cust.id);
    expect(agree).toEqual({ subLedger: '40000.00', ledger: '40000.00', agrees: true });
    const dup = await draft(owner, unit.id, [
      await line('1201', '1.00', '0.00', { partyId: cust.id, billDocNo: inv, billDueDate: today }),
      await line('4101', '0.00', '1.00'),
    ]);
    const dupSubmit = await call(owner, 'post', `/finance/journals/${dup.id}/submit`, undefined, {
      ...IM(dup.version),
      ...U(unit.id),
    });
    expect(dupSubmit.status).toBe(409); // the same bill number twice for one party is caught at submit
    const rev = await call(owner, 'post', `/finance/journals/${p.id}/reverse`, {
      reason: 'Invoice raised in error',
    });
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);
    expect((await prisma.openItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(
      'Cancelled',
    );
    expect((await openItemService.agreement(db, 'RECEIVABLE', cust.id)).agrees).toBe(true);
  });

  it('a settled bill blocks the reversal of its journal until the allocation is undone (409 SETTLED_DOCUMENT)', async () => {
    const { unit } = await freshUnit();
    const cust = await mkCustomer();
    const bill = await postJournal(owner, unit.id, [
      await line('1201', '1000.00', '0.00', {
        partyId: cust.id,
        billDocNo: `B-${rid()}`,
        billDueDate: today,
      }),
      await line('4101', '0.00', '1000.00'),
    ]);
    const credit = await postJournal(owner, unit.id, [
      await line('4107', '300.00', '0.00'),
      await line('1201', '0.00', '300.00', {
        partyId: cust.id,
        billDocNo: `CN-${rid()}`,
        billDueDate: today,
      }),
    ]);
    const src = await prisma.openItem.findUniqueOrThrow({
      where: { id: credit.openItemIds[0] as string },
    });
    expect(src.amount.toFixed(2)).toBe('-300.00');
    const me = await prisma.user.findFirstOrThrow({ where: { loginId: 'owner' } });
    const alloc = await prisma.$transaction((tx) =>
      openItemService.allocate(
        tx,
        {
          sourceItemId: src.id,
          targetItemId: bill.openItemIds[0] as string,
          amount: '300.00',
          date: today,
        },
        { userId: me.id },
      ),
    );
    const t = await prisma.openItem.findUniqueOrThrow({
      where: { id: bill.openItemIds[0] as string },
    });
    expect(t.outstanding?.toFixed(2)).toBe('700.00');
    // the party balance still agrees with the GL (an allocation moves no money)
    expect((await openItemService.agreement(db, 'RECEIVABLE', cust.id)).agrees).toBe(true);
    const blocked = await call(owner, 'post', `/finance/journals/${bill.id}/reverse`, {
      reason: 'Wrong customer billed',
    });
    expect(blocked.status).toBe(409);
    expect(errorOf(blocked).code).toBe('SETTLED_DOCUMENT');
    // over-allocation is refused
    await expect(
      prisma.$transaction((tx) =>
        openItemService.allocate(
          tx,
          {
            sourceItemId: src.id,
            targetItemId: bill.openItemIds[0] as string,
            amount: '1.00',
            date: today,
          },
          { userId: me.id },
        ),
      ),
    ).rejects.toMatchObject({ code: 'OVER_ALLOCATION' });
    await prisma.$transaction((tx) =>
      openItemService.reverseAllocation(tx, alloc.id, { userId: me.id }, today),
    );
    expect(
      (
        await prisma.openItem.findUniqueOrThrow({ where: { id: bill.openItemIds[0] as string } })
      ).outstanding?.toFixed(2),
    ).toBe('1000.00');
    await expect(
      prisma.$executeRawUnsafe(`UPDATE allocations SET amount = 1 WHERE id = '${alloc.id}'`),
    ).rejects.toThrow(/append-only/);
    const ok = await call(owner, 'post', `/finance/journals/${bill.id}/reverse`, {
      reason: 'Wrong customer billed',
    });
    expect(ok.status).toBe(200);
  });

  it('GET /open-items and the ageing report (side-specific permission, buckets by days past due)', async () => {
    const { unit } = await freshUnit();
    const cust = await mkCustomer('Ageing Customer');
    const old = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
    await postJournal(owner, unit.id, [
      await line('1201', '500.00', '0.00', {
        partyId: cust.id,
        billDocNo: `OLD-${rid()}`,
        billDueDate: old,
      }),
      await line('4101', '0.00', '500.00'),
    ]);
    await postJournal(owner, unit.id, [
      await line('1201', '250.00', '0.00', {
        partyId: cust.id,
        billDocNo: `NEW-${rid()}`,
        billDueDate: today,
      }),
      await line('4101', '0.00', '250.00'),
    ]);
    expect((await call(null, 'get', '/finance/open-items?side=RECEIVABLE')).status).toBe(401);
    expect(
      (await call(emp, 'get', '/finance/reports/ageing?side=RECEIVABLE')).status,
    ).toBeGreaterThanOrEqual(200);
    const list = await call(
      owner,
      'get',
      `/finance/open-items?side=RECEIVABLE&partyId=${cust.id}`,
      undefined,
      U(unit.id),
    );
    expect(list.status).toBe(200);
    expect((list.body as { meta: { total: number } }).meta.total).toBe(2);
    const ag = dataOf<{
      parties: { name: string; notDue: string; d31_60: string; total: string }[];
      total: { total: string };
    }>(
      await call(
        owner,
        'get',
        `/finance/reports/ageing?side=RECEIVABLE&asOf=${today}`,
        undefined,
        U(unit.id),
      ),
    );
    const row = ag.parties.find((p) => p.name === 'Ageing Customer');
    expect(row).toMatchObject({ notDue: '250.00', d31_60: '500.00', total: '750.00' });
    expect(ag.total.total).toBe('750.00');
    expect((await call(owner, 'get', '/finance/reports/ageing?side=BAD')).status).toBe(422);
  });
});

// ===========================================================================================================
describe('cash and bank', () => {
  /** A new ledger account of its own plus a cash / bank book on it, in the given unit. */
  async function bankFor(unitId: string, kind: 'BANK' | 'CASH' | 'PETTY' = 'BANK') {
    const code = String(40000 + (seq += 1));
    const a = await prisma.account.create({
      data: {
        code,
        name: `Test ${kind} ${code}`,
        parentId: await acc('1100'),
        rootType: 'Asset',
        normalBalance: 'Debit',
        subType: kind === 'BANK' ? 'Bank' : 'Cash',
        cfClass: 'CASH',
      },
    });
    const res = await call(owner, 'post', '/finance/bank-accounts', {
      unitId,
      accountId: a.id,
      kind,
      name: a.name,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const book = await prisma.bankAccount.findUniqueOrThrow({
      where: { id: dataOf<{ id: string }>(res).id },
    });
    return { ...book, ledgerId: a.id };
  }
  const fund = async (unitId: string, ledgerId: string, amount: string) =>
    postJournal(owner, unitId, [
      { accountId: ledgerId, debit: amount, credit: '0.00' },
      await line('3001', '0.00', amount),
    ]);

  it('bank accounts: 401, 403, 422 (wrong ledger type, bad IFSC), 409 (second book on the same ledger account)', async () => {
    const { unit } = await freshUnit();
    expect((await call(null, 'get', '/finance/bank-accounts')).status).toBe(401);
    expect((await call(emp, 'post', '/finance/bank-accounts', { unitId: unit.id })).status).toBe(
      403,
    );
    const bad = await call(owner, 'post', '/finance/bank-accounts', {
      unitId: unit.id,
      accountId: await acc('4101'),
      kind: 'BANK',
      name: 'Sales is not a bank',
    });
    expect(bad.status).toBe(422);
    const b0 = await bankFor(unit.id);
    expect(
      (
        await call(owner, 'post', '/finance/bank-accounts', {
          unitId: unit.id,
          accountId: await acc('1113'),
          kind: 'BANK',
          name: 'Bad IFSC',
          ifsc: 'xx',
        })
      ).status,
    ).toBe(422);
    const mismatch = await call(owner, 'post', '/finance/bank-accounts', {
      unitId: unit.id,
      accountId: await acc('1113'),
      kind: 'CASH',
      name: 'Kind mismatch',
    });
    expect(errorOf(mismatch).code).toBe('MODE_ACCOUNT_MISMATCH');
    const again = await call(owner, 'post', '/finance/bank-accounts', {
      unitId: unit.id,
      accountId: b0.ledgerId,
      kind: 'BANK',
      name: 'Twice',
    });
    expect(again.status).toBe(409);
    expect(
      (
        await call(
          owner,
          'patch',
          `/finance/bank-accounts/${b0.id}`,
          { name: 'ICICI main' },
          IM(b0.version),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          owner,
          'patch',
          `/finance/bank-accounts/${b0.id}`,
          { name: 'Stale' },
          IM(b0.version),
        )
      ).status,
    ).toBe(409);
    const list = dataOf<{ id: string }[]>(
      await call(owner, 'get', '/finance/bank-accounts', undefined, U(unit.id)),
    );
    expect(list.map((x) => x.id)).toContain(b0.id);
  });

  it('supplier payment: FIFO over the open bills, the payment is a credit item, cancel restores everything', async () => {
    const { unit, cc } = await freshUnit();
    const bank = await bankFor(unit.id);
    const sup = await mkSupplier('Pay Supplier');
    const mkBill = async (amount: string, due: string) =>
      postJournal(owner, unit.id, [
        await line('6201', amount, '0.00', { costCenterId: cc.id }),
        await line('2101', '0.00', amount, {
          partyId: sup.id,
          billDocNo: `PB-${rid()}`,
          billDueDate: due,
        }),
      ]);
    await fund(unit.id, bank.ledgerId, '100000.00');
    const b1 = await mkBill('40000.00', '2026-10-10');
    const b2 = await mkBill('60000.00', '2026-10-20');
    const pay = await call(
      owner,
      'post',
      '/finance/payments',
      {
        kind: 'PAYMENT',
        docDate: today,
        bankAccountId: bank.id,
        supplierId: sup.id,
        amount: '70000.00',
        mode: 'NEFT',
        referenceNo: 'UTR1',
      },
      U(unit.id),
    );
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
    const p = dataOf<{ id: string; code: string; version: number; status: string }>(pay);
    expect(p.code).toMatch(/^PAY\//);
    const i1 = await prisma.openItem.findUniqueOrThrow({
      where: { id: b1.openItemIds[0] as string },
    });
    const i2 = await prisma.openItem.findUniqueOrThrow({
      where: { id: b2.openItemIds[0] as string },
    });
    expect(i1.outstanding?.toFixed(2)).toBe('0.00');
    expect(i1.status).toBe('Settled');
    expect(i2.outstanding?.toFixed(2)).toBe('30000.00');
    expect((await openItemService.agreement(db, 'PAYABLE', sup.id)).agrees).toBe(true);
    const detail = dataOf<{ allocations: unknown[] }>(
      await call(owner, 'get', `/finance/payments/${p.id}`),
    );
    expect(detail.allocations).toHaveLength(2);
    const plist = await call(owner, 'get', `/finance/payments?kind=PAYMENT`, undefined, U(unit.id));
    expect((plist.body as { meta: { total: number } }).meta.total).toBe(1);
    // cancel: allocations undone, mirror journal, bills open again
    expect(
      (
        await call(
          emp,
          'post',
          `/finance/payments/${p.id}/cancel`,
          { reason: 'Wrong bank used' },
          IM(p.version),
        )
      ).status,
    ).toBe(403);
    const c = await call(
      owner,
      'post',
      `/finance/payments/${p.id}/cancel`,
      { reason: 'Wrong bank used' },
      IM(p.version),
    );
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(
      (
        await prisma.openItem.findUniqueOrThrow({ where: { id: b1.openItemIds[0] as string } })
      ).outstanding?.toFixed(2),
    ).toBe('40000.00');
    expect(
      (
        await prisma.openItem.findUniqueOrThrow({ where: { id: b2.openItemIds[0] as string } })
      ).outstanding?.toFixed(2),
    ).toBe('60000.00');
    expect((await openItemService.agreement(db, 'PAYABLE', sup.id)).agrees).toBe(true);
    const again = await call(
      owner,
      'post',
      `/finance/payments/${p.id}/cancel`,
      { reason: 'Second cancel' },
      IM(dataOf<{ version: number }>(c).version),
    );
    expect(again.status).toBe(409);
    expect(
      await prisma.auditLog.count({
        where: { targetId: p.id, action: { in: ['PAYMENT_POSTED', 'PAYMENT_CANCELLED'] } },
      }),
    ).toBe(2);
  });

  it('specific allocation, over-allocation, advance confirmation, blocked bills', async () => {
    const { unit, cc } = await freshUnit();
    const bank = await bankFor(unit.id);
    const sup = await mkSupplier();
    await fund(unit.id, bank.ledgerId, '50000.00');
    const bill = await postJournal(owner, unit.id, [
      await line('6201', '1000.00', '0.00', { costCenterId: cc.id }),
      await line('2101', '0.00', '1000.00', {
        partyId: sup.id,
        billDocNo: `SB-${rid()}`,
        billDueDate: today,
      }),
    ]);
    const itemId = bill.openItemIds[0] as string;
    const over = await call(
      owner,
      'post',
      '/finance/payments',
      {
        kind: 'PAYMENT',
        docDate: today,
        bankAccountId: bank.id,
        supplierId: sup.id,
        amount: '500.00',
        mode: 'UPI',
        allocations: [{ itemId, amount: '600.00' }],
      },
      U(unit.id),
    );
    expect(over.status).toBe(422);
    expect(errorOf(over).code).toBe('OVER_ALLOCATION');
    const blocked = await call(owner, 'post', `/finance/open-items/${itemId}/hold`, {
      status: 'Blocked',
      reason: 'Quality dispute',
    });
    expect(blocked.status).toBe(200);
    const stop = await call(
      owner,
      'post',
      '/finance/payments',
      {
        kind: 'PAYMENT',
        docDate: today,
        bankAccountId: bank.id,
        supplierId: sup.id,
        amount: '500.00',
        mode: 'UPI',
        allocations: [{ itemId, amount: '500.00' }],
      },
      U(unit.id),
    );
    expect(errorOf(stop).code).toBe('ITEM_BLOCKED');
    await call(owner, 'post', `/finance/open-items/${itemId}/hold`, { status: 'Open' });
    const part = await call(
      owner,
      'post',
      '/finance/payments',
      {
        kind: 'PAYMENT',
        docDate: today,
        bankAccountId: bank.id,
        supplierId: sup.id,
        amount: '500.00',
        mode: 'UPI',
        allocations: [{ itemId, amount: '500.00' }],
      },
      U(unit.id),
    );
    expect(part.status, JSON.stringify(part.body)).toBe(200);
    expect(
      (await prisma.openItem.findUniqueOrThrow({ where: { id: itemId } })).outstanding?.toFixed(2),
    ).toBe('500.00');
    const other = await mkSupplier();
    const noBills = await call(
      owner,
      'post',
      '/finance/payments',
      {
        kind: 'PAYMENT',
        docDate: today,
        bankAccountId: bank.id,
        supplierId: other.id,
        amount: '200.00',
        mode: 'NEFT',
      },
      U(unit.id),
    );
    expect(errorOf(noBills).code).toBe('ADVANCE_NOT_CONFIRMED');
    const adv = await call(
      owner,
      'post',
      '/finance/payments',
      {
        kind: 'PAYMENT',
        docDate: today,
        bankAccountId: bank.id,
        supplierId: other.id,
        amount: '200.00',
        mode: 'NEFT',
        allowAdvance: true,
      },
      U(unit.id),
    );
    expect(adv.status, JSON.stringify(adv.body)).toBe(200);
    const advItem = await prisma.openItem.findFirstOrThrow({ where: { partyId: other.id } });
    expect(advItem.itemType).toBe('ADVANCE');
    expect(advItem.amount.toFixed(2)).toBe('-200.00');
    expect((await openItemService.agreement(db, 'PAYABLE', other.id)).agrees).toBe(true);
    expect(
      (
        await call(owner, 'post', '/finance/open-items/00000000-0000-4000-8000-000000000000/hold', {
          status: 'Blocked',
          reason: 'x',
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(owner, 'post', `/finance/open-items/${itemId}/hold`, { status: 'Blocked' }))
        .status,
    ).toBe(422);
  });

  it('cash rules: mode must fit the book; cash cannot go below zero; a cash receipt of 2,00,000 is blocked; transfers; the book runs a balance', async () => {
    const { unit } = await freshUnit();
    const bankBook = await bankFor(unit.id);
    const cashBook = await bankFor(unit.id, 'PETTY');
    const cashFor = (kind: string, amount: string, extra: Record<string, unknown> = {}) =>
      call(
        owner,
        'post',
        '/finance/payments',
        { kind, docDate: today, bankAccountId: cashBook.id, amount, mode: 'Cash', ...extra },
        U(unit.id),
      );
    const mm = await call(
      owner,
      'post',
      '/finance/payments',
      {
        kind: 'RECEIPT',
        docDate: today,
        bankAccountId: bankBook.id,
        counterAccountId: await acc('4206'),
        amount: '10.00',
        mode: 'Cash',
      },
      U(unit.id),
    );
    expect(errorOf(mm).code).toBe('MODE_ACCOUNT_MISMATCH');
    const neg = await cashFor('PAYMENT', '100.00', { counterAccountId: await acc('6202') });
    expect(neg.status).toBe(409);
    expect(errorOf(neg).code).toBe('NEGATIVE_CASH');
    const big = await cashFor('RECEIPT', '200000.00', { counterAccountId: await acc('4206') });
    expect(errorOf(big).code).toBe('CASH_RECEIPT_LIMIT');
    const ok = await cashFor('RECEIPT', '5000.00', { counterAccountId: await acc('4206') });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(dataOf<{ code: string }>(ok).code).toMatch(/^RCP\//);
    const tr = await call(
      owner,
      'post',
      '/finance/payments',
      {
        kind: 'TRANSFER',
        docDate: today,
        bankAccountId: cashBook.id,
        toBankAccountId: bankBook.id,
        amount: '2000.00',
        mode: 'Cash',
      },
      U(unit.id),
    );
    expect(tr.status, JSON.stringify(tr.body)).toBe(200);
    expect(dataOf<{ code: string }>(tr).code).toMatch(/^CNT\//);
    const same = await call(
      owner,
      'post',
      '/finance/payments',
      {
        kind: 'TRANSFER',
        docDate: today,
        bankAccountId: cashBook.id,
        toBankAccountId: cashBook.id,
        amount: '1.00',
        mode: 'Cash',
      },
      U(unit.id),
    );
    expect(same.status).toBe(422);
    const book = dataOf<{
      opening: string;
      totalReceipts: string;
      totalPayments: string;
      closing: string;
      rows: { balance: string }[];
    }>(
      await call(
        owner,
        'get',
        `/finance/books/${cashBook.id}?from=${today}&to=${today}`,
        undefined,
        U(unit.id),
      ),
    );
    expect(book).toMatchObject({
      opening: '0.00',
      totalReceipts: '5000.00',
      totalPayments: '2000.00',
      closing: '3000.00',
    });
    expect(book.rows.map((r) => r.balance)).toEqual(['5000.00', '3000.00']);
    expect(
      (
        await call(
          owner,
          'post',
          '/finance/payments',
          {
            kind: 'RECEIPT',
            docDate: today,
            bankAccountId: bankBook.id,
            amount: '10.00',
            mode: 'NEFT',
          },
          U(unit.id),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await call(
          owner,
          'post',
          '/finance/payments',
          {
            kind: 'RECEIPT',
            docDate: today,
            bankAccountId: bankBook.id,
            counterAccountId: await acc('4206'),
            amount: '0',
            mode: 'NEFT',
          },
          U(unit.id),
        )
      ).status,
    ).toBe(422);
    expect((await call(null, 'post', '/finance/payments', {})).status).toBe(401);
    expect((await call(emp, 'post', '/finance/payments', {})).status).toBe(403);
    expect(
      (
        await call(
          owner,
          'get',
          `/finance/books/00000000-0000-4000-8000-000000000000?from=${today}&to=${today}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (await call(owner, 'get', '/finance/payments/00000000-0000-4000-8000-000000000000')).status,
    ).toBe(404);
  });

  it('cash paid to one supplier above the daily limit is a warning stored on the journal, not a block', async () => {
    const { unit, cc } = await freshUnit();
    const cash = await bankFor(unit.id, 'CASH');
    const sup = await mkSupplier();
    await fund(unit.id, cash.ledgerId, '50000.00');
    await postJournal(owner, unit.id, [
      await line('6201', '20000.00', '0.00', { costCenterId: cc.id }),
      await line('2101', '0.00', '20000.00', {
        partyId: sup.id,
        billDocNo: `CB-${rid()}`,
        billDueDate: today,
      }),
    ]);
    const pay = await call(
      owner,
      'post',
      '/finance/payments',
      {
        kind: 'PAYMENT',
        docDate: today,
        bankAccountId: cash.id,
        supplierId: sup.id,
        amount: '15000.00',
        mode: 'Cash',
      },
      U(unit.id),
    );
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
    const w = dataOf<{ warnings: { code: string }[]; journalId: string }>(pay);
    expect(w.warnings.map((x) => x.code)).toContain('CASH_LIMIT_PAYMENT');
    const stored = await prisma.journal.findUniqueOrThrow({ where: { id: w.journalId } });
    expect(JSON.stringify(stored.warnings)).toContain('CASH_LIMIT_PAYMENT');
  });
});

// ===========================================================================================================
describe('budgets', () => {
  it('an active budget stops an over-budget posting (409 BUDGET_EXCEEDED); the override gate lets it through with a reason', async () => {
    const { unit, cc } = await freshUnit();
    const fy = await prisma.financialYear.findFirstOrThrow({ where: { isCurrent: true } });
    expect((await call(null, 'get', '/finance/budgets')).status).toBe(401);
    expect((await call(emp, 'post', '/finance/budgets', {})).status).toBe(403);
    const months = Array.from({ length: 12 }, () => '1000.00');
    const bad = await call(owner, 'post', '/finance/budgets', {
      unitId: unit.id,
      accountId: await acc('4101'),
      name: 'Not an expense',
      months,
    });
    expect(bad.status).toBe(422);
    expect(
      (
        await call(owner, 'post', '/finance/budgets', {
          unitId: unit.id,
          accountId: await acc('6201'),
          name: 'Short',
          months: ['1'],
        })
      ).status,
    ).toBe(422);
    const created = await call(owner, 'post', '/finance/budgets', {
      unitId: unit.id,
      accountId: await acc('6201'),
      costCenterId: cc.id,
      name: 'Rent',
      months,
      fyId: fy.id,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const b = dataOf<{ id: string; version: number }>(created);
    expect(
      (
        await call(owner, 'post', '/finance/budgets', {
          unitId: unit.id,
          accountId: await acc('6201'),
          costCenterId: cc.id,
          name: 'Dup',
          months,
          fyId: fy.id,
        })
      ).status,
    ).toBe(409);
    // a Draft budget is not enforced
    await postJournal(owner, unit.id, [
      await line('6201', '999999.00', '0.00', { costCenterId: cc.id }),
      await line('1111', '0.00', '999999.00'),
    ]);
    const act = await call(
      owner,
      'post',
      `/finance/budgets/${b.id}/status`,
      { status: 'Active' },
      IM(b.version),
    );
    expect(act.status, JSON.stringify(act.body)).toBe(200);
    expect(
      (
        await call(
          owner,
          'post',
          `/finance/budgets/${b.id}/status`,
          { status: 'Active' },
          IM(dataOf<{ version: number }>(act).version),
        )
      ).status,
    ).toBe(409);
    const list = dataOf<{ total: string; accountCode: string }[]>(
      await call(owner, 'get', '/finance/budgets', undefined, U(unit.id)),
    );
    expect(list[0]).toMatchObject({ total: '12000.00', accountCode: '6201' });
    // the year-to-date actual is already far over: even 1.00 more is refused
    const d = await draft(owner, unit.id, [
      await line('6201', '1.00', '0.00', { costCenterId: cc.id }),
      await line('1111', '0.00', '1.00'),
    ]);
    const sub = dataOf<{ version: number }>(
      await call(owner, 'post', `/finance/journals/${d.id}/submit`, undefined, {
        ...IM(d.version),
        ...U(unit.id),
      }),
    );
    const refused = await call(
      owner,
      'post',
      `/finance/journals/${d.id}/post`,
      {},
      { ...IM(sub.version), ...U(unit.id) },
    );
    expect(refused.status).toBe(409);
    expect(errorOf(refused).code).toBe('BUDGET_EXCEEDED');
    const short = await call(
      owner,
      'post',
      `/finance/journals/${d.id}/post`,
      { overrideBudget: { reason: 'x' } },
      { ...IM(sub.version), ...U(unit.id) },
    );
    expect(short.status).toBe(422);
    const forced = await call(
      owner,
      'post',
      `/finance/journals/${d.id}/post`,
      { overrideBudget: { reason: 'CFO approved extra rent' } },
      { ...IM(sub.version), ...U(unit.id) },
    );
    expect(forced.status, JSON.stringify(forced.body)).toBe(200);
    expect(
      await prisma.auditLog.count({ where: { action: 'BUDGET_OVERRIDDEN', targetId: b.id } }),
    ).toBe(1);
    const closed = await call(
      owner,
      'post',
      `/finance/budgets/${b.id}/status`,
      { status: 'Closed' },
      IM(dataOf<{ version: number }>(act).version),
    );
    expect(closed.status).toBe(200);
    expect((await call(owner, 'delete', `/finance/budgets/${b.id}`)).status).toBe(409);
  });

  it('a Draft budget can be edited and deleted; a stale version is refused', async () => {
    const { unit } = await freshUnit();
    const months = Array.from({ length: 12 }, (_, i) => String((i + 1) * 100));
    const c = dataOf<{ id: string; version: number }>(
      await call(owner, 'post', '/finance/budgets', {
        unitId: unit.id,
        accountId: await acc('6216'),
        name: 'Bank charges',
        months,
      }),
    );
    const up = await call(
      owner,
      'patch',
      `/finance/budgets/${c.id}`,
      { name: 'Bank charges v2', months: months.map(() => '50') },
      IM(c.version),
    );
    expect(up.status).toBe(200);
    expect(
      (await call(owner, 'patch', `/finance/budgets/${c.id}`, { name: 'Stale' }, IM(c.version)))
        .status,
    ).toBe(409);
    expect((await call(owner, 'delete', `/finance/budgets/${c.id}`)).status).toBe(204);
    expect((await call(owner, 'delete', `/finance/budgets/${c.id}`)).status).toBe(404);
  });
});

// ===========================================================================================================
describe('reports', () => {
  it('trial balance, general ledger, P&L and balance sheet agree with each other for one unit', async () => {
    const { unit, cc } = await freshUnit();
    await postJournal(owner, unit.id, [
      await line('1111', '100000.00', '0.00'),
      await line('4101', '0.00', '100000.00'),
    ]);
    await postJournal(owner, unit.id, [
      await line('6216', '2000.00', '0.00'),
      await line('1111', '0.00', '2000.00'),
    ]);
    await postJournal(owner, unit.id, [
      await line('6201', '10000.00', '0.00', { costCenterId: cc.id }),
      await line('1111', '0.00', '10000.00'),
    ]);
    const t = await tb(unit.id);
    expect(t.balanced).toBe(true);
    expect(t.totalDebit).toBe('112000.00');
    expect(t.totalCredit).toBe('112000.00');
    expect(t.lines.find((l) => l.code === '1111')).toMatchObject({
      debit: '100000.00',
      credit: '12000.00',
      closingDebit: '88000.00',
      closingCredit: '0.00',
    });
    const gl = dataOf<{
      opening: string;
      totalDebit: string;
      closing: string;
      lines: { balance: string }[];
    }>(
      await call(
        owner,
        'get',
        `/finance/reports/general-ledger?accountId=${await acc('1111')}&from=${today}&to=${today}`,
        undefined,
        U(unit.id),
      ),
    );
    expect(gl).toMatchObject({ opening: '0.00', totalDebit: '100000.00', closing: '88000.00' });
    expect(gl.lines.map((x) => x.balance)).toEqual(['100000.00', '98000.00', '88000.00']);
    const pl = dataOf<{ summary: Record<string, string> }>(
      await call(
        owner,
        'get',
        `/finance/reports/profit-and-loss?from=2026-04-01&to=2027-03-31`,
        undefined,
        U(unit.id),
      ),
    );
    expect(pl.summary).toMatchObject({
      revenue: '100000.00',
      operatingExpenses: '12000.00',
      netProfit: '88000.00',
    });
    const bs = dataOf<{
      balanced: boolean;
      currentYearProfit: string;
      totals: Record<string, string>;
    }>(
      await call(
        owner,
        'get',
        `/finance/reports/balance-sheet?asOf=${today}`,
        undefined,
        U(unit.id),
      ),
    );
    expect(bs.balanced).toBe(true);
    expect(bs.currentYearProfit).toBe('88000.00');
    expect(bs.totals).toMatchObject({ assets: '88000.00', liabilitiesAndEquity: '88000.00' });
    // validation and permissions
    expect(
      (await call(owner, 'get', '/finance/reports/profit-and-loss?from=bad&to=2027-03-31')).status,
    ).toBe(422);
    expect((await call(null, 'get', '/finance/reports/trial-balance')).status).toBe(401);
    expect(
      (await call(emp, 'get', '/finance/reports/balance-sheet')).status,
    ).toBeGreaterThanOrEqual(200);
    expect(
      (
        await call(
          owner,
          'get',
          `/finance/reports/general-ledger?accountId=00000000-0000-4000-8000-000000000000&from=${today}&to=${today}`,
        )
      ).status,
    ).toBe(404);
  });
});

// ===========================================================================================================
describe('event posting through the rules (contract 4.1.3)', () => {
  it('maps AR / SALES / OUTPUT_CGST / OUTPUT_SGST keys, is idempotent, rejects a changed replay, and a _CANCELLED event reverses it', async () => {
    const { unit } = await freshUnit();
    const cust = await mkCustomer();
    const docId = '11111111-1111-4111-8111-' + String(Date.now()).slice(-12).padStart(12, '0');
    const body = {
      event: 'SALES_INVOICE_POSTED',
      docType: 'sales-invoices',
      docId,
      docDate: today,
      unitId: unit.id,
      voucherType: 'Sales Invoice',
      payload: {
        docNo: `TAL/2627/${rid()}`.slice(0, 16),
        dueDate: today,
        partyId: cust.id,
        lines: [
          { account: 'AR', debit: '11800.00', credit: '0.00' },
          { account: 'SALES', debit: '0.00', credit: '10000.00' },
          { account: 'OUTPUT_CGST', debit: '0.00', credit: '900.00' },
          { account: 'OUTPUT_SGST', debit: '0.00', credit: '900.00' },
        ],
      },
    };
    expect((await call(null, 'post', '/finance/events', body)).status).toBe(401);
    expect((await call(emp, 'post', '/finance/events', body)).status).toBe(403);
    const first = await call(owner, 'post', '/finance/events', body, U(unit.id));
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const j = dataOf<{ id: string; code: string; replayed: boolean; openItemIds: string[] }>(first);
    expect(j.code.startsWith('EV/SALES_INVOICE/')).toBe(true);
    expect(j.replayed).toBe(false);
    expect(j.openItemIds).toHaveLength(1);
    const rows = await prisma.glEntry.findMany({ where: { journalId: j.id } });
    const codes = await prisma.account.findMany({
      where: { id: { in: rows.map((r) => r.accountId) } },
      select: { id: true, code: true },
    });
    expect(codes.map((c) => c.code).sort()).toEqual(['1201', '2301', '2302', '4101']);
    expect(rows.every((r) => r.voucherNo === body.payload.docNo)).toBe(true);
    // replay: the first journal, nothing new
    const replay = await call(owner, 'post', '/finance/events', body, U(unit.id));
    expect(dataOf<{ id: string; replayed: boolean }>(replay)).toMatchObject({
      id: j.id,
      replayed: true,
    });
    expect(await prisma.glEntry.count({ where: { journalId: j.id } })).toBe(4);
    // a different amount for the same document is refused
    const changed = {
      ...body,
      payload: {
        ...body.payload,
        lines: body.payload.lines.map((l, i) =>
          i === 0 ? { ...l, debit: '11801.00' } : i === 1 ? { ...l, credit: '10001.00' } : l,
        ),
      },
    };
    const ch = await call(owner, 'post', '/finance/events', changed, U(unit.id));
    expect(ch.status).toBe(409);
    expect(errorOf(ch).code).toBe('EVENT_PAYLOAD_CHANGED');
    // unmapped key
    const unmapped = await call(
      owner,
      'post',
      '/finance/events',
      {
        ...body,
        docId: '22222222-2222-4222-8222-222222222222',
        payload: {
          ...body.payload,
          lines: [
            { account: 'NOPE', debit: '1.00', credit: '0.00' },
            { account: 'SALES', debit: '0.00', credit: '1.00' },
          ],
        },
      },
      U(unit.id),
    );
    expect(unmapped.status).toBe(422);
    expect(errorOf(unmapped).code).toBe('UNMAPPED_ACCOUNT_KEY');
    // export invoice picks the export accounts (conditional rules)
    const exp = await call(
      owner,
      'post',
      '/finance/events',
      {
        ...body,
        docId: '33333333-3333-4333-8333-333333333333',
        payload: {
          ...body.payload,
          docNo: `EXP-${rid()}`,
          invoiceType: 'Export',
          lines: [
            { account: 'AR', debit: '500.00', credit: '0.00' },
            { account: 'SALES', debit: '0.00', credit: '500.00' },
          ],
        },
      },
      U(unit.id),
    );
    expect(exp.status, JSON.stringify(exp.body)).toBe(200);
    const expRows = await prisma.glEntry.findMany({
      where: { journalId: dataOf<{ id: string }>(exp).id },
    });
    const expCodes = await prisma.account.findMany({
      where: { id: { in: expRows.map((r) => r.accountId) } },
      select: { code: true },
    });
    expect(expCodes.map((c) => c.code).sort()).toEqual(['1202', '4102']);
    // cancel event reverses
    const cancel = await call(
      owner,
      'post',
      '/finance/events',
      {
        ...body,
        event: 'SALES_INVOICE_CANCELLED',
        payload: {
          ...body.payload,
          reason: 'Invoice cancelled by sales',
          reverses: `SALES_INVOICE_POSTED:sales-invoices:${docId}`,
        },
      },
      U(unit.id),
    );
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect((await prisma.journal.findUniqueOrThrow({ where: { id: j.id } })).status).toBe(
      'Cancelled',
    );
    expect(
      (await prisma.openItem.findUniqueOrThrow({ where: { id: j.openItemIds[0] as string } }))
        .status,
    ).toBe('Cancelled');
  });

  it('posting rules can be listed and re-pointed; a bad code is 422; a stale version 409', async () => {
    const rules = dataOf<{ id: string; version: number; lineKey: string; accountRef: string }[]>(
      await call(owner, 'get', '/finance/posting-rules'),
    );
    const r = rules.find((x) => x.lineKey === 'ROUND_OFF');
    expect(r).toBeTruthy();
    const body = { accountSelector: 'FIXED_CODE', accountRef: '6270' };
    expect(
      (
        await call(
          owner,
          'put',
          `/finance/posting-rules/${r!.id}`,
          { accountSelector: 'FIXED_CODE', accountRef: '9999' },
          IM(r!.version),
        )
      ).status,
    ).toBe(422);
    expect(
      (await call(owner, 'put', `/finance/posting-rules/${r!.id}`, body, IM(r!.version + 5)))
        .status,
    ).toBe(409);
    expect(
      (await call(owner, 'put', `/finance/posting-rules/${r!.id}`, body, IM(r!.version))).status,
    ).toBe(200);
    expect(
      (await call(emp, 'put', `/finance/posting-rules/${r!.id}`, body, IM(r!.version + 1))).status,
    ).toBe(403);
  });
});

// ===========================================================================================================
describe('approval above the owner threshold (Phase 5 engine)', () => {
  it('with no threshold configured a journal never asks for approval; with one set it goes through the engine and posts on approval', async () => {
    // the maker / checker users may work in the 3 seeded units (not in a throwaway unit)
    const unit = await prisma.unit.findUniqueOrThrow({ where: { code: 'TAL' } });
    const cc = await prisma.costCenter.findUniqueOrThrow({ where: { code: 'TAL-PROD' } });
    await prisma.setting.deleteMany({ where: { key: 'fin.journal_approval_threshold' } });
    const free = await draft(maker, unit.id, [
      await line('6201', '9000000.00', '0.00', { costCenterId: cc.id }),
      await line('1111', '0.00', '9000000.00'),
    ]);
    const s0 = await call(maker, 'post', `/finance/journals/${free.id}/submit`, undefined, {
      ...IM(free.version),
      ...U(unit.id),
    });
    expect(s0.status, JSON.stringify(s0.body)).toBe(200);
    expect(dataOf<{ needsApproval: boolean }>(s0).needsApproval).toBe(false);

    await prisma.setting.upsert({
      where: { key: 'fin.journal_approval_threshold' },
      create: { key: 'fin.journal_approval_threshold', value: '5000.00' },
      update: { value: '5000.00' },
    });
    try {
      const small = await postJournal(maker, unit.id, [
        await line('6201', '4999.99', '0.00', { costCenterId: cc.id }),
        await line('1111', '0.00', '4999.99'),
      ]);
      expect(small.code.startsWith('JV/')).toBe(true);
      const big = await draft(maker, unit.id, [
        await line('6201', '8000.00', '0.00', { costCenterId: cc.id }),
        await line('1111', '0.00', '8000.00'),
      ]);
      const sub = await call(maker, 'post', `/finance/journals/${big.id}/submit`, undefined, {
        ...IM(big.version),
        ...U(unit.id),
      });
      expect(sub.status, JSON.stringify(sub.body)).toBe(200);
      const s = dataOf<{
        needsApproval: boolean;
        postingStatus: string;
        version: number;
        approval: { id: string; version: number };
      }>(sub);
      expect(s.needsApproval).toBe(true);
      expect(s.postingStatus).toBe('Pending Approval');
      // cannot post or edit while waiting
      expect(
        (
          await call(
            maker,
            'post',
            `/finance/journals/${big.id}/post`,
            {},
            { ...IM(s.version), ...U(unit.id) },
          )
        ).status,
      ).toBe(409);
      expect(
        (
          await call(
            maker,
            'patch',
            `/finance/journals/${big.id}`,
            { narration: 'x' },
            IM(s.version),
          )
        ).status,
      ).toBe(409);
      // the maker cannot approve their own journal
      const self = await call(
        maker,
        'post',
        `/approvals/requests/${s.approval.id}/approve`,
        {},
        IM(s.approval.version),
      );
      expect(self.status).toBeGreaterThanOrEqual(400);
      const ok = await call(
        checker,
        'post',
        `/approvals/requests/${s.approval.id}/approve`,
        {},
        IM(s.approval.version),
      );
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const after = await prisma.journal.findUniqueOrThrow({ where: { id: big.id } });
      expect(after.status).toBe('Posted');
      expect(after.approvedBy).toBe(checker.user.id);
      expect(after.code.startsWith('JV/')).toBe(true);
      expect(
        await prisma.auditLog.count({ where: { targetId: big.id, action: 'JOURNAL_APPROVED' } }),
      ).toBe(1);
    } finally {
      await prisma.setting.deleteMany({ where: { key: 'fin.journal_approval_threshold' } });
    }
  });
});

// ===========================================================================================================
describe('bank reconciliation', () => {
  it('import must foot and not repeat; match by amount; the proof must be 0.00 to reconcile; reversal of a matched entry is blocked', async () => {
    const { unit, cc } = await freshUnit();
    const bankAcc = await prisma.account.create({
      data: {
        code: String(60000 + (seq += 1)),
        name: 'Reco test bank',
        parentId: await acc('1100'),
        rootType: 'Asset',
        normalBalance: 'Debit',
        subType: 'Bank',
        cfClass: 'CASH',
      },
    });
    const bank = dataOf<{ id: string }>(
      await call(owner, 'post', '/finance/bank-accounts', {
        unitId: unit.id,
        accountId: bankAcc.id,
        kind: 'BANK',
        name: 'Reco bank',
      }),
    );
    // opening balance in the books (dated before the first statement: treated as already in the bank's opening)
    await postJournal(
      owner,
      unit.id,
      [
        { accountId: bankAcc.id, debit: '100000.00', credit: '0.00' },
        await line('3001', '0.00', '100000.00'),
      ],
      { docDate: '2026-09-15' },
    );
    const pay = await call(
      owner,
      'post',
      '/finance/payments',
      {
        kind: 'PAYMENT',
        docDate: '2026-11-05',
        bankAccountId: bank.id,
        counterAccountId: await acc('6202'),
        amount: '5000.00',
        mode: 'NEFT',
        referenceNo: 'CHQ-77',
      },
      U(unit.id),
    );
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
    void cc;
    const stmt = {
      bankAccountId: bank.id,
      periodFrom: '2026-10-01',
      periodTo: '2026-11-06',
      openingBalance: '100000.00',
      closingBalance: '94882.00',
      lines: [
        {
          txnDate: '2026-11-06',
          description: 'NEFT CHQ-77',
          refNo: 'CHQ-77',
          withdrawal: '5000.00',
        },
        { txnDate: '2026-11-06', description: 'Bank charges', withdrawal: '118.00' },
      ],
    };
    expect((await call(null, 'post', '/finance/bank-statements', stmt)).status).toBe(401);
    expect((await call(emp, 'post', '/finance/bank-statements', stmt)).status).toBe(403);
    const foot = await call(owner, 'post', '/finance/bank-statements', {
      ...stmt,
      closingBalance: '94000.00',
    });
    expect(foot.status).toBe(422);
    expect(errorOf(foot).code).toBe('STATEMENT_DOES_NOT_FOOT');
    const created = await call(owner, 'post', '/finance/bank-statements', stmt);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const st = dataOf<{ id: string; version: number }>(created);
    const dup = await call(owner, 'post', '/finance/bank-statements', stmt);
    expect(dup.status).toBe(409);
    expect(errorOf(dup).code).toBe('DUPLICATE_STATEMENT');
    const detail = dataOf<{
      lines: { id: string; lineNo: number }[];
      proof: { difference: string };
    }>(await call(owner, 'get', `/finance/bank-statements/${st.id}`));
    expect(detail.lines).toHaveLength(2);
    // not reconciled yet: 5,000 uncleared in the books and 118 unrecorded
    const early = await call(
      owner,
      'post',
      `/finance/bank-statements/${st.id}/reconcile`,
      {},
      IM(st.version),
    );
    expect(early.status).toBe(422);
    expect(errorOf(early).code).toBe('SUGGESTIONS_PENDING');
    const sug = dataOf<{ lineId: string; candidates: { glEntryId: string }[] }[]>(
      await call(owner, 'get', `/finance/bank-statements/${st.id}/suggestions`),
    );
    const first = sug.find((s) => s.lineId === (detail.lines[0] as { id: string }).id);
    expect(first?.candidates.length).toBeGreaterThan(0);
    const wrongAmt = await prisma.glEntry.findFirstOrThrow({
      where: { accountId: bankAcc.id, debit: { gt: 0 } },
    });
    const mm = await call(owner, 'post', `/finance/bank-statements/${st.id}/match`, {
      lineId: (detail.lines[0] as { id: string }).id,
      glEntryId: wrongAmt.id,
    });
    expect(mm.status).toBe(422);
    expect(errorOf(mm).code).toBe('AMOUNT_MISMATCH');
    const m1 = await call(owner, 'post', `/finance/bank-statements/${st.id}/match`, {
      lineId: (detail.lines[0] as { id: string }).id,
      glEntryId: (first as { candidates: { glEntryId: string }[] }).candidates[0]!.glEntryId,
    });
    expect(m1.status, JSON.stringify(m1.body)).toBe(200);
    // matching the same ledger row to a second line is refused
    const twice = await call(owner, 'post', `/finance/bank-statements/${st.id}/match`, {
      lineId: (detail.lines[1] as { id: string }).id,
      glEntryId: (first as { candidates: { glEntryId: string }[] }).candidates[0]!.glEntryId,
    });
    expect([409, 422]).toContain(twice.status);
    // the bank charge is not in the books: post it from the statement line (creates the entry and matches it)
    const made = await call(owner, 'post', `/finance/bank-statements/${st.id}/create-entry`, {
      lineId: (detail.lines[1] as { id: string }).id,
      counterAccountId: await acc('6216'),
    });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    expect(dataOf<{ difference: string }>(made).difference).toBe('0.00');
    // a matched entry cannot be reversed (RECONCILED_ENTRY)
    const payJ = dataOf<{ journalId?: string; id: string }>(pay);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: payJ.id } });
    const blocked = await call(owner, 'post', `/finance/journals/${payment.journalId}/reverse`, {
      reason: 'Try to reverse a matched entry',
    });
    expect(blocked.status).toBe(409);
    expect(errorOf(blocked).code).toBe('RECONCILED_ENTRY');
    const fresh = await prisma.bankStatement.findUniqueOrThrow({ where: { id: st.id } });
    const done = await call(
      owner,
      'post',
      `/finance/bank-statements/${st.id}/reconcile`,
      {},
      IM(fresh.version),
    );
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(
      (
        await call(
          owner,
          'post',
          `/finance/bank-statements/${st.id}/reconcile`,
          {},
          IM(fresh.version + 1),
        )
      ).status,
    ).toBe(409);
    // reopen needs a reason; an Open statement cannot be matched when Reconciled
    const un = await call(owner, 'post', `/finance/bank-statements/${st.id}/unmatch`, {
      lineId: (detail.lines[0] as { id: string }).id,
    });
    expect(un.status).toBe(409);
    expect(
      (
        await call(
          owner,
          'post',
          `/finance/bank-statements/${st.id}/reopen`,
          { reason: 'abc' },
          IM(fresh.version + 1),
        )
      ).status,
    ).toBe(422);
    const reopened = await call(
      owner,
      'post',
      `/finance/bank-statements/${st.id}/reopen`,
      { reason: 'Re-check the charges' },
      IM(fresh.version + 1),
    );
    expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
    const un2 = await call(owner, 'post', `/finance/bank-statements/${st.id}/unmatch`, {
      lineId: (detail.lines[0] as { id: string }).id,
    });
    expect(un2.status).toBe(200);
    expect(
      await prisma.auditLog.count({
        where: {
          targetId: st.id,
          action: {
            in: [
              'BANK_STATEMENT_IMPORTED',
              'BANK_MATCHED',
              'BANK_UNMATCHED',
              'BANK_STATEMENT_RECONCILED',
              'BANK_STATEMENT_REOPENED',
            ],
          },
        },
      }),
    ).toBeGreaterThanOrEqual(6);
    // the next statement cannot be imported while this one is open
    const next = await call(owner, 'post', '/finance/bank-statements', {
      bankAccountId: bank.id,
      periodFrom: '2026-12-01',
      periodTo: '2026-12-31',
      openingBalance: '94882.00',
      closingBalance: '94882.00',
      lines: [
        { txnDate: '2026-12-05', description: 'x', deposit: '1.00' },
        { txnDate: '2026-12-06', description: 'y', withdrawal: '1.00' },
      ],
    });
    expect(next.status).toBe(409);
    expect(errorOf(next).code).toBe('PREVIOUS_STATEMENT_OPEN');
  });
});

// ===========================================================================================================
describe('period close and year-end', () => {
  it('a period with a Draft journal cannot close; reopening needs a reason; the year-end moves the P&L to Retained Earnings and seals the year', async () => {
    const { unit, cc } = await freshUnit();
    const fy = await prisma.financialYear.create({
      data: {
        code: '2023-24',
        label: 'FY 2023-24',
        startDate: new Date('2023-04-01T00:00:00Z'),
        endDate: new Date('2024-03-31T00:00:00Z'),
        status: 'OPEN',
        isCurrent: false,
      },
    });
    const periods = await prisma.financialYearPeriod.findMany({
      where: { fyId: fy.id },
      orderBy: { periodNo: 'asc' },
    });
    expect(periods).toHaveLength(12);
    const at = (docDate: string) => ({ docDate });
    const j = (lines: unknown[], docDate: string) =>
      postJournal(owner, unit.id, lines, at(docDate));
    // dates in the past are fine for the gate (fin.go_live_date is unset)
    await j(
      [await line('1111', '100000.00', '0.00'), await line('4101', '0.00', '100000.00')],
      '2023-05-10',
    );
    await j(
      [
        await line('6201', '30000.00', '0.00', { costCenterId: cc.id }),
        await line('1111', '0.00', '30000.00'),
      ],
      '2023-06-10',
    );
    const d = await draft(
      owner,
      unit.id,
      [
        await line('6201', '1.00', '0.00', { costCenterId: cc.id }),
        await line('1111', '0.00', '1.00'),
      ],
      at('2023-07-04'),
    );

    const view = dataOf<{
      periods: { id: string; periodNo: number; version: number; draftJournals: number }[];
      preview: { units: { netProfit: string }[] };
    }>(await call(owner, 'get', `/finance/close/${fy.id}`));
    expect(view.periods.find((p) => p.periodNo === 4)?.draftJournals).toBe(1);
    expect(view.preview.units.find((u) => u)?.netProfit).toBe('70000.00');
    const p4 = view.periods.find((p) => p.periodNo === 4)!;
    const blocked = await call(
      owner,
      'post',
      `/finance/close/periods/${p4.id}/close`,
      {},
      IM(p4.version),
    );
    expect(blocked.status).toBe(409);
    expect(errorOf(blocked).code).toBe('CLOSE_BLOCKED');
    expect(
      (await call(emp, 'post', `/finance/close/periods/${p4.id}/close`, {}, IM(p4.version))).status,
    ).toBe(403);
    const p1 = view.periods.find((p) => p.periodNo === 1)!;
    const closed = await call(
      owner,
      'post',
      `/finance/close/periods/${p1.id}/close`,
      {},
      IM(p1.version),
    );
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const g = await draft(
      owner,
      unit.id,
      [
        await line('6201', '2.00', '0.00', { costCenterId: cc.id }),
        await line('1111', '0.00', '2.00'),
      ],
      at('2023-04-12'),
    );
    const stop = await call(
      owner,
      'post',
      `/finance/journals/${g.id}/submit`,
      undefined,
      IM(g.version),
    );
    expect(errorOf(stop).code).toBe('PERIOD_CLOSED');
    expect(
      (
        await call(
          owner,
          'post',
          `/finance/close/periods/${p1.id}/reopen`,
          { reason: 'abc' },
          IM(dataOf<{ version: number }>(closed).version),
        )
      ).status,
    ).toBe(422);
    const re = await call(
      owner,
      'post',
      `/finance/close/periods/${p1.id}/reopen`,
      { reason: 'Late invoice to book' },
      IM(dataOf<{ version: number }>(closed).version),
    );
    expect(re.status, JSON.stringify(re.body)).toBe(200);

    // year-end is refused while a Draft remains, then goes through
    const early = await call(owner, 'post', `/finance/close/${fy.id}/year-end`, {});
    expect(early.status).toBe(409);
    expect(errorOf(early).code).toBe('CLOSE_BLOCKED');
    await call(owner, 'delete', `/finance/journals/${d.id}`);
    await call(owner, 'delete', `/finance/journals/${g.id}`);
    const yr = await call(owner, 'post', `/finance/close/${fy.id}/year-end`, {});
    expect(yr.status, JSON.stringify(yr.body)).toBe(200);
    const closings = dataOf<{
      closings: { unitId: string; netProfit: string; journalId: string }[];
    }>(yr).closings;
    expect(closings).toHaveLength(1);
    expect(closings[0]).toMatchObject({ unitId: unit.id, netProfit: '70000.00' });
    expect((await prisma.financialYear.findUniqueOrThrow({ where: { id: fy.id } })).status).toBe(
      'CLOSED',
    );
    expect(
      await prisma.financialYearPeriod.count({ where: { fyId: fy.id, status: { not: 'CLOSED' } } }),
    ).toBe(0);
    // retained earnings holds the profit; the closing rows are flagged
    const re3004 = await prisma.$queryRaw<
      { n: string }[]
    >`SELECT COALESCE(SUM(credit - debit),0)::text AS n FROM gl_entries WHERE unit_id = ${unit.id}::uuid AND account_id = ${await acc('3004')}::uuid`;
    expect(re3004[0]?.n).toBe('70000.00');
    expect(
      await prisma.glEntry.count({ where: { journalId: closings[0]!.journalId, isClosing: true } }),
    ).toBeGreaterThan(0);
    // the year's P&L is still readable and unchanged; the trial balance and balance sheet still balance
    const pl = dataOf<{ summary: Record<string, string> }>(
      await call(
        owner,
        'get',
        `/finance/reports/profit-and-loss?from=2023-04-01&to=2024-03-31`,
        undefined,
        U(unit.id),
      ),
    );
    expect(pl.summary).toMatchObject({
      revenue: '100000.00',
      operatingExpenses: '30000.00',
      netProfit: '70000.00',
    });
    const t = dataOf<{ balanced: boolean; lines: { code: string }[] }>(
      await call(
        owner,
        'get',
        `/finance/reports/trial-balance?asOf=2024-03-31`,
        undefined,
        U(unit.id),
      ),
    );
    expect(t.balanced).toBe(true);
    const bs = dataOf<{ balanced: boolean; totals: Record<string, string> }>(
      await call(
        owner,
        'get',
        `/finance/reports/balance-sheet?asOf=2024-03-31`,
        undefined,
        U(unit.id),
      ),
    );
    expect(bs.balanced).toBe(true);
    expect(bs.totals).toMatchObject({ assets: '70000.00', liabilitiesAndEquity: '70000.00' });
    // sealed: no more postings, and it cannot be closed twice
    const late = await draft(
      owner,
      unit.id,
      [
        await line('6201', '3.00', '0.00', { costCenterId: cc.id }),
        await line('1111', '0.00', '3.00'),
      ],
      at('2024-03-01'),
    );
    expect(
      errorOf(
        await call(
          owner,
          'post',
          `/finance/journals/${late.id}/submit`,
          undefined,
          IM(late.version),
        ),
      ).code,
    ).toBe('PERIOD_CLOSED');
    expect((await call(owner, 'post', `/finance/close/${fy.id}/year-end`, {})).status).toBe(409);
    expect(await prisma.auditLog.count({ where: { action: 'FY_CLOSED', targetId: fy.id } })).toBe(
      1,
    );
  });
});

// ===========================================================================================================
describe('property: random balanced postings never unbalance the ledger', () => {
  it('seeded run of 60 random multi-line journals posted through PostingService: every journal and every unit nets to zero', async () => {
    const SEED = 20261113;
    let state = SEED >>> 0;
    const rnd = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const { unit, cc } = await freshUnit();
    const me = await prisma.user.findFirstOrThrow({ where: { loginId: 'owner' } });
    const debitAccts = ['6201', '6217', '6205', '1101'];
    const journalIds: string[] = [];
    for (let n = 0; n < 60; n++) {
      const parts = 1 + Math.floor(rnd() * 4);
      const lines: { accountId: string; debit: string; credit: string; costCenterId?: string }[] =
        [];
      let total = 0;
      for (let i = 0; i < parts; i++) {
        const code = debitAccts[Math.floor(rnd() * debitAccts.length)] as string;
        const cents = 1 + Math.floor(rnd() * 900_000);
        total += cents;
        lines.push({
          accountId: await acc(code),
          debit: (cents / 100).toFixed(2),
          credit: '0.00',
          ...(code === '1101' ? {} : { costCenterId: cc.id }),
        });
      }
      lines.push({ accountId: await acc('1111'), debit: '0.00', credit: (total / 100).toFixed(2) });
      const posted = await prisma.$transaction(
        (tx) =>
          PostingService.postJournal(
            tx,
            { unitId: unit.id, docDate: today, voucherType: 'Journal', source: 'SYSTEM', lines },
            { userId: me.id },
          ),
        { maxWait: 15_000, timeout: 30_000 },
      );
      journalIds.push(posted.id);
    }
    const bad = await prisma.$queryRaw<{ journal_id: string }[]>`
      SELECT journal_id FROM gl_entries WHERE journal_id = ANY(${journalIds}::uuid[]) GROUP BY journal_id, unit_id HAVING SUM(debit) <> SUM(credit)`;
    expect(bad).toEqual([]);
    const t = await tb(unit.id);
    expect(t.balanced).toBe(true);
  });
});
