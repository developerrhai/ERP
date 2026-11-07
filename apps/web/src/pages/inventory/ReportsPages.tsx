// Stock Ageing, Expiry Tracking, Stock Valuation (with the books check, integrity and the GL cut-over) and Barcode scan.
import { useState } from 'react';
import { Pager } from '../../components/Pager';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import {
  ageingReport,
  cutoverPlan,
  cutoverRun,
  expiryReport,
  glCompare,
  integrity,
  preflight,
  scanCode,
  valuationReport,
  type ScanResult,
} from '../../lib/inventoryApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import {
  dmy,
  Empty,
  ErrorBox,
  inr,
  PageHead,
  Pill,
  qty,
  todayIso,
  WarehouseSelect,
} from './shared';

export function StockAgeingPage() {
  const [page, setPage] = useState(1);
  const list = useLoad(() => ageingReport({ page }), [page]);
  return (
    <>
      <PageHead
        title="Stock Ageing"
        sub="How long the stock you hold has been lying in the store, and which items are slow or dead."
      />
      <ErrorBox message={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Warehouse</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                On hand
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                0–30 d
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                31–90 d
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                91–180 d
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                180+ d
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Avg age
              </th>
              <th scope="col">Movement</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.rows.length ?? 0) === 0 && !list.loading ? (
              <Empty cols={9}>No stock yet. Post a receipt or opening stock first.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((r, i) => (
              <tr key={i}>
                <td>
                  {r.itemCode} · {r.itemName}
                </td>
                <td>{r.warehouse}</td>
                <td style={{ textAlign: 'right' }}>{qty(r.onHand)}</td>
                <td style={{ textAlign: 'right' }}>{qty(r.f030)}</td>
                <td style={{ textAlign: 'right' }}>{qty(r.f3190)}</td>
                <td style={{ textAlign: 'right' }}>{qty(r.f91180)}</td>
                <td style={{ textAlign: 'right' }}>{qty(r.f180Plus)}</td>
                <td style={{ textAlign: 'right' }}>{r.ageDays} d</td>
                <td>
                  <Pill>{r.movement}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} size={20} total={list.data?.meta.total ?? 0} onPage={setPage} />
    </>
  );
}

export function ExpiryPage() {
  const [page, setPage] = useState(1);
  const [band, setBand] = useState('');
  const list = useLoad(() => expiryReport({ band, page }), [band, page]);
  const loss = list.data?.meta.expiredValue;
  return (
    <>
      <PageHead
        title="Expiry Tracking"
        sub="Batches that have expired or will soon. Expired stock cannot be issued."
      />
      <div className="filters">
        <select
          aria-label="Band"
          value={band}
          onChange={(e) => {
            setBand(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All</option>
          {[
            ['Expired', 'Expired'],
            ['Critical', 'Within 30 days'],
            ['High', '31–60 days'],
            ['Medium', '61–90 days'],
            ['Low', 'Over 90 days'],
          ].map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        {typeof loss === 'number' && loss > 0 ? (
          <span className="notice">Expired stock value: {inr(loss)}</span>
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Batch</th>
              <th scope="col">Warehouse</th>
              <th scope="col">Expiry</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Days left
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Qty
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Value
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.rows.length ?? 0) === 0 && !list.loading ? (
              <Empty cols={8}>No batches with an expiry date in stock.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((r) => (
              <tr key={`${r.batchId}${r.warehouse}`}>
                <td>
                  {r.itemCode} · {r.itemName}
                </td>
                <td>{r.batchNo}</td>
                <td>{r.warehouse}</td>
                <td>{dmy(r.expiryDate)}</td>
                <td style={{ textAlign: 'right' }}>{r.daysToExpiry}</td>
                <td style={{ textAlign: 'right' }}>{qty(r.qty)}</td>
                <td style={{ textAlign: 'right' }}>{inr(r.value)}</td>
                <td>
                  <Pill>{r.band === 'Expired' ? 'Expired' : r.status}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} size={20} total={list.data?.meta.total ?? 0} onPage={setPage} />
    </>
  );
}

export function ValuationPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [from, setFrom] = useState(`${todayIso().slice(0, 8)}01`);
  const [to, setTo] = useState(todayIso());
  const [page, setPage] = useState(1);
  const list = useLoad(() => valuationReport({ from, to, page }), [from, to, page]);
  const books = useLoad(glCompare, []);
  const [admin, setAdmin] = useState<'pre' | 'int' | 'cut' | null>(null);
  const pre = useLoad(() => (admin === 'pre' ? preflight() : Promise.resolve(null)), [admin]);
  const integ = useLoad(() => (admin === 'int' ? integrity() : Promise.resolve(null)), [admin]);
  const cut = useLoad(
    () => (admin === 'cut' ? cutoverPlan(todayIso()) : Promise.resolve(null)),
    [admin],
  );
  const [err, setErr] = useState('');
  return (
    <>
      <PageHead
        title="Stock Valuation"
        sub="Opening, receipts, issues and closing value of the stock, checked against the books."
      />
      <div className="filters">
        <label>
          From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <ErrorBox message={list.error || err} />
      <div className="card">
        <h3>Stock value vs the books</h3>
        {books.data ? (
          <>
            <p>
              {books.data.inBalance ? (
                <Pill tone="posted">In balance</Pill>
              ) : (
                <Pill tone="cancelled">Difference found</Pill>
              )}{' '}
              as of {dmy(books.data.asOf)}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Unit</th>
                    <th scope="col">Account</th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Stock value
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Books
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Difference
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {books.data.rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.unit}</td>
                      <td>{r.key}</td>
                      <td style={{ textAlign: 'right' }}>{inr(r.stockValue)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {r.glBalance === null ? '—' : inr(r.glBalance)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {r.variance === null ? '—' : inr(r.variance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p>Loading…</p>
        )}
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Warehouse</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Opening
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Receipts
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Issues
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Adjustments
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Closing
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Qty
              </th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.rows.length ?? 0) === 0 && !list.loading ? (
              <Empty cols={8}>No stock movement in this period.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((r, i) => (
              <tr key={i}>
                <td>
                  {r.itemCode} · {r.itemName}
                </td>
                <td>{r.warehouse}</td>
                <td style={{ textAlign: 'right' }}>{inr(r.opening)}</td>
                <td style={{ textAlign: 'right' }}>{inr(r.receipts)}</td>
                <td style={{ textAlign: 'right' }}>{inr(r.issues)}</td>
                <td style={{ textAlign: 'right' }}>{inr(r.adjustments)}</td>
                <td style={{ textAlign: 'right' }}>
                  <strong>{inr(r.closing)}</strong>
                </td>
                <td style={{ textAlign: 'right' }}>{qty(r.closingQty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} size={20} total={list.data?.meta.total ?? 0} onPage={setPage} />
      {actions.controls ? (
        <div className="card">
          <h3>Checks for the administrator</h3>
          <div className="actions">
            <button type="button" className="btn sm" onClick={() => setAdmin('pre')}>
              Pre-flight check
            </button>
            <button type="button" className="btn sm" onClick={() => setAdmin('int')}>
              Stock integrity
            </button>
            <button type="button" className="btn sm" onClick={() => setAdmin('cut')}>
              Books cut-over
            </button>
          </div>
          {admin === 'pre' && pre.data ? (
            <ul>
              {pre.data.checks.map((c) => (
                <li key={c.id}>
                  {c.count === 0 ? '✓' : c.level === 'blocker' ? '✗' : '!'} {c.name}
                  {c.count ? ` — ${c.count}: ${c.sample.join(', ')}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
          {admin === 'int' && integ.data ? (
            <ul>
              {integ.data.checks.map((c) => (
                <li key={c.id}>
                  {c.ok ? '✓' : '✗'} {c.id} {c.name}
                  {c.mismatches.length ? ` — ${c.mismatches.length} problem(s)` : ''}
                </li>
              ))}
            </ul>
          ) : null}
          {admin === 'cut' && cut.data ? (
            <>
              <ul>
                {cut.data.lines.map((l) => (
                  <li key={l.key}>
                    {l.key}: stock {inr(l.stock)} · books {inr(l.gl)} · to post {inr(l.diff)}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="btn sm primary"
                disabled={!cut.data.needed}
                onClick={() => {
                  void (async () => {
                    try {
                      await cutoverRun(todayIso());
                      toast('Books brought level with the stock.');
                      books.reload();
                      cut.reload();
                    } catch (e) {
                      setErr(toUiError(e).message);
                    }
                  })();
                }}
              >
                Post the opening entry for this unit
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export function ScanPage() {
  const [raw, setRaw] = useState('');
  const [context, setContext] = useState('LOOKUP');
  const [warehouseId, setW] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [err, setErr] = useState('');
  const go = async () => {
    setErr('');
    try {
      setResult(await scanCode(raw, context, warehouseId || undefined));
      setRaw('');
    } catch (e) {
      setErr(toUiError(e).message);
    }
  };
  return (
    <>
      <PageHead
        title="Barcode / QR"
        sub="Scan or type a barcode, a GS1 code, a batch, a serial number or a bin. Scanning never changes stock."
      />
      <ErrorBox message={err} />
      <div className="card">
        <div className="field">
          <label>
            Scan here
            <input
              autoFocus
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && raw) void go();
              }}
            />
          </label>
        </div>
        <div className="field">
          <label>
            Purpose
            <select value={context} onChange={(e) => setContext(e.target.value)}>
              {['LOOKUP', 'RECEIVE', 'COUNT', 'TRANSFER', 'ISSUE'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <WarehouseSelect
          value={warehouseId}
          onChange={setW}
          label="Warehouse (to recognise bins)"
        />
        <button type="button" className="btn primary" disabled={!raw} onClick={() => void go()}>
          Check
        </button>
      </div>
      {result ? (
        <div className={`notice${result.valid ? '' : ' error'}`} role="status">
          <strong>{result.valid ? 'OK' : 'Not valid'}</strong> · {result.kind} · {result.message}
          {result.batch ? (
            <div>
              Batch {result.batch.batchNo} · expires {dmy(result.batch.expiryDate)} ·{' '}
              {result.batch.qcStatus}
            </div>
          ) : null}
          {result.serial ? (
            <div>
              Serial {result.serial.serialNo} · {result.serial.status}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
