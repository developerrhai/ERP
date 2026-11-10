// apps/web/src/pages/service/TechnicianBoardPage.tsx
import { useEffect, useState } from 'react';
import { PageHead, Pill } from '../finance/shared';
import { serviceApi, type ServiceTicket } from '../../lib/serviceApi';

export function TechnicianBoardPage() {
  const [board, setBoard] = useState<{
    unassignedTickets: ServiceTicket[];
    lanes: Array<{ technician: any; assignedTickets: ServiceTicket[] }>;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadBoard = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await serviceApi.getTechnicianBoard();
      setBoard(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load technician board');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBoard();
  }, []);

  return (
    <div className="page-body">
      <PageHead
        title="Technician Dispatch Board"
        sub="Dispatch lanes per technician with real-time job load, skill levels, and unassigned backlog."
      />

      {error && <div className="notice error">{error}</div>}

      {loading ? (
        <p>Loading technician board...</p>
      ) : board ? (
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '1.5rem' }}>
          {/* Unassigned Tickets Queue */}
          <div style={{ background: '#fce8e6', borderRadius: '6px', border: '1px solid #fad2cf', overflow: 'hidden' }}>
            <div style={{ padding: '0.75rem 1rem', background: '#fad2cf', fontWeight: 700, color: '#c5221f' }}>
              Unassigned Backlog ({board.unassignedTickets.length})
            </div>
            <div style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '600px', overflowY: 'auto' }}>
              {board.unassignedTickets.map((t) => (
                <div key={t.id} style={{ background: '#ffffff', border: '1px solid #fad2cf', borderRadius: '4px', padding: '0.75rem' }}>
                  <div style={{ fontWeight: 600, color: '#c5221f' }}>{t.ticket_no}</div>
                  <div style={{ fontSize: '12px', marginBottom: '0.25rem' }}>{t.subject}</div>
                  <div style={{ fontSize: '11px', color: '#5f6368', marginBottom: '0.5rem' }}>{t.customer_name}</div>
                  <div style={{ fontSize: '11px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="badge">P{t.priority}</span>
                    <button
                      className="btn small primary"
                      style={{ padding: '1px 6px', fontSize: '11px' }}
                      onClick={() => serviceApi.autoAssignTicket(t.id).then(loadBoard)}
                    >
                      ⚡ Auto Dispatch
                    </button>
                  </div>
                </div>
              ))}
              {board.unassignedTickets.length === 0 && (
                <p style={{ textAlign: 'center', color: '#70757a', fontSize: '12px', marginTop: '2rem' }}>
                  No unassigned tickets
                </p>
              )}
            </div>
          </div>

          {/* Technician Lanes */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, board.lanes.length)}, 280px)`, gap: '1rem', overflowX: 'auto' }}>
            {board.lanes.map((lane) => {
              const tech = lane.technician;
              const load = lane.assignedTickets.length;
              const max = tech.max_open_jobs || 5;
              const isFull = load >= max;

              return (
                <div
                  key={tech.id}
                  style={{
                    background: '#f8f9fa',
                    border: '1px solid #dadce0',
                    borderRadius: '6px',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div style={{ padding: '0.75rem 1rem', background: '#e8eaed', borderBottom: '1px solid #dadce0' }}>
                    <div style={{ fontWeight: 700 }}>{tech.name}</div>
                    <div style={{ fontSize: '11px', color: '#5f6368', display: 'flex', justifyContent: 'space-between' }}>
                      <span>{tech.emp_code}</span>
                      <span style={{ fontWeight: 600, color: isFull ? '#c5221f' : '#137333' }}>
                        Load: {load}/{max}
                      </span>
                    </div>
                  </div>

                  <div style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', flex: 1, maxHeight: '600px', overflowY: 'auto' }}>
                    {lane.assignedTickets.map((t) => (
                      <div key={t.id} style={{ background: '#ffffff', border: '1px solid #dadce0', borderRadius: '4px', padding: '0.75rem' }}>
                        <div style={{ fontWeight: 600 }}>{t.ticket_no}</div>
                        <div style={{ fontSize: '12px', marginBottom: '0.25rem' }}>{t.subject}</div>
                        <div style={{ fontSize: '11px', color: '#5f6368', marginBottom: '0.5rem' }}>{t.customer_name}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Pill tone={t.status === 'IN_PROGRESS' ? 'info' : 'warning'}>{t.status}</Pill>
                          <span className="badge">P{t.priority}</span>
                        </div>
                      </div>
                    ))}
                    {lane.assignedTickets.length === 0 && (
                      <p style={{ textAlign: 'center', color: '#70757a', fontSize: '12px', marginTop: '2rem' }}>
                        No assigned active jobs
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
