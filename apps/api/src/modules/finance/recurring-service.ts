// Recurring journals (rent, depreciation schedules, accrual templates) and auto-reversal of accruals.
// A template makes a Draft journal each period (or posts it when auto_post is on). run() is idempotent per due
// date: next_run moves forward in the same transaction as the journal it created. It is called by the "Run due"
// button / POST /finance/recurring/run; scheduling it daily with pg-boss is a later, separate step.
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { Actor } from './accounts-service';
import { FinErrors } from './errors';
import { D, ZERO, isoDate, money, parseMoney } from './money';
import { PostingService } from './posting-service';
import type { PostLineInput, VoucherType } from './posting-service';

export type Frequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export interface TemplateLine {
  accountId: string;
  debit: string;
  credit: string;
  costCenterId?: string;
  narration?: string;
}
export interface RecurringInput {
  unitId: string;
  name: string;
  voucherType: string;
  narration?: string;
  lines: TemplateLine[];
  frequency: Frequency;
  nextRun: string;
  endDate?: string | null;
  autoPost?: boolean;
  reverseNextDay?: boolean;
}

/** The next occurrence after `iso` (month ends are kept: 31 Jan -> 28/29 Feb). */
export function advance(iso: string, f: Frequency): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (f === 'WEEKLY') {
    d.setUTCDate(d.getUTCDate() + 7);
    return isoDate(d);
  }
  const months = f === 'MONTHLY' ? 1 : f === 'QUARTERLY' ? 3 : 12;
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return isoDate(target);
}

interface Row {
  id: string;
  unit_id: string;
  name: string;
  voucher_type: string;
  narration: string | null;
  lines: TemplateLine[];
  frequency: Frequency;
  next_run: Date;
  end_date: Date | null;
  auto_post: boolean;
  reverse_next_day: boolean;
  status: string;
  last_journal_id: string | null;
  runs: number;
  version: number;
}
const COLS =
  'id, unit_id, name, voucher_type, narration, lines, frequency, next_run, end_date, auto_post, reverse_next_day, status, last_journal_id, runs, version';
const dto = (r: Row) => ({
  id: r.id,
  unitId: r.unit_id,
  name: r.name,
  voucherType: r.voucher_type,
  narration: r.narration,
  lines: r.lines,
  frequency: r.frequency,
  nextRun: isoDate(r.next_run),
  endDate: r.end_date ? isoDate(r.end_date) : null,
  autoPost: r.auto_post,
  reverseNextDay: r.reverse_next_day,
  status: r.status,
  lastJournalId: r.last_journal_id,
  runs: r.runs,
  version: r.version,
});

function checkLines(lines: TemplateLine[]): void {
  if (lines.length < 2) throw Errors.validation({ lines: 'A template needs at least two lines.' });
  let d = ZERO;
  let c = ZERO;
  lines.forEach((l, i) => {
    const dr = parseMoney(l.debit || '0', `lines.${i}.debit`);
    const cr = parseMoney(l.credit || '0', `lines.${i}.credit`);
    if ((dr.greaterThan(0) && cr.greaterThan(0)) || (dr.isZero() && cr.isZero())) {
      throw Errors.validation({
        [`lines.${i}.debit`]: 'Each line has either a debit or a credit.',
      });
    }
    d = d.plus(dr);
    c = c.plus(cr);
  });
  if (!d.equals(c)) throw FinErrors.unbalanced(money(d.minus(c)), 'The template does not balance.');
}

