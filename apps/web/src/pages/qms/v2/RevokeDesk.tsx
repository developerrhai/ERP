// Rejection & Revoke Register: rejected batches and items, and the controlled revoke of a rejection (reason compulsory,
// approved or refused with a note, MR / Quality Head override, full trail).
import { useState } from 'react';
import { Modal } from '../../../components/Modal';
import { useToast } from '../../../components/Toast';
import { getSalesV40 } from '../../sales/salesV40Api';
import { qget, qpost } from '../../../lib/qmsApi';
import { useLoad } from '../../../lib/useLoad';
import type { ActionSet } from '../../../types';
import { dmy, ErrorBox, Pill } from '../../finance/shared';
import { recordOf, useWmsActions as useActions, WmsRegister as Register } from '../../wms/WmsRegister';
import { CommentDialog, messageOf, Trail, type TrailEvent } from './shared';

const PAGE = 'qms-rejection-revoke';

interface Request {
  id: string;
  number: string;
  status: string;
  reason: string;
  requestedByName: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  override: boolean;
  events: TrailEvent[];
}
interface History {
  rejection: { id: string; number: string; status: string; part: string; itemName: string | null; holdQty: string; defect: string; process: string; rejectDate: string; disposition: string };
  requests: Request[];
}
type Step = { kind: 'ask' | 'override'; id: string; number: string } | { kind: 'approve' | 'refuse'; id: string; number: string };

