// The ApprovalDocHandler registry (docs/phases/PHASE-05.md §5). The engine never touches a
// document table itself: it asks the handler of the document type. Every generic page is served by
// the generic-records handler below; typed modules (Phase 6+) call ApprovalService.register().
// These handlers are the ONLY code that writes Approved / Rejected / Pending Approval.
import type { Prisma } from '@prisma/client';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { buildPageSchema } from '../../engine/field-schema';
import { kindOf } from '../../engine/kinds';

export interface DocSnapshot {
  code: string;
  title: string;
  amount: Prisma.Decimal | string | null;
  /** The stored owner department of the document (never taken from a request body). */
  department: string;
  unitId: string;
  createdBy: string;
  status: string;
  version: number;
  /** false when the document's financial year is closed. */
  fyOpen: boolean;
}

export interface ApprovalRequestInfo {
  id: string;
  docType: string;
  actorId: string;
}

export interface ApprovalDocHandler {
  /** Re-reads the document inside the transaction and locks its row (FOR UPDATE). null = not found. */
  snapshot(tx: Db, docId: string): Promise<DocSnapshot | null>;
  /** document -> 'Pending Approval' */
  onSubmitted(tx: Db, docId: string, req: ApprovalRequestInfo): Promise<void>;
  /** document -> 'Approved' (a module may post next) */
  onApproved(tx: Db, docId: string, req: ApprovalRequestInfo): Promise<void>;
  /** document -> 'Rejected' */
  onRejected(tx: Db, docId: string, req: ApprovalRequestInfo): Promise<void>;
  /** document -> 'Draft' (also withdraw) */
  onReturned(tx: Db, docId: string, req: ApprovalRequestInfo): Promise<void>;
}

const registered = new Map<string, ApprovalDocHandler>();

/** A module registers the handler of its own document type. */
export function registerApprovalHandler(docType: string, handler: ApprovalDocHandler): void {
  registered.set(docType, handler);
}

interface GenericRow {
  id: string;
  code: string;
  status: string;
  version: number;
  amount: string | null;
  unit_id: string;
  department: string;
  created_by_id: string;
  fy_status: string;
}

async function setGenericStatus(
  tx: Db,
  docType: string,
  docId: string,
  status: string,
  actorId: string,
): Promise<void> {
  const n = await tx.$executeRaw`
    UPDATE generic_records
       SET status = ${status}, version = version + 1, updated_at = now(), updated_by_id = ${actorId}::uuid
     WHERE id = ${docId}::uuid AND page_id = ${docType}`;
  if (n !== 1) throw Errors.notFound('Record not found.');
}

function genericHandler(docType: string): ApprovalDocHandler {
  return {
    async snapshot(tx, docId) {
      const rows = await tx.$queryRaw<GenericRow[]>`
        SELECT g.id, g.code, g.status, g.version, g.amount::text AS amount, g.unit_id, g.department,
               g.created_by_id, fy.status AS fy_status
          FROM generic_records g
          JOIN financial_years fy ON fy.id = g.fy_id
         WHERE g.id = ${docId}::uuid AND g.page_id = ${docType} AND g.deleted_at IS NULL
         FOR UPDATE OF g`;
      const row = rows[0];
      if (!row) return null;
      let department = row.department;
      if (!department) {
        const control = await tx.moduleControl.findUnique({
          where: { pageId: docType },
          select: { ownerDepartment: true },
        });
        department = control?.ownerDepartment ?? '';
      }
      return {
        code: row.code,
        title: buildPageSchema(docType)?.title ?? docType,
        amount: row.amount,
        department,
        unitId: row.unit_id,
        createdBy: row.created_by_id,
        status: row.status,
        version: row.version,
        fyOpen: row.fy_status === 'OPEN',
      };
    },
    onSubmitted: (tx, docId, req) =>
      setGenericStatus(tx, docType, docId, 'Pending Approval', req.actorId),
    onApproved: (tx, docId, req) => setGenericStatus(tx, docType, docId, 'Approved', req.actorId),
    onRejected: (tx, docId, req) => setGenericStatus(tx, docType, docId, 'Rejected', req.actorId),
    onReturned: (tx, docId, req) => setGenericStatus(tx, docType, docId, 'Draft', req.actorId),
  };
}

const genericCache = new Map<string, ApprovalDocHandler>();

/** The handler of a document type: a registered module handler, else the generic one for generic pages. */
export function handlerFor(docType: string): ApprovalDocHandler {
  const own = registered.get(docType);
  if (own) return own;
  if (kindOf(docType) === 'generic') {
    let handler = genericCache.get(docType);
    if (!handler) {
      handler = genericHandler(docType);
      genericCache.set(docType, handler);
    }
    return handler;
  }
  throw Errors.notFound('This page does not use the approval workflow.');
}
