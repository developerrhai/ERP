// V40 page project-global-history ("Global Project History"): enter one Project Number to see its complete document,
// department, approval and movement history from every login. Master details, the department roll-up and the activity
// log all come from GET /projects/:id/summary and /history; events of plants you did not choose are masked by the API.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import { saveBlob, spineApi, type HistoryRow, type ProjectSummary } from '../../lib/spineApi';

const when = (v: string | null): string => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const day = (v: string | null): string => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const pretty = (s: string): string => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

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
      const found = await spineApi.options(c);
      const hit = found.find((p) => p.code.toLowerCase() === c.toLowerCase());
      if (!hit) {
        setSummary(null);
        setRows([]);
        setError(`There is no project with the number “${c}” in your plants.`);
        return;
      }
      const [s, h] = await Promise.all([spineApi.summary(hit.id), spineApi.history(hit.id, { dept: deptId || undefined })]);
      setSummary(s);
      setRows(h);
    } catch (e) {
      // never leave another project's figures on screen next to an error
      setSummary(null);
      setRows([]);
      setError(e instanceof ApiError ? e.message : 'Could not load the project history.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (number) {
      void load(number, '');
      return;
    }
    // V40 opens with a project already entered: start with the newest project of the chosen plants
    void spineApi.options('').then((list) => {
      const first = list[0];
      if (first) {
        setNumber(first.code);
        void load(first.code, '');
      }
    }, () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const docs = useMemo(() => {
    const m = new Map<string, { dept: string; type: string | null; no: string; first: string; text: string }>();
    for (const r of [...rows].reverse()) {
      if (!r.doc_no || r.masked) continue;
      const k = `${r.doc_no}`;
      if (!m.has(k)) {
        m.set(k, { dept: r.department ?? '—', type: r.doc_type ?? null, no: r.doc_no, first: r.at, text: r.text ?? '' });
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
                  <th>Date</th>
                  <th>Details</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.no}>
                    <td>{d.dept}</td>
                    <td>{d.type ?? '—'}</td>
                    <td><b>{d.no}</b></td>
                    <td>{day(d.first)}</td>
                    <td>{d.text}</td>
                    <td>
                      {d.type ? <Link className="btn" to={`/m/${d.type}`}>Load Document</Link> : '—'}
                    </td>
                  </tr>
                ))}
                {docs.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No documents on this project yet.</td>
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
                  <th>Remarks</th>
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
                    <td>{r.text ?? '—'}</td>
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
