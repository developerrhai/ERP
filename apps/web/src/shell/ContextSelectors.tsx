// Top-bar Company / Unit / FY selects (Phase 3 A3). A change is saved with PUT /me/context and
// the page refetches; if a page holds unsaved edits the user is asked to discard them first.
import { useState } from 'react';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { ApiError } from '../lib/api';
import { ALL_UNITS_LABEL, changeContext, useAppContext } from '../lib/context';
import { hasUnsavedChanges } from '../lib/unsaved';
import type { CurrentContext } from '../types';

/** Option value for "All Units" (a real unit id is never empty). */
export const ALL_UNITS = '';

export function ContextSelectors() {
  const ctx = useAppContext();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<CurrentContext | null>(null);
  const data = ctx.data;

  const apply = async (next: CurrentContext): Promise<void> => {
    setPending(true);
    try {
      await changeContext(next);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not switch the working context.');
    } finally {
      setPending(false);
    }
  };

  const request = (next: CurrentContext): void => {
    if (!data) return;
    const cur = data.current;
    if (next.unitId === cur.unitId && next.fyId === cur.fyId) return;
    if (hasUnsavedChanges()) setConfirm(next);
    else void apply(next);
  };

  if (!data) {
    const title =
      ctx.status === 'error' ? ctx.error || 'Working context unavailable' : 'Loading context…';
    return (
      <>
        <select className="hide-mobile" aria-label="Company" title={title} disabled>
          <option>{ctx.status === 'error' ? 'Company' : 'Loading…'}</option>
        </select>
        <select className="hide-mobile" aria-label="Unit" title={title} disabled>
          <option>Unit</option>
        </select>
        <select className="hide-mobile" aria-label="Financial year" title={title} disabled>
          <option>FY</option>
        </select>
      </>
    );
  }

  const { company, units, fys, allUnitsAllowed, current } = data;
  return (
    <>
      <select
        className="hide-mobile"
        aria-label="Company"
        title="Active Company"
        value={company.id}
        disabled
        onChange={() => undefined}
      >
        <option value={company.id}>{company.tradeName}</option>
      </select>
      <select
        className="hide-mobile"
        aria-label="Unit"
        title="Select Unit"
        value={current.unitId ?? ALL_UNITS}
        disabled={pending}
        onChange={(e) =>
          request({
            unitId: e.target.value === ALL_UNITS ? null : e.target.value,
            fyId: current.fyId,
          })
        }
      >
        {allUnitsAllowed ? <option value={ALL_UNITS}>{ALL_UNITS_LABEL}</option> : null}
        {units.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      <select
        className="hide-mobile"
        aria-label="Financial year"
        title="Financial Year"
        value={current.fyId}
        disabled={pending}
        onChange={(e) => request({ unitId: current.unitId, fyId: e.target.value })}
      >
        {fys.map((f) => (
          <option key={f.id} value={f.id}>
            {f.status === 'CLOSED' ? `${f.label} (closed)` : f.label}
          </option>
        ))}
      </select>
      {confirm ? (
        <Modal
          size="sm"
          title="Discard unsaved changes?"
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirm(null)}>
                Keep editing
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  const next = confirm;
                  setConfirm(null);
                  void apply(next);
                }}
              >
                Discard and switch
              </button>
            </>
          }
        >
          <p className="confirm-text">
            This page has unsaved changes. Switching the unit or financial year reloads the page and
            discards them.
          </p>
        </Modal>
      ) : null}
    </>
  );
}
