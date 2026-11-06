// Add / Edit user modal (prototype .modal + .form-grid + .field). Validates locally for fast
// feedback, then shows the API's 422 field errors under fields and 409 messages on top.
// Phase 3: Units checkbox list + Default unit (at least one unit for Manager/Lead/Member).
import { useRef, useState, type FormEvent } from 'react';
import { Field, PasswordField, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { PasswordHints } from '../../components/PasswordHints';
import { ApiError } from '../../lib/api';
import { checkPassword } from '../../lib/password-policy';
import type { RoleCode, RoleMeta, UnitRef, User } from '../../types';
import {
  createUser,
  manageableRoles,
  needsUnits,
  updateUser,
  userUnitIds,
  VERSION_CONFLICT_MESSAGE,
  type CreateUserInput,
  type UserPatch,
} from './usersApi';

const LOGIN_ID_RE = /^[a-z0-9._@-]{3,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  mode: 'add' | 'edit';
  user?: User;
  roles: RoleMeta[];
  departments: string[];
  /** Units that can be assigned (the active units). */
  units?: UnitRef[];
  onClose: () => void;
  onSaved: (user: User) => void;
}

type Errors = Partial<
  Record<
    | 'loginId'
    | 'email'
    | 'name'
    | 'role'
    | 'department'
    | 'temporaryPassword'
    | 'unitIds'
    | 'defaultUnitId',
    string
  >
>;

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x));

