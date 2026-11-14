// Phase 30 pages: Command Center, Contractors, Work Orders, Workers (checks + deploy), Attendance, Wages, Bills (reconcile + payment), Compliance, Incidents.
import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import { clApi } from '../../lib/clApi';
import { saveFile } from '../../lib/docsMailApi';
import { useLoad } from '../../lib/useLoad';
import { DateField } from '../../ui/components';

const errText = (e: unknown): string => {
  if (e instanceof ApiError) {
    const f = Object.values(e.fields ?? {});
    return f.length > 0 ? f.join(' ') : e.message;
  }
  return 'That did not work.';
};
const d = (v: unknown): string => (v ? String(v).slice(0, 10) : '—');
const TILES: [string, string][] = [['workersOnSite', 'Workers on site'], ['contractorsActive', 'Contractors active'], ['licencesExpiring30', 'Licences expiring (30 days)'], ['wageSheetsPending', 'Wage sheets pending'], ['billsBlocked', 'Bills blocked'], ['incidentsThisMonth', 'Incidents this month']];

function useRun(reloads: (() => void)[]) {
  const toast = useToast();
  return async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      reloads.forEach((r) => r());
    } catch (e) {
      toast(errText(e));
    }
  };
}

export function ClCommandPage() {
  const cc = useLoad(() => clApi.command(), []);
  const t = cc.data?.tiles ?? {};
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Contract Labour Command Center</h1><p className="muted">For the plants you chose.</p></div></div>
      {cc.error ? <p role="alert">{cc.error}</p> : null}
      <div className="gate-rail">{TILES.map(([k, l]) => <article key={k} className="panel gate-card"><p className="muted">{l}</p><p style={{ fontSize: '1.8rem' }}><strong>{t[k] ?? 0}</strong></p></article>)}</div>
      <section className="panel"><h2>Blockers</h2>
        {(cc.data?.blockers ?? []).map((b) => <p key={b.invoice_no} className="rag rag-red" style={{ display: 'block' }}>{b.invoice_no} · {b.contractor}: {b.block_reason}</p>)}
        {(cc.data?.blockers ?? []).length === 0 ? <p className="muted">No bill is blocked.</p> : null}</section>
      <section className="panel"><h2>Headcount by contractor and plant</h2>
        <table className="register-table"><thead><tr><th>Plant</th><th>Contractor</th><th>Workers</th></tr></thead><tbody>
          {(cc.data?.headcount ?? []).map((h) => <tr key={`${h.unit_code}${h.contractor}`}><td>{h.unit_code}</td><td>{h.contractor}</td><td>{h.headcount}</td></tr>)}
          {(cc.data?.headcount ?? []).length === 0 ? <tr><td colSpan={3}>Nobody deployed.</td></tr> : null}
        </tbody></table></section>
      <section className="panel"><h2>Expiries in 30 days</h2>
        {(cc.data?.expiries ?? []).map((e) => <p key={`${e.name}${e.what}`}>{e.name}: {e.what} on {d(e.on_date)}</p>)}
        {(cc.data?.expiries ?? []).length === 0 ? <p className="muted">Nothing expires soon.</p> : null}</section>
    </div>
  );
}

export function ContractorsPage() {
  const list = useLoad(() => clApi.contractors(), []);
  const run = useRun([() => list.reload()]);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ code: '', name: '', pan: '', licenceValidUntil: '', agreementEnd: '', insuranceExpiry: '', email: '' });
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Contractors</h1><p className="muted">A contractor must be approved by a different person before workers can be deployed.</p></div><button type="button" className="btn primary" onClick={() => setAdding(true)}>＋ Add</button></div>
      <table className="register-table"><thead><tr><th>Code</th><th>Name</th><th>Licence until</th><th>Agreement until</th><th>Insurance until</th><th>Risk</th><th>Approval</th><th>On site</th><th /></tr></thead><tbody>
        {(list.data ?? []).map((c) => <tr key={c.id}><td>{c.code}</td><td>{c.name}</td><td>{d(c.licence_valid_until)}</td><td>{d(c.agreement_end)}</td><td>{d(c.insurance_expiry)}</td><td>{c.risk_rating}</td><td>{c.approval_status}</td><td>{c.deployed}</td>
          <td>{c.approval_status === 'Pending' ? <button type="button" className="btn" onClick={() => void run(() => clApi.approveContractor(c.id), 'Approved.')}>Approve</button> : null}</td></tr>)}
        {!list.loading && (list.data ?? []).length === 0 ? <tr><td colSpan={9}>No contractors yet.</td></tr> : null}
      </tbody></table>
      {adding ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Add contractor"><div className="modal"><h2>New contractor</h2>
          {([['code', 'Code'], ['name', 'Name'], ['pan', 'PAN'], ['email', 'Email']] as const).map(([k, l]) => <label key={k}>{l}<input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}
          {([['licenceValidUntil', 'Licence valid until'], ['agreementEnd', 'Agreement end'], ['insuranceExpiry', 'Insurance expiry']] as const).map(([k, l]) => <label key={k}>{l}<DateField value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}
          <div className="modal-actions"><button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>
            <button type="button" className="btn primary" onClick={() => void run(() => clApi.addContractor({ code: f.code, name: f.name, pan: f.pan || null, email: f.email || null, licenceValidUntil: f.licenceValidUntil || null, agreementEnd: f.agreementEnd || null, insuranceExpiry: f.insuranceExpiry || null }).then(() => setAdding(false)), 'Contractor saved.')}>Save</button></div></div></div>
      ) : null}
    </div>
  );
}

