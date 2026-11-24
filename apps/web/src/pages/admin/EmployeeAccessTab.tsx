// Employees tab of Permission Master: who holds which role, and in which department. The same list the Users page
// reads (/users), so the role and department shown here are exactly what the permission engine uses for that person.
import { useEffect, useState } from 'react';
import { Pager } from '../../components/Pager';
import { ApiError } from '../../lib/api';
import type { User } from '../../types';
import { listUsers } from '../users/usersApi';

const SIZE = 20;

export function EmployeeAccessTab({ onInspect }: { onInspect: (userId: string) => void }) {
  const [rows, setRows] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [roles, setRoles] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listUsers({ page, size: SIZE, ...(q.trim() ? { q } : {}), ...(role ? { roleId: role } : {}) })
      .then((res) => {
        if (!alive) return;
        setRows(res.users);
        setTotal(res.meta.total ?? res.users.length);
        setError('');
        // the role filter lists every role seen so far, so choosing one never hides the others
        setRoles((prev) => ({
          ...prev,
          ...Object.fromEntries(res.users.map((u) => [u.roleId, u.roleLabel || u.roleName || u.role])),
        }));
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof ApiError ? err.message : 'Could not load employees.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [page, q, role]);

  return (
    <div className="v8-section">
      <div className="toolbar">
        <input
          aria-label="Search employees"
          placeholder="Search name, login ID or email"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Filter by role"
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All roles</option>
          {Object.entries(roles)
            .sort((a, b) => a[1].localeCompare(b[1]))
            .map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
        </select>
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
              <th scope="col">Employee</th>
              <th scope="col">Login ID</th>
              <th scope="col">Role</th>
              <th scope="col">Department</th>
              <th scope="col">Also works in</th>
              <th scope="col">Status</th>
              <th scope="col">Access</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={7}>Loading…</td>
              </tr>
            ) : null}
            {!loading && rows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={7}>No employees match.</td>
              </tr>
            ) : null}
            {rows.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.loginId}</td>
                <td>{u.roleLabel || u.roleName || u.role}</td>
                <td>{u.department ?? '—'}</td>
                <td>{u.extraDepartments?.length ? u.extraDepartments.join(', ') : '—'}</td>
                <td>{u.status}</td>
                <td>
                  <button
                    type="button"
                    className="btn sm"
                    aria-label={`View effective access of ${u.name}`}
                    onClick={() => onInspect(u.id)}
                  >
                    Effective Access
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} size={SIZE} total={total} onPage={setPage} />
    </div>
  );
}
