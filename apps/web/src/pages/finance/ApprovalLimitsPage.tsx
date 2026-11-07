// Finance Approval Limits (admin-settings › finance-limits): the amounts from which a manual journal and a credit
// or debit note must be approved before they reach the books. Owned by the administrator (Super User /
// Administrator): the rights come from `controls` on System Setup. Empty = that document never asks for approval.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Field } from '../../components/Field';
import { useToast } from '../../components/Toast';
import { toUiError, type UiError } from '../../lib/errors';
import { getApprovalLimits, saveApprovalLimits } from '../../lib/financeApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { ErrorBox, inr, PageHead } from './shared';

export function ApprovalLimitsPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(getApprovalLimits, []);
  const [journal, setJournal] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<UiError | null>(null);
  const [pending, setPending] = useState(false);
  const canEdit = actions.controls;

  useEffect(() => {
    if (data) {
      setJournal(data.journalApprovalThreshold ?? '');
      setNote(data.noteApprovalThreshold ?? '');
    }
  }, [data]);

  const check = (v: string): string | null => {
    if (v.trim() === '') return null;
    if (!/^\d+(\.\d{1,2})?$/.test(v.trim()))
      return 'Enter an amount like 500000 or leave it empty.';
    return null;
  };

  const save = async (): Promise<void> => {
    const f: Record<string, string> = {};
    const a = check(journal);
    const b = check(note);
    if (a) f.journalApprovalThreshold = a;
    if (b) f.noteApprovalThreshold = b;
    if (Object.keys(f).length) {
      setErr({ message: '', fields: f, code: 'LOCAL' });
      return;
    }
    setPending(true);
    setErr(null);
    try {
      await saveApprovalLimits({
        journalApprovalThreshold: journal.trim() === '' ? null : journal.trim(),
        noteApprovalThreshold: note.trim() === '' ? null : note.trim(),
      });
      toast('Approval limits saved.');
      reload();
    } catch (caught) {
      setErr(toUiError(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <PageHead
        title="Finance Approval Limits"
        sub="From which amount a journal or a credit / debit note must be approved before it is posted."
      >
        <Link className="btn" to="/m/admin-settings">
          ← System Setup
        </Link>
        {canEdit ? (
          <button
            type="button"
            className="btn primary"
            disabled={pending || loading}
            onClick={() => void save()}
          >
            {pending ? 'Saving…' : 'Save limits'}
          </button>
        ) : null}
      </PageHead>
      <ErrorBox message={error || err?.message || ''} />
      <div className="card" style={{ padding: 16, maxWidth: 560 }}>
        <Field
          label="Manual journals — approval from (₹)"
          inputMode="decimal"
          value={journal}
          disabled={!canEdit}
          onChange={(e) => setJournal(e.target.value)}
          error={err?.fields.journalApprovalThreshold}
          placeholder="Empty = never needs approval"
        />
        <p className="v8-sub">
          {data?.journalApprovalThreshold
            ? `A journal with a total of ${inr(data.journalApprovalThreshold)} or more goes to the approver first.`
            : 'No limit set: journals are posted without approval.'}
        </p>
        <Field
          label="Credit and debit notes — approval from (₹)"
          inputMode="decimal"
          value={note}
          disabled={!canEdit}
          onChange={(e) => setNote(e.target.value)}
          error={err?.fields.noteApprovalThreshold}
          placeholder="Empty = never needs approval"
        />
        <p className="v8-sub">
          {data?.noteApprovalThreshold
            ? `A note of ${inr(data.noteApprovalThreshold)} or more goes to the approver first.`
            : 'No limit set: notes are posted without approval.'}
        </p>
        {!canEdit ? (
          <p className="v8-sub">Only the Super User or an Administrator can change these limits.</p>
        ) : null}
        <p className="v8-sub">
          Who approves comes from the Approval Matrix of the Finance department. The person who
          prepared a document can never approve it.
        </p>
      </div>
    </>
  );
}
