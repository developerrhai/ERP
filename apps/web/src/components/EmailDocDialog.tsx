// Phase 21 §5.7: Reusable "Email Document" preview + editable To/CC/Message dialog
import { useEffect, useState } from 'react';
import { phase21Api } from '../lib/phase21Api';
import { useToast } from './Toast';

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
      {open ? <EmailDocDialog docType={docType} docId={docId} onClose={() => setOpen(false)} /> : null}
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
  const [message, setMessage] = useState('');
  const [attachMode, setAttachMode] = useState<'AUTO' | 'ATTACH' | 'LINK'>('AUTO');
  const [subject, setSubject] = useState('');
  const [attachmentFilename, setAttachmentFilename] = useState('');

  useEffect(() => {
    setLoading(true);
    phase21Api
      .previewDocEmail(docType, docId)
      .then((res) => {
        setToStr(res.to.join(', '));
        setCcStr(res.cc.join(', '));
        setSubject(res.subject);
        setAttachmentFilename(res.attachmentFilename);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Preview failed'))
      .finally(() => setLoading(false));
  }, [docType, docId]);

  const send = async () => {
    const to = toStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const cc = ccStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (to.length === 0) {
      setError('Enter at least one recipient email.');
      return;
    }
    setSending(true);
    setError('');
    try {
      await phase21Api.sendDocEmail(docType, docId, { to, cc, message, attachMode });
      toast('Email dispatched and logged.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Email Document"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.55)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 9999,
        padding: 16,
      }}
    >
      <div className="card" style={{ maxWidth: 560, width: '100%', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Email Document</h3>
          <button type="button" className="btn sm" onClick={onClose}>
            Close
          </button>
        </div>
        {loading ? <p className="v8-sub">Loading preview…</p> : null}
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        {!loading ? (
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            <label>
              Subject
              <input type="text" value={subject} readOnly />
            </label>
            <label>
              To (comma-separated)
              <input
                type="text"
                value={toStr}
                onChange={(e) => setToStr(e.target.value)}
                placeholder="billing@customer.example"
              />
            </label>
            <label>
              CC
              <input
                type="text"
                value={ccStr}
                onChange={(e) => setCcStr(e.target.value)}
                placeholder="accounts@customer.example"
              />
            </label>
            <label>
              Attachment Mode
              <select
                value={attachMode}
                onChange={(e) => setAttachMode(e.target.value as 'AUTO' | 'ATTACH' | 'LINK')}
              >
                <option value="AUTO">Auto (&le; 7 MB attach, else 30-day link)</option>
                <option value="ATTACH">Force PDF Attachment ({attachmentFilename})</option>
                <option value="LINK">Force 30-Day Share Link</option>
              </select>
            </label>
            <label>
              Custom Note
              <textarea
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Optional note to include in email body"
              />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={sending}
                onClick={() => void send()}
              >
                {sending ? 'Sending…' : 'Send Email'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

