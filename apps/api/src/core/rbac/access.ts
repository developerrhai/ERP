// THE access decision (docs/phase2/CONTRACT.md §2.5): can(user, pageId, action) and
// scopeFor(user, pageId). `decide` is pure (table-driven tests feed it data directly); the
// per-user profile is cached for 60 s and the whole cache is cleared on any write that can
// change an answer (role_permissions, department_families, module_controls, departments, users).
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
import { hasMinRole } from './role-rules';
import type { RoleCode } from './role-rules';

export interface AccessUser {
  id: string;
  role: RoleCode;
  department: string | null;
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
  /** False when the role has no row at all on the page -> family -> "*" chain. */
  hasRow: boolean;
}

export interface AccessData {
  /** module_controls by pageId. A page without a row is treated as disabled (fail closed). */
  controls: ReadonlyMap<string, ControlFlags>;
  /** role_permissions of the user's role, by resource ("*", "family:X", "page:id"). */
  rows: ReadonlyMap<string, PermissionRow>;
  /** department_families of the user's department. */
  departmentFamilies: ReadonlySet<string>;
}

export interface PageAccess {
  actions: ActionFlags;
  scope: Scope;
}

/**
 * Page -> family -> "*", per cell: for each action (and for the scope) the most specific row with a
 * non-null value wins. A cell that is null everywhere resolves to false / OWN.
 */
export function resolvePermission(
  pageId: string,
  family: string,
  rows: ReadonlyMap<string, PermissionRow>,
): ResolvedPermission {
  const chain = [
    rows.get(pageResource(pageId)),
    rows.get(familyResource(family)),
    rows.get(DEFAULT_RESOURCE),
  ].filter((r): r is PermissionRow => r !== undefined);
  const actions = noActions();
  for (const action of ACTIONS) {
    actions[action] = chain.find((r) => r[action] !== null)?.[action] ?? false;
  }
  const scope = chain.find((r) => r.scope !== null)?.scope ?? 'OWN';
  return { actions, scope, hasRow: chain.length > 0 };
}

/** Pages exempt from the department gate (they keep a Phase 1 role rule instead). */
const ADMIN_ONLY_PAGES: ReadonlySet<string> = new Set(['admin-users']);

export function decideScope(user: AccessUser, pageId: string, data: AccessData): Scope {
  if (user.role === 'SUPER_ADMIN') return 'ALL';
  const page = pageInfo(pageId);
  if (!page) return 'OWN';
  return resolvePermission(pageId, page.family, data.rows).scope;
}

/** §2.5, step by step. */
export function decide(
  user: AccessUser,
  pageId: string,
  action: Action,
  data: AccessData,
): boolean {
  // 1. Unknown page.
  const page = pageInfo(pageId);
  if (!page) return false;

  const isKitTestPage = process.env.KIT_ALLOW_TEST_PAGES === 'true' && pageId.startsWith('kit-');

  // 2. Disabled module: hidden from everyone; SUPER_ADMIN keeps only `controls` to re-enable it.
  const control =
    data.controls.get(pageId) ??
    (isKitTestPage
      ? { enabled: true, allowAdd: true, allowEdit: true, allowDelete: true, allowExport: true }
      : undefined);
  if (!control || !control.enabled) return user.role === 'SUPER_ADMIN' && action === 'controls';

  // 3. allow_* switches are business rules and bind SUPER_ADMIN too.
  const flag = ALLOW_FLAG_FOR[action];
  if (flag && !control[flag]) return false;

  // 4. The owner may do everything else.
  if (user.role === 'SUPER_ADMIN') return true;

  // Hard rule: Administration pages are ADMIN and above only, whatever the table says
  // (this also keeps admin-users on its Phase 1 rule).
  if (page.family === ADMIN_FAMILY && !hasMinRole(user.role, 'ADMIN')) return false;

  const row = resolvePermission(pageId, page.family, data.rows);
  if (!row.hasRow) return false;

  // 5. Department gate, skipped for scope ALL, admin-users, and kit test pages.
  if (row.scope !== 'ALL' && !ADMIN_ONLY_PAGES.has(pageId) && !isKitTestPage) {
    if (!data.departmentFamilies.has(page.family)) return false;
  }

  // 6. Role gate.
  if (!row.actions[action]) return false;

  // 7. Hierarchy guard: configuration needs ADMIN or above, whatever the table says.
  if (action === 'controls' && !hasMinRole(user.role, 'ADMIN')) return false;
  return true;
}

