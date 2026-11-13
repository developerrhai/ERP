// Cash and bank (05a §4.4, 05b §5.9, BR-FIN-10, BR-FIN-11): bank / cash books, supplier payments with bill
// allocation, other receipts, transfers between cash and bank, and the cash / bank book from the ledger.
// A payment document is created already Posted (the modal is the draft); undo = Cancel = reversal journal.
import type { Prisma } from '@prisma/client';
import { recordAudit } from '../../core/audit/audit-service';
import type { Db } from '../../core/db/prisma';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { Actor } from './accounts-service';
import { FinErrors } from './errors';
import { D, ZERO, isoDate, money, parseMoney } from './money';
import type { Dec } from './money';
import { openItemService } from './open-items-service';
import { PostingService } from './posting-service';
import type { PostLineInput, Warning } from './posting-service';
import { getSetting } from './settings';

type Mode = 'NEFT' | 'RTGS' | 'IMPS' | 'UPI' | 'Cheque' | 'Cash';

export interface BankAccountInput {
  unitId: string;
  accountId: string;
  kind: 'BANK' | 'CASH' | 'PETTY';
  name: string;
  bankName?: string | null;
  accountLast4?: string | null;
  ifsc?: string | null;
}

export interface PaymentInput {
  kind: 'PAYMENT' | 'RECEIPT' | 'TRANSFER';
  docDate: string;
  bankAccountId: string;
  /** PAYMENT to a supplier */
  supplierId?: string;
  /** reimbursement of an employee (expense claims, ledger account 2104) */
  employeeId?: string;
  /** RECEIPT / PAYMENT of another kind (refund, interest, loan, bank charge ...): the other side's ledger account */
  counterAccountId?: string;
  toBankAccountId?: string;
  amount: string;
  mode: Mode;
  referenceNo?: string;
  narration?: string;
  /** specific allocation of a supplier payment; omitted = FIFO */
  allocations?: { itemId: string; amount: string }[];
  allowAdvance?: boolean;
}

async function bankOf(db: Db, id: string) {
  const b = await db.bankAccount.findFirst({ where: { id, deletedAt: null } });
  if (!b) throw Errors.validation({ bankAccountId: 'Choose a cash or bank account.' });
  if (b.status !== 'Active')
    throw Errors.validation({ bankAccountId: 'This cash / bank account is inactive.' });
  return b;
}

