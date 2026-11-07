// Period close and year-end (admin-fy › close). A period closes only when nothing is half-done in it; the
// year-end moves the year's profit to Retained Earnings and seals the year. Both are explained before you click.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Field, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { toUiError } from '../../lib/errors';
import {
  closePeriod,
  closeView,
  closeYear,
  reopenPeriod,
  type CloseView,
} from '../../lib/financeApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet, FinancialYear } from '../../types';
import { dmy, Empty, ErrorBox, inr, PageHead, Pill } from './shared';

export function PeriodClosePage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const years = useLoad(() => api<FinancialYear[]>('/financial-years'), []);
  const [fyId, setFyId] = useState('');
  const current =
    fyId || (years.data ?? []).find((y) => y.isCurrent)?.id || (years.data ?? [])[0]?.id || '';
  const view = useLoad(() => (current ? closeView(current) : Promise.resolve(null)), [current]);
  const [err, setErr] = useState('');
  const [reopen, setReopen] = useState<CloseView['periods'][number] | null>(null);
  const [yearEnd, setYearEnd] = useState(false);
  const canChange = actions.edit;
  const v = view.data;
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setErr('');
    try {
      await fn();
      toast(msg);
      view.reload();
    } catch (e) {
      setErr(toUiError(e).message);
    }
  };
  return (
    <>
      <PageHead
        title="Period Close & Year-End"
        sub="Close each month once it is final. At the year end, the profit moves to Retained Earnings and the year is sealed."
      >
        <Link className="btn" to="/m/admin-fy">
          ← Financial Years
        </Link>
      </PageHead>
      <SelectField label="Financial year" value={current} onChange={setFyId}>
        {(years.data ?? []).map((y) => (
          <option key={y.id} value={y.id}>
            {y.code} {y.status === 'CLOSED' ? '(closed)' : ''}
          </option>
        ))}
      </SelectField>
      <ErrorBox message={view.error || err} />
      {v ? (
        <>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col">Open items</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {v.periods.map((p) => {
                  const blockers = [
                    p.draftJournals ? `${p.draftJournals} draft journal(s)` : '',
                    p.openBankStatements ? `${p.openBankStatements} unreconciled statement(s)` : '',
                  ].filter(Boolean);
                  return (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.label}</strong>
                      </td>
                      <td>{dmy(p.startDate)}</td>
                      <td>{dmy(p.endDate)}</td>
                      <td>{blockers.length ? blockers.join(', ') : 'Nothing pending'}</td>
                      <td>
                        <Pill>{p.status}</Pill>
                      </td>
                      <td>
                        {canChange && v.fy.status === 'OPEN' ? (
                          p.status === 'OPEN' ? (
                            <button
                              type="button"
                              className="btn sm"
                              disabled={blockers.length > 0}
                              title={
                                blockers.length
                                  ? `Cannot close: ${blockers.join(', ')}`
                                  : 'Close this month'
                              }
                              onClick={() =>
                                void act(() => closePeriod(p.id, p.version), `${p.label} closed.`)
                              }
                            >
                              Close month
                            </button>
                          ) : (
                            <button type="button" className="btn sm" onClick={() => setReopen(p)}>
                              Reopen
                            </button>
                          )
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                {view.loading && !v ? <Empty cols={6}>Loading…</Empty> : null}
              </tbody>
            </table>
          </div>
          <h2 style={{ marginTop: 24 }}>Year-end</h2>
          {v.fy.status === 'CLOSED' ? (
            <div className="notice" role="note">
              {v.fy.code} is closed. No more entries can be posted to it.
            </div>
          ) : (
            <>
              <div className="card table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Unit</th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        Profit for the year
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.preview.units.map((u) => (
                      <tr key={u.unitId}>
                        <td>{u.unit}</td>
                        <td style={{ textAlign: 'right' }}>{inr(u.netProfit)}</td>
                      </tr>
                    ))}
                    {v.preview.units.length === 0 ? (
                      <Empty cols={2}>No income or expense postings in this year.</Empty>
                    ) : null}
                  </tbody>
                </table>
              </div>
              {v.preview.draftJournals > 0 ? (
                <p className="field-error">
                  {v.preview.draftJournals} journal(s) are still Draft or waiting for approval. Post
                  or delete them first.
                </p>
              ) : null}
              {canChange ? (
                <button
                  type="button"
                  className="btn danger"
                  disabled={v.preview.draftJournals > 0}
                  title={
                    v.preview.draftJournals ? 'Finish the drafts first' : 'Close the financial year'
                  }
                  onClick={() => setYearEnd(true)}
                >
                  Close the year {v.fy.code}
                </button>
              ) : null}
            </>
          )}
        </>
      ) : null}
      {reopen ? (
        <ReopenModal
          period={reopen}
          onClose={() => setReopen(null)}
          onDone={() => {
            setReopen(null);
            view.reload();
            toast('Month reopened.');
          }}
        />
      ) : null}
      {yearEnd && v ? (
        <Modal
          title={`Close ${v.fy.code}?`}
          sub="This cannot be undone from here."
          size="sm"
          onClose={() => setYearEnd(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setYearEnd(false)}>
                Not now
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() =>
                  void (async () => {
                    setYearEnd(false);
                    await act(() => closeYear(v.fy.id), `${v.fy.code} closed.`);
                    years.reload();
                  })()
                }
              >
                Close the year
              </button>
            </>
          }
        >
          <p>
            The profit of each unit is posted to Retained Earnings, all 12 months are closed and
            nobody can post to <strong>{v.fy.code}</strong> again.
          </p>
        </Modal>
      ) : null}
    </>
  );
}

function ReopenModal({
  period,
  onClose,
  onDone,
}: {
  period: CloseView['periods'][number];
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  return (
    <Modal
      title={`Reopen ${period.label}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() =>
              void (async () => {
                if (reason.trim().length < 5) {
                  setErr('Enter a reason of at least 5 characters.');
                  return;
                }
                try {
                  await reopenPeriod(period.id, period.version, reason.trim());
                  onDone();
                } catch (e) {
                  setErr(toUiError(e).message);
                }
              })()
            }
          >
            Reopen
          </button>
        </>
      }
    >
      <ErrorBox message={err} />
      <Field
        label="Reason *"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why does this month need to change?"
      />
    </Modal>
  );
}
