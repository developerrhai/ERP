// Financial reports: Trial Balance (fin-trial), Profit & Loss (fin-pnl), Balance Sheet (fin-bs), General Ledger
// (fin-gl) and AR / AP ageing (fin-ar, fin-ap, fin-ageing). They only read; every figure comes from the ledger.
import { Fragment, useState } from 'react';
import { SelectField } from '../../components/Field';
import {
  ageing,
  balanceSheet,
  generalLedger,
  listAccounts,
  profitAndLoss,
  trialBalance,
  type Group,
} from '../../lib/financeApi';
import { useLoad } from '../../lib/useLoad';
import { amt, dmy, Empty, ErrorBox, inr, PageHead, todayIso } from './shared';
import { DateField } from '../../ui/components';

const fyStart = (): string => {
  const d = new Date();
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-04-01`;
};

export function TrialBalancePage() {
  const [asOf, setAsOf] = useState(todayIso());
  const { data, loading, error } = useLoad(() => trialBalance(asOf), [asOf]);
  return (
    <>
      <PageHead
        title="Trial Balance"
        sub="Every account's balance. Total debit must equal total credit."
      >
        <DateField
          aria-label="As on"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
        />
      </PageHead>
      <ErrorBox message={error} />
      {data ? (
        <div className={data.balanced ? 'notice' : 'msg error show static'} role="status">
          {data.balanced
            ? `Balanced: ${inr(data.totalDebit)} on both sides.`
            : 'The trial balance does not balance. Please tell your administrator.'}
        </div>
      ) : null}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Account</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Debit
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Credit
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Balance Dr
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Balance Cr
              </th>
            </tr>
          </thead>
          <tbody>
            {(data?.lines ?? []).map((l) => (
              <tr key={l.code}>
                <td>{l.code}</td>
                <td>{l.name}</td>
                <td style={{ textAlign: 'right' }}>{amt(l.debit)}</td>
                <td style={{ textAlign: 'right' }}>{amt(l.credit)}</td>
                <td style={{ textAlign: 'right' }}>{amt(l.closingDebit)}</td>
                <td style={{ textAlign: 'right' }}>{amt(l.closingCredit)}</td>
              </tr>
            ))}
            {loading && !data ? <Empty cols={6}>Loading…</Empty> : null}
            {data && data.lines.length === 0 ? (
              <Empty cols={6}>No postings yet. Post a journal to see the trial balance.</Empty>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Groups({ title, groups }: { title: string; groups: Group[] }) {
  return (
    <div className="card table-wrap" style={{ marginBottom: 16 }}>
      <table>
        <caption style={{ textAlign: 'left', padding: 8, fontWeight: 600 }}>{title}</caption>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.code}>
              <tr>
                <td>
                  <strong>{g.name}</strong>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <strong>{inr(g.total)}</strong>
                </td>
              </tr>
              {g.accounts.map((a) => (
                <tr key={`${g.code}-${a.code}`}>
                  <td style={{ paddingLeft: 28 }}>
                    {a.code} · {a.name}
                  </td>
                  <td style={{ textAlign: 'right' }}>{inr(a.amount)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
          {groups.length === 0 ? <Empty cols={2}>Nothing to show.</Empty> : null}
        </tbody>
      </table>
    </div>
  );
}

export function ProfitLossPage() {
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(todayIso());
  const { data, error } = useLoad(() => profitAndLoss(from, to), [from, to]);
  const s = data?.summary;
  return (
    <>
      <PageHead title="Profit & Loss" sub="What you earned and spent in the period.">
        <DateField
          aria-label="From"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <DateField aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
      </PageHead>
      <ErrorBox message={error} />
      {s ? (
        <div className="kpis">
          <div className="kpi">
            <small>Revenue</small>
            <b>{inr(s.revenue)}</b>
          </div>
          <div className="kpi">
            <small>Gross profit</small>
            <b>{inr(s.grossProfit)}</b>
          </div>
          <div className="kpi">
            <small>Operating profit</small>
            <b>{inr(s.operatingProfit)}</b>
          </div>
          <div className="kpi">
            <small>Net profit</small>
            <b>{inr(s.netProfit)}</b>
          </div>
        </div>
      ) : null}
      {data ? <Groups title="By group" groups={data.sections} /> : null}
      {data && data.sections.length === 0 ? (
        <p className="v8-sub">No income or expense postings in this period.</p>
      ) : null}
    </>
  );
}

export function BalanceSheetPage() {
  const [asOf, setAsOf] = useState(todayIso());
  const { data, error } = useLoad(() => balanceSheet(asOf), [asOf]);
  return (
    <>
      <PageHead
        title="Balance Sheet"
        sub="What you own, what you owe, and what is left for the owners."
      >
        <DateField
          aria-label="As on"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
        />
      </PageHead>
      <ErrorBox message={error} />
      {data ? (
        <>
          <div className="kpis">
            <div className="kpi">
              <small>Total assets</small>
              <b>{inr(data.totals.assets)}</b>
            </div>
            <div className="kpi">
              <small>Liabilities</small>
              <b>{inr(data.totals.liabilities)}</b>
            </div>
            <div className="kpi">
              <small>Owners' equity</small>
              <b>{inr(data.totals.equity)}</b>
            </div>
            <div className="kpi">
              <small>Year's profit so far</small>
              <b>{inr(data.currentYearProfit)}</b>
            </div>
          </div>
          {!data.balanced ? (
            <div className="msg error show static" role="alert">
              The balance sheet does not balance. Please tell your administrator.
            </div>
          ) : null}
          <Groups title="Assets" groups={data.assets} />
          <Groups title="Liabilities" groups={data.liabilities} />
          <Groups title="Equity" groups={data.equity} />
        </>
      ) : null}
    </>
  );
}

export function GeneralLedgerPage() {
  const accounts = useLoad(() => listAccounts({ postable: true, size: 200 }), []);
  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(todayIso());
  const { data, error } = useLoad(
    () => (accountId ? generalLedger(accountId, from, to) : Promise.resolve(null)),
    [accountId, from, to],
  );
  return (
    <>
      <PageHead
        title="General Ledger"
        sub="Every entry of one account, with the balance after each."
      >
        <DateField
          aria-label="From"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <DateField aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
      </PageHead>
      <ErrorBox message={error} />
      <SelectField label="Account" value={accountId} onChange={setAccountId}>
        <option value="">Choose an account…</option>
        {(accounts.data?.rows ?? []).map((a) => (
          <option key={a.id} value={a.id}>
            {a.code} · {a.name}
          </option>
        ))}
      </SelectField>
      {data ? (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Voucher</th>
                <th scope="col">Details</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Debit
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Credit
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Balance
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={5}>Opening balance</td>
                <td style={{ textAlign: 'right' }}>{inr(data.opening)}</td>
              </tr>
              {data.lines.map((l) => (
                <tr key={l.id}>
                  <td>{dmy(l.date)}</td>
                  <td>{l.voucherNo}</td>
                  <td>{l.narration ?? l.voucherType}</td>
                  <td style={{ textAlign: 'right' }}>{amt(l.debit)}</td>
                  <td style={{ textAlign: 'right' }}>{amt(l.credit)}</td>
                  <td style={{ textAlign: 'right' }}>{inr(l.balance)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={5}>
                  <strong>Closing balance</strong>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <strong>{inr(data.closing)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="v8-sub">Choose an account to see its ledger.</p>
      )}
    </>
  );
}

export function AgeingPage({ side }: { side: 'RECEIVABLE' | 'PAYABLE' }) {
  const [asOf, setAsOf] = useState(todayIso());
  const { data, loading, error } = useLoad(() => ageing(side, asOf), [side, asOf]);
  const who = side === 'RECEIVABLE' ? 'Customer' : 'Supplier';
  return (
    <>
      <PageHead
        title={side === 'RECEIVABLE' ? 'Accounts Receivable' : 'Accounts Payable'}
        sub={`What each ${who.toLowerCase()} ${side === 'RECEIVABLE' ? 'owes you' : 'is owed'}, by how late it is.`}
      >
        <DateField
          aria-label="As on"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
        />
      </PageHead>
      <ErrorBox message={error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{who}</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Not due
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                1–30 days
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                31–60
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                61–90
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Over 90
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {(data?.parties ?? []).map((p) => (
              <tr key={p.partyId}>
                <td>{p.name}</td>
                <td style={{ textAlign: 'right' }}>{amt(p.notDue)}</td>
                <td style={{ textAlign: 'right' }}>{amt(p.d1_30)}</td>
                <td style={{ textAlign: 'right' }}>{amt(p.d31_60)}</td>
                <td style={{ textAlign: 'right' }}>{amt(p.d61_90)}</td>
                <td style={{ textAlign: 'right' }}>{amt(p.d90plus)}</td>
                <td style={{ textAlign: 'right' }}>
                  <strong>{inr(p.total)}</strong>
                </td>
              </tr>
            ))}
            {data ? (
              <tr>
                <td>
                  <strong>Total</strong>
                </td>
                <td style={{ textAlign: 'right' }}>{amt(data.total.notDue)}</td>
                <td style={{ textAlign: 'right' }}>{amt(data.total.d1_30)}</td>
                <td style={{ textAlign: 'right' }}>{amt(data.total.d31_60)}</td>
                <td style={{ textAlign: 'right' }}>{amt(data.total.d61_90)}</td>
                <td style={{ textAlign: 'right' }}>{amt(data.total.d90plus)}</td>
                <td style={{ textAlign: 'right' }}>
                  <strong>{inr(data.total.total)}</strong>
                </td>
              </tr>
            ) : null}
            {loading && !data ? <Empty cols={7}>Loading…</Empty> : null}
            {data && data.parties.length === 0 ? (
              <Empty cols={7}>Nothing is outstanding.</Empty>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
