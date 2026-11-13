// Phase 24 pages: My Dashboard, Plant Dashboard, Owner Console and the module analytics pages.
import { useState } from 'react';
import { BarChart, CompareGrid, KpiTile } from '../../components/DashParts';
import { dashApi } from '../../lib/dashApi';
import { useLoad } from '../../lib/useLoad';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';

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
    <div className="dash-page">
      <Head title="My Dashboard" sub={m.scopeNote} />
      <section aria-label="My queues" className="kpi-grid">
        <div className="kpi-tile">
          <span className="kpi-name">Approvals waiting for me</span>
          <span className="kpi-value">{m.queues.approvalsWaiting}</span>
        </div>
        <div className={`kpi-tile${m.queues.approvalsOverdue > 0 ? ' rag-border-red' : ''}`}>
          <span className="kpi-name">Approvals overdue</span>
          <span className="kpi-value">{m.queues.approvalsOverdue}</span>
        </div>
        <div className="kpi-tile">
          <span className="kpi-name">My requests pending</span>
          <span className="kpi-value">{m.queues.submittedPending}</span>
        </div>
      </section>
      <section aria-label="My documents">
        <h2>My documents</h2>
        {m.myDocumentsByStatus.length === 0 ? (
          <p className="muted">No documents of yours in the chosen plants yet.</p>
        ) : (
          <BarChart
            ariaLabel="My documents by status"
            data={m.myDocumentsByStatus.map((r) => ({ label: r.status, count: r.count }))}
          />
        )}
      </section>
      <section aria-label={`${m.department} figures`}>
        <h2>{m.department}</h2>
        {m.cards.length === 0 ? (
          <p className="muted">No KPIs are defined for {m.department} yet.</p>
        ) : (
          <div className="kpi-grid">
            {m.cards.map((c) => (
              <KpiTile key={c.code} card={c} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function PlantDashboardPage() {
  const d = useLoad(() => dashApi.plant(), []);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  if (d.error) return <p role="alert">{d.error}</p>;
  if (!d.data) return <p className="muted">Loading the plant dashboard…</p>;
  const g = d.data;

  async function makeTv() {
    setBusy(true);
    try {
      const only = g.plants.length === 1 ? (g.plants[0]?.id ?? null) : null;
      const t = await dashApi.tvToken('plant', only);
      setLink(`${window.location.origin}/tv/plant?token=${t.token}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not create the TV link.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dash-page">
      <Head
        title="Plant Dashboard"
        sub={g.plants.length > 1 ? 'Comparison of the plants you chose, with the total.' : 'The plant you chose.'}
      />
      <CompareGrid grid={g} />
      <section aria-label="TV mode">
        <h2>TV screen</h2>
        <p className="muted">A read-only link for the shop-floor screen. It refreshes by itself and expires in 30 days.</p>
        <button type="button" className="btn" disabled={busy} onClick={() => void makeTv()}>
          Create TV link
        </button>
        {link ? (
          <p>
            <input readOnly value={link} aria-label="TV link" style={{ width: '100%' }} onFocus={(e) => e.currentTarget.select()} />
            <span className="muted">Copy it now: it is shown once. Creating a new link stops the old one.</span>
          </p>
        ) : null}
      </section>
    </div>
  );
}

export function OwnerConsolePage() {
  const d = useLoad(() => dashApi.owner(), []);
  if (d.error) return <p role="alert">{d.error}</p>;
  if (!d.data) return <p className="muted">Loading the owner console…</p>;
  const o = d.data;
  return (
    <div className="dash-page">
      <Head title="Owner Console" sub="Every KPI by plant and in total, for the plants you chose." />
      <CompareGrid grid={o} />
      <section aria-label="Pending approvals by age">
        <h2>Pending approvals by age</h2>
        <BarChart ariaLabel="Pending approvals by age" data={o.approvalsByAge} />
      </section>
      <section aria-label="Statutory rows to review">
        <h2>Statutory rows waiting for review</h2>
        <p>
          GST rates: <strong>{o.needsReview.gstRates}</strong> · HSN / SAC codes: <strong>{o.needsReview.hsnCodes}</strong>
        </p>
      </section>
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
