// Client for the Phase 9 procurement endpoints (/scm, /wms/putaway, /fin/debitnote, /fin/ap).
// Documents are plain JSON objects (money and quantities arrive as decimal strings).
import { request } from './api';
import type { PageMeta } from '../types';

export type Doc = Record<string, unknown> & { id: string; version: number; status: string };
export type Row = Record<string, unknown>;

const key = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const idem = () => ({ 'Idempotency-Key': key() });
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const qs = (o: Record<string, string | number | boolean | undefined | null>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export interface Paged<T> {
  rows: T[];
  meta: PageMeta;
}
export async function listDocs<T = Doc>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<Paged<T>> {
  const r = await request<T[]>(`${path}${qs({ page: 1, size: 20, ...params })}`);
  return {
    rows: r.data,
    meta: r.meta ?? { page: 1, size: r.data.length, total: r.data.length },
  };
}
export const getDoc = async <T = Doc>(path: string, id: string): Promise<T> =>
  (await request<T>(`${path}/${id}`)).data;
export const getJson = async <T = unknown>(path: string): Promise<T> =>
  (await request<T>(path)).data;
export const createDoc = async (path: string, body: unknown): Promise<Doc> =>
  (await request<Doc>(path, { method: 'POST', body, headers: idem() })).data;
export const updateDoc = async (
  path: string,
  id: string,
  version: number,
  body: unknown,
): Promise<Doc> =>
  (await request<Doc>(`${path}/${id}`, { method: 'PUT', body, headers: ifMatch(version) })).data;
export const deleteDoc = async (path: string, id: string, version: number): Promise<void> => {
  await request<unknown>(`${path}/${id}`, { method: 'DELETE', headers: ifMatch(version) });
};
/** submit / post / cancel / claim ... : POST path/id/verb with an Idempotency-Key and the version. */
export const verb = async <T = Doc>(
  path: string,
  id: string,
  name: string,
  body: unknown = {},
  version?: number,
): Promise<T> =>
  (
    await request<T>(`${path}/${id}/${name}`, {
      method: 'POST',
      body,
      headers: { ...idem(), ...(version !== undefined ? ifMatch(version) : {}) },
    })
  ).data;
export const post = async <T = unknown>(path: string, body: unknown = {}): Promise<T> =>
  (await request<T>(path, { method: 'POST', body, headers: idem() })).data;

export interface Option {
  id: string;
  label: string;
}
export const lookupSuppliers = async (q = ''): Promise<Option[]> => {
  const r = await request<{ id: string; code: string; name: string }[]>(
    `/suppliers${qs({ q, approval: 'APPROVED', size: 30 })}`,
  );
  return r.data.map((s) => ({ id: s.id, label: `${s.code} · ${s.name}` }));
};
export const lookupPos = async (): Promise<Option[]> => {
  const r = await request<Doc[]>(`/scm/po${qs({ status: 'Approved', size: 100 })}`);
  return r.data.map((p) => ({
    id: p.id,
    label: `${String(p.number)} · ${String(p.supplierName)}`,
  }));
};

export const lookupCustomers = async (q = ''): Promise<Option[]> => {
  const r = await request<{ id: string; code: string; name: string }[]>(
    `/customers${qs({ q, size: 30 })}`,
  );
  return r.data.map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` }));
};
