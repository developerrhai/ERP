// Two helpers opened from Journal Entries: recurring journals (templates, "Run due") and exchange rates with the
// month-end revaluation preview of open foreign-currency bills.
import { useState } from 'react';
import { Field, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { useAppContext } from '../../lib/context';
import { toUiError } from '../../lib/errors';
import {
  createRecurring,
  deleteRecurring,
  listAccounts,
  listDimension,
  listFxRates,
  listRecurring,
  revaluation,
  runRecurring,
  saveFxRate,
  setRecurringStatus,
  type Revaluation,
  type RunResult,
} from '../../lib/financeApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, Empty, ErrorBox, inr, Pill, todayIso } from './shared';
import { DateField } from '../../ui/components';

const FREQ: Record<string, string> = {
  WEEKLY: 'Every week',
  MONTHLY: 'Every month',
  QUARTERLY: 'Every 3 months',
  YEARLY: 'Every year',
};

export function RecurringModal({ actions, onClose }: { actions: ActionSet; onClose: () => void }) {
  const toast = useToast();
  const list = useLoad(listRecurring, []);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<RunResult | null>(null);
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setErr('');
    try {
      await fn();
      toast(msg);
      list.reload();
    } catch (e) {
      setErr(toUiError(e).message);
    }
  };
  return (
    <Modal
      title="Recurring journals"
      sub="Entries that repeat (rent, depreciation, accruals). Run them when they fall due."
      onClose={onClose}
      footer={
        <>
          {actions.add ? (
            <button type="button" className="btn" onClick={() => setAdding(true)}>
              ＋ New template
            </button>
          ) : null}
          {actions.post ? (
            <button
              type="button"
              className="btn primary"
              title="Create (or post) every journal that is due today or earlier, and reverse accruals that are due"
              onClick={() =>
                void (async () => {
                  setErr('');
                  try {
                    setResult(await runRecurring(todayIso()));
                    list.reload();
                  } catch (e) {
                    setErr(toUiError(e).message);
                  }
                })()
              }
            >
              Run what is due
            </button>
          ) : null}
        </>
      }
    >
      <ErrorBox message={list.error || err} />
      {result ? (
        <div className="notice" role="status">
          {result.created.length} journal(s) created, {result.reversed.length} accrual(s) reversed
          {result.failures.length
            ? `, ${result.failures.length} could not run: ${result.failures.map((f) => `${f.template} (${f.error})`).join('; ')}`
            : '.'}
        </div>
      ) : null}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Template</th>
              <th scope="col">Repeats</th>
              <th scope="col">Next run</th>
              <th scope="col">Posting</th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((t) => (
              <tr key={t.id}>
                <td>
                  <strong>{t.name}</strong>
                </td>
                <td>{FREQ[t.frequency] ?? t.frequency}</td>
                <td>{dmy(t.nextRun)}</td>
                <td>
                  {t.autoPost ? 'Posted automatically' : 'Saved as a Draft'}
                  {t.reverseNextDay ? ', reversed next day' : ''}
                </td>
                <td>
                  <Pill>{t.status}</Pill>
                </td>
                <td>
                  <div className="actions">
                    {actions.edit && t.status !== 'Finished' ? (
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() =>
                          void act(
                            () =>
                              setRecurringStatus(
                                t.id,
                                t.version,
                                t.status === 'Active' ? 'Paused' : 'Active',
                              ),
                            t.status === 'Active' ? 'Paused.' : 'Resumed.',
                          )
                        }
                      >
                        {t.status === 'Active' ? 'Pause' : 'Resume'}
                      </button>
                    ) : null}
                    {actions.delete ? (
                      <button
                        type="button"
                        className="btn sm danger"
                        aria-label={`Delete ${t.name}`}
                        onClick={() => void act(() => deleteRecurring(t.id), 'Template deleted.')}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {list.data && list.data.length === 0 ? (
              <Empty cols={6}>No templates yet. Click ＋ New template.</Empty>
            ) : null}
          </tbody>
        </table>
      </div>
      {adding ? (
        <TemplateForm
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            list.reload();
            toast('Template saved.');
          }}
        />
      ) : null}
    </Modal>
  );
}

function TemplateForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const ctx = useAppContext().data;
  const accounts = useLoad(() => listAccounts({ postable: true }), []);
  const centers = useLoad(() => listDimension('cost'), []);
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState('MONTHLY');
  const [nextRun, setNextRun] = useState(todayIso());
  const [autoPost, setAutoPost] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [lines, setLines] = useState([
    { accountId: '', debit: '', credit: '', costCenterId: '' },
    { accountId: '', debit: '', credit: '', costCenterId: '' },
  ]);
  const [err, setErr] = useState('');
  const set = (i: number, p: Partial<(typeof lines)[number]>) =>
    setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const dr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const cr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  return (
    <Modal
      title="New recurring template"
      onClose={onClose}
      footer={
        <>
          <span className={Math.abs(dr - cr) < 0.005 ? 'v8-sub' : 'field-error'} role="status">
            Debit {inr(dr)} · Credit {inr(cr)}
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() =>
              void (async () => {
                if (name.trim().length < 2 || !ctx?.current.unitId) {
                  setErr('Give the template a name and choose a unit at the top of the screen.');
                  return;
                }
                try {
                  await createRecurring({
                    unitId: ctx.current.unitId,
                    name: name.trim(),
                    frequency,
                    nextRun,
                    autoPost,
                    reverseNextDay: reverse,
                    lines: lines
                      .filter((l) => l.accountId)
                      .map((l) => ({
                        accountId: l.accountId,
                        debit: l.debit || '0',
                        credit: l.credit || '0',
                        ...(l.costCenterId ? { costCenterId: l.costCenterId } : {}),
                      })),
                  });
                  onSaved();
                } catch (e) {
                  setErr(toUiError(e).message);
                }
              })()
            }
          >
            Save template
          </button>
        </>
      }
    >
      <ErrorBox message={err} />
      <Field
        label="Name *"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Monthly rent"
      />
      <div className="grid2">
        <SelectField label="Repeats *" value={frequency} onChange={setFrequency}>
          {Object.entries(FREQ).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectField>
        <Field
          label="First date *"
          type="date"
          value={nextRun}
          onChange={(e) => setNextRun(e.target.value)}
        />
      </div>
      <label className="check">
        <input type="checkbox" checked={autoPost} onChange={(e) => setAutoPost(e.target.checked)} />{' '}
        Post it automatically (otherwise it is saved as a Draft for you to check)
      </label>
      <label className="check">
        <input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} />{' '}
        Reverse it the next day (for accruals)
      </label>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col">Cost centre</th>
              <th scope="col">Debit</th>
              <th scope="col">Credit</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <select
                    aria-label={`Template line ${i + 1} account`}
                    value={l.accountId}
                    onChange={(e) => set(i, { accountId: e.target.value })}
                  >
                    <option value="">Choose…</option>
                    {(accounts.data?.rows ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    aria-label={`Template line ${i + 1} cost centre`}
                    value={l.costCenterId}
                    onChange={(e) => set(i, { costCenterId: e.target.value })}
                  >
                    <option value="">—</option>
                    {(centers.data?.rows ?? [])
                      .filter((d) => !d.isGroup)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.code}
                        </option>
                      ))}
                  </select>
                </td>
                <td>
                  <input
                    aria-label={`Template line ${i + 1} debit`}
                    inputMode="decimal"
                    value={l.debit}
                    onChange={(e) =>
                      set(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })
                    }
                  />
                </td>
                <td>
                  <input
                    aria-label={`Template line ${i + 1} credit`}
                    inputMode="decimal"
                    value={l.credit}
                    onChange={(e) =>
                      set(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="btn sm"
        onClick={() =>
          setLines((ls) => [...ls, { accountId: '', debit: '', credit: '', costCenterId: '' }])
        }
      >
        ＋ Add line
      </button>
    </Modal>
  );
}

