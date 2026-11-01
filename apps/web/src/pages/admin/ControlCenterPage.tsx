// System Control Center (/m/admin-settings/controls): the prototype per-module control table
// (owner department, enabled, approval, add/edit/delete/export) with family filter, search and
// Save per row; Administration modules cannot be disabled; saves refresh the sidebar.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { refreshMenu } from '../../lib/menu';
import { registry } from '../../lib/registry';
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
  const [drafts, setDrafts] = useState<Record<string, ModuleControl>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ title: string; message: string } | null>(null);
  const canEdit = actions.controls;

  const originals = useMemo(() => {
    const m: Record<string, ModuleControl> = {};
    for (const r of data ?? []) m[r.pageId] = r;
    return m;
  }, [data]);
  useEffect(() => setDrafts(originals), [originals]);

  const set = (pageId: string, patch: Partial<ModuleControl>): void => {
    setDrafts((prev) => {
      const cur = prev[pageId];
      return cur ? { ...prev, [pageId]: { ...cur, ...patch } } : prev;
    });
  };

  const save = async (pageId: string): Promise<void> => {
    const draft = drafts[pageId];
    const original = originals[pageId];
    if (!draft || !original || saving) return;
    const patch = diffControl(draft, original);
    if (Object.keys(patch).length === 0) return;
    setSaving(pageId);
    setRowError(null);
    try {
      const saved = await updateModuleControl(pageId, original.version, patch);
      setData((data ?? []).map((r) => (r.pageId === pageId ? saved : r)));
      toast(`${saved.title} saved.`);
      void refreshMenu();
    } catch (err) {
      setRowError({ title: original.title, message: toUiError(err).message });
    } finally {
      setSaving(null);
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
      {error ? (
        <div className="msg error show static" role="alert">
          {error}
        </div>
      ) : null}
      {rowError ? (
        <div className="msg error show static" role="alert">
          {rowError.title}: {rowError.message}
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
            {loading ? 'Loading…' : `${data?.length ?? 0} modules`}
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
              {(data ?? []).map((row) => {
                const draft = drafts[row.pageId] ?? row;
                const dirty = Object.keys(diffControl(draft, row)).length > 0;
                return (
                  <tr key={row.pageId}>
                    <td>{row.family}</td>
                    <td>{row.title}</td>
                    <td>
                      <select
                        className="ctrl-select"
                        aria-label={`${row.title} owner department`}
                        value={draft.ownerDepartment}
                        disabled={!canEdit}
                        onChange={(e) => set(row.pageId, { ownerDepartment: e.target.value })}
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
                            onChange={(e) => set(row.pageId, { [f.key]: e.target.checked })}
                          />
                        </td>
                      );
                    })}
                    <td>
                      <button
                        type="button"
                        className="btn"
                        aria-label={`Save ${row.title}`}
                        disabled={!canEdit || !dirty || saving !== null}
                        onClick={() => void save(row.pageId)}
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
