// Duplicate Detection (admin-duplicates): Master deduplication rules, PAN/GSTIN match rules and fuzzy cluster merging.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';

interface DuplicateRule {
  id: string;
  name: string;
  entity: string;
  fields: string;
  algorithm: 'EXACT' | 'FUZZY_SOUNDEX' | 'TAX_IDENTIFIER';
  status: 'ACTIVE' | 'INACTIVE';
  matchesFound: number;
}

const DEFAULT_RULES: DuplicateRule[] = [
  { id: 'dup-1', name: 'Vendor PAN / GSTIN Exact Match', entity: 'Vendors', fields: 'pan, gstin', algorithm: 'TAX_IDENTIFIER', status: 'ACTIVE', matchesFound: 0 },
  { id: 'dup-2', name: 'Customer Trade Name & Phone Fuzzy', entity: 'Customers', fields: 'tradeName, phone', algorithm: 'FUZZY_SOUNDEX', status: 'ACTIVE', matchesFound: 2 },
  { id: 'dup-3', name: 'Item Part Number Exact Normalized', entity: 'Items', fields: 'code, partNo', algorithm: 'EXACT', status: 'ACTIVE', matchesFound: 0 },
  { id: 'dup-4', name: 'Employee Identity Card (PAN/Aadhaar)', entity: 'Employees', fields: 'pan, nationalId', algorithm: 'EXACT', status: 'ACTIVE', matchesFound: 0 },
  { id: 'dup-5', name: 'Lead Email & Mobile Number Match', entity: 'Leads', fields: 'email, mobile', algorithm: 'EXACT', status: 'ACTIVE', matchesFound: 5 },
];

