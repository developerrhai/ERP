// Shop floor: a tablet view with big buttons (pick your work center, tap a card, start / pause / complete, log downtime) and the
// supervisor dashboard (OEE against target, rejection %, downtime, good pieces by hour, overdue orders).
import { useEffect, useState } from 'react';
import { mget, mlist, mpost } from '../../lib/mfgApi';
import type { Row } from '../../lib/mfgApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, ErrorBox, PageHead, Pill } from '../finance/shared';
import { Tabs } from '../qms/Shared';
import { JobCardPanel } from './JobCard';
import { ORDER_TONE, OptionSelect, s, useWorkCentres } from './Kit';
import { Act, Dialog, Grid, num } from './Ui';

export function ShopFloorPage({ actions }: { actions: ActionSet }) {
  const [tab, setTab] = useState<'tablet' | 'board'>('tablet');
  return (
    <>
      <PageHead
        title="Shop Floor"
        sub="For the machine tablet: pick the work center, tap a job card, and use the big buttons. Supervisors see the day's numbers on the second tab."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['tablet', 'Tablet'],
          ['board', 'Supervisor dashboard'],
        ]}
      />
      {tab === 'tablet' ? <Tablet actions={{ ...actions, post: true }} /> : <Dashboard />}
    </>
  );
}

function Tablet({ actions }: { actions: ActionSet }) {
  const wcs = useWorkCentres();
  const [wc, setWc] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [dt, setDt] = useState<Row | null>(null);
  const reasons = useLoad(() => mget<Row[]>('/downtime-reasons'), []);
  const [reason, setReason] = useState('');
  const list = useLoad(
    () => (wc ? mlist('/job-cards', { workCentreId: wc, size: 50 }) : Promise.resolve(null)),
    [wc],
  );
  useEffect(() => {
    if (!wc) return;
    const t = setInterval(() => list.reload(), 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a slow refresh of the board
  }, [wc]);
  const cards = (list.data?.rows ?? []).filter((r) => s(r.status) !== 'Done');
  return (
    <>
      <div className="toolbar" style={{ fontSize: 18 }}>
        <label htmlFor="sf-wc">Work center</label>
        <OptionSelect id="sf-wc" value={wc} options={wcs.data ?? []} onChange={setWc} />
      </div>
      <ErrorBox message={list.error} />
      {wc ? (
        <div className="toolbar">
          <OptionSelect
            id="sf-reason"
            value={reason}
            options={(reasons.data ?? []).map((r) => ({ id: s(r.id), label: s(r.name) }))}
            onChange={setReason}
            blank="Machine stopped: why?"
          />
          <span style={{ fontSize: 20 }}>
            <Act
              label="Machine stopped"
              primary
              run={async () => {
                if (!reason) throw new Error('Choose why the machine stopped.');
                setDt(await mpost('/downtime', { workCentreId: wc, reasonId: reason }));
              }}
            />
          </span>
          {dt ? (
            <span style={{ fontSize: 20 }}>
              <Act
                label="Machine running again"
                run={() => mpost(`/downtime/${s(dt.id)}/end`)}
                done={() => setDt(null)}
              />
            </span>
          ) : null}
        </div>
      ) : (
        <p>Pick a work center to see its job cards.</p>
      )}
      {wc ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 12,
          }}
        >
          {cards.length === 0 && !list.loading ? (
            <p>No open job cards for this work center.</p>
          ) : null}
          {cards.map((c) => (
            <button
              key={s(c.id)}
              type="button"
              className="card"
              style={{ padding: 16, textAlign: 'left', fontSize: 18, cursor: 'pointer' }}
              onClick={() => setOpen(s(c.id))}
            >
              <b>{s(c.orderNumber)}</b>
              <br />
              {s(c.itemName)}
              <br />
              Op {s(c.seq)} · {s(c.name)}
              <br />
              <Pill tone={ORDER_TONE[s(c.status)]}>{s(c.status)}</Pill>
            </button>
          ))}
        </div>
      ) : null}
      {open ? (
        <Dialog title="Job card" onClose={() => setOpen(null)}>
          <JobCardPanel id={open} actions={actions} big onChanged={() => list.reload()} />
        </Dialog>
      ) : null}
    </>
  );
}

const pct = (v: unknown): string => `${(Number(v) * 100).toFixed(1)}%`;
const below = (r: Row): boolean =>
  r.target !== null && r.target !== undefined && Number(r.oee) * 100 < Number(r.target);

function Dashboard() {
  const d = useLoad(() => mget('/shopfloor/summary'), []);
  const data = d.data;
  const oee = (data?.oee as Row[] | undefined) ?? [];
  const hourly = (data?.hourly as Row[] | undefined) ?? [];
  const orders = (data?.orders ?? {}) as Record<string, number>;
  const max = Math.max(1, ...hourly.map((h) => Number(h.good)));
  return (
    <>
      <ErrorBox message={d.error} />
      {data?.empty === true ? (
        <p>No data yet. Figures appear once job cards are logged today.</p>
      ) : null}
      {data ? (
        <>
          <p>
            Good pieces today <b>{num(data.goodPieces)}</b> · rejection{' '}
            <b>{data.rejectionPct ? `${s(data.rejectionPct)}%` : '—'}</b> · downtime{' '}
            <b>{num(data.downtimeMinutes)} min</b>
          </p>
          <p>
            Orders:{' '}
            {Object.entries(orders)
              .map(([k, v]) => `${k} ${v}`)
              .join(' · ') || 'none open'}
          </p>
          <h4>OEE by work center (availability × performance × quality)</h4>
          <Grid
            rows={oee}
            rowKey={(r) => s(r.workCentreId)}
            empty="No data yet."
            cols={[
              { h: 'Work center', r: (r) => `${s(r.code)} · ${s(r.name)}` },
              { h: 'Availability', r: (r) => (r.noData === true ? '—' : pct(r.availability)) },
              { h: 'Performance', r: (r) => (r.noData === true ? '—' : pct(r.performance)) },
              { h: 'Quality', r: (r) => (r.noData === true ? '—' : pct(r.quality)) },
              {
                h: 'OEE',
                r: (r) =>
                  r.noData === true ? (
                    'No data yet'
                  ) : (
                    <b style={{ color: below(r) ? '#b42318' : undefined }}>{pct(r.oee)}</b>
                  ),
              },
              { h: 'Target', r: (r) => (r.target ? `${s(r.target)}%` : '—') },
            ]}
          />
          <h4>Good pieces by hour</h4>
          {hourly.length === 0 ? (
            <p>No data yet.</p>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120 }}>
              {hourly.map((h) => (
                <div
                  key={s(h.hour)}
                  title={`${s(h.hour)}:00 — ${s(h.good)}`}
                  style={{ textAlign: 'center' }}
                >
                  <div
                    style={{
                      height: (Number(h.good) / max) * 90,
                      width: 22,
                      background: '#2563eb',
                    }}
                  />
                  <small>{s(h.hour)}</small>
                </div>
              ))}
            </div>
          )}
          <h4>Overdue orders</h4>
          <Grid
            rows={(data.overdue as Row[] | undefined) ?? []}
            rowKey={(r) => s(r.id)}
            empty="Nothing is overdue."
            cols={[
              { h: 'Order', r: (r) => s(r.number) },
              { h: 'Item', r: (r) => s(r.itemName) },
              { h: 'Due', r: (r) => dmy(s(r.dueDate).slice(0, 10)) },
              { h: 'Status', r: (r) => s(r.status) },
            ]}
          />
        </>
      ) : null}
    </>
  );
}
