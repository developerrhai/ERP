// Permission Master (admin-permissions): the prototype role × action table with scope and
// per-row Save, per-role family overrides (inherit → allow → deny), and the Department Access tab.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { refreshMenu } from '../../lib/menu';
import { useLoad } from '../../lib/useLoad';
import {
  ACTIONS,
  SCOPES,
  type Action,
  type ActionSet,
  type RolePermissions,
  type Scope,
} from '../../types';
import { getPermissions, roleVersion, savePermissions, type PermissionsData } from './adminApi';
import { DepartmentAccessTab } from './DepartmentAccessTab';
import {
  cellState,
  draftFromRows,
  effective,
  nextState,
  overrideCount,
  rowsFromDraft,
  withCell,
  withStar,
  type RoleDraft,
} from './permissionModel';

type EditableRole = RolePermissions['role'];

export const ROLE_LABEL: Record<EditableRole | 'SUPER_ADMIN', string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  LEAD: 'Lead',
  MEMBER: 'Member',
};

const ACTION_LABEL: Record<Action, string> = {
  view: 'View',
  add: 'Add',
  edit: 'Edit',
  delete: 'Delete',
  approve: 'Approve',
  export: 'Export',
  controls: 'Controls',
};

export const NOT_EDITABLE_TITLE = 'You can only change the permissions of roles below your own.';
export const ADMIN_CONTROLS_TITLE = "An Admin's Controls permission is protected and stays on.";

export function PermissionMasterPage({ actions }: { actions: ActionSet }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'access' ? 'access' : 'roles';
  const setTab = (next: 'roles' | 'access'): void => {
    const p = new URLSearchParams(params);
    if (next === 'access') p.set('tab', 'access');
    else p.delete('tab');
    setParams(p, { replace: true });
  };
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Permission Master</h1>
          <p>Configure role action rights and scope.</p>
        </div>
      </div>
      <div className="v9-subtabs" role="tablist" aria-label="Permission Master sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'roles'}
          className={tab === 'roles' ? 'v9-subtab active' : 'v9-subtab'}
          onClick={() => setTab('roles')}
        >
          Role Permissions
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'access'}
          className={tab === 'access' ? 'v9-subtab active' : 'v9-subtab'}
          onClick={() => setTab('access')}
        >
          Department Access
        </button>
      </div>
      {tab === 'roles' ? (
        <RolePermissionsTab focusRole={params.get('role')} />
      ) : (
        <DepartmentAccessTab canEdit={actions.controls} />
      )}
    </>
  );
}

