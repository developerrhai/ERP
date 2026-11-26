// Quality Certificates: the register, the add / edit form, the record view and its print, e-mail and hand-over buttons.
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { RecordActions } from '../../components/workspace/RecordActions';
import { docsMailApi, type Certificate } from '../../lib/docsMailApi';
import { toUiError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';

const EMPTY = { partName: '', partCode: '', jobCardNo: '', inspectionDate: '', sampleQty: '', acceptedQty: '', rejectedQty: '', drawingRevision: '', inspector: '', result: 'Pass', ncrNo: '', remarks: '' };
type Form = typeof EMPTY;
const FIELDS: { key: keyof Form; label: string; type?: 'number' | 'date'; required?: boolean; wide?: boolean }[] = [
  { key: 'partName', label: 'Part name', required: true },
  { key: 'partCode', label: 'Part code' },
  { key: 'jobCardNo', label: 'Job card no.' },
  { key: 'inspectionDate', label: 'Inspection date', type: 'date' },
  { key: 'drawingRevision', label: 'Drawing revision' },
  { key: 'inspector', label: 'Inspector' },
  { key: 'sampleQty', label: 'Sample qty', type: 'number', required: true },
  { key: 'acceptedQty', label: 'Accepted qty', type: 'number', required: true },
  { key: 'rejectedQty', label: 'Rejected qty', type: 'number' },
  { key: 'ncrNo', label: 'NCR no. (needed when it fails)' },
  { key: 'remarks', label: 'Remarks', wide: true },
];
const day = (v: string | null): string => (v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const qty = (v: string): string => String(Number(v));
const tone = (v: string): string => (v === 'Pass' || v === 'Approved' ? 'rag-green' : v === 'Fail' || v === 'Rejected' ? 'rag-red' : 'rag-amber');
const toForm = (c: Certificate): Form => ({
  partName: c.part_name,
  partCode: c.part_code ?? '',
  jobCardNo: c.job_card_no ?? '',
  inspectionDate: String(c.inspection_date ?? '').slice(0, 10),
  sampleQty: qty(c.sample_qty),
  acceptedQty: qty(c.accepted_qty),
  rejectedQty: qty(c.rejected_qty),
  drawingRevision: c.drawing_revision ?? '',
  inspector: c.inspector ?? '',
  result: c.result,
  ncrNo: c.ncr_no ?? '',
  remarks: c.remarks ?? '',
});

export function CertificatesPage({ actions }: { actions?: ActionSet }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [result, setResult] = useState('');
  const list = useLoad(() => docsMailApi.certificates(q || undefined), [q]);
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [viewing, setViewing] = useState<Certificate | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const rows = (list.data ?? []).filter((c) => !result || c.result === result);

  const open = (c: Certificate | null): void => {
    setForm(c ? toForm(c) : EMPTY);
    setErrors({});
    setMessage('');
    setViewing(null);
    setEditing({ id: c?.id ?? null });
  };
  const decide = async (c: Certificate, action: 'approve' | 'reject'): Promise<void> => {
    try {
      await docsMailApi.certAction(c.id, action);
      toast(`${c.number} ${action === 'approve' ? 'released' : 'rejected'}.`);
      setViewing(null);
      list.reload();
    } catch (e) {
      toast(toUiError(e).message);
    }
  };
  const save = async (): Promise<void> => {
    const missing: Record<string, string> = {};
    for (const f of FIELDS) if (f.required && !form[f.key].trim()) missing[f.key] = `${f.label} is required.`;
    setErrors(missing);
    if (Object.keys(missing).length > 0) {
      setMessage('Fill in the highlighted fields.');
      return;
    }
    const body = {
      partName: form.partName.trim(),
      partCode: form.partCode || null,
      jobCardNo: form.jobCardNo || null,
      ...(form.inspectionDate ? { inspectionDate: form.inspectionDate } : {}),
      sampleQty: Number(form.sampleQty || 0),
      acceptedQty: Number(form.acceptedQty || 0),
      rejectedQty: Number(form.rejectedQty || 0),
      drawingRevision: form.drawingRevision || null,
      inspector: form.inspector || null,
      result: form.result,
      ncrNo: form.ncrNo || null,
      remarks: form.remarks || null,
    };
    setSaving(true);
    try {
      if (editing?.id) await docsMailApi.updateCertificate(editing.id, body);
      else await docsMailApi.addCertificate(body);
      toast('Certificate saved.');
      setEditing(null);
      list.reload();
    } catch (e) {
      const ui = toUiError(e);
      setErrors(ui.fields ?? {});
      setMessage(ui.message);
    } finally {
      setSaving(false);
    }
  };

  const buttons = (c: Certificate, inView: boolean) => (
    <RecordActions docType="quality-certificate" id={c.id} number={c.number} status={c.quality_approval} onChanged={list.reload}>
      {!inView ? (
        <button type="button" className="btn sm" onClick={() => setViewing(c)}>
          View
        </button>
      ) : null}
      <button
        type="button"
        className="btn sm"
        onClick={() => (c.quality_approval === 'Pending' && actions?.edit !== false ? open(c) : toast(`${c.number} is ${c.quality_approval.toLowerCase()}: only a certificate still pending release can be edited.`))}
      >
        Edit
      </button>
      {c.quality_approval === 'Pending' && actions?.approve !== false ? (
        <>
          <button type="button" className="btn sm primary" onClick={() => void decide(c, 'approve')}>
            Release
          </button>
          <button type="button" className="btn sm danger" onClick={() => void decide(c, 'reject')}>
            Reject
          </button>
        </>
      ) : null}
    </RecordActions>
  );

  return (
    <div className="dash-page">
      <div className="page-head">
        <div>
          <h1>Quality Certificates</h1>
          <p className="muted">A certificate is released by a different person from the one who made it.</p>
        </div>
        {actions?.add !== false ? (
          <button type="button" className="btn primary" onClick={() => open(null)}>
            ＋ Add Certificate
          </button>
        ) : null}
      </div>
      <div className="toolbar">
        <input className="search qc-search" type="search" aria-label="Search certificates" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number, part or job card" />
        <select aria-label="Result" value={result} onChange={(e) => setResult(e.target.value)}>
          <option value="">All results</option>
          <option>Pass</option>
          <option>Fail</option>
          <option>Conditional</option>
        </select>
      </div>
      {list.error ? <p className="form-error" role="alert">{list.error}</p> : null}
      <div className="card table-wrap">
        <table className="register-table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Date</th>
              <th>Part</th>
              <th>Job card</th>
              <th>Sample / Acc / Rej</th>
              <th>Result</th>
              <th>Release</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <b>{c.number}</b>
                </td>
                <td>{day(c.inspection_date)}</td>
                <td>{c.part_code ? `${c.part_code} · ` : ''}{c.part_name}</td>
                <td>{c.job_card_no ?? '—'}</td>
                <td>{`${qty(c.sample_qty)} / ${qty(c.accepted_qty)} / ${qty(c.rejected_qty)}`}</td>
                <td><span className={`rag ${tone(c.result)}`}>{c.result}</span></td>
                <td><span className={`rag ${tone(c.quality_approval)}`}>{c.quality_approval}</span></td>
                <td className="row-actions">{buttons(c, false)}</td>
              </tr>
            ))}
            {!list.loading && rows.length === 0 ? (
              <tr>
                <td colSpan={8}>No certificates yet. Press ＋ Add Certificate to make the first one.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {viewing ? (
        <Modal
          title={viewing.number}
          sub="Quality certificate"
          onClose={() => setViewing(null)}
          footer={
            <>
              {buttons(viewing, true)}
              <button type="button" className="btn sm" onClick={() => setViewing(null)}>
                Close
              </button>
            </>
          }
        >
          <div className="drawer-grid">
            {([
              ...FIELDS.map((f) => [f.label.replace(/ \(.*\)$/, ''), f.type === 'date' ? day(toForm(viewing)[f.key] || null) : toForm(viewing)[f.key]]),
              ['Result', viewing.result],
              ['Release', viewing.quality_approval],
            ] as string[][]).map(([label, value]) => (
              <div className="v8-mini" key={label}>
                <small>{label}</small>
                <b>{value || '—'}</b>
              </div>
            ))}
          </div>
        </Modal>
      ) : null}

      {editing ? (
        <Modal
          title={editing.id ? 'Edit certificate' : 'New certificate'}
          sub="Fields marked * are required. The number is given when it is saved."
          onClose={() => setEditing(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>
                {saving ? 'Saving…' : 'Save certificate'}
              </button>
            </>
          }
        >
          {message ? <p className="form-error" role="alert">{message}</p> : null}
          <div className="form-grid">
            {FIELDS.filter((f) => !f.wide).map((f) => (
              <div className="field" key={f.key}>
                <label htmlFor={`qc-${f.key}`} className={f.required ? 'is-required' : undefined}>{f.label}</label>
                <input
                  id={`qc-${f.key}`}
                  type={f.type ?? 'text'}
                  {...(f.type === 'number' ? { min: 0, step: 'any' } : {})}
                  aria-invalid={errors[f.key] ? true : undefined}
                  value={form[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                />
                {errors[f.key] ? <small className="field-error">{errors[f.key]}</small> : null}
              </div>
            ))}
            <div className="field">
              <label htmlFor="qc-result">Result</label>
              <select id="qc-result" value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })}>
                <option>Pass</option>
                <option>Fail</option>
                <option>Conditional</option>
              </select>
            </div>
            <div className="field field-wide">
              <label htmlFor="qc-remarks">Remarks</label>
              <textarea id="qc-remarks" rows={2} maxLength={500} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
