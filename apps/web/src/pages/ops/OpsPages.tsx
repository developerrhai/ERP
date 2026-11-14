// Phase 29 pages: Task Management, Shift Roster & Handover, Visitor Management, Canteen (with the counter screen).
import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import { opsApi, type Task } from '../../lib/opsApi';
import { useLoad } from '../../lib/useLoad';
import { DateField } from '../../ui/components';

const errText = (e: unknown): string => {
  if (e instanceof ApiError) {
    const f = Object.values(e.fields ?? {});
    return f.length > 0 ? f.join(' ') : e.message;
  }
  return 'That did not work.';
};
const when = (v: string | null | undefined): string => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const day = (v: string | null | undefined): string => (v ? String(v).slice(0, 10) : '—');
const COLOUR: Record<string, string> = { GREEN: 'rag-green', AMBER: 'rag-amber', RED: 'rag-red' };

// ---------------------------------------------------------------------------------------------- Tasks
type TaskTab = 'register' | 'board' | 'mine' | 'overdue' | 'workload' | 'approval';

export function TasksPage() {
  const toast = useToast();
  const [tab, setTab] = useState<TaskTab>('register');
  const filter = tab === 'mine' ? { mine: true } : tab === 'overdue' ? { overdue: true } : tab === 'approval' ? { status: 'Done' } : {};
  const list = useLoad(() => (tab === 'board' || tab === 'workload' ? Promise.resolve([] as Task[]) : opsApi.tasks(filter)), [tab]);
  const board = useLoad(() => (tab === 'board' ? opsApi.board() : Promise.resolve({} as Record<string, Task[]>)), [tab]);
  const load = useLoad(() => (tab === 'workload' ? opsApi.workload() : Promise.resolve([])), [tab]);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ title: '', department: '', dueDate: '', priority: 'Medium', approvalRequired: false });

  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast(ok);
      list.reload();
      board.reload();
    } catch (e) {
      toast(errText(e));
    }
  }
  const rows = tab === 'approval' ? (list.data ?? []).filter((t) => t.approval_status === 'Pending') : list.data ?? [];
  const card = (t: Task) => (
    <tr key={t.id}>
      <td>{t.task_no}</td><td>{t.title}{t.blocked_by_count > 0 ? <div className="muted">Waiting for {t.blocked_by_count} task(s)</div> : null}</td><td>{t.department ?? '—'}</td><td>{t.assigned_to ?? '—'}</td>
      <td>{t.priority}</td><td>{day(t.due_date)}</td><td>{t.progress_pct} %</td><td><span className={`rag ${t.status === 'Done' || t.status === 'Approved' ? 'rag-green' : t.status === 'Blocked' ? 'rag-red' : ''}`}>{t.status}</span></td>
      <td className="row-actions">
        {t.status === 'Open' || t.status === 'Blocked' ? <button type="button" className="btn" onClick={() => void run(() => opsApi.taskAction(t.id, 'start'), 'Started.')}>Start</button> : null}
        {t.status === 'In Progress' ? <button type="button" className="btn primary" onClick={() => void run(() => opsApi.taskAction(t.id, 'done'), 'Done.')}>Done</button> : null}
        {t.approval_status === 'Pending' ? <button type="button" className="btn primary" onClick={() => void run(() => opsApi.taskAction(t.id, 'approve'), 'Approved.')}>Approve</button> : null}
        {['Done', 'Approved'].includes(t.status) ? <button type="button" className="btn" onClick={() => { const r = window.prompt('Reason to reopen'); if (r) void run(() => opsApi.reopen(t.id, r), 'Reopened.'); }}>Reopen</button> : null}
      </td>
    </tr>
  );
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Task Management</h1><p className="muted">A task that waits for another task cannot start until that one is done.</p></div><button type="button" className="btn primary" onClick={() => setAdding(true)}>＋ Add</button></div>
      <div role="tablist" className="tabs-row">
        {([['register', 'Task Register'], ['board', 'Department Board'], ['mine', 'My Tasks'], ['overdue', 'Due & Overdue'], ['workload', 'Workload'], ['approval', 'Task Approval']] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' primary' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {list.error ? <p role="alert">{list.error}</p> : null}
      {tab === 'board' ? (
        <div className="gate-rail">
          {['Open', 'In Progress', 'Blocked', 'Done', 'Approved'].map((s) => (
            <section key={s} className="panel"><h3>{s} ({(board.data?.[s] ?? []).length})</h3>
              {(board.data?.[s] ?? []).map((t) => <p key={t.id}><strong>{t.task_no}</strong> {t.title}<br /><span className="muted">{t.assigned_to ?? '—'} · due {day(t.due_date)}</span></p>)}
            </section>
          ))}
        </div>
      ) : tab === 'workload' ? (
        <table className="register-table"><thead><tr><th>Person</th><th>Open</th><th>Overdue</th><th>Approvals waiting</th><th>Load</th></tr></thead><tbody>
          {(load.data ?? []).map((w) => <tr key={w.user_id}><td>{w.name}</td><td>{w.open}</td><td>{w.overdue}</td><td>{w.approvals_waiting}</td><td><span className={`rag ${COLOUR[w.colour] ?? ''}`}>{w.colour}</span></td></tr>)}
          {(load.data ?? []).length === 0 ? <tr><td colSpan={5}>No assigned tasks.</td></tr> : null}
        </tbody></table>
      ) : (
        <table className="register-table"><thead><tr><th>Task</th><th>Title</th><th>Department</th><th>Assigned to</th><th>Priority</th><th>Due</th><th>Progress</th><th>Status</th><th /></tr></thead><tbody>
          {rows.map(card)}
          {!list.loading && rows.length === 0 ? <tr><td colSpan={9}>No tasks.</td></tr> : null}
        </tbody></table>
      )}
      {adding ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Add task">
          <div className="modal">
            <h2>New task</h2>
            <label>Task<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
            <label>Department<input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></label>
            <label>Due date<DateField value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></label>
            <label>Priority<select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select></label>
            <label className="plant-remember"><input type="checkbox" checked={f.approvalRequired} onChange={(e) => setF({ ...f, approvalRequired: e.target.checked })} /> Needs approval when done</label>
            <div className="modal-actions"><button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>
              <button type="button" className="btn primary" onClick={() => void run(() => opsApi.addTask({ title: f.title, department: f.department || null, dueDate: f.dueDate || null, priority: f.priority, approvalRequired: f.approvalRequired }).then(() => setAdding(false)), 'Task saved.')}>Save</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Shift handover
export function HandoverPage() {
  const toast = useToast();
  const list = useLoad(() => opsApi.handovers(), []);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ department: '', handoverDate: new Date().toISOString().slice(0, 10), incomingUserId: '', issues: '', safetyNote: '', materialsShort: '' });
  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast(ok);
      list.reload();
    } catch (e) {
      toast(errText(e));
    }
  }
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Shift Roster & Handover</h1><p className="muted">The outgoing in-charge submits; the incoming in-charge must accept within 30 minutes of the shift start.</p></div><button type="button" className="btn primary" onClick={() => setAdding(true)}>＋ New handover</button></div>
      {list.error ? <p role="alert">{list.error}</p> : null}
      <table className="register-table"><thead><tr><th>Date</th><th>Department</th><th>From</th><th>To</th><th>Issues</th><th>Status</th><th /></tr></thead><tbody>
        {(list.data ?? []).map((h) => (
          <tr key={h.id}><td>{day(h.handover_date)}</td><td>{h.department}</td><td>{h.outgoing}</td><td>{h.incoming ?? '—'}</td><td>{h.issues ?? '—'}{h.reject_reason ? <div className="muted">Rejected: {h.reject_reason}</div> : null}</td><td>{h.status}</td>
            <td className="row-actions">
              {['DRAFT', 'REJECTED'].includes(h.status) ? <button type="button" className="btn" onClick={() => void run(() => opsApi.handoverAction(h.id, 'submit'), 'Submitted.')}>Submit</button> : null}
              {h.status === 'SUBMITTED' ? <><button type="button" className="btn primary" onClick={() => void run(() => opsApi.handoverAction(h.id, 'accept'), 'Accepted.')}>Accept</button><button type="button" className="btn" onClick={() => { const r = window.prompt('Reason for rejecting'); if (r) void run(() => opsApi.rejectHandover(h.id, r), 'Rejected.'); }}>Reject</button></> : null}
            </td></tr>
        ))}
        {!list.loading && (list.data ?? []).length === 0 ? <tr><td colSpan={7}>No handovers yet.</td></tr> : null}
      </tbody></table>
      {adding ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="New handover">
          <div className="modal">
            <h2>New handover</h2>
            <label>Department<input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></label>
            <label>Date<DateField value={f.handoverDate} onChange={(e) => setF({ ...f, handoverDate: e.target.value })} /></label>
            <label>Incoming in-charge (user id)<input value={f.incomingUserId} onChange={(e) => setF({ ...f, incomingUserId: e.target.value })} /></label>
            <label>Issues<textarea value={f.issues} onChange={(e) => setF({ ...f, issues: e.target.value })} /></label>
            <label>Safety note<input value={f.safetyNote} onChange={(e) => setF({ ...f, safetyNote: e.target.value })} /></label>
            <label>Materials short<input value={f.materialsShort} onChange={(e) => setF({ ...f, materialsShort: e.target.value })} /></label>
            <div className="modal-actions"><button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>
              <button type="button" className="btn primary" onClick={() => void run(() => opsApi.addHandover({ department: f.department, handoverDate: f.handoverDate, incomingUserId: f.incomingUserId || null, issues: f.issues || null, safetyNote: f.safetyNote || null, materialsShort: f.materialsShort || null }).then(() => setAdding(false)), 'Handover saved.')}>Save</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Visitors
export function VisitorsPage() {
  const toast = useToast();
  const [tab, setTab] = useState<'register' | 'inside'>('register');
  const list = useLoad(() => opsApi.visitors({}), []);
  const inside = useLoad(() => (tab === 'inside' ? opsApi.inside() : Promise.resolve([])), [tab]);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ visitorName: '', company: '', mobile: '', purpose: '', visitDate: new Date().toISOString().slice(0, 10), plannedOut: '', vehicleNo: '', idLast4: '' });
  const [qr, setQr] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast(ok);
      list.reload();
      inside.reload();
    } catch (e) {
      toast(errText(e));
    }
  }
  const rows = tab === 'inside' ? inside.data ?? [] : list.data ?? [];
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Visitor Management</h1><p className="muted">Pre-register, host approves, gate checks in, check out. Only the last 4 characters of the ID are kept.</p></div><button type="button" className="btn primary" onClick={() => setAdding(true)}>＋ Pre-register</button></div>
      <div role="tablist" className="tabs-row">{(['register', 'inside'] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={`btn${tab === t ? ' primary' : ''}`} onClick={() => setTab(t)}>{t === 'register' ? 'Visitor Register' : 'Inside Plant'}</button>)}</div>
      {qr ? <p role="status">QR code for the gate (shown once): <code>{qr}</code></p> : null}
      <table className="register-table"><thead><tr><th>Pass</th><th>Visitor</th><th>Host</th><th>Date</th><th>Planned out</th><th>Status</th><th /></tr></thead><tbody>
        {rows.map((v) => (
          <tr key={v.id} className={v.overstay ? 'unread' : undefined}>
            <td>{v.pass_no}</td><td>{v.visitor_name}{v.company ? ` · ${v.company}` : ''}<div className="muted">{v.purpose}</div></td><td>{v.host}</td><td>{day(v.visit_date)}</td>
            <td>{when(v.planned_out)}{v.overstay ? <span className="rag rag-red"> Overstay</span> : null}</td><td>{v.status}{v.minutes_inside !== undefined ? ` · ${v.minutes_inside} min` : ''}</td>
            <td className="row-actions">
              {v.status === 'PRE_REGISTERED' ? <><button type="button" className="btn primary" onClick={() => void run(() => opsApi.visitorAction(v.id, 'approve'), 'Approved.')}>Approve</button><button type="button" className="btn" onClick={() => void run(() => opsApi.visitorAction(v.id, 'reject'), 'Rejected.')}>Reject</button></> : null}
              {v.status === 'APPROVED' ? <><button type="button" className="btn primary" onClick={() => void run(() => opsApi.checkIn({ id: v.id }), 'Checked in.')}>Check in</button><button type="button" className="btn" onClick={() => void opsApi.qr(v.id).then((r) => setQr(r.token), (e: unknown) => toast(errText(e)))}>QR</button></> : null}
              {v.status === 'INSIDE' ? <button type="button" className="btn" onClick={() => void run(() => opsApi.visitorAction(v.id, 'check-out'), 'Checked out.')}>Check out</button> : null}
            </td>
          </tr>
        ))}
        {rows.length === 0 ? <tr><td colSpan={7}>No visitors.</td></tr> : null}
      </tbody></table>
      {adding ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Pre-register visitor">
          <div className="modal">
            <h2>Pre-register a visitor</h2>
            {([['visitorName', 'Visitor name'], ['company', 'Company'], ['mobile', 'Mobile'], ['purpose', 'Purpose'], ['vehicleNo', 'Vehicle no.'], ['idLast4', 'ID: last 4 characters only']] as const).map(([k, l]) => <label key={k}>{l}<input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}
            <label>Visit date<DateField value={f.visitDate} onChange={(e) => setF({ ...f, visitDate: e.target.value })} /></label>
            <label>Planned out<input type="datetime-local" value={f.plannedOut} onChange={(e) => setF({ ...f, plannedOut: e.target.value })} /></label>
            <div className="modal-actions"><button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>
              <button type="button" className="btn primary" onClick={() => void run(() => opsApi.addVisitor({ visitorName: f.visitorName, company: f.company || null, mobile: f.mobile || null, purpose: f.purpose, visitDate: f.visitDate, plannedOut: f.plannedOut ? new Date(f.plannedOut).toISOString() : null, vehicleNo: f.vehicleNo || null, idLast4: f.idLast4 || null }).then(() => setAdding(false)), 'Pass created.')}>Save</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Canteen (counter + rates + month)
export function CanteenPage() {
  const toast = useToast();
  const [tab, setTab] = useState<'counter' | 'register' | 'rates' | 'cost'>('counter');
  const [code, setCode] = useState('');
  const [meal, setMeal] = useState('LUNCH');
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const today = useLoad(() => opsApi.today(), []);
  const month = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
  const reg = useLoad(() => (tab === 'register' ? opsApi.register(month) : Promise.resolve([])), [tab]);
  const rates = useLoad(() => (tab === 'rates' ? opsApi.rates() : Promise.resolve([])), [tab]);
  const months = useLoad(() => (tab === 'cost' ? opsApi.months() : Promise.resolve([])), [tab]);
  const cost = useLoad(() => (tab === 'cost' ? opsApi.departmentCost(month) : Promise.resolve([])), [tab]);
  const [rf, setRf] = useState({ mealType: 'LUNCH', rate: '', gstPct: '5', employeeSharePct: '40' });

  async function scan() {
    try {
      const c = await opsApi.scan({ code, mealType: meal });
      setFlash({ ok: true, text: `${c.person_name}: ${meal.toLowerCase()} served (₹ ${c.total})` });
      setCode('');
      today.reload();
    } catch (e) {
      setFlash({ ok: false, text: errText(e) });
    }
  }
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Canteen</h1><p className="muted">Scan the employee code at the counter. One meal of a type per person per day.</p></div></div>
      <div role="tablist" className="tabs-row">
        {([['counter', 'Counter'], ['register', 'Meal Register'], ['rates', 'Rate Master'], ['cost', 'Department Cost & Month']] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' primary' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'counter' ? (
        <>
          <div className="inline-form">
            <label>Employee code<input autoFocus value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void scan(); }} placeholder="Scan or type" style={{ fontSize: '1.4rem' }} /></label>
            <label>Meal<select value={meal} onChange={(e) => setMeal(e.target.value)}><option value="BREAKFAST">Breakfast</option><option value="LUNCH">Lunch</option><option value="DINNER">Dinner</option><option value="TEA">Tea / Snacks</option></select></label>
            <button type="button" className="btn primary" onClick={() => void scan()}>Serve</button>
          </div>
          {flash ? <p role={flash.ok ? 'status' : 'alert'} className={`rag ${flash.ok ? 'rag-green' : 'rag-red'}`} style={{ fontSize: '1.2rem', padding: '12px' }}>{flash.text}</p> : null}
          <div className="gate-rail">
            <section className="panel"><h3>Today</h3>{(today.data?.counts ?? []).map((c) => <p key={c.meal_type}>{c.meal_type}: <strong>{c.n}</strong></p>)}{(today.data?.counts ?? []).length === 0 ? <p className="muted">Nothing served yet.</p> : null}</section>
            <section className="panel"><h3>Last 5 served</h3>{(today.data?.last ?? []).map((c) => <p key={c.coupon_no}>{c.person_name} · {c.meal_type} · {when(c.served_at)}</p>)}</section>
          </div>
        </>
      ) : null}
      {tab === 'register' ? (
        <table className="register-table"><thead><tr><th>Coupon</th><th>Person</th><th>Meal</th><th>Date</th><th>Total</th><th>Employee</th><th>Company</th></tr></thead><tbody>
          {(reg.data ?? []).map((c) => <tr key={c.coupon_no}><td>{c.coupon_no}</td><td>{c.person_name}</td><td>{c.meal_type}</td><td>{day(c.date)}</td><td>{c.total}</td><td>{c.employee_share}</td><td>{c.company_share}</td></tr>)}
          {(reg.data ?? []).length === 0 ? <tr><td colSpan={7}>No meals this month.</td></tr> : null}
        </tbody></table>
      ) : null}
      {tab === 'rates' ? (
        <>
          <table className="register-table"><thead><tr><th>Plant</th><th>Meal</th><th>Rate</th><th>GST %</th><th>Employee share %</th><th>From</th></tr></thead><tbody>
            {(rates.data ?? []).map((r) => <tr key={r.id}><td>{r.unit_code}</td><td>{r.meal}</td><td>{r.rate}</td><td>{r.gst_pct}</td><td>{r.employee_share_pct}</td><td>{day(r.effective_from)}</td></tr>)}
          </tbody></table>
          <section className="panel"><h2>Set a rate</h2>
            <div className="inline-form">
              <label>Meal<select value={rf.mealType} onChange={(e) => setRf({ ...rf, mealType: e.target.value })}><option value="BREAKFAST">Breakfast</option><option value="LUNCH">Lunch</option><option value="DINNER">Dinner</option><option value="TEA">Tea / Snacks</option></select></label>
              <label>Rate<input inputMode="decimal" value={rf.rate} onChange={(e) => setRf({ ...rf, rate: e.target.value })} /></label>
              <label>GST %<input inputMode="decimal" value={rf.gstPct} onChange={(e) => setRf({ ...rf, gstPct: e.target.value })} /></label>
              <label>Employee share %<input inputMode="decimal" value={rf.employeeSharePct} onChange={(e) => setRf({ ...rf, employeeSharePct: e.target.value })} /></label>
              <button type="button" className="btn primary" onClick={() => void opsApi.setRate({ mealType: rf.mealType, rate: Number(rf.rate), gstPct: Number(rf.gstPct), employeeSharePct: Number(rf.employeeSharePct) }).then(() => { toast('Rate saved.'); rates.reload(); }, (e: unknown) => toast(errText(e)))}>Save</button>
            </div></section>
        </>
      ) : null}
      {tab === 'cost' ? (
        <>
          <table className="register-table"><thead><tr><th>Department</th><th>Meals</th><th>Total</th><th>Employee share</th><th>Company share</th></tr></thead><tbody>
            {(cost.data ?? []).map((c) => <tr key={c.department}><td>{c.department}</td><td>{c.meals}</td><td>{c.total}</td><td>{c.employee_share}</td><td>{c.company_share}</td></tr>)}
            {(cost.data ?? []).length === 0 ? <tr><td colSpan={5}>No meals this month.</td></tr> : null}
          </tbody></table>
          <section className="panel"><h2>Month close</h2>
            <p className="muted">Closing sends the employee share to payroll (CANTEEN_DED) and posts the company share to Staff Welfare.</p>
            <button type="button" className="btn primary" onClick={() => { if (window.confirm(`Close the canteen for ${month}?`)) void opsApi.closeMonth(month).then(() => { toast('Month closed.'); months.reload(); }, (e: unknown) => toast(errText(e))); }}>Close {month}</button>
            <table className="register-table"><thead><tr><th>Plant</th><th>Month</th><th>Status</th><th>Meals</th><th>Employee</th><th>Company</th></tr></thead><tbody>
              {(months.data ?? []).map((m) => <tr key={`${m.unit_code}${m.month}`}><td>{m.unit_code}</td><td>{m.month}</td><td>{m.status}</td><td>{m.meals ?? '—'}</td><td>{m.employee_total ?? '—'}</td><td>{m.company_total ?? '—'}</td></tr>)}
            </tbody></table></section>
        </>
      ) : null}
    </div>
  );
}
