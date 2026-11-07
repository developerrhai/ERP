// JournalService: the manual journal document (05a §4.3, flow F2). Draft (free to edit, may be unbalanced) ->
// submit (full validation; above the owner's threshold it goes through the Phase 5 ApprovalService) -> post
// (the ledger is written by PostingService, number taken only now) -> reverse (mirror journal, original Cancelled).
// No threshold is configured by this code: fin.journal_approval_threshold stays UNSET until the owner decides
// (errata E-31); with it unset, submit never asks for approval.
import type { Prisma } from '@prisma/client';
import { recordAudit } from '../../core/audit/audit-service';
import type { Db } from '../../core/db/prisma';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { approvalService } from '../approvals/service';
import type { ApprovalCaller } from '../approvals/service';
import { registerApprovalHandler } from '../approvals/handlers';
import type { ApprovalDocHandler, DocSnapshot } from '../approvals/handlers';
import type { Actor } from './accounts-service';
import { FinErrors } from './errors';
import { D, ZERO, isoDate, money, parseMoney } from './money';
import { PostingService } from './posting-service';
import type { PostedJournal, VoucherType } from './posting-service';
import { getSetting } from './settings';

export const JOURNAL_DOC_TYPE = 'fin-journal';

/** The voucher types a person may pick on the manual journal screen. */
export const MANUAL_VOUCHER_TYPES = [
  'Journal',
  'Opening',
  'Adjustment',
  'Provision',
  'Depreciation',
  'Bank Charges',
  'Other',
] as const;

export interface JournalLineDraft {
  accountId: string;
  debit: string;
  credit: string;
  unitId?: string;
  partyId?: string;
  costCenterId?: string;
  profitCenterId?: string;
  narration?: string;
  billDocNo?: string;
  billDocDate?: string;
  billDueDate?: string;
  /** foreign-currency line: currency, foreign amount, rate (INR per 1 unit) and side; the INR value is computed */
  currencyCode?: string;
  amountFc?: string;
  fxRate?: string;
  side?: 'DR' | 'CR';
}

export interface JournalDraftInput {
  unitId: string;
  docDate: string;
  voucherType: (typeof MANUAL_VOUCHER_TYPES)[number];
  narration?: string;
  referenceNo?: string;
  supportingDoc?: string;
  autoReverseOn?: string;
  lines: JournalLineDraft[];
}

type JournalFull = Prisma.JournalGetPayload<{ include: { lines: true } }>;

function draftId(): string {
  return `DRAFT-${Math.random().toString(16).slice(2, 10)}`;
}

async function writeLines(
  tx: Db,
  journalId: string,
  unitId: string,
  lines: JournalLineDraft[],
): Promise<{ debit: Prisma.Decimal; credit: Prisma.Decimal }> {
  let debit = ZERO;
  let credit = ZERO;
  let no = 0;
  for (const l of lines) {
    no += 1;
    const field = `lines.${no - 1}`;
    const cur = (l.currencyCode ?? 'INR').toUpperCase();
    let d = parseMoney(l.debit || '0', `${field}.debit`);
    let c = parseMoney(l.credit || '0', `${field}.credit`);
    let fxRate = D(1);
    let amountFc: Prisma.Decimal | null = null;
    if (cur !== 'INR') {
      if (!l.amountFc || !l.fxRate || !l.side) {
        throw FinErrors.noFxRate('Give the foreign amount, the rate and Debit / Credit.', {
          [`${field}.fxRate`]: 'Enter the amount, the rate and the side.',
        });
      }
      amountFc = parseMoney(l.amountFc, `${field}.amountFc`);
      fxRate = D(l.fxRate);
      if (!fxRate.greaterThan(0) || fxRate.decimalPlaces() > 6) {
        throw FinErrors.noFxRate('The rate must be above 0 with at most 6 decimals.', {
          [`${field}.fxRate`]: 'Enter a rate like 83.2000.',
        });
      }
      const base = amountFc.times(fxRate).toDecimalPlaces(2, 4);
      d = l.side === 'DR' ? base : ZERO;
      c = l.side === 'CR' ? base : ZERO;
    }
    if (d.isNegative() || c.isNegative())
      throw Errors.validation({ [`${field}.debit`]: 'Amounts cannot be negative.' });
    if (d.greaterThan(0) && c.greaterThan(0))
      throw Errors.validation({
        [`${field}.debit`]: 'Use either Debit or Credit on a line, not both.',
      });
    if (d.isZero() && c.isZero())
      throw Errors.validation({ [`${field}.debit`]: 'Enter a debit or a credit amount.' });
    const acct = await tx.account.findFirst({
      where: { id: l.accountId, deletedAt: null },
      select: { id: true },
    });
    if (!acct) throw Errors.validation({ [`${field}.accountId`]: 'Choose an account.' });
    const partyType = l.partyId
      ? (await tx.customer.count({ where: { id: l.partyId } })) > 0
        ? 'CUSTOMER'
        : (await tx.supplier.count({ where: { id: l.partyId } })) > 0
          ? 'SUPPLIER'
          : 'EMPLOYEE'
      : null;
    debit = debit.plus(d);
    credit = credit.plus(c);
    await tx.journalLine.create({
      data: {
        journalId,
        lineNo: no,
        unitId: l.unitId ?? unitId,
        accountId: l.accountId,
        debit: d,
        credit: c,
        partyType,
        partyId: l.partyId ?? null,
        costCenterId: l.costCenterId ?? null,
        profitCenterId: l.profitCenterId ?? null,
        narration: l.narration ?? null,
        billMode: l.partyId ? 'NEW' : null,
        billDocNo: l.billDocNo ?? null,
        billDocDate: l.billDocDate ? new Date(`${l.billDocDate}T00:00:00Z`) : null,
        billDueDate: l.billDueDate ? new Date(`${l.billDueDate}T00:00:00Z`) : null,
        currencyCode: cur,
        fxRate,
        amountFc,
      },
    });
  }
  return { debit, credit };
}

