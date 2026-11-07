// Shared constants of the Format & Settings engine (Phase 6B).

/**
 * Publishing a money-affecting rule set goes through the Phase 5 approval engine under this document
 * type. It is the id of the new admin page, but the people who submit and approve are the owner
 * department's heads and managers, not Administrators: see pageAllows() in approvals/service.ts.
 */
export const SETTINGS_APPROVAL_DOC_TYPE = 'admin-formats';

/** Lowest role level that may approve a settings change (Department Manager). */
export const SETTINGS_APPROVER_MIN_LEVEL = 50;

/** Document statuses that still count as "open": a format they pin cannot be retired. */
export const OPEN_DOCUMENT_STATUSES = ['Draft', 'Pending Approval', 'Rejected'] as const;