export function FxModal({ canEdit, onClose }: { canEdit: boolean; onClose: () => void }) {
  const toast = useToast();
  const rates = useLoad(listFxRates, []);
  const [currencyCode, setCur] = useState('USD');
  const [rateDate, setDate] = useState(todayIso());
  const [rate, setRate] = useState('');
  const [asOf, setAsOf] = useState(todayIso());
  const [reval, setReval] = useState<Revaluation | null>(null);
  const [err, setErr] = useState('');
  return (
    <Modal
      title="Exchange rates"
      sub="INR for 1 unit of the foreign currency. Used on foreign-currency journal lines and the revaluation check."
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <ErrorBox message={rates.error || err} />
      {canEdit ? (
        <div className="grid2">
          <Field
            label="Currency"
            value={currencyCode}
            maxLength={3}
            onChange={(e) => setCur(e.target.value.toUpperCase())}
          />
          <Field
            label="Date"
            type="date"
            value={rateDate}
            onChange={(e) => setDate(e.target.value)}
          />
          <Field
            label="Rate (INR)"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="83.2000"
          />
          <div className="field" style={{ alignSelf: 'end' }}>
            <button
              id="fx-save"
              type="button"
              className="btn primary"
              onClick={() =>
                void (async () => {
                  setErr('');
                  try {
                    await saveFxRate({ currencyCode, rateDate, rate });
                    setRate('');
                    rates.reload();
                    toast('Rate saved.');
                  } catch (e) {
                    setErr(toUiError(e).message);
                  }
                })()
              }
            >
              Save rate
            </button>
          </div>
        </div>
      ) : null}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Currency</th>
              <th scope="col">Date</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Rate (INR)
              </th>
            </tr>
          </thead>
          <tbody>
            {(rates.data?.rows ?? []).map((r) => (
              <tr key={r.id}>
                <td>{r.currencyCode}</td>
                <td>{dmy(r.rateDate)}</td>
                <td style={{ textAlign: 'right' }}>{Number(r.rate).toFixed(4)}</td>
              </tr>
            ))}
            {rates.data && rates.data.rows.length === 0 ? (
              <Empty cols={3}>No rates yet. Add the first one above.</Empty>
            ) : null}
          </tbody>
        </table>
      </div>
      <h3 style={{ marginTop: 16 }}>Month-end revaluation check</h3>
      <div className="recordbar">
        <DateField
          aria-label="Revalue as on"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
        />
        <button
          type="button"
          className="btn"
          onClick={() =>
            void (async () => {
              setErr('');
              try {
                setReval(await revaluation(asOf));
              } catch (e) {
                setReval(null);
                setErr(toUiError(e).message);
              }
            })()
          }
        >
          Check open foreign bills
        </button>
      </div>
      {reval ? (
        <>
          <div className="kpis">
            <div className="kpi">
              <small>Unrealised gain</small>
              <b>{inr(reval.unrealisedGain)}</b>
            </div>
            <div className="kpi">
              <small>Unrealised loss</small>
              <b>{inr(reval.unrealisedLoss)}</b>
            </div>
          </div>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Bill</th>
                  <th scope="col">Currency</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Rate
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Books
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    At new rate
                  </th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {reval.lines.map((l) => (
                  <tr key={l.itemId}>
                    <td>{l.docNo}</td>
                    <td>{l.currency}</td>
                    <td style={{ textAlign: 'right' }}>{Number(l.rate).toFixed(4)}</td>
                    <td style={{ textAlign: 'right' }}>{inr(l.carrying)}</td>
                    <td style={{ textAlign: 'right' }}>{inr(l.revalued)}</td>
                    <td>
                      {l.result} {l.result === 'None' ? '' : inr(Math.abs(Number(l.difference)))}
                    </td>
                  </tr>
                ))}
                {reval.lines.length === 0 ? (
                  <Empty cols={6}>No open foreign-currency bills.</Empty>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="v8-sub">
            This is a check only. Post the difference as a journal if your auditor wants it booked.
          </p>
        </>
      ) : null}
    </Modal>
  );
}
