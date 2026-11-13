// Phase 22-A shared list pagination (STANDARDS "API pagination").
//   * keyset (cursor) lists for documents / transactions: stable under inserts, no deep OFFSET;
//   * page/size lists for masters under 10k rows;
//   * "unpaginated:true, max:500" for the few small lookups (units, roles, departments...).
// Response meta: { limit, nextCursor, hasMore, total, totalIsEstimate } (keyset) or
// { page, size, total } (page).
import { Prisma } from '@prisma/client';
import { Errors } from './http/errors';

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;
export const LOOKUP_MAX = 500;
/** Exact totals up to this many rows; beyond it the UI shows "10,000+" (an estimate). */
export const TOTAL_EXACT_CAP = 10_000;

export interface CursorPayload {
  /** The sort key the cursor was made for, e.g. "-doc_date". */
  k: string;
  /** Last row's sort value, as a string (dates as ISO). */
  v: string;
  /** Last row's id (tie-breaker). */
  id: string;
}

export interface KeysetMeta {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
  totalIsEstimate: boolean;
}

export interface PageMeta {
  page: number;
  size: number;
  total: number;
}

/** limit param: absent -> 25, > 100 -> PAGE_LIMIT_TOO_LARGE, not a positive integer -> 400. */
export function parseLimit(raw: unknown, fallback = DEFAULT_LIMIT, max = MAX_LIMIT): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1)
    throw Errors.badRequest('limit must be a whole number of 1 or more.');
  if (n > max) throw Errors.pageLimitTooLarge();
  return n;
}

export function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify({ k: p.k, v: p.v, id: p.id }), 'utf8').toString('base64url');
}

/**
 * Decodes a cursor. Anything malformed, tampered with, or made for another sort order throws
 * CURSOR_INVALID (the client restarts from page 1 and shows a toast).
 */
export function decodeCursor(cursor: string, sortKey: string): CursorPayload {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Partial<CursorPayload>;
    if (
      typeof parsed.k === 'string' &&
      typeof parsed.v === 'string' &&
      typeof parsed.id === 'string' &&
      parsed.k === sortKey &&
      /^[0-9a-f-]{36}$/i.test(parsed.id)
    ) {
      return { k: parsed.k, v: parsed.v, id: parsed.id };
    }
  } catch {
    // fall through
  }
  throw Errors.cursorInvalid();
}

export interface SortSpec {
  /** Whitelisted column name (never user text). */
  column: string;
  desc: boolean;
}

/**
 * Parses "-doc_date" / "doc_date" against a whitelist of sort columns. Unknown sorts -> 400.
 * `columns` maps the public sort name to the SQL column expression (without user input).
 */
export function parseSort(
  raw: string | undefined,
  columns: Record<string, string>,
  defaultSort: string,
): { sortKey: string; spec: SortSpec } {
  const key = raw && raw !== '' ? raw : defaultSort;
  const desc = key.startsWith('-');
  const name = desc ? key.slice(1) : key;
  const column = columns[name];
  if (column === undefined) throw Errors.badRequest(`Cannot sort by "${name}".`);
  return { sortKey: key, spec: { column, desc } };
}

/**
 * SQL fragment for "rows after the cursor" under (column, id) ordering. Returns Prisma.empty when
 * there is no cursor. `column` must come from parseSort (a whitelist), `cast` is the SQL type of
 * the sort value (e.g. "date", "timestamptz", "text", "numeric").
 */
export function keysetAfter(
  spec: SortSpec,
  cursor: CursorPayload | null,
  cast: string,
  idColumn = 'id',
): Prisma.Sql {
  if (cursor === null) return Prisma.empty;
  const op = spec.desc ? Prisma.raw('<') : Prisma.raw('>');
  const col = Prisma.raw(spec.column);
  const idc = Prisma.raw(idColumn);
  return Prisma.sql`AND (${col}, ${idc}) ${op} (${cursor.v}::${Prisma.raw(cast)}, ${cursor.id}::uuid)`;
}

