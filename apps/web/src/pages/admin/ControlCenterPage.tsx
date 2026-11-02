// System Control Center (/m/admin-settings/controls): the prototype per-module control table
// (owner department, enabled, approval, add/edit/delete/export) with family filter, search and
// Save per row; Administration modules cannot be disabled; saves refresh the sidebar.
// Unsaved edits are kept per row and survive saves of other rows and filter/search changes.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorMessage } from '../../components/ErrorMessage';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { refreshMenu } from '../../lib/menu';
import { registry } from '../../lib/registry';
import { useUnsavedGuard } from '../../lib/unsaved';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet, ModuleControl } from '../../types';
import {
  activeDepartmentNames,
  listModuleControls,
  updateModuleControl,
  type ModuleControlPatch,
} from './adminApi';

const PROTECTED_FAMILY = 'Administration';

type Flag =
  | 'enabled'
  | 'approvalRequired'
  | 'allowAdd'
  | 'allowEdit'
  | 'allowDelete'
  | 'allowExport';
const FLAGS: readonly { key: Flag; label: string }[] = [
  { key: 'enabled', label: 'Enabled' },
  { key: 'approvalRequired', label: 'Approval' },
  { key: 'allowAdd', label: 'Add' },
  { key: 'allowEdit', label: 'Edit' },
  { key: 'allowDelete', label: 'Delete' },
  { key: 'allowExport', label: 'Export' },
];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function diffControl(draft: ModuleControl, original: ModuleControl): ModuleControlPatch {
  const patch: ModuleControlPatch = {};
  if (draft.ownerDepartment !== original.ownerDepartment)
    patch.ownerDepartment = draft.ownerDepartment;
  for (const { key } of FLAGS) if (draft[key] !== original[key]) patch[key] = draft[key];
  return patch;
}

/** Adds `change` to a row's pending edits, dropping fields that are back at the server value. */
export function mergeEdit(
  current: ModuleControlPatch | undefined,
  change: ModuleControlPatch,
  server: ModuleControl,
): ModuleControlPatch | undefined {
  const merged = diffControl({ ...server, ...current, ...change }, server);
  return Object.keys(merged).length ? merged : undefined;
}

function without<T>(map: Record<string, T>, key: string): Record<string, T> {
  const next = { ...map };
  delete next[key];
  return next;
}

interface RowError {
  pageId: string;
  title: string;
  message: string;
  conflict: boolean;
}