export const cashBankService = {
  // ---- cash / bank accounts -------------------------------------------------------------------------------
  async listBankAccounts(q: { unitId?: string | null }) {
    const rows = await prisma.bankAccount.findMany({
      take: 500, // unpaginated: small lookup, max 500
      where: { deletedAt: null, ...(q.unitId ? { unitId: q.unitId } : {}) },
      orderBy: { name: 'asc' },
    });
    const accounts = await prisma.account.findMany({
      where: { id: { in: rows.map((r) => r.accountId) } },
      select: { id: true, code: true, name: true },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return rows.map((r) => ({
      ...r,
      accountCode: byId.get(r.accountId)?.code ?? null,
      accountName: byId.get(r.accountId)?.name ?? null,
    }));
  },

  async createBankAccount(input: BankAccountInput, actor: Actor) {
    return prisma.$transaction(async (tx) => {
      const acct = await tx.account.findFirst({
        where: { id: input.accountId, deletedAt: null, status: 'Active', isGroup: false },
      });
      if (!acct || !['Bank', 'Cash'].includes(acct.subType))
        throw Errors.validation({ accountId: 'Choose a Bank or Cash ledger account.' });
      if (acct.subType === 'Bank' && input.kind !== 'BANK')
        throw FinErrors.modeAccountMismatch('A Bank ledger account needs the kind Bank.', {
          kind: 'Choose Bank.',
        });
      if (acct.subType === 'Cash' && input.kind === 'BANK')
        throw FinErrors.modeAccountMismatch(
          'A Cash ledger account needs the kind Cash or Petty cash.',
          { kind: 'Choose Cash or Petty cash.' },
        );
      if (await tx.bankAccount.count({ where: { accountId: input.accountId, deletedAt: null } }))
        throw Errors.duplicate({
          accountId: 'This ledger account already has a cash / bank book.',
        });
      const created = await tx.bankAccount.create({
        data: {
          unitId: input.unitId,
          accountId: input.accountId,
          kind: input.kind,
          name: input.name,
          bankName: input.bankName ?? null,
          accountLast4: input.accountLast4 ?? null,
          ifsc: input.ifsc ?? null,
          createdById: actor.userId,
        },
      });
      await recordAudit(
        {
          action: 'BANK_ACCOUNT_CREATED',
          actorId: actor.userId,
          targetType: 'BankAccount',
          targetId: created.id,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { name: input.name },
        },
        tx,
      );
      return created;
    });
  },

  async updateBankAccount(
    id: string,
    version: number,
    patch: { name?: string; bankName?: string | null; status?: 'Active' | 'Inactive' },
    actor: Actor,
  ) {
    return prisma.$transaction(async (tx) => {
      const cur = await tx.bankAccount.findFirst({ where: { id, deletedAt: null } });
      if (!cur) throw Errors.notFound('Cash / bank account not found.');
      if (cur.version !== version) throw Errors.versionConflict();
      const res = await tx.bankAccount.updateMany({
        where: { id, version },
        data: {
          ...(patch.name ? { name: patch.name } : {}),
          ...(patch.bankName !== undefined ? { bankName: patch.bankName } : {}),
          ...(patch.status ? { status: patch.status } : {}),
          version: { increment: 1 },
          updatedById: actor.userId,
          updatedAt: new Date(),
        },
      });
      if (res.count !== 1) throw Errors.versionConflict();
      await recordAudit(
        {
          action: 'BANK_ACCOUNT_UPDATED',
          actorId: actor.userId,
          targetType: 'BankAccount',
          targetId: id,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: {},
        },
        tx,
      );
      return tx.bankAccount.findUniqueOrThrow({ where: { id } });
    });
  },

  // ---- documents ------------------------------------------------------------------------------------------
  async createPayment(input: PaymentInput, actor: Actor) {
    return prisma.$transaction((tx) => cashBankService.createPaymentIn(tx, input, actor), {
      maxWait: 15_000,
      timeout: 30_000,
    });
  },

  /** Same as createPayment, inside the caller's transaction (tax challans, expense payments). */
  async createPaymentIn(tx: Db, input: PaymentInput, actor: Actor) {
    const amount = parseMoney(input.amount, 'amount');
    if (!amount.greaterThan(0))
      throw Errors.validation({ amount: 'Enter an amount greater than 0.' });
    {
      {
        const bank = await bankOf(tx, input.bankAccountId);
        // BR-FIN-11 d: the mode must fit the kind of book
        if ((input.mode === 'Cash') !== (bank.kind === 'CASH' || bank.kind === 'PETTY')) {
          throw FinErrors.modeAccountMismatch(
            input.mode === 'Cash'
              ? 'A cash payment needs a Cash or Petty cash book.'
              : 'This mode needs a Bank account.',
            { mode: 'Does not fit the account.' },
          );
        }
        const unitId = bank.unitId;
        const warnings: Warning[] = [];
        const lines: PostLineInput[] = [];
        let voucherType: 'Payment' | 'Receipt' | 'Contra';
        let purpose: 'SUPPLIER' | 'OTHER' | 'TRANSFER';
        let partyType: 'SUPPLIER' | 'EMPLOYEE' | null = null;
        let supplierBills: { id: string; outstanding: Dec }[] = [];

        if (input.kind === 'TRANSFER') {
          if (!input.toBankAccountId)
            throw Errors.validation({ toBankAccountId: 'Choose the account to transfer to.' });
          const to = await bankOf(tx, input.toBankAccountId);
          if (to.id === bank.id)
            throw Errors.validation({ toBankAccountId: 'Choose a different account.' });
          if (to.unitId !== bank.unitId)
            throw Errors.validation({
              toBankAccountId:
                'Transfers between units are not supported yet. Use a journal with due-to / due-from lines.',
            });
          voucherType = 'Contra';
          purpose = 'TRANSFER';
          lines.push({
            accountId: to.accountId,
            debit: amount.toFixed(2),
            credit: '0.00',
            narration: input.narration ?? 'Transfer in',
          });
          lines.push({
            accountId: bank.accountId,
            debit: '0.00',
            credit: amount.toFixed(2),
            narration: input.narration ?? 'Transfer out',
          });
        } else if (input.kind === 'PAYMENT' && (input.supplierId || input.employeeId)) {
          voucherType = 'Payment';
          purpose = 'SUPPLIER';
          partyType = input.employeeId ? 'EMPLOYEE' : 'SUPPLIER';
          const supplier = input.employeeId
            ? null
            : await tx.supplier.findFirst({
                where: {
                  id: input.supplierId,
                  deletedAt: null,
                  status: 'ACTIVE',
                  approvalStatus: 'APPROVED',
                },
              });
          const employee = input.employeeId
            ? await tx.user.findFirst({ where: { id: input.employeeId, status: 'ACTIVE' } })
            : null;
          if (!supplier && !employee)
            throw Errors.validation({
              [input.employeeId ? 'employeeId' : 'supplierId']: input.employeeId
                ? 'Choose an active employee.'
                : 'Choose an active supplier.',
            });
          const party = supplier
            ? { id: supplier.id, name: supplier.name }
            : { id: (employee as { id: string }).id, name: (employee as { name: string }).name };
          const control = employee
            ? await tx.account.findUnique({ where: { code: '2104' } })
            : supplier!.apAccountId
              ? await tx.account.findUnique({ where: { id: supplier!.apAccountId } })
              : await tx.accountDefault
                  .findUnique({ where: { key: 'AP_TRADE' } })
                  .then((d) => (d ? tx.account.findUnique({ where: { id: d.accountId } }) : null));
          if (!control)
            throw FinErrors.unmappedKey('No payables account is set for this supplier.');
          supplierBills = (await openItemService.openBills(tx, 'PAYABLE', party.id, unitId))
            .filter((b) => D(b.outstanding).greaterThan(0))
            .map((b) => ({ id: b.id, outstanding: D(b.outstanding) }));
          // party line: the payment itself is a credit item (PAYMENT, or ADVANCE when nothing is allocated)
          const specific = input.allocations ?? null;
          const planned = specific
            ? specific.reduce((s, a) => s.plus(parseMoney(a.amount, 'allocations')), ZERO)
            : null;
          if (planned && planned.greaterThan(amount))
            throw FinErrors.overAllocation('The allocations are more than the payment.', {
              allocations: 'Reduce the allocations.',
            });
          const willAllocate = specific
            ? (planned as Dec)
            : Dec0(
                supplierBills.reduce((s, b) => s.plus(b.outstanding), ZERO),
                amount,
              );
          if (willAllocate.isZero() && !input.allowAdvance) {
            throw FinErrors.advanceNotConfirmed(
              'This payment matches no open bill. Confirm that it is an advance.',
              { allowAdvance: 'Confirm the advance.' },
            );
          }
          lines.push({
            accountId: control.id,
            debit: amount.toFixed(2),
            credit: '0.00',
            partyType,
            partyId: party.id,
            billMode: 'NEW',
            billItemType: willAllocate.isZero() ? 'ADVANCE' : 'PAYMENT',
            ...(input.narration ? { narration: input.narration } : {}),
          });
          lines.push({
            accountId: bank.accountId,
            debit: '0.00',
            credit: amount.toFixed(2),
            narration: input.narration ?? `Payment to ${party.name}`,
          });
          // BR-FIN-11 b: cash paid to one party in one day above the limit is a warning (Income-tax disallowance risk)
          if (input.mode === 'Cash') {
            const limit = D(
              await getSetting<string>(tx, 'fin.cash_payment_limit_per_day', '10000.00'),
            );
            // unpaginated: single-row SUM() aggregate
            const rows = await tx.$queryRaw<{ s: string }[]>`
            SELECT COALESCE(SUM(amount), 0)::text AS s FROM payments
             WHERE kind = 'PAYMENT' AND mode = 'Cash' AND status = 'Posted' AND party_id = ${party.id}::uuid AND doc_date = ${input.docDate}::date`;
            const dayTotal = D(rows[0]?.s ?? 0).plus(amount);
            if (dayTotal.greaterThan(limit))
              warnings.push({
                code: 'CASH_LIMIT_PAYMENT',
                message: `Cash paid to this supplier today is ${money(dayTotal)}, above ${money(limit)}.`,
                dayTotal: money(dayTotal),
                limit: money(limit),
              });
          }
        } else {
          // other receipts / payments: the other side is a ledger account (refund, interest, loan, bank charge ...)
          if (!input.counterAccountId)
            throw Errors.validation({ counterAccountId: 'Choose the account for the other side.' });
          const counter = await tx.account.findFirst({
            where: { id: input.counterAccountId, deletedAt: null },
          });
          if (!counter)
            throw Errors.validation({ counterAccountId: 'Choose the account for the other side.' });
          if (counter.partyRequired)
            throw Errors.validation({
              counterAccountId:
                'Customer and supplier accounts are not used here: use a customer receipt or a supplier payment.',
            });
          if (counter.id === bank.accountId)
            throw Errors.validation({ counterAccountId: 'Choose a different account.' });
          purpose = 'OTHER';
          if (input.kind === 'RECEIPT') {
            voucherType = 'Receipt';
            if (input.mode === 'Cash') {
              const limit = D(
                await getSetting<string>(tx, 'fin.cash_receipt_limit_per_day', '200000.00'),
              );
              // unpaginated: single-row SUM() aggregate
              const rows = await tx.$queryRaw<{ s: string }[]>`
              SELECT COALESCE(SUM(amount), 0)::text AS s FROM payments
               WHERE kind = 'RECEIPT' AND mode = 'Cash' AND status = 'Posted' AND bank_account_id = ${bank.id}::uuid AND doc_date = ${input.docDate}::date`;
              if (
                D(rows[0]?.s ?? 0)
                  .plus(amount)
                  .greaterThanOrEqualTo(limit)
              ) {
                throw FinErrors.cashReceiptLimit(
                  `Cash receipts of ${money(limit)} or more in a day are not allowed.`,
                  { amount: 'Receive this by bank.' },
                );
              }
            }
            lines.push({
              accountId: bank.accountId,
              debit: amount.toFixed(2),
              credit: '0.00',
              narration: input.narration ?? 'Receipt',
            });
            lines.push({
              accountId: counter.id,
              debit: '0.00',
              credit: amount.toFixed(2),
              narration: input.narration ?? 'Receipt',
            });
          } else {
            voucherType = 'Payment';
            lines.push({
              accountId: counter.id,
              debit: amount.toFixed(2),
              credit: '0.00',
              narration: input.narration ?? 'Payment',
            });
            lines.push({
              accountId: bank.accountId,
              debit: '0.00',
              credit: amount.toFixed(2),
              narration: input.narration ?? 'Payment',
            });
          }
        }

        const fy = await tx.financialYear.findFirst({
          where: {
            startDate: { lte: new Date(`${input.docDate}T00:00:00Z`) },
            endDate: { gte: new Date(`${input.docDate}T00:00:00Z`) },
          },
        });
        if (!fy)
          throw FinErrors.noPeriod('No financial year covers this date.', {
            docDate: 'No financial year covers this date.',
          });
        const posted = await PostingService.postJournal(
          tx,
          {
            unitId,
            docDate: input.docDate,
            voucherType,
            source: 'PAYMENT',
            ...(input.narration ? { narration: input.narration } : {}),
            ...(input.referenceNo ? { referenceNo: input.referenceNo } : {}),
            lines,
            warnings,
          },
          actor,
        );
        const payment = await tx.payment.create({
          data: {
            unitId,
            fyId: fy.id,
            code: posted.code,
            kind: input.kind,
            purpose,
            docDate: new Date(`${input.docDate}T00:00:00Z`),
            partyType,
            partyId: input.supplierId ?? input.employeeId ?? null,
            bankAccountId: bank.id,
            toBankAccountId: input.toBankAccountId ?? null,
            counterAccountId: input.counterAccountId ?? null,
            amount,
            mode: input.mode,
            referenceNo: input.referenceNo ?? null,
            narration: input.narration ?? null,
            journalId: posted.id,
            createdById: actor.userId,
          },
        });

        // allocate the supplier payment: specific bills, or FIFO
        if (purpose === 'SUPPLIER' && posted.openItemIds[0]) {
          const sourceItemId = posted.openItemIds[0];
          let parts: { itemId: string; amount: string }[];
          if (input.allocations)
            parts = input.allocations.map((a) => ({
              itemId: a.itemId,
              amount: parseMoney(a.amount, 'allocations').toFixed(2),
            }));
          else {
            let left = amount;
            parts = [];
            for (const b of supplierBills) {
              if (left.lessThanOrEqualTo(0)) break;
              const take = left.lessThan(b.outstanding) ? left : b.outstanding;
              parts.push({ itemId: b.id, amount: take.toFixed(2) });
              left = left.minus(take);
            }
          }
          for (const p of parts) {
            await openItemService.allocate(
              tx,
              {
                sourceItemId,
                targetItemId: p.itemId,
                amount: p.amount,
                date: input.docDate,
                paymentId: payment.id,
                journalId: posted.id,
                forPayment: true,
              },
              actor,
            );
          }
        }
        await recordAudit(
          {
            action: 'PAYMENT_POSTED',
            actorId: actor.userId,
            targetType: 'Payment',
            targetId: payment.id,
            ...(actor.meta ? { meta: actor.meta } : {}),
            detail: {
              code: payment.code,
              kind: input.kind,
              amount: money(amount),
              mode: input.mode,
            },
          },
          tx,
        );
        return { payment, journal: posted };
      }
    }
  },

  async cancelPayment(id: string, version: number, reason: string, actor: Actor) {
    return prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM payments WHERE id = ${id}::uuid FOR UPDATE`;
        if (!locked[0]) throw Errors.notFound('Payment not found.');
        const p = await tx.payment.findUniqueOrThrow({ where: { id } });
        if (p.version !== version) throw Errors.versionConflict();
        if (p.status !== 'Posted')
          throw FinErrors.invalidTransition('This payment is already cancelled.');
        // undo its allocations first (append-only negative rows), then post the mirror journal
        // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
        const allocs = await tx.allocation.findMany({ where: { paymentId: id, reversesId: null } });
        for (const a of allocs) {
          if (await tx.allocation.count({ where: { reversesId: a.id } })) continue;
          await openItemService.reverseAllocation(tx, a.id, actor, isoDate(p.docDate));
        }
        const rev = await PostingService.reverse(tx, p.journalId, reason, actor, {
          reversalDate: isoDate(p.docDate),
        });
        await tx.payment.update({
          where: { id },
          data: {
            status: 'Cancelled',
            reversalJournalId: rev.id,
            cancelReason: reason,
            version: { increment: 1 },
            updatedById: actor.userId,
          },
        });
        await recordAudit(
          {
            action: 'PAYMENT_CANCELLED',
            actorId: actor.userId,
            targetType: 'Payment',
            targetId: id,
            ...(actor.meta ? { meta: actor.meta } : {}),
            detail: { code: p.code, reason },
          },
          tx,
        );
        return tx.payment.findUniqueOrThrow({ where: { id } });
      },
      { maxWait: 15_000, timeout: 30_000 },
    );
  },

  async listPayments(q: {
    unitId?: string | null;
    kind?: string;
    status?: string;
    bankAccountId?: string;
    from?: string;
    to?: string;
    page: number;
    size: number;
  }) {
    const where: Prisma.PaymentWhereInput = {
      ...(q.unitId ? { unitId: q.unitId } : {}),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.bankAccountId ? { bankAccountId: q.bankAccountId } : {}),
      ...(q.from || q.to
        ? {
            docDate: {
              ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}),
              ...(q.to ? { lte: new Date(`${q.to}T00:00:00Z`) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy: [{ docDate: 'desc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.size,
        take: q.size,
      }),
      prisma.payment.count({ where }),
    ]);
    return {
      total,
      rows: rows.map((r) => ({ ...r, amount: money(r.amount), docDate: isoDate(r.docDate) })),
    };
  },

  async getPayment(id: string) {
    const p = await prisma.payment.findUnique({ where: { id } });
    if (!p) throw Errors.notFound('Payment not found.');
    // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
    const allocations = await prisma.allocation.findMany({
      where: { paymentId: id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      ...p,
      amount: money(p.amount),
      docDate: isoDate(p.docDate),
      allocations: allocations.map((a) => ({
        id: a.id,
        targetItemId: a.targetItemId,
        amount: money(a.amount),
        reversesId: a.reversesId,
      })),
    };
  },

  /** Cash book / bank book: the ledger rows of the account with a running balance. */
  async book(bankAccountId: string, from: string, to: string) {
    const b = await prisma.bankAccount.findFirst({ where: { id: bankAccountId, deletedAt: null } });
    if (!b) throw Errors.notFound('Cash / bank account not found.');
    // unpaginated: rows of one parent (account_id)
    const opening = await prisma.$queryRaw<{ v: string }[]>`
      SELECT COALESCE(SUM(debit - credit), 0)::text AS v FROM gl_entries
       WHERE account_id = ${b.accountId}::uuid AND unit_id = ${b.unitId}::uuid AND posting_date < ${from}::date`;
    // unpaginated: rows of one parent (account_id)
    const rows = await prisma.$queryRaw<
      {
        id: string;
        posting_date: Date;
        voucher_type: string;
        voucher_no: string;
        narration: string | null;
        debit: string;
        credit: string;
        journal_id: string;
      }[]
    >`
      SELECT id, posting_date, voucher_type, voucher_no, narration, debit::text, credit::text, journal_id FROM gl_entries
       WHERE account_id = ${b.accountId}::uuid AND unit_id = ${b.unitId}::uuid AND posting_date BETWEEN ${from}::date AND ${to}::date
       ORDER BY posting_date, seq`;
    let run = D(opening[0]?.v ?? 0);
    const openingBalance = run;
    let totalIn = ZERO;
    let totalOut = ZERO;
    const out = rows.map((r) => {
      run = run.plus(r.debit).minus(r.credit);
      totalIn = totalIn.plus(r.debit);
      totalOut = totalOut.plus(r.credit);
      return {
        id: r.id,
        date: isoDate(r.posting_date),
        voucherType: r.voucher_type,
        voucherNo: r.voucher_no,
        narration: r.narration,
        receipt: money(r.debit),
        payment: money(r.credit),
        balance: money(run),
        journalId: r.journal_id,
      };
    });
    return {
      account: { id: b.id, name: b.name, kind: b.kind, unitId: b.unitId },
      opening: money(openingBalance),
      totalReceipts: money(totalIn),
      totalPayments: money(totalOut),
      closing: money(run),
      rows: out,
    };
  },
};

/** min(total open, amount): how much of a payment would be allocated FIFO. */
function Dec0(totalOpen: Dec, amount: Dec): Dec {
  return totalOpen.lessThan(amount) ? totalOpen : amount;
}
