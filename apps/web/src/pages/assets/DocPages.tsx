// Phase 14 fixed-asset documents: capitalisation (AS 10 cost, CWIP to asset), allocation, transfer, depreciation runs (book posts
// to the ledger, tax is a memo) and disposal. Draft -> approval -> post; the server checks every rule.
import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { aget, alist, apost, aput } from '../../lib/assetApi';
import type { Row } from '../../lib/assetApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, ErrorBox, inr, PageHead, Pill } from '../finance/shared';
import { Tabs } from '../qms/Shared';
import {
  Act,
  AssetSelect,
  Dialog,
  FormModal,
  Grid,
  ReasonAct,
  TONE,
  num,
  s,
  todayIso,
  useAccountOptions,
  useCostCentreOptions,
  useUnitOptions,
  useUserOptions,
} from './Shared';
import { DateField } from '../../ui/components';

const pill = (v: unknown) => <Pill tone={TONE[s(v)]}>{s(v).replace(/_/g, ' ')}</Pill>;
const day = (v: unknown) => (v ? dmy(s(v).slice(0, 10)) : '—');

/** The submit / approve / post buttons every asset document shares. */
function DocButtons({
  base,
  d,
  actions,
  after,
  postLabel,
  cancelQuestion,
}: {
  base: string;
  d: Row;
  actions: ActionSet;
  after: () => void;
  postLabel: string;
  cancelQuestion: string;
}) {
  const ver = Number(d.version);
  const st = s(d.status);
  const ap = s(d.approvalStatus);
  return (
    <>
      {st === 'DRAFT' && ['DRAFT', 'REJECTED'].includes(ap) && actions.submit ? (
        <Act
          label="Send for approval"
          primary
          run={() => apost(`${base}/${s(d.id)}/submit`, {}, ver)}
          done={after}
        />
      ) : null}
      {st === 'DRAFT' && ap === 'PENDING' && actions.approve ? (
        <>
          <Act
            label="Approve"
            primary
            run={() => apost(`${base}/${s(d.id)}/approve`, {}, ver)}
            done={after}
          />
          <Act
            label="Reject"
            run={() => apost(`${base}/${s(d.id)}/reject`, {}, ver)}
            done={after}
          />
        </>
      ) : null}
      {st === 'DRAFT' && ap === 'APPROVED' && actions.post ? (
        <Act
          label={postLabel}
          primary
          run={() => apost(`${base}/${s(d.id)}/post`, {}, ver)}
          done={after}
        />
      ) : null}
      {st !== 'CANCELLED' && actions.cancel ? (
        <ReasonAct
          label="Cancel"
          question={cancelQuestion}
          run={(reason) => apost(`${base}/${s(d.id)}/cancel`, { reason }, ver)}
          done={after}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ capitalisation
export function CapitalisationPage({ actions }: { actions: ActionSet }) {
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const list = useLoad(() => alist('/assets/capitalisations'), []);
  return (
    <>
      <PageHead
        title="Capitalisation"
        sub="Turn an asset in capital work in progress into a working asset: price + freight + installation + testing + fees. GST you claim stays out of the cost."
      />
      <div className="toolbar">
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            + New capitalisation
          </button>
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="Nothing capitalised yet. Create the asset on Asset Master first, then click + New capitalisation."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'No.', r: (r) => s(r.capNo) },
          { h: 'Asset', r: (r) => `${s(r.assetNo)} · ${s(r.assetName)}` },
          { h: 'Date', r: (r) => day(r.capitalisationDate) },
          { h: 'Source', r: (r) => s(r.source).replace('_', ' ') },
          { h: 'Cost', r: (r) => inr(s(r.totalCost)) },
          { h: 'Approval', r: (r) => pill(r.approvalStatus) },
          { h: 'Status', r: (r) => pill(r.status) },
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
      {adding ? (
        <CapForm
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            list.reload();
          }}
        />
      ) : null}
      {view ? (
        <CapView
          id={view}
          actions={actions}
          onClose={() => setView(null)}
          onChanged={() => list.reload()}
        />
      ) : null}
    </>
  );
}

interface CostLine {
  component: string;
  amount: string;
  gstAmount: string;
  glSourceAccount: string;
  gstAddedToCost: boolean;
}
const COMPONENTS = [
  { id: 'BASE', label: 'Price' },
  { id: 'FREIGHT', label: 'Freight' },
  { id: 'INSTALLATION', label: 'Installation' },
  { id: 'TESTING', label: 'Testing' },
  { id: 'PROF_FEE', label: 'Professional fees' },
  { id: 'OTHER', label: 'Other' },
];

function CapForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const accounts = useAccountOptions();
  const [assetId, setAssetId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [source, setSource] = useState('PURCHASE');
  const [residual, setResidual] = useState('');
  const [why, setWhy] = useState('');
  const [lines, setLines] = useState<CostLine[]>([
    { component: 'BASE', amount: '', gstAmount: '', glSourceAccount: '', gstAddedToCost: false },
  ]);
  const [msg, setMsg] = useState('');
  const set = (i: number, p: Partial<CostLine>) =>
    setLines((o) => o.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const total = lines.reduce((a, l) => a + (Number(l.amount) || 0), 0);
  return (
    <Dialog
      title="New capitalisation"
      onClose={onClose}
      error={msg}
      footer={
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setMsg('');
            apost('/assets/capitalisations', {
              assetId,
              capitalisationDate: date,
              source,
              ...(residual ? { residualOverridePct: residual } : {}),
              ...(why ? { residualJustification: why } : {}),
              lines: lines
                .filter((l) => l.amount)
                .map((l) => ({
                  component: l.component,
                  amount: l.amount,
                  glSourceAccount: l.glSourceAccount,
                  ...(l.gstAmount ? { gstAmount: l.gstAmount } : {}),
                  gstAddedToCost: l.gstAddedToCost,
                })),
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
          <label htmlFor="cap-asset">Asset (in capital work in progress) *</label>
          <AssetSelect id="cap-asset" value={assetId} onChange={setAssetId} />
        </div>
        <div className="field">
          <label htmlFor="cap-date">Available for use from *</label>
          <DateField id="cap-date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="cap-src">Source</label>
          <select id="cap-src" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="PURCHASE">Purchase</option>
            <option value="CWIP">Capital work in progress</option>
            <option value="OPENING_IMPORT">Opening balance</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="cap-res">Residual value % (only if above 5)</label>
          <input
            id="cap-res"
            type="number"
            min={0}
            step="any"
            value={residual}
            onChange={(e) => setResidual(e.target.value)}
          />
        </div>
        {Number(residual) > 5 ? (
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="cap-why">Why is the residual above 5 %? *</label>
            <textarea id="cap-why" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} />
          </div>
        ) : null}
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Cost</th>
              <th>Amount</th>
              <th>GST on it</th>
              <th>Added to cost?</th>
              <th>Paid from / booked against</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <select
                    aria-label={`Cost kind ${i + 1}`}
                    value={l.component}
                    onChange={(e) => set(i, { component: e.target.value })}
                  >
                    {COMPONENTS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    aria-label={`Amount ${i + 1}`}
                    type="number"
                    min={0}
                    step="any"
                    value={l.amount}
                    onChange={(e) => set(i, { amount: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`GST ${i + 1}`}
                    type="number"
                    min={0}
                    step="any"
                    value={l.gstAmount}
                    onChange={(e) => set(i, { gstAmount: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`GST in cost ${i + 1}`}
                    type="checkbox"
                    checked={l.gstAddedToCost}
                    onChange={(e) => set(i, { gstAddedToCost: e.target.checked })}
                  />
                </td>
                <td>
                  <select
                    aria-label={`Account ${i + 1}`}
                    value={l.glSourceAccount}
                    onChange={(e) => set(i, { glSourceAccount: e.target.value })}
                  >
                    <option value="">— choose —</option>
                    {(accounts.data ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
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
            {
              component: 'FREIGHT',
              amount: '',
              gstAmount: '',
              glSourceAccount: '',
              gstAddedToCost: false,
            },
          ])
        }
      >
        + Add cost line
      </button>
      <p>
        Cost before GST: <b>{inr(total)}</b>
      </p>
    </Dialog>
  );
}

function CapView({
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
  const doc = useLoad(() => aget(`/assets/capitalisations/${id}`), [id]);
  const d = doc.data;
  const after = () => {
    doc.reload();
    onChanged();
  };
  return (
    <Dialog
      title={d ? `${s(d.capNo)} · ${s(d.assetName)}` : 'Capitalisation'}
      sub={d ? `${s(d.status)} · approval ${s(d.approvalStatus).toLowerCase()}` : ''}
      onClose={onClose}
      error={doc.error}
      footer={
        d ? (
          <DocButtons
            base="/assets/capitalisations"
            d={d}
            actions={actions}
            after={after}
            postLabel="Post to the ledger"
            cancelQuestion="Why is it cancelled?"
          />
        ) : null
      }
    >
      {d ? (
        <>
          <p>
            Cost <b>{inr(s(d.totalCost))}</b> · from {day(d.capitalisationDate)}
            {d.residualOverridePct
              ? ` · residual ${num(d.residualOverridePct)} % (${s(d.residualJustification)})`
              : ''}
          </p>
          <Grid
            rows={(d.lines as Row[]) ?? []}
            rowKey={(l) => s(l.id)}
            cols={[
              {
                h: 'Cost',
                r: (l) => COMPONENTS.find((c) => c.id === s(l.component))?.label ?? s(l.component),
              },
              { h: 'Amount', r: (l) => inr(s(l.amount)) },
              {
                h: 'GST',
                r: (l) =>
                  Number(l.gstAmount)
                    ? `${inr(s(l.gstAmount))} ${l.gstAddedToCost === true ? '(in cost)' : '(claimed)'}`
                    : '—',
              },
              { h: 'Account', r: (l) => s(l.glSourceAccount) },
            ]}
          />
        </>
      ) : (
        <p>Loading…</p>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------------ allocation
export function AllocationPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [assetId, setAssetId] = useState('');
  const users = useUserOptions();
  const list = useLoad(() => alist('/assets/allocations'), []);
  return (
    <>
      <PageHead
        title="Asset Allocation"
        sub="Who has which asset, since when, in what condition, and when it is due back."
      />
      <div className="toolbar">
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            + Hand over an asset
          </button>
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="Nothing handed over yet."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'No.', r: (r) => s(r.allocNo) },
          { h: 'Asset', r: (r) => `${s(r.assetNo)} · ${s(r.assetName)}` },
          {
            h: 'Given to',
            r: (r) =>
              [s(r.employeeName), s(r.department), s(r.location)].filter(Boolean).join(' · '),
          },
          { h: 'Since', r: (r) => day(r.allocatedOn) },
          { h: 'Due back', r: (r) => day(r.returnDue) },
          { h: 'Status', r: (r) => pill(r.status) },
          {
            h: '',
            r: (r) =>
              s(r.status) === 'ALLOCATED' && actions.edit ? (
                <ReturnAction id={s(r.id)} onDone={() => list.reload()} />
              ) : null,
          },
        ]}
      />
      {adding ? (
        <FormModal
          title="Hand over an asset"
          fields={[
            { key: 'employeeId', label: 'Person', type: 'select', options: users.data ?? [] },
            { key: 'department', label: 'Department' },
            { key: 'location', label: 'Location' },
            { key: 'allocatedOn', label: 'From', type: 'date' },
            { key: 'returnDue', label: 'Due back (loans)', type: 'date' },
            { key: 'conditionOut', label: 'Condition now' },
            { key: 'handoverDoc', label: 'Hand-over note or document' },
          ]}
          initial={{ allocatedOn: todayIso() }}
          onClose={() => setAdding(false)}
          extra={
            <div className="field">
              <label htmlFor="al-asset">Asset *</label>
              <AssetSelect id="al-asset" value={assetId} onChange={setAssetId} />
            </div>
          }
          onSubmit={async (v) => {
            await apost('/assets/allocations', { ...v, assetId });
            toast('Saved');
            setAdding(false);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function ReturnAction({ id, onDone }: { id: string; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Take back
      </button>
      {open ? (
        <FormModal
          title="Take the asset back"
          fields={[
            { key: 'returnedOn', label: 'Returned on', type: 'date' },
            { key: 'conditionIn', label: 'Condition now' },
          ]}
          initial={{ returnedOn: todayIso() }}
          onClose={() => setOpen(false)}
          onSubmit={async (v) => {
            await apost(`/assets/allocations/${id}/return`, v);
            toast('Saved');
            setOpen(false);
            onDone();
          }}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ transfer
export function TransferPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [assetId, setAssetId] = useState('');
  const units = useUnitOptions();
  const users = useUserOptions();
  const ccs = useCostCentreOptions();
  const list = useLoad(() => alist('/assets/transfers'), []);
  return (
    <>
      <PageHead
        title="Asset Transfer"
        sub="Move an asset to another place, person, cost centre or unit. A move between units posts both units' books through the inter-unit account."
      />
      <div className="toolbar">
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            + New transfer
          </button>
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="No transfers yet."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'No.', r: (r) => s(r.trNo) },
          { h: 'Asset', r: (r) => `${s(r.assetNo)} · ${s(r.assetName)}` },
          {
            h: 'From → to',
            r: (r) =>
              s(r.fromUnit) === s(r.toUnit)
                ? `${s(r.toLocation) || 'same unit'}`
                : `${s(r.fromUnit)} → ${s(r.toUnit)}`,
          },
          { h: 'Approval', r: (r) => pill(r.approvalStatus) },
          { h: 'Status', r: (r) => pill(r.status) },
          {
            h: '',
            r: (r) => {
              const ver = Number(r.version);
              return (
                <>
                  {s(r.status) === 'DRAFT' &&
                  ['DRAFT', 'REJECTED'].includes(s(r.approvalStatus)) &&
                  actions.submit ? (
                    <Act
                      label="Send for approval"
                      run={() => apost(`/assets/transfers/${s(r.id)}/submit`, {}, ver)}
                      done={() => list.reload()}
                    />
                  ) : null}
                  {s(r.status) === 'DRAFT' &&
                  s(r.approvalStatus) === 'PENDING' &&
                  actions.approve ? (
                    <Act
                      label="Approve"
                      run={() => apost(`/assets/transfers/${s(r.id)}/approve`, {}, ver)}
                      done={() => list.reload()}
                    />
                  ) : null}
                  {s(r.status) === 'DRAFT' && s(r.approvalStatus) === 'APPROVED' && actions.post ? (
                    <Act
                      label="Complete the move"
                      primary
                      run={() => apost(`/assets/transfers/${s(r.id)}/complete`, {}, ver)}
                      done={() => list.reload()}
                    />
                  ) : null}
                  {s(r.status) === 'DRAFT' && actions.cancel ? (
                    <Act
                      label="Cancel"
                      sure="Cancel this transfer?"
                      run={() => apost(`/assets/transfers/${s(r.id)}/cancel`, {}, ver)}
                      done={() => list.reload()}
                    />
                  ) : null}
                </>
              );
            },
          },
        ]}
      />
      {adding ? (
        <FormModal
          title="New transfer"
          fields={[
            {
              key: 'toUnitId',
              label: 'To unit (leave if it stays)',
              type: 'select',
              options: units.data ?? [],
            },
            { key: 'toLocation', label: 'To location' },
            { key: 'toEmployeeId', label: 'To person', type: 'select', options: users.data ?? [] },
            {
              key: 'toCostCentreId',
              label: 'To cost centre',
              type: 'select',
              options: ccs.data ?? [],
            },
            { key: 'condition', label: 'Condition' },
          ]}
          onClose={() => setAdding(false)}
          extra={
            <div className="field">
              <label htmlFor="tr-asset">Asset *</label>
              <AssetSelect id="tr-asset" value={assetId} onChange={setAssetId} />
            </div>
          }
          onSubmit={async (v) => {
            await apost('/assets/transfers', { ...v, assetId });
            toast('Saved');
            setAdding(false);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ depreciation
export function DepreciationPage({ actions }: { actions: ActionSet }) {
  const [tab, setTab] = useState<'runs' | 'block' | 'shift' | 'rates'>('runs');
  return (
    <>
      <PageHead
        title="Depreciation"
        sub="Book depreciation (Companies Act, Schedule II) posts to the ledger. Income-tax depreciation is a memo on the block's written-down value."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['runs', 'Runs'],
          ['block', 'Income-tax blocks'],
          ['shift', 'Extra shifts'],
          ['rates', 'Rates'],
        ]}
      />
      {tab === 'runs' ? <Runs actions={actions} /> : null}
      {tab === 'block' ? <BlockLedger /> : null}
      {tab === 'shift' ? <ShiftUsage actions={actions} /> : null}
      {tab === 'rates' ? <Rates actions={actions} /> : null}
    </>
  );
}

function Runs({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const list = useLoad(() => alist('/assets/depreciation/runs'), []);
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<string | null>(null);
  return (
    <>
      <div className="toolbar">
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            + New run
          </button>
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="No runs yet. Click + New run after a month has ended."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'Run', r: (r) => s(r.runNo) },
          { h: 'Area', r: (r) => (s(r.area) === 'BOOK' ? 'Book (posts)' : 'Income tax (memo)') },
          { h: 'Period', r: (r) => s(r.period) },
          { h: 'Total', r: (r) => inr(s(r.totalAmount)) },
          { h: 'Status', r: (r) => pill(r.status) },
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
      {adding ? (
        <FormModal
          title="New depreciation run"
          sub="Book: one month, after it has ended. Income tax: the financial year chosen at the top."
          fields={[
            {
              key: 'area',
              label: 'Area',
              type: 'select',
              required: true,
              options: [
                { id: 'BOOK', label: 'Book (posts to the ledger)' },
                { id: 'TAX', label: 'Income tax (memo)' },
              ],
            },
            { key: 'period', label: 'Month (book only)', type: 'month' },
          ]}
          initial={{ area: 'BOOK' }}
          onClose={() => setAdding(false)}
          onSubmit={async (v) => {
            const r = await apost('/assets/depreciation/runs', v);
            toast('Run prepared: check it, then post');
            setAdding(false);
            list.reload();
            setView(s(r.id));
          }}
        />
      ) : null}
      {view ? (
        <RunView
          id={view}
          actions={actions}
          onClose={() => setView(null)}
          onChanged={() => list.reload()}
        />
      ) : null}
    </>
  );
}

function RunView({
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
  const doc = useLoad(() => aget(`/assets/depreciation/runs/${id}`), [id]);
  const d = doc.data;
  const st = s(d?.status);
  const ver = Number(d?.version ?? 0);
  const after = () => {
    doc.reload();
    onChanged();
  };
  const book = s(d?.area) === 'BOOK';
  return (
    <Dialog
      title={d ? `${s(d.runNo)} · ${s(d.period)}` : 'Run'}
      sub={d ? `${book ? 'Book' : 'Income tax'} · ${st}` : ''}
      onClose={onClose}
      error={doc.error}
      footer={
        d ? (
          <>
            {st === 'DRAFT' && actions.post ? (
              <Act
                label={book ? 'Post to the ledger' : 'Confirm'}
                primary
                run={() => apost(`/assets/depreciation/runs/${id}/post`, {}, ver)}
                done={after}
              />
            ) : null}
            {['DRAFT', 'POSTED'].includes(st) && actions.cancel ? (
              <ReasonAct
                label="Reverse"
                question="Why is it reversed?"
                run={(reason) => apost(`/assets/depreciation/runs/${id}/reverse`, { reason }, ver)}
                done={after}
              />
            ) : null}
          </>
        ) : null
      }
    >
      {d ? (
        <>
          <p>
            Total <b>{inr(s(d.totalAmount))}</b>
          </p>
          <Grid
            rows={(d.lines as Row[]) ?? []}
            rowKey={(l) => s(l.id)}
            empty="No asset needs depreciation this period."
            cols={
              book
                ? [
                    { h: 'Asset', r: (l) => `${s(l.assetNo)} · ${s(l.assetName)}` },
                    { h: 'Opening value', r: (l) => inr(s(l.openingValue)) },
                    { h: 'Method', r: (l) => s(l.method) },
                    { h: 'Days', r: (l) => s(l.days) },
                    { h: 'Shift factor', r: (l) => num(l.shiftFactor) },
                    { h: 'Depreciation', r: (l) => inr(s(l.amount)) },
                    { h: 'Closing value', r: (l) => inr(s(l.closingValue)) },
                  ]
                : [
                    { h: 'Block', r: (l) => s(l.blockCode) },
                    { h: 'Opening WDV', r: (l) => inr(s(l.openingValue)) },
                    { h: 'Rate %', r: (l) => num(l.rate) },
                    { h: 'Depreciation', r: (l) => inr(s(l.amount)) },
                    { h: 'Closing WDV', r: (l) => inr(s(l.closingValue)) },
                  ]
            }
          />
        </>
      ) : (
        <p>Loading…</p>
      )}
    </Dialog>
  );
}

function BlockLedger() {
  const list = useLoad(() => aget<Row[]>('/assets/depreciation/block-ledger'), []);
  return (
    <>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data ?? []}
        loading={list.loading}
        empty="No tax run yet. Make a New run for the area Income tax."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'Year', r: (r) => s(r.fyCode) },
          { h: 'Block', r: (r) => `${s(r.blockCode)} · ${s(r.blockName)}` },
          { h: 'Opening', r: (r) => inr(s(r.openingWdv)) },
          { h: 'Added (180+ days)', r: (r) => inr(s(r.additionsGe180)) },
          { h: 'Added (under 180)', r: (r) => inr(s(r.additionsLt180)) },
          { h: 'Sold', r: (r) => inr(s(r.deletions)) },
          { h: 'Depreciation', r: (r) => inr(s(r.depreciation)) },
          { h: 'Closing', r: (r) => inr(s(r.closingWdv)) },
          {
            h: '',
            r: (r) => (r.needsReview === true ? <Pill tone="pending">To review</Pill> : null),
          },
        ]}
      />
    </>
  );
}

function ShiftUsage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [assetId, setAssetId] = useState('');
  const [f, setF] = useState({
    period: todayIso().slice(0, 7),
    singleDays: '',
    doubleDays: '',
    tripleDays: '',
  });
  const [msg, setMsg] = useState('');
  return (
    <>
      <p className="hint">
        Plant and machinery that ran a second or third shift gets +50 % or +100 % depreciation for
        those days (not if the category is marked NESD).
      </p>
      <ErrorBox message={msg} />
      <div className="form-grid">
        <div className="field">
          <label htmlFor="sh-asset">Machine</label>
          <AssetSelect id="sh-asset" value={assetId} onChange={setAssetId} />
        </div>
        <div className="field">
          <label htmlFor="sh-per">Month</label>
          <input
            id="sh-per"
            type="month"
            value={f.period}
            onChange={(e) => setF({ ...f, period: e.target.value })}
          />
        </div>
        {(
          [
            ['singleDays', 'Days on one shift'],
            ['doubleDays', 'Days on two shifts'],
            ['tripleDays', 'Days on three shifts'],
          ] as const
        ).map(([k, label]) => (
          <div className="field" key={k}>
            <label htmlFor={`sh-${k}`}>{label}</label>
            <input
              id={`sh-${k}`}
              type="number"
              min={0}
              max={31}
              value={f[k]}
              onChange={(e) => setF({ ...f, [k]: e.target.value })}
            />
          </div>
        ))}
      </div>
      {actions.edit ? (
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setMsg('');
            aput('/assets/depreciation/shift-usage', {
              assetId,
              period: f.period,
              singleDays: Number(f.singleDays || 0),
              doubleDays: Number(f.doubleDays || 0),
              tripleDays: Number(f.tripleDays || 0),
            })
              .then(() => toast('Saved'))
              .catch((e: unknown) => setMsg(toUiError(e).message));
          }}
        >
          Save
        </button>
      ) : null}
    </>
  );
}

function Rates({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const list = useLoad(() => aget<Row[]>('/assets/it-blocks'), []);
  const [edit, setEdit] = useState(false);
  return (
    <>
      <p className="hint">
        Income-tax rates are seeded only for the four blocks the specification names, marked to
        review. Add the others you use.
      </p>
      <div className="toolbar">
        {actions.edit ? (
          <button type="button" className="btn primary" onClick={() => setEdit(true)}>
            + Add or change a rate
          </button>
        ) : null}
      </div>
      <Grid
        rows={(list.data ?? []).flatMap((b): Row[] =>
          ((b.rates as Row[]) ?? []).map((r) => ({ ...r, blockCode: b.code, blockName: b.name })),
        )}
        loading={list.loading}
        rowKey={(r) => s(r.id)}
        empty="No rates yet."
        cols={[
          { h: 'Block', r: (r) => `${s(r.blockCode)} · ${s(r.blockName)}` },
          { h: 'From', r: (r) => day(r.effectiveFrom) },
          { h: 'Rate %', r: (r) => num(r.ratePct) },
          { h: 'Law', r: (r) => s(r.actRef) },
          {
            h: '',
            r: (r) => (r.needsReview === true ? <Pill tone="pending">To review</Pill> : null),
          },
        ]}
      />
      {edit ? (
        <FormModal
          title="Income-tax block rate"
          fields={[
            { key: 'blockCode', label: 'Block code', required: true },
            { key: 'name', label: 'Block name (for a new block)' },
            { key: 'effectiveFrom', label: 'From', type: 'date', required: true },
            { key: 'ratePct', label: 'Rate %', type: 'number', required: true },
            { key: 'actRef', label: 'Law and section', required: true },
          ]}
          initial={{ effectiveFrom: todayIso(), actRef: 'ITA2025' }}
          onClose={() => setEdit(false)}
          onSubmit={async (v) => {
            await aput('/assets/it-blocks/rates', v);
            toast('Saved');
            setEdit(false);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ disposal
export function DisposalPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const [assetId, setAssetId] = useState('');
  const accounts = useAccountOptions();
  const list = useLoad(() => alist('/assets/disposals'), []);
  return (
    <>
      <PageHead
        title="Asset Disposal"
        sub="Sell, scrap, write off or donate an asset. The gain or loss is worked out from its book value; GST credit on a sale is checked against section 18(6)."
      />
      <div className="toolbar">
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            + New disposal
          </button>
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="No disposals yet."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'No.', r: (r) => s(r.dispNo) },
          { h: 'Asset', r: (r) => `${s(r.assetNo)} · ${s(r.assetName)}` },
          { h: 'How', r: (r) => s(r.method).replace('_', ' ') },
          { h: 'Sale value', r: (r) => inr(s(r.saleValue)) },
          { h: 'Gain / loss', r: (r) => (r.gainLoss === null ? '—' : inr(s(r.gainLoss))) },
          { h: 'Approval', r: (r) => pill(r.approvalStatus) },
          { h: 'Status', r: (r) => pill(r.status) },
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
      {adding ? (
        <FormModal
          title="New disposal"
          fields={[
            {
              key: 'method',
              label: 'How',
              type: 'select',
              required: true,
              options: [
                { id: 'SALE', label: 'Sale' },
                { id: 'SCRAP', label: 'Scrap' },
                { id: 'WRITE_OFF', label: 'Write off' },
                { id: 'DONATION', label: 'Donation' },
              ],
            },
            { key: 'disposalDate', label: 'Date', type: 'date' },
            { key: 'buyer', label: 'Buyer' },
            { key: 'saleValue', label: 'Sale value (without GST)', type: 'number' },
            { key: 'gstOnSale', label: 'GST charged on the sale', type: 'number' },
            {
              key: 'gstIntraState',
              label: 'Buyer is in the same state (CGST + SGST)',
              type: 'check',
            },
            {
              key: 'proceedsAccount',
              label: 'Money goes to',
              type: 'select',
              options: accounts.data ?? [],
            },
            { key: 'itcTaken', label: 'GST credit taken when bought', type: 'number' },
            { key: 'quartersUsed', label: 'Quarters the asset was used', type: 'number' },
          ]}
          initial={{ method: 'SALE', disposalDate: todayIso(), gstIntraState: 'true' }}
          onClose={() => setAdding(false)}
          extra={
            <div className="field">
              <label htmlFor="ds-asset">Asset *</label>
              <AssetSelect id="ds-asset" value={assetId} onChange={setAssetId} />
            </div>
          }
          onSubmit={async (v) => {
            await apost('/assets/disposals', {
              ...v,
              assetId,
              gstIntraState: v.gstIntraState === 'true',
              ...(v.quartersUsed ? { quartersUsed: Number(v.quartersUsed) } : {}),
            });
            toast('Saved as a draft');
            setAdding(false);
            list.reload();
          }}
        />
      ) : null}
      {view ? (
        <DisposalView
          id={view}
          actions={actions}
          onClose={() => setView(null)}
          onChanged={() => list.reload()}
        />
      ) : null}
    </>
  );
}

function DisposalView({
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
  const doc = useLoad(() => aget(`/assets/disposals/${id}`), [id]);
  const d = doc.data;
  const after = () => {
    doc.reload();
    onChanged();
  };
  return (
    <Dialog
      title={d ? `${s(d.dispNo)} · ${s(d.assetName)}` : 'Disposal'}
      sub={d ? `${s(d.method).replace('_', ' ')} · ${s(d.status)}` : ''}
      onClose={onClose}
      error={doc.error}
      footer={
        d ? (
          <DocButtons
            base="/assets/disposals"
            d={d}
            actions={actions}
            after={after}
            postLabel="Post to the ledger"
            cancelQuestion="Why is it cancelled?"
          />
        ) : null
      }
    >
      {d ? (
        <>
          <p>
            Sale value <b>{inr(s(d.saleValue))}</b> + GST <b>{inr(s(d.gstOnSale))}</b> · book value
            at disposal{' '}
            <b>{d.nbvAtDisposal === null ? 'worked out when posted' : inr(s(d.nbvAtDisposal))}</b> ·
            gain or loss <b>{d.gainLoss === null ? '—' : inr(s(d.gainLoss))}</b>
          </p>
          {d.s186Calc !== null && d.s186Calc !== undefined ? (
            <p>
              GST section 18(6): pay the higher of the credit still to be reversed and the tax on
              the sale = <b>{inr(s(d.s186Calc))}</b>. Beyond the tax charged on the sale:{' '}
              <b>{inr(s(d.s186PayableExtra))}</b>. This is shown for your return; nothing is posted
              for it.
            </p>
          ) : null}
        </>
      ) : (
        <p>Loading…</p>
      )}
    </Dialog>
  );
}
