// Small parts shared by the Quality screens of the v2 specification: priority, the compulsory-comment pop-up, the
// approval trail, a CSV file of a table and the data types of the new endpoints.
import { useState, type ReactNode } from 'react';
import { Modal } from '../../../components/Modal';
import { saveFile } from '../../../lib/docsMailApi';
import { toUiError } from '../../../lib/errors';
import { formatDateTime } from '../../../lib/format';
import { ErrorBox, Pill } from '../../finance/shared';
import './qms-v2.css';

export const PRIORITIES = ['MINOR', 'MAJOR', 'CRITICAL'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<string, string> = { MINOR: 'Minor', MAJOR: 'Major', CRITICAL: 'Critical' };
const PRIORITY_TONE: Record<string, string> = { MINOR: 'draft', MAJOR: 'pending', CRITICAL: 'rejected' };

export function PriorityPill({ value }: { value: string | null | undefined }) {
  return value ? <Pill tone={PRIORITY_TONE[value]}>{PRIORITY_LABEL[value] ?? value}</Pill> : <span>—</span>;
}

export function PrioritySelect({ id, value, onChange, optional = false, disabled = false, label }: { id?: string; value: string; onChange: (v: string) => void; optional?: boolean; disabled?: boolean; label?: string }) {
  return (
    <select id={id} aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {optional ? <option value="">Not set</option> : null}
      {PRIORITIES.map((p) => (
        <option key={p} value={p}>
          {PRIORITY_LABEL[p]}
        </option>
      ))}
    </select>
  );
}

export interface TrailEvent {
  action: string;
  note: string | null;
  at: string;
  byName: string | null;
}
export function Trail({ events }: { events: TrailEvent[] }) {
  return (
    <div className="table-wrap">
      <table className="register-table plain">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Step</th>
            <th>Comment</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={`${e.at}-${i}`}>
              <td>{formatDateTime(e.at)}</td>
              <td>{e.byName ?? '—'}</td>
              <td>{e.action.charAt(0) + e.action.slice(1).toLowerCase()}</td>
              <td>{e.note ?? '—'}</td>
            </tr>
          ))}
          {events.length === 0 ? (
            <tr>
              <td colSpan={4}>No steps recorded yet.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A pop-up that asks for words before an action: Return (comment compulsory), accept, cancel, revoke. The button stays
 * off until the words are long enough, and a refusal from the server is shown in the pop-up.
 */
export function CommentDialog({ title, text, label, action, min = 3, danger = false, onSubmit, onClose }: { title: string; text: ReactNode; label: string; action: string; min?: number; danger?: boolean; onSubmit: (words: string) => Promise<void>; onClose: () => void }) {
  const [words, setWords] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const short = words.trim().length < min;
  return (
    <Modal
      title={title}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className={danger ? 'btn danger' : 'btn primary'}
            disabled={busy || short}
            title={short ? `Type at least ${min} letters first.` : undefined}
            onClick={() => {
              setBusy(true);
              setError('');
              onSubmit(words.trim())
                .catch((e: unknown) => setError(messageOf(e)))
                .finally(() => setBusy(false));
            }}
          >
            {action}
          </button>
        </>
      }
    >
      <ErrorBox message={error} />
      <p>{text}</p>
      <div className="field">
        <label htmlFor="qv-words">
          {label}
          {min > 0 ? ' *' : ''}
        </label>
        <textarea id="qv-words" rows={3} maxLength={500} autoFocus value={words} onChange={(e) => setWords(e.target.value)} />
      </div>
    </Modal>
  );
}

export function messageOf(e: unknown): string {
  const u = toUiError(e);
  return Object.values(u.fields)[0] ?? u.message;
}

const cell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v as string | number);
  // a value that starts like a formula is written as text
  const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export function saveCsv(name: string, rows: unknown[][]): void {
  const text = rows.map((r) => r.map(cell).join(',')).join('\r\n');
  saveFile({ blob: new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }), filename: name }, name);
}

/** "2026-11" of today in India, moved back `back` months. */
export function monthIso(back = 0): string {
  const d = new Date(Date.now() + 19_800_000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - back);
  return d.toISOString().slice(0, 7);
}
