// Phase 28 pages: Devices & Sync, Attendance Policies (with the automation log), Punch Sites, Live Attendance Board.
import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { api, ApiError } from '../../lib/api';
import { POLICY_TITLES, attApi, previewOf, type Policy } from '../../lib/attApi';
import { useLoad } from '../../lib/useLoad';

const errText = (e: unknown): string => {
  if (e instanceof ApiError) {
    const f = Object.values(e.fields ?? {});
    return f.length > 0 ? f.join(' ') : e.message;
  }
  return 'That did not work.';
};
const when = (v: string | null): string => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const DOT: Record<string, string> = { ONLINE: 'rag-green', STALE: 'rag-amber', OFFLINE: 'rag-red' };

function usePlants() {
  return useLoad(() => api<{ allowed: { id: string; code: string; name: string }[] }>('/me/plants'), []);
}

// ---------------------------------------------------------------------------------------------- Devices & Sync
export function DevicesPage() {
  const toast = useToast();
  const devices = useLoad(() => attApi.devices(), []);
  const agents = useLoad(() => attApi.agents(), []);
  const logs = useLoad(() => attApi.syncLogs(), []);
  const plants = usePlants();
  const [f, setF] = useState({ code: '', name: '', unitId: '', connection: 'PUSH', serialNo: '' });
  const [agentName, setAgentName] = useState('');
  const [key, setKey] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast(ok);
      devices.reload();
      agents.reload();
    } catch (e) {
      toast(errText(e));
    }
  }
  useEffect(() => {
    const t = window.setInterval(() => devices.reload(), 30_000);
    return () => window.clearInterval(t);
  }, [devices]);
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Devices & Sync</h1><p className="muted">Punches arrive from the machines by themselves. A device that sends nothing for 30 minutes turns amber, for 2 hours red.</p></div></div>
      {devices.error ? <p role="alert">{devices.error}</p> : null}
      <div className="gate-rail">
        {(devices.data ?? []).map((d) => (
          <article key={d.id} className="panel gate-card" aria-label={d.name}>
            <h3><span className={`rag ${DOT[d.status] ?? ''}`}>{d.status}</span> {d.name}</h3>
            <p className="muted">{d.unit_code} · {d.connection}{d.serial_no ? ` · ${d.serial_no}` : ''}</p>
            <p>Last punch {when(d.last_punch_at)} · today {d.today_punches}{d.unknown_codes > 0 ? ` · ${d.unknown_codes} unknown code(s)` : ''}</p>
          </article>
        ))}
        {!devices.loading && (devices.data ?? []).length === 0 ? <p className="muted">No devices yet. Add one below.</p> : null}
      </div>
      <section className="panel">
        <h2>Add a device</h2>
        <div className="inline-form">
          <label>Code<input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></label>
          <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>Plant<select value={f.unitId} onChange={(e) => setF({ ...f, unitId: e.target.value })}><option value="">Choose</option>{(plants.data?.allowed ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></label>
          <label>Connection<select value={f.connection} onChange={(e) => setF({ ...f, connection: e.target.value })}><option value="PUSH">Push (device sends)</option><option value="AGENT">Agent (plant PC)</option><option value="MANUAL">Manual upload</option></select></label>
          <label>Serial number<input value={f.serialNo} onChange={(e) => setF({ ...f, serialNo: e.target.value })} /></label>
          <button type="button" className="btn primary" onClick={() => void run(() => attApi.addDevice({ code: f.code, name: f.name, unitId: f.unitId, connection: f.connection, serialNo: f.serialNo || null }), 'Device registered.')}>Register</button>
        </div>
        <p className="muted">Push devices post to <code>/iclock/cdata</code> on this server. Set the server address and the device serial in the machine's cloud/ADMS settings.</p>
      </section>
      <section className="panel">
        <h2>Agents (plant PC)</h2>
        <div className="inline-form">
          <label>Name<input value={agentName} onChange={(e) => setAgentName(e.target.value)} /></label>
          <button type="button" className="btn" onClick={() => void attApi.addAgent({ unitId: f.unitId || plants.data?.allowed[0]?.id, name: agentName }).then((r) => { setKey(r.key); agents.reload(); }, (e: unknown) => toast(errText(e)))}>Create agent key</button>
        </div>
        {key ? <p role="status">Copy this key now. It is shown only once: <code>{key}</code></p> : null}
        <table className="register-table"><thead><tr><th>Name</th><th>Plant</th><th>Status</th><th>Last seen</th></tr></thead><tbody>
          {(agents.data ?? []).map((a) => <tr key={a.id}><td>{a.name}</td><td>{a.unit_code}</td><td>{a.status}</td><td>{when(a.last_seen_at)}</td></tr>)}
          {(agents.data ?? []).length === 0 ? <tr><td colSpan={4}>No agents.</td></tr> : null}
        </tbody></table>
      </section>
      <section className="panel">
        <h2>Sync log</h2>
        <table className="register-table"><thead><tr><th>When</th><th>Device</th><th>Received</th><th>New</th><th>Duplicates</th><th>Unknown codes</th></tr></thead><tbody>
          {(logs.data ?? []).map((l) => <tr key={l.id}><td>{when(l.at)}</td><td>{l.device ?? '—'}</td><td>{l.received}</td><td>{l.inserted}</td><td>{l.duplicates}</td><td>{l.unknown_codes}</td></tr>)}
          {(logs.data ?? []).length === 0 ? <tr><td colSpan={6}>Nothing received yet.</td></tr> : null}
        </tbody></table>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Policies + automation log
export function PoliciesPage() {
  const toast = useToast();
  const policies = useLoad(() => attApi.policies(), []);
  const plants = usePlants();
  const [unit, setUnit] = useState('');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const actions = useLoad(() => attApi.autoActions(month), [month]);
  const [edit, setEdit] = useState<Record<string, Record<string, string>>>({});

  const effective = (key: string): Policy | undefined => {
    const own = (policies.data ?? []).find((p) => p.policy_key === key && p.unit_id === (unit || null));
    return own ?? (policies.data ?? []).find((p) => p.policy_key === key && p.unit_id === null);
  };
  async function save(key: string, enabled: boolean, params?: Record<string, number>) {
    try {
      await attApi.setPolicy({ policyKey: key, unitId: unit || null, enabled, ...(params ? { params } : {}) });
      toast('Saved.');
      policies.reload();
    } catch (e) {
      toast(errText(e));
    }
  }
  const FIELDS: Record<string, { k: string; label: string }[]> = {
    LATE_MARK: [{ k: 'lates', label: 'Late marks' }, { k: 'deductDays', label: 'Deduct days' }],
    MISSED_PUNCH: [{ k: 'days', label: 'Days to regularise' }],
    AUTO_LOCK: [{ k: 'day', label: 'Lock day of next month' }, { k: 'hour', label: 'Hour (24 h)' }],
    MOBILE_PUNCH: [{ k: 'maxAccuracyM', label: 'Best GPS accuracy (m)' }],
  };
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Attendance Policies</h1><p className="muted">Every automatic change is recorded with a reason and can be reversed by HR. Nothing silently changes pay.</p></div></div>
      <div className="inline-form">
        <label>Applies to<select value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">All plants</option>{(plants.data?.allowed ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} only</option>)}</select></label>
      </div>
      {policies.error ? <p role="alert">{policies.error}</p> : null}
      <div className="gate-rail">
        {Object.keys(POLICY_TITLES).map((key) => {
          const p = effective(key);
          const params = { ...(p?.params ?? {}), ...Object.fromEntries(Object.entries(edit[key] ?? {}).map(([k, v]) => [k, Number(v)])) } as Record<string, number | boolean>;
          return (
            <article key={key} className="panel gate-card" aria-label={POLICY_TITLES[key]}>
              <h3>{POLICY_TITLES[key]}</h3>
              <label className="plant-remember"><input type="checkbox" checked={p?.enabled ?? false} onChange={(e) => void save(key, e.target.checked)} /> On{p && p.unit_id === null && unit ? ' (all plants)' : ''}</label>
              <p className="muted">{previewOf(key, params)}</p>
              {(FIELDS[key] ?? []).map((fld) => (
                <label key={fld.k}>{fld.label}<input inputMode="decimal" value={edit[key]?.[fld.k] ?? String(p?.params?.[fld.k] ?? '')} onChange={(e) => setEdit({ ...edit, [key]: { ...(edit[key] ?? {}), [fld.k]: e.target.value } })} /></label>
              ))}
              {FIELDS[key] ? <button type="button" className="btn" onClick={() => void save(key, p?.enabled ?? false, params as Record<string, number>)}>Save settings</button> : null}
            </article>
          );
        })}
      </div>
      <section className="panel">
        <h2>Automation log</h2>
        <label>Month<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
        <table className="register-table"><thead><tr><th>Date</th><th>Employee</th><th>Policy</th><th>Change</th><th>Reason</th><th /></tr></thead><tbody>
          {(actions.data ?? []).map((a) => (
            <tr key={a.id} className={a.reversed_at ? 'muted' : undefined}>
              <td>{a.action_date?.slice(0, 10)}</td><td>{a.employee} ({a.emp_code})</td><td>{POLICY_TITLES[a.policy_key] ?? a.policy_key}</td><td>{a.action.replace('_', ' ')}</td>
              <td>{a.reason}{a.reversed_at ? ` — reversed: ${a.reverse_reason}` : ''}</td>
              <td>{!a.reversed_at ? <button type="button" className="btn" onClick={() => { const reason = window.prompt('Reason to reverse this automatic change'); if (reason) void attApi.reverse(a.id, reason).then(() => { toast('Reversed.'); actions.reload(); }, (e: unknown) => toast(errText(e))); }}>Reverse</button> : null}</td>
            </tr>
          ))}
          {!actions.loading && (actions.data ?? []).length === 0 ? <tr><td colSpan={6}>No automatic changes this month.</td></tr> : null}
        </tbody></table>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Punch sites
export function PunchSitesPage() {
  const toast = useToast();
  const sites = useLoad(() => attApi.sites(), []);
  const plants = usePlants();
  const [f, setF] = useState({ unitId: '', name: '', lat: '', lng: '', radiusM: '200' });
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Punch Sites</h1><p className="muted">A person can punch from the phone only inside one of these circles.</p></div></div>
      <table className="register-table"><thead><tr><th>Plant</th><th>Site</th><th>Latitude</th><th>Longitude</th><th>Radius (m)</th></tr></thead><tbody>
        {(sites.data ?? []).map((s) => <tr key={s.id}><td>{s.unit_code}</td><td>{s.name}</td><td>{s.lat}</td><td>{s.lng}</td><td>{s.radius_m}</td></tr>)}
        {!sites.loading && (sites.data ?? []).length === 0 ? <tr><td colSpan={5}>No sites yet.</td></tr> : null}
      </tbody></table>
      <section className="panel">
        <h2>Add a site</h2>
        <div className="inline-form">
          <label>Plant<select value={f.unitId} onChange={(e) => setF({ ...f, unitId: e.target.value })}><option value="">Choose</option>{(plants.data?.allowed ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></label>
          <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>Latitude<input inputMode="decimal" value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} /></label>
          <label>Longitude<input inputMode="decimal" value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} /></label>
          <label>Radius (m)<input inputMode="numeric" value={f.radiusM} onChange={(e) => setF({ ...f, radiusM: e.target.value })} /></label>
          <button type="button" className="btn" onClick={() => navigator.geolocation?.getCurrentPosition((p) => setF((x) => ({ ...x, lat: String(p.coords.latitude), lng: String(p.coords.longitude) })), () => toast('Could not read your location.'))}>Use my location</button>
          <button type="button" className="btn primary" onClick={() => void attApi.addSite({ unitId: f.unitId, name: f.name, lat: Number(f.lat), lng: Number(f.lng), radiusM: Number(f.radiusM) }).then(() => { toast('Site added.'); sites.reload(); }, (e: unknown) => toast(errText(e)))}>Add</button>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Live board
export function LiveBoardPage() {
  const [unit, setUnit] = useState('');
  const plants = usePlants();
  const live = useLoad(() => attApi.live(unit || undefined), [unit]);
  useEffect(() => {
    const t = window.setInterval(() => live.reload(), 30_000);
    return () => window.clearInterval(t);
  }, [live]);
  const rows = live.data ?? [];
  const inside = rows.reduce((a, r) => a + r.inside, 0);
  const expected = rows.reduce((a, r) => a + r.expected, 0);
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Live Attendance Board</h1><p className="muted">Who is inside now. Refreshes every 30 seconds.</p></div></div>
      <div className="inline-form">
        <label>Plant<select value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">All chosen plants</option>{(plants.data?.allowed ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></label>
      </div>
      {live.error ? <p role="alert">{live.error}</p> : null}
      <p><strong>{inside}</strong> inside of <strong>{expected}</strong> expected{expected > 0 ? ` · ${(Math.round((inside / expected) * 1000) / 10).toFixed(1)} %` : ''}</p>
      <div className="gate-rail">
        {rows.map((r) => (
          <article key={`${r.unit_id}-${r.department}`} className="panel gate-card" aria-label={`${r.unit_code} ${r.department}`}>
            <h3>{r.department}</h3>
            <p className="muted">{r.unit_code}</p>
            <p style={{ fontSize: '1.6rem' }}><strong>{r.inside}</strong> / {r.expected}</p>
            <div className="progress"><div className="progress-bar" style={{ width: `${Math.min(100, Number(r.pct ?? 0))}%` }} /></div>
            <p className="muted">{r.pct === null ? '—' : `${r.pct} %`} present now</p>
          </article>
        ))}
        {!live.loading && rows.length === 0 ? <p className="muted">Nobody expected today in the chosen plants.</p> : null}
      </div>
    </div>
  );
}