export const recurringService = {
  async list(unitId: string | null) {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT ${COLS} FROM recurring_journals WHERE ($1::uuid IS NULL OR unit_id = $1::uuid) ORDER BY next_run, name`,
      unitId,
    );
    return rows.map(dto);
  },

  async create(input: RecurringInput, actor: Actor) {
    checkLines(input.lines);
    if (input.name.trim().length < 2)
      throw Errors.validation({ name: 'Give the template a name.' });
    if (input.endDate && input.endDate < input.nextRun)
      throw Errors.validation({ endDate: 'The end date is before the first run.' });
    const vt = await prisma.voucherType.findUnique({ where: { code: input.voucherType } });
    if (!vt) throw Errors.validation({ voucherType: 'Unknown voucher type.' });
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `INSERT INTO recurring_journals (unit_id, name, voucher_type, narration, lines, frequency, next_run, end_date, auto_post, reverse_next_day, created_by_id)
       VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7::date, $8::date, $9, $10, $11::uuid) RETURNING ${COLS}`,
      input.unitId,
      input.name.trim(),
      input.voucherType,
      input.narration ?? null,
      JSON.stringify(input.lines),
      input.frequency,
      input.nextRun,
      input.endDate ?? null,
      input.autoPost ?? false,
      input.reverseNextDay ?? false,
      actor.userId,
    );
    await recordAudit({
      action: 'RECURRING_CREATED',
      actorId: actor.userId,
      targetType: 'RecurringJournal',
      targetId: (rows[0] as Row).id,
      ...(actor.meta ? { meta: actor.meta } : {}),
      detail: { name: input.name },
    });
    return dto(rows[0] as Row);
  },

  async setStatus(id: string, version: number, status: 'Active' | 'Paused', actor: Actor) {
    const n =
      await prisma.$executeRaw`UPDATE recurring_journals SET status = ${status}, version = version + 1, updated_at = now(), updated_by_id = ${actor.userId}::uuid
      WHERE id = ${id}::uuid AND version = ${version} AND status <> 'Finished'`;
    if (n !== 1) throw Errors.versionConflict();
    return (await recurringService.list(null)).find((r) => r.id === id);
  },

  async remove(id: string) {
    const n = await prisma.$executeRaw`DELETE FROM recurring_journals WHERE id = ${id}::uuid`;
    if (n !== 1) throw Errors.notFound('Template not found.');
  },

  /** Create (or post) every due template up to `asOf`, then reverse accruals whose auto-reverse date has come. */
  async run(asOf: string, actor: Actor) {
    const created: {
      template: string;
      journalId: string;
      code: string;
      date: string;
      posted: boolean;
    }[] = [];
    const failures: { template: string; date?: string; error: string }[] = [];
    const due = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT ${COLS} FROM recurring_journals WHERE status = 'Active' AND next_run <= $1::date AND (end_date IS NULL OR next_run <= end_date) ORDER BY next_run, name`,
      asOf,
    );
    for (const t of due) {
      let guard = 0; // a template catches up month by month, never more than 24 occurrences in one run
      let current = t;
      while (guard++ < 24) {
        const date = isoDate(current.next_run);
        if (date > asOf || (current.end_date && date > isoDate(current.end_date))) break;
        try {
          const out = await prisma.$transaction(
            async (tx) => {
              const locked = await tx.$queryRawUnsafe<Row[]>(
                `SELECT ${COLS} FROM recurring_journals WHERE id = $1::uuid AND status = 'Active' AND next_run = $2::date FOR UPDATE`,
                t.id,
                date,
              );
              if (!locked[0]) return null; // somebody else already ran this occurrence
              const reverseOn = t.reverse_next_day
                ? isoDate(new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000))
                : undefined;
              let journalId: string;
              let code: string;
              let posted = false;
              if (t.auto_post) {
                const lines: PostLineInput[] = t.lines.map((l) => ({
                  accountId: l.accountId,
                  debit: l.debit || '0',
                  credit: l.credit || '0',
                  ...(l.costCenterId ? { costCenterId: l.costCenterId } : {}),
                  ...(l.narration ? { narration: l.narration } : {}),
                }));
                const p = await PostingService.postJournal(
                  tx,
                  {
                    unitId: t.unit_id,
                    docDate: date,
                    voucherType: t.voucher_type as VoucherType,
                    source: 'MANUAL',
                    narration: t.narration ?? t.name,
                    lines,
                    ...(reverseOn ? { autoReverseOn: reverseOn } : {}),
                  },
                  actor,
                );
                journalId = p.id;
                code = p.code;
                posted = true;
              } else {
                const d = new Date(`${date}T00:00:00Z`);
                const fy = await tx.financialYear.findFirst({
                  where: { startDate: { lte: d }, endDate: { gte: d } },
                });
                if (!fy) throw FinErrors.noPeriod(`No financial year covers ${date}.`);
                const j = await tx.journal.create({
                  data: {
                    unitId: t.unit_id,
                    fyId: fy.id,
                    code: `DRAFT-${Math.random().toString(16).slice(2, 10)}`,
                    voucherType: t.voucher_type,
                    docDate: d,
                    narration: t.narration ?? t.name,
                    preparedBy: actor.userId,
                    createdById: actor.userId,
                    totalDebit: t.lines.reduce((s, l) => s.plus(l.debit || '0'), ZERO),
                    totalCredit: t.lines.reduce((s, l) => s.plus(l.credit || '0'), ZERO),
                    ...(reverseOn ? { autoReverseOn: new Date(`${reverseOn}T00:00:00Z`) } : {}),
                    lines: {
                      create: t.lines.map((l, i) => ({
                        lineNo: i + 1,
                        unitId: t.unit_id,
                        accountId: l.accountId,
                        debit: D(l.debit || '0'),
                        credit: D(l.credit || '0'),
                        costCenterId: l.costCenterId ?? null,
                        narration: l.narration ?? null,
                      })),
                    },
                  },
                  select: { id: true, code: true },
                });
                journalId = j.id;
                code = j.code;
              }
              const next = advance(date, t.frequency);
              const finished = t.end_date !== null && next > isoDate(t.end_date);
              await tx.$executeRaw`UPDATE recurring_journals SET next_run = ${next}::date, last_journal_id = ${journalId}::uuid, runs = runs + 1,
                status = ${finished ? 'Finished' : 'Active'}, version = version + 1, updated_at = now() WHERE id = ${t.id}::uuid`;
              await recordAudit(
                {
                  action: 'RECURRING_RUN',
                  actorId: actor.userId,
                  targetType: 'RecurringJournal',
                  targetId: t.id,
                  ...(actor.meta ? { meta: actor.meta } : {}),
                  detail: { date, journal: code, posted },
                },
                tx,
              );
              return { journalId, code, posted, next, finished };
            },
            { maxWait: 15_000, timeout: 30_000 },
          );
          if (!out) break;
          created.push({
            template: t.name,
            journalId: out.journalId,
            code: out.code,
            date,
            posted: out.posted,
          });
          if (out.finished) break;
          current = { ...current, next_run: new Date(`${out.next}T00:00:00Z`) };
        } catch (e) {
          failures.push({
            template: t.name,
            date,
            error: e instanceof Error ? e.message : String(e),
          });
          break; // keep the template due; it is retried on the next run
        }
      }
    }

    // accrual helper: a journal with an auto-reverse date reverses itself on that day
    const reversed: { journal: string; reversal: string }[] = [];
    const pending = await prisma.journal.findMany({
      where: {
        deletedAt: null,
        status: 'Posted',
        reversedById: null,
        reversalOfId: null,
        autoReverseOn: { lte: new Date(`${asOf}T00:00:00Z`) },
      },
      select: { id: true, code: true, autoReverseOn: true },
      orderBy: { autoReverseOn: 'asc' },
      take: 200,
    });
    for (const j of pending) {
      try {
        const r = await prisma.$transaction(
          (tx) =>
            PostingService.reverse(tx, j.id, 'Automatic reversal of an accrual', actor, {
              reversalDate: isoDate(j.autoReverseOn as Date),
            }),
          { maxWait: 15_000, timeout: 30_000 },
        );
        reversed.push({ journal: j.code, reversal: r.code });
      } catch (e) {
        failures.push({
          template: `auto-reverse ${j.code}`,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return { asOf, created, reversed, failures };
  },
};
