// The working context of every request (Phase 3 §A2): which unit and financial year the caller is
// working in, read from X-Unit-Id / X-FY-Id and validated, with fallbacks (preference -> default
// unit -> first accessible unit; FY -> current). Exposes req.ctx for unit-scoped modules.
import type { FinancialYear, Unit, UserPreference } from '@prisma/client';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../http/async-handler';
import { Errors } from '../http/errors';
import type { RoleCode } from '../rbac/role-rules';
import { contextRepository, hasAllUnits, userAllUnitsFlag } from './context-repository';

export interface RequestContext {
  companyId: string;
  /** null = "All units" (ADMIN+ only, reads only) or, for a user with no active unit, no unit. */
  unitId: string | null;
  fyId: string;
  /** True only when an ADMIN+ works in "All units". */
  allUnits: boolean;
  /**
   * Phase 23: the plants the caller chose to view (always inside what they are allowed). `unitId` stays
   * the plant a new record belongs to (the "write plant"): the default plant if it is selected, else the
   * first selected one.
   */
  unitIds: string[];
}

export interface ContextUser {
  id: string;
  role?: any;
  allUnits?: boolean;
  defaultUnitId: string | null;
}

export const UNIT_HEADER = 'x-unit-id';
export const FY_HEADER = 'x-fy-id';
/** Phase 23: comma-separated plant codes or ids, e.g. "TAL,SAW". */
export const UNITS_HEADER = 'x-units';
/** X-Unit-Id value meaning "All units" (case-insensitive). */
export const ALL_UNITS = 'all';

const uuid = z.string().uuid();
const isUuid = (value: string): boolean => uuid.safeParse(value).success;

let companyIdCache: string | null = null;

export async function companyId(): Promise<string> {
  if (companyIdCache) return companyIdCache;
  const company = await contextRepository.company();
  if (!company) throw new Error('No company row: run the migrations / seed');
  companyIdCache = company.id;
  return company.id;
}

/** Validates an explicit unit choice (null = "All units"). 403 CONTEXT_FORBIDDEN / 422 CONTEXT_INVALID. */
export async function assertUnitChoice(user: ContextUser, unitId: string | null): Promise<void> {
  if (unitId === null) {
    if (!hasAllUnits(user)) {
      throw Errors.contextForbidden('Only administrators can work in "All units".');
    }
    return;
  }
  const unit = isUuid(unitId) ? await contextRepository.unitById(unitId) : null;
  if (!unit) throw Errors.contextInvalid('Unknown unit.');
  if (unit.status !== 'ACTIVE') throw Errors.contextForbidden('This unit is inactive.');
  if (
    !hasAllUnits(user) &&
    !(await contextRepository.hasUnitRow(user.id, unit.id)) &&
    !(await userAllUnitsFlag(user.id))
  ) {
    throw Errors.contextForbidden('You do not have access to this unit.');
  }
}

/** Validates an explicit FY choice. Closed years are valid context (writes check the period later). */
export async function assertFyChoice(fyId: string): Promise<FinancialYear> {
  const fy = isUuid(fyId) ? await contextRepository.fyById(fyId) : null;
  if (!fy) throw Errors.contextInvalid('Unknown financial year.');
  return fy;
}

/** Preference -> default unit -> first accessible unit; ADMIN+ without any unit get "All units". */
export function fallbackUnit(
  user: ContextUser,
  preference: UserPreference | null,
  accessible: readonly Unit[],
): { unitId: string | null; allUnits: boolean } {
  const admin = hasAllUnits(user);
  if (preference?.allUnits && admin) return { unitId: null, allUnits: true };
  const usable = (id: string | null | undefined) =>
    id ? accessible.some((u) => u.id === id) : false;
  if (usable(preference?.unitId)) return { unitId: preference?.unitId ?? null, allUnits: false };
  if (usable(user.defaultUnitId)) return { unitId: user.defaultUnitId, allUnits: false };
  const first = accessible[0];
  if (first) return { unitId: first.id, allUnits: false };
  return { unitId: null, allUnits: admin };
}

async function fallbackFyId(preference: UserPreference | null): Promise<string> {
  if (preference?.fyId) return preference.fyId;
  const fy = await contextRepository.defaultFy();
  if (!fy) throw new Error('No financial year rows: run the migrations / seed');
  return fy.id;
}

