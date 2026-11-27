// Customer NCR and Conformance NCR inside their tabs: the register, the customer-wise summary, the 8D board, the gate
// chart, the summary sheet with its dial, Pending Acceptance and Priority.
import { useEffect, useRef, useState } from 'react';
import { useToast } from '../../../components/Toast';
import { qget, qlist, qpatch } from '../../../lib/qmsApi';
import { useLoad } from '../../../lib/useLoad';
import type { ActionSet } from '../../../types';
import { dmy, Empty, ErrorBox, inr, PageHead, Pill } from '../../finance/shared';
import { useFrame } from '../../frame/V40TabFrame';
import { recordOf, useWmsActions as useActions, WmsRegister as Register } from '../../wms/WmsRegister';
import { Gauge, ProgressList, SERIES, STATUS } from './charts';
import { ImportButton } from './ImportDialog';
import { EightD, GateStrip, NcrForm, NcrStepDialog, NcrView, pageOf, type Ncr, type NcrStep, type NcrType } from './NcrParts';
import { messageOf, PRIORITIES, PRIORITY_LABEL, PriorityPill, PrioritySelect, saveCsv } from './shared';

interface Summary {
  customerId: string;
  customerNo: string;
  customerName: string;
  total: number;
  open: number;
  pending: number;
  closed: number;
  minor: number;
  major: number;
  critical: number;
  qty: string;
  claimAmount: string;
  lastDate: string;
}
interface Counts {
  total: number;
  open: number;
  pending: number;
  closed: number;
  minor: number;
  major: number;
  critical: number;
  criticalOpen: number;
  overdue: number;
}
interface GateRow {
  id: string;
  number: string;
  customerName: string;
  title: string;
  priority: string;
  status: string;
  done: number;
  gates: { key: string; label: string; done: boolean; doneOn: string | null }[];
}

interface Open {
  view: (id: string) => void;
  step: (step: NcrStep, record: { id: string; number: string }) => void;
}

