// apps/api/src/kit/panels/helpers.ts
// Panel builder helpers and query utilities (docs/plans/07-ENGINE-KIT.md §2.3, §2.4 & T-KIT-04)

import { Prisma } from '@prisma/client';
import type { Db } from '../../core/db/prisma';
import type { Caller } from '../../modules/records/service';
import { num, round2, round3 } from '../../modules/inventory/money';
import type { Column, Format, Kpi, PanelAction, Row, Section } from './types';

export function kpi(
  label: string,
  value: string | number | null,
  format: Format,
  tone?: 'good' | 'warn' | 'bad' | null,
  hint?: string,
): Kpi {
  return {
    label,
    value,
    format,
    tone: tone ?? null,
    ...(hint ? { hint } : {}),
  };
}

export function tableSection(opts: {
  title?: string;
  columns: Column[];
  rows: Row[];
  empty?: string;
  meta?: { page: number; size: number; total: number };
  totals?: Record<string, number>;
  rowActions?: PanelAction[];
  headerActions?: PanelAction[];
}): Section {
  return {
    type: 'table',
    ...opts,
  };
}

export function money(d: Prisma.Decimal | number | null | undefined): number | null {
  if (d === null || d === undefined) return null;
  if (typeof d === 'number') return Number(d.toFixed(2));
  return num(round2(d));
}

export function qty(d: Prisma.Decimal | number | null | undefined): number | null {
  if (d === null || d === undefined) return null;
  if (typeof d === 'number') return Number(d.toFixed(3));
  return num(round3(d));
}

export function unitScope(caller: Caller): { unitId: string | null; none: boolean; ownOnly: boolean } {
  return {
    unitId: caller.ctx.unitId,
    none: caller.ctx.unitId === null && !caller.ctx.allUnits,
    ownOnly: false,
  };
}

export function periodOf(
  query: { from?: string; to?: string },
  fy?: { startDate: Date | string; endDate: Date | string } | null,
): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (query.from && query.to) {
    return { from: query.from, to: query.to };
  }
  const defaultFrom = fy?.startDate
    ? new Date(fy.startDate).toISOString().slice(0, 10)
    : today;
  return {
    from: query.from ?? defaultFrom,
    to: query.to ?? today,
  };
}

export interface PagedTableOpts {
  countSql?: Prisma.Sql;
  rowsSql?: (orderBy: Prisma.Sql, limit: number, offset: number) => Prisma.Sql;
  query: { page?: number; size?: number; sort?: string; [k: string]: unknown };
  columns: Column[];
  sorts?: Record<string, string>; // sortKey -> dbColumn
  defaultSort?: string;
  totalsSql?: Prisma.Sql;
  rows?: Row[]; // in-memory fallback
  total?: number;
}

export async function pagedTable(
  db: Db,
  opts: PagedTableOpts,
): Promise<{
  rows: Row[];
  meta: { page: number; size: number; total: number };
  totals?: Record<string, number>;
}> {
  const page = Math.max(1, opts.query.page ?? 1);
  const size = Math.min(100, Math.max(1, opts.query.size ?? 20));
  const offset = (page - 1) * size;

  // In-memory support (e.g. for mock fixture builders)
  if (opts.rows) {
    const total = opts.total ?? opts.rows.length;
    const pagedRows = opts.rows.slice(offset, offset + size);
    return {
      rows: pagedRows,
      meta: { page, size, total },
      totals: undefined,
    };
  }

  // Database SQL support
  let total = 0;
  if (opts.countSql) {
    const countRes = await db.$queryRaw<Array<{ count: bigint | number }>>(opts.countSql);
    total = Number(countRes[0]?.count ?? 0);
  }

  const sortKey = opts.query.sort ?? opts.defaultSort ?? 'createdAt';
  const isDesc = sortKey.startsWith('-');
  const cleanKey = isDesc ? sortKey.slice(1) : sortKey;
  const colName = opts.sorts?.[cleanKey] ?? cleanKey;
  const safeOrder = Prisma.raw(`${colName} ${isDesc ? 'DESC' : 'ASC'}`);

  let rows: Row[] = [];
  if (opts.rowsSql) {
    const sql = opts.rowsSql(safeOrder, size, offset);
    rows = await db.$queryRaw<Row[]>(sql);
  }

  let totals: Record<string, number> | undefined;
  if (opts.totalsSql) {
    const totalsRes = await db.$queryRaw<Array<Record<string, unknown>>>(opts.totalsSql);
    if (totalsRes[0]) {
      totals = {};
      for (const [k, v] of Object.entries(totalsRes[0])) {
        if (v !== null && v !== undefined) {
          totals[k] = Number(v);
        }
      }
    }
  }

  return {
    rows,
    meta: { page, size, total },
    totals,
  };
}
