// apps/web/src/pages/projects/ProjectsListPage.tsx
import { useEffect, useState } from 'react';
import { PageHead, Pill, inr, dmy } from '../finance/shared';
import { projectsApi, type Project } from '../../lib/projectsApi';

export function ProjectsListPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    name: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
    contractValue: 500000,
    billingType: 'FIXED_PRICE',
  });

  const loadProjects = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await projectsApi.list();
      setProjects(res.rows);
    } catch (err: any) {
      setError(err.message || 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError('');
      await projectsApi.create({
        name: form.name,
        start_date: form.startDate,
        end_date: form.endDate,
        contract_value: Number(form.contractValue),
        billing_type: form.billingType,
      });
      setShowModal(false);
      loadProjects();
    } catch (err: any) {
      setError(err.message || 'Failed to create project');
    }
  };

  const handleActivate = async (id: string) => {
    try {
      setError('');
      await projectsApi.activate(id);
      loadProjects();
    } catch (err: any) {
      setError(err.message || 'Failed to activate project');
    }
  };

  return (
    <div className="page-body">
      <PageHead
        title="Customer Projects"
        sub="Projects management with schedules, EVM, Gantt, timesheets, and GL profitability."
      />

      {error && <div className="notice error">{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <span className="badge">Total Projects: {projects.length}</span>
          <span className="badge" style={{ background: '#e6f4ea', color: '#137333' }}>
            Active: {projects.filter((p) => p.status === 'ACTIVE').length}
          </span>
        </div>
        <button className="btn primary" onClick={() => setShowModal(true)}>
          + New Project
        </button>
      </div>

      {loading ? (
        <p>Loading projects...</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Project No</th>
              <th>Project Name</th>
              <th>Customer</th>
              <th>Timeline</th>
              <th style={{ textAlign: 'right' }}>Contract Value</th>
              <th style={{ textAlign: 'right' }}>Approved Budget</th>
              <th style={{ textAlign: 'right' }}>Actual Cost</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>{p.project_no}</strong>
                </td>
                <td>{p.name}</td>
                <td>{p.customer_name || '—'}</td>
                <td>
                  {dmy(p.start_date)} to {dmy(p.end_date)}
                </td>
                <td style={{ textAlign: 'right' }}>{inr(p.contract_value)}</td>
                <td style={{ textAlign: 'right' }}>{inr(p.approved_budget ?? 0)}</td>
                <td style={{ textAlign: 'right' }}>{inr(p.actual_cost ?? 0)}</td>
                <td>
                  <Pill tone={p.status === 'ACTIVE' ? 'success' : p.status === 'PLANNING' ? 'neutral' : 'warning'}>
                    {p.status}
                  </Pill>
                </td>
                <td>
                  {p.status === 'PLANNING' && (
                    <button className="btn small" onClick={() => handleActivate(p.id)}>
                      Activate
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {projects.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '2rem' }}>
                  No customer projects found. Click "+ New Project" to create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {showModal && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: '500px' }}>
            <h3>New Customer Project</h3>
            <form onSubmit={handleCreate}>
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label>Project Name</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Turnkey Plant Automation"
                  className="input"
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div className="form-group">
                  <label>Start Date</label>
                  <input
                    type="date"
                    required
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    className="input"
                  />
                </div>
                <div className="form-group">
                  <label>End Date</label>
                  <input
                    type="date"
                    required
                    value={form.endDate}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    className="input"
                  />
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label>Contract Value (₹)</label>
                <input
                  type="number"
                  required
                  value={form.contractValue}
                  onChange={(e) => setForm({ ...form, contractValue: Number(e.target.value) })}
                  className="input"
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button type="button" className="btn" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn primary">
                  Save Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

