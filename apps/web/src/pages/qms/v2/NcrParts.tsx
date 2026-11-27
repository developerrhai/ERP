// The pop-ups of Customer NCR and Conformance NCR: register / edit form, the record with its D1-D8 stages, gate chart
// line and approval trail, and the four actions (send for acceptance, accept, return with comment, cancel).
import { useEffect, useState } from 'react';
import { Modal } from '../../../components/Modal';
import { useToast } from '../../../components/Toast';
import { docsMailApi, saveFile } from '../../../lib/docsMailApi';
import { toUiError } from '../../../lib/errors';
import { qget, qpatch, qpost, qput } from '../../../lib/qmsApi';
import { registry } from '../../../lib/registry';
import { useLoad } from '../../../lib/useLoad';
import type { ActionSet } from '../../../types';
import { dmy, ErrorBox, inr, Pill, todayIso } from '../../finance/shared';
import { RefPicker } from '../Shared';
import { CommentDialog, messageOf, PriorityPill, PrioritySelect, Trail, type TrailEvent } from './shared';

export type NcrType = 'CUSTOMER' | 'CONFORMANCE';
export const pageOf = (t: NcrType): string => (t === 'CUSTOMER' ? 'qms-customer-ncr' : 'qms-conformance-ncr');

export interface Stage {
  key: string;
  label: string;
  text: string;
  done: boolean;
  doneOn: string | null;
  doneBy: string | null;
}
export interface Ncr {
  id: string;
  number: string;
  type: NcrType;
  ncrDate: string;
  department: string;
  priority: string;
  result: string;
  customerId: string | null;
  customerName: string | null;
  customerCode: string | null;
  itemId: string | null;
  itemName: string | null;
  itemCode: string | null;
  reference: string | null;
  process: string | null;
  title: string;
  description: string;
  qty: string | null;
  claimAmount: string;
  rootCause: string | null;
  correctiveAction: string | null;
  preventiveAction: string | null;
  ownerName: string | null;
  targetDate: string | null;
  status: string;
  version: number;
  returnComment: string | null;
  returnedByName: string | null;
  closedByName: string | null;
  closedAt: string | null;
  closureNote: string | null;
  cancelReason: string | null;
  stages: Stage[];
  events: TrailEvent[];
}

const EMPTY = {
  ncrDate: todayIso(),
  department: 'Quality',
  priority: 'MINOR',
  result: 'NON_CONFORMANCE',
  customerId: '',
  customerLabel: '',
  itemId: '',
  itemLabel: '',
  reference: '',
  process: '',
  title: '',
  description: '',
  qty: '',
  claimAmount: '',
  rootCause: '',
  correctiveAction: '',
  preventiveAction: '',
  ownerName: '',
  targetDate: '',
};

