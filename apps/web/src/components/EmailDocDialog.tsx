// Phase 21 §5.7: Reusable "Email Document" preview + editable To/CC/Message dialog
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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

/** Page ids that read badly as a module name. */
const KIND: Record<string, string> = { 'inv-items': 'Item / SKU Master', 'inv-stock': 'Stock Balance', 'crm-sources': 'Lead Source' };
const kindOf = (docType: string): string => (KIND[docType] ?? docType.replace(/[-_]/g, ' ')).toUpperCase();

/** ERP record summary that pre-fills the Message of the email (Demo ERP layout). */
export function recordSummary(docType: string, docId: string): string {
  const kind = kindOf(docType);
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
  const [docNo, setDocNo] = useState('');
  // the box the error is about: it is outlined in red and gets the cursor
  const [bad, setBad] = useState<'to' | 'cc' | 'bcc' | 'subject' | ''>('');
  const mark = (field: 'to' | 'cc' | 'bcc' | 'subject' | ''): void => {
    setBad(field);
    if (field) setTimeout(() => document.querySelector<HTMLInputElement>(`[aria-label="Email Document"] [data-field="${field}"]`)?.focus(), 0);
  };

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
        // the message names the record by its number, unless the person already changed the text
        if (res.docNo && res.docNo !== docId) {
          setDocNo(res.docNo);
          setMessage((m) => (m === recordSummary(docType, docId) ? recordSummary(docType, res.docNo) : m));
        }
      })
      .catch(() => {
        // Fallback gracefully so the dialog stays usable even for demo / offline records
        const fallbackNo = docId.slice(0, 16);
        setSubject(`RHAI ERP — ${docType.replace(/[-_]/g, ' ').toUpperCase()} ${fallbackNo}`);
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
    mark('');
    if (to.length === 0) {
      setError('Enter at least one recipient email.');
      mark('to');
      return;
    }
    const badAddress = [...to, ...cc, ...bcc].find((a) => !EMAIL_RE.test(a));
    if (badAddress) {
      setError(`"${badAddress}" is not a valid email address.`);
      mark(to.includes(badAddress) ? 'to' : cc.includes(badAddress) ? 'cc' : 'bcc');
      return;
    }
    if (!subject.trim()) {
      setError('Enter the subject of the email.');
      mark('subject');
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
      // A demo record that is not stored in the ERP cannot be resolved by the mail service (404): the dialog says so plainly.
      if (e instanceof ApiError && e.status !== 404) {
        setError(Object.values(e.fields)[0] ?? e.message);
        const key = (Object.keys(e.fields)[0] ?? '').split('.')[0];
        mark(key === 'to' || key === 'cc' || key === 'bcc' || key === 'subject' ? key : '');
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

  // drawn on <body> like every Modal: opened from a table row it would sit inside that row's sticky cell, and the sticky
  // cells of the other rows would paint over it
  return createPortal(
    <div className="modal-bg show" role="dialog" aria-modal="true" aria-label="Email Document">
      <div
        className="modal x-maxw-620px x-w-100pct x-r-16px x-box-shadow-0-20px-45px-rgba-15-23-42-0_22 x-bd-1px-solid-line x-d-flex x-fd-column x-maxh-90vh x-ov-hidden x-bg-card"
      >
        <div
          className="modal-head x-p-16px-20px x-bb-1px-solid-line x-d-flex x-jc-space-between x-ai-center x-bg-linear-gradient-to-right-hf8fafc-hf1f5f9"
        >
          <div>
            <div className="x-d-flex x-ai-center x-gap-8px">
              <span className="x-fs-18px">✉️</span>
              <b className="x-fs-17px x-fw-700 x-c-h0f243d">Email Document</b>
            </div>
            <div className="x-fs-12px x-c-muted x-mt-3px">
              Send document notification and PDF attachments to counterparties
            </div>
          </div>
          <button
            type="button"
            className="btn x-r-8px x-p-4px-10px x-fs-12px x-bg-card x-bd-1px-solid-line-strong"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div
          className="modal-body x-p-20px-24px x-flex-1-1-auto x-minh-0 x-ovy-auto"
        >
          {/* Document Reference Pill Card */}
          <div
            className="x-d-flex x-ai-center x-jc-space-between x-bg-card2 x-bd-1px-solid-line x-r-10px x-p-10px-14px x-mb-16px"
          >
            <div>
              <span
                className="x-fs-11px x-fw-700 x-c-muted x-text-transform-uppercase"
              >
                Document
              </span>
              <div className="x-fs-13px x-fw-700 x-c-h0f243d x-mt-2px">
                {kindOf(docType)} • {docNo || (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(docId) ? (loading ? '…' : 'record not found') : docId)}
              </div>
            </div>
            <span
              className="x-fs-11px x-fw-600 x-p-4px-10px x-r-999px x-bg-heff6ff x-c-primary x-bd-1px-solid-hbfdbfe"
            >
              📎{' '}
              {format === 'pdf'
                ? attachmentFilename || 'document.pdf'
                : `${(attachmentFilename || 'document').replace(/\.[^.]+$/, '')}.${FORMATS.find((x) => x.value === format)?.ext ?? 'pdf'}`}
            </span>
          </div>

          {loading ? (
            <div className="x-p-28px-0 x-ta-center x-c-muted x-fs-13px">
              Preparing document preview…
            </div>
          ) : null}

          {error ? (
            <div
              className="x-bg-hfef2f2 x-bd-1px-solid-hfecaca x-c-danger-hover x-p-9px-12px x-r-8px x-fs-12px x-mb-16px"
              role="alert"
            >
              {error}
            </div>
          ) : null}

          {!loading ? (
            <div className="x-d-grid x-cols-1fr-1fr x-gap-14px">
              <div className="x-grid-column-1-n1">
                <label
                  htmlFor="email-subject"
                  className="x-d-block x-fs-12px x-fw-600 x-c-textn2 x-mb-5px"
                >
                  Subject *
                </label>
                <input
                  id="email-subject"
                  type="text"
                  value={subject}
                  data-field="subject"
                  aria-invalid={bad === 'subject' ? true : undefined}
                  onChange={(e) => setSubject(e.target.value)}
                  className="x-w-100pct x-box-sizing-border-box x-p-8px-12px x-fs-13px x-r-8px x-bd-1px-solid-line-strong x-bg-card x-outline-none"
                />
              </div>

              <div className="x-grid-column-1-n1">
                <label
                  className="x-d-block x-fs-12px x-fw-600 x-c-textn2 x-mb-5px"
                >
                  To (comma-separated) *
                </label>
                <input
                  type="text"
                  value={toStr}
                  data-field="to"
                  aria-invalid={bad === 'to' ? true : undefined}
                  onChange={(e) => setToStr(e.target.value)}
                  placeholder="name@company.com"
                  className="x-w-100pct x-box-sizing-border-box x-p-8px-12px x-fs-13px x-r-8px x-bd-1px-solid-line-strong x-bg-card x-outline-none"
                />
              </div>

              <div>
                <label
                  className="x-d-block x-fs-12px x-fw-600 x-c-textn2 x-mb-5px"
                >
                  CC
                </label>
                <input
                  type="text"
                  value={ccStr}
                  data-field="cc"
                  aria-invalid={bad === 'cc' ? true : undefined}
                  onChange={(e) => setCcStr(e.target.value)}
                  placeholder="Optional copy to"
                  className="x-w-100pct x-box-sizing-border-box x-p-8px-12px x-fs-13px x-r-8px x-bd-1px-solid-line-strong x-bg-card x-outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="email-bcc"
                  className="x-d-block x-fs-12px x-fw-600 x-c-textn2 x-mb-5px"
                >
                  BCC
                </label>
                <input
                  id="email-bcc"
                  type="text"
                  value={bccStr}
                  data-field="bcc"
                  aria-invalid={bad === 'bcc' ? true : undefined}
                  onChange={(e) => setBccStr(e.target.value)}
                  placeholder="audit@company.example"
                  className="x-w-100pct x-box-sizing-border-box x-p-8px-12px x-fs-13px x-r-8px x-bd-1px-solid-line-strong x-bg-card x-outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="email-format"
                  className="x-d-block x-fs-12px x-fw-600 x-c-textn2 x-mb-5px"
                >
                  Prepare Attachment Format
                </label>
                <select
                  id="email-format"
                  value={format}
                  onChange={(e) => setFormat(e.target.value as AttachFormat)}
                  className="x-w-100pct x-box-sizing-border-box x-p-8px-12px x-fs-13px x-r-8px x-bd-1px-solid-line-strong x-bg-card x-outline-none"
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
                  className="x-d-block x-fs-12px x-fw-600 x-c-textn2 x-mb-5px"
                >
                  Attachment Mode
                </label>
                <select
                  value={attachMode}
                  onChange={(e) => setAttachMode(e.target.value as 'AUTO' | 'ATTACH' | 'LINK')}
                  className="x-w-100pct x-box-sizing-border-box x-p-8px-12px x-fs-13px x-r-8px x-bd-1px-solid-line-strong x-bg-card x-outline-none"
                >
                  <option value="AUTO">Auto (&le; 7 MB attach, else 30-day link)</option>
                  <option value="ATTACH">Force PDF Attachment ({attachmentFilename})</option>
                  <option value="LINK">Force 30-Day Share Link</option>
                </select>
              </div>

              <div className="x-grid-column-1-n1">
                <label
                  htmlFor="email-message"
                  className="x-d-block x-fs-12px x-fw-600 x-c-textn2 x-mb-5px"
                >
                  Message (ERP record summary)
                </label>
                <textarea
                  id="email-message"
                  rows={8}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="x-w-100pct x-box-sizing-border-box x-bd-1px-solid-line-strong x-r-8px x-p-9px-12px x-fs-13px x-font-family-inherit x-outline-none x-resize-vertical"
                />
              </div>

              <div className="x-grid-column-1-n1">
                <label
                  htmlFor="email-note"
                  className="x-d-block x-fs-12px x-fw-600 x-c-textn2 x-mb-5px"
                >
                  Custom Note
                </label>
                <textarea
                  id="email-note"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional note to include in email body"
                  className="x-w-100pct x-box-sizing-border-box x-bd-1px-solid-line-strong x-r-8px x-p-9px-12px x-fs-13px x-font-family-inherit x-outline-none x-resize-vertical"
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
          className="modal-foot x-p-14px-24px x-bt-1px-solid-line x-bg-card2 x-d-flex x-jc-flex-end x-gap-10px"
        >
          <button
            type="button"
            className="btn x-r-8px x-p-7px-16px x-fs-13px"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn primary x-r-8px x-p-7px-20px x-fs-13px x-fw-600"
            disabled={sending || loading}
            onClick={() => void send()}
          >
            {sending ? 'Sending…' : 'Send Email'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
