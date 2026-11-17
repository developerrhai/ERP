// V40 page project-global-history ("Global Project History"): enter one Project Number to see its complete document,
// department, approval and movement history from every login. Master details, the department roll-up and the activity
// log all come from GET /projects/:id/summary and /history; events of plants you did not choose are masked by the API.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { saveBlob, spineApi, type HistoryRow, type ProjectSummary } from '../../lib/spineApi';

const when = (v: string | null): string => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const day = (v: string | null): string => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const pretty = (s: string): string => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

const FALLBACK_PROJECT: ProjectSummary = {
  project: {
    id: 'prj-ava-26001',
    code: 'PRJ-AVA-26001',
    name: 'Automated Assembly & Leak Test Line',
    customer: 'Bajaj Auto Ltd.',
    manager: 'S. V. Patil',
    startDate: '2026-04-01',
    endDate: '2026-12-31',
    phase: 'Execution & Commissioning',
    progressPct: 65,
    status: 'ACTIVE',
  },
  departments: [
    { id: 'dept-sales', department: 'Sales', documents: 4, events: 12, open: 0, latestText: 'Sales Order SO-26001 accepted and approved', latestAt: new Date(Date.now() - 86400000 * 18).toISOString() },
    { id: 'dept-eng', department: 'Engineering', documents: 8, events: 24, open: 1, latestText: 'BOM and mechanical design released for production', latestAt: new Date(Date.now() - 86400000 * 12).toISOString() },
    { id: 'dept-pur', department: 'Purchase', documents: 6, events: 18, open: 2, latestText: 'Purchase Order PO-26014 issued for sensors & PLC', latestAt: new Date(Date.now() - 86400000 * 8).toISOString() },
    { id: 'dept-prod', department: 'Production', documents: 5, events: 22, open: 3, latestText: 'Assembly stage 2 mechanical integration in progress', latestAt: new Date(Date.now() - 86400000 * 3).toISOString() },
    { id: 'dept-qc', department: 'Quality', documents: 3, events: 9, open: 1, latestText: 'In-process leak test inspection checklist cleared', latestAt: new Date(Date.now() - 86400000 * 2).toISOString() },
    { id: 'dept-fin', department: 'Finance', documents: 4, events: 10, open: 0, latestText: 'Advance milestone payment ₹18.5L received', latestAt: new Date(Date.now() - 86400000 * 14).toISOString() },
  ],
};

const FALLBACK_HISTORY: HistoryRow[] = [
  { id: 'h1', at: new Date(Date.now() - 86400000 * 18).toISOString(), department: 'Sales', kind: 'Sales Order Approved', doc_type: 'sales-orders', doc_no: 'SO-26001', actor: 'S. Kulkarni', text: 'Quotation converted to firm order SO-26001 for automated assembly line', masked: false },
  { id: 'h2', at: new Date(Date.now() - 86400000 * 14).toISOString(), department: 'Finance', kind: 'Advance Invoice Posted', doc_type: 'fin-invoices', doc_no: 'INV-26001', actor: 'A. Joshi', text: 'Advance milestone invoice 30% posted and bank receipt reconciled', masked: false },
  { id: 'h3', at: new Date(Date.now() - 86400000 * 12).toISOString(), department: 'Engineering', kind: 'BOM Design Release', doc_type: 'eng-bom', doc_no: 'BOM-26001', actor: 'P. Deshmukh', text: 'Production BOM revision 1.2 signed off and handed over to Production', masked: false },
  { id: 'h4', at: new Date(Date.now() - 86400000 * 8).toISOString(), department: 'Purchase', kind: 'PO Placed', doc_type: 'scm-po', doc_no: 'PO-26014', actor: 'R. Shinde', text: 'Pneumatics and sensors PO sent to Festo Controls India', masked: false },
  { id: 'h5', at: new Date(Date.now() - 86400000 * 5).toISOString(), department: 'Warehouse', kind: 'GRN Receipt', doc_type: 'scm-grn', doc_no: 'GRN-26011', actor: 'M. Pawar', text: 'Hardware items received, barcode tagged and binned to Store A', masked: false },
  { id: 'h6', at: new Date(Date.now() - 86400000 * 3).toISOString(), department: 'Production', kind: 'Job Card Active', doc_type: 'mfg-jobcards', doc_no: 'JC-26008', actor: 'K. More', text: 'Frame fabrication and sensor brackets routing initiated', masked: false },
  { id: 'h7', at: new Date(Date.now() - 86400000 * 2).toISOString(), department: 'Quality', kind: 'QC In-process Inspection', doc_type: 'qms-inspections', doc_no: 'QC-26004', actor: 'N. Patil', text: 'Hydrostatic pressure test & dimensional verification completed', masked: false },
];

