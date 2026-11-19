// Phase 21 §5.7: Reusable "Email Document" preview + editable To/CC/Message dialog
import { useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { phase21Api, type EmailExtraFile } from '../lib/phase21Api';
import { EMAIL_RE } from '../lib/validators';
import { AttachDocs } from './AttachDocs';
import { useToast } from './Toast';

export type AttachFormat = 'pdf' | 'word' | 'excel';
const FORMATS: { value: AttachFormat; label: string; ext: string }[] = [
  { value: 'word', label: 'Word (.docx)', ext: 'docx' },
  { value: 'excel', label: 'Excel (.xlsx)', ext: 'xlsx' },
  { value: 'pdf', label: 'PDF (.pdf)', ext: 'pdf' },
];
const EMAIL_FILE_MAX_MB = 5;
const EMAIL_FILE_MAX_COUNT = 3;

const toBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((typeof r.result === 'string' ? r.result : '').split(',')[1] ?? '');
    r.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    r.readAsDataURL(file);
  });

/** ERP record summary that pre-fills the Message of the email (Demo ERP layout). */
export function recordSummary(docType: string, docId: string): string {
  const kind = docType.replace(/[-_]/g, ' ').toUpperCase();
  return [
    'Dear Sir / Madam,',
    '',
    `Please find attached the ERP record ${docId} (${kind}) from Sawant Group ERP.`,
    '',
    `Record      : ${docId}`,
    `Module      : ${kind}`,
    `Prepared on : ${new Date().toISOString().slice(0, 10)}`,
    '',
    'Kindly review and revert if any correction is required.',
    '',
    'Regards,',
    'Sawant Group ERP',
  ].join('\n');
}

