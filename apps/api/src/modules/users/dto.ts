// The public User DTO (Phase 02 §5, §6).
// Includes roleId, roleCode, roleName, roleLevel, extraDepartments, approvalLimit, and units.
import type { Prisma, Role, User, UserDepartment } from '@prisma/client';
import { REVERSE_ROLE_MAP } from '../../core/rbac/role-rules';

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
  roleId: string;
  roleCode: string;
  roleName: string;
  roleLevel: number;
  /** Legacy aliases for backwards compatibility */
  role: string;
  roleLabel: string;
  department: string | null;
  extraDepartments: string[];
  approvalLimit: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  previousLoginAt?: string | null;
  previousLoginIp?: string | null;
  mfaEnabled?: boolean;
  mfaSetupRequired?: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
  units: UserUnitRef[];
  defaultUnitId: string | null;
}

export const USER_INCLUDE = {
  role: true,
  extraDepartments: { select: { departmentName: true } },
  units: { include: { unit: { select: { id: true, code: true, name: true, createdAt: true } } } },
} satisfies Prisma.UserInclude;

export const USER_UNITS_INCLUDE = USER_INCLUDE;

export type UserWithRelations = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE }>;
export type UserWithUnits = UserWithRelations;

export function toUserDto(user: UserWithRelations, extra?: { mfaSetupRequired?: boolean }): UserDto {
  const units = (user.units ?? [])
    .map((u) => u.unit)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.code.localeCompare(b.code))
    .map((u) => ({ id: u.id, code: u.code, name: u.name }));

  const extraDepartments = (user.extraDepartments ?? []).map((d) => d.departmentName);
  const approvalLimit =
    user.approvalLimit !== null && user.approvalLimit !== undefined
      ? user.approvalLimit.toString()
      : null;

  return {
    id: user.id,
    loginId: user.loginId,
    email: user.email,
    name: user.name,
    roleId: user.roleId,
    roleCode: user.role?.code ?? '',
    roleName: user.role?.name ?? '',
    roleLevel: user.role?.level ?? 10,
    role: REVERSE_ROLE_MAP[user.role?.code ?? ''] ?? user.role?.code ?? '',
    roleLabel: user.role?.name ?? '',
    department: user.department,
    extraDepartments,
    approvalLimit,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    previousLoginAt: user.previousLoginAt ? user.previousLoginAt.toISOString() : null,
    previousLoginIp: user.previousLoginIp ?? null,
    mfaEnabled: user.mfaEnabled ?? false,
    mfaSetupRequired: extra?.mfaSetupRequired ?? false,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    version: user.version,
    units,
    defaultUnitId: user.defaultUnitId,
  };
}
