// Department Master (admin-departments): prototype master table (Code, Name, Head, Status, Users)
// with Add/Edit modals and a delete confirm that explains 409 IN_USE; Administration is protected.
import { useRef, useState, type FormEvent } from 'react';
import { Field, SelectField } from '../../components/Field';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { toUiError, type UiError } from '../../lib/errors';
import { refreshMenu } from '../../lib/menu';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet, Department, UserStatus } from '../../types';
import {
  createDepartment,
  deleteDepartment,
  listDepartments,
  updateDepartment,
  type DepartmentInput,
} from './adminApi';

export const PROTECTED_DEPARTMENT = 'Administration';
const CODE_RE = /^[A-Z0-9]{2,10}$/;

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; dept: Department }
  | { kind: 'delete'; dept: Department }
  | null;

export function DepartmentMasterPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const { data, loading, error, reload, setData } = useLoad(listDepartments, []);
  const [dialog, setDialog] = useState<Dialog>(null);
  // Bumped on a conflict reload so the open modal remounts with the fresh record.
  const [modalKey, setModalKey] = useState(0);
  const canChange = actions.controls;
  const close = (): void => setDialog(null);
  /** VERSION_CONFLICT: refetch, then reopen the same dialog on the fresh copy of that record. */
  const reloadDept = async (id: string): Promise<void> => {
    const list = await listDepartments();
    setData(list);
    const fresh = list.find((d) => d.id === id);
    setDialog((cur) => (cur && cur.kind !== 'add' && fresh ? { ...cur, dept: fresh } : null));
    setModalKey((k) => k + 1);
  };
  const afterSave = (message: string): void => {
    close();
    reload();
    void refreshMenu();
    toast(message);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Department Master</h1>
          <p>Departments, heads and the users assigned to them.</p>
        </div>
        <div className="actions">
          {canChange ? (
            <button
              type="button"
              className="btn primary"
              onClick={() => setDialog({ kind: 'add' })}
            >
              ＋ Add Department
            </button>
          ) : null}
        </div>
      </div>
      {error ? (
        <div className="msg error show static" role="alert">
          {error}
        </div>
      ) : null}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Name</th>
              <th scope="col">Head</th>
              <th scope="col">Status</th>
              <th scope="col">Users</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((d) => {
              const isProtected = d.name === PROTECTED_DEPARTMENT;
              return (
                <tr key={d.id}>
                  <td>{d.code}</td>
                  <td>{d.name}</td>
                  <td>{d.head ?? '—'}</td>
                  <td>
                    <span className={`status ${d.status.toLowerCase()}`}>
                      {d.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>{d.userCount}</td>
                  <td>
                    {canChange ? (
                      <div className="actions">
                        <button
                          type="button"
                          className="btn sm"
                          aria-label={`Edit ${d.name}`}
                          onClick={() => setDialog({ kind: 'edit', dept: d })}
                        >
                          Edit
                        </button>
                        {isProtected ? null : (
                          <button
                            type="button"
                            className="btn sm danger"
                            aria-label={`Delete ${d.name}`}
                            onClick={() => setDialog({ kind: 'delete', dept: d })}
                          >
                            Delete
                          </button>
                        )}
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
            {data && data.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={6}>No departments yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {dialog?.kind === 'add' ? (
        <DepartmentFormModal
          onClose={close}
          onSaved={(d) => afterSave(`Department ${d.name} created.`)}
        />
      ) : null}
      {dialog?.kind === 'edit' ? (
        <DepartmentFormModal
          key={modalKey}
          dept={dialog.dept}
          onReload={() => reloadDept(dialog.dept.id)}
          onClose={close}
          onSaved={(d) => afterSave(`Department ${d.name} updated.`)}
        />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <DeleteDepartmentModal
          key={modalKey}
          dept={dialog.dept}
          onReload={() => reloadDept(dialog.dept.id)}
          onClose={close}
          onDeleted={() => afterSave(`Department ${dialog.dept.name} deleted.`)}
        />
      ) : null}
    </>
  );
}

interface FormProps {
  dept?: Department;
  onReload?: () => Promise<void>;
  onClose: () => void;
  onSaved: (d: Department) => void;
}

function DepartmentFormModal({ dept, onReload, onClose, onSaved }: FormProps) {
  const [code, setCode] = useState(dept?.code ?? '');
  const [name, setName] = useState(dept?.name ?? '');
  const [head, setHead] = useState(dept?.head ?? '');
  const [status, setStatus] = useState<UserStatus>(dept?.status ?? 'ACTIVE');
  const [err, setErr] = useState<UiError | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const isProtected = dept?.name === PROTECTED_DEPARTMENT;

  const validate = (): Record<string, string> => {
    const f: Record<string, string> = {};
    if (!CODE_RE.test(code.trim())) f.code = 'Code: 2–10 capital letters or digits.';
    const n = name.trim();
    if (n.length < 2 || n.length > 60) f.name = 'Name must be 2–60 characters.';
    if (head.trim().length > 100) f.head = 'Head must be at most 100 characters.';
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
    const input: DepartmentInput = {
      code: code.trim(),
      name: name.trim(),
      head: head.trim() || null,
    };
    inFlight.current = true;
    setPending(true);
    setErr(null);
    try {
      if (!dept) {
        onSaved(await createDepartment(input));
        return;
      }
      const patch: Partial<DepartmentInput> = {};
      if (input.code !== dept.code) patch.code = input.code;
      if (input.name !== dept.name) patch.name = input.name;
      if ((input.head ?? null) !== (dept.head ?? null)) patch.head = input.head ?? null;
      if (status !== dept.status) patch.status = status;
      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }
      onSaved(await updateDepartment(dept.id, dept.version, patch));
    } catch (caught) {
      setErr(toUiError(caught));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const formId = dept ? 'dept-edit-form' : 'dept-add-form';
  return (
    <Modal
      title={dept ? `Edit Department — ${dept.name}` : 'Add Department'}
      sub={
        isProtected ? 'Administration cannot be renamed away, deactivated or deleted.' : undefined
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn primary" disabled={pending}>
            {pending ? 'Saving…' : dept ? 'Save Changes' : 'Create Department'}
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
            disabled={isProtected}
            error={err?.fields.name}
            onChange={(e) => setName(e.target.value)}
          />
          <Field
            label="Head"
            value={head}
            maxLength={100}
            autoComplete="off"
            error={err?.fields.head}
            onChange={(e) => setHead(e.target.value)}
          />
          {dept ? (
            <SelectField
              label="Status"
              value={status}
              disabled={isProtected}
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

function DeleteDepartmentModal({
  dept,
  onReload,
  onClose,
  onDeleted,
}: {
  dept: Department;
  onReload: () => Promise<void>;
  onClose: () => void;
  onDeleted: () => void;
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
      await deleteDepartment(dept.id, dept.version);
      onDeleted();
    } catch (caught) {
      // 409 IN_USE / PROTECTED: show the server's own text (our user count may be stale).
      setError(toUiError(caught));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <Modal
      size="sm"
      title="Delete Department"
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
        Delete the department {dept.name} ({dept.code})? Its menu access settings are removed too.
      </p>
    </Modal>
  );
}
