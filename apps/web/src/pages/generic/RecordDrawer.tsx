// View drawer (prototype .drawer): every field of one record as label/value tiles, the status pill,
// and the Edit / Delete / typed-action buttons the user may use.
import { Drawer } from '../../components/Drawer';
import { RecordApprovalPanel } from '../approvals/ApprovalsTab';
import { formatDateTime } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';
import { ActionButtons } from './RecordActions';
import { PrintMenu } from './kit/PrintMenu';
import { DocumentsPanel } from './DocumentsPanel';
import { lockAllows, openRecordPdf, submitRecord } from './phase4Api';
import { toUiError } from '../../lib/errors';
import { useState } from 'react';
import { HistoryDrawer, MoveForwardDialog } from '../../components/MoveForward';
import { PrintButtons } from '../docsmail/DocsMailPages';
import { listRecordAudit, type PageAction, type PageSchema, type RecordRow } from './engineApi';
import { displayValue, isEmptyValue, valueOf } from './fieldModel';

interface Props {
  schema: PageSchema;
  row: RecordRow;
  perms: Record<string, boolean>;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (row: RecordRow) => void;
  onDelete: (row: RecordRow) => void;
  onAction: (row: RecordRow, action: PageAction) => void;
  onOpenWorkspace?: (row: RecordRow) => void;
  /** Called with the saved row after a successful Submit. */
  onSubmitted?: (row: RecordRow) => void;
  /** Called after an approval decision / withdraw in the drawer; the page reloads the record. */
  onApprovalChanged?: () => void;
  onClose: () => void;
}

export function RecordDrawer({
  schema,
  row,
  perms,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  onAction,
  onOpenWorkspace,
  onSubmitted,
  onApprovalChanged,
  onClose,
}: Props) {
  const [actionError, setActionError] = useState('');
  const [moving, setMoving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const generic = schema.kind === 'generic';
  const canSubmit =
    generic && perms.submit === true && lockAllows(schema.lock, row.status, 'submit');
  const pendingLock = generic && row.status === 'Pending Approval';
  const lockedTip = 'Locked while pending approval';
  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setActionError('');
    try {
      onSubmitted?.(await submitRecord(schema.pageId, row));
    } catch (err) {
      setActionError(toUiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };
  const activity = useLoad(
    () => listRecordAudit(schema.pageId, row.id),
    [schema.pageId, row.id, row.version],
  );
  return (
    <Drawer title={`${schema.title} Details`} onClose={onClose}>
      <div className="drawer-grid">
        {schema.fields.map((f) => {
          const v = valueOf(row, f);
          return (
            <div className="v8-mini" key={f.key}>
              <small>{f.label}</small>
              {f.type === 'status' && !isEmptyValue(v) ? (
                <b>
                  <span className={`status ${String(v).toLowerCase().replace(/\s+/g, '-')}`}>
                    {String(v)}
                  </span>
                </b>
              ) : (
                <b>{displayValue(row, f)}</b>
              )}
            </div>
          );
        })}
      </div>
      <p className="v8-sub drawer-meta">
        Created {formatDateTime(row.createdAt)}
        {row.createdBy?.name ? ` by ${row.createdBy.name}` : ''}
        {row.department ? ` • ${row.department}` : ''}
      </p>
      {generic ? <DocumentsPanel schema={schema} row={row} canEdit={perms.edit === true} /> : null}
      {generic ? (
        <RecordApprovalPanel
          pageId={schema.pageId}
          recordId={row.id}
          version={row.version}
          onChanged={() => onApprovalChanged?.()}
        />
      ) : null}
      <section className="drawer-section" aria-label="Activity">
        <h3>Activity</h3>
        {activity.error ? <p className="v8-sub">{activity.error}</p> : null}
        {activity.loading && !activity.data ? <p className="v8-sub">Loading…</p> : null}
        {activity.data && activity.data.rows.length === 0 ? (
          <p className="v8-sub">No activity recorded yet.</p>
        ) : null}
        <ol className="timeline">
          {(activity.data?.rows ?? []).map((a) => (
            <li key={a.id}>
              <b>{a.action.replace(/_/g, ' ').toLowerCase()}</b>
              <span className="v8-sub">
                {' '}
                {a.actorName ?? 'System'} • {formatDateTime(a.at)}
              </span>
            </li>
          ))}
        </ol>
      </section>
      {actionError ? (
        <p className="field-error" role="alert">
          {actionError}
        </p>
      ) : null}
      <div className="drawer-actions">
        {generic && canEdit ? (
          <button type="button" className="btn" onClick={() => setMoving(true)}>
            Move Forward
          </button>
        ) : null}
        {generic ? <PrintButtons pageId={schema.pageId} id={row.id} /> : null}
        {generic ? (
          <button type="button" className="btn" onClick={() => setHistoryOpen(true)}>
            History
          </button>
        ) : null}
        {generic && perms.export ? (
          <button
            type="button"
            className="btn"
            onClick={() =>
              void openRecordPdf(schema.pageId, row.id).catch((e: unknown) =>
                setActionError(toUiError(e).message),
              )
            }
          >
            PDF
          </button>
        ) : null}
        {canSubmit ? (
          <button
            type="button"
            className="btn primary"
            disabled={submitting}
            onClick={() => void submit()}
          >
            {submitting ? 'Submitting…' : 'Submit for Approval'}
          </button>
        ) : null}
        {schema.tabPanels?.some((tp) => tp.scope === 'record') ? (
          <button type="button" className="btn" onClick={() => onOpenWorkspace?.(row)}>
            Open workspace
          </button>
        ) : null}
        {schema.printTemplates && schema.printTemplates.some((t) => t.scope !== 'page') ? (
          <PrintMenu
            pageId={schema.pageId}
            recordId={row.id}
            templates={schema.printTemplates}
            buttonLabel="Print ▾"
            className="btn"
          />
        ) : null}
        <ActionButtons schema={schema} row={row} perms={perms} onAction={onAction} />
        {canEdit ? (
          <button type="button" className="btn" onClick={() => onEdit(row)}>
            Edit
          </button>
        ) : pendingLock && perms.edit ? (
          <button type="button" className="btn" disabled title={lockedTip}>
            Edit
          </button>
        ) : null}
        {canDelete ? (
          <button type="button" className="btn danger" onClick={() => onDelete(row)}>
            Delete
          </button>
        ) : pendingLock && perms.delete ? (
          <button type="button" className="btn danger" disabled title={lockedTip}>
            Delete
          </button>
        ) : null}
      </div>
      {moving ? (
        <MoveForwardDialog
          docType={schema.pageId}
          docId={row.id}
          docNo={row.code}
          onClose={() => setMoving(false)}
          onMoved={() => {
            setMoving(false);
            onApprovalChanged?.();
          }}
        />
      ) : null}
      {historyOpen ? (
        <HistoryDrawer docType={schema.pageId} docId={row.id} title={row.code} onClose={() => setHistoryOpen(false)} />
      ) : null}
    </Drawer>
  );
}
