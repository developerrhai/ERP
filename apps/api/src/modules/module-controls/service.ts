// System Control Center (Phase 2 §2.3 module_controls, §2.6): list the 248 page controls in
// registry order (filter by family / text), and PATCH one with If-Match. Administration-family pages
// can never be disabled, nor have allow_add/edit/delete/export switched off (409 PROTECTED). The
// owner must be an active department. Audited; clears the access cache so the menu changes at once.
import { Prisma } from '@prisma/client';
import type { ModuleControl } from '@prisma/client';
import type { AuthContext, RequestMeta } from '../../core/auth/auth-context';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { invalidateAccessCache } from '../../core/rbac/access';
import { ADMIN_FAMILY, pageInfo, registry } from '../../core/registry';
import { moduleControlRepository } from './repository';
import type { ListModuleControlsQuery, UpdateModuleControlInput } from './schemas';

export interface ModuleControlDto {
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
  updatedAt: string;
}

function toDto(c: ModuleControl): ModuleControlDto {
  const page = pageInfo(c.pageId);
  return {
    pageId: c.pageId,
    title: page?.title ?? c.pageId,
    family: page?.family ?? '',
    enabled: c.enabled,
    ownerDepartment: c.ownerDepartment,
    approvalRequired: c.approvalRequired,
    allowAdd: c.allowAdd,
    allowEdit: c.allowEdit,
    allowDelete: c.allowDelete,
    allowExport: c.allowExport,
    version: c.version,
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** The owner department vanished between the check and the write (FK violation) -> 422. */
export function mapOwnerFkError(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
    return Errors.validation({ ownerDepartment: 'Choose an active department.' });
  }
  return err;
}

/** allow_* switches that can never be turned off on an Administration-family page. */
export const ADMIN_LOCKED_FLAGS = ['allowAdd', 'allowEdit', 'allowDelete', 'allowExport'] as const;

type Tracked = keyof UpdateModuleControlInput;
const TRACKED: readonly Tracked[] = [
  'enabled',
  'ownerDepartment',
  'approvalRequired',
  'allowAdd',
  'allowEdit',
  'allowDelete',
  'allowExport',
];

export const moduleControlService = {
  async list(query: ListModuleControlsQuery): Promise<ModuleControlDto[]> {
    const rows = await moduleControlRepository.all();
    const q = query.q?.toLowerCase();
    return rows
      .filter((c) => registry.pages.has(c.pageId))
      .map(toDto)
      .filter((c) => !query.family || c.family === query.family)
      .filter((c) => !q || c.title.toLowerCase().includes(q) || c.pageId.toLowerCase().includes(q))
      .sort((a, b) => (pageInfo(a.pageId)?.order ?? 0) - (pageInfo(b.pageId)?.order ?? 0));
  },

  async update(
    actor: AuthContext,
    pageId: string,
    expectedVersion: number,
    input: UpdateModuleControlInput,
    meta: RequestMeta,
  ): Promise<ModuleControlDto> {
    const page = pageInfo(pageId);
    const current = page ? await moduleControlRepository.find(pageId) : null;
    if (!page || !current) throw Errors.notFound('Unknown module.');
    if (page.family === ADMIN_FAMILY && input.enabled === false) {
      throw Errors.protectedResource('Administration pages cannot be disabled.');
    }
    // Phase 3 (orchestrator decision): switching add/edit/delete/export off on an Administration page
    // could lock everyone, the owner included, out of user management, so those stay on too.
    if (page.family === ADMIN_FAMILY && ADMIN_LOCKED_FLAGS.some((flag) => input[flag] === false)) {
      throw Errors.protectedResource(
        'Administration pages must keep add, edit, delete and export allowed.',
      );
    }
    if (expectedVersion !== current.version) throw Errors.versionConflict();
    if (input.ownerDepartment !== undefined && input.ownerDepartment !== current.ownerDepartment) {
      const owner = await moduleControlRepository.findDepartment(input.ownerDepartment);
      if (!owner || owner.status !== 'ACTIVE') {
        throw Errors.validation({ ownerDepartment: 'Choose an active department.' });
      }
    }

    const before: Prisma.InputJsonObject = {};
    const after: Prisma.InputJsonObject = {};
    const data: Prisma.ModuleControlUncheckedUpdateManyInput = {};
    for (const field of TRACKED) {
      const next = input[field];
      if (next === undefined || next === current[field]) continue;
      Object.assign(before, { [field]: current[field] });
      Object.assign(after, { [field]: next });
      Object.assign(data, { [field]: next });
    }
    // Nothing changes: return the current row without a version bump or an audit row.
    if (Object.keys(data).length === 0) return toDto(current);
    const updated = await prisma
      .$transaction(async (tx) => {
        const applied = await moduleControlRepository.updateIfVersion(
          pageId,
          expectedVersion,
          { ...data, updatedById: actor.userId },
          tx,
        );
        if (!applied) throw Errors.versionConflict();
        await recordAudit(
          {
            action: 'MODULE_CONTROL_UPDATED',
            actorId: actor.userId,
            targetType: 'ModuleControl',
            targetId: pageId,
            meta,
            detail: { pageId, before, after },
          },
          tx,
        );
        const fresh = await moduleControlRepository.find(pageId, tx);
        if (!fresh) throw Errors.notFound('Unknown module.');
        return fresh;
      })
      .catch((err: unknown) => {
        throw mapOwnerFkError(err);
      });
    invalidateAccessCache();
    return toDto(updated);
  },
};
