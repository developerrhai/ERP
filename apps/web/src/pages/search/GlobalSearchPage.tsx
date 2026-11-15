// V40 page global-search: a filter card (Search text, Module Family, Status, Search ERP) and one result card per record with
// View Record / Open Module. Every hit is a real record of a page the caller may open, in the caller's plants (GET /work/record-search).
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { workApi, type SearchHit } from '../../lib/workApi';

const STATUSES = ['Active', 'Approved', 'Pending', 'Open', 'Completed', 'Draft'];

export function GlobalSearchPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '');
  const [family, setFamily] = useState('');
  const [status, setStatus] = useState('');
  const [families, setFamilies] = useState<string[]>([]);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void workApi.searchFamilies().then(setFamilies, () => undefined);
  }, []);

  async function run(e?: FormEvent): Promise<void> {
    e?.preventDefault();
    if (q.trim().length < 2) {
      setError('Enter at least 2 characters to search all permitted ERP data.');
      setHits(null);
      return;
    }
    setBusy(true);
    setError('');
    try {
      setHits(await workApi.recordSearch(q.trim(), family, status));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The search did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (q.trim().length >= 2) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="dash-page">
      <div className="page-head">
        <div>
          <h1>Global Search</h1>
          <p className="muted">Search across every permitted ERP record with direct record navigation.</p>
        </div>
      </div>
      <div className="search-layout" style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 320px) 1fr', gap: 14 }}>
        <form className="card" onSubmit={(e) => void run(e)}>
          <h3 style={{ marginTop: 0 }}>Search Filters</h3>
          <div className="field">
            <label htmlFor="gs-q">Search text</label>
            <input id="gs-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Invoice, customer, PO, employee, item..." />
          </div>
          <div className="field">
            <label htmlFor="gs-family">Module Family</label>
            <select id="gs-family" value={family} onChange={(e) => setFamily(e.target.value)}>
              <option value="">All permitted modules</option>
              {families.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="gs-status">Status</label>
            <select id="gs-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any status</option>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn primary" style={{ width: '100%' }} disabled={busy}>
            Search ERP
          </button>
          <div className="notice" style={{ marginTop: 10 }}>
            <b>{hits ? `${hits.length} result(s)` : '0 result(s)'}</b>
            <br />
            Results respect department and role access.
          </div>
        </form>
        <div>
          {error ? <p role="alert">{error}</p> : null}
          {hits === null && !error ? <div className="notice">Enter at least 2 characters to search all permitted ERP data.</div> : null}
          {hits && hits.length === 0 ? <div className="notice">No matching ERP records. Try record number, customer, supplier, employee, item, invoice, order, mobile or status.</div> : null}
          {(hits ?? []).map((h) => (
            <div className="card" key={`${h.pageId}-${h.id}`} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <h4 style={{ margin: 0 }}>
                    {h.label} • {h.number}
                  </h4>
                  <p className="muted" style={{ margin: '4px 0' }}>
                    {h.family}
                    {h.status ? ` • ${h.status}` : ''}
                  </p>
                </div>
                <div className="actions">
                  <button type="button" className="btn" onClick={() => navigate(`/m/${h.pageId}?q=${encodeURIComponent(h.number)}`)}>
                    View Record
                  </button>
                  <button type="button" className="btn primary" onClick={() => navigate(`/m/${h.pageId}`)}>
                    Open Module
                  </button>
                </div>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>{h.matched}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
