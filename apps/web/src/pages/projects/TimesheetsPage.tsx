// apps/web/src/pages/projects/TimesheetsPage.tsx
import { useEffect, useState } from 'react';
import { PageHead, Pill, dmy } from '../finance/shared';
import { projectsApi, type ProjectTimesheet } from '../../lib/projectsApi';

export function TimesheetsPage() {
  const [timesheets, setTimesheets] = useState<ProjectTimesheet[]>([]);
  const [approvalQueue, setApprovalQueue] = useState<ProjectTimesheet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'ALL' | 'QUEUE'>('ALL');

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      const [all, queue] = await Promise.all([
        projectsApi.listTimesheets(),
        projectsApi.getApprovalQueue(),
      ]);
      setTimesheets(all);
      setApprovalQueue(queue);
    } catch (err: any) {
      setError(err.message || 'Failed to load timesheets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleApprove = async (id: string) => {
    try {
      setError('');
      await projectsApi.approveTimesheet(id);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to approve timesheet');
    }
  };

  const handleReject = async (id: string) => {
    try {
      setError('');
      await projectsApi.rejectTimesheet(id, 'Hours rejected by manager');
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to reject timesheet');
    }
  };

  return (
    <div className="page-body">
      <PageHead
        title="Project Timesheets"
        sub="Employee weekly timesheet submission, day validation (max 24h), and GL labour cost absorption on approval."
      />

      {error && <div className="notice error">{error}</div>}

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid #dadce0' }}>
        <button
          className={`tab-btn ${activeTab === 'ALL' ? 'active' : ''}`}
          onClick={() => setActiveTab('ALL')}
          style={{ padding: '0.5rem 1rem', border: 'none', background: 'none', borderBottom: activeTab === 'ALL' ? '2px solid #1a73e8' : 'none', fontWeight: 600 }}
        >
          All Timesheets ({timesheets.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'QUEUE' ? 'active' : ''}`}
          onClick={() => setActiveTab('QUEUE')}
          style={{ padding: '0.5rem 1rem', border: 'none', background: 'none', borderBottom: activeTab === 'QUEUE' ? '2px solid #1a73e8' : 'none', fontWeight: 600 }}
        >
          Approval Queue ({approvalQueue.length})
        </button>
      </div>

      {loading ? (
        <p>Loading timesheets...</p>
      ) : activeTab === 'QUEUE' ? (
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Week Start</th>
              <th style={{ textAlign: 'right' }}>Total Hours</th>
              <th style={{ textAlign: 'right' }}>Billable Hours</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {approvalQueue.map((ts) => (
              <tr key={ts.id}>
                <td>
                  <strong>{ts.employee_name}</strong> ({ts.emp_code})
                </td>
                <td>{dmy(ts.week_start_date)}</td>
                <td style={{ textAlign: 'right' }}>{ts.total_hours} h</td>
                <td style={{ textAlign: 'right' }}>{ts.total_billable_hours} h</td>
                <td>
                  <Pill tone="warning">{ts.status}</Pill>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn small primary" onClick={() => handleApprove(ts.id)}>
                      Approve & Post GL
                    </button>
                    <button className="btn small danger" onClick={() => handleReject(ts.id)}>
                      Reject
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {approvalQueue.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>
                  No pending timesheets in approval queue.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Week Start</th>
              <th style={{ textAlign: 'right' }}>Total Hours</th>
              <th style={{ textAlign: 'right' }}>Billable Hours</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {timesheets.map((ts) => (
              <tr key={ts.id}>
                <td>
                  <strong>{ts.employee_name}</strong> ({ts.emp_code})
                </td>
                <td>{dmy(ts.week_start_date)}</td>
                <td style={{ textAlign: 'right' }}>{ts.total_hours} h</td>
                <td style={{ textAlign: 'right' }}>{ts.total_billable_hours} h</td>
                <td>
                  <Pill tone={ts.status === 'APPROVED' ? 'success' : ts.status === 'SUBMITTED' ? 'warning' : 'neutral'}>
                    {ts.status}
                  </Pill>
                </td>
              </tr>
            ))}
            {timesheets.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }}>
                  No timesheets found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