export function buildProfile(user: AccessUser, data: AccessData): Map<string, PageAccess> {
  const profile = new Map<string, PageAccess>();
  const pageIds = new Set<string>([...registry.pages.keys(), ...TYPED_PAGES]);
  for (const pageId of pageIds) {
    const actions = noActions();
    for (const action of ACTIONS) actions[action] = decide(user, pageId, action, data);
    profile.set(pageId, { actions, scope: decideScope(user, pageId, data) });
  }
  return profile;
}

export async function loadAccessData(user: AccessUser): Promise<AccessData> {
  const [controls, rows, families] = await Promise.all([
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
    user.role === 'SUPER_ADMIN'
      ? Promise.resolve([])
      : prisma.rolePermission.findMany({ where: { role: user.role } }),
    user.department
      ? prisma.departmentFamily.findMany({
          where: { departmentName: user.department },
          select: { family: true },
        })
      : Promise.resolve([]),
  ]);
  return {
    controls: new Map(controls.map((c) => [c.pageId, c])),
    rows: new Map(rows.map((r) => [r.resource, r])),
    departmentFamilies: new Set(families.map((f) => f.family)),
  };
}

// ---------------------------------------------------------------------------------------------
// Cache: 60 s per user, cleared globally on writes. A generation counter stops a profile that was
// being computed during an invalidation from being stored afterwards with stale data.
// ---------------------------------------------------------------------------------------------
export const ACCESS_CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 10_000;
const cache = new Map<string, { expiresAt: number; profile: Map<string, PageAccess> }>();
let generation = 0;

function cacheKey(user: AccessUser): string {
  return `${user.id}|${user.role}|${user.department ?? ''}`;
}

export function invalidateAccessCache(): void {
  generation += 1;
  cache.clear();
}

export function accessCacheSize(): number {
  return cache.size;
}

export async function accessProfile(user: AccessUser): Promise<Map<string, PageAccess>> {
  const key = cacheKey(user);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.profile;
  const startedAt = generation;
  const profile = buildProfile(user, await loadAccessData(user));
  if (startedAt === generation) {
    if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
    cache.set(key, { expiresAt: Date.now() + ACCESS_CACHE_TTL_MS, profile });
  }
  return profile;
}

export async function can(user: AccessUser, pageId: string, action: Action): Promise<boolean> {
  const prof = await accessProfile(user);
  const entry = prof.get(pageId);
  if (entry) return entry.actions[action];
  return decide(user, pageId, action, await loadAccessData(user));
}

export async function scopeFor(user: AccessUser, pageId: string): Promise<Scope> {
  const prof = await accessProfile(user);
  const entry = prof.get(pageId);
  if (entry) return entry.scope;
  return decideScope(user, pageId, await loadAccessData(user));
}

/** Route guard for page-level permissions (used by Phase 2 admin endpoints and Phase 4 records). */
export function requirePageAction(pageId: string, action: Action): RequestHandler {
  if (!pageInfo(pageId)) throw new Error(`requirePageAction: unknown page id ${pageId}`);
  return asyncHandler(async (req, _res, next) => {
    if (!req.auth) throw Errors.unauthenticated();
    const user = req.auth.user;
    if (
      !(await can({ id: user.id, role: user.role, department: user.department }, pageId, action))
    ) {
      throw Errors.forbidden();
    }
    next();
  });
}

/**
 * Like requirePageAction, but the page id comes from the `:pageId` route parameter (Phase 4
 * generic records). An unknown page id is a 404; the access decision is the same.
 */
export function requireParamPageAction(action: Action): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    if (!req.auth) throw Errors.unauthenticated();
    const pageId = req.params.pageId ?? '';
    if (!pageInfo(pageId)) throw Errors.notFound('Unknown page.');
    const user = req.auth.user;
    if (
      !(await can({ id: user.id, role: user.role, department: user.department }, pageId, action))
    ) {
      throw Errors.forbidden();
    }
    next();
  });
}

export function accessUserOf(user: {
  id: string;
  role: RoleCode;
  department: string | null;
}): AccessUser {
  return { id: user.id, role: user.role, department: user.department };
}
