// Contract Labour Command Center, laid out like V40: lifecycle, plant headcount, control alerts with Open buttons and the three
// control cards. Numbers come from GET /cl/command-center (plant-scoped); nothing is invented.
import { Link } from 'react-router-dom';
import { clApi } from '../../lib/clApi';
import { useLoad } from '../../lib/useLoad';
import { NavButton, OpsHead } from '../dashboards/OpsParts';
import '../dashboards/ops-dashboards.css';

const TILES: [string, string][] = [
  ['workersOnSite', 'Workers on site'],
  ['contractorsActive', 'Contractors active'],
  ['licencesExpiring30', 'Licences expiring (30 days)'],
  ['wageSheetsPending', 'Wage sheets pending'],
  ['billsBlocked', 'Bills blocked'],
  ['incidentsThisMonth', 'Incidents this month'],
];
const LIFECYCLE = [
  'Contractor Approval',
  'Work Order / PO',
  'Worker KYC',
  'Medical & Safety',
  'Gate Activation',
  'Plant Deployment',
  'Attendance & OT',
  'Wages & Invoice',
  'Compliance / Exit',
];
const rupees = (v: number): string => `₹ ${Math.round(v).toLocaleString('en-IN')}`;
const day = (v: unknown): string => (v ? String(v).slice(0, 10) : '—');

