// apps/web/src/pages/service/AmcPage.tsx
import { useEffect, useState } from 'react';
import { PageHead, Pill, inr, dmy } from '../finance/shared';
import { serviceApi, type AmcContract } from '../../lib/serviceApi';

export function AmcPage() {
  const [contracts, setContracts] = useState<AmcContract[]>([]);
  const [selectedAmc, setSelectedAmc] = useState<AmcContract | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadContracts = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await serviceApi.listAmc();
      setContracts(res.rows);
      if (selectedAmc) {
        const full = await serviceApi.getAmc(selectedAmc.id);
        setSelectedAmc(full);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load AMC contracts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadContracts();
  }, []);

  const handleSelect = async (c: AmcContract) => {
    try {
      const full = await serviceApi.getAmc(c.id);
      setSelectedAmc(full);
    } catch (err: any) {
      setError(err.message || 'Failed to load contract details');
    }
  };

  const handleActivate = async (id: string) => {
    try {
      setError('');
      await serviceApi.activateAmc(id);
      loadContracts();
    } catch (err: any) {
      setError(err.message || 'Failed to activate contract');
    }
  };

  const handleRecognise = async (amcId: string, period: string) => {
    try {
      setError('');
      await serviceApi.recogniseRevenue(amcId, period);
      loadContracts();
    } catch (err: any) {
      setError(err.message || 'Failed to recognise revenue');
    }
  };

  return (
    <div className="page-body">
      <PageHead
        title="Annual Maintenance Contracts (AMC)"
        sub="Contract lifecycle, automated visit schedules, billing schedules, and daily straight-line revenue recognition (Ind AS 115)."
      />

      {error && <div className="notice error">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: selectedAmc ? '1fr 500px' : '1fr', gap: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <span className="badge">Total Contracts: {contracts.length}</span>
              <span className="badge" style={{ background: '#e6f4ea', color: '#137333' }}>
                Active: {contracts.filter((c) => c.status === 'ACTIVE').length}
              </span>
            </div>
            <button className="btn primary" onClick={() => alert('New AMC Contract form')}>
              + New AMC Contract
            </button>
          </div>

          {loading ? (
            <p>Loading AMC contracts...</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Contract No</th>
                  <th>Customer</th>
                  <th>Coverage</th>
                  <th>Timeline</th>
                  <th style={{ textAlign: 'right' }}>Contract Value</th>
                  <th>Frequency</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => handleSelect(c)}
                    style={{
                      cursor: 'pointer',
                      background: selectedAmc?.id === c.id ? '#e8f0fe' : undefined,
                    }}
                  >
                    <td><strong>{c.contract_no}</strong></td>
                    <td>{c.customer_name || '—'}</td>
                    <td>{c.coverage}</td>
                    <td>{dmy(c.start_date)} to {dmy(c.end_date)}</td>
                    <td style={{ textAlign: 'right' }}>{inr(c.contract_value)}</td>
                    <td>{c.visit_frequency}</td>
                    <td>
                      <Pill tone={c.status === 'ACTIVE' ? 'success' : 'neutral'}>{c.status}</Pill>
                    </td>
                    <td>
                      {c.status === 'DRAFT' && (
                        <button
                          className="btn small primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleActivate(c.id);
                          }}
                        >
                          Activate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {contracts.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>
                      No AMC contracts found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Contract Schedule & Revenue Recognition Drawer */}
        {selectedAmc && (
          <div style={{ background: '#ffffff', border: '1px solid #dadce0', borderRadius: '6px', padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>{selectedAmc.contract_no}</h3>
                <div style={{ fontSize: '13px', color: '#5f6368' }}>{selectedAmc.customer_name} • {selectedAmc.coverage}</div>
              </div>
              <button className="btn small" onClick={() => setSelectedAmc(null)}>✕</button>
            </div>

            {/* Visit Schedule */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h4>Visit Schedule ({selectedAmc.visitSchedule?.length || 0} visits)</h4>
              <div style={{ maxHeight: '160px', overflowY: 'auto' }}>
                <table className="table" style={{ fontSize: '12px' }}>
                  <thead>
                    <tr>
                      <th>Due Date</th>
                      <th>Serial</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedAmc.visitSchedule?.map((vs: any) => (
                      <tr key={vs.id}>
                        <td>{dmy(vs.due_date)}</td>
                        <td>{vs.serial_number || 'General Site'}</td>
                        <td><Pill tone={vs.status === 'COMPLETED' ? 'success' : 'neutral'}>{vs.status}</Pill></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Revenue Recognition Schedule */}
            <div>
              <h4>Daily Straight-Line Revenue Recognition</h4>
              <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
                <table className="table" style={{ fontSize: '12px' }}>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedAmc.revenueSchedule?.map((rs: any) => (
                      <tr key={rs.id}>
                        <td><strong>{rs.period}</strong></td>
                        <td style={{ textAlign: 'right' }}>{inr(rs.amount)}</td>
                        <td><Pill tone={rs.status === 'RECOGNISED' ? 'success' : 'warning'}>{rs.status}</Pill></td>
                        <td>
                          {rs.status === 'PENDING' && (
                            <button
                              className="btn small primary"
                              onClick={() => handleRecognise(selectedAmc.id, rs.period)}
                            >
                              Recognise
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
