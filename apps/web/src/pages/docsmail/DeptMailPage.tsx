// Department Mail (QA FIN-01): the Demo ERP "Department Mail & Attachment Center". The compose form is laid out in clear rows
// (To / Subject / Message / ERP Document Attachments) with red field errors; "+ Add Attachment" picks real ERP documents
// (type -> record -> format); the right side shows the Department Inboxes and the Recent Messages.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import { docsMailApi, type CatalogRecord, type MailRow } from '../../lib/docsMailApi';
import { EMAIL_RE } from '../../lib/validators';
import { useLoad } from '../../lib/useLoad';

const errText = (e: unknown): string => {
  if (e instanceof ApiError) {
    const f = Object.values(e.fields ?? {});
    return f.length > 0 ? f.join(' ') : e.message;
  }
  return 'That did not work.';
};
const when = (v: string | null): string =>
  v
    ? new Date(v).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

type Format = 'pdf' | 'word' | 'excel';
interface Attached {
  label: string;
  pageId: string;
  recordId: string;
  format: Format;
}
const FORMAT_LABEL: Record<Format, string> = { pdf: 'PDF', word: 'Word', excel: 'Excel' };
const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const RED = { borderColor: '#dc2626', background: '#fef2f2' } as const;

export function DeptMailPage() {
  const toast = useToast();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<'compose' | 'inbox' | 'sent'>(
    params.get('compose') ? 'compose' : 'inbox',
  );
  const inbox = useLoad<MailRow[]>(() => docsMailApi.inbox(), []);
  const sent = useLoad<MailRow[]>(() => docsMailApi.sent(), []);
  const depts = useLoad(() => docsMailApi.departments(), []);
  const catalog = useLoad(() => docsMailApi.catalog(), []);
  const [form, setForm] = useState({
    toDept: '',
    external: '',
    subject: 'Department Document • Review / Action',
    body: 'Please review the attached ERP document(s) and complete the required action.',
  });
  const [open, setOpen] = useState<MailRow | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [attached, setAttached] = useState<Attached[]>([]);
  // the "+ Add Attachment" picker
  const [pick, setPick] = useState({ pageId: '', q: '', recordId: '', format: 'pdf' as Format });
  const [records, setRecords] = useState<CatalogRecord[]>([]);
  const [pickError, setPickError] = useState('');

  const externals = form.external.split(/[,;\s]+/).filter(Boolean);
  const problems: Record<string, string> = {};
  if (!form.toDept && externals.length === 0)
    problems.to = 'Choose a department or type an outside email address.';
  const badMail = externals.find((a) => !EMAIL_RE.test(a));
  if (badMail) problems.external = `"${badMail}" is not a valid email address.`;
  if (!form.subject.trim()) problems.subject = 'Subject is required.';
  if (!form.body.trim()) problems.body = 'Message is required.';
  const shown = submitted ? problems : {};
  const bad = (k: string) =>
    shown[k] ? ({ 'aria-invalid': true, style: RED } as const) : ({} as const);

  async function loadRecords(pageId: string, q: string) {
    setPick((p) => ({ ...p, pageId, q, recordId: '' }));
    setPickError('');
    if (!pageId) {
      setRecords([]);
      return;
    }
    try {
      setRecords(await docsMailApi.records(pageId, q));
    } catch (e) {
      setRecords([]);
      setPickError(errText(e));
    }
  }

  function addAttachment() {
    const rec = records.find((r) => r.id === pick.recordId);
    const entry = (catalog.data ?? []).find((c) => c.pageId === pick.pageId);
    if (!rec || !entry) {
      setPickError('Choose a document type and a record first.');
      return;
    }
    if (attached.some((a) => a.recordId === rec.id && a.format === pick.format)) {
      setPickError('This document is already attached in that format.');
      return;
    }
    if (attached.length >= 10) {
      setPickError('At most 10 documents can be attached.');
      return;
    }
    setAttached((a) => [
      ...a,
      {
        label: `${entry.title} ${rec.number} (${FORMAT_LABEL[pick.format]})`,
        pageId: pick.pageId,
        recordId: rec.id,
        format: pick.format,
      },
    ]);
    setPick((p) => ({ ...p, recordId: '' }));
    setPickError('');
  }

  async function submit() {
    setSubmitted(true);
    if (Object.keys(problems).length > 0) return;
    try {
      if (externals.length > 0) {
        const r = await docsMailApi.sendExternal({
          to: externals,
          subject: form.subject,
          body: form.body,
        });
        toast(`Queued for ${r.queued} address(es).`);
      } else {
        await docsMailApi.sendInternal({
          toDepartmentIds: form.toDept ? [form.toDept] : [],
          subject: form.subject,
          body: form.body,
          ...(attached.length
            ? {
                attachments: attached.map((a) => ({
                  label: a.label,
                  pageId: a.pageId,
                  recordId: a.recordId,
                  format: a.format,
                })),
              }
            : {}),
        });
        toast(
          `Sent${attached.length ? ` with ${attached.length} ERP document${attached.length === 1 ? '' : 's'}` : ''}.`,
        );
      }
      setAttached([]);
      setSubmitted(false);
      sent.reload();
      setTab('sent');
    } catch (e) {
      toast(errText(e));
    }
  }

  const recent = useMemo(
    () =>
      [
        ...(inbox.data ?? []).map((m) => ({ m, dir: 'In' as const })),
        ...(sent.data ?? []).map((m) => ({ m, dir: 'Out' as const })),
      ]
        .sort((a, b) => b.m.created_at.localeCompare(a.m.created_at))
        .slice(0, 5),
    [inbox.data, sent.data],
  );
  const unread = (inbox.data ?? []).filter((m) => !m.read).length;

  const list = (tab === 'inbox' ? inbox.data : sent.data) ?? [];
  return (
    <div className="dash-page">
      <div className="page-head">
        <div>
          <h1>Department Mail</h1>
          <p className="muted">
            Department Mail &amp; Attachment Center — mail between departments, and to outside
            addresses, with ERP documents attached.
          </p>
        </div>
      </div>
      <div role="tablist" className="tabs-row">
        {(['inbox', 'sent', 'compose'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`btn${tab === t ? ' primary' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'compose'
              ? 'Compose'
              : t === 'inbox'
                ? `Inbox${unread ? ` (${unread})` : ''}`
                : 'Sent'}
          </button>
        ))}
      </div>

      <div
        className="dept-mail-layout"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(240px, 1fr)',
          gap: 14,
          alignItems: 'start',
        }}
      >
        <div>
          {tab === 'compose' ? (
            <form
              className="panel"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
              style={{ display: 'grid', gap: 12 }}
            >
              <h2 style={{ margin: 0, fontSize: 15 }}>New Message / Attach Document</h2>
              {submitted && Object.keys(problems).length > 0 ? (
                <div
                  role="alert"
                  style={{
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#b91c1c',
                    padding: '8px 12px',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                >
                  Please fix the highlighted fields.
                </div>
              ) : null}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: 12,
                }}
              >
                <div className="field">
                  <label htmlFor="dm-to">To department *</label>
                  <select
                    id="dm-to"
                    value={form.toDept}
                    onChange={(e) => setForm({ ...form, toDept: e.target.value })}
                    {...bad('to')}
                  >
                    <option value="">Choose a department</option>
                    {(depts.data ?? []).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  {shown.to ? <span className="field-error">{shown.to}</span> : null}
                </div>
                <div className="field">
                  <label htmlFor="dm-ext">Or outside email address(es)</label>
                  <input
                    id="dm-ext"
                    value={form.external}
                    onChange={(e) => setForm({ ...form, external: e.target.value })}
                    placeholder="name@company.com"
                    {...bad('external')}
                  />
                  {shown.external ? <span className="field-error">{shown.external}</span> : null}
                </div>
              </div>
              <div className="field">
                <label htmlFor="dm-subject">Subject *</label>
                <input
                  id="dm-subject"
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  {...bad('subject')}
                />
                {shown.subject ? <span className="field-error">{shown.subject}</span> : null}
              </div>
              <div className="field">
                <label htmlFor="dm-body">Message *</label>
                <textarea
                  id="dm-body"
                  rows={5}
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  {...bad('body')}
                />
                {shown.body ? <span className="field-error">{shown.body}</span> : null}
              </div>

              <fieldset
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: '10px 12px',
                  margin: 0,
                }}
              >
                <legend
                  style={{ fontSize: 12, fontWeight: 700, color: '#334155', padding: '0 6px' }}
                >
                  ERP Document Attachments (+ Add Attachment)
                </legend>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                    gap: 10,
                    alignItems: 'end',
                  }}
                >
                  <div className="field">
                    <label htmlFor="dm-doctype">Document type</label>
                    <select
                      id="dm-doctype"
                      value={pick.pageId}
                      onChange={(e) => void loadRecords(e.target.value, '')}
                    >
                      <option value="">Choose a document type</option>
                      {(catalog.data ?? []).map((c) => (
                        <option key={c.pageId} value={c.pageId}>
                          {c.title} ({c.count})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="dm-docq">Find a record</label>
                    <input
                      id="dm-docq"
                      value={pick.q}
                      placeholder="Type a number"
                      disabled={!pick.pageId}
                      onChange={(e) => void loadRecords(pick.pageId, e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="dm-record">Record</label>
                    <select
                      id="dm-record"
                      value={pick.recordId}
                      disabled={!pick.pageId}
                      onChange={(e) => setPick({ ...pick, recordId: e.target.value })}
                    >
                      <option value="">{records.length ? 'Choose a record' : 'No records'}</option>
                      {records.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.number} · {r.status}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="dm-format">Format</label>
                    <select
                      id="dm-format"
                      value={pick.format}
                      onChange={(e) => setPick({ ...pick, format: e.target.value as Format })}
                    >
                      <option value="pdf">PDF</option>
                      <option value="word">Word (.docx)</option>
                      <option value="excel">Excel (.xlsx)</option>
                    </select>
                  </div>
                  <button type="button" className="btn primary" onClick={addAttachment}>
                    + Add Attachment
                  </button>
                </div>
                {pickError ? (
                  <div role="alert" style={{ color: '#b91c1c', fontSize: 12, marginTop: 6 }}>
                    {pickError}
                  </div>
                ) : null}
                {attached.length > 0 ? (
                  <ul
                    style={{
                      listStyle: 'none',
                      margin: '10px 0 0',
                      padding: 0,
                      display: 'grid',
                      gap: 4,
                    }}
                    aria-label="Attached ERP documents"
                  >
                    {attached.map((a, i) => (
                      <li
                        key={`${a.recordId}-${a.format}`}
                        style={{
                          display: 'flex',
                          gap: 8,
                          alignItems: 'center',
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          borderRadius: 6,
                          padding: '4px 8px',
                          fontSize: 12,
                        }}
                      >
                        <span className="chip" style={{ fontSize: 10 }}>
                          {FORMAT_LABEL[a.format]}
                        </span>
                        <span style={{ flex: 1 }}>{a.label}</span>
                        <button
                          type="button"
                          className="btn sm"
                          aria-label={`Remove ${a.label}`}
                          onClick={() => setAttached(attached.filter((_, j) => j !== i))}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
                    No ERP document attached yet.
                  </p>
                )}
              </fieldset>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn" onClick={() => setTab('inbox')}>
                  Cancel
                </button>
                <button type="submit" className="btn primary">
                  Send
                </button>
              </div>
            </form>
          ) : (
            <table className="register-table">
              <thead>
                <tr>
                  <th>{tab === 'inbox' ? 'From' : 'To'}</th>
                  <th>Subject</th>
                  <th>When</th>
                  <th>{tab === 'inbox' ? 'Files' : 'Read by'}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr
                    key={m.id}
                    className={tab === 'inbox' && !m.read ? 'unread' : undefined}
                    onClick={() =>
                      void docsMailApi.open(m.id).then(
                        (x) => {
                          setOpen(x);
                          inbox.reload();
                        },
                        (e: unknown) => toast(errText(e)),
                      )
                    }
                  >
                    <td>
                      {tab === 'inbox'
                        ? `${m.from_name ?? ''} ${m.from_department ? `(${m.from_department})` : ''}`
                        : m.to_department}
                    </td>
                    <td>{tab === 'inbox' && !m.read ? <strong>{m.subject}</strong> : m.subject}</td>
                    <td>{when(m.created_at)}</td>
                    <td>
                      {tab === 'inbox'
                        ? typeof m.attachments === 'number'
                          ? m.attachments
                          : Array.isArray(m.attachments)
                            ? m.attachments.length
                            : ''
                        : `${m.read_by ?? 0} of ${m.recipients ?? 0}`}
                    </td>
                  </tr>
                ))}
                {list.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No mail.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>

        <aside style={{ display: 'grid', gap: 12 }} aria-label="Mail side panels">
          <section className="panel" aria-label="Department Inboxes">
            <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>Department Inboxes</h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
              {(depts.data ?? []).map((d) => (
                <li key={d.id}>
                  <Link to={`/m/dept-inbox-${slug(d.name)}`} style={{ fontSize: 12 }}>
                    {d.name} Inbox
                  </Link>
                </li>
              ))}
              {(depts.data ?? []).length === 0 ? (
                <li className="muted" style={{ fontSize: 12 }}>
                  No departments available.
                </li>
              ) : null}
            </ul>
          </section>
          <section className="panel" aria-label="Recent Messages">
            <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>Recent Messages</h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
              {recent.map(({ m, dir }) => (
                <li key={`${dir}-${m.id}`} style={{ fontSize: 12 }}>
                  <span className="chip" style={{ fontSize: 10 }}>
                    {dir}
                  </span>{' '}
                  <b>{m.subject}</b>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {when(m.created_at)}
                  </div>
                </li>
              ))}
              {recent.length === 0 ? (
                <li className="muted" style={{ fontSize: 12 }}>
                  No messages yet.
                </li>
              ) : null}
            </ul>
          </section>
          <section className="panel" aria-label="Work Center quick actions">
            <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>Quick Actions</h3>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className="btn sm primary" onClick={() => setTab('compose')}>
                New Message / Attach Document
              </button>
              <Link className="btn sm" to="/m/plant-flow-command">
                Plant Flow
              </Link>
              <Link className="btn sm" to="/m/admin-workflow">
                Workflow Matrix
              </Link>
            </div>
          </section>
        </aside>
      </div>

      {open ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Message">
          <div className="modal">
            <h2>{open.subject}</h2>
            <p className="muted">
              {open.from_name} · {when(open.created_at)}
            </p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{open.body}</p>
            {Array.isArray(open.attachments) && open.attachments.length > 0 ? (
              <ul>
                {open.attachments.map((a, i) => (
                  <li key={i}>{a.label}</li>
                ))}
              </ul>
            ) : null}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setOpen(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
