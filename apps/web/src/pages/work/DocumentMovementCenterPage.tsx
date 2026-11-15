// V40 page document-movement-center ("Department Mail & Attachment Center"): send ERP documents like e-mail attachments.
// "Send to Department Inbox" moves every attached document (a real department movement, POST /work/movements) and
// sends one internal message carrying all attachments (POST /mail/internal). Nothing is forwarded by itself.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import { docsMailApi, type CatalogEntry, type CatalogRecord, type MailRow } from '../../lib/docsMailApi';
import { workApi, type Dept } from '../../lib/workApi';

const PURPOSES = ['Review & Action', 'Approval Preparation', 'Technical Review', 'Commercial Review', 'Quality Review', 'Finance Processing', 'For Information', 'Revision / Correction'];
const PRIORITIES = ['Normal', 'High', 'Critical'] as const;
const DEFAULT_SUBJECT = 'Department Document • Review / Action';
const DEFAULT_MESSAGE = 'Please review the attached ERP document(s) and complete the required action.';

interface Attached {
  pageId: string;
  title: string;
  recordId: string;
  number: string;
}

const when = (iso: string): string => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function DocumentMovementCenterPage({ department }: { department?: string | null }) {
  const toast = useToast();
  const [depts, setDepts] = useState<Dept[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [managers, setManagers] = useState<{ id: string; name: string }[]>([]);
  const [manager, setManager] = useState('');
  const [priority, setPriority] = useState<string>('Normal');
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [requiredBy, setRequiredBy] = useState('');
  const [purpose, setPurpose] = useState(PURPOSES[0]!);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [docType, setDocType] = useState('');
  const [records, setRecords] = useState<CatalogRecord[]>([]);
  const [recordId, setRecordId] = useState('');
  const [attached, setAttached] = useState<Attached[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<MailRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    void workApi.departments().then((d) => {
      setDepts(d);
      const mine = d.find((x) => x.name === department) ?? d[0];
      if (mine) setFrom(mine.id);
      const other = d.find((x) => x.id !== mine?.id);
      if (other) setTo(other.id);
    }, () => setDepts([]));
    void docsMailApi.catalog().then((c) => {
      setCatalog(c);
      if (c[0]) setDocType(c[0].pageId);
    }, () => setCatalog([]));
  }, [department]);

  useEffect(() => {
    if (!to) {
      setManagers([]);
      return;
    }
    setManager('');
    void workApi.managers(to).then(setManagers, () => setManagers([]));
  }, [to]);

  useEffect(() => {
    if (!docType) return;
    setRecordId('');
    void docsMailApi.records(docType, '').then((r) => {
      setRecords(r);
      if (r[0]) setRecordId(r[0].id);
    }, () => setRecords([]));
  }, [docType]);

  // one tile per department: pending actions (needs action) of that inbox; recent messages = my sent mail
  useEffect(() => {
    let alive = true;
    for (const d of depts) {
      void workApi.counts(d.id).then((c) => alive && setCounts((cur) => ({ ...cur, [d.id]: c.needsAction + c.work })), () => undefined);
    }
    void docsMailApi.sent().then((m) => alive && setRecent(m.slice(0, 5)), () => undefined);
    return () => {
      alive = false;
    };
  }, [depts, tick]);

  const entry = useMemo(() => catalog.find((c) => c.pageId === docType), [catalog, docType]);

  function add(): void {
    const rec = records.find((r) => r.id === recordId);
    if (!entry || !rec) return;
    if (attached.some((a) => a.pageId === entry.pageId && a.recordId === rec.id)) {
      toast('That document is already attached.');
      return;
    }
    setAttached((cur) => [...cur, { pageId: entry.pageId, title: entry.title, recordId: rec.id, number: rec.number }]);
  }

  async function send(): Promise<void> {
    setError('');
    if (!to) return setError('Choose the department that receives the message.');
    if (attached.length === 0) return setError('Add at least one ERP document before sending.');
    setBusy(true);
    try {
      for (const a of attached) {
        await workApi.forward({
          docType: a.pageId,
          docId: a.recordId,
          docNo: a.number,
          toDepartmentId: to,
          assignedManagerId: manager || null,
          priority,
          requiredBy: requiredBy || null,
          handoverNote: `${purpose}: ${message || subject}`.slice(0, 500),
          ...(from ? { fromDepartmentId: from } : {}),
        });
      }
      await docsMailApi.sendInternal({
        fromDepartment: depts.find((d) => d.id === from)?.name ?? null,
        toDepartmentIds: [to],
        subject: subject || DEFAULT_SUBJECT,
        body: message || DEFAULT_MESSAGE,
        attachments: attached.map((a) => ({ label: `${a.title} ${a.number}`, pageId: a.pageId, recordId: a.recordId })),
      }).catch(() => undefined); // the movement is the record of truth; a department with nobody to mail still got the movement
      toast(`Sent to ${depts.find((d) => d.id === to)?.name ?? 'the department'} inbox.`);
      setAttached([]);
      setTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  const slug = (d: Dept): string => d.name.toLowerCase();
  return (
    <div className="dash-page">
      <div className="page-head">
        <div>
          <h1>Department Mail &amp; Attachment Center</h1>
          <p className="muted">Send ERP documents exactly like internal email attachments. The message moves; the original PO, BOM, Invoice, DC or other ERP record stays linked as an attachment.</p>
        </div>
        <div className="actions">
          <Link className="btn primary" to={`/m/dept-inbox-${department ? department.toLowerCase() : 'administration'}`}>
            Open My Inbox
          </Link>
        </div>
      </div>

      <div className="doc-move-grid">
        <section className="card" aria-label="New Department Message">
          <h3>New Department Message</h3>
          <p className="muted">Choose the destination department, write a short subject/message, attach one or more ERP documents, then send. The destination receives one inbox message with all attachments.</p>
          <div className="inline-form">
            <label>
              From Department
              <select value={from} onChange={(e) => setFrom(e.target.value)}>
                {depts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              To Department
              <select value={to} onChange={(e) => setTo(e.target.value)}>
                {depts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Responsible Manager
              <select value={manager} onChange={(e) => setManager(e.target.value)}>
                <option value="">Department Manager (anyone)</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                {PRIORITIES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label>
              Subject
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Document subject / action required" />
            </label>
            <label>
              Message
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
            </label>
            <label>
              Required By
              <input type="date" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} />
            </label>
            <label>
              Purpose
              <select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
                {PURPOSES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="card">
            <b>Attachments</b>
            <p className="muted">Attach Invoice, PO, BOM, GRN, DC, quotation, QC, project, HR or DMS documents.</p>
            <div className="inline-form">
              <label>
                Document Type
                <select value={docType} onChange={(e) => setDocType(e.target.value)}>
                  {catalog.map((c) => (
                    <option key={c.pageId} value={c.pageId}>
                      {`${c.title} • ${c.group}`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Document / Record
                <select value={recordId} onChange={(e) => setRecordId(e.target.value)}>
                  {records.length === 0 ? <option value="">No records of this type</option> : null}
                  {records.map((r) => (
                    <option key={r.id} value={r.id}>
                      {`${r.number} • ${r.status}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="actions">
              <button type="button" className="btn" disabled={!recordId} onClick={add}>
                + Add Attachment
              </button>
              <button type="button" className="btn" disabled={attached.length === 0} onClick={() => setAttached([])}>
                Clear Attachments
              </button>
            </div>
            {attached.length === 0 ? (
              <p className="work-note card">No attachment selected. Add at least one ERP document.</p>
            ) : (
              <ul>
                {attached.map((a) => (
                  <li key={`${a.pageId}-${a.recordId}`}>
                    {a.title} <b>{a.number}</b>{' '}
                    <button type="button" className="btn" onClick={() => setAttached((cur) => cur.filter((x) => x !== a))}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {error ? <p role="alert">{error}</p> : null}
          <button type="button" className="btn primary" disabled={busy} onClick={() => void send()}>
            Send to Department Inbox
          </button>
        </section>

        <div>
          <section className="card" aria-label="Department Inboxes">
            <h3>Department Inboxes</h3>
            <p className="muted">Every department uses the same inbox structure. Admin/Administration inbox is identical; Super User may additionally open other departments for oversight.</p>
            <div className="inbox-tiles">
              {depts.map((d) => (
                <Link key={d.id} className="btn card inbox-tile" to={`/m/dept-inbox-${slug(d)}`}>
                  <small>{counts[d.id] ?? 0} pending actions</small>
                  <b>{d.name} Inbox</b>
                </Link>
              ))}
            </div>
          </section>
          <section className="card" aria-label="Recent Messages">
            <h3>Recent Messages</h3>
            {recent.length === 0 ? (
              <p className="work-note card">No department messages yet.</p>
            ) : (
              <ul>
                {recent.map((m) => (
                  <li key={m.id}>
                    <b>{m.subject}</b> <span className="muted">→ {m.to_department ?? 'Department'} · {when(m.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
