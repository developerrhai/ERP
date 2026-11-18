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
      <div className="kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, margin: '14px 0' }}>
        <div className="kpi" style={{ padding: 12, background: '#fff', borderRadius: 8, border: '1px solid #cbd5e1' }}>
          <small style={{ color: '#64748b' }}>Active Rules</small>
          <b style={{ fontSize: 18, color: '#1e293b', display: 'block', margin: '4px 0' }}>{rules.filter(r => r.status === 'ACTIVE').length} Active Rules</b>
          <span style={{ fontSize: 11, color: '#15803d' }}>Enforced on Save</span>
        </div>
        <div className="kpi" style={{ padding: 12, background: '#fff', borderRadius: 8, border: '1px solid #cbd5e1' }}>
          <small style={{ color: '#64748b' }}>Flagged Clusters</small>
          <b style={{ fontSize: 18, color: '#1e293b', display: 'block', margin: '4px 0' }}>7 Suspects</b>
          <span style={{ fontSize: 11, color: '#b91c1c' }}>Awaiting merge decision</span>
        </div>
        <div className="kpi" style={{ padding: 12, background: '#fff', borderRadius: 8, border: '1px solid #cbd5e1' }}>
          <small style={{ color: '#64748b' }}>Matching Engines</small>
          <b style={{ fontSize: 18, color: '#1e293b', display: 'block', margin: '4px 0' }}>Soundex &amp; Exact</b>
          <span style={{ fontSize: 11, color: '#2563eb' }}>GSTIN &amp; PAN primary</span>
        </div>
        <div className="kpi" style={{ padding: 12, background: '#fff', borderRadius: 8, border: '1px solid #cbd5e1' }}>
          <small style={{ color: '#64748b' }}>Data Quality</small>
          <b style={{ fontSize: 18, color: '#1e293b', display: 'block', margin: '4px 0' }}>99.8%</b>
          <span style={{ fontSize: 11, color: '#15803d' }}>Clean Directory</span>
        </div>
      </div>

      {/* Split View: Duplicate Rules Checklist + Add Rule Form */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.8fr) minmax(280px, 1fr)', gap: 14, margin: '14px 0' }}>
        <div className="card table-wrap" style={{ padding: 14, background: '#fff', borderRadius: 10, border: '1px solid #cbd5e1' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14, color: '#1e293b' }}>Duplicate Rules Checklist</h3>
            <span className="chip" style={{ background: '#dcfce7', color: '#15803d' }}>Active Guardrails</span>
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

        <div className="card" style={{ padding: 14, background: '#fff', borderRadius: 10, border: '1px solid #cbd5e1' }}>
          <h3 style={{ margin: '0 0 10px 0', fontSize: 14, color: '#1e293b' }}>Add Duplicate Rule</h3>
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px 0' }}>
            Define custom field combinations for duplicate prevention.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span>Rule Name:</span>
              <input
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                placeholder="e.g. Customer GSTIN Uniqueness"
                style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 6 }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span>Entity:</span>
              <select
                value={fEntity}
                onChange={(e) => setFEntity(e.target.value)}
                style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 6 }}
              >
                <option value="Customers">Customers</option>
                <option value="Vendors">Vendors</option>
                <option value="Items">Item Master</option>
                <option value="Employees">Employees</option>
                <option value="Leads">Leads &amp; CRM</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span>Fields (comma separated):</span>
              <input
                value={fFields}
                onChange={(e) => setFFields(e.target.value)}
                placeholder="e.g. gstin, pan"
                style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 6 }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span>Algorithm:</span>
              <select
                value={fAlgo}
                onChange={(e) => setFAlgo(e.target.value as 'EXACT' | 'FUZZY_SOUNDEX' | 'TAX_IDENTIFIER')}
                style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 6 }}
              >
                <option value="EXACT">Exact Normalized Match</option>
                <option value="FUZZY_SOUNDEX">Fuzzy Soundex &amp; Levenshtein</option>
                <option value="TAX_IDENTIFIER">Tax Identifier (PAN/GSTIN)</option>
              </select>
            </label>
            <button
              type="button"
              className="btn sm primary"
              style={{ marginTop: 6 }}
              onClick={addRule}
            >
              ＋ Save Rule
            </button>
          </div>
        </div>
      </div>

      {/* Detailed Table */}
      <div className="card table-wrap">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px 6px 14px' }}>
          <h3 style={{ margin: 0, fontSize: 14, color: '#1e293b' }}>Duplicate Rules Detailed Register</h3>
          <span style={{ fontSize: 12, color: '#64748b' }}>Configure deduplication thresholds and automated merge triggers</span>
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
