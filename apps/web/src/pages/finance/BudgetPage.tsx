// Budgeting (fin-budget): twelve monthly amounts per expense account. Only an Active budget is enforced.
import { FinV40 } from './FinV40';
import { useState, type FormEvent } from 'react';
import { Field, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { useAppContext } from '../../lib/context';
import { toUiError } from '../../lib/errors';
import { createBudget, deleteBudget, listAccounts, listBudgets, setBudgetStatus, listDimension } from '../../lib/financeApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { Empty, ErrorBox, inr, PageHead, Pill } from './shared';

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

export function BudgetPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(listBudgets, []);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setErr('');
    try {
      await fn();
      toast(msg);
      reload();
    } catch (e) {
      setErr(toUiError(e).message);
    }
  };
  return (
    <>
      <PageHead
        title="Budgeting"
        sub="Set what each expense account may spend. Postings over an active budget are stopped."
      >
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            ＋ New Budget
          </button>
        ) : null}
      </PageHead>
      <ErrorBox message={error || err} />
      <FinV40
        pageId="fin-budget"
        actions={actions}
        fallback={
          <>
            <div className="card table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Budget</th>
                    <th scope="col">Account</th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Year total
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(data ?? []).map((b) => (
                    <tr key={b.id}>
                      <td>
                        <strong>{b.name}</strong>
                      </td>
                      <td>
                        {b.accountCode} · {b.accountName}
                      </td>
                      <td style={{ textAlign: 'right' }}>{inr(b.total)}</td>
                      <td>
                        <Pill>{b.status}</Pill>
                      </td>
                      <td>
                        <div className="actions">
                          {b.status === 'Draft' && actions.approve ? (
                            <button
                              type="button"
                              className="btn sm"
                              title="Start enforcing this budget"
                              onClick={() =>
                                void act(
                                  () => setBudgetStatus(b.id, b.version, 'Active'),
                                  'Budget is now active.',
                                )
                              }
                            >
                              Activate
                            </button>
                          ) : null}
                          {b.status === 'Active' && actions.approve ? (
                            <button
                              type="button"
                              className="btn sm"
                              onClick={() =>
                                void act(
                                  () => setBudgetStatus(b.id, b.version, 'Closed'),
                                  'Budget closed.',
                                )
                              }
                            >
                              Close
                            </button>
                          ) : null}
                          {b.status === 'Draft' && actions.delete ? (
                            <button
                              type="button"
                              className="btn sm danger"
                              aria-label={`Delete ${b.name}`}
                              onClick={() => void act(() => deleteBudget(b.id), 'Budget deleted.')}
                            >
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {loading && !data ? <Empty cols={5}>Loading…</Empty> : null}
                  {data && data.length === 0 ? (
                    <Empty cols={5}>No budgets yet. Click ＋ New Budget.</Empty>
                  ) : null}
                </tbody>
              </table>
            </div>
            {adding ? (
              <BudgetForm
                onClose={() => setAdding(false)}
                onSaved={() => {
                  setAdding(false);
                  reload();
                  toast('Budget saved as Draft.');
                }}
              />
            ) : null}
          </>
        }
      />
    </>
  );
}

function BudgetForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const ctx = useAppContext().data;
  const accounts = useLoad(() => listAccounts({ postable: true, size: 200 }), []);
  const [accountId, setAccountId] = useState('');
  const [name, setName] = useState('');
  const [monthly, setMonthly] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [byMonth, setByMonth] = useState<Record<number, string>>({});
  const centers = useLoad(() => listDimension('cost'), []);
  const [err, setErr] = useState('');
  const [pending, setPending] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!accountId || name.trim().length < 2 || !(Number(monthly) >= 0) || monthly === '') {
      setErr('Choose an account, give the budget a name and enter the monthly amount.');
      return;
    }
    setPending(true);
    setErr('');
    try {
      await createBudget({
        unitId: ctx?.current.unitId,
        accountId,
        name: name.trim(),
        months: MONTHS.map((_m, i) => byMonth[i]?.trim() || monthly),
        ...(costCenterId ? { costCenterId } : {}),
      });
      onSaved();
    } catch (caught) {
      setErr(toUiError(caught).message);
      setPending(false);
    }
  };
  return (
    <Modal
      title="New budget"
      sub="The monthly amount fills all 12 months; type over any month that differs."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="budget-form" className="btn primary" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="budget-form" onSubmit={(e) => void submit(e)} noValidate>
        <ErrorBox message={err} />
        <SelectField label="Expense account *" value={accountId} onChange={setAccountId}>
          <option value="">Choose…</option>
          {(accounts.data?.rows ?? [])
            .filter((a) => a.rootType === 'Expense')
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
        </SelectField>
        <Field label="Budget name *" value={name} onChange={(e) => setName(e.target.value)} />
        <Field
          label="Amount per month *"
          inputMode="decimal"
          value={monthly}
          onChange={(e) => setMonthly(e.target.value)}
        />
        <SelectField label="Cost centre" value={costCenterId} onChange={setCostCenterId}>
          <option value="">The whole account</option>
          {(centers.data?.rows ?? [])
            .filter((d) => !d.isGroup)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} · {d.name}
              </option>
            ))}
        </SelectField>
        <fieldset className="field budget-months">
          <legend>Month by month (blank = the monthly amount)</legend>
          <div className="form-grid">
            {MONTHS.map((m, i) => (
              <div className="field" key={String(m)}>
                <label htmlFor={`bm-${i}`}>{String(m)}</label>
                <input id={`bm-${i}`} inputMode="decimal" placeholder={monthly || '0'} value={byMonth[i] ?? ''} onChange={(e) => setByMonth({ ...byMonth, [i]: e.target.value })} />
              </div>
            ))}
          </div>
        </fieldset>
        <p className="v8-sub">Annual budget: ₹ {MONTHS.reduce((a, _m, i) => a + (Number(byMonth[i]?.trim() || monthly) || 0), 0).toLocaleString('en-IN')}</p>
      </form>
    </Modal>
  );
}
