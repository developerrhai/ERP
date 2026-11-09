// Phase 13 registers: scrap entries, rework orders (and the customer-challan rework register), WIP with its ledger check, and
// costing (cost per order, variances, yield). Every figure is the server's (R-15); nothing here posts to the ledger by itself.
import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { mget, mlist, mpost } from '../../lib/mfgApi';
import type { Row } from '../../lib/mfgApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, ErrorBox, inr, PageHead, Pill } from '../finance/shared';
import { RefPicker, Tabs } from '../qms/Shared';
import { ChallanReworkTab } from './JobWork';
import { FileButton, FormModal, ORDER_TONE, OptionSelect, s } from './Kit';
import { Act, Dialog, Grid, ReasonAct, num } from './Ui';

// ------------------------------------------------------------------------------------------------ scrap
export function ScrapPage({ actions }: { actions: ActionSet }) {
  const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);
  const list = useLoad(() => mlist('/scrap-entries', { status }), [status]);
  return (
    <>
      <PageHead
        title="Scrap Management"
        sub="Scrap is recorded as a draft, then submitted. Normal loss stays in the product cost; abnormal loss goes to the scrap-loss account. Scrap above the limit waits for approval."
      />
      <div className="toolbar">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {['Draft', 'Submitted', 'Cancelled'].map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            + Record scrap
          </button>
        ) : null}
        {actions.print ? (
          <FileButton path="/export/scrap" name="mfg-scrap.xlsx" label="Export Excel" />
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <p>
        Quantity <b>{num(list.data?.meta.totalQty)}</b> · loss posted{' '}
        <b>{inr(s(list.data?.meta.totalLoss ?? '0'))}</b>
      </p>
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="No scrap recorded."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'No.', r: (r) => s(r.number) },
          { h: 'Date', r: (r) => dmy(s(r.scrapDate).slice(0, 10)) },
          { h: 'Order', r: (r) => s(r.orderNumber) },
          { h: 'Operation', r: (r) => s(r.opName) || '—' },
          { h: 'Item', r: (r) => s(r.itemName) },
          { h: 'Qty', r: (r) => num(r.qty) },
          { h: 'Reason', r: (r) => s(r.reason) },
          { h: 'Kind', r: (r) => (r.isNormal === true ? 'Normal' : 'Abnormal') },
          { h: 'Loss', r: (r) => (r.lossValue ? inr(s(r.lossValue)) : '—') },
          { h: 'Status', r: (r) => <Pill tone={ORDER_TONE[s(r.status)]}>{s(r.status)}</Pill> },
          {
            h: '',
            r: (r) =>
              s(r.status) === 'Draft' ? (
                <>
                  {actions.post ? (
                    <Act
                      label="Submit"
                      primary
                      run={() => mpost(`/scrap-entries/${s(r.id)}/submit`)}
                      done={() => list.reload()}
                    />
                  ) : null}
                  {actions.cancel ? (
                    <ReasonAct
                      label="Cancel"
                      question="Why is it cancelled?"
                      run={(reason) => mpost(`/scrap-entries/${s(r.id)}/cancel`, { reason })}
                      done={() => list.reload()}
                    />
                  ) : null}
                </>
              ) : null,
          },
        ]}
      />
      {adding ? (
        <ScrapForm
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function ScrapForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const orders = useLoad(() => mlist('/production-orders'), []);
  const reasons = useLoad(() => mget<Row[]>('/scrap-reasons'), []);
  const [f, setF] = useState({
    orderId: '',
    qty: '',
    reasonId: '',
    recoverableQty: '',
    recoveryValue: '',
    recoveryItemId: '',
    recoveryLabel: '',
  });
  const [msg, setMsg] = useState('');
  const set = (p: Partial<typeof f>) => setF((o) => ({ ...o, ...p }));
  const live = (orders.data?.rows ?? []).filter((o) =>
    ['Released', 'In Progress', 'Completed'].includes(s(o.status)),
  );
  return (
    <Dialog
      title="Record scrap"
      onClose={onClose}
      error={msg}
      footer={
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setMsg('');
            mpost('/scrap-entries', {
              orderId: f.orderId,
              qty: f.qty,
              ...(f.reasonId ? { reasonId: f.reasonId } : {}),
              ...(f.recoverableQty ? { recoverableQty: f.recoverableQty } : {}),
              ...(f.recoveryValue ? { recoveryValue: f.recoveryValue } : {}),
              ...(f.recoveryItemId ? { recoveryItemId: f.recoveryItemId } : {}),
            })
              .then(() => {
                toast('Saved as a draft');
                onSaved();
              })
              .catch((e: unknown) => setMsg(toUiError(e).message));
          }}
        >
          Save draft
        </button>
      }
    >
      <div className="form-grid">
        <div className="field">
          <label htmlFor="sc-order">Production order *</label>
          <OptionSelect
            id="sc-order"
            value={f.orderId}
            options={live.map((o) => ({ id: s(o.id), label: `${s(o.number)} · ${s(o.itemName)}` }))}
            onChange={(v) => set({ orderId: v })}
          />
        </div>
        <div className="field">
          <label htmlFor="sc-qty">Scrap quantity *</label>
          <input
            id="sc-qty"
            type="number"
            min={0}
            step="any"
            value={f.qty}
            onChange={(e) => set({ qty: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="sc-reason">Reason *</label>
          <OptionSelect
            id="sc-reason"
            value={f.reasonId}
            options={(reasons.data ?? []).map((r) => ({
              id: s(r.id),
              label: `${s(r.name)}${r.normal === true ? ' (normal loss)' : ''}`,
            }))}
            onChange={(v) => set({ reasonId: v })}
          />
        </div>
        <div className="field">
          <label htmlFor="sc-rq">Recoverable quantity</label>
          <input
            id="sc-rq"
            type="number"
            min={0}
            step="any"
            value={f.recoverableQty}
            onChange={(e) => set({ recoverableQty: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="sc-rv">Recovery value</label>
          <input
            id="sc-rv"
            type="number"
            min={0}
            step="any"
            value={f.recoveryValue}
            onChange={(e) => set({ recoveryValue: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="sc-ri">Recovered as item</label>
          <RefPicker
            id="sc-ri"
            kind="item"
            value={f.recoveryItemId}
            label={f.recoveryLabel}
            onChange={(i, l) => set({ recoveryItemId: i, recoveryLabel: l })}
          />
        </div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------------ rework
export function ReworkPage({ actions }: { actions: ActionSet }) {
  const [tab, setTab] = useState<'house' | 'challan'>('house');
  return (
    <>
      <PageHead
        title="Rework Management"
        sub="Pieces sent for rework in production (hours and material are added to the order cost), and the rework register against the customer's delivery challan."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['house', 'Rework in production'],
          ['challan', 'Customer challan rework'],
        ]}
      />
      {tab === 'house' ? (
        <InHouseRework actions={actions} />
      ) : (
        <ChallanReworkTab actions={actions} />
      )}
    </>
  );
}

function InHouseRework({ actions }: { actions: ActionSet }) {
  const [status, setStatus] = useState('Open');
  const [done, setDone] = useState<Row | null>(null);
  const toast = useToast();
  const list = useLoad(() => mlist('/rework-orders', { status }), [status]);
  return (
    <>
      <div className="toolbar">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {['Open', 'Done', 'Cancelled'].map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        {actions.print ? (
          <FileButton path="/export/rework" name="mfg-rework.xlsx" label="Export Excel" />
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="No rework."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'No.', r: (r) => s(r.number) },
          { h: 'Order', r: (r) => s(r.orderNumber) },
          { h: 'Operation', r: (r) => s(r.opName) },
          { h: 'Item', r: (r) => s(r.itemName) },
          { h: 'Pieces', r: (r) => num(r.qty) },
          { h: 'Reason', r: (r) => s(r.reason) },
          { h: 'Good again', r: (r) => num(r.qtyOk) },
          { h: 'Scrap', r: (r) => num(r.qtyScrap) },
          { h: 'Rework cost', r: (r) => inr(s(r.cost)) },
          { h: 'Status', r: (r) => <Pill tone={ORDER_TONE[s(r.status)]}>{s(r.status)}</Pill> },
          {
            h: '',
            r: (r) =>
              s(r.status) === 'Open' && actions.post ? (
                <>
                  {r.releasedAt ? null : (
                    <Act
                      label="Release"
                      run={() => mpost(`/rework-orders/${s(r.id)}/release`)}
                      done={() => list.reload()}
                    />
                  )}
                  <button type="button" className="btn primary" onClick={() => setDone(r)}>
                    Finish
                  </button>
                </>
              ) : null,
          },
        ]}
      />
      {done ? (
        <FormModal
          title={`Finish rework ${s(done.number)}`}
          sub={`${num(done.qty)} pieces: every piece is good again or scrap`}
          fields={[
            { key: 'qtyOk', label: 'Good again', type: 'number', required: true },
            { key: 'qtyScrap', label: 'Scrap', type: 'number', required: true },
            { key: 'hours', label: 'Hours spent', type: 'number' },
            { key: 'materialCost', label: 'Extra material cost', type: 'number' },
            {
              key: 'reinspection',
              label: 'Re-inspection',
              type: 'select',
              options: ['ACCEPTED', 'REJECTED', 'PENDING'],
            },
          ]}
          initial={{ qtyOk: s(done.qty), qtyScrap: '0' }}
          onClose={() => setDone(null)}
          onSubmit={async (v) => {
            await mpost(`/rework-orders/${s(done.id)}/complete`, v);
            toast('Rework finished');
            setDone(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ WIP and costing
export function WipPage({ actions }: { actions: ActionSet }) {
  const list = useLoad(() => mget('/reports/wip'), []);
  const rec = useLoad(() => mget('/reports/wip-reconciliation'), []);
  const r = rec.data;
  return (
    <>
      <PageHead
        title="WIP Tracking"
        sub="Orders in production and the value each holds. The total must equal the Work-in-Process account of the ledger."
      />
      <div className="toolbar">
        {actions.print ? (
          <FileButton path="/export/wip" name="mfg-wip.xlsx" label="Export Excel" />
        ) : null}
      </div>
      <ErrorBox message={list.error || rec.error} />
      {r ? (
        <p role={r.exception === true ? 'alert' : undefined}>
          Cost ledger <b>{inr(s(r.ledger))}</b> · general ledger <b>{inr(s(r.generalLedger))}</b> ·
          difference <b>{inr(s(r.difference))}</b>{' '}
          {r.exception === true ? (
            <Pill tone="cancelled">Does not match: check it</Pill>
          ) : (
            <Pill tone="approved">Matches</Pill>
          )}
        </p>
      ) : null}
      <Grid
        rows={(list.data?.rows as Row[] | undefined) ?? []}
        loading={list.loading}
        empty="Nothing is in production."
        rowKey={(x) => s(x.id)}
        cols={[
          { h: 'Order', r: (x) => s(x.number) },
          { h: 'Item', r: (x) => s(x.itemName) },
          { h: 'Quantity', r: (x) => num(x.qty) },
          { h: 'Made', r: (x) => num(x.qtyCompleted) },
          { h: 'Scrapped', r: (x) => num(x.qtyScrapped) },
          { h: 'In rework', r: (x) => num(x.qtyRework) },
          { h: 'In stock', r: (x) => num(x.qtyReceived) },
          { h: 'Now at', r: (x) => s(x.currentOp) || '—' },
          { h: 'WIP value', r: (x) => inr(s(x.wipValue)) },
          { h: 'Status', r: (x) => <Pill tone={ORDER_TONE[s(x.status)]}>{s(x.status)}</Pill> },
        ]}
      />
    </>
  );
}

export function CostingPage({ actions }: { actions: ActionSet }) {
  const [tab, setTab] = useState<'cost' | 'var' | 'yield'>('cost');
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState<string | null>(null);
  const cost = useLoad(() => mget('/reports/costing', { q }), [q]);
  const vari = useLoad(() => mget('/reports/variance'), []);
  const yld = useLoad(() => mget('/reports/yield'), []);
  return (
    <>
      <PageHead
        title="Production Costing"
        sub="Material, labour and overhead per order, the cost per good piece against the standard, and the reported variances."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['cost', 'Cost per order'],
          ['var', 'Variances'],
          ['yield', 'Yield'],
        ]}
      />
      {tab === 'cost' ? (
        <>
          <div className="toolbar">
            <input
              aria-label="Search costing"
              placeholder="Search order or item"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {actions.print ? (
              <FileButton path="/export/costing" name="mfg-costing.xlsx" label="Export Excel" />
            ) : null}
          </div>
          <ErrorBox message={cost.error} />
          <Grid
            rows={(cost.data?.rows as Row[] | undefined) ?? []}
            loading={cost.loading}
            empty="No costed orders yet."
            rowKey={(x) => s(x.id)}
            cols={[
              { h: 'Order', r: (x) => s(x.number) },
              { h: 'Item', r: (x) => `${s(x.itemCode)} · ${s(x.itemName)}` },
              { h: 'Good pieces', r: (x) => num(x.qtyCompleted) },
              { h: 'Material', r: (x) => inr(s(x.material)) },
              { h: 'Labour', r: (x) => inr(s(x.labour)) },
              { h: 'Overhead', r: (x) => inr(s(x.overhead)) },
              { h: 'Abnormal scrap', r: (x) => inr(s(x.abnormalScrap)) },
              { h: 'Total', r: (x) => inr(s(x.total)) },
              { h: 'Cost / piece', r: (x) => (x.unitCost ? s(x.unitCost) : '—') },
              {
                h: 'Standard',
                r: (x) =>
                  x.standardCost === null || x.standardCost === undefined ? '—' : s(x.standardCost),
              },
              { h: 'Difference', r: (x) => (x.variancePerUnit ? s(x.variancePerUnit) : '—') },
              {
                h: '',
                r: (x) => (
                  <button type="button" className="btn" onClick={() => setSheet(s(x.id))}>
                    Cost sheet
                  </button>
                ),
              },
            ]}
          />
        </>
      ) : null}
      {tab === 'var' ? (
        <Grid
          rows={(vari.data?.rows as Row[] | undefined) ?? []}
          loading={vari.loading}
          empty="No data yet."
          rowKey={(x) => s(x.number)}
          cols={[
            { h: 'Order', r: (x) => s(x.number) },
            { h: 'Item', r: (x) => s(x.itemName) },
            { h: 'Material usage', r: (x) => inr(s(x.materialUsage)) },
            { h: 'Material price', r: (x) => inr(s(x.materialPrice)) },
            { h: 'Labour efficiency', r: (x) => s(x.efficiency) },
            { h: 'Yield', r: (x) => s(x.yield) },
          ]}
        />
      ) : null}
      {tab === 'yield' ? (
        <Grid
          rows={(yld.data?.rows as Row[] | undefined) ?? []}
          loading={yld.loading}
          empty="No data yet."
          rowKey={(x) => s(x.id)}
          cols={[
            { h: 'Order', r: (x) => s(x.number) },
            { h: 'Item', r: (x) => s(x.itemName) },
            { h: 'Ordered', r: (x) => num(x.qty) },
            { h: 'Good', r: (x) => num(x.qtyCompleted) },
            { h: 'Scrapped', r: (x) => num(x.qtyScrapped) },
            { h: 'Yield %', r: (x) => (x.yieldPct ? s(x.yieldPct) : '—') },
          ]}
        />
      ) : null}
      {sheet ? <CostSheet id={sheet} onClose={() => setSheet(null)} /> : null}
    </>
  );
}

function CostSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const doc = useLoad(() => mget(`/production-orders/${id}/cost-sheet`), [id]);
  const d = doc.data;
  const rows = Object.entries(d ?? {}).filter(([, v]) => typeof v !== 'object' || v === null);
  return (
    <Dialog title="Cost sheet" onClose={onClose} error={doc.error}>
      {d ? (
        <Grid
          rows={rows}
          rowKey={([k]) => k}
          cols={[
            { h: 'Item', r: ([k]) => k.replace(/([A-Z])/g, ' $1').toLowerCase() },
            { h: 'Value', r: ([, v]) => s(v) },
          ]}
        />
      ) : (
        <p>Loading…</p>
      )}
    </Dialog>
  );
}
