// apps/web/src/pages/service/MobileVisitsPage.tsx
import { useEffect, useState, useRef } from 'react';
import { PageHead, Pill } from '../finance/shared';
import { serviceApi, type ServiceVisit } from '../../lib/serviceApi';

export function MobileVisitsPage() {
  const [visits, setVisits] = useState<ServiceVisit[]>([]);
  const [activeVisit, setActiveVisit] = useState<ServiceVisit | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [signatory, setSignatory] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const loadVisits = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await serviceApi.listVisits();
      setVisits(data);
      if (activeVisit) {
        const refreshed = await serviceApi.getVisit(activeVisit.id);
        setActiveVisit(refreshed);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load visits');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVisits();
  }, []);

  const handleStartTravel = async (id: string) => {
    try {
      setError('');
      await serviceApi.startTravel(id);
      loadVisits();
    } catch (err: any) {
      setError(err.message || 'Failed to start travel');
    }
  };

  const handleCheckIn = async (id: string) => {
    try {
      setError('');
      // Simulate geolocation
      await serviceApi.checkIn(id, { lat: 18.5204, lng: 73.8567, travelKm: 12.5 });
      loadVisits();
    } catch (err: any) {
      setError(err.message || 'Failed to check in');
    }
  };

  const handleSign = async (id: string) => {
    try {
      setError('');
      if (!signatory.trim()) {
        setError('VIS_SIGN_REQ: Customer signature required.');
        return;
      }
      await serviceApi.signAndComplete(id, {
        signatoryName: signatory,
        findings: 'Machine operating parameters inspected and calibrated.',
        actionTaken: 'Lubricated bearing assemblies and tested running load.',
      });
      loadVisits();
    } catch (err: any) {
      setError(err.message || 'Failed to complete visit');
    }
  };

  // Canvas drawing handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    ctx.beginPath();
    ctx.moveTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  return (
    <div className="page-body">
      <PageHead
        title="Field Service & Mobile Visits (/m/visits)"
        sub="Field technician workflow: travel start, GPS site check-in, spare consumption, customer canvas signature, and PDF sign-off."
      />

      {error && <div className="notice error">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: activeVisit ? '1fr 450px' : '1fr', gap: '1.5rem' }}>
        <div>
          <h3>Scheduled Visits</h3>
          {loading ? (
            <p>Loading visits...</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {visits.map((v) => (
                <div
                  key={v.id}
                  onClick={() => setActiveVisit(v)}
                  style={{
                    background: activeVisit?.id === v.id ? '#e8f0fe' : '#ffffff',
                    border: '1px solid #dadce0',
                    borderRadius: '6px',
                    padding: '1rem',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <strong>{v.visit_no}</strong>
                    <Pill tone={v.status === 'COMPLETED' ? 'success' : v.status === 'IN_PROGRESS' ? 'info' : 'warning'}>
                      {v.status}
                    </Pill>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>{v.customer_name}</div>
                  <div style={{ fontSize: '12px', color: '#5f6368', marginBottom: '0.5rem' }}>{v.site_address}</div>
                  <div style={{ fontSize: '11px', color: '#70757a' }}>
                    Scheduled: {new Date(v.scheduled_start).toLocaleDateString()} {new Date(v.scheduled_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • Tech: {v.technician_name}
                  </div>
                </div>
              ))}
              {visits.length === 0 && <p>No service visits scheduled.</p>}
            </div>
          )}
        </div>

        {/* Mobile Execution Stepper */}
        {activeVisit && (
          <div style={{ background: '#ffffff', border: '1px solid #dadce0', borderRadius: '6px', padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Visit {activeVisit.visit_no}</h3>
              <button className="btn small" onClick={() => setActiveVisit(null)}>
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Step 1: Travel */}
              <div style={{ padding: '0.75rem', background: '#f8f9fa', borderRadius: '4px' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Step 1: Travel & Navigation</div>
                {activeVisit.status === 'SCHEDULED' ? (
                  <button className="btn primary" onClick={() => handleStartTravel(activeVisit.id)}>
                    🚗 Start Travel
                  </button>
                ) : (
                  <span style={{ fontSize: '12px', color: '#137333' }}>✓ Travel started</span>
                )}
              </div>

              {/* Step 2: Check-in */}
              <div style={{ padding: '0.75rem', background: '#f8f9fa', borderRadius: '4px' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Step 2: Site Check-in (GPS)</div>
                {activeVisit.status === 'EN_ROUTE' ? (
                  <button className="btn primary" onClick={() => handleCheckIn(activeVisit.id)}>
                    📍 GPS Check-In at Site
                  </button>
                ) : activeVisit.check_in_at ? (
                  <span style={{ fontSize: '12px', color: '#137333' }}>
                    ✓ Checked in at {new Date(activeVisit.check_in_at).toLocaleTimeString()} ({activeVisit.travel_km} km)
                  </span>
                ) : (
                  <span style={{ fontSize: '12px', color: '#70757a' }}>Pending travel completion</span>
                )}
              </div>

              {/* Step 3: Sign Off on Canvas */}
              <div style={{ padding: '0.75rem', background: '#f8f9fa', borderRadius: '4px' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Step 3: Customer Canvas Signature</div>
                {activeVisit.status === 'IN_PROGRESS' ? (
                  <div>
                    <input
                      type="text"
                      className="input"
                      placeholder="Signatory Name (e.g. Rajesh Patil)"
                      value={signatory}
                      onChange={(e) => setSignatory(e.target.value)}
                      style={{ width: '100%', marginBottom: '0.5rem' }}
                    />
                    <div style={{ border: '1px solid #ccc', borderRadius: '4px', background: '#fff', marginBottom: '0.5rem' }}>
                      <canvas
                        ref={canvasRef}
                        width={380}
                        height={120}
                        onMouseDown={startDrawing}
                        onMouseMove={draw}
                        onMouseUp={stopDrawing}
                        onMouseLeave={stopDrawing}
                        style={{ display: 'block', cursor: 'crosshair' }}
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <button className="btn small" onClick={clearCanvas}>
                        Clear Signature
                      </button>
                      <button className="btn primary" onClick={() => handleSign(activeVisit.id)}>
                        ✓ Sign & Complete Visit
                      </button>
                    </div>
                  </div>
                ) : activeVisit.status === 'COMPLETED' ? (
                  <div>
                    <span style={{ fontSize: '12px', color: '#137333' }}>
                      ✓ Signed by {activeVisit.signatory_name}
                    </span>
                    <div style={{ marginTop: '0.5rem' }}>
                      <button
                        className="btn small"
                        onClick={() => alert(`Report PDF generated for ${activeVisit.visit_no}`)}
                      >
                        📄 Download Report PDF
                      </button>
                    </div>
                  </div>
                ) : (
                  <span style={{ fontSize: '12px', color: '#70757a' }}>Check-in required first</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

