// The notification types the ERP can send (docs/phases/PHASE-05.md §9). The list is code, not data:
// the Notification Center reads it to draw the Preferences grid, and notify() refuses unknown types.
export type NotificationSeverity = 'INFO' | 'ACTION' | 'WARN';
export type EmailMode = 'OFF' | 'INSTANT' | 'DIGEST';
export type NotificationGroup = 'Approvals' | 'System';

export interface NotificationTypeDef {
  type: string;
  label: string;
  description: string;
  group: NotificationGroup;
  severity: NotificationSeverity;
  /** The in-app copy cannot be switched off (the approver would never learn about the request). */
  inAppLocked: boolean;
}

export const NOTIFICATION_TYPES: readonly NotificationTypeDef[] = [
  {
    type: 'APPROVAL_ASSIGNED',
    label: 'Approval waiting for me',
    description: 'A request needs your decision.',
    group: 'Approvals',
    severity: 'ACTION',
    inAppLocked: true,
  },
  {
    type: 'APPROVAL_DECIDED',
    label: 'My request was decided',
    description: 'Your request was approved, rejected, returned or withdrawn.',
    group: 'Approvals',
    severity: 'INFO',
    inAppLocked: false,
  },
  {
    type: 'APPROVAL_LEVEL_PASSED',
    label: 'My request moved to the next level',
    description: 'One level approved your request.',
    group: 'Approvals',
    severity: 'INFO',
    inAppLocked: false,
  },
  {
    type: 'APPROVAL_ESCALATED',
    label: 'Approval escalated',
    description: 'A request was not decided in time and was escalated.',
    group: 'Approvals',
    severity: 'WARN',
    inAppLocked: false,
  },
  {
    type: 'APPROVAL_REMINDER',
    label: 'Approval reminder',
    description: 'Daily reminder for requests waiting more than 24 hours.',
    group: 'Approvals',
    severity: 'ACTION',
    inAppLocked: false,
  },
  {
    type: 'DELEGATION_STARTED',
    label: 'Approvals delegated to me',
    description: 'A colleague delegated their approvals to you.',
    group: 'Approvals',
    severity: 'INFO',
    inAppLocked: false,
  },
  {
    type: 'SYSTEM_JOB_FAILED',
    label: 'Background job failed',
    description: 'A scheduled job did not finish (Administrators).',
    group: 'System',
    severity: 'WARN',
    inAppLocked: false,
  },
  {
    type: 'STOCK_EXPIRING',
    label: 'Stock expiring',
    description: 'Batches in stock have expired or expire within 30 days.',
    group: 'System',
    severity: 'WARN',
    inAppLocked: false,
  },
  {
    type: 'STOCK_REORDER',
    label: 'Items to re-order',
    description: 'Stock fell below the re-order level of one or more items.',
    group: 'System',
    severity: 'WARN',
    inAppLocked: false,
  },
  {
    type: 'DOCUMENT_EXPIRING',
    label: 'Document expiring',
    description: 'A document you manage is about to expire.',
    group: 'System',
    severity: 'WARN',
    inAppLocked: false,
  },
  {
    type: 'SCM_PO_APPROVED',
    label: 'Purchase order approved',
    description: 'Your purchase order was approved.',
    group: 'System',
    severity: 'INFO',
    inAppLocked: false,
  },
  {
    type: 'SCM_GRN_POSTED',
    label: 'Goods received',
    description: 'A goods receipt was posted (stock may wait in Quality Inspection).',
    group: 'System',
    severity: 'INFO',
    inAppLocked: false,
  },
  {
    type: 'SCM_INVOICE_ON_HOLD',
    label: 'Purchase invoice on hold',
    description: 'A purchase invoice has matching problems and is on hold.',
    group: 'System',
    severity: 'WARN',
    inAppLocked: false,
  },
  {
    type: 'SCM_MSME_DUE',
    label: 'MSME payment due soon',
    description: 'A Micro/Small supplier invoice reaches its legal due date soon.',
    group: 'System',
    severity: 'WARN',
    inAppLocked: false,
  },
  {
    type: 'SCM_ITC_180',
    label: 'Input tax credit at risk',
    description: 'An invoice is unpaid and its input tax credit will be reversed after 180 days.',
    group: 'System',
    severity: 'WARN',
    inAppLocked: false,
  },
  {
    type: 'SCM_CONTRACT_EXPIRING',
    label: 'Contract expiring',
    description: 'A purchase contract ends within 30 days.',
    group: 'System',
    severity: 'WARN',
    inAppLocked: false,
  },
  {
    type: 'SCM_PUTAWAY_EXCEPTION',
    label: 'Put-away exception',
    description: 'A put-away task could not be completed.',
    group: 'System',
    severity: 'WARN',
    inAppLocked: false,
  },
  {
    type: 'SCM_SUPPLIER_DOC_EXPIRING',
    label: 'Supplier document expiring',
    description: 'A supplier compliance document is about to expire.',
    group: 'System',
    severity: 'WARN',
    inAppLocked: false,
  },
  {
    type: 'SCM_PO_DELAYED',
    label: 'Purchase order line delayed',
    description: 'A purchase order line is past its expected delivery date.',
    group: 'System',
    severity: 'WARN',
    inAppLocked: false,
  },
  {
    type: 'QMS_INSPECTION_PENDING',
    label: 'Goods waiting for inspection',
    description: 'A goods receipt created an inspection lot; the stock stays in Quality Inspection.',
    group: 'System',
    severity: 'ACTION',
    inAppLocked: false,
  },
  {
    type: 'QMS_CALIBRATION_DUE',
    label: 'Instrument calibration due',
    description: 'A measuring instrument is about to go out of calibration or already has.',
    group: 'System',
    severity: 'WARN',
    inAppLocked: false,
  },
  {
    type: 'MFG_MRP',
    label: 'MRP run finished',
    description: 'An MRP run is done or failed.',
    group: 'System',
    severity: 'INFO',
    inAppLocked: false,
  },
  {
    type: 'MFG_DOWNTIME',
    label: 'Long downtime',
    description: 'A work centre has been down for more than 30 minutes.',
    group: 'System',
    severity: 'WARN',
    inAppLocked: false,
  },
  {
    type: 'MFG_OVERDUE',
    label: 'Production order overdue',
    description: 'A production order is past its due date.',
    group: 'System',
    severity: 'WARN',
    inAppLocked: false,
  },
  {
    type: 'MFG_QC_HOLD',
    label: 'Finished goods on QC hold',
    description: 'Finished goods wait for the final inspection.',
    group: 'System',
    severity: 'ACTION',
    inAppLocked: false,
  },
  {
    type: 'MFG_SHORTAGE',
    label: 'Material shortage at release',
    description: 'A production order was released with a material shortage.',
    group: 'System',
    severity: 'WARN',
    inAppLocked: false,
  },
];

export const NOTIFICATION_TYPE_NAMES: readonly string[] = NOTIFICATION_TYPES.map((t) => t.type);

export function notificationTypeDef(type: string): NotificationTypeDef | undefined {
  return NOTIFICATION_TYPES.find((t) => t.type === type);
}

export function typesOfGroup(group: NotificationGroup): string[] {
  return NOTIFICATION_TYPES.filter((t) => t.group === group).map((t) => t.type);
}

export interface NotifyInput {
  type: string;
  title: string;
  body?: string;
  /** In-app route the item opens, e.g. /approvals?request=<id>. */
  link?: string;
  entityType?: string;
  entityId?: string;
  /** Same (user, dedupeKey) is delivered once. */
  dedupeKey?: string;
  severity?: NotificationSeverity;
  /** Shown in the email: document code and amount. */
  docCode?: string;
  amount?: string | null;
}
