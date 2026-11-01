// Role Master (Phase 2 §1): the 5 fixed roles from role-rules.ts with user counts, whether the
// caller can manage each, and who may create it. Read-only by design (roles are fixed in code).
import {
  MANAGEABLE_ROLES,
  ROLES,
  ROLE_LABELS,
  ROLE_LEVELS,
  canManage,
} from '../../core/rbac/role-rules';
import type { RoleCode } from '../../core/rbac/role-rules';
import { roleRepository } from './repository';

export interface RoleDto {
  code: RoleCode;
  label: string;
  level: number;
  userCount: number;
  canManage: boolean;
  /** Roles allowed to create users with this role (§1.2). Empty for SUPER_ADMIN. */
  creatableBy: RoleCode[];
}

export const roleService = {
  async list(actorRole: RoleCode): Promise<RoleDto[]> {
    const counts = await roleRepository.userCountsByRole();
    return ROLES.map((code) => ({
      code,
      label: ROLE_LABELS[code],
      level: ROLE_LEVELS[code],
      userCount: counts.get(code) ?? 0,
      canManage: canManage(actorRole, code),
      creatableBy: ROLES.filter((actor) => MANAGEABLE_ROLES[actor].includes(code)),
    }));
  },
};
