// Stock Ageing, Expiry Tracking, Stock Valuation (with the books check, integrity and the GL cut-over) and Barcode scan.
import { useState } from 'react';
import { INV_HEADS } from './v40/heads';
import { InvTabView } from './v40/InvTabView';
import { useInvTab } from './v40/useInvTab';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import {
  cutoverPlan,
  cutoverRun,
  glCompare,
  integrity,
  preflight,
  scanCode,
  type ScanResult,
} from '../../lib/inventoryApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import {
  dmy,
  ErrorBox,
  inr,
  PageHead,
  Pill,
  todayIso,
  WarehouseSelect,
} from './shared';
import { DateField } from '../../ui/components';

export function StockAgeingPage() {
  const tab = useInvTab('inv-ageing', undefined, INV_HEADS['inv-ageing']);
  return tab ?? <StockAgeingPageBody />;
}

function StockAgeingPageBody() {
  return (
    <>
      <PageHead
        title="Stock Ageing"
        sub="How long the stock you hold has been lying in the store, and which items are slow or dead."
      />
      <InvTabView pageId="inv-ageing" tab="Ageing Summary" />
    </>
  );
}

export function ExpiryPage() {
  const tab = useInvTab('inv-expiry', undefined, INV_HEADS['inv-expiry']);
  return tab ?? <ExpiryPageBody />;
}

function ExpiryPageBody() {
  return (
    <>
      <PageHead
        title="Expiry Tracking"
        sub="Batches that have expired or will soon. Expired stock cannot be issued."
      />
      <InvTabView pageId="inv-expiry" tab="Expiry Dashboard" />
    </>
  );
}

export function ValuationPage({ actions }: { actions: ActionSet }) {
  const tab = useInvTab('inv-valuation', actions, INV_HEADS['inv-valuation']);
  return tab ?? <ValuationPageBody actions={actions} />;
}

function ValuationPageBody({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [from, setFrom] = useState(`${todayIso().slice(0, 8)}01`);
  const [to, setTo] = useState(todayIso());
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
          From <DateField value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To <DateField value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <ErrorBox message={err} />
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
      <InvTabView pageId="inv-valuation" tab="Valuation Summary" period={{ from, to }} />
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
