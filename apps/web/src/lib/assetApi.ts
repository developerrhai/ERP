// Client for the Phase 14 endpoints (/api/v1/maint and /api/v1/assets). Documents are plain JSON; quantities and money arrive as
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

export async function aget<T = Row>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<T> {
  return (await request<T>(`${path}${qs(params)}`)).data;
}
export async function alist<T = Row>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<{ rows: T[]; meta: PageMeta & Record<string, unknown> }> {
  const r = await request<T[]>(`${path}${qs({ page: 1, size: 100, ...params })}`);
  return {
    rows: r.data,
    meta: (r.meta ?? { page: 1, size: r.data.length, total: r.data.length }) as PageMeta &
      Record<string, unknown>,
  };
}
export async function apost<T = Row>(
  path: string,
  body: unknown = {},
  version?: number,
): Promise<T> {
  return (
    await request<T>(path, {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': key(), ...(version !== undefined ? ifm(version) : {}) },
    })
  ).data;
}
export async function apatch<T = Row>(path: string, version: number, body: unknown): Promise<T> {
  return (await request<T>(path, { method: 'PATCH', body, headers: ifm(version) })).data;
}
export async function aput<T = Row>(path: string, body: unknown): Promise<T> {
  return (await request<T>(path, { method: 'PUT', body })).data;
}

export async function saveAssetFile(path: string, fallbackName: string): Promise<void> {
  const { blob, filename } = await download(path);
  saveBlob(blob, filename ?? fallbackName);
}

/** The labels PDF is built from a POST, so it is fetched as a blob here. */
export async function printLabels(ids: string[]): Promise<void> {
  const { blob } = await download('/assets/qr/labels', { method: 'POST', body: { ids } });
  saveBlob(blob, 'asset-labels.pdf');
}
