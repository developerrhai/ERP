// For the working registers (vouchers, reservations, counts, batches...): the V40 column set of the page's first tab plus the
// values of every row on the page, looked up by document id. If the V40 layout cannot be loaded the page keeps its own columns.
import { useMemo } from 'react';
import { useLoad } from '../../../lib/useLoad';
import { getV40Tab } from './v40Api';
import type { V40Column, V40TabRow } from './v40Api';

export interface V40Cols {
  /** null while loading or when the layout is not available: draw the page's own columns. */
  cols: V40Column[] | null;
  byId: ReadonlyMap<string, V40TabRow>;
  reload: () => void;
}

export function useV40Cols(
  pageId: string,
  tab: string,
  q: { q?: string; status?: string; page: number; size: number },
  /** Anything that changes when the page's own list reloads (so the values are fetched again). */
  version: unknown,
): V40Cols {
  const { data, reload } = useLoad(
    () => getV40Tab(pageId, tab, q).catch(() => null),
    [pageId, tab, q.q, q.status, q.page, q.size, version],
  );
  const byId = useMemo(() => {
    const m = new Map<string, V40TabRow>();
    for (const r of data?.rows ?? []) if (r.id && !m.has(r.id)) m.set(r.id, r);
    return m;
  }, [data]);
  return { cols: data?.columns ?? null, byId, reload };
}