export function toDto(j: JournalFull, accounts?: Map<string, { code: string; name: string }>) {
  return {
    id: j.id,
    code: j.code,
    unitId: j.unitId,
    fyId: j.fyId,
    voucherType: j.voucherType,
    docDate: isoDate(j.docDate),
    status: j.status,
    postingStatus: j.postingStatus,
    source: j.source,
    referenceNo: j.referenceNo,
    narration: j.narration,
    supportingDoc: j.supportingDoc,
    totalDebit: money(j.totalDebit),
    totalCredit: money(j.totalCredit),
    preparedBy: j.preparedBy,
    approvedBy: j.approvedBy,
    postedBy: j.postedBy,
    postedAt: j.postedAt?.toISOString() ?? null,
    reversalOfId: j.reversalOfId,
    reversedById: j.reversedById,
    reversalReason: j.reversalReason,
    autoReverseOn: j.autoReverseOn ? isoDate(j.autoReverseOn) : null,
    warnings: j.warnings,
    version: j.version,
    createdAt: j.createdAt.toISOString(),
    lines: [...j.lines]
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        unitId: l.unitId,
        accountId: l.accountId,
        accountCode: accounts?.get(l.accountId)?.code ?? null,
        accountName: accounts?.get(l.accountId)?.name ?? null,
        currencyCode: l.currencyCode,
        fxRate: l.fxRate.toFixed(6),
        amountFc: l.amountFc ? money(l.amountFc) : null,
        debit: money(l.debit),
        credit: money(l.credit),
        partyType: l.partyType,
        partyId: l.partyId,
        costCenterId: l.costCenterId,
        profitCenterId: l.profitCenterId,
        narration: l.narration,
        billDocNo: l.billDocNo,
        billDocDate: l.billDocDate ? isoDate(l.billDocDate) : null,
        billDueDate: l.billDueDate ? isoDate(l.billDueDate) : null,
      })),
  };
}

async function loadFull(db: Db, id: string): Promise<JournalFull> {
  const j = await db.journal.findFirst({
    where: { id, deletedAt: null },
    include: { lines: true },
  });
  if (!j) throw Errors.notFound('Journal not found.');
  return j;
}

async function accountMap(db: Db, ids: string[]) {
  const rows = await db.account.findMany({
    where: { id: { in: ids } },
    select: { id: true, code: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, { code: r.code, name: r.name }]));
}

/** Does this journal need approval? (only when the owner has configured a threshold) */
async function approvalNeeded(db: Db, totalDebit: Prisma.Decimal): Promise<boolean> {
  const raw = await getSetting<string | number | null>(db, 'fin.journal_approval_threshold', null);
  if (raw === null || raw === undefined || raw === '') return false;
  return totalDebit.greaterThanOrEqualTo(D(raw));
}