export function ClCommandPage() {
  const cc = useLoad(() => clApi.command(), []);
  const data = cc.data;
  const t = data?.tiles ?? {};
  const alerts = data?.alerts;

  // headcount per plant (sum over contractors), biggest bar = full width
  const byPlant = new Map<string, number>();
  for (const h of data?.headcount ?? []) byPlant.set(h.unit_code, (byPlant.get(h.unit_code) ?? 0) + Number(h.headcount));
  const plantRows = Array.from(byPlant.entries());
  const maxHead = Math.max(1, ...plantRows.map(([, n]) => n));

  const alertRows: { level: string; cls: string; text: string; to: string }[] = [
    {
      level: 'Critical',
      cls: 'critical',
      text: `${alerts?.highRiskCompliance ?? 0} high-risk compliance record(s)`,
      to: '/m/cl-compliance',
    },
    {
      level: 'Warning',
      cls: 'warning',
      text: `${(data?.expiries ?? []).length} contractor licence/insurance/agreement item(s) expiring in 30 days`,
      to: '/m/cl-contractors',
    },
    {
      level: 'Action',
      cls: 'action',
      text: `${alerts?.onboardingBlocked ?? 0} worker onboarding case(s) not yet cleared`,
      to: '/m/cl-onboarding',
    },
    {
      level: 'Finance',
      cls: 'finance',
      text: `${rupees(alerts?.invoiceOutstanding ?? 0)} contractor invoice not yet approved for payment`,
      to: '/m/cl-invoices',
    },
  ];

  return (
    <div className="ops-page">
      <OpsHead title="Contract Labour Command Center" sub="End-to-end contractor, worker, compliance, deployment, wages and billing control. For the plants you chose.">
        <NavButton to="/m/cl-compliance">Compliance</NavButton>
        <NavButton to="/m/cl-wages">Wage Run</NavButton>
        <NavButton to="/m/cl-workers" primary>
          ＋ Add Worker
        </NavButton>
      </OpsHead>
      {cc.error ? <p role="alert">{cc.error}</p> : null}

      <section className="ops-summary" aria-label="Key figures">
        {TILES.map(([k, l]) => (
          <div key={k} className={`ops-stat${k === 'billsBlocked' && (t[k] ?? 0) > 0 ? ' is-red' : ''}`}>
            <small>{l}</small>
            <b>{t[k] ?? 0}</b>
          </div>
        ))}
      </section>

      <section className="ops-card" aria-label="Contract Labour Lifecycle">
        <h3>Contract Labour Lifecycle</h3>
        <ol className="ops-flow">
          {LIFECYCLE.map((x, i) => (
            <li key={x}>
              <b>{i + 1}</b>
              <span>{x}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="ops-grid two">
        <section className="ops-card" aria-label="Plant / Unit Headcount">
          <h3>Plant / Unit Headcount</h3>
          {plantRows.length === 0 ? <p className="ops-empty">Nobody deployed.</p> : null}
          {plantRows.map(([unit, n]) => (
            <div key={unit} className="ops-unit">
              <b>{unit}</b>
              <div className="track">
                <span style={{ width: `${(n / maxHead) * 100}%` }} />
              </div>
              <strong>{n}</strong>
            </div>
          ))}
          <div className="ops-links">
            <NavButton to="/m/cl-deployment">Deployment</NavButton>
            <NavButton to="/m/cl-attendance">Attendance</NavButton>
            <NavButton to="/m/cl-gatepass">Gate Access</NavButton>
            <NavButton to="/m/cl-safety">Safety</NavButton>
          </div>
        </section>
        <section className="ops-card" aria-label="Control Alerts">
          <h3>Control Alerts</h3>
          <div>
            {alertRows.map((a) => (
              <div key={a.level} className={`ops-alert ${a.cls}`}>
                <span className="what">
                  <b>{a.level}</b>
                  {a.text}
                </span>
                <NavButton to={a.to}>Open</NavButton>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="ops-grid">
        <section className="ops-card" aria-label="Workforce Control">
          <h3>Workforce Control</h3>
          <p className="ops-sub">KYC, Aadhaar duplicate prevention, PF/ESIC, medical, police verification, induction, PPE, ID card and contract expiry.</p>
          <div>
            <NavButton to="/m/cl-workers" primary>
              Worker Master
            </NavButton>
          </div>
        </section>
        <section className="ops-card" aria-label="Payroll & Billing">
          <h3>Payroll &amp; Billing</h3>
          <p className="ops-sub">Attendance, overtime, statutory deduction, wage slip, contractor GST invoice, TDS, retention and payment balance.</p>
          <div>
            <NavButton to="/m/cl-invoices" primary>
              Billing Control
            </NavButton>
          </div>
        </section>
        <section className="ops-card" aria-label="Compliance Dossier">
          <h3>Compliance Dossier</h3>
          <p className="ops-sub">Licence, agreement, PF/ESIC challan, muster roll, wage register, bank proof, insurance and returns.</p>
          <div>
            <NavButton to="/m/cl-compliance" primary>
              Compliance Score
            </NavButton>
          </div>
        </section>
      </div>

      <section className="ops-card" aria-label="Blockers">
        <h3>Blockers</h3>
        {(data?.blockers ?? []).map((b) => (
          <p key={b.invoice_no} className="ops-rag red" style={{ display: 'block' }}>
            {b.invoice_no} · {b.contractor}: {b.block_reason}
          </p>
        ))}
        {(data?.blockers ?? []).length === 0 ? <p className="ops-empty">No bill is blocked.</p> : null}
      </section>

      <section className="ops-card" aria-label="Headcount by contractor and plant">
        <h3>Headcount by contractor and plant</h3>
        <div className="ops-scroll">
          <table className="register-table">
            <thead>
              <tr>
                <th>Plant</th>
                <th>Contractor</th>
                <th>Workers</th>
              </tr>
            </thead>
            <tbody>
              {(data?.headcount ?? []).map((h) => (
                <tr key={`${h.unit_code}${h.contractor}`}>
                  <td>{h.unit_code}</td>
                  <td>{h.contractor}</td>
                  <td>{h.headcount}</td>
                </tr>
              ))}
              {(data?.headcount ?? []).length === 0 ? (
                <tr>
                  <td colSpan={3}>Nobody deployed.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="ops-card" aria-label="Expiries in 30 days">
        <h3>Expiries in 30 days</h3>
        {(data?.expiries ?? []).map((e) => (
          <p key={`${e.name}${e.what}`}>
            {e.name}: {e.what} on {day(e.on_date)}
          </p>
        ))}
        {(data?.expiries ?? []).length === 0 ? <p className="ops-empty">Nothing expires soon.</p> : null}
        <div>
          <Link className="btn" to="/m/cl-contractors">
            Contractor Master
          </Link>
        </div>
      </section>
    </div>
  );
}
