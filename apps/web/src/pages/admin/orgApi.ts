// Typed wrappers for the Phase 3 organisation endpoints (company, units, financial years,
// designations, currencies, uoms — docs/phase3-4/CONTRACT.md A2).
// Every PATCH and state change of a versioned row sends If-Match.
import { api } from '../../lib/api';
import type {
  Company,
  Currency,
  Designation,
  FinancialYear,
  Unit,
  Uom,
  UserStatus,
} from '../../types';

const ifMatch = (version: number): Record<string, string> => ({ 'If-Match': String(version) });

// ---- company ---------------------------------------------------------------------

export function getCompany(): Promise<Company> {
  return api<Company>('/company');
}

export type CompanyPatch = Partial<
  Pick<
    Company,
    | 'legalName'
    | 'tradeName'
    | 'pan'
    | 'cin'
    | 'gstin'
    | 'address'
    | 'stateCode'
    | 'email'
    | 'phone'
    | 'website'
    | 'city'
    | 'pincode'
  >
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
  stateCode?: string | null;
  city?: string | null;
  pincode?: string | null;
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

// ---- designations -----------------------------------------------------------------

export function listDesignations(query?: {
  q?: string;
  status?: string;
  departmentId?: string;
}): Promise<Designation[]> {
  const params = new URLSearchParams();
  if (query?.q) params.set('q', query.q);
  if (query?.status) params.set('status', query.status);
  if (query?.departmentId) params.set('departmentId', query.departmentId);
  const qStr = params.toString();
  return api<Designation[]>(`/designations${qStr ? `?${qStr}` : ''}`);
}

export interface DesignationInput {
  code: string;
  name: string;
  departmentId?: string | null;
  level?: number;
  status?: 'ACTIVE' | 'INACTIVE';
}

export function createDesignation(input: DesignationInput): Promise<Designation> {
  return api<Designation>('/designations', { method: 'POST', body: input });
}

export function updateDesignation(
  id: string,
  version: number,
  patch: Partial<DesignationInput>,
): Promise<Designation> {
  return api<Designation>(`/designations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
    headers: ifMatch(version),
  });
}

export function deleteDesignation(id: string, version: number): Promise<void> {
  return api<undefined>(`/designations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: ifMatch(version),
  });
}

// ---- currencies -------------------------------------------------------------------

export function listCurrencies(query?: { q?: string; status?: string }): Promise<Currency[]> {
  const params = new URLSearchParams();
  if (query?.q) params.set('q', query.q);
  if (query?.status) params.set('status', query.status);
  const qStr = params.toString();
  return api<Currency[]>(`/currencies${qStr ? `?${qStr}` : ''}`);
}

export interface CurrencyInput {
  code: string;
  name: string;
  symbol: string;
  decimalPlaces?: number;
  isBase?: boolean;
  exchangeRate?: number;
  status?: 'ACTIVE' | 'INACTIVE';
}

export function createCurrency(input: CurrencyInput): Promise<Currency> {
  return api<Currency>('/currencies', { method: 'POST', body: input });
}

export function updateCurrency(
  id: string,
  version: number,
  patch: Partial<CurrencyInput>,
): Promise<Currency> {
  return api<Currency>(`/currencies/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
    headers: ifMatch(version),
  });
}

export function deleteCurrency(id: string, version: number): Promise<void> {
  return api<undefined>(`/currencies/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: ifMatch(version),
  });
}

// ---- uoms -------------------------------------------------------------------------

export function listUoms(query?: {
  q?: string;
  status?: string;
  uomClass?: string;
}): Promise<Uom[]> {
  const params = new URLSearchParams();
  if (query?.q) params.set('q', query.q);
  if (query?.status) params.set('status', query.status);
  if (query?.uomClass) params.set('uomClass', query.uomClass);
  const qStr = params.toString();
  return api<Uom[]>(`/uoms${qStr ? `?${qStr}` : ''}`);
}

export interface UomInput {
  code: string;
  name: string;
  uomClass?: string;
  decimals?: number;
  status?: string;
}

export function createUom(input: UomInput): Promise<Uom> {
  return api<Uom>('/uoms', { method: 'POST', body: input });
}

export function updateUom(id: string, version: number, patch: Partial<UomInput>): Promise<Uom> {
  return api<Uom>(`/uoms/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
    headers: ifMatch(version),
  });
}

export function deleteUom(id: string, version: number): Promise<void> {
  return api<undefined>(`/uoms/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: ifMatch(version),
  });
}
