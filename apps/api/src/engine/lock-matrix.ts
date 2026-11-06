// The single rule for "what may be done to a record in which status" (docs/phases/PHASE-04.md §5 C6,
// ROADMAP R-09). Every write path (update, remove, restore, status, submit, documents) asks canDo();
// the web gets the same table through the page schema, so buttons and server never disagree.
import { Errors } from '../core/http/errors';

export const LOCK_OPS = ['update', 'remove', 'restore', 'status', 'submit', 'documents'] as const;
export type LockOp = (typeof LOCK_OPS)[number];

export interface LockInput {
  status: string;
  /** Master pages (statuses Active / Inactive) may be deleted; transactional pages only in Draft. */
  master: boolean;
  /** The financial year of the record is OPEN. */
  fyOpen: boolean;
}

export type LockResult =
  | { ok: true }
  | { ok: false; code: 'RECORD_LOCKED' | 'PERIOD_CLOSED'; message: string };

type Row = Readonly<Record<LockOp, boolean>>;

const row = (
  update: boolean,
  remove: boolean,
  status: boolean,
  submit: boolean,
  documents: boolean,
): Row => ({
  update,
  remove,
  restore: remove,
  status,
  submit,
  documents,
});

/** Transactional pages (header documents). */
const TRANSACTIONAL: Readonly<Record<string, Row>> = {
  Draft: row(true, true, true, true, true),
  Active: row(true, false, true, false, true),
  Inactive: row(true, false, true, false, true),
  Open: row(true, false, true, false, true),
  Pending: row(false, false, true, false, false),
  // Phase 5: the approval engine owns these statuses (docs/phases/PHASE-05.md §5 "Locking").
  'Pending Approval': row(false, false, false, false, false),
  Approved: row(false, false, false, false, false),
  Posted: row(false, false, false, false, false),
  // A rejected document is editable again; resubmitting starts the next approval cycle.
  Rejected: row(true, true, false, true, true),
  Completed: row(false, false, false, false, false),
  Cancelled: row(false, false, false, false, false),
};

/** Statuses the approval workflow owns: edits are refused with the §8 RECORD_LOCKED text. */
export const APPROVAL_LOCKED_STATUSES: ReadonlySet<string> = new Set([
  'Pending Approval',
  'Approved',
  'Posted',
]);

/** Masters: Active / Inactive are fully editable and deletable (soft). */
const MASTER: Readonly<Record<string, Row>> = {
  Active: row(true, true, true, false, true),
  Inactive: row(true, true, true, false, true),
};

const LOCKED: Row = row(false, false, false, false, false);

/** Status a record in `from` may be moved to by hand when it is Pending: only a cancel. */
export const PENDING_MANUAL_TARGETS: readonly string[] = ['Cancelled'];

export function rowFor(status: string, master: boolean): Row {
  return (master ? MASTER : TRANSACTIONAL)[status] ?? LOCKED;
}

export function canDo(op: LockOp, input: LockInput): LockResult {
  if (!input.fyOpen) {
    return {
      ok: false,
      code: 'PERIOD_CLOSED',
      message: 'The financial year of this record is closed.',
    };
  }
  if (rowFor(input.status, input.master)[op]) return { ok: true };
  return { ok: false, code: 'RECORD_LOCKED', message: lockedMessage(op, input.status) };
}

function lockedMessage(op: LockOp, status: string): string {
  if (APPROVAL_LOCKED_STATUSES.has(status)) {
    return `This document is ${status} and cannot be changed.`;
  }
  switch (op) {
    case 'update':
      return `A ${status} record cannot be edited.`;
    case 'remove':
      return `A ${status} record cannot be deleted. Cancel it instead.`;
    case 'restore':
      return `A ${status} record cannot be restored.`;
    case 'status':
      return `A ${status} record cannot change status.`;
    case 'submit':
      return `Only a Draft record can be submitted; this one is ${status}.`;
    case 'documents':
      return `Documents cannot be added to or removed from a ${status} record.`;
  }
}

/** Throws the matching AppError (409 RECORD_LOCKED / PERIOD_CLOSED) when the operation is not allowed. */
export function assertCanDo(op: LockOp, input: LockInput): void {
  const result = canDo(op, input);
  if (result.ok) return;
  if (result.code === 'PERIOD_CLOSED') throw Errors.periodClosed(result.message);
  throw Errors.recordLocked(result.message);
}

/** The table the schema endpoint sends to the web: status → operations allowed. */
export function lockTable(master: boolean): Record<string, Record<LockOp, boolean>> {
  const source = master ? MASTER : TRANSACTIONAL;
  return Object.fromEntries(Object.entries(source).map(([status, r]) => [status, { ...r }]));
}
