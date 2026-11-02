// Department Access tab: the departments × 22 families checkbox matrix (prototype DEPT_FAMILIES)
// with Save per department; Administration is locked to all families (CONTRACT §2.6).
import { useMemo, useState } from 'react';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { refreshMenu } from '../../lib/menu';
import { useUnsavedGuard } from '../../lib/unsaved';
import { useLoad } from '../../lib/useLoad';
import { getDepartmentAccess, saveDepartmentAccess } from './adminApi';
import { PROTECTED_DEPARTMENT } from './DepartmentMasterPage';

export function DepartmentAccessTab({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const { data, loading, error, setData } = useLoad(getDepartmentAccess, []);
  const original = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const d of data?.departments ?? []) m[d.name] = [...d.families];
    return m;
  }, [data]);
  // Only unsaved edits live here; everything else reads straight from the server data. Saving
  // one department drops only that department's edit, so other unsaved rows are kept.
  const [edits, setEdits] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ dept: string; message: string } | null>(null);
  const current = (dept: string): string[] => edits[dept] ?? original[dept] ?? [];

  const families = data?.families ?? [];
  const toggle = (dept: string, family: string, on: boolean): void => {
    setEdits((prev) => {
      const cur = new Set(prev[dept] ?? original[dept] ?? []);
      if (on) cur.add(family);
      else cur.delete(family);
      // Keep registry order so "dirty" comparisons are stable.
      return { ...prev, [dept]: families.filter((f) => cur.has(f)) };
    });
  };
  const isDirty = (dept: string): boolean => {
    const a = new Set(current(dept));
    const b = new Set(original[dept] ?? []);
    return a.size !== b.size || [...a].some((f) => !b.has(f));
  };

  useUnsavedGuard(Object.keys(edits).some(isDirty));

  const save = async (dept: string): Promise<void> => {
    if (saving) return;
    setSaving(dept);
    setRowError(null);
    const chosen = current(dept);
    try {
      await saveDepartmentAccess(dept, chosen);
      setData((prev) =>
        prev
          ? {
              ...prev,
              departments: prev.departments.map((d) =>
                d.name === dept ? { ...d, families: chosen } : d,
              ),
            }
          : prev,
      );
      setEdits((prev) => {
        const next = { ...prev };
        delete next[dept];
        return next;
      });
      toast(`Menu access for ${dept} saved.`);
      void refreshMenu();
    } catch (err) {
      setRowError({ dept, message: toUiError(err).message });
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
      {error ? (
        <div className="msg error show static" role="alert">
          {error}
        </div>
      ) : null}
      {rowError ? (
        <div className="msg error show static" role="alert">
          {rowError.dept}: {rowError.message}
        </div>
      ) : null}
      <p className="v8-sub access-hint">
        Families a department sees in its menu (Manager, Lead and Member). Admins see every family.
      </p>
      <div className="card table-wrap">
        <table className="access-matrix">
          <thead>
            <tr>
              <th scope="col">Department</th>
              {families.map((f) => (
                <th scope="col" key={f} title={f}>
                  <span className="access-head">{f}</span>
                </th>
              ))}
              <th scope="col">Save</th>
            </tr>
          </thead>
          <tbody>
            {(data?.departments ?? []).map((d) => {
              const locked = d.name === PROTECTED_DEPARTMENT;
              const on = new Set(current(d.name));
              return (
                <tr key={d.name}>
                  <th scope="row">{d.name}</th>
                  {families.map((f) => (
                    <td key={f}>
                      <input
                        type="checkbox"
                        aria-label={`${d.name} — ${f}`}
                        checked={locked || on.has(f)}
                        disabled={locked || !canEdit}
                        title={locked ? 'Administration always sees all families.' : undefined}
                        onChange={(e) => toggle(d.name, f, e.target.checked)}
                      />
                    </td>
                  ))}
                  <td>
                    {locked ? (
                      <span className="v8-sub">All families</span>
                    ) : (
                      <button
                        type="button"
                        className="btn"
                        aria-label={`Save ${d.name}`}
                        disabled={!canEdit || !isDirty(d.name) || saving !== null}
                        onClick={() => void save(d.name)}
                      >
                        {saving === d.name ? 'Saving…' : 'Save'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {loading && !data ? (
              <tr className="empty-row">
                <td colSpan={families.length + 2}>Loading…</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
