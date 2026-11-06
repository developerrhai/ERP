// Designation Master (admin-designations): typed master for employee designations,
// department mapping, authority level (1-100), and active/inactive status.
import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Field, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { toUiError, type UiError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet, Department, Designation, UserStatus } from '../../types';
import { listDepartments } from './adminApi';
import {
  createDesignation,
  deleteDesignation,
  listDesignations,
  updateDesignation,
  type DesignationInput,
} from './orgApi';

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; item: Designation }
  | { kind: 'delete'; item: Designation }
  | null;

export function DesignationMasterPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const { data, loading, error, reload, setData } = useLoad(listDesignations, []);
  const { data: depts } = useLoad(listDepartments, []);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [modalKey, setModalKey] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const canChange = actions.controls || actions.add || actions.edit;
  const canDelete = actions.controls || actions.delete;
  const close = (): void => setDialog(null);

  const reloadDesignation = async (id: string): Promise<void> => {
    const list = await listDesignations();
    setData(list);
    const fresh = list.find((d) => d.id === id);
    setDialog((cur) => (cur && cur.kind !== 'add' && fresh ? { ...cur, item: fresh } : null));
    setModalKey((k) => k + 1);
  };

  const afterSave = (message: string): void => {
    close();
    reload();
    toast(message);
  };

  const filtered = (data ?? []).filter((d) => {
    if (statusFilter && d.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return d.code.toLowerCase().includes(q) || d.name.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Designation Master</h1>
          <p>Organisational designations, departmental associations, and authority levels.</p>
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
              ＋ Add Designation
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
          placeholder="Search by code or title…"
          value={search}
          aria-label="Search designations"
          onChange={(e) => setSearch(e.target.value)}
        />
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
              <th scope="col">Title</th>
              <th scope="col">Department</th>
              <th scope="col">Level</th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => {
              const active = d.status === 'ACTIVE';
              const deptName =
                d.department?.name ??
                depts?.find((dep) => dep.id === d.departmentId)?.name ??
                'All Departments';
              return (
                <tr key={d.id}>
                  <td><strong>{d.code}</strong></td>
                  <td>{d.name}</td>
                  <td>{deptName}</td>
                  <td>{d.level ?? 10}</td>
                  <td>
                    <span className={`status ${d.status.toLowerCase()}`}>
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
                            aria-label={`Edit ${d.name}`}
                            onClick={() => setDialog({ kind: 'edit', item: d })}
                          >
                            Edit
                          </button>
                        ) : null}
                        {canDelete ? (
                          <button
                            type="button"
                            className="btn sm danger"
                            aria-label={`Delete ${d.name}`}
                            onClick={() => setDialog({ kind: 'delete', item: d })}
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
                <td colSpan={6}>No designations found.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {dialog?.kind === 'add' ? (
        <DesignationFormModal
          departments={depts ?? []}
          onClose={close}
          onSaved={(item) => afterSave(`Designation ${item.name} created.`)}
        />
      ) : null}
      {dialog?.kind === 'edit' ? (
        <DesignationFormModal
          key={modalKey}
          item={dialog.item}
          departments={depts ?? []}
          onReload={() => reloadDesignation(dialog.item.id)}
          onClose={close}
          onSaved={(item) => afterSave(`Designation ${item.name} updated.`)}
        />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <DesignationDeleteModal
          key={modalKey}
          item={dialog.item}
          onReload={() => reloadDesignation(dialog.item.id)}
          onClose={close}
          onDone={(msg) => afterSave(msg)}
        />
      ) : null}
    </>
  );
}

interface FormProps {
  item?: Designation;
  departments: Department[];
  onReload?: () => Promise<void>;
  onClose: () => void;
  onSaved: (d: Designation) => void;
}

function DesignationFormModal({ item, departments, onReload, onClose, onSaved }: FormProps) {
  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [departmentId, setDepartmentId] = useState(item?.departmentId ?? '');
  const [level, setLevel] = useState(String(item?.level ?? 10));
  const [status, setStatus] = useState<UserStatus>(item?.status ?? 'ACTIVE');
  const [err, setErr] = useState<UiError | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const validate = (): Record<string, string> => {
    const f: Record<string, string> = {};
    const c = code.trim();
    if (!/^[A-Z0-9_-]{2,20}$/i.test(c)) {
      f.code = 'Code must be 2–20 letters, digits or dashes.';
    }
    const n = name.trim();
    if (n.length < 2 || n.length > 100) f.name = 'Title must be 2–100 characters.';
    const lvl = Number(level);
    if (isNaN(lvl) || lvl < 1 || lvl > 100) f.level = 'Level must be between 1 and 100.';
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
    const input: DesignationInput = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      departmentId: departmentId.trim() || null,
      level: Number(level),
      status,
    };
    inFlight.current = true;
    setPending(true);
    setErr(null);
    try {
      if (!item) {
        onSaved(await createDesignation(input));
        return;
      }
      const patch: Partial<DesignationInput> = {};
      if (input.code !== item.code) patch.code = input.code;
      if (input.name !== item.name) patch.name = input.name;
      if ((input.departmentId ?? null) !== (item.departmentId ?? null)) {
        patch.departmentId = input.departmentId;
      }
      if (input.level !== item.level) patch.level = input.level;
      if (status !== item.status) patch.status = status;
      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }
      onSaved(await updateDesignation(item.id, item.version, patch));
    } catch (caught) {
      setErr(toUiError(caught));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const formId = item ? 'desig-edit-form' : 'desig-add-form';
  return (
    <Modal
      title={item ? `Edit Designation — ${item.name}` : 'Add Designation'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn primary" disabled={pending}>
            {pending ? 'Saving…' : item ? 'Save Changes' : 'Create Designation'}
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
            maxLength={20}
            autoComplete="off"
            error={err?.fields.code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <Field
            label="Title / Name"
            value={name}
            maxLength={100}
            autoComplete="off"
            error={err?.fields.name}
            onChange={(e) => setName(e.target.value)}
          />
          <SelectField
            label="Department"
            value={departmentId}
            error={err?.fields.departmentId}
            onChange={(v) => setDepartmentId(v)}
          >
            <option value="">(All Departments)</option>
            {departments.map((dep) => (
              <option key={dep.id} value={dep.id}>
                {dep.name}
              </option>
            ))}
          </SelectField>
          <Field
            label="Authority Level (1–100)"
            type="number"
            value={level}
            error={err?.fields.level}
            onChange={(e) => setLevel(e.target.value)}
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

function DesignationDeleteModal({
  item,
  onReload,
  onClose,
  onDone,
}: {
  item: Designation;
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
      await deleteDesignation(item.id, item.version);
      onDone(`Designation ${item.name} deleted.`);
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
      title="Delete Designation"
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
        Delete designation <strong>{item.name}</strong> ({item.code})? Designations linked to active
        employees cannot be deleted.
      </p>
    </Modal>
  );
}
