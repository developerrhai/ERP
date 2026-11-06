// apps/api/src/modules/inventory/policy/policy-service.ts
// Inventory policy retrieval and optimistic updates against settings table.
// Validates policy rules with zod against plan 02 §7.5 bounds.

import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma, type Db } from '../../../core/db/prisma';
import { settingsRepository } from '../../settings/repository';
import { Errors } from '../../../core/http/errors';

export const POLICY_KEY = 'inventory.policy';

export const DEFAULT_POLICY = {
  allowNegativeStock: false,
  enforceUomPrecision: false,
  reservationDays: 14,
  autoReleaseReservations: true,
  releaseOnDemandCancel: true,
  nearExpiryDays: 60,
  approvalThresholdValue: 10000,
  reconThresholdValue: 10000,
  countTolerancePct: 2,
  countToleranceValue: 500,
  movementDays: { fast: 30, normal: 90, slow: 180 },
  abc: { aCumPct: 80, bCumPct: 95, freqDays: { A: 30, B: 90, C: 365 } },
  xyz: { xMaxCv: 0.5, yMaxCv: 1.0 },
  usageWindowDays: 90,
  serviceLevelDefaultPct: 95,
  holdingCostPctDefault: 20,
  packWeightTolerancePct: 2,
  volumetricDivisor: 5000,
  missedReadHours: 24,
} as const;

export const movementDaysSchema = z
  .object({
    fast: z.number().int().min(1).max(3650),
    normal: z.number().int().min(1).max(3650),
    slow: z.number().int().min(1).max(3650),
  })
  .refine((m) => m.fast < m.normal && m.normal < m.slow, {
    message: 'movementDays must satisfy fast < normal < slow',
  });

export const abcSchema = z
  .object({
    aCumPct: z.number().min(0).max(100),
    bCumPct: z.number().min(0).max(100),
    freqDays: z.object({
      A: z.number().int().min(1).max(3650),
      B: z.number().int().min(1).max(3650),
      C: z.number().int().min(1).max(3650),
    }),
  })
  .refine((a) => a.aCumPct < a.bCumPct && a.bCumPct <= 100, {
    message: 'abc must satisfy aCumPct < bCumPct <= 100',
  });

export const xyzSchema = z
  .object({
    xMaxCv: z.number().min(0),
    yMaxCv: z.number().min(0),
  })
  .refine((x) => x.xMaxCv < x.yMaxCv, {
    message: 'xyz must satisfy xMaxCv < yMaxCv',
  });

export const policySchema = z
  .object({
    allowNegativeStock: z.boolean(),
    enforceUomPrecision: z.boolean(),
    reservationDays: z.number().int().min(1).max(365),
    autoReleaseReservations: z.boolean(),
    releaseOnDemandCancel: z.boolean(),
    nearExpiryDays: z.number().int().min(1).max(365),
    approvalThresholdValue: z.number().min(0),
    reconThresholdValue: z.number().min(0),
    countTolerancePct: z.number().min(0).max(100),
    countToleranceValue: z.number().min(0),
    movementDays: movementDaysSchema,
    abc: abcSchema,
    xyz: xyzSchema,
    usageWindowDays: z.number().int().min(7).max(365),
    serviceLevelDefaultPct: z.number().min(50).max(99.9),
    holdingCostPctDefault: z.number().min(0).max(100),
    packWeightTolerancePct: z.number().min(0).max(50),
    volumetricDivisor: z.number().int().min(1000).max(10000),
    missedReadHours: z.number().int().min(1).max(720),
  })
  .strict();

export const policyPatchSchema = z
  .object({
    allowNegativeStock: z.boolean().optional(),
    enforceUomPrecision: z.boolean().optional(),
    reservationDays: z.number().int().min(1).max(365).optional(),
    autoReleaseReservations: z.boolean().optional(),
    releaseOnDemandCancel: z.boolean().optional(),
    nearExpiryDays: z.number().int().min(1).max(365).optional(),
    approvalThresholdValue: z.number().min(0).optional(),
    reconThresholdValue: z.number().min(0).optional(),
    countTolerancePct: z.number().min(0).max(100).optional(),
    countToleranceValue: z.number().min(0).optional(),
    movementDays: movementDaysSchema.optional(),
    abc: abcSchema.optional(),
    xyz: xyzSchema.optional(),
    usageWindowDays: z.number().int().min(7).max(365).optional(),
    serviceLevelDefaultPct: z.number().min(50).max(99.9).optional(),
    holdingCostPctDefault: z.number().min(0).max(100).optional(),
    packWeightTolerancePct: z.number().min(0).max(50).optional(),
    volumetricDivisor: z.number().int().min(1000).max(10000).optional(),
    missedReadHours: z.number().int().min(1).max(720).optional(),
  })
  .strict();

export type InventoryPolicy = z.infer<typeof policySchema>;

export async function getPolicyWithVersion(
  db: Db = prisma,
): Promise<{ policy: InventoryPolicy; version: number }> {
  const row = await settingsRepository.get(POLICY_KEY, db);
  if (!row) {
    return {
      policy: policySchema.parse(DEFAULT_POLICY),
      version: 0,
    };
  }
  const raw = typeof row.value === 'object' && row.value !== null ? row.value : {};
  const merged = { ...DEFAULT_POLICY, ...raw };
  const valid = policySchema.parse(merged);
  return { policy: valid, version: row.version };
}

export async function getPolicy(db: Db = prisma): Promise<InventoryPolicy> {
  const { policy } = await getPolicyWithVersion(db);
  return policy;
}

export async function updatePolicy(
  db: Db = prisma,
  patch: Record<string, unknown>,
  expectedVersion: number,
  actorId: string | null = null,
): Promise<{ policy: InventoryPolicy; version: number }> {
  // Validate patch keys and structure strictly with zod
  const validatedPatch = policyPatchSchema.parse(patch);

  const current = await getPolicy(db);
  const merged: InventoryPolicy = {
    ...current,
    ...validatedPatch,
    movementDays: validatedPatch.movementDays ?? current.movementDays,
    abc: validatedPatch.abc ?? current.abc,
    xyz: validatedPatch.xyz ?? current.xyz,
  };

  const finalPolicy = policySchema.parse(merged);

  const ok = await settingsRepository.writeIfVersion(
    POLICY_KEY,
    expectedVersion,
    finalPolicy as unknown as Prisma.InputJsonObject,
    actorId,
    db,
  );

  if (!ok) {
    throw Errors.versionConflict();
  }

  return {
    policy: finalPolicy,
    version: expectedVersion === 0 ? 1 : expectedVersion + 1,
  };
}
