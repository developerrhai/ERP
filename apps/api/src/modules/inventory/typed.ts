// What the seven typed Inventory pages share: the row DTO (same shape as a generic record, plus the
// `refs` labels of lookup fields), the handler interface the records controller dispatches to, and
// small helpers (unit visibility from the request context, undo tokens, audit writes).
import { createHmac } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { recordAudit } from '../../core/audit/audit-service';
import type { AuditAction } from '../../core/audit/audit-service';
import type { Db } from '../../core/db/prisma';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { Caller } from '../records/service';

export interface RefLabel {
  id: string;
  code: string;
  name: string;
}

export interface TypedRecordDto {
  id: string;
  code: string;
  status: string;
  /** null for company-wide rows (items). */
  unitId: string | null;
  fyId: string | null;
  department: string;
  data: Record<string, unknown>;
  version: number;
  amount: number | null;
  createdAt: string;
  createdBy: { id: string; name: string };
  updatedAt: string;
  deletedAt: string | null;
  /** Labels of the lookup-typed fields, by field key. */
  refs: Record<string, RefLabel>;
}

export interface TypedListQuery {
  q?: string;
  status?: string;
  sort: string;
  page: number;
  size: number;
  deleted?: boolean;
  view?: string;
  warehouseId?: string;
  belowReorder?: boolean;
}

export interface ActionBody {
  dispatchedQty?: number;
  receivedQty?: number;
}

export interface ListResult {
  rows: TypedRecordDto[];
  total: number;
  totals?: Record<string, number>;
}

export interface TypedHandler {
  readonly pageId: string;
  list(caller: Caller, query: TypedListQuery): Promise<ListResult>;
  get(caller: Caller, id: string): Promise<TypedRecordDto>;
  create?(caller: Caller, data: Record<string, unknown>): Promise<TypedRecordDto>;
  update?(
    caller: Caller,
    id: string,
    version: number,
    data: Record<string, unknown>,
  ): Promise<TypedRecordDto>;
  remove?(caller: Caller, id: string, version: number | undefined): Promise<{ undoToken: string }>;
  restore?(caller: Caller, id: string, token: string | undefined): Promise<TypedRecordDto>;
  action?(
    caller: Caller,
    id: string,
    action: string,
    body: ActionBody,
    idempotencyKey: string | undefined,
  ): Promise<{ record: TypedRecordDto; replay: boolean }>;
  /** Rows for the .xlsx export (same filters as list, no paging) with optional totals. */
  exportRows?(caller: Caller, query: TypedListQuery): Promise<ListResult>;
  /** Audit rows of this page, optionally of one record. */
  auditScope?(caller: Caller): { unitId: string | null; none: boolean; ownOnly: boolean };
}

/** The unit filter of the request context: a concrete unit, all units (ADMIN+), or nothing. */
export function unitFilter(caller: Caller): { unitId: string | null; none: boolean } {
  return {
    unitId: caller.ctx.unitId,
    none: caller.ctx.unitId === null && !caller.ctx.allUnits,
  };
}

export function concreteUnit(caller: Caller): string {
  if (caller.ctx.unitId === null) {
    throw Errors.contextInvalid('Choose a unit first: "All units" is for viewing lists only.');
  }
  return caller.ctx.unitId;
}

export function undoTokenOf(id: string, deletedAt: Date): string {
  return createHmac('sha256', env.JWT_ACCESS_SECRET)
    .update(`undo:${id}:${deletedAt.getTime()}`)
    .digest('hex')
    .slice(0, 32);
}

export type AuditTarget = 'Item' | 'Warehouse' | 'Voucher';

export function writeAudit(
  db: Db,
  caller: Caller,
  action: AuditAction,
  target: AuditTarget,
  row: { id: string; code: string },
  pageId: string,
  detail: Prisma.InputJsonObject = {},
): Promise<void> {
  return recordAudit(
    {
      action,
      actorId: caller.auth.userId,
      targetType: target,
      targetId: row.id,
      meta: caller.meta,
      detail: { pageId, code: row.code, ...detail },
    },
    db,
  );
}

/** Master status in the database (ACTIVE / INACTIVE) as shown to the web. */
export const masterStatusLabel = (s: 'ACTIVE' | 'INACTIVE'): string =>
  s === 'ACTIVE' ? 'Active' : 'Inactive';

/** Names of users by id, for the `createdBy` of a page of rows. */
export async function userNames(ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

/** The department shown on rows that have no creator department (masters). */
export const INVENTORY_DEPARTMENT = 'Warehouse';