export function DuplicateDetectionPage() {
  const toast = useToast();
  const [rules, setRules] = useState<DuplicateRule[]>(DEFAULT_RULES);
  const [fName, setFName] = useState('');
  const [fEntity, setFEntity] = useState('Customers');
  const [fFields, setFFields] = useState('');
  const [fAlgo, setFAlgo] = useState<'EXACT' | 'FUZZY_SOUNDEX' | 'TAX_IDENTIFIER'>('EXACT');

  const addRule = () => {
    if (!fName.trim()) return;
    const newRule: DuplicateRule = {
      id: `dup-${rules.length + 1}`,
      name: fName.trim(),
      entity: fEntity,
      fields: fFields || 'name',
      algorithm: fAlgo,
      status: 'ACTIVE',
      matchesFound: 0,
    };
    setRules([...rules, newRule]);
    setFName('');
    setFFields('');
    toast('Duplicate detection rule added.');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Duplicate Detection &amp; Data Hygiene</h1>
          <p>Prevent split records, redundant vendor/customer codes, and orphan masters using exact and fuzzy matching algorithms.</p>
        </div>
        <div className="actions">
          <Link className="btn" to="/m/admin-settings">
            ← System Setup
          </Link>
          <button
            type="button"
            className="btn primary"
            onClick={() => toast('Triggered full system deduplication scan across all active entity rules.')}
          >
            Run System Deduplication Scan
          </button>
        </div>
      </div>

      {/* 4 Top Summary Cards (Demo ERP Baseline) */}
      <div className="kpis x-d-grid x-cols-repeat-4-1fr x-gap-12px x-m-14px-0">
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Active Rules</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">{rules.filter(r => r.status === 'ACTIVE').length} Active Rules</b>
          <span className="x-fs-11px x-c-success">Enforced on Save</span>
        </div>
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Flagged Clusters</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">7 Suspects</b>
          <span className="x-fs-11px x-c-danger-hover">Awaiting merge decision</span>
        </div>
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Matching Engines</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">Soundex &amp; Exact</b>
          <span className="x-fs-11px x-c-primary">GSTIN &amp; PAN primary</span>
        </div>
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Data Quality</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">99.8%</b>
          <span className="x-fs-11px x-c-success">Clean Directory</span>
        </div>
      </div>

      {/* Split View: Duplicate Rules Checklist + Add Rule Form */}
      <div className="x-d-grid x-cols-minmax-0-1_8fr-minmax-280px-1fr x-gap-14px x-m-14px-0">
        <div className="card table-wrap x-p-14px x-bg-card x-r-10px x-bd-1px-solid-line-strong">
          <div className="x-d-flex x-jc-space-between x-ai-center x-mb-12px">
            <h3 className="x-m-0 x-fs-14px x-c-text">Duplicate Rules Checklist</h3>
            <span className="chip x-bg-hdcfce7 x-c-success">Active Guardrails</span>
          </div>
          <table className="register-table">
            <thead>
              <tr>
                <th>Rule Name</th>
                <th>Entity Target</th>
                <th>Algorithm</th>
                <th>Matches</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rules.slice(0, 4).map(r => (
                <tr key={r.id}>
                  <td><strong>{r.name}</strong></td>
                  <td>{r.entity}</td>
                  <td><span className="chip">{r.algorithm}</span></td>
                  <td><strong style={{ color: r.matchesFound > 0 ? '#b91c1c' : '#15803d' }}>{r.matchesFound}</strong></td>
                  <td>
                    <div className="actions">
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => toast(`Testing rule ${r.name}: Scan completed.`)}
                      >
                        Test
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card x-p-14px x-bg-card x-r-10px x-bd-1px-solid-line-strong">
          <h3 className="x-m-0-0-10px-0 x-fs-14px x-c-text">Add Duplicate Rule</h3>
          <p className="x-fs-12px x-c-muted x-m-0-0-12px-0">
            Define custom field combinations for duplicate prevention.
          </p>
          <div className="x-d-flex x-fd-column x-gap-8px x-fs-12px">
            <label className="x-d-flex x-fd-column x-gap-2px">
              <span>Rule Name:</span>
              <input
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                placeholder="e.g. Customer GSTIN Uniqueness"
                className="x-p-6px-8px x-bd-1px-solid-line-strong x-r-6px"
              />
            </label>
            <label className="x-d-flex x-fd-column x-gap-2px">
              <span>Entity:</span>
              <select
                value={fEntity}
                onChange={(e) => setFEntity(e.target.value)}
                className="x-p-6px-8px x-bd-1px-solid-line-strong x-r-6px"
              >
                <option value="Customers">Customers</option>
                <option value="Vendors">Vendors</option>
                <option value="Items">Item Master</option>
                <option value="Employees">Employees</option>
                <option value="Leads">Leads &amp; CRM</option>
              </select>
            </label>
            <label className="x-d-flex x-fd-column x-gap-2px">
              <span>Fields (comma separated):</span>
              <input
                value={fFields}
                onChange={(e) => setFFields(e.target.value)}
                placeholder="e.g. gstin, pan"
                className="x-p-6px-8px x-bd-1px-solid-line-strong x-r-6px"
              />
            </label>
            <label className="x-d-flex x-fd-column x-gap-2px">
              <span>Algorithm:</span>
              <select
                value={fAlgo}
                onChange={(e) => setFAlgo(e.target.value as 'EXACT' | 'FUZZY_SOUNDEX' | 'TAX_IDENTIFIER')}
                className="x-p-6px-8px x-bd-1px-solid-line-strong x-r-6px"
              >
                <option value="EXACT">Exact Normalized Match</option>
                <option value="FUZZY_SOUNDEX">Fuzzy Soundex &amp; Levenshtein</option>
                <option value="TAX_IDENTIFIER">Tax Identifier (PAN/GSTIN)</option>
              </select>
            </label>
            <button
              type="button"
              className="btn sm primary x-mt-6px"
              onClick={addRule}
            >
              ＋ Save Rule
            </button>
          </div>
        </div>
      </div>

      {/* Detailed Table */}
      <div className="card table-wrap">
        <div className="x-d-flex x-jc-space-between x-ai-center x-p-12px-14px-6px-14px">
          <h3 className="x-m-0 x-fs-14px x-c-text">Duplicate Rules Detailed Register</h3>
          <span className="x-fs-12px x-c-muted">Configure deduplication thresholds and automated merge triggers</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Rule ID</th>
              <th>Rule Name</th>
              <th>Target Entity</th>
              <th>Monitored Fields</th>
              <th>Match Algorithm</th>
              <th>Flagged Rows</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rules.map(r => (
              <tr key={r.id}>
                <td><code>{r.id}</code></td>
                <td><strong>{r.name}</strong></td>
                <td>{r.entity}</td>
                <td><code>{r.fields}</code></td>
                <td><span className="chip">{r.algorithm}</span></td>
                <td><strong style={{ color: r.matchesFound > 0 ? '#b91c1c' : '#15803d' }}>{r.matchesFound}</strong></td>
                <td><span className={`status ${r.status === 'ACTIVE' ? 'active' : 'inactive'}`}>{r.status}</span></td>
                <td>
                  <div className="actions">
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => toast(`Editing rule ${r.id}`)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => toast(`Running on-demand scan for ${r.name}...`)}
                    >
                      Run Check
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
