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
      <div className="kpis x-d-grid x-cols-repeat-4-1fr x-gap-12px x-m-14px-0">
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Active Snapshots</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">14 Snapshots</b>
          <span className="x-fs-11px x-c-success">Continuous WAL archiving</span>
        </div>
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Backup Schedule</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">Daily 02:00 IST</b>
          <span className="x-fs-11px x-c-primary">Automated Cron + Pre-Deploy</span>
        </div>
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Recovery Target</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">RPO 5m / RTO 15m</b>
          <span className="x-fs-11px x-c-success">High Availability Cluster</span>
        </div>
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Data Quality</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">100%</b>
          <span className="x-fs-11px x-c-success">Checksum Verified</span>
        </div>
      </div>

      {/* Split View: Backup & Restore Workspace + Data Operation Summary */}
      <div className="x-d-grid x-cols-minmax-0-1_8fr-minmax-280px-1fr x-gap-14px x-m-14px-0">
        <div className="card table-wrap x-p-14px x-bg-card x-r-10px x-bd-1px-solid-line-strong">
          <div className="x-d-flex x-jc-space-between x-ai-center x-mb-12px">
            <h3 className="x-m-0 x-fs-14px x-c-text">Backup &amp; Restore Workspace</h3>
            <div className="x-d-flex x-gap-6px">
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

        <div className="card x-p-14px x-bg-card x-r-10px x-bd-1px-solid-line-strong">
          <h3 className="x-m-0-0-10px-0 x-fs-14px x-c-text">Data Operation Summary</h3>
          <p className="x-fs-12px x-c-muted x-m-0-0-12px-0">
            Snapshot verification, retention lifecycle and replication status.
          </p>
          <div className="x-d-flex x-fd-column x-gap-8px x-fs-12px">
            <div className="x-d-flex x-jc-space-between x-pb-6px x-bb-1px-solid-line">
              <span>Primary DB Size:</span>
              <strong>1.28 GB</strong>
            </div>
            <div className="x-d-flex x-jc-space-between x-pb-6px x-bb-1px-solid-line">
              <span>WAL Retention:</span>
              <strong>7 Days Continuous</strong>
            </div>
            <div className="x-d-flex x-jc-space-between x-pb-6px x-bb-1px-solid-line">
              <span>Off-site S3 Glacier:</span>
              <strong className="x-c-success">Synced (ap-south-1)</strong>
            </div>
            <div className="x-d-flex x-jc-space-between">
              <span>Last Test Drill:</span>
              <strong className="x-c-success">Passed (17 Nov 2026)</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Detailed Table */}
      <div className="card table-wrap x-mb-18px">
        <div className="x-d-flex x-jc-space-between x-ai-center x-p-12px-14px-6px-14px">
          <h3 className="x-m-0 x-fs-14px x-c-text">Database Snapshots Detailed Register</h3>
          <span className="x-fs-12px x-c-muted">Point-in-time recovery archives</span>
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
      <div className="x-mt-24px">
        <button
          type="button"
          className="btn x-mb-12px"
          onClick={() => setShowDpdp(!showDpdp)}
        >
          {showDpdp ? '▲ Hide Go-Live Hardening & DPDP Console' : '▼ Show Go-Live Hardening, Cut-Over & DPDP Compliance Tools'}
        </button>
        {showDpdp && (
          <div className="x-bd-1px-solid-line-strong x-r-8px x-p-12px x-bg-card2">
            <HardeningPage />
          </div>
        )}
      </div>
    </>
  );
}
