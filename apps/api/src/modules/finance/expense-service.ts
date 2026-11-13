// Expense claims (05a flow, 05b expense_claims / expense_policies). An employee raises a claim (Draft); Submit
// sends it through the Phase 5 approval engine (document type `fin-expenses`); Approved posts
// Dr expense / Cr 2104 Employee Reimbursements Payable (party = the employee) in the same transaction; Pay settles
// that bill from a bank / cash book. Policy limits are DATA (expense_policies), edited by Finance.
import { recordAudit } from '../../core/audit/audit-service';
import type { Db } from '../../core/db/prisma';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
import { registerApprovalHandler } from '../approvals/handlers';
import type { ApprovalDocHandler, DocSnapshot } from '../approvals/handlers';
import { approvalService } from '../approvals/service';
import type { ApprovalCaller } from '../approvals/service';
import type { Actor } from './accounts-service';
import { cashBankService } from './cash-bank-service';
import { FinErrors } from './errors';
import { D, isoDate, money, parseMoney, ZERO } from './money';
import { PostingService } from './posting-service';

export const EXPENSE_DOC_TYPE = 'fin-expenses';

interface ClaimRow {
  id: string;
  unit_id: string;
  fy_id: string;
  code: string;
  employee_id: string;
  claim_date: Date;
  category: string;
  expense_account_id: string;
  cost_center_id: string | null;
  amount: string;
  description: string;
  bill_no: string | null;
  status: string;
  journal_id: string | null;
  payment_id: string | null;
  warnings: unknown;
  version: number;
  created_by_id: string;
}
const COLS = `id, unit_id, fy_id, code, employee_id, claim_date, category, expense_account_id, cost_center_id, amount::text,
  description, bill_no, status, journal_id, payment_id, warnings, version, created_by_id`;

const dto = (r: ClaimRow, employee?: string | null) => ({
  id: r.id,
  unitId: r.unit_id,
  code: r.code,
  employeeId: r.employee_id,
  employee: employee ?? null,
  claimDate: isoDate(r.claim_date),
  category: r.category,
  expenseAccountId: r.expense_account_id,
  costCenterId: r.cost_center_id,
  amount: money(r.amount),
  description: r.description,
  billNo: r.bill_no,
  status: r.status,
  journalId: r.journal_id,
  paymentId: r.payment_id,
  warnings: r.warnings as { code: string; message: string }[],
  version: r.version,
});

async function loadClaim(db: Db, id: string): Promise<ClaimRow> {
  // unpaginated: rows of one parent (id)
  const rows = await db.$queryRawUnsafe<ClaimRow[]>(
    `SELECT ${COLS} FROM expense_claims WHERE id = $1::uuid AND deleted_at IS NULL`,
    id,
  );
  if (!rows[0]) throw Errors.notFound('Expense claim not found.');
  return rows[0];
}

export interface ClaimInput {
  unitId: string;
  employeeId?: string;
  claimDate: string;
  category: string;
  expenseAccountId?: string;
  costCenterId?: string | null;
  amount: string;
  description: string;
  billNo?: string | null;
}