export function NcrForm({ type, id, onClose, onSaved }: { type: NcrType; id: string | null; onClose: () => void; onSaved: (r: Ncr) => void }) {
  const toast = useToast();
  const customer = type === 'CUSTOMER';
  const [f, setF] = useState({ ...EMPTY });
  const [version, setVersion] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof EMPTY, v: string): void => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!id) return;
    let alive = true;
    qget<Ncr>(`/ncrs/${id}`)
      .then((r) => {
        if (!alive) return;
        setVersion(r.version);
        setF({
          ncrDate: r.ncrDate,
          department: r.department,
          priority: r.priority,
          result: r.result,
          customerId: r.customerId ?? '',
          customerLabel: r.customerName ? `${r.customerCode} · ${r.customerName}` : '',
          itemId: r.itemId ?? '',
          itemLabel: r.itemName ? `${r.itemCode} · ${r.itemName}` : '',
          reference: r.reference ?? '',
          process: r.process ?? '',
          title: r.title,
          description: r.description,
          qty: r.qty ?? '',
          claimAmount: Number(r.claimAmount) ? r.claimAmount : '',
          rootCause: r.rootCause ?? '',
          correctiveAction: r.correctiveAction ?? '',
          preventiveAction: r.preventiveAction ?? '',
          ownerName: r.ownerName ?? '',
          targetDate: r.targetDate ?? '',
        });
      })
      .catch((e: unknown) => alive && setMsg(messageOf(e)));
    return () => {
      alive = false;
    };
  }, [id]);

  const save = async (): Promise<void> => {
    // the server checks everything again; these four are said in place before it is asked
    const missing: Record<string, string> = {};
    if (customer && !f.customerId) missing.customerId = 'Choose the customer who complained.';
    if (f.title.trim().length < 3) missing.title = 'Write a short title.';
    if (f.description.trim().length < 3) missing.description = customer ? 'Describe the complaint.' : 'Describe what was found.';
    for (const k of ['qty', 'claimAmount'] as const) if (f[k] && !/^\d+(\.\d+)?$/.test(f[k])) missing[k] = 'Enter a number.';
    setErrors(missing);
    setMsg(Object.keys(missing).length ? 'Please fill the marked fields.' : '');
    if (Object.keys(missing).length) return;
    const body = {
      ncrDate: f.ncrDate,
      department: f.department,
      priority: f.priority,
      ...(customer ? { customerId: f.customerId } : { result: f.result, rootCause: f.rootCause, correctiveAction: f.correctiveAction, preventiveAction: f.preventiveAction, process: f.process }),
      itemId: f.itemId || null,
      reference: f.reference,
      title: f.title,
      description: f.description,
      qty: f.qty || null,
      claimAmount: f.claimAmount || null,
      ownerName: f.ownerName,
      targetDate: f.targetDate || null,
    };
    setBusy(true);
    try {
      const r = id && version !== null ? await qpatch<Ncr>(`/ncrs/${id}`, version, body) : await qpost<Ncr>('/ncrs', { type, ...body });
      toast(`Saved ${r.number}`);
      onSaved(r);
    } catch (e) {
      const u = toUiError(e);
      setMsg(u.message);
      setErrors(u.fields);
    } finally {
      setBusy(false);
    }
  };

  const input = (k: keyof typeof EMPTY, label: string, kind = 'text', required = false) => (
    <div className="field">
      <label htmlFor={`ncr-${k}`}>
        {label}
        {required ? ' *' : ''}
      </label>
      <input id={`ncr-${k}`} type={kind} value={f[k]} onChange={(e) => set(k, e.target.value)} />
      {errors[k] ? <div className="field-error">{errors[k]}</div> : null}
    </div>
  );
  const area = (k: keyof typeof EMPTY, label: string, required = false) => (
    <div className="field wide">
      <label htmlFor={`ncr-${k}`}>
        {label}
        {required ? ' *' : ''}
      </label>
      <textarea id={`ncr-${k}`} rows={3} value={f[k]} onChange={(e) => set(k, e.target.value)} />
      {errors[k] ? <div className="field-error">{errors[k]}</div> : null}
    </div>
  );

  return (
    <Modal
      title={id ? 'Edit NCR' : customer ? 'Register a customer complaint' : 'New conformance record'}
      sub={customer ? 'Complaint registration. The 8D stages are filled on the record after saving.' : 'Internal process conformance or non-conformance.'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <ErrorBox message={msg} />
      <div className="form-grid">
        {input('ncrDate', 'Date', 'date', true)}
        <div className="field">
          <label htmlFor="ncr-priority">Priority *</label>
          <PrioritySelect id="ncr-priority" value={f.priority} onChange={(v) => set('priority', v)} />
          {errors.priority ? <div className="field-error">{errors.priority}</div> : null}
          {f.priority === 'CRITICAL' ? <small className="qv-warn">Critical: the Quality Head and the MR are alerted, and only they or an administrator can close it.</small> : null}
        </div>
        <div className="field">
          <label htmlFor="ncr-department">Responsible department</label>
          <select id="ncr-department" value={f.department} onChange={(e) => set('department', e.target.value)}>
            {registry.departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
        {customer ? (
          <div className="field">
            <label htmlFor="ncr-customer">Customer *</label>
            <RefPicker id="ncr-customer" kind="customer" value={f.customerId} label={f.customerLabel} onChange={(v, l) => setF((x) => ({ ...x, customerId: v, customerLabel: l }))} />
            {errors.customerId ? <div className="field-error">{errors.customerId}</div> : null}
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="ncr-result">Result *</label>
              <select id="ncr-result" value={f.result} onChange={(e) => set('result', e.target.value)}>
                <option value="NON_CONFORMANCE">Non-conformance</option>
                <option value="CONFORMANCE">Conformance</option>
              </select>
            </div>
            {input('process', 'Process')}
          </>
        )}
        <div className="field">
          <label htmlFor="ncr-item">Item</label>
          <RefPicker id="ncr-item" kind="item" value={f.itemId} label={f.itemLabel} onChange={(v, l) => setF((x) => ({ ...x, itemId: v, itemLabel: l }))} />
          {errors.itemId ? <div className="field-error">{errors.itemId}</div> : null}
        </div>
        {input('reference', customer ? 'Invoice / complaint reference' : 'Reference')}
        {input('qty', 'Quantity affected')}
        {customer ? input('claimAmount', 'Customer claim amount (₹)') : null}
        {input('ownerName', 'Responsible owner')}
        {input('targetDate', 'Target date', 'date')}
        <div className="field wide">
          <label htmlFor="ncr-title">Title *</label>
          <input id="ncr-title" maxLength={200} value={f.title} onChange={(e) => set('title', e.target.value)} />
          {errors.title ? <div className="field-error">{errors.title}</div> : null}
        </div>
        {area('description', customer ? 'Complaint' : 'Observation', true)}
        {customer ? null : (
          <>
            {area('rootCause', 'Root cause')}
            {area('correctiveAction', 'Corrective action')}
            {area('preventiveAction', 'Preventive action')}
          </>
        )}
      </div>
    </Modal>
  );
}

/** D1 to D8 as coloured gates: passed, the one that is open now, and those still closed. */
export function GateStrip({ stages }: { stages: { key: string; label: string; done: boolean; doneOn: string | null }[] }) {
  const current = stages.findIndex((s) => !s.done);
  return (
    <ol className="qv-gates" aria-label="Stage gates">
      {stages.map((s, i) => (
        <li key={s.key} className={s.done ? 'passed' : i === current ? 'current' : ''} title={`${s.label}: ${s.done ? `passed ${dmy(s.doneOn)}` : i === current ? 'open' : 'waiting'}`}>
          <b>{s.key.toUpperCase()}</b>
          <span>{s.done ? '✓' : i === current ? '●' : '—'}</span>
        </li>
      ))}
    </ol>
  );
}

/** The D1-D8 workflow of one customer NCR: each stage is saved, passed (in order) or reopened. */
export function EightD({ ncr, canEdit, onChanged }: { ncr: Ncr; canEdit: boolean; onChanged: (r: Ncr) => void }) {
  const toast = useToast();
  const [words, setWords] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  useEffect(() => {
    setWords({});
    setErrors({});
  }, [ncr.id]);
  const editable = canEdit && ncr.status === 'Open';
  const next = ncr.stages.findIndex((s) => !s.done);
  const send = async (s: Stage, done: boolean): Promise<void> => {
    setBusy(s.key);
    setErrors({});
    try {
      const r = await qput<Ncr>(`/ncrs/${ncr.id}/stages/${s.key}`, { text: words[s.key] ?? s.text, done }, ncr.version);
      setWords((w) => {
        const rest = { ...w };
        delete rest[s.key];
        return rest;
      });
      toast(done && !s.done ? `${s.label} passed` : !done && s.done ? `${s.label} reopened` : `${s.label} saved`);
      onChanged(r);
    } catch (e) {
      setErrors({ [s.key]: messageOf(e) });
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="qv-8d">
      <GateStrip stages={ncr.stages} />
      {ncr.stages.map((s, i) => (
        <section key={s.key} className={`qv-stage${s.done ? ' passed' : ''}`} aria-label={s.label}>
          <header>
            <b>{s.label}</b>
            {s.done ? <Pill tone="approved">{`Passed ${dmy(s.doneOn)}${s.doneBy ? ` · ${s.doneBy}` : ''}`}</Pill> : i === next ? <Pill tone="pending">Open</Pill> : <Pill tone="draft">Waiting</Pill>}
          </header>
          <textarea
            aria-label={`${s.label} details`}
            rows={2}
            maxLength={2000}
            value={words[s.key] ?? s.text}
            disabled={!editable}
            onChange={(e) => setWords((w) => ({ ...w, [s.key]: e.target.value }))}
          />
          {errors[s.key] ? <div className="field-error">{errors[s.key]}</div> : null}
          {editable ? (
            <div className="actions">
              <button type="button" className="btn sm" disabled={busy !== ''} onClick={() => void send(s, s.done)}>
                Save
              </button>
              {s.done ? (
                <button type="button" className="btn sm" disabled={busy !== ''} onClick={() => void send(s, false)}>
                  Reopen gate
                </button>
              ) : (
                <button type="button" className="btn sm primary" disabled={busy !== ''} onClick={() => void send(s, true)}>
                  Pass gate
                </button>
              )}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

export type NcrStep = 'submit' | 'accept' | 'return' | 'cancel';
/** The comment pop-up of one step. Return needs the comment; accept and send take it if given; cancel needs a reason. */
export function NcrStepDialog({ step, record, onClose, onDone }: { step: NcrStep; record: { id: string; number: string }; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const text = {
    submit: ['Send for acceptance', `${record.number} goes to Pending Acceptance. It cannot be changed until it is accepted or returned.`, 'Note', 'Send', 'sent for acceptance'],
    accept: ['Accept and close', `${record.number} will be closed.`, 'Closure note', 'Accept', 'accepted and closed'],
    return: ['Return', `${record.number} goes back to the person who sent it.`, 'Add Comment', 'Return', 'returned'],
    cancel: ['Cancel NCR', `${record.number} stays on record as cancelled.`, 'Reason', 'Cancel NCR', 'cancelled'],
  }[step] as [string, string, string, string, string];
  return (
    <CommentDialog
      title={text[0]}
      text={text[1]}
      label={text[2]}
      action={text[3]}
      min={step === 'return' || step === 'cancel' ? 3 : 0}
      danger={step === 'cancel'}
      onClose={onClose}
      onSubmit={async (words) => {
        const body = step === 'return' ? { comment: words } : step === 'cancel' ? { reason: words } : words ? { note: words } : {};
        await qpost(`/ncrs/${record.id}/${step}`, body);
        toast(`${record.number} ${text[4]}.`);
        onDone();
      }}
    />
  );
}

export function NcrView({ id, actions, onClose, onEdit, onChanged }: { id: string; actions: ActionSet; onClose: () => void; onEdit: (id: string) => void; onChanged: () => void }) {
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const load = useLoad(() => qget<Ncr>(`/ncrs/${id}`), [id, tick]);
  const [fresh, setFresh] = useState<Ncr | null>(null);
  const [step, setStep] = useState<NcrStep | null>(null);
  const r = fresh && load.data && fresh.version >= load.data.version ? fresh : load.data;
  const open = r?.status === 'Open';
  const waiting = r?.status === 'Pending Acceptance';
  const fact = (label: string, value: string | null | undefined) => (
    <div className="v8-mini">
      <small>{label}</small>
      <b>{value || '—'}</b>
    </div>
  );
  return (
    <>
      <Modal
        title={r ? r.number : 'Loading…'}
        sub={r ? r.title : ''}
        onClose={onClose}
        footer={
          r ? (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  docsMailApi
                    .print(pageOf(r.type), r.id, 'standard')
                    .then((f) => saveFile(f, `${r.number}.pdf`))
                    .catch((e: unknown) => toast(messageOf(e)));
                }}
              >
                PDF
              </button>
              {open && actions.edit ? (
                <button type="button" className="btn" onClick={() => onEdit(r.id)}>
                  Edit
                </button>
              ) : null}
              {open && actions.submit ? (
                <button type="button" className="btn primary" onClick={() => setStep('submit')}>
                  Send for Acceptance
                </button>
              ) : null}
              {waiting && actions.approve ? (
                <>
                  <button type="button" className="btn" onClick={() => setStep('return')}>
                    Return
                  </button>
                  <button type="button" className="btn primary" onClick={() => setStep('accept')}>
                    Accept
                  </button>
                </>
              ) : null}
              {(open || waiting) && actions.cancel ? (
                <button type="button" className="btn danger" onClick={() => setStep('cancel')}>
                  Cancel NCR
                </button>
              ) : null}
              <button type="button" className="btn" onClick={onClose}>
                Close
              </button>
            </>
          ) : undefined
        }
      >
        <ErrorBox message={load.error} />
        {r ? (
          <>
            <p className="qv-pills">
              <Pill>{r.status}</Pill> <PriorityPill value={r.priority} />
              {r.type === 'CONFORMANCE' ? <Pill tone={r.result === 'CONFORMANCE' ? 'approved' : 'rejected'}>{r.result === 'CONFORMANCE' ? 'Conformance' : 'Non-conformance'}</Pill> : null}
            </p>
            {r.returnComment ? (
              <div className="msg warn show static" role="status">
                Returned by {r.returnedByName ?? 'the approver'}: {r.returnComment}
              </div>
            ) : null}
            <div className="drawer-grid">
              {fact('Date', dmy(r.ncrDate))}
              {r.type === 'CUSTOMER' ? fact('Customer', r.customerName ? `${r.customerCode} · ${r.customerName}` : '') : fact('Process', r.process)}
              {fact('Responsible department', r.department)}
              {fact('Item', r.itemName ? `${r.itemCode} · ${r.itemName}` : '')}
              {fact('Reference', r.reference)}
              {fact('Quantity', r.qty)}
              {r.type === 'CUSTOMER' ? fact('Claim amount', inr(r.claimAmount)) : null}
              {fact('Responsible owner', r.ownerName)}
              {fact('Target date', dmy(r.targetDate))}
              {r.status === 'Closed' ? fact('Closed', `${dmy(r.closedAt)}${r.closedByName ? ` by ${r.closedByName}` : ''}`) : null}
              {r.status === 'Closed' ? fact('Closure note', r.closureNote) : null}
              {r.status === 'Cancelled' ? fact('Cancelled because', r.cancelReason) : null}
            </div>
            <h3>{r.type === 'CUSTOMER' ? 'Complaint' : 'Observation'}</h3>
            <p className="qv-text">{r.description}</p>
            {r.type === 'CUSTOMER' ? (
              <>
                <h3>8D corrective workflow</h3>
                <EightD
                  ncr={r}
                  canEdit={actions.edit}
                  onChanged={(n) => {
                    setFresh(n);
                    onChanged();
                  }}
                />
              </>
            ) : (
              <div className="drawer-grid">
                {fact('Root cause', r.rootCause)}
                {fact('Corrective action', r.correctiveAction)}
                {fact('Preventive action', r.preventiveAction)}
              </div>
            )}
            <h3>Approval trail</h3>
            <Trail events={r.events} />
          </>
        ) : null}
      </Modal>
      {step && r ? (
        <NcrStepDialog
          step={step}
          record={r}
          onClose={() => setStep(null)}
          onDone={() => {
            setStep(null);
            setFresh(null);
            setTick((n) => n + 1);
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}
