// Typed wrappers for the Phase 2 admin endpoints (docs/phase2/CONTRACT.md §3). Every PATCH/PUT of
// a versioned row sends If-Match (PUT /permissions/:role uses the role's highest row version).
import { api, request } from '../../lib/api';
import type {
  AuditLog,
  Department,
  Letterhead,
  ModuleControl,
  PageMeta,
  PermissionRow,
  RoleCode,
  RoleInfo,
  RolePermissions,
  UserStatus,
} from '../../types';

const ifMatch = (version: number): Record<string, string> => ({ 'If-Match': String(version) });

// ---- departments -----------------------------------------------------------

export function listDepartments(): Promise<Department[]> {
  return api<Department[]>('/departments');
}

export interface DepartmentInput {
  code: string;
  name: string;
  head?: string | null;
  status?: UserStatus;
}

export function createDepartment(input: DepartmentInput): Promise<Department> {
  return api<Department>('/departments', { method: 'POST', body: input });
}

export function updateDepartment(
  id: string,
  version: number,
  patch: Partial<DepartmentInput>,
): Promise<Department> {
  return api<Department>(`/departments/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
    headers: ifMatch(version),
  });
}

export function deleteDepartment(id: string, version: number): Promise<void> {
  return api<undefined>(`/departments/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: ifMatch(version),
  });
}

// ---- roles & permissions -----------------------------------------------------

export function listRoles(): Promise<RoleInfo[]> {
  return api<RoleInfo[]>('/roles');
}

export interface PermissionsData {
  roles: RolePermissions[];
  families: string[];
}

export function getPermissions(): Promise<PermissionsData> {
  return api<PermissionsData>('/permissions');
}

/**
 * If-Match for PUT /permissions/:role is the highest version among that role's rows
 * (CONTRACT §3 lets the API choose "max version" or a role-level version; this client uses max).
 */
export function roleVersion(rows: PermissionRow[]): number {
  return rows.reduce((max, r) => Math.max(max, r.version ?? 0), 0);
}

/** Row body for PUT /permissions/:role; null cells/scope mean inherit. */
export type PermissionRowInput = Omit<PermissionRow, 'version'>;

export function savePermissions(
  role: RolePermissions['role'],
  version: number,
  rows: PermissionRowInput[],
): Promise<unknown> {
  return api<unknown>(`/permissions/${role}`, {
    method: 'PUT',
    body: { rows },
    headers: ifMatch(version),
  });
}

export interface DepartmentAccessData {
  departments: { name: string; families: string[] }[];
  families: string[];
}

export function getDepartmentAccess(): Promise<DepartmentAccessData> {
  return api<DepartmentAccessData>('/department-access');
}

export function saveDepartmentAccess(department: string, families: string[]): Promise<unknown> {
  return api<unknown>(`/department-access/${encodeURIComponent(department)}`, {
    method: 'PUT',
    body: { families },
  });
}

// ---- module controls ---------------------------------------------------------

export function listModuleControls(family: string, q: string): Promise<ModuleControl[]> {
  const params = new URLSearchParams();
  if (family) params.set('family', family);
  if (q.trim()) params.set('q', q.trim());
  const qs = params.toString();
  return api<ModuleControl[]>(`/module-controls${qs ? `?${qs}` : ''}`);
}

export type ModuleControlPatch = Partial<
  Pick<
    ModuleControl,
    | 'enabled'
    | 'ownerDepartment'
    | 'approvalRequired'
    | 'allowAdd'
    | 'allowEdit'
    | 'allowDelete'
    | 'allowExport'
  >
>;

export function updateModuleControl(
  pageId: string,
  version: number,
  patch: ModuleControlPatch,
): Promise<ModuleControl> {
  return api<ModuleControl>(`/module-controls/${encodeURIComponent(pageId)}`, {
    method: 'PATCH',
    body: patch,
    headers: ifMatch(version),
  });
}

export function activeDepartmentNames(): Promise<string[]> {
  return api<string[]>('/meta/departments');
}

// ---- letterhead --------------------------------------------------------------

