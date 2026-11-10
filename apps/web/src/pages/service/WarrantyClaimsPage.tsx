// apps/web/src/pages/service/WarrantyClaimsPage.tsx
import { useEffect, useState } from 'react';
import { PageHead, Pill, inr, dmy } from '../finance/shared';
import { serviceApi, type WarrantyCheck } from '../../lib/serviceApi';

export function WarrantyClaimsPage() {
  const [serialQuery, setSerialQuery] = useState('SN-2026-001');
  const [checkResult, setCheckResult] = useState<WarrantyCheck | null>(null);
  const [claims, setClaims] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadClaims = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await serviceApi.listClaims();
      setClaims(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load claims');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClaims();
  }, []);

  const handleCheck = async () => {
    if (!serialQuery.trim()) return;
    try {
      setError('');
      const res = await serviceApi.checkWarranty(serialQuery);
      setCheckResult(res);
    } catch (err: any) {
      setError(err.message || 'Failed to verify warranty');
    }
  };

  const handleSettle = async (claimId: string, amount: number) => {
    try {
      setError('');
      await serviceApi.settleClaim(claimId, { settledAmount: amount });
      loadClaims();
    } catch (err: any) {
      setError(err.message || 'Failed to settle claim');
    }
  };

  return (
    <div className="page-body">
      <PageHead
        title="Warranty Entitlement & Back-to-Back Claims"
        sub="Instant serial warranty check with anniversary end-date rules, failure inspection, and back-to-back supplier settlements."
      />

      {error && <div className="notice error">{error}</div>}

      {/* Serial Lookup Tool */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '2rem', background: '#f8f9fa', border: '1px solid #dadce0' }}>
        <h4 style={{ margin: '0 0 0.75rem 0' }}>Equipment Serial Warranty Lookup</h4>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <input
            type="text"
            className="input"
            value={serialQuery}
            onChange={(e) => setSerialQuery(e.target.value)}
            placeholder="Enter Serial Number (e.g. SN-2026-001)"
            style={{ width: '280px' }}
          />
          <button className="btn primary" onClick={handleCheck}>
            🔍 Verify Warranty Status
          </button>
        </div>

        {checkResult && (
          <div
            style={{
              marginTop: '1rem',
              padding: '1rem',
              borderRadius: '4px',
              border: checkResult.result === 'IN_WARRANTY' || checkResult.result === 'AMC_COVERED'
                ? '1px solid #ceead6'
                : '1px solid #fad2cf',
              background: checkResult.result === 'IN_WARRANTY' || checkResult.result === 'AMC_COVERED'
                ? '#e6f4ea'
                : '#fce8e6',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <strong style={{ fontSize: '15px' }}>
                Serial: {checkResult.serial} ({checkResult.itemName || 'Equipment'})
              </strong>
              <span
                className="badge"
                style={{
                  background: checkResult.result === 'IN_WARRANTY' ? '#137333' : checkResult.result === 'AMC_COVERED' ? '#1a73e8' : '#c5221f',
                  color: '#ffffff',
                  fontWeight: 700,
                }}
              >
                {checkResult.result}
              </span>
            </div>
            {checkResult.customerName && <div>Customer: {checkResult.customerName}</div>}
            {checkResult.warrantyEnd && (
              <div>Warranty Valid Until: {dmy(checkResult.warrantyEnd)}</div>
            )}
            <ul style={{ margin: '0.5rem 0 0 1rem', padding: 0, fontSize: '12px' }}>
              {checkResult.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Claims List */}
      <div>
        <h3>Warranty Claims & Supplier Recoveries</h3>
        {loading ? (
          <p>Loading claims...</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Claim No</th>
                <th>Serial</th>
                <th>Customer</th>
                <th>Failure Date</th>
                <th>Problem</th>
                <th>Decision</th>
                <th>Supplier</th>
                <th style={{ textAlign: 'right' }}>Claim Amount</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.claim_no}</strong></td>
                  <td>{c.serial_number}</td>
                  <td>{c.customer_name}</td>
                  <td>{dmy(c.failure_date)}</td>
                  <td>{c.problem_description}</td>
                  <td><Pill tone={c.decision === 'REPLACE' ? 'info' : c.decision === 'REPAIR' ? 'warning' : 'neutral'}>{c.decision}</Pill></td>
                  <td>{c.supplier_name || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{inr(c.supplier_claim_amount)}</td>
                  <td><Pill tone={c.status === 'SETTLED' ? 'success' : 'warning'}>{c.status}</Pill></td>
                  <td>
                    {c.status === 'CLAIMED_SUPPLIER' && (
                      <button
                        className="btn small primary"
                        onClick={() => handleSettle(c.id, Number(c.supplier_claim_amount))}
                      >
                        Settle Claim
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {claims.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', padding: '2rem' }}>
                    No warranty claims recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

