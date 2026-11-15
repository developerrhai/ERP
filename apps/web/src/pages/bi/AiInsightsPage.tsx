// AI & Automation insight dashboards (ai-copilot, ai-demand, ai-inventory, ai-sales, ai-vendor, ai-finance, ai-executive),
// laid out like V40 "Advanced AI Business Analysis". The findings are produced by explainable rules and statistics
// (Holt forecast, z-score, thresholds) over real ERP records on the server: GET /ai/overview. No generated prose.
import { useMemo, useState } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { biApi } from '../../lib/biApi';
import { useLoad } from '../../lib/useLoad';
import { BarChart, LineChart } from './BiCharts';
import { ChartCard, Empty, Kpi } from './BiParts';
import { summarise, type AiOverview } from './analyticsModel';
import './bi-dashboards.css';

/** The department each AI page opens on (V40 shows every module on all of them). */
const PRESET: Record<string, string> = {
  'ai-sales': 'Sales',
  'ai-vendor': 'Purchase',
  'ai-inventory': 'Inventory',
  'ai-finance': 'Finance',
};

export function AiInsightsPage({ pageId }: { pageId: string }) {
  const { data, loading, error } = useLoad<AiOverview>(() => biApi.getAiOverview(), [pageId]);
  const [dept, setDept] = useState<string>(PRESET[pageId] ?? '');
  const findings = useMemo(() => (data ? data.findings.filter((f) => !dept || f.module === dept) : []), [data, dept]);
  const trendStats = useMemo(
    () => summarise({ columns: [{ key: 'value', label: 'Value', type: 'num' }], rows: (data?.trend ?? []).map((t) => ({ value: t.value })) }, 'value'),
    [data],
  );

  return (
    <div className="bi-dash">
      <h1>Advanced AI Business Analysis</h1>
      <p className="bi-purpose">Cross-functional predictive, diagnostic, prescriptive and automation intelligence based on ERP data.</p>
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      {loading ? <p className="muted">Loading…</p> : null}
      {data ? (
        <>
          <div className="bi-notice">
            <b>AI Architecture:</b> findings below come from an explainable analytics engine (threshold rules, Holt forecasting and z-score checks) that reads your permission-scoped ERP records inside the
            server. Nothing is sent to an external model for these findings.{' '}
            {data.governance.externalModel ? 'An external model is configured for the Copilot below.' : 'The Copilot answers from permission-scoped dataset queries.'}
          </div>
          <div className="kpis">
            <Kpi label="Business Health" value={`${data.health}/100`} hint="100 minus weighted risk findings" tone={data.health < 60 ? 'bad' : data.health < 80 ? 'warn' : undefined} />
            <Kpi label="Data Quality" value={data.dataQuality === null ? '—' : `${data.dataQuality}%`} hint="Master data completeness" />
            <Kpi label="AI Findings" value={String(data.findings.length)} hint="Generated from real records" />
            <Kpi label="Automation Candidates" value={String(data.findings.filter((f) => f.type === 'Automation').length)} hint="Review & approve" />
          </div>
          <div className="bi-graphs">
            <ChartCard title="20-Point Business Trend + Forecast" sub={`${data.trendLabel} • Blue = actual • Green = calculated trend line`}>
              {data.trend.some((t) => t.value > 0) ? (
                <LineChart
                  label={data.trendLabel}
                  labels={data.trend.map((t) => t.label)}
                  series={[
                    { name: 'Actual', values: data.trend.map((t) => t.value), tone: 'a' },
                    { name: 'Trend line', values: trendStats.trend, tone: 'b' },
                  ]}
                />
              ) : (
                <Empty>No approved sales orders in the last 20 weeks, so there is no trend to draw.</Empty>
              )}
            </ChartCard>
            <ChartCard title="Cross-Module Risk" sub="0 = no open risk finding; each High adds 40, Medium 20, Low 5 (max 100)">
              <BarChart label="Cross-module risk score" items={data.moduleRisk.map((m) => ({ label: m.module, value: m.risk }))} />
            </ChartCard>
          </div>
          <div className="card bi-filter">
            <label htmlFor="ai-dept">Department Filter</label>
            <select id="ai-dept" value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">All Departments</option>
              {data.moduleRisk.map((m) => (
                <option key={m.module} value={m.module}>
                  {m.module}
                </option>
              ))}
            </select>
            <small>Quick filter for department-wise records on this page.</small>
          </div>
          <div className="card table-wrap bi-table-card">
            <div className="toolbar">
              <b>{findings.length} AI Findings</b>
              <span className="bi-badge">Explainable • Role-aware • Auditable</span>
            </div>
            <div className="table-wrap">
              <table className="register-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Module</th>
                    <th>Type</th>
                    <th>Severity</th>
                    <th>Finding / Recommended Action</th>
                    <th className="num">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {findings.map((f, i) => (
                    <tr key={`${f.module}-${i}`}>
                      <td>{i + 1}</td>
                      <td>{f.module}</td>
                      <td>{f.type}</td>
                      <td>
                        <span className={`bi-badge ${f.severity.toLowerCase()}`}>{f.severity}</span>
                      </td>
                      <td className="wrap" title={`Evidence: ${f.evidence}`}>
                        {f.finding}
                      </td>
                      <td className="num">{f.confidence === null ? '—' : `${f.confidence}%`}</td>
                    </tr>
                  ))}
                  {findings.length === 0 ? (
                    <tr>
                      <td colSpan={6}>No findings{dept ? ` for ${dept}` : ''}: every rule that could run found nothing to flag.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
          <div className="bi-two">
            <CopilotCard enabled={data.governance.aiEnabled} />
            <ChartCard title="AI Governance Controls">
              <div className="detail-grid">
                <div className="detail"><small>Role Permission</small><b>Enforced</b></div>
                <div className="detail"><small>Human Approval</small><b>Required for write actions</b></div>
                <div className="detail"><small>Audit Trail</small><b>Enabled</b></div>
                <div className="detail"><small>Data Export</small><b>Controlled</b></div>
                <div className="detail"><small>Confidence</small><b>Displayed</b></div>
                <div className="detail"><small>Production AI</small><b>API-ready</b></div>
              </div>
              {data.skipped.length ? <p className="bi-note">Some rules could not run: {data.skipped.join(', ')}.</p> : null}
            </ChartCard>
          </div>
        </>
      ) : null}
    </div>
  );
}

function CopilotCard({ enabled }: { enabled: boolean }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string>('Ask a cross-functional ERP question.');
  const [head, setHead] = useState('Ready');
  const [conv, setConv] = useState('');

  const ask = async (): Promise<void> => {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      let id = conv;
      if (!id) {
        const c = (await biApi.createConversation({ title: text.slice(0, 80), modulePageId: 'ai-copilot' })) as { id: string };
        id = c.id;
        setConv(id);
      }
      const msg = (await biApi.askCopilot(id, text)) as { content?: string };
      setHead('Answer');
      setAnswer(msg.content ?? '');
    } catch (e) {
      setHead('Could not answer');
      setAnswer(e instanceof Error ? e.message : 'The Copilot is not available.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ChartCard title="Enterprise AI Copilot">
      <div className="bi-ask">
        <input
          aria-label="Ask the AI Copilot"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void ask();
          }}
          placeholder="Ask about sales, purchase, inventory, finance, production, HR, risk or automation"
        />
        <button type="button" className="btn primary" onClick={() => void ask()} disabled={busy || !q.trim()}>
          Ask AI
        </button>
      </div>
      <div className="bi-answer" role="status">
        <strong>{head}</strong>
        {answer}
      </div>
      {!enabled ? <p className="bi-note">The Copilot is switched off by the administrator, so questions will be refused until it is enabled.</p> : null}
    </ChartCard>
  );
}