export function orderBySql(spec: SortSpec, idColumn = 'id'): Prisma.Sql {
  const dir = Prisma.raw(spec.desc ? 'DESC' : 'ASC');
  return Prisma.sql`ORDER BY ${Prisma.raw(spec.column)} ${dir}, ${Prisma.raw(idColumn)} ${dir}`;
}

export interface KeysetInput<T> {
  sortKey: string;
  limit: number;
  cursor?: string | undefined;
  /** Loads at most `take` rows (always limit + 1) strictly after `after` (null on the first page). */
  fetch: (args: { take: number; after: CursorPayload | null }) => Promise<T[]>;
  /** Sort value of a row as a string (dates -> ISO). */
  valueOf: (row: T) => string | Date | number | null | undefined;
  idOf: (row: T) => string;
  total?: () => Promise<{ total: number; totalIsEstimate: boolean }>;
}

/**
 * Keyset page. Fetches limit + 1 rows so it knows `hasMore` without a count.
 * The cursor carries {k: sortKey, v: lastValue, id: lastId}; a cursor for another sort -> CURSOR_INVALID.
 */
export async function paginateKeyset<T>(
  input: KeysetInput<T>,
): Promise<{ data: T[]; meta: KeysetMeta }> {
  const after = input.cursor ? decodeCursor(input.cursor, input.sortKey) : null;
  const rows = await input.fetch({ take: input.limit + 1, after });
  const hasMore = rows.length > input.limit;
  const data = hasMore ? rows.slice(0, input.limit) : rows;
  const last = data[data.length - 1];
  let nextCursor: string | null = null;
  if (hasMore && last !== undefined) {
    const raw = input.valueOf(last);
    const v =
      raw instanceof Date
        ? raw.toISOString()
        : raw === null || raw === undefined
          ? ''
          : String(raw);
    nextCursor = encodeCursor({ k: input.sortKey, v, id: input.idOf(last) });
  }
  const t = input.total ? await input.total() : { total: data.length, totalIsEstimate: false };
  return {
    data,
    meta: {
      limit: input.limit,
      nextCursor,
      hasMore,
      total: t.total,
      totalIsEstimate: t.totalIsEstimate,
    },
  };
}

/** Minimal client surface so tests can pass a fake. */
export interface RawClient {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
}

/**
 * Total for keyset lists: exact when <= 10,000 rows (counted with the same WHERE, capped by a
 * LIMIT 10001 sub-select), else the pg_class.reltuples estimate with totalIsEstimate = true.
 * `fromWhere` is `FROM <table> WHERE <filters>` (already scope-safe).
 */
export async function cappedTotal(
  db: RawClient,
  table: string,
  fromWhere: Prisma.Sql,
): Promise<{ total: number; totalIsEstimate: boolean }> {
  const rows = await db.$queryRaw<{ n: number }[]>(
    Prisma.sql`SELECT count(*)::int AS n FROM (SELECT 1 ${fromWhere} LIMIT ${TOTAL_EXACT_CAP + 1}) c`,
  );
  const n = rows[0]?.n ?? 0;
  if (n <= TOTAL_EXACT_CAP) return { total: n, totalIsEstimate: false };
  const est = await db.$queryRaw<{ est: number }[]>(
    Prisma.sql`SELECT GREATEST(reltuples, 0)::bigint::float8 AS est FROM pg_class WHERE oid = ${table}::regclass`,
  );
  return {
    total: Math.max(TOTAL_EXACT_CAP + 1, Math.round(est[0]?.est ?? 0)),
    totalIsEstimate: true,
  };
}

/** page/size for masters < 10k rows. Both loaders receive the same skip/take. */
export async function paginatePage<T>(
  input: { page: number; size: number },
  load: (args: { skip: number; take: number }) => Promise<T[]>,
  count: () => Promise<number>,
): Promise<{ data: T[]; meta: PageMeta }> {
  const size = Math.min(Math.max(1, input.size), MAX_LIMIT);
  const page = Math.max(1, input.page);
  const [data, total] = await Promise.all([load({ skip: (page - 1) * size, take: size }), count()]);
  return { data, meta: { page, size, total } };
}