export const expenseService = {
  async policies() {
    // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
    const rows = await prisma.$queryRaw<
      {
        category: string;
        per_claim_limit: string;
        per_month_limit: string;
        approval_limit: string;
        default_account_id: string | null;
        version: number;
      }[]
    >`
      SELECT category, per_claim_limit::text, per_month_limit::text, approval_limit::text, default_account_id, version FROM expense_policies ORDER BY category`;
    return rows.map((r) => ({
      category: r.category,
      perClaimLimit: money(r.per_claim_limit),
      perMonthLimit: money(r.per_month_limit),
      approvalLimit: money(r.approval_limit),
      defaultAccountId: r.default_account_id,
      version: r.version,
    }));
  },

  async setPolicy(
    category: string,
    version: number,
    p: {
      perClaimLimit: string;
      perMonthLimit: string;
      approvalLimit: string;
      defaultAccountId?: string | null;
    },
    actor: Actor,
  ) {
    const a = parseMoney(p.perClaimLimit, 'perClaimLimit');
    const m = parseMoney(p.perMonthLimit, 'perMonthLimit');
    const l = parseMoney(p.approvalLimit, 'approvalLimit');
    if (a.isNegative() || m.isNegative() || l.isNegative())
      throw Errors.validation({ perClaimLimit: 'Limits cannot be negative.' });
    if (l.lessThan(a))
      throw Errors.validation({
        approvalLimit: 'The hard limit must be at least the per-claim limit.',
      });
    const n =
      await prisma.$executeRaw`UPDATE expense_policies SET per_claim_limit = ${a.toFixed(2)}::numeric, per_month_limit = ${m.toFixed(2)}::numeric,
      approval_limit = ${l.toFixed(2)}::numeric, default_account_id = ${p.defaultAccountId ?? null}::uuid, version = version + 1, updated_at = now(), updated_by_id = ${actor.userId}::uuid
      WHERE category = ${category} AND version = ${version}`;
    if (n !== 1) throw Errors.versionConflict();
    await recordAudit({
      action: 'EXPENSE_POLICY_CHANGED',
      actorId: actor.userId,
      targetType: 'ExpensePolicy',
      targetId: null,
      ...(actor.meta ? { meta: actor.meta } : {}),
      detail: { category },
    });
    return (await expenseService.policies()).find((x) => x.category === category);
  },

  async list(q: {
    unitId: string | null;
    employeeId?: string | null;
    status?: string;
    page: number;
    size: number;
  }) {
    const rows = await prisma.$queryRawUnsafe<(ClaimRow & { employee: string; total: bigint })[]>(
      `SELECT ${COLS.split(',')
        .map((c) => `c.${c.trim()}`)
        .join(', ')}, u.name AS employee, COUNT(*) OVER()::bigint AS total
         FROM expense_claims c JOIN users u ON u.id = c.employee_id
        WHERE c.deleted_at IS NULL AND ($1::uuid IS NULL OR c.unit_id = $1::uuid) AND ($2::uuid IS NULL OR c.employee_id = $2::uuid) AND ($3::text IS NULL OR c.status = $3)
        ORDER BY c.claim_date DESC, c.created_at DESC LIMIT $4 OFFSET $5`,
      q.unitId,
      q.employeeId ?? null,
      q.status ?? null,
      q.size,
      (q.page - 1) * q.size,
    );
    return { total: Number(rows[0]?.total ?? 0), rows: rows.map((r) => dto(r, r.employee)) };
  },

  async get(id: string) {
    const r = await loadClaim(prisma, id);
    const u = await prisma.user.findUnique({
      where: { id: r.employee_id },
      select: { name: true },
    });
    return dto(r, u?.name);
  },

  async create(input: ClaimInput, actor: Actor, canActForOthers: boolean) {
    const amount = parseMoney(input.amount, 'amount');
    if (!amount.greaterThan(0))
      throw Errors.validation({ amount: 'Enter an amount greater than 0.' });
    if (input.description.trim().length < 3)
      throw Errors.validation({ description: 'Say what the expense was for.' });
    const employeeId = input.employeeId && canActForOthers ? input.employeeId : actor.userId;
    return prisma.$transaction(async (tx) => {
      // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
      const policy = await tx.$queryRaw<
        {
          category: string;
          per_claim_limit: string;
          per_month_limit: string;
          approval_limit: string;
          default_account_id: string | null;
        }[]
      >`
        SELECT category, per_claim_limit::text, per_month_limit::text, approval_limit::text, default_account_id FROM expense_policies WHERE category = ${input.category}`;
      const pol = policy[0];
      if (!pol) throw Errors.validation({ category: 'Choose a category from the list.' });
      const emp = await tx.user.findFirst({ where: { id: employeeId, status: 'ACTIVE' } });
      if (!emp) throw Errors.validation({ employeeId: 'The employee is not active.' });
      const accountId = input.expenseAccountId ?? pol.default_account_id;
      if (!accountId) throw Errors.validation({ expenseAccountId: 'Choose the expense account.' });
      const acct = await tx.account.findFirst({
        where: {
          id: accountId,
          deletedAt: null,
          status: 'Active',
          isGroup: false,
          rootType: 'Expense',
        },
      });
      if (!acct) throw Errors.validation({ expenseAccountId: 'Choose an expense account.' });
      if (acct.costCenterRequired && !input.costCenterId)
        throw FinErrors.costCenterRequired(`Account ${acct.code} needs a cost centre.`, {
          costCenterId: 'Choose a cost centre.',
        });
      const d = new Date(`${input.claimDate}T00:00:00Z`);
      const fy = await tx.financialYear.findFirst({
        where: { startDate: { lte: d }, endDate: { gte: d } },
      });
      if (!fy)
        throw FinErrors.noPeriod('No financial year covers this date.', {
          claimDate: 'No financial year covers this date.',
        });
      // policy: above the hard limit is refused; above the per-claim / per-month limit is allowed with a visible warning
      const warnings: { code: string; message: string }[] = [];
      if (amount.greaterThan(pol.approval_limit)) {
        throw FinErrors.expenseLimit(
          `A ${input.category} claim cannot be more than ${money(pol.approval_limit)}. Split the claim or ask Finance.`,
          { amount: `At most ${money(pol.approval_limit)}.` },
        );
      }
      if (amount.greaterThan(pol.per_claim_limit))
        warnings.push({
          code: 'OVER_CLAIM_LIMIT',
          message: `Above the ${money(pol.per_claim_limit)} limit for ${input.category}; the approver will see this.`,
        });
      const month = input.claimDate.slice(0, 7);
      // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
      const used = await tx.$queryRaw<{ s: string }[]>`
        SELECT COALESCE(SUM(amount), 0)::text AS s FROM expense_claims
         WHERE employee_id = ${employeeId}::uuid AND category = ${input.category} AND deleted_at IS NULL
           AND status NOT IN ('Rejected','Cancelled') AND to_char(claim_date, 'YYYY-MM') = ${month}`;
      if (
        D(used[0]?.s ?? 0)
          .plus(amount)
          .greaterThan(pol.per_month_limit)
      ) {
        warnings.push({
          code: 'OVER_MONTH_LIMIT',
          message: `With this claim the month's ${input.category} total passes ${money(pol.per_month_limit)}.`,
        });
      }
      const rows = await tx.$queryRawUnsafe<ClaimRow[]>(
        `INSERT INTO expense_claims (unit_id, fy_id, code, employee_id, claim_date, category, expense_account_id, cost_center_id, amount, description, bill_no, warnings, created_by_id)
         VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::date, $6, $7::uuid, $8::uuid, $9::numeric, $10, $11, $12::jsonb, $13::uuid) RETURNING ${COLS}`,
        input.unitId,
        fy.id,
        `DRAFT-${Math.random().toString(16).slice(2, 10)}`,
        employeeId,
        input.claimDate,
        input.category,
        accountId,
        input.costCenterId ?? null,
        amount.toFixed(2),
        input.description.trim(),
        input.billNo ?? null,
        JSON.stringify(warnings),
        actor.userId,
      );
      const r = rows[0] as ClaimRow;
      // the claim number is gap-free: taken now from the Expense series
      const code = await NumberingService.allocate(tx, {
        pageId: 'EXP',
        unitId: input.unitId,
        fyId: fy.id,
        date: input.claimDate,
      });
      await tx.$executeRaw`UPDATE expense_claims SET code = ${code} WHERE id = ${r.id}::uuid`;
      await recordAudit(
        {
          action: 'EXPENSE_CREATED',
          actorId: actor.userId,
          targetType: 'ExpenseClaim',
          targetId: r.id,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { code, amount: money(amount), category: input.category },
        },
        tx,
      );
      return dto({ ...r, code }, emp.name);
    });
  },

  async update(
    id: string,
    version: number,
    patch: {
      description?: string;
      amount?: string;
      billNo?: string | null;
      costCenterId?: string | null;
    },
    actor: Actor,
  ) {
    return prisma.$transaction(async (tx) => {
      const r = await loadClaim(tx, id);
      if (r.version !== version) throw Errors.versionConflict();
      if (!['Draft', 'Rejected'].includes(r.status))
        throw FinErrors.notDraft('Only a Draft or Rejected claim can be edited.');
      const amount = patch.amount !== undefined ? parseMoney(patch.amount, 'amount') : D(r.amount);
      if (!amount.greaterThan(0))
        throw Errors.validation({ amount: 'Enter an amount greater than 0.' });
      const pol = (
        // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
        await tx.$queryRaw<
          { approval_limit: string }[]
        >`SELECT approval_limit::text FROM expense_policies WHERE category = ${r.category}`
      )[0];
      if (pol && amount.greaterThan(pol.approval_limit))
        throw FinErrors.expenseLimit(
          `A ${r.category} claim cannot be more than ${money(pol.approval_limit)}.`,
          { amount: `At most ${money(pol.approval_limit)}.` },
        );
      const n =
        await tx.$executeRaw`UPDATE expense_claims SET amount = ${amount.toFixed(2)}::numeric, description = ${patch.description?.trim() ?? r.description},
        bill_no = ${patch.billNo === undefined ? r.bill_no : patch.billNo}, cost_center_id = ${patch.costCenterId === undefined ? r.cost_center_id : patch.costCenterId}::uuid,
        status = 'Draft', version = version + 1, updated_at = now(), updated_by_id = ${actor.userId}::uuid WHERE id = ${id}::uuid AND version = ${version}`;
      if (n !== 1) throw Errors.versionConflict();
      return dto(await loadClaim(tx, id));
    });
  },

  async remove(id: string, actor: Actor) {
    await prisma.$transaction(async (tx) => {
      const r = await loadClaim(tx, id);
      if (r.status !== 'Draft') throw FinErrors.notDraft('Only a Draft claim can be deleted.');
      await tx.$executeRaw`UPDATE expense_claims SET deleted_at = now(), deleted_by_id = ${actor.userId}::uuid, version = version + 1 WHERE id = ${id}::uuid`;
    });
  },

  async submit(caller: ApprovalCaller, id: string, version: number) {
    const r = await loadClaim(prisma, id);
    if (r.version !== version) throw Errors.versionConflict();
    return approvalService.submit(caller, EXPENSE_DOC_TYPE, id, { docVersion: version });
  },

  /** Pay an approved claim from a cash / bank book; the claim's bill is settled by the payment. */
  async pay(
    id: string,
    version: number,
    p: { bankAccountId: string; mode: string; docDate: string },
    actor: Actor,
  ) {
    return prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM expense_claims WHERE id = ${id}::uuid FOR UPDATE`;
        const r = await loadClaim(tx, id);
        if (r.version !== version) throw Errors.versionConflict();
        if (r.status !== 'Approved' || !r.journal_id)
          throw FinErrors.invalidTransition('Only an approved claim can be paid.');
        const item = (
          // unpaginated: rows of one parent (journal_id)
          await tx.$queryRaw<{ id: string; outstanding: string }[]>`
          SELECT id, outstanding::text FROM open_items WHERE journal_id = ${r.journal_id}::uuid AND party_id = ${r.employee_id}::uuid AND status <> 'Cancelled'`
        )[0];
        if (!item) throw FinErrors.invalidTransition('The claim has no open bill to settle.');
        const out = await cashBankService.createPaymentIn(
          tx,
          {
            kind: 'PAYMENT',
            docDate: p.docDate,
            bankAccountId: p.bankAccountId,
            employeeId: r.employee_id,
            amount: money(item.outstanding),
            mode: p.mode as 'NEFT' | 'RTGS' | 'IMPS' | 'UPI' | 'Cheque' | 'Cash',
            narration: `Expense claim ${r.code}`,
            allocations: [{ itemId: item.id, amount: money(item.outstanding) }],
          },
          actor,
        );
        await tx.$executeRaw`UPDATE expense_claims SET status = 'Paid', payment_id = ${out.payment.id}::uuid, version = version + 1, updated_at = now(), updated_by_id = ${actor.userId}::uuid WHERE id = ${id}::uuid`;
        await recordAudit(
          {
            action: 'EXPENSE_PAID',
            actorId: actor.userId,
            targetType: 'ExpenseClaim',
            targetId: id,
            ...(actor.meta ? { meta: actor.meta } : {}),
            detail: { code: r.code, payment: out.payment.code },
          },
          tx,
        );
        return dto(await loadClaim(tx, id));
      },
      { maxWait: 15_000, timeout: 30_000 },
    );
  },

  /** Cancel an approved, unpaid claim: its journal is reversed. */
  async cancel(id: string, version: number, reason: string, actor: Actor) {
    return prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM expense_claims WHERE id = ${id}::uuid FOR UPDATE`;
        const r = await loadClaim(tx, id);
        if (r.version !== version) throw Errors.versionConflict();
        if (r.status === 'Paid')
          throw FinErrors.invalidTransition(
            'A paid claim cannot be cancelled. Cancel its payment first.',
          );
        if (r.status !== 'Approved' || !r.journal_id)
          throw FinErrors.invalidTransition('Only an approved claim can be cancelled.');
        await PostingService.reverse(tx, r.journal_id, reason, actor, {
          reversalDate: isoDate(r.claim_date),
        });
        await tx.$executeRaw`UPDATE expense_claims SET status = 'Cancelled', version = version + 1, updated_at = now(), updated_by_id = ${actor.userId}::uuid WHERE id = ${id}::uuid`;
        await recordAudit(
          {
            action: 'EXPENSE_CANCELLED',
            actorId: actor.userId,
            targetType: 'ExpenseClaim',
            targetId: id,
            ...(actor.meta ? { meta: actor.meta } : {}),
            detail: { reason },
          },
          tx,
        );
        return dto(await loadClaim(tx, id));
      },
      { maxWait: 15_000, timeout: 30_000 },
    );
  },
};

