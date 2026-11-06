// THE access decision (docs/phases/PHASE-02.md §5): can(user, pageId, action),
// scopeFor(user, pageId) and explain(user, pageId).
// Pure decide() function, 12 actions, 4 scopes, explicit-deny-wins.
// Cached for 60 s per user profile; cache invalidated on any permission-related write.
import type { RequestHandler } from 'express';
import { prisma } from '../db/prisma';
import { asyncHandler } from '../http/async-handler';
import { Errors } from '../http/errors';
import { ADMIN_FAMILY, pageInfo, registry } from '../registry';
import { TYPED_PAGES } from '../../engine/kinds';
import {
  ACTIONS,
  ALLOW_FLAG_FOR,
  DEFAULT_RESOURCE,
  familyResource,
  noActions,
  pageResource,
} from './permission-model';
import type { Action, ActionFlags, Scope } from './permission-model';
import { ADMIN_LEVEL, LEGACY_LEVELS, SUPER_USER_LEVEL } from './role-rules';

export interface AccessUser {
  id: string;
  roleId: string;
  roleCode: string;
  level: number;
  allUnits: boolean;
  departments: string[]; // [home, ...extra]
}

export interface ControlFlags {
  enabled: boolean;
  allowAdd: boolean;
  allowEdit: boolean;
  allowDelete: boolean;
  allowExport: boolean;
}

/** A stored row. On family/page rows null means "inherit from the next less specific row". */
export type PermissionRow = { [A in Action]: boolean | null } & { scope: Scope | null };

/** The resolved cells for one page: each action and the scope resolved independently. */
export interface ResolvedPermission {
  actions: ActionFlags;
  scope: Scope;
  hasRow: boolean;
  denySources: Partial<Record<Action, string>>;
  allowSources: Partial<Record<Action, string>>;
  scopeSource?: string;
}

export interface AccessData {
  controls: ReadonlyMap<string, ControlFlags>;
  rows: ReadonlyMap<string, PermissionRow>;
  departmentFamilies: ReadonlySet<string>;
  roleVersion: number;
  unitIds: string;
}

export interface PageAccess {
  actions: ActionFlags;
  scope: Scope;
  reasons: string[];
}

/**
 * Page -> family -> "*", per cell.
 * Explicit deny wins: if page row OR family row has false, false wins.
 * Otherwise, if either has true, true wins.
 * Otherwise use the "*" row value.
 */
export function resolvePermission(
  pageId: string,
  family: string,
  rows: ReadonlyMap<string, PermissionRow>,
): ResolvedPermission {
  const pageRow = rows.get(pageResource(pageId));
  const familyRow = rows.get(familyResource(family));
  const defaultRow = rows.get(DEFAULT_RESOURCE);

  const actions = noActions();
  const denySources: Partial<Record<Action, string>> = {};
  const allowSources: Partial<Record<Action, string>> = {};

  for (const action of ACTIONS) {
    if (pageRow && pageRow[action] === false) {
      actions[action] = false;
      denySources[action] = `Denied by page row '${pageId}'`;
    } else if (familyRow && familyRow[action] === false) {
      actions[action] = false;
      denySources[action] = `Denied by family row '${family}'`;
    } else if (pageRow && pageRow[action] === true) {
      actions[action] = true;
      allowSources[action] = `Allowed by page row '${pageId}'`;
    } else if (familyRow && familyRow[action] === true) {
      actions[action] = true;
      allowSources[action] = `Allowed by family row '${family}'`;
    } else if (defaultRow && defaultRow[action] !== null) {
      actions[action] = defaultRow[action] ?? false;
      if (defaultRow[action]) {
        allowSources[action] = 'Allowed by role default (*)';
      } else {
        denySources[action] = 'Denied by role default (*)';
      }
    } else {
      actions[action] = false;
      denySources[action] = 'No permission row defined';
    }
  }

  let scope: Scope = 'OWN';
  let scopeSource = 'Default scope (OWN)';
  if (pageRow && pageRow.scope !== null) {
    scope = pageRow.scope;
    scopeSource = `Scope from page row '${pageId}'`;
  } else if (familyRow && familyRow.scope !== null) {
    scope = familyRow.scope;
    scopeSource = `Scope from family row '${family}'`;
  } else if (defaultRow && defaultRow.scope !== null) {
    scope = defaultRow.scope;
    scopeSource = 'Scope from role default (*)';
  }

  const hasRow = Boolean(pageRow || familyRow || defaultRow);
  return { actions, scope, hasRow, denySources, allowSources, scopeSource };
}

