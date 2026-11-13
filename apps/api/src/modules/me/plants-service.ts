// Phase 23: plant access. Who may work in which plants (Admin), and which plants a user chose to view now.
// Reads and writes the new columns with raw SQL (users.all_units_access, user_preferences.unit_ids).
import type { Unit } from '@prisma/client';
import type { AuthContext, RequestMeta } from '../../core/auth/auth-context';
import { recordAudit } from '../../core/audit/audit-service';
import { contextRepository, hasAllUnits, userAllUnitsFlag } from '../../core/context/context-repository';
import { writeUnitOf } from '../../core/context/resolve-context';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { emitRealtimeNotify } from '../notifications/realtime';
import { notificationService } from '../notifications/service';

export interface PlantDto {
  id: string;
  code: string;
  name: string;
  city: string | null;
}

export interface MyPlantsDto {
  allowed: PlantDto[];
  selected: string[];
  default: string | null;
  remember: boolean;
  /** true when the user belongs to 2+ plants and has not asked to skip the picker */
  needsPicker: boolean;
  accessType: 'Single plant' | 'Multi-plant';
  /** "pending approvals" per plant for the picker cards; null where the counter is not filled yet */
  pending: Record<string, number | null>;
}

const toDto = (u: Unit): PlantDto => ({ id: u.id, code: u.code, name: u.name, city: u.city });

