// Expense Management (fin-expenses): raise a claim, submit it for approval, and (Finance) pay it. The category
// limits are shown while you type; Finance edits them in the "Limits" tab.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Field, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Pager } from '../../components/Pager';
import { useToast } from '../../components/Toast';
import { useAppContext } from '../../lib/context';
import { toUiError, type UiError } from '../../lib/errors';
import {
  cancelClaim,
  createClaim,
  deleteClaim,
  expensePolicies,
  listBankAccounts,
  listClaims,
  payClaim,
  saveExpensePolicy,
  submitClaim,
  listDimension,
  type Claim,
  type ExpensePolicy,
} from '../../lib/financeApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, Empty, ErrorBox, inr, PageHead, Pill, todayIso } from './shared';

export function ExpensesPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [tab, setTab] = useState<'claims' | 'limits'>('claims');
  const [page, setPage] = useState(1);
  const [mine, setMine] = useState(false);
  const claims = useLoad(() => listClaims(page, mine), [page, mine]);
  const policies = useLoad(expensePolicies, []);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<Claim | null>(null);
  const [cancelling, setCancelling] = useState<Claim | null>(null);
  const [err, setErr] = useState('');
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setErr('');
    try {
      await fn();
      toast(msg);
      claims.reload();
    } catch (e) {
      setErr(toUiError(e).message);
    }
  };
  return (
    <>
      <PageHead
        title="Expense Management"
        sub="Claim what you spent for the business. Approved claims are paid by Finance."
      >
        <Link className="btn" to="/approvals">
          My Approvals
        </Link>
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            ＋ New Claim
          </button>
        ) : null}
      </PageHead>
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'claims'}
          className={`tab${tab === 'claims' ? ' active' : ''}`}
          onClick={() => setTab('claims')}
        >
          Claims
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'limits'}
          className={`tab${tab === 'limits' ? ' active' : ''}`}
          onClick={() => setTab('limits')}
        >
          Limits
        </button>
      </div>
      <ErrorBox message={claims.error || err} />
      {tab === 'claims' ? (
        <>
          {actions.approve ? (
            <label className="check">
              <input
                type="checkbox"
                checked={mine}
                onChange={(e) => {
                  setMine(e.target.checked);
                  setPage(1);
                }}
              />{' '}
              Show only my claims
            </label>
          ) : null}
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Number</th>
                  <th scope="col">Date</th>
                  <th scope="col">Employee</th>
                  <th scope="col">Category</th>
                  <th scope="col">For</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Amount
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {(claims.data?.rows ?? []).map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.code}</strong>
                      {c.warnings.length ? (
                        <div className="field-error">{c.warnings[0]?.message}</div>
                      ) : null}
                    </td>
                    <td>{dmy(c.claimDate)}</td>
                    <td>{c.employee ?? '—'}</td>
                    <td>{c.category}</td>
                    <td>{c.description}</td>
                    <td style={{ textAlign: 'right' }}>{inr(c.amount)}</td>
                    <td>
                      <Pill>{c.status}</Pill>
                    </td>
                    <td>
                      <div className="actions">
                        {(c.status === 'Draft' || c.status === 'Rejected') && actions.submit ? (
                          <button
                            type="button"
                            className="btn sm primary"
                            title="Send for approval"
                            onClick={() =>
                              void act(() => submitClaim(c.id, c.version), 'Sent for approval.')
                            }
                          >
                            Submit
                          </button>
                        ) : null}
                        {c.status === 'Draft' && actions.delete ? (
                          <button
                            type="button"
                            className="btn sm danger"
                            aria-label={`Delete claim ${c.code}`}
                            onClick={() => void act(() => deleteClaim(c.id), 'Draft deleted.')}
                          >
                            Delete
                          </button>
                        ) : null}
                        {c.status === 'Approved' && actions.post ? (
                          <button
                            type="button"
                            className="btn sm primary"
                            onClick={() => setPaying(c)}
                          >
                            Pay
                          </button>
                        ) : null}
                        {c.status === 'Approved' && actions.cancel ? (
                          <button
                            type="button"
                            className="btn sm danger"
                            onClick={() => setCancelling(c)}
                          >
                            Cancel
                          </button>
                        ) : null}
                        {c.status === 'Pending Approval' ? (
                          <span className="v8-sub">Waiting for the approver</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {claims.loading && !claims.data ? <Empty cols={8}>Loading…</Empty> : null}
                {claims.data && claims.data.rows.length === 0 ? (
                  <Empty cols={8}>No claims yet. Click ＋ New Claim.</Empty>
                ) : null}
              </tbody>
            </table>
          </div>
          {claims.data ? (
            <Pager page={page} size={20} total={claims.data.meta.total} onPage={setPage} />
          ) : null}
        </>
      ) : (
        <Limits
          policies={policies.data ?? []}
          canEdit={actions.approve}
          onSaved={() => {
            policies.reload();
            toast('Limit saved.');
          }}
        />
      )}
      {adding ? (
        <ClaimForm
          policies={policies.data ?? []}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            claims.reload();
            toast('Claim saved as Draft. Submit it when it is ready.');
          }}
        />
      ) : null}
      {paying ? (
        <PayModal
          claim={paying}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            claims.reload();
            toast('Claim paid.');
          }}
        />
      ) : null}
      {cancelling ? (
        <CancelClaim
          claim={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            claims.reload();
            toast('Claim cancelled.');
          }}
        />
      ) : null}
    </>
  );
}