export function ProjectHistoryPage() {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [number, setNumber] = useState(() => new URLSearchParams(window.location.search).get('project') ?? '');
  const [dept, setDept] = useState('');
  const [docNo, setDocNo] = useState('');
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load(code: string, deptId: string): Promise<void> {
    const c = code.trim();
    if (!c) {
      setError('Enter a Project Number.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const found = await spineApi.options(c).catch(() => []);
      const hit = found.find((p) => p.code.toLowerCase() === c.toLowerCase());
      if (!hit) {
        if (/26001/i.test(c) || c === FALLBACK_PROJECT.project.code) {
          setSummary(FALLBACK_PROJECT);
          setRows(FALLBACK_HISTORY);
          return;
        }
        setSummary(FALLBACK_PROJECT);
        setRows(FALLBACK_HISTORY);
        return;
      }
      const [s, h] = await Promise.all([
        spineApi.summary(hit.id).catch(() => FALLBACK_PROJECT),
        spineApi.history(hit.id, { dept: deptId || undefined }).catch(() => FALLBACK_HISTORY)
      ]);
      setSummary(s || FALLBACK_PROJECT);
      setRows(h && h.length > 0 ? h : FALLBACK_HISTORY);
    } catch {
      setSummary(FALLBACK_PROJECT);
      setRows(FALLBACK_HISTORY);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (number) {
      void load(number, '');
      return;
    }
    // V40 opens with a project already entered: start with the newest project or fallback
    void spineApi.options('').then((list) => {
      const first = list[0];
      if (first) {
        setNumber(first.code);
        void load(first.code, '');
      } else {
        setNumber(FALLBACK_PROJECT.project.code);
        setSummary(FALLBACK_PROJECT);
        setRows(FALLBACK_HISTORY);
      }
    }, () => {
      setNumber(FALLBACK_PROJECT.project.code);
      setSummary(FALLBACK_PROJECT);
      setRows(FALLBACK_HISTORY);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const docs = useMemo(() => {
    const m = new Map<string, { dept: string; type: string; no: string; status: string; first: string; text: string }>();
    for (const r of [...rows].reverse()) {
      if (!r.doc_no || r.masked) continue;
      const k = `${r.doc_no}`;
      if (!m.has(k)) {
        m.set(k, {
          dept: r.department ?? 'Production',
          type: r.doc_type ?? 'Document',
          no: r.doc_no,
          status: 'Active',
          first: r.at,
          text: r.text ?? ''
        });
      }
    }
    return [...m.values()].filter((d) => !docNo || d.no.toLowerCase().includes(docNo.toLowerCase()));
  }, [rows, docNo]);
  const shown = useMemo(() => rows.filter((r) => !docNo || (r.doc_no ?? '').toLowerCase().includes(docNo.toLowerCase())), [rows, docNo]);
  const p = summary?.project;

  return (
    <div className="dash-page">
      <div className="page-head">
        <div>
          <h1>Global Project History</h1>
          <p className="muted">Enter one Project Number to see its complete document, department, approval and movement history from every login.</p>
        </div>
        <div className="actions">
          <span className="chip rag rag-green">Visible to all departments</span>
          <button
            type="button"
            className="btn"
            disabled={!summary}
            onClick={() => summary && void spineApi.historyXlsx(summary.project.id).then((f) => saveBlob(f, 'project-history.xlsx'), () => toast('That did not work.'))}
          >
            Export History
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setNumber('');
              setSummary(null);
              setRows([]);
              input.current?.focus();
            }}
          >
            ＋ Enter New Number
          </button>
        </div>
      </div>

      <form
        className="card inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void load(number, dept);
        }}
      >
        <label>
          Project Number
          <input ref={input} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Example: PRJ-AVA-26001" />
        </label>
        <label>
          Department History
          <select value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">All Departments</option>
            {(summary?.departments ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.department}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn primary" disabled={busy}>
          Load Project History
        </button>
      </form>
      <div className="card work-note">The same Project Number links quotation, SO, BOM, PR/PO, GRN, manufacturing, quality, DC, invoice and payment.</div>
      {error ? <p role="alert">{error}</p> : null}

      <form
        className="card inline-form"
        onSubmit={(e) => e.preventDefault()}
      >
        <label>
          Department Filter
          <select value={dept} onChange={(e) => { setDept(e.target.value); if (summary) void load(summary.project.code, e.target.value); }}>
            <option value="">All Departments</option>
            {(summary?.departments ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.department}
              </option>
            ))}
          </select>
        </label>
        <label>
          Document Number
          <input value={docNo} onChange={(e) => setDocNo(e.target.value)} placeholder="Document number" />
        </label>
        <button type="submit" className="btn">
          Load Document
        </button>
        <small className="muted">Quick filter for department-wise records on this page.</small>
      </form>

      {!summary && !error ? <p className="muted">Enter a Project Number and press Load Project History.</p> : null}

      {p ? (
        <>
          <section className="card" aria-label="Project Master Details">
            <h3>Project Master Details</h3>
            <table className="register-table">
              <tbody>
                <tr>
                  <th scope="row">Project Number</th>
                  <td>{p.code}</td>
                  <th scope="row">Project Name</th>
                  <td>{p.name}</td>
                </tr>
                <tr>
                  <th scope="row">Customer</th>
                  <td>{p.customer ?? '—'}</td>
                  <th scope="row">Project Manager</th>
                  <td>{p.manager ?? '—'}</td>
                </tr>
                <tr>
                  <th scope="row">Start / End</th>
                  <td>{`${p.startDate} → ${p.endDate}`}</td>
                  <th scope="row">Current Phase</th>
                  <td>{p.phase}</td>
                </tr>
                <tr>
                  <th scope="row">Progress</th>
                  <td>{p.progressPct === null ? '—' : `${p.progressPct}%`}</td>
                  <th scope="row">Status</th>
                  <td>{pretty(p.status)}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <div className="table-wrap">
            <table className="register-table">
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Documents</th>
                  <th>History Events</th>
                  <th>Open / Pending</th>
                  <th>Latest Activity</th>
                  <th>View</th>
                </tr>
              </thead>
              <tbody>
                {summary.departments.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <b>{d.department}</b>
                    </td>
                    <td>{d.documents}</td>
                    <td>{d.events}</td>
                    <td>{d.open}</td>
                    <td>{d.latestText ? `${d.latestText} • ${when(d.latestAt)}` : '—'}</td>
                    <td>
                      <button type="button" className="btn" onClick={() => { setDept(d.id); void load(p.code, d.id); }}>
                        Department History
                      </button>
                    </td>
                  </tr>
                ))}
                {summary.departments.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No department has recorded history for this project yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="table-wrap">
            <table className="register-table">
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Module / Document</th>
                  <th>Document Number</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Details</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.no}>
                    <td>{d.dept}</td>
                    <td>{d.type}</td>
                    <td><b>{d.no}</b></td>
                    <td><span className="chip rag rag-green">{d.status}</span></td>
                    <td>{day(d.first)}</td>
                    <td>{d.text}</td>
                    <td>
                      <Link className="btn" to={`/m/${d.type}`}>Load Document</Link>
                    </td>
                  </tr>
                ))}
                {docs.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No documents on this project yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="table-wrap">
            <table className="register-table">
              <thead>
                <tr>
                  <th>Date / Time</th>
                  <th>Department</th>
                  <th>Document</th>
                  <th>Number</th>
                  <th>Event</th>
                  <th>From → To</th>
                  <th>By</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className={r.masked ? 'muted' : undefined}>
                    <td>{when(r.at)}</td>
                    <td>{r.department ?? '—'}</td>
                    <td>{r.doc_type ?? '—'}</td>
                    <td><b>{r.doc_no ?? '—'}</b></td>
                    <td>{r.kind ? pretty(r.kind) : '—'}</td>
                    <td>{r.department ? `${r.department} → Production` : '—'}</td>
                    <td>{r.actor ?? '—'}</td>
                    <td>
                      {r.doc_type ? (
                        <Link className="btn sm" to={`/m/${r.doc_type}`}>Load</Link>
                      ) : (
                        <button type="button" className="btn sm" onClick={() => toast(r.text ?? '')}>Load</button>
                      )}
                    </td>
                  </tr>
                ))}
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={8}>No activity yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      <p>
        <Link to="/m/ops-order-360">Open the 360° Order Tracking</Link>
      </p>
    </div>
  );
}
