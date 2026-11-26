// The V40 master workspace pieces drawn around a register: the KPI cards (Records in Scope, Completion, Open / Pending,
// At Risk), the Validation Controls panel and the Department Filter. Every number comes from the server.
import { getWorkspaceSummary, type ControlRule, type WorkspaceSummary } from '../../lib/workspaceApi';
import { useLoad } from '../../lib/useLoad';
import { workApi } from '../../lib/workApi';
import { formatMoney } from '../../pages/generic/fieldModel';
import './workspace.css';

/** The summary of a page, reloaded whenever `token` changes (after an add, edit or delete). null page = nothing to load. */
export function useWorkspaceSummary(pageId: string | null, token: unknown = 0): WorkspaceSummary | null {
  const { data } = useLoad(
    () => (pageId ? getWorkspaceSummary(pageId) : Promise.resolve(null)),
    [pageId, token],
  );
  // a page that cannot be summarised (no permission, server down) shows dashes, never a wrong number
  return data && typeof data.records === 'number' ? data : null;
}

export function WorkspaceKpis({ summary, noun }: { summary: WorkspaceSummary | null; noun: string }) {
  const show = (v: string): string => (summary ? v : '—');
  const risky = (summary?.atRisk ?? 0) > 0;
  const cards: { label: string; value: string; note: string; hint?: string | undefined; warn?: boolean }[] = [
    { label: 'Records in Scope', value: show(String(summary?.records)), note: noun },
    { label: 'Completion', value: show(`${summary?.completeness}%`), note: 'Data coverage', hint: summary?.hints.completeness },
    { label: 'Open / Pending', value: show(String(summary?.openPending)), note: 'Action queue', hint: summary?.hints.openPending },
    {
      label: 'At Risk',
      value: show(`${summary?.riskScore}/100`),
      note: !summary ? 'Risk score' : risky ? `Review ${summary.atRisk} record${summary.atRisk === 1 ? '' : 's'}` : 'Controlled',
      hint: summary?.hints.atRisk,
      warn: risky,
    },
  ];
  if (summary?.primary) {
    cards.push({ label: summary.primary.label, value: formatMoney(summary.primary.value), note: 'All records in scope' });
  }
  return (
    <div className="ws-kpis" role="group" aria-label="Key figures">
      {cards.map((c) => (
        <div className={`ws-kpi${c.warn ? ' warn' : ''}`} key={c.label} title={c.hint}>
          <small>{c.label}</small>
          <b>{c.value}</b>
          <span>{c.note}</span>
        </div>
      ))}
    </div>
  );
}

export function ValidationControls({ rules }: { rules: ControlRule[] }) {
  return (
    <aside className="ws-controls" aria-label="Validation Controls">
      <h3>Validation Controls</h3>
      {rules.length === 0 ? <p className="v8-sub">Loading…</p> : null}
      <ul>
        {rules.map((r) => (
          <li key={r.name}>
            <div>
              <span>{r.name}</span>
              <small>{r.detail}</small>
            </div>
            <b className={r.state === 'Enabled' ? 'on' : 'opt'}>{r.state}</b>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** "Department Filter": the records currently with a department (its open Move Forward, else the owning department). */
export function DepartmentFilter({ value, onChange }: { value: string; onChange: (department: string) => void }) {
  const { data } = useLoad(() => workApi.departments(), []);
  const names = Array.isArray(data) ? data.map((d) => d.name) : [];
  return (
    <div className="ws-deptfilter">
      <label>
        Department Filter
        <select aria-label="Department Filter" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">All Departments</option>
          {[...new Set([...(value ? [value] : []), ...names])].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <small>
        {value ? `Showing the records now with ${value}.` : 'Quick filter by the department a record is with now.'}
      </small>
    </div>
  );
}
