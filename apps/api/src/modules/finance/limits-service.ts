// Finance approval limits: the amounts from which a manual journal / a credit or debit note must go through the
// approval engine. They are settings the administrator owns (Super User / Administrator, `controls` on
// admin-settings) - never constants and never set by code. Unset = that document never asks for approval.
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { Actor } from './accounts-service';
import { money, parseMoney } from './money';

export const LIMIT_KEYS = {
  journal: 'fin.journal_approval_threshold',
  note: 'fin.note_approval_threshold',
} as const;

export interface ApprovalLimits {
  journalApprovalThreshold: string | null;
  noteApprovalThreshold: string | null;
}

const read = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : money(v as string);

export const limitsService = {
  async get(): Promise<ApprovalLimits> {
    // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
    const rows = await prisma.setting.findMany({
      where: { key: { in: [LIMIT_KEYS.journal, LIMIT_KEYS.note] } },
    });
    const by = new Map(rows.map((r) => [r.key, r.value]));
    return {
      journalApprovalThreshold: read(by.get(LIMIT_KEYS.journal)),
      noteApprovalThreshold: read(by.get(LIMIT_KEYS.note)),
    };
  },

  /** `null` clears a limit (that document type stops asking for approval); a missing key is left alone. */
  async set(
    patch: { journalApprovalThreshold?: string | null; noteApprovalThreshold?: string | null },
    actor: Actor,
  ) {
    const before = await limitsService.get();
    await prisma.$transaction(async (tx) => {
      for (const [field, key] of [
        ['journalApprovalThreshold', LIMIT_KEYS.journal],
        ['noteApprovalThreshold', LIMIT_KEYS.note],
      ] as const) {
        const v = patch[field];
        if (v === undefined) continue;
        if (v === null) {
          await tx.setting.deleteMany({ where: { key } });
          continue;
        }
        const amount = parseMoney(v, field);
        if (amount.isNegative())
          throw Errors.validation({ [field]: 'The limit cannot be negative.' });
        await tx.setting.upsert({
          where: { key },
          create: { key, value: amount.toFixed(2), updatedById: actor.userId },
          update: {
            value: amount.toFixed(2),
            version: { increment: 1 },
            updatedById: actor.userId,
          },
        });
      }
      await recordAudit(
        {
          action: 'SETTINGS_UPDATED',
          actorId: actor.userId,
          targetType: 'Setting',
          targetId: null,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { area: 'finance-approval-limits', before: { ...before }, after: { ...patch } },
        },
        tx,
      );
    });
    return limitsService.get();
  },
};
