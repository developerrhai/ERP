// Manual credit / debit notes (05a 4.1.3 e.2): corrections with no goods movement - finance charges, interest,
// agreed discounts, vendor rate corrections. Goods returns come from Sales / SCM as events. A note is a Draft
// until posted; posting writes the journal and the party's open item; undo = Cancel (mirror journal).
//   Credit note  = to a CUSTOMER   (REDUCE what they owe: Dr counter / Cr receivable;  ADD: Dr receivable / Cr counter)
//   Debit note   = to a SUPPLIER   (REDUCE what we owe:   Dr payable  / Cr counter;    ADD: Dr counter  / Cr payable)
import { recordAudit } from '../../core/audit/audit-service';
import type { Db } from '../../core/db/prisma';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { Actor } from './accounts-service';
import { FinErrors } from './errors';
import { D, isoDate, money, parseMoney } from './money';
import { getSetting } from './settings';
import { registerApprovalHandler } from '../approvals/handlers';
import type { ApprovalDocHandler, DocSnapshot } from '../approvals/handlers';
import { approvalService } from '../approvals/service';
import type { ApprovalCaller } from '../approvals/service';
import { PostingService } from './posting-service';
import type { PostLineInput } from './posting-service';

export interface NoteInput {
  kind: 'CREDIT' | 'DEBIT';
  effect: 'REDUCE' | 'ADD';
  unitId: string;
  partyId: string;
  docDate: string;
  counterAccountId: string;
  costCenterId?: string | null;
  amount: string;
  reason: string;
  againstDocNo?: string | null;
}

interface NoteRow {
  id: string;
  unit_id: string;
  fy_id: string;
  code: string;
  kind: string;
  effect: string;
  party_type: string;
  party_id: string;
  doc_date: Date;
  counter_account_id: string;
  cost_center_id: string | null;
  amount: string;
  reason: string;
  against_doc_no: string | null;
  status: string;
  journal_id: string | null;
  version: number;
}

const SELECT = `id, unit_id, fy_id, code, kind, effect, party_type, party_id, doc_date, counter_account_id, cost_center_id,
  amount::text, reason, against_doc_no, status, journal_id, version`;

const dto = (r: NoteRow, partyName?: string | null) => ({
  id: r.id,
  unitId: r.unit_id,
  code: r.code,
  kind: r.kind,
  effect: r.effect,
  partyType: r.party_type,
  partyId: r.party_id,
  partyName: partyName ?? null,
  docDate: isoDate(r.doc_date),
  counterAccountId: r.counter_account_id,
  costCenterId: r.cost_center_id,
  amount: money(r.amount),
  reason: r.reason,
  againstDocNo: r.against_doc_no,
  status: r.status,
  journalId: r.journal_id,
  version: r.version,
});

async function load(tx: typeof prisma, id: string): Promise<NoteRow> {
  const rows = await tx.$queryRawUnsafe<NoteRow[]>(
    `SELECT ${SELECT} FROM credit_debit_notes WHERE id = $1::uuid AND deleted_at IS NULL`,
    id,
  );
  if (!rows[0]) throw Errors.notFound('Note not found.');
  return rows[0];
}

async function checkParty(
  tx: typeof prisma,
  kind: 'CREDIT' | 'DEBIT',
  partyId: string,
): Promise<string> {
  if (kind === 'CREDIT') {
    const c = await tx.customer.findFirst({
      where: { id: partyId, deletedAt: null, status: 'ACTIVE', approvalStatus: 'APPROVED' },
    });
    if (!c) throw Errors.validation({ partyId: 'Choose an active customer.' });
    return c.name;
  }
  const s = await tx.supplier.findFirst({
    where: { id: partyId, deletedAt: null, status: 'ACTIVE', approvalStatus: 'APPROVED' },
  });
  if (!s) throw Errors.validation({ partyId: 'Choose an active supplier.' });
  return s.name;
}

