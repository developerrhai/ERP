// The "Approval journey": one block per level with the role, the people, the time, the comment and
// "on behalf of", then the full timeline (submit, approve, escalate, remind…). Used by the Approval
// Center drawer and by the record drawer of every module page.
import { formatDateTime } from '../../lib/format';
import {
  ACTION_LABEL,
  STATUS_LABEL,
  inr,
  type ApprovalRequest,
  type StepView,
} from '../../lib/approvalsApi';

export const statusClass = (s: string): string => s.toLowerCase().replace(/\s+/g, '-');

function who(step: StepView): string {
  if (step.actedBy) {
    return step.onBehalfOf
      ? `${step.actedBy.name} (on behalf of ${step.onBehalfOf.name})`
      : step.actedBy.name;
  }
  if (step.assignees.length === 0) return 'Nobody assigned yet';
  return step.assignees
    .map((a) => (a.onBehalfOf ? `${a.name} (on behalf of ${a.onBehalfOf})` : a.name))
    .join(', ');
}

const STEP_LABEL: Record<string, string> = {
  WAITING: 'Waiting',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  RETURNED: 'Returned',
  CANCELLED: 'Cancelled',
};

export function ApprovalJourney({ request }: { request: ApprovalRequest }) {
  return (
    <section className="journey" aria-label="Approval journey">
      <div className="journey-head">
        <span className={`status ${statusClass(request.status)}`}>
          {STATUS_LABEL[request.status]}
        </span>
        <span className="v8-sub">
          {request.moduleTitle} {request.docCode} • {inr(request.amount)} • {request.department} •
          attempt {request.cycle}
        </span>
      </div>
      <ol className="journey-steps">
        {request.steps.map((s) => (
          <li key={s.id} className={`journey-step ${statusClass(s.status)}`}>
            <div>
              <b>
                Level {s.level} · {s.approver}
              </b>{' '}
              <span className={`status ${statusClass(s.status)}`}>
                {STEP_LABEL[s.status] ?? s.status}
              </span>
              {s.overdue ? <span className="status overdue"> Overdue</span> : null}
            </div>
            <div className="v8-sub">{who(s)}</div>
            {s.actedAt ? <div className="v8-sub">{formatDateTime(s.actedAt)}</div> : null}
            {s.status === 'PENDING' && s.dueAt ? (
              <div className="v8-sub">Due {formatDateTime(s.dueAt)}</div>
            ) : null}
            {s.escalatedAt ? (
              <div className="v8-sub">Escalated {formatDateTime(s.escalatedAt)}</div>
            ) : null}
            {s.comment ? <div className="journey-comment">“{s.comment}”</div> : null}
          </li>
        ))}
      </ol>
      <h4>History</h4>
      <ol className="timeline">
        <li>
          <b>Requested</b>
          <span className="v8-sub">
            {' '}
            {request.requestedBy.name} • {formatDateTime(request.requestedAt)}
          </span>
        </li>
        {request.timeline.map((t) => (
          <li key={t.id}>
            <b>
              {ACTION_LABEL[t.action] ?? t.action}
              {t.level ? ` · level ${t.level}` : ''}
            </b>
            <span className="v8-sub">
              {' '}
              {t.actor
                ? t.onBehalfOf
                  ? `${t.actor.name} (on behalf of ${t.onBehalfOf.name})`
                  : t.actor.name
                : 'System'}{' '}
              • {formatDateTime(t.at)}
            </span>
            {t.comment ? <div className="journey-comment">“{t.comment}”</div> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