function normalizeUser(u: any): AccessUser {
  if (u && typeof u.level === 'number' && Array.isArray(u.departments)) {
    return u as AccessUser;
  }
  const roleCode = u?.roleCode || u?.role || 'EMPLOYEE';
  const level = typeof u?.level === 'number' ? u.level : (LEGACY_LEVELS[roleCode] ?? 10);
  const departments = Array.isArray(u?.departments)
    ? u.departments
    : u?.department
      ? [u.department]
      : [];
  return {
    id: u?.id ?? 'unknown',
    roleId: u?.roleId ?? '',
    roleCode,
    level,
    allUnits: u?.allUnits ?? (level >= ADMIN_LEVEL),
    departments,
  };
}

export function decideScope(user: AccessUser, pageId: string, data: AccessData): Scope {
  const u = normalizeUser(user);
  if (u.level >= SUPER_USER_LEVEL) return 'ALL';
  const page = pageInfo(pageId);
  if (!page) return 'OWN';
  return resolvePermission(pageId, page.family, data.rows).scope;
}

/**
 * §5.2 Access decision, step by step:
 * 1. Unknown page -> false.
 * 2. Module control missing or disabled -> false. Only SUPER_USER keeps controls.
 * 3. allow_* switches veto everyone, Super User included.
 * 4. SUPER_USER -> true.
 * 5. Administration family and role level below 95 -> false (hard rule).
 * 6. Resolve cell: explicit deny wins.
 * 7. Scope = most specific non-null scope (page -> family -> *).
 * 8. Department gate: if scope is OWN or DEPARTMENT, family must be in combined department_families.
 *    UNIT and ALL skip this gate.
 * 9. controls action needs level >= 95.
 */
export function decide(
  user: AccessUser,
  pageId: string,
  action: Action,
  data: AccessData,
): boolean {
  const u = normalizeUser(user);
  // 1. Unknown page.
  const page = pageInfo(pageId);
  if (!page) return false;

  const isKitTestPage = process.env.KIT_ALLOW_TEST_PAGES === 'true' && pageId.startsWith('kit-');

  // 2. Disabled module: hidden from everyone; SUPER_USER keeps only controls.
  const control =
    data.controls.get(pageId) ??
    (isKitTestPage
      ? { enabled: true, allowAdd: true, allowEdit: true, allowDelete: true, allowExport: true }
      : undefined);
  if (!control || !control.enabled) {
    return u.level >= SUPER_USER_LEVEL && action === 'controls';
  }

  // 3. allow_* switches veto everyone, Super User included.
  const flag = ALLOW_FLAG_FOR[action];
  if (flag && !control[flag]) return false;

  // 4. SUPER_USER (level 99) -> true.
  if (u.level >= SUPER_USER_LEVEL) return true;

  // 5. Administration family hard rule: role level below 95 -> false.
  if (page.family === ADMIN_FAMILY && u.level < ADMIN_LEVEL) return false;

  // 6 & 7. Resolve permission cells and scope.
  const row = resolvePermission(pageId, page.family, data.rows);
  if (!row.hasRow) return false;

  // 8. Department gate: skipped for UNIT, ALL, and kit test pages.
  if (row.scope === 'OWN' || row.scope === 'DEPARTMENT') {
    if (!isKitTestPage && !data.departmentFamilies.has(page.family)) {
      return false;
    }
  }

  // 9. Role cell must be true.
  if (!row.actions[action]) return false;

  // 10. controls action needs level >= 95.
  if (action === 'controls' && user.level < ADMIN_LEVEL) return false;

  return true;
}

/**
 * §5.7 Effective access explanation for a page.
 * Returns { actions, scope, reasons[] }.
 */
