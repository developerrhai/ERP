// Phase 14 maintenance pages: preventive plans and checklists, the PM schedule, breakdown tickets, work orders (for machines and
// equipment, and for the other assets), spares, downtime, the MTBF report and alerts. The server decides every state change.
import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { aget, alist, apost, aput } from '../../lib/assetApi';
import type { Row } from '../../lib/assetApi';
import { lookupWarehouseOptions } from '../../lib/mfgApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, ErrorBox, inr, PageHead, Pill } from '../finance/shared';
import { Tabs } from '../qms/Shared';
import { OptionSelect } from '../mfg/Kit';
import {
  Act,
  AssetSelect,
  Dialog,
  FormModal,
  Grid,
  ReasonAct,
  TONE,
  addDays,
  hhmm,
  isoNow,
  localToIso,
  num,
  s,
  todayIso,
  useUserOptions,
} from './Shared';
import { DateField } from '../../ui/components';

const pill = (v: unknown) => <Pill tone={TONE[s(v)]}>{s(v).replace(/_/g, ' ')}</Pill>;

// ------------------------------------------------------------------------------------------------ preventive plans
export function PreventivePage({ actions }: { actions: ActionSet }) {
  const [tab, setTab] = useState<'plans' | 'checklists'>('plans');
  return (
    <>
      <PageHead
        title="Preventive Maintenance"
        sub="Service plans by days, by meter, or whichever comes first. The schedule page raises a work order when one falls due."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['plans', 'PM plans'],
          ['checklists', 'Checklists'],
        ]}
      />
      {tab === 'plans' ? <Plans actions={actions} /> : <Checklists actions={actions} />}
    </>
  );
}

