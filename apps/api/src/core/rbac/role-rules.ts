// THE single rule table for the role hierarchy (CONTRACT §1.2). The API, the tests and
// GET /meta/roles all read it from here; never duplicate these rules anywhere else.
export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'LEAD', 'MEMBER'] as const;

export type RoleCode = (typeof ROLES)[number];

export const ROLE_LEVELS: Readonly<Record<RoleCode, number>> = {
  SUPER_ADMIN: 100,
  ADMIN: 80,
  MANAGER: 60,
  LEAD: 40,
  MEMBER: 20,
};

export const ROLE_LABELS: Readonly<Record<RoleCode, string>> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  LEAD: 'Lead',
  MEMBER: 'Member',
};

/** Who may create / edit / deactivate / reset the password of whom. Nobody manages SUPER_ADMIN. */
export const MANAGEABLE_ROLES: Readonly<Record<RoleCode, readonly RoleCode[]>> = {
  SUPER_ADMIN: ['ADMIN', 'MANAGER', 'LEAD', 'MEMBER'],
  ADMIN: ['MANAGER', 'LEAD', 'MEMBER'],
  MANAGER: [],
  LEAD: [],
  MEMBER: [],
};

/** Minimum role that may view the user list and open user records. */
export const USER_ADMIN_MIN_ROLE: RoleCode = 'ADMIN';

export function canManage(actorRole: RoleCode, targetRole: RoleCode): boolean {
  return MANAGEABLE_ROLES[actorRole].includes(targetRole);
}

/** A role change needs the actor to manage both the old and the new role. */
export function canChangeRole(actorRole: RoleCode, fromRole: RoleCode, toRole: RoleCode): boolean {
  return canManage(actorRole, fromRole) && canManage(actorRole, toRole);
}

export function hasMinRole(role: RoleCode, minRole: RoleCode): boolean {
  return ROLE_LEVELS[role] >= ROLE_LEVELS[minRole];
}