export function ClWorkOrdersPage() {
  const list = useLoad(() => clApi.workOrders(), []);
  const contractors = useLoad(() => clApi.contractors(), []);
  const run = useRun([() => list.reload()]);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ contractorId: '', skillCategory: 'Unskilled', requiredHeadcount: '', rate: '', serviceChargePct: '0', startDate: '', endDate: '', budget: '' });
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Contract Work Orders</h1><p className="muted">The rate cannot be below the minimum wage. Budget turns amber at 90 % and blocks at 100 %.</p></div><button type="button" className="btn primary" onClick={() => setAdding(true)}>＋ Add</button></div>
      <table className="register-table"><thead><tr><th>Number</th><th>Contractor</th><th>Plant</th><th>Skill</th><th>Headcount</th><th>Rate</th><th>Budget used</th><th>Status</th><th /></tr></thead><tbody>
        {(list.data ?? []).map((w) => <tr key={w.id}><td>{w.number}</td><td>{w.contractor}</td><td>{w.unit_code}</td><td>{w.skill_category}</td><td>{w.deployed}/{w.required_headcount}</td><td>{w.rate}</td>
          <td><span className={`rag ${w.budget_level === 'BLOCKED' ? 'rag-red' : w.budget_level === 'AMBER' ? 'rag-amber' : 'rag-green'}`}>{w.budget_pct} %</span></td><td>{w.status}</td>
          <td>{w.status === 'Draft' ? <button type="button" className="btn" onClick={() => void run(() => clApi.activateWorkOrder(w.id), 'Activated.')}>Activate</button> : null}</td></tr>)}
        {!list.loading && (list.data ?? []).length === 0 ? <tr><td colSpan={9}>No work orders yet.</td></tr> : null}
      </tbody></table>
      {adding ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Add work order"><div className="modal"><h2>New work order</h2>
          <label>Contractor<select value={f.contractorId} onChange={(e) => setF({ ...f, contractorId: e.target.value })}><option value="">Choose</option>{(contractors.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></label>
          <label>Skill<select value={f.skillCategory} onChange={(e) => setF({ ...f, skillCategory: e.target.value })}><option>Unskilled</option><option>Semi-skilled</option><option>Skilled</option><option>Highly skilled</option></select></label>
          {([['requiredHeadcount', 'Required headcount'], ['rate', 'Daily rate'], ['serviceChargePct', 'Service charge %'], ['budget', 'Budget']] as const).map(([k, l]) => <label key={k}>{l}<input inputMode="decimal" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}
          <label>Start<DateField value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></label>
          <label>End<DateField value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></label>
          <div className="modal-actions"><button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>
            <button type="button" className="btn primary" onClick={() => void run(() => clApi.addWorkOrder({ contractorId: f.contractorId, skillCategory: f.skillCategory, requiredHeadcount: Number(f.requiredHeadcount), rate: Number(f.rate), serviceChargePct: Number(f.serviceChargePct), startDate: f.startDate, endDate: f.endDate, budget: Number(f.budget) }).then(() => setAdding(false)), 'Work order saved.')}>Save</button></div></div></div>
      ) : null}
    </div>
  );
}

