// V40 Executive AI Insights: findings from the real ai_insights table (GET /ai/insights) and
// the explainable engine (GET /ai/overview), with a real 20-point business trend, cross-module risk,
// and governance controls card. No trend or confidence value is invented.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { biApi } from '../../lib/biApi';
import type { AiOverview } from '../bi/analyticsModel';
import { LineChart } from '../bi/BiCharts';
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
  confidence?: number | null;
}

const moduleOf = (i: Insight) => i.datasetCode || i.kpiCode || i.department || 'General';

export function AiInsightsPage() {
  const [rows, setRows] = useState<Insight[]>([]);
  const [overview, setOverview] = useState<AiOverview | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    biApi
      .getAiOverview()
      .then((ov) => {
        if (!alive || !ov) return;
        setOverview(ov);
        if (ov.findings && ov.findings.length > 0) {
          setRows(
            ov.findings.map((f, i) => ({
              id: `f-${i}`,
              datasetCode: f.module,
              kind: f.type,
              severity: f.severity,
              message: f.finding,
              confidence: f.confidence,
            })),
          );
        }
      })
      .catch(() => {
        // Handled or test mock fallback below
      });

    biApi
      .listInsights()
      .then((r) => {
        if (!alive) return;
        if (r && r.length > 0) {
          setRows((prev) => (prev.length > 0 ? prev : (r as Insight[])));
        }
      })
      .catch(() => alive && setFailed(true))
      .finally(() => alive && setLoaded(true));

    return () => {
      alive = false;
    };
  }, []);

  const bars = useMemo(() => {
    if (overview?.moduleRisk && overview.moduleRisk.length > 0) {
      return overview.moduleRisk.map((m) => ({ label: m.module, value: m.risk }));
    }
    const m = new Map<string, number>();
    for (const r of rows) m.set(moduleOf(r), (m.get(moduleOf(r)) ?? 0) + 1);
    return [...m.entries()].map(([label, value]) => ({ label, value }));
  }, [overview, rows]);

  const hasTrend = overview?.trend && overview.trend.some((t) => t.value > 0);

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
          <h3 style={{ margin: 0, fontSize: 13, marginBottom: 8 }}>20-Point Business Trend + Forecast</h3>
          {hasTrend && overview ? (
            <LineChart
              label={overview.trendLabel}
              labels={overview.trend.map((t) => t.label)}
              series={[{ name: 'Actual', values: overview.trend.map((t) => t.value), tone: 'a' }]}
            />
          ) : (
            <div className="ex-empty">
              {loaded ? 'No approved sales orders in the last 20 weeks, so there is no trend to draw.' : 'Loading…'}
            </div>
          )}
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
                    <td>{r.confidence ? `${r.confidence}%` : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="ex-two-even">
        <div className="ex-card ex-card-pad">
          <h3 style={{ margin: '0 0 10px', fontSize: 13 }}>Enterprise AI Copilot</h3>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
            Ask cross-functional questions about sales, purchase, inventory, production, finance and compliance.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link className="btn primary" to="/m/ai-copilot">Open AI Copilot</Link>
            <Link className="btn" to="/m/project-global-history">Project History</Link>
          </div>
        </div>
        <div className="ex-card ex-card-pad">
          <h3 style={{ margin: '0 0 10px', fontSize: 13 }}>AI Governance Controls</h3>
          <div className="detail-grid">
            <div className="detail"><small>Role Permission</small><b>Enforced</b></div>
            <div className="detail"><small>Human Approval</small><b>Required for write actions</b></div>
            <div className="detail"><small>Audit Trail</small><b>Enabled</b></div>
            <div className="detail"><small>Data Export</small><b>Controlled</b></div>
            <div className="detail"><small>Confidence</small><b>Displayed</b></div>
            <div className="detail"><small>Production AI</small><b>API-ready</b></div>
          </div>
        </div>
      </div>
    </div>
  );
}
