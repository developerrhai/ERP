// Financial Years (Phase 3 §A1, page admin-fy): list, add a year (Indian FY: 1 Apr – 31 Mar, no
// overlap), relabel, set current (exactly one), close / reopen (the current year cannot be closed,
// a closed year cannot be made current). Every write runs under one advisory lock and is audited.
import { Prisma } from '@prisma/client';
import type { FinancialYear } from '@prisma/client';
import type { AuthContext, RequestMeta } from '../../core/auth/auth-context';
import { recordAudit } from '../../core/audit/audit-service';
import type { AuditAction } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { FieldErrors } from '../../core/http/errors';
import {
  fyCode,
  fyDates,
  fyLabel,
  fyStartYearOf,
  isoDate,
  parseIsoDate,
  startYearOfCode,
} from './fy-rules';
import { financialYearRepository as repo } from './repository';
import type { CreateFinancialYearInput, UpdateFinancialYearInput } from './schemas';

export interface FinancialYearDto {
  id: string;
  code: string;
  label: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'CLOSED';
  isCurrent: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function toFinancialYearDto(fy: FinancialYear): FinancialYearDto {
  return {
    id: fy.id,
    code: fy.code,
    label: fy.label,
    startDate: isoDate(fy.startDate),
    endDate: isoDate(fy.endDate),
    status: fy.status,
    isCurrent: fy.isCurrent,
    version: fy.version,
    createdAt: fy.createdAt.toISOString(),
    updatedAt: fy.updatedAt.toISOString(),
  };
}

const MIN_START_YEAR = 2000;
const MAX_START_YEAR = 2098;
const DUPLICATE_MESSAGE = 'This financial year already exists.';

/** Works out the start year from whichever of code / startDate / endDate was given (422 if they disagree). */
async function startYearFor(input: CreateFinancialYearInput, db: Db): Promise<number> {
  const fields: FieldErrors = {};
  let year: number | null = null;
  if (input.startDate !== undefined) {
    const start = parseIsoDate(input.startDate);
    if (!start || start.getUTCMonth() !== 3 || start.getUTCDate() !== 1) {
      fields.startDate = 'A financial year starts on 1 April (YYYY-04-01).';
    } else year = start.getUTCFullYear();
  }
  if (input.code !== undefined) {
    const fromCode = startYearOfCode(input.code);
    if (fromCode === null) fields.code = 'Use the form 2027-28 (two consecutive years).';
    else if (year !== null && fromCode !== year) {
      fields.code = 'The code does not match the start date.';
    } else year = fromCode;
  }
  if (Object.keys(fields).length > 0) throw Errors.validation(fields);
  if (year === null) {
    // Nothing given: the year after the latest one (or the year containing today).
    const latest = await repo.latest(db);
    year = latest ? latest.startDate.getUTCFullYear() + 1 : fyStartYearOf(new Date());
  }
  if (input.endDate !== undefined) {
    const end = parseIsoDate(input.endDate);
    if (!end || isoDate(end) !== isoDate(fyDates(year).endDate)) {
      throw Errors.validation({
        endDate: `A financial year ends on 31 March of the next year (${isoDate(fyDates(year).endDate)}).`,
      });
    }
  }
  if (year < MIN_START_YEAR || year > MAX_START_YEAR) {
    throw Errors.validation({
      [input.code !== undefined ? 'code' : 'startDate']:
        `The year must be between ${MIN_START_YEAR} and ${MAX_START_YEAR}.`,
    });
  }
  return year;
}

function mapDbError(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return Errors.duplicate({ code: DUPLICATE_MESSAGE });
  }
  return err;
}

/** Loads under the lock and checks the (optional) If-Match version. */
async function loadLocked(tx: Db, id: string, expectedVersion: number | undefined) {
  await repo.lock(tx);
  const fy = await repo.findById(id, tx);
  if (!fy) throw Errors.notFound('Financial year not found.');
  if (expectedVersion !== undefined && expectedVersion !== fy.version) {
    throw Errors.versionConflict();
  }
  return fy;
}

async function audit(
  tx: Db,
  action: AuditAction,
  actor: AuthContext,
  fy: FinancialYear,
  meta: RequestMeta,
  detail: Prisma.InputJsonObject = {},
) {
  await recordAudit(
    {
      action,
      actorId: actor.userId,
      targetType: 'FinancialYear',
      targetId: fy.id,
      meta,
      detail: { code: fy.code, ...detail },
    },
    tx,
  );
}

async function reload(tx: Db, id: string): Promise<FinancialYear> {
  const fy = await repo.findById(id, tx);
  if (!fy) throw Errors.notFound('Financial year not found.');
  return fy;
}