/** The context for an authenticated user from the raw header values (undefined/empty = missing). */
/** Phase 23: X-Units tokens (codes or ids) -> concrete plant ids, each checked against what the user may see. */
export async function resolveUnitsHeader(user: ContextUser, header: string): Promise<string[]> {
  const tokens = [...new Set(header.split(',').map((t) => t.trim()).filter((t) => t !== ''))];
  if (tokens.length === 0) throw Errors.contextInvalid('X-Units must list at least one plant.');
  const accessible = await contextRepository.accessibleUnits(user);
  const ids: string[] = [];
  for (const token of tokens) {
    const unit = accessible.find((u) => u.id === token || u.code.toLowerCase() === token.toLowerCase());
    if (!unit) {
      const known = (await contextRepository.allActiveUnits()).find(
        (u) => u.id === token || u.code.toLowerCase() === token.toLowerCase(),
      );
      if (!known) throw Errors.contextInvalid('Unknown plant in X-Units.');
      throw Errors.unitNotAllowed(known.name);
    }
    ids.push(unit.id);
  }
  return ids;
}

/** The write plant of a selection: the default plant when selected, else the first selected one. */
export function writeUnitOf(selected: readonly string[], defaultUnitId: string | null): string | null {
  if (defaultUnitId && selected.includes(defaultUnitId)) return defaultUnitId;
  return selected[0] ?? null;
}

export async function resolveContextFor(
  user: ContextUser,
  unitHeader: string | undefined,
  fyHeader: string | undefined,
  unitsHeader?: string,
): Promise<RequestContext> {
  const unitValue = unitHeader?.trim() ?? '';
  const fyValue = fyHeader?.trim() ?? '';
  if (unitValue !== '' && unitValue.toLowerCase() !== ALL_UNITS && !isUuid(unitValue)) {
    throw Errors.contextInvalid('X-Unit-Id must be a unit id or "all".');
  }
  if (fyValue !== '' && !isUuid(fyValue)) {
    throw Errors.contextInvalid('X-FY-Id must be a financial year id.');
  }
  let preference: UserPreference | null | undefined;
  const loadPreference = async () => {
    preference ??= await contextRepository.preference(user.id);
    return preference;
  };

  let unit: { unitId: string | null; allUnits: boolean };
  let unitIds: string[] | undefined;
  const unitsValue = unitsHeader?.trim() ?? '';
  if (unitValue === '' && unitsValue !== '') {
    unitIds = await resolveUnitsHeader(user, unitsValue);
    unit = { unitId: writeUnitOf(unitIds, user.defaultUnitId), allUnits: false };
  } else if (unitValue === '') {
    const [pref, accessible] = await Promise.all([
      loadPreference(),
      contextRepository.accessibleUnits(user),
    ]);
    // Phase 23: the saved plant choice wins over the single-plant fallback.
    const saved = (await contextRepository.plantPreference(user.id)).unitIds.filter((id) =>
      accessible.some((u) => u.id === id),
    );
    if (saved.length > 0 && !(pref?.allUnits && hasAllUnits(user))) {
      unitIds = saved;
      unit = { unitId: writeUnitOf(saved, user.defaultUnitId), allUnits: false };
    } else {
      unit = fallbackUnit(user, pref, accessible);
    }
  } else if (unitValue.toLowerCase() === ALL_UNITS) {
    await assertUnitChoice(user, null);
    unit = { unitId: null, allUnits: true };
  } else {
    await assertUnitChoice(user, unitValue);
    unit = { unitId: unitValue, allUnits: false };
  }

  const fyId =
    fyValue === ''
      ? await fallbackFyId(await loadPreference())
      : (await assertFyChoice(fyValue)).id;
  // A single plant (or "All units") still gives a list: every module can rely on unitIds being filled.
  if (!unitIds) {
    if (unit.unitId) unitIds = [unit.unitId];
    else unitIds = (await contextRepository.accessibleUnits(user)).map((u) => u.id);
  }
  return { companyId: await companyId(), ...unit, unitIds, fyId };
}

/** Middleware (after authenticate): sets req.ctx or fails with CONTEXT_FORBIDDEN / CONTEXT_INVALID. */
export const resolveContext: RequestHandler = asyncHandler(async (req, _res, next) => {
  if (!req.auth) throw Errors.unauthenticated();
  const user = req.auth.user;
  req.ctx = await resolveContextFor(
    { id: user.id, role: user.role, defaultUnitId: user.defaultUnitId },
    req.get(UNIT_HEADER),
    req.get(FY_HEADER),
    req.get(UNITS_HEADER),
  );
  next();
});

/** Route guard for unit-scoped writes: "All units" (or no unit) is for reading lists only. */
export const requireConcreteUnit: RequestHandler = (req, _res, next) => {
  if (!req.ctx) return next(new Error('requireConcreteUnit needs resolveContext first'));
  if (req.ctx.unitId === null) {
    return next(
      Errors.contextInvalid('Choose a unit first: "All units" is for viewing lists only.'),
    );
  }
  next();
};
