// Phase 12 rejection / rework register, quality alerts, monthly summary and the PPM and quality-cost monitors.
// Every figure is calculated on the server (R-15); the screen only shows it.
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { qdelete, qget, qlist, qpost, qput } from '../../lib/qmsApi';
import type { Row } from '../../lib/qmsApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, Empty, ErrorBox, inr, PageHead, Pill, todayIso } from '../finance/shared';
import { FormList } from './FormPages';
import { RefPicker, Tabs, s } from './Shared';

const thisMonth = (): string => todayIso().slice(0, 7);
const DISP: Record<string, string> = {
  HOLD: 'On hold',
  REWORK: 'Rework',
  SCRAP: 'Scrap',
  USE_AS_IS: 'Use as is',
  RETURN_TO_VENDOR: 'Return to vendor',
};
const VERDICT: Record<string, string> = { OK: 'Within target', OVER: 'Above target' };

function Verdict({ v }: { v: unknown }) {
  return v ? (
    <Pill tone={v === 'OK' ? 'approved' : 'rejected'}>{VERDICT[s(v)]}</Pill>
  ) : (
    <span>—</span>
  );
}

function RejectionDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    rejectDate: todayIso(),
    process: '',
    operator: '',
    itemId: '',
    part: '',
    holdQty: '',
    defect: '',
    defectType: 'DIMENSIONAL',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const field = (k: keyof typeof f, label: string, type = 'text') => (
    <div className="field">
      <label htmlFor={`rj-${k}`}>{label} *</label>
      <input id={`rj-${k}`} type={type} value={f[k]} onChange={(e) => set(k, e.target.value)} />
      {errors[k] ? <div className="field-error">{errors[k]}</div> : null}
    </div>
  );
  return (
    <Modal
      title="Record a rejection"
      sub="Parts put on hold at a process."
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setMsg('');
            setErrors({});
            qpost('/rejections', {
              ...f,
              itemId: f.itemId || undefined,
              operator: f.operator || undefined,
            })
              .then((r) => {
                toast(`Recorded ${s(r.number)}`);
                onDone();
              })
              .catch((e: unknown) => {
                const u = toUiError(e);
                setMsg(u.message);
                setErrors(u.fields);
              });
          }}
        >
          Save
        </button>
      }
    >
      <ErrorBox message={msg} />
      <div className="form-grid">
        {field('rejectDate', 'Date', 'date')}
        {field('process', 'Process')}
        <div className="field">
          <label htmlFor="rj-operator">Operator</label>
          <input
            id="rj-operator"
            value={f.operator}
            onChange={(e) => set('operator', e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="rj-itemId">Item (optional)</label>
          <RefPicker
            id="rj-itemId"
            kind="item"
            value={f.itemId}
            onChange={(id, l) => setF((x) => ({ ...x, itemId: id, part: x.part || l }))}
          />
        </div>
        {field('part', 'Part')}
        {field('holdQty', 'Quantity on hold')}
        {field('defect', 'Defect')}
        <div className="field">
          <label htmlFor="rj-defectType">Defect type *</label>
          <select
            id="rj-defectType"
            value={f.defectType}
            onChange={(e) => set('defectType', e.target.value)}
          >
            {[
              'DIMENSIONAL',
              'VISUAL',
              'MATERIAL',
              'PROCESS',
              'PAINT / COATING',
              'WELDING',
              'OTHER',
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
      </div>
    </Modal>
  );
}

function Rejections({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [month, setMonth] = useState(thisMonth());
  const [adding, setAdding] = useState(false);
  const [disposing, setDisposing] = useState<Row | null>(null);
  const [disp, setDisp] = useState('REWORK');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const list = useLoad(() => qlist('/rejections', { month }), [month]);
  const sum = useLoad(() => qget('/rejections/summary', { month }), [month]);
  const reload = () => {
    list.reload();
    sum.reload();
  };
  const groups: [string, string][] = [
    ['byProcess', 'By process'],
    ['byDefectType', 'By defect type'],
    ['byDisposition', 'By disposition'],
  ];
  return (
    <>
      <div className="toolbar">
        <label htmlFor="rj-month">Month</label>
        <input
          id="rj-month"
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            + Record rejection
          </button>
        ) : null}
      </div>
      <ErrorBox message={msg || list.error || sum.error} />
      {sum.data ? (
        <div className="card" style={{ padding: 12, marginBottom: 12 }}>
          <b>
            Monthly summary: {s((sum.data.total as Row).entries)} entries,{' '}
            {s((sum.data.total as Row).qty)} pieces on hold
          </b>
          <div className="form-grid">
            {groups.map(([k, label]) => (
              <div key={k}>
                <h4>{label}</h4>
                {((sum.data?.[k] as Row[]) ?? []).length === 0 ? <p>None</p> : null}
                {((sum.data?.[k] as Row[]) ?? []).map((g) => (
                  <div key={s(g.key)}>
                    {k === 'byDisposition' ? (DISP[s(g.key)] ?? s(g.key)) : s(g.key)}:{' '}
                    <b>{s(g.qty)}</b> ({s(g.entries)})
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>No.</th>
              <th>Date</th>
              <th>Process</th>
              <th>Operator</th>
              <th>Part</th>
              <th>Hold qty</th>
              <th>Defect</th>
              <th>Type</th>
              <th>Disposition</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data && list.data.rows.length === 0 && !list.loading ? (
              <Empty cols={11}>No rejections in this month.</Empty>
            ) : null}
            {(list.data?.rows ?? []).map((r) => (
              <tr key={s(r.id)}>
                <td>{s(r.number)}</td>
                <td>{dmy(s(r.rejectDate))}</td>
                <td>{s(r.process)}</td>
                <td>{s(r.operator)}</td>
                <td>{s(r.part)}</td>
                <td>{s(r.holdQty)}</td>
                <td>{s(r.defect)}</td>
                <td>{s(r.defectType)}</td>
                <td>{DISP[s(r.disposition)] ?? s(r.disposition)}</td>
                <td>
                  <Pill>{s(r.status)}</Pill>
                </td>
                <td>
                  {actions.edit && s(r.status) !== 'Cancelled' ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setDisposing(r);
                        setDisp(s(r.disposition) === 'HOLD' ? 'REWORK' : s(r.disposition));
                        setNote(s(r.dispositionNote));
                      }}
                    >
                      Decide
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding ? (
        <RejectionDialog
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            reload();
          }}
        />
      ) : null}
      {disposing ? (
        <Modal
          title={`What happens to ${s(disposing.number)}?`}
          sub={`${s(disposing.holdQty)} × ${s(disposing.part)}`}
          size="sm"
          onClose={() => setDisposing(null)}
          footer={
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setMsg('');
                qpost(
                  `/rejections/${s(disposing.id)}/dispose`,
                  { disposition: disp, ...(note ? { note } : {}) },
                  Number(disposing.version),
                )
                  .then(() => {
                    toast(`Updated ${s(disposing.number)}`);
                    setDisposing(null);
                    reload();
                  })
                  .catch((e: unknown) => {
                    setMsg(toUiError(e).message);
                    setDisposing(null);
                  });
              }}
            >
              Save
            </button>
          }
        >
          <div className="field">
            <label htmlFor="dp-d">Disposition *</label>
            <select id="dp-d" value={disp} onChange={(e) => setDisp(e.target.value)}>
              {Object.entries(DISP).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="dp-n">Note (rework operation, deviation approval, vendor return)</label>
            <input id="dp-n" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function Ppm({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [to, setTo] = useState(thisMonth());
  const from = `${Number(to.slice(0, 4)) - 1}-${to.slice(5, 7)}`;
  const rep = useLoad(() => qget('/reports/ppm', { from, to }), [from, to]);
  const [f, setF] = useState({
    month: thisMonth(),
    producedQty: '',
    rejectedQty: '',
    customerRejectedQty: '',
    salesValue: '',
  });
  const [msg, setMsg] = useState('');
  return (
    <>
      <div className="toolbar">
        <label htmlFor="pp-to">Up to month</label>
        <input id="pp-to" type="month" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <ErrorBox message={msg || rep.error} />
      <p>
        Target: internal {rep.data?.internalTarget ? s(rep.data.internalTarget) : 'not set'} PPM ·
        customer {rep.data?.customerTarget ? s(rep.data.customerTarget) : 'not set'} PPM. PPM =
        rejected ÷ produced × 1,000,000.
      </p>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th>Produced</th>
              <th>Rejected</th>
              <th>Customer rejected</th>
              <th>Internal PPM</th>
              <th />
              <th>Customer PPM</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rep.data && (rep.data.months as Row[]).length === 0 && !rep.loading ? (
              <Empty cols={8}>No figures yet. Enter a month below.</Empty>
            ) : null}
            {((rep.data?.months as Row[]) ?? []).map((m) => (
              <tr key={s(m.month)}>
                <td>{s(m.month)}</td>
                <td>{s(m.produced)}</td>
                <td>{s(m.rejected)}</td>
                <td>{s(m.customerRejected)}</td>
                <td>{s(m.internalPpm) || '—'}</td>
                <td>
                  <Verdict v={m.internalVsTarget} />
                </td>
                <td>{s(m.customerPpm) || '—'}</td>
                <td>
                  <Verdict v={m.customerVsTarget} />
                </td>
              </tr>
            ))}
          </tbody>
          {rep.data ? (
            <tfoot>
              <tr>
                <th>Total</th>
                <th>{s((rep.data.totals as Row).produced)}</th>
                <th>{s((rep.data.totals as Row).rejected)}</th>
                <th>{s((rep.data.totals as Row).customerRejected)}</th>
                <th>{s((rep.data.totals as Row).internalPpm) || '—'}</th>
                <th />
                <th>{s((rep.data.totals as Row).customerPpm) || '—'}</th>
                <th />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {actions.edit ? (
        <div className="card" style={{ padding: 12, marginTop: 12 }}>
          <h4>Enter the figures of a month</h4>
          <div className="form-grid">
            {(
              [
                ['month', 'Month', 'month'],
                ['producedQty', 'Produced quantity', 'text'],
                ['rejectedQty', 'Rejected in-house', 'text'],
                ['customerRejectedQty', 'Rejected by customers', 'text'],
                ['salesValue', 'Sales value (₹)', 'text'],
              ] as const
            ).map(([k, label, type]) => (
              <div className="field" key={k}>
                <label htmlFor={`pm-${k}`}>{label}</label>
                <input
                  id={`pm-${k}`}
                  type={type}
                  value={f[k]}
                  onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setMsg('');
              qput('/monthly', f)
                .then(() => {
                  toast(`Saved figures for ${f.month}`);
                  rep.reload();
                })
                .catch((e: unknown) => setMsg(toUiError(e).message));
            }}
          >
            Save month
          </button>
        </div>
      ) : null}
    </>
  );
}

const CATS: [string, string][] = [
  ['PREVENTION', 'Prevention'],
  ['APPRAISAL', 'Appraisal'],
  ['INTERNAL_FAILURE', 'Internal failure'],
  ['EXTERNAL_FAILURE', 'External failure'],
];
function QualityCost({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [to, setTo] = useState(thisMonth());
  const from = `${Number(to.slice(0, 4)) - 1}-${to.slice(5, 7)}`;
  const rep = useLoad(() => qget('/reports/quality-cost', { from, to }), [from, to]);
  const costs = useLoad(() => qget<{ rows: Row[] }>('/costs', { month: to }), [to]);
  const [f, setF] = useState({ category: 'PREVENTION', description: '', amount: '' });
  const [msg, setMsg] = useState('');
  return (
    <>
      <div className="toolbar">
        <label htmlFor="qc-to">Up to month</label>
        <input id="qc-to" type="month" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <ErrorBox message={msg || rep.error || costs.error} />
      <p>
        Quality cost % = (prevention + appraisal + internal failure + external failure) ÷ sales
        value × 100. Target: {rep.data?.target ? `${s(rep.data.target)} %` : 'not set'}.
      </p>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Month</th>
              {CATS.map(([, l]) => (
                <th key={l}>{l}</th>
              ))}
              <th>Total</th>
              <th>Sales</th>
              <th>Cost %</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rep.data && (rep.data.months as Row[]).length === 0 && !rep.loading ? (
              <Empty cols={9}>No cost entered yet.</Empty>
            ) : null}
            {((rep.data?.months as Row[]) ?? []).map((m) => (
              <tr key={s(m.month)}>
                <td>{s(m.month)}</td>
                <td>{inr(s(m.prevention))}</td>
                <td>{inr(s(m.appraisal))}</td>
                <td>{inr(s(m.internalFailure))}</td>
                <td>{inr(s(m.externalFailure))}</td>
                <td>{inr(s(m.total))}</td>
                <td>{inr(s(m.salesValue))}</td>
                <td>{s(m.costPercent) ? `${s(m.costPercent)} %` : '—'}</td>
                <td>
                  <Verdict v={m.vsTarget} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4>Entries of {to}</h4>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Description</th>
              <th>Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {costs.data && costs.data.rows.length === 0 && !costs.loading ? (
              <Empty cols={4}>No entries this month.</Empty>
            ) : null}
            {(costs.data?.rows ?? []).map((c) => (
              <tr key={s(c.id)}>
                <td>{CATS.find(([k]) => k === s(c.category))?.[1] ?? s(c.category)}</td>
                <td>{s(c.description)}</td>
                <td>{inr(s(c.amount))}</td>
                <td>
                  {actions.delete ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        qdelete(`/costs/${s(c.id)}`)
                          .then(() => {
                            toast('Entry removed');
                            costs.reload();
                            rep.reload();
                          })
                          .catch((e: unknown) => setMsg(toUiError(e).message));
                      }}
                    >
                      Remove
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {actions.add ? (
        <div className="card" style={{ padding: 12, marginTop: 12 }}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="qc-cat">Category</label>
              <select
                id="qc-cat"
                value={f.category}
                onChange={(e) => setF((x) => ({ ...x, category: e.target.value }))}
              >
                {CATS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="qc-desc">Description</label>
              <input
                id="qc-desc"
                value={f.description}
                onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="qc-amt">Amount (₹)</label>
              <input
                id="qc-amt"
                value={f.amount}
                onChange={(e) => setF((x) => ({ ...x, amount: e.target.value }))}
              />
            </div>
          </div>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setMsg('');
              qpost('/costs', { month: to, ...f })
                .then(() => {
                  toast('Cost added');
                  setF((x) => ({ ...x, description: '', amount: '' }));
                  costs.reload();
                  rep.reload();
                })
                .catch((e: unknown) => setMsg(toUiError(e).message));
            }}
          >
            Add cost to {to}
          </button>
        </div>
      ) : null}
    </>
  );
}

export function NcrPage({ actions }: { actions: ActionSet }) {
  const [tab, setTab] = useState<'rej' | 'alert' | 'ppm' | 'cost'>('rej');
  return (
    <>
      <PageHead
        title="Rejections, alerts and quality monitors"
        sub="Rejection and rework register with its monthly summary, quality alerts, PPM against target and quality cost."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['rej', 'Rejection / rework register'],
          ['alert', 'Quality alerts'],
          ['ppm', 'PPM monitor'],
          ['cost', 'Quality cost monitor'],
        ]}
      />
      {tab === 'rej' ? <Rejections actions={actions} /> : null}
      {tab === 'alert' ? <FormList kind="ALERT" actions={actions} /> : null}
      {tab === 'ppm' ? <Ppm actions={actions} /> : null}
      {tab === 'cost' ? <QualityCost actions={actions} /> : null}
    </>
  );
}
