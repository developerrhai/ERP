// Writes AuditLog rows for the security events in CONTRACT §6 Audit. The table is append-only (a DB
// trigger raises on UPDATE/DELETE), so this module only ever inserts.
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import type { Db } from '../db/prisma';
import type { RequestMeta } from '../auth/auth-context';

export const CORE_AUDIT_ACTIONS = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'ACCOUNT_LOCKED',
  'LOGOUT',
  'LOGOUT_ALL',
  'TOKEN_REUSE_DETECTED',
  'REFRESH_RACE',
  'PASSWORD_CHANGED',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_PASSWORD_RESET',
  'DEPARTMENT_CREATED',
  'DEPARTMENT_UPDATED',
  'DEPARTMENT_DELETED',
  'PERMISSIONS_UPDATED',
  'DEPARTMENT_ACCESS_UPDATED',
  'MODULE_CONTROL_UPDATED',
  'SETTINGS_UPDATED',
  'COMPANY_UPDATED',
  'UNIT_CREATED',
  'UNIT_UPDATED',
  'UNIT_DELETED',
  'FINANCIAL_YEAR_CREATED',
  'FINANCIAL_YEAR_UPDATED',
  'FINANCIAL_YEAR_SET_CURRENT',
  'FINANCIAL_YEAR_CLOSED',
  'FINANCIAL_YEAR_REOPENED',
  'CONTEXT_CHANGED',
  'RECORD_CREATED',
  'RECORD_UPDATED',
  'RECORD_DELETED',
  'RECORD_RESTORED',
  'RECORD_STATUS_CHANGED',
  'RECORDS_EXPORTED',
  'ITEM_CREATED',
  'ITEM_UPDATED',
  'ITEM_DELETED',
  'ITEM_RESTORED',
  'ITEM_STATUS_CHANGED',
  'WAREHOUSE_CREATED',
  'WAREHOUSE_UPDATED',
  'WAREHOUSE_DELETED',
  'WAREHOUSE_RESTORED',
  'WAREHOUSE_STATUS_CHANGED',
  'VOUCHER_CREATED',
  'VOUCHER_UPDATED',
  'VOUCHER_DELETED',
  'VOUCHER_RESTORED',
  'VOUCHER_POSTED',
  'VOUCHER_CANCELLED',
  'TRANSFER_DISPATCHED',
  'TRANSFER_RECEIVED',
] as const;

export const INVENTORY_AUDIT_ACTIONS = [
  'RESERVATION_CREATED',
  'RESERVATION_RELEASED',
  'RESERVATION_SHORTENED',
  'RESERVATION_EXPIRED',
  'BATCH_CREATED',
  'BATCH_UPDATED',
  'BATCH_QC_CHANGED',
  'BATCH_EXPIRY_EXTENDED',
  'BATCH_RECALLED',
  'SERIAL_UPDATED',
  'HOLD_PLACED',
  'HOLD_RELEASED',
  'RECONCILIATION_CREATED',
  'RECONCILIATION_UPDATED',
  'RECONCILIATION_STATUS_CHANGED',
  'RECONCILIATION_POSTED',
  'REVALUATION_POSTED',
  'REVALUATION_CANCELLED',
  'VALUATION_RUN_CREATED',
  'VALUATION_RUN_FINALIZED',
  'LOCATION_CREATED',
  'LOCATION_UPDATED',
  'LOCATION_DELETED',
  'LOCATION_STATUS_CHANGED',
  'WAREHOUSE_BIN_ENABLED',
  'STOCK_FROZEN_BLOCK',
  'COUNT_STATUS_CHANGED',
  'COUNT_POSTED',
  'WAREHOUSE_FROZEN',
  'WAREHOUSE_UNFROZEN',
  'PUTAWAY_COMPLETED',
  'PICK_CONFIRMED',
  'PACK_STATUS_CHANGED',
  'WMS_TRANSFER_STATUS_CHANGED',
  'BARCODE_CREATED',
  'BARCODE_UPDATED',
  'RFID_IMPORTED',
  'REORDER_POLICY_CHANGED',
  'UOM_CREATED',
  'UOM_UPDATED',
  'POLICY_UPDATED',
  'JOB_RUN',
] as const;

/** Phase 4: documents, submit, import / export jobs. */
export const PHASE4_AUDIT_ACTIONS = [
  'DOCUMENT_ADDED',
  'DOCUMENT_REMOVED',
  'DOCUMENT_DOWNLOADED',
  'DOCUMENT_REJECTED',
  'RECORD_SUBMITTED',
  'EXPORT_JOB_CREATED',
  'IMPORT_VALIDATED',
  'IMPORT_COMMITTED',
] as const;

/** Phase 5: approval engine. Target = the document; detail = request, level, amount, actor, comment. */
export const PHASE5_AUDIT_ACTIONS = [
  'APPROVAL_SUBMITTED',
  'APPROVAL_APPROVED_LEVEL',
  'APPROVAL_APPROVED',
  'APPROVAL_REJECTED',
  'APPROVAL_RETURNED',
  'APPROVAL_WITHDRAWN',
  'APPROVAL_ESCALATED',
  'APPROVAL_REASSIGNED',
  'APPROVAL_MATRIX_CHANGED',
  'DELEGATION_CREATED',
  'DELEGATION_REVOKED',
] as const;

export const AUDIT_ACTIONS: string[] = [
  ...CORE_AUDIT_ACTIONS,
  ...INVENTORY_AUDIT_ACTIONS,
  ...PHASE4_AUDIT_ACTIONS,
  ...PHASE5_AUDIT_ACTIONS,
];

export type AuditAction = string;

export type AuditTargetType =
  | 'User'
  | 'Department'
  | 'Setting'
  | 'Company'
  | 'Unit'
  | 'FinancialYear'
  | 'Item'
  | 'Warehouse'
  | 'Voucher'
  | 'Reservation'
  | 'Batch'
  | 'Serial'
  | 'Location'
  | 'Count'
  | 'Policy'
  | 'Pack'
  | string;

export interface AuditEntry {
  action: AuditAction;
  actorId?: string | null;
  targetType?: AuditTargetType | null;
  targetId?: string | null;
  meta?: RequestMeta;
  ip?: string | null;
  userAgent?: string | null;
  detail?: Prisma.InputJsonObject;
}

export async function recordAudit(entry: AuditEntry, db: Db = prisma): Promise<void> {
  await db.auditLog.create({
    data: {
      action: entry.action,
      actorId: entry.actorId ?? null,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      ip: entry.ip ?? entry.meta?.ip ?? null,
      userAgent: entry.userAgent ?? entry.meta?.userAgent ?? null,
      detail: entry.detail ?? {},
    },
  });
}
