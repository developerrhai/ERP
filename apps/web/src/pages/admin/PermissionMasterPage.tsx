// Permission Master (admin-permissions): the role × action table with scope and
// per-row Save, per-role family overrides (inherit → allow → deny), Department Access tab,
// and Effective Access viewer tab (Phase 02 §2, §7).
import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ErrorMessage } from '../../components/ErrorMessage';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { refreshMenu } from '../../lib/menu';
import { useUnsavedGuard } from '../../lib/unsaved';
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
import { EffectiveAccessTab } from './EffectiveAccessTab';
import {
  cellState,
  draftFromRows,
  effective,
  nextState,
  overrideCount,
  changedOverrideCells,
  rowsFromDraft,
  withCell,
  withStar,
  type RoleDraft,
} from './permissionModel';

export const ROLE_LABEL: Record<string, string> = {
  SUPER_USER: 'Super User',
  SUPER_ADMIN: 'Super Admin',
  ADMINISTRATOR: 'Administrator',
  ADMIN: 'Admin',
  DIRECTOR: 'Director',
  CFO: 'CFO',
  GENERAL_MANAGER: 'General Manager',
  DEPT_HEAD: 'Department Head',
  DEPT_MANAGER: 'Department Manager',
  MANAGER: 'Manager',
  SUPERVISOR: 'Supervisor',
  LEAD: 'Lead',
  EMPLOYEE: 'Employee',
  MEMBER: 'Member',
};

function roleLabelOf(block: RolePermissions): string {
  if (block.name) return block.name;
  if (block.role && ROLE_LABEL[block.role]) return ROLE_LABEL[block.role] as string;
  if (block.code && ROLE_LABEL[block.code]) return ROLE_LABEL[block.code] as string;
  return block.code || block.role || block.roleId || 'Role';
}

const ACTION_LABEL: Record<Action, string> = {
  view: 'View',
  add: 'Add',
  edit: 'Edit',
  delete: 'Delete',
  approve: 'Approve',
  export: 'Export',
  controls: 'Controls',
  submit: 'Submit',
  post: 'Post',
  cancel: 'Cancel',
  print: 'Print',
  import: 'Import',
};

export const NOT_EDITABLE_TITLE = 'You can only change the permissions of roles below your own.';
export const ADMIN_CONTROLS_TITLE = "An Admin's Controls permission is protected and stays on.";

export function PermissionMasterPage({ actions }: { actions: ActionSet }) {
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab');
  const tab: 'roles' | 'access' | 'effective' =
    rawTab === 'access' ? 'access' : rawTab === 'effective' ? 'effective' : 'roles';

  const setTab = (next: 'roles' | 'access' | 'effective'): void => {
    const p = new URLSearchParams(params);
    if (next === 'roles') p.delete('tab');
    else p.set('tab', next);
    setParams(p, { replace: true });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Permission Master</h1>
          <p>Configure role action rights, scopes, and effective access drilldown.</p>
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
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'effective'}
          className={tab === 'effective' ? 'v9-subtab active' : 'v9-subtab'}
          onClick={() => setTab('effective')}
        >
          Effective Access
        </button>
      </div>
      {tab === 'roles' ? (
        <RolePermissionsTab focusRole={params.get('role')} />
      ) : tab === 'access' ? (
        <DepartmentAccessTab canEdit={actions.controls} />
      ) : (
        <EffectiveAccessTab />
      )}
    </>
  );
}

