// REQ-02: one bank entry across several open bills. A customer receipt is posted at once against the ticked invoices
// (anything left over stays as an advance); paying a supplier makes one payment proposal for the ticked bills, which is
// approved and then paid from Accounts Payable with a single bank entry.
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { toUiMessage } from '../../lib/errors';
import { post } from '../../lib/scmApi';
import { useLoad } from '../../lib/useLoad';
import { DateField } from '../../ui/components';
import { dmy, ErrorBox, inrExact, todayIso } from './shared';
import './finance-v40.css';

interface Bill {
  id: string;
  number: string;
  vendorInvoiceNo?: string | null;
  customerId?: string;
  customerName?: string;
  supplierId?: string;
  supplierName?: string;
  dueDate?: string | null;
  outstanding: string;
  paymentBlock?: boolean;
}
interface Bank {
  id: string;
  name: string;
  kind?: string;
}

// money is compared in paise, so 0.1 + 0.2 stays 0.30
const paise = (v: string): number => Math.round(Number(v || 0) * 100);
const rupees = (p: number): string => (p / 100).toFixed(2);

export function SettleBillsModal({
  side,
  bankId,
  billId,
  onClose,
  onDone,
}: {
  side: 'CUSTOMER' | 'SUPPLIER';
  /** the cash / bank account chosen before (Bank Book, Cash Book) */
  bankId?: string;
  /** the bill whose "Allocate" button was pressed: its party is chosen and the bill ticked */
  billId?: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const receipt = side === 'CUSTOMER';
  const toast = useToast();
  const open = useLoad(() => api<{ rows: Bill[] }>(receipt ? '/sales/collections/outstanding' : '/fin/ap/payables'), [side]);
  const banks = useLoad(() => (receipt ? api<Bank[]>('/finance/bank-accounts') : Promise.resolve([] as Bank[])), [side]);
  const all = open.data?.rows ?? [];
  const partyOf = (b: Bill): string => (receipt ? b.customerId : b.supplierId) ?? '';
  const [chosenParty, setParty] = useState('');
  const started = all.find((b) => b.id === billId);
  const party = chosenParty || (started ? partyOf(started) : '');
  const parties = [...new Map(all.map((b) => [partyOf(b), (receipt ? b.customerName : b.supplierName) ?? '—'])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
  const bills = all.filter((b) => party !== '' && partyOf(b) === party);
  // bill id -> amount typed against it; a bill is ticked when it is in here
  const [picked, setPicked] = useState<Record<string, string> | null>(null);
  const amounts: Record<string, string> = picked ?? (started ? { [started.id]: started.outstanding } : {});
  const [typed, setTyped] = useState('');
  const [bank, setBank] = useState(bankId ?? '');
  const [mode, setMode] = useState('NEFT');
  const [date, setDate] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const total = bills.reduce((s, b) => s + (amounts[b.id] === undefined ? 0 : paise(amounts[b.id] ?? '0')), 0);
  const received = typed === '' ? total : paise(typed);
  const cashBook = (banks.data ?? []).find((b) => b.id === bank)?.kind;
  const isCash = cashBook !== undefined && cashBook !== 'BANK';
  const effectiveMode = isCash ? 'Cash' : mode;

  const tick = (b: Bill, on: boolean): void => {
    const next = { ...amounts };
    if (!on) delete next[b.id];
    else {
      // what is left of a typed amount, else the whole open amount
      const left = typed === '' ? paise(b.outstanding) : Math.max(0, paise(typed) - total);
      next[b.id] = rupees(Math.min(paise(b.outstanding), left || paise(b.outstanding)));
    }
    setPicked(next);
  };
  /** Fills the bills oldest first with the typed amount. */
  const spread = (): void => {
    let left = paise(typed);
    const next: Record<string, string> = {};
    for (const b of bills) {
      if (left <= 0) break;
      const take = Math.min(left, paise(b.outstanding));
      next[b.id] = rupees(take);
      left -= take;
    }
    setPicked(next);
  };

  const ids = Object.keys(amounts).filter((id) => bills.some((b) => b.id === id));
  const wrong = ids.find((id) => {
    const b = bills.find((x) => x.id === id);
    const a = paise(amounts[id] ?? '0');
    return !b || a <= 0 || a > paise(b.outstanding);
  });
  const reason = !party
    ? `Choose the ${receipt ? 'customer' : 'supplier'} first.`
    : receipt && !bank
      ? 'Choose where the money was received.'
      : wrong
        ? 'On each ticked bill, enter more than 0 and not more than what is open.'
        : receipt && received <= 0
          ? 'Type the amount received.'
          : receipt && total > received
            ? 'The bills add up to more than the amount received.'
            : !receipt && ids.length === 0
              ? 'Tick the bills to pay.'
              : '';

  const save = async (): Promise<void> => {
    setMsg('');
    setBusy(true);
    try {
      if (receipt) {
        await post('/sales/receipts', {
          customerId: party,
          bankAccountId: bank,
          amount: rupees(received),
          mode: effectiveMode,
          receiptDate: date,
          reference: reference.trim() || undefined,
          allocations: ids.map((id) => ({ invoiceId: id, amount: rupees(paise(amounts[id] ?? '0')) })),
        });
        onDone(`Receipt recorded: ${inrExact(rupees(received))} against ${ids.length} invoice${ids.length === 1 ? '' : 's'}.`);
      } else {
        const due = ids.map((id) => bills.find((b) => b.id === id)?.dueDate ?? '').sort();
        const made = await post<{ number?: string }>('/fin/ap/proposals', {
          dueTill: due[due.length - 1] || todayIso(),
          invoiceIds: ids,
          amounts: Object.fromEntries(ids.map((id) => [id, rupees(paise(amounts[id] ?? '0'))])),
        });
        onDone(`Payment proposal ${made.number ?? ''} made for ${inrExact(rupees(total))}. Open "Payment proposals" in Accounts Payable to submit it; after approval it is paid with one bank entry.`);
      }
    } catch (e) {
      const text = toUiMessage(e);
      setMsg(text);
      toast(text);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={receipt ? 'Receive from a customer' : 'Pay a supplier'}
      sub={receipt ? 'One receipt can settle several invoices, fully or in part.' : 'Tick the bills to pay, fully or in part. They go for approval as one payment.'}
      onClose={onClose}
      footer={
        <>
          <span className="muted settle-total" role="status">
            {`On bills ${inrExact(rupees(total))}`}
            {receipt && received > total ? ` · ${inrExact(rupees(received - total))} stays as an advance` : ''}
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy || reason !== ''} title={reason || undefined} onClick={() => void save()}>
            {receipt ? 'Record receipt' : 'Create payment proposal'}
          </button>
        </>
      }
    >
      <ErrorBox message={msg || open.error || banks.error} />
      <div className="form-grid">
        <div className="field">
          <label htmlFor="sb-party">{receipt ? 'Customer *' : 'Supplier *'}</label>
          <select
            id="sb-party"
            value={party}
            onChange={(e) => {
              setParty(e.target.value);
              setPicked({});
            }}
          >
            <option value="">{all.length || open.loading ? 'Choose…' : `Nothing is waiting to be ${receipt ? 'collected' : 'paid'}`}</option>
            {parties.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        {receipt ? (
          <>
            <div className="field">
              <label htmlFor="sb-bank">Received in *</label>
              <select id="sb-bank" value={bank} onChange={(e) => setBank(e.target.value)}>
                <option value="">Choose…</option>
                {(banks.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sb-mode">Mode *</label>
              <select id="sb-mode" value={effectiveMode} disabled={isCash} onChange={(e) => setMode(e.target.value)}>
                {(isCash ? ['Cash'] : ['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque']).map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sb-amount">Amount received *</label>
              <input id="sb-amount" type="number" min={0} step="0.01" value={typed} placeholder={rupees(total)} onChange={(e) => setTyped(e.target.value)} />
              <button type="button" className="btn sm" disabled={!party || paise(typed) <= 0} title={!party || paise(typed) <= 0 ? 'Choose the customer and type the amount first.' : undefined} onClick={spread}>
                Spread over oldest invoices
              </button>
            </div>
            <div className="field">
              <label htmlFor="sb-date">Date *</label>
              <DateField id="sb-date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="sb-ref">UTR / cheque no.</label>
              <input id="sb-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          </>
        ) : null}
      </div>
      <div className="table-wrap">
        <table aria-label="Open bills">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Tick every bill"
                  disabled={bills.length === 0}
                  checked={bills.length > 0 && ids.length === bills.length}
                  onChange={(e) => setPicked(e.target.checked ? Object.fromEntries(bills.filter((b) => !b.paymentBlock).map((b) => [b.id, b.outstanding])) : {})}
                />
              </th>
              <th>{receipt ? 'Invoice' : 'Supplier invoice'}</th>
              <th>Due</th>
              <th className="num">Open</th>
              <th>Amount to settle</th>
            </tr>
          </thead>
          <tbody>
            {bills.map((b) => {
              const name = receipt ? b.number : (b.vendorInvoiceNo ?? b.number);
              const on = amounts[b.id] !== undefined;
              return (
                <tr key={b.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Settle ${name}`}
                      checked={on}
                      disabled={b.paymentBlock === true}
                      title={b.paymentBlock ? 'Held back from payment.' : undefined}
                      onChange={(e) => tick(b, e.target.checked)}
                    />
                  </td>
                  <td>
                    {name}
                    {b.paymentBlock ? <small className="muted"> · held back</small> : null}
                  </td>
                  <td>{b.dueDate ? dmy(b.dueDate) : '—'}</td>
                  <td className="num">{inrExact(b.outstanding)}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      aria-label={`Amount for ${name}`}
                      disabled={!on}
                      value={on ? amounts[b.id] : ''}
                      onChange={(e) => setPicked({ ...amounts, [b.id]: e.target.value })}
                    />
                  </td>
                </tr>
              );
            })}
            {bills.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={5}>{party ? 'No open bill for this party.' : `Choose the ${receipt ? 'customer' : 'supplier'} to see the open bills.`}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
