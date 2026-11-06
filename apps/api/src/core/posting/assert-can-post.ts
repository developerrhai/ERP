// apps/api/src/core/posting/assert-can-post.ts
// Universal posting guard for transaction documents (STANDARDS §5, §6, §7; Phase 03 Order 1).
// Validates:
// 1. Unit is active.
// 2. Financial Year is OPEN.
// 3. Posting date falls inside the Financial Year.
// 4. Financial Year Period covering posting date is OPEN (not locked/closed).
// 5. Document state transition is valid for the requested action.

import type { FinancialYear, FinancialYearPeriod, Unit } from '@prisma/client';
import { prisma } from '../db/prisma';
import type { Db } from '../db/prisma';
import { Errors } from '../http/errors';

export interface CanPostContext {
  unitId: string;
  fyId: string;
  postingDate: Date | string;
  documentStatus?: string;
  allowedStatuses?: readonly string[];
  action?: 'post' | 'dispatch' | 'receive' | 'cancel' | string;
}

export interface CanPostResult {
  unit: Unit;
  fy: FinancialYear;
  period: FinancialYearPeriod | null;
}

function toIsoDate(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export async function assertCanPost(
  txOrDb: Db,
  ctx: CanPostContext,
): Promise<CanPostResult> {
  const db = txOrDb ?? prisma;
  const postingDateStr = toIsoDate(ctx.postingDate);

  // 1. Unit Check
  const unit = await db.unit.findUnique({
    where: { id: ctx.unitId },
  });
  if (!unit) {
    throw Errors.contextInvalid('Unit not found.');
  }
  if (unit.status !== 'ACTIVE') {
    throw Errors.conflict(`Unit ${unit.code} is inactive.`);
  }

  // 2. Financial Year Check
  const fy = await db.financialYear.findUnique({
    where: { id: ctx.fyId },
  });
  if (!fy) {
    throw Errors.contextInvalid('Financial year not found.');
  }
  if (fy.status !== 'OPEN') {
    throw Errors.periodClosed(`Financial year ${fy.code} is closed.`);
  }

  // 3. Date within Financial Year Check
  const fyStartStr = toIsoDate(fy.startDate);
  const fyEndStr = toIsoDate(fy.endDate);
  if (postingDateStr < fyStartStr || postingDateStr > fyEndStr) {
    throw Errors.validation({
      postingDate: `The posting date must lie inside financial year ${fy.code} (${fyStartStr} to ${fyEndStr}).`,
    });
  }

  // 4. Period Lock Check (M2 financial_year_periods)
  const postingDateObj = new Date(`${postingDateStr}T00:00:00Z`);
  const period = await db.financialYearPeriod.findFirst({
    where: {
      fyId: ctx.fyId,
      startDate: { lte: postingDateObj },
      endDate: { gte: postingDateObj },
    },
  });

  if (period && period.status !== 'OPEN') {
    throw Errors.periodClosed(`Period ${period.label} is closed for posting.`);
  }

  // 5. Document Status Transition Check (if provided)
  if (ctx.documentStatus && ctx.allowedStatuses) {
    if (!ctx.allowedStatuses.includes(ctx.documentStatus)) {
      const act = ctx.action ?? 'post';
      const actionName = act === 'cancel' ? 'cancelled' : `${act}ed`;
      throw Errors.conflict(`A ${ctx.documentStatus} document cannot be ${actionName}.`);
    }
  }

  return { unit, fy, period };
}