const CHECKS = ['KYC', 'MEDICAL', 'INDUCTION', 'POLICE', 'PPE', 'ID_CARD'];
export function WorkersPage() {
  const list = useLoad(() => clApi.workers(), []);
  const contractors = useLoad(() => clApi.contractors(), []);
  const wos = useLoad(() => clApi.workOrders(), []);
  const run = useRun([() => list.reload(), () => wos.reload()]);
  const [adding, setAdding] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [chk, setChk] = useState({ kind: 'KYC', validUntil: '' });
  const [wo, setWo] = useState('');
  const [f, setF] = useState({ name: '', contractorId: '', aadhaarLast4: '', skillCategory: 'Unskilled', wageRate: '', gender: 'M', biometricCode: '' });
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Contract Workers</h1><p className="muted">Only the last 4 digits of Aadhaar are kept. Deploy only when KYC, medical, induction and PPE are valid.</p></div><button type="button" className="btn primary" onClick={() => setAdding(true)}>＋ Add</button></div>
      <table className="register-table"><thead><tr><th>Worker</th><th>Name</th><th>Contractor</th><th>Skill</th><th>Wage</th><th>Aadhaar</th><th>Checks</th><th>Status</th><th /></tr></thead><tbody>
        {(list.data ?? []).map((w) => <tr key={w.id}><td>{w.worker_no}</td><td>{w.name}</td><td>{w.contractor}</td><td>{w.skill_category}</td><td>{w.wage_rate}</td><td>{w.aadhaar_last4 ? `XXXX-${w.aadhaar_last4}` : '—'}</td><td>{w.checks ?? '—'}</td><td>{w.status}</td>
          <td className="row-actions"><button type="button" className="btn" onClick={() => setSel(w.id)}>Checks / Deploy</button>{w.status === 'Deployed' ? <button type="button" className="btn" onClick={() => void run(() => clApi.release(w.id), 'Released.')}>Release</button> : null}</td></tr>)}
        {!list.loading && (list.data ?? []).length === 0 ? <tr><td colSpan={9}>No workers yet.</td></tr> : null}
      </tbody></table>
      {sel ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Checks and deployment"><div className="modal"><h2>Checks and deployment</h2>
          <label>Check<select value={chk.kind} onChange={(e) => setChk({ ...chk, kind: e.target.value })}>{CHECKS.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label>Valid until<DateField value={chk.validUntil} onChange={(e) => setChk({ ...chk, validUntil: e.target.value })} /></label>
          <button type="button" className="btn" onClick={() => void run(() => clApi.check(sel, { kind: chk.kind, validUntil: chk.validUntil || null }), 'Check saved.')}>Save check</button>
          <label>Work order<select value={wo} onChange={(e) => setWo(e.target.value)}><option value="">Choose</option>{(wos.data ?? []).filter((w) => w.status === 'Active').map((w) => <option key={w.id} value={w.id}>{w.number} · {w.contractor}</option>)}</select></label>
          <div className="modal-actions"><button type="button" className="btn" onClick={() => setSel(null)}>Close</button><button type="button" className="btn primary" onClick={() => void run(() => clApi.deploy(sel, { workOrderId: wo }), 'Deployed.')}>Deploy</button></div></div></div>
      ) : null}
      {adding ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Add worker"><div className="modal"><h2>New worker</h2>
          <label>Contractor<select value={f.contractorId} onChange={(e) => setF({ ...f, contractorId: e.target.value })}><option value="">Choose</option>{(contractors.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></label>
          {([['name', 'Name'], ['aadhaarLast4', 'Aadhaar: last 4 digits'], ['wageRate', 'Daily wage rate'], ['biometricCode', 'Attendance (biometric) code']] as const).map(([k, l]) => <label key={k}>{l}<input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}
          <label>Skill<select value={f.skillCategory} onChange={(e) => setF({ ...f, skillCategory: e.target.value })}><option>Unskilled</option><option>Semi-skilled</option><option>Skilled</option><option>Highly skilled</option></select></label>
          <label>Gender<select value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option></select></label>
          <div className="modal-actions"><button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>
            <button type="button" className="btn primary" onClick={() => void run(() => clApi.addWorker({ name: f.name, contractorId: f.contractorId, aadhaarLast4: f.aadhaarLast4 || null, skillCategory: f.skillCategory, wageRate: Number(f.wageRate), gender: f.gender, biometricCode: f.biometricCode || null }).then(() => setAdding(false)), 'Worker saved.')}>Save</button></div></div></div>
      ) : null}
    </div>
  );
}

export function ClAttendancePage() {
  const month = new Date().toISOString().slice(0, 7);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const list = useLoad(() => clApi.attendance(month), []);
  const run = useRun([() => list.reload()]);
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Contract Attendance</h1><p className="muted">The daily muster is built from the device punches.</p></div></div>
      <div className="inline-form"><label>Date<DateField value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <button type="button" className="btn primary" onClick={() => void run(() => clApi.generateMuster(date), 'Muster built.')}>Build muster</button></div>
      <table className="register-table"><thead><tr><th>Date</th><th>Worker</th><th>Name</th><th>Regular h</th><th>OT h</th><th>Status</th><th>Payable</th><th>Gate</th><th /></tr></thead><tbody>
        {(list.data ?? []).map((a) => <tr key={String(a.id)}><td>{d(a.att_date)}</td><td>{String(a.worker_no)}</td><td>{String(a.name)}</td><td>{String(a.regular_hours)}</td><td>{String(a.ot_hours)}</td><td>{String(a.status)}</td><td>{String(a.payable_days)}</td><td>{a.gate_match === false ? 'Mismatch' : a.gate_match === true ? 'OK' : '—'}</td>
          <td>{a.gate_match === false && !a.supervisor_approved ? <button type="button" className="btn" onClick={() => void run(() => clApi.approveDay(String(a.id)), 'Approved.')}>Approve day</button> : null}</td></tr>)}
        {!list.loading && (list.data ?? []).length === 0 ? <tr><td colSpan={9}>No attendance this month.</td></tr> : null}
      </tbody></table>
    </div>
  );
}

