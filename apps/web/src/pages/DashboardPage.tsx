// Phase 19 Department Dashboard: real SQL KPIs, formula & row count tooltips, zero-denominator "—", open exceptions
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getApprovalCounts } from '../lib/approvalsApi';
import { contextLabels, useAppContext } from '../lib/context';
import { biApi } from '../lib/biApi';
import { useLoad } from '../lib/useLoad';
import type { User } from '../types';

export function DashboardPage({ user }: { user: User }) {
  const dept = user.department ?? 'Administration';
  const labels = contextLabels(useAppContext().data);
  const counts = useLoad(getApprovalCounts, []);
  const [dash, setDash] = useState<any | null>(null);
  const [infoOpen, setInfoOpen] = useState<string | null>(null);

  useEffect(() => {
    biApi.getDepartmentDashboard(dept).then(setDash).catch(() => {});
  }, [dept]);

  const kpis: any[] = dash?.kpis ?? [];
  const exceptions: any[] = dash?.exceptions ?? [];

  return (
    <div className="space-y-4">
      <section className="v8-dash-hero" aria-labelledby="dash-title">
        <div>
          <small>LOGGED-IN BUSINESS AREA</small>
          <h2 id="dash-title">{dept} Dashboard</h2>
          <p>
            {user.name} • {user.roleLabel}
          </p>
          {labels ? (
            <p className="hero-context" data-testid="hero-context">
              {labels.unit} • {labels.fy}
            </p>
          ) : null}
        </div>
        <div className="v8-health">
          <div>
            <small>Department</small>
            <b>{dept}</b>
          </div>
          <div>
            <small>Role</small>
            <b>{user.roleLabel}</b>
          </div>
          <div>
            <small>Login ID</small>
            <b>{user.loginId}</b>
          </div>
          <div>
            <small>Account</small>
            <b>{user.status === 'ACTIVE' ? 'Active' : 'Inactive'}</b>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Link className="btn primary" to="/approvals">
          My Approvals ({counts.data ? counts.data.waitingForMe : '…'})
        </Link>
        <Link className="btn" to="/m/command-center">
          Command Center
        </Link>
        <Link className="btn" to="/m/ai-copilot">
          AI Copilot
        </Link>
      </div>

      {/* Real Department KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <div key={k.code} className="bg-white rounded-xl border border-slate-200 p-4 space-y-1 relative">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase">{k.name}</span>
              <button
                type="button"
                title={k.tooltip}
                onClick={() => setInfoOpen(infoOpen === k.code ? null : k.code)}
                className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 text-xs font-bold hover:bg-indigo-100"
              >
                i
              </button>
            </div>
            <div className="text-2xl font-bold text-slate-900 font-mono">
              {k.value === null
                ? '—'
                : k.unitLabel === 'INR'
                  ? `₹${Number(k.value).toLocaleString('en-IN')}`
                  : k.unitLabel === '%'
                    ? `${k.value}%`
                    : k.value}
            </div>
            {k.value === null && (
              <div className="text-[11px] text-slate-400">No data in period</div>
            )}
            {infoOpen === k.code && (
              <div className="mt-2 p-2 rounded bg-slate-50 border border-slate-200 text-xs text-slate-600">
                <div><strong>Formula:</strong> {k.formulaText}</div>
                <div><strong>Source rows:</strong> {k.rowCount}</div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Exceptions Table */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm text-slate-800">Open Exceptions & Pending Items</h3>
          <span className="text-xs text-slate-500">{dash?.summary || ''}</span>
        </div>
        {exceptions.length === 0 ? (
          <div className="text-sm text-slate-500 py-4">No open exceptions in your scope.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b">
              <tr>
                <th className="px-3 py-2 text-left">Module</th>
                <th className="px-3 py-2 text-left">Doc Code</th>
                <th className="px-3 py-2 text-left">Title</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {exceptions.map((ex) => (
                <tr key={ex.id}>
                  <td className="px-3 py-2 text-xs">{ex.module}</td>
                  <td className="px-3 py-2 font-mono font-semibold">{ex.docCode}</td>
                  <td className="px-3 py-2">{ex.title}</td>
                  <td className="px-3 py-2 text-xs text-amber-700 font-semibold">{ex.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