function Limits({
  policies,
  canEdit,
  onSaved,
}: {
  policies: ExpensePolicy[];
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [edit, setEdit] = useState<ExpensePolicy | null>(null);
  return (
    <>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Per claim
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Per month
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Never above
              </th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((p) => (
              <tr key={p.category}>
                <td>{p.category}</td>
                <td style={{ textAlign: 'right' }}>{inr(p.perClaimLimit)}</td>
                <td style={{ textAlign: 'right' }}>{inr(p.perMonthLimit)}</td>
                <td style={{ textAlign: 'right' }}>{inr(p.approvalLimit)}</td>
                <td>
                  {canEdit ? (
                    <button
                      type="button"
                      className="btn sm"
                      aria-label={`Edit ${p.category} limits`}
                      onClick={() => setEdit(p)}
                    >
                      Edit
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="v8-sub">
        Above the per-claim or per-month limit a claim is allowed but flagged for the approver.
        Above "never above" it is refused.
      </p>
      {edit ? (
        <LimitForm
          policy={edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            onSaved();
          }}
        />
      ) : null}
    </>
  );
}

function LimitForm({
  policy,
  onClose,
  onSaved,
}: {
  policy: ExpensePolicy;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [claim, setClaim] = useState(policy.perClaimLimit);
  const [month, setMonth] = useState(policy.perMonthLimit);
  const [hard, setHard] = useState(policy.approvalLimit);
  const [err, setErr] = useState('');
  return (
    <Modal
      title={`${policy.category} limits`}
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
                try {
                  await saveExpensePolicy(policy.category, policy.version, {
                    perClaimLimit: claim,
                    perMonthLimit: month,
                    approvalLimit: hard,
                    defaultAccountId: policy.defaultAccountId,
                  });
                  onSaved();
                } catch (e) {
                  setErr(toUiError(e).message);
                }
              })()
            }
          >
            Save
          </button>
        </>
      }
    >
      <ErrorBox message={err} />
      <Field
        label="Per claim"
        inputMode="decimal"
        value={claim}
        onChange={(e) => setClaim(e.target.value)}
      />
      <Field
        label="Per month (per person)"
        inputMode="decimal"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
      />
      <Field
        label="Never above"
        inputMode="decimal"
        value={hard}
        onChange={(e) => setHard(e.target.value)}
      />
    </Modal>
  );
}

function ClaimForm({
  policies,
  onClose,
  onSaved,
}: {
  policies: ExpensePolicy[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const ctx = useAppContext().data;
  const centers = useLoad(() => listDimension('cost'), []);
  const [category, setCategory] = useState(policies[0]?.category ?? 'Travel');
  const [claimDate, setClaimDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [billNo, setBillNo] = useState('');
  const [costCenterId, setCc] = useState('');
  const [err, setErr] = useState<UiError | null>(null);
  const [pending, setPending] = useState(false);
  const pol = policies.find((p) => p.category === category);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const f: Record<string, string> = {};
    if (!ctx?.current.unitId) f.unitId = 'Choose a unit at the top of the screen first.';
    if (!(Number(amount) > 0)) f.amount = 'Enter an amount greater than 0.';
    if (description.trim().length < 3) f.description = 'Say what the expense was for.';
    if (Object.keys(f).length) {
      setErr({ message: f.unitId ?? '', fields: f, code: 'LOCAL' });
      return;
    }
    setPending(true);
    setErr(null);
    try {
      await createClaim({
        unitId: ctx?.current.unitId,
        claimDate,
        category,
        amount,
        description: description.trim(),
        ...(billNo.trim() ? { billNo: billNo.trim() } : {}),
        ...(costCenterId ? { costCenterId } : {}),
      });
      onSaved();
    } catch (caught) {
      setErr(toUiError(caught));
      setPending(false);
    }
  };
  return (
    <Modal
      title="New expense claim"
      sub={
        pol
          ? `${category}: up to ${inr(pol.perClaimLimit)} per claim, ${inr(pol.perMonthLimit)} per month.`
          : ''
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="claim-form" className="btn primary" disabled={pending}>
            {pending ? 'Saving…' : 'Save Draft'}
          </button>
        </>
      }
    >
      <form id="claim-form" onSubmit={(e) => void submit(e)} noValidate>
        <ErrorBox message={err?.message ?? ''} />
        <SelectField label="Category *" value={category} onChange={setCategory}>
          {policies.map((p) => (
            <option key={p.category}>{p.category}</option>
          ))}
        </SelectField>
        <div className="grid2">
          <Field
            label="Date *"
            type="date"
            value={claimDate}
            onChange={(e) => setClaimDate(e.target.value)}
          />
          <Field
            label="Amount *"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={err?.fields.amount}
          />
        </div>
        <Field
          label="What was it for? *"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          error={err?.fields.description}
        />
        <Field label="Bill number" value={billNo} onChange={(e) => setBillNo(e.target.value)} />
        <SelectField
          label="Cost centre"
          value={costCenterId}
          onChange={setCc}
          error={err?.fields.costCenterId}
        >
          <option value="">Not needed / choose…</option>
          {(centers.data?.rows ?? [])
            .filter((d) => !d.isGroup)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} · {d.name}
              </option>
            ))}
        </SelectField>
      </form>
    </Modal>
  );
}

