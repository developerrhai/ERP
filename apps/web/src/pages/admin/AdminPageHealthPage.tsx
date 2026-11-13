// Phase 22 §7: crawler results of the latest run. "Only errors" filter, every row links to the page,
// and the p95 column turns red above the budget.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { listPageHealth, type HealthMeta, type HealthRow } from '../../lib/screensApi';
import { dmy, ErrorBox, PageHead, Pill } from '../finance/shared';

export function AdminPageHealthPage() {
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [meta, setMeta] = useState<HealthMeta | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listPageHealth({ status: onlyErrors ? 'ERROR' : undefined, q: query, page })
      .then((r) => {
        if (!alive) return;
        setRows(r.data);
        setMeta(r.meta);
        setError('');
      })
      .catch((e: unknown) => alive && setError(e instanceof ApiError ? e.message : 'Something went wrong.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [onlyErrors, query, page]);

  const pages = meta ? Math.max(1, Math.ceil(meta.total / meta.size)) : 1;
  return (
    <>
      <PageHead
        title="Page Health"
        sub="Every page opened as every role by the crawler: errors, forbidden text and load time."
      />
      <ErrorBox message={error} />
      {meta && meta.runId === null ? (
        <p className="v8-sub">No crawler run has been imported yet. Run the crawler, then import its result.</p>
      ) : meta ? (
        <p className="v8-sub" role="status">
          Last run {dmy(meta.checkedAt)} · {meta.pagesChecked} checks ·{' '}
          <b>{meta.errors === 0 ? 'all green' : `${meta.errors} with errors`}</b>
        </p>
      ) : null}
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(q.trim());
        }}
      >
        <label>
          <input
            type="checkbox"
            checked={onlyErrors}
            onChange={(e) => {
              setPage(1);
              setOnlyErrors(e.target.checked);
            }}
          />{' '}
          Only errors
        </label>
        <label>
          <span className="sr-only">Search page</span>
          <input type="search" placeholder="Page id…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button type="submit" className="btn sm">
          Search
        </button>
      </form>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Page</th>
              <th>Role</th>
              <th>Plants</th>
              <th>Result</th>
              <th>Problem</th>
              <th>p95 (ms)</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={6}>{loading ? 'Loading…' : 'No results to show.'}</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={`${r.pageId}|${r.role}|${r.unitCombo}`}>
                  <td>
                    <Link to={`/m/${r.pageId}`}>{r.pageId}</Link>
                  </td>
                  <td>{r.role}</td>
                  <td>{r.unitCombo}</td>
                  <td>
                    <Pill tone={r.status === 'OK' ? 'active' : 'rejected'}>{r.status === 'OK' ? 'OK' : 'Error'}</Pill>
                  </td>
                  <td>{r.errorKind ? `${r.errorKind}: ${r.errorText ?? ''}` : '—'}</td>
                  <td style={r.overBudget ? { color: '#c0392b', fontWeight: 600 } : undefined}>
                    {r.p95Ms ?? '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <nav className="v8-pager" aria-label="Pagination">
        <span>
          Page {page} of {pages}
        </span>
        <div className="pages">
          <button type="button" className="v8-page" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <button type="button" className="v8-page" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      </nav>
    </>
  );
}
