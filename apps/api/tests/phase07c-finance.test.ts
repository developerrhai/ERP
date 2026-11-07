// Phase 07 part 3: the approval limits are an administrator setting (screen: System Setup > Finance Approval
// Limits). Journals and credit / debit notes use them: unset = never asks; set = from that amount the document
// goes through the Phase 5 approval engine and is posted when approved.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { API, errorOf, makeUser, newApp, prisma, signIn, signInOwner } from './helpers';
import type { Signed } from './helpers';
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
type M = 'get' | 'post' | 'put' | 'delete';
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
const IM = (version: number) => ({ 'If-Match': `"${version}"` });
const acc = async (code: string) =>
  (await prisma.account.findUniqueOrThrow({ where: { code } })).id;
const clearLimits = () =>
  prisma.setting.deleteMany({
    where: { key: { in: ['fin.journal_approval_threshold', 'fin.note_approval_threshold'] } },
  });
async function mkCustomer() {
  const name = `Customer ${rid()}`;
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
  await clearLimits();
  // older suites reset the numbering series of the seeded units; move the finance series past any existing voucher
  await prisma.$executeRaw`INSERT INTO number_series (page_id, unit_id, fy_id, next_value)
    SELECT p.page_id, u.id, fy.id, 700000 FROM unnest(ARRAY['JV', 'CRN', 'DBN', 'EXP', 'PAY']) AS p(page_id), units u, financial_years fy
     WHERE u.code = 'TAL' AND fy.start_date <= CURRENT_DATE AND fy.end_date >= CURRENT_DATE
    ON CONFLICT (page_id, unit_id, fy_id) DO UPDATE SET next_value = GREATEST(number_series.next_value, 700000)`;
});
afterAll(async () => {
  await clearLimits();
  await prisma.$disconnect();
});