function Plans({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const list = useLoad(() => alist('/maint/plans'), []);
  const [adding, setAdding] = useState(false);
  return (
    <>
      <div className="toolbar">
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            + New PM plan
          </button>
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="No PM plans yet. Click + New PM plan."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'Plan', r: (r) => s(r.planNo) },
          { h: 'Asset', r: (r) => `${s(r.assetNo)} · ${s(r.assetName)}` },
          { h: 'Title', r: (r) => s(r.title) },
          {
            h: 'Every',
            r: (r) =>
              [
                r.intervalDays ? `${s(r.intervalDays)} days` : '',
                r.intervalMeter
                  ? `${num(r.intervalMeter)} ${s(r.meterType).replace('_', ' ').toLowerCase()}`
                  : '',
              ]
                .filter(Boolean)
                .join(' or '),
          },
          { h: 'Last done', r: (r) => (r.lastDoneOn ? dmy(s(r.lastDoneOn).slice(0, 10)) : '—') },
          { h: 'Next due', r: (r) => (r.nextDue ? dmy(s(r.nextDue).slice(0, 10)) : '—') },
          { h: 'Active', r: (r) => (r.active === true ? 'Yes' : 'No') },
          {
            h: '',
            r: (r) =>
              actions.edit ? (
                r.active === true ? (
                  <Act
                    label="Stop"
                    run={() => apost(`/maint/plans/${s(r.id)}/deactivate`, {}, Number(r.version))}
                    done={() => list.reload()}
                  />
                ) : (
                  <Act
                    label="Start again"
                    run={() => apost(`/maint/plans/${s(r.id)}/activate`, {}, Number(r.version))}
                    done={() => list.reload()}
                  />
                )
              ) : null,
          },
        ]}
      />
      {adding ? (
        <PlanForm
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            toast('Saved');
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function PlanForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const checklists = useLoad(() => aget<Row[]>('/maint/checklists'), []);
  const [assetId, setAssetId] = useState('');
  const asset = useLoad(
    () => (assetId ? aget(`/assets/by-id/${assetId}`) : Promise.resolve(null)),
    [assetId],
  );
  const meters = (asset.data?.meters as Row[] | undefined) ?? [];
  return (
    <FormModal
      title="New PM plan"
      fields={[
        { key: 'title', label: 'What is done', required: true },
        {
          key: 'triggerType',
          label: 'Triggered by',
          type: 'select',
          required: true,
          options: [
            { id: 'TIME', label: 'Days' },
            { id: 'METER', label: 'Meter reading' },
            { id: 'BOTH', label: 'Whichever comes first' },
          ],
        },
        { key: 'intervalDays', label: 'Every how many days', type: 'number' },
        {
          key: 'meterId',
          label: 'Meter',
          type: 'select',
          options: meters.map((m) => ({ id: s(m.id), label: s(m.meterType).replace('_', ' ') })),
        },
        { key: 'intervalMeter', label: 'Every how many meter units', type: 'number' },
        { key: 'leadDays', label: 'Raise the work order how many days early', type: 'number' },
        { key: 'startFrom', label: 'Count from', type: 'date' },
        {
          key: 'checklistTemplateId',
          label: 'Checklist',
          type: 'select',
          options: (checklists.data ?? []).map((c) => ({ id: s(c.id), label: s(c.name) })),
        },
      ]}
      sub="Choose the asset first (above the form), then fill the rest."
      initial={{ triggerType: 'TIME', leadDays: '3', startFrom: todayIso() }}
      onClose={onClose}
      extra={
        <div className="field">
          <label htmlFor="pm-asset">Asset *</label>
          <AssetSelect id="pm-asset" maintainable value={assetId} onChange={setAssetId} />
        </div>
      }
      onSubmit={async (v) => {
        await apost('/maint/plans', {
          ...v,
          assetId,
          ...(v.intervalDays ? { intervalDays: Number(v.intervalDays) } : {}),
          ...(v.leadDays ? { leadDays: Number(v.leadDays) } : {}),
        });
        onSaved();
      }}
    />
  );
}

function Checklists({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const list = useLoad(() => aget<Row[]>('/maint/checklists'), []);
  const [adding, setAdding] = useState(false);
  const [lines, setLines] = useState('');
  return (
    <>
      <div className="toolbar">
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            + New checklist
          </button>
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data ?? []}
        loading={list.loading}
        empty="No checklists yet."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'Code', r: (r) => s(r.code) },
          { h: 'Name', r: (r) => s(r.name) },
          { h: 'Checks', r: (r) => ((r.items as Row[]) ?? []).map((i) => s(i.text)).join('; ') },
        ]}
      />
      {adding ? (
        <FormModal
          title="New checklist"
          sub="One check per line. Write a number check as: Spindle temperature | 20 | 60"
          fields={[
            { key: 'code', label: 'Code', required: true },
            { key: 'name', label: 'Name', required: true },
            { key: 'items', label: 'Checks (one per line)', type: 'textarea', required: true },
          ]}
          onClose={() => setAdding(false)}
          onSubmit={async (v) => {
            const items = (v.items ?? '')
              .split('\n')
              .map((x) => x.trim())
              .filter(Boolean)
              .map((x) => {
                const [text, min, max] = x.split('|').map((y) => y.trim());
                return min && max ? { text, answerType: 'NUMBER', min, max } : { text };
              });
            await apost('/maint/checklists', { code: v.code, name: v.name, items });
            toast('Saved');
            setAdding(false);
            setLines('');
            list.reload();
          }}
        />
      ) : null}
      {lines ? null : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ PM schedule
export function SchedulePage({ actions }: { actions: ActionSet }) {
  const [status, setStatus] = useState('');
  const list = useLoad(() => alist('/maint/schedules', { status }), [status]);
  return (
    <>
      <PageHead
        title="Maintenance Schedule"
        sub="What falls due and the work order raised for it. Plans raise their work orders daily; press the button to do it now."
      />
      <div className="toolbar">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {['PLANNED', 'WO_CREATED', 'DONE', 'SKIPPED'].map((x) => (
            <option key={x} value={x}>
              {x.replace('_', ' ')}
            </option>
          ))}
        </select>
        {actions.post ? (
          <Act
            label="Raise due work orders now"
            primary
            run={() => apost('/maint/schedules/generate')}
            done={() => list.reload()}
            ok="Done"
          />
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="Nothing is due. Add a PM plan on the Preventive Maintenance page."
        rowKey={(r) => s(r.id)}
        cols={[
          {
            h: 'Due',
            r: (r) =>
              r.dueDate ? dmy(s(r.dueDate).slice(0, 10)) : `${num(r.dueMeter)} on the meter`,
          },
          { h: 'Asset', r: (r) => `${s(r.assetNo)} · ${s(r.assetName)}` },
          { h: 'Plan', r: (r) => `${s(r.planNo)} · ${s(r.title)}` },
          { h: 'Work order', r: (r) => s(r.mwoNo) || '—' },
          { h: 'Status', r: (r) => pill(r.status) },
          {
            h: '',
            r: (r) =>
              s(r.status) === 'PLANNED' && actions.edit ? (
                <Act
                  label="Skip"
                  sure="Skip this service?"
                  run={() => apost(`/maint/schedules/${s(r.id)}/skip`)}
                  done={() => list.reload()}
                />
              ) : null,
          },
        ]}
      />
    </>
  );
}

// ------------------------------------------------------------------------------------------------ breakdowns
export function BreakdownPage({ actions }: { actions: ActionSet }) {
  const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const list = useLoad(() => alist('/maint/breakdowns', { status }), [status]);
  return (
    <>
      <PageHead
        title="Breakdown Log"
        sub="Report a stopped machine. Acknowledging it raises the repair work order and starts the downtime clock."
      />
      <div className="toolbar">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {['OPEN', 'ACK', 'IN_REPAIR', 'RESOLVED', 'CLOSED', 'CANCELLED'].map((x) => (
            <option key={x} value={x}>
              {x.replace('_', ' ')}
            </option>
          ))}
        </select>
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            + Report a breakdown
          </button>
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="No breakdowns. Good."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'Ticket', r: (r) => s(r.bdNo) },
          { h: 'Reported', r: (r) => hhmm(r.reportedAt) },
          { h: 'Machine', r: (r) => `${s(r.assetNo)} · ${s(r.assetName)}` },
          { h: 'Problem', r: (r) => s(r.symptom) },
          { h: 'Priority', r: (r) => s(r.priority) },
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
        <RaiseForm
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            list.reload();
          }}
        />
      ) : null}
      {view ? (
        <BdView
          id={view}
          actions={actions}
          onClose={() => setView(null)}
          onChanged={() => list.reload()}
        />
      ) : null}
    </>
  );
}

function RaiseForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [assetId, setAssetId] = useState('');
  return (
    <FormModal
      title="Report a breakdown"
      fields={[
        { key: 'symptom', label: 'What is wrong', type: 'textarea', required: true },
        {
          key: 'priority',
          label: 'Priority (P1 = production stopped)',
          type: 'select',
          options: ['P1', 'P2', 'P3'],
        },
        { key: 'machineStopped', label: 'The machine has stopped', type: 'check' },
      ]}
      initial={{ priority: 'P2', machineStopped: 'true' }}
      onClose={onClose}
      extra={
        <div className="field">
          <label htmlFor="bd-asset">Machine *</label>
          <AssetSelect id="bd-asset" maintainable value={assetId} onChange={setAssetId} />
        </div>
      }
      onSubmit={async (v) => {
        await apost('/maint/breakdowns', {
          assetId,
          symptom: v.symptom,
          priority: v.priority,
          machineStopped: v.machineStopped === 'true',
        });
        toast('Reported');
        onSaved();
      }}
    />
  );
}

function BdView({
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
  const doc = useLoad(() => aget(`/maint/breakdowns/${id}`), [id]);
  const codes = useLoad(() => aget<Row[]>('/maint/failure-codes'), []);
  const [resolving, setResolving] = useState(false);
  const t = doc.data;
  const st = s(t?.status);
  const ver = Number(t?.version ?? 0);
  const after = () => {
    doc.reload();
    onChanged();
  };
  const opts = (kind: string) =>
    (codes.data ?? [])
      .filter((c) => s(c.kind) === kind)
      .map((c) => ({ id: s(c.code), label: `${s(c.code)} · ${s(c.name)}` }));
  return (
    <Dialog
      title={t ? `${s(t.bdNo)} · ${s(t.assetName)}` : 'Breakdown'}
      sub={st.replace('_', ' ')}
      onClose={onClose}
      error={doc.error}
      footer={
        t ? (
          <>
            {st === 'OPEN' && actions.edit ? (
              <Act
                label="Acknowledge"
                primary
                run={() => apost(`/maint/breakdowns/${id}/acknowledge`, {}, ver)}
                done={after}
              />
            ) : null}
            {st === 'ACK' && actions.edit ? (
              <Act
                label="Start repair"
                primary
                run={() => apost(`/maint/breakdowns/${id}/start-repair`, {}, ver)}
                done={after}
              />
            ) : null}
            {['ACK', 'IN_REPAIR'].includes(st) && actions.edit ? (
              <button type="button" className="btn primary" onClick={() => setResolving(true)}>
                Repaired
              </button>
            ) : null}
            {st === 'RESOLVED' && actions.approve ? (
              <Act
                label="Close ticket"
                primary
                run={() => apost(`/maint/breakdowns/${id}/close`, {}, ver)}
                done={after}
              />
            ) : null}
            {['OPEN', 'ACK'].includes(st) && actions.cancel ? (
              <ReasonAct
                label="Cancel ticket"
                question="Why is it cancelled?"
                run={(reason) => apost(`/maint/breakdowns/${id}/cancel`, { reason }, ver)}
                done={after}
              />
            ) : null}
          </>
        ) : null
      }
    >
      {t ? (
        <>
          <p>
            <b>{s(t.symptom)}</b>
          </p>
          <p>
            Reported {hhmm(t.reportedAt)} · priority {s(t.priority)} · work order{' '}
            <b>{s(t.mwoNo) || 'not raised yet'}</b>
            {t.repairedAt ? ` · repaired ${hhmm(t.repairedAt)}` : ''}
          </p>
          {t.failureMode ? (
            <p>
              Mode {s(t.failureMode)} · cause {s(t.failureCause)} · mechanism{' '}
              {s(t.failureMechanism) || '—'} · {s(t.rootCause)}
            </p>
          ) : null}
        </>
      ) : (
        <p>Loading…</p>
      )}
      {resolving ? (
        <FormModal
          title="Repair done"
          sub="Pick the failure codes. They feed the reliability numbers."
          fields={[
            {
              key: 'failureMode',
              label: 'How it failed (mode)',
              type: 'select',
              required: true,
              options: opts('MODE'),
            },
            {
              key: 'failureCause',
              label: 'Why it failed (cause)',
              type: 'select',
              required: true,
              options: opts('CAUSE'),
            },
            {
              key: 'failureMechanism',
              label: 'What failed (mechanism)',
              type: 'select',
              options: opts('MECHANISM'),
            },
            { key: 'rootCause', label: 'Root cause in words', type: 'textarea' },
          ]}
          onClose={() => setResolving(false)}
          onSubmit={async (v) => {
            await apost(`/maint/breakdowns/${id}/resolve`, v, ver);
            setResolving(false);
            after();
          }}
        />
      ) : null}
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------------ work orders
export function WorkOrdersPage({
  actions,
  page,
  base,
  title,
}: {
  actions: ActionSet;
  page: string;
  base: string;
  title: string;
}) {
  const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const list = useLoad(() => alist(base, { status }), [base, status]);
  return (
    <>
      <PageHead
        title={title}
        sub="Maintenance jobs: checks to tick, spares drawn from the store, labour and vendor charges. The cost is worked out for you."
      />
      <div className="toolbar">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {['PLANNED', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED'].map((x) => (
            <option key={x} value={x}>
              {x.replace('_', ' ')}
            </option>
          ))}
        </select>
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            + New work order
          </button>
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="No work orders yet."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'Work order', r: (r) => s(r.mwoNo) },
          { h: 'Asset', r: (r) => `${s(r.assetNo)} · ${s(r.assetName)}` },
          { h: 'Type', r: (r) => s(r.woType) },
          { h: 'Job', r: (r) => s(r.description) },
          { h: 'Priority', r: (r) => s(r.priority) },
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
        <WoForm
          base={base}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            list.reload();
          }}
        />
      ) : null}
      {view ? (
        <WoView
          id={view}
          base={base}
          page={page}
          actions={actions}
          onClose={() => setView(null)}
          onChanged={() => list.reload()}
        />
      ) : null}
    </>
  );
}