export const journalService = {
  async list(q: {
    unitId?: string | null;
    q?: string;
    status?: string;
    postingStatus?: string;
    from?: string;
    to?: string;
    page: number;
    size: number;
    sort?: string;
  }) {
    const where: Prisma.JournalWhereInput = { deletedAt: null };
    if (q.unitId) where.unitId = q.unitId;
    if (q.status) where.status = q.status;
    if (q.postingStatus) where.postingStatus = q.postingStatus;
    if (q.from || q.to)
      where.docDate = {
        ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}),
        ...(q.to ? { lte: new Date(`${q.to}T00:00:00Z`) } : {}),
      };
    if (q.q)
      where.OR = [
        { code: { contains: q.q, mode: 'insensitive' } },
        { narration: { contains: q.q, mode: 'insensitive' } },
        { referenceNo: { contains: q.q, mode: 'insensitive' } },
      ];
    const asc = q.sort === 'date';
    const [rows, total] = await Promise.all([
      prisma.journal.findMany({
        where,
        include: { lines: true },
        orderBy: [{ docDate: asc ? 'asc' : 'desc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.size,
        take: q.size,
      }),
      prisma.journal.count({ where }),
    ]);
    return {
      rows: rows.map((j) => ({
        ...toDto(j),
        lines: [] as ReturnType<typeof toDto>['lines'],
        lineCount: j.lines.length,
      })),
      total,
    };
  },

  async get(id: string, unitId?: string | null) {
    const j = await loadFull(prisma, id);
    if (unitId && j.unitId !== unitId && !j.lines.some((l) => l.unitId === unitId))
      throw Errors.notFound('Journal not found.');
    return toDto(
      j,
      await accountMap(
        prisma,
        j.lines.map((l) => l.accountId),
      ),
    );
  },

  async createDraft(input: JournalDraftInput, actor: Actor) {
    if (input.lines.length < 1) throw Errors.validation({ lines: 'Add at least one line.' });
    return prisma.$transaction(async (tx) => {
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
      const j = await tx.journal.create({
        data: {
          unitId: input.unitId,
          fyId: fy.id,
          code: draftId(),
          voucherType: input.voucherType,
          docDate: new Date(`${input.docDate}T00:00:00Z`),
          narration: input.narration ?? null,
          referenceNo: input.referenceNo ?? null,
          supportingDoc: input.supportingDoc ?? null,
          autoReverseOn: input.autoReverseOn ? new Date(`${input.autoReverseOn}T00:00:00Z`) : null,
          preparedBy: actor.userId,
          createdById: actor.userId,
        },
      });
      const t = await writeLines(tx, j.id, input.unitId, input.lines);
      await tx.journal.update({
        where: { id: j.id },
        data: { totalDebit: t.debit, totalCredit: t.credit },
      });
      await recordAudit(
        {
          action: 'JOURNAL_CREATED',
          actorId: actor.userId,
          targetType: 'Journal',
          targetId: j.id,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { code: j.code },
        },
        tx,
      );
      return toDto(
        await loadFull(tx, j.id),
        await accountMap(
          tx,
          input.lines.map((l) => l.accountId),
        ),
      );
    });
  },

  async updateDraft(id: string, version: number, input: Partial<JournalDraftInput>, actor: Actor) {
    return prisma.$transaction(async (tx) => {
      const cur = await loadFull(tx, id);
      if (cur.version !== version) throw Errors.versionConflict();
      if (cur.status !== 'Draft' || !['Not Posted', 'Rejected'].includes(cur.postingStatus)) {
        throw FinErrors.notDraft('Only a Draft or Rejected journal can be edited.');
      }
      let fyId = cur.fyId;
      if (input.docDate) {
        const d = new Date(`${input.docDate}T00:00:00Z`);
        const fy = await tx.financialYear.findFirst({
          where: { startDate: { lte: d }, endDate: { gte: d } },
        });
        if (!fy)
          throw FinErrors.noPeriod('No financial year covers this date.', {
            docDate: 'No financial year covers this date.',
          });
        fyId = fy.id;
      }
      let totals = { debit: cur.totalDebit, credit: cur.totalCredit };
      if (input.lines) {
        if (input.lines.length < 1) throw Errors.validation({ lines: 'Add at least one line.' });
        await tx.journalLine.deleteMany({ where: { journalId: id } });
        totals = await writeLines(tx, id, input.unitId ?? cur.unitId, input.lines);
      }
      const res = await tx.journal.updateMany({
        where: { id, version },
        data: {
          fyId,
          totalDebit: totals.debit,
          totalCredit: totals.credit,
          version: { increment: 1 },
          updatedById: actor.userId,
          updatedAt: new Date(),
          postingStatus: 'Not Posted',
          ...(input.unitId ? { unitId: input.unitId } : {}),
          ...(input.docDate ? { docDate: new Date(`${input.docDate}T00:00:00Z`) } : {}),
          ...(input.voucherType ? { voucherType: input.voucherType } : {}),
          ...(input.narration !== undefined ? { narration: input.narration } : {}),
          ...(input.referenceNo !== undefined ? { referenceNo: input.referenceNo } : {}),
          ...(input.supportingDoc !== undefined ? { supportingDoc: input.supportingDoc } : {}),
          ...(input.autoReverseOn !== undefined
            ? {
                autoReverseOn: input.autoReverseOn
                  ? new Date(`${input.autoReverseOn}T00:00:00Z`)
                  : null,
              }
            : {}),
        },
      });
      if (res.count !== 1) throw Errors.versionConflict();
      await recordAudit(
        {
          action: 'JOURNAL_UPDATED',
          actorId: actor.userId,
          targetType: 'Journal',
          targetId: id,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { code: cur.code },
        },
        tx,
      );
      const full = await loadFull(tx, id);
      return toDto(
        full,
        await accountMap(
          tx,
          full.lines.map((l) => l.accountId),
        ),
      );
    });
  },

  async deleteDraft(id: string, actor: Actor) {
    await prisma.$transaction(async (tx) => {
      const cur = await loadFull(tx, id);
      if (cur.status !== 'Draft' || cur.postingStatus === 'Pending Approval')
        throw FinErrors.notDraft('Only a Draft journal can be deleted.');
      await tx.journal.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: actor.userId, version: { increment: 1 } },
      });
      await recordAudit(
        {
          action: 'JOURNAL_DELETED',
          actorId: actor.userId,
          targetType: 'Journal',
          targetId: id,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { code: cur.code },
        },
        tx,
      );
    });
  },

  /**
   * submit: validates the whole journal (accounts, parties, balance, period) without posting. Over the owner's
   * threshold it enters the approval engine; otherwise it is simply ready to post.
   */
  async submit(caller: ApprovalCaller, id: string, version: number) {
    const actor: Actor = { userId: caller.auth.userId, meta: caller.meta };
    const outcome = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM journals WHERE id = ${id}::uuid AND deleted_at IS NULL FOR UPDATE`;
      if (!locked[0]) throw Errors.notFound('Journal not found.');
      const cur = await loadFull(tx, id);
      if (cur.version !== version) throw Errors.versionConflict();
      if (cur.status !== 'Draft' || !['Not Posted', 'Rejected'].includes(cur.postingStatus))
        throw FinErrors.notDraft('Only a Draft or Rejected journal can be submitted.');
      // dry-run the posting in a savepoint-like way: a throwaway transaction that always rolls back
      await dryRunPost(tx, cur, actor);
      const needs = await approvalNeeded(tx, cur.totalDebit);
      await recordAudit(
        {
          action: 'JOURNAL_SUBMITTED',
          actorId: actor.userId,
          targetType: 'Journal',
          targetId: id,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { code: cur.code, needsApproval: needs },
        },
        tx,
      );
      return { needs, version: cur.version };
    });
    if (outcome.needs) {
      const req = await approvalService.submit(caller, JOURNAL_DOC_TYPE, id, {
        docVersion: outcome.version,
      });
      return { needsApproval: true as const, approval: req };
    }
    return { needsApproval: false as const };
  },

  /** post a Draft whose approval (if any was needed) is done. */
  async post(
    id: string,
    version: number,
    actor: Actor,
    opts: { overrideBudget?: { reason: string } } = {},
  ): Promise<PostedJournal> {
    return prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM journals WHERE id = ${id}::uuid AND deleted_at IS NULL FOR UPDATE`;
        if (!locked[0]) throw Errors.notFound('Journal not found.');
        const cur = await loadFull(tx, id);
        if (cur.version !== version) throw Errors.versionConflict();
        if (cur.status !== 'Draft') throw FinErrors.notDraft('This journal is already posted.');
        if (cur.postingStatus === 'Pending Approval')
          throw FinErrors.invalidTransition('This journal is waiting for approval.');
        if ((await approvalNeeded(tx, cur.totalDebit)) && cur.postingStatus !== 'Approved') {
          throw FinErrors.invalidTransition(
            'This journal is above the approval limit. Submit it for approval first.',
          );
        }
        return PostingService.postJournal(
          tx,
          {
            ...journalInput(cur),
            ...(opts.overrideBudget ? { overrideBudget: opts.overrideBudget } : {}),
          },
          actor,
        );
      },
      { maxWait: 15_000, timeout: 30_000 },
    );
  },

  async reverse(id: string, reason: string, actor: Actor, opts: { reversalDate?: string } = {}) {
    return prisma.$transaction((tx) => PostingService.reverse(tx, id, reason, actor, opts), {
      maxWait: 15_000,
      timeout: 30_000,
    });
  },
};

