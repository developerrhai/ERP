// Bank Reconciliation (fin-bankreco): import a statement, match its lines to ledger rows, post the entries the
// books are missing, and reconcile when the difference is exactly zero.
import { useState, type FormEvent } from 'react';
import { Field, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import {
  createEntryFromLine,
  getStatement,
  importStatement,
  listAccounts,
  listBankAccounts,
  listStatements,
  matchLine,
  reconcileStatement,
  suggestions,
  unmatchLine,
} from '../../lib/financeApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { amt, dmy, Empty, ErrorBox, inr, PageHead, Pill } from './shared';

export function BankRecoPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const list = useLoad(listStatements, []);
  const [open, setOpen] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  return (
    <>
      <PageHead
        title="Bank Reconciliation"
        sub="Match your bank statement to the books until the difference is zero."
      >
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setImporting(true)}>
            ＋ Import Statement
          </button>
        ) : null}
      </PageHead>
      <ErrorBox message={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Opening
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Closing
              </th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.rows ?? []).map((s) => (
              <tr key={s.id}>
                <td>
                  {dmy(s.periodFrom)} to {dmy(s.periodTo)}
                </td>
                <td style={{ textAlign: 'right' }}>{inr(s.openingBalance)}</td>
                <td style={{ textAlign: 'right' }}>{inr(s.closingBalance)}</td>
                <td>
                  <Pill>{s.status}</Pill>
                </td>
                <td>
                  <button type="button" className="btn sm" onClick={() => setOpen(s.id)}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
            {list.data && list.data.rows.length === 0 ? (
              <Empty cols={5}>No statements yet. Click ＋ Import Statement.</Empty>
            ) : null}
          </tbody>
        </table>
      </div>
      {importing ? (
        <ImportForm
          onClose={() => setImporting(false)}
          onSaved={() => {
            setImporting(false);
            list.reload();
            toast('Statement imported.');
          }}
        />
      ) : null}
      {open ? (
        <Workbench
          id={open}
          actions={actions}
          onClose={() => {
            setOpen(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

/** Pasted CSV: date,description,reference,withdrawal,deposit  (date as YYYY-MM-DD). */
function parseCsv(text: string) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [txnDate = '', description = '', refNo = '', withdrawal = '', deposit = ''] = l
        .split(',')
        .map((c) => c.trim());
      return {
        txnDate,
        description,
        refNo,
        withdrawal: withdrawal || undefined,
        deposit: deposit || undefined,
      };
    });
}

function ImportForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const banks = useLoad(listBankAccounts, []);
  const [bankAccountId, setBank] = useState('');
  const [periodFrom, setFrom] = useState('');
  const [periodTo, setTo] = useState('');
  const [openingBalance, setOpening] = useState('');
  const [closingBalance, setClosing] = useState('');
  const [csv, setCsv] = useState('');
  const [err, setErr] = useState('');
  const [pending, setPending] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (
      !bankAccountId ||
      !periodFrom ||
      !periodTo ||
      !openingBalance ||
      !closingBalance ||
      !csv.trim()
    ) {
      setErr('Fill every field and paste the statement lines.');
      return;
    }
    setPending(true);
    setErr('');
    try {
      await importStatement({
        bankAccountId,
        periodFrom,
        periodTo,
        openingBalance,
        closingBalance,
        lines: parseCsv(csv),
      });
      onSaved();
    } catch (caught) {
      setErr(toUiError(caught).message);
      setPending(false);
    }
  };
  return (
    <Modal
      title="Import bank statement"
      sub="Paste one line per row: date (YYYY-MM-DD), description, reference, withdrawal, deposit."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="import-form" className="btn primary" disabled={pending}>
            {pending ? 'Importing…' : 'Import'}
          </button>
        </>
      }
    >
      <form id="import-form" onSubmit={(e) => void submit(e)} noValidate>
        <ErrorBox message={err} />
        <SelectField label="Bank account *" value={bankAccountId} onChange={setBank}>
          <option value="">Choose…</option>
          {(banks.data ?? [])
            .filter((b) => b.kind === 'BANK')
            .map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
        </SelectField>
        <div className="grid2">
          <Field
            label="From *"
            type="date"
            value={periodFrom}
            onChange={(e) => setFrom(e.target.value)}
          />
          <Field
            label="To *"
            type="date"
            value={periodTo}
            onChange={(e) => setTo(e.target.value)}
          />
          <Field
            label="Opening balance *"
            inputMode="decimal"
            value={openingBalance}
            onChange={(e) => setOpening(e.target.value)}
          />
          <Field
            label="Closing balance *"
            inputMode="decimal"
            value={closingBalance}
            onChange={(e) => setClosing(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="csv">Statement lines *</label>
          <textarea
            id="csv"
            rows={8}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder="2026-11-05,NEFT to vendor,UTR123,5000.00,"
          />
        </div>
      </form>
    </Modal>
  );
}

function Workbench({
  id,
  actions,
  onClose,
}: {
  id: string;
  actions: ActionSet;
  onClose: () => void;
}) {
  const toast = useToast();
  const { data, error, reload } = useLoad(
    async () => ({ detail: await getStatement(id), hints: await suggestions(id) }),
    [id],
  );
  const accounts = useLoad(() => listAccounts({ postable: true, size: 200 }), []);
  const [err, setErr] = useState('');
  const [counter, setCounter] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    setErr('');
    try {
      await fn();
      if (ok) toast(ok);
      reload();
    } catch (e) {
      setErr(toUiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  const d = data?.detail;
  const hint = (lineId: string) => data?.hints.find((h) => h.lineId === lineId)?.candidates[0];
  const open = d?.statement.status === 'Open';
  return (
    <Modal
      title="Reconcile statement"
      sub={d ? `${dmy(d.statement.periodFrom)} to ${dmy(d.statement.periodTo)}` : ''}
      onClose={onClose}
      footer={
        <>
          {d ? (
            <span
              className={d.proof.difference === '0.00' ? 'v8-sub' : 'field-error'}
              role="status"
            >
              Difference {inr(d.proof.difference)}
            </span>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          {open && d && actions.approve ? (
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              title="Only possible when every line is matched and the difference is zero"
              onClick={() =>
                void run(() => reconcileStatement(id, d.statement.version), 'Statement reconciled.')
              }
            >
              Reconcile
            </button>
          ) : null}
        </>
      }
    >
      <ErrorBox message={error || err} />
      {d ? (
        <>
          <div className="kpis">
            <div className="kpi">
              <small>Books</small>
              <b>{inr(d.proof.bookBalance)}</b>
            </div>
            <div className="kpi">
              <small>Bank</small>
              <b>{inr(d.proof.statementClosing)}</b>
            </div>
            <div className="kpi">
              <small>Not cleared</small>
              <b>{inr(d.proof.unclearedBook)}</b>
            </div>
            <div className="kpi">
              <small>Not in books</small>
              <b>{inr(d.proof.unrecordedBank)}</b>
            </div>
          </div>
          {open && actions.add ? (
            <SelectField
              label="Account for entries the books are missing (bank charges, interest…)"
              value={counter}
              onChange={setCounter}
            >
              <option value="">Choose…</option>
              {(accounts.data?.rows ?? [])
                .filter((a) => !a.partyRequired)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
            </SelectField>
          ) : null}
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Description</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Out
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    In
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {d.lines.map((l) => {
                  const h = hint(l.id);
                  return (
                    <tr key={l.id}>
                      <td>{dmy(l.txnDate)}</td>
                      <td>{l.description ?? l.refNo ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>{amt(l.withdrawal)}</td>
                      <td style={{ textAlign: 'right' }}>{amt(l.deposit)}</td>
                      <td>
                        <Pill>{l.matchStatus}</Pill>
                      </td>
                      <td>
                        {open ? (
                          <div className="actions">
                            {l.matchStatus === 'Matched' ? (
                              <button
                                type="button"
                                className="btn sm"
                                disabled={busy}
                                onClick={() => void run(() => unmatchLine(id, l.id))}
                              >
                                Unmatch
                              </button>
                            ) : (
                              <>
                                {h ? (
                                  <button
                                    type="button"
                                    className="btn sm"
                                    disabled={busy}
                                    title={`${h.voucherNo} ${dmy(h.date)}`}
                                    onClick={() => void run(() => matchLine(id, l.id, h.glEntryId))}
                                  >
                                    Match {h.voucherNo}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="btn sm"
                                  disabled={busy || !counter}
                                  title={
                                    counter
                                      ? 'Post this entry and match it'
                                      : 'Choose an account above first'
                                  }
                                  onClick={() =>
                                    void run(
                                      () => createEntryFromLine(id, l.id, counter),
                                      'Entry posted and matched.',
                                    )
                                  }
                                >
                                  Post entry
                                </button>
                              </>
                            )}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