/** Writes the journal of a note and marks it Posted (called by post() and by the approval handler). */
async function postInTx(tx: Db, id: string, actor: Actor) {
  const n = await load(tx as never, id);
  const amount = money(n.amount);
  const customer = n.party_type === 'CUSTOMER';
  const partyRow = customer
    ? await tx.customer.findUnique({
        where: { id: n.party_id },
        select: { arAccountId: true },
      })
    : await tx.supplier.findUnique({
        where: { id: n.party_id },
        select: { apAccountId: true },
      });
  const ownControl = customer
    ? (partyRow as { arAccountId: string | null } | null)?.arAccountId
    : (partyRow as { apAccountId: string | null } | null)?.apAccountId;
  const defKey = customer ? 'AR_DOMESTIC' : 'AP_TRADE';
  const control =
    ownControl ?? (await tx.accountDefault.findUniqueOrThrow({ where: { key: defKey } })).accountId;
  const reduce = n.effect === 'REDUCE';
  // customers: receivable is a debit balance; suppliers: payable is a credit balance
  const partySide: 'DR' | 'CR' = customer ? (reduce ? 'CR' : 'DR') : reduce ? 'DR' : 'CR';
  const item: PostLineInput['billItemType'] = customer
    ? reduce
      ? 'CREDIT_NOTE'
      : 'DEBIT_NOTE'
    : reduce
      ? 'DEBIT_NOTE'
      : 'INVOICE';
  const partyLine: PostLineInput = {
    accountId: control,
    debit: partySide === 'DR' ? amount : '0.00',
    credit: partySide === 'CR' ? amount : '0.00',
    partyType: customer ? 'CUSTOMER' : 'SUPPLIER',
    partyId: n.party_id,
    billMode: 'NEW',
    billItemType: item,
    ...(n.against_doc_no ? { narration: `Against ${n.against_doc_no}` } : {}),
  };
  const counterLine: PostLineInput = {
    accountId: n.counter_account_id,
    debit: partySide === 'DR' ? '0.00' : amount,
    credit: partySide === 'DR' ? amount : '0.00',
    ...(n.cost_center_id ? { costCenterId: n.cost_center_id } : {}),
    narration: n.reason.slice(0, 300),
  };
  const posted = await PostingService.postJournal(
    tx,
    {
      unitId: n.unit_id,
      docDate: isoDate(n.doc_date),
      voucherType: customer ? 'Credit Note' : 'Debit Note',
      source: 'NOTE',
      narration: n.reason,
      sourceDocType: 'credit-debit-notes',
      sourceDocId: n.id,
      lines: [partyLine, counterLine],
    },
    actor,
  );
  await tx.$executeRaw`UPDATE credit_debit_notes SET status = 'Posted', code = ${posted.code}, journal_id = ${posted.id}::uuid, version = version + 1, updated_at = now(), updated_by_id = ${actor.userId}::uuid WHERE id = ${id}::uuid`;
  await recordAudit(
    {
      action: 'NOTE_POSTED',
      actorId: actor.userId,
      targetType: 'Note',
      targetId: id,
      ...(actor.meta ? { meta: actor.meta } : {}),
      detail: { code: posted.code, amount },
    },
    tx,
  );
  return dto(await load(tx as never, id));
}

