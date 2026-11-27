// Tax Master (admin-taxes): GST tax rates, HSN/SAC codes, reverse charge and tax rules.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import type { ActionSet } from '../../types';

interface TaxRule {
  id: string;
  code: string;
  name: string;
  rate: number;
  cgst: number;
  sgst: number;
  igst: number;
  type: 'GST' | 'TCS' | 'TDS' | 'CESS';
  status: 'ACTIVE' | 'INACTIVE';
  hsnCount: number;
}

const DEFAULT_TAX_RULES: TaxRule[] = [
  { id: 'tax-1', code: 'GST-18', name: 'Standard GST 18% (Industrial & Machinery)', rate: 18, cgst: 9, sgst: 9, igst: 18, type: 'GST', status: 'ACTIVE', hsnCount: 142 },
  { id: 'tax-2', code: 'GST-12', name: 'Reduced GST 12% (Assemblies & Sub-parts)', rate: 12, cgst: 6, sgst: 6, igst: 12, type: 'GST', status: 'ACTIVE', hsnCount: 68 },
  { id: 'tax-3', code: 'GST-28', name: 'Automotive & Luxury GST 28%', rate: 28, cgst: 14, sgst: 14, igst: 28, type: 'GST', status: 'ACTIVE', hsnCount: 24 },
  { id: 'tax-4', code: 'GST-5', name: 'Essential Spares & Raw Materials 5%', rate: 5, cgst: 2.5, sgst: 2.5, igst: 5, type: 'GST', status: 'ACTIVE', hsnCount: 89 },
  { id: 'tax-5', code: 'GST-0', name: 'Nil Rated / SEZ / Export 0%', rate: 0, cgst: 0, sgst: 0, igst: 0, type: 'GST', status: 'ACTIVE', hsnCount: 35 },
  { id: 'tax-6', code: 'TDS-194C', name: 'TDS Contractor 194C (2%)', rate: 2, cgst: 0, sgst: 0, igst: 0, type: 'TDS', status: 'ACTIVE', hsnCount: 12 },
  { id: 'tax-7', code: 'TDS-194J', name: 'TDS Professional / Tech 194J (10%)', rate: 10, cgst: 0, sgst: 0, igst: 0, type: 'TDS', status: 'ACTIVE', hsnCount: 8 },
  { id: 'tax-8', code: 'TCS-206C', name: 'TCS on Scrap Sale 206C (1%)', rate: 1, cgst: 0, sgst: 0, igst: 0, type: 'TCS', status: 'ACTIVE', hsnCount: 5 },
];

