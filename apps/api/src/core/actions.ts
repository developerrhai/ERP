// Phase 22-C: the universal ActionBar contract (ROADMAP R-32).
//   * no permission            -> the action is hidden (not in `allowed`, not in `blocked`)
//   * the record's state blocks -> the action is blocked, with the reason shown on hover
// Lists get `_a`, a bitmask computed in SQL from status + permission (no per-row call);
// `actionsFor(ctx, record)` gives the same answer for one record, with the reasons.
import { Prisma } from '@prisma/client';

export const ACTION_KEYS = [
  'open',
  'edit',
  'delete',
  'pdf',
  'excel',
  'print',
  'documents',
  'submit',
  'approve',
  'word',
  'moveForward',
] as const;
export type ActionKey = (typeof ACTION_KEYS)[number];

export const ACTION_BIT: Record<ActionKey, number> = Object.fromEntries(
  ACTION_KEYS.map((k, i) => [k, 1 << i]),
) as Record<ActionKey, number>;

/** What the caller may do on the page (from the permission model), before the record's state. */
export interface PagePerms {
  view: boolean;
  edit: boolean;
  delete: boolean;
  submit: boolean;
  approve: boolean;
  print: boolean;
  export: boolean;
}

export interface ActionSet {
  allowed: ActionKey[];
  blocked: Partial<Record<ActionKey, string>>;
}

export const WORD_REASON = 'Arrives in Phase 27.';
export const MOVE_REASON = 'Arrives in Phase 25.';

const POSTED = ['Posted', 'Approved', 'Closed', 'Cancelled', 'Paid', 'Disbursed', 'Completed', 'Released', 'Locked'];
const PENDING = ['Pending Approval', 'Pending', 'Submitted', 'In Approval'];
const DRAFTY = ['Draft', 'Rejected', 'Returned'];

export type StateClass = 'draft' | 'pending' | 'posted' | 'other';

export function stateClass(status: string | null | undefined): StateClass {
  const s = (status ?? '').trim();
  if (DRAFTY.some((d) => d.toLowerCase() === s.toLowerCase())) return 'draft';
  if (PENDING.some((d) => d.toLowerCase() === s.toLowerCase())) return 'pending';
  if (POSTED.some((d) => d.toLowerCase() === s.toLowerCase())) return 'posted';
  return 'other';
}

/** Reason an action is blocked in this state, or null when the state allows it. */
export function stateReason(action: ActionKey, status: string | null | undefined): string | null {
  const c = stateClass(status);
  switch (action) {
    case 'edit':
      if (c === 'posted') return "Posted documents can't be edited — use Cancel/Reverse.";
      if (c === 'pending') return 'Pending approval — wait for the decision.';
      return null;
    case 'delete':
      if (c === 'pending') return 'Pending approval — wait for the decision.';
      return c === 'posted' ? 'Only Draft records can be deleted.' : null;
    case 'submit':
      if (c === 'draft') return null;
      if (c === 'pending') return 'Already sent for approval.';
      return c === 'posted' ? 'This record is already decided.' : 'Only Draft records can be sent for approval.';
    case 'approve':
      return c === 'pending' ? null : 'Nothing to approve: this record is not waiting for a decision.';
    case 'word':
      return WORD_REASON;
    case 'moveForward':
      return MOVE_REASON;
    default:
      return null;
  }
}

const PERM_FOR: Record<ActionKey, (p: PagePerms) => boolean> = {
  open: (p) => p.view,
  edit: (p) => p.edit,
  delete: (p) => p.delete,
  pdf: (p) => p.print,
  excel: (p) => p.export,
  print: (p) => p.print,
  documents: (p) => p.view,
  submit: (p) => p.submit,
  approve: (p) => p.approve,
  word: (p) => p.print,
  moveForward: (p) => p.view,
};

/** `actionsFor` for one record: allowed + blocked-with-reason. */
export function actionsFor(perms: PagePerms, status: string | null | undefined): ActionSet {
  const allowed: ActionKey[] = [];
  const blocked: Partial<Record<ActionKey, string>> = {};
  for (const k of ACTION_KEYS) {
    if (!PERM_FOR[k](perms)) continue; // hidden
    const reason = stateReason(k, status);
    if (reason === null) allowed.push(k);
    else blocked[k] = reason;
  }
  return { allowed, blocked };
}

export function maskOf(set: ActionSet): number {
  return set.allowed.reduce((m, k) => m | ACTION_BIT[k], 0);
}
export function maskOfBlocked(set: ActionSet): number {
  return (Object.keys(set.blocked) as ActionKey[]).reduce((m, k) => m | (ACTION_BIT[k] << 16), 0);
}

export function decodeMask(mask: number): ActionSet {
  const allowed: ActionKey[] = [];
  const blocked: Partial<Record<ActionKey, string>> = {};
  for (const k of ACTION_KEYS) {
    if (mask & ACTION_BIT[k]) allowed.push(k);
    else if (mask & (ACTION_BIT[k] << 16)) blocked[k] = 'blocked';
  }
  return { allowed, blocked };
}

function lit(names: string[]): Prisma.Sql {
  return Prisma.join(names.map((n) => Prisma.sql`${n.toLowerCase()}`));
}

/**
 * SQL for the per-row `_a` bitmask: bits 0..10 = allowed, bits 16..26 = visible but blocked.
 * `statusExpr` is a trusted SQL column expression. Permissions are bound as booleans.
 * It agrees with actionsFor() for every status (tested).
 */
export function actionMaskSql(statusExpr: string, perms: PagePerms): Prisma.Sql {
  const st = Prisma.sql`lower(coalesce(${Prisma.raw(statusExpr)}::text, ''))`;
  const isDraft = Prisma.sql`${st} IN (${lit(DRAFTY)})`;
  const isPending = Prisma.sql`${st} IN (${lit(PENDING)})`;
  const isPosted = Prisma.sql`${st} IN (${lit(POSTED)})`;
  const one = (k: ActionKey, perm: boolean, okWhen: Prisma.Sql): Prisma.Sql => {
    const bit = ACTION_BIT[k];
    const hi = bit << 16;
    return Prisma.sql`(CASE WHEN NOT ${perm}::boolean THEN 0 WHEN ${okWhen} THEN ${bit}::int ELSE ${hi}::int END)`;
  };
  const yes = Prisma.sql`true`;
  const no = Prisma.sql`false`;
  const parts: Prisma.Sql[] = [
    one('open', perms.view, yes),
    one('edit', perms.edit, Prisma.sql`NOT (${isPosted} OR ${isPending})`),
    one('delete', perms.delete, Prisma.sql`NOT (${isPosted} OR ${isPending})`),
    one('pdf', perms.print, yes),
    one('excel', perms.export, yes),
    one('print', perms.print, yes),
    one('documents', perms.view, yes),
    one('submit', perms.submit, isDraft),
    one('approve', perms.approve, isPending),
    one('word', perms.print, no),
    one('moveForward', perms.view, no),
  ];
  return Prisma.sql`(${Prisma.join(parts, ' | ')})`;
}