export function explain(
  user: AccessUser,
  pageId: string,
  data: AccessData,
): { actions: ActionFlags; scope: Scope; reasons: string[] } {
  const page = pageInfo(pageId);
  if (!page) {
    return { actions: noActions(), scope: 'OWN', reasons: ['Unknown page.'] };
  }

  const isKitTestPage = process.env.KIT_ALLOW_TEST_PAGES === 'true' && pageId.startsWith('kit-');
  const control =
    data.controls.get(pageId) ??
    (isKitTestPage
      ? { enabled: true, allowAdd: true, allowEdit: true, allowDelete: true, allowExport: true }
      : undefined);

  const actions = noActions();
  const reasons: string[] = [];

  const resolved = resolvePermission(pageId, page.family, data.rows);
  const u = normalizeUser(user);
  const effectiveScope = u.level >= SUPER_USER_LEVEL ? 'ALL' : resolved.scope;

  for (const action of ACTIONS) {
    if (!control || !control.enabled) {
      if (u.level >= SUPER_USER_LEVEL && action === 'controls') {
        actions[action] = true;
        reasons.push(`${action}: Allowed because Super User can re-enable disabled module`);
      } else {
        actions[action] = false;
        reasons.push(`${action}: Module disabled in System Control Center`);
      }
      continue;
    }

    const flag = ALLOW_FLAG_FOR[action];
    if (flag && !control[flag]) {
      actions[action] = false;
      reasons.push(`${action}: Switch ${flag} is disabled in System Control Center`);
      continue;
    }

    if (u.level >= SUPER_USER_LEVEL) {
      actions[action] = true;
      reasons.push(`${action}: Super User full access`);
      continue;
    }

    if (page.family === ADMIN_FAMILY && u.level < ADMIN_LEVEL) {
      actions[action] = false;
      reasons.push(`${action}: Administration pages are only for Administrator and Super User`);
      continue;
    }

    if (!resolved.hasRow) {
      actions[action] = false;
      reasons.push(`${action}: No permission row found for role`);
      continue;
    }

    if (effectiveScope === 'OWN' || effectiveScope === 'DEPARTMENT') {
      if (!isKitTestPage && !data.departmentFamilies.has(page.family)) {
        actions[action] = false;
        const deptList = user.departments.length > 0 ? user.departments.join(', ') : 'None';
        reasons.push(`${action}: Family not in departments ${deptList}`);
        continue;
      }
    }

    if (!resolved.actions[action]) {
      actions[action] = false;
      reasons.push(`${action}: ${resolved.denySources[action] ?? 'Denied by role permissions'}`);
      continue;
    }

    if (action === 'controls' && user.level < ADMIN_LEVEL) {
      actions[action] = false;
      reasons.push(`${action}: Controls action requires role level >= 95`);
      continue;
    }

    actions[action] = true;
    reasons.push(`${action}: ${resolved.allowSources[action] ?? 'Allowed'}`);
  }

  return { actions, scope: effectiveScope, reasons };
}

export function buildProfile(user: AccessUser, data: AccessData): Map<string, PageAccess> {
  const profile = new Map<string, PageAccess>();
  const pageIds = new Set<string>([...registry.pages.keys(), ...TYPED_PAGES]);
  for (const pageId of pageIds) {
    const explained = explain(user, pageId, data);
    profile.set(pageId, {
      actions: explained.actions,
      scope: explained.scope,
      reasons: explained.reasons,
    });
  }
  return profile;
}

export async function loadAccessData(user: AccessUser): Promise<AccessData> {
  const depts = user.departments ?? [];
  const [controls, rows, families, roleRow, userUnits] = await Promise.all([
    prisma.moduleControl.findMany({
      select: {
        pageId: true,
        enabled: true,
        allowAdd: true,
        allowEdit: true,
        allowDelete: true,
        allowExport: true,
      },
    }),
    user.level >= SUPER_USER_LEVEL
      ? Promise.resolve([])
      : prisma.rolePermission.findMany({ where: { roleId: user.roleId } }),
    depts.length > 0
      ? prisma.departmentFamily.findMany({
          where: { departmentName: { in: depts } },
          select: { family: true },
        })
      : Promise.resolve([]),
    prisma.role.findUnique({
      where: { id: user.roleId },
      select: { version: true },
    }),
    prisma.userUnit.findMany({
      where: { userId: user.id },
      select: { unitId: true },
    }),
  ]);

  const unitIds = userUnits
    .map((u) => u.unitId)
    .sort()
    .join(',');

  return {
    controls: new Map(controls.map((c) => [c.pageId, c])),
    rows: new Map(rows.map((r) => [r.resource, r as PermissionRow])),
    departmentFamilies: new Set(families.map((f) => f.family)),
    roleVersion: roleRow?.version ?? 1,
    unitIds,
  };
}