export function UserFormModal({
  mode,
  user,
  roles,
  departments,
  units = [],
  onClose,
  onSaved,
}: Props) {
  const options = manageableRoles(roles);
  const initialRole = options.find(
    (r) => (user?.roleId && r.id === user.roleId) || (user?.role && (r.code === user.role || r.id === user.role)),
  );
  const [loginId, setLoginId] = useState(user?.loginId ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [name, setName] = useState(user?.name ?? '');
  const [roleId, setRoleId] = useState(initialRole?.code ?? initialRole?.id ?? user?.role ?? user?.roleId ?? '');
  const [department, setDepartment] = useState(user?.department ?? '');
  const [extraDepartments, setExtraDepartments] = useState<string[]>(user?.extraDepartments ?? []);
  const [approvalLimit, setApprovalLimit] = useState<string>(
    user?.approvalLimit !== null && user?.approvalLimit !== undefined ? user.approvalLimit : '0',
  );
  const [tempPassword, setTempPassword] = useState('');
  const initialUnits = user ? userUnitIds(user) : [];
  const [unitIds, setUnitIds] = useState<string[]>(initialUnits);
  const [defaultUnitId, setDefaultUnitId] = useState(user?.defaultUnitId ?? '');

  const selectedRole = options.find((r) => r.id === roleId || r.code === roleId);
  const isSuperUser = selectedRole?.code === 'SUPER_USER';
  const roleCode = selectedRole?.code ?? '';

  // Assigned units that are no longer offered (e.g. deactivated) stay visible and removable.
  const unitOptions: UnitRef[] = [
    ...units,
    ...(user?.units ?? []).filter((u) => !units.some((k) => k.id === u.id)),
    ...initialUnits
      .filter((id) => !units.some((k) => k.id === id) && !user?.units?.some((u) => u.id === id))
      .map((id) => ({ id, code: id, name: id })),
  ];
  const unitScoped = needsUnits(roleCode, roles);
  // The default must be one of the chosen units; a single unit is its own default.
  const effectiveDefault = unitIds.includes(defaultUnitId)
    ? defaultUnitId
    : unitIds.length === 1
      ? (unitIds[0] ?? '')
      : '';
  const toggleUnit = (id: string, on: boolean): void =>
    setUnitIds((prev) =>
      on
        ? unitOptions.map((u) => u.id).filter((x) => x === id || prev.includes(x))
        : prev.filter((x) => x !== id),
    );
  const [errors, setErrors] = useState<Errors & { approvalLimit?: string; extraDepartments?: string }>({});
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const pwChecks = checkPassword(tempPassword, loginId, email);

  const validate = (): typeof errors => {
    const e: typeof errors = {};
    if (mode === 'add' && !LOGIN_ID_RE.test(loginId.trim().toLowerCase())) {
      e.loginId = '3–64 characters: letters, digits, . _ @ -';
    }
    if (email.trim() && !EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email address.';
    const n = name.trim();
    if (n.length < 2 || n.length > 100) e.name = 'Name must be 2–100 characters.';
    if (!roleId && !selectedRole) e.role = 'Choose a role.';
    if (!isSuperUser && !department) e.department = 'Choose a department.';
    if (!isSuperUser) {
      if (!approvalLimit || !/^\d+(\.\d{1,2})?$/.test(approvalLimit.trim())) {
        e.approvalLimit = 'Enter an amount of 0 or more with up to 2 decimals.';
      }
    }
    if (unitScoped) {
      if (unitIds.length === 0) e.unitIds = 'Choose at least one unit.';
      else if (!effectiveDefault) e.defaultUnitId = 'Choose the default unit.';
    }
    if (mode === 'add' && !pwChecks.every((c) => c.ok)) {
      e.temporaryPassword = 'The temporary password does not meet the policy.';
    }
    return e;
  };

  const buildPatch = (current: User): UserPatch => {
    const patch: UserPatch = {};
    const newEmail = email.trim().toLowerCase() || null;
    if (newEmail !== current.email) patch.email = newEmail;
    if (name.trim() !== current.name) patch.name = name.trim();
    const currentRoleMatch = options.find(
      (r) => (current.roleId && r.id === current.roleId) || (current.role && (r.code === current.role || r.id === current.role)),
    );
    if (selectedRole && (!currentRoleMatch || selectedRole.id !== currentRoleMatch.id)) {
      if (current.roleId || selectedRole.id) patch.roleId = selectedRole.id;
      patch.role = selectedRole.code;
    }
    if (department !== (current.department ?? '')) patch.department = department || null;
    if (current.extraDepartments !== undefined ? !sameSet(extraDepartments, current.extraDepartments) : extraDepartments.length > 0) {
      patch.extraDepartments = extraDepartments;
    }
    const currentLimitStr = current.approvalLimit !== null && current.approvalLimit !== undefined ? current.approvalLimit : null;
    const nextLimit = isSuperUser ? null : approvalLimit.trim();
    if (current.approvalLimit !== undefined ? nextLimit !== currentLimitStr : (approvalLimit.trim() !== '' && approvalLimit.trim() !== '0')) {
      patch.approvalLimit = nextLimit;
    }
    if (unitScoped) {
      if (!sameSet(unitIds, userUnitIds(current))) patch.unitIds = unitIds;
      if ((effectiveDefault || null) !== (current.defaultUnitId ?? null)) {
        patch.defaultUnitId = effectiveDefault || null;
      }
    }
    return patch;
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (inFlight.current) return;
    const local = validate();
    setErrors(local);
    setFormError('');
    if (Object.keys(local).length) return;
    inFlight.current = true;
    setPending(true);
    try {
      let saved: User;
      if (mode === 'add') {
        const input: CreateUserInput = {
          loginId: loginId.trim().toLowerCase(),
          ...(email.trim() ? { email: email.trim().toLowerCase() } : {}),
          name: name.trim(),
          role: selectedRole?.code ?? (roleId as RoleCode),
          department: isSuperUser ? null : department,
          temporaryPassword: tempPassword,
          ...(unitScoped ? { unitIds, defaultUnitId: effectiveDefault } : {}),
        };
        if (extraDepartments.length > 0) {
          input.extraDepartments = extraDepartments;
        }
        if (approvalLimit && approvalLimit.trim() !== '0') {
          input.approvalLimit = approvalLimit.trim();
        }
        if (selectedRole?.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selectedRole.id)) {
          input.roleId = selectedRole.id;
        }
        saved = await createUser(input);
      } else if (user) {
        const patch = buildPatch(user);
        if (Object.keys(patch).length === 0) {
          onClose();
          return;
        }
        saved = await updateUser(user.id, user.version, patch);
      } else {
        return;
      }
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields as any);
        setFormError(err.code === 'VERSION_CONFLICT' ? VERSION_CONFLICT_MESSAGE : err.message);
      } else {
        setFormError('Something went wrong.');
      }
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const formId = mode === 'add' ? 'user-add-form' : 'user-edit-form';
  return (
    <Modal
      title={mode === 'add' ? 'Add User' : `Edit User — ${user?.name ?? ''}`}
      sub={
        mode === 'add'
          ? 'The user must change this temporary password at first sign-in.'
          : `Login ID: ${user?.loginId ?? ''}`
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn primary" disabled={pending}>
            {pending ? 'Saving…' : mode === 'add' ? 'Create User' : 'Save Changes'}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={(e) => void onSubmit(e)} noValidate>
        {formError ? (
          <div className="msg error show static" role="alert">
            {formError}
          </div>
        ) : null}
        <div className="form-grid">
          {mode === 'add' ? (
            <Field
              label="Login ID"
              value={loginId}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              error={errors.loginId}
              onChange={(e) => setLoginId(e.target.value)}
            />
          ) : null}
          <Field
            label="Full Name"
            value={name}
            autoComplete="off"
            error={errors.name}
            onChange={(e) => setName(e.target.value)}
          />
          <Field
            label="Email"
            type="email"
            value={email}
            autoComplete="off"
            error={errors.email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <SelectField
            label="Role"
            value={roleId}
            error={errors.role}
            onChange={(v) => setRoleId(v)}
          >
            <option value="">Select role</option>
            {options.map((r) => (
              <option key={r.code || r.id} value={r.code || r.id}>
                {r.name || r.label || r.code}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Department"
            value={department}
            error={errors.department}
            onChange={setDepartment}
          >
            <option value="">Select department</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </SelectField>

          <div className="field">
            <label>Also Works In (Extra Departments)</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
              {departments
                .filter((d) => d !== department)
                .map((d) => {
                  const selected = extraDepartments.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      className={`chip ${selected ? 'primary' : ''}`}
                      style={{
                        padding: '3px 8px',
                        borderRadius: '12px',
                        border: selected ? '1px solid var(--primary)' : '1px solid var(--border)',
                        background: selected ? 'var(--primary-subtle, #ebf8ff)' : 'var(--surface-sunken)',
                        color: selected ? 'var(--primary-dark, #2b6cb0)' : 'var(--text)',
                        cursor: 'pointer',
                        fontSize: '11px',
                      }}
                      onClick={() => {
                        if (selected) {
                          setExtraDepartments(extraDepartments.filter((dept) => dept !== d));
                        } else if (extraDepartments.length < 10) {
                          setExtraDepartments([...extraDepartments, d]);
                        }
                      }}
                    >
                      {selected ? '✓ ' : '＋ '}
                      {d}
                    </button>
                  );
                })}
            </div>
            {errors.extraDepartments ? (
              <span className="field-error">{errors.extraDepartments}</span>
            ) : null}
            <span className="hint">Up to 10 additional departments where user can view and work.</span>
          </div>

          <div className="field">
            <Field
              label="Approval Limit (₹)"
              type="number"
              value={isSuperUser ? '' : approvalLimit}
              disabled={isSuperUser}
              error={errors.approvalLimit}
              placeholder={isSuperUser ? 'Unlimited' : '0'}
              onChange={(e) => setApprovalLimit(e.target.value)}
            />
            <span className="hint">
              {isSuperUser
                ? 'Super Users have unlimited approval authority.'
                : 'Maximum financial amount user can approve (0 for none).'}
            </span>
          </div>
          {unitScoped ? (
            <fieldset
              className="field unit-checks"
              aria-invalid={errors.unitIds ? true : undefined}
              aria-describedby={errors.unitIds ? 'user-units-err' : undefined}
            >
              <legend>Units</legend>
              <div className="unit-check-list">
                {unitOptions.map((u) => (
                  <label key={u.id} className="unit-check">
                    <input
                      type="checkbox"
                      className="v8-checkbox"
                      checked={unitIds.includes(u.id)}
                      onChange={(e) => toggleUnit(u.id, e.target.checked)}
                    />
                    {u.name}
                  </label>
                ))}
                {unitOptions.length === 0 ? <span className="v8-sub">No active units.</span> : null}
              </div>
              {errors.unitIds ? (
                <span className="field-error" id="user-units-err">
                  {errors.unitIds}
                </span>
              ) : null}
            </fieldset>
          ) : selectedRole ? (
            <div className="field">
              <span className="field-label">Units</span>
              <span className="v8-sub">Admins work in all units.</span>
            </div>
          ) : null}
          {unitScoped ? (
            <SelectField
              label="Default unit"
              value={effectiveDefault}
              error={errors.defaultUnitId}
              disabled={unitIds.length === 0}
              onChange={setDefaultUnitId}
            >
              <option value="">Select default unit</option>
              {unitOptions
                .filter((u) => unitIds.includes(u.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </SelectField>
          ) : null}
          {mode === 'add' ? (
            <div>
              <PasswordField
                label="Temporary Password"
                value={tempPassword}
                autoComplete="new-password"
                error={errors.temporaryPassword}
                onChange={(e) => setTempPassword(e.target.value)}
              />
              <PasswordHints checks={pwChecks} />
            </div>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}
