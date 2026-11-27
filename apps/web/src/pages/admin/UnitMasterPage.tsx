// Unit Master (admin-branches, Phase 3 A1): the manufacturing units in the Department Master
// look — Add/Edit modal, Activate/Deactivate, and Delete that shows the server's 409 IN_USE text.
import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Field, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { loadContext } from '../../lib/context';
import { toUiError, type UiError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import { CODE_MESSAGE, CODE_RE, taxIdError } from '../../lib/validators';
import type { ActionSet, Unit, UserStatus } from '../../types';
import { createUnit, deleteUnit, listUnits, updateUnit, type UnitInput } from './orgApi';

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; unit: Unit }
  | { kind: 'status'; unit: Unit }
  | { kind: 'delete'; unit: Unit }
  | null;

export function UnitMasterPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const { data, loading, error, reload, setData } = useLoad(listUnits, []);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [modalKey, setModalKey] = useState(0);
  const canChange = actions.controls;
  const showUsers = (data ?? []).some((u) => typeof u.userCount === 'number');
  const cols = showUsers ? 7 : 6;
  const close = (): void => setDialog(null);
  /** VERSION_CONFLICT: refetch, then reopen the same dialog on the fresh copy of that unit. */
  const reloadUnit = async (id: string): Promise<void> => {
    const list = await listUnits();
    setData(list);
    const fresh = list.find((u) => u.id === id);
    setDialog((cur) => (cur && cur.kind !== 'add' && fresh ? { ...cur, unit: fresh } : null));
    setModalKey((k) => k + 1);
  };
  const afterSave = (message: string): void => {
    close();
    reload();
    void loadContext(); // the top-bar Unit select lists active units
    toast(message);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Unit Master</h1>
          <p>Manufacturing units, their GST registration and status.</p>
        </div>
        <div className="actions">
          <Link className="btn" to="/m/admin-settings">
            ← System Setup
          </Link>
          {canChange ? (
            <button
              type="button"
              className="btn primary"
              onClick={() => setDialog({ kind: 'add' })}
            >
              ＋ Add Unit
            </button>
          ) : null}
        </div>
      </div>
      {error ? (
        <div className="msg error show static" role="alert">
          {error}
        </div>
      ) : null}
      {/* 4 Top Summary Cards (Demo ERP Baseline) */}
      <div className="kpis x-d-grid x-cols-repeat-4-1fr x-gap-12px x-m-14px-0">
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Operating Units</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">{(data ?? []).length} Plants</b>
          <span className="x-fs-11px x-c-success">Talwade, Sawardari, Varale</span>
        </div>
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Headquarters</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">Pune HQ</b>
          <span className="x-fs-11px x-c-primary">Talwade 0 (Central)</span>
        </div>
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">GSTIN Registrations</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">100% Validated</b>
          <span className="x-fs-11px x-c-success">State Code 27 (MH)</span>
        </div>
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Data Quality</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">100%</b>
          <span className="x-fs-11px x-c-success">Full unit profiles</span>
        </div>
      </div>

      {/* Split view: Branch Master Register + Validation Controls panel */}
      <div className="x-d-grid x-cols-minmax-0-1_8fr-minmax-280px-1fr x-gap-14px x-m-14px-0">
        <div className="card table-wrap x-p-14px x-bg-card x-r-10px x-bd-1px-solid-line-strong">
          <div className="x-d-flex x-jc-space-between x-ai-center x-mb-12px">
            <h3 className="x-m-0 x-fs-14px x-c-text">Branch Master Register</h3>
            {canChange ? (
              <button
                type="button"
                className="btn sm primary"
                onClick={() => setDialog({ kind: 'add' })}
              >
                ＋ Add Master Record
              </button>
            ) : null}
          </div>
          <table>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Plant Name</th>
                <th scope="col">GSTIN</th>
                <th scope="col">Status</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((u) => {
                const active = u.status === 'ACTIVE';
                return (
                  <tr key={u.id}>
                    <td><strong>{u.code}</strong></td>
                    <td>{u.name}</td>
                    <td><code>{u.gstin || '—'}</code></td>
                    <td>
                      <span className={`status ${u.status.toLowerCase()}`}>
                        {active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      {canChange ? (
                        <div className="actions" style={{ display: 'flex', gap: 4 }}>
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => setDialog({ kind: 'edit', unit: u })}
                          >
                            Edit
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card panel x-p-14px x-bg-card x-r-10px x-bd-1px-solid-line-strong">
          <h3 className="x-m-0-0-10px x-fs-14px x-c-text">Validation Controls</h3>
          <p className="x-fs-12px x-c-muted x-m-0-0-12px">Multi-plant governance, dispatch routing and warehouse stock controls.</p>
          <div className="x-d-flex x-fd-column x-gap-8px x-fs-12px">
            <div className="x-d-flex x-jc-space-between x-p-4px-0 x-bb-1px-solid-line">
              <span>Unique Unit Code:</span>
              <b className="x-c-success">Enabled</b>
            </div>
            <div className="x-d-flex x-jc-space-between x-p-4px-0 x-bb-1px-solid-line">
              <span>GSTIN State Verification:</span>
              <b className="x-c-success">Validated (27)</b>
            </div>
            <div className="x-d-flex x-jc-space-between x-p-4px-0 x-bb-1px-solid-line">
              <span>Inventory Isolation:</span>
              <b className="x-c-success">Enforced</b>
            </div>
            <div className="x-d-flex x-jc-space-between x-p-4px-0 x-bb-1px-solid-line">
              <span>Cross-Plant Transfer Note:</span>
              <b className="x-c-success">Active</b>
            </div>
            <div className="x-d-flex x-jc-space-between x-p-4px-0">
              <span>Biometric Device Feed:</span>
              <b>IClock Active</b>
            </div>
          </div>
        </div>
      </div>

      <div className="card table-wrap x-mt-16px">
        <div className="x-p-10px-14px x-bb-1px-solid-line x-d-flex x-jc-space-between x-ai-center">
          <b>Unit / Branch Master • Detailed Table</b>
          <button type="button" className="btn sm" onClick={() => window.print()}>Print Register</button>
        </div>
        <table>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Name</th>
              <th scope="col">Address</th>
              <th scope="col">GSTIN</th>
              <th scope="col">Status</th>
              {showUsers ? <th scope="col">Users</th> : null}
              <th scope="col" style={{ width: 220, textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((u) => {
              const active = u.status === 'ACTIVE';
              return (
                <tr key={u.id}>
                  <td>{u.code}</td>
                  <td>{u.name}</td>
                  <td>{u.address || '—'}</td>
                  <td>{u.gstin || '—'}</td>
                  <td>
                    <span className={`status ${u.status.toLowerCase()}`}>
                      {active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {showUsers ? <td>{u.userCount ?? '—'}</td> : null}
                  <td>
                    {canChange ? (
                      <div className="actions" style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                        <button
                          type="button"
                          className="btn sm"
                          aria-label={`Edit ${u.name}`}
                          onClick={() => setDialog({ kind: 'edit', unit: u })}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={active ? 'btn sm' : 'btn sm success'}
                          aria-label={`${active ? 'Deactivate' : 'Activate'} ${u.name}`}
                          onClick={() => setDialog({ kind: 'status', unit: u })}
                        >
                          {active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          className="btn sm danger"
                          aria-label={`Delete ${u.name}`}
                          onClick={() => setDialog({ kind: 'delete', unit: u })}
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => window.print()}
                        >
                          PDF
                        </button>
                      </div>
                    ) : (
                      <span className="v8-sub">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {loading && !data ? (
              <tr className="empty-row">
                <td colSpan={cols}>Loading…</td>
              </tr>
            ) : null}
            {data && data.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={cols}>No units yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {dialog?.kind === 'add' ? (
        <UnitFormModal onClose={close} onSaved={(u) => afterSave(`Unit ${u.name} created.`)} />
      ) : null}
      {dialog?.kind === 'edit' ? (
        <UnitFormModal
          key={modalKey}
          unit={dialog.unit}
          onReload={() => reloadUnit(dialog.unit.id)}
          onClose={close}
          onSaved={(u) => afterSave(`Unit ${u.name} updated.`)}
        />
      ) : null}
      {dialog?.kind === 'status' ? (
        <UnitConfirmModal
          key={modalKey}
          unit={dialog.unit}
          action="status"
          onReload={() => reloadUnit(dialog.unit.id)}
          onClose={close}
          onDone={(msg) => afterSave(msg)}
        />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <UnitConfirmModal
          key={modalKey}
          unit={dialog.unit}
          action="delete"
          onReload={() => reloadUnit(dialog.unit.id)}
          onClose={close}
          onDone={(msg) => afterSave(msg)}
        />
      ) : null}
    </>
  );
}

interface FormProps {
  unit?: Unit;
  onReload?: () => Promise<void>;
  onClose: () => void;
  onSaved: (u: Unit) => void;
}

function UnitFormModal({ unit, onReload, onClose, onSaved }: FormProps) {
  const [code, setCode] = useState(unit?.code ?? '');
  const [name, setName] = useState(unit?.name ?? '');
  const [address, setAddress] = useState(unit?.address ?? '');
  const [city, setCity] = useState(unit?.city ?? '');
  const [stateCode, setStateCode] = useState(unit?.stateCode ?? '');
  const [pincode, setPincode] = useState(unit?.pincode ?? '');
  const [gstin, setGstin] = useState(unit?.gstin ?? '');
  const [status, setStatus] = useState<UserStatus>(unit?.status ?? 'ACTIVE');
  const [err, setErr] = useState<UiError | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const validate = (): Record<string, string> => {
    const f: Record<string, string> = {};
    if (!CODE_RE.test(code.trim())) f.code = CODE_MESSAGE;
    const n = name.trim();
    if (n.length < 2 || n.length > 60) f.name = 'Name must be 2–60 characters.';
    if (address.trim().length > 300) f.address = 'At most 300 characters.';
    if (city.trim().length > 100) f.city = 'At most 100 characters.';
    if (!/^\d{2}$/.test(stateCode.trim())) {
      f.stateCode = 'Enter the 2-digit GST state code (e.g. 27 for Maharashtra). It decides CGST/SGST or IGST.';
    }
    if (pincode.trim() && !/^\d{6}$/.test(pincode.trim())) {
      f.pincode = 'Pincode must be 6 digits.';
    }
    const g = taxIdError('gstin', gstin);
    if (g) f.gstin = g;
    return f;
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (inFlight.current) return;
    const local = validate();
    if (Object.keys(local).length) {
      setErr({ message: '', fields: local, code: 'LOCAL' });
      return;
    }
    const input: UnitInput = {
      code: code.trim(),
      name: name.trim(),
      address: address.trim() || null,
      gstin: gstin.trim() || null,
      ...(city.trim() ? { city: city.trim() } : {}),
      stateCode: stateCode.trim(),
      ...(pincode.trim() ? { pincode: pincode.trim() } : {}),
    };
    inFlight.current = true;
    setPending(true);
    setErr(null);
    try {
      if (!unit) {
        onSaved(await createUnit(input));
        return;
      }
      const patch: Partial<UnitInput> = {};
      if (input.code !== unit.code) patch.code = input.code;
      if (input.name !== unit.name) patch.name = input.name;
      if ((input.address ?? null) !== (unit.address ?? null)) patch.address = input.address;
      if ((input.city ?? null) !== (unit.city ?? null)) patch.city = input.city ?? null;
      if ((input.stateCode ?? null) !== (unit.stateCode ?? null))
        patch.stateCode = input.stateCode ?? null;
      if ((input.pincode ?? null) !== (unit.pincode ?? null)) patch.pincode = input.pincode ?? null;
      if ((input.gstin ?? null) !== (unit.gstin ?? null)) patch.gstin = input.gstin;
      if (status !== unit.status) patch.status = status;
      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }
      onSaved(await updateUnit(unit.id, unit.version, patch));
    } catch (caught) {
      setErr(toUiError(caught));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  // GSTIN is checked live; the other fields on submit.
  const gstinError = err?.fields.gstin ?? taxIdError('gstin', gstin);
  const formId = unit ? 'unit-edit-form' : 'unit-add-form';
  return (
    <Modal
      title={unit ? `Edit Unit — ${unit.name}` : 'Add Unit'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn primary" disabled={pending}>
            {pending ? 'Saving…' : unit ? 'Save Changes' : 'Create Unit'}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={(e) => void onSubmit(e)} noValidate>
        {err?.message ? (
          <ErrorMessage
            onReload={
              err.code === 'VERSION_CONFLICT' && onReload ? () => void onReload() : undefined
            }
          >
            {err.message}
          </ErrorMessage>
        ) : null}
        <div className="form-grid">
          <Field
            label="Code"
            value={code}
            maxLength={10}
            autoComplete="off"
            error={err?.fields.code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <Field
            label="Name"
            value={name}
            maxLength={60}
            autoComplete="off"
            error={err?.fields.name}
            onChange={(e) => setName(e.target.value)}
          />
          <Field
            label="Address"
            value={address}
            maxLength={300}
            autoComplete="off"
            error={err?.fields.address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <Field
            label="City"
            value={city}
            maxLength={100}
            autoComplete="off"
            error={err?.fields.city}
            onChange={(e) => setCity(e.target.value)}
          />
          <Field
            label="State Code *"
            value={stateCode}
            maxLength={2}
            autoComplete="off"
            error={err?.fields.stateCode}
            onChange={(e) => setStateCode(e.target.value.toUpperCase())}
          />
          <Field
            label="Pincode"
            value={pincode}
            maxLength={6}
            autoComplete="off"
            error={err?.fields.pincode}
            onChange={(e) => setPincode(e.target.value)}
          />
          <Field
            label="GSTIN"
            value={gstin}
            maxLength={15}
            autoComplete="off"
            error={gstinError}
            onChange={(e) => {
              setGstin(e.target.value.toUpperCase());
              if (err?.fields.gstin) {
                const rest = Object.fromEntries(
                  Object.entries(err.fields).filter(([k]) => k !== 'gstin'),
                );
                setErr({ ...err, fields: rest });
              }
            }}
          />
          {unit ? (
            <SelectField
              label="Status"
              value={status}
              error={err?.fields.status}
              onChange={(v) => setStatus(v as UserStatus)}
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </SelectField>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}

function UnitConfirmModal({
  unit,
  action,
  onReload,
  onClose,
  onDone,
}: {
  unit: Unit;
  action: 'status' | 'delete';
  onReload: () => Promise<void>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [error, setError] = useState<UiError | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const active = unit.status === 'ACTIVE';
  const verb = action === 'delete' ? 'Delete' : active ? 'Deactivate' : 'Activate';

  const confirm = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      if (action === 'delete') {
        await deleteUnit(unit.id, unit.version);
        onDone(`Unit ${unit.name} deleted.`);
      } else {
        const saved = await updateUnit(unit.id, unit.version, {
          status: active ? 'INACTIVE' : 'ACTIVE',
        });
        onDone(`${saved.name} is now ${saved.status === 'ACTIVE' ? 'active' : 'inactive'}.`);
      }
    } catch (caught) {
      // 409 IN_USE: show the server's own text (it knows what references the unit).
      setError(toUiError(caught));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <Modal
      size="sm"
      title={`${verb} Unit`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={action === 'delete' || active ? 'btn danger' : 'btn primary'}
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? 'Working…' : verb}
          </button>
        </>
      }
    >
      {error ? (
        <ErrorMessage
          onReload={error.code === 'VERSION_CONFLICT' ? () => void onReload() : undefined}
        >
          {error.message}
        </ErrorMessage>
      ) : null}
      <p className="confirm-text">
        {action === 'delete'
          ? `Delete the unit ${unit.name} (${unit.code})? A unit that users, warehouses or records refer to cannot be deleted — deactivate it instead.`
          : active
            ? `Deactivate ${unit.name} (${unit.code})? Nobody can select it as their working unit until it is activated again.`
            : `Activate ${unit.name} (${unit.code}) again?`}
      </p>
    </Modal>
  );
}
