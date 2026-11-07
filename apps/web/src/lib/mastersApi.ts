// Client for the Phase 6 endpoints (docs/phases/PHASE-06.md §6): offline GSTIN / PAN decode, duplicate
// check, tax-rate and price lookups, customers, suppliers, supplier bank accounts and credit requests.
// Nothing here talks to a government portal; the chip text says so ("not checked on portal").
import { api, request } from './api';
import type { PageMeta } from '../types';

const newKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export type RegType = 'REGULAR' | 'COMPOSITION' | 'UNREGISTERED' | 'SEZ' | 'OVERSEAS';

export type GstinDecode =
  | {
      ok: true;
      gstin: string;
      stateCode: string;
      state: string | null;
      pan: string;
      registrationType: RegType;
      note: string;
    }
  | { ok: false; gstin: string; code: string; message: string };

export const decodeGstin = (gstin: string): Promise<GstinDecode> =>
  api<GstinDecode>(`/statutory/gstin/${encodeURIComponent(gstin.replace(/\s+/g, ''))}`);

export type PanDecode =
  | { ok: true; pan: string; holder: string }
  | { ok: false; code: string; message: string };

export const decodePan = (pan: string): Promise<PanDecode> =>
  api<PanDecode>(`/statutory/pan/${encodeURIComponent(pan.replace(/\s+/g, ''))}`);

export interface DupHit {
  level: 'BLOCK' | 'WARN' | 'INFO';
  field: string;
  message: string;
  matchId: string;
  matchKind: 'CUSTOMER' | 'SUPPLIER';
  matchCode: string;
}

export interface DupQuery {
  kind: 'CUSTOMER' | 'SUPPLIER';
  gstin?: string | null;
  pan?: string | null;
  name?: string | null;
  city?: string | null;
  mobile?: string | null;
  email?: string | null;
  accountNo?: string | null;
  excludeId?: string | null;
}

export const checkDuplicates = (q: DupQuery): Promise<DupHit[]> =>
  api<DupHit[]>('/parties/check-duplicates', { method: 'POST', body: q });

export interface PartyBase {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  gstRegistrationType: RegType;
  gstin: string | null;
  pan: string | null;
  stateCode: string;
  currencyCode: string;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  status: 'ACTIVE' | 'INACTIVE';
  version: number;
}

export interface Customer extends PartyBase {
  creditLimit: string | null;
  creditDays: number | null;
  tier: 'A' | 'B' | 'C' | 'D';
}

export interface Supplier extends PartyBase {
  supplierType: 'MATERIAL' | 'CONTRACTOR';
  msmeUdyamNo: string | null;
  msmeCategory: 'MICRO' | 'SMALL' | 'MEDIUM' | null;
  msmeActivity: 'MANUFACTURING' | 'SERVICES' | 'TRADING' | null;
  msmeAgreedDays: number | null;
  msme45dayApplies: boolean | null;
  purchaseHold: boolean;
}

export interface PartyInput {
  name: string;
  legalName?: string | null;
  gstRegistrationType: RegType;
  gstin?: string | null;
  pan?: string | null;
  stateCode?: string | null;
  groupId?: string | null;
  paymentTermId?: string | null;
  city?: string | null;
  mobile?: string | null;
  email?: string | null;
  /** "This is a different party": acknowledges WARN duplicates. */
  differentParty?: boolean;
}

export interface Paged<T> {
  rows: T[];
  meta: PageMeta;
}

async function paged<T>(path: string): Promise<Paged<T>> {
  const res = await request<T[]>(path);
  return {
    rows: res.data,
    meta: res.meta ?? { page: 1, size: res.data.length, total: res.data.length },
  };
}

const qs = (o: Record<string, string | number | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const listCustomers = (
  q: { q?: string; status?: string; page?: number; size?: number } = {},
) =>
  paged<Customer>(
    `/customers${qs({ q: q.q, status: q.status, page: q.page ?? 1, size: q.size ?? 20 })}`,
  );

export const createCustomer = (
  input: PartyInput & { creditLimit?: number | null; creditDays?: number | null },
) =>
  api<Customer>('/customers', {
    method: 'POST',
    body: input,
    headers: { 'Idempotency-Key': newKey() },
  });

export const requestCreditChange = (
  customerId: string,
  input: { newLimit?: number | null; newDays?: number | null; reason: string },
) =>
  api<{ applied: boolean; requestId: string | null }>(
    `/customers/${encodeURIComponent(customerId)}/credit-requests`,
    {
      method: 'POST',
      body: input,
    },
  );

export const listSuppliers = (
  q: { q?: string; status?: string; approval?: string; page?: number; size?: number } = {},
) =>
  paged<Supplier>(
    `/suppliers${qs({ q: q.q, status: q.status, approval: q.approval, page: q.page ?? 1, size: q.size ?? 20 })}`,
  );

export const createSupplier = (
  input: PartyInput & {
    supplierType?: 'MATERIAL' | 'CONTRACTOR';
    msmeUdyamNo?: string | null;
    msmeCategory?: 'MICRO' | 'SMALL' | 'MEDIUM' | null;
    msmeActivity?: 'MANUFACTURING' | 'SERVICES' | 'TRADING' | null;
    msmeAgreedDays?: number | null;
  },
) =>
  api<Supplier>('/suppliers', {
    method: 'POST',
    body: input,
    headers: { 'Idempotency-Key': newKey() },
  });

export const submitSupplier = (id: string) =>
  api<{ id: string }>(`/suppliers/${encodeURIComponent(id)}/submit`, { method: 'POST' });

export interface BankAccountView {
  id: string;
  ifsc: string;
  holder: string;
  accountNo: string;
  verified: boolean;
}

export const addBankAccount = (
  supplierId: string,
  input: { ifsc: string; holderName: string; accountNo: string; accountNoConfirm: string },
) =>
  api<BankAccountView>(`/suppliers/${encodeURIComponent(supplierId)}/bank-accounts`, {
    method: 'POST',
    body: input,
  });

export const verifyBankAccount = (supplierId: string, bankAccountId: string) =>
  api<BankAccountView>(
    `/suppliers/${encodeURIComponent(supplierId)}/bank-accounts/${encodeURIComponent(bankAccountId)}/verify`,
    { method: 'POST' },
  );

export interface RateChoice {
  source: 'ITEM_OVERRIDE' | 'HSN';
  gstRateId: string;
  code: string;
  igstPct: string;
  cgstPct: string;
  sgstPct: string;
  cessPct: string;
  conditionNote: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  needsReview: boolean;
}

export const getTaxRate = (itemId: string, date: string) =>
  api<RateChoice[]>(`/tax/rate${qs({ itemId, date })}`);

export interface PriceResult {
  rate: string;
  discountPct: string;
  net: string;
  source: string;
  priceListId: string | null;
  rowId: string | null;
}

export const lookupPrice = (q: {
  customerId?: string;
  supplierId?: string;
  itemId: string;
  qty: number;
  uom?: string;
  date: string;
  kind?: 'SELLING' | 'BUYING';
}) => api<PriceResult>(`/pricing/lookup${qs(q)}`);
