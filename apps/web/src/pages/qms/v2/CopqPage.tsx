// COPQ (Cost of Poor Quality): internal failure (scrap, rework), external failure (customer claims), appraisal and
// prevention, month by month, with the trend chart and every cost line behind the figures.
import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../../components/Modal';
import { useToast } from '../../../components/Toast';
import { toUiError } from '../../../lib/errors';
import { qdelete, qget, qpost } from '../../../lib/qmsApi';
import { useLoad } from '../../../lib/useLoad';
import type { ActionSet } from '../../../types';
import { dmy, Empty, ErrorBox, inr } from '../../finance/shared';
import { useFrame } from '../../frame/V40TabFrame';
import { Confirm } from '../../wms/WmsRegister';
import { SERIES, StackedColumns } from './charts';
import { ImportButton } from './ImportDialog';
import { OwnTab } from './NcrDesk';
import { messageOf, monthIso, saveCsv } from './shared';

const PAGE = 'qms-copq';
const CATEGORY: Record<string, string> = {
  INTERNAL_FAILURE: 'Internal failure',
  EXTERNAL_FAILURE: 'External failure',
  APPRAISAL: 'Appraisal',
  PREVENTION: 'Prevention',
};
interface Month {
  month: string;
  scrap: string;
  rework: string;
  internalFailure: string;
  claims: string;
  externalFailure: string;
  appraisal: string;
  prevention: string;
  total: string;
  salesValue: string;
  costPercent: string | null;
}
interface Line {
  source: string;
  category: string;
  id: string;
  doc: string | null;
  description: string;
  amount: string;
  month: string;
}
interface Report {
  months: Month[];
  totals: Record<'scrap' | 'rework' | 'internalFailure' | 'claims' | 'externalFailure' | 'appraisal' | 'prevention' | 'total', string>;
  lines: Line[];
}
const monthName = (m: string): string => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`;

function AddCost({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ month: monthIso(), category: 'APPRAISAL', description: '', amount: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const set = (k: keyof typeof f, v: string): void => setF((x) => ({ ...x, [k]: v }));
  const save = (): void => {
    const missing: Record<string, string> = {};
    if (!f.month) missing.month = 'Choose the month.';
    if (f.description.trim().length < 3) missing.description = 'Say what the cost is.';
    if (!/^\d+(\.\d+)?$/.test(f.amount) || Number(f.amount) <= 0) missing.amount = 'Enter an amount above 0.';
    setErrors(missing);
    setMsg(Object.keys(missing).length ? 'Please fill the marked fields.' : '');
    if (Object.keys(missing).length) return;
    qpost('/copq/costs', f)
      .then(() => {
        toast('Cost added.');
        onDone();
      })
      .catch((e: unknown) => {
        const u = toUiError(e);
        setMsg(u.message);
        setErrors(u.fields);
      });
  };
  return (
    <Modal
      title="Add a quality cost"
      sub="Scrap, rework and customer claims are counted by themselves: enter only what they do not cover."
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <ErrorBox message={msg} />
      <div className="form-grid">
        <div className="field">
          <label htmlFor="qv-cost-month">Month *</label>
          <input id="qv-cost-month" type="month" value={f.month} onChange={(e) => set('month', e.target.value)} />
          {errors.month ? <div className="field-error">{errors.month}</div> : null}
        </div>
        <div className="field">
          <label htmlFor="qv-cost-category">Category *</label>
          <select id="qv-cost-category" value={f.category} onChange={(e) => set('category', e.target.value)}>
            {Object.entries(CATEGORY).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="field wide">
          <label htmlFor="qv-cost-description">Description *</label>
          <input id="qv-cost-description" maxLength={200} value={f.description} onChange={(e) => set('description', e.target.value)} />
          {errors.description ? <div className="field-error">{errors.description}</div> : null}
        </div>
        <div className="field">
          <label htmlFor="qv-cost-amount">Amount (₹) *</label>
          <input id="qv-cost-amount" inputMode="decimal" value={f.amount} onChange={(e) => set('amount', e.target.value)} />
          {errors.amount ? <div className="field-error">{errors.amount}</div> : null}
        </div>
      </div>
    </Modal>
  );
}

export function CopqPage({ actions, title, sub }: { actions: ActionSet; title: string; sub: string }) {
  const toast = useToast();
  const tab = useFrame()?.tabName ?? 'COPQ Summary';
  const [from, setFrom] = useState(monthIso(5));
  const [to, setTo] = useState(monthIso());
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const [remove, setRemove] = useState<Line | null>(null);
  const [category, setCategory] = useState('');
  const load = useLoad(() => qget<Report>('/copq', { from, to }), [from, to, tick]);
  const r = load.data;
  const reload = (): void => setTick((n) => n + 1);
  const months = r?.months ?? [];
  const lines = (r?.lines ?? []).filter((l) => !category || l.category === category);

  const exportAll = (): void => {
    if (!r) return;
    if (tab === 'Cost Entries')
      saveCsv('copq-cost-entries.csv', [['Month', 'Category', 'Source', 'Document', 'Description', 'Amount'], ...lines.map((l) => [l.month, CATEGORY[l.category], l.source, l.doc, l.description, l.amount])]);
    else
      saveCsv('copq-monthly.csv', [
        ['Month', 'Scrap', 'Rework', 'Internal failure', 'Customer claims', 'External failure', 'Appraisal', 'Prevention', 'Total', 'Sales value', 'COPQ % of sales'],
        ...months.map((m) => [m.month, m.scrap, m.rework, m.internalFailure, m.claims, m.externalFailure, m.appraisal, m.prevention, m.total, m.salesValue, m.costPercent]),
      ]);
  };
  const live = useRef(exportAll);
  live.current = exportAll;
  useEffect(() => {
    const onExport = (e: Event): void => {
      const { detail } = e as CustomEvent<{ pageId?: string; handled: boolean }>;
      if (detail.pageId !== PAGE || !actions.export) return;
      detail.handled = true;
      live.current();
    };
    window.addEventListener('v40-export-register', onExport);
    return () => window.removeEventListener('v40-export-register', onExport);
  }, [actions.export]);

  const tile = (label: string, value: string | undefined, note: string, color: string) => (
    <div className="card qv-tile" style={{ borderTopColor: color }}>
      <small>{label}</small>
      <b>{inr(value ?? '0')}</b>
      <span>{note}</span>
    </div>
  );

  return (
    <div className="qv-page">
      <ImportButton pageId={PAGE} kinds={actions.import ? ['cost'] : []} onDone={reload} />
      <OwnTab pageId={PAGE} title={title} sub={sub} actions={actions} add={[{ label: '＋ Add Quality Cost', onClick: () => setAdding(true) }]}>
        <div className="toolbar">
          <label htmlFor="qv-from">From</label>
          <input id="qv-from" type="month" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          <label htmlFor="qv-to">To</label>
          <input id="qv-to" type="month" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
          {actions.export ? (
            <button type="button" className="btn" disabled={!r} title={r ? undefined : 'Loading.'} onClick={exportAll}>
              Export
            </button>
          ) : null}
        </div>
        <ErrorBox message={load.error} />
        {r && tab !== 'Cost Entries' ? (
          <div className="qv-tiles">
            {tile('Internal failure', r.totals.internalFailure, `Scrap ${inr(r.totals.scrap)} · Rework ${inr(r.totals.rework)}`, SERIES.blue)}
            {tile('External failure', r.totals.externalFailure, `Customer claims ${inr(r.totals.claims)}`, SERIES.orange)}
            {tile('Appraisal', r.totals.appraisal, 'Inspection, testing, calibration', SERIES.aqua)}
            {tile('Prevention', r.totals.prevention, 'Training, planning, audits', SERIES.yellow)}
            {tile('Total COPQ', r.totals.total, `${months.length} month(s)`, '#172033')}
          </div>
        ) : null}
        {tab === 'Monthly Trend' ? (
          <section className="qv-card" aria-label="Monthly trend">
            <h3>Monthly cost of poor quality (₹)</h3>
            <StackedColumns
              caption="Monthly cost of poor quality by category"
              money={(v) => inr(v)}
              series={[
                { key: 'internalFailure', label: 'Internal failure', color: SERIES.blue },
                { key: 'externalFailure', label: 'External failure', color: SERIES.orange },
                { key: 'appraisal', label: 'Appraisal', color: SERIES.aqua },
                { key: 'prevention', label: 'Prevention', color: SERIES.yellow },
              ]}
              data={months.map((m) => ({
                label: monthName(m.month),
                values: { internalFailure: Number(m.internalFailure), externalFailure: Number(m.externalFailure), appraisal: Number(m.appraisal), prevention: Number(m.prevention) },
              }))}
            />
          </section>
        ) : null}
        {tab === 'Cost Entries' ? (
          <>
            <div className="toolbar">
              <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {Object.entries(CATEGORY).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <span className="qv-count">{lines.length} cost lines</span>
            </div>
            <div className="card table-wrap">
              <table className="register-table plain">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Category</th>
                    <th>Source</th>
                    <th>Document</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={`${l.source}-${l.id}`}>
                      <td>{monthName(l.month)}</td>
                      <td>{CATEGORY[l.category]}</td>
                      <td>{l.source}</td>
                      <td>{l.doc ?? '—'}</td>
                      <td>{l.description}</td>
                      <td className="num">{inr(l.amount)}</td>
                      <td>
                        {l.source === 'Entered' && actions.delete ? (
                          <button type="button" className="btn sm danger" onClick={() => setRemove(l)}>
                            Delete
                          </button>
                        ) : (
                          <span className="qv-note">{l.source === 'Entered' ? '—' : `From ${l.source.toLowerCase()}`}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {lines.length === 0 && !load.loading ? <Empty cols={7}>No quality cost in these months.</Empty> : null}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="card table-wrap">
            <table className="register-table plain">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Scrap</th>
                  <th>Rework</th>
                  <th>Internal failure</th>
                  <th>Customer claims</th>
                  <th>External failure</th>
                  <th>Appraisal</th>
                  <th>Prevention</th>
                  <th>Total</th>
                  <th>% of sales</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.month}>
                    <td>{monthName(m.month)}</td>
                    {(['scrap', 'rework', 'internalFailure', 'claims', 'externalFailure', 'appraisal', 'prevention', 'total'] as const).map((k) => (
                      <td key={k} className="num">
                        {inr(m[k])}
                      </td>
                    ))}
                    <td className="num" title={m.costPercent ? `Sales ${dmy(`${m.month}-01`).slice(3)}: ${inr(m.salesValue)}` : 'No sales figure saved for this month (Non-Conformance / NCR, monthly figures).'}>
                      {m.costPercent ? `${m.costPercent}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </OwnTab>
      {adding ? (
        <AddCost
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            reload();
          }}
        />
      ) : null}
      {remove ? (
        <Confirm
          title="Delete this cost?"
          text={`${remove.description} · ${inr(remove.amount)}`}
          action="Delete"
          onClose={() => setRemove(null)}
          onConfirm={() => {
            const l = remove;
            setRemove(null);
            qdelete(`/copq/costs/${l.id}`)
              .then(() => toast('Cost deleted.'))
              .catch((e: unknown) => toast(messageOf(e)))
              .finally(reload);
          }}
        />
      ) : null}
    </div>
  );
}
