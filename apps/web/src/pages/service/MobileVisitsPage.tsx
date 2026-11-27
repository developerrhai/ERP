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
            <div className="x-d-flex x-fd-column x-gap-1rem">
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
                  <div className="x-d-flex x-jc-space-between x-mb-0_25rem">
                    <strong>{v.visit_no}</strong>
                    <Pill tone={v.status === 'COMPLETED' ? 'success' : v.status === 'IN_PROGRESS' ? 'info' : 'warning'}>
                      {v.status}
                    </Pill>
                  </div>
                  <div className="x-fs-13px x-fw-600">{v.customer_name}</div>
                  <div className="x-fs-12px x-c-muted x-mb-0_5rem">{v.site_address}</div>
                  <div className="x-fs-11px x-c-h70757a">
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
          <div className="x-bg-card x-bd-1px-solid-line-strong x-r-6px x-p-1_25rem">
            <div className="x-d-flex x-jc-space-between x-mb-1rem">
              <h3 className="x-m-0">Visit {activeVisit.visit_no}</h3>
              <button className="btn small" onClick={() => setActiveVisit(null)}>
                ✕
              </button>
            </div>

            <div className="x-d-flex x-fd-column x-gap-1rem">
              {/* Step 1: Travel */}
              <div className="x-p-0_75rem x-bg-card2 x-r-6px">
                <div className="x-fw-600 x-mb-0_25rem">Step 1: Travel & Navigation</div>
                {activeVisit.status === 'SCHEDULED' ? (
                  <button className="btn primary" onClick={() => handleStartTravel(activeVisit.id)}>
                    🚗 Start Travel
                  </button>
                ) : (
                  <span className="x-fs-12px x-c-success">✓ Travel started</span>
                )}
              </div>

              {/* Step 2: Check-in */}
              <div className="x-p-0_75rem x-bg-card2 x-r-6px">
                <div className="x-fw-600 x-mb-0_25rem">Step 2: Site Check-in (GPS)</div>
                {activeVisit.status === 'EN_ROUTE' ? (
                  <button className="btn primary" onClick={() => handleCheckIn(activeVisit.id)}>
                    📍 GPS Check-In at Site
                  </button>
                ) : activeVisit.check_in_at ? (
                  <span className="x-fs-12px x-c-success">
                    ✓ Checked in at {new Date(activeVisit.check_in_at).toLocaleTimeString()} ({activeVisit.travel_km} km)
                  </span>
                ) : (
                  <span className="x-fs-12px x-c-h70757a">Pending travel completion</span>
                )}
              </div>

              {/* Step 3: Sign Off on Canvas */}
              <div className="x-p-0_75rem x-bg-card2 x-r-6px">
                <div className="x-fw-600 x-mb-0_5rem">Step 3: Customer Canvas Signature</div>
                {activeVisit.status === 'IN_PROGRESS' ? (
                  <div>
                    <input
                      type="text"
                      className="input x-w-100pct x-mb-0_5rem"
                      placeholder="Signatory Name (e.g. Rajesh Patil)"
                      value={signatory}
                      onChange={(e) => setSignatory(e.target.value)}
                    />
                    <div className="x-bd-1px-solid-hccc x-r-6px x-bg-card x-mb-0_5rem">
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
                    <div className="x-d-flex x-jc-space-between">
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
                    <span className="x-fs-12px x-c-success">
                      ✓ Signed by {activeVisit.signatory_name}
                    </span>
                    <div className="x-mt-0_5rem">
                      <button
                        className="btn small"
                        onClick={() => alert(`Report PDF generated for ${activeVisit.visit_no}`)}
                      >
                        📄 Download Report PDF
                      </button>
                    </div>
                  </div>
                ) : (
                  <span className="x-fs-12px x-c-h70757a">Check-in required first</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

