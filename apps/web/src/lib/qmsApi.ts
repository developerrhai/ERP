// Client for the Phase 12 quality endpoints (/api/v1/qms). Documents are plain JSON; quantities arrive as decimal strings.
import { request } from './api';
import type { PageMeta } from '../types';

export type Row = Record<string, unknown>;
export interface Template {
  id: string;
  kind: string;
  name: string;
  version: number;
  customerId: string | null;
  headerFields: FieldDef[];
  rowConfig: {
    readings?: number;
    readingLabel?: string;
    labelHeader?: string;
    attribute?: boolean;
    extra?: { key: string; label: string }[];
  };
  closeRequires: string[];
  status: string;
}
export interface FieldDef {
  key: string;
  label: string;
  type?:
    | 'text'
    | 'textarea'
    | 'date'
    | 'number'
    | 'select'
    | 'item'
    | 'customer'
    | 'supplier'
    | 'instrument';
  required?: boolean;
  options?: string[];
}

const key = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const qs = (o: Record<string, string | number | boolean | undefined | null>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
const ifm = (version: number) => ({ 'If-Match': `"${version}"` });

export async function qget<T = Row>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<T> {
  return (await request<T>(`/qms${path}${qs(params)}`)).data;
}
export async function qlist<T = Row>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<{ rows: T[]; meta: PageMeta }> {
  const r = await request<T[]>(`/qms${path}${qs({ page: 1, size: 50, ...params })}`);
  return { rows: r.data, meta: r.meta ?? { page: 1, size: r.data.length, total: r.data.length } };
}
export async function qpost<T = Row>(
  path: string,
  body: unknown = {},
  version?: number,
): Promise<T> {
  return (
    await request<T>(`/qms${path}`, {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': key(), ...(version !== undefined ? ifm(version) : {}) },
    })
  ).data;
}
export async function qput<T = Row>(path: string, body: unknown): Promise<T> {
  return (await request<T>(`/qms${path}`, { method: 'PUT', body })).data;
}
export async function qpatch<T = Row>(path: string, version: number, body: unknown): Promise<T> {
  return (await request<T>(`/qms${path}`, { method: 'PATCH', body, headers: ifm(version) })).data;
}
export async function qdelete(path: string): Promise<void> {
  await request<unknown>(`/qms${path}`, { method: 'DELETE' });
}

export interface Option {
  id: string;
  label: string;
}
export async function lookupRef(
  kind: 'item' | 'customer' | 'supplier' | 'instrument',
  q: string,
): Promise<Option[]> {
  if (kind === 'item') {
    const r = await request<{ id: string; code: string; name: string }[]>(
      `/lookups/items${qs({ q, limit: 30 })}`,
    );
    return r.data.map((x) => ({ id: x.id, label: `${x.code} · ${x.name}` }));
  }
  if (kind === 'customer') {
    const r = await request<{ id: string; code: string; name: string }[]>(
      `/customers${qs({ q, size: 30 })}`,
    );
    return r.data.map((x) => ({ id: x.id, label: `${x.code} · ${x.name}` }));
  }
  if (kind === 'supplier') {
    const r = await request<{ id: string; code: string; name: string }[]>(
      `/suppliers${qs({ q, size: 30 })}`,
    );
    return r.data.map((x) => ({ id: x.id, label: `${x.code} · ${x.name}` }));
  }
  const r = await request<Row[]>(`/qms/instruments${qs({ status: 'ACTIVE', q, size: 50 })}`);
  return r.data.map((x) => ({
    id: String(x.id),
    label: `${String(x.equipmentNo)} · ${String(x.name)}`,
  }));
}