export function ControlCenterPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [family, setFamily] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 300);
  const { data, loading, error, setData } = useLoad(
    () => listModuleControls(family, q),
    [family, q],
  );
  const departments = useLoad(activeDepartmentNames, []);
  // pageId → only the fields changed from the server row. Kept across saves of other rows and
  // across filter/search changes (decision: keep drafts rather than prompt to discard).
  const [edits, setEdits] = useState<Record<string, ModuleControlPatch>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [rowError, setRowError] = useState<RowError | null>(null);
  const canEdit = actions.controls;

  const rows = data ?? [];
  const visibleIds = new Set(rows.map((r) => r.pageId));
  const dirtyCount = Object.keys(edits).length;
  useUnsavedGuard(dirtyCount > 0);
  const hiddenDirty = Object.keys(edits).filter((id) => !visibleIds.has(id)).length;

  const set = (row: ModuleControl, change: ModuleControlPatch): void => {
    setEdits((prev) => {
      const merged = mergeEdit(prev[row.pageId], change, row);
      return merged ? { ...prev, [row.pageId]: merged } : without(prev, row.pageId);
    });
  };

  const replaceRow = (saved: ModuleControl): void => {
    setData((prev) => (prev ?? []).map((r) => (r.pageId === saved.pageId ? saved : r)));
  };

  const save = async (row: ModuleControl): Promise<void> => {
    const patch = edits[row.pageId];
    if (!patch || saving) return;
    setSaving(row.pageId);
    setRowError(null);
    try {
      const saved = await updateModuleControl(row.pageId, row.version, patch);
      replaceRow(saved);
      setEdits((prev) => without(prev, row.pageId));
      toast(`${saved.title} saved.`);
      void refreshMenu();
    } catch (err) {
      const ui = toUiError(err);
      setRowError({
        pageId: row.pageId,
        title: row.title,
        message: ui.message,
        conflict: ui.code === 'VERSION_CONFLICT',
      });
    } finally {
      setSaving(null);
    }
  };

  /** VERSION_CONFLICT: refetch just this row and drop its stale edit; other drafts stay. */
  const reloadRow = async (target: RowError): Promise<void> => {
    try {
      const fresh = (await listModuleControls('', target.title)).find(
        (r) => r.pageId === target.pageId,
      );
      if (fresh) replaceRow(fresh);
      setEdits((prev) => without(prev, target.pageId));
      setRowError(null);
    } catch (err) {
      setRowError({ ...target, message: toUiError(err).message, conflict: false });
    }
  };

  const deptOptions = (current: string): string[] => {
    const names = departments.data ?? [];
    return names.includes(current) ? names : [current, ...names];
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>System Control Center</h1>
          <p>Configure every ERP module from one control table.</p>
        </div>
        <div className="actions">
          <Link className="btn" to="/m/admin-settings">
            ← System Setup
          </Link>
        </div>
      </div>
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      {rowError ? (
        <ErrorMessage onReload={rowError.conflict ? () => void reloadRow(rowError) : undefined}>
          {rowError.title}: {rowError.message}
        </ErrorMessage>
      ) : null}
      {dirtyCount ? (
        <div className="msg info show static" role="status">
          {dirtyCount} unsaved change{dirtyCount === 1 ? '' : 's'}
          {hiddenDirty ? ` (${hiddenDirty} hidden by the current filter)` : ''}. Save each row to
          apply it.
        </div>
      ) : null}
      <div className="card">
        <div className="v8-table-toolbar">
          <select
            aria-label="Filter by family"
            value={family}
            onChange={(e) => setFamily(e.target.value)}
          >
            <option value="">All Families</option>
            {registry.families.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
          <input
            type="search"
            placeholder="Search modules..."
            aria-label="Search modules"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="v8-spacer" />
          <span className="v8-sub" aria-live="polite">
            {loading ? 'Loading…' : `${rows.length} modules`}
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Family</th>
                <th scope="col">Module</th>
                <th scope="col">Owner Department</th>
                {FLAGS.map((f) => (
                  <th scope="col" key={f.key}>
                    {f.label}
                  </th>
                ))}
                <th scope="col">Save</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const pending = edits[row.pageId];
                const draft = { ...row, ...pending };
                return (
                  <tr key={row.pageId} className={pending ? 'row-dirty' : undefined}>
                    <td>{row.family}</td>
                    <td>{row.title}</td>
                    <td>
                      <select
                        className="ctrl-select"
                        aria-label={`${row.title} owner department`}
                        value={draft.ownerDepartment}
                        disabled={!canEdit}
                        onChange={(e) => set(row, { ownerDepartment: e.target.value })}
                      >
                        {deptOptions(draft.ownerDepartment).map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </td>
                    {FLAGS.map((f) => {
                      const protectedCell = f.key === 'enabled' && row.family === PROTECTED_FAMILY;
                      return (
                        <td key={f.key}>
                          <input
                            type="checkbox"
                            aria-label={`${row.title} ${f.label}`}
                            checked={draft[f.key]}
                            disabled={!canEdit || protectedCell}
                            title={
                              protectedCell
                                ? 'Administration modules cannot be disabled.'
                                : undefined
                            }
                            onChange={(e) => set(row, { [f.key]: e.target.checked })}
                          />
                        </td>
                      );
                    })}
                    <td>
                      <button
                        type="button"
                        className="btn"
                        aria-label={`Save ${row.title}`}
                        disabled={!canEdit || !pending || saving !== null}
                        onClick={() => void save(row)}
                      >
                        {saving === row.pageId ? 'Saving…' : 'Save'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!loading && data && data.length === 0 ? (
                <tr className="empty-row">
                  <td colSpan={FLAGS.length + 4}>No modules match.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
