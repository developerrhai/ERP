// Phase 34 pages: Integrations & API Vault, Outbound Webhooks & dead-letter queue.
import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { api, ApiError } from '../../lib/api';
import { useLoad } from '../../lib/useLoad';

type Row = Record<string, unknown>;
interface Provider { provider: string; label: string; mode: 'DISABLED' | 'SANDBOX' | 'LIVE'; config: Record<string, unknown>; secrets: Record<string, string>; failStreak: number; lastTestedAt: string | null; lastTestStatus: string | null }
interface Delivery { id: string; endpoint: string; event_name: string; attempt: number; http_status: number | null; status: string; next_retry_at: string | null; last_error: string | null; created_at: string }
interface Endpoint { id: string; name: string; url: string; secret_last4: string | null; failure_count: number; status: string; dead_letters: number }

const errText = (e: unknown): string => {
  if (e instanceof ApiError) {
    const f = Object.values(e.fields ?? {});
    return f.length > 0 ? f.join(' ') : e.message;
  }
  return 'That did not work.';
};
const when = (v: string | null): string => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const MODE_CLASS: Record<string, string> = { DISABLED: '', SANDBOX: 'rag-amber', LIVE: 'rag-green' };
const SECRET_FIELDS: Record<string, string[]> = { GST_IRP: ['clientId', 'token'], GST_EWAY: ['clientId', 'token'], WHATSAPP: ['token', 'webhookSecret'], BANK_FEED: ['apiKey', 'webhookSecret'], SMTP_RELAY: ['password'] };

export function IntegrationsPage() {
  const toast = useToast();
  const list = useLoad(() => api<Provider[]>('/admin/integrations'), []);
  const logs = useLoad(() => api<Row[]>('/admin/integrations/logs'), []);
  const [edit, setEdit] = useState<{ p: Provider; mode: string; baseUrl: string; secrets: Record<string, string> } | null>(null);

  async function save() {
    if (!edit) return;
    try {
      const secrets = Object.fromEntries(Object.entries(edit.secrets).filter(([, v]) => v));
      await api(`/admin/integrations/${edit.p.provider}`, { method: 'PUT', body: { mode: edit.mode, config: edit.baseUrl ? { baseUrl: edit.baseUrl } : {}, secrets } });
      toast('Saved.');
      setEdit(null);
      list.reload();
    } catch (e) {
      toast(errText(e));
    }
  }
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Integrations & API Vault</h1><p className="muted">Nothing goes out to a government portal, bank or WhatsApp until a provider is set to Sandbox or Live. Secrets are kept encrypted and only the last 4 characters are ever shown.</p></div></div>
      {list.error ? <p role="alert">{list.error}</p> : null}
      <div className="gate-rail">
        {(list.data ?? []).map((p) => (
          <article key={p.provider} className="panel gate-card" aria-label={p.label}>
            <h3>{p.label}</h3>
            <p><span className={`rag ${MODE_CLASS[p.mode] ?? ''}`}>{p.mode}</span>{p.failStreak > 0 ? <span className="rag rag-red"> {p.failStreak} failures in a row</span> : null}</p>
            <p className="muted">{Object.keys(p.secrets).length > 0 ? Object.entries(p.secrets).map(([k, v]) => `${k} ${v}`).join(' · ') : 'No secrets saved'}</p>
            <p className="muted">Last test: {p.lastTestStatus ?? '—'} {p.lastTestedAt ? `· ${when(p.lastTestedAt)}` : ''}</p>
            <div className="row-actions">
              <button type="button" className="btn" onClick={() => setEdit({ p, mode: p.mode, baseUrl: String(p.config.baseUrl ?? ''), secrets: {} })}>Configure</button>
              <button type="button" className="btn" onClick={() => void api<{ ok: boolean; detail: string }>(`/admin/integrations/${p.provider}/test`, { method: 'POST', body: {} }).then((r) => { toast(`${r.ok ? 'Connected' : 'Not connected'}: ${r.detail}`); list.reload(); logs.reload(); }, (e: unknown) => toast(errText(e)))}>Test connection</button>
            </div>
          </article>
        ))}
      </div>
      <section className="panel"><h2>Recent calls</h2>
        <table className="register-table"><thead><tr><th>When</th><th>Provider</th><th>Direction</th><th>Request</th><th>Result</th><th>Status</th></tr></thead><tbody>
          {(logs.data ?? []).slice(0, 25).map((l) => <tr key={String(l.id)}><td>{when(String(l.created_at))}</td><td>{String(l.provider_code)}</td><td>{String(l.direction)}</td><td>{String(l.request_summary ?? '')}</td><td>{String(l.error_text ?? l.response_summary ?? '')}</td><td>{String(l.http_status ?? '—')}</td></tr>)}
          {(logs.data ?? []).length === 0 ? <tr><td colSpan={6}>No calls yet.</td></tr> : null}
        </tbody></table></section>
      {edit ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Configure integration"><div className="modal"><h2>{edit.p.label}</h2>
          <label>Mode<select value={edit.mode} onChange={(e) => setEdit({ ...edit, mode: e.target.value })}><option value="DISABLED">Disabled (JSON / file only)</option><option value="SANDBOX">Sandbox</option><option value="LIVE">Live</option></select></label>
          <label>Service address (https)<input value={edit.baseUrl} onChange={(e) => setEdit({ ...edit, baseUrl: e.target.value })} placeholder="Leave empty for the built-in sandbox" /></label>
          {(SECRET_FIELDS[edit.p.provider] ?? []).map((k) => (
            <label key={k}>{k} {edit.p.secrets[k] ? `(saved ${edit.p.secrets[k]})` : ''}<input type="password" autoComplete="off" value={edit.secrets[k] ?? ''} onChange={(e) => setEdit({ ...edit, secrets: { ...edit.secrets, [k]: e.target.value } })} placeholder="Type a new value to replace" /></label>
          ))}
          <div className="modal-actions"><button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button><button type="button" className="btn primary" onClick={() => void save()}>Save</button></div></div></div>
      ) : null}
    </div>
  );
}