export function ClWagesPage() {
  const toast = useToast();
  const sheets = useLoad(() => clApi.wages(), []);
  const contractors = useLoad(() => clApi.contractors(), []);
  const run = useRun([() => sheets.reload()]);
  const [f, setF] = useState({ contractorId: '', month: new Date().toISOString().slice(0, 7) });
  const [lines, setLines] = useState<Record<string, unknown>[] | null>(null);
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Contract Wages</h1><p className="muted">PF, ESIC and professional tax are worked out per worker. Lock the sheet when it is right.</p></div></div>
      <div className="inline-form">
        <label>Contractor<select value={f.contractorId} onChange={(e) => setF({ ...f, contractorId: e.target.value })}><option value="">Choose</option>{(contractors.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Month<input type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} /></label>
        <button type="button" className="btn primary" onClick={() => void run(() => clApi.computeWages({ month: f.month, contractorId: f.contractorId }), 'Wages worked out.')}>Compute</button>
      </div>
      <table className="register-table"><thead><tr><th>Month</th><th>Contractor</th><th>Plant</th><th>Workers</th><th>Gross</th><th>Net</th><th>Status</th><th /></tr></thead><tbody>
        {(sheets.data ?? []).map((s) => <tr key={s.id}><td>{s.month}</td><td>{s.contractor}</td><td>{s.unit_code}</td><td>{s.workers}</td><td>{s.total_gross}</td><td>{s.total_net}</td><td>{s.status}</td>
          <td className="row-actions"><button type="button" className="btn" onClick={() => void clApi.wageLines(s.id).then(setLines, (e: unknown) => toast(errText(e)))}>Lines</button><button type="button" className="btn" onClick={() => void clApi.bankAdvice(s.id).then((x) => saveFile(x, 'bank-advice.xlsx'), (e: unknown) => toast(errText(e)))}>Bank advice</button>{s.status === 'COMPUTED' ? <button type="button" className="btn primary" onClick={() => void run(() => clApi.lockWages(s.id), 'Locked.')}>Lock</button> : null}</td></tr>)}
        {!sheets.loading && (sheets.data ?? []).length === 0 ? <tr><td colSpan={8}>No wage sheets yet.</td></tr> : null}
      </tbody></table>
      {lines ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Wage lines"><div className="modal"><h2>Wage lines</h2>
          <table className="register-table"><thead><tr><th>Worker</th><th>Days</th><th>Basic</th><th>OT</th><th>Gross</th><th>PF</th><th>ESIC</th><th>PT</th><th>Net</th></tr></thead><tbody>
            {lines.map((l) => <tr key={String(l.id)}><td>{String(l.name)}</td><td>{String(l.payable_days)}</td><td>{String(l.basic_wages)}</td><td>{String(l.ot_amount)}</td><td>{String(l.gross_wages)}</td><td>{String(l.pf_employee)}</td><td>{String(l.esic_employee)}</td><td>{String(l.prof_tax)}</td><td>{String(l.net_pay)}</td></tr>)}
          </tbody></table><div className="modal-actions"><button type="button" className="btn" onClick={() => setLines(null)}>Close</button></div></div></div>
      ) : null}
    </div>
  );
}