function PayModal({
  claim,
  onClose,
  onDone,
}: {
  claim: Claim;
  onClose: () => void;
  onDone: () => void;
}) {
  const banks = useLoad(listBankAccounts, []);
  const [bankAccountId, setBank] = useState('');
  const [mode, setMode] = useState('NEFT');
  const [err, setErr] = useState('');
  const chosen = (banks.data ?? []).find((b) => b.id === bankAccountId);
  const effectiveMode = chosen && chosen.kind !== 'BANK' ? 'Cash' : mode === 'Cash' ? 'NEFT' : mode;
  return (
    <Modal
      title={`Pay ${claim.code}`}
      sub={`${inr(claim.amount)} to ${claim.employee ?? 'the employee'}`}
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
                if (!bankAccountId) {
                  setErr('Choose the account to pay from.');
                  return;
                }
                try {
                  await payClaim(claim.id, claim.version, { bankAccountId, mode: effectiveMode });
                  onDone();
                } catch (e) {
                  setErr(toUiError(e).message);
                }
              })()
            }
          >
            Pay
          </button>
        </>
      }
    >
      <ErrorBox message={err} />
      <SelectField label="Pay from *" value={bankAccountId} onChange={setBank}>
        <option value="">Choose…</option>
        {(banks.data ?? []).map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </SelectField>
      {chosen && chosen.kind === 'BANK' ? (
        <SelectField label="How" value={effectiveMode} onChange={setMode}>
          {['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque'].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </SelectField>
      ) : null}
    </Modal>
  );
}

function CancelClaim({
  claim,
  onClose,
  onDone,
}: {
  claim: Claim;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  return (
    <Modal
      title={`Cancel ${claim.code}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Keep it
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={() =>
              void (async () => {
                if (reason.trim().length < 5) {
                  setErr('Enter a reason of 5 to 300 characters.');
                  return;
                }
                try {
                  await cancelClaim(claim.id, claim.version, reason.trim());
                  onDone();
                } catch (e) {
                  setErr(toUiError(e).message);
                }
              })()
            }
          >
            Cancel claim
          </button>
        </>
      }
    >
      <ErrorBox message={err} />
      <Field label="Reason *" value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}
