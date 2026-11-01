// Shared API types for the web client, mirroring the DTOs in docs/phase1/CONTRACT.md §7
// so every screen agrees on the shape of a user, a role and an error.

export type RoleCode = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'LEAD' | 'MEMBER';
export type UserStatus = 'ACTIVE' | 'INACTIVE';

export interface User {
  id: string;
  loginId: string;
  email: string | null;
  name: string;
  role: RoleCode;
  roleLabel: string;
  roleLevel: number;
  department: string | null;
  status: UserStatus;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface AuthResult {
  accessToken: string;
  expiresIn: number;
  user: User;
}

export interface RoleMeta {
  code: RoleCode;
  label: string;
  level: number;
  canManage: boolean;
}

export interface PageMeta {
  page: number;
  size: number;
  total: number;
}

// ---- Phase 2 (docs/phase2/CONTRACT.md §2–§3) ------------------------------

export const ACTIONS = ['view', 'add', 'edit', 'delete', 'approve', 'export', 'controls'] as const;
export type Action = (typeof ACTIONS)[number];
export type ActionSet = Record<Action, boolean>;
export type Scope = 'OWN' | 'DEPARTMENT' | 'ALL';
export const SCOPES: readonly Scope[] = ['OWN', 'DEPARTMENT', 'ALL'];

export interface PagePermissions {
  pageId: string;
  actions: ActionSet;
  scope: Scope;
}

export interface MenuFamily {
  name: string;
  icon: string;
  items: { id: string; title: string }[];
}

export interface Department {
  id: string;
  code: string;
  name: string;
  head: string | null;
  status: UserStatus;
  userCount: number;
  version: number;
}

export interface RoleInfo {
  code: RoleCode;
  label: string;
  level: number;
  userCount: number;
  canManage: boolean;
}

/**
 * A role_permissions row. On `*` every cell is set; on family/page rows a null cell (or scope)
 * means "inherit from the less specific row" (Phase 2 orchestrator decision).
 */
export type PermissionRow = Record<Action, boolean | null> & {
  resource: string;
  scope: Scope | null;
  version?: number;
};

export interface RolePermissions {
  role: Exclude<RoleCode, 'SUPER_ADMIN'>;
  editable: boolean;
  rows: PermissionRow[];
}

export interface ModuleControl {
  pageId: string;
  title: string;
  family: string;
  enabled: boolean;
  ownerDepartment: string;
  approvalRequired: boolean;
  allowAdd: boolean;
  allowEdit: boolean;
  allowDelete: boolean;
  allowExport: boolean;
  version: number;
}

export interface Letterhead {
  companyName: string;
  legalName: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  gstin: string;
  pan: string;
  cin: string;
  footer: string;
  signatory: string;
}

export interface AuditLog {
  id: string;
  at: string;
  actorId: string | null;
  actorName: string | null;
  actorLoginId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  userAgent: string | null;
  detail: unknown;
}
