// One job card (one operation of a production order): start setup or run, pause with a reason, resume, add a time entry, and
// complete with the counts. Used by the Work Orders screen and, with big buttons, by the tablet shop floor.
import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { mget, mpost } from '../../lib/mfgApi';
import type { Row } from '../../lib/mfgApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { ErrorBox, Pill } from '../finance/shared';
import { FileButton, ORDER_TONE, OptionSelect, s } from './Kit';
import { Act, Dialog, Grid, hhmm, num } from './Ui';

export function JobCardPanel({
  id,
  actions,
  big,
  onChanged,
}: {
  id: string;
  actions: ActionSet;
  big?: boolean;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const doc = useLoad(() => mget(`/job-cards/${id}`), [id]);
  const reasons = useLoad(() => mget<Row[]>('/downtime-reasons'), []);
  const scraps = useLoad(() => mget<Row[]>('/scrap-reasons'), []);
  const [counts, setCounts] = useState({ good: '', rejected: '', scrap: '', rework: '' });
  const [pauseReason, setPauseReason] = useState('');
  const [scrapReason, setScrapReason] = useState('');
  const [log, setLog] = useState<{ from: string; to: string } | null>(null);
  const [msg, setMsg] = useState('');
  const c = doc.data;
  const st = s(c?.status);
  const after = () => {
    doc.reload();
    onChanged?.();
  };
  const bigStyle = big ? { fontSize: 22, padding: '18px 28px', margin: 6 } : undefined;
  const act = (label: string, run: () => Promise<unknown>, primary = false, sure?: string) => (
    <span style={bigStyle}>
      <Act
        label={label}
        run={run}
        done={after}
        primary={primary || !!big}
        {...(sure ? { sure } : {})}
      />
    </span>
  );
  const canWork = actions.post;
  return (
    <div>
      <ErrorBox message={msg || doc.error} />
      {c ? (
        <>
          <p style={big ? { fontSize: 20 } : undefined}>
            <b>
              {s(c.orderNumber)} · {s(c.itemName)}
            </b>
            <br />
            Operation {s(c.seq)} {s(c.name)} at {s(c.workCentreCode)}{' '}
            <Pill tone={ORDER_TONE[st]}>{st}</Pill>
          </p>
          <p style={big ? { fontSize: 20 } : undefined}>
            Quantity in <b>{num(c.qtyIn)}</b> · good <b>{num(c.qtyDone)}</b> · rejected{' '}
            <b>{num(c.qtyRejected)}</b> · scrap <b>{num(c.qtyScrap)}</b> · rework{' '}
            <b>{num(c.qtyRework)}</b> · left <b>{num(c.remaining)}</b>
          </p>
          {canWork && st !== 'Done' ? (
            <div className="toolbar">
              {st === 'Pending' || st === 'In Progress' ? (
                <>
                  {act('Start setup', () => mpost(`/job-cards/${id}/start`, { kind: 'SETUP' }))}
                  {act('Start run', () => mpost(`/job-cards/${id}/start`, { kind: 'RUN' }))}
                </>
              ) : null}
              {st === 'Paused' ? act('Resume', () => mpost(`/job-cards/${id}/resume`, {})) : null}
              {st === 'In Progress' ? (
                <>
                  <OptionSelect
                    id={`jc-pause-${id}`}
                    value={pauseReason}
                    options={(reasons.data ?? []).map((r) => ({ id: s(r.id), label: s(r.name) }))}
                    onChange={setPauseReason}
                    blank="Why pause?"
                  />
                  {act('Pause', () => {
                    if (!pauseReason)
                      return Promise.reject(new Error('Choose why you are pausing.'));
                    return mpost(`/job-cards/${id}/pause`, { reasonId: pauseReason });
                  })}
                </>
              ) : null}
            </div>
          ) : null}
          {canWork && st !== 'Done' ? (
            <div className="form-grid">
              {(
                [
                  ['good', 'Good pieces'],
                  ['rejected', 'Rejected'],
                  ['scrap', 'Scrap'],
                  ['rework', 'Rework'],
                ] as const
              ).map(([k, label]) => (
                <div className="field" key={k}>
                  <label htmlFor={`jc-${k}-${id}`}>{label}</label>
                  <input
                    id={`jc-${k}-${id}`}
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    style={big ? { fontSize: 22, padding: 12 } : undefined}
                    value={counts[k]}
                    onChange={(e) => setCounts((o) => ({ ...o, [k]: e.target.value }))}
                  />
                </div>
              ))}
              <div className="field">
                <label htmlFor={`jc-sr-${id}`}>Scrap reason (if any scrap)</label>
                <OptionSelect
                  id={`jc-sr-${id}`}
                  value={scrapReason}
                  options={(scraps.data ?? []).map((r) => ({ id: s(r.id), label: s(r.name) }))}
                  onChange={setScrapReason}
                />
              </div>
            </div>
          ) : null}
          {canWork && st !== 'Done' ? (
            <div className="toolbar">
              {act(
                'Complete this card',
                () => {
                  const body: Record<string, unknown> = {};
                  for (const [k, v] of Object.entries(counts)) if (v !== '') body[k] = v;
                  if (scrapReason) body.scrapReasonId = scrapReason;
                  return mpost(`/job-cards/${id}/complete`, body);
                },
                true,
              )}
              {!big ? (
                <button type="button" className="btn" onClick={() => setLog({ from: '', to: '' })}>
                  Add a time entry
                </button>
              ) : null}
              {!big && actions.print ? (
                <FileButton
                  path={`/job-cards/${id}/print`}
                  name="job-card.pdf"
                  label="Print job card"
                />
              ) : null}
            </div>
          ) : null}
          {!big ? (
            <>
              <h4>Time entries</h4>
              <Grid
                rows={(c.timeLogs as Row[] | undefined) ?? []}
                rowKey={(r) => s(r.id)}
                empty="No time logged yet."
                cols={[
                  { h: 'Kind', r: (r) => s(r.kind) },
                  { h: 'From', r: (r) => hhmm(r.fromTs) },
                  { h: 'To', r: (r) => (r.toTs ? hhmm(r.toTs) : 'running') },
                  { h: 'Operator', r: (r) => s(r.operatorName) },
                ]}
              />
              <h4>Downtime</h4>
              <Grid
                rows={(c.downtime as Row[] | undefined) ?? []}
                rowKey={(r) => s(r.id)}
                empty="No downtime."
                cols={[
                  { h: 'Reason', r: (r) => s(r.reasonName) },
                  { h: 'From', r: (r) => hhmm(r.fromTs) },
                  { h: 'To', r: (r) => (r.toTs ? hhmm(r.toTs) : 'running') },
                  { h: 'Minutes', r: (r) => num(r.minutes) },
                ]}
              />
            </>
          ) : null}
          {log ? (
            <Dialog
              title="Add a time entry"
              sub="For work that was not timed on the tablet"
              onClose={() => setLog(null)}
              footer={
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    setMsg('');
                    mpost(`/job-cards/${id}/time-logs`, {
                      kind: 'RUN',
                      fromTs: new Date(log.from).toISOString(),
                      toTs: new Date(log.to).toISOString(),
                    })
                      .then(() => {
                        toast('Saved');
                        setLog(null);
                        after();
                      })
                      .catch((e: unknown) => setMsg(toUiError(e).message));
                  }}
                >
                  Save
                </button>
              }
            >
              <div className="field">
                <label htmlFor="tl-from">From</label>
                <input
                  id="tl-from"
                  type="datetime-local"
                  value={log.from}
                  onChange={(e) => setLog({ ...log, from: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="tl-to">To</label>
                <input
                  id="tl-to"
                  type="datetime-local"
                  value={log.to}
                  onChange={(e) => setLog({ ...log, to: e.target.value })}
                />
              </div>
            </Dialog>
          ) : null}
        </>
      ) : (
        <p>Loading…</p>
      )}
    </div>
  );
}
