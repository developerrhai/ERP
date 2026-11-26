// REQ-01: one party that is both our customer and our supplier. The window lists such parties with what is to be
// received and what is to be paid, sets one off against the other with a single entry, and can cancel that entry.
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { toUiMessage } from '../../lib/errors';
import { listCustomers, listSuppliers } from '../../lib/mastersApi';
import { post } from '../../lib/scmApi';
import { useLoad } from '../../lib/useLoad';
import { usePagePermissions } from '../../lib/usePagePermissions';
import type { ActionSet } from '../../types';
import { DateField } from '../../ui/components';
import { dmy, ErrorBox, inrExact, todayIso } from './shared';
import './finance-v40.css';

interface Party {
  unitId: string;
  unit: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  matchedBy: string;
  receivable: string;
  payable: string;
  adjustable: string;
  net: string;
}
interface Done {
  id: string;
  number: string;
  date: string;
  customerName: string;
  supplierName: string;
  amount: string;
  status: string;
}

const netText = (net: string): string => {
  const n = Number(net);
  if (n > 0) return `${inrExact(String(n))} to receive`;
  if (n < 0) return `${inrExact(String(-n))} to pay`;
  return 'Nothing either way';
};
const keyOf = (p: Party): string => `${p.unitId}|${p.customerId}|${p.supplierId}`;

