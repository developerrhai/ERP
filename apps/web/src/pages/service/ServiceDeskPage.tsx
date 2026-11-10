// apps/web/src/pages/service/ServiceDeskPage.tsx
import { useEffect, useState } from 'react';
import { PageHead, Pill } from '../finance/shared';
import { serviceApi, type ServiceTicket } from '../../lib/serviceApi';

export function ServiceDeskPage() {
  const [tickets, setTickets] = useState<ServiceTicket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<ServiceTicket | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadTickets = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await serviceApi.listTickets();
      setTickets(res.rows);
      if (selectedTicket) {
        const refreshed = await serviceApi.getTicket(selectedTicket.id);
        setSelectedTicket(refreshed);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTickets();
  }, []);

  const handleSelect = async (t: ServiceTicket) => {
    try {
      const full = await serviceApi.getTicket(t.id);
      setSelectedTicket(full);
    } catch (err: any) {
      setError(err.message || 'Failed to load ticket details');
    }
  };

  const handleAutoAssign = async (id: string) => {
    try {
      setError('');
      await serviceApi.autoAssignTicket(id);
      loadTickets();
    } catch (err: any) {
      setError(err.message || 'Failed to auto-assign technician');
    }
  };

  const handlePause = async (id: string) => {
    try {
      setError('');
      await serviceApi.pauseTicket(id, 'AWAITING_CUSTOMER', 'Awaiting customer confirmation');
      loadTickets();
    } catch (err: any) {
      setError(err.message || 'Failed to pause SLA');
    }
  };

  const handleResume = async (id: string) => {
    try {
      setError('');
      await serviceApi.resumeTicket(id);
      loadTickets();
    } catch (err: any) {
      setError(err.message || 'Failed to resume SLA');
    }
  };

  const handleResolve = async (id: string) => {
    try {
      setError('');
      await serviceApi.resolveTicket(id, 'Issue resolved on site');
      loadTickets();
    } catch (err: any) {
      setError(err.message || 'Failed to resolve ticket');
    }
  };

  return (
    <div className="page-body">
      <PageHead
        title="Service Desk & SLA Management"
        sub="Incident tracking, priority matrix (impact + urgency - 1), business-minute SLA timer, and technician dispatch."
      />

      {error && <div className="notice error">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: selectedTicket ? '1fr 400px' : '1fr', gap: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <span className="badge">Total Tickets: {tickets.length}</span>
              <span className="badge" style={{ background: '#fce8e6', color: '#c5221f' }}>
                Open: {tickets.filter((t) => t.status !== 'RESOLVED' && t.status !== 'CLOSED').length}
              </span>
            </div>
            <button className="btn primary" onClick={() => alert('New Service Ticket form')}>
              + New Service Ticket
            </button>
          </div>

          {loading ? (
            <p>Loading service desk...</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Customer</th>
                  <th>Priority</th>
                  <th>Entitlement</th>
                  <th>SLA State</th>
                  <th>Technician</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => handleSelect(t)}
                    style={{
                      cursor: 'pointer',
                      background: selectedTicket?.id === t.id ? '#e8f0fe' : undefined,
                    }}
                  >
                    <td>
                      <strong>{t.ticket_no}</strong>
                      <div style={{ fontSize: '11px', color: '#5f6368' }}>{t.subject}</div>
                    </td>
                    <td>{t.customer_name || '—'}</td>
                    <td>
                      <span
                        className="badge"
                        style={{
                          background: t.priority === 1 ? '#fad2cf' : t.priority === 2 ? '#feefc3' : '#e8eaed',
                          color: t.priority === 1 ? '#c5221f' : t.priority === 2 ? '#b06000' : '#202124',
                          fontWeight: 700,
                        }}
                      >
                        P{t.priority}
                      </span>
                    </td>
                    <td>
                      <Pill tone={t.entitlement === 'WARRANTY' ? 'success' : t.entitlement === 'AMC' ? 'info' : 'neutral'}>
                        {t.entitlement}
                      </Pill>
                    </td>
                    <td>
                      <span
                        className="badge"
                        style={{
                          background: t.sla_state === 'BREACHED' ? '#fad2cf' : t.sla_state === 'WARNING' ? '#feefc3' : '#ceead6',
                          color: t.sla_state === 'BREACHED' ? '#c5221f' : t.sla_state === 'WARNING' ? '#b06000' : '#137333',
                          fontWeight: 600,
                        }}
                      >
                        {t.sla_state}
                      </span>
                    </td>
                    <td>{t.technician_name || <em style={{ color: '#70757a' }}>Unassigned</em>}</td>
                    <td>
                      <Pill tone={t.status === 'RESOLVED' ? 'success' : t.status === 'IN_PROGRESS' ? 'info' : 'warning'}>
                        {t.status}
                      </Pill>
                    </td>
                  </tr>
                ))}
                {tickets.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '2rem' }}>
                      No service tickets found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Ticket Details & Timeline Drawer */}
        {selectedTicket && (
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #dadce0',
              borderRadius: '6px',
              padding: '1.25rem',
              height: 'fit-content',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>{selectedTicket.ticket_no}</h3>
                <div style={{ fontSize: '13px', color: '#5f6368' }}>{selectedTicket.subject}</div>
              </div>
              <button className="btn small" onClick={() => setSelectedTicket(null)}>
                ✕
              </button>
            </div>

            <div style={{ background: '#f8f9fa', padding: '0.75rem', borderRadius: '4px', marginBottom: '1rem', fontSize: '12px' }}>
              <div><strong>Customer:</strong> {selectedTicket.customer_name}</div>
              <div><strong>Site Address:</strong> {selectedTicket.site_address}</div>
              <div><strong>Entitlement:</strong> {selectedTicket.entitlement}</div>
              {selectedTicket.serial_number && <div><strong>Serial:</strong> {selectedTicket.serial_number}</div>}
              <div><strong>Assigned Tech:</strong> {selectedTicket.technician_name || 'None'}</div>
              <div><strong>Resolution Due:</strong> {selectedTicket.resolution_due_at ? new Date(selectedTicket.resolution_due_at).toLocaleString() : '—'}</div>
            </div>

            {/* Quick Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem' }}>
              {!selectedTicket.assigned_technician_id && (
                <button className="btn primary" onClick={() => handleAutoAssign(selectedTicket.id)}>
                  ⚡ Auto-Dispatch Technician
                </button>
              )}
              {selectedTicket.status === 'IN_PROGRESS' && (
                <button className="btn warning" onClick={() => handlePause(selectedTicket.id)}>
                  ⏸ Pause SLA Timer (Customer/Parts)
                </button>
              )}
              {(selectedTicket.status === 'AWAITING_CUSTOMER' || selectedTicket.status === 'AWAITING_PARTS') && (
                <button className="btn primary" onClick={() => handleResume(selectedTicket.id)}>
                  ▶ Resume SLA Timer
                </button>
              )}
              {selectedTicket.status !== 'RESOLVED' && selectedTicket.status !== 'CLOSED' && (
                <button className="btn success" onClick={() => handleResolve(selectedTicket.id)}>
                  ✓ Resolve Ticket
                </button>
              )}
            </div>

            {/* Timeline */}
            <h4>Timeline & Events</h4>
            <div style={{ borderLeft: '2px solid #e0e0e0', paddingLeft: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {selectedTicket.events?.map((e: any) => (
                <div key={e.id} style={{ fontSize: '12px' }}>
                  <div style={{ fontWeight: 600 }}>{e.kind}: {e.to_status || ''}</div>
                  <div style={{ color: '#5f6368' }}>{e.body}</div>
                  <div style={{ fontSize: '10px', color: '#80868b' }}>
                    {new Date(e.event_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
