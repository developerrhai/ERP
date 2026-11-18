// Backup & Restore (admin-backup): Automated backups, disaster recovery, and point-in-time restore.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { HardeningPage } from './HardeningPage';

interface BackupSnapshot {
  id: string;
  name: string;
  type: 'AUTOMATED' | 'MANUAL' | 'PRE_DEPLOY';
  sizeMb: number;
  tables: number;
  status: 'COMPLETED' | 'IN_PROGRESS' | 'FAILED';
  createdAt: string;
  checksum: string;
}

const DEFAULT_SNAPSHOTS: BackupSnapshot[] = [
  { id: 'snp-1', name: 'Daily Automated Nightly Snapshot', type: 'AUTOMATED', sizeMb: 248.5, tables: 184, status: 'COMPLETED', createdAt: '2026-11-18 02:00:15 IST', checksum: 'sha256:7f8a9b1c...' },
  { id: 'snp-2', name: 'Pre-Deployment V40 Migration Backup', type: 'PRE_DEPLOY', sizeMb: 246.1, tables: 184, status: 'COMPLETED', createdAt: '2026-11-17 19:30:00 IST', checksum: 'sha256:4a5b6c7d...' },
  { id: 'snp-3', name: 'Daily Automated Nightly Snapshot', type: 'AUTOMATED', sizeMb: 244.8, tables: 184, status: 'COMPLETED', createdAt: '2026-11-17 02:00:10 IST', checksum: 'sha256:1e2f3a4b...' },
  { id: 'snp-4', name: 'Weekly Off-Site S3 Cold Storage Archive', type: 'MANUAL', sizeMb: 242.0, tables: 184, status: 'COMPLETED', createdAt: '2026-11-15 03:00:00 IST', checksum: 'sha256:9c8d7e6f...' },
];

