// Tax registers: Sales Register (tax-salesreg), Purchase Register (tax-purchasereg), TDS (tax-tds) and TCS
// (tax-tcs). They list what the sales and purchase documents sent; nothing is computed or filed here, and no
// government portal is called. Record a challan when the deducted tax is deposited.
import { useState } from 'react';
import { Field, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { useAppContext } from '../../lib/context';
import { toUiError } from '../../lib/errors';
import {
  depositChallan,
  listBankAccounts,
  taxChallans,
  taxRegister,
  tdsRegister,
} from '../../lib/financeApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { amt, dmy, Empty, ErrorBox, inr, PageHead, Pill, todayIso } from './shared';

const fyStart = (): string => {
  const d = new Date();
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-04-01`;
};

export function TaxRegisterPage({ kind }: { kind: 'sales' | 'purchase' }) {
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(todayIso());
  const { data, loading, error } = useLoad(() => taxRegister(kind, from, to), [kind, from, to]);
  const sales = kind === 'sales';
  return (
    <>
      <PageHead
        title={sales ? 'Sales Register' : 'Purchase Register'}
        sub={
          sales
            ? 'Every tax invoice and note raised, with the GST on it.'
            : 'Every supplier bill and note booked, with the input tax on it.'
        }
      >
        <input
          type="date"
          aria-label="From"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
      </PageHead>
      <ErrorBox message={error} />
      {data ? (
        <div className="kpis">
          <div className="kpi">
            <small>Taxable value</small>
            <b>{inr(data.totals.taxable)}</b>
          </div>
          <div className="kpi">
            <small>CGST</small>
            <b>{inr(data.totals.cgst)}</b>
          </div>
          <div className="kpi">
            <small>SGST</small>
            <b>{inr(data.totals.sgst)}</b>
          </div>
          <div className="kpi">
            <small>IGST</small>
            <b>{inr(data.totals.igst)}</b>
          </div>
        </div>
      ) : null}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Document</th>
              <th scope="col">Date</th>
              <th scope="col">{sales ? 'Customer' : 'Supplier'}</th>
              <th scope="col">GSTIN</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Taxable
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                CGST
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                SGST
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                IGST
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.docNo}</strong> <span className="v8-sub">{r.docKind}</span>
                </td>
                <td>{dmy(r.docDate)}</td>
                <td>{r.partyName}</td>
                <td>{r.partyGstin ?? 'Unregistered'}</td>
                <td style={{ textAlign: 'right' }}>{amt(r.taxable)}</td>
                <td style={{ textAlign: 'right' }}>{amt(r.cgst)}</td>
                <td style={{ textAlign: 'right' }}>{amt(r.sgst)}</td>
                <td style={{ textAlign: 'right' }}>{amt(r.igst)}</td>
                <td>
                  <Pill>{r.status}</Pill>
                </td>
              </tr>
            ))}
            {loading && !data ? <Empty cols={9}>Loading…</Empty> : null}
            {data && data.rows.length === 0 ? (
              <Empty cols={9}>No documents in this period yet.</Empty>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="v8-sub">
        GST returns and e-invoice files are prepared in the Indian Taxation module; this register
        only shows what the books hold.
      </p>
    </>
  );
}

export function TdsPage({ kind, actions }: { kind: 'tds' | 'tcs'; actions: ActionSet }) {
  const toast = useToast();
  const label = kind.toUpperCase();
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(todayIso());
  const reg = useLoad(() => tdsRegister(kind, from, to), [kind, from, to]);
  const challans = useLoad(taxChallans, []);
  const [picked, setPicked] = useState<string[]>([]);
  const [depositing, setDepositing] = useState(false);
  const open = (reg.data?.rows ?? []).filter((r) => r.status === 'Active' && !r.challanNo);
  const sel = open.filter((r) => picked.includes(r.id));
  const total = sel.reduce((s, r) => s + Number(r.tdsAmount), 0);
  return (
    <>
      <PageHead
        title={label}
        sub={`Tax ${kind === 'tds' ? 'deducted from supplier payments' : 'collected'} and whether it has been deposited.`}
      >
        <input
          type="date"
          aria-label="From"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
        {actions.add ? (
          <button
            type="button"
            className="btn primary"
            disabled={sel.length === 0}
            title={sel.length ? '' : 'Tick the entries you are depositing'}
            onClick={() => setDepositing(true)}
          >
            Record challan{sel.length ? ` (${inr(total)})` : ''}
          </button>
        ) : null}
      </PageHead>
      <ErrorBox message={reg.error} />
      {reg.data ? (
        <div className="kpis">
          <div className="kpi">
            <small>Deducted</small>
            <b>{inr(reg.data.totalDeducted)}</b>
          </div>
          <div className="kpi">
            <small>Not yet deposited</small>
            <b>{inr(reg.data.pendingDeposit)}</b>
          </div>
        </div>
      ) : null}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col" aria-label="Select" />
              <th scope="col">Date</th>
              <th scope="col">Supplier</th>
              <th scope="col">Section</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                On amount
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Rate %
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Tax
              </th>
              <th scope="col">Challan</th>
            </tr>
          </thead>
          <tbody>
            {(reg.data?.rows ?? []).map((r) => (
              <tr key={r.id}>
                <td>
                  {r.status === 'Active' && !r.challanNo ? (
                    <input
                      type="checkbox"
                      aria-label={`Select entry of ${r.supplier ?? 'supplier'} ${r.docNo ?? ''}`}
                      checked={picked.includes(r.id)}
                      onChange={(e) =>
                        setPicked((p) =>
                          e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id),
                        )
                      }
                    />
                  ) : null}
                </td>
                <td>{dmy(r.deductedOn)}</td>
                <td>{r.supplier ?? '—'}</td>
                <td>{r.sectionCode}</td>
                <td style={{ textAlign: 'right' }}>{amt(r.baseAmount)}</td>
                <td style={{ textAlign: 'right' }}>{r.ratePct}</td>
                <td style={{ textAlign: 'right' }}>{inr(r.tdsAmount)}</td>
                <td>
                  {r.status === 'Cancelled' ? (
                    <Pill>Cancelled</Pill>
                  ) : (
                    (r.challanNo ?? 'Not deposited')
                  )}
                </td>
              </tr>
            ))}
            {reg.loading && !reg.data ? <Empty cols={8}>Loading…</Empty> : null}
            {reg.data && reg.data.rows.length === 0 ? (
              <Empty cols={8}>Nothing in this period.</Empty>
            ) : null}
          </tbody>
        </table>
      </div>
      {(challans.data ?? []).length > 0 ? (
        <>
          <h2 style={{ marginTop: 24 }}>Challans</h2>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Challan no.</th>
                  <th scope="col">Type</th>
                  <th scope="col">Paid on</th>
                  <th scope="col">BSR</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Amount
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Entries
                  </th>
                </tr>
              </thead>
              <tbody>
                {(challans.data ?? []).map((c) => (
                  <tr key={c.id}>
                    <td>{c.challanNo}</td>
                    <td>{c.taxKind}</td>
                    <td>{dmy(c.paidOn)}</td>
                    <td>{c.bsrCode ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{inr(c.amount)}</td>
                    <td style={{ textAlign: 'right' }}>{c.entries}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      {depositing ? (
        <ChallanForm
          kind={label as 'TDS' | 'TCS'}
          entryIds={sel.map((r) => r.id)}
          total={total}
          onClose={() => setDepositing(false)}
          onDone={() => {
            setDepositing(false);
            setPicked([]);
            reg.reload();
            challans.reload();
            toast('Challan recorded and posted.');
          }}
        />
      ) : null}
    </>
  );
}

function ChallanForm({
  kind,
  entryIds,
  total,
  onClose,
  onDone,
}: {
  kind: 'TDS' | 'TCS';
  entryIds: string[];
  total: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const ctx = useAppContext().data;
  const banks = useLoad(listBankAccounts, []);
  const [bankAccountId, setBank] = useState('');
  const [paidOn, setPaidOn] = useState(todayIso());
  const [challanNo, setNo] = useState('');
  const [bsrCode, setBsr] = useState('');
  const [err, setErr] = useState('');
  return (
    <Modal
      title="Record challan"
      sub={`${inr(total)} is paid to the government from your bank and taken off ${kind} payable.`}
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
                if (!bankAccountId || challanNo.trim().length < 3 || !ctx?.current.unitId) {
                  setErr('Choose the bank account and enter the challan number.');
                  return;
                }
                try {
                  await depositChallan({
                    unitId: ctx.current.unitId,
                    taxKind: kind,
                    bankAccountId,
                    paidOn,
                    challanNo: challanNo.trim(),
                    ...(bsrCode.trim() ? { bsrCode: bsrCode.trim() } : {}),
                    entryIds,
                  });
                  onDone();
                } catch (e) {
                  setErr(toUiError(e).message);
                }
              })()
            }
          >
            Post challan
          </button>
        </>
      }
    >
      <ErrorBox message={err} />
      <SelectField label="Paid from *" value={bankAccountId} onChange={setBank}>
        <option value="">Choose…</option>
        {(banks.data ?? [])
          .filter((b) => b.kind === 'BANK')
          .map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
      </SelectField>
      <Field label="Challan number *" value={challanNo} onChange={(e) => setNo(e.target.value)} />
      <div className="grid2">
        <Field
          label="Paid on *"
          type="date"
          value={paidOn}
          onChange={(e) => setPaidOn(e.target.value)}
        />
        <Field label="BSR code" value={bsrCode} onChange={(e) => setBsr(e.target.value)} />
      </div>
    </Modal>
  );
}
