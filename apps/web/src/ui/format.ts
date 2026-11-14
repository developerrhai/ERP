// Indian number / date / status helpers shared by the Phase 36 UI kit.
export function formatINR(n: number | string | null | undefined, decimals = 2): string {
  const v = typeof n === 'string' ? Number(n) : n;
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(v);
}

export function parseINR(s: string): number | null {
  const t = s.replace(/[₹,\s]/g, '');
  if (t === '' || t === '-' || t === '.') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** ISO yyyy-mm-dd (or a full ISO string / Date) -> dd-mm-yyyy; anything else -> an em dash. */
export function formatDMY(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const src = typeof iso === 'string' ? iso : Number.isNaN(iso.getTime()) ? '' : iso.toISOString();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(src);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '—';
}

/** dd-mm-yyyy -> ISO yyyy-mm-dd, or null when it is not a real calendar date. */
export function parseDMY(s: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  if (d.getUTCDate() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'mute';

const STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Draft', tone: 'mute' },
  SUBMITTED: { label: 'Submitted', tone: 'info' },
  PENDING: { label: 'Pending', tone: 'warn' },
  PENDING_APPROVAL: { label: 'Pending approval', tone: 'warn' },
  APPROVED: { label: 'Approved', tone: 'ok' },
  REJECTED: { label: 'Rejected', tone: 'bad' },
  OPEN: { label: 'Open', tone: 'info' },
  CLOSED: { label: 'Closed', tone: 'mute' },
  CANCELLED: { label: 'Cancelled', tone: 'bad' },
  POSTED: { label: 'Posted', tone: 'ok' },
  PAID: { label: 'Paid', tone: 'ok' },
  PARTIAL: { label: 'Partly paid', tone: 'warn' },
  RECEIVED: { label: 'Received', tone: 'info' },
  ACCEPTED: { label: 'Accepted', tone: 'ok' },
  ACTIVE: { label: 'Active', tone: 'ok' },
  INACTIVE: { label: 'Inactive', tone: 'mute' },
  COMPLETED: { label: 'Completed', tone: 'ok' },
  IN_PROGRESS: { label: 'In progress', tone: 'info' },
  OVERDUE: { label: 'Overdue', tone: 'bad' },
  ON_HOLD: { label: 'On hold', tone: 'warn' },
  PENDING_L1: { label: 'Pending approval (level 1)', tone: 'warn' },
  PENDING_L2: { label: 'Pending approval (level 2)', tone: 'warn' },
  PENDING_L3: { label: 'Pending approval (level 3)', tone: 'warn' },
  NOT_REQUIRED: { label: 'Not required', tone: 'mute' },
  NONE: { label: '—', tone: 'mute' },
  RETURNED: { label: 'Returned', tone: 'warn' },
  WAITING_APPROVAL: { label: 'Waiting for approval', tone: 'warn' },
  IN_WORK: { label: 'In department work', tone: 'info' },
  PLANNED: { label: 'Planned', tone: 'info' },
  DONE: { label: 'Done', tone: 'ok' },
  PARTIALLY_RECEIVED: { label: 'Partly received', tone: 'warn' },
  REVERSED: { label: 'Reversed', tone: 'bad' },
};

/** One status code -> one word and one colour for every module (a raw code is never shown). */
export function statusInfo(code: string | null | undefined): { label: string; tone: Tone } {
  if (!code) return { label: '—', tone: 'mute' };
  const hit = STATUS[code.toUpperCase()];
  if (hit) return hit;
  const words = code.toLowerCase().replace(/[_-]+/g, ' ');
  return { label: words.charAt(0).toUpperCase() + words.slice(1), tone: 'mute' };
}
