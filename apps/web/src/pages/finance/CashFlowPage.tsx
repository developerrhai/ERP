// Cash Flow (fin-cashflow): where the cash came from and where it went, in three sections. The report proves
// itself: opening cash + net change = closing cash.
import { useState } from 'react';
import { cashFlow } from '../../lib/financeApi';
import { useLoad } from '../../lib/useLoad';
import { Empty, ErrorBox, inr, PageHead, todayIso } from './shared';

const fyStart = (): string => {
  const d = new Date();
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-04-01`;
};

function Section({
  title,
  total,
  items,
  first,
}: {
  title: string;
  total: string;
  items: { code: string; name: string; amount: string }[];
  first?: { label: string; amount: string };
}) {
  return (
    <div className="card table-wrap" style={{ marginBottom: 16 }}>
      <table>
        <caption style={{ textAlign: 'left', padding: 8, fontWeight: 600 }}>{title}</caption>
        <tbody>
          {first ? (
            <tr>
              <td>{first.label}</td>
              <td style={{ textAlign: 'right' }}>{inr(first.amount)}</td>
            </tr>
          ) : null}
          {items.map((i) => (
            <tr key={i.code}>
              <td style={{ paddingLeft: 24 }}>
                {i.code} · {i.name}
              </td>
              <td style={{ textAlign: 'right' }}>{inr(i.amount)}</td>
            </tr>
          ))}
          {items.length === 0 && !first ? <Empty cols={2}>No movement.</Empty> : null}
          <tr>
            <td>
              <strong>Total</strong>
            </td>
            <td style={{ textAlign: 'right' }}>
              <strong>{inr(total)}</strong>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function CashFlowPage() {
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(todayIso());
  const { data, error } = useLoad(() => cashFlow(from, to), [from, to]);
  return (
    <>
      <PageHead title="Cash Flow" sub="Where the cash came from and where it went in the period.">
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
        <>
          <div className="kpis">
            <div className="kpi">
              <small>Cash at start</small>
              <b>{inr(data.openingCash)}</b>
            </div>
            <div className="kpi">
              <small>Net change</small>
              <b>{inr(data.netChange)}</b>
            </div>
            <div className="kpi">
              <small>Cash at end</small>
              <b>{inr(data.closingCash)}</b>
            </div>
          </div>
          {!data.reconciles ? (
            <div className="msg error show static" role="alert">
              The cash flow does not add up to the change in cash. Please tell your administrator.
            </div>
          ) : null}
          <Section
            title="Operating activities"
            total={data.operating.total}
            items={data.operating.items}
            first={{ label: 'Net profit for the period', amount: data.operating.netProfit }}
          />
          <Section
            title="Investing activities"
            total={data.investing.total}
            items={data.investing.items}
          />
          <Section
            title="Financing activities"
            total={data.financing.total}
            items={data.financing.items}
          />
        </>
      ) : null}
    </>
  );
}
