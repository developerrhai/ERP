// Role Master (admin-roles): read-only list of the five fixed roles (owner decision O-4) with
// level, user count, who may create each role, and a shortcut to its permissions.
import { useNavigate } from 'react-router-dom';
import { useLoad } from '../../lib/useLoad';
import { listRoles, ROLE_CREATED_BY } from './adminApi';

export function RoleMasterPage() {
  const navigate = useNavigate();
  const { data, loading, error } = useLoad(listRoles, []);
  const roles = [...(data ?? [])].sort((a, b) => b.level - a.level);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Role Master</h1>
          <p>The five fixed roles of the authority hierarchy. Roles cannot be added or renamed.</p>
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
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.code}>
                <td>{r.label}</td>
                <td>{r.level}</td>
                <td>{r.userCount}</td>
                <td>{ROLE_CREATED_BY[r.code]}</td>
                <td>
                  {r.code === 'SUPER_ADMIN' ? (
                    <span className="v8-sub">All permissions (owner)</span>
                  ) : (
                    <button
                      type="button"
                      className="btn sm"
                      aria-label={`Permissions for ${r.label}`}
                      onClick={() => navigate(`/m/admin-permissions?role=${r.code}`)}
                    >
                      Permissions
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {loading && !data ? (
              <tr className="empty-row">
                <td colSpan={5}>Loading…</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