export function BillsPage() {
  const bills = useLoad(() => clApi.bills(), []);
  const contractors = useLoad(() => clApi.contractors(), []);
  const wos = useLoad(() => clApi.workOrders(), []);
  const run = useRun([() => bills.reload()]);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ invoiceNo: '', invoiceDate: '', contractorId: '', workOrderId: '', billingMonth: '', headcount: '', billedManDays: '' });
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Contractor Bills</h1><p className="muted">Checked against the muster. Payment is blocked until every monthly proof is verified, and only the undisputed part is approved.</p></div><button type="button" className="btn primary" onClick={() => setAdding(true)}>＋ Add bill</button></div>
      <table className="register-table"><thead><tr><th>Bill</th><th>Contractor</th><th>Month</th><th>Man-days</th><th>Gross</th><th>Net payable</th><th>Disputed</th><th>Status</th><th /></tr></thead><tbody>
        {(bills.data ?? []).map((b) => <tr key={b.id}><td>{b.invoice_no}</td><td>{b.contractor}</td><td>{b.billing_month}</td><td>{b.billed_man_days}{b.recon ? <div className="muted">Muster {String((b.recon as Record<string, unknown>).musterManDays)}</div> : null}</td><td>{b.gross_invoice}</td><td>{b.net_payable}</td><td>{b.disputed_amount}</td>
          <td><span className={`rag ${b.status === 'PAYMENT_BLOCKED' ? 'rag-red' : b.status === 'APPROVED' ? 'rag-green' : ''}`}>{b.status.replace('_', ' ')}</span>{b.block_reason ? <div className="muted">{b.block_reason}</div> : null}</td>
          <td className="row-actions"><button type="button" className="btn" onClick={() => void run(() => clApi.reconcile(b.id), 'Reconciled.')}>Reconcile</button><button type="button" className="btn primary" onClick={() => void run(() => clApi.approvePayment(b.id), 'Payment approved.')}>Approve payment</button></td></tr>)}
        {!bills.loading && (bills.data ?? []).length === 0 ? <tr><td colSpan={9}>No bills yet.</td></tr> : null}
      </tbody></table>
      {adding ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Add bill"><div className="modal"><h2>New contractor bill</h2>
          <label>Contractor<select value={f.contractorId} onChange={(e) => setF({ ...f, contractorId: e.target.value })}><option value="">Choose</option>{(contractors.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Work order<select value={f.workOrderId} onChange={(e) => setF({ ...f, workOrderId: e.target.value })}><option value="">Choose</option>{(wos.data ?? []).filter((w) => !f.contractorId || w.contractor).map((w) => <option key={w.id} value={w.id}>{w.number}</option>)}</select></label>
          {([['invoiceNo', 'Bill number'], ['headcount', 'Headcount'], ['billedManDays', 'Billed man-days']] as const).map(([k, l]) => <label key={k}>{l}<input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}
          <label>Bill date<DateField value={f.invoiceDate} onChange={(e) => setF({ ...f, invoiceDate: e.target.value })} /></label>
          <label>Billing month<input type="month" value={f.billingMonth} onChange={(e) => setF({ ...f, billingMonth: e.target.value })} /></label>
          <div className="modal-actions"><button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>
            <button type="button" className="btn primary" onClick={() => void run(() => clApi.addBill({ invoiceNo: f.invoiceNo, invoiceDate: f.invoiceDate, contractorId: f.contractorId, workOrderId: f.workOrderId, billingMonth: f.billingMonth, headcount: Number(f.headcount || 0), billedManDays: Number(f.billedManDays) }).then(() => setAdding(false)), 'Bill saved.')}>Save</button></div></div></div>
      ) : null}
    </div>
  );
}

