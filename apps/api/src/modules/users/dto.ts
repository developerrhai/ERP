// The public User DTO (CONTRACT §7). The only way a user leaves the API, so the hash, lockout
// counters and session data can never be serialised by accident.
import type { User } from '@prisma/client';
import { ROLE_LABELS, ROLE_LEVELS } from '../../core/rbac/role-rules';
import type { RoleCode } from '../../core/rbac/role-rules';

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
}

export function toUserDto(user: User): UserDto {
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
