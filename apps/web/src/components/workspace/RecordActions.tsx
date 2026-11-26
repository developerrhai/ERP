// The standard buttons of one stored record on a screen with its own table: Email, PDF, Word, Excel, Docs and Move
// Forward, with their dialogs. The page keeps its own Open / Edit buttons.
import { useState, type ReactNode } from 'react';
import { docsMailApi, printFile, saveFile, type PrintKind } from '../../lib/docsMailApi';
import { toUiError } from '../../lib/errors';
import { EmailDocDialog } from '../EmailDocDialog';
import { MoveForwardDialog } from '../MoveForward';
import { useToast } from '../Toast';
import { RecordDocsModal } from './RecordDialogs';
import './workspace.css';

type Dialog = 'email' | 'docs' | 'move' | null;

export function RecordActions({
  docType,
  id,
  number,
  status = '',
  onChanged,
  children,
  move = true,
  withPrint = false,
}: {
  /** the page id the record belongs to (its print layout, documents and hand-overs) */
  docType: string;
  id: string;
  number: string;
  status?: string;
  onChanged?: () => void;
  /** the page's own buttons (Open, View ...), shown first in the same tidy block */
  children?: ReactNode;
  /** false when the page has its own Move Forward button */
  move?: boolean;
  /** add a Print button (the record view dialogs) */
  withPrint?: boolean;
}) {
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const print = async (kind: PrintKind, ext: string): Promise<void> => {
    try {
      saveFile(await docsMailApi.print(docType, id, kind), `${number || 'record'}.${ext}`);
    } catch (e) {
      toast(toUiError(e).message);
    }
  };
  const button = (label: string, run: () => void, primary = false) => (
    <button type="button" className={`btn sm${primary ? ' primary' : ''}`} aria-label={`${label} ${number}`} onClick={run}>
      {label}
    </button>
  );
  return (
    <span className="ws-record-actions" onClick={(e) => e.stopPropagation()}>
      {children}
      {button('Email', () => setDialog('email'))}
      {button('PDF', () => void print('standard', 'pdf'))}
      {button('Word', () => void print('word', 'docx'))}
      {button('Excel', () => void print('excel', 'xlsx'))}
      {button('Docs', () => setDialog('docs'))}
      {withPrint
        ? button('Print', () => void docsMailApi.print(docType, id, 'standard').then(printFile, (e: unknown) => toast(toUiError(e).message)))
        : null}
      {move ? button('Move Forward', () => setDialog('move'), true) : null}
      {dialog === 'email' ? <EmailDocDialog docType={docType} docId={id} onClose={() => setDialog(null)} /> : null}
      {dialog === 'docs' ? (
        <RecordDocsModal docType={docType} docId={id} docNo={number} status={status} canEdit onClose={() => setDialog(null)} {...(onChanged ? { onChanged } : {})} />
      ) : null}
      {dialog === 'move' ? (
        <MoveForwardDialog
          docType={docType}
          docId={id}
          docNo={number}
          onClose={() => setDialog(null)}
          onMoved={() => {
            setDialog(null);
            toast(`${number} moved forward.`);
            onChanged?.();
          }}
        />
      ) : null}
    </span>
  );
}