export function TaxMasterPage({ actions: _actions }: { actions?: ActionSet }) {
  const toast = useToast();
  const [taxes] = useState<TaxRule[]>(DEFAULT_TAX_RULES);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const filtered = taxes.filter(t => {
    if (typeFilter && t.type !== typeFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return t.code.toLowerCase().includes(q) || t.name.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tax Master</h1>
          <p>Statutory GST rates, HSN mapping, reverse charge rules, and TDS/TCS schedule.</p>
        </div>
        <div className="actions">
          <Link className="btn" to="/m/admin-settings">
            ← System Setup
          </Link>
          <button
            type="button"
            className="btn primary"
            onClick={() => toast('New Tax Rule dialog: Enter Code, Tax Rate %, and HSN applicability.')}
          >
            ＋ Add Tax Rate
          </button>
        </div>
      </div>

      {/* 4 Top Summary Cards (Demo ERP Baseline) */}
      <div className="kpis x-d-grid x-cols-repeat-4-1fr x-gap-12px x-m-14px-0">
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Active Tax Slabs</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">{taxes.filter(t => t.status === 'ACTIVE').length} Active Slabs</b>
          <span className="x-fs-11px x-c-success">GST, TDS &amp; TCS Ready</span>
        </div>
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">HSN Mappings</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">383 Mapped Items</b>
          <span className="x-fs-11px x-c-primary">E-Invoice Compliant</span>
        </div>
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Statutory Compliance</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">100%</b>
          <span className="x-fs-11px x-c-success">CGST + SGST = IGST Rule</span>
        </div>
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Data Quality</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">99.9%</b>
          <span className="x-fs-11px x-c-success">No Orphan Tax Codes</span>
        </div>
      </div>

      {/* Split View: Tax Master Checklist + Compliance Actions */}
      <div className="x-d-grid x-cols-minmax-0-1_8fr-minmax-280px-1fr x-gap-14px x-m-14px-0">
        <div className="card table-wrap x-p-14px x-bg-card x-r-10px x-bd-1px-solid-line-strong">
          <div className="x-d-flex x-jc-space-between x-ai-center x-mb-12px">
            <h3 className="x-m-0 x-fs-14px x-c-text">Tax Master Compliance Checklist</h3>
            <span className="chip x-bg-hdcfce7 x-c-success">Verified Valid</span>
          </div>
          <table className="register-table">
            <thead>
              <tr>
                <th>Compliance Check</th>
                <th>Rule Definition</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>GST Split Validation</strong></td>
                <td>Equal bifurcation between CGST &amp; SGST for intra-state</td>
                <td><span className="status active">Passed</span></td>
              </tr>
              <tr>
                <td><strong>IGST Cross-Check</strong></td>
                <td>Single rate equals total tax for inter-state and imports</td>
                <td><span className="status active">Passed</span></td>
              </tr>
              <tr>
                <td><strong>HSN 6/8-Digit Format</strong></td>
                <td>Mandatory 6 or 8 digit codes on invoices &gt; ₹5 Cr</td>
                <td><span className="status active">Passed</span></td>
              </tr>
              <tr>
                <td><strong>Reverse Charge Mechanism</strong></td>
                <td>Section 9(3) and 9(4) auto-accrual flags active</td>
                <td><span className="status active">Passed</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card x-p-14px x-bg-card x-r-10px x-bd-1px-solid-line-strong">
          <h3 className="x-m-0-0-10px-0 x-fs-14px x-c-text">Compliance Actions</h3>
          <p className="x-fs-12px x-c-muted x-m-0-0-12px-0">
            Statutory tax validation tools and official audit documents.
          </p>
          <div className="x-d-flex x-fd-column x-gap-10px x-fs-12px">
            <button
              type="button"
              className="btn sm primary"
              onClick={() => toast('Tax Validation Run: All 8 active slabs verified with GST portal schemas.')}
            >
              Run Validation
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => toast('Generated Letterhead PDF for CA / Statutory Tax Audit.')}
            >
              Download Letterhead PDF
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => toast('HSN/SAC directory refreshed with latest CBIC circular.')}
            >
              Sync CBIC Master List
            </button>
          </div>
        </div>
      </div>

      {/* Detailed Table */}
      <div className="card table-wrap">
        <div className="x-d-flex x-jc-space-between x-ai-center x-p-12px-14px-8px-14px">
          <div className="x-d-flex x-gap-10px x-ai-center">
            <input
              type="search"
              placeholder="Search tax rate or description…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="x-w-240px x-p-6px-10px x-fs-13px x-bd-1px-solid-line-strong x-r-6px"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="x-p-6px-10px x-fs-13px x-bd-1px-solid-line-strong x-r-6px"
            >
              <option value="">All Types</option>
              <option value="GST">GST</option>
              <option value="TDS">TDS</option>
              <option value="TCS">TCS</option>
            </select>
          </div>
          <span className="x-fs-12px x-c-muted">Showing {filtered.length} tax records</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Rate (%)</th>
              <th>CGST (%)</th>
              <th>SGST (%)</th>
              <th>IGST (%)</th>
              <th>HSN Count</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(t => (
              <tr key={t.id}>
                <td><strong>{t.code}</strong></td>
                <td>{t.name}</td>
                <td><strong>{t.rate}%</strong></td>
                <td>{t.cgst}%</td>
                <td>{t.sgst}%</td>
                <td>{t.igst}%</td>
                <td>{t.hsnCount} items</td>
                <td><span className={`status ${t.status === 'ACTIVE' ? 'active' : 'inactive'}`}>{t.status}</span></td>
                <td>
                  <div className="actions">
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => toast(`Editing tax rate ${t.code}`)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => toast(`Audit history for ${t.code} opened.`)}
                    >
                      History
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
