// Client for the Phase 13 manufacturing endpoints (/api/v1/mfg). Documents are plain JSON; quantities and money arrive as
// decimal strings. State-changing posts carry an Idempotency-Key, and a version through If-Match where the API asks for one.
import { download, request } from './api';
import { saveBlob } from './download';
import type { PageMeta } from '../types';

export type Row = Record<string, unknown>;
export interface Option {
  id: string;
  label: string;
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

export async function mget<T = Row>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<T> {
  return (await request<T>(`/mfg${path}${qs(params)}`)).data;
}
export async function mlist<T = Row>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<{ rows: T[]; meta: PageMeta & Record<string, unknown> }> {
  const r = await request<T[]>(`/mfg${path}${qs({ page: 1, size: 100, ...params })}`);
  return {
    rows: r.data,
    meta: (r.meta ?? { page: 1, size: r.data.length, total: r.data.length }) as PageMeta &
      Record<string, unknown>,
  };
}
export async function mpost<T = Row>(
  path: string,
  body: unknown = {},
  version?: number,
): Promise<T> {
  return (
    await request<T>(`/mfg${path}`, {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': key(), ...(version !== undefined ? ifm(version) : {}) },
    })
  ).data;
}
export async function mpatch<T = Row>(path: string, version: number, body: unknown): Promise<T> {
  return (await request<T>(`/mfg${path}`, { method: 'PATCH', body, headers: ifm(version) })).data;
}
export async function mdelete(path: string): Promise<void> {
  await request<unknown>(`/mfg${path}`, { method: 'DELETE' });
}

export async function lookupWarehouseOptions(): Promise<Option[]> {
  const r = await request<{ id: string; code: string; name: string }[]>(
    '/lookups/warehouses?limit=50',
  );
  return r.data.map((x) => ({ id: x.id, label: `${x.code} · ${x.name}` }));
}
export async function lookupWorkCentreOptions(): Promise<Option[]> {
  const r = await request<Row[]>('/mfg/work-centres?status=ACTIVE&size=200');
  return r.data.map((x) => ({ id: String(x.id), label: `${String(x.code)} · ${String(x.name)}` }));
}

/** Downloads a file the API builds (Excel or PDF) and hands it to the browser as a save. */
export async function saveMfgFile(path: string, fallbackName: string): Promise<void> {
  const { blob, filename } = await download(`/mfg${path}`);
  saveBlob(blob, filename ?? fallbackName);
}