export const LETTERHEAD_KEYS = [
  'companyName',
  'legalName',
  'address',
  'phone',
  'email',
  'website',
  'gstin',
  'pan',
  'cin',
  'footer',
  'signatory',
] as const satisfies readonly (keyof Letterhead)[];

export interface LetterheadData {
  value: Letterhead;
  version: number;
}

/** Fixed API shape: `{data:{value:{…11 fields}, version}}`. Missing fields show as empty inputs. */
function withAllFields(data: LetterheadData): LetterheadData {
  const value = {} as Letterhead;
  for (const k of LETTERHEAD_KEYS) value[k] = data.value[k] ?? '';
  return { value, version: data.version };
}

export async function getLetterhead(): Promise<LetterheadData> {
  return withAllFields(await api<LetterheadData>('/settings/letterhead'));
}

export async function saveLetterhead(version: number, value: Letterhead): Promise<LetterheadData> {
  const saved = await api<LetterheadData>('/settings/letterhead', {
    method: 'PUT',
    body: value,
    headers: ifMatch(version),
  });
  return withAllFields(saved);
}

// ---- audit -------------------------------------------------------------------

export interface AuditQuery {
  from: string;
  to: string;
  actorId: string;
  action: string;
  q: string;
  page: number;
  size: number;
}

/** Audit row as the API returns it (fixed shape: `actor:{id,name,loginId}|null`). */
export interface AuditLogDto {
  id: string;
  at: string;
  actor: { id: string; name: string; loginId: string } | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  userAgent: string | null;
  detail: unknown;
}

export function toAuditLog(dto: AuditLogDto): AuditLog {
  return {
    id: dto.id,
    at: dto.at,
    actorId: dto.actor?.id ?? null,
    actorName: dto.actor?.name ?? null,
    actorLoginId: dto.actor?.loginId ?? null,
    action: dto.action,
    targetType: dto.targetType ?? null,
    targetId: dto.targetId ?? null,
    ip: dto.ip ?? null,
    userAgent: dto.userAgent ?? null,
    detail: dto.detail ?? null,
  };
}

/** Date inputs are local days; "to" is inclusive, so it becomes the end of that day. */
export function dayBoundary(day: string, end: boolean): string {
  const d = new Date(`${day}T${end ? '23:59:59.999' : '00:00:00.000'}`);
  return d.toISOString();
}

export async function listAuditLogs(
  query: AuditQuery,
): Promise<{ rows: AuditLog[]; meta: PageMeta }> {
  const params = new URLSearchParams();
  if (query.from) params.set('from', dayBoundary(query.from, false));
  if (query.to) params.set('to', dayBoundary(query.to, true));
  if (query.actorId) params.set('actorId', query.actorId);
  if (query.action) params.set('action', query.action);
  if (query.q.trim()) params.set('q', query.q.trim());
  params.set('page', String(query.page));
  params.set('size', String(query.size));
  const res = await request<AuditLogDto[]>(`/audit-logs?${params.toString()}`);
  const rows = res.data.map(toAuditLog);
  return { rows, meta: res.meta ?? { page: query.page, size: query.size, total: rows.length } };
}

export async function getAuditLog(id: string): Promise<AuditLog> {
  return toAuditLog(await api<AuditLogDto>(`/audit-logs/${encodeURIComponent(id)}`));
}

export const AUDIT_ACTIONS = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'ACCOUNT_LOCKED',
  'LOGOUT',
  'LOGOUT_ALL',
  'TOKEN_REUSE_DETECTED',
  'PASSWORD_CHANGED',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_PASSWORD_RESET',
  'DEPARTMENT_CREATED',
  'DEPARTMENT_UPDATED',
  'DEPARTMENT_DELETED',
  'PERMISSIONS_UPDATED',
  'DEPARTMENT_ACCESS_UPDATED',
  'MODULE_CONTROL_UPDATED',
  'SETTINGS_UPDATED',
] as const;

export const ROLE_CREATED_BY: Record<RoleCode, string> = {
  SUPER_ADMIN: 'Nobody (the owner, created by setup)',
  ADMIN: 'Super Admin',
  MANAGER: 'Super Admin, Admin',
  LEAD: 'Super Admin, Admin',
  MEMBER: 'Super Admin, Admin',
};
