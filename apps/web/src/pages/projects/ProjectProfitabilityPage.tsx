// apps/web/src/pages/projects/ProjectProfitabilityPage.tsx
import { useEffect, useState } from 'react';
import { PageHead, inr, dmy } from '../finance/shared';
import { projectsApi, type Project, type ProfitabilityReport } from '../../lib/projectsApi';

export function ProjectProfitabilityPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [profitability, setProfitability] = useState<ProfitabilityReport | null>(null);
  const [budgetVsActual, setBudgetVsActual] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    projectsApi.list().then((res) => {
      setProjects(res.rows);
      if (res.rows.length > 0 && res.rows[0]) {
        setSelectedProjectId(res.rows[0].id);
      }
    });
  }, []);

  const loadData = async (projectId: string) => {
    try {
      setLoading(true);
      setError('');
      const [prof, bva] = await Promise.all([
        projectsApi.getProfitability(projectId),
        projectsApi.getBudgetVsActual(projectId),
      ]);
      setProfitability(prof);
      setBudgetVsActual(bva);
    } catch (err: any) {
      setError(err.message || 'Failed to load profitability');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedProjectId) {
      loadData(selectedProjectId);
    }
  }, [selectedProjectId]);

  return (
    <div className="page-body">
      <PageHead
        title="Project Profitability & GL Drill-Down"
        sub="Profitability calculated directly from GL entries tagged with project_id (Ind AS 115 / AS 7), with line drill-down."
      />

      {error && <div className="notice error">{error}</div>}

      <div className="x-d-flex x-gap-1rem x-ai-center x-mb-1_5rem">
        <label>Select Project:</label>
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          className="input x-w-320px"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.project_no} - {p.name}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p>Loading project financials...</p>
      ) : profitability ? (
        <div>
          {/* Key Financial KPIs */}
          <div className="x-d-grid x-cols-repeat-4-1fr x-gap-1rem x-mb-1_5rem">
            <div className="card x-p-1rem x-bg-he8f0fe x-bd-1px-solid-haecbfa">
              <div className="x-fs-12px x-c-h174ea6">Total Revenue</div>
              <div className="x-fs-24px x-fw-700 x-c-h174ea6">
                {inr(profitability.revenue)}
              </div>
            </div>
            <div className="card x-p-1rem x-bg-hfce8e6 x-bd-1px-solid-hfad2cf">
              <div className="x-fs-12px x-c-danger-hover">Total Cost (GL Booked)</div>
              <div className="x-fs-24px x-fw-700 x-c-danger-hover">
                {inr(profitability.totalCost)}
              </div>
            </div>
            <div className="card x-p-1rem x-bg-he6f4ea x-bd-1px-solid-hceead6">
              <div className="x-fs-12px x-c-success">Contribution Margin</div>
              <div className="x-fs-24px x-fw-700 x-c-success">
                {inr(profitability.contribution)}
              </div>
            </div>
            <div className="card x-p-1rem x-bg-hfef7e0 x-bd-1px-solid-hfeefc3">
              <div className="x-fs-12px x-c-hb06000">Margin %</div>
              <div className="x-fs-24px x-fw-700 x-c-hb06000">
                {profitability.marginPct}
              </div>
            </div>
          </div>

          {/* Budget vs Actual Comparison */}
          <div className="x-mb-2rem">
            <h4>Budget vs Actual by Cost Head</h4>
            <table className="table">
              <thead>
                <tr>
                  <th>Cost Head</th>
                  <th style={{ textAlign: 'right' }}>Budgeted</th>
                  <th style={{ textAlign: 'right' }}>Actual Spent</th>
                  <th style={{ textAlign: 'right' }}>Variance</th>
                  <th style={{ textAlign: 'right' }}>% Used</th>
                </tr>
              </thead>
              <tbody>
                {budgetVsActual.map((b) => (
                  <tr key={b.costHead}>
                    <td><strong>{b.costHead}</strong></td>
                    <td style={{ textAlign: 'right' }}>{inr(b.budgeted)}</td>
                    <td style={{ textAlign: 'right' }}>{inr(b.actual)}</td>
                    <td style={{ textAlign: 'right', color: b.variance < 0 ? '#c5221f' : '#137333' }}>
                      {inr(b.variance)}
                    </td>
                    <td style={{ textAlign: 'right' }}>{b.pctUsed}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* GL Entries Drill Down */}
          <div>
            <h4>GL Transactions Drill-Down (Filtered by project_id)</h4>
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Voucher</th>
                  <th>Account</th>
                  <th>Narration</th>
                  <th style={{ textAlign: 'right' }}>Debit (₹)</th>
                  <th style={{ textAlign: 'right' }}>Credit (₹)</th>
                </tr>
              </thead>
              <tbody>
                {profitability.drillDown.map((gl) => (
                  <tr key={gl.id}>
                    <td>{dmy(gl.posting_date)}</td>
                    <td>{gl.voucher_no} ({gl.voucher_type})</td>
                    <td>{gl.account_code} - {gl.account_name}</td>
                    <td>{gl.narration || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{Number(gl.debit) > 0 ? inr(gl.debit) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{Number(gl.credit) > 0 ? inr(gl.credit) : '—'}</td>
                  </tr>
                ))}
                {profitability.drillDown.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '1.5rem' }}>
                      No GL entries posted for this project yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

