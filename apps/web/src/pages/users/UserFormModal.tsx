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
  const [loginId, setLoginId] = useState(user?.loginId ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [name, setName] = useState(user?.name ?? '');
  const [role, setRole] = useState<RoleCode | ''>(user?.role ?? '');
  const [department, setDepartment] = useState(user?.department ?? '');
  const [tempPassword, setTempPassword] = useState('');
  const initialUnits = user ? userUnitIds(user) : [];
  const [unitIds, setUnitIds] = useState<string[]>(initialUnits);
  const [defaultUnitId, setDefaultUnitId] = useState(user?.defaultUnitId ?? '');
  // Assigned units that are no longer offered (e.g. deactivated) stay visible and removable.
  const unitOptions: UnitRef[] = [
    ...units,
    ...(user?.units ?? []).filter((u) => !units.some((k) => k.id === u.id)),
    ...initialUnits
      .filter((id) => !units.some((k) => k.id === id) && !user?.units?.some((u) => u.id === id))
      .map((id) => ({ id, code: id, name: id })),
  ];
  const unitScoped = needsUnits(role);
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
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const pwChecks = checkPassword(tempPassword, loginId, email);

  const validate = (): Errors => {
    const e: Errors = {};
    if (mode === 'add' && !LOGIN_ID_RE.test(loginId.trim().toLowerCase())) {
      e.loginId = '3–64 characters: letters, digits, . _ @ -';
    }
    if (email.trim() && !EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email address.';
    const n = name.trim();
    if (n.length < 2 || n.length > 100) e.name = 'Name must be 2–100 characters.';
    if (!role) e.role = 'Choose a role.';
    if (!department) e.department = 'Choose a department.';
    if (needsUnits(role)) {
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
    if (role && role !== current.role) patch.role = role;
    if (department !== (current.department ?? '')) patch.department = department || null;
    if (needsUnits(role)) {
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
        saved = await createUser({
          loginId: loginId.trim().toLowerCase(),
          ...(email.trim() ? { email: email.trim().toLowerCase() } : {}),
          name: name.trim(),
          role: role as RoleCode,
          department,
          temporaryPassword: tempPassword,
          ...(needsUnits(role) ? { unitIds, defaultUnitId: effectiveDefault } : {}),
        });
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
        setErrors(err.fields as Errors);
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
            value={role}
            error={errors.role}
            onChange={(v) => setRole(v as RoleCode | '')}
          >
            <option value="">Select role</option>
            {options.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
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
          ) : role ? (
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
