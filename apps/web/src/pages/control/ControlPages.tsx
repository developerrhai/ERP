// Phase 31 pages: Custom Fields, Form Rules, Modules per Plant, Numbering, Sessions, Login Policies, View As, API Keys, System Health.
import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import { controlApi } from '../../lib/controlApi';
import { setViewAs } from '../../lib/viewAs';
import { useLoad } from '../../lib/useLoad';

const errText = (e: unknown): string => {
  if (e instanceof ApiError) {
    const f = Object.values(e.fields ?? {});
    return f.length > 0 ? f.join(' ') : e.message;
  }
  return 'That did not work.';
};
const when = (v: string | null): string => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

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
const PageBox = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <label>Page id<input value={value} onChange={(e) => onChange(e.target.value)} placeholder="for example scm-po" /></label>
);

export function CustomFieldsPage() {
  const [pageId, setPageId] = useState('scm-po');
  const list = useLoad(() => controlApi.fields(pageId), [pageId]);
  const run = useRun([() => list.reload()]);
  const [f, setF] = useState({ key: '', label: '', type: 'text', options: '', required: false });
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Custom Fields</h1><p className="muted">Add your own fields to any page (up to 50). They show in the form, the list and filter, the PDF, the Excel and the import. They are never used in money or tax calculations.</p></div></div>
      <div className="inline-form"><PageBox value={pageId} onChange={setPageId} /></div>
      {list.error ? <p role="alert">{list.error}</p> : null}
      <table className="register-table"><thead><tr><th>Key</th><th>Label</th><th>Type</th><th>Required</th><th>List</th><th>Filter</th><th>PDF</th><th>Excel</th><th>Active</th></tr></thead><tbody>
        {(list.data ?? []).map((d) => (
          <tr key={d.id}><td>{d.key}</td><td>{d.label}</td><td>{d.type}</td>
            {(['required', 'in_list', 'in_filter', 'in_pdf', 'in_excel', 'active'] as const).map((k) => (
              <td key={k}><input type="checkbox" checked={d[k]} onChange={(e) => void run(() => controlApi.updateField(d.id, { [k === 'in_list' ? 'inList' : k === 'in_filter' ? 'inFilter' : k === 'in_pdf' ? 'inPdf' : k === 'in_excel' ? 'inExcel' : k]: e.target.checked }), 'Saved.')} aria-label={`${d.label} ${k}`} /></td>
            ))}</tr>
        ))}
        {!list.loading && (list.data ?? []).length === 0 ? <tr><td colSpan={9}>No custom fields on this page.</td></tr> : null}
      </tbody></table>
      <section className="panel"><h2>Add a field</h2>
        <div className="inline-form">
          <label>Key (like drawing_no)<input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} /></label>
          <label>Label<input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></label>
          <label>Type<select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{['text', 'number', 'decimal', 'date', 'bool', 'select', 'multiselect'].map((t) => <option key={t}>{t}</option>)}</select></label>
          <label>Choices (comma separated, for select)<input value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} /></label>
          <label className="plant-remember"><input type="checkbox" checked={f.required} onChange={(e) => setF({ ...f, required: e.target.checked })} /> Required</label>
          <button type="button" className="btn primary" onClick={() => void run(() => controlApi.addField({ pageId, key: f.key, label: f.label, type: f.type, options: f.options ? f.options.split(',').map((x) => x.trim()).filter(Boolean) : undefined, required: f.required }), 'Field added.')}>Add</button>
        </div></section>
    </div>
  );
}

