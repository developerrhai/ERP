// Client of the V40 flat registers (/scm/v40/<kind>) of the Procurement / SCM pages.
import { request } from '../../lib/api';
import type { PageMeta } from '../../types';
import type { Row } from './v40Specs';

export interface V40Page {
  rows: Row[];
  meta: PageMeta;
}

export async function listV40(
  kind: string,
  p: { page?: number; size?: number; q?: string; status?: string } = {},
): Promise<V40Page> {
  const qs = new URLSearchParams({ page: String(p.page ?? 1), size: String(p.size ?? 20) });
  if (p.q) qs.set('q', p.q);
  if (p.status) qs.set('status', p.status);
  const r = await request<Row[]>(`/scm/v40/${kind}?${qs.toString()}`);
  return { rows: r.data, meta: r.meta ?? { page: 1, size: r.data.length, total: r.data.length } };
}