export function BackupRestorePage() {
  const toast = useToast();
  const [snapshots] = useState<BackupSnapshot[]>(DEFAULT_SNAPSHOTS);
  const [showDpdp, setShowDpdp] = useState(false);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Backup &amp; Disaster Recovery Workspace</h1>
          <p>Automated database snapshots, point-in-time recovery, cold storage archiving and DPDP compliance.</p>
        </div>
        <div className="actions">
          <Link className="btn" to="/m/admin-settings">
            ← System Setup
          </Link>
          <button
            type="button"
            className="btn primary"
            onClick={() => toast('Triggered manual on-demand database snapshot.')}
          >
            ＋ Create Snapshot
          </button>
        </div>
      </div>

      {/* 4 Top Summary Cards (Demo ERP Baseline) */}
      <div className="kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, margin: '14px 0' }}>
        <div className="kpi" style={{ padding: 12, background: '#fff', borderRadius: 8, border: '1px solid #cbd5e1' }}>
          <small style={{ color: '#64748b' }}>Active Snapshots</small>
          <b style={{ fontSize: 18, color: '#1e293b', display: 'block', margin: '4px 0' }}>14 Snapshots</b>
          <span style={{ fontSize: 11, color: '#15803d' }}>Continuous WAL archiving</span>
        </div>
        <div className="kpi" style={{ padding: 12, background: '#fff', borderRadius: 8, border: '1px solid #cbd5e1' }}>
          <small style={{ color: '#64748b' }}>Backup Schedule</small>
          <b style={{ fontSize: 18, color: '#1e293b', display: 'block', margin: '4px 0' }}>Daily 02:00 IST</b>
          <span style={{ fontSize: 11, color: '#2563eb' }}>Automated Cron + Pre-Deploy</span>
        </div>
        <div className="kpi" style={{ padding: 12, background: '#fff', borderRadius: 8, border: '1px solid #cbd5e1' }}>
          <small style={{ color: '#64748b' }}>Recovery Target</small>
          <b style={{ fontSize: 18, color: '#1e293b', display: 'block', margin: '4px 0' }}>RPO 5m / RTO 15m</b>
          <span style={{ fontSize: 11, color: '#15803d' }}>High Availability Cluster</span>
        </div>
        <div className="kpi" style={{ padding: 12, background: '#fff', borderRadius: 8, border: '1px solid #cbd5e1' }}>
          <small style={{ color: '#64748b' }}>Data Quality</small>
          <b style={{ fontSize: 18, color: '#1e293b', display: 'block', margin: '4px 0' }}>100%</b>
          <span style={{ fontSize: 11, color: '#15803d' }}>Checksum Verified</span>
        </div>
      </div>

      {/* Split View: Backup & Restore Workspace + Data Operation Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.8fr) minmax(280px, 1fr)', gap: 14, margin: '14px 0' }}>
        <div className="card table-wrap" style={{ padding: 14, background: '#fff', borderRadius: 10, border: '1px solid #cbd5e1' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14, color: '#1e293b' }}>Backup &amp; Restore Workspace</h3>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="btn sm primary"
                onClick={() => toast('Run Backup & Restore Workspace: Dry-run recovery drill initiated.')}
              >
                Run Backup &amp; Restore Workspace
              </button>
              <button
                type="button"
                className="btn sm"
                onClick={() => toast('Exported backup manifest to Excel.')}
              >
                Export Excel
              </button>
            </div>
          </div>
          <table className="register-table">
            <thead>
              <tr>
                <th>Snapshot Name</th>
                <th>Type</th>
                <th>Size</th>
                <th>Tables</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.slice(0, 3).map(s => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong></td>
                  <td><span className="chip">{s.type}</span></td>
                  <td>{s.sizeMb} MB</td>
                  <td>{s.tables} tables</td>
                  <td><span className="status active">{s.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ padding: 14, background: '#fff', borderRadius: 10, border: '1px solid #cbd5e1' }}>
          <h3 style={{ margin: '0 0 10px 0', fontSize: 14, color: '#1e293b' }}>Data Operation Summary</h3>
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px 0' }}>
            Snapshot verification, retention lifecycle and replication status.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid #f1f5f9' }}>
              <span>Primary DB Size:</span>
              <strong>1.28 GB</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid #f1f5f9' }}>
              <span>WAL Retention:</span>
              <strong>7 Days Continuous</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid #f1f5f9' }}>
              <span>Off-site S3 Glacier:</span>
              <strong style={{ color: '#15803d' }}>Synced (ap-south-1)</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Last Test Drill:</span>
              <strong style={{ color: '#15803d' }}>Passed (17 Nov 2026)</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Detailed Table */}
      <div className="card table-wrap" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px 6px 14px' }}>
          <h3 style={{ margin: 0, fontSize: 14, color: '#1e293b' }}>Database Snapshots Detailed Register</h3>
          <span style={{ fontSize: 12, color: '#64748b' }}>Point-in-time recovery archives</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Snapshot ID</th>
              <th>Name</th>
              <th>Type</th>
              <th>Size</th>
              <th>Created At</th>
              <th>Checksum</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.map(s => (
              <tr key={s.id}>
                <td><code>{s.id}</code></td>
                <td><strong>{s.name}</strong></td>
                <td><span className="chip">{s.type}</span></td>
                <td>{s.sizeMb} MB</td>
                <td>{s.createdAt}</td>
                <td><code style={{ fontSize: 11 }}>{s.checksum}</code></td>
                <td><span className="status active">{s.status}</span></td>
                <td>
                  <div className="actions">
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => toast(`Restoring ${s.name} requires master passkey confirmation.`)}
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => toast(`Checksum verified: ${s.checksum}`)}
                    >
                      Verify
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tabbed / Integrated DPDP & Partition Tools */}
      <div style={{ marginTop: 24 }}>
        <button
          type="button"
          className="btn"
          style={{ marginBottom: 12 }}
          onClick={() => setShowDpdp(!showDpdp)}
        >
          {showDpdp ? '▲ Hide Go-Live Hardening & DPDP Console' : '▼ Show Go-Live Hardening, Cut-Over & DPDP Compliance Tools'}
        </button>
        {showDpdp && (
          <div style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: 12, background: '#f8fafc' }}>
            <HardeningPage />
          </div>
        )}
      </div>
    </>
  );
}
