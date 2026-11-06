// DB-driven role hierarchy rules (Phase 02 §5.5).
// The role level is used ONLY for administration (who manages whom).
// Roles do not inherit permissions from each other; each role's matrix is explicit.

export const SYSTEM_ROLES = [
  'SUPER_USER',
  'ADMINISTRATOR',
  'DIRECTOR',
  'CFO',
  'GENERAL_MANAGER',
  'DEPT_HEAD',
  'DEPT_MANAGER',
  'SUPERVISOR',
  'EMPLOYEE',
] as const;

export type SystemRoleCode = (typeof SYSTEM_ROLES)[number];
export type RoleCode = string;

export const SUPER_USER_LEVEL = 99;
export const ADMIN_LEVEL = 95;

export const RESERVED_LEVELS: readonly number[] = [ADMIN_LEVEL, SUPER_USER_LEVEL];

export function isReservedLevel(level: number): boolean {
  return RESERVED_LEVELS.includes(level);
}

export function isSystemRole(code: string): boolean {
  return (SYSTEM_ROLES as readonly string[]).includes(code);
}

/**
 * An actor manages a target only if actor.level > target.level.
 * Exception: A Super User (level 99) may create, deactivate or reset other Super Users.
 */
export function canManageLevel(actorLevel: number, targetLevel: number): boolean {
  if (actorLevel >= SUPER_USER_LEVEL && targetLevel >= SUPER_USER_LEVEL) {
    return true;
  }
  return actorLevel > targetLevel;
}

/** Check if role meets minimum level (e.g. requireMinLevel(95)). */
export function hasMinLevel(level: number, minLevel: number): boolean {
  return level >= minLevel;
}

// ------------------------------------------------------------------------------------------------
// Legacy compatibility helpers (for tests and migration bridges)
// ------------------------------------------------------------------------------------------------
export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'LEAD', 'MEMBER'] as const;
export const USER_ADMIN_MIN_ROLE = 'ADMIN';

export const LEGACY_LEVELS: Record<string, number> = {
  SUPER_ADMIN: 99,
  SUPER_USER: 99,
  ADMIN: 95,
  ADMINISTRATOR: 95,
  DIRECTOR: 90,
  CFO: 80,
  GENERAL_MANAGER: 70,
  DEPT_HEAD: 60,
  DEPT_MANAGER: 50,
  MANAGER: 50,
  SUPERVISOR: 30,
  LEAD: 30,
  EMPLOYEE: 10,
  MEMBER: 10,
};

/** Maps DB role codes back to legacy role codes for API backwards-compatibility. */
export const REVERSE_ROLE_MAP: Record<string, string> = {
  SUPER_USER: 'SUPER_ADMIN',
  ADMINISTRATOR: 'ADMIN',
  DEPT_MANAGER: 'MANAGER',
  SUPERVISOR: 'LEAD',
  EMPLOYEE: 'MEMBER',
};

/**
 * Display levels for the 5 legacy roles exposed via the meta/roles and GET /roles endpoints.
 * SUPER_ADMIN is displayed at level 100 to signal it sits above ADMIN (95).
 */
export const LEGACY_DISPLAY_LEVELS: Record<string, number> = {
  SUPER_ADMIN: 100,
  ADMIN: 95,
  MANAGER: 50,
  LEAD: 30,
  MEMBER: 10,
};

export const MANAGEABLE_ROLES: Record<string, readonly string[]> = {
  SUPER_ADMIN: ['ADMIN', 'MANAGER', 'LEAD', 'MEMBER'],
  SUPER_USER: [
    'ADMINISTRATOR',
    'DIRECTOR',
    'CFO',
    'GENERAL_MANAGER',
    'DEPT_HEAD',
    'DEPT_MANAGER',
    'SUPERVISOR',
    'EMPLOYEE',
  ],
  ADMIN: ['MANAGER', 'LEAD', 'MEMBER'],
  ADMINISTRATOR: [
    'DIRECTOR',
    'CFO',
    'GENERAL_MANAGER',
    'DEPT_HEAD',
    'DEPT_MANAGER',
    'SUPERVISOR',
    'EMPLOYEE',
  ],
  MANAGER: [],
  DEPT_MANAGER: [],
  LEAD: [],
  SUPERVISOR: [],
  MEMBER: [],
  EMPLOYEE: [],
};

export function canManage(
  actorRoleOrLevel: string | number,
  targetRoleOrLevel: string | number,
): boolean {
  if (typeof actorRoleOrLevel === 'string' && typeof targetRoleOrLevel === 'string') {
    const list = MANAGEABLE_ROLES[actorRoleOrLevel];
    if (list) {
      return list.includes(targetRoleOrLevel);
    }
  }
  const actorLevel =
    typeof actorRoleOrLevel === 'number'
      ? actorRoleOrLevel
      : (LEGACY_LEVELS[actorRoleOrLevel] ?? 10);
  const targetLevel =
    typeof targetRoleOrLevel === 'number'
      ? targetRoleOrLevel
      : (LEGACY_LEVELS[targetRoleOrLevel] ?? 10);
  if (targetLevel >= SUPER_USER_LEVEL) return false;
  return canManageLevel(actorLevel, targetLevel);
}

export function canChangeRole(
  actor: string | number,
  fromRole: string | number,
  toRole: string | number,
): boolean {
  return canManage(actor, fromRole) && canManage(actor, toRole);
}

export function hasMinRole(
  roleOrLevel: string | number,
  minRoleOrLevel: string | number,
): boolean {
  const level =
    typeof roleOrLevel === 'number' ? roleOrLevel : (LEGACY_LEVELS[roleOrLevel] ?? 10);
  const minLevel =
    typeof minRoleOrLevel === 'number'
      ? minRoleOrLevel
      : (LEGACY_LEVELS[minRoleOrLevel] ?? 10);
  return level >= minLevel;
}