function RolePermissionsTab({ focusRole }: { focusRole: string | null }) {
  const toast = useToast();
  const { data, loading, error, reload, setData } = useLoad(getPermissions, []);
  // Only roles with unsaved edits live here; the rest read straight from the server data
  const [drafts, setDrafts] = useState<Record<string, RoleDraft>>({});
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(focusRole && focusRole !== 'SUPER_ADMIN' && focusRole !== 'SUPER_USER' ? [focusRole] : []),
  );
  const [saving, setSaving] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, { message: string; conflict: boolean } | undefined>>({});

  const originals = useMemo(() => buildDrafts(data), [data]);
  const originalsRef = useRef(originals);
  originalsRef.current = originals;
  const draftFor = (roleKey: string): RoleDraft | undefined => drafts[roleKey] ?? originals[roleKey];

  useUnsavedGuard(
    Object.keys(drafts).some((roleKey) => {
      const d = drafts[roleKey];
      return !!d && isDirty(d, originals[roleKey]);
    }),
  );

  const dropDraft = (roleKey: string): void =>
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[roleKey];
      return next;
    });

  const update = (roleKey: string, fn: (d: RoleDraft) => RoleDraft): void => {
    setDrafts((prev) => {
      const cur = prev[roleKey] ?? originalsRef.current[roleKey];
      return cur ? { ...prev, [roleKey]: fn(cur) } : prev;
    });
  };

  const keyOf = (block: RolePermissions): string =>
    block.roleId || block.role || block.code || '';

  const save = async (block: RolePermissions): Promise<void> => {
    const key = keyOf(block);
    const draft = draftFor(key);
    if (!draft || saving) return;
    setSaving(key);
    setRowError((e) => ({ ...e, [key]: undefined }));
    const label = roleLabelOf(block);
    try {
      await savePermissions(key, roleVersion(block.rows), rowsFromDraft(draft));
      toast(`${label} permissions saved.`);
      dropDraft(key);
      reload();
      void refreshMenu();
    } catch (err) {
      const ui = toUiError(err);
      setRowError((e) => ({
        ...e,
        [key]: { message: ui.message, conflict: ui.code === 'VERSION_CONFLICT' },
      }));
    } finally {
      setSaving(null);
    }
  };

  /** VERSION_CONFLICT: refetch and replace only this role's rows */
  const reloadRole = async (block: RolePermissions): Promise<void> => {
    const key = keyOf(block);
    try {
      const fresh = await getPermissions();
      const freshBlock = fresh.roles.find((r) => keyOf(r) === key);
      setData((prev) =>
        prev && freshBlock
          ? { ...prev, roles: prev.roles.map((r) => (keyOf(r) === key ? freshBlock : r)) }
          : prev,
      );
      dropDraft(key);
      setRowError((e) => ({ ...e, [key]: undefined }));
    } catch (err) {
      setRowError((e) => ({ ...e, [key]: { message: toUiError(err).message, conflict: false } }));
    }
  };

  const families = data?.families ?? [];
  const blocks = data?.roles ?? [];
  const errors = blocks.filter((b) => rowError[keyOf(b)]);

  return (
    <>
      {error ? (
        <div className="msg error show static" role="alert">
          {error}
        </div>
      ) : null}
      {errors.map((b) => {
        const key = keyOf(b);
        const label = roleLabelOf(b);
        return (
          <ErrorMessage
            key={key}
            onReload={rowError[key]?.conflict ? () => void reloadRole(b) : undefined}
            reloadLabel={`Reload ${label}`}
          >
            {label}: {rowError[key]?.message}
          </ErrorMessage>
        );
      })}
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
              const key = keyOf(block);
              const draft = draftFor(key);
              if (!draft) return null;
              const label = roleLabelOf(block);
              const locked = !block.editable;
              const dirty = isDirty(draft, originals[key]);
              const pendingOverrides = changedOverrideCells(draft, originals[key]);
              const noteId = `perm-note-${key}`;
              return (
                <tr
                  key={key}
                  className={focusRole === key || focusRole === block.role || focusRole === block.code ? 'perm-focus' : undefined}
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
                        update(key, (d) => withStar(d, { scope: e.target.value as Scope }))
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
                    const adminControls =
                      (block.role === 'ADMIN' || block.code === 'ADMINISTRATOR') && a === 'controls';
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
                            update(key, (d) => withStar(d, { [a]: e.target.checked }))
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
                      aria-describedby={pendingOverrides ? noteId : undefined}
                      disabled={locked || !dirty || saving !== null}
                      title={locked ? NOT_EDITABLE_TITLE : undefined}
                      onClick={() => void save(block)}
                    >
                      {saving === key ? 'Saving…' : 'Save'}
                    </button>
                    {pendingOverrides ? (
                      <small className="perm-note" id={noteId}>
                        includes {pendingOverrides} unsaved family override
                        {pendingOverrides === 1 ? '' : 's'}
                      </small>
                    ) : null}
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
          const key = keyOf(block);
          const draft = draftFor(key);
          if (!draft) return null;
          const label = roleLabelOf(block);
          const isOpen = open.has(key) || (!!block.role && open.has(block.role)) || (!!block.code && open.has(block.code));
          const locked = !block.editable;
          const panelId = `ovr-${key}`;
          return (
            <div className="card perm-family" key={key}>
              <button
                type="button"
                className="perm-family-head"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
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
                                      update(key, (d) =>
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
                        dropDraft(key);
                      }}
                    >
                      Discard changes
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={locked || !isDirty(draft, originals[key]) || saving !== null}
                      onClick={() => void save(block)}
                    >
                      {saving === key ? 'Saving…' : `Save all ${label} changes`}
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

function buildDrafts(data: PermissionsData | null): Record<string, RoleDraft> {
  const out: Record<string, RoleDraft> = {};
  for (const block of data?.roles ?? []) {
    const key = block.roleId || block.role || block.code;
    if (key) {
      out[key] = draftFromRows(block.rows);
    }
  }
  return out;
}

function isDirty(draft: RoleDraft, original: RoleDraft | undefined): boolean {
  if (!original) return false;
  return JSON.stringify(rowsFromDraft(draft)) !== JSON.stringify(rowsFromDraft(original));
}
