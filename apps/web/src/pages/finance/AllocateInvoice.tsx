// The Allocate button of the Accounts Payable / Receivable registers: set a receipt, payment, advance or credit note of the
// same party against one open invoice (POST /finance/open-items/allocate). The Credit / Debit Note pages have their own
// dialog for settling a note against a bill; this one is the other direction, starting from the invoice.
import { useState } from 'react';
import { Field, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { toUiMessage } from '../../lib/errors';
import { allocateNote, settleOptions } from '../../lib/financeApi';
import type { SettleOptions } from '../../lib/financeApi';
import { useLoad } from '../../lib/useLoad';
import { dmy, ErrorBox, inr } from './shared';

export function AllocateInvoiceDialog({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const { data, error } = useLoad<SettleOptions>(() => settleOptions(id), [id]);
  const [creditId, setCreditId] = useState('');
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState('');
  const [pending, setPending] = useState(false);
  const credit = data?.credits.find((c) => c.id === creditId);
  const reverse = Boolean(data?.target.isCredit);
  const room = reverse ? Math.abs(Number(data?.target.outstanding ?? 0)) : Number(data?.target.outstanding ?? 0);
  const pick = (v: string): void => {
    setCreditId(v);
    const c = data?.credits.find((x) => x.id === v);
    if (c) setAmount(String(Math.min(room, Math.abs(Number(c.outstanding)))));
  };
  const save = async (): Promise<void> => {
    if (!data || !credit) return;
    if (!(Number(amount) > 0)) return setErr('Enter an amount greater than 0.');
    setPending(true);
    setErr('');
    try {
      await allocateNote(
        reverse
          ? { sourceItemId: data.target.id, targetItemId: credit.id, amount }
          : { sourceItemId: credit.id, targetItemId: data.target.id, amount },
      );
      onDone(`${inr(amount)} set against ${data.target.docNo}.`);
    } catch (e) {
      setErr(toUiMessage(e));
      setPending(false);
    }
  };
  return (
    <Modal
      title="Allocate"
      sub={data ? (reverse ? `Set ${data.target.docNo} against an open bill of the same party.` : `Settle ${data.target.docNo} with a credit of the same party.`) : ''}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={pending || !credit} title={credit ? undefined : reverse ? 'Choose the bill to settle first.' : 'Choose the credit to settle with first.'} onClick={() => void save()}>
            Allocate
          </button>
        </>
      }
    >
      <ErrorBox message={error || err} />
      {!data && !error ? <p className="muted">Loading…</p> : null}
      {data && room <= 0 ? <p>{reverse ? 'Nothing is left to allocate on this entry.' : 'This invoice has nothing open to settle.'}</p> : null}
      {data && room > 0 ? (
        <>
          <p>
            Open on {data.target.docNo}: <b>{inr(String(room))}</b>
          </p>
          <SelectField label={reverse ? 'Against bill *' : 'Against credit *'} value={creditId} onChange={pick}>
            <option value="">
              {reverse
                ? data.credits.length
                  ? 'Choose a bill…'
                  : 'No open bills for this party'
                : data.credits.length
                  ? 'Choose a receipt, payment or credit note…'
                  : 'No open credits for this party'}
            </option>
            {data.credits.map((c) => (
              <option key={c.id} value={c.id}>
                {c.docNo} · {c.itemType} · {dmy(c.docDate)} · open {inr(String(Math.abs(Number(c.outstanding))))}
              </option>
            ))}
          </SelectField>
          <Field label="Amount *" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </>
      ) : null}
    </Modal>
  );
}
