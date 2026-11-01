// Add / Edit user modal (prototype .modal + .form-grid + .field). Validates locally for fast
// feedback, then shows the API's 422 field errors under fields and 409 messages on top.
import { useRef, useState, type FormEvent } from 'react';
import { Field, PasswordField, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { PasswordHints } from '../../components/PasswordHints';
import { ApiError } from '../../lib/api';
import { checkPassword } from '../../lib/password-policy';
import type { RoleCode, RoleMeta, User } from '../../types';
import {
  createUser,
  manageableRoles,
  updateUser,
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
  onClose: () => void;
  onSaved: (user: User) => void;
}

type Errors = Partial<
  Record<'loginId' | 'email' | 'name' | 'role' | 'department' | 'temporaryPassword', string>
>;

export function UserFormModal({ mode, user, roles, departments, onClose, onSaved }: Props) {
  const options = manageableRoles(roles);
  const [loginId, setLoginId] = useState(user?.loginId ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [name, setName] = useState(user?.name ?? '');
  const [role, setRole] = useState<RoleCode | ''>(user?.role ?? '');
  const [department, setDepartment] = useState(user?.department ?? '');
  const [tempPassword, setTempPassword] = useState('');
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
