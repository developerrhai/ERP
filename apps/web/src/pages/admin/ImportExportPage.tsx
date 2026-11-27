// Import / Export Workspace (admin-import): Universal CSV/Excel bulk import, data migration and template generator.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';

interface ImportJob {
  id: string;
  name: string;
  entity: string;
  records: number;
  validRows: number;
  errorRows: number;
  status: 'COMPLETED' | 'VALIDATED' | 'FAILED' | 'PENDING';
  executedAt: string;
}

const DEFAULT_JOBS: ImportJob[] = [
  { id: 'imp-101', name: 'Item Master Opening Catalog', entity: 'Items / Raw Materials', records: 1240, validRows: 1240, errorRows: 0, status: 'COMPLETED', executedAt: '2026-11-17 14:10 IST' },
  { id: 'imp-102', name: 'Vendor Directory Cut-over', entity: 'Suppliers / Vendors', records: 148, validRows: 148, errorRows: 0, status: 'COMPLETED', executedAt: '2026-11-17 11:20 IST' },
  { id: 'imp-103', name: 'Customer Master Data (GST Compliant)', entity: 'Customers', records: 320, validRows: 318, errorRows: 2, status: 'VALIDATED', executedAt: '2026-11-16 16:45 IST' },
  { id: 'imp-104', name: 'Chart of Accounts FY26-27 Opening GL', entity: 'GL Accounts', records: 215, validRows: 215, errorRows: 0, status: 'COMPLETED', executedAt: '2026-11-15 09:30 IST' },
];

export function ImportExportPage() {
  const toast = useToast();
  const [jobs] = useState<ImportJob[]>(DEFAULT_JOBS);
  const [selectedEntity, setSelectedEntity] = useState('Items');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Import / Export Workspace</h1>
          <p>Bulk master and transactional data migration with pre-import validation, format checking and rollback guardrails.</p>
        </div>
        <div className="actions">
          <Link className="btn" to="/m/admin-settings">
            ← System Setup
          </Link>
          <button
            type="button"
            className="btn primary"
            onClick={() => toast('Select CSV or XLSX file to begin staged bulk upload.')}
          >
            ＋ Upload File
          </button>
        </div>
      </div>

      {/* 4 Top Summary Cards (Demo ERP Baseline) */}
      <div className="kpis x-d-grid x-cols-repeat-4-1fr x-gap-12px x-m-14px-0">
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Active Workspaces</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">12 Data Entities</b>
          <span className="x-fs-11px x-c-success">Items, Customers, Vendors, GL...</span>
        </div>
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Batch Processing Limit</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">10,000 Rows</b>
          <span className="x-fs-11px x-c-primary">Transactional Atomicity</span>
        </div>
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Validation Guardrails</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">Schema &amp; Tax Checked</b>
          <span className="x-fs-11px x-c-success">Pre-Flight Simulation</span>
        </div>
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Data Quality</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">99.9%</b>
          <span className="x-fs-11px x-c-success">Zero Corrupt Imports</span>
        </div>
      </div>

      {/* Split View: Import/Export Workspace + Data Operation Summary */}
      <div className="x-d-grid x-cols-minmax-0-1_8fr-minmax-280px-1fr x-gap-14px x-m-14px-0">
        <div className="card table-wrap x-p-14px x-bg-card x-r-10px x-bd-1px-solid-line-strong">
          <div className="x-d-flex x-jc-space-between x-ai-center x-mb-12px">
            <h3 className="x-m-0 x-fs-14px x-c-text">Import / Export Workspace</h3>
            <div className="x-d-flex x-gap-6px">
              <button
                type="button"
                className="btn sm primary"
                onClick={() => toast('Run Import/Export Workspace: Processing active batch queue.')}
              >
                Run Import/Export Workspace
              </button>
              <button
                type="button"
                className="btn sm"
                onClick={() => toast('Exported active entity data to formatted Excel sheet.')}
              >
                Export Excel
              </button>
            </div>
          </div>
          <table className="register-table">
            <thead>
              <tr>
                <th>Job Name</th>
                <th>Entity Target</th>
                <th>Rows</th>
                <th>Valid</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {jobs.slice(0, 3).map(j => (
                <tr key={j.id}>
                  <td><strong>{j.name}</strong></td>
                  <td>{j.entity}</td>
                  <td>{j.records}</td>
                  <td style={{ color: '#15803d' }}>{j.validRows}</td>
                  <td><span className={`status ${j.status === 'COMPLETED' ? 'active' : 'inactive'}`}>{j.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card x-p-14px x-bg-card x-r-10px x-bd-1px-solid-line-strong">
          <h3 className="x-m-0-0-10px-0 x-fs-14px x-c-text">Data Operation Summary</h3>
          <p className="x-fs-12px x-c-muted x-m-0-0-12px-0">
            Template downloads and batch migration controls.
          </p>
          <div className="x-d-flex x-fd-column x-gap-8px x-fs-12px">
            <label className="x-d-flex x-fd-column x-gap-4px">
              <span>Target Entity:</span>
              <select
                value={selectedEntity}
                onChange={(e) => setSelectedEntity(e.target.value)}
                className="x-p-6px-8px x-fs-12px x-bd-1px-solid-line-strong x-r-6px"
              >
                <option value="Items">Item Master (Products &amp; Spares)</option>
                <option value="Vendors">Vendor Directory</option>
                <option value="Customers">Customer Master</option>
                <option value="GL">Chart of Accounts &amp; Open Balances</option>
                <option value="BOM">Bill of Materials (Multi-Level)</option>
              </select>
            </label>
            <button
              type="button"
              className="btn sm x-mt-4px"
              onClick={() => toast(`Downloaded blank CSV template for ${selectedEntity} with column headers and sample data.`)}
            >
              Download Sample Template
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => toast('All schema validations passed for active workspace.')}
            >
              Verify Mapping Headers
            </button>
          </div>
        </div>
      </div>

      {/* Detailed Table */}
      <div className="card table-wrap">
        <div className="x-d-flex x-jc-space-between x-ai-center x-p-12px-14px-6px-14px">
          <h3 className="x-m-0 x-fs-14px x-c-text">Batch Import &amp; Export Detailed Log</h3>
          <span className="x-fs-12px x-c-muted">Audit log of all bulk data transfer jobs</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Description</th>
              <th>Entity Type</th>
              <th>Total Rows</th>
              <th>Valid</th>
              <th>Errors</th>
              <th>Executed At</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map(j => (
              <tr key={j.id}>
                <td><code>{j.id}</code></td>
                <td><strong>{j.name}</strong></td>
                <td>{j.entity}</td>
                <td>{j.records}</td>
                <td style={{ color: '#15803d' }}>{j.validRows}</td>
                <td style={{ color: j.errorRows > 0 ? '#b91c1c' : '#64748b' }}>{j.errorRows}</td>
                <td>{j.executedAt}</td>
                <td><span className={`status ${j.status === 'COMPLETED' ? 'active' : 'inactive'}`}>{j.status}</span></td>
                <td>
                  <div className="actions">
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => toast(`Downloading source file for ${j.id}`)}
                    >
                      Export Source
                    </button>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => toast(`Viewing error log for ${j.id}: ${j.errorRows} rows flagged.`)}
                    >
                      View Log
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
