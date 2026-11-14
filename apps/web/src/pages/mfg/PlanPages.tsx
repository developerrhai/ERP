// Phase 13 planning: production plans (demand pulled from sales orders, capacity and material checks, release, run MRP), the
// daily board and capacity view kept from the first build, and MRP runs with their suggestions, pegging and exceptions.
import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { mget, mlist, mpost } from '../../lib/mfgApi';
import type { Row } from '../../lib/mfgApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, ErrorBox, PageHead, Pill, todayIso } from '../finance/shared';
import { RefPicker, Tabs } from '../qms/Shared';
import { CapacityTab, DailyBoard } from './BoardTabs';
import { FileButton, ORDER_TONE, OptionSelect, s, useWarehouses } from './Kit';
import { Act, Dialog, Grid, num } from './Ui';
import { DateField } from '../../ui/components';

// ------------------------------------------------------------------------------------------------ production plans
export function ProductionPlansPage({ actions }: { actions: ActionSet }) {
  const [tab, setTab] = useState<'plans' | 'board' | 'capacity'>('plans');
  return (
    <>
      <PageHead
        title="Production Planning"
        sub="Decide what to make and when: pull demand from sales orders, check capacity and material, release the plan, then run MRP on it."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['plans', 'Production plans'],
          ['board', 'Daily board'],
          ['capacity', 'Capacity'],
        ]}
      />
      {tab === 'plans' ? <PlanList actions={actions} /> : null}
      {tab === 'board' ? <DailyBoard actions={actions} /> : null}
      {tab === 'capacity' ? <CapacityTab /> : null}
    </>
  );
}

interface PlanLineDraft {
  itemId: string;
  itemLabel: string;
  plannedQty: string;
  requiredDate: string;
}

function PlanList({ actions }: { actions: ActionSet }) {
  const [status, setStatus] = useState('');
  const [view, setView] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const list = useLoad(() => mlist('/production-plans', { status }), [status]);
  return (
    <>
      <div className="toolbar">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['DRAFT', 'SUBMITTED', 'RELEASED', 'CLOSED'].map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            + New plan
          </button>
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="No production plans yet."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'Plan', r: (r) => s(r.number) },
          { h: 'Date', r: (r) => dmy(s(r.planDate)) },
          { h: 'Horizon (days)', r: (r) => s(r.horizonDays) },
          { h: 'Lines', r: (r) => s(r.lineCount) },
          { h: 'Status', r: (r) => <Pill tone={ORDER_TONE[s(r.status)]}>{s(r.status)}</Pill> },
          {
            h: '',
            r: (r) => (
              <button type="button" className="btn" onClick={() => setView(s(r.id))}>
                Open
              </button>
            ),
          },
        ]}
      />
      {view ? (
        <PlanView
          id={view}
          actions={actions}
          onClose={() => setView(null)}
          onChanged={() => list.reload()}
        />
      ) : null}
      {adding ? (
        <PlanForm
          onClose={() => setAdding(false)}
          onSaved={(id) => {
            setAdding(false);
            list.reload();
            setView(id);
          }}
        />
      ) : null}
    </>
  );
}

