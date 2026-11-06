// UOM Master (admin-uom): typed master for Units of Measurement,
// measurement classes (Weight, Count, Volume, Length), and decimal precision.
import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Field, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { toUiError, type UiError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet, Uom, UserStatus } from '../../types';
import { createUom, deleteUom, listUoms, updateUom, type UomInput } from './orgApi';

export const UOM_CLASSES = [
  { value: 'COUNT', label: 'Count / Pieces' },
  { value: 'WEIGHT', label: 'Weight' },
  { value: 'LENGTH', label: 'Length' },
  { value: 'VOLUME', label: 'Volume' },
  { value: 'AREA', label: 'Area' },
  { value: 'TIME', label: 'Time' },
  { value: 'OTHER', label: 'Other' },
] as const;

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; item: Uom }
  | { kind: 'delete'; item: Uom }
  | null;

export function UomMasterPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const { data, loading, error, reload, setData } = useLoad(listUoms, []);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [modalKey, setModalKey] = useState(0);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const canChange = actions.controls || actions.add || actions.edit;
  const canDelete = actions.controls || actions.delete;
  const close = (): void => setDialog(null);

  const reloadUom = async (id: string): Promise<void> => {
    const list = await listUoms();
    setData(list);
    const fresh = list.find((u) => u.id === id);
    setDialog((cur) => (cur && cur.kind !== 'add' && fresh ? { ...cur, item: fresh } : null));
    setModalKey((k) => k + 1);
  };

  const afterSave = (message: string): void => {
    close();
    reload();
    toast(message);
  };

  const filtered = (data ?? []).filter((u) => {
    if (statusFilter && u.status !== statusFilter) return false;
    if (classFilter && u.uomClass !== classFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return u.code.toLowerCase().includes(q) || u.name.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Unit of Measurement (UOM) Master</h1>
          <p>Standard units, measurement categories, and precision settings.</p>
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
              ＋ Add UOM
            </button>
          ) : null}
        </div>
      </div>
      {error ? (
        <div className="msg error show static" role="alert">
          {error}
        </div>
      ) : null}
      <div className="recordbar" style={{ marginBottom: 16 }}>
        <input
          type="search"
          placeholder="Search by code or unit name…"
          value={search}
          aria-label="Search units of measurement"
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          value={classFilter}
          aria-label="Filter by measurement class"
          onChange={(e) => setClassFilter(e.target.value)}
        >
          <option value="">All Categories</option>
          {UOM_CLASSES.map((cls) => (
            <option key={cls.value} value={cls.value}>
              {cls.label}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          aria-label="Filter by status"
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Name</th>
              <th scope="col">Category</th>
              <th scope="col">Decimal Places</th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => {
              const active = u.status === 'ACTIVE';
              const classLabel =
                UOM_CLASSES.find((c) => c.value === u.uomClass)?.label ?? u.uomClass ?? 'Other';
              return (
                <tr key={u.id}>
                  <td><strong>{u.code}</strong></td>
                  <td>{u.name}</td>
                  <td>{classLabel}</td>
                  <td>{u.decimals ?? 0}</td>
                  <td>
                    <span className={`status ${u.status.toLowerCase()}`}>
                      {active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    {canChange || canDelete ? (
                      <div className="actions">
                        {canChange ? (
                          <button
                            type="button"
                            className="btn sm"
                            aria-label={`Edit ${u.name}`}
                            onClick={() => setDialog({ kind: 'edit', item: u })}
                          >
                            Edit
                          </button>
                        ) : null}
                        {canDelete ? (
                          <button
                            type="button"
                            className="btn sm danger"
                            aria-label={`Delete ${u.name}`}
                            onClick={() => setDialog({ kind: 'delete', item: u })}
                          >
                            Delete
                          </button>
                        ) : null}
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
                <td colSpan={6}>Loading…</td>
              </tr>
            ) : null}
            {data && filtered.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={6}>No units of measurement found.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {dialog?.kind === 'add' ? (
        <UomFormModal
          onClose={close}
          onSaved={(item) => afterSave(`UOM ${item.code} created.`)}
        />
      ) : null}
      {dialog?.kind === 'edit' ? (
        <UomFormModal
          key={modalKey}
          item={dialog.item}
          onReload={() => reloadUom(dialog.item.id)}
          onClose={close}
          onSaved={(item) => afterSave(`UOM ${item.code} updated.`)}
        />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <UomDeleteModal
          key={modalKey}
          item={dialog.item}
          onReload={() => reloadUom(dialog.item.id)}
          onClose={close}
          onDone={(msg) => afterSave(msg)}
        />
      ) : null}
    </>
  );
}

interface FormProps {
  item?: Uom;
  onReload?: () => Promise<void>;
  onClose: () => void;
  onSaved: (u: Uom) => void;
}

function UomFormModal({ item, onReload, onClose, onSaved }: FormProps) {
  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [uomClass, setUomClass] = useState(item?.uomClass ?? 'COUNT');
  const [decimals, setDecimals] = useState(String(item?.decimals ?? 0));
  const [status, setStatus] = useState<UserStatus>(
    (item?.status as UserStatus) || 'ACTIVE',
  );
  const [err, setErr] = useState<UiError | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const validate = (): Record<string, string> => {
    const f: Record<string, string> = {};
    const c = code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{1,10}$/.test(c)) {
      f.code = 'Code must be 1–10 letters, digits, or dashes (e.g. KG, NOS).';
    }
    const n = name.trim();
    if (n.length < 2 || n.length > 60) f.name = 'Unit name must be 2–60 characters.';
    const dec = Number(decimals);
    if (isNaN(dec) || dec < 0 || dec > 4) f.decimals = 'Decimals must be between 0 and 4.';
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
    const input: UomInput = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      uomClass,
      decimals: Number(decimals),
      status,
    };
    inFlight.current = true;
    setPending(true);
    setErr(null);
    try {
      if (!item) {
        onSaved(await createUom(input));
        return;
      }
      const patch: Partial<UomInput> = {};
      if (input.code !== item.code) patch.code = input.code;
      if (input.name !== item.name) patch.name = input.name;
      if (input.uomClass !== item.uomClass) patch.uomClass = input.uomClass;
      if (input.decimals !== item.decimals) patch.decimals = input.decimals;
      if (status !== item.status) patch.status = status;
      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }
      onSaved(await updateUom(item.id, item.version, patch));
    } catch (caught) {
      setErr(toUiError(caught));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const formId = item ? 'uom-edit-form' : 'uom-add-form';
  return (
    <Modal
      title={item ? `Edit UOM — ${item.code}` : 'Add Unit of Measurement'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn primary" disabled={pending}>
            {pending ? 'Saving…' : item ? 'Save Changes' : 'Create UOM'}
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
            label="UOM Code (e.g. KG, NOS, MTR)"
            value={code}
            maxLength={10}
            autoComplete="off"
            error={err?.fields.code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <Field
            label="Full Unit Name (e.g. Kilogram)"
            value={name}
            maxLength={60}
            autoComplete="off"
            error={err?.fields.name}
            onChange={(e) => setName(e.target.value)}
          />
          <SelectField
            label="Measurement Category"
            value={uomClass}
            error={err?.fields.uomClass}
            onChange={(v) => setUomClass(v)}
          >
            {UOM_CLASSES.map((cls) => (
              <option key={cls.value} value={cls.value}>
                {cls.label}
              </option>
            ))}
          </SelectField>
          <Field
            label="Decimal Places (0–4)"
            type="number"
            value={decimals}
            error={err?.fields.decimals}
            onChange={(e) => setDecimals(e.target.value)}
          />
          {item ? (
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

function UomDeleteModal({
  item,
  onReload,
  onClose,
  onDone,
}: {
  item: Uom;
  onReload: () => Promise<void>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [error, setError] = useState<UiError | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const confirm = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await deleteUom(item.id, item.version);
      onDone(`UOM ${item.code} deleted.`);
    } catch (caught) {
      setError(toUiError(caught));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <Modal
      size="sm"
      title="Delete UOM"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? 'Deleting…' : 'Delete'}
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
        Delete unit of measurement <strong>{item.name}</strong> ({item.code})? Units referenced in
        item master or inventory vouchers cannot be deleted.
      </p>
    </Modal>
  );
}
