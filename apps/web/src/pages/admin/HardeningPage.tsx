// Phase 20 Hardening Console: Opening-Balance Cut-over & Sign-Off (20-G), DPDP Register &
// Retention Policies (20-J), and Audit Partition Health (20-D).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatInr } from '../../i18n';
import { hardeningApi } from '../../lib/hardeningApi';
import { useToast } from '../../components/Toast';

const DATASETS = [
  'GL_TRIAL',
  'STOCK',
  'AR_OPEN',
  'AP_OPEN',
  'EMPLOYEES_YTD',
  'ASSET_REGISTER',
  'OPEN_PO_SO',
] as const;

export function HardeningPage({ initialTab = 'cutover' }: { initialTab?: 'cutover' | 'dpdp' | 'partitions' }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [tab, setTab] = useState<'cutover' | 'dpdp' | 'partitions'>(initialTab);
  const [batches, setBatches] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [policies, setPolicies] = useState<any[]>([]);
  const [partitions, setPartitions] = useState<{ partitions: any[]; defaultRows: number }>({
    partitions: [],
    defaultRows: 0,
  });

  // Cut-over form
  const [dataset, setDataset] = useState<(typeof DATASETS)[number]>('GL_TRIAL');
  const [legacyTotal, setLegacyTotal] = useState('150000');
  const [rowsJson, setRowsJson] = useState(
    '[{"accountCode":"1101","debit":150000,"credit":0},{"accountCode":"3009","debit":0,"credit":150000}]',
  );

  // DPDP form
  const [reqType, setReqType] = useState<'ACCESS' | 'CORRECTION' | 'ERASURE'>('ACCESS');
  const [principalType, setPrincipalType] = useState<'CUSTOMER' | 'EMPLOYEE' | 'SUPPLIER' | 'CONTACT'>('CUSTOMER');
  const [principalName, setPrincipalName] = useState('');
  const [reqDesc, setReqDesc] = useState('');

  const reloadAll = async () => {
    try {
      const [b, reqs, pols, parts] = await Promise.all([
        hardeningApi.listCutoverBatches().catch(() => []),
        hardeningApi.listDpdpRequests().catch(() => []),
        hardeningApi.listRetentionPolicies().catch(() => []),
        hardeningApi.getAuditPartitions().catch(() => ({ partitions: [], defaultRows: 0 })),
      ]);
      setBatches(b);
      setRequests(reqs);
      setPolicies(pols);
      setPartitions(parts);
    } catch {
      // handled per tab
    }
  };

  useEffect(() => {
    void reloadAll();
  }, []);

  const runDryRun = async () => {
    try {
      const rows = JSON.parse(rowsJson) as Record<string, unknown>[];
      const batch = await hardeningApi.runCutoverDryRun({ dataset, legacyTotal, rows });
      toast(`Dry run ${batch.batchNo}: diff ${formatInr(batch.difference)}`);
      await reloadAll();
    } catch (e: any) {
      toast(e?.message || 'Dry run failed');
    }
  };

  const submitDpdp = async () => {
    if (!principalName.trim() || !reqDesc.trim()) return;
    const created = await hardeningApi.createDpdpRequest({
      requestType: reqType,
      principalType,
      principalName: principalName.trim(),
      description: reqDesc.trim(),
    });
    toast(`Created ${created.requestNo}`);
    setPrincipalName('');
    setReqDesc('');
    await reloadAll();
  };

  return (
    <div className="page-pad" style={{ padding: 16 }}>
      <div className="page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Go-Live Hardening, Cut-Over & DPDP Compliance</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            Opening-balance reconciliation, DPDP Act request register (30-day SLA), and audit partition status.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className={`btn ${tab === 'cutover' ? 'primary' : ''}`} onClick={() => setTab('cutover')}>
            {t('cutover.title')}
          </button>
          <button type="button" className={`btn ${tab === 'dpdp' ? 'primary' : ''}`} onClick={() => setTab('dpdp')}>
            DPDP Register
          </button>
          <button type="button" className={`btn ${tab === 'partitions' ? 'primary' : ''}`} onClick={() => setTab('partitions')}>
            Audit Partitions
          </button>
        </div>
      </div>

      {tab === 'cutover' ? (
        <div className="card" style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: 16 }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>{t('cutover.dryRun')}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}>
              Dataset *
              <select value={dataset} onChange={(e) => setDataset(e.target.value as any)} style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}>
                {DATASETS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              Legacy Control Total (INR) *
              <input value={legacyTotal} onChange={(e) => setLegacyTotal(e.target.value)} style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }} />
            </label>
          </div>
          <label style={{ fontSize: 13, display: 'block', marginBottom: 10 }}>
            Rows JSON *
            <textarea rows={3} value={rowsJson} onChange={(e) => setRowsJson(e.target.value)} style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }} />
          </label>
          <button type="button" className="btn primary" onClick={() => void runDryRun()}>
            {t('cutover.dryRun')}
          </button>

          <table style={{ width: '100%', marginTop: 16, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)' }}>
                <th style={{ padding: 8 }}>Batch</th>
                <th style={{ padding: 8 }}>Dataset</th>
                <th style={{ padding: 8 }}>Legacy Total</th>
                <th style={{ padding: 8 }}>ERP Total</th>
                <th style={{ padding: 8 }}>Difference</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: 8 }}>{b.batchNo}</td>
                  <td style={{ padding: 8 }}>{b.dataset}</td>
                  <td style={{ padding: 8 }}>{formatInr(b.legacyTotal)}</td>
                  <td style={{ padding: 8 }}>{formatInr(b.erpTotal)}</td>
                  <td style={{ padding: 8 }}>{formatInr(b.difference)}</td>
                  <td style={{ padding: 8 }}>{b.status}</td>
                  <td style={{ padding: 8, display: 'flex', gap: 6 }}>
                    {b.status === 'VALIDATED' ? (
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() => void hardeningApi.commitCutoverBatch(b.id).then(reloadAll)}
                      >
                        {t('cutover.commit')}
                      </button>
                    ) : null}
                    {b.status === 'COMMITTED' ? (
                      <button
                        type="button"
                        className="btn success"
                        onClick={() => void hardeningApi.signOffCutoverBatch(b.id, {}).then(reloadAll)}
                      >
                        {t('cutover.signOff')}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === 'dpdp' ? (
        <div className="card" style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: 16 }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>{t('dpdp.requestRegister')}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
            <label style={{ fontSize: 13 }}>
              Type
              <select value={reqType} onChange={(e) => setReqType(e.target.value as any)} style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}>
                <option value="ACCESS">ACCESS</option>
                <option value="CORRECTION">CORRECTION</option>
                <option value="ERASURE">ERASURE</option>
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              Principal Type
              <select value={principalType} onChange={(e) => setPrincipalType(e.target.value as any)} style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}>
                <option value="CUSTOMER">CUSTOMER</option>
                <option value="EMPLOYEE">EMPLOYEE</option>
                <option value="SUPPLIER">SUPPLIER</option>
                <option value="CONTACT">CONTACT</option>
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              Data Principal Name *
              <input value={principalName} onChange={(e) => setPrincipalName(e.target.value)} style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }} />
            </label>
          </div>
          <label style={{ fontSize: 13, display: 'block', marginBottom: 10 }}>
            Request Description *
            <input value={reqDesc} onChange={(e) => setReqDesc(e.target.value)} style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }} />
          </label>
          <button type="button" className="btn primary" onClick={() => void submitDpdp()}>
            Log Request (30-Day SLA)
          </button>

          <h3 style={{ marginTop: 18, fontSize: 15 }}>Active Requests ({requests.length})</h3>
          <ul style={{ fontSize: 13 }}>
            {requests.map((r) => (
              <li key={r.id}>
                <strong>{r.requestNo}</strong> · {r.requestType} · {r.principalName} · {r.status} ({r.daysRemaining}d remaining)
              </li>
            ))}
          </ul>

          <h3 style={{ marginTop: 18, fontSize: 15 }}>{t('dpdp.retentionPolicies')}</h3>
          <button type="button" className="btn" onClick={() => void hardeningApi.runRetentionSweep().then(reloadAll)}>
            Run Retention & Anonymisation Sweep
          </button>
          <ul style={{ fontSize: 13 }}>
            {policies.map((p) => (
              <li key={p.id}>
                <strong>{p.dataCategory}</strong>: {p.retentionDays} days — {p.legalBasis}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === 'partitions' ? (
        <div className="card" style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: 16 }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>PostgreSQL Monthly Audit Log Partitions</h2>
          <p style={{ fontSize: 13 }}>
            DEFAULT Partition Rows: <strong>{partitions.defaultRows}</strong> (must be 0). Total Partitions:{' '}
            <strong>{partitions.partitions.length}</strong>
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={() => void hardeningApi.maintainAuditPartitions().then(reloadAll)}
          >
            Pre-Create Next 3 Months Partitions
          </button>
          <ul style={{ fontSize: 13, marginTop: 12 }}>
            {partitions.partitions.map((p) => (
              <li key={p.partitionName}>
                <code>{p.partitionName}</code> — {p.rangeBound}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

