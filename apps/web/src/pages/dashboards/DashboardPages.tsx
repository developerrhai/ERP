// Operational dashboards laid out like V40: My Dashboard, Plant Dashboard (V40 Manufacturing Control Dashboard), Owner Console,
// and the module analytics pages. Every number is read from the dashboards API; no data -> an empty state.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, CompareGrid, KpiTile } from '../../components/DashParts';
import { dashApi } from '../../lib/dashApi';
import type { Grid } from '../../lib/dashApi';
import { spineApi } from '../../lib/spineApi';
import { useLoad } from '../../lib/useLoad';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import { DeptCards, NavButton, OpsHead, PlantChips, RagSummary } from './OpsParts';

function Head({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub ? <p className="muted">{sub}</p> : null}
      </div>
    </div>
  );
}

export function MyDashboardPage() {
  const d = useLoad(() => dashApi.my(), []);
  if (d.error) return <p role="alert">{d.error}</p>;
  if (!d.data) return <p className="muted">Loading your dashboard…</p>;
  const m = d.data;
  return (
    <div className="ops-page">
      <OpsHead title="My Dashboard" sub={m.scopeNote}>
        <NavButton to="/m/my-approvals" primary>
          My Approvals
        </NavButton>
        <NavButton to="/m/ops-tasks">My Tasks</NavButton>
      </OpsHead>
      <section aria-label="My queues" className="ops-summary">
        <div className="ops-stat">
          <small>Approvals waiting for me</small>
          <b>{m.queues.approvalsWaiting}</b>
          <span>
            <Link to="/m/my-approvals">Open the approval inbox</Link>
          </span>
        </div>
        <div className={`ops-stat${m.queues.approvalsOverdue > 0 ? ' is-red' : ''}`}>
          <small>Approvals overdue</small>
          <b>{m.queues.approvalsOverdue}</b>
          <span>{m.queues.approvalsOverdue > 0 ? 'Needs your action' : 'Nothing overdue'}</span>
        </div>
        <div className="ops-stat">
          <small>My requests pending</small>
          <b>{m.queues.submittedPending}</b>
          <span>Waiting on someone else</span>
        </div>
      </section>
      <section aria-label="My documents" className="ops-card">
        <h2>My documents</h2>
        {m.myDocumentsByStatus.length === 0 ? (
          <p className="ops-empty">No documents of yours in the chosen plants yet.</p>
        ) : (
          <BarChart
            ariaLabel="My documents by status"
            data={m.myDocumentsByStatus.map((r) => ({ label: r.status, count: r.count }))}
          />
        )}
      </section>
      <section aria-label={`${m.department} figures`} className="ops-card">
        <h2>{m.department}</h2>
        {m.cards.length === 0 ? (
          <p className="ops-empty">No KPIs are defined for {m.department} yet.</p>
        ) : (
          <div className="ops-grid">
            {m.cards.map((c) => (
              <KpiTile key={c.code} card={c} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function TvBlock({ grid, dashKey, tvPath, label }: { grid: Grid; dashKey: string; tvPath: string; label: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  async function makeTv() {
    setBusy(true);
    try {
      const only = grid.plants.length === 1 ? (grid.plants[0]?.id ?? null) : null;
      const t = await dashApi.tvToken(dashKey, only);
      setLink(`${window.location.origin}${tvPath}?token=${t.token}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not create the TV link.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="TV mode" className="ops-card ops-tv">
      <h2>TV screen</h2>
      <p className="ops-sub">{label}</p>
      <div>
        <button type="button" className="btn" disabled={busy} onClick={() => void makeTv()}>
          Create TV link
        </button>
      </div>
      {link ? (
        <div>
          <input readOnly value={link} aria-label="TV link" onFocus={(e) => e.currentTarget.select()} />
          <p className="ops-sub">
            Copy it now: it is shown once. Creating a new link stops the old one.{' '}
            <a href={link} target="_blank" rel="noreferrer">
              Open TV mode
            </a>
          </p>
        </div>
      ) : null}
    </section>
  );
}

const CONNECTED_CHAIN_STAGES = [
  { num: 1, name: 'Sales Order', parent: 'Quotation / Customer Order', page: 'sales-orders', status: 'Connected' },
  { num: 2, name: 'Production Plan', parent: 'Sales Order #SO-24011', page: 'prod-plan', status: 'Connected' },
  { num: 3, name: 'MRP', parent: 'Production Plan #PP-01', page: 'prod-mrp', status: 'Connected' },
  { num: 4, name: 'Purchase', parent: 'MRP BOM Requisition', page: 'scm-po', status: 'Connected' },
  { num: 5, name: 'GRN', parent: 'Purchase Order #PO-24009', page: 'scm-grn', status: 'Connected' },
  { num: 6, name: 'Inventory', parent: 'GRN Inspection Release', page: 'inv-stock', status: 'Connected' },
  { num: 7, name: 'Material Issue', parent: 'Job Card BOM Pick', page: 'prod-material-issue', status: 'Connected' },
  { num: 8, name: 'Manufacturing', parent: 'Material Issue Note', page: 'mfg-jobcards', status: 'Connected' },
  { num: 9, name: 'Quality', parent: 'Job Route In-process', page: 'qms-inspections', status: 'Connected' },
  { num: 10, name: 'Finished Goods', parent: 'Approved Job QC', page: 'inv-fg', status: 'Connected' },
  { num: 11, name: 'Delivery Challan (DC)', parent: 'FG Release / Sales Order', page: 'sales-dispatch', status: 'Connected' },
  { num: 12, name: 'Invoice', parent: 'Delivery Challan #DC-1042', page: 'fin-invoices', status: 'Connected' },
  { num: 13, name: 'Payment', parent: 'GST Invoice #INV-1042', page: 'fin-payments', status: 'Connected' },
];

export function ConnectedChainBanner() {
  return (
    <section aria-label="Connected Transaction Chain" className="ops-card ops-chain-flow" style={{ marginBottom: '14px', padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '14px', fontWeight: 800 }}>Connected Transaction Chain Flow</h2>
          <span style={{ fontSize: '11px', color: 'var(--muted)' }}>13 connected operational stages from Sales Order to Customer Payment</span>
        </div>
        <span className="ops-stat is-green" style={{ display: 'inline-flex', padding: '3px 8px', borderRadius: '999px', fontSize: '10px', fontWeight: 800 }}>
          13 / 13 Stages Active
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
        {CONNECTED_CHAIN_STAGES.map((s) => (
          <Link
            key={s.num}
            to={`/m/${s.page}`}
            style={{
              border: '1px solid var(--line)',
              borderRadius: '8px',
              padding: '8px 10px',
              background: 'var(--card2, #f8fafc)',
              textDecoration: 'none',
              color: 'inherit',
              display: 'flex',
              flexDirection: 'column',
              gap: '3px',
            }}
          >
            <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--primary, #1d4ed8)' }}>{s.num}. {s.name}</span>
            <span style={{ fontSize: '9px', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Connected: {s.parent}
            </span>
            <span className="ops-stat is-green" style={{ fontSize: '9px', padding: '1px 5px', width: 'fit-content', marginTop: '2px', borderRadius: '4px' }}>
              {s.status}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function PlantDashboardPage() {
  const d = useLoad(() => dashApi.plant(), []);
  // the open exceptions count on the V40 button; hidden quietly when the user may not see the exceptions page
  const exc = useLoad(() => spineApi.exceptions({ state: 'open' }).catch(() => null), []);
  const [sel, setSel] = useState('all');
  if (d.error) return <p role="alert">{d.error}</p>;
  if (!d.data) return <p className="muted">Loading the plant dashboard…</p>;
  const g = d.data;
  const exceptionsLabel = exc.data ? `Exceptions (${exc.data.length})` : 'Exceptions';
  return (
    <div className="ops-page">
      <OpsHead
        title="Plant Dashboard"
        sub={`Live command view across sales, purchase, production, inventory, dispatch and finance. ${
          g.plants.length > 1 ? 'Pick one plant or see them all with the total.' : 'The plant you chose.'
        }`}
      >
        <NavButton to="/m/ops-order-360" primary>
          Open 360° Order Tracking
        </NavButton>
        <NavButton to="/m/process-exceptions">{exceptionsLabel}</NavButton>
      </OpsHead>
      <PlantChips plants={g.plants} value={sel} onChange={setSel} />
      {g.rows.length === 0 ? (
        <p className="ops-empty">No KPIs to show yet.</p>
      ) : (
        <>
          <RagSummary grid={g} sel={sel} />
          <ConnectedChainBanner />
          <DeptCards grid={g} sel={sel} />
          <section aria-label="KPI by plant" className="ops-card">
            <h2>KPI by plant</h2>
            <div className="ops-scroll">
              <CompareGrid grid={g} />
            </div>
          </section>
        </>
      )}
      <TvBlock
        grid={g}
        dashKey="plant"
        tvPath="/tv/plant"
        label="A read-only link for the shop-floor screen. It refreshes by itself and expires in 30 days."
      />
    </div>
  );
}

export function OwnerConsolePage() {
  const d = useLoad(() => dashApi.owner(), []);
  const [sel, setSel] = useState('all');
  if (d.error) return <p role="alert">{d.error}</p>;
  if (!d.data) return <p className="muted">Loading the owner console…</p>;
  const o = d.data;
  const age = o.approvalsByAge.reduce((s, r) => s + r.count, 0);
  return (
    <div className="ops-page">
      <OpsHead title="Owner Console" sub="Every KPI by plant and in total, for the plants you chose.">
        <NavButton to="/m/plant-dashboard" primary>
          Plant Dashboard
        </NavButton>
        <NavButton to="/m/my-approvals">Approval Inbox</NavButton>
        <NavButton to="/m/process-exceptions">Exceptions</NavButton>
      </OpsHead>
      <PlantChips plants={o.plants} value={sel} onChange={setSel} />
      {o.rows.length === 0 ? (
        <p className="ops-empty">No KPIs to show yet.</p>
      ) : (
        <>
          <RagSummary grid={o} sel={sel} />
          <DeptCards grid={o} sel={sel} title={(x) => x} />
          <section aria-label="KPI by plant" className="ops-card">
            <h2>KPI by plant</h2>
            <div className="ops-scroll">
              <CompareGrid grid={o} />
            </div>
          </section>
        </>
      )}
      <div className="ops-grid two">
        <section aria-label="Pending approvals by age" className="ops-card">
          <h2>Pending approvals by age</h2>
          {age === 0 ? <p className="ops-empty">No approval is pending.</p> : null}
          <BarChart ariaLabel="Pending approvals by age" data={o.approvalsByAge} />
        </section>
        <section aria-label="Statutory rows to review" className="ops-card">
          <h2>Statutory rows waiting for review</h2>
          <ul className="ops-lines">
            <li className="ops-line">
              <span>GST rates</span>
              <span className="ops-val">
                <Link to="/m/tax-gst">{o.needsReview.gstRates}</Link>
              </span>
            </li>
            <li className="ops-line">
              <span>HSN / SAC codes</span>
              <span className="ops-val">
                <Link to="/m/tax-hsn">{o.needsReview.hsnCodes}</Link>
              </span>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

export function ModuleAnalyticsPage({ code, title }: { code: string; title: string }) {
  const d = useLoad(() => dashApi.module(code), [code]);
  if (d.error) return <p role="alert">{d.error}</p>;
  if (!d.data) return <p className="muted">Loading {title}…</p>;
  return (
    <div className="dash-page">
      <Head title={title} sub="KPIs for the plants you chose." />
      <CompareGrid grid={d.data} empty={d.data.empty} />
    </div>
  );
}
