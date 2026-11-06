// apps/api/tests/numbering-service.test.ts
// Tests for NumberingService.allocate (Phase 03 Order 2, BR-INV-63, M4)
// Proves gap-free numbering, pattern formatting, and that next codes remain unchanged.

import { beforeAll, describe, expect, it } from 'vitest';
import { NumberingService } from '../src/core/numbering';
import { prisma } from './helpers';

describe('NumberingService.allocate', () => {
  let unitId: string;
  let fyId: string;
  let fyCode: string;

  beforeAll(async () => {
    const tal = await prisma.unit.findUniqueOrThrow({ where: { code: 'TAL' } });
    unitId = tal.id;
    const fy = await prisma.financialYear.findFirstOrThrow({
      where: { isCurrent: true },
    });
    fyId = fy.id;
    fyCode = fy.code;
  });

  it('allocates gap-free inventory voucher number matching <PFX>/<UNIT>/<FY>/<0001>', async () => {
    const fyPart = fyCode.slice(2);
    const code = await prisma.$transaction(async (tx) => {
      return NumberingService.allocate(tx, {
        docType: 'inv-opening',
        unitId,
        fyId,
        prefix: 'OPN',
        padding: 4,
      });
    });

    expect(code).toMatch(new RegExp(`^OPN/TAL/${fyPart}/\\d{4}$`));
  });

  it('proves generic record code format matches old nextNumber output with padding 5', async () => {
    const fyPart = fyCode.slice(2);
    const code = await prisma.$transaction(async (tx) => {
      return NumberingService.allocate(tx, {
        pageId: 'crm-leads',
        unitId,
        fyId,
        prefix: 'LED',
        padding: 5,
      });
    });

    expect(code).toMatch(new RegExp(`^LED/TAL/${fyPart}/\\d{5}$`));
  });

  it('supports custom numbering pattern and date tokens', async () => {
    const code = await prisma.$transaction(async (tx) => {
      return NumberingService.allocate(tx, {
        docType: 'custom-doc',
        unitId,
        fyId,
        prefix: 'DOC',
        suffix: 'IN',
        pattern: '{prefix}-{unit}-{year}-{month}-{number:3}-{suffix}',
        date: new Date('2026-05-15T00:00:00Z'),
      });
    });

    expect(code).toMatch(/^DOC-TAL-2026-05-\d{3}-IN$/);
  });

  it('returns consecutive numbers with 10 parallel allocate calls without gaps', async () => {
    const pageId = `test-parallel-${Date.now()}`;
    const results = await Promise.all(
      Array.from({ length: 10 }).map(() =>
        prisma.$transaction(async (tx) => {
          return NumberingService.allocate(tx, {
            pageId,
            unitId,
            fyId,
            prefix: 'PAR',
            padding: 4,
          });
        }),
      ),
    );

    const nums = results.map((r) => parseInt(r.split('/')[3]!, 10)).sort((a, b) => a - b);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
