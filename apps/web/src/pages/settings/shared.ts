// Small things the Settings screens share.
export const READ_ONLY_HINT = 'Only the Department Head can change this';

export const statusLabel = (s: string): string =>
  s === 'PENDING_APPROVAL' ? 'Waiting for approval' : s.charAt(0) + s.slice(1).toLowerCase();

export const statusClass = (s: string): string =>
  s === 'ACTIVE' ? 'active' : s === 'RETIRED' ? 'inactive' : s === 'DRAFT' ? 'draft' : 'pending';