export const notesService = {
  async list(q: {
    kind: 'CREDIT' | 'DEBIT';
    unitId: string | null;
    status?: string;
    page: number;
    size: number;
  }) {
    const rows = await prisma.$queryRawUnsafe<
      (NoteRow & { party_name: string | null; total: bigint })[]
    >(
      `SELECT n.${SELECT.split(',')
        .map((c) => c.trim())
        .join(', n.')},
              COALESCE(c.name, s.name) AS party_name, COUNT(*) OVER()::bigint AS total
         FROM credit_debit_notes n LEFT JOIN customers c ON c.id = n.party_id AND n.party_type = 'CUSTOMER'
              LEFT JOIN suppliers s ON s.id = n.party_id AND n.party_type = 'SUPPLIER'
        WHERE n.deleted_at IS NULL AND n.kind = $1 AND ($2::uuid IS NULL OR n.unit_id = $2::uuid) AND ($3::text IS NULL OR n.status = $3)
        ORDER BY n.doc_date DESC, n.created_at DESC LIMIT $4 OFFSET $5`,
      q.kind,
      q.unitId,
      q.status ?? null,
      q.size,
      (q.page - 1) * q.size,
    );
    return { total: Number(rows[0]?.total ?? 0), rows: rows.map((r) => dto(r, r.party_name)) };
  },

  async get(id: string) {
    const r = await load(prisma, id);
    return dto(
      r,
      await checkParty(prisma, r.kind as 'CREDIT' | 'DEBIT', r.party_id).catch(() => null),
    );
  },

  async create(input: NoteInput, actor: Actor) {
    const amount = parseMoney(input.amount, 'amount');
    if (!amount.greaterThan(0))
      throw Errors.validation({ amount: 'Enter an amount greater than 0.' });
    if (input.reason.trim().length < 5)
      throw Errors.validation({ reason: 'Give a reason of at least 5 characters.' });
    return prisma.$transaction(async (tx) => {
      const name = await checkParty(tx as never, input.kind, input.partyId);
      const counter = await tx.account.findFirst({
        where: { id: input.counterAccountId, deletedAt: null, status: 'Active', isGroup: false },
      });
      if (!counter || counter.partyRequired)
        throw Errors.validation({
          counterAccountId:
            'Choose an income or expense account (not a customer or supplier account).',
        });
      const d = new Date(`${input.docDate}T00:00:00Z`);
      const fy = await tx.financialYear.findFirst({
        where: { startDate: { lte: d }, endDate: { gte: d } },
      });
      if (!fy)
        throw FinErrors.noPeriod('No financial year covers this date.', {
          docDate: 'No financial year covers this date.',
        });
      const rows = await tx.$queryRawUnsafe<NoteRow[]>(
        `INSERT INTO credit_debit_notes (unit_id, fy_id, code, kind, effect, party_type, party_id, doc_date, counter_account_id, cost_center_id, amount, reason, against_doc_no, created_by_id)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid, $8::date, $9::uuid, $10::uuid, $11::numeric, $12, $13, $14::uuid) RETURNING ${SELECT}`,
        input.unitId,
        fy.id,
        `DRAFT-${Math.random().toString(16).slice(2, 10)}`,
        input.kind,
        input.effect,
        input.kind === 'CREDIT' ? 'CUSTOMER' : 'SUPPLIER',
        input.partyId,
        input.docDate,
        input.counterAccountId,
        input.costCenterId ?? null,
        amount.toFixed(2),
        input.reason.trim(),
        input.againstDocNo ?? null,
        actor.userId,
      );
      await recordAudit(
        {
          action: 'NOTE_CREATED',
          actorId: actor.userId,
          targetType: 'Note',
          targetId: (rows[0] as NoteRow).id,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { kind: input.kind, amount: money(amount) },
        },
        tx,
      );
      return dto(rows[0] as NoteRow, name);
    });
  },

  async remove(id: string, actor: Actor) {
    await prisma.$transaction(async (tx) => {
      const r = await load(tx as never, id);
      if (r.status !== 'Draft' && r.status !== 'Rejected')
        throw FinErrors.notDraft('Only a Draft or Rejected note can be deleted.');
      await tx.$executeRaw`UPDATE credit_debit_notes SET deleted_at = now(), deleted_by_id = ${actor.userId}::uuid, version = version + 1 WHERE id = ${id}::uuid`;
    });
  },

  async post(id: string, version: number, actor: Actor) {
    return prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM credit_debit_notes WHERE id = ${id}::uuid FOR UPDATE`;
        const n = await load(tx as never, id);
        if (n.version !== version) throw Errors.versionConflict();
        if (n.status !== 'Draft' && n.status !== 'Approved')
          throw FinErrors.notDraft('Only a Draft note can be posted.');
        if (n.status === 'Draft' && (await approvalNeeded(tx, D(n.amount)))) {
          throw FinErrors.invalidTransition(
            'This note is above the approval limit. Submit it for approval first.',
          );
        }
        return postInTx(tx, id, actor);
      },
      { maxWait: 15_000, timeout: 30_000 },
    );
  },

  async cancel(id: string, version: number, reason: string, actor: Actor) {
    return prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM credit_debit_notes WHERE id = ${id}::uuid FOR UPDATE`;
        const n = await load(tx as never, id);
        if (n.version !== version) throw Errors.versionConflict();
        if (n.status !== 'Posted' || !n.journal_id)
          throw FinErrors.invalidTransition('Only a posted note can be cancelled.');
        await PostingService.reverse(tx, n.journal_id, reason, actor, {
          reversalDate: isoDate(n.doc_date),
        });
        await tx.$executeRaw`UPDATE credit_debit_notes SET status = 'Cancelled', version = version + 1, updated_at = now(), updated_by_id = ${actor.userId}::uuid WHERE id = ${id}::uuid`;
        await recordAudit(
          {
            action: 'NOTE_CANCELLED',
            actorId: actor.userId,
            targetType: 'Note',
            targetId: id,
            ...(actor.meta ? { meta: actor.meta } : {}),
            detail: { reason },
          },
          tx,
        );
        return dto(await load(tx as never, id));
      },
      { maxWait: 15_000, timeout: 30_000 },
    );
  },
};

