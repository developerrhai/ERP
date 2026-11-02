// Company Master (Phase 3 §A1, page admin-company): read, and PATCH with If-Match. Unchanged values
// are a no-op (no version bump, no audit row); every real change is audited with before/after.
import type { Company, Prisma } from '@prisma/client';
import type { AuthContext, RequestMeta } from '../../core/auth/auth-context';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { companyRepository } from './repository';
import type { UpdateCompanyInput } from './schemas';

export interface CompanyDto {
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
  updatedAt: string;
}

export function toCompanyDto(c: Company): CompanyDto {
  return {
    id: c.id,
    code: c.code,
    legalName: c.legalName,
    tradeName: c.tradeName,
    pan: c.pan,
    cin: c.cin,
    gstin: c.gstin,
    address: c.address,
    currency: c.currency,
    timezone: c.timezone,
    version: c.version,
    updatedAt: c.updatedAt.toISOString(),
  };
}

async function load(): Promise<Company> {
  const company = await companyRepository.get();
  if (!company) throw Errors.notFound('Company not configured.');
  return company;
}

type Tracked = keyof UpdateCompanyInput;
const TRACKED: readonly Tracked[] = ['legalName', 'tradeName', 'pan', 'cin', 'gstin', 'address'];

export const companyService = {
  async get(): Promise<CompanyDto> {
    return toCompanyDto(await load());
  },

  async update(
    actor: AuthContext,
    expectedVersion: number,
    input: UpdateCompanyInput,
    meta: RequestMeta,
  ): Promise<CompanyDto> {
    const current = await load();
    if (expectedVersion !== current.version) throw Errors.versionConflict();
    const before: Prisma.InputJsonObject = {};
    const after: Prisma.InputJsonObject = {};
    const data: Prisma.CompanyUncheckedUpdateManyInput = {};
    for (const field of TRACKED) {
      const next = input[field];
      if (next === undefined || next === current[field]) continue;
      Object.assign(before, { [field]: current[field] });
      Object.assign(after, { [field]: next });
      Object.assign(data, { [field]: next });
    }
    // Nothing changes: return the current row without a version bump or an audit row.
    if (Object.keys(data).length === 0) return toCompanyDto(current);
    const updated = await prisma.$transaction(async (tx) => {
      if (!(await companyRepository.updateIfVersion(current.id, expectedVersion, data, tx))) {
        throw Errors.versionConflict();
      }
      await recordAudit(
        {
          action: 'COMPANY_UPDATED',
          actorId: actor.userId,
          targetType: 'Company',
          targetId: current.id,
          meta,
          detail: { before, after },
        },
        tx,
      );
      const fresh = await companyRepository.get(tx);
      if (!fresh) throw Errors.notFound('Company not configured.');
      return fresh;
    });
    return toCompanyDto(updated);
  },
};
