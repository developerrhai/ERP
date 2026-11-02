// Department -> menu family access (Phase 2 §2.3 department_families, §2.6). Read the matrix;
// replace one department's families. Families must be real registry families, and the
// Administration department must keep all of them (409 PROTECTED). Audited; clears the access cache.
import type { AuthContext, RequestMeta } from '../../core/auth/auth-context';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { invalidateAccessCache } from '../../core/rbac/access';
import { ADMIN_DEPARTMENT, isFamily, registry } from '../../core/registry';
import { departmentAccessRepository } from './repository';

export interface DepartmentAccessDto {
  name: string;
  families: string[];
}

const inRegistryOrder = (families: Iterable<string>): string[] => {
  const set = new Set(families);
  return registry.familyNames.filter((f) => set.has(f));
};

export const departmentAccessService = {
  async matrix(): Promise<{ departments: DepartmentAccessDto[]; families: string[] }> {
    const rows = await departmentAccessRepository.departments();
    return {
      departments: rows.map((d) => ({
        name: d.name,
        families: inRegistryOrder(d.families.map((f) => f.family)),
      })),
      families: [...registry.familyNames],
    };
  },

  async replace(
    actor: AuthContext,
    departmentName: string,
    families: string[],
    meta: RequestMeta,
  ): Promise<DepartmentAccessDto> {
    const department = await departmentAccessRepository.findDepartment(departmentName);
    if (!department) throw Errors.notFound('Department not found.');
    const fields: Record<string, string> = {};
    const seen = new Set<string>();
    families.forEach((f, i) => {
      if (!isFamily(f)) fields[`families.${i}`] = 'Unknown family.';
      else if (seen.has(f)) fields[`families.${i}`] = 'Duplicate family.';
      seen.add(f);
    });
    if (Object.keys(fields).length > 0) throw Errors.validation(fields);
    if (department.name === ADMIN_DEPARTMENT && seen.size !== registry.familyNames.length) {
      throw Errors.protectedResource('The Administration department must keep all families.');
    }
    const ordered = inRegistryOrder(seen);
    const changed = await prisma.$transaction(async (tx) => {
      await departmentAccessRepository.lock(department.name, tx);
      const before = inRegistryOrder(
        await departmentAccessRepository.familiesOf(department.name, tx),
      );
      // Same families as stored: nothing to write or audit.
      if (before.length === ordered.length && before.every((f, i) => f === ordered[i])) {
        return false;
      }
      await departmentAccessRepository.replace(department.name, ordered, tx);
      await recordAudit(
        {
          action: 'DEPARTMENT_ACCESS_UPDATED',
          actorId: actor.userId,
          targetType: 'DepartmentAccess',
          targetId: department.id,
          meta,
          detail: { department: department.name, before, after: ordered },
        },
        tx,
      );
      return true;
    });
    if (changed) invalidateAccessCache();
    return { name: department.name, families: ordered };
  },
};
