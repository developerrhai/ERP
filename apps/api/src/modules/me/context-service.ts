// GET / PUT /me/context (Phase 3 §A2): what the top-bar selectors offer (the company, the user's
// active units, "All units" for ADMIN+, every FY) and the saved choice. GET ignores the context
// headers on purpose, so it stays the way back when a stored unit was deactivated or taken away.
import type { User } from '@prisma/client';
import type { AuthContext, RequestMeta } from '../../core/auth/auth-context';
import { recordAudit } from '../../core/audit/audit-service';
import { contextRepository, hasAllUnits } from '../../core/context/context-repository';
import { assertFyChoice, assertUnitChoice, fallbackUnit } from '../../core/context/resolve-context';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { PutContextInput } from './schemas';

export interface MeContextDto {
  company: { id: string; code: string; tradeName: string };
  units: { id: string; code: string; name: string }[];
  allUnitsAllowed: boolean;
  fys: { id: string; code: string; label: string; status: 'OPEN' | 'CLOSED'; isCurrent: boolean }[];
  current: { unitId: string | null; fyId: string };
}

export const contextService = {
  async get(user: User): Promise<MeContextDto> {
    const [company, units, fys, preference] = await Promise.all([
      contextRepository.company(),
      contextRepository.accessibleUnits(user),
      contextRepository.allFys(),
      contextRepository.preference(user.id),
    ]);
    if (!company) throw Errors.notFound('Company not configured.');
    const unit = fallbackUnit(user, preference, units);
    const fyId =
      preference?.fyId ??
      fys.find((f) => f.isCurrent)?.id ??
      (await contextRepository.defaultFy())?.id;
    if (!fyId) throw Errors.notFound('No financial year configured.');
    return {
      company: { id: company.id, code: company.code, tradeName: company.tradeName },
      units: units.map((u) => ({ id: u.id, code: u.code, name: u.name })),
      allUnitsAllowed: hasAllUnits(user),
      fys: fys.map((f) => ({
        id: f.id,
        code: f.code,
        label: f.label,
        status: f.status,
        isCurrent: f.isCurrent,
      })),
      current: { unitId: unit.unitId, fyId },
    };
  },

  async put(actor: AuthContext, input: PutContextInput, meta: RequestMeta): Promise<MeContextDto> {
    const user = actor.user;
    await assertUnitChoice(user, input.unitId);
    const fy = await assertFyChoice(input.fyId);
    const next = { unitId: input.unitId, allUnits: input.unitId === null, fyId: fy.id };
    const current = await contextRepository.preference(user.id);
    const changed =
      !current ||
      current.unitId !== next.unitId ||
      current.allUnits !== next.allUnits ||
      current.fyId !== next.fyId;
    if (changed) {
      await prisma.$transaction(async (tx) => {
        await contextRepository.savePreference(user.id, next, tx);
        await recordAudit(
          {
            action: 'CONTEXT_CHANGED',
            actorId: user.id,
            targetType: 'User',
            targetId: user.id,
            meta,
            detail: {
              before: current
                ? { unitId: current.unitId, allUnits: current.allUnits, fyId: current.fyId }
                : null,
              after: next,
            },
          },
          tx,
        );
      });
    }
    return this.get(user);
  },
};
