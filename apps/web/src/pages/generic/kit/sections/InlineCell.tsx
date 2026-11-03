// apps/web/src/pages/generic/kit/sections/InlineCell.tsx
// Inline editable table cell for quick number/text updates (docs/plans/07-ENGINE-KIT.md §2.3, §12 T-KIT-08)

import { useState } from 'react';
import type { PanelCall } from '../panelTypes';

export interface InlineCellProps {
  rowId: string;
  initialValue: unknown;
  editable: { type: 'qty' | 'money' | 'text'; action: PanelCall };
  onCall?: (call: PanelCall, opts?: { payload?: Record<string, unknown> }) => Promise<unknown>;
}

export function InlineCell({ rowId, initialValue, editable, onCall }: InlineCellProps) {
  const [val, setVal] = useState<string>(
    initialValue !== null && initialValue !== undefined ? String(initialValue) : '',
  );
  const [committedVal, setCommittedVal] = useState<string>(
    initialValue !== null && initialValue !== undefined ? String(initialValue) : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (val === committedVal) {
      setError(null);
      return;
    }
    if (!onCall) return;

    setError(null);
    setSaving(true);

    try {
      let parsedValue: unknown = val;
      if (editable.type === 'qty' || editable.type === 'money') {
        const num = Number(val);
        parsedValue = isNaN(num) ? val : num;
      }

      await onCall(editable.action, {
        payload: { rowId, value: parsedValue },
      });
      setCommittedVal(val);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'message' in err) {
        setError(String((err as { message: unknown }).message));
      } else {
        setError('Failed to update value.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void save();
    } else if (e.key === 'Escape') {
      setVal(committedVal);
      setError(null);
    }
  };

  return (
    <div className="inline-cell-wrap" style={{ display: 'inline-block', minWidth: '70px' }}>
      <input
        type={editable.type === 'text' ? 'text' : 'number'}
        className="inline-input"
        value={val}
        disabled={saving}
        onChange={(e) => {
          setVal(e.target.value);
          if (error) setError(null);
        }}
        onBlur={() => void save()}
        onKeyDown={handleKeyDown}
        style={{
          width: '100%',
          padding: '2px 4px',
          fontSize: '11px',
          border: error ? '1px solid #dc2626' : '1px solid var(--line)',
          borderRadius: '4px',
          background: saving ? 'var(--card2)' : 'var(--card)',
          color: 'var(--text)',
        }}
        aria-label="Editable cell"
      />
      {error ? (
        <small
          className="field-error"
          role="alert"
          style={{
            display: 'block',
            color: '#dc2626',
            fontSize: '9px',
            marginTop: '2px',
            lineHeight: 1.2,
          }}
        >
          {error}
        </small>
      ) : null}
    </div>
  );
}
