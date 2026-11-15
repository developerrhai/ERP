// GET /work/doc-picker/:pageId?q= : the records of any V40 page that can be moved forward (number, status, date), newest first,
// only in the caller's plants. Pages with a dedicated table are described in doc-sources/; document types and generic
// registers are read from their own source. Table and column names come from constant data, never from the request.
import { prisma } from '../../core/db/prisma';
import { query } from '../procurement/core';
import type { Caller } from '../records/service';
import { Errors } from '../../core/http/errors';
import { accessUserOf, can } from '../../core/rbac/access';
import { pageInfo } from '../../core/registry';
import { isElevated } from './service';
import { catalogOf, catalogRecords } from '../docsmail/print';
import { DOC_SOURCES } from './doc-sources';

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ok = (...n: (string | undefined)[]): boolean => n.every((x) => x === undefined || IDENT.test(x));

export interface PickRow { id: string; number: string; status: string | null; date: string | null }

export async function docPicker(caller: Caller, pageId: string, q: string): Promise<PickRow[]> {
  // a page the access registry knows follows its view right; a V40-only page (an alias of another screen) is for Owner / Admin only
  const allowed = pageInfo(pageId) ? await can(accessUserOf(caller.auth.user), pageId, 'view') : isElevated(caller);
  if (!allowed) throw Errors.forbidden();
  const unitIds = caller.ctx.unitIds;
  const src = DOC_SOURCES.get(pageId);
  if (src && ok(src.table, src.numberCol, src.statusCol, src.dateCol, src.unitCol, src.deptCol)) {
    const rows = await query(
      prisma,
      `SELECT id::text AS id, ${src.numberCol}::text AS number, ${src.statusCol ? `${src.statusCol}::text` : 'NULL'} AS status,
              ${src.dateCol ? `${src.dateCol}::text` : 'NULL'} AS date
         FROM ${src.table}
        WHERE ($1 = '' OR ${src.numberCol}::text ILIKE $2)
          ${src.unitCol ? `AND ${src.unitCol} = ANY($3::uuid[])` : 'AND $3::uuid[] IS NOT NULL'}
          ${src.where ? `AND (${src.where})` : ''}
        ORDER BY ${src.dateCol ?? 'id'} DESC NULLS LAST LIMIT 30`,
      q,
      `%${q}%`,
      unitIds,
    );
    return rows as unknown as PickRow[];
  }
  // document types of the document catalogue (sales order, purchase order, GRN, ...)
  if (catalogOf(pageId)) {
    const rows = await catalogRecords(caller, pageId, q);
    return rows.map((r) => ({ id: String(r.id), number: String(r.number), status: r.status === null || r.status === undefined ? null : String(r.status), date: r.date === null || r.date === undefined ? null : String(r.date) }));
  }
  // registers kept in the generic table
  const rows = await query(
    prisma,
    `SELECT id::text AS id, code AS number, status, doc_date::text AS date FROM generic_records
      WHERE page_id = $1 AND unit_id = ANY($2::uuid[]) AND ($3 = '' OR code ILIKE $4) ORDER BY created_at DESC LIMIT 30`,
    pageId,
    unitIds,
    q,
    `%${q}%`,
  );
  return rows as unknown as PickRow[];
}
