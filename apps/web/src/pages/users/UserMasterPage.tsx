// User Master (/m/admin-users): the prototype user table backed by GET /users with search,
// filters and pagination; Add/Edit/Reset/Activate follow /me/permissions and the role rules.
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import { useAppContext } from '../../lib/context';
import { formatDateTime } from '../../lib/format';
import type { ActionSet, RoleCode, RoleMeta, User, UserStatus } from '../../types';
import { ResetPasswordModal } from './ResetPasswordModal';
import { StatusConfirmModal } from './StatusConfirmModal';
import { UserFormModal } from './UserFormModal';
import {
  canManageUser,
  fetchDepartments,
  fetchRoles,
  listUsers,
  manageableRoles,
  unitsLabel,
} from './usersApi';

const PAGE_SIZE = 20;

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; user: User }
  | { kind: 'reset'; user: User }
  | { kind: 'status'; user: User }
  | null;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function pageWindow(page: number, pages: number): number[] {
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const out: number[] = [];
  for (let p = start; p <= Math.min(pages, start + 4); p += 1) out.push(p);
  return out;
}

interface Props {
  currentUser: User;
  /** From GET /me/permissions: add → Add User; edit → Edit / Reset Password / Activate. */
  actions?: Pick<ActionSet, 'add' | 'edit'>;
}

export function UserMasterPage({ currentUser, actions = { add: true, edit: true } }: Props) {
  const toast = useToast();
  const [roles, setRoles] = useState<RoleMeta[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 300);
  const [role, setRole] = useState<RoleCode | ''>('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [unitId, setUnitId] = useState('');
  // Phase 3: the assignable units come from the working context (ADMIN+ see every active unit).
  const units = useAppContext().data?.units ?? [];
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchRoles(), fetchDepartments()])
      .then(([r, d]) => {
        if (!alive) return;
        setRoles(r);
        setDepartments(d);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof ApiError ? err.message : 'Could not load roles.');
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listUsers({ q, role, status, unitId, page, size: PAGE_SIZE })
      .then((res) => {
        if (!alive) return;
        setUsers(res.users);
        setTotal(res.meta.total);
        setError('');
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof ApiError ? err.message : 'Could not load users.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [q, role, status, unitId, page, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const close = useCallback(() => setDialog(null), []);
  const canAdd = actions.add && manageableRoles(roles).length > 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>User Master</h1>
          <p>Department-wise login accounts and roles.</p>
        </div>
        <div className="actions">
          {canAdd ? (
            <button
              type="button"
              className="btn primary"
              onClick={() => setDialog({ kind: 'add' })}
            >
              ＋ Add User
            </button>
          ) : null}
        </div>
      </div>
      {error ? (
        <div className="msg error show static" role="alert">
          {error}
        </div>
      ) : null}
      <div className="card">
        <div className="v8-table-toolbar">
          <input
            type="search"
            placeholder="Search name, login ID or email..."
            aria-label="Search users"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <select
            aria-label="Filter by role"
            value={role}
            onChange={(e) => {
              setRole(e.target.value as RoleCode | '');
              setPage(1);
            }}
          >
            <option value="">All Roles</option>
            {roles.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as UserStatus | '');
              setPage(1);
            }}
          >
            <option value="">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
          <select
            aria-label="Filter by unit"
            value={unitId}
            onChange={(e) => {
              setUnitId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Units</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <span className="v8-spacer" />
          <span className="v8-sub" aria-live="polite">
            {loading ? 'Loading…' : `${total} user${total === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Login ID</th>
                <th scope="col">Email</th>
                <th scope="col">Department</th>
                <th scope="col">Role</th>
                <th scope="col">Units</th>
                <th scope="col">Status</th>
                <th scope="col">Last Login</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const manageable = actions.edit && canManageUser(u, currentUser, roles);
                return (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{u.loginId}</td>
                    <td>{u.email ?? '—'}</td>
                    <td>{u.department ?? '—'}</td>
                    <td>{u.roleLabel}</td>
                    <td>{unitsLabel(u, units)}</td>
                    <td>
                      <span className={`status ${u.status.toLowerCase()}`}>
                        {u.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>{formatDateTime(u.lastLoginAt)}</td>
                    <td>
                      {manageable ? (
                        <div className="actions">
                          <button
                            type="button"
                            className="btn sm"
                            aria-label={`Edit ${u.name}`}
                            onClick={() => setDialog({ kind: 'edit', user: u })}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn sm"
                            aria-label={`Reset password for ${u.name}`}
                            onClick={() => setDialog({ kind: 'reset', user: u })}
                          >
                            Reset Password
                          </button>
                          <button
                            type="button"
                            className={u.status === 'ACTIVE' ? 'btn sm danger' : 'btn sm success'}
                            aria-label={`${u.status === 'ACTIVE' ? 'Deactivate' : 'Activate'} ${u.name}`}
                            onClick={() => setDialog({ kind: 'status', user: u })}
                          >
                            {u.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      ) : (
                        <span className="v8-sub">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && users.length === 0 ? (
                <tr className="empty-row">
                  <td colSpan={9}>No users match these filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <nav className="v8-pager" aria-label="Pagination">
          <span>
            Showing {from}–{to} of {total}
          </span>
          <div className="pages">
            <button
              type="button"
              className="v8-page"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Prev
            </button>
            {pageWindow(page, pages).map((p) => (
              <button
                type="button"
                key={p}
                className={p === page ? 'v8-page active' : 'v8-page'}
                aria-current={p === page ? 'page' : undefined}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            ))}
            <button
              type="button"
              className="v8-page"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </nav>
      </div>

      {dialog?.kind === 'add' || dialog?.kind === 'edit' ? (
        <UserFormModal
          mode={dialog.kind}
          user={dialog.kind === 'edit' ? dialog.user : undefined}
          roles={roles}
          departments={departments}
          units={units}
          onClose={close}
          onSaved={(u) => {
            close();
            reload();
            toast(
              dialog.kind === 'add' ? `User ${u.loginId} created.` : `User ${u.loginId} updated.`,
            );
          }}
        />
      ) : null}
      {dialog?.kind === 'reset' ? (
        <ResetPasswordModal
          user={dialog.user}
          onClose={close}
          onDone={() => {
            close();
            toast(`Temporary password set for ${dialog.user.loginId}.`);
          }}
        />
      ) : null}
      {dialog?.kind === 'status' ? (
        <StatusConfirmModal
          user={dialog.user}
          onClose={close}
          onSaved={(u) => {
            close();
            reload();
            toast(`${u.loginId} is now ${u.status === 'ACTIVE' ? 'active' : 'inactive'}.`);
          }}
        />
      ) : null}
    </>
  );
}
