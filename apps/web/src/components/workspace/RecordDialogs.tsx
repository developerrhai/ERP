// Dialogs shared by the master workspaces: the documents of one record, and "Submit Selected" (send several ticked records
// to one department for approval, each as its own tracked hand-over).
import { useEffect, useState } from 'react';
import { toUiError } from '../../lib/errors';
import { workApi, type Dept } from '../../lib/workApi';
import { DocumentsPanel } from '../../pages/generic/DocumentsPanel';
import type { PageSchema } from '../../pages/generic/engineApi';
import { WorkflowStrip } from '../WorkflowStrip';
import { Modal } from '../Modal';

export function RecordDocsModal({
  docType,
  docId,
  docNo,
  status,
  canEdit,
  onClose,
  onChanged,
}: {
  docType: string;
  docId: string;
  docNo: string;
  status: string;
  canEdit: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  return (
    <Modal
      title={`Documents · ${docNo}`}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <WorkflowStrip docType={docType} docId={docId} />
      <DocumentsPanel
        schema={{ pageId: docType } as unknown as PageSchema}
        row={{ id: docId, code: docNo, status }}
        canEdit={canEdit}
        {...(onChanged ? { onChanged } : {})}
      />
    </Modal>
  );
}

export interface SubmitTarget {
  docId: string;
  docNo: string;
}

export function SubmitSelectedDialog({
  docType,
  targets,
  onClose,
  onDone,
}: {
  docType: string;
  targets: SubmitTarget[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [depts, setDepts] = useState<Dept[]>([]);
  const [to, setTo] = useState('');
  const [note, setNote] = useState('Please review and approve these records.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void workApi.departments().then(setDepts, () => setDepts([]));
  }, []);

  async function send(): Promise<void> {
    if (!to) {
      setError('Choose the department that has to approve them.');
      return;
    }
    setBusy(true);
    setError('');
    let sent = 0;
    const refused: string[] = [];
    for (const t of targets) {
      try {
        await workApi.forward({
          docType,
          docId: t.docId,
          docNo: t.docNo,
          toDepartmentId: to,
          workStatus: 'Review Required',
          handoverNote: note.trim() || null,
        });
        sent += 1;
      } catch (e) {
        const u = toUiError(e);
        refused.push(`${t.docNo}: ${Object.values(u.fields)[0] ?? u.message}`);
      }
    }
    setBusy(false);
    if (sent === 0) {
      setError(refused.join(' '));
      return;
    }
    onDone(
      refused.length
        ? `Submitted ${sent}; ${refused.length} could not be submitted (${refused[0]}).`
        : `Submitted ${sent} record${sent === 1 ? '' : 's'} for approval.`,
    );
  }

  return (
    <Modal
      size="sm"
      title="Submit Selected"
      sub={`${targets.length} record${targets.length === 1 ? '' : 's'} for approval`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void send()}>
            {busy ? 'Submitting…' : 'Submit'}
          </button>
        </>
      }
    >
      {error ? (
        <p role="alert" className="error-text">
          {error}
        </p>
      ) : null}
      <div className="field">
        <label htmlFor="ss-to">Approving Department *</label>
        <select id="ss-to" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Choose a department</option>
          {depts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="ss-note">Note</label>
        <textarea id="ss-note" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}