export function WebhooksPage() {
  const toast = useToast();
  const eps = useLoad(() => api<Endpoint[]>('/admin/webhooks'), []);
  const [status, setStatus] = useState('DEAD_LETTER');
  const dels = useLoad(() => api<Delivery[]>(`/admin/webhooks/deliveries${status ? `?status=${status}` : ''}`), [status]);
  const [f, setF] = useState({ name: '', url: '', events: 'invoice.posted' });
  const [secret, setSecret] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast(ok);
      eps.reload();
      dels.reload();
    } catch (e) {
      toast(errText(e));
    }
  }
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Outbound Webhooks</h1><p className="muted">Each message is signed. A failed delivery is retried after 1, 2, 4 and 8 minutes; after the 5th failure it waits here in the dead-letter queue until you replay it.</p></div></div>
      {secret ? <p role="status">Copy this signing secret now (shown once): <code>{secret}</code></p> : null}
      <table className="register-table"><thead><tr><th>Name</th><th>Address</th><th>Secret</th><th>Failures</th><th>Dead letters</th><th>Status</th></tr></thead><tbody>
        {(eps.data ?? []).map((e) => <tr key={e.id}><td>{e.name}</td><td>{e.url}</td><td>{e.secret_last4 ? `••••${e.secret_last4}` : '—'}</td><td>{e.failure_count}</td><td>{e.dead_letters > 0 ? <span className="rag rag-red">{e.dead_letters}</span> : 0}</td><td>{e.status}</td></tr>)}
        {!eps.loading && (eps.data ?? []).length === 0 ? <tr><td colSpan={6}>No endpoints yet.</td></tr> : null}
      </tbody></table>
      <section className="panel"><h2>Add an endpoint</h2>
        <div className="inline-form">
          <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>Public https address<input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></label>
          <label>Events (comma separated)<input value={f.events} onChange={(e) => setF({ ...f, events: e.target.value })} /></label>
          <button type="button" className="btn primary" onClick={() => void run(() => api<{ plainSecret: string }>('/webhooks/endpoints', { method: 'POST', body: { name: f.name, url: f.url, events: f.events.split(',').map((x) => x.trim()).filter(Boolean) } }).then((r) => setSecret(r.plainSecret)), 'Endpoint added.')}>Add</button>
        </div></section>
      <section className="panel"><h2>Deliveries</h2>
        <div className="inline-form"><label>Show<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="DEAD_LETTER">Dead-letter queue</option><option value="RETRY">Retrying</option><option value="PENDING">Waiting</option><option value="DELIVERED">Delivered</option><option value="">All</option></select></label>
          <button type="button" className="btn" onClick={() => void run(() => api('/admin/webhooks/run', { method: 'POST', body: {} }), 'Sent what was due.')}>Send due now</button></div>
        <table className="register-table"><thead><tr><th>When</th><th>Endpoint</th><th>Event</th><th>Attempts</th><th>Result</th><th>Next try</th><th /></tr></thead><tbody>
          {(dels.data ?? []).map((d) => <tr key={d.id}><td>{when(d.created_at)}</td><td>{d.endpoint}</td><td>{d.event_name}</td><td>{d.attempt}</td><td>{d.http_status ?? '—'} {d.last_error ?? ''}</td><td>{when(d.next_retry_at)}</td>
            <td>{d.status === 'DEAD_LETTER' ? <button type="button" className="btn primary" onClick={() => void run(() => api(`/admin/webhooks/deliveries/${d.id}/replay`, { method: 'POST', body: {} }), 'Queued again.')}>Replay</button> : d.status}</td></tr>)}
          {!dels.loading && (dels.data ?? []).length === 0 ? <tr><td colSpan={7}>Nothing here.</td></tr> : null}
        </tbody></table></section>
    </div>
  );
}
