// V40 Executive AI Insights: findings from the real ai_insights table (GET /ai/insights), a cross-module risk
// chart derived from them, and the copilot entry. No trend or confidence value is invented.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { biApi } from '../../lib/biApi';
import { BarChart } from './BarChart';
import './executive.css';

interface Insight {
  id: string;
  kpiCode?: string | null;
  datasetCode?: string | null;
  kind: string;
  severity: string;
  message: string;
  department?: string | null;
  detectedAt?: string;
}

const moduleOf = (i: Insight) => i.datasetCode || i.kpiCode || i.department || 'General';

export function AiInsightsPage() {
  const [rows, setRows] = useState<Insight[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    biApi
      .listInsights()
      .then((r) => alive && setRows(r as Insight[]))
      .catch(() => alive && setFailed(true))
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  const bars = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(moduleOf(r), (m.get(moduleOf(r)) ?? 0) + 1);
    return [...m.entries()].map(([label, value]) => ({ label, value }));
  }, [rows]);

  return (
    <div className="ex-page" data-testid="ai-insights">
      <div className="ex-head">
        <div>
          <h2>Advanced AI Business Analysis</h2>
          <p>Cross-functional predictive, diagnostic, prescriptive and automation intelligence based on ERP data.</p>
        </div>
        <div className="ex-actions">
          <button type="button" className="btn" onClick={() => window.print()}>AI Report PDF</button>
          <Link className="btn" to="/m/ai-copilot">Ask AI</Link>
          <Link className="btn" to="/m/project-global-history">Project History</Link>
        </div>
      </div>

      <div className="ex-note">
        <b>AI Architecture:</b> This build uses an explainable local analytics engine. It does not send business data
        externally. A production deployment can connect the same UI to an approved AI API with role-aware data access
        and audit logging.
      </div>

      <div className="ex-two-even">
        <div className="ex-card ex-card-pad">
          <h3 style={{ margin: 0, fontSize: 13 }}>20-Point Business Trend + Forecast</h3>
          <div className="ex-empty">No trend series is recorded yet. Run a forecast from the AI Copilot page.</div>
        </div>
        <div className="ex-card ex-card-pad">
          <h3 style={{ margin: 0, fontSize: 13 }}>Cross-Module Risk</h3>
          <BarChart bars={bars} empty={loaded ? 'No risk findings.' : 'Loading…'} />
        </div>
      </div>

      <div className="ex-card">
        <div className="ex-title">
          <h3>{rows.length} AI Findings</h3>
          <span>Explainable • Role-aware • Auditable</span>
        </div>
        <div className="ex-scroll">
          <table className="ex-table">
            <thead>
              <tr><th>#</th><th>Module</th><th>Type</th><th>Severity</th><th>Finding / Recommended Action</th><th>Confidence</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="ex-empty">{failed ? 'Could not load AI findings.' : loaded ? 'No AI findings yet.' : 'Loading…'}</td></tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={r.id ?? i}>
                    <td>{i + 1}</td>
                    <td>{moduleOf(r)}</td>
                    <td>{r.kind}</td>
                    <td><span className={`ex-pri ${r.severity}`}>{r.severity}</span></td>
                    <td>{r.message}</td>
                    <td>—</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