function WoForm({
  base,
  onClose,
  onSaved,
}: {
  base: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [assetId, setAssetId] = useState('');
  return (
    <FormModal
      title="New work order"
      fields={[
        {
          key: 'woType',
          label: 'Kind of job',
          type: 'select',
          required: true,
          options: [
            { id: 'CORRECTIVE', label: 'Repair' },
            { id: 'PM', label: 'Preventive service' },
            { id: 'CALIBRATION', label: 'Calibration' },
            { id: 'AMC', label: 'Annual contract visit' },
          ],
        },
        { key: 'description', label: 'What is to be done', type: 'textarea', required: true },
        { key: 'priority', label: 'Priority', type: 'select', options: ['P1', 'P2', 'P3'] },
        { key: 'plannedStart', label: 'Planned start', type: 'date' },
        { key: 'estCost', label: 'Estimated cost', type: 'number' },
      ]}
      initial={{ woType: 'CORRECTIVE', priority: 'P2' }}
      onClose={onClose}
      extra={
        <div className="field">
          <label htmlFor="wo-asset">Asset *</label>
          <AssetSelect id="wo-asset" value={assetId} onChange={setAssetId} />
        </div>
      }
      onSubmit={async (v) => {
        await apost(base, { ...v, assetId });
        toast('Saved');
        onSaved();
      }}
    />
  );
}

function WoView({
  id,
  base,
  actions,
  onClose,
  onChanged,
}: {
  id: string;
  base: string;
  page: string;
  actions: ActionSet;
  onClose: () => void;
  onChanged: () => void;
}) {
  const doc = useLoad(() => aget(`${base}/${id}`), [id, base]);
  const whs = useLoad(() => lookupWarehouseOptions(), []);
  const [wh, setWh] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Record<string, string>>({});
  const [addSpare, setAddSpare] = useState(false);
  const [addLabour, setAddLabour] = useState(false);
  const [addVendor, setAddVendor] = useState(false);
  const users = useUserOptions();
  const w = doc.data;
  const st = s(w?.status);
  const ver = Number(w?.version ?? 0);
  const after = () => {
    doc.reload();
    onChanged();
  };
  const live = st === 'IN_PROGRESS';
  const cost = (w?.cost ?? {}) as Row;
  return (
    <Dialog
      title={w ? `${s(w.mwoNo)} · ${s(w.assetName)}` : 'Work order'}
      sub={
        w
          ? `${s(w.woType)} · ${st.replace('_', ' ')} · approval ${s(w.approvalStatus).replace('_', ' ').toLowerCase()}`
          : ''
      }
      onClose={onClose}
      error={doc.error}
      footer={
        w ? (
          <>
            {st === 'PLANNED' && s(w.approvalStatus) === 'NOT_REQUIRED' && actions.submit ? (
              <Act
                label="Send for approval"
                run={() => apost(`${base}/${id}/submit`, {}, ver)}
                done={after}
              />
            ) : null}
            {s(w.approvalStatus) === 'PENDING' && actions.approve ? (
              <>
                <Act
                  label="Approve"
                  primary
                  run={() => apost(`${base}/${id}/approve`, {}, ver)}
                  done={after}
                />
                <Act
                  label="Reject"
                  run={() => apost(`${base}/${id}/reject`, {}, ver)}
                  done={after}
                />
              </>
            ) : null}
            {['PLANNED', 'APPROVED'].includes(st) &&
            s(w.approvalStatus) !== 'PENDING' &&
            actions.post ? (
              <Act
                label="Start the job"
                primary
                run={() => apost(`${base}/${id}/start`)}
                done={after}
              />
            ) : null}
            {live && actions.post ? (
              <Act
                label="Job is done"
                primary
                run={() => apost(`${base}/${id}/complete`, {}, ver)}
                done={after}
              />
            ) : null}
            {st === 'COMPLETED' && actions.approve ? (
              <Act
                label="Sign off and close"
                primary
                run={() => apost(`${base}/${id}/sign-off`, {}, ver)}
                done={after}
              />
            ) : null}
            {['PLANNED', 'APPROVED'].includes(st) && actions.cancel ? (
              <ReasonAct
                label="Cancel"
                question="Why is it cancelled?"
                run={(reason) => apost(`${base}/${id}/cancel`, { reason }, ver)}
                done={after}
              />
            ) : null}
          </>
        ) : null
      }
    >
      {w ? (
        <>
          <p>
            <b>{s(w.description)}</b> · planned{' '}
            {w.plannedStart ? dmy(s(w.plannedStart).slice(0, 10)) : '—'} · started{' '}
            {hhmm(w.actualStart)} · finished {hhmm(w.actualEnd)}
          </p>
          <h4>Checks</h4>
          <Grid
            rows={(w.tasks as Row[]) ?? []}
            rowKey={(t) => s(t.id)}
            empty="No checks on this job."
            cols={[
              { h: 'No.', r: (t) => s(t.seq) },
              {
                h: 'Check',
                r: (t) =>
                  `${s(t.text)}${t.minValue !== null && t.maxValue !== null ? ` (${num(t.minValue)} to ${num(t.maxValue)})` : ''}`,
              },
              { h: 'Result', r: (t) => s(t.result) || '—' },
              {
                h: '',
                r: (t) =>
                  live && actions.post ? (
                    <>
                      <input
                        aria-label={`Result ${s(t.seq)}`}
                        value={result[s(t.id)] ?? ''}
                        placeholder={s(t.answerType) === 'OK_NOTOK' ? 'OK or NOT OK' : ''}
                        onChange={(e) => setResult((o) => ({ ...o, [s(t.id)]: e.target.value }))}
                      />
                      <Act
                        label="Save"
                        run={() =>
                          aput(`${base}/${id}/tasks/${s(t.id)}`, { result: result[s(t.id)] ?? '' })
                        }
                        done={after}
                      />
                    </>
                  ) : null,
              },
            ]}
          />
          <h4>Spares</h4>
          <div className="toolbar">
            <label htmlFor="wo-wh">Issue from store</label>
            <OptionSelect id="wo-wh" value={wh} options={whs.data ?? []} onChange={setWh} />
            {actions.edit && !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(st) ? (
              <button type="button" className="btn" onClick={() => setAddSpare(true)}>
                + Add spare
              </button>
            ) : null}
          </div>
          <Grid
            rows={(w.spares as Row[]) ?? []}
            rowKey={(r) => s(r.id)}
            empty="No spares."
            cols={[
              { h: 'Item', r: (r) => `${s(r.itemCode)} · ${s(r.itemName)}` },
              { h: 'Needed', r: (r) => num(r.requiredQty) },
              { h: 'Issued', r: (r) => num(r.issuedQty) },
              { h: 'Returned', r: (r) => num(r.returnedQty) },
              { h: 'Cost', r: (r) => inr(s(r.amount)) },
              {
                h: 'Issue / return',
                r: (r) =>
                  live && actions.post ? (
                    <>
                      <input
                        aria-label={`Quantity ${s(r.itemCode)}`}
                        type="number"
                        min={0}
                        step="any"
                        value={qty[s(r.id)] ?? ''}
                        onChange={(e) => setQty((o) => ({ ...o, [s(r.id)]: e.target.value }))}
                      />
                      <Act
                        label="Issue"
                        run={() =>
                          apost(`${base}/${id}/spares/${s(r.id)}/issue`, {
                            qty: qty[s(r.id)],
                            ...(wh ? { warehouseId: wh } : {}),
                          })
                        }
                        done={() => {
                          setQty({});
                          after();
                        }}
                      />
                      <Act
                        label="Return"
                        run={() =>
                          apost(`${base}/${id}/spares/${s(r.id)}/return`, { qty: qty[s(r.id)] })
                        }
                        done={() => {
                          setQty({});
                          after();
                        }}
                      />
                    </>
                  ) : null,
              },
            ]}
          />
          <h4>Labour and vendors</h4>
          <div className="toolbar">
            {actions.edit && !['CLOSED', 'CANCELLED'].includes(st) ? (
              <>
                <button type="button" className="btn" onClick={() => setAddLabour(true)}>
                  + Labour
                </button>
                <button type="button" className="btn" onClick={() => setAddVendor(true)}>
                  + Vendor charge
                </button>
              </>
            ) : null}
          </div>
          <Grid
            rows={[
              ...((w.labour as Row[]) ?? []).map((l) => ({
                id: s(l.id),
                who: s(l.employeeName) || s(l.vendorName),
                what: `${num(l.hours)} h at ${num(l.rate)}`,
                amount: l.amount,
              })),
              ...((w.vendorCharges as Row[]) ?? []).map((v) => ({
                id: s(v.id),
                who: s(v.supplierName) || 'Vendor',
                what: s(v.invoiceRef),
                amount: v.amount,
              })),
            ]}
            rowKey={(r) => s(r.id)}
            empty="No labour or vendor charges."
            cols={[
              { h: 'Who', r: (r) => s(r.who) },
              { h: 'What', r: (r) => s(r.what) },
              { h: 'Amount', r: (r) => inr(s(r.amount)) },
            ]}
          />
          <p>
            Cost: spares <b>{inr(s(cost.spares))}</b> · labour <b>{inr(s(cost.labour))}</b> ·
            vendors <b>{inr(s(cost.vendor))}</b> · total <b>{inr(s(cost.total))}</b>
          </p>
          {addSpare ? (
            <FormModal
              title="Add a spare"
              fields={[
                { key: 'itemId', label: 'Spare part', type: 'item', required: true },
                { key: 'qty', label: 'Quantity needed', type: 'number', required: true },
              ]}
              onClose={() => setAddSpare(false)}
              onSubmit={async (v) => {
                await apost(`${base}/${id}/spares`, {
                  itemId: v.itemId,
                  qty: v.qty,
                  ...(wh ? { warehouseId: wh } : {}),
                });
                setAddSpare(false);
                after();
              }}
            />
          ) : null}
          {addLabour ? (
            <FormModal
              title="Add labour"
              fields={[
                {
                  key: 'employeeId',
                  label: 'Our person',
                  type: 'select',
                  options: users.data ?? [],
                },
                { key: 'vendorName', label: 'Or an outside vendor' },
                { key: 'startAt', label: 'From', type: 'datetime' },
                { key: 'endAt', label: 'To', type: 'datetime' },
                { key: 'rate', label: 'Rate per hour', type: 'number', required: true },
              ]}
              onClose={() => setAddLabour(false)}
              onSubmit={async (v) => {
                await apost(`${base}/${id}/labour`, {
                  ...v,
                  startAt: localToIso(v.startAt ?? isoNow()),
                  endAt: localToIso(v.endAt ?? isoNow()),
                });
                setAddLabour(false);
                after();
              }}
            />
          ) : null}
          {addVendor ? (
            <FormModal
              title="Add a vendor charge"
              fields={[
                { key: 'supplierId', label: 'Supplier', type: 'supplier' },
                { key: 'invoiceRef', label: 'Invoice number' },
                { key: 'amount', label: 'Amount', type: 'number', required: true },
              ]}
              onClose={() => setAddVendor(false)}
              onSubmit={async (v) => {
                await apost(`${base}/${id}/vendor-charges`, v);
                setAddVendor(false);
                after();
              }}
            />
          ) : null}
        </>
      ) : (
        <p>Loading…</p>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------------ spares, downtime, MTBF, alerts
export function SparesPage() {
  const [q, setQ] = useState('');
  const list = useLoad(() => alist('/maint/spares', { q }), [q]);
  return (
    <>
      <PageHead
        title="Spare Parts"
        sub="Spare Part items with the stock the store holds. Stock is kept on the inventory pages; this is a view for the maintenance team."
      />
      <div className="toolbar">
        <input
          aria-label="Search spares"
          placeholder="Search code or name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="No spare part items. Mark an item as type Spare Part in the Item Master."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'Code', r: (r) => s(r.code) },
          { h: 'Name', r: (r) => s(r.name) },
          { h: 'In stock', r: (r) => `${num(r.onHand)} ${s(r.uom)}` },
          { h: 'Value', r: (r) => inr(s(r.value)) },
        ]}
      />
    </>
  );
}

export function DowntimePage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [type, setType] = useState('');
  const [adding, setAdding] = useState(false);
  const [assetId, setAssetId] = useState('');
  const list = useLoad(() => alist('/maint/downtime', { type }), [type]);
  return (
    <>
      <PageHead
        title="Downtime"
        sub="Every stop of a machine, planned or not. These minutes feed OEE and the MTBF report; a planned stop is not a failure."
      />
      <div className="toolbar">
        <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All</option>
          <option value="PLANNED">Planned</option>
          <option value="UNPLANNED">Unplanned</option>
        </select>
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            + Log downtime
          </button>
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <p>
        Total <b>{num(list.data?.meta.totalMinutes)}</b> minutes
      </p>
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="No downtime recorded."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'No.', r: (r) => s(r.dtNo) },
          { h: 'Machine', r: (r) => `${s(r.assetNo)} · ${s(r.assetName)}` },
          { h: 'From', r: (r) => hhmm(r.startAt) },
          { h: 'To', r: (r) => (r.endAt ? hhmm(r.endAt) : 'still down') },
          { h: 'Minutes', r: (r) => num(r.durationMin) },
          { h: 'Type', r: (r) => (s(r.dtType) === 'PLANNED' ? 'Planned' : 'Unplanned') },
          { h: 'Reason', r: (r) => s(r.reason) || (r.bdNo ? s(r.bdNo) : '—') },
          {
            h: '',
            r: (r) =>
              !r.endAt && actions.edit ? (
                <Act
                  label="Machine is running"
                  run={() => apost(`/maint/downtime/${s(r.id)}/end`)}
                  done={() => list.reload()}
                />
              ) : null,
          },
        ]}
      />
      {adding ? (
        <FormModal
          title="Log downtime"
          fields={[
            { key: 'startAt', label: 'From', type: 'datetime', required: true },
            { key: 'endAt', label: 'To (leave empty if still down)', type: 'datetime' },
            {
              key: 'dtType',
              label: 'Type',
              type: 'select',
              required: true,
              options: [
                { id: 'UNPLANNED', label: 'Unplanned' },
                { id: 'PLANNED', label: 'Planned' },
              ],
            },
            { key: 'reason', label: 'Reason' },
            { key: 'lostQty', label: 'Pieces lost', type: 'number' },
          ]}
          initial={{ dtType: 'UNPLANNED' }}
          onClose={() => setAdding(false)}
          extra={
            <div className="field">
              <label htmlFor="dt-asset">Machine *</label>
              <AssetSelect id="dt-asset" maintainable value={assetId} onChange={setAssetId} />
            </div>
          }
          onSubmit={async (v) => {
            await apost('/maint/downtime', {
              ...v,
              assetId,
              startAt: localToIso(v.startAt ?? ''),
              ...(v.endAt ? { endAt: localToIso(v.endAt) } : {}),
            });
            toast('Saved');
            setAdding(false);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

export function MtbfPage() {
  const [from, setFrom] = useState(addDays(todayIso(), -90));
  const [to, setTo] = useState(todayIso());
  const d = useLoad(() => aget('/maint/reports/mtbf', { from, to }), [from, to]);
  return (
    <>
      <PageHead
        title="MTBF and MTTR"
        sub="Worked out only from the logged downtime and breakdowns. A machine with no failures in the period shows a dash, not a made-up number."
      />
      <div className="toolbar">
        <label htmlFor="mt-from">From</label>
        <DateField id="mt-from" value={from} onChange={(e) => setFrom(e.target.value)} />
        <label htmlFor="mt-to">To</label>
        <DateField id="mt-to" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <ErrorBox message={d.error} />
      <Grid
        rows={(d.data?.rows as Row[] | undefined) ?? []}
        loading={d.loading}
        empty="No data yet."
        rowKey={(r) => s(r.assetId)}
        cols={[
          { h: 'Asset', r: (r) => `${s(r.assetNo)} · ${s(r.name)}` },
          { h: 'Criticality', r: (r) => s(r.criticality) },
          { h: 'Failures', r: (r) => s(r.failures) },
          { h: 'MTBF (hours)', r: (r) => (r.mtbfHours ? s(r.mtbfHours) : '—') },
          { h: 'MTTR (hours)', r: (r) => (r.mttrHours ? s(r.mttrHours) : '—') },
          { h: 'Availability', r: (r) => (r.availabilityPct ? `${s(r.availabilityPct)} %` : '—') },
          { h: 'Downtime (min)', r: (r) => num(r.downtimeMinutes) },
        ]}
      />
    </>
  );
}

export function AlertsPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [status, setStatus] = useState('OPEN');
  const list = useLoad(() => alist('/maint/alerts', { status }), [status]);
  const rules = useLoad(() => aget<Row[]>('/maint/alert-rules'), []);
  const [msg, setMsg] = useState('');
  return (
    <>
      <PageHead
        title="Maintenance Alerts"
        sub="Services falling due or overdue, breakdowns nobody picked up, warranties ending and loans due back. Overdue ones escalate on their own."
      />
      <div className="toolbar">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          <option value="OPEN">Open</option>
          <option value="ACK">Acknowledged</option>
        </select>
        {actions.post ? (
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setMsg('');
              apost('/maint/alerts/run')
                .then(() => {
                  toast('Checked');
                  list.reload();
                })
                .catch((e: unknown) => setMsg(toUiError(e).message));
            }}
          >
            Check now
          </button>
        ) : null}
      </div>
      <ErrorBox message={msg || list.error} />
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="No alerts. Everything is on time."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'Alert', r: (r) => s(r.alertType).replace(/_/g, ' ').toLowerCase() },
          { h: 'Asset', r: (r) => s(r.assetNo) || '—' },
          { h: 'Message', r: (r) => s(r.message) },
          {
            h: 'Level',
            r: (r) =>
              Number(r.escalationLevel) > 0 ? `Escalated ×${s(r.escalationLevel)}` : 'New',
          },
          { h: 'Status', r: (r) => pill(r.status) },
          {
            h: '',
            r: (r) =>
              s(r.status) === 'OPEN' && actions.edit ? (
                <Act
                  label="Acknowledge"
                  run={() => apost(`/maint/alerts/${s(r.id)}/acknowledge`)}
                  done={() => list.reload()}
                />
              ) : null,
          },
        ]}
      />
      <h4>When alerts are raised</h4>
      <Grid
        rows={rules.data ?? []}
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'Alert', r: (r) => s(r.alertType).replace(/_/g, ' ').toLowerCase() },
          { h: 'Days ahead', r: (r) => s(r.leadDays) },
          {
            h: 'Escalates after (minutes)',
            r: (r) => ((r.escalationMinutes as number[]) ?? []).join(', ') || '—',
          },
          { h: 'On', r: (r) => (r.active === true ? 'Yes' : 'No') },
        ]}
      />
    </>
  );
}
