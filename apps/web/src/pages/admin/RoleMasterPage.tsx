// Role Master (admin-roles, Phase 02 §2, §5.5): lists roles with level, user count,
// system badge, and Add/Edit/Delete modals + Permissions shortcut.
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Field, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { toUiError, type UiError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet, RoleInfo, UserStatus } from '../../types';
import {
  createRole,
  deleteRole,
  listRoles,
  ROLE_CREATED_BY,
  updateRole,
  type RoleCreateInput,
  type RoleUpdateInput,
} from './adminApi';

const CODE_RE = /^[A-Z][A-Z0-9_]{1,29}$/;

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; role: RoleInfo }
  | { kind: 'delete'; role: RoleInfo }
  | null;

export function RoleMasterPage({ actions }: { actions?: Pick<ActionSet, 'add' | 'edit' | 'delete'> }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(listRoles, []);
  const [dialog, setDialog] = useState<Dialog>(null);

  const roles = [...(data ?? [])].sort((a, b) => b.level - a.level);
  const canAdd = Boolean(actions?.add);
  const close = (): void => setDialog(null);

  const afterSave = (message: string): void => {
    close();
    reload();
    toast(message);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Role Master</h1>
          <p>Roles and the authority hierarchy. System roles have locked codes and levels.</p>
        </div>
        <div className="actions">
          {canAdd ? (
            <button
              type="button"
              className="btn primary"
              onClick={() => setDialog({ kind: 'add' })}
            >
              ＋ Add Role
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
              <th scope="col">Role</th>
              <th scope="col">Level</th>
              <th scope="col">Users</th>
              <th scope="col">Can be created by</th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => {
              const isSuper = r.code === 'SUPER_ADMIN' || r.code === 'SUPER_USER';
              const canEdit = actions?.edit && r.canManage;
              const canDel = actions?.delete && r.canManage && !r.isSystem;
              return (
                <tr key={r.id || r.code}>
                  <td title={r.code}>{r.label || r.name}</td>
                  <td>{r.level}</td>
                  <td>{r.userCount}</td>
                  <td>
                    {ROLE_CREATED_BY[r.code] ?? (r.level >= 95 ? 'Nobody (system)' : `Level > ${r.level}`)}
                  </td>
                  <td>
                    <span className={`status ${(r.status ?? 'ACTIVE').toLowerCase()}`}>
                      {r.status === 'INACTIVE' ? 'Inactive' : 'Active'}
                    </span>
                  </td>
                  <td>
                    <div className="actions">
                      {isSuper ? (
                        <span className="v8-sub">All permissions (owner)</span>
                      ) : (
                        <button
                          type="button"
                          className="btn sm"
                          aria-label={`Permissions for ${r.label || r.name}`}
                          onClick={() => navigate(`/m/admin-permissions?role=${r.code || r.id}`)}
                        >
                          Permissions
                        </button>
                      )}
                      {canEdit ? (
                        <button
                          type="button"
                          className="btn sm"
                          aria-label={`Edit ${r.label || r.name}`}
                          onClick={() => setDialog({ kind: 'edit', role: r })}
                        >
                          Edit
                        </button>
                      ) : null}
                      {canDel ? (
                        <button
                          type="button"
                          className="btn sm danger"
                          aria-label={`Delete ${r.label || r.name}`}
                          disabled={r.userCount > 0}
                          title={r.userCount > 0 ? 'Assigned to users; cannot be deleted' : undefined}
                          onClick={() => setDialog({ kind: 'delete', role: r })}
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
            {loading && !data ? (
              <tr className="empty-row">
                <td colSpan={6}>Loading…</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {dialog?.kind === 'add' ? (
        <AddRoleModal
          roles={roles}
          onClose={close}
          onSaved={() => afterSave('Role created.')}
        />
      ) : null}

      {dialog?.kind === 'edit' ? (
        <EditRoleModal
          role={dialog.role}
          onClose={close}
          onSaved={() => afterSave(`Role ${dialog.role.name} updated.`)}
        />
      ) : null}

      {dialog?.kind === 'delete' ? (
        <DeleteRoleModal
          role={dialog.role}
          onClose={close}
          onDeleted={() => afterSave(`Role ${dialog.role.name} deleted.`)}
        />
      ) : null}
    </>
  );
}

// -----------------------------------------------------------------------------
// Add Role Modal
// -----------------------------------------------------------------------------
function AddRoleModal({
  roles,
  onClose,
  onSaved,
}: {
  roles: RoleInfo[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [level, setLevel] = useState(50);
  const [description, setDescription] = useState('');
  const [allUnits, setAllUnits] = useState(false);
  const [copyFromRoleId, setCopyFromRoleId] = useState('');
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uiError, setUiError] = useState<UiError | null>(null);

  const onNameChange = (val: string) => {
    setName(val);
    if (!codeManuallyEdited) {
      const slug = val
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 30);
      setCode(slug);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedCode = code.trim().toUpperCase();
    if (!CODE_RE.test(trimmedCode)) {
      setUiError({
        message: 'Please fix the highlighted fields.',
        fields: { code: 'Use 2-30 uppercase letters, digits and underscores; start with a letter.' },
        code: 'VALIDATION_ERROR',
      });
      return;
    }
    setSubmitting(true);
    setUiError(null);
    try {
      const payload: RoleCreateInput = {
        name: name.trim(),
        code: trimmedCode,
        level: Number(level),
        description: description.trim() || null,
        allUnits,
        copyFromRoleId: copyFromRoleId || undefined,
      };
      await createRole(payload);
      onSaved();
    } catch (err) {
      setUiError(toUiError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="Add Role"
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" form="add-role-form" className="btn primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Role'}
          </button>
        </div>
      }
    >
      <form id="add-role-form" onSubmit={onSubmit} className="v8-form">
        <Field
          label="Role Name"
          name="name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          error={uiError?.fields?.name}
          required
          autoFocus
        />
        <div className="field">
          <Field
            label="Code"
            name="code"
            value={code}
            onChange={(e) => {
              setCodeManuallyEdited(true);
              setCode(e.target.value.toUpperCase());
            }}
            error={uiError?.fields?.code}
            required
          />
          <span className="hint">Permanent identifier (uppercase, 2-30 chars, e.g. REGIONAL_MANAGER).</span>
        </div>
        <div className="field">
          <Field
            label="Authority Level"
            name="level"
            type="number"
            value={String(level)}
            onChange={(e) => setLevel(Number(e.target.value))}
            error={uiError?.fields?.level}
            required
          />
          <span className="hint">1 to 94. Higher number = more authority. Must be below your own level.</span>
        </div>
        <div className="field">
          <label>Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
          {uiError?.fields?.description ? (
            <span className="field-error">{uiError.fields.description}</span>
          ) : null}
        </div>
        <SelectField
          label="Copy Permissions From"
          value={copyFromRoleId}
          onChange={setCopyFromRoleId}
        >
          <option value="">None (default permissions)</option>
          {roles.map((r) => (
            <option key={r.id || r.code} value={r.id || r.code}>
              {r.label || r.name} ({r.code})
            </option>
          ))}
        </SelectField>
        <div className="field">
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={allUnits}
              onChange={(e) => setAllUnits(e.target.checked)}
            />
            <span>Can work in all units without individual assignment</span>
          </label>
        </div>
        {uiError?.message ? <div className="msg error show static">{uiError.message}</div> : null}
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Edit Role Modal
// -----------------------------------------------------------------------------
function EditRoleModal({
  role,
  onClose,
  onSaved,
}: {
  role: RoleInfo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(role.name || role.label || '');
  const [level, setLevel] = useState(role.level);
  const [description, setDescription] = useState(role.description ?? '');
  const [allUnits, setAllUnits] = useState(role.allUnits ?? false);
  const [status, setStatus] = useState<UserStatus>(role.status ?? 'ACTIVE');
  const [submitting, setSubmitting] = useState(false);
  const [uiError, setUiError] = useState<UiError | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setUiError(null);
    try {
      const patch: RoleUpdateInput = {
        name: name.trim(),
        description: description.trim() || null,
        allUnits,
        status,
      };
      if (!role.isSystem) {
        patch.level = Number(level);
      }
      await updateRole(role.id, role.version ?? 1, patch);
      onSaved();
    } catch (err) {
      setUiError(toUiError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={`Edit Role: ${role.label || role.name}`}
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" form="edit-role-form" className="btn primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      }
    >
      <form id="edit-role-form" onSubmit={onSubmit} className="v8-form">
        <Field
          label="Role Name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={uiError?.fields?.name}
          required
          autoFocus
        />
        <div className="field">
          <label>Code</label>
          <input type="text" value={role.code} disabled readOnly className="readonly" />
          <span className="hint">Role codes cannot be changed.</span>
        </div>
        <div className="field">
          <Field
            label="Authority Level"
            name="level"
            type="number"
            value={String(level)}
            onChange={(e) => setLevel(Number(e.target.value))}
            disabled={role.isSystem}
            error={uiError?.fields?.level}
            required
          />
          <span className="hint">
            {role.isSystem ? 'System role level is locked.' : 'Must be below your own level.'}
          </span>
        </div>
        <div className="field">
          <label>Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
          {uiError?.fields?.description ? (
            <span className="field-error">{uiError.fields.description}</span>
          ) : null}
        </div>
        <div className="field">
          <SelectField
            label="Status"
            value={status}
            onChange={(val) => setStatus(val as UserStatus)}
            disabled={role.userCount > 0 && status === 'ACTIVE'}
          >
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </SelectField>
          {role.userCount > 0 ? (
            <span className="hint">Assigned to active users; cannot deactivate.</span>
          ) : null}
        </div>
        <div className="field">
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={allUnits}
              onChange={(e) => setAllUnits(e.target.checked)}
            />
            <span>Can work in all units without individual assignment</span>
          </label>
        </div>
        {uiError?.message ? <div className="msg error show static">{uiError.message}</div> : null}
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Delete Role Modal
// -----------------------------------------------------------------------------
function DeleteRoleModal({
  role,
  onClose,
  onDeleted,
}: {
  role: RoleInfo;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [uiError, setUiError] = useState<UiError | null>(null);

  const onDelete = async () => {
    setSubmitting(true);
    setUiError(null);
    try {
      await deleteRole(role.id, role.version ?? 1);
      onDeleted();
    } catch (err) {
      setUiError(toUiError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={`Delete Role: ${role.label || role.name}`}
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="btn danger" onClick={onDelete} disabled={submitting}>
            {submitting ? 'Deleting…' : 'Delete Role'}
          </button>
        </div>
      }
    >
      <p>
        Are you sure you want to delete role <strong>{role.label || role.name}</strong> (<code>{role.code}</code>)?
      </p>
      <p className="v8-sub">
        This action cannot be undone. All custom permission rows for this role will also be removed.
      </p>
      {uiError?.message ? <div className="msg error show static">{uiError.message}</div> : null}
    </Modal>
  );
}
