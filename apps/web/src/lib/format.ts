// Small display helpers (initials, role/department line, dates) shared by the top bar,
// drawer and User Master so the same user always renders the same way.
import type { User } from '../types';

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : (parts[0]?.[1] ?? '');
  return (first + last).toUpperCase() || '?';
}

export function roleLine(user: Pick<User, 'roleLabel' | 'department'>): string {
  return user.department ? `${user.roleLabel} • ${user.department}` : user.roleLabel;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}
