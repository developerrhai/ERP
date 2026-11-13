// PostingService: the ONLY writer of the ledger (05c §7.1 AccountingService, 05a §4.1.3 event contract).
// postJournal() runs the 13 steps of 05c §7.1.1 in one caller transaction: period gate (Phase 3 assertCanPost),
// rule-resolved lines, account / party / dimension checks, balance per unit, budget, cash controls, event
// idempotency, gap-free numbering at POST, journal + lines + gl_entries, bill-wise open items, audit.
// reverse() posts the mirror journal (BR-FIN-04); a posted row is never updated except the Cancelled link.
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { recordAudit } from '../../core/audit/audit-service';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
import { assertCanPost } from '../../core/posting';
import type { Actor } from './accounts-service';
import { budgetService } from './budget-service';
import { FinErrors } from './errors';
import { D, ZERO, isoDate, money, parseMoney, round2 } from './money';
import type { Dec } from './money';
import { getSetting } from './settings';
import { taxService } from './tax-service';
import type { TaxBlock, TdsBlock } from './tax-service';

export type PartyType = 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE';
export type VoucherType =
  | 'Journal'
  | 'Opening'
  | 'Closing'
  | 'Depreciation'
  | 'Provision'
  | 'Adjustment'
  | 'Reversal'
  | 'Bank Charges'
  | 'Receipt'
  | 'Payment'
  | 'Contra'
  | 'Sales Invoice'
  | 'Purchase Invoice'
  | 'Credit Note'
  | 'Debit Note'
  | 'Goods Receipt'
  | 'Delivery'
  | 'Stock Adjustment'
  | 'Expense'
  | 'Tax Settlement'
  | 'Payroll'
  | 'Other';
export type JournalSource = 'MANUAL' | 'EVENT' | 'PAYMENT' | 'NOTE' | 'EXPENSE' | 'TAX' | 'SYSTEM';

export interface PostLineInput {
  accountId?: string;
  /** account CODE (alternative to accountId; handy for system postings) */
  accountCode?: string;
  debit: string;
  credit: string;
  unitId?: string;
  partyType?: PartyType;
  partyId?: string;
  costCenterId?: string;
  profitCenterId?: string;
  narration?: string;
  billMode?: 'NEW' | 'AGAINST';
  billDocNo?: string;
  billDocDate?: string;
  billDueDate?: string;
  /** open item type created for billMode NEW (default JOURNAL) */
  billItemType?:
    | 'INVOICE'
    | 'CREDIT_NOTE'
    | 'DEBIT_NOTE'
    | 'RECEIPT'
    | 'PAYMENT'
    | 'ADVANCE'
    | 'OPENING'
    | 'JOURNAL';
  /** Foreign-currency line: give the currency, the foreign amount, the rate and the side; the INR value is computed. */
  currencyCode?: string;
  amountFc?: string;
  fxRate?: string;
  side?: 'DR' | 'CR';
  /** Draft journals only: the stored line id */
  lineId?: string;
  projectId?: string;
  amcContractId?: string;
}

export interface EventLine {
  account: string; // logical key, e.g. AR, SALES, OUTPUT_CGST
  debit: string;
  credit: string;
  partyId?: string;
  partyType?: PartyType;
  itemType?: string;
  unitId?: string;
  costCenter?: string; // cost centre CODE
  narration?: string;
  projectId?: string;
  amcContractId?: string;
}

export interface EventPayload {
  docNo?: string;
  dueDate?: string;
  partyId?: string;
  partyType?: string;
  isImport?: boolean;
  invoiceType?: string;
  dispatchType?: string;
  paymentMode?: string;
  bankAccountId?: string;
  reverses?: string;
  reason?: string;
  /** the producer's tax amounts (Finance checks and stores them, never computes) */
  tax?: TaxBlock;
  tds?: TdsBlock;
  lines: EventLine[];
}

export interface PostInput {
  unitId: string;
  docDate: string;
  voucherType: VoucherType;
  source: JournalSource;
  narration?: string;
  referenceNo?: string;
  sourceDocType?: string;
  sourceDocId?: string;
  sourceDocNo?: string;
  event?: string;
  payload?: EventPayload;
  lines?: PostLineInput[];
  overrideBudget?: { reason: string };
  autoReverseOn?: string;
  isClosing?: boolean;
  /** post an existing Draft journal (its lines are read from the database) */
  draftId?: string;
  approvedById?: string;
  /** warnings produced by the caller (e.g. the cash payment limit); stored on the journal */
  warnings?: Warning[];
}

export interface Warning {
  code: string;
  message: string;
  [k: string]: unknown;
}

export interface PostedJournal {
  id: string;
  code: string;
  status: 'Posted';
  totalDebit: string;
  totalCredit: string;
  glEntryIds: string[];
  openItemIds: string[];
  warnings: Warning[];
  replayed: boolean;
}

interface NormLine {
  lineId?: string;
  accountId: string;
  debit: Dec;
  credit: Dec;
  unitId: string;
  partyType: PartyType | null;
  partyId: string | null;
  costCenterId: string | null;
  profitCenterId: string | null;
  narration: string | null;
  billMode: 'NEW' | 'AGAINST' | null;
  billDocNo: string | null;
  billDocDate: string | null;
  billDueDate: string | null;
  billItemType: NonNullable<PostLineInput['billItemType']>;
  currencyCode: string;
  fxRate: Dec;
  amountFc: Dec | null;
  projectId: string | null;
  amcContractId: string | null;
}

type AccountRow = Prisma.AccountGetPayload<object>;

const NO_BUDGET_VOUCHERS = new Set<string>(['Closing', 'Reversal', 'Opening']);
const sideOf = (a: AccountRow): 'RECEIVABLE' | 'PAYABLE' | null =>
  a.controlSide as 'RECEIVABLE' | 'PAYABLE' | null;

