// Typed wrappers for the /users and /meta endpoints used by User Master (CONTRACT §7),
// plus the rule that the Role select offers only roles the actor can manage.
import { api, request } from '../../lib/api';
import type { PageMeta, RoleCode, RoleMeta, UnitRef, User, UserStatus } from '../../types';

export interface UserQuery {
  q: string;
  role: RoleCode | '';
  status: UserStatus | '';
  /** Phase 3: only users who may work in this unit ('' = any). */
  unitId?: string;
  page: number;
  size: number;
}

export interface UserPage {
  users: User[];
  meta: PageMeta;
}

export async function listUsers(query: UserQuery): Promise<UserPage> {
  const params = new URLSearchParams();
  if (query.q.trim()) params.set('q', query.q.trim());
  if (query.role) params.set('role', query.role);
  if (query.status) params.set('status', query.status);
  if (query.unitId) params.set('unitId', query.unitId);
  params.set('page', String(query.page));
  params.set('size', String(query.size));
  params.set('sort', 'name');
  const res = await request<User[]>(`/users?${params.toString()}`);
  return {
    users: res.data,
    meta: res.meta ?? { page: query.page, size: query.size, total: res.data.length },
  };
}

export interface CreateUserInput {
  loginId: string;
  email?: string;
  name: string;
  role: RoleCode;
  department?: string;
  temporaryPassword: string;
  unitIds?: string[];
  defaultUnitId?: string | null;
}

export function createUser(input: CreateUserInput): Promise<User> {
  return api<User>('/users', { method: 'POST', body: input });
}

export type UserPatch = Partial<{
  email: string | null;
  name: string;
  role: RoleCode;
  department: string | null;
  status: UserStatus;
  unitIds: string[];
  defaultUnitId: string | null;
}>;

export function updateUser(id: string, version: number, patch: UserPatch): Promise<User> {
  return api<User>(`/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
    headers: { 'If-Match': String(version) },
  });
}

export function resetUserPassword(id: string, temporaryPassword: string): Promise<void> {
  return api<undefined>(`/users/${encodeURIComponent(id)}/reset-password`, {
    method: 'POST',
    body: { temporaryPassword },
  });
}

export function fetchRoles(): Promise<RoleMeta[]> {
  return api<RoleMeta[]>('/meta/roles');
}

export function fetchDepartments(): Promise<string[]> {
  return api<string[]>('/meta/departments');
}

/** Roles offered in Add/Edit: only those the signed-in actor may manage (from the API). */
export function manageableRoles(roles: RoleMeta[]): RoleMeta[] {
  return roles.filter((r) => r.canManage).sort((a, b) => b.level - a.level);
}

export function canManageUser(row: User, actor: User, roles: RoleMeta[]): boolean {
  if (row.id === actor.id) return false;
  return roles.some((r) => r.code === row.role && r.canManage);
}

export const VERSION_CONFLICT_MESSAGE =
  'This user was changed by someone else. Reload and try again.';

// ---- Phase 3: units per user -------------------------------------------------------

/** Roles that need at least one unit; ADMIN+ work in every unit implicitly. */
export const UNIT_SCOPED_ROLES: readonly RoleCode[] = ['MANAGER', 'LEAD', 'MEMBER'];

export function needsUnits(role: RoleCode | ''): boolean {
  return role !== '' && UNIT_SCOPED_ROLES.includes(role);
}

/** The user's unit ids, whether the API sends `units` objects or plain `unitIds`. */
export function userUnitIds(user: Pick<User, 'units' | 'unitIds'>): string[] {
  return user.units?.map((u) => u.id) ?? user.unitIds ?? [];
}

/** Table text for the Units column. */
export function unitsLabel(user: User, known: UnitRef[]): string {
  if (!needsUnits(user.role)) return 'All units';
  const names =
    user.units?.map((u) => u.name) ??
    userUnitIds(user).map((id) => known.find((k) => k.id === id)?.name ?? id);
  return names.length ? names.join(', ') : '—';
}
