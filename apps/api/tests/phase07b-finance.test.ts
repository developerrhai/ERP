// Phase 07 part 2: manual credit / debit notes, expense claims (approval engine), recurring journals + auto
// reversal, foreign currency, cash-flow report, and the Finance tax registers (checked, never computed).
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { gstinCheckChar } from '../src/engine/validators';
import { advance } from '../src/modules/finance/recurring-service';
import { prisma as db } from '../src/core/db/prisma';
import { openItemService } from '../src/modules/finance/open-items-service';
import { API, errorOf, makeUser, newApp, prisma, signIn, signInOwner } from './helpers';
import type { Signed } from './helpers';
import { makeUnit } from './phase3-helpers';
import { dataOf as rawDataOf } from './phase4-helpers';

function dataOf<T>(res: request.Response): T {
  if ((res.body as { data?: unknown } | undefined)?.data === undefined) {
    throw new Error(`No data in the response: ${res.status} ${JSON.stringify(res.body)}`);
  }
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

async function freshUnit(gstin?: string) {
  const unit = await makeUnit();
  if (gstin)
    await prisma.unit.update({
      where: { id: unit.id },
      data: { gstin, stateCode: gstin.slice(0, 2) },
    });
  const cc = await prisma.costCenter.create({
    data: { code: `T${rid()}`.slice(0, 20), name: 'Test cost centre', unitId: unit.id },
  });
  return { unit, cc };
}
const gstinFor = (state: string): string => {
  seq += 1;
  const first14 = `${state}AAAPA${String(1000 + seq).padStart(4, '0')}A1Z`;
  return first14 + gstinCheckChar(first14);
};
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
async function postJournal(
  s: Signed,
  unitId: string,
  lines: unknown[],
  extra: Record<string, unknown> = {},
) {
  const c = await call(s, 'post', '/finance/journals', {
    unitId,
    docDate: today,
    voucherType: 'Journal',
    narration: 'test',
    lines,
    ...extra,
  });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  const d = dataOf<{ id: string; version: number }>(c);
  const sub = await call(s, 'post', `/finance/journals/${d.id}/submit`, undefined, {
    ...IM(d.version),
    ...U(unitId),
  });
  expect(sub.status, JSON.stringify(sub.body)).toBe(200);
  const post = await call(
    s,
    'post',
    `/finance/journals/${d.id}/post`,
    {},
    { ...IM(dataOf<{ version: number }>(sub).version), ...U(unitId) },
  );
  expect(post.status, JSON.stringify(post.body)).toBe(200);
  return dataOf<{ id: string; code: string; openItemIds: string[]; glEntryIds: string[] }>(post);
}
/** A cash / bank book with its own ledger account in the unit, funded with `amount`. */
async function funded(unitId: string, amount: string) {
  const code = String(30000 + (seq += 1));
  const a = await prisma.account.create({
    data: {
      code,
      name: `Test bank ${code}`,
      parentId: await acc('1100'),
      rootType: 'Asset',
      normalBalance: 'Debit',
      subType: 'Bank',
      cfClass: 'CASH',
    },
  });
  const res = await call(owner, 'post', '/finance/bank-accounts', {
    unitId,
    accountId: a.id,
    kind: 'BANK',
    name: a.name,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await postJournal(owner, unitId, [
    { accountId: a.id, debit: amount, credit: '0.00' },
    await line('3001', '0.00', amount),
  ]);
  return { bankId: dataOf<{ id: string }>(res).id, ledgerId: a.id };
}

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
  await prisma.$disconnect();
});

// ===========================================================================================================
describe('credit and debit notes', () => {
  const noteBody = async (over: Record<string, unknown>) => ({
    effect: 'REDUCE',
    docDate: today,
    counterAccountId: await acc('4108'),
    amount: '1000.00',
    reason: 'Agreed post-sale discount',
    ...over,
  });

  it('401 / 403 / 404 / 422 on the note endpoints', async () => {
    const { unit } = await freshUnit();
    const cust = await mkCustomer();
    expect((await call(null, 'get', '/finance/credit-notes')).status).toBe(401);
    expect((await call(emp, 'post', '/finance/credit-notes', {})).status).toBe(403);
    expect(
      (await call(owner, 'get', '/finance/credit-notes/00000000-0000-4000-8000-000000000000'))
        .status,
    ).toBe(404);
    const base = await noteBody({ unitId: unit.id, partyId: cust.id });
    expect(
      (await call(owner, 'post', '/finance/credit-notes', { ...base, amount: '0' })).status,
    ).toBe(422);
    expect(
      (await call(owner, 'post', '/finance/credit-notes', { ...base, reason: 'no' })).status,
    ).toBe(422);
    const sup = await mkSupplier();
    expect(
      (await call(owner, 'post', '/finance/credit-notes', { ...base, partyId: sup.id })).status,
    ).toBe(422); // a credit note is for a customer
    expect(
      (
        await call(owner, 'post', '/finance/credit-notes', {
          ...base,
          counterAccountId: await acc('1201'),
        })
      ).status,
    ).toBe(422);
  });

  it('a customer credit note reduces the receivable: Draft -> Post -> number CRN/…, negative open item, ledger agrees, cancel reverses', async () => {
    const { unit } = await freshUnit();
    const cust = await mkCustomer();
    const inv = await postJournal(owner, unit.id, [
      await line('1201', '5000.00', '0.00', {
        partyId: cust.id,
        billDocNo: `INV-${rid()}`,
        billDueDate: today,
      }),
      await line('4101', '0.00', '5000.00'),
    ]);
    const created = await call(
      owner,
      'post',
      '/finance/credit-notes',
      await noteBody({ unitId: unit.id, partyId: cust.id, amount: '1200.00' }),
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const n = dataOf<{ id: string; code: string; version: number; status: string }>(created);
    expect(n.status).toBe('Draft');
    expect(n.code.startsWith('DRAFT-')).toBe(true);
    const posted = await call(
      owner,
      'post',
      `/finance/credit-notes/${n.id}/post`,
      {},
      IM(n.version),
    );
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    const p = dataOf<{ code: string; status: string; journalId: string; version: number }>(posted);
    expect(p.status).toBe('Posted');
    expect(p.code).toMatch(/^CRN\//);
    const item = await prisma.openItem.findFirstOrThrow({ where: { journalId: p.journalId } });
    expect(item.itemType).toBe('CREDIT_NOTE');
    expect(item.amount.toFixed(2)).toBe('-1200.00');
    expect((await openItemService.agreement(db, 'RECEIVABLE', cust.id)).agrees).toBe(true);
    // settle it against the invoice, then it cannot be cancelled until the allocation is undone
    const me = await prisma.user.findFirstOrThrow({ where: { loginId: 'owner' } });
    const alloc = await prisma.$transaction((tx) =>
      openItemService.allocate(
        tx,
        {
          sourceItemId: item.id,
          targetItemId: inv.openItemIds[0] as string,
          amount: '1200.00',
          date: today,
        },
        { userId: me.id },
      ),
    );
    const blocked = await call(
      owner,
      'post',
      `/finance/credit-notes/${n.id}/cancel`,
      { reason: 'Raised by mistake' },
      IM(p.version),
    );
    expect(blocked.status).toBe(409);
    expect(errorOf(blocked).code).toBe('SETTLED_DOCUMENT');
    await prisma.$transaction((tx) =>
      openItemService.reverseAllocation(tx, alloc.id, { userId: me.id }, today),
    );
    expect(
      (
        await call(
          emp,
          'post',
          `/finance/credit-notes/${n.id}/cancel`,
          { reason: 'Raised by mistake' },
          IM(p.version),
        )
      ).status,
    ).toBe(403);
    const cancelled = await call(
      owner,
      'post',
      `/finance/credit-notes/${n.id}/cancel`,
      { reason: 'Raised by mistake' },
      IM(p.version),
    );
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(dataOf<{ status: string }>(cancelled).status).toBe('Cancelled');
    expect(
      (await call(owner, 'post', `/finance/credit-notes/${n.id}/post`, {}, IM(p.version))).status,
    ).toBeGreaterThanOrEqual(409);
    expect((await openItemService.agreement(db, 'RECEIVABLE', cust.id)).agrees).toBe(true);
    const audit = await prisma.auditLog.findMany({ where: { targetId: n.id } });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['NOTE_CREATED', 'NOTE_POSTED', 'NOTE_CANCELLED']),
    );
  });

  it('a supplier debit note reduces the payable; an ADD note raises it; a Draft can be deleted', async () => {
    const { unit } = await freshUnit();
    const sup = await mkSupplier();
    const reduce = dataOf<{ id: string; version: number }>(
      await call(
        owner,
        'post',
        '/finance/debit-notes',
        await noteBody({
          unitId: unit.id,
          partyId: sup.id,
          counterAccountId: await acc('5111'),
          amount: '300.00',
          reason: 'Rate correction on bill',
        }),
      ),
    );
    const r = dataOf<{ code: string; journalId: string }>(
      await call(owner, 'post', `/finance/debit-notes/${reduce.id}/post`, {}, IM(reduce.version)),
    );
    expect(r.code).toMatch(/^DBN\//);
    const it1 = await prisma.openItem.findFirstOrThrow({ where: { journalId: r.journalId } });
    expect(it1.side).toBe('PAYABLE');
    expect(it1.amount.toFixed(2)).toBe('-300.00');
    const add = dataOf<{ id: string; version: number }>(
      await call(
        owner,
        'post',
        '/finance/debit-notes',
        await noteBody({
          effect: 'ADD',
          unitId: unit.id,
          partyId: sup.id,
          counterAccountId: await acc('6254'),
          amount: '75.50',
          reason: 'Interest charged by supplier',
        }),
      ),
    );
    const a = dataOf<{ journalId: string }>(
      await call(owner, 'post', `/finance/debit-notes/${add.id}/post`, {}, IM(add.version)),
    );
    expect(
      (
        await prisma.openItem.findFirstOrThrow({ where: { journalId: a.journalId } })
      ).amount.toFixed(2),
    ).toBe('75.50');
    expect((await openItemService.agreement(db, 'PAYABLE', sup.id)).agrees).toBe(true);
    const d = dataOf<{ id: string }>(
      await call(
        owner,
        'post',
        '/finance/debit-notes',
        await noteBody({ unitId: unit.id, partyId: sup.id, counterAccountId: await acc('5111') }),
      ),
    );
    expect((await call(owner, 'delete', `/finance/debit-notes/${d.id}`)).status).toBe(204);
    expect((await call(owner, 'get', `/finance/debit-notes/${d.id}`)).status).toBe(404);
    expect((await call(owner, 'get', `/finance/credit-notes/${reduce.id}`)).status).toBe(404); // right id, wrong page
    const list = await call(
      owner,
      'get',
      '/finance/debit-notes?status=Posted',
      undefined,
      U(unit.id),
    );
    expect((list.body as { meta: { total: number } }).meta.total).toBe(2);
  });
});

// ===========================================================================================================
describe('expense claims', () => {
  it('policies are data: listed, editable by an approver, stale versions refused', async () => {
    expect((await call(null, 'get', '/finance/expense-policies')).status).toBe(401);
    const list = dataOf<
      { category: string; perClaimLimit: string; approvalLimit: string; version: number }[]
    >(await call(owner, 'get', '/finance/expense-policies'));
    const food = list.find((p) => p.category === 'Food');
    expect(food).toMatchObject({ perClaimLimit: '1500.00', approvalLimit: '4500.00' });
    const body = {
      perClaimLimit: '1600',
      perMonthLimit: '6000',
      approvalLimit: '4800',
      defaultAccountId: await acc('6222'),
    };
    expect(
      (await call(emp, 'put', '/finance/expense-policies/Food', body, IM(food!.version))).status,
    ).toBe(403);
    expect(
      (
        await call(
          owner,
          'put',
          '/finance/expense-policies/Food',
          { ...body, approvalLimit: '1000' },
          IM(food!.version),
        )
      ).status,
    ).toBe(422);
    expect(
      (await call(owner, 'put', '/finance/expense-policies/Food', body, IM(food!.version + 3)))
        .status,
    ).toBe(409);
    expect(
      (await call(owner, 'put', '/finance/expense-policies/Food', body, IM(food!.version))).status,
    ).toBe(200);
    await call(
      owner,
      'put',
      '/finance/expense-policies/Food',
      { ...body, perClaimLimit: '1500', approvalLimit: '4500' },
      IM(food!.version + 1),
    );
  });

  it('claim -> submit -> approve posts Dr expense / Cr 2104 (employee) -> pay settles the bill; limits warn or refuse', async () => {
    const tal = await prisma.unit.findUniqueOrThrow({ where: { code: 'TAL' } });
    const cc = await prisma.costCenter.findUniqueOrThrow({ where: { code: 'TAL-PROD' } });
    const bank = await funded(tal.id, '50000.00');
    const base = {
      unitId: tal.id,
      claimDate: today,
      category: 'Travel',
      costCenterId: cc.id,
      description: 'Client visit, Pune',
    };
    expect((await call(null, 'post', '/finance/expenses', {})).status).toBe(401);
    expect((await call(emp, 'post', '/finance/expenses', {})).status).toBe(403);
    // the hard limit (3x per-claim = 15,000 for Travel) refuses; above 5,000 only warns
    const tooBig = await call(maker, 'post', '/finance/expenses', { ...base, amount: '15000.01' });
    expect(tooBig.status).toBe(422);
    expect(errorOf(tooBig).code).toBe('EXPENSE_LIMIT');
    expect(
      (
        await call(maker, 'post', '/finance/expenses', {
          ...base,
          category: 'Nonsense',
          amount: '10',
        })
      ).status,
    ).toBe(422);
    expect((await call(maker, 'post', '/finance/expenses', { ...base, amount: '0' })).status).toBe(
      422,
    );
    const noCc = await call(maker, 'post', '/finance/expenses', {
      ...base,
      costCenterId: undefined,
      amount: '100',
    });
    expect(errorOf(noCc).code).toBe('COST_CENTER_REQUIRED');
    const created = await call(maker, 'post', '/finance/expenses', {
      ...base,
      amount: '6000.00',
      billNo: 'B-77',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const c = dataOf<{
      id: string;
      code: string;
      version: number;
      status: string;
      warnings: { code: string }[];
    }>(created);
    expect(c.status).toBe('Draft');
    expect(c.code).toMatch(/^EXP\//);
    expect(c.warnings.map((w) => w.code)).toContain('OVER_CLAIM_LIMIT');
    // edit while Draft
    const edited = await call(
      maker,
      'patch',
      `/finance/expenses/${c.id}`,
      { amount: '5500.00' },
      IM(c.version),
    );
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const v1 = dataOf<{ version: number }>(edited).version;
    // pay before approval is refused
    expect(
      (
        await call(
          owner,
          'post',
          `/finance/expenses/${c.id}/pay`,
          { bankAccountId: bank.bankId, mode: 'NEFT' },
          IM(v1),
        )
      ).status,
    ).toBe(409);
    const sub = await call(maker, 'post', `/finance/expenses/${c.id}/submit`, undefined, IM(v1));
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(dataOf<{ status: string }>(sub).status).toBe('Pending Approval');
    expect(
      (await call(maker, 'patch', `/finance/expenses/${c.id}`, { amount: '10' }, IM(v1 + 1)))
        .status,
    ).toBe(409);
    const req = await prisma.approvalRequest.findFirstOrThrow({
      where: { docType: 'fin-expenses', docId: c.id, status: 'PENDING' },
    });
    const self = await call(
      maker,
      'post',
      `/approvals/requests/${req.id}/approve`,
      {},
      IM(req.version),
    );
    expect(self.status).toBeGreaterThanOrEqual(400);
    const ok = await call(
      checker,
      'post',
      `/approvals/requests/${req.id}/approve`,
      {},
      IM(req.version),
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const approved = dataOf<{ status: string; journalId: string; version: number }>(
      await call(maker, 'get', `/finance/expenses/${c.id}`),
    );
    expect(approved.status).toBe('Approved');
    const bill = await prisma.openItem.findFirstOrThrow({
      where: { journalId: approved.journalId },
    });
    expect(bill.partyType).toBe('EMPLOYEE');
    expect(bill.amount.toFixed(2)).toBe('5500.00');
    expect((await openItemService.agreement(db, 'PAYABLE', maker.user.id)).agrees).toBe(true);
    // an employee sees only their own claims; an approver sees all
    expect((await call(checker, 'get', `/finance/expenses/${c.id}`)).status).toBe(200);
    // pay from the bank book
    const paid = await call(
      owner,
      'post',
      `/finance/expenses/${c.id}/pay`,
      { bankAccountId: bank.bankId, mode: 'NEFT' },
      { ...IM(approved.version), ...U(tal.id) },
    );
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(dataOf<{ status: string; paymentId: string }>(paid).status).toBe('Paid');
    expect((await prisma.openItem.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe(
      'Settled',
    );
    expect((await openItemService.agreement(db, 'PAYABLE', maker.user.id)).agrees).toBe(true);
    // a paid claim cannot be cancelled
    const noCancel = await call(
      owner,
      'post',
      `/finance/expenses/${c.id}/cancel`,
      { reason: 'Changed my mind' },
      IM(dataOf<{ version: number }>(paid).version),
    );
    expect(noCancel.status).toBe(409);
    const audit = await prisma.auditLog.findMany({ where: { targetId: c.id } });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['EXPENSE_CREATED', 'EXPENSE_APPROVED', 'EXPENSE_PAID']),
    );
  });

  it('a rejected claim can be edited and resubmitted; an approved unpaid claim can be cancelled (journal reversed); a Draft can be deleted', async () => {
    const tal = await prisma.unit.findUniqueOrThrow({ where: { code: 'TAL' } });
    const cc = await prisma.costCenter.findUniqueOrThrow({ where: { code: 'TAL-PROD' } });
    const mk = async (amount: string) =>
      dataOf<{ id: string; version: number }>(
        await call(maker, 'post', '/finance/expenses', {
          unitId: tal.id,
          claimDate: today,
          category: 'Fuel',
          costCenterId: cc.id,
          description: 'Fuel for van',
          amount,
        }),
      );
    const a = await mk('2000.00');
    await call(maker, 'post', `/finance/expenses/${a.id}/submit`, undefined, IM(a.version));
    const req = await prisma.approvalRequest.findFirstOrThrow({
      where: { docType: 'fin-expenses', docId: a.id, status: 'PENDING' },
    });
    const rej = await call(
      checker,
      'post',
      `/approvals/requests/${req.id}/reject`,
      { comment: 'Receipt is missing, please attach it' },
      IM(req.version),
    );
    expect(rej.status, JSON.stringify(rej.body)).toBe(200);
    const afterReject = dataOf<{ status: string; version: number }>(
      await call(maker, 'get', `/finance/expenses/${a.id}`),
    );
    expect(afterReject.status).toBe('Rejected');
    const re = await call(
      maker,
      'patch',
      `/finance/expenses/${a.id}`,
      { description: 'Fuel for van (receipt attached)' },
      IM(afterReject.version),
    );
    expect(re.status).toBe(200);
    await call(
      maker,
      'post',
      `/finance/expenses/${a.id}/submit`,
      undefined,
      IM(dataOf<{ version: number }>(re).version),
    );
    const req2 = await prisma.approvalRequest.findFirstOrThrow({
      where: { docType: 'fin-expenses', docId: a.id, status: 'PENDING' },
    });
    expect(
      (await call(checker, 'post', `/approvals/requests/${req2.id}/approve`, {}, IM(req2.version)))
        .status,
    ).toBe(200);
    const approved = dataOf<{ version: number; journalId: string }>(
      await call(maker, 'get', `/finance/expenses/${a.id}`),
    );
    expect(
      (
        await call(
          emp,
          'post',
          `/finance/expenses/${a.id}/cancel`,
          { reason: 'Not needed any more' },
          IM(approved.version),
        )
      ).status,
    ).toBe(403);
    const cancelled = await call(
      owner,
      'post',
      `/finance/expenses/${a.id}/cancel`,
      { reason: 'Not needed any more' },
      IM(approved.version),
    );
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(
      (await prisma.journal.findUniqueOrThrow({ where: { id: approved.journalId } })).status,
    ).toBe('Cancelled');
    const d = await mk('100.00');
    expect((await call(maker, 'delete', `/finance/expenses/${d.id}`)).status).toBe(204);
    expect((await call(maker, 'get', `/finance/expenses/${d.id}`)).status).toBe(404);
    expect((await call(maker, 'get', '/finance/expenses?mine=true')).status).toBe(200);
  });
});

// ===========================================================================================================
describe('recurring journals and auto-reversal', () => {
  it('advance() keeps month ends and steps weekly / quarterly / yearly', () => {
    expect(advance('2026-01-31', 'MONTHLY')).toBe('2026-02-28');
    expect(advance('2028-01-31', 'MONTHLY')).toBe('2028-02-29');
    expect(advance('2026-11-30', 'QUARTERLY')).toBe('2027-02-28');
    expect(advance('2026-02-28', 'YEARLY')).toBe('2027-02-28');
    expect(advance('2026-11-06', 'WEEKLY')).toBe('2026-11-13');
  });

  it('401 / 403 / 422 and the lifecycle of a template', async () => {
    const { unit, cc } = await freshUnit();
    const body = {
      unitId: unit.id,
      name: 'Monthly rent',
      frequency: 'MONTHLY',
      nextRun: '2026-09-30',
      lines: [
        await line('6201', '10000.00', '0.00', { costCenterId: cc.id }),
        await line('2103', '0.00', '10000.00'),
      ],
    };
    expect((await call(null, 'get', '/finance/recurring')).status).toBe(401);
    expect((await call(emp, 'post', '/finance/recurring/run', {})).status).toBe(403);
    expect(
      (
        await call(owner, 'post', '/finance/recurring', {
          ...body,
          lines: [await line('6201', '10000.00', '0.00'), await line('2103', '0.00', '9999.00')],
        })
      ).status,
    ).toBe(422);
    expect(
      (await call(owner, 'post', '/finance/recurring', { ...body, endDate: '2026-01-01' })).status,
    ).toBe(422);
    const t = dataOf<{ id: string; version: number }>(
      await call(owner, 'post', '/finance/recurring', body),
    );
    const paused = await call(
      owner,
      'post',
      `/finance/recurring/${t.id}/status`,
      { status: 'Paused' },
      IM(t.version),
    );
    expect(paused.status).toBe(200);
    expect(
      (
        await call(
          owner,
          'post',
          `/finance/recurring/${t.id}/status`,
          { status: 'Active' },
          IM(t.version),
        )
      ).status,
    ).toBe(409);
    expect((await call(owner, 'delete', `/finance/recurring/${t.id}`)).status).toBe(204);
    expect((await call(owner, 'delete', `/finance/recurring/${t.id}`)).status).toBe(404);
  });

  it('run creates a Draft for each due date (catches up), is idempotent, and a Draft is a normal journal', async () => {
    const { unit, cc } = await freshUnit();
    const t = dataOf<{ id: string; version: number }>(
      await call(owner, 'post', '/finance/recurring', {
        unitId: unit.id,
        name: 'Rent accrual',
        frequency: 'MONTHLY',
        nextRun: '2026-09-30',
        narration: 'Monthly rent',
        lines: [
          await line('6201', '10000.00', '0.00', { costCenterId: cc.id }),
          await line('2103', '0.00', '10000.00'),
        ],
      }),
    );
    const run1 = dataOf<{
      created: { code: string; date: string; posted: boolean; journalId: string }[];
      failures: unknown[];
    }>(await call(owner, 'post', '/finance/recurring/run', { asOf: today }));
    const mine = run1.created.filter((c) => c.journalId);
    const rows = await prisma.journal.findMany({
      where: { unitId: unit.id },
      orderBy: { docDate: 'asc' },
    });
    expect(rows.map((r) => r.docDate.toISOString().slice(0, 10))).toEqual([
      '2026-09-30',
      '2026-10-30',
    ]);
    expect(rows.every((r) => r.status === 'Draft')).toBe(true);
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(run1.failures).toEqual([]);
    const after = (await call(owner, 'get', '/finance/recurring', undefined, U(unit.id))).body as {
      data: { id: string; nextRun: string; runs: number }[];
    };
    expect(after.data.find((x) => x.id === t.id)).toMatchObject({ nextRun: '2026-11-30', runs: 2 });
    const run2 = dataOf<{ created: unknown[] }>(
      await call(owner, 'post', '/finance/recurring/run', { asOf: today }),
    );
    expect(
      run2.created.filter((c) => (c as { template: string }).template === 'Rent accrual'),
    ).toHaveLength(0);
    expect(await prisma.journal.count({ where: { unitId: unit.id } })).toBe(2);
    // the generated draft goes through the normal submit / post
    const d = rows[0]!;
    const sub = await call(owner, 'post', `/finance/journals/${d.id}/submit`, undefined, {
      ...IM(d.version),
      ...U(unit.id),
    });
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
  });

  it('auto-post + "reverse next day" posts an accrual and reverses it the next day', async () => {
    const { unit, cc } = await freshUnit();
    dataOf(
      await call(owner, 'post', '/finance/recurring', {
        unitId: unit.id,
        name: 'Accrued electricity',
        frequency: 'MONTHLY',
        nextRun: '2026-10-15',
        autoPost: true,
        reverseNextDay: true,
        voucherType: 'Provision',
        lines: [
          await line('6203', '4000.00', '0.00', { costCenterId: cc.id }),
          await line('2103', '0.00', '4000.00'),
        ],
      }),
    );
    const out = dataOf<{
      created: { posted: boolean; code: string }[];
      reversed: { journal: string; reversal: string }[];
      failures: unknown[];
    }>(await call(owner, 'post', '/finance/recurring/run', { asOf: today }));
    expect(out.failures).toEqual([]);
    const posted = await prisma.journal.findMany({
      where: { unitId: unit.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(posted).toHaveLength(2);
    expect(posted[0]).toMatchObject({
      status: 'Cancelled',
      postingStatus: 'Reversed',
      voucherType: 'Provision',
    });
    expect(posted[1]).toMatchObject({ status: 'Posted', voucherType: 'Reversal' });
    expect(out.reversed.length).toBeGreaterThanOrEqual(1);
    const net = await prisma.$queryRaw<
      { n: string }[]
    >`SELECT COALESCE(SUM(debit - credit),0)::text AS n FROM gl_entries WHERE unit_id = ${unit.id}::uuid`;
    expect(net[0]?.n).toBe('0.00');
  });
});

// ===========================================================================================================
describe('foreign currency', () => {
  it('the rate master: set, update, look up the latest on or before a date; INR and bad rates are refused', async () => {
    expect((await call(null, 'get', '/finance/fx-rates')).status).toBe(401);
    expect(
      (
        await call(emp, 'put', '/finance/fx-rates', {
          currencyCode: 'USD',
          rateDate: today,
          rate: '84',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(owner, 'put', '/finance/fx-rates', {
          currencyCode: 'INR',
          rateDate: today,
          rate: '1',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call(owner, 'put', '/finance/fx-rates', {
          currencyCode: 'USD',
          rateDate: today,
          rate: '0',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call(owner, 'put', '/finance/fx-rates', {
          currencyCode: 'USD',
          rateDate: '2026-11-01',
          rate: '83.2',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(owner, 'put', '/finance/fx-rates', {
          currencyCode: 'USD',
          rateDate: '2026-11-05',
          rate: '84.0000',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(owner, 'put', '/finance/fx-rates', {
          currencyCode: 'USD',
          rateDate: '2026-11-05',
          rate: '84.5',
        })
      ).status,
    ).toBe(200); // same day: replaced
    const on = dataOf<{ rate: string; rateDate: string }>(
      await call(owner, 'get', '/finance/fx-rates/on?currency=USD&date=2026-11-04'),
    );
    expect(on).toEqual({ rate: '83.200000', rateDate: '2026-11-01' });
    expect(
      dataOf<{ rate: string }>(
        await call(owner, 'get', `/finance/fx-rates/on?currency=USD&date=${today}`),
      ).rate,
    ).toBe('84.500000');
    const list = await call(owner, 'get', '/finance/fx-rates?currency=USD');
    expect((list.body as { meta: { total: number } }).meta.total).toBe(2);
  });

  it('a foreign line stores the amount and the rate and books round-half-up INR; a missing rate is refused', async () => {
    const { unit } = await freshUnit();
    const noRate = await call(owner, 'post', '/finance/journals', {
      unitId: unit.id,
      docDate: today,
      lines: [
        {
          accountId: await acc('1111'),
          debit: '0',
          credit: '0',
          currencyCode: 'USD',
          amountFc: '1000',
          side: 'DR',
        },
        await line('4102', '0.00', '83200.00'),
      ],
    });
    expect(noRate.status).toBe(422);
    expect(errorOf(noRate).code).toBe('NO_FX_RATE');
    const p = await postJournal(owner, unit.id, [
      {
        accountId: await acc('1111'),
        debit: '0',
        credit: '0',
        currencyCode: 'USD',
        amountFc: '1000.00',
        fxRate: '83.2',
        side: 'DR',
      },
      await line('4102', '0.00', '83200.00'),
    ]);
    const gl = await prisma.glEntry.findFirstOrThrow({
      where: { journalId: p.id, debit: { gt: 0 } },
    });
    expect(gl.debit.toFixed(2)).toBe('83200.00');
    expect(gl.amountFc?.toFixed(2)).toBe('1000.00');
    expect(gl.fxRate.toFixed(6)).toBe('83.200000');
    expect(gl.currencyCode).toBe('USD');
    // round half up: 1.00 USD at 83.205 = 83.21 (banker's rounding would give 83.20)
    const q = await postJournal(owner, unit.id, [
      {
        accountId: await acc('1111'),
        debit: '0',
        credit: '0',
        currencyCode: 'USD',
        amountFc: '1.00',
        fxRate: '83.205',
        side: 'DR',
      },
      await line('4102', '0.00', '83.21'),
    ]);
    expect(q.glEntryIds).toHaveLength(2);
  });

  it('the revaluation preview shows the unrealised gain on an open USD receivable at the closing rate', async () => {
    const { unit } = await freshUnit();
    const cust = await mkCustomer();
    const p = await postJournal(owner, unit.id, [
      {
        accountId: await acc('1202'),
        debit: '0',
        credit: '0',
        currencyCode: 'USD',
        amountFc: '1000.00',
        fxRate: '83.2',
        side: 'DR',
        partyId: cust.id,
        billDocNo: `EXP-${rid()}`,
        billDueDate: today,
      },
      await line('4102', '0.00', '83200.00'),
    ]);
    const item = await prisma.openItem.findUniqueOrThrow({
      where: { id: p.openItemIds[0] as string },
    });
    expect(item.amountFc?.toFixed(2)).toBe('1000.00');
    expect(item.currencyCode).toBe('USD');
    const rev = dataOf<{
      unrealisedGain: string;
      unrealisedLoss: string;
      lines: {
        currency: string;
        rate: string;
        revalued: string;
        difference: string;
        result: string;
      }[];
    }>(
      await call(
        owner,
        'get',
        `/finance/reports/fx-revaluation?asOf=${today}`,
        undefined,
        U(unit.id),
      ),
    );
    expect(rev.lines).toHaveLength(1);
    expect(rev.lines[0]).toMatchObject({
      currency: 'USD',
      rate: '84.500000',
      revalued: '84500.00',
      difference: '1300.00',
      result: 'Gain',
    });
    expect(rev.unrealisedGain).toBe('1300.00');
    expect(rev.unrealisedLoss).toBe('0.00');
    const none = dataOf<{ lines: unknown[] }>(
      await call(
        owner,
        'get',
        `/finance/reports/fx-revaluation?asOf=${today}`,
        undefined,
        U((await freshUnit()).unit.id),
      ),
    );
    expect(none.lines).toHaveLength(0);
    expect((await call(null, 'get', '/finance/reports/fx-revaluation')).status).toBe(401);
  });
});

// ===========================================================================================================
describe('cash flow report', () => {
  it('operating + investing + financing equals the change in cash, and the report proves it', async () => {
    const { unit } = await freshUnit();
    const cust = await mkCustomer();
    await postJournal(owner, unit.id, [
      await line('1111', '100000.00', '0.00'),
      await line('3001', '0.00', '100000.00'),
    ]);
    await postJournal(owner, unit.id, [
      await line('1603', '30000.00', '0.00'),
      await line('1111', '0.00', '30000.00'),
    ]);
    await postJournal(owner, unit.id, [
      await line('1111', '50000.00', '0.00'),
      await line('4101', '0.00', '50000.00'),
    ]);
    await postJournal(owner, unit.id, [
      await line('6216', '10000.00', '0.00'),
      await line('1111', '0.00', '10000.00'),
    ]);
    await postJournal(owner, unit.id, [
      await line('1201', '20000.00', '0.00', {
        partyId: cust.id,
        billDocNo: `CF-${rid()}`,
        billDueDate: today,
      }),
      await line('4101', '0.00', '20000.00'),
    ]);
    const cf = dataOf<{
      operating: { netProfit: string; total: string; items: { code: string; amount: string }[] };
      investing: { total: string };
      financing: { total: string };
      netChange: string;
      openingCash: string;
      closingCash: string;
      reconciles: boolean;
    }>(
      await call(
        owner,
        'get',
        `/finance/reports/cash-flow?from=2026-04-01&to=${today}`,
        undefined,
        U(unit.id),
      ),
    );
    expect(cf.operating.netProfit).toBe('60000.00'); // 70,000 sales - 10,000 charges
    expect(cf.operating.items.find((i) => i.code === '1201')?.amount).toBe('-20000.00'); // receivables grew
    expect(cf.operating.total).toBe('40000.00');
    expect(cf.investing.total).toBe('-30000.00');
    expect(cf.financing.total).toBe('100000.00');
    expect(cf.netChange).toBe('110000.00');
    expect(cf).toMatchObject({ openingCash: '0.00', closingCash: '110000.00', reconciles: true });
    expect(
      (await call(null, 'get', '/finance/reports/cash-flow?from=2026-04-01&to=2026-11-01')).status,
    ).toBe(401);
    expect(
      (await call(owner, 'get', '/finance/reports/cash-flow?from=bad&to=2026-11-01')).status,
    ).toBe(422);
  });
});

// ===========================================================================================================
describe('tax registers (checked, never computed)', () => {
  const salesEvent = (
    unitId: string,
    partyId: string,
    over: Record<string, unknown> = {},
    tax: Record<string, unknown> = {},
    docId?: string,
  ) => ({
    event: 'SALES_INVOICE_POSTED',
    docType: 'sales-invoices',
    docId: docId ?? crypto.randomUUID(),
    docDate: today,
    unitId,
    voucherType: 'Sales Invoice',
    payload: {
      docNo: `TAL/2627/${rid()}`.slice(0, 16),
      dueDate: today,
      partyId,
      lines: [
        { account: 'AR', debit: '11800.00', credit: '0.00' },
        { account: 'SALES', debit: '0.00', credit: '10000.00' },
        { account: 'OUTPUT_CGST', debit: '0.00', credit: '900.00' },
        { account: 'OUTPUT_SGST', debit: '0.00', credit: '900.00' },
      ],
      tax: {
        direction: 'OUTWARD',
        docKind: 'INV',
        partyName: 'Test Buyer Pvt Ltd',
        partyGstin: gstinFor('27'),
        partyStateCode: '27',
        placeOfSupplyStateCode: '27',
        lines: [
          {
            hsn: '847130',
            taxable: '10000.00',
            rate: '18',
            cgst: '900.00',
            sgst: '900.00',
            igst: '0.00',
            cess: '0.00',
          },
        ],
        ...tax,
      },
      ...over,
    },
  });

  it('a sales invoice event fills the sales register; Finance refuses a tax block that does not agree with the ledger lines', async () => {
    const { unit } = await freshUnit(gstinFor('27'));
    const cust = await mkCustomer();
    const body = salesEvent(unit.id, cust.id);
    expect((await call(emp, 'post', '/finance/events', body)).status).toBe(403);
    const ok = await call(owner, 'post', '/finance/events', body, U(unit.id));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const j = dataOf<{ id: string }>(ok);
    const reg = dataOf<{
      totals: Record<string, string>;
      rows: { docNo: string; cgst: string; partyGstin: string; status: string }[];
    }>(
      await call(
        owner,
        'get',
        `/finance/tax/sales-register?from=2026-04-01&to=${today}`,
        undefined,
        U(unit.id),
      ),
    );
    expect(reg.rows).toHaveLength(1);
    expect(reg.rows[0]).toMatchObject({
      docNo: body.payload.docNo,
      cgst: '900.00',
      status: 'Active',
    });
    expect(reg.totals).toMatchObject({
      taxable: '10000.00',
      cgst: '900.00',
      sgst: '900.00',
      igst: '0.00',
    });
    expect(
      await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM tax_document_lines`,
    ).toBeTruthy();
    // the CGST in the block (800) is not the CGST in the ledger (900): 422 and nothing is posted
    const bad = salesEvent(
      unit.id,
      cust.id,
      {},
      {
        lines: [
          {
            hsn: '847130',
            taxable: '10000.00',
            rate: '18',
            cgst: '800.00',
            sgst: '900.00',
            igst: '0.00',
            cess: '0.00',
          },
        ],
      },
    );
    const mm = await call(owner, 'post', '/finance/events', bad, U(unit.id));
    expect(mm.status).toBe(422);
    expect(errorOf(mm).code).toBe('TAX_PAYLOAD_MISMATCH');
    expect(await prisma.journal.count({ where: { sourceDocId: bad.docId } })).toBe(0);
    // unequal CGST / SGST inside the state, and IGST on an intra-state supply, are structural errors
    const igst = salesEvent(
      unit.id,
      cust.id,
      {},
      {
        lines: [
          {
            hsn: '847130',
            taxable: '10000.00',
            rate: '18',
            cgst: '0.00',
            sgst: '0.00',
            igst: '1800.00',
            cess: '0.00',
          },
        ],
      },
    );
    expect(errorOf(await call(owner, 'post', '/finance/events', igst, U(unit.id))).code).toBe(
      'TAX_PAYLOAD_MISMATCH',
    );
    // cancel event: register row cancelled, journal reversed
    const cancel = await call(
      owner,
      'post',
      '/finance/events',
      {
        ...body,
        event: 'SALES_INVOICE_CANCELLED',
        payload: { ...body.payload, reason: 'Invoice cancelled by sales', reverses: 'x' },
      },
      U(unit.id),
    );
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect((await prisma.journal.findUniqueOrThrow({ where: { id: j.id } })).status).toBe(
      'Cancelled',
    );
    const after = dataOf<{ totals: Record<string, string>; rows: { status: string }[] }>(
      await call(
        owner,
        'get',
        `/finance/tax/sales-register?from=2026-04-01&to=${today}`,
        undefined,
        U(unit.id),
      ),
    );
    expect(after.rows[0]?.status).toBe('Cancelled');
    expect(after.totals.taxable).toBe('0.00');
  });

  it('GST is booked only against real GSTINs: a wrong check character, a state mismatch, a unit with no GSTIN, and ITC without a supplier GSTIN are refused', async () => {
    const withGstin = await freshUnit(gstinFor('27'));
    const noGstin = await freshUnit();
    const cust = await mkCustomer();
    const wrongCheck = gstinFor('27').slice(0, 14) + '0';
    const bad1 = await call(
      owner,
      'post',
      '/finance/events',
      salesEvent(withGstin.unit.id, cust.id, {}, { partyGstin: wrongCheck }),
      U(withGstin.unit.id),
    );
    expect(bad1.status).toBe(422);
    expect(errorOf(bad1).code).toBe('GSTIN_CHECKSUM');
    const bad2 = await call(
      owner,
      'post',
      '/finance/events',
      salesEvent(withGstin.unit.id, cust.id, {}, { partyStateCode: '29' }),
      U(withGstin.unit.id),
    );
    expect(errorOf(bad2).code).toBe('GSTIN_STATE_MISMATCH');
    const bad3 = await call(
      owner,
      'post',
      '/finance/events',
      salesEvent(noGstin.unit.id, cust.id),
      U(noGstin.unit.id),
    );
    expect(bad3.status).toBe(422);
    expect(errorOf(bad3).code).toBe('GSTIN_REQUIRED');
    // B2C to an unregistered buyer is fine (no party GSTIN), as long as the unit has its own
    const b2c = salesEvent(withGstin.unit.id, cust.id);
    delete (b2c.payload.tax as Record<string, unknown>).partyGstin;
    expect((await call(owner, 'post', '/finance/events', b2c, U(withGstin.unit.id))).status).toBe(
      200,
    );
    // input tax credit needs the supplier's GSTIN
    const sup = await mkSupplier();
    const cc = await prisma.costCenter.findUniqueOrThrow({ where: { code: 'TAL-PROD' } });
    const purchase = (gstin?: string) => ({
      event: 'PURCHASE_INVOICE_POSTED',
      docType: 'purchase-invoices',
      docId: crypto.randomUUID(),
      docDate: today,
      unitId: withGstin.unit.id,
      voucherType: 'Purchase Invoice',
      payload: {
        docNo: `PI-${rid()}`,
        dueDate: today,
        partyId: sup.id,
        lines: [
          { account: 'PURCHASE_EXPENSE', debit: '10000.00', credit: '0.00', costCenter: cc.code },
          { account: 'INPUT_CGST', debit: '900.00', credit: '0.00' },
          { account: 'INPUT_SGST', debit: '900.00', credit: '0.00' },
          { account: 'AP_CONTROL', debit: '0.00', credit: '11800.00' },
        ],
        tax: {
          direction: 'INWARD',
          docKind: 'INV',
          partyName: 'Steel Traders',
          ...(gstin ? { partyGstin: gstin, partyStateCode: '27' } : {}),
          placeOfSupplyStateCode: '27',
          lines: [
            {
              hsn: '720110',
              taxable: '10000.00',
              rate: '18',
              cgst: '900.00',
              sgst: '900.00',
              igst: '0.00',
              cess: '0.00',
            },
          ],
        },
      },
    });
    const noItc = await call(owner, 'post', '/finance/events', purchase(), U(withGstin.unit.id));
    expect(errorOf(noItc).code).toBe('GSTIN_REQUIRED');
    const okp = await call(
      owner,
      'post',
      '/finance/events',
      purchase(gstinFor('27')),
      U(withGstin.unit.id),
    );
    expect(okp.status, JSON.stringify(okp.body)).toBe(200);
    const preg = dataOf<{ rows: { partyName: string; cgst: string }[] }>(
      await call(
        owner,
        'get',
        `/finance/tax/purchase-register?from=2026-04-01&to=${today}`,
        undefined,
        U(withGstin.unit.id),
      ),
    );
    expect(preg.rows).toHaveLength(1);
    expect(preg.rows[0]).toMatchObject({ partyName: 'Steel Traders', cgst: '900.00' });
    expect(
      (await call(null, 'get', '/finance/tax/purchase-register?from=2026-04-01&to=2026-11-06'))
        .status,
    ).toBe(401);
    expect(
      (await call(owner, 'get', '/finance/tax/sales-register?from=bad&to=2026-11-06')).status,
    ).toBe(422);
  });

  it('TDS deducted on a purchase is recorded as sent, deposited with a challan (Dr TDS Payable / Cr bank), and then locked', async () => {
    const { unit } = await freshUnit(gstinFor('27'));
    const sup = await mkSupplier('TDS Contractor');
    const bank = await funded(unit.id, '50000.00');
    const cc = await prisma.costCenter.findUniqueOrThrow({ where: { code: 'TAL-PROD' } });
    const docId = crypto.randomUUID();
    const body = (tds: string) => ({
      event: 'PURCHASE_INVOICE_POSTED',
      docType: 'purchase-invoices',
      docId,
      docDate: today,
      unitId: unit.id,
      voucherType: 'Purchase Invoice',
      payload: {
        docNo: `JW-${rid()}`,
        dueDate: today,
        partyId: sup.id,
        lines: [
          { account: 'PURCHASE_EXPENSE', debit: '100000.00', credit: '0.00', costCenter: cc.code },
          { account: 'AP_CONTROL', debit: '0.00', credit: '98000.00' },
          { account: 'TDS_PAYABLE', debit: '0.00', credit: '2000.00' },
        ],
        tds: { sectionCode: '194C', baseAmount: '100000.00', ratePct: '2', tdsAmount: tds },
      },
    });
    const wrong = await call(owner, 'post', '/finance/events', body('1500.00'), U(unit.id));
    expect(errorOf(wrong).code).toBe('TAX_PAYLOAD_MISMATCH');
    const ok = await call(owner, 'post', '/finance/events', body('2000.00'), U(unit.id));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const reg = dataOf<{
      totalDeducted: string;
      pendingDeposit: string;
      rows: { id: string; sectionCode: string; supplier: string; challanNo: string | null }[];
    }>(
      await call(
        owner,
        'get',
        `/finance/tax/tds-register?from=2026-04-01&to=${today}`,
        undefined,
        U(unit.id),
      ),
    );
    expect(reg).toMatchObject({ totalDeducted: '2000.00', pendingDeposit: '2000.00' });
    expect(reg.rows[0]).toMatchObject({
      sectionCode: '194C',
      supplier: 'TDS Contractor',
      challanNo: null,
    });
    expect(
      dataOf<{ rows: unknown[] }>(
        await call(
          owner,
          'get',
          `/finance/tax/tcs-register?from=2026-04-01&to=${today}`,
          undefined,
          U(unit.id),
        ),
      ).rows,
    ).toHaveLength(0);

    const dep = {
      unitId: unit.id,
      taxKind: 'TDS',
      bankAccountId: bank.bankId,
      paidOn: today,
      challanNo: `CH-${rid()}`,
      bsrCode: '0510308',
      entryIds: [reg.rows[0]!.id],
    };
    expect((await call(emp, 'post', '/finance/tax/challans', dep)).status).toBe(403);
    expect(
      (
        await call(owner, 'post', '/finance/tax/challans', {
          ...dep,
          entryIds: ['00000000-0000-4000-8000-000000000000'],
        })
      ).status,
    ).toBe(422);
    const paid = await call(owner, 'post', '/finance/tax/challans', dep);
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect(dataOf<{ amount: string; entries: number }>(paid)).toMatchObject({
      amount: '2000.00',
      entries: 1,
    });
    const payable = await prisma.$queryRaw<{ n: string }[]>`
      SELECT COALESCE(SUM(g.credit - g.debit),0)::text AS n FROM gl_entries g JOIN accounts a ON a.id = g.account_id WHERE a.code = '2311' AND g.unit_id = ${unit.id}::uuid`;
    expect(payable[0]?.n).toBe('0.00'); // deducted and deposited: nothing left payable
    expect((await call(owner, 'post', '/finance/tax/challans', dep)).status).toBe(409); // challan number used again
    expect(
      errorOf(
        await call(owner, 'post', '/finance/tax/challans', { ...dep, challanNo: `CH-${rid()}` }),
      ).code,
    ).toBe('CHALLAN_MISMATCH'); // already deposited
    const after = dataOf<{ pendingDeposit: string; rows: { challanNo: string | null }[] }>(
      await call(
        owner,
        'get',
        `/finance/tax/tds-register?from=2026-04-01&to=${today}`,
        undefined,
        U(unit.id),
      ),
    );
    expect(after.pendingDeposit).toBe('0.00');
    expect(after.rows[0]?.challanNo).toBe(dep.challanNo);
    const challans = dataOf<{ challanNo: string; amount: string }[]>(
      await call(owner, 'get', '/finance/tax/challans', undefined, U(unit.id)),
    );
    expect(challans[0]).toMatchObject({ challanNo: dep.challanNo, amount: '2000.00' });
    // the deduction is deposited: the purchase cannot be cancelled by an event any more
    const cancel = await call(
      owner,
      'post',
      '/finance/events',
      {
        ...body('2000.00'),
        event: 'PURCHASE_INVOICE_CANCELLED',
        payload: {
          ...body('2000.00').payload,
          reason: 'Supplier invoice withdrawn',
          reverses: 'x',
        },
      },
      U(unit.id),
    );
    expect(cancel.status).toBe(409);
    expect(errorOf(cancel).code).toBe('TDS_ALREADY_DEPOSITED');
  });
});
