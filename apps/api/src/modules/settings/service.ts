// Letterhead & PDF settings (Phase 2 §2.3): read by any signed-in user (documents will print it),
// replaced as a whole with If-Match by `controls` on admin-settings. Stored values are re-validated
// on read so a hand-edited row cannot break clients. Audited with the changed fields.
import type { Prisma } from '@prisma/client';
import type { AuthContext, RequestMeta } from '../../core/auth/auth-context';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { DEFAULT_LETTERHEAD, LETTERHEAD_KEY } from '../../core/seed/defaults';
import { settingsRepository } from './repository';
import { letterheadSchema } from './schemas';
import type { Letterhead } from './schemas';

/** Response shape (orchestrator decision): {value:{...11 fields}, version}. */
export interface LetterheadDto {
  value: Letterhead;
  version: number;
}

function parseStored(value: unknown): Letterhead {
  const parsed = letterheadSchema.safeParse(value);
  return parsed.success ? parsed.data : letterheadSchema.parse(DEFAULT_LETTERHEAD);
}

export const settingsService = {
  async getLetterhead(): Promise<LetterheadDto> {
    const row = await settingsRepository.get(LETTERHEAD_KEY);
    if (!row) return { value: letterheadSchema.parse(DEFAULT_LETTERHEAD), version: 0 };
    return { value: parseStored(row.value), version: row.version };
  },

  async putLetterhead(
    actor: AuthContext,
    expectedVersion: number,
    input: Letterhead,
    meta: RequestMeta,
  ): Promise<LetterheadDto> {
    const current = await this.getLetterhead();
    if (current.version !== expectedVersion) throw Errors.versionConflict();
    const before: Prisma.InputJsonObject = {};
    const after: Prisma.InputJsonObject = {};
    for (const key of Object.keys(input) as (keyof Letterhead)[]) {
      if (input[key] !== current.value[key]) {
        Object.assign(before, { [key]: current.value[key] });
        Object.assign(after, { [key]: input[key] });
      }
    }
    // Nothing changes: return the current value without a version bump or an audit row.
    if (current.version > 0 && Object.keys(after).length === 0) return current;
    await prisma.$transaction(async (tx) => {
      const ok = await settingsRepository.writeIfVersion(
        LETTERHEAD_KEY,
        expectedVersion,
        { ...input },
        actor.userId,
        tx,
      );
      if (!ok) throw Errors.versionConflict();
      await recordAudit(
        {
          action: 'SETTINGS_UPDATED',
          actorId: actor.userId,
          targetType: 'Setting',
          targetId: LETTERHEAD_KEY,
          meta,
          detail: { key: LETTERHEAD_KEY, before, after },
        },
        tx,
      );
    });
    return this.getLetterhead();
  },
};
