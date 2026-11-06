// apps/api/tests/inv-core-services.test.ts
// Tests for Inventory core services: NumberingService, AccountingService, PolicyService.
// Follows docs/plans/02f-INVENTORY-TICKETS.md §12 T-INV-02.

import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, unitIds } from './helpers';
import { dec } from '../src/modules/inventory/money';
import { NumberingService } from '../src/core/numbering/numbering-service';
import { AccountingService } from '../src/core/accounting/accounting-service';
import {
  getPolicyWithVersion,
  updatePolicy,
  getPolicy,
} from '../src/modules/inventory/policy/policy-service';

describe('T-INV-02 — Inventory Core Services', () => {
  let unitId: string;
  let fyId: string;
  let companyId: string;

  beforeAll(async () => {
    const ids = await unitIds(['TAL']);
    unitId = ids[0]!;

    const fy = await prisma.financialYear.findFirstOrThrow({
      where: { status: 'OPEN' },
    });
    fyId = fy.id;

    const company = await prisma.company.findFirstOrThrow();
    companyId = company.id;
  });

  it('numbering is gap free under parallel calls', async () => {
    const docType = 'inv-reservation';
    const total = 20;

    const generated = await Promise.all(
      Array.from({ length: total }, () =>
        prisma.$transaction((tx) =>
          NumberingService.next(tx, { docType, unitId, fyId }),
        ),
      ),
    );

    expect(generated.length).toBe(total);

    // Extract suffixes as numbers
    const suffixes = generated.map((code) => Number(code.split('/').at(-1)));
    suffixes.sort((a, b) => a - b);

    // Ensure all 20 are unique
    const unique = new Set(suffixes);
    expect(unique.size).toBe(total);

    // Ensure strictly consecutive gap-free sequence
    for (let i = 1; i < suffixes.length; i++) {
      expect(suffixes[i]).toBe(suffixes[i - 1]! + 1);
    }
  });

  it('numbering format RES/TAL/<fy>/0001', async () => {
    const docType = 'inv-reservation';
    const number = await prisma.$transaction((tx) =>
      NumberingService.next(tx, { docType, unitId, fyId }),
    );

    // Format must match RES/TAL/<fy>/<0001>
    expect(number).toMatch(/^RES\/TAL\/\d{2}-\d{2}\/\d{4}$/);
  });

  it('accounting post is idempotent', async () => {
    const docId = randomUUID();
    const event = 'RECEIPT_POSTED';
    const docType = 'inv-transactions';

    const input = {
      companyId,
      event,
      docType,
      docId,
      docDate: new Date(),
      unitId,
      lines: [
        { accountCode: '1000', debit: dec(150.5), credit: dec(0), narrative: 'Inventory Dr' },
        { accountCode: '2000', debit: dec(0), credit: dec(150.5), narrative: 'GRNI Cr' },
      ],
    };

    // Post twice
    await AccountingService.post(prisma, input);
    await AccountingService.post(prisma, input);

    // Assert only one row in accounting_event_queue
    const rows = await prisma.accountingEventQueue.findMany({
      where: { event, docType, docId },
    });
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe('PENDING');
  });

  it('reverse writes _REVERSED once', async () => {
    const docId = randomUUID();
    const event = 'ISSUE_POSTED';
    const docType = 'inv-transactions';

    const input = {
      companyId,
      event,
      docType,
      docId,
      docDate: new Date(),
      unitId,
      reason: 'Issue cancelled due to data entry mistake',
    };

    // Reverse twice
    await AccountingService.reverse(prisma, input);
    await AccountingService.reverse(prisma, input);

    // Assert only one row in accounting_event_queue with _REVERSED
    const rows = await prisma.accountingEventQueue.findMany({
      where: { event: `${event}_REVERSED`, docType, docId },
    });
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe('PENDING');
  });

  it('unbalanced event throws', async () => {
    const input = {
      companyId,
      event: 'UNBALANCED_TEST',
      docType: 'inv-transactions',
      docId: randomUUID(),
      docDate: new Date(),
      unitId,
      lines: [
        { accountCode: '1000', debit: dec(100.0), credit: dec(0) },
        { accountCode: '2000', debit: dec(0), credit: dec(99.5) }, // Unbalanced by 0.50
      ],
    };

    await expect(AccountingService.post(prisma, input)).rejects.toThrow(
      /Unbalanced accounting event/,
    );
  });

  it('policy defaults and update with version', async () => {
    const { policy: initial, version: v0 } = await getPolicyWithVersion(prisma);
    expect(initial.reservationDays).toBe(14);
    expect(initial.allowNegativeStock).toBe(false);

    // Optimistic update
    const nextReservationDays = initial.reservationDays === 14 ? 21 : 14;
    const { policy: updated, version: v1 } = await updatePolicy(
      prisma,
      { reservationDays: nextReservationDays },
      v0,
    );

    expect(updated.reservationDays).toBe(nextReservationDays);
    expect(v1).toBe(v0 + 1);

    const refreshed = await getPolicy(prisma);
    expect(refreshed.reservationDays).toBe(nextReservationDays);

    // Stale version update must fail with 409
    await expect(
      updatePolicy(prisma, { reservationDays: 30 }, v0),
    ).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
  });

  it('policy rejects unknown key', async () => {
    const { version } = await getPolicyWithVersion(prisma);

    // Passing an unknown key must be rejected by zod strict schema
    await expect(
      updatePolicy(
        prisma,
        { unknownPropertyNotAllowed: 'foo' } as unknown as Record<string, unknown>,
        version,
      ),
    ).rejects.toThrow();

    // Invalid range fast >= normal must be rejected
    await expect(
      updatePolicy(
        prisma,
        {
          movementDays: { fast: 100, normal: 50, slow: 200 },
        },
        version,
      ),
    ).rejects.toThrow(/fast < normal < slow/);
  });
});
