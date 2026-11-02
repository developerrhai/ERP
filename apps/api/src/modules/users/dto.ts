// The public User DTO (CONTRACT §7, Phase 3 adds units / defaultUnitId). The only way a user leaves
// the API, so the hash, lockout counters and session data can never be serialised by accident.
import type { Prisma, User } from '@prisma/client';
import { ROLE_LABELS, ROLE_LEVELS } from '../../core/rbac/role-rules';
import type { RoleCode } from '../../core/rbac/role-rules';

export interface UserUnitRef {
  id: string;
  code: string;
  name: string;
}

export interface UserDto {
  id: string;
  loginId: string;
  email: string | null;
  name: string;
  role: RoleCode;
  roleLabel: string;
  roleLevel: number;
  department: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  /** Explicitly assigned units (ADMIN+ also have every unit implicitly), in Unit Master order. */
  units: UserUnitRef[];
  defaultUnitId: string | null;
}

/** Prisma include that loads what toUserDto needs. */
export const USER_UNITS_INCLUDE = {
  units: { include: { unit: { select: { id: true, code: true, name: true, createdAt: true } } } },
} satisfies Prisma.UserInclude;

export type UserWithUnits = Prisma.UserGetPayload<{ include: typeof USER_UNITS_INCLUDE }>;

export function toUserDto(user: UserWithUnits): UserDto {
  const units = user.units
    .map((u) => u.unit)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.code.localeCompare(b.code))
    .map((u) => ({ id: u.id, code: u.code, name: u.name }));
  return {
    ...baseDto(user),
    units,
    defaultUnitId: user.defaultUnitId,
  };
}

function baseDto(user: User): Omit<UserDto, 'units' | 'defaultUnitId'> {
  return {
    id: user.id,
    loginId: user.loginId,
    email: user.email,
    name: user.name,
    role: user.role,
    roleLabel: ROLE_LABELS[user.role],
    roleLevel: ROLE_LEVELS[user.role],
    department: user.department,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    version: user.version,
  };
}
