// Shared API types for the web client, mirroring the DTOs in docs/phase1/CONTRACT.md §7
// so every screen agrees on the shape of a user, a role and an error.

export type RoleCode = string;
export type UserStatus = 'ACTIVE' | 'INACTIVE';

export interface User {
  id: string;
  loginId: string;
  email: string | null;
  name: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  roleLevel: number;
  role: string;
  roleLabel: string;
  department: string | null;
  extraDepartments?: string[];
  approvalLimit?: string | null;
  status: UserStatus;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  previousLoginAt?: string | null;
  previousLoginIp?: string | null;
  lockedUntil?: string | null;
  mfaEnabled?: boolean;
  mfaSetupRequired?: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
  /** Units the user may work in (SUPER_USER / allUnits roles have all units implicitly). */
  units?: UnitRef[];
  unitIds?: string[];
  defaultUnitId?: string | null;
}

export interface AuthResult {
  accessToken: string;
  expiresIn: number;
  user: User;
}

export interface MfaChallengeResult {
  mfaRequired: true;
  challengeId: string;
  expiresIn: number;
}

export type LoginResponse = AuthResult | MfaChallengeResult;

export interface SessionInfo {
  id: string;
  familyId: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  revokedAt?: string | null;
  revokedReason?: string | null;
  isCurrent?: boolean;
  isLive?: boolean;
  mfaVerified?: boolean;
}

export interface SecurityPolicy {
  passwordMinLength: number;
  maxFailedLogins: number;
  lockoutMinutes: number;
  idleMinutes: number;
  absoluteHours: number;
  maxSessionsPerUser: number;
  mfaRequiredForAdmins: boolean;
}

export interface SecurityPolicyRecord {
  value: SecurityPolicy;
  version: number;
}

export interface MfaStatus {
  eligible: boolean;
  enabled: boolean;
  required: boolean;
  recoveryCodesRemaining: number;
  enrolledAt: string | null;
}

export interface RoleMeta {
  id: string;
  code: string;
  name: string;
  label: string;
  level: number;
  canManage: boolean;
  allUnits: boolean;
}

export interface PageMeta {
  page: number;
  size: number;
  total: number;
  /** Column totals over all matching rows (typed list pages such as Stock Balance). */
  totals?: Record<string, number | string>;
}

// ---- Phase 02 (Roles & Access v2) ----------------------------------------

export const ACTIONS = [
  'view',
  'add',
  'edit',
  'delete',
  'approve',
  'export',
  'controls',
  'submit',
  'post',
  'cancel',
  'print',
  'import',
] as const;
export type Action = (typeof ACTIONS)[number];
export type ActionSet = Record<Action, boolean>;
export type Scope = 'OWN' | 'DEPARTMENT' | 'UNIT' | 'ALL';
export const SCOPES: readonly Scope[] = ['OWN', 'DEPARTMENT', 'UNIT', 'ALL'];

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
  id: string;
  code: string;
  name: string;
  label?: string;
  level: number;
  description?: string | null;
  isSystem?: boolean;
  allUnits?: boolean;
  status?: UserStatus;
  userCount: number;
  canManage: boolean;
  version?: number;
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
  roleId?: string;
  role?: string;
  code?: string;
  name?: string;
  level?: number;
  isSystem?: boolean;
  allUnits?: boolean;
  status?: UserStatus;
  editable: boolean;
  version?: number;
  rows: PermissionRow[];
}

export interface EffectiveAccessPage {
  pageId: string;
  title: string;
  family: string;
  actions: ActionSet;
  scope: Scope;
  reasons: string[];
}

export interface EffectiveAccessResult {
  user: User;
  pages: EffectiveAccessPage[];
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
  version?: number;
  logoFileId?: string | null;
  headerHeightMm?: number;
  footerHeightMm?: number;
  primaryColor?: string;
  showGstin?: boolean;
  showPan?: boolean;
  showCin?: boolean;
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

// ---- Phase 3 (docs/phase3-4/CONTRACT.md Stage A) ---------------------------

export interface UnitRef {
  id: string;
  code: string;
  name: string;
}

export type FyStatus = 'OPEN' | 'CLOSED';

export interface FyRef {
  id: string;
  code: string;
  label: string;
  status: FyStatus;
  isCurrent: boolean;
}

/** The working context: `unitId: null` means "All Units" (ADMIN+ only). */
export interface CurrentContext {
  unitId: string | null;
  fyId: string;
}

/** GET /me/context. */
export interface MeContext {
  company: { id: string; code: string; tradeName: string };
  units: UnitRef[];
  allUnitsAllowed: boolean;
  fys: FyRef[];
  current: CurrentContext;
}

export interface Company {
  id: string;
  code: string;
  legalName: string;
  tradeName: string;
  pan: string | null;
  cin: string | null;
  gstin: string | null;
  address: string | null;
  currency: string;
  timezone: string;
  version: number;
  stateCode?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  city?: string | null;
  pincode?: string | null;
}

export interface Unit {
  id: string;
  code: string;
  name: string;
  address: string | null;
  gstin: string | null;
  status: UserStatus;
  version: number;
  /** Optional: shown when the API reports how many users work in the unit. */
  userCount?: number;
  stateCode?: string | null;
  city?: string | null;
  pincode?: string | null;
}

export interface FinancialYear {
  id: string;
  code: string;
  label: string;
  /** ISO date (YYYY-MM-DD, or a full ISO timestamp). */
  startDate: string;
  endDate: string;
  status: FyStatus;
  isCurrent: boolean;
  version: number;
}

export interface Designation {
  id: string;
  code: string;
  name: string;
  departmentId: string | null;
  department?: { id: string; code: string; name: string } | null;
  level: number;
  status: 'ACTIVE' | 'INACTIVE';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Currency {
  id: string;
  code: string;
  name: string;
  symbol: string;
  decimalPlaces: number;
  isBase: boolean;
  exchangeRate: number;
  status: 'ACTIVE' | 'INACTIVE';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Uom {
  id: string;
  code: string;
  name: string;
  uomClass: string;
  decimals: number;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
