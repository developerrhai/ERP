// Typed wrappers for the Phase 3 organisation endpoints (company, units, financial years —
// docs/phase3-4/CONTRACT.md A2). Every PATCH and state change of a versioned row sends If-Match.
import { api } from '../../lib/api';
import type { Company, FinancialYear, Unit, UserStatus } from '../../types';

const ifMatch = (version: number): Record<string, string> => ({ 'If-Match': String(version) });

// ---- company ---------------------------------------------------------------------

export function getCompany(): Promise<Company> {
  return api<Company>('/company');
}

export type CompanyPatch = Partial<
  Pick<Company, 'legalName' | 'tradeName' | 'pan' | 'cin' | 'gstin' | 'address'>
>;

export function updateCompany(version: number, patch: CompanyPatch): Promise<Company> {
  return api<Company>('/company', { method: 'PATCH', body: patch, headers: ifMatch(version) });
}

// ---- units -----------------------------------------------------------------------

export function listUnits(): Promise<Unit[]> {
  return api<Unit[]>('/units');
}

export interface UnitInput {
  code: string;
  name: string;
  address?: string | null;
  gstin?: string | null;
  status?: UserStatus;
}

export function createUnit(input: UnitInput): Promise<Unit> {
  return api<Unit>('/units', { method: 'POST', body: input });
}

export function updateUnit(id: string, version: number, patch: Partial<UnitInput>): Promise<Unit> {
  return api<Unit>(`/units/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
    headers: ifMatch(version),
  });
}

export function deleteUnit(id: string, version: number): Promise<void> {
  return api<undefined>(`/units/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: ifMatch(version),
  });
}

// ---- financial years ---------------------------------------------------------------

export function listFinancialYears(): Promise<FinancialYear[]> {
  return api<FinancialYear[]>('/financial-years');
}

export interface FinancialYearInput {
  code: string;
  label: string;
  startDate: string;
  endDate: string;
}

export function createFinancialYear(input: FinancialYearInput): Promise<FinancialYear> {
  return api<FinancialYear>('/financial-years', { method: 'POST', body: input });
}

export type FyCommand = 'set-current' | 'close' | 'reopen';

export function runFyCommand(fy: FinancialYear, command: FyCommand): Promise<FinancialYear> {
  return api<FinancialYear>(`/financial-years/${encodeURIComponent(fy.id)}/${command}`, {
    method: 'POST',
    headers: ifMatch(fy.version),
  });
}

/**
 * The Indian FY after the latest one (1 Apr – 31 Mar). With no years yet, the FY containing
 * `today` is proposed.
 */
export function nextFinancialYear(
  years: Pick<FinancialYear, 'endDate'>[],
  today: Date = new Date(),
): FinancialYearInput {
  let startYear: number;
  const ends = years
    .map((y) => /^(\d{4})-(\d{2})-(\d{2})/.exec(y.endDate))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
  if (ends.length) {
    startYear = Math.max(...ends);
  } else {
    startYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  }
  const code = `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
  return {
    code,
    label: `FY ${code}`,
    startDate: `${startYear}-04-01`,
    endDate: `${startYear + 1}-03-31`,
  };
}
