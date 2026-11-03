// View drawer (prototype .drawer): every field of one record as label/value tiles, the status pill,
// and the Edit / Delete / typed-action buttons the user may use.
import { Drawer } from '../../components/Drawer';
import { formatDateTime } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';
import { ActionButtons } from './RecordActions';
import { PrintMenu } from './kit/PrintMenu';
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
  onClose,
}: Props) {
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
      <div className="drawer-actions">
        {schema.tabPanels?.some((tp) => tp.scope === 'record') ? (
          <button
            type="button"
            className="btn"
            onClick={() => onOpenWorkspace?.(row)}
          >
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
        ) : null}
        {canDelete ? (
          <button type="button" className="btn danger" onClick={() => onDelete(row)}>
            Delete
          </button>
        ) : null}
      </div>
    </Drawer>
  );
}