export function NettingButton() {
  const [open, setOpen] = useState(false);
  const { actions } = usePagePermissions('fin-journal');
  if (!actions.view) return null;
  return (
    <>
      <button type="button" className="btn" title="For a party that is both a customer and a supplier" onClick={() => setOpen(true)}>
        ⇄ Set off customer / supplier
      </button>
      {open ? <NettingModal may={actions} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function NettingModal({ may, onClose }: { may: ActionSet; onClose: () => void }) {
  const toast = useToast();
  const data = useLoad(() => api<{ parties: Party[]; history: Done[] }>('/finance/netting'), []);
  const customers = useLoad(() => listCustomers({ size: 100 }).catch(() => null), []);
  const suppliers = useLoad(() => listSuppliers({ size: 100 }).catch(() => null), []);
  const [chosen, setChosen] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [narration, setNarration] = useState('');
  const [cancelling, setCancelling] = useState<Done | null>(null);
  const [reason, setReason] = useState('');
  const [linkC, setLinkC] = useState('');
  const [linkS, setLinkS] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const parties = data.data?.parties ?? [];
  const history = data.data?.history ?? [];
  const party = parties.find((p) => keyOf(p) === chosen);

  const run = (work: Promise<unknown>, done: string, after: () => void): void => {
    setMsg('');
    setBusy(true);
    work
      .then(() => {
        toast(done);
        after();
        data.reload();
      })
      .catch((e: unknown) => setMsg(toUiMessage(e)))
      .finally(() => setBusy(false));
  };
  const amountReason = !may.post
    ? 'You do not have the right to post journal entries.'
    : !party
    ? ''
    : !(Number(amount) > 0)
      ? 'Enter the amount to set off.'
      : Number(amount) > Number(party.adjustable)
        ? `At most ${inrExact(party.adjustable)} can be set off.`
        : '';

  return (
    <Modal
      title="Set off customer and supplier balances"
      sub="When the same party buys from us and sells to us, one entry reduces both: what it owes us and what we owe it. Amounts are open bills; advances and credit or debit notes not yet adjusted are not counted."
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <ErrorBox message={msg || data.error} />
      <div className="table-wrap">
        <table aria-label="Parties that are customer and supplier">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Supplier</th>
              <th>Plant</th>
              <th className="num">To receive</th>
              <th className="num">To pay</th>
              <th>Net result</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {parties.map((p) => (
              <tr key={keyOf(p)} className={chosen === keyOf(p) ? 'selected' : undefined}>
                <td>
                  {p.customerCode} · {p.customerName}
                </td>
                <td>
                  {p.supplierCode} · {p.supplierName}
                  <small className="muted"> ({p.matchedBy})</small>
                </td>
                <td>{p.unit}</td>
                <td className="num">{inrExact(p.receivable)}</td>
                <td className="num">{inrExact(p.payable)}</td>
                <td>{netText(p.net)}</td>
                <td>
                  <button
                    type="button"
                    className="btn sm primary"
                    aria-label={`Set off ${p.customerName} in ${p.unit}`}
                    disabled={Number(p.adjustable) <= 0}
                    title={Number(p.adjustable) <= 0 ? 'One side has no open bill, so there is nothing to set off.' : undefined}
                    onClick={() => {
                      setChosen(keyOf(p));
                      setAmount(p.adjustable);
                      setMsg('');
                    }}
                  >
                    Set off
                  </button>
                </td>
              </tr>
            ))}
            {parties.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={7}>{data.loading ? 'Loading…' : 'No party with open bills is both a customer and a supplier. Give both the same GSTIN / PAN, or link them below.'}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {party ? (
        <section className="settle-box" aria-label="New set-off">
          <h3>
            Set off {party.customerName} · up to {inrExact(party.adjustable)}
          </h3>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="nt-amount">Amount to set off *</label>
              <input id="nt-amount" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="nt-date">Date *</label>
              <DateField id="nt-date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="nt-note">Narration</label>
              <input id="nt-note" value={narration} maxLength={300} onChange={(e) => setNarration(e.target.value)} />
            </div>
          </div>
          <p className="muted">
            After this entry: {inrExact(String(Math.max(0, Number(party.receivable) - Number(amount || 0))))} to receive,{' '}
            {inrExact(String(Math.max(0, Number(party.payable) - Number(amount || 0))))} to pay. The oldest bills are settled first.
          </p>
          <div className="actions">
            <button
              type="button"
              className="btn primary"
              disabled={busy || amountReason !== ''}
              title={amountReason || undefined}
              onClick={() =>
                run(
                  post('/finance/netting', {
                    unitId: party.unitId,
                    customerId: party.customerId,
                    supplierId: party.supplierId,
                    amount,
                    date,
                    ...(narration.trim() ? { narration: narration.trim() } : {}),
                  }),
                  `${inrExact(amount)} set off for ${party.customerName}.`,
                  () => {
                    setChosen('');
                    setNarration('');
                  },
                )
              }
            >
              Post set-off
            </button>
            <button type="button" className="btn" onClick={() => setChosen('')}>
              Not now
            </button>
          </div>
        </section>
      ) : null}

      {!customers.loading && !suppliers.loading && (!customers.data || !suppliers.data) ? (
        <p className="muted">To link a customer and a supplier by hand you need access to both lists. Ask an administrator.</p>
      ) : (
        <section className="settle-box" aria-label="Link a customer and a supplier">
          <h3>Link a customer and a supplier</h3>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="nt-cust">Customer</label>
              <select id="nt-cust" value={linkC} onChange={(e) => setLinkC(e.target.value)}>
                <option value="">Choose…</option>
                {(customers.data?.rows ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="nt-supp">Supplier</label>
              <select id="nt-supp" value={linkS} onChange={(e) => setLinkS(e.target.value)}>
                <option value="">Choose…</option>
                {(suppliers.data?.rows ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.code} · {x.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <span className="field-label">&nbsp;</span>
              <button
                type="button"
                className="btn"
                disabled={busy || !may.edit || !linkC || !linkS}
                title={!may.edit ? 'You do not have the right to change this link.' : !linkC || !linkS ? 'Choose the customer and the supplier.' : undefined}
                onClick={() =>
                  run(api('/finance/netting/link', { method: 'PUT', body: { customerId: linkC, supplierId: linkS } }), 'Linked as the same party.', () => {
                    setLinkC('');
                    setLinkS('');
                  })
                }
              >
                Link as same party
              </button>
            </div>
          </div>
        </section>
      )}

      {history.length ? (
        <section className="settle-box" aria-label="Set-offs made">
          <h3>Set-offs made</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Entry</th>
                  <th>Date</th>
                  <th>Party</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{h.number}</td>
                    <td>{dmy(h.date)}</td>
                    <td>{h.customerName}</td>
                    <td className="num">{inrExact(h.amount)}</td>
                    <td>{h.status}</td>
                    <td>
                      {h.status === 'Posted' && may.cancel ? (
                        <button type="button" className="btn sm" onClick={() => { setCancelling(h); setReason(''); }}>
                          Cancel set-off
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cancelling ? (
            <div className="form-grid">
              <div className="field">
                <label htmlFor="nt-why">Why is {cancelling.number} cancelled? *</label>
                <input id="nt-why" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
              </div>
              <div className="field">
                <span className="field-label">&nbsp;</span>
                <button
                  type="button"
                  className="btn danger"
                  disabled={busy || reason.trim().length < 5}
                  title={reason.trim().length < 5 ? 'Type a reason of at least 5 letters.' : undefined}
                  onClick={() =>
                    run(post(`/finance/netting/${cancelling.id}/cancel`, { reason: reason.trim() }), `${cancelling.number} cancelled.`, () => setCancelling(null))
                  }
                >
                  Confirm cancel
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </Modal>
  );
}
