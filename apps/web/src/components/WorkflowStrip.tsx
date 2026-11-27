// Where a document is and what happens next, in two lines: its approval (who it is waiting on) and its department movement
// (who holds it and at which step). A department's Received / Accepted does not change the document's own status, so
// without this a Sales Order Finance had accepted still just read "Pending Approval" (QA BUG-02).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getDocApprovals, type ApprovalRequest } from '../lib/approvalsApi';
import { workApi, type DocMovement } from '../lib/workApi';

const STEP: Record<string, string> = {
  SENT: 'sent, waiting for the department to mark it Received',
  RECEIVED: 'received, waiting for the department to Accept it (or Return it)',
  ACCEPTED: 'accepted, the department is doing its part and will then Move Forward, Complete or Return it',
  IN_WORK: 'in work, the department will then Move Forward or Complete it',
  WAITING_APPROVAL: 'waiting for the department head’s approval',
};

const when = (v: string | null | undefined): string =>
  v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

export function WorkflowStrip({ docType: given, docId }: { docType?: string | undefined; docId: string }) {
  // the same document type the dialog's Move Forward / History / Email use: the page being viewed
  const { pageId: routePage = '' } = useParams();
  const docType = given || routePage;
  const [move, setMove] = useState<DocMovement | null>(null);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);

  useEffect(() => {
    if (!docType) return undefined;
    let alive = true;
    // either lookup may be refused for a role without access: the strip simply shows what it can
    void workApi.doc(docType, docId).then(
      (d) => alive && setMove(d),
      () => undefined,
    );
    void getDocApprovals(docType, docId).then(
      (a) => alive && setApproval(a.latest),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [docType, docId]);

  const holder = move?.holder ?? null;
  const pending = approval && approval.status === 'PENDING' ? approval : null;
  if (!holder && !pending) return null;

  return (
    <div
      className="workflow-strip x-bg-soft x-r-8px x-p-8px-12px x-m-8px-0 x-fs-13px"
      role="note"
      aria-label="Workflow status"
    >
      {pending ? (
        <div>
          <b>Approval:</b> pending, waiting on <b>{pending.waitingOn ?? 'an approver'}</b> (level {pending.currentLevel} of{' '}
          {pending.totalLevels}).
        </div>
      ) : null}
      {holder ? (
        <div>
          <b>Department:</b> with <b>{holder.department}</b> since {when(holder.sent_at)}, {STEP[holder.state] ?? holder.state.toLowerCase()}.
        </div>
      ) : null}
      {pending && holder ? (
        <div className="muted">
          A department accepting this record does not approve it: the status stays Pending Approval until {pending.waitingOn ?? 'the approver'}{' '}
          decides.
        </div>
      ) : null}
    </div>
  );
}