function PlanForm({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const [horizon, setHorizon] = useState('30');
  const [lines, setLines] = useState<PlanLineDraft[]>([
    { itemId: '', itemLabel: '', plannedQty: '', requiredDate: todayIso() },
  ]);
  const [msg, setMsg] = useState('');
  const set = (i: number, p: Partial<PlanLineDraft>) =>
    setLines((o) => o.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Dialog
      title="New production plan"
      onClose={onClose}
      error={msg}
      footer={
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setMsg('');
            mpost('/production-plans', {
              horizonDays: Number(horizon),
              lines: lines
                .filter((l) => l.itemId)
                .map((l) => ({
                  itemId: l.itemId,
                  plannedQty: l.plannedQty,
                  requiredDate: l.requiredDate,
                })),
            })
              .then((r) => onSaved(s(r.id)))
              .catch((e: unknown) => setMsg(toUiError(e).message));
          }}
        >
          Save draft
        </button>
      }
    >
      <div className="field">
        <label htmlFor="pp-h">Horizon in days</label>
        <input
          id="pp-h"
          type="number"
          min={1}
          max={365}
          value={horizon}
          onChange={(e) => setHorizon(e.target.value)}
        />
      </div>
      <p className="hint">
        Add lines by hand here, or open the plan afterwards and pull demand from sales orders.
      </p>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Quantity to make</th>
              <th>Needed by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <RefPicker
                    id={`pp-item-${i}`}
                    kind="item"
                    value={l.itemId}
                    label={l.itemLabel}
                    onChange={(x, lab) => set(i, { itemId: x, itemLabel: lab })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Planned quantity ${i + 1}`}
                    type="number"
                    min={0}
                    step="any"
                    value={l.plannedQty}
                    onChange={(e) => set(i, { plannedQty: e.target.value })}
                  />
                </td>
                <td>
                  <DateField
                    aria-label={`Needed by ${i + 1}`}
                    value={l.requiredDate}
                    onChange={(e) => set(i, { requiredDate: e.target.value })}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      setLines((o) => (o.length > 1 ? o.filter((_, j) => j !== i) : o))
                    }
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="btn"
        onClick={() =>
          setLines((o) => [
            ...o,
            { itemId: '', itemLabel: '', plannedQty: '', requiredDate: todayIso() },
          ])
        }
      >
        + Add line
      </button>
    </Dialog>
  );
}

function PlanView({
  id,
  actions,
  onClose,
  onChanged,
}: {
  id: string;
  actions: ActionSet;
  onClose: () => void;
  onChanged: () => void;
}) {
  const doc = useLoad(() => mget(`/production-plans/${id}`), [id]);
  const p = doc.data;
  const st = s(p?.status);
  const ver = Number(p?.version ?? 0);
  const after = () => {
    doc.reload();
    onChanged();
  };
  return (
    <Dialog
      title={p ? s(p.number) : 'Production plan'}
      sub={p ? `${st} · horizon ${s(p.horizonDays)} days` : ''}
      onClose={onClose}
      error={doc.error}
      footer={
        p ? (
          <>
            {st === 'DRAFT' && actions.edit ? (
              <>
                <Act
                  label="Pull demand from sales orders"
                  run={() => mpost(`/production-plans/${id}/pull-demand`)}
                  done={after}
                />
                <Act
                  label="Send for approval"
                  run={() => mpost(`/production-plans/${id}/submit`, {}, ver)}
                  done={after}
                />
              </>
            ) : null}
            <Act
              label="Check capacity"
              run={() => mpost(`/production-plans/${id}/check-capacity`)}
              done={after}
            />
            <Act
              label="Check material"
              run={() => mpost(`/production-plans/${id}/check-material`)}
              done={after}
            />
            {(st === 'DRAFT' || st === 'SUBMITTED') && actions.approve ? (
              <Act
                label="Release plan"
                primary
                run={() => mpost(`/production-plans/${id}/release`, {}, ver)}
                done={after}
              />
            ) : null}
            {st === 'RELEASED' ? (
              <>
                <Act
                  label="Run MRP on this plan"
                  primary
                  run={() => mpost(`/production-plans/${id}/run-mrp`)}
                  ok="MRP started: see the MRP page"
                  done={after}
                />
                {actions.approve ? (
                  <Act
                    label="Close plan"
                    run={() => mpost(`/production-plans/${id}/close`, {}, ver)}
                    done={after}
                  />
                ) : null}
              </>
            ) : null}
          </>
        ) : null
      }
    >
      {p ? (
        <Grid
          rows={(p.lines as Row[] | undefined) ?? []}
          rowKey={(r) => s(r.id)}
          cols={[
            { h: 'Item', r: (r) => `${s(r.itemCode)} · ${s(r.itemName)}` },
            { h: 'Source', r: (r) => s(r.soNumber) || s(r.demandSource) },
            { h: 'Demand', r: (r) => num(r.demandQty) },
            { h: 'To make', r: (r) => num(r.plannedQty) },
            { h: 'Needed by', r: (r) => dmy(s(r.requiredDate)) },
            {
              h: 'Capacity load %',
              r: (r) =>
                r.capacityLoadPct === null || r.capacityLoadPct === undefined
                  ? '—'
                  : num(r.capacityLoadPct),
            },
            {
              h: 'Material available %',
              r: (r) =>
                r.materialAvailPct === null || r.materialAvailPct === undefined
                  ? '—'
                  : num(r.materialAvailPct),
            },
          ]}
        />
      ) : (
        <p>Loading…</p>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------------ MRP
const TYPE_TEXT: Record<string, string> = { MAKE: 'Make', BUY: 'Buy' };

export function MrpPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [view, setView] = useState<string | null>(null);
  const [days, setDays] = useState('30');
  const [msg, setMsg] = useState('');
  const list = useLoad(() => mlist('/mrp-runs'), []);
  const live = (list.data?.rows ?? []).some((r) => ['QUEUED', 'RUNNING'].includes(s(r.status)));
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => list.reload(), 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload is stable enough for a poll
  }, [live]);
  return (
    <>
      <PageHead
        title="Material Requirement Planning"
        sub="MRP nets demand against stock, open orders, safety stock and lead time, then suggests what to make and what to buy. Each suggestion shows the demand behind it."
      />
      <div className="toolbar">
        {actions.post ? (
          <>
            <label htmlFor="mrp-days">Look ahead (days)</label>
            <input
              id="mrp-days"
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setMsg('');
                mpost('/mrp-runs', { horizonDays: Number(days) })
                  .then(() => {
                    toast('MRP started');
                    list.reload();
                  })
                  .catch((e: unknown) => setMsg(toUiError(e).message));
              }}
            >
              Run MRP
            </button>
          </>
        ) : null}
      </div>
      <ErrorBox message={msg || list.error} />
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="No MRP runs yet."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'Run', r: (r) => s(r.number) },
          { h: 'Started', r: (r) => dmy(s(r.createdAt).slice(0, 10)) },
          { h: 'Horizon', r: (r) => `${s(r.horizonDays)} days` },
          { h: 'Make', r: (r) => s(r.makeCount) },
          { h: 'Buy', r: (r) => s(r.buyCount) },
          { h: 'Exceptions', r: (r) => s(r.exceptionCount) },
          { h: 'Status', r: (r) => <Pill tone={ORDER_TONE[s(r.status)]}>{s(r.status)}</Pill> },
          {
            h: '',
            r: (r) => (
              <button type="button" className="btn" onClick={() => setView(s(r.id))}>
                Open
              </button>
            ),
          },
        ]}
      />
      {view ? <RunView id={view} actions={actions} onClose={() => setView(null)} /> : null}
    </>
  );
}

function RunView({
  id,
  actions,
  onClose,
}: {
  id: string;
  actions: ActionSet;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'sug' | 'buckets' | 'exc'>('sug');
  const [wh, setWh] = useState('');
  const [rm, setRm] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const whs = useWarehouses();
  const run = useLoad(() => mget(`/mrp-runs/${id}`), [id]);
  const sug = useLoad(() => mget<Row[]>(`/mrp-runs/${id}/suggestions`), [id]);
  const buckets = useLoad(() => mget<Row[]>(`/mrp-runs/${id}/buckets`), [id]);
  const exc = useLoad(() => mget<Row[]>(`/mrp-runs/${id}/exceptions`), [id]);
  const where = { ...(wh ? { warehouseId: wh } : {}), ...(rm ? { rmWarehouseId: rm } : {}) };
  const r = run.data;
  const open = (sug.data ?? []).filter((x) => ['OPEN', 'FIRMED'].includes(s(x.status)));
  return (
    <Dialog
      title={r ? `MRP ${s(r.number)}` : 'MRP run'}
      sub={r ? `${s(r.status)}${r.error ? ` · ${s(r.error)}` : ''}` : ''}
      onClose={onClose}
      error={run.error || sug.error}
      footer={
        <>
          {actions.print ? (
            <>
              <FileButton path={`/mrp-runs/${id}/export`} name="mrp.xlsx" label="Excel" />
              <FileButton path={`/mrp-runs/${id}/print`} name="mrp.pdf" label="Print" />
            </>
          ) : null}
          {actions.approve && picked.length ? (
            <Act
              label={`Convert ${picked.length} selected`}
              primary
              run={() => mpost('/mrp-suggestions/convert-bulk', { ids: picked, ...where })}
              done={() => {
                setPicked([]);
                sug.reload();
              }}
            />
          ) : null}
        </>
      }
    >
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['sug', 'Suggestions'],
          ['buckets', 'Time buckets'],
          ['exc', 'Exceptions'],
        ]}
      />
      {tab === 'sug' ? (
        <>
          <div className="toolbar">
            <label htmlFor="mrp-wh">Finished goods store</label>
            <OptionSelect id="mrp-wh" value={wh} options={whs.data ?? []} onChange={setWh} />
            <label htmlFor="mrp-rm">Raw material store</label>
            <OptionSelect id="mrp-rm" value={rm} options={whs.data ?? []} onChange={setRm} />
          </div>
          <Grid
            rows={sug.data ?? []}
            loading={sug.loading}
            empty="Nothing to make or buy: demand is covered."
            rowKey={(x) => s(x.id)}
            cols={[
              {
                h: '',
                r: (x) =>
                  ['OPEN', 'FIRMED'].includes(s(x.status)) && actions.approve ? (
                    <input
                      type="checkbox"
                      aria-label={`Select ${s(x.itemCode)}`}
                      checked={picked.includes(s(x.id))}
                      onChange={(e) =>
                        setPicked((o) =>
                          e.target.checked ? [...o, s(x.id)] : o.filter((i) => i !== s(x.id)),
                        )
                      }
                    />
                  ) : null,
              },
              { h: 'Item', r: (x) => `${s(x.itemCode)} · ${s(x.itemName)}` },
              { h: 'Action', r: (x) => TYPE_TEXT[s(x.type)] ?? s(x.type) },
              { h: 'Quantity', r: (x) => `${num(x.qty)} ${s(x.uom)}` },
              {
                h: 'Start by',
                r: (x) => (x.releaseDate ? dmy(s(x.releaseDate).slice(0, 10)) : '—'),
              },
              { h: 'Needed by', r: (x) => dmy(s(x.dueDate).slice(0, 10)) },
              {
                h: 'Why (pegging)',
                r: (x) =>
                  ((x.pegging as Row[] | null) ?? [])
                    .map((p) => `${s(p.type)} ${s(p.ref)}: ${num(p.qty)}`)
                    .join('; ') || '—',
              },
              { h: 'Status', r: (x) => <Pill tone={ORDER_TONE[s(x.status)]}>{s(x.status)}</Pill> },
              {
                h: '',
                r: (x) =>
                  ['OPEN', 'FIRMED'].includes(s(x.status)) ? (
                    <>
                      {s(x.status) === 'OPEN' && actions.edit ? (
                        <Act
                          label="Firm"
                          run={() => mpost(`/mrp-suggestions/${s(x.id)}/firm`)}
                          done={() => sug.reload()}
                        />
                      ) : null}
                      {actions.edit ? (
                        <Act
                          label="Ignore"
                          run={() => mpost(`/mrp-suggestions/${s(x.id)}/ignore`)}
                          done={() => sug.reload()}
                        />
                      ) : null}
                      {actions.approve ? (
                        <Act
                          label="Convert"
                          primary
                          run={() => mpost(`/mrp-suggestions/${s(x.id)}/convert`, where)}
                          ok="Converted"
                          done={() => sug.reload()}
                        />
                      ) : null}
                    </>
                  ) : s(x.convertedDocType) ? (
                    s(x.convertedDocType)
                  ) : null,
              },
            ]}
          />
          {open.length === 0 ? null : (
            <p className="hint">
              Buy suggestions become one draft requisition; make suggestions become draft production
              orders.
            </p>
          )}
        </>
      ) : null}
      {tab === 'buckets' ? (
        <Grid
          rows={buckets.data ?? []}
          loading={buckets.loading}
          empty="No data yet."
          rowKey={(b) => s(b.id)}
          cols={[
            { h: 'Item', r: (b) => `${s(b.itemCode)} · ${s(b.itemName)}` },
            { h: 'Period', r: (b) => dmy(s(b.bucketDate).slice(0, 10)) },
            { h: 'Gross need', r: (b) => num(b.gross) },
            { h: 'Coming in', r: (b) => num(b.scheduledReceipts) },
            { h: 'Projected on hand', r: (b) => num(b.projectedOnHand) },
            { h: 'Net need', r: (b) => num(b.net) },
            { h: 'Planned order', r: (b) => num(b.plannedReceipt) },
          ]}
        />
      ) : null}
      {tab === 'exc' ? (
        <Grid
          rows={exc.data ?? []}
          loading={exc.loading}
          empty="No exceptions."
          rowKey={(e) => s(e.id)}
          cols={[
            { h: 'Item', r: (e) => `${s(e.itemCode)} ${s(e.itemName)}` },
            { h: 'Problem', r: (e) => s(e.code).replace(/_/g, ' ').toLowerCase() },
            { h: 'Detail', r: (e) => s(e.message) },
          ]}
        />
      ) : null}
    </Dialog>
  );
}