/** Customer No. + All Summary: the customer-wise ledger; a customer opens to its complaints. */
function CustomerSummary({ canExport, tick, open }: { canExport: boolean; tick: number; open: Open }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Summary | null>(null);
  const load = useLoad(() => qget<{ rows: Summary[] }>('/ncrs/customers'), [tick]);
  const mine = useLoad(() => (picked ? qlist<Ncr>('/ncrs', { type: 'CUSTOMER', customerId: picked.customerId, size: 100 }) : Promise.resolve(null)), [picked?.customerId, tick]);
  const rows = (load.data?.rows ?? []).filter((r) => `${r.customerNo} ${r.customerName}`.toLowerCase().includes(q.trim().toLowerCase()));
  const sum = (k: 'total' | 'open' | 'pending' | 'closed' | 'minor' | 'major' | 'critical') => rows.reduce((a, r) => a + r[k], 0);
  const money = rows.reduce((a, r) => a + Number(r.claimAmount), 0);
  const head = ['Customer No', 'Customer', 'Complaints', 'Open', 'Waiting', 'Closed', 'Minor', 'Major', 'Critical', 'Qty', 'Claim amount', 'Last complaint'];
  return (
    <>
      <div className="toolbar">
        <input aria-label="Search customer" placeholder="Search customer no. or name" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="qv-count">{rows.length} customers</span>
        {canExport ? (
          <button
            type="button"
            className="btn"
            disabled={rows.length === 0}
            title={rows.length === 0 ? 'There is nothing to export.' : undefined}
            onClick={() => saveCsv('customer-ncr-summary.csv', [head, ...rows.map((r) => [r.customerNo, r.customerName, r.total, r.open, r.pending, r.closed, r.minor, r.major, r.critical, r.qty, r.claimAmount, r.lastDate])])}
          >
            Export summary
          </button>
        ) : null}
      </div>
      <ErrorBox message={load.error} />
      <div className="card table-wrap">
        <table className="register-table plain">
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.customerId} className={picked?.customerId === r.customerId ? 'selected' : undefined}>
                <td>
                  <button type="button" className="link" onClick={() => setPicked(picked?.customerId === r.customerId ? null : r)}>
                    {r.customerNo}
                  </button>
                </td>
                <td>{r.customerName}</td>
                <td className="num">{r.total}</td>
                <td className="num">{r.open}</td>
                <td className="num">{r.pending}</td>
                <td className="num">{r.closed}</td>
                <td className="num">{r.minor}</td>
                <td className="num">{r.major}</td>
                <td className="num">{r.critical}</td>
                <td className="num">{r.qty}</td>
                <td className="num">{inr(r.claimAmount)}</td>
                <td>{dmy(r.lastDate)}</td>
              </tr>
            ))}
            {rows.length > 1 ? (
              <tr className="qv-total">
                <td />
                <td>All customers</td>
                <td className="num">{sum('total')}</td>
                <td className="num">{sum('open')}</td>
                <td className="num">{sum('pending')}</td>
                <td className="num">{sum('closed')}</td>
                <td className="num">{sum('minor')}</td>
                <td className="num">{sum('major')}</td>
                <td className="num">{sum('critical')}</td>
                <td />
                <td className="num">{inr(money)}</td>
                <td />
              </tr>
            ) : null}
            {rows.length === 0 && !load.loading ? <Empty cols={head.length}>No customer complaints yet.</Empty> : null}
          </tbody>
        </table>
      </div>
      {picked ? (
        <section className="qv-panel" aria-label={`Complaints of ${picked.customerName}`}>
          <h3>Complaints of {picked.customerName}</h3>
          <div className="table-wrap">
            <table className="register-table plain">
              <thead>
                <tr>
                  <th>NCR No</th>
                  <th>Date</th>
                  <th>Title</th>
                  <th>Priority</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(mine.data?.rows ?? []).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <button type="button" className="link" onClick={() => open.view(r.id)}>
                        {r.number}
                      </button>
                    </td>
                    <td>{dmy(r.ncrDate)}</td>
                    <td>{r.title}</td>
                    <td>
                      <PriorityPill value={r.priority} />
                    </td>
                    <td>
                      <Pill>{r.status}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}

/** Complaint Registration -> 8D Quality: pick a complaint and work its eight stages. */
function EightDBoard({ actions, tick, onChanged, open, onAdd }: { actions: ActionSet; tick: number; onChanged: () => void; open: Open; onAdd: () => void }) {
  const [id, setId] = useState('');
  const [local, setLocal] = useState(0);
  const list = useLoad(() => qlist<Ncr>('/ncrs', { type: 'CUSTOMER', status: 'open', size: 100 }), [tick]);
  const rows = list.data?.rows ?? [];
  const chosen = rows.some((r) => r.id === id) ? id : (rows[0]?.id ?? '');
  const one = useLoad(() => (chosen ? qget<Ncr>(`/ncrs/${chosen}`) : Promise.resolve(null)), [chosen, tick, local]);
  const [fresh, setFresh] = useState<Ncr | null>(null);
  const r = fresh && one.data && fresh.id === one.data.id && fresh.version >= one.data.version ? fresh : one.data;
  return (
    <>
      <ErrorBox message={list.error || one.error} />
      {rows.length === 0 && !list.loading ? (
        <div className="card qv-empty">
          <p>No open complaint to work on.</p>
          {actions.add ? (
            <button type="button" className="btn primary" onClick={onAdd}>
              ＋ Register Complaint
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="toolbar">
            <label htmlFor="qv-8d-pick">Complaint</label>
            <select id="qv-8d-pick" value={chosen} onChange={(e) => setId(e.target.value)}>
              {rows.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.number} · {x.customerName} · {x.title}
                </option>
              ))}
            </select>
            {r ? (
              <>
                <Pill>{r.status}</Pill>
                <PriorityPill value={r.priority} />
                <button type="button" className="btn" onClick={() => open.view(r.id)}>
                  Open record
                </button>
                {r.status === 'Open' && actions.submit ? (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={r.stages.some((s) => !s.done)}
                    title={r.stages.some((s) => !s.done) ? 'Pass all eight gates first.' : undefined}
                    onClick={() => open.step('submit', r)}
                  >
                    Send for Acceptance
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
          {r?.returnComment ? (
            <div className="msg warn show static" role="status">
              Returned by {r.returnedByName ?? 'the approver'}: {r.returnComment}
            </div>
          ) : null}
          {r ? (
            <EightD
              ncr={r}
              canEdit={actions.edit}
              onChanged={(n) => {
                setFresh(n);
                setLocal((x) => x + 1);
                onChanged();
              }}
            />
          ) : null}
        </>
      )}
    </>
  );
}

function GateChart({ tick, canExport, open }: { tick: number; canExport: boolean; open: Open }) {
  const [customerId, setCustomerId] = useState('');
  const [page, setPage] = useState(1);
  const customers = useLoad(() => qget<{ rows: Summary[] }>('/ncrs/customers'), [tick]);
  const load = useLoad(() => qget<{ total: number; rows: GateRow[] }>('/ncrs/gates', { page, size: 20, customerId: customerId || undefined }), [page, customerId, tick]);
  const rows = load.data?.rows ?? [];
  const pages = Math.max(1, Math.ceil((load.data?.total ?? 0) / 20));
  return (
    <>
      <div className="toolbar">
        <select
          aria-label="Customer"
          value={customerId}
          onChange={(e) => {
            setCustomerId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All customers</option>
          {(customers.data?.rows ?? []).map((c) => (
            <option key={c.customerId} value={c.customerId}>
              {c.customerNo} · {c.customerName}
            </option>
          ))}
        </select>
        <span className="qv-count">{load.data?.total ?? 0} complaints</span>
        {canExport ? (
          <button
            type="button"
            className="btn"
            disabled={rows.length === 0}
            title={rows.length === 0 ? 'There is nothing to export.' : undefined}
            onClick={() =>
              saveCsv('customer-ncr-gate-chart.csv', [
                ['NCR No', 'Customer', 'Title', 'Priority', 'Status', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'],
                ...rows.map((r) => [r.number, r.customerName, r.title, PRIORITY_LABEL[r.priority], r.status, ...r.gates.map((g) => (g.done ? g.doneOn : ''))]),
              ])
            }
          >
            Export chart
          </button>
        ) : null}
      </div>
      <p className="qv-key">
        <span className="passed">✓ passed</span>
        <span className="current">● open gate</span>
        <span>— waiting</span>
      </p>
      <ErrorBox message={load.error} />
      <div className="card table-wrap">
        <table className="register-table plain">
          <thead>
            <tr>
              <th>NCR No</th>
              <th>Customer</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Stage gates D1 → D8</th>
              <th>Passed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <button type="button" className="link" onClick={() => open.view(r.id)}>
                    {r.number}
                  </button>
                  <small className="qv-sub">{r.title}</small>
                </td>
                <td>{r.customerName}</td>
                <td>
                  <PriorityPill value={r.priority} />
                </td>
                <td>
                  <Pill>{r.status}</Pill>
                </td>
                <td>
                  <GateStrip stages={r.gates} />
                </td>
                <td className="num">{r.done} / 8</td>
              </tr>
            ))}
            {rows.length === 0 && !load.loading ? <Empty cols={6}>No customer complaints yet.</Empty> : null}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <div className="actions">
          <button type="button" className="btn sm" disabled={page <= 1} title={page <= 1 ? 'This is the first page.' : undefined} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span>
            Page {page} of {pages}
          </span>
          <button type="button" className="btn sm" disabled={page >= pages} title={page >= pages ? 'This is the last page.' : undefined} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      ) : null}
    </>
  );
}

/** Summary Sheet -> Gauge: the dial of closed against all; pressing a figure lists those records. */
function SummarySheet({ type, tick, open }: { type: NcrType; tick: number; open: Open }) {
  const [customerId, setCustomerId] = useState('');
  const [show, setShow] = useState<'open' | 'Closed'>('open');
  const customer = type === 'CUSTOMER';
  const customers = useLoad(() => (customer ? qget<{ rows: Summary[] }>('/ncrs/customers') : Promise.resolve(null)), [tick, customer]);
  const counts = useLoad(() => qget<Counts>('/ncrs/counts', { type, customerId: customerId || undefined }), [type, customerId, tick]);
  const list = useLoad(() => qlist<Ncr>('/ncrs', { type, status: show, customerId: customerId || undefined, size: 50 }), [type, customerId, show, tick]);
  const c = counts.data;
  const stillOpen = c ? c.open + c.pending : 0;
  return (
    <>
      {customer ? (
        <div className="toolbar">
          <select aria-label="Customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">All customers</option>
            {(customers.data?.rows ?? []).map((x) => (
              <option key={x.customerId} value={x.customerId}>
                {x.customerNo} · {x.customerName}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <ErrorBox message={counts.error || list.error} />
      {c ? (
        <div className="qv-grid">
          <section className="qv-card" aria-label="Open against closed">
            <h3>Open vs. closed</h3>
            <Gauge share={c.total ? c.closed / c.total : 0} color={STATUS.good} value={c.total ? `${Math.round((c.closed / c.total) * 100)}% closed` : 'No records'} caption={`${c.closed} closed of ${c.total}`} />
            <div className="qv-switch" role="group" aria-label="List">
              <button type="button" className={`btn sm${show === 'open' ? ' primary' : ''}`} aria-pressed={show === 'open'} onClick={() => setShow('open')}>
                Open: {stillOpen}
              </button>
              <button type="button" className={`btn sm${show === 'Closed' ? ' primary' : ''}`} aria-pressed={show === 'Closed'} onClick={() => setShow('Closed')}>
                Closed: {c.closed}
              </button>
            </div>
          </section>
          <section className="qv-card" aria-label="By status">
            <h3>Where they stand</h3>
            <ProgressList
              rows={[
                { label: 'Open', value: c.open, of: c.total, color: SERIES.blue },
                { label: 'Pending acceptance', value: c.pending, of: c.total, color: SERIES.orange },
                { label: 'Closed', value: c.closed, of: c.total, color: STATUS.good },
              ]}
            />
            <p className="qv-note">
              {c.overdue} open past the target date · {c.criticalOpen} Critical still open
            </p>
          </section>
          <section className="qv-card" aria-label="By priority">
            <h3>Priority</h3>
            <ProgressList
              rows={[
                { label: 'Minor', value: c.minor, of: c.total, color: STATUS.warning },
                { label: 'Major', value: c.major, of: c.total, color: STATUS.serious },
                { label: 'Critical', value: c.critical, of: c.total, color: STATUS.critical },
              ]}
            />
          </section>
        </div>
      ) : null}
      <section className="qv-panel" aria-label={show === 'open' ? 'Open records' : 'Closed records'}>
        <h3>{show === 'open' ? 'Open records' : 'Closed records'}</h3>
        <NcrTable type={type} rows={list.data?.rows ?? []} loading={list.loading} open={open} />
      </section>
    </>
  );
}

function NcrTable({ type, rows, loading, open, buttons }: { type: NcrType; rows: Ncr[]; loading: boolean; open: Open; buttons?: (r: Ncr) => React.ReactNode }) {
  return (
    <div className="card table-wrap">
      <table className="register-table plain">
        <thead>
          <tr>
            <th>NCR No</th>
            <th>Date</th>
            <th>{type === 'CUSTOMER' ? 'Customer' : 'Department'}</th>
            <th>Title</th>
            <th>Priority</th>
            <th>Owner</th>
            <th>Target</th>
            <th>Status</th>
            {buttons ? <th>Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <button type="button" className="link" onClick={() => open.view(r.id)}>
                  {r.number}
                </button>
              </td>
              <td>{dmy(r.ncrDate)}</td>
              <td>{type === 'CUSTOMER' ? r.customerName : r.department}</td>
              <td>{r.title}</td>
              <td>
                <PriorityPill value={r.priority} />
              </td>
              <td>{r.ownerName ?? '—'}</td>
              <td>{dmy(r.targetDate)}</td>
              <td>
                <Pill>{r.status}</Pill>
              </td>
              {buttons ? <td className="row-actions">{buttons(r)}</td> : null}
            </tr>
          ))}
          {rows.length === 0 && !loading ? <Empty cols={buttons ? 9 : 8}>Nothing here.</Empty> : null}
        </tbody>
      </table>
    </div>
  );
}

function PendingTab({ type, actions, tick, open }: { type: NcrType; actions: ActionSet; tick: number; open: Open }) {
  const list = useLoad(() => qlist<Ncr>('/ncrs', { type, status: 'Pending Acceptance', size: 100 }), [type, tick]);
  return (
    <>
      <p className="qv-note">Records waiting for acceptance. Return sends one back and needs a comment.</p>
      <ErrorBox message={list.error} />
      <NcrTable
        type={type}
        rows={list.data?.rows ?? []}
        loading={list.loading}
        open={open}
        buttons={(r) => (
          <div className="qv-buttons">
            <button type="button" className="btn sm" onClick={() => open.view(r.id)}>
              View
            </button>
            {actions.approve ? (
              <>
                <button type="button" className="btn sm primary" onClick={() => open.step('accept', r)}>
                  Accept
                </button>
                <button type="button" className="btn sm" onClick={() => open.step('return', r)}>
                  Return
                </button>
              </>
            ) : null}
          </div>
        )}
      />
    </>
  );
}

function PriorityTab({ type, actions, tick, onChanged, open }: { type: NcrType; actions: ActionSet; tick: number; onChanged: () => void; open: Open }) {
  const toast = useToast();
  const [priority, setPriority] = useState('');
  const counts = useLoad(() => qget<Counts>('/ncrs/counts', { type }), [type, tick]);
  const list = useLoad(() => qlist<Ncr>('/ncrs', { type, status: 'open', priority: priority || undefined, size: 100 }), [type, priority, tick]);
  const change = (r: Ncr, value: string): void => {
    qpatch(`/ncrs/${r.id}`, r.version, { priority: value })
      .then(() => toast(`${r.number} is now ${PRIORITY_LABEL[value]}.`))
      .catch((e: unknown) => toast(messageOf(e)))
      .finally(onChanged);
  };
  return (
    <>
      <div className="qv-switch" role="group" aria-label="Priority">
        <button type="button" className={`btn${priority === '' ? ' primary' : ''}`} aria-pressed={priority === ''} onClick={() => setPriority('')}>
          All open
        </button>
        {PRIORITIES.map((p) => (
          <button key={p} type="button" className={`btn${priority === p ? ' primary' : ''}`} aria-pressed={priority === p} onClick={() => setPriority(p)}>
            {PRIORITY_LABEL[p]} ({counts.data ? counts.data[p.toLowerCase() as 'minor' | 'major' | 'critical'] : 0} in all)
          </button>
        ))}
      </div>
      <ErrorBox message={list.error} />
      <NcrTable
        type={type}
        rows={list.data?.rows ?? []}
        loading={list.loading}
        open={open}
        buttons={(r) =>
          r.status === 'Open' && actions.edit ? (
            <PrioritySelect label={`Priority of ${r.number}`} value={r.priority} onChange={(v) => change(r, v)} />
          ) : (
            <span className="qv-note">{r.status === 'Open' ? 'No edit right' : 'Waiting for acceptance'}</span>
          )
        }
      />
    </>
  );
}

export function NcrDesk({ type, actions, title, sub }: { type: NcrType; actions: ActionSet; title: string; sub: string }) {
  const pageId = pageOf(type);
  const frame = useFrame();
  const tab = frame?.tabName ?? '';
  const act = useActions();
  const [form, setForm] = useState<{ id: string | null } | null>(null);
  const [view, setView] = useState<string | null>(null);
  const [step, setStep] = useState<{ step: NcrStep; record: { id: string; number: string } } | null>(null);
  const open: Open = { view: setView, step: (s, record) => setStep({ step: s, record }) };
  const add = [{ label: type === 'CUSTOMER' ? '＋ Register Complaint' : '＋ Add Conformance NCR', onClick: () => setForm({ id: null }) }];
  const own: Record<string, JSX.Element> = {
    'Customer Summary': <CustomerSummary canExport={actions.export} tick={act.reloadKey} open={open} />,
    '8D Quality': <EightDBoard actions={actions} tick={act.reloadKey} onChanged={act.reload} open={open} onAdd={() => setForm({ id: null })} />,
    'Gate Chart': <GateChart tick={act.reloadKey} canExport={actions.export} open={open} />,
    'Summary & Gauge': <SummarySheet type={type} tick={act.reloadKey} open={open} />,
    Summary: <SummarySheet type={type} tick={act.reloadKey} open={open} />,
    'Pending Acceptance': <PendingTab type={type} actions={actions} tick={act.reloadKey} open={open} />,
    Priority: <PriorityTab type={type} actions={actions} tick={act.reloadKey} onChanged={act.reload} open={open} />,
  };
  const dialogs = (
    <>
      {form ? (
        <NcrForm
          type={type}
          id={form.id}
          onClose={() => setForm(null)}
          onSaved={(r) => {
            const fresh = form.id === null;
            setForm(null);
            act.reload();
            if (fresh) setView(r.id);
          }}
        />
      ) : null}
      {view && !form ? (
        <NcrView
          key={view}
          id={view}
          actions={actions}
          onClose={() => setView(null)}
          onEdit={(id) => setForm({ id })}
          onChanged={act.reload}
        />
      ) : null}
      {step ? (
        <NcrStepDialog
          step={step.step}
          record={step.record}
          onClose={() => setStep(null)}
          onDone={() => {
            setStep(null);
            act.reload();
          }}
        />
      ) : null}
    </>
  );
  const panel = own[tab];
  return (
    <div className="qv-page">
      <ImportButton pageId={pageId} kinds={actions.import ? [type === 'CUSTOMER' ? 'customer-ncr' : 'conformance-ncr'] : []} onDone={act.reload} />
      {panel ? (
        <OwnTab pageId={pageId} title={title} sub={sub} actions={actions} add={add}>
          <ErrorBox message={act.error} />
          {panel}
          {dialogs}
        </OwnTab>
      ) : (
        <Register
          pageId={pageId}
          title={title}
          sub={sub}
          actions={actions}
          add={add}
          error={act.error}
          reloadKey={act.reloadKey}
          reload={act.reload}
          onOpen={setView}
          onEdit={actions.edit ? (id) => setForm({ id }) : undefined}
          canEditRow={(status) => status === 'Open'}
          rowExtra={(r) => {
            const record = { id: recordOf(r), number: r.number };
            return (
              <>
                {r.status === 'Open' && actions.submit ? (
                  <button type="button" className="btn sm" onClick={() => open.step('submit', record)}>
                    Send for Acceptance
                  </button>
                ) : null}
                {r.status === 'Pending Acceptance' && actions.approve ? (
                  <>
                    <button type="button" className="btn sm primary" onClick={() => open.step('accept', record)}>
                      Accept
                    </button>
                    <button type="button" className="btn sm" onClick={() => open.step('return', record)}>
                      Return
                    </button>
                  </>
                ) : null}
                {(r.status === 'Open' || r.status === 'Pending Acceptance') && actions.cancel ? (
                  <button type="button" className="btn sm danger" onClick={() => open.step('cancel', record)}>
                    Cancel NCR
                  </button>
                ) : null}
              </>
            );
          }}
        >
          {dialogs}
        </Register>
      )}
    </div>
  );
}

/** The page head and the top "＋ Add New" button on a tab that draws its own content. */
export function OwnTab({ pageId, title, sub, actions, add, children }: { pageId: string; title: string; sub: string; actions: ActionSet; add: { label: string; onClick: () => void }[]; children: React.ReactNode }) {
  const toast = useToast();
  const live = useRef(add);
  live.current = actions.add ? add : [];
  useEffect(() => {
    const onAdd = (e: Event): void => {
      const { detail } = e as CustomEvent<{ pageId?: string; handled: boolean }>;
      if (detail.pageId !== pageId || detail.handled) return;
      detail.handled = true;
      const button = live.current[0];
      if (button) button.onClick();
      else toast('Nothing can be added from this tab with your role.');
    };
    window.addEventListener('v40-add-record', onAdd);
    return () => window.removeEventListener('v40-add-record', onAdd);
  }, [pageId, toast]);
  return (
    <>
      <PageHead title={title} sub={sub}>
        {actions.print ? (
          <button type="button" className="btn" onClick={() => window.print()}>
            Print
          </button>
        ) : null}
        {(actions.add ? add : []).map((b) => (
          <button key={b.label} type="button" className="btn primary" onClick={b.onClick}>
            {b.label}
          </button>
        ))}
      </PageHead>
      {children}
    </>
  );
}