// ---------------------------------------------------------------------------------------------------------
const handler: ApprovalDocHandler = {
  async snapshot(tx, docId): Promise<DocSnapshot | null> {
    const lock = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM expense_claims WHERE id = ${docId}::uuid AND deleted_at IS NULL FOR UPDATE`;
    if (!lock[0]) return null;
    const r = await loadClaim(tx, docId);
    const fy = await tx.financialYear.findUniqueOrThrow({
      where: { id: r.fy_id },
      select: { status: true },
    });
    const control = await tx.moduleControl.findUnique({
      where: { pageId: EXPENSE_DOC_TYPE },
      select: { ownerDepartment: true },
    });
    return {
      code: r.code,
      title: 'Expense claim',
      amount: r.amount,
      department: control?.ownerDepartment ?? 'Finance',
      unitId: r.unit_id,
      createdBy: r.created_by_id,
      status: r.status === 'Rejected' ? 'Rejected' : r.status,
      version: r.version,
      fyOpen: fy.status === 'OPEN',
    };
  },
  async onSubmitted(tx, docId) {
    await tx.$executeRaw`UPDATE expense_claims SET status = 'Pending Approval', version = version + 1 WHERE id = ${docId}::uuid`;
  },
  async onApproved(tx, docId, req) {
    const r = await loadClaim(tx, docId);
    const control = await tx.account.findUniqueOrThrow({ where: { code: '2104' } });
    const amount = money(r.amount);
    const posted = await PostingService.postJournal(
      tx,
      {
        unitId: r.unit_id,
        docDate: isoDate(r.claim_date),
        voucherType: 'Expense',
        source: 'EXPENSE',
        narration: `${r.category}: ${r.description}`.slice(0, 300),
        sourceDocType: EXPENSE_DOC_TYPE,
        sourceDocId: r.id,
        sourceDocNo: r.code,
        approvedById: req.actorId,
        lines: [
          {
            accountId: r.expense_account_id,
            debit: amount,
            credit: '0.00',
            ...(r.cost_center_id ? { costCenterId: r.cost_center_id } : {}),
            narration: r.description.slice(0, 300),
          },
          {
            accountId: control.id,
            debit: '0.00',
            credit: amount,
            partyType: 'EMPLOYEE',
            partyId: r.employee_id,
            billMode: 'NEW',
            billItemType: 'INVOICE',
            billDocNo: r.code,
            ...(r.bill_no ? { narration: `Bill ${r.bill_no}` } : {}),
          },
        ],
      },
      { userId: req.actorId },
    );
    await tx.$executeRaw`UPDATE expense_claims SET status = 'Approved', journal_id = ${posted.id}::uuid, version = version + 1 WHERE id = ${docId}::uuid`;
    await recordAudit(
      {
        action: 'EXPENSE_APPROVED',
        actorId: req.actorId,
        targetType: 'ExpenseClaim',
        targetId: docId,
        detail: { code: r.code },
      },
      tx,
    );
  },
  async onRejected(tx, docId) {
    await tx.$executeRaw`UPDATE expense_claims SET status = 'Rejected', version = version + 1 WHERE id = ${docId}::uuid`;
  },
  async onReturned(tx, docId) {
    await tx.$executeRaw`UPDATE expense_claims SET status = 'Draft', version = version + 1 WHERE id = ${docId}::uuid`;
  },
};
registerApprovalHandler(EXPENSE_DOC_TYPE, handler);
export { ZERO };