describe('Finance approval limits (administrator setting)', () => {
  it('401 without a token, 403 for people who are not administrators, owner reads nothing set', async () => {
    expect((await call(null, 'get', '/finance/approval-limits')).status).toBe(401);
    expect((await call(emp, 'get', '/finance/approval-limits')).status).toBe(403);
    expect(
      (await call(emp, 'put', '/finance/approval-limits', { journalApprovalThreshold: '1000' }))
        .status,
    ).toBe(403);
    expect(
      (await call(maker, 'put', '/finance/approval-limits', { journalApprovalThreshold: '1000' }))
        .status,
    ).toBe(403);
    expect(dataOf(await call(owner, 'get', '/finance/approval-limits'))).toEqual({
      journalApprovalThreshold: null,
      noteApprovalThreshold: null,
    });
  });

  it('validates, saves, audits, leaves the other limit alone and clears with null', async () => {
    expect(
      (await call(owner, 'put', '/finance/approval-limits', { journalApprovalThreshold: '-5' }))
        .status,
    ).toBe(422);
    expect(
      (await call(owner, 'put', '/finance/approval-limits', { journalApprovalThreshold: 'abc' }))
        .status,
    ).toBe(422);
    expect(
      (await call(owner, 'put', '/finance/approval-limits', { journalApprovalThreshold: '10.123' }))
        .status,
    ).toBe(422);
    expect(
      (await call(owner, 'put', '/finance/approval-limits', { somethingElse: 1 })).status,
    ).toBe(422);
    const a = await call(owner, 'put', '/finance/approval-limits', {
      journalApprovalThreshold: '500000',
      noteApprovalThreshold: '100000.50',
    });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(dataOf(a)).toEqual({
      journalApprovalThreshold: '500000.00',
      noteApprovalThreshold: '100000.50',
    });
    const b = await call(owner, 'put', '/finance/approval-limits', {
      journalApprovalThreshold: '750000',
    });
    expect(dataOf(b)).toEqual({
      journalApprovalThreshold: '750000.00',
      noteApprovalThreshold: '100000.50',
    });
    const c = await call(owner, 'put', '/finance/approval-limits', { noteApprovalThreshold: null });
    expect(dataOf(c)).toEqual({
      journalApprovalThreshold: '750000.00',
      noteApprovalThreshold: null,
    });
    const audit = await prisma.auditLog.findMany({
      where: { action: 'SETTINGS_UPDATED', actorId: owner.user.id },
    });
    expect(
      audit.filter((x) => JSON.stringify(x.detail).includes('finance-approval-limits')).length,
    ).toBeGreaterThanOrEqual(3);
    await clearLimits();
  });

  it('a journal asks for approval only from the amount the administrator set (set through the API)', async () => {
    const tal = await prisma.unit.findUniqueOrThrow({ where: { code: 'TAL' } });
    const cc = await prisma.costCenter.findUniqueOrThrow({ where: { code: 'TAL-PROD' } });
    const lines = async (amount: string) => [
      { accountId: await acc('6201'), debit: amount, credit: '0.00', costCenterId: cc.id },
      { accountId: await acc('1111'), debit: '0.00', credit: amount },
    ];
    const mk = async (amount: string) =>
      dataOf<{ id: string; version: number }>(
        await call(maker, 'post', '/finance/journals', {
          unitId: tal.id,
          docDate: today,
          lines: await lines(amount),
        }),
      );
    expect(
      (await call(owner, 'put', '/finance/approval-limits', { journalApprovalThreshold: '5000' }))
        .status,
    ).toBe(200);
    try {
      const small = await mk('4999.99');
      const s1 = await call(
        maker,
        'post',
        `/finance/journals/${small.id}/submit`,
        undefined,
        IM(small.version),
      );
      expect(dataOf<{ needsApproval: boolean }>(s1).needsApproval).toBe(false);
      const big = await mk('5000.00'); // the limit itself needs approval ("from")
      const s2 = await call(
        maker,
        'post',
        `/finance/journals/${big.id}/submit`,
        undefined,
        IM(big.version),
      );
      const d = dataOf<{ needsApproval: boolean; approval: { id: string; version: number } }>(s2);
      expect(d.needsApproval).toBe(true);
      expect(
        (
          await call(
            checker,
            'post',
            `/approvals/requests/${d.approval.id}/approve`,
            {},
            IM(d.approval.version),
          )
        ).status,
      ).toBe(200);
      expect((await prisma.journal.findUniqueOrThrow({ where: { id: big.id } })).status).toBe(
        'Posted',
      );
    } finally {
      await clearLimits();
    }
  });
});

