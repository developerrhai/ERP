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
    type: 'DOCUMENT_EXPIRING',
    label: 'Document expiring',
    description: 'A document you manage is about to expire.',
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
