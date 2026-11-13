// Phase 22-C: the one V40 button bar (ROADMAP R-32).
//   no permission        -> the button is hidden
//   the record blocks it -> the button is greyed and the reason is shown on hover / focus
// Word and Move Forward are greyed "Arrives in Phase 27 / Phase 25" until their phase.
import type { ActionSet } from '../types';
import type { ActionKey, RecordActions } from '../lib/screensApi';

interface Btn {
  label: string;
  /** Page permission needed; the button is hidden without it. */
  need: keyof ActionSet;
  /** Record-level buttons need a selected record. */
  record?: ActionKey;
  /** Greyed with this fixed reason until a later phase builds it. */
  later?: string;
  primary?: boolean;
}

export const BAR: readonly Btn[] = [
  { label: 'Excel', need: 'export' },
  { label: 'Industry PDF', need: 'print' },
  { label: 'Word', need: 'print', later: 'Arrives in Phase 27.' },
  { label: 'Print', need: 'print' },
  { label: '＋ Add', need: 'add', primary: true },
  { label: 'Edit', need: 'edit', record: 'edit' },
  { label: 'Delete', need: 'delete', record: 'delete' },
  { label: 'Documents', need: 'view', record: 'documents' },
  { label: 'Submit Approval', need: 'submit', record: 'submit' },
  { label: 'Approval Queue', need: 'view' },
  { label: 'Move Forward', need: 'view', later: 'Arrives in Phase 25.' },
];

interface Props {
  actions: ActionSet;
  /** The selected record's answer from the server (GET …/:id/actions). null = nothing selected. */
  record?: RecordActions | null;
  /** page: shell-level bar (cross-cutting buttons only); full: list screens with records. */
  mode?: 'page' | 'full';
  /** Per-button reasons the screen itself knows (e.g. an entry form that is not built yet). */
  blocked?: Readonly<Record<string, string>>;
  onAction?: (label: string) => void;
}

export function ActionBar({ actions, record = null, mode = 'full', blocked, onAction }: Props) {
  // Shell-level bar: only what an older page does not already draw itself (they keep Excel / Print / Add).
  const SHELL = new Set(['Industry PDF', 'Word', 'Approval Queue', 'Move Forward']);
  const shown = BAR.filter((b) => (mode === 'page' ? SHELL.has(b.label) : true));
  return (
    <div className="actionbar" role="toolbar" aria-label="Page actions" data-testid="actionbar">
      {shown.map((b) => {
        if (!actions[b.need]) return null; // no permission: hidden
        let reason: string | null = blocked?.[b.label] ?? null;
        if (reason !== null) {
          // the screen's own reason wins
        } else if (b.later) reason = b.later;
        else if (b.record) {
          if (record === null) reason = 'Select a record first.';
          else if (record.blocked[b.record]) reason = record.blocked[b.record] ?? null;
          else if (!record.allowed.includes(b.record)) reason = 'Not available for this record.';
        }
        const disabled = reason !== null;
        return (
          <span key={b.label} className="actionbar-item" title={reason ?? undefined}>
            <button
              type="button"
              className={b.primary ? 'btn primary' : 'btn'}
              disabled={disabled}
              aria-disabled={disabled}
              onClick={() => onAction?.(b.label)}
            >
              {b.label}
            </button>
            {disabled ? <span className="sr-only">{reason}</span> : null}
          </span>
        );
      })}
    </div>
  );
}
