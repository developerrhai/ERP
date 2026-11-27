// Effective Access drawer (Phase 02 §7): shows the 12-action matrix and plain-words
// reasons for a user, with family filter and click-to-explain.
import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import { ACTIONS, type Action, type EffectiveAccessPage, type User } from '../../types';
import { getEffectiveAccess } from '../admin/adminApi';

interface Props {
  user: User;
  onClose: () => void;
}

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

export function EffectiveAccessDrawer({ user, onClose }: Props) {
  const [pages, setPages] = useState<EffectiveAccessPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [family, setFamily] = useState('');
  const [selectedPage, setSelectedPage] = useState<EffectiveAccessPage | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getEffectiveAccess(user.id, family || undefined)
      .then((res) => {
        if (!alive) return;
        setPages(res.pages ?? []);
        setError('');
      })
      .catch((err: unknown) => {
        if (alive)
          setError(err instanceof ApiError ? err.message : 'Could not load effective access.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [user.id, family]);

  const families = Array.from(new Set(pages.map((p) => p.family))).sort();

  return (
    <div
      className="drawer-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="eff-title"
    >
      <div
        className="drawer x-maxw-960px x-w-90vw"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <div>
            <h2 id="eff-title">Check Access — {user.name}</h2>
            <p className="v8-sub">
              Role: <strong>{user.roleLabel || user.roleName || user.role}</strong> (Level{' '}
              {user.roleLevel ?? 10}) · Home Dept: <strong>{user.department ?? '—'}</strong>
              {user.extraDepartments && user.extraDepartments.length > 0 ? (
                <> · Also works in: {user.extraDepartments.join(', ')}</>
              ) : null}
            </p>
          </div>
          <button type="button" className="btn sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="drawer-body">
          <div className="v8-table-toolbar x-mb-12px">
            <label htmlFor="eff-family-select" className="x-mr-8px x-fs-13px">
              Filter Family:
            </label>
            <select
              id="eff-family-select"
              value={family}
              onChange={(e) => setFamily(e.target.value)}
              className="x-w-220px"
            >
              <option value="">All Families</option>
              {families.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <span className="v8-spacer" />
            <span className="v8-sub">
              {loading ? 'Calculating…' : `${pages.length} page${pages.length === 1 ? '' : 's'}`}
            </span>
          </div>

          {error ? (
            <div className="msg error show static" role="alert">
              {error}
            </div>
          ) : null}

          {selectedPage ? (
            <div
              className="card x-mb-16px x-bg-var-bg-subtle-hf8f9fa x-p-12px"
            >
              <div
                className="x-d-flex x-jc-space-between x-ai-center"
              >
                <h4 className="x-m-0">
                  Decision for: <strong>{selectedPage.title}</strong> ({selectedPage.family}) —
                  Scope: <strong>{selectedPage.scope}</strong>
                </h4>
                <button type="button" className="btn sm" onClick={() => setSelectedPage(null)}>
                  Hide details
                </button>
              </div>
              <ul className="x-m-8px-0-0-16px x-p-0 x-fs-13px x-lh-1_6">
                {selectedPage.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="table-wrap x-maxh-60vh x-ovy-auto">
            <table>
              <thead>
                <tr>
                  <th scope="col">Page</th>
                  <th scope="col">Scope</th>
                  {ACTIONS.map((a) => (
                    <th scope="col" key={a} style={{ textAlign: 'center', minWidth: '40px' }}>
                      {ACTION_SHORT[a]}
                    </th>
                  ))}
                  <th scope="col">Why?</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => (
                  <tr key={p.pageId}>
                    <td>
                      <div>
                        <strong>{p.title}</strong>
                        <div className="v8-sub" style={{ fontSize: '11px' }}>
                          {p.family}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="badge sm">{p.scope}</span>
                    </td>
                    {ACTIONS.map((a) => {
                      const allowed = p.actions[a];
                      return (
                        <td key={a} style={{ textAlign: 'center' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              color: allowed
                                ? 'var(--color-success, #2e7d32)'
                                : 'var(--color-danger, #d32f2f)',
                              fontWeight: 'bold',
                            }}
                          >
                            {allowed ? '✓' : '✕'}
                          </span>
                        </td>
                      );
                    })}
                    <td>
                      <button
                        type="button"
                        className="btn sm"
                        style={{ padding: '2px 8px', fontSize: '11px' }}
                        onClick={() => setSelectedPage(p)}
                      >
                        Reasons
                      </button>
                    </td>
                  </tr>
                ))}
                {loading && pages.length === 0 ? (
                  <tr className="empty-row">
                    <td colSpan={ACTIONS.length + 3}>Calculating effective permissions…</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="drawer-foot">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