// ---------------------------------------------------------------------------------------------
// Cache: 60 s per user profile, cleared globally on writes (§5.6).
// Key: userId | roleId | roleVersion | departments | unitIds
// ---------------------------------------------------------------------------------------------
export const ACCESS_CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 10_000;
const cache = new Map<string, { expiresAt: number; profile: Map<string, PageAccess> }>();
let generation = 0;

export function cacheKey(user: AccessUser, roleVersion: number, unitIds: string): string {
  const depts = [...user.departments].sort().join(',');
  return `${user.id}|${user.roleId}|${roleVersion}|${depts}|${unitIds}`;
}

export function invalidateAccessCache(): void {
  generation += 1;
  cache.clear();
}

export function accessCacheSize(): number {
  return cache.size;
}

export async function accessProfile(user: AccessUser): Promise<Map<string, PageAccess>> {
  const data = await loadAccessData(user);
  const key = cacheKey(user, data.roleVersion, data.unitIds);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.profile;

  const startedAt = generation;
  const profile = buildProfile(user, data);
  if (startedAt === generation) {
    if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
    cache.set(key, { expiresAt: Date.now() + ACCESS_CACHE_TTL_MS, profile });
  }
  return profile;
}

export async function can(user: AccessUser, pageId: string, action: Action): Promise<boolean> {
  const u = user?.departments ? user : accessUserOf(user);
  const prof = await accessProfile(u);
  const entry = prof.get(pageId);
  if (entry) return entry.actions[action];
  return decide(u, pageId, action, await loadAccessData(u));
}

export async function scopeFor(user: AccessUser, pageId: string): Promise<Scope> {
  const u = user?.departments ? user : accessUserOf(user);
  const prof = await accessProfile(u);
  const entry = prof.get(pageId);
  if (entry) return entry.scope;
  return decideScope(u, pageId, await loadAccessData(u));
}

/** Route guard for page-level permissions. */
export function requirePageAction(pageId: string, action: Action): RequestHandler {
  if (!pageInfo(pageId)) throw new Error(`requirePageAction: unknown page id ${pageId}`);
  return asyncHandler(async (req, _res, next) => {
    if (!req.auth) throw Errors.unauthenticated();
    const user = accessUserOf(req.auth);
    if (!(await can(user, pageId, action))) {
      throw Errors.forbidden();
    }
    next();
  });
}

/** Like requirePageAction, but the page id comes from :pageId param. */
export function requireParamPageAction(action: Action): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    if (!req.auth) throw Errors.unauthenticated();
    const pageId = req.params.pageId ?? '';
    if (!pageInfo(pageId)) throw Errors.notFound('Unknown page.');
    const user = accessUserOf(req.auth);
    if (!(await can(user, pageId, action))) {
      throw Errors.forbidden();
    }
    next();
  });
}

export function accessUserOf(source: {
  userId?: string;
  id?: string;
  roleId?: string;
  roleCode?: string;
  level?: number;
  allUnits?: boolean;
  departments?: string[];
  role?: any;
  department?: string | null;
  extraDepartments?: any[];
}): AccessUser {
  const id = source.userId ?? source.id ?? '';
  let roleId = source.roleId ?? '';
  let roleCode = source.roleCode ?? '';
  let level = source.level;
  let allUnits = source.allUnits;

  if (source.role && typeof source.role === 'object') {
    roleId = roleId || source.role.id;
    roleCode = roleCode || source.role.code;
    if (level === undefined) level = source.role.level;
    if (allUnits === undefined) allUnits = source.role.allUnits;
  } else if (typeof source.role === 'string') {
    roleCode = roleCode || source.role;
    if (level === undefined) level = LEGACY_LEVELS[source.role];
  }

  level = level ?? 10;
  allUnits = allUnits ?? false;

  let departments = source.departments ? [...source.departments] : [];
  if (departments.length === 0) {
    if (source.department) departments.push(source.department);
    if (Array.isArray(source.extraDepartments)) {
      for (const d of source.extraDepartments) {
        const name = typeof d === 'string' ? d : d.departmentName;
        if (name && !departments.includes(name)) departments.push(name);
      }
    }
  }

  return { id, roleId, roleCode, level, allUnits, departments };
}
