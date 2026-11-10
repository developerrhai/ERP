// apps/web/src/pages/bi/BiBuilderPage.tsx
import { useEffect, useState } from 'react';
import { biApi } from '../../lib/biApi';

export function BiBuilderPage({
  initialTab,
}: {
  initialTab?: 'COMMAND' | 'BUILDER' | 'REPORTS' | 'SCHEDULER' | 'SEARCH';
}) {
  const [tab, setTab] = useState<'COMMAND' | 'BUILDER' | 'REPORTS' | 'SCHEDULER' | 'SEARCH'>(initialTab ?? 'BUILDER');
  const [datasets, setDatasets] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [commandKpis, setCommandKpis] = useState<any[]>([]);

  // Report Builder
  const [selectedDs, setSelectedDs] = useState('sales_orders');
  const [reportName, setReportName] = useState('');
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [scopeApplied, setScopeApplied] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Global Search
  const [searchQ, setSearchQ] = useState('');
  const [searchHits, setSearchHits] = useState<any[]>([]);

  const loadAll = async () => {
    try {
      const [ds, reps, sch, cc] = await Promise.all([
        biApi.listDatasets(),
        biApi.listReports(),
        biApi.listSchedules(),
        biApi.getCommandCenter().catch(() => ({ kpis: [] })),
      ]);
      setDatasets(ds);
      setReports(reps);
      setSchedules(sch);
      setCommandKpis(cc.kpis || []);
    } catch {
      // handled silently
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const handlePreview = async () => {
    setErrorMsg(null);
    try {
      const res = await biApi.queryDataset({ datasetCode: selectedDs, limit: 50 });
      setPreviewRows(res.rows || []);
      setScopeApplied(res.scopeApplied || '');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Query blocked.');
    }
  };

  const handleSaveReport = async () => {
    if (!reportName.trim()) return;
    setErrorMsg(null);
    try {
      const ds = datasets.find((d) => d.code === selectedDs);
      const cols = Array.isArray(ds?.columns) ? ds.columns.map((c: any) => c.key) : [];
      await biApi.createReport({
        code: `RPT_${Date.now().toString().slice(-6)}`,
        name: reportName,
        datasetCode: selectedDs,
        columns: cols,
      });
      setReportName('');
      await loadAll();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not save report.');
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQ.trim()) return;
    const hits = await biApi.search(searchQ);
    setSearchHits(hits);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">📊 BI, Governed Reports & Command Center</h1>
          <p className="text-sm text-slate-500">
            Zero-SQL whitelisted dataset reporting, permission-scoped KPIs & global full-text search
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {([
            ['COMMAND', 'Command Center'],
            ['BUILDER', 'Report Builder'],
            ['REPORTS', 'Saved Reports'],
            ['SCHEDULER', 'Schedules'],
            ['SEARCH', 'Global Search'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                tab === key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {errorMsg && (
        <div className="bg-red-50 border border-red-300 text-red-800 px-4 py-2.5 rounded-lg text-sm">{errorMsg}</div>
      )}

      {tab === 'COMMAND' && (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {commandKpis.map((k) => (
            <div key={k.code} className="bg-white rounded-xl border border-slate-200 p-4 space-y-1">
              <div className="text-[11px] font-bold uppercase text-indigo-600">{k.department}</div>
              <div className="text-sm font-semibold text-slate-700">{k.name}</div>
              <div className="text-2xl font-bold font-mono text-slate-900">
                {k.value === null
                  ? '—'
                  : k.unitLabel === 'INR'
                    ? `₹${Number(k.value).toLocaleString('en-IN')}`
                    : k.unitLabel === '%'
                      ? `${k.value}%`
                      : k.value}
              </div>
              <div className="text-[11px] text-slate-500" title={k.tooltip}>
                {k.formulaText} ({k.rowCount} rows)
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'BUILDER' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs text-slate-600 mb-1">Governed Dataset</label>
              <select
                value={selectedDs}
                onChange={(e) => setSelectedDs(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              >
                {datasets.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.label} ({d.ownerDepartment})
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handlePreview}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium"
            >
              Preview 50 Rows
            </button>
            <div className="flex items-end gap-2">
              <div>
                <label className="block text-xs text-slate-600 mb-1">Save As Report</label>
                <input
                  value={reportName}
                  onChange={(e) => setReportName(e.target.value)}
                  placeholder="Report title"
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <button
                onClick={handleSaveReport}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium"
              >
                Save Report
              </button>
            </div>
          </div>

          {scopeApplied && (
            <div className="text-xs text-slate-500">
              Scope enforced: <span className="font-mono font-semibold">{scopeApplied}</span> • Sensitive columns masked automatically
            </div>
          )}

          {previewRows.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b text-slate-600">
                  <tr>
                    {Object.keys(previewRows[0]).map((col) => (
                      <th key={col} className="px-3 py-2 text-left font-mono text-xs">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {previewRows.map((row, idx) => (
                    <tr key={idx}>
                      {Object.values(row).map((val, cIdx) => (
                        <td key={cIdx} className="px-3 py-2 text-xs">{val === null ? '—' : String(val)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'REPORTS' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Dataset</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reports.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-mono font-semibold">{r.code}</td>
                  <td className="px-4 py-3">{r.name}</td>
                  <td className="px-4 py-3 text-xs">{r.datasetLabel}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={async () => {
                        const run = await biApi.runReport(r.id);
                        setPreviewRows(run.rows || []);
                        setTab('BUILDER');
                      }}
                      className="px-3 py-1 rounded bg-indigo-600 text-white text-xs"
                    >
                      Run
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'SCHEDULER' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left">Report</th>
                <th className="px-4 py-3 text-left">Cron (IST)</th>
                <th className="px-4 py-3 text-left">Format</th>
                <th className="px-4 py-3 text-left">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {schedules.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-medium">{s.reportName}</td>
                  <td className="px-4 py-3 font-mono text-xs">{s.cronExpr}</td>
                  <td className="px-4 py-3 text-xs">{s.format}</td>
                  <td className="px-4 py-3 text-xs">{s.active ? 'Active' : 'Paused'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'SEARCH' && (
        <div className="space-y-4">
          <form onSubmit={handleSearch} className="flex gap-2 max-w-xl">
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Search documents, invoices, POs, projects (Ctrl+K)..."
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <button type="submit" className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">
              Search
            </button>
          </form>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {searchHits.length === 0 ? (
              <div className="p-6 text-sm text-slate-500 text-center">No matching documents in your permitted scope.</div>
            ) : (
              searchHits.map((h) => (
                <div key={`${h.entityType}-${h.entityId}`} className="p-3 flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-sm text-slate-900">{h.title}</div>
                    <div className="text-xs text-slate-500">{h.entityType} • {h.docNo || '-'} • {h.subtitle || ''}</div>
                  </div>
                  <span className="text-xs font-mono text-indigo-600">{h.department || 'General'}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

