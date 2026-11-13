// Phase 23 top bar: a chip per chosen plant; a click opens a checkbox list with Apply. With unsaved form
// changes it asks to discard them first (same rule as the FY select).
import { useState } from 'react';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { ApiError } from '../lib/api';
import { choosePlants, usePlants } from '../lib/plants';
import { hasUnsavedChanges } from '../lib/unsaved';

export function PlantSelector() {
  const { data } = usePlants();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!data || data.allowed.length < 2) return null;

  const chosen = data.allowed.filter((p) => data.selected.includes(p.id));
  const toggle = (id: string) =>
    setTicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  async function apply() {
    setBusy(true);
    try {
      await choosePlants(ticked, data?.remember ?? false);
      setOpen(false);
      setConfirm(false);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not change the plants.');
    } finally {
      setBusy(false);
    }
  }

  const onApply = () => {
    if (ticked.length === 0) return;
    if (hasUnsavedChanges()) setConfirm(true);
    else void apply();
  };

  return (
    <div className="plant-selector" aria-label="Plants">
      <button
        type="button"
        className="plant-chips"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setTicked(data.selected);
          setOpen((v) => !v);
        }}
      >
        {chosen.map((p) => (
          <span key={p.id} className="chip">
            {p.name}
          </span>
        ))}
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="plant-menu" role="dialog" aria-label="Choose plants">
          {data.allowed.map((p) => (
            <label key={p.id} className="plant-menu-row">
              <input type="checkbox" checked={ticked.includes(p.id)} onChange={() => toggle(p.id)} />
              {p.name} <span className="muted">({p.code})</span>
            </label>
          ))}
          <div className="plant-menu-foot">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn primary" disabled={busy || ticked.length === 0} onClick={onApply}>
              Apply
            </button>
          </div>
        </div>
      ) : null}
      {confirm ? (
        <Modal
          size="sm"
          title="Discard unsaved changes?"
          onClose={() => setConfirm(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirm(false)}>
                Keep editing
              </button>
              <button type="button" className="btn danger" onClick={() => void apply()}>
                Discard and switch
              </button>
            </>
          }
        >
          <p className="confirm-text">
            This page has unsaved changes. Changing the plants reloads the page and discards them.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