export const financialYearService = {
  async list(): Promise<FinancialYearDto[]> {
    return (await repo.list()).map(toFinancialYearDto);
  },

  async create(
    actor: AuthContext,
    input: CreateFinancialYearInput,
    meta: RequestMeta,
  ): Promise<FinancialYearDto> {
    try {
      const created = await prisma.$transaction(async (tx) => {
        await repo.lock(tx);
        const year = await startYearFor(input, tx);
        const code = fyCode(year);
        // The dates are fixed by the start year, so "no overlap" is the same as "no such code".
        if (await repo.findByCode(code, tx)) throw Errors.duplicate({ code: DUPLICATE_MESSAGE });
        const fy = await repo.create(
          { code, label: input.label ?? fyLabel(year), ...fyDates(year) },
          tx,
        );
        await audit(tx, 'FINANCIAL_YEAR_CREATED', actor, fy, meta, {
          label: fy.label,
          startDate: isoDate(fy.startDate),
          endDate: isoDate(fy.endDate),
        });
        return fy;
      });
      return toFinancialYearDto(created);
    } catch (err) {
      throw mapDbError(err);
    }
  },

  async update(
    actor: AuthContext,
    id: string,
    expectedVersion: number,
    input: UpdateFinancialYearInput,
    meta: RequestMeta,
  ): Promise<FinancialYearDto> {
    const updated = await prisma.$transaction(async (tx) => {
      const fy = await loadLocked(tx, id, expectedVersion);
      if (input.label === fy.label) return fy;
      if (!(await repo.updateIfVersion(fy.id, fy.version, { label: input.label }, tx))) {
        throw Errors.versionConflict();
      }
      await audit(tx, 'FINANCIAL_YEAR_UPDATED', actor, fy, meta, {
        before: { label: fy.label },
        after: { label: input.label },
      });
      return reload(tx, fy.id);
    });
    return toFinancialYearDto(updated);
  },

  async setCurrent(
    actor: AuthContext,
    id: string,
    expectedVersion: number | undefined,
    meta: RequestMeta,
  ): Promise<FinancialYearDto> {
    const updated = await prisma.$transaction(async (tx) => {
      const fy = await loadLocked(tx, id, expectedVersion);
      if (fy.isCurrent) return fy;
      if (fy.status === 'CLOSED') {
        throw Errors.conflict('A closed financial year cannot be made current. Reopen it first.');
      }
      const previous = await repo.current(tx);
      if (previous) {
        await repo.updateIfVersion(previous.id, previous.version, { isCurrent: false }, tx);
      }
      if (!(await repo.updateIfVersion(fy.id, fy.version, { isCurrent: true }, tx))) {
        throw Errors.versionConflict();
      }
      await audit(tx, 'FINANCIAL_YEAR_SET_CURRENT', actor, fy, meta, {
        previous: previous?.code ?? null,
      });
      return reload(tx, fy.id);
    });
    return toFinancialYearDto(updated);
  },

  async close(
    actor: AuthContext,
    id: string,
    expectedVersion: number | undefined,
    meta: RequestMeta,
  ): Promise<FinancialYearDto> {
    const updated = await prisma.$transaction(async (tx) => {
      const fy = await loadLocked(tx, id, expectedVersion);
      if (fy.status === 'CLOSED') return fy;
      if (fy.isCurrent) {
        throw Errors.conflict(
          'The current financial year cannot be closed. Make another year current first.',
        );
      }
      if (!(await repo.updateIfVersion(fy.id, fy.version, { status: 'CLOSED' }, tx))) {
        throw Errors.versionConflict();
      }
      await audit(tx, 'FINANCIAL_YEAR_CLOSED', actor, fy, meta);
      return reload(tx, fy.id);
    });
    return toFinancialYearDto(updated);
  },

  async reopen(
    actor: AuthContext,
    id: string,
    expectedVersion: number | undefined,
    meta: RequestMeta,
  ): Promise<FinancialYearDto> {
    const updated = await prisma.$transaction(async (tx) => {
      const fy = await loadLocked(tx, id, expectedVersion);
      if (fy.status === 'OPEN') return fy;
      if (!(await repo.updateIfVersion(fy.id, fy.version, { status: 'OPEN' }, tx))) {
        throw Errors.versionConflict();
      }
      await audit(tx, 'FINANCIAL_YEAR_REOPENED', actor, fy, meta);
      return reload(tx, fy.id);
    });
    return toFinancialYearDto(updated);
  },
};