const DOC_KINDS = ['PF_ECR', 'PF_CHALLAN', 'ESIC_CHALLAN', 'MUSTER_ROLL', 'WAGE_REGISTER', 'BANK_PROOF', 'BONUS_REGISTER', 'RETURN_FILED'];
export function CompliancePage() {
  const contractors = useLoad(() => clApi.contractors(), []);
  const [contractor, setContractor] = useState('');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const data = useLoad(() => (contractor ? clApi.compliance(contractor, month) : Promise.resolve(null)), [contractor, month]);
  const run = useRun([() => data.reload()]);
  const [kind, setKind] = useState('PF_ECR');
  const [ref, setRef] = useState('');
  const c = data.data;
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Contract Compliance</h1><p className="muted">11 checks. Payment is blocked below 100 %. A different person verifies each proof.</p></div></div>
      <div className="inline-form">
        <label>Contractor<select value={contractor} onChange={(e) => setContractor(e.target.value)}><option value="">Choose</option>{(contractors.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label>Month<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
      </div>
      {c ? (
        <>
          <p><span className={`rag ${c.scorePct >= 100 ? 'rag-green' : c.scorePct >= 80 ? 'rag-amber' : 'rag-red'}`}>{c.scorePct} %</span> · {c.passed} of {c.required} checks · risk {c.risk}{c.blocked ? ` · ${c.blockReason ?? ''}` : ''}</p>
          <table className="register-table"><thead><tr><th>Check</th><th>Status</th></tr></thead><tbody>{c.checks.map((k) => <tr key={k.kind}><td>{k.label}</td><td><span className={`rag ${k.passed ? 'rag-green' : 'rag-red'}`}>{k.passed ? 'Passed' : k.uploaded ? 'Uploaded, not verified' : 'Missing'}</span></td></tr>)}</tbody></table>
          <section className="panel"><h2>Upload a proof</h2>
            <div className="inline-form"><label>Kind<select value={kind} onChange={(e) => setKind(e.target.value)}>{DOC_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
              <label>Reference<input value={ref} onChange={(e) => setRef(e.target.value)} /></label>
              <button type="button" className="btn primary" onClick={() => void run(() => clApi.uploadDoc({ contractorId: contractor, month, kind, reference: ref || null }), 'Uploaded.')}>Upload</button></div>
            <table className="register-table"><thead><tr><th>Proof</th><th>Reference</th><th>Verified</th><th /></tr></thead><tbody>{c.docs.map((x) => <tr key={x.id}><td>{x.kind}</td><td>{x.reference ?? '—'}</td><td>{x.verified_at ? 'Yes' : 'No'}</td><td>{!x.verified_at ? <button type="button" className="btn" onClick={() => void run(() => clApi.verifyDoc(x.id), 'Verified.')}>Verify</button> : null}</td></tr>)}</tbody></table></section>
        </>
      ) : <p className="muted">Choose a contractor.</p>}
    </div>
  );
}

export function IncidentsPage() {
  const list = useLoad(() => clApi.incidents(), []);
  const run = useRun([() => list.reload()]);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ incidentDate: new Date().toISOString().slice(0, 10), severity: 'Minor', description: '', lostTimeHours: '0' });
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Contract Safety Incidents</h1></div><button type="button" className="btn primary" onClick={() => setAdding(true)}>＋ Add</button></div>
      <table className="register-table"><thead><tr><th>Number</th><th>Date</th><th>Plant</th><th>Severity</th><th>Description</th><th>Lost hours</th><th>Status</th></tr></thead><tbody>
        {(list.data ?? []).map((i) => <tr key={String(i.id)}><td>{String(i.incident_no)}</td><td>{d(i.incident_date)}</td><td>{String(i.unit_code)}</td><td>{String(i.severity)}</td><td>{String(i.description)}</td><td>{String(i.lost_time_hours)}</td><td>{String(i.status)}</td></tr>)}
        {!list.loading && (list.data ?? []).length === 0 ? <tr><td colSpan={7}>No incidents.</td></tr> : null}
      </tbody></table>
      {adding ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Add incident"><div className="modal"><h2>New incident</h2>
          <label>Date<DateField value={f.incidentDate} onChange={(e) => setF({ ...f, incidentDate: e.target.value })} /></label>
          <label>Severity<select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}><option>Near miss</option><option>Minor</option><option>Major</option><option>Fatal</option></select></label>
          <label>Description<textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
          <label>Lost time (hours)<input inputMode="decimal" value={f.lostTimeHours} onChange={(e) => setF({ ...f, lostTimeHours: e.target.value })} /></label>
          <div className="modal-actions"><button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>
            <button type="button" className="btn primary" onClick={() => void run(() => clApi.addIncident({ incidentDate: f.incidentDate, severity: f.severity, description: f.description, lostTimeHours: Number(f.lostTimeHours || 0) }).then(() => setAdding(false)), 'Incident saved.')}>Save</button></div></div></div>
      ) : null}
    </div>
  );
}