export function FormRulesPage() {
  const [pageId, setPageId] = useState('');
  const list = useLoad(() => controlApi.rules(pageId || undefined), [pageId]);
  const roles = useLoad(() => controlApi.roles(), []);
  const run = useRun([() => list.reload()]);
  const [f, setF] = useState({ pageId: '', fieldKey: '', effect: 'REQUIRED', roleId: '', status: '' });
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Form Rules</h1><p className="muted">By page, role and status: hide a field, make it read-only or required. The server enforces it even if the screen is bypassed. Fields the system needs cannot be hidden.</p></div></div>
      <div className="inline-form"><PageBox value={pageId} onChange={setPageId} /></div>
      <table className="register-table"><thead><tr><th>Page</th><th>Field</th><th>Effect</th><th>Role</th><th>Status</th><th /></tr></thead><tbody>
        {(list.data ?? []).map((r) => <tr key={r.id}><td>{r.page_id}</td><td>{r.field_key}</td><td>{r.effect}</td><td>{r.role ?? 'All'}</td><td>{r.status ?? 'All'}</td><td><button type="button" className="btn" onClick={() => void run(() => controlApi.deleteRule(r.id), 'Rule removed.')}>Remove</button></td></tr>)}
        {!list.loading && (list.data ?? []).length === 0 ? <tr><td colSpan={6}>No rules.</td></tr> : null}
      </tbody></table>
      <section className="panel"><h2>Add a rule</h2>
        <div className="inline-form">
          <PageBox value={f.pageId} onChange={(v) => setF({ ...f, pageId: v })} />
          <label>Field key<input value={f.fieldKey} onChange={(e) => setF({ ...f, fieldKey: e.target.value })} /></label>
          <label>Effect<select value={f.effect} onChange={(e) => setF({ ...f, effect: e.target.value })}><option>REQUIRED</option><option>READONLY</option><option>HIDDEN</option></select></label>
          <label>Role<select value={f.roleId} onChange={(e) => setF({ ...f, roleId: e.target.value })}><option value="">All roles</option>{(roles.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          <label>Status<input value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} placeholder="All (or Draft, Approved)" /></label>
          <button type="button" className="btn primary" onClick={() => void run(() => controlApi.addRule({ pageId: f.pageId, fieldKey: f.fieldKey, effect: f.effect, roleId: f.roleId || null, status: f.status || null }), 'Rule added.')}>Add</button>
        </div></section>
    </div>
  );
}

export function ModulePlantsPage() {
  const list = useLoad(() => controlApi.modules(), []);
  const plants = useLoad(() => controlApi.plants(), []);
  const run = useRun([() => list.reload()]);
  const [f, setF] = useState({ pageId: '', unitId: '' });
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Modules per Plant</h1><p className="muted">Off means gone from the menu, home, search and dashboards for that plant, and the server answers “{'{module}'} is turned off for {'{plant}'}”. Existing data stays.</p></div></div>
      <table className="register-table"><thead><tr><th>Page</th><th>Plant</th><th>Role</th><th>On</th></tr></thead><tbody>
        {(list.data ?? []).map((m) => <tr key={m.id}><td>{m.page_id}</td><td>{m.unit_code}</td><td>{m.role ?? 'All roles'}</td><td><input type="checkbox" checked={m.enabled} aria-label={`${m.page_id} ${m.unit_code}`} onChange={(e) => void run(() => controlApi.setModule({ pageId: m.page_id, unitId: (plants.data?.allowed ?? []).find((p) => p.code === m.unit_code)?.id, enabled: e.target.checked }), 'Saved.')} /></td></tr>)}
        {!list.loading && (list.data ?? []).length === 0 ? <tr><td colSpan={4}>Every module is on for every plant.</td></tr> : null}
      </tbody></table>
      <section className="panel"><h2>Switch a module off for a plant</h2>
        <div className="inline-form">
          <PageBox value={f.pageId} onChange={(v) => setF({ ...f, pageId: v })} />
          <label>Plant<select value={f.unitId} onChange={(e) => setF({ ...f, unitId: e.target.value })}><option value="">Choose</option>{(plants.data?.allowed ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></label>
          <button type="button" className="btn primary" onClick={() => void run(() => controlApi.setModule({ pageId: f.pageId, unitId: f.unitId, enabled: false }), 'Module switched off.')}>Switch off</button>
        </div></section>
    </div>
  );
}

export function NumberingPage() {
  const list = useLoad(() => controlApi.series(), []);
  const toast = useToast();
  const [f, setF] = useState({ prefix: 'INV/', padding: '5', plant: 'TAL', fy: '2627', gst: true });
  const [pv, setPv] = useState<{ preview: string; length: number; ok: boolean } | null>(null);
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Numbering</h1><p className="muted">A GST document number can be at most 16 characters.</p></div></div>
      <table className="register-table"><thead><tr><th>Page</th><th>Plant</th><th>Prefix</th><th>Next</th><th>Preview</th></tr></thead><tbody>
        {(list.data ?? []).map((s, i) => <tr key={i}><td>{String(s.page_id)}</td><td>{String(s.unit_code ?? 'All')}</td><td>{String(s.prefix ?? '')}</td><td>{String(s.next_value ?? '')}</td><td>{String(s.preview)}</td></tr>)}
      </tbody></table>
      <section className="panel"><h2>Preview a series</h2>
        <div className="inline-form">
          <label>Prefix<input value={f.prefix} onChange={(e) => setF({ ...f, prefix: e.target.value })} /></label>
          <label>Digits<input inputMode="numeric" value={f.padding} onChange={(e) => setF({ ...f, padding: e.target.value })} /></label>
          <label>Plant<input value={f.plant} onChange={(e) => setF({ ...f, plant: e.target.value })} /></label>
          <label>FY<input value={f.fy} onChange={(e) => setF({ ...f, fy: e.target.value })} /></label>
          <label className="plant-remember"><input type="checkbox" checked={f.gst} onChange={(e) => setF({ ...f, gst: e.target.checked })} /> GST document</label>
          <button type="button" className="btn primary" onClick={() => void controlApi.previewSeries({ prefix: f.prefix, padding: Number(f.padding), plant: f.plant, fy: f.fy, gst: f.gst }).then(setPv, (e: unknown) => toast(errText(e)))}>Preview</button>
        </div>
        {pv ? <p className={`rag ${pv.ok ? 'rag-green' : 'rag-red'}`}>{pv.preview} · {pv.length} characters{pv.ok ? '' : ' — too long for a GST document'}</p> : null}</section>
    </div>
  );
}

