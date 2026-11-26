// The V40 record strip of a master / register page: Record dropdown, Load Selected, Add, Edit, Delete, Documents, Submit
// Approval, Approval Queue, Move Forward and Project History. The page decides what Load / Add / Edit / Delete do; the
// documents, approval hand-over, movement and history dialogs are the same for every page.
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { HistoryDrawer, MoveForwardDialog } from '../MoveForward';
import { useToast } from '../Toast';
import { RecordDocsModal } from './RecordDialogs';
import './workspace.css';

export interface ToolbarRecord {
  /** The key the page selects by (the row id of its table). */
  key: string;
  label: string;
  /** The uuid and number Documents / Move Forward / History act on. */
  docId: string;
  docNo: string;
  status: string;
}

/** A button the page handles; `blocked` explains why it cannot run on the selected record. */
export interface ToolbarAction {
  run: () => void;
  blocked?: string | undefined;
  label?: string;
}

interface Props {
  /** The page the toolbar belongs to (record selection is announced to the top action bar under this id). */
  pageId: string;
  /** Document type of Documents / Move Forward / History when it differs from the page. */
  docType?: string;
  records: ToolbarRecord[];
  activeKey: string;
  onSelect: (key: string) => void;
  /** Missing = the user may not do it: the button is not shown. */
  onLoad: ToolbarAction;
  onAdd?: ToolbarAction | undefined;
  onEdit?: ToolbarAction | undefined;
  onDelete?: ToolbarAction | undefined;
  canEdit: boolean;
  /** Documents / hand-overs done here reload the page. */
  onChanged: () => void;
  /** Page-specific buttons after the standard ones (Activate / Deactivate). */
  extra?: ReactNode;
}

type Dialog = 'docs' | 'submit' | 'move' | 'history' | null;

export function RecordToolbar(p: Props) {
  const toast = useToast();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<Dialog>(null);
  const active = p.records.find((r) => r.key === p.activeKey) ?? p.records[0];
  const docType = p.docType ?? p.pageId;

  // the top action bar (Word, Industry PDF, Send Email, Excel) acts on the record the user picked here
  const [picked, setPicked] = useState(false);
  const docId = picked ? (active?.docId ?? '') : '';
  const docNo = picked ? (active?.docNo ?? '') : '';
  useEffect(() => {
    // nothing picked yet: leave the bar alone (a ticked table row may already be its record)
    if (!docId) return undefined;
    const announce = (): void => {
      window.dispatchEvent(new CustomEvent('v40-active-record', { detail: { pageId: p.pageId, recordId: docId, docNo } }));
    };
    announce();
    const onRequest = (e: Event): void => {
      const ce = e as CustomEvent<{ pageId?: string }>;
      if (!ce.detail?.pageId || ce.detail.pageId === p.pageId) announce();
    };
    window.addEventListener('v40-request-active-record', onRequest);
    return () => window.removeEventListener('v40-request-active-record', onRequest);
  }, [p.pageId, docId, docNo]);

  // Send Email / Word / Industry PDF of the top bar fall back to the record this picker shows (asked at click time, so a
  // ticked table row still wins and Excel still exports the whole register)
  const shownId = active?.docId ?? '';
  const shownNo = active?.docNo ?? '';
  useEffect(() => {
    // an empty id is an answer too: the picker has no record on this tab
    const onAsk = (e: Event): void => {
      const { detail } = e as CustomEvent<{ pageId?: string; record: { id: string; docNo: string } | null }>;
      if (detail.pageId === p.pageId) detail.record = { id: shownId, docNo: shownNo };
    };
    window.addEventListener('v40-shown-record', onAsk);
    return () => window.removeEventListener('v40-shown-record', onAsk);
  }, [p.pageId, shownId, shownNo]);

  // a button stays clickable and says what is missing, instead of sitting greyed out with no reason
  const needRecord = (go: () => void, blocked?: string) => (): void => {
    if (!active) toast('There is no record yet. Add one first.');
    else if (blocked) toast(blocked);
    else go();
  };
  const handled = (a: ToolbarAction) => needRecord(a.run, a.blocked);

  return (
    <div className="recordbar ws-toolbar" role="group" aria-label="Record actions">
      <b>Record:</b>
      <select
        aria-label="Select Record"
        value={active?.key ?? ''}
        onChange={(e) => {
          setPicked(true);
          p.onSelect(e.target.value);
        }}
      >
        {p.records.map((r) => (
          <option key={r.key} value={r.key}>
            {r.label}
          </option>
        ))}
        {p.records.length === 0 ? <option value="">No records available</option> : null}
      </select>
      <button type="button" className="btn sm" onClick={handled(p.onLoad)}>
        Load Selected
      </button>
      {p.onAdd ? (
        <button type="button" className="btn sm" onClick={() => p.onAdd?.run()}>
          {p.onAdd.label ?? '＋ Add'}
        </button>
      ) : null}
      {p.onEdit ? (
        <button type="button" className="btn sm" onClick={handled(p.onEdit)}>
          Edit
        </button>
      ) : null}
      {p.onDelete ? (
        <button type="button" className="btn sm danger" onClick={handled(p.onDelete)}>
          Delete
        </button>
      ) : null}
      <button type="button" className="btn sm" onClick={needRecord(() => setDialog('docs'))}>
        Documents
      </button>
      <button type="button" className="btn sm btn-submit" onClick={needRecord(() => setDialog('submit'))}>
        Submit Approval
      </button>
      <button type="button" className="btn sm btn-queue" onClick={() => navigate('/m/my-approvals')}>
        Approval Queue
      </button>
      <button type="button" className="btn sm btn-move" onClick={needRecord(() => setDialog('move'))}>
        Move Forward
      </button>
      <button type="button" className="btn sm" onClick={needRecord(() => setDialog('history'))}>
        Project History
      </button>
      {p.extra}
      {dialog === 'docs' && active ? (
        <RecordDocsModal
          docType={docType}
          docId={active.docId}
          docNo={active.docNo}
          status={active.status}
          canEdit={p.canEdit}
          onClose={() => setDialog(null)}
          onChanged={p.onChanged}
        />
      ) : null}
      {(dialog === 'move' || dialog === 'submit') && active ? (
        <MoveForwardDialog
          docType={docType}
          docId={active.docId}
          docNo={active.docNo}
          {...(dialog === 'submit'
            ? {
                title: 'Submit for Approval',
                initialWorkStatus: 'Review Required' as const,
                initialNote: 'Please review and approve this record.',
              }
            : {})}
          onClose={() => setDialog(null)}
          onMoved={() => {
            toast(dialog === 'submit' ? `${active.docNo} sent for approval.` : `${active.docNo} moved forward.`);
            setDialog(null);
            p.onChanged();
          }}
        />
      ) : null}
      {dialog === 'history' && active ? (
        <HistoryDrawer docType={docType} docId={active.docId} title={active.docNo} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}