function journalInput(cur: JournalFull) {
  return {
    unitId: cur.unitId,
    docDate: isoDate(cur.docDate),
    voucherType: cur.voucherType as VoucherType,
    source: 'MANUAL' as const,
    draftId: cur.id,
    ...(cur.narration ? { narration: cur.narration } : {}),
    ...(cur.referenceNo ? { referenceNo: cur.referenceNo } : {}),
    ...(cur.autoReverseOn ? { autoReverseOn: isoDate(cur.autoReverseOn) } : {}),
  };
}

/** Validate exactly as posting would, then roll everything back to a savepoint (numbers and ledger rows never survive). */
async function dryRunPost(tx: Db, cur: JournalFull, actor: Actor): Promise<void> {
  await tx.$executeRawUnsafe('SAVEPOINT fin_dry_run');
  try {
    // the budget is enforced when the journal is POSTED (with its override gate); submit only checks the rest
    await PostingService.postJournal(
      tx,
      { ...journalInput(cur), overrideBudget: { reason: 'dry run' } },
      actor,
    );
  } finally {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT fin_dry_run');
  }
}

// ---------------------------------------------------------------------------------------------------------
// ApprovalService handler for the document type `fin-journal` (Phase 5 contract). The engine is the ONLY thing
// that moves a journal to Pending Approval / Approved / Rejected; Approved posts the ledger in the same transaction.
// ---------------------------------------------------------------------------------------------------------
const journalHandler: ApprovalDocHandler = {
  async snapshot(tx, docId): Promise<DocSnapshot | null> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM journals WHERE id = ${docId}::uuid AND deleted_at IS NULL FOR UPDATE`;
    if (!rows[0]) return null;
    const j = await tx.journal.findUniqueOrThrow({ where: { id: docId } });
    const fy = await tx.financialYear.findUniqueOrThrow({
      where: { id: j.fyId },
      select: { status: true },
    });
    const control = await tx.moduleControl.findUnique({
      where: { pageId: JOURNAL_DOC_TYPE },
      select: { ownerDepartment: true },
    });
    const status =
      j.status !== 'Draft'
        ? j.status
        : j.postingStatus === 'Not Posted'
          ? 'Draft'
          : j.postingStatus;
    return {
      code: j.code,
      title: 'Journal entry',
      amount: j.totalDebit,
      department: control?.ownerDepartment ?? 'Finance',
      unitId: j.unitId,
      createdBy: j.createdById,
      status,
      version: j.version,
      fyOpen: fy.status === 'OPEN',
    };
  },
  async onSubmitted(tx, docId, req) {
    await tx.journal.update({
      where: { id: docId },
      data: {
        postingStatus: 'Pending Approval',
        version: { increment: 1 },
        updatedById: req.actorId,
      },
    });
  },
  async onApproved(tx, docId, req) {
    await tx.journal.update({
      where: { id: docId },
      data: { postingStatus: 'Approved', approvedBy: req.actorId, approvedAt: new Date() },
    });
    const cur = await loadFull(tx, docId);
    await PostingService.postJournal(
      tx,
      { ...journalInput(cur), approvedById: req.actorId },
      { userId: req.actorId },
    );
    await recordAudit(
      {
        action: 'JOURNAL_APPROVED',
        actorId: req.actorId,
        targetType: 'Journal',
        targetId: docId,
        detail: { code: cur.code },
      },
      tx,
    );
  },
  async onRejected(tx, docId, req) {
    await tx.journal.update({
      where: { id: docId },
      data: { postingStatus: 'Rejected', version: { increment: 1 }, updatedById: req.actorId },
    });
    await recordAudit(
      {
        action: 'JOURNAL_REJECTED',
        actorId: req.actorId,
        targetType: 'Journal',
        targetId: docId,
        detail: {},
      },
      tx,
    );
  },
  async onReturned(tx, docId, req) {
    await tx.journal.update({
      where: { id: docId },
      data: { postingStatus: 'Not Posted', version: { increment: 1 }, updatedById: req.actorId },
    });
  },
};

registerApprovalHandler(JOURNAL_DOC_TYPE, journalHandler);
export { journalHandler };
