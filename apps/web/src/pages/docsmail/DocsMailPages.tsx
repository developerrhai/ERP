// Phase 27 pages: Document Center, Department Mail, Mail Automation, Quality Certificates, Offer & Appointment Letters.
import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { api, ApiError } from '../../lib/api';
import {
  PRINT_CHOICES,
  docsMailApi,
  saveFile,
  type Automation,
  type CatalogEntry,
  type CatalogRecord,
  type MailRow,
  type PrintKind,
} from '../../lib/docsMailApi';
import { useLoad } from '../../lib/useLoad';

const errText = (e: unknown): string => {
  if (e instanceof ApiError) {
    const f = Object.values(e.fields ?? {});
    return f.length > 0 ? f.join(' ') : e.message;
  }
  return 'That did not work.';
};
const when = (v: string | null): string => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

/** "Print ▾": Standard / Letterhead / Commercial PDF, Word, Excel. */
export function PrintButtons({ pageId, id }: { pageId: string; id: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <span className="print-menu">
      <button type="button" className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>Print ▾</button>
      {open ? (
        <ul role="menu" className="print-menu-list">
          {PRINT_CHOICES.map((c) => (
            <li key={c.kind} role="none">
              <button
                type="button"
                role="menuitem"
                className="btn"
                onClick={() => {
                  setOpen(false);
                  void docsMailApi.print(pageId, id, c.kind as PrintKind).then((f) => saveFile(f, `document.${c.kind === 'word' ? 'docx' : c.kind === 'excel' ? 'xlsx' : 'pdf'}`), (e: unknown) => toast(errText(e)));
                }}
              >{c.label}</button>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------- Document Center
export function DocumentCenterPage() {
  const toast = useToast();
  const cat = useLoad<CatalogEntry[]>(() => docsMailApi.catalog(), []);
  const depts = useLoad(() => docsMailApi.departments(), []);
  const [type, setType] = useState<CatalogEntry | null>(null);
  const [q, setQ] = useState('');
  const [records, setRecords] = useState<CatalogRecord[]>([]);
  const [picked, setPicked] = useState<CatalogRecord | null>(null);
  const [to, setTo] = useState('');
  useEffect(() => {
    if (!type) return;
    let alive = true;
    void docsMailApi.records(type.pageId, q).then((r) => alive && setRecords(r), (e: unknown) => alive && toast(errText(e)));
    return () => {
      alive = false;
    };
  }, [type, q, toast]);
  const groups = new Map<string, CatalogEntry[]>();
  for (const c of cat.data ?? []) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Document Center</h1><p className="muted">Pick a document type, then a record. Print it in 5 formats, or send it to a department.</p></div></div>
      {cat.error ? <p role="alert">{cat.error}</p> : null}
      <div className="doc-center">
        <nav aria-label="Document types">
          {[...groups.entries()].map(([g, items]) => (
            <section key={g}>
              <h3>{g}</h3>
              {items.map((c) => (
                <button key={c.pageId} type="button" className={`btn${type?.pageId === c.pageId ? ' primary' : ''}`} onClick={() => { setType(c); setPicked(null); setQ(''); }}>
                  {c.title} <span className="muted">({c.count})</span>
                </button>
              ))}
            </section>
          ))}
        </nav>
        <section aria-label="Records">
          {type ? (
            <>
              <h2>{type.title}</h2>
              <label>Search<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number" /></label>
              <table className="register-table">
                <thead><tr><th>Number</th><th>Status</th><th>Date</th><th /></tr></thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id} className={picked?.id === r.id ? 'selected' : undefined}>
                      <td>{r.number}</td><td>{r.status}</td><td>{r.date ? String(r.date).slice(0, 10) : '—'}</td>
                      <td><button type="button" className="btn" onClick={() => setPicked(r)}>Select</button></td>
                    </tr>
                  ))}
                  {records.length === 0 ? <tr><td colSpan={4}>No records.</td></tr> : null}
                </tbody>
              </table>
            </>
          ) : <p className="muted">Choose a document type on the left.</p>}
        </section>
        <aside aria-label="Actions">
          {picked && type ? (
            <div className="panel">
              <h3>{type.title} {picked.number}</h3>
              <PrintButtons pageId={type.pageId} id={picked.id} />
              <label>Send to department
                <select value={to} onChange={(e) => setTo(e.target.value)}>
                  <option value="">Choose a department</option>
                  {(depts.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <button
                type="button"
                className="btn primary"
                disabled={!to}
                onClick={() => void docsMailApi.sendToDept({ pageId: type.pageId, recordId: picked.id, docNo: picked.number, toDepartmentId: to }).then(() => toast('Sent to the department.'), (e: unknown) => toast(errText(e)))}
              >Send to Department</button>
            </div>
          ) : <p className="muted">Select a record to print or send it.</p>}
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Department Mail
export function DeptMailPage() {
  const toast = useToast();
  const [tab, setTab] = useState<'compose' | 'inbox' | 'sent'>('inbox');
  const inbox = useLoad<MailRow[]>(() => docsMailApi.inbox(), []);
  const sent = useLoad<MailRow[]>(() => docsMailApi.sent(), []);
  const depts = useLoad(() => docsMailApi.departments(), []);
  const [form, setForm] = useState({ toDept: '', external: '', subject: 'Department Document • Review / Action', body: 'Please review the attached ERP document(s) and complete the required action.' });
  const [open, setOpen] = useState<MailRow | null>(null);

  async function submit() {
    try {
      if (form.external.trim()) {
        const r = await docsMailApi.sendExternal({ to: form.external.split(/[,;\s]+/).filter(Boolean), subject: form.subject, body: form.body });
        toast(`Queued for ${r.queued} address(es).`);
      } else {
        await docsMailApi.sendInternal({ toDepartmentIds: form.toDept ? [form.toDept] : [], subject: form.subject, body: form.body });
        toast('Sent.');
      }
      sent.reload();
      setTab('sent');
    } catch (e) {
      toast(errText(e));
    }
  }
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Department Mail</h1><p className="muted">Mail between departments, and to outside addresses.</p></div></div>
      <div role="tablist" className="tabs-row">
        {(['inbox', 'sent', 'compose'] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={`btn${tab === t ? ' primary' : ''}`} onClick={() => setTab(t)}>{t === 'compose' ? 'Compose' : t === 'inbox' ? 'Inbox' : 'Sent'}</button>)}
      </div>
      {tab === 'compose' ? (
        <div className="panel">
          <label>To department
            <select value={form.toDept} onChange={(e) => setForm({ ...form, toDept: e.target.value })}>
              <option value="">Choose a department</option>
              {(depts.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label>Or outside email address(es)<input value={form.external} onChange={(e) => setForm({ ...form, external: e.target.value })} placeholder="name@company.com" /></label>
          <label>Subject<input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></label>
          <label>Message<textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></label>
          <button type="button" className="btn primary" onClick={() => void submit()}>Send</button>
        </div>
      ) : (
        <table className="register-table">
          <thead><tr><th>{tab === 'inbox' ? 'From' : 'To'}</th><th>Subject</th><th>When</th><th>{tab === 'inbox' ? 'Files' : 'Read by'}</th></tr></thead>
          <tbody>
            {((tab === 'inbox' ? inbox.data : sent.data) ?? []).map((m) => (
              <tr key={m.id} className={tab === 'inbox' && !m.read ? 'unread' : undefined} onClick={() => void docsMailApi.open(m.id).then((x) => { setOpen(x); inbox.reload(); }, (e: unknown) => toast(errText(e)))}>
                <td>{tab === 'inbox' ? `${m.from_name ?? ''} ${m.from_department ? `(${m.from_department})` : ''}` : m.to_department}</td>
                <td>{tab === 'inbox' && !m.read ? <strong>{m.subject}</strong> : m.subject}</td>
                <td>{when(m.created_at)}</td>
                <td>{tab === 'inbox' ? (typeof m.attachments === 'number' ? m.attachments : '') : `${m.read_by ?? 0} of ${m.recipients ?? 0}`}</td>
              </tr>
            ))}
            {((tab === 'inbox' ? inbox.data : sent.data) ?? []).length === 0 ? <tr><td colSpan={4}>No mail.</td></tr> : null}
          </tbody>
        </table>
      )}
      {open ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Message">
          <div className="modal">
            <h2>{open.subject}</h2>
            <p className="muted">{open.from_name} · {when(open.created_at)}</p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{open.body}</p>
            {Array.isArray(open.attachments) && open.attachments.length > 0 ? <ul>{open.attachments.map((a, i) => <li key={i}>{a.label}</li>)}</ul> : null}
            <div className="modal-actions"><button type="button" className="btn" onClick={() => setOpen(null)}>Close</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Mail Automation
export function MailAutomationPage() {
  const toast = useToast();
  const list = useLoad<Automation[]>(() => docsMailApi.automations(), []);
  const plants = useLoad(() => api<{ allowed: { id: string; code: string; name: string }[] }>('/me/plants'), []);
  const [edit, setEdit] = useState<Automation | null>(null);
  const [draft, setDraft] = useState({ subject: '', body: '', runTime: '', offsetDays: '' });
  const [runs, setRuns] = useState<{ code: string; rows: Awaited<ReturnType<typeof docsMailApi.runs>> } | null>(null);

  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast(ok);
      list.reload();
    } catch (e) {
      toast(errText(e));
    }
  }
  const groups = new Map<string, Automation[]>();
  for (const a of list.data ?? []) groups.set(a.module, [...(groups.get(a.module) ?? []), a]);
  return (
    <div className="dash-page">
      <div className="page-head"><div><h1>Mail Automation</h1><p className="muted">40 ready automations. Switch each on or off, edit its wording and timing, switch it off for one plant, and send a test to yourself. Automations marked “Planned” need a later phase to start by themselves.</p></div></div>
      {list.error ? <p role="alert">{list.error}</p> : null}
      {[...groups.entries()].map(([module, items]) => (
        <section key={module} className="panel">
          <h2>{module}</h2>
          <div className="automation-grid">
            {items.map((a) => (
              <article key={a.code} className="panel automation-card" aria-label={a.name}>
                <h3>{a.seq}. {a.name} <span className={`rag ${a.wired ? 'rag-green' : ''}`}>{a.wired ? (a.p21_rule_code ? 'Phase 21' : 'Live') : 'Planned'}</span></h3>
                <p className="muted">{a.trigger_text} → {a.recipients_text}{a.attachment_text ? ` · ${a.attachment_text}` : ''}</p>
                <label className="plant-remember"><input type="checkbox" checked={a.enabled} onChange={(e) => void run(() => docsMailApi.updateAutomation(a.code, { enabled: e.target.checked }), e.target.checked ? 'Switched on.' : 'Switched off.')} /> On</label>
                {a.run_time ? <p className="muted">Time: {a.run_time === '*' ? 'hourly check' : a.run_time}{a.offset_days !== null ? ` · ${a.offset_days} day(s)` : ''}</p> : null}
                <p className="muted">Sent {a.sent_count} · last run {when(a.last_run)}</p>
                {(plants.data?.allowed ?? []).length > 1 ? (
                  <div className="row-actions">
                    {(plants.data?.allowed ?? []).map((p) => {
                      const o = a.plants.find((x) => x.unitId === p.id);
                      const on = o ? o.enabled : true;
                      return <label key={p.id} className="plant-remember"><input type="checkbox" checked={on} onChange={(e) => void run(() => docsMailApi.setPlant(a.code, p.id, e.target.checked), `${p.code} ${e.target.checked ? 'on' : 'off'}.`)} /> {p.code}</label>;
                    })}
                  </div>
                ) : null}
                <div className="row-actions">
                  <button type="button" className="btn" onClick={() => { setEdit(a); setDraft({ subject: a.subject_tpl ?? a.defaults?.subject ?? '', body: a.body_tpl ?? a.defaults?.body ?? '', runTime: a.run_time ?? '', offsetDays: a.offset_days === null ? '' : String(a.offset_days) }); }}>Edit template</button>
                  <button type="button" className="btn" onClick={() => void docsMailApi.testAutomation(a.code).then((r) => toast(`Test queued to ${r.to}.`), (e: unknown) => toast(errText(e)))}>Send test to me</button>
                  <button type="button" className="btn" onClick={() => void docsMailApi.runs(a.code).then((rows) => setRuns({ code: a.code, rows }), (e: unknown) => toast(errText(e)))}>Last runs</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
      {edit ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit automation">
          <div className="modal">
            <h2>{edit.name}</h2>
            <p className="muted">Merge fields: {'{{doc_no}} {{party}} {{due_date}} {{detail}} {{date}} {{result}}'}</p>
            <label>Subject<input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></label>
            <label>Message<textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></label>
            {edit.trigger_kind !== 'EVENT' ? <label>Time (24 h, like 09:00)<input value={draft.runTime} onChange={(e) => setDraft({ ...draft, runTime: e.target.value })} /></label> : null}
            {edit.trigger_kind === 'DATE' ? <label>Days (before is negative)<input inputMode="numeric" value={draft.offsetDays} onChange={(e) => setDraft({ ...draft, offsetDays: e.target.value })} /></label> : null}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button>
              <button type="button" className="btn primary" onClick={() => void run(() => docsMailApi.updateAutomation(edit.code, { subjectTpl: draft.subject || null, bodyTpl: draft.body || null, ...(edit.trigger_kind !== 'EVENT' ? { runTime: draft.runTime || null } : {}), ...(edit.trigger_kind === 'DATE' && draft.offsetDays !== '' ? { offsetDays: Number(draft.offsetDays) } : {}) }).then(() => setEdit(null)), 'Saved.')}>Save</button>
            </div>
          </div>
        </div>
      ) : null}
      {runs ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Runs">
          <div className="modal">
            <h2>Last runs</h2>
            <table className="register-table"><thead><tr><th>When</th><th>Status</th><th>Plant</th><th>Document</th><th>To</th></tr></thead>
              <tbody>{runs.rows.map((r) => <tr key={r.id}><td>{when(r.at)}</td><td>{r.status}{r.reason ? ` · ${r.reason}` : ''}</td><td>{r.unit_code ?? '—'}</td><td>{r.doc_no ?? '—'}</td><td>{r.recipients}</td></tr>)}{runs.rows.length === 0 ? <tr><td colSpan={5}>No runs yet.</td></tr> : null}</tbody></table>
            <div className="modal-actions"><button type="button" className="btn" onClick={() => setRuns(null)}>Close</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Quality Certificates
export function CertificatesPage() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const list = useLoad(() => docsMailApi.certificates(q || undefined), [q]);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ partName: '', partCode: '', jobCardNo: '', sampleQty: '', acceptedQty: '', rejectedQty: '', drawingRevision: '', inspector: '', result: 'Pass', ncrNo: '', remarks: '' });
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
      <div className="page-head"><div><h1>Quality Certificates</h1><p className="muted">A certificate is released by a different person from the one who made it.</p></div><button type="button" className="btn primary" onClick={() => setAdding(true)}>＋ Add</button></div>
      <label>Search<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number, part or job card" /></label>
      <table className="register-table">
        <thead><tr><th>Number</th><th>Part</th><th>Job card</th><th>Sample / Acc / Rej</th><th>Result</th><th>Release</th><th /></tr></thead>
        <tbody>
          {(list.data ?? []).map((c) => (
            <tr key={c.id}>
              <td>{c.number}</td><td>{c.part_code ? `${c.part_code} · ` : ''}{c.part_name}</td><td>{c.job_card_no ?? '—'}</td><td>{c.sample_qty} / {c.accepted_qty} / {c.rejected_qty}</td>
              <td><span className={`rag ${c.result === 'Pass' ? 'rag-green' : c.result === 'Fail' ? 'rag-red' : 'rag-amber'}`}>{c.result}</span></td><td>{c.quality_approval}</td>
              <td className="row-actions">
                {c.quality_approval === 'Pending' ? <><button type="button" className="btn primary" onClick={() => void run(() => docsMailApi.certAction(c.id, 'approve'), 'Released.')}>Release</button><button type="button" className="btn" onClick={() => void run(() => docsMailApi.certAction(c.id, 'reject'), 'Rejected.')}>Reject</button></> : null}
                <PrintButtons pageId="quality-certificate" id={c.id} />
              </td>
            </tr>
          ))}
          {!list.loading && (list.data ?? []).length === 0 ? <tr><td colSpan={7}>No certificates yet.</td></tr> : null}
        </tbody>
      </table>
      {adding ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Add certificate">
          <div className="modal">
            <h2>New certificate</h2>
            {([['partName', 'Part name'], ['partCode', 'Part code'], ['jobCardNo', 'Job card no.'], ['sampleQty', 'Sample qty'], ['acceptedQty', 'Accepted qty'], ['rejectedQty', 'Rejected qty'], ['drawingRevision', 'Drawing revision'], ['inspector', 'Inspector'], ['ncrNo', 'NCR no. (needed when it fails)'], ['remarks', 'Remarks']] as const).map(([k, l]) => (
              <label key={k}>{l}<input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
            ))}
            <label>Result<select value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}><option>Pass</option><option>Fail</option><option>Conditional</option></select></label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>
              <button type="button" className="btn primary" onClick={() => void run(() => docsMailApi.addCertificate({ partName: f.partName, partCode: f.partCode || null, jobCardNo: f.jobCardNo || null, sampleQty: Number(f.sampleQty || 0), acceptedQty: Number(f.acceptedQty || 0), rejectedQty: Number(f.rejectedQty || 0), drawingRevision: f.drawingRevision || null, inspector: f.inspector || null, result: f.result, ncrNo: f.ncrNo || null, remarks: f.remarks || null }).then(() => setAdding(false)), 'Certificate saved.')}>Save</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Letters
export function LettersPage() {
  const toast = useToast();
  const list = useLoad(() => docsMailApi.letters(), []);
  const templates = useLoad(() => docsMailApi.letterTemplates(), []);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ templateCode: 'OFFER', personName: '', personEmail: '', designation: '', department: '', gross: '', joining_date: '' });
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
      <div className="page-head"><div><h1>Offer & Appointment Letters</h1><p className="muted">Made from an approved template. A letter is issued only after a different person approves it.</p></div><button type="button" className="btn primary" onClick={() => setAdding(true)}>＋ Add</button></div>
      <table className="register-table">
        <thead><tr><th>Number</th><th>Letter</th><th>Person</th><th>Status</th><th>Emailed</th><th /></tr></thead>
        <tbody>
          {(list.data ?? []).map((l) => (
            <tr key={l.id}>
              <td>{l.number}</td><td>{l.template_code === 'OFFER' ? 'Offer' : 'Appointment'}</td><td>{l.person_name}</td><td>{l.status}</td><td>{when(l.emailed_at)}</td>
              <td className="row-actions">
                {l.status === 'Draft' ? <button type="button" className="btn" onClick={() => void run(() => docsMailApi.letterAction(l.id, 'approve'), 'Approved.')}>Approve</button> : null}
                {l.status === 'Approved' ? <button type="button" className="btn primary" onClick={() => void run(() => docsMailApi.letterAction(l.id, 'issue'), 'Issued.')}>Issue</button> : null}
                {l.status === 'Issued' ? <button type="button" className="btn" onClick={() => void run(() => docsMailApi.letterAction(l.id, 'email'), 'Emailed.')}>Email</button> : null}
                <PrintButtons pageId="hr-offer-letter" id={l.id} />
              </td>
            </tr>
          ))}
          {!list.loading && (list.data ?? []).length === 0 ? <tr><td colSpan={6}>No letters yet.</td></tr> : null}
        </tbody>
      </table>
      {adding ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Add letter">
          <div className="modal">
            <h2>New letter</h2>
            <label>Template<select value={f.templateCode} onChange={(e) => setF({ ...f, templateCode: e.target.value })}>{(templates.data ?? []).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select></label>
            {([['personName', 'Person name'], ['personEmail', 'Email'], ['designation', 'Designation'], ['department', 'Department'], ['gross', 'Monthly gross'], ['joining_date', 'Joining date']] as const).map(([k, l]) => <label key={k}>{l}<input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>
              <button type="button" className="btn primary" onClick={() => void run(() => docsMailApi.addLetter({ templateCode: f.templateCode, personName: f.personName, personEmail: f.personEmail || null, data: { designation: f.designation, department: f.department, gross: f.gross, joining_date: f.joining_date } }).then(() => setAdding(false)), 'Letter saved.')}>Save</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
