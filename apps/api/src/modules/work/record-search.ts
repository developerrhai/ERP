// Global Search (V40 page global-search): looks for a text in the number / name of the records of every page the caller may open,
// in the caller's plants. The pages and tables come from doc-sources/ (and the document catalogue); table and column names are
// constant data, never from the request. Each page contributes at most 5 hits; the whole answer is capped at 80.
import { prisma } from '../../core/db/prisma';
import { pageInfo } from '../../core/registry';
import { accessUserOf, can } from '../../core/rbac/access';
import { Errors } from '../../core/http/errors';
import { CATALOG } from '../docsmail/print';
import { query } from '../procurement/core';
import type { Caller } from '../records/service';
import { DOC_SOURCES, type DocSource } from './doc-sources';
import { isElevated } from './service';

const IDENT = /^[a-z_][a-z0-9_]*$/;

export interface SearchHit { pageId: string; label: string; family: string; id: string; number: string; status: string | null; date: string | null; matched: string }

const sources = (): DocSource[] => {
  const out = new Map<string, DocSource>(DOC_SOURCES);
  for (const c of CATALOG) {
    if (!out.has(c.pageId)) out.set(c.pageId, { pageId: c.pageId, table: c.table, numberCol: c.numberCol, statusCol: c.statusCol, dateCol: c.dateCol, ...(c.unitCol ? { unitCol: c.unitCol } : {}) });
  }
  return [...out.values()];
};

/** Families the search can be limited to (for the Module Family select). */
export function searchFamilies(): string[] {
  const set = new Set<string>();
  for (const s of sources()) {
    const f = pageInfo(s.pageId)?.family;
    if (f) set.add(f);
  }
  return [...set].sort();
}

export async function searchRecords(caller: Caller, q: string, family: string, status: string): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) throw Errors.validation({ q: 'Enter at least 2 characters to search.' });
  const user = accessUserOf(caller.auth.user);
  const elevated = isElevated(caller);
  const unitIds = caller.ctx.unitIds;
  const hits: SearchHit[] = [];

  const one = async (s: DocSource): Promise<SearchHit[]> => {
    const info = pageInfo(s.pageId);
    if (family && info?.family !== family) return [];
    if (!IDENT.test(s.table) || !IDENT.test(s.numberCol) || (s.statusCol && !IDENT.test(s.statusCol)) || (s.dateCol && !IDENT.test(s.dateCol)) || (s.unitCol && !IDENT.test(s.unitCol))) return [];
    const allowed = info ? await can(user, s.pageId, 'view') : elevated;
    if (!allowed) return [];
    try {
      const rows = await query(
        prisma,
        `SELECT id::text AS id, ${s.numberCol}::text AS number, ${s.statusCol ? `${s.statusCol}::text` : 'NULL'} AS status, ${s.dateCol ? `${s.dateCol}::text` : 'NULL'} AS date
           FROM ${s.table}
          WHERE ${s.numberCol}::text ILIKE $1
            ${status && s.statusCol ? `AND ${s.statusCol}::text ILIKE $2` : 'AND $2::text IS NOT NULL'}
            ${s.unitCol ? `AND ${s.unitCol} = ANY($3::uuid[])` : 'AND $3::uuid[] IS NOT NULL'}
            ${s.where ? `AND (${s.where})` : ''}
          ORDER BY ${s.dateCol ?? 'id'} DESC NULLS LAST LIMIT 5`,
        `%${term}%`,
        status || '',
        unitIds,
      );
      return rows.map((r) => ({
        pageId: s.pageId,
        label: info?.title ?? s.pageId,
        family: info?.family ?? '',
        id: String(r.id),
        number: String(r.number),
        status: r.status === null || r.status === undefined ? null : String(r.status),
        date: r.date === null || r.date === undefined ? null : String(r.date),
        matched: `Number / name contains "${term}"`,
      }));
    } catch {
      return [];
    }
  };

  const all = sources();
  for (let i = 0; i < all.length && hits.length < 80; i += 12) {
    const part = await Promise.all(all.slice(i, i + 12).map(one));
    for (const p of part) hits.push(...p);
  }
  return hits.slice(0, 80);
}
