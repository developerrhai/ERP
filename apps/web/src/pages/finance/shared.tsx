// Small helpers shared by the Finance screens: Indian money format, DD-MM-YYYY dates, status pills.
import type { ReactNode } from 'react';

const INR = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "125000.5" -> "₹ 1,25,000.50" */
export function inr(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isNaN(n) ? '—' : `₹ ${INR.format(n)}`;
}

/** Plain number with Indian grouping, no symbol, for table columns. */
export function amt(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  return Number.isNaN(n) || n === 0 ? '' : INR.format(n);
}

/** "2026-11-06" -> "06-11-2026" */
export function dmy(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '—';
}

export const todayIso = (): string => new Date().toISOString().slice(0, 10);

export function Pill({ children, tone }: { children: ReactNode; tone?: string }) {
  const cls = (tone ?? (typeof children === 'string' ? children : ''))
    .toLowerCase()
    .replace(/\s+/g, '-');
  return <span className={`status ${cls}`}>{children}</span>;
}

export function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div className="msg error show static" role="alert">
      {message}
    </div>
  ) : null;
}

export function PageHead({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}

export function Empty({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <tr className="empty-row">
      <td colSpan={cols}>{children}</td>
    </tr>
  );
}