// ---------------------------------------------------------------------------------------------------------
// Rule engine (MAP rules): symbolic key -> ledger account
// ---------------------------------------------------------------------------------------------------------
interface Condition {
  path: string;
  eq?: unknown;
  in?: unknown[];
  exists?: boolean;
}

function readPath(root: { line: EventLine; payload: EventPayload }, path: string): unknown {
  const [head, ...rest] = path.split('.');
  let cur: unknown = head === 'line' ? root.line : head === 'payload' ? root.payload : undefined;
  for (const k of rest) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function matches(
  cond: Condition | null,
  root: { line: EventLine; payload: EventPayload },
): boolean {
  if (!cond) return true;
  const v = readPath(root, cond.path);
  if (cond.exists !== undefined) return (v !== undefined && v !== null && v !== '') === cond.exists;
  if (cond.in) return cond.in.includes(v);
  return v === cond.eq;
}

export async function resolveRules(
  db: Db,
  event: string,
  payload: EventPayload,
  docDate: string,
): Promise<PostLineInput[]> {
  if (!payload.lines?.length) throw FinErrors.noPostingRule('The event has no lines.');
  const on = new Date(`${docDate}T00:00:00Z`);
  const out: PostLineInput[] = [];
  for (const line of payload.lines) {
    // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
    const rules = await db.postingRule.findMany({
      where: {
        lineKey: line.account,
        event: { in: [event, '*'] },
        isActive: true,
        effectiveFrom: { lte: on },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
      },
      orderBy: [{ seq: 'asc' }],
    });
    // an event-specific rule beats a '*' rule; inside the same event the lower seq wins
    rules.sort(
      (a, b) => (a.event === event ? 0 : 1) - (b.event === event ? 0 : 1) || a.seq - b.seq,
    );
    const rule = rules.find((r) =>
      matches((r.condition as Condition | null) ?? null, { line, payload }),
    );
    if (!rule)
      throw FinErrors.unmappedKey(`No account is mapped for "${line.account}".`, {
        account: line.account,
      });
    let accountId: string | undefined;
    if (rule.accountSelector === 'FIXED_CODE') {
      accountId = (
        await db.account.findFirst({ where: { code: rule.accountRef, deletedAt: null } })
      )?.id;
    } else if (rule.accountSelector === 'DEFAULT_KEY') {
      accountId = (await db.accountDefault.findUnique({ where: { key: rule.accountRef } }))
        ?.accountId;
    } else {
      const ba = payload.bankAccountId
        ? await db.bankAccount.findFirst({ where: { id: payload.bankAccountId, deletedAt: null } })
        : null;
      accountId = ba?.accountId;
    }
    if (!accountId)
      throw FinErrors.unmappedKey(`The account for "${line.account}" does not exist.`, {
        account: line.account,
      });
    let partyType = line.partyType;
    if (!partyType && (line.partyId ?? payload.partyId)) {
      partyType =
        line.account === 'AR' || line.account === 'CUSTOMER_ADVANCE'
          ? 'CUSTOMER'
          : line.account === 'AP_CONTROL'
            ? 'SUPPLIER'
            : undefined;
    }
    const cc = line.costCenter
      ? await db.costCenter.findFirst({ where: { code: line.costCenter, deletedAt: null } })
      : null;
    if (line.costCenter && !cc)
      throw Errors.validation({ costCenter: `Cost centre ${line.costCenter} does not exist.` });
    const partyId = partyType ? (line.partyId ?? payload.partyId) : undefined;
    const isControl = line.account === 'AR' || line.account === 'AP_CONTROL';
    out.push({
      accountId,
      debit: line.debit,
      credit: line.credit,
      ...(line.unitId ? { unitId: line.unitId } : {}),
      ...(partyType && partyId ? { partyType, partyId } : {}),
      ...(cc ? { costCenterId: cc.id } : {}),
      ...(line.narration ? { narration: line.narration } : {}),
      ...(isControl && partyId
        ? {
            billMode: 'NEW' as const,
            billDocNo: payload.docNo ?? '',
            billDocDate: docDate,
            ...(payload.dueDate ? { billDueDate: payload.dueDate } : {}),
            billItemType: (line.account === 'AR' ? Number(line.debit) > 0 : Number(line.credit) > 0)
              ? ('INVOICE' as const)
              : ('CREDIT_NOTE' as const),
          }
        : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
async function loadAccounts(db: Db, lines: PostLineInput[]): Promise<Map<string, AccountRow>> {
  const ids = lines.map((l) => l.accountId).filter((x): x is string => !!x);
  const codes = lines.map((l) => l.accountCode).filter((x): x is string => !!x);
  // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
  const rows = await db.account.findMany({
    where: { deletedAt: null, OR: [{ id: { in: ids } }, { code: { in: codes } }] },
  });
  const m = new Map<string, AccountRow>();
  for (const r of rows) {
    m.set(r.id, r);
    m.set(`code:${r.code}`, r);
  }
  return m;
}

async function partyActive(db: Db, type: PartyType, id: string): Promise<boolean> {
  if (type === 'EMPLOYEE') return (await db.user.count({ where: { id, status: 'ACTIVE' } })) > 0;
  if (type === 'CUSTOMER')
    return (
      (await db.customer.count({
        where: { id, deletedAt: null, status: 'ACTIVE', approvalStatus: 'APPROVED' },
      })) > 0
    );
  return (
    (await db.supplier.count({
      where: { id, deletedAt: null, status: 'ACTIVE', approvalStatus: 'APPROVED' },
    })) > 0
  );
}

async function defaultProfitCenter(
  db: Db,
  unitId: string,
  cache: Map<string, string | null>,
): Promise<string | null> {
  if (cache.has(unitId)) return cache.get(unitId) ?? null;
  const pc = await db.profitCenter.findFirst({
    where: { unitId, isDefault: true, deletedAt: null, status: 'Active' },
    select: { id: true },
  });
  cache.set(unitId, pc?.id ?? null);
  return pc?.id ?? null;
}

export function describeUnbalance(lines: { unitId: string; debit: Dec; credit: Dec }[]): {
  totalDebit: Dec;
  totalCredit: Dec;
  byUnit: Map<string, Dec>;
} {
  let d = ZERO;
  let c = ZERO;
  const byUnit = new Map<string, Dec>();
  for (const l of lines) {
    d = d.plus(l.debit);
    c = c.plus(l.credit);
    byUnit.set(l.unitId, (byUnit.get(l.unitId) ?? ZERO).plus(l.debit).minus(l.credit));
  }
  return { totalDebit: d, totalCredit: c, byUnit };
}

async function normalise(
  db: Db,
  input: PostInput,
  lines: PostLineInput[],
  source: JournalSource,
): Promise<NormLine[]> {
  if (lines.length < 2) throw FinErrors.unbalanced('0.00', 'A journal needs at least two lines.');
  const accounts = await loadAccounts(db, lines);
  const pcCache = new Map<string, string | null>();
  const unitChecked = new Map<string, boolean>();
  const out: NormLine[] = [];
  let n = 0;
  for (const l of lines) {
    n += 1;
    const field = `lines.${n - 1}`;
    const acct = l.accountId
      ? accounts.get(l.accountId)
      : l.accountCode
        ? accounts.get(`code:${l.accountCode}`)
        : undefined;
    if (!acct)
      throw FinErrors.accountNotPostable(`Line ${n}: choose an existing account.`, {
        [`${field}.accountId`]: 'Choose an account.',
      });
    if (acct.status !== 'Active' || acct.isGroup || !acct.postingAllowed) {
      throw FinErrors.accountNotPostable(
        `Line ${n}: account ${acct.code} ${acct.name} cannot be posted to.`,
        { [`${field}.accountId`]: `${acct.code} cannot be posted to.` },
      );
    }
    const currencyCode = (l.currencyCode ?? 'INR').toUpperCase();
    let debit: Dec;
    let credit: Dec;
    let fxRate = D(1);
    let amountFc: Dec | null = null;
    if (currencyCode === 'INR') {
      debit = parseMoney(l.debit, `${field}.debit`);
      credit = parseMoney(l.credit, `${field}.credit`);
    } else {
      if (!l.amountFc || !l.fxRate) {
        throw FinErrors.noFxRate(`Line ${n}: give the ${currencyCode} amount and the rate.`, {
          [`${field}.fxRate`]: 'Enter the rate (INR per 1 unit).',
        });
      }
      amountFc = parseMoney(l.amountFc, `${field}.amountFc`);
      fxRate = D(l.fxRate);
      if (!fxRate.greaterThan(0) || fxRate.decimalPlaces() > 6) {
        throw FinErrors.noFxRate(`Line ${n}: the rate must be above 0 with at most 6 decimals.`, {
          [`${field}.fxRate`]: 'Enter a rate like 83.2000.',
        });
      }
      const base = round2(amountFc.times(fxRate));
      if (l.side === 'DR') {
        debit = base;
        credit = ZERO;
      } else if (l.side === 'CR') {
        debit = ZERO;
        credit = base;
      } else {
        // a stored draft line: the INR value was computed when it was saved; it must still agree
        debit = parseMoney(l.debit, `${field}.debit`);
        credit = parseMoney(l.credit, `${field}.credit`);
        if (!(debit.isZero() ? credit : debit).equals(base)) {
          throw FinErrors.amountMismatch(`Line ${n}: the INR value does not match amount x rate.`);
        }
      }
    }
    if (
      debit.isNegative() ||
      credit.isNegative() ||
      (debit.greaterThan(0) && credit.greaterThan(0)) ||
      (debit.isZero() && credit.isZero())
    ) {
      throw Errors.validation({
        [`${field}.debit`]: 'Each line needs an amount in either Debit or Credit, not both.',
      });
    }
    const unitId = l.unitId ?? input.unitId;
    if (!unitChecked.has(unitId)) {
      const u = await db.unit.findUnique({ where: { id: unitId }, select: { status: true } });
      if (!u || u.status !== 'ACTIVE')
        throw Errors.contextInvalid('A line names a unit that does not exist or is inactive.');
      unitChecked.set(unitId, true);
    }
    // cost centre
    let costCenterId = l.costCenterId ?? null;
    if (costCenterId) {
      const cc = await db.costCenter.findFirst({
        where: { id: costCenterId, deletedAt: null, status: 'Active' },
      });
      if (!cc || cc.isGroup)
        throw Errors.validation({
          [`${field}.costCenterId`]: 'Choose an active, non-group cost centre.',
        });
    } else if (acct.costCenterRequired && source !== 'SYSTEM') {
      throw FinErrors.costCenterRequired(`Line ${n}: account ${acct.code} needs a cost centre.`, {
        [`${field}.costCenterId`]: 'Choose a cost centre.',
      });
    }
    costCenterId = costCenterId ?? null;
    // profit centre
    let profitCenterId = l.profitCenterId ?? null;
    if (profitCenterId) {
      const pc = await db.profitCenter.findFirst({
        where: { id: profitCenterId, deletedAt: null, status: 'Active' },
      });
      if (!pc)
        throw Errors.validation({ [`${field}.profitCenterId`]: 'Choose an active profit centre.' });
    } else profitCenterId = await defaultProfitCenter(db, unitId, pcCache);
    // party
    let partyType: PartyType | null = null;
    let partyId: string | null = null;
    if (l.partyId) {
      if (!acct.partyRequired)
        throw FinErrors.partyNotAllowed(
          `Line ${n}: account ${acct.code} does not take a customer or supplier.`,
          { [`${field}.partyId`]: 'Remove the party.' },
        );
      const wanted: PartyType =
        acct.code === '2104' ? 'EMPLOYEE' : sideOf(acct) === 'RECEIVABLE' ? 'CUSTOMER' : 'SUPPLIER';
      if (l.partyType && l.partyType !== wanted)
        throw FinErrors.partyRoleMismatch(
          `Line ${n}: account ${acct.code} needs a ${wanted.toLowerCase()}.`,
          { [`${field}.partyId`]: `Choose a ${wanted.toLowerCase()}.` },
        );
      if (!(await partyActive(db, wanted, l.partyId)))
        throw FinErrors.partyRoleMismatch(
          `Line ${n}: the ${wanted.toLowerCase()} does not exist or is inactive.`,
          { [`${field}.partyId`]: `Choose an active ${wanted.toLowerCase()}.` },
        );
      partyType = wanted;
      partyId = l.partyId;
    } else if (acct.partyRequired) {
      throw FinErrors.partyRequired(
        `Line ${n}: account ${acct.code} ${acct.name} needs a ${sideOf(acct) === 'RECEIVABLE' ? 'customer' : 'supplier'}.`,
        { [`${field}.partyId`]: 'Choose the party.' },
      );
    }
    // bill reference (BR-FIN-08)
    let billMode = l.billMode ?? null;
    if (partyId) {
      if (source === 'MANUAL') {
        if (billMode === 'AGAINST')
          throw Errors.validation({
            [`${field}.billMode`]: 'A manual journal can only create a new bill.',
          });
        billMode = 'NEW';
        if (!l.billDocNo?.trim())
          throw FinErrors.billRefRequired(`Line ${n}: enter the bill number.`, {
            [`${field}.billDocNo`]: 'Enter the bill number.',
          });
        if (!l.billDueDate)
          throw FinErrors.billRefRequired(`Line ${n}: enter the bill due date.`, {
            [`${field}.billDueDate`]: 'Enter the due date.',
          });
      } else if (!billMode) billMode = 'NEW';
    } else if (billMode) {
      throw Errors.validation({ [`${field}.billMode`]: 'A bill reference needs a party.' });
    }
    out.push({
      ...(l.lineId ? { lineId: l.lineId } : {}),
      accountId: acct.id,
      debit,
      credit,
      unitId,
      partyType,
      partyId,
      costCenterId,
      profitCenterId,
      narration: l.narration ?? null,
      billMode,
      billDocNo: l.billDocNo?.trim() || null,
      billDocDate: l.billDocDate ?? input.docDate,
      billDueDate: l.billDueDate ?? null,
      billItemType: l.billItemType ?? 'JOURNAL',
      currencyCode,
      fxRate,
      amountFc,
      projectId: l.projectId ?? null,
      amcContractId: l.amcContractId ?? null,
    });
  }
  return out;
}

function checkBalanced(lines: NormLine[]): void {
  const { totalDebit, totalCredit, byUnit } = describeUnbalance(lines);
  if (!totalDebit.equals(totalCredit))
    throw FinErrors.unbalanced(money(totalDebit.minus(totalCredit)));
  for (const [unit, net] of byUnit) {
    if (!net.isZero()) {
      throw FinErrors.unbalanced(
        money(net),
        `Each unit must balance on its own. Unit ${unit} is out by ${money(net)}; add a due-to / due-from line.`,
      );
    }
  }
}

function signatureOf(
  lines: { accountId: string; debit: Dec; credit: Dec; unitId: string; partyId: string | null }[],
): string {
  const parts = lines
    .map(
      (l) => `${l.accountId}|${l.unitId}|${l.partyId ?? ''}|${money(l.debit)}|${money(l.credit)}`,
    )
    .sort();
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

async function findFyFor(db: Db, docDate: string) {
  const d = new Date(`${docDate}T00:00:00Z`);
  const fy = await db.financialYear.findFirst({
    where: { startDate: { lte: d }, endDate: { gte: d } },
  });
  if (!fy)
    throw FinErrors.noPeriod(`No financial year covers ${docDate}.`, {
      docDate: 'No financial year covers this date.',
    });
  return fy;
}

// ---------------------------------------------------------------------------------------------------------
export const PostingService = {
  /**
   * Post now (steps 7.1.1). Everything runs in the caller's transaction; any error rolls it all back.
   * Event inputs are idempotent: posting the same (event, docType, docId) again returns the first journal.
   */
  async postJournal(tx: Db, input: PostInput, actor: Actor): Promise<PostedJournal> {
    const warnings: Warning[] = [...(input.warnings ?? [])];
    // 1. unit, financial year, period (Phase 3 gate: unit active, FY open, date inside FY, period OPEN)
    const fy = await findFyFor(tx, input.docDate);
    const gate = await assertCanPost(tx, {
      unitId: input.unitId,
      fyId: fy.id,
      postingDate: input.docDate,
    });
    if (!gate.period)
      throw FinErrors.noPeriod(`No period covers ${input.docDate}.`, {
        docDate: 'No period covers this date.',
      });
    const period = gate.period;
    const today = isoDate(new Date());
    const tomorrow = isoDate(new Date(Date.now() + 86_400_000));
    if (
      input.docDate > tomorrow &&
      !(await getSetting<boolean>(tx, 'fin.allow_future_dates', false))
    ) {
      throw FinErrors.futureDate('The date is in the future.', {
        docDate: `Use ${today} or an earlier date.`,
      });
    }
    const goLive = await getSetting<string | null>(tx, 'fin.go_live_date', null);
    if (
      goLive &&
      input.docDate < goLive &&
      input.voucherType !== 'Opening' &&
      input.voucherType !== 'Closing'
    ) {
      throw Errors.validation({
        docDate: `Postings before the go-live date (${goLive}) are not allowed.`,
      });
    }

    // 2. lines
    let rawLines: PostLineInput[];
    let draft: { id: string; version: number; code: string } | null = null;
    if (input.draftId) {
      const j = await tx.journal.findUnique({
        where: { id: input.draftId },
        include: { lines: { orderBy: { lineNo: 'asc' } } },
      });
      if (!j || j.deletedAt) throw Errors.notFound('Journal not found.');
      if (j.status !== 'Draft') throw FinErrors.notDraft('Only a Draft journal can be posted.');
      draft = { id: j.id, version: j.version, code: j.code };
      rawLines = j.lines.map((l) => ({
        lineId: l.id,
        accountId: l.accountId,
        debit: l.debit.toFixed(2),
        credit: l.credit.toFixed(2),
        unitId: l.unitId,
        ...(l.partyType ? { partyType: l.partyType as PartyType } : {}),
        ...(l.partyId ? { partyId: l.partyId } : {}),
        ...(l.costCenterId ? { costCenterId: l.costCenterId } : {}),
        ...(l.profitCenterId ? { profitCenterId: l.profitCenterId } : {}),
        ...(l.narration ? { narration: l.narration } : {}),
        ...(l.billMode ? { billMode: l.billMode as 'NEW' | 'AGAINST' } : {}),
        ...(l.billDocNo ? { billDocNo: l.billDocNo } : {}),
        ...(l.billDocDate ? { billDocDate: isoDate(l.billDocDate) } : {}),
        ...(l.billDueDate ? { billDueDate: isoDate(l.billDueDate) } : {}),
        billItemType: 'JOURNAL' as const,
        ...(l.currencyCode !== 'INR'
          ? {
              currencyCode: l.currencyCode,
              fxRate: l.fxRate.toFixed(6),
              amountFc: l.amountFc?.toFixed(2) ?? '',
            }
          : {}),
      }));
    } else if (input.event) {
      if (!input.payload) throw FinErrors.noPostingRule('An event needs its payload.');
      if (!input.sourceDocType || !input.sourceDocId)
        throw Errors.validation({ sourceDocId: 'An event needs sourceDocType and sourceDocId.' });
      rawLines = await resolveRules(tx, input.event, input.payload, input.docDate);
    } else {
      rawLines = input.lines ?? [];
    }
    const lines = await normalise(tx, input, rawLines, input.source);

    // 5. balance (BR-FIN-01): overall and per unit
    checkBalanced(lines);

    // 8. event idempotency (BR-FIN-05): same key -> the first journal; a different shape -> 409
    if (input.event && input.sourceDocType && input.sourceDocId) {
      const sig = signatureOf(lines);
      const existing = await tx.journal.findFirst({
        where: {
          sourceEvent: input.event,
          sourceDocType: input.sourceDocType,
          sourceDocId: input.sourceDocId,
          reversalOfId: null,
        },
        include: { lines: true },
      });
      if (existing) {
        const prior = signatureOf(
          existing.lines.map((l) => ({
            accountId: l.accountId,
            debit: D(l.debit),
            credit: D(l.credit),
            unitId: l.unitId,
            partyId: l.partyId,
          })),
        );
        if (prior !== sig)
          throw FinErrors.eventPayloadChanged(
            'This event was already posted with different amounts.',
          );
        return {
          id: existing.id,
          code: existing.code,
          status: 'Posted',
          totalDebit: money(existing.totalDebit),
          totalCredit: money(existing.totalCredit),
          glEntryIds: [],
          openItemIds: [],
          warnings: [],
          replayed: true,
        };
      }
    }

    // 6. budget (4.11): expense debits, not for system / closing / reversal / opening postings
    if (input.source !== 'SYSTEM' && !NO_BUDGET_VOUCHERS.has(input.voucherType)) {
      const spend = new Map<
        string,
        { unitId: string; accountId: string; costCenterId: string | null; amount: Dec }
      >();
      const accounts = await tx.account.findMany({
        where: { id: { in: lines.map((l) => l.accountId) } },
        select: { id: true, rootType: true },
      });
      const expense = new Set(accounts.filter((a) => a.rootType === 'Expense').map((a) => a.id));
      for (const l of lines) {
        if (!expense.has(l.accountId) || !l.debit.greaterThan(0)) continue;
        const k = `${l.unitId}|${l.accountId}|${l.costCenterId ?? ''}`;
        const cur = spend.get(k);
        spend.set(k, {
          unitId: l.unitId,
          accountId: l.accountId,
          costCenterId: l.costCenterId,
          amount: (cur?.amount ?? ZERO).plus(l.debit),
        });
      }
      for (const s of spend.values()) {
        const chk = await budgetService.check(tx, {
          unitId: s.unitId,
          fyId: fy.id,
          docDate: input.docDate,
          accountId: s.accountId,
          costCenterId: s.costCenterId,
          spend: s.amount,
        });
        if (chk?.exceeded) {
          if (!input.overrideBudget) {
            throw FinErrors.budgetExceeded(
              `This posting is ${chk.over} over the budget (budget to date ${chk.budgetToDate}, spent ${chk.actualToDate}).`,
              { amount: `Over budget by ${chk.over}.` },
            );
          }
          warnings.push({
            code: 'BUDGET_OVERRIDDEN',
            message: input.overrideBudget.reason,
            budgetId: chk.budgetId,
            over: chk.over,
            by: actor.userId,
          });
          await recordAudit(
            {
              action: 'BUDGET_OVERRIDDEN',
              actorId: actor.userId,
              targetType: 'Budget',
              targetId: chk.budgetId,
              ...(actor.meta ? { meta: actor.meta } : {}),
              detail: { reason: input.overrideBudget.reason, over: chk.over },
            },
            tx,
          );
        }
      }
    }

    // 7. cash controls (BR-FIN-11 a): a cash account may not go below zero at the end of the posting date
    if (
      input.source === 'PAYMENT' &&
      !(await getSetting<boolean>(tx, 'fin.allow_negative_cash', false))
    ) {
      const cashAccounts = await tx.account.findMany({
        where: { id: { in: lines.map((l) => l.accountId) }, subType: 'Cash' },
        select: { id: true, code: true },
      });
      for (const ca of cashAccounts) {
        const net = lines
          .filter((l) => l.accountId === ca.id)
          .reduce((s, l) => s.plus(l.debit).minus(l.credit), ZERO);
        if (!net.isNegative()) continue;
        for (const unitId of new Set(
          lines.filter((l) => l.accountId === ca.id).map((l) => l.unitId),
        )) {
          const unitNet = lines
            .filter((l) => l.accountId === ca.id && l.unitId === unitId)
            .reduce((s, l) => s.plus(l.debit).minus(l.credit), ZERO);
          // unpaginated: rows of one parent (account_id)
          const rows = await tx.$queryRaw<{ bal: string }[]>`
            SELECT COALESCE(SUM(debit - credit), 0)::text AS bal FROM gl_entries
             WHERE account_id = ${ca.id}::uuid AND unit_id = ${unitId}::uuid AND posting_date <= ${input.docDate}::date`;
          if (
            D(rows[0]?.bal ?? 0)
              .plus(unitNet)
              .isNegative()
          ) {
            throw FinErrors.negativeCash(`The cash account ${ca.code} cannot go below zero.`, {
              amount: 'Not enough cash.',
            });
          }
        }
      }
    }

    // 9. number (gap-free, taken NOW, rolled back with the transaction)
    const vt = await tx.voucherType.findUnique({ where: { code: input.voucherType } });
    if (!vt) throw Errors.validation({ voucherType: 'Unknown voucher type.' });
    let code: string;
    if (vt.prefix === 'EV') {
      const short = (input.event ?? input.voucherType).replace(/_(POSTED|RECEIVED|CANCELLED)$/, '');
      code = `EV/${short}/${input.sourceDocNo ?? input.payload?.docNo ?? input.sourceDocId ?? ''}`;
    } else {
      code = await NumberingService.allocate(tx, {
        pageId: vt.prefix,
        unitId: input.unitId,
        fyId: fy.id,
        date: input.docDate,
      });
    }
    const voucherNo = input.sourceDocNo ?? input.payload?.docNo ?? code;
    const { totalDebit, totalCredit } = describeUnbalance(lines);

    // 10. journal + lines + ledger rows
    const journalId =
      draft?.id ??
      (
        await tx.journal.create({
          data: {
            unitId: input.unitId,
            fyId: fy.id,
            periodId: null,
            code: `DRAFT-${Math.random().toString(16).slice(2, 10)}`,
            voucherType: input.voucherType,
            docDate: new Date(`${input.docDate}T00:00:00Z`),
            source: input.source,
            sourceEvent: input.event ?? null,
            sourceDocType: input.sourceDocType ?? null,
            sourceDocId: input.sourceDocId ?? null,
            sourceDocNo: input.sourceDocNo ?? input.payload?.docNo ?? null,
            referenceNo: input.referenceNo ?? null,
            narration: input.narration ?? null,
            preparedBy: actor.userId,
            createdById: actor.userId,
            autoReverseOn: input.autoReverseOn
              ? new Date(`${input.autoReverseOn}T00:00:00Z`)
              : null,
          },
          select: { id: true },
        })
      ).id;

    const lineIds: string[] = [];
    if (draft) {
      for (const l of lines) lineIds.push(l.lineId as string);
    } else {
      let no = 0;
      for (const l of lines) {
        no += 1;
        const row = await tx.journalLine.create({
          data: {
            journalId,
            lineNo: no,
            unitId: l.unitId,
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            partyType: l.partyType,
            partyId: l.partyId,
            costCenterId: l.costCenterId,
            profitCenterId: l.profitCenterId,
            narration: l.narration,
            billMode: l.billMode,
            billDocNo: l.billDocNo,
            billDocDate: l.billDocDate ? new Date(`${l.billDocDate}T00:00:00Z`) : null,
            billDueDate: l.billDueDate ? new Date(`${l.billDueDate}T00:00:00Z`) : null,
            currencyCode: l.currencyCode,
            fxRate: l.fxRate,
            amountFc: l.amountFc,
            projectId: l.projectId,
            amcContractId: l.amcContractId,
          },
          select: { id: true },
        });
        lineIds.push(row.id);
      }
    }
    const postingDate = new Date(`${input.docDate}T00:00:00Z`);
    const glIds: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i] as NormLine;
      const gl = await tx.glEntry.create({
        data: {
          unitId: l.unitId,
          journalId,
          journalLineId: lineIds[i] as string,
          postingDate,
          fyId: fy.id,
          periodId: period.id,
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
          partyType: l.partyType,
          partyId: l.partyId,
          costCenterId: l.costCenterId,
          profitCenterId: l.profitCenterId,
          voucherType: input.voucherType,
          voucherNo,
          sourceDocType: input.sourceDocType ?? null,
          sourceDocId: input.sourceDocId ?? null,
          sourceDocNo: input.sourceDocNo ?? input.payload?.docNo ?? null,
          narration: l.narration ?? input.narration?.slice(0, 300) ?? null,
          isClosing: input.isClosing ?? false,
          currencyCode: l.currencyCode,
          fxRate: l.fxRate,
          amountFc: l.amountFc,
          projectId: l.projectId,
          amcContractId: l.amcContractId,
          createdById: actor.userId,
        },
        select: { id: true },
      });
      glIds.push(gl.id);
    }
    const posted = await tx.journal
      .update({
        where: { id: journalId },
        data: {
          status: 'Posted',
          postingStatus: 'Posted',
          periodId: period.id,
          code,
          totalDebit,
          totalCredit,
          postedAt: new Date(),
          postedBy: actor.userId,
          ...(input.approvedById ? { approvedBy: input.approvedById, approvedAt: new Date() } : {}),
          warnings: warnings as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
          updatedById: actor.userId,
          docDate: postingDate,
          voucherType: input.voucherType,
        },
        select: { id: true, code: true },
      })
      .catch((e: unknown) => {
        // a voucher number that already exists (somebody lowered the numbering series): say so, do not 500
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw Errors.conflict(
            'The next voucher number is already in use. Ask your administrator to check the numbering series.',
          );
        }
        throw e;
      });

    // 11. sub-ledger: bill-wise open items for party lines
    const openItemIds: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i] as NormLine;
      if (!l.partyId || l.billMode !== 'NEW') continue;
      const side = l.partyType === 'CUSTOMER' ? 'RECEIVABLE' : 'PAYABLE';
      const raw = side === 'RECEIVABLE' ? l.debit.minus(l.credit) : l.credit.minus(l.debit);
      const item = await tx.openItem
        .create({
          data: {
            unitId: l.unitId,
            side,
            partyType: l.partyType as string,
            partyId: l.partyId,
            itemType: l.billItemType,
            docType: input.sourceDocType ?? 'journals',
            docId: input.sourceDocId ?? journalId,
            docNo: l.billDocNo ?? voucherNo,
            docDate: new Date(`${l.billDocDate ?? input.docDate}T00:00:00Z`),
            dueDate: l.billDueDate ? new Date(`${l.billDueDate}T00:00:00Z`) : null,
            amount: raw,
            amountFc: l.amountFc ? (raw.isNegative() ? l.amountFc.negated() : l.amountFc) : null,
            currencyCode: l.currencyCode,
            journalId,
            createdById: actor.userId,
          },
          select: { id: true },
        })
        .catch((e: unknown) => {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            throw Errors.duplicate({
              [`lines.${i}.billDocNo`]: `Bill ${l.billDocNo ?? ''} already exists for this party.`,
            });
          }
          throw e;
        });
      openItemIds.push(item.id);
    }

    // 12. tax registers (event payload `tax` / `tds` blocks)
    if (input.payload && (input.payload.tax || input.payload.tds)) {
      await taxService.recordFromEvent(tx, {
        unitId: input.unitId,
        journalId,
        docNo: input.payload.docNo ?? voucherNo,
        docDate: input.docDate,
        partyType:
          lines.find((l) => l.partyType)?.partyType === 'SUPPLIER'
            ? 'SUPPLIER'
            : lines.find((l) => l.partyType)?.partyType === 'CUSTOMER'
              ? 'CUSTOMER'
              : null,
        partyId: lines.find((l) => l.partyId)?.partyId ?? input.payload.partyId ?? null,
        tax: input.payload.tax,
        tds: input.payload.tds,
        actorId: actor.userId,
      });
    }

    // 13. audit
    await recordAudit(
      {
        action: 'JOURNAL_POSTED',
        actorId: actor.userId,
        targetType: 'Journal',
        targetId: posted.id,
        ...(actor.meta ? { meta: actor.meta } : {}),
        detail: {
          code: posted.code,
          total: money(totalDebit),
          unitId: input.unitId,
          source: input.source,
          voucherType: input.voucherType,
        },
      },
      tx,
    );
    return {
      id: posted.id,
      code: posted.code,
      status: 'Posted',
      totalDebit: money(totalDebit),
      totalCredit: money(totalCredit),
      glEntryIds: glIds,
      openItemIds,
      warnings,
      replayed: false,
    };
  },

  /** BR-FIN-04: the mirror journal. Only Posted, not itself a reversal, not already reversed. */
  async reverse(
    tx: Db,
    journalId: string,
    reason: string,
    actor: Actor,
    opts: { reversalDate?: string } = {},
  ): Promise<PostedJournal> {
    const r = reason.trim();
    if (r.length < 5 || r.length > 300)
      throw FinErrors.reasonRequired('Give a reason of 5 to 300 characters.', {
        reason: 'Enter 5 to 300 characters.',
      });
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM journals WHERE id = ${journalId}::uuid FOR UPDATE`;
    if (!locked[0]) throw Errors.notFound('Journal not found.');
    const orig = await tx.journal.findUniqueOrThrow({
      where: { id: journalId },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    if (orig.reversalOfId)
      throw FinErrors.cannotReverseReversal(
        'A reversal cannot be reversed. Post a fresh journal instead.',
      );
    if (orig.reversedById || orig.status === 'Cancelled')
      throw FinErrors.alreadyReversed('This journal was already reversed.');
    if (orig.status !== 'Posted')
      throw FinErrors.invalidTransition('Only a posted journal can be reversed.');

    // unpaginated: rows of one parent (journalId)
    const items = await tx.openItem.findMany({
      where: { journalId, status: { not: 'Cancelled' } },
    });
    if (items.some((i) => D(i.settledAmount).greaterThan(0))) {
      throw FinErrors.settledDocument(
        'Some bills of this journal are already settled. Undo those allocations first.',
      );
    }
    const matched = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM bank_matches m JOIN gl_entries g ON g.id = m.gl_entry_id
       WHERE g.journal_id = ${journalId}::uuid AND m.unmatched_at IS NULL`;
    if (Number(matched[0]?.n ?? 0) > 0)
      throw FinErrors.reconciledEntry(
        'A bank line of this journal is already matched to a bank statement. Unmatch it first.',
      );

    const origDate = isoDate(orig.docDate);
    const date = opts.reversalDate ?? origDate;
    if (date < origDate)
      throw FinErrors.reversalDateInvalid('The reversal date cannot be before the original date.', {
        reversalDate: 'Use the original date or later.',
      });
    const fy = await findFyFor(tx, date);
    const gate = await assertCanPost(tx, { unitId: orig.unitId, fyId: fy.id, postingDate: date });
    if (!gate.period)
      throw FinErrors.reversalDateInvalid('That date has no open period.', {
        reversalDate: 'Choose a date in an open period.',
      });

    const vt = await tx.voucherType.findUniqueOrThrow({ where: { code: 'Reversal' } });
    const code = await NumberingService.allocate(tx, {
      pageId: vt.prefix,
      unitId: orig.unitId,
      fyId: fy.id,
      date,
    });
    // unpaginated: rows of one parent (journalId)
    const origGl = await tx.glEntry.findMany({ where: { journalId } });
    const glByLine = new Map(origGl.map((g) => [g.journalLineId, g.id]));
    const rev = await tx.journal.create({
      data: {
        unitId: orig.unitId,
        fyId: fy.id,
        code: `DRAFT-${Math.random().toString(16).slice(2, 10)}`,
        voucherType: 'Reversal',
        docDate: new Date(`${date}T00:00:00Z`),
        source: 'SYSTEM',
        narration: `Reversal of ${orig.code}: ${r}`.slice(0, 500),
        referenceNo: orig.code,
        preparedBy: actor.userId,
        createdById: actor.userId,
        reversalOfId: orig.id,
        reversalReason: r,
        sourceDocType: orig.sourceDocType,
        sourceDocId: null,
      },
      select: { id: true },
    });
    let no = 0;
    const glIds: string[] = [];
    for (const l of orig.lines) {
      no += 1;
      const jl = await tx.journalLine.create({
        data: {
          journalId: rev.id,
          lineNo: no,
          unitId: l.unitId,
          accountId: l.accountId,
          debit: l.credit,
          credit: l.debit,
          partyType: l.partyType,
          partyId: l.partyId,
          costCenterId: l.costCenterId,
          profitCenterId: l.profitCenterId,
          narration: l.narration,
          currencyCode: l.currencyCode,
          fxRate: l.fxRate,
          amountFc: l.amountFc,
          projectId: (l as any).projectId,
          amcContractId: (l as any).amcContractId,
        },
        select: { id: true },
      });
      const gl = await tx.glEntry.create({
        data: {
          unitId: l.unitId,
          journalId: rev.id,
          journalLineId: jl.id,
          postingDate: new Date(`${date}T00:00:00Z`),
          fyId: fy.id,
          periodId: gate.period.id,
          accountId: l.accountId,
          debit: l.credit,
          credit: l.debit,
          partyType: l.partyType,
          partyId: l.partyId,
          costCenterId: l.costCenterId,
          profitCenterId: l.profitCenterId,
          voucherType: 'Reversal',
          voucherNo: code,
          narration: `Reversal of ${orig.code}`,
          isReversal: true,
          reversesGlId: glByLine.get(l.id) ?? null,
          currencyCode: l.currencyCode,
          fxRate: l.fxRate,
          amountFc: l.amountFc,
          projectId: l.projectId,
          amcContractId: l.amcContractId,
          createdById: actor.userId,
        },
        select: { id: true },
      });
      glIds.push(gl.id);
    }
    const totalDebit = orig.totalCredit;
    const totalCredit = orig.totalDebit;
    await tx.journal.update({
      where: { id: rev.id },
      data: {
        status: 'Posted',
        postingStatus: 'Posted',
        periodId: gate.period.id,
        code,
        totalDebit: totalCredit,
        totalCredit: totalDebit,
        postedAt: new Date(),
        postedBy: actor.userId,
        version: { increment: 1 },
      },
    });
    // the original becomes Cancelled / Reversed (the only change a trigger allows on a posted journal)
    await tx.journal.update({
      where: { id: orig.id },
      data: {
        status: 'Cancelled',
        postingStatus: 'Reversed',
        reversedById: rev.id,
        reversalReason: r,
        version: { increment: 1 },
        updatedById: actor.userId,
      },
    });
    await taxService.cancelForJournal(tx, orig.id);
    if (items.length) {
      await tx.openItem.updateMany({
        where: { journalId, status: { not: 'Cancelled' } },
        data: { status: 'Cancelled', updatedById: actor.userId },
      });
    }
    await recordAudit(
      {
        action: 'JOURNAL_REVERSED',
        actorId: actor.userId,
        targetType: 'Journal',
        targetId: orig.id,
        ...(actor.meta ? { meta: actor.meta } : {}),
        detail: { original: orig.code, reversal: code, reason: r, date },
      },
      tx,
    );
    return {
      id: rev.id,
      code,
      status: 'Posted',
      totalDebit: money(totalCredit),
      totalCredit: money(totalDebit),
      glEntryIds: glIds,
      openItemIds: [],
      warnings: [],
      replayed: false,
    };
  },

  /** `<ORIGINAL>_CANCELLED` events: find the original by its event key and reverse it. */
  async reverseBySource(
    tx: Db,
    sourceEvent: string,
    sourceDocType: string,
    sourceDocId: string,
    reason: string,
    actor: Actor,
    opts: { reversalDate?: string } = {},
  ) {
    const orig = await tx.journal.findFirst({
      where: { sourceEvent, sourceDocType, sourceDocId, reversalOfId: null },
    });
    if (!orig) return null;
    if (orig.reversedById) return null; // idempotent: already reversed
    return PostingService.reverse(tx, orig.id, reason, actor, opts);
  },
};