/** Does this note need approval? Only when the administrator has set fin.note_approval_threshold. */
async function approvalNeeded(db: Db, amount: ReturnType<typeof D>): Promise<boolean> {
  const raw = await getSetting<string | number | null>(db, 'fin.note_approval_threshold', null);
  if (raw === null || raw === undefined || raw === '') return false;
  return amount.greaterThanOrEqualTo(D(raw));
}

export const NOTE_DOC_TYPES = { CREDIT: 'fin-creditnote', DEBIT: 'fin-debitnote' } as const;

export const notesApproval = {
  /** Submit a Draft / Rejected note: above the limit it enters the approval engine, below it is simply ready to post. */
  async submit(caller: ApprovalCaller, id: string, version: number) {
    const n = await load(prisma, id);
    if (n.version !== version) throw Errors.versionConflict();
    if (n.status !== 'Draft' && n.status !== 'Rejected')
      throw FinErrors.notDraft('Only a Draft or Rejected note can be submitted.');
    if (!(await approvalNeeded(prisma as never, D(n.amount))))
      return { needsApproval: false as const };
    const docType = n.kind === 'CREDIT' ? NOTE_DOC_TYPES.CREDIT : NOTE_DOC_TYPES.DEBIT;
    const approval = await approvalService.submit(caller, docType, id, { docVersion: version });
    return { needsApproval: true as const, approval };
  },
};

function noteHandler(): ApprovalDocHandler {
  return {
    async snapshot(tx, docId): Promise<DocSnapshot | null> {
      const lock = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM credit_debit_notes WHERE id = ${docId}::uuid AND deleted_at IS NULL FOR UPDATE`;
      if (!lock[0]) return null;
      const n = await load(tx as never, docId);
      const fy = await tx.financialYear.findUniqueOrThrow({
        where: { id: n.fy_id },
        select: { status: true },
      });
      const created = await tx.$queryRaw<
        { c: string }[]
      >`SELECT created_by_id::text AS c FROM credit_debit_notes WHERE id = ${docId}::uuid`;
      const control = await tx.moduleControl.findUnique({
        where: { pageId: n.kind === 'CREDIT' ? NOTE_DOC_TYPES.CREDIT : NOTE_DOC_TYPES.DEBIT },
        select: { ownerDepartment: true },
      });
      return {
        code: n.code,
        title: n.kind === 'CREDIT' ? 'Credit note' : 'Debit note',
        amount: n.amount,
        department: control?.ownerDepartment ?? 'Finance',
        unitId: n.unit_id,
        createdBy: created[0]?.c ?? '',
        status: n.status,
        version: n.version,
        fyOpen: fy.status === 'OPEN',
      };
    },
    async onSubmitted(tx, docId) {
      await tx.$executeRaw`UPDATE credit_debit_notes SET status = 'Pending Approval', version = version + 1 WHERE id = ${docId}::uuid`;
    },
    async onApproved(tx, docId, req) {
      await tx.$executeRaw`UPDATE credit_debit_notes SET status = 'Approved', version = version + 1 WHERE id = ${docId}::uuid`;
      await postInTx(tx, docId, { userId: req.actorId });
    },
    async onRejected(tx, docId) {
      await tx.$executeRaw`UPDATE credit_debit_notes SET status = 'Rejected', version = version + 1 WHERE id = ${docId}::uuid`;
    },
    async onReturned(tx, docId) {
      await tx.$executeRaw`UPDATE credit_debit_notes SET status = 'Draft', version = version + 1 WHERE id = ${docId}::uuid`;
    },
  };
}
registerApprovalHandler(NOTE_DOC_TYPES.CREDIT, noteHandler());
registerApprovalHandler(NOTE_DOC_TYPES.DEBIT, noteHandler());
