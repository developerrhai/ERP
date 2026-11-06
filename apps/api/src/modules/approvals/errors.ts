// The exact §8 messages of docs/phases/PHASE-05.md. Services throw these; nothing else words an
// approval error. Money is shown in the Indian format (₹1,00,000).
import { AppError } from '../../core/http/errors';
import { formatInr } from './money';

export const ApprovalErrors = {
  matrixLevelGap: (n: number) =>
    new AppError(
      422,
      'MATRIX_LEVEL_GAP',
      `Levels must run 1, 2, 3… without gaps. Level ${n} is missing.`,
      {
        [`level${n}`]: `Level ${n} is missing.`,
      },
    ),
  matrixFirstThreshold: () =>
    new AppError(422, 'MATRIX_FIRST_THRESHOLD', 'Level 1 must start at ₹0.', {
      level1: 'Level 1 must start at ₹0.',
    }),
  matrixThresholdOrder: (n: number, previous: string | number) =>
    new AppError(
      422,
      'MATRIX_THRESHOLD_ORDER',
      `Level ${n} threshold must be higher than level ${n - 1} (${formatInr(previous)}).`,
      { [`level${n}`]: `Must be higher than ${formatInr(previous)}.` },
    ),
  matrixApproverRequired: (n: number) =>
    new AppError(
      422,
      'MATRIX_APPROVER_REQUIRED',
      `Choose a role or a named user for level ${n}, not both.`,
      { [`level${n}`]: 'Choose a role or a named user, not both.' },
    ),
  matrixSameUser: (name: string, n: number) =>
    new AppError(
      422,
      'MATRIX_SAME_USER',
      `${name} cannot be the approver at two levels of the same set.`,
      { [`level${n}`]: `${name} is already an approver at another level.` },
    ),
  matrixDuplicateSet: () =>
    new AppError(
      409,
      'MATRIX_DUPLICATE_SET',
      'A rule set already exists for this department, document and unit.',
    ),
  noApprovalRule: (department: string) =>
    new AppError(
      422,
      'NO_APPROVAL_RULE',
      `No approval rules are set for ${department}. Ask the administrator to add them in Approval Matrix.`,
    ),
  noEligibleApprover: (level: number, role: string) =>
    new AppError(
      422,
      'NO_ELIGIBLE_APPROVER',
      `Nobody other than you can approve level ${level} (${role}). Ask the administrator to assign an approver.`,
    ),
  alreadyPending: () => new AppError(409, 'ALREADY_PENDING', 'Already pending approval.'),
  notSubmittable: (status: string) =>
    new AppError(
      409,
      'NOT_SUBMITTABLE',
      `Only Draft or Rejected documents can be submitted. This one is ${status}.`,
    ),
  selfApproval: () =>
    new AppError(403, 'SELF_APPROVAL', 'You cannot approve a request you raised or created.'),
  oneLevelOnly: (level: number) =>
    new AppError(
      403,
      'ONE_LEVEL_ONLY',
      `You already approved level ${level} of this request. Another approver must act.`,
    ),
  notYourLevel: (role: string) =>
    new AppError(
      403,
      'NOT_YOUR_LEVEL',
      `This level needs ${role}. You are not an approver for it.`,
    ),
  overLimit: (amount: string | number, limit: string | number) =>
    new AppError(
      403,
      'OVER_LIMIT',
      `This needs an approval limit of ${formatInr(amount)}. Your limit is ${formatInr(limit)}.`,
    ),
  levelAlreadyDecided: (name: string, time: string) =>
    new AppError(
      409,
      'LEVEL_ALREADY_DECIDED',
      `This level was already decided by ${name} at ${time}. Refresh to see the latest.`,
    ),
  commentRequired: () =>
    new AppError(422, 'COMMENT_REQUIRED', 'Please write a reason (at least 10 characters).', {
      comment: 'Please write a reason (at least 10 characters).',
    }),
  delegationOverlap: (from: string, to: string) =>
    new AppError(
      409,
      'DELEGATION_OVERLAP',
      `You already have a delegation between ${from} and ${to}.`,
    ),
  delegationSelf: () =>
    new AppError(422, 'DELEGATION_SELF', 'You cannot delegate to yourself.', {
      toUserId: 'You cannot delegate to yourself.',
    }),
};

/** Day-month-year in the business time zone, used inside messages. */
export function formatDmy(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(`${date.slice(0, 10)}T00:00:00Z`) : date;
  const ist = new Date(d.getTime() + (typeof date === 'string' ? 0 : 5.5 * 3600 * 1000));
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${ist.getUTCFullYear()}`;
}

/** "06-11-2026 14:30" in Asia/Kolkata. */
export function formatDateTimeIst(date: Date): string {
  const ist = new Date(date.getTime() + 5.5 * 3600 * 1000);
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mi = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${formatDmy(date)} ${hh}:${mi}`;
}

/** The business date (YYYY-MM-DD, Asia/Kolkata) of an instant. */
export function istDate(date: Date = new Date()): string {
  return new Date(date.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}
