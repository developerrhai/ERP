// Effective Access Tab (Phase 02 §2): pick a user and inspect resolved rights
// across all pages with 12 actions, scope, and plain-words decision reasons.
import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import { ACTIONS, type Action, type EffectiveAccessPage, type User } from '../../types';
import { listUsers } from '../users/usersApi';
import { getEffectiveAccess } from './adminApi';

const ACTION_SHORT: Record<Action, string> = {
  view: 'View',
  add: 'Add',
  edit: 'Edit',
  delete: 'Del',
  approve: 'Appr',
  export: 'Exp',
  controls: 'Ctrl',
  submit: 'Sub',
  post: 'Post',
  cancel: 'Canc',
  print: 'Prnt',
  import: 'Imp',
};

export function EffectiveAccessTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [family, setFamily] = useState<string>('');
  const [pages, setPages] = useState<EffectiveAccessPage[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [error, setError] = useState('');
  const [selectedPage, setSelectedPage] = useState<EffectiveAccessPage | null>(null);

  useEffect(() => {
    let alive = true;
    listUsers({ page: 1, size: 100 })
      .then((res) => {
        if (!alive) return;
        setUsers(res.users);
        if (res.users.length > 0 && res.users[0] && !selectedUserId) {
          const first = res.users[0];
          setSelectedUserId(first.id);
          setSelectedUser(first);
        }
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof ApiError ? err.message : 'Could not load users list.');
      })
      .finally(() => {
        if (alive) setLoadingUsers(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleUserChange = (id: string) => {
    setSelectedUserId(id);
    const u = users.find((user) => user.id === id) || null;
    setSelectedUser(u);
    setSelectedPage(null);
  };

  useEffect(() => {
    if (!selectedUserId) return;
    let alive = true;
    setLoadingAccess(true);
    getEffectiveAccess(selectedUserId, family || undefined)
      .then((res) => {
        if (!alive) return;
        setPages(res.pages ?? []);
        setError('');
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof ApiError ? err.message : 'Could not calculate effective access.');
      })
      .finally(() => {
        if (alive) setLoadingAccess(false);
      });
    return () => {
      alive = false;
    };
  }, [selectedUserId, family]);

  const families = Array.from(new Set(pages.map((p) => p.family))).sort();

  return (
    <div className="v8-section">
      <div className="card" style={{ marginBottom: '16px', padding: '16px' }}>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ margin: 0, minWidth: '240px' }}>
            <label htmlFor="eff-tab-user-select">Select User</label>
            <select
              id="eff-tab-user-select"
              value={selectedUserId}
              disabled={loadingUsers}
              onChange={(e) => handleUserChange(e.target.value)}
            >
              {loadingUsers ? <option>Loading users…</option> : null}
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.loginId} · {u.roleLabel || u.role})
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0, minWidth: '200px' }}>
            <label htmlFor="eff-tab-family-select">Filter by Family</label>
            <select
              id="eff-tab-family-select"
              value={family}
              onChange={(e) => setFamily(e.target.value)}
            >
              <option value="">All Families</option>
              {families.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          {selectedUser ? (
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', paddingBottom: '6px' }}>
              Role: <strong>{selectedUser.roleLabel || selectedUser.role}</strong> (Level {selectedUser.roleLevel ?? 10}) · Dept: <strong>{selectedUser.department ?? '—'}</strong>
              {selectedUser.extraDepartments && selectedUser.extraDepartments.length > 0 ? (
                <> · Also works in: {selectedUser.extraDepartments.join(', ')}</>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="msg error show static" role="alert" style={{ marginBottom: '16px' }}>
          {error}
        </div>
      ) : null}

      {selectedPage ? (
        <div className="card" style={{ marginBottom: '16px', background: 'var(--surface-sunken)', padding: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h4 style={{ margin: 0 }}>
              Decision Reasons: <strong>{selectedPage.title}</strong> ({selectedPage.family})
            </h4>
            <button
              type="button"
              className="btn sm"
              onClick={() => setSelectedPage(null)}
              aria-label="Dismiss reason drilldown"
            >
              Dismiss
            </button>
          </div>
          <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--text-muted)' }}>
            Data Scope: <strong>{selectedPage.scope}</strong>
          </p>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px' }}>
            {selectedPage.reasons && selectedPage.reasons.length > 0 ? (
              selectedPage.reasons.map((r, i) => <li key={i}>{r}</li>)
            ) : (
              <li>No specific overrides; standard defaults apply.</li>
            )}
          </ul>
        </div>
      ) : null}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Page</th>
              <th scope="col">Family</th>
              <th scope="col">Scope</th>
              {ACTIONS.map((a) => (
                <th scope="col" key={a} style={{ textAlign: 'center', minWidth: '40px' }} title={a}>
                  {ACTION_SHORT[a]}
                </th>
              ))}
              <th scope="col">Decision</th>
            </tr>
          </thead>
          <tbody>
            {loadingAccess ? (
              <tr className="empty-row">
                <td colSpan={ACTIONS.length + 4}>Calculating effective rights…</td>
              </tr>
            ) : pages.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={ACTIONS.length + 4}>No pages found.</td>
              </tr>
            ) : (
              pages.map((p) => {
                const isSelected = selectedPage?.pageId === p.pageId;
                return (
                  <tr
                    key={p.pageId}
                    style={{ background: isSelected ? 'var(--selection-bg, #edf2f7)' : undefined }}
                  >
                    <td>
                      <div style={{ fontWeight: 500 }}>{p.title}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        <code>{p.pageId}</code>
                      </div>
                    </td>
                    <td>{p.family}</td>
                    <td>
                      <span className="badge chip sm" style={{ fontSize: '11px' }}>
                        {p.scope}
                      </span>
                    </td>
                    {ACTIONS.map((a) => {
                      const allowed = p.actions[a] === true;
                      return (
                        <td key={a} style={{ textAlign: 'center' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              width: '18px',
                              height: '18px',
                              borderRadius: '50%',
                              lineHeight: '18px',
                              fontSize: '11px',
                              fontWeight: 'bold',
                              background: allowed ? 'var(--success-bg, #c6f6d5)' : 'var(--danger-bg, #fed7d7)',
                              color: allowed ? 'var(--success-fg, #22543d)' : 'var(--danger-fg, #742a2a)',
                            }}
                          >
                            {allowed ? '✓' : '—'}
                          </span>
                        </td>
                      );
                    })}
                    <td>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => setSelectedPage(p)}
                        aria-label={`View reason for ${p.title}`}
                      >
                        Explain
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
