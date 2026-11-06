// apps/api/tests/assert-can-post.test.ts
// Unit tests for assertCanPost posting guard (STANDARDS §5, §6, §7; Phase 03 Order 1)

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertCanPost } from '../src/core/posting';
import { prisma, TAL } from './helpers';

describe('assertCanPost Posting Guard', () => {
  let fyId: string;
  let fyCode: string;
  let activeUnitId: string;
  let closedPeriodNo: number;

  beforeAll(async () => {
    const tal = await prisma.unit.findUniqueOrThrow({ where: { code: 'TAL' } });
    activeUnitId = tal.id;
    const fy = await prisma.financialYear.findFirstOrThrow({
      where: { isCurrent: true },
      include: { periods: true },
    });
    fyId = fy.id;
    fyCode = fy.code;

    // Pick period 1 (April) and close it for test verification
    const period1 = fy.periods.find((p) => p.periodNo === 1);
    if (period1) {
      closedPeriodNo = period1.periodNo;
      await prisma.financialYearPeriod.update({
        where: { id: period1.id },
        data: { status: 'CLOSED' },
      });
    }
  });

  it('allows posting when unit is active, FY is open, period is open, and date is inside FY', async () => {
    // Period 2 (May) is open
    const mayDate = new Date('2026-05-15T00:00:00Z');
    const result = await assertCanPost(prisma, {
      unitId: activeUnitId,
      fyId,
      postingDate: mayDate,
      documentStatus: 'Draft',
      allowedStatuses: ['Draft'],
      action: 'post',
    });

    expect(result.unit.id).toBe(activeUnitId);
    expect(result.fy.id).toBe(fyId);
    expect(result.period?.status).toBe('OPEN');
  });

  it('rejects posting when the monthly period is CLOSED (409 PERIOD_CLOSED)', async () => {
    // Period 1 (April) was closed in beforeAll
    const aprilDate = new Date('2026-04-15T00:00:00Z');
    await expect(
      assertCanPost(prisma, {
        unitId: activeUnitId,
        fyId,
        postingDate: aprilDate,
        documentStatus: 'Draft',
        allowedStatuses: ['Draft'],
        action: 'post',
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'PERIOD_CLOSED',
    });
  });

  it('rejects posting when posting date lies outside the financial year (422 VALIDATION_ERROR)', async () => {
    const outsideDate = new Date('2024-01-01T00:00:00Z');
    await expect(
      assertCanPost(prisma, {
        unitId: activeUnitId,
        fyId,
        postingDate: outsideDate,
        documentStatus: 'Draft',
        allowedStatuses: ['Draft'],
        action: 'post',
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects posting when document is in illegal status for action (409 CONFLICT)', async () => {
    const mayDate = new Date('2026-05-15T00:00:00Z');
    await expect(
      assertCanPost(prisma, {
        unitId: activeUnitId,
        fyId,
        postingDate: mayDate,
        documentStatus: 'Cancelled',
        allowedStatuses: ['Draft'],
        action: 'post',
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
    });
  });

  afterAll(async () => {
    // Reopen period 1
    const period1 = await prisma.financialYearPeriod.findFirst({
      where: { fyId, periodNo: 1 },
    });
    if (period1) {
      await prisma.financialYearPeriod.update({
        where: { id: period1.id },
        data: { status: 'OPEN' },
      });
    }
  });
});