export function SessionsPage() {
  const list = useLoad(() => controlApi.sessions(), []);
  const run = useRun([() => list.reload()]);
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Sessions</h1><p className="muted">Everyone signed in now. Force logout ends a session at once.</p></div></div>
      <table className="register-table"><thead><tr><th>Person</th><th>Login</th><th>IP</th><th>Device</th><th>Started</th><th>Last seen</th><th /></tr></thead><tbody>
        {(list.data ?? []).map((s) => <tr key={s.id}><td>{s.name}</td><td>{s.login_id}</td><td>{s.ip ?? '—'}</td><td>{(s.user_agent ?? '').slice(0, 40)}</td><td>{when(s.created_at)}</td><td>{when(s.last_used_at)}</td><td><button type="button" className="btn" onClick={() => void run(() => controlApi.logout(s.id), 'Signed out.')}>Force logout</button></td></tr>)}
        {!list.loading && (list.data ?? []).length === 0 ? <tr><td colSpan={7}>Nobody is signed in.</td></tr> : null}
      </tbody></table>
    </div>
  );
}

export function LoginPoliciesPage() {
  const list = useLoad(() => controlApi.policies(), []);
  const roles = useLoad(() => controlApi.roles(), []);
  const run = useRun([() => list.reload()]);
  const [f, setF] = useState({ roleId: '', hoursFrom: '', hoursTo: '', ipCidrs: '' });
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Login Policies</h1><p className="muted">Sign-in hours (IST) and allowed IP ranges per role. Leave empty for no limit.</p></div></div>
      <table className="register-table"><thead><tr><th>Role</th><th>Hours</th><th>IP ranges</th></tr></thead><tbody>
        {(list.data ?? []).map((p) => <tr key={p.role_id}><td>{p.role}</td><td>{p.hours_from ? `${p.hours_from.slice(0, 5)}–${(p.hours_to ?? '').slice(0, 5)}` : 'Any time'}</td><td>{p.ip_cidrs.length > 0 ? p.ip_cidrs.join(', ') : 'Any address'}</td></tr>)}
        {!list.loading && (list.data ?? []).length === 0 ? <tr><td colSpan={3}>No policy set.</td></tr> : null}
      </tbody></table>
      <section className="panel"><h2>Set a policy</h2>
        <div className="inline-form">
          <label>Role<select value={f.roleId} onChange={(e) => setF({ ...f, roleId: e.target.value })}><option value="">Choose</option>{(roles.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          <label>From<input type="time" value={f.hoursFrom} onChange={(e) => setF({ ...f, hoursFrom: e.target.value })} /></label>
          <label>To<input type="time" value={f.hoursTo} onChange={(e) => setF({ ...f, hoursTo: e.target.value })} /></label>
          <label>IP ranges (comma separated)<input value={f.ipCidrs} onChange={(e) => setF({ ...f, ipCidrs: e.target.value })} placeholder="203.0.113.0/24" /></label>
          <button type="button" className="btn primary" onClick={() => void run(() => controlApi.setPolicy({ roleId: f.roleId, hoursFrom: f.hoursFrom || null, hoursTo: f.hoursTo || null, ipCidrs: f.ipCidrs ? f.ipCidrs.split(',').map((x) => x.trim()).filter(Boolean) : [] }), 'Policy saved.')}>Save</button>
        </div></section>
    </div>
  );
}

export function ViewAsPage() {
  const toast = useToast();
  const users = useLoad(() => controlApi.users(), []);
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  async function start() {
    try {
      const r = await controlApi.startViewAs(target, reason);
      setViewAs({ id: r.id, name: r.targetName });
      window.location.assign('/');
    } catch (e) {
      toast(errText(e));
    }
  }
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>View As</h1><p className="muted">See the ERP exactly as another person sees it. Read-only, for 30 minutes, with a red banner. A reason is needed and every use is audited.</p></div></div>
      <div className="inline-form">
        <label>Person<select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Choose</option>{(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.loginId})</option>)}</select></label>
        <label>Reason<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you looking?" /></label>
        <button type="button" className="btn primary" disabled={!target || reason.trim().length < 5} onClick={() => void start()}>Start</button>
      </div>
    </div>
  );
}