export const plantsService = {
  /** GET /me/plants */
  async get(user: { id: string; defaultUnitId: string | null; role?: unknown }): Promise<MyPlantsDto> {
    const [allowed, pref] = await Promise.all([
      contextRepository.accessibleUnits(user),
      contextRepository.plantPreference(user.id),
    ]);
    const saved = pref.unitIds.filter((id) => allowed.some((u) => u.id === id));
    const selected = saved.length > 0 ? saved : allowed.length > 0 && user.defaultUnitId && allowed.some((u) => u.id === user.defaultUnitId) ? [user.defaultUnitId] : allowed[0] ? [allowed[0].id] : [];
    // unpaginated: one row per plant the user can access (small, bounded by plants)
    const counters = await prisma.$queryRaw<{ unit_id: string; n: number | null }[]>`
      SELECT unit_id::text AS unit_id, my_approvals AS n FROM user_work_counters WHERE user_id = ${user.id}::uuid`;
    const pending: Record<string, number | null> = {};
    for (const u of allowed) pending[u.id] = counters.find((c) => c.unit_id === u.id)?.n ?? null;
    return {
      allowed: allowed.map(toDto),
      selected,
      default: user.defaultUnitId,
      remember: pref.remember,
      needsPicker: allowed.length > 1 && !pref.remember,
      accessType: allowed.length > 1 ? 'Multi-plant' : 'Single plant',
      pending,
    };
  },

  /** PUT /me/plants: the user's own choice of plants to view. */
  async put(
    actor: AuthContext,
    input: { selected: string[]; remember: boolean },
    meta: RequestMeta,
  ): Promise<MyPlantsDto> {
    const user = actor.user;
    const allowed = await contextRepository.accessibleUnits(user);
    const selected = [...new Set(input.selected)];
    if (selected.length === 0) throw Errors.validation({ selected: 'Choose at least one plant to continue.' });
    for (const id of selected) {
      const unit = allowed.find((u) => u.id === id);
      if (!unit) {
        const known = await contextRepository.unitById(id);
        throw known ? Errors.unitNotAllowed(known.name) : Errors.contextInvalid('Unknown plant.');
      }
    }
    const before = await contextRepository.plantPreference(user.id);
    const write = writeUnitOf(selected, user.defaultUnitId);
    await prisma.$transaction(async (tx) => {
      await contextRepository.savePlantPreference(user.id, { unitIds: selected, remember: input.remember }, tx);
      // keep the legacy single-plant columns readable for one release (E-40)
      const fy = await contextRepository.defaultFy(tx);
      await contextRepository.savePreference(
        user.id,
        { unitId: write, allUnits: false, fyId: (await contextRepository.preference(user.id, tx))?.fyId ?? fy?.id ?? '' },
        tx,
      );
      // security log: who chose which plants, and when
      await recordAudit(
        {
          action: 'PLANTS_CHOSEN',
          actorId: user.id,
          targetType: 'User',
          targetId: user.id,
          meta,
          detail: { before: before.unitIds, after: selected, remember: input.remember },
        },
        tx,
      );
    });
    return this.get(user);
  },

  /** PUT /admin/users/:id/plants */
  async adminSet(
    actor: AuthContext,
    userId: string,
    input: { unitIds: string[]; allUnits: boolean; defaultUnitId: string | null },
    meta: RequestMeta,
  ): Promise<{ unitIds: string[]; defaultUnitId: string | null; allUnits: boolean; summary: string }> {
    const target = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
    if (!target) throw Errors.notFound('User not found.');
    const active = await contextRepository.allActiveUnits();
    // "All plants (including future plants)" ticks every box and keeps future units included
    const wanted = input.allUnits ? active.map((u) => u.id) : [...new Set(input.unitIds)];
    const superUser = hasAllUnits(target);
    if (wanted.length === 0 && !superUser) throw Errors.validation({ unitIds: 'Tick at least one plant.' });
    for (const id of wanted) {
      if (!active.some((u) => u.id === id)) throw Errors.validation({ unitIds: 'Choose from the listed plants.' });
    }
    let defaultUnitId = input.defaultUnitId;
    if (defaultUnitId !== null && !wanted.includes(defaultUnitId)) {
      throw Errors.validation({ defaultUnitId: 'The default plant must be one of the ticked plants.' });
    }
    defaultUnitId ??= wanted[0] ?? null;

    // unpaginated: the user's own plant assignments (small)
    const beforeRows = await prisma.userUnit.findMany({ where: { userId }, select: { unitId: true } });
    const beforeIds = beforeRows.map((r) => r.unitId);
    const beforeAll = await userAllUnitsFlag(userId);
    const removed = beforeIds.filter((id) => !wanted.includes(id));

    await prisma.$transaction(async (tx) => {
      await tx.userUnit.deleteMany({ where: { userId, unitId: { notIn: wanted } } });
      const have = new Set(beforeIds);
      const add = wanted.filter((id) => !have.has(id));
      if (add.length > 0) await tx.userUnit.createMany({ data: add.map((unitId) => ({ userId, unitId })) });
      await tx.$executeRaw`UPDATE users SET all_units_access = ${input.allUnits}, default_unit_id = ${defaultUnitId}::uuid WHERE id = ${userId}::uuid`;
      // drop removed plants from the saved view so the next request cannot keep them
      if (removed.length > 0) {
        await tx.$executeRaw`
          UPDATE user_preferences SET unit_ids = ARRAY(SELECT x FROM unnest(unit_ids) x WHERE x = ANY(${wanted}::uuid[]))
           WHERE user_id = ${userId}::uuid`;
      }
      await recordAudit(
        {
          action: 'USER_PLANTS_CHANGED',
          actorId: actor.user.id,
          targetType: 'User',
          targetId: userId,
          meta,
          detail: {
            before: { unitIds: beforeIds, allUnits: beforeAll, defaultUnitId: target.defaultUnitId },
            after: { unitIds: wanted, allUnits: input.allUnits, defaultUnitId },
          },
        },
        tx,
      );
      await notificationService.notify(tx, [userId], {
        type: 'access.plants_changed',
        title: 'Your plant access was changed',
        body: 'Your plant access was changed by Admin.',
        dedupeKey: `plants:${userId}:${Date.now()}`,
      });
    });
    // SSE: the open tabs re-read their plants at once (session.context_changed)
    await emitRealtimeNotify(prisma, { u: [userId], k: 'c' });
    const names = active.filter((u) => wanted.includes(u.id)).map((u) => u.name);
    const defName = active.find((u) => u.id === defaultUnitId)?.name;
    const summary = `${target.name} can work in ${names.join(' and ') || 'no plant'}.${defName ? ` Default: ${defName}.` : ''}`;
    return { unitIds: wanted, defaultUnitId, allUnits: input.allUnits, summary };
  },
};