describe('credit / debit notes above the limit', () => {
  const body = async (unitId: string, partyId: string, amount: string) => ({
    effect: 'REDUCE',
    unitId,
    partyId,
    docDate: today,
    counterAccountId: await acc('4108'),
    amount,
    reason: 'Agreed post-sale discount',
  });

  it('a small note is posted straight; a big one is submitted, approved by someone else and then posted', async () => {
    const tal = await prisma.unit.findUniqueOrThrow({ where: { code: 'TAL' } });
    const cust = await mkCustomer();
    expect(
      (await call(owner, 'put', '/finance/approval-limits', { noteApprovalThreshold: '500' }))
        .status,
    ).toBe(200);
    try {
      const small = dataOf<{ id: string; version: number }>(
        await call(maker, 'post', '/finance/credit-notes', await body(tal.id, cust.id, '499.99')),
      );
      const s1 = await call(
        maker,
        'post',
        `/finance/credit-notes/${small.id}/submit`,
        undefined,
        IM(small.version),
      );
      expect(dataOf<{ needsApproval: boolean }>(s1).needsApproval).toBe(false);
      expect(
        (await call(maker, 'post', `/finance/credit-notes/${small.id}/post`, {}, IM(small.version)))
          .status,
      ).toBe(200);

      const big = dataOf<{ id: string; version: number }>(
        await call(maker, 'post', '/finance/credit-notes', await body(tal.id, cust.id, '500.00')),
      );
      // posting directly is refused while the amount is at or above the limit
      const direct = await call(
        maker,
        'post',
        `/finance/credit-notes/${big.id}/post`,
        {},
        IM(big.version),
      );
      expect(direct.status).toBe(409);
      expect(errorOf(direct).message).toMatch(/approval limit/);
      const sub = await call(
        maker,
        'post',
        `/finance/credit-notes/${big.id}/submit`,
        undefined,
        IM(big.version),
      );
      expect(sub.status, JSON.stringify(sub.body)).toBe(200);
      const d = dataOf<{
        status: string;
        needsApproval: boolean;
        approval: { id: string; version: number };
      }>(sub);
      expect(d).toMatchObject({ status: 'Pending Approval', needsApproval: true });
      expect(
        (
          await call(
            maker,
            'post',
            `/approvals/requests/${d.approval.id}/approve`,
            {},
            IM(d.approval.version),
          )
        ).status,
      ).toBeGreaterThanOrEqual(400);
      const ok = await call(
        checker,
        'post',
        `/approvals/requests/${d.approval.id}/approve`,
        {},
        IM(d.approval.version),
      );
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const done = dataOf<{ status: string; code: string }>(
        await call(maker, 'get', `/finance/credit-notes/${big.id}`),
      );
      expect(done.status).toBe('Posted');
      expect(done.code).toMatch(/^CRN\//);
      expect(
        await prisma.openItem.count({
          where: { partyId: cust.id, itemType: 'CREDIT_NOTE', status: { not: 'Cancelled' } },
        }),
      ).toBe(2);
    } finally {
      await clearLimits();
    }
  });

  it('a rejected note can be deleted; with no limit set a debit note never asks for approval', async () => {
    const tal = await prisma.unit.findUniqueOrThrow({ where: { code: 'TAL' } });
    const cust = await mkCustomer();
    expect(
      (await call(owner, 'put', '/finance/approval-limits', { noteApprovalThreshold: '0' })).status,
    ).toBe(200); // 0 = every note
    try {
      const n = dataOf<{ id: string; version: number }>(
        await call(maker, 'post', '/finance/credit-notes', await body(tal.id, cust.id, '10.00')),
      );
      const sub = dataOf<{ approval: { id: string; version: number } }>(
        await call(maker, 'post', `/finance/credit-notes/${n.id}/submit`, undefined, IM(n.version)),
      );
      const rej = await call(
        checker,
        'post',
        `/approvals/requests/${sub.approval.id}/reject`,
        { comment: 'Please attach the agreement' },
        IM(sub.approval.version),
      );
      expect(rej.status, JSON.stringify(rej.body)).toBe(200);
      expect(
        dataOf<{ status: string }>(await call(maker, 'get', `/finance/credit-notes/${n.id}`))
          .status,
      ).toBe('Rejected');
      expect((await call(maker, 'delete', `/finance/credit-notes/${n.id}`)).status).toBe(204);
    } finally {
      await clearLimits();
    }
    const sup = await prisma.supplier.create({
      data: {
        code: `S${rid()}`,
        name: 'Debit Note Supplier',
        nameKey: `dn-${rid()}`,
        stateCode: '27',
        gstRegistrationType: 'UNREGISTERED',
        approvalStatus: 'APPROVED',
      },
    });
    const dn = dataOf<{ id: string; version: number }>(
      await call(maker, 'post', '/finance/debit-notes', {
        effect: 'REDUCE',
        unitId: tal.id,
        partyId: sup.id,
        docDate: today,
        counterAccountId: await acc('5111'),
        amount: '99999.00',
        reason: 'Rate correction on bill',
      }),
    );
    expect(
      dataOf<{ needsApproval: boolean }>(
        await call(
          maker,
          'post',
          `/finance/debit-notes/${dn.id}/submit`,
          undefined,
          IM(dn.version),
        ),
      ).needsApproval,
    ).toBe(false);
    expect(
      (await call(maker, 'post', `/finance/debit-notes/${dn.id}/post`, {}, IM(dn.version))).status,
    ).toBe(200);
  });
});