export function EmailDocButton({
  docType,
  docId,
  label = 'Email',
}: {
  docType: string;
  docId: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn sm" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open ? (
        <EmailDocDialog docType={docType} docId={docId} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

export function EmailDocDialog({
  docType,
  docId,
  onClose,
}: {
  docType: string;
  docId: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [toStr, setToStr] = useState('');
  const [ccStr, setCcStr] = useState('');
  const [bccStr, setBccStr] = useState('');
  const [message, setMessage] = useState(() => recordSummary(docType, docId));
  const [note, setNote] = useState('');
  const [format, setFormat] = useState<AttachFormat>('pdf');
  const [files, setFiles] = useState<File[]>([]);
  const [attachMode, setAttachMode] = useState<'AUTO' | 'ATTACH' | 'LINK'>('AUTO');
  const [subject, setSubject] = useState('');
  const [attachmentFilename, setAttachmentFilename] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    phase21Api
      .previewDocEmail(docType, docId)
      .then((res) => {
        setToStr(res.to.join(', '));
        setCcStr(res.cc.join(', '));
        setSubject(
          res.subject || `RHAI ERP — ${docType.replace(/[-_]/g, ' ').toUpperCase()} ${docId}`,
        );
        setAttachmentFilename(res.attachmentFilename || `${docId}.pdf`);
      })
      .catch(() => {
        // Fallback gracefully so the dialog stays usable even for demo / offline records
        const fallbackNo = docId.slice(0, 16);
        setSubject(`RHAI ERP — ${docType.replace(/[-_]/g, ' ').toUpperCase()} ${fallbackNo}`);
        setToStr('billing@customer.example');
        setCcStr('accounts@customer.example');
        setAttachmentFilename(`${fallbackNo.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`);
      })
      .finally(() => setLoading(false));
  }, [docType, docId]);

  const list = (v: string): string[] =>
    v
      .split(/[,;]/)
      .map((x) => x.trim())
      .filter(Boolean);

  const send = async () => {
    const to = list(toStr);
    const cc = list(ccStr);
    const bcc = list(bccStr);
    if (to.length === 0) {
      setError('Enter at least one recipient email.');
      return;
    }
    const badAddress = [...to, ...cc, ...bcc].find((a) => !EMAIL_RE.test(a));
    if (badAddress) {
      setError(`"${badAddress}" is not a valid email address.`);
      return;
    }
    if (!subject.trim()) {
      setError('Enter the subject of the email.');
      return;
    }
    if (files.length > EMAIL_FILE_MAX_COUNT) {
      setError(`Attach at most ${EMAIL_FILE_MAX_COUNT} supporting documents.`);
      return;
    }
    const tooBig = files.find((f) => f.size > EMAIL_FILE_MAX_MB * 1024 * 1024);
    if (tooBig) {
      setError(`${tooBig.name} is larger than ${EMAIL_FILE_MAX_MB} MB.`);
      return;
    }
    setSending(true);
    setError('');
    try {
      const extraFiles: EmailExtraFile[] = await Promise.all(
        files.map(async (f) => ({ filename: f.name, contentBase64: await toBase64(f) })),
      );
      await phase21Api.sendDocEmail(docType, docId, {
        to,
        cc,
        bcc,
        subject: subject.trim(),
        message: `${message.trim()}${note.trim() ? `\n\nNote: ${note.trim()}` : ''}`,
        attachMode,
        attachFormat: format,
        ...(extraFiles.length ? { extraFiles } : {}),
      });
      toast(
        `Email dispatched and logged with ${FORMATS.find((x) => x.value === format)?.ext.toUpperCase() ?? 'PDF'}${files.length ? ` and ${files.length} supporting document${files.length === 1 ? '' : 's'}` : ''}.`,
      );
      onClose();
    } catch (e) {
      // A demo record that is not stored in the ERP cannot be resolved by the mail service (404 / 422): the dialog says so plainly.
      if (e instanceof ApiError && e.status !== 404 && e.status !== 422) {
        setError(e.message);
      } else {
        toast(
          `Email prepared for ${to[0]}. This demo record is not stored in the ERP mail queue, so nothing was sent.`,
        );
        onClose();
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="modal-bg show" role="dialog" aria-modal="true" aria-label="Email Document">
      <div
        className="modal"
        style={{
          maxWidth: 620,
          width: '100%',
          borderRadius: 16,
          boxShadow: '0 20px 45px rgba(15, 23, 42, 0.22)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          background: '#ffffff',
        }}
      >
        <div
          className="modal-head"
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'linear-gradient(to right, #f8fafc, #f1f5f9)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>✉️</span>
              <b style={{ fontSize: 17, fontWeight: 700, color: '#0f243d' }}>Email Document</b>
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
              Send document notification and PDF attachments to counterparties
            </div>
          </div>
          <button
            type="button"
            className="btn"
            style={{
              borderRadius: 8,
              padding: '4px 10px',
              fontSize: 12,
              background: '#fff',
              border: '1px solid #cbd5e1',
            }}
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="modal-body" style={{ padding: '20px 24px' }}>
          {/* Document Reference Pill Card */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              padding: '10px 14px',
              marginBottom: 16,
            }}
          >
            <div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#64748b',
                  textTransform: 'uppercase',
                }}
              >
                Document
              </span>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f243d', marginTop: 2 }}>
                {docType.replace(/[-_]/g, ' ').toUpperCase()} • {docId}
              </div>
            </div>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: 999,
                background: '#eff6ff',
                color: '#1d4ed8',
                border: '1px solid #bfdbfe',
              }}
            >
              📎{' '}
              {format === 'pdf'
                ? attachmentFilename || 'document.pdf'
                : `${(attachmentFilename || 'document').replace(/\.[^.]+$/, '')}.${FORMATS.find((x) => x.value === format)?.ext ?? 'pdf'}`}
            </span>
          </div>

          {loading ? (
            <div style={{ padding: '28px 0', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
              Preparing document preview…
            </div>
          ) : null}

          {error ? (
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                padding: '9px 12px',
                borderRadius: 8,
                fontSize: 12,
                marginBottom: 16,
              }}
              role="alert"
            >
              {error}
            </div>
          ) : null}

          {!loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label
                  htmlFor="email-subject"
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#334155',
                    marginBottom: 5,
                  }}
                >
                  Subject *
                </label>
                <input
                  id="email-subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 12px',
                    fontSize: 13,
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#334155',
                    marginBottom: 5,
                  }}
                >
                  To (comma-separated) *
                </label>
                <input
                  type="text"
                  value={toStr}
                  onChange={(e) => setToStr(e.target.value)}
                  placeholder="billing@customer.example"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 12px',
                    fontSize: 13,
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#334155',
                    marginBottom: 5,
                  }}
                >
                  CC
                </label>
                <input
                  type="text"
                  value={ccStr}
                  onChange={(e) => setCcStr(e.target.value)}
                  placeholder="accounts@customer.example"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 12px',
                    fontSize: 13,
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="email-bcc"
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#334155',
                    marginBottom: 5,
                  }}
                >
                  BCC
                </label>
                <input
                  id="email-bcc"
                  type="text"
                  value={bccStr}
                  onChange={(e) => setBccStr(e.target.value)}
                  placeholder="audit@company.example"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 12px',
                    fontSize: 13,
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="email-format"
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#334155',
                    marginBottom: 5,
                  }}
                >
                  Prepare Attachment Format
                </label>
                <select
                  id="email-format"
                  value={format}
                  onChange={(e) => setFormat(e.target.value as AttachFormat)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 12px',
                    fontSize: 13,
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    outline: 'none',
                  }}
                >
                  {FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#334155',
                    marginBottom: 5,
                  }}
                >
                  Attachment Mode
                </label>
                <select
                  value={attachMode}
                  onChange={(e) => setAttachMode(e.target.value as 'AUTO' | 'ATTACH' | 'LINK')}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 12px',
                    fontSize: 13,
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    outline: 'none',
                  }}
                >
                  <option value="AUTO">Auto (&le; 7 MB attach, else 30-day link)</option>
                  <option value="ATTACH">Force PDF Attachment ({attachmentFilename})</option>
                  <option value="LINK">Force 30-Day Share Link</option>
                </select>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label
                  htmlFor="email-message"
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#334155',
                    marginBottom: 5,
                  }}
                >
                  Message (ERP record summary)
                </label>
                <textarea
                  id="email-message"
                  rows={8}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    border: '1px solid #cbd5e1',
                    borderRadius: 8,
                    padding: '9px 12px',
                    fontSize: 13,
                    fontFamily: 'inherit',
                    outline: 'none',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label
                  htmlFor="email-note"
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#334155',
                    marginBottom: 5,
                  }}
                >
                  Custom Note
                </label>
                <textarea
                  id="email-note"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional note to include in email body"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    border: '1px solid #cbd5e1',
                    borderRadius: 8,
                    padding: '9px 12px',
                    fontSize: 13,
                    fontFamily: 'inherit',
                    outline: 'none',
                    resize: 'vertical',
                  }}
                />
              </div>

              <AttachDocs
                files={files}
                onChange={setFiles}
                label="Attach Supporting Documents"
                buttonLabel="+ Add Doc"
              />
            </div>
          ) : null}
        </div>

        <div
          className="modal-foot"
          style={{
            padding: '14px 24px',
            borderTop: '1px solid #e2e8f0',
            background: '#f8fafc',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
          }}
        >
          <button
            type="button"
            className="btn"
            style={{ borderRadius: 8, padding: '7px 16px', fontSize: 13 }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={sending || loading}
            style={{ borderRadius: 8, padding: '7px 20px', fontSize: 13, fontWeight: 600 }}
            onClick={() => void send()}
          >
            {sending ? 'Sending…' : 'Send Email'}
          </button>
        </div>
      </div>
    </div>
  );
}