function StepDialog({ step, onClose, onDone }: { step: Step; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const t = {
    ask: ['Request revoke', `Somebody else has to approve the request for ${step.number}.`, 'Reason for revoking', 'Send request'],
    override: ['Revoke override', `${step.number} is revoked at once, without a second approval.`, 'Reason for revoking', 'Revoke now'],
    approve: ['Approve revoke', `${step.number}: the rejection will stop counting. Blocked stock is not moved.`, 'Approval note', 'Approve'],
    refuse: ['Refuse revoke', `${step.number}: the rejection stays.`, 'Why it is refused', 'Refuse'],
  }[step.kind] as [string, string, string, string];
  return (
    <CommentDialog
      title={t[0]}
      text={t[1]}
      label={t[2]}
      action={t[3]}
      min={5}
      danger={step.kind === 'refuse' || step.kind === 'override'}
      onClose={onClose}
      onSubmit={async (words) => {
        if (step.kind === 'ask') await qpost('/revokes', { rejectionId: step.id, reason: words });
        else if (step.kind === 'override') await qpost('/revokes/override', { rejectionId: step.id, reason: words });
        else await qpost(`/revokes/${step.id}/decide`, { approved: step.kind === 'approve', note: words });
        toast(step.kind === 'ask' ? 'Revoke requested.' : step.kind === 'refuse' ? 'Request refused.' : 'Rejection revoked.');
        onDone();
      }}
    />
  );
}

function Record({ id, actions, tick, canOverride, onStep, onWithdraw, onClose }: { id: string; actions: ActionSet; tick: number; canOverride: boolean; onStep: (s: Step) => void; onWithdraw: (id: string, number: string) => void; onClose: () => void }) {
  const load = useLoad(() => qget<History>(`/revokes/rejection/${id}`), [id, tick]);
  const h = load.data;
  const r = h?.rejection;
  const waiting = h?.requests.find((q) => q.status === 'Pending');
  const live = r && (r.status === 'Open' || r.status === 'Closed');
  const fact = (label: string, value: string) => (
    <div className="v8-mini">
      <small>{label}</small>
      <b>{value || '—'}</b>
    </div>
  );
  return (
    <Modal
      title={r?.number ?? 'Loading…'}
      sub={r ? 'Rejection and its revoke requests' : ''}
      onClose={onClose}
      footer={
        r ? (
          <>
            {live && !waiting && actions.add ? (
              <button type="button" className="btn primary" onClick={() => onStep({ kind: 'ask', id: r.id, number: r.number })}>
                Request Revoke
              </button>
            ) : null}
            {waiting && actions.approve ? (
              <>
                <button type="button" className="btn primary" onClick={() => onStep({ kind: 'approve', id: waiting.id, number: waiting.number })}>
                  Approve
                </button>
                <button type="button" className="btn" onClick={() => onStep({ kind: 'refuse', id: waiting.id, number: waiting.number })}>
                  Refuse
                </button>
              </>
            ) : null}
            {waiting && actions.add ? (
              <button type="button" className="btn" onClick={() => onWithdraw(waiting.id, waiting.number)}>
                Withdraw
              </button>
            ) : null}
            {live && canOverride ? (
              <button type="button" className="btn danger" onClick={() => onStep({ kind: 'override', id: r.id, number: r.number })}>
                Revoke Override
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
            <Pill>{r.status}</Pill>
          </p>
          <div className="drawer-grid">
            {fact('Rejected on', dmy(r.rejectDate))}
            {fact('Source', r.process)}
            {fact('Item', r.itemName ?? r.part)}
            {fact('Quantity', r.holdQty)}
            {fact('Defect', r.defect)}
            {fact('Disposition', r.disposition.replace(/_/g, ' ').toLowerCase())}
          </div>
          {h.requests.length === 0 ? <p className="qv-note">No revoke has been requested for this rejection.</p> : null}
          {h.requests.map((q) => (
            <section key={q.id} className="qv-panel" aria-label={q.number}>
              <h3>
                {q.number} <Pill>{q.status}</Pill>
                {q.override ? <Pill tone="pending">Override</Pill> : null}
              </h3>
              <p className="qv-text">
                <b>Reason:</b> {q.reason}
                {q.decisionNote ? (
                  <>
                    <br />
                    <b>Decision:</b> {q.decisionNote}
                  </>
                ) : null}
              </p>
              <Trail events={q.events} />
            </section>
          ))}
        </>
      ) : null}
    </Modal>
  );
}

/** "＋ Request Revoke": choose the rejection first. */
function Pick({ onClose, onPicked }: { onClose: () => void; onPicked: (id: string) => void }) {
  const [id, setId] = useState('');
  const load = useLoad(() => getSalesV40(PAGE, { tab: '', first: true, page: 1, size: 100 }), []);
  const rows = (load.data?.rows ?? []).filter((r) => r.status === 'Open' || r.status === 'Closed');
  const itemKey = load.data?.columns.find((c) => c.label === 'Item')?.key ?? '';
  return (
    <Modal
      title="Which rejection?"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn primary" disabled={!id} title={id ? undefined : 'Choose a rejection.'} onClick={() => onPicked(id)}>
            Open
          </button>
        </>
      }
    >
      <ErrorBox message={load.error} />
      <div className="field">
        <label htmlFor="qv-rej">Rejection *</label>
        <select id="qv-rej" value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">— choose —</option>
          {rows.map((r) => (
            <option key={r.id} value={recordOf(r)}>
              {r.number}
              {r[itemKey] ? ` · ${r[itemKey]}` : ''}
            </option>
          ))}
        </select>
      </div>
      {!load.loading && rows.length === 0 ? <p className="qv-note">There is no rejection that can be revoked. Rejections are recorded by inspections and on the Non-Conformance / NCR page.</p> : null}
    </Modal>
  );
}

export function RevokeDesk({ actions, title, sub }: { actions: ActionSet; title: string; sub: string }) {
  const toast = useToast();
  const act = useActions();
  const [view, setView] = useState<string | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [picking, setPicking] = useState(false);
  const counts = useLoad(() => qget<{ rejected: number; revoked: number; pending: number; revokedPct: number; canOverride: boolean }>('/revokes/counts'), [act.reloadKey]);
  const c = counts.data;
  const withdraw = (id: string, number: string): void => {
    qpost(`/revokes/${id}/withdraw`)
      .then(() => toast(`${number} withdrawn.`))
      .catch((e: unknown) => toast(messageOf(e)))
      .finally(act.reload);
  };
  return (
    <div className="qv-page">
      <Register
        pageId={PAGE}
        title={title}
        sub={sub}
        actions={actions}
        add={[{ label: '＋ Request Revoke', onClick: () => setPicking(true) }]}
        error={act.error}
        reloadKey={act.reloadKey}
        reload={act.reload}
        onOpen={setView}
        above={
          c ? (
            <div className="qv-tiles">
              <div className="card">
                <small>Rejections</small>
                <b>{c.rejected}</b>
              </div>
              <div className="card">
                <small>Revoke requests waiting</small>
                <b>{c.pending}</b>
              </div>
              <div className="card">
                <small>Revoked</small>
                <b>{c.revoked}</b>
              </div>
              <div className="card">
                <small>Share revoked</small>
                <b>{c.revokedPct}%</b>
              </div>
            </div>
          ) : null
        }
        rowExtra={(r) => (
          <button type="button" className="btn sm primary" onClick={() => setView(recordOf(r))}>
            Revoke / Trail
          </button>
        )}
      >
        {picking ? (
          <Pick
            onClose={() => setPicking(false)}
            onPicked={(id) => {
              setPicking(false);
              setView(id);
            }}
          />
        ) : null}
        {view ? <Record id={view} actions={actions} tick={act.reloadKey} canOverride={Boolean(c?.canOverride)} onStep={setStep} onWithdraw={withdraw} onClose={() => setView(null)} /> : null}
        {step ? (
          <StepDialog
            step={step}
            onClose={() => setStep(null)}
            onDone={() => {
              setStep(null);
              act.reload();
            }}
          />
        ) : null}
      </Register>
    </div>
  );
}