function RolePermissionsTab({ focusRole }: { focusRole: string | null }) {
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(getPermissions, []);
  const [drafts, setDrafts] = useState<Partial<Record<EditableRole, RoleDraft>>>({});
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(focusRole && focusRole !== 'SUPER_ADMIN' ? [focusRole] : []),
  );
  const [saving, setSaving] = useState<EditableRole | null>(null);
  const [rowError, setRowError] = useState<Partial<Record<EditableRole, string>>>({});

  const originals = useMemo(() => buildDrafts(data), [data]);
  useEffect(() => setDrafts(originals), [originals]);

  const update = (role: EditableRole, fn: (d: RoleDraft) => RoleDraft): void => {
    setDrafts((prev) => {
      const cur = prev[role];
      return cur ? { ...prev, [role]: fn(cur) } : prev;
    });
  };

  const save = async (block: RolePermissions): Promise<void> => {
    const draft = drafts[block.role];
    if (!draft || saving) return;
    setSaving(block.role);
    setRowError((e) => ({ ...e, [block.role]: undefined }));
    try {
      await savePermissions(block.role, roleVersion(block.rows), rowsFromDraft(draft));
      toast(`${ROLE_LABEL[block.role]} permissions saved.`);
      reload();
      void refreshMenu();
    } catch (err) {
      setRowError((e) => ({ ...e, [block.role]: toUiError(err).message }));
    } finally {
      setSaving(null);
    }
  };

  const families = data?.families ?? [];
  const blocks = data?.roles ?? [];
  const errors = blocks.filter((b) => rowError[b.role]);

  return (
    <>
      {error ? (
        <div className="msg error show static" role="alert">
          {error}
        </div>
      ) : null}
      {errors.map((b) => (
        <div className="msg error show static" role="alert" key={b.role}>
          {ROLE_LABEL[b.role]}: {rowError[b.role]}
        </div>
      ))}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Role</th>
              <th scope="col">Scope</th>
              {ACTIONS.map((a) => (
                <th scope="col" key={a}>
                  {ACTION_LABEL[a]}
                </th>
              ))}
              <th scope="col">Save</th>
            </tr>
          </thead>
          <tbody>
            <tr className="perm-locked">
              <td>Super Admin</td>
              <td>ALL</td>
              {ACTIONS.map((a) => (
                <td key={a}>
                  <input
                    type="checkbox"
                    checked
                    disabled
                    aria-label={`Super Admin ${ACTION_LABEL[a]}`}
                    title="The owner always has every permission."
                  />
                </td>
              ))}
              <td>
                <span className="v8-sub">All permissions (owner)</span>
              </td>
            </tr>
            {blocks.map((block) => {
              const draft = drafts[block.role];
              if (!draft) return null;
              const label = ROLE_LABEL[block.role];
              const locked = !block.editable;
              const dirty = isDirty(draft, originals[block.role]);
              return (
                <tr
                  key={block.role}
                  className={focusRole === block.role ? 'perm-focus' : undefined}
                  title={locked ? NOT_EDITABLE_TITLE : undefined}
                >
                  <td>{label}</td>
                  <td>
                    <select
                      className="perm-scope"
                      aria-label={`${label} scope`}
                      value={draft.star.scope}
                      disabled={locked}
                      onChange={(e) =>
                        update(block.role, (d) => withStar(d, { scope: e.target.value as Scope }))
                      }
                    >
                      {SCOPES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  {ACTIONS.map((a) => {
                    const adminControls = block.role === 'ADMIN' && a === 'controls';
                    return (
                      <td key={a}>
                        <input
                          type="checkbox"
                          aria-label={`${label} ${ACTION_LABEL[a]}`}
                          checked={adminControls ? true : draft.star[a]}
                          disabled={locked || adminControls}
                          title={
                            adminControls
                              ? ADMIN_CONTROLS_TITLE
                              : locked
                                ? NOT_EDITABLE_TITLE
                                : undefined
                          }
                          onChange={(e) =>
                            update(block.role, (d) => withStar(d, { [a]: e.target.checked }))
                          }
                        />
                      </td>
                    );
                  })}
                  <td>
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Save ${label}`}
                      disabled={locked || !dirty || saving !== null}
                      title={locked ? NOT_EDITABLE_TITLE : undefined}
                      onClick={() => void save(block)}
                    >
                      {saving === block.role ? 'Saving…' : 'Save'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {loading && !data ? (
              <tr className="empty-row">
                <td colSpan={ACTIONS.length + 3}>Loading…</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="v8-section perm-overrides">
        <div className="v8-titlebar">
          <h3>Family overrides</h3>
          <span className="v8-sub">
            Grey cells inherit the role default above; blue cells override it for that family. Click
            a cell to cycle inherit → allow → deny.
          </span>
        </div>
        {blocks.map((block) => {
          const draft = drafts[block.role];
          if (!draft) return null;
          const label = ROLE_LABEL[block.role];
          const isOpen = open.has(block.role);
          const locked = !block.editable;
          const panelId = `ovr-${block.role}`;
          return (
            <div className="card perm-family" key={block.role}>
              <button
                type="button"
                className="perm-family-head"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(block.role)) next.delete(block.role);
                    else next.add(block.role);
                    return next;
                  })
                }
              >
                <span>
                  {label} — {overrideCount(draft)} override{overrideCount(draft) === 1 ? '' : 's'}
                </span>
                <span aria-hidden="true">{isOpen ? '⌃' : '⌄'}</span>
              </button>
              {isOpen ? (
                <div id={panelId}>
                  <div className="table-wrap">
                    <table className="perm-grid">
                      <thead>
                        <tr>
                          <th scope="col">Family</th>
                          {ACTIONS.map((a) => (
                            <th scope="col" key={a}>
                              {ACTION_LABEL[a]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {families.map((fam) => (
                          <tr key={fam}>
                            <td>{fam}</td>
                            {ACTIONS.map((a) => {
                              const state = cellState(draft, fam, a);
                              const value = effective(draft, fam, a);
                              const text = `${label} ${fam} ${ACTION_LABEL[a]}: ${
                                state === 'inherit'
                                  ? `inherited (${value ? 'allowed' : 'denied'})`
                                  : state === 'allow'
                                    ? 'allowed'
                                    : 'denied'
                              }`;
                              return (
                                <td key={a}>
                                  <button
                                    type="button"
                                    className={`perm-cell ${state}${value ? ' on' : ''}`}
                                    aria-label={text}
                                    title={locked ? NOT_EDITABLE_TITLE : text}
                                    disabled={locked}
                                    onClick={() =>
                                      update(block.role, (d) =>
                                        withCell(d, fam, a, nextState(state)),
                                      )
                                    }
                                  >
                                    {value ? '✓' : '✕'}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="perm-family-foot">
                    <button
                      type="button"
                      className="btn"
                      disabled={locked || saving !== null}
                      onClick={() => {
                        const orig = originals[block.role];
                        if (orig) setDrafts((p) => ({ ...p, [block.role]: orig }));
                      }}
                    >
                      Discard changes
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={locked || !isDirty(draft, originals[block.role]) || saving !== null}
                      onClick={() => void save(block)}
                    >
                      {saving === block.role ? 'Saving…' : `Save all ${label} changes`}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

function buildDrafts(data: PermissionsData | null): Partial<Record<EditableRole, RoleDraft>> {
  const out: Partial<Record<EditableRole, RoleDraft>> = {};
  for (const block of data?.roles ?? []) out[block.role] = draftFromRows(block.rows);
  return out;
}

function isDirty(draft: RoleDraft, original: RoleDraft | undefined): boolean {
  if (!original) return false;
  return JSON.stringify(rowsFromDraft(draft)) !== JSON.stringify(rowsFromDraft(original));
}
