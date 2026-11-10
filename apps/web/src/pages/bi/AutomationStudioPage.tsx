// apps/web/src/pages/bi/AutomationStudioPage.tsx
import { useEffect, useState } from 'react';
import { biApi } from '../../lib/biApi';

export function AutomationStudioPage({
  initialTab,
}: {
  initialTab?: 'RULES' | 'RUNS' | 'WEBHOOKS' | 'JOBS';
}) {
  const [tab, setTab] = useState<'RULES' | 'RUNS' | 'WEBHOOKS' | 'JOBS'>(initialTab ?? 'RULES');
  const [rules, setRules] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [whName, setWhName] = useState('');
  const [whUrl, setWhUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadAll = async () => {
    try {
      const [rl, rn, wh, jb] = await Promise.all([
        biApi.listRules(),
        biApi.listRuleRuns(),
        biApi.listWebhooks(),
        biApi.listJobs(),
      ]);
      setRules(rl);
      setRuns(rn);
      setWebhooks(wh);
      setJobs(jb);
    } catch {
      // handled silently
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const handleAddWebhook = async () => {
    setErrorMsg(null);
    try {
      await biApi.createWebhook({ name: whName || 'ERP Endpoint', url: whUrl, events: ['invoice.overdue'] });
      setWhName('');
      setWhUrl('');
      await loadAll();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Invalid webhook endpoint.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">⚡ Automation Studio, Webhooks & Jobs</h1>
          <p className="text-sm text-slate-500">
            AST condition rules, Standard Webhooks (HMAC-SHA256 + SSRF guard), and pg-boss queue monitor
          </p>
        </div>
        <div className="flex gap-1.5">
          {([
            ['RULES', 'Rules'],
            ['RUNS', 'Run History'],
            ['WEBHOOKS', 'Webhooks'],
            ['JOBS', 'Background Jobs'],
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

      {tab === 'RULES' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-left">Rule</th>
                <th className="px-4 py-3 text-left">Trigger Event</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rules.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-mono font-semibold">{r.code}</td>
                  <td className="px-4 py-3">{r.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.triggerEvent}</td>
                  <td className="px-4 py-3 text-xs">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'WEBHOOKS' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-2 items-center">
            <input
              value={whName}
              onChange={(e) => setWhName(e.target.value)}
              placeholder="Endpoint Name"
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <input
              value={whUrl}
              onChange={(e) => setWhUrl(e.target.value)}
              placeholder="https://hooks.partner.com/webhook"
              className="flex-1 min-w-[260px] px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
            />
            <button onClick={handleAddWebhook} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">
              Register Webhook
            </button>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">HTTPS URL</th>
                  <th className="px-4 py-3 text-left">Secret</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {webhooks.map((w) => (
                  <tr key={w.id}>
                    <td className="px-4 py-3 font-medium">{w.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{w.url}</td>
                    <td className="px-4 py-3 font-mono text-xs">****{w.secretLast4}</td>
                    <td className="px-4 py-3 text-xs">{w.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'RUNS' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left">Rule</th>
                <th className="px-4 py-3 text-left">Event</th>
                <th className="px-4 py-3 text-left">Depth</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3">{r.ruleName}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.eventName}</td>
                  <td className="px-4 py-3 text-xs">{r.depth}</td>
                  <td className="px-4 py-3 text-xs">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'JOBS' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left">Queue Name</th>
                <th className="px-4 py-3 text-left">State</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-right">Retries</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="px-4 py-3 font-mono text-xs font-semibold">{j.name}</td>
                  <td className="px-4 py-3 text-xs">{j.state}</td>
                  <td className="px-4 py-3 text-xs">{String(j.createdOn).slice(0, 19)}</td>
                  <td className="px-4 py-3 text-right text-xs">{j.retryCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