export function ApiKeysPage() {
  const list = useLoad(() => controlApi.keys(), []);
  const run = useRun([() => list.reload()]);
  const [name, setName] = useState('');
  const [shown, setShown] = useState<string | null>(null);
  const toast = useToast();
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>API Keys</h1><p className="muted">The key is shown once when created. Only a hash is kept.</p></div></div>
      {shown ? <p role="status">Copy this key now: <code>{shown}</code></p> : null}
      <div className="inline-form"><label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button type="button" className="btn primary" onClick={() => void controlApi.addKey({ name, scopes: ['read'] }).then((r) => { setShown(r.key); list.reload(); }, (e: unknown) => toast(errText(e)))}>Create key</button></div>
      <table className="register-table"><thead><tr><th>Name</th><th>Prefix</th><th>Created</th><th>Last used</th><th>Status</th><th /></tr></thead><tbody>
        {(list.data ?? []).map((k) => <tr key={k.id}><td>{k.name}</td><td>{k.prefix}</td><td>{when(k.created_at)}</td><td>{when(k.last_used_at)}</td><td>{k.revoked_at ? 'Revoked' : 'Active'}</td><td>{!k.revoked_at ? <button type="button" className="btn" onClick={() => void run(() => controlApi.revokeKey(k.id), 'Revoked.')}>Revoke</button> : null}</td></tr>)}
      </tbody></table>
    </div>
  );
}

export function HealthPage() {
  const h = useLoad(() => controlApi.health(), []);
  const cards = useLoad(() => controlApi.console(), []);
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>System Health</h1><p className="muted">Database speed, background job queues and the email queue.</p></div></div>
      {h.data ? <p>Database answered in <strong>{h.data.dbMs} ms</strong> · {h.data.emailPending} email(s) waiting · {when(h.data.time)}</p> : null}
      <div className="gate-rail">
        {Object.entries(cards.data ?? {}).map(([k, v]) => <article key={k} className="panel gate-card"><p className="muted">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</p><p style={{ fontSize: '1.6rem' }}><strong>{v}</strong></p></article>)}
      </div>
      <table className="register-table"><thead><tr><th>Queue</th><th>Waiting</th><th>Failed</th></tr></thead><tbody>
        {(h.data?.queues ?? []).map((q) => <tr key={q.name}><td>{q.name}</td><td>{q.waiting}</td><td><span className={`rag ${q.failed > 0 ? 'rag-red' : 'rag-green'}`}>{q.failed}</span></td></tr>)}
        {(h.data?.queues ?? []).length === 0 ? <tr><td colSpan={3}>No queue data.</td></tr> : null}
      </tbody></table>
    </div>
  );
}
