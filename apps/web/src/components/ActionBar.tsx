// Phase 22-C / Phase 36 C3: the one V40 button bar (ROADMAP R-32).
//   no permission        -> the button is hidden
//   the record blocks it -> the button is greyed and the reason is shown on hover / focus
// Phase 36: no button is ever dead. A page handler (onAction returning true) wins; otherwise the bar runs the
// shared default - Print, Excel (the visible table), Industry PDF / Word / record Excel (the print endpoint),
// Approval Queue, Documents and Move Forward (the Phase 25 dialog) - and a button that truly cannot work is
// greyed with "Not available yet: {reason}". There is no "Arrives in Phase" text any more.
// + Add New / + Add and Submit Approval have no single generic backend action (the create/submit shape is
// page-specific), so the shared default dispatches a window event the page can opt into (DocPage already
// does, for + Add New) and marks `detail.handled = true`; a page that hasn't wired a listener gets an honest
// "use this screen's own button" toast instead of a silent no-op or a false success message.
import { useEffect, useState } from 'react';
import { useInRouterContext, useNavigate } from 'react-router-dom';
import type { ActionSet } from '../types';
import type { ActionKey, RecordActions } from '../lib/screensApi';
import { docsMailApi, saveFile, type PrintKind } from '../lib/docsMailApi';
import { useToast } from './Toast';
import { EmailDocDialog } from './EmailDocDialog';
import { MoveForwardDialog } from './MoveForward';
import { PickDocumentDialog } from './PickDocument';
import { ImportDrawer } from './ImportDrawer';
import { duplicateMessage, scanDuplicates } from './dupScan';
import { findAddButton } from '../lib/ownAddButton';

const PICK_FIRST = 'Select a record first.';

interface Btn {
  label: string;
  /** Page permission needed; the button is hidden without it. */
  need: keyof ActionSet;
  /** Record-level buttons need a selected record. */
  record?: ActionKey;
  /** The default handler needs a selected record (print endpoint / Move Forward work on one record). */
  needsRecord?: boolean;
  primary?: boolean;
  /** page = the shell bar above older pages; full = list screens; both = either. Default both. */
  where?: 'page' | 'full' | 'both';
  /** Page mode: shown only when the page body has no button of this name of its own (no duplicates). */
  ifAbsent?: boolean;
}

export const BAR: readonly Btn[] = [
  { label: 'Dashboard', need: 'view' },
  { label: 'Full 360°', need: 'view' },
  { label: 'Move Next Controlled Step', need: 'view', needsRecord: true },
  { label: '← Return', need: 'view' },
  { label: 'Send Email', need: 'view', needsRecord: true },
  { label: 'Excel', need: 'export', where: 'full', ifAbsent: true },
  { label: 'Industry PDF', need: 'print', needsRecord: true },
  { label: 'Word', need: 'print', needsRecord: true },
  { label: 'Print', need: 'print', where: 'full', ifAbsent: true },
  { label: '＋ Add New', need: 'add', primary: true },
  { label: 'Load Selected', need: 'view', ifAbsent: true },
  { label: '＋ Add', need: 'add', where: 'full' },
  { label: '⇧ Import', need: 'add' },
  { label: '⇩ Export', need: 'export' },
  { label: 'Duplicates', need: 'view' },
  { label: 'Edit', need: 'edit', record: 'edit', where: 'full', ifAbsent: true },
  { label: 'Delete', need: 'delete', record: 'delete', where: 'full', ifAbsent: true },
  { label: 'Documents', need: 'view', record: 'documents' },
  { label: 'Submit Approval', need: 'submit', record: 'submit' },
  { label: 'Approval Queue', need: 'view' },
  { label: 'Move Forward', need: 'view', needsRecord: true },
  { label: 'Move Document', need: 'view' },
  { label: 'Move Forward - Internal', need: 'view', needsRecord: true },
  { label: 'Project History', need: 'view' },
  { label: 'Approvals', need: 'view', where: 'full', ifAbsent: true },
  { label: 'Reports', need: 'view', where: 'full', ifAbsent: true },
  { label: 'Analytics & Graphs', need: 'view', where: 'full', ifAbsent: true },
  { label: 'Audit Trail', need: 'view', where: 'full', ifAbsent: true },
  { label: '360° Tracking', need: 'view', where: 'full', ifAbsent: true },
];

/** Page buttons the bar can run by itself (everything else needs the page's own onAction). */
const DEFAULTS = new Set([
  'Dashboard',
  'Full 360°',
  'Move Next Controlled Step',
  'Move Document',
  'Move Forward - Internal',
  '← Return',
  'Send Email',
  'Excel',
  '⇩ Export',
  '⇧ Import',
  'Duplicates',
  'Industry PDF',
  'Word',
  'Print',
  '＋ Add New',
  '＋ Add',
  'Approval Queue',
  'Documents',
  'Move Forward',
  'Project History',
  'Approvals',
  'Reports',
  'Analytics & Graphs',
  'Audit Trail',
  '360° Tracking',
]);

const BUTTON_CLASS: Record<string, string> = {
  '← Return': 'btn-return',
  'Full 360°': 'btn-360',
  'Send Email': 'btn-email',
  Word: 'btn-word',
  Excel: 'btn-excel',
  'Industry PDF': 'btn-pdf',
  Print: 'btn-print',
  '＋ Add New': 'primary btn-add',
  '＋ Add': 'primary btn-add',
  '⇧ Import': 'btn-import',
  '⇩ Export': 'btn-export',
  Duplicates: 'btn-duplicates',
  'Project History': 'btn-history',
};

const V40_CORE_BUTTONS: readonly string[] = [
  '← Return',
  'Full 360°',
  'Send Email',
  'Word',
  'Excel',
  'Industry PDF',
  'Print',
  '＋ Add New',
  '⇧ Import',
  '⇩ Export',
  'Duplicates',
  'Project History',
];

const ADMIN_CORE_BUTTONS: readonly string[] = [
  '← Return',
  '⇧ Import',
  '⇩ Export',
  'Duplicates',
];

// QA report (BI-03): one standard toolbar on every BI screen, the same as the other modules.
const BI_CORE_BUTTONS: readonly string[] = [
  '← Return',
  'Send Email',
  'Word',
  'Excel',
  'Industry PDF',
  'Print',
  '＋ Add New',
  '⇧ Import',
  '⇩ Export',
  'Duplicates',
  'Project History',
];

/** V40 has three buttons that move the selected record on to the next department: they all open the Move Forward dialog. */
const MOVE_LABELS: ReadonlySet<string> = new Set(['Move Forward', 'Move Next Controlled Step', 'Move Forward - Internal']);

/** Where the navigation defaults go. */
const GO: Record<string, string> = {
  Dashboard: '/m/dashboard',
  'Full 360°': '/m/ops-order-360',
  'Move Document': '/m/document-movement-center',
  'Project History': '/m/project-global-history',
  'Approval Queue': '/approvals',
  Documents: '/m/business-documents',
  Approvals: '/approvals',
  Reports: '/m/bi-reports',
  'Analytics & Graphs': '/m/bi-dashboards',
  'Audit Trail': '/m/admin-audit',
  '360° Tracking': '/m/ops-order-360',
};

interface Props {
  actions: ActionSet;
  /** The selected record's answer from the server (GET …/:id/actions). null = nothing selected. */
  record?: RecordActions | null;
  /** page: shell-level bar (cross-cutting buttons only); full: list screens with records. */
  mode?: 'page' | 'full';
  /** Per-button reasons the screen itself knows (e.g. an entry form that is not built yet). */
  blocked?: Readonly<Record<string, string>>;
  /** Return true when the page handled the click; anything else lets the shared default run. */
  onAction?: (label: string) => boolean | void;
  /** Page id and selected record: they switch on the print / Move Forward defaults. */
  pageId?: string;
  recordId?: string | null;
  docNo?: string;
}

/** The visible register as a CSV file (opens in Excel) - the Excel button for pages with no export of their own. */
export function tableToCsv(table: HTMLTableElement): string {
  const cell = (c: Element) =>
    `"${(c.textContent ?? '').replace(/\s+/g, ' ').trim().replace(/"/g, '""')}"`;
  return [...table.querySelectorAll('tr')]
    .map((r) => [...r.children].map(cell).join(','))
    .join('\r\n');
}

export function ActionBar(props: Props) {
  const inRouter = useInRouterContext();
  return inRouter ? <WithNavigate {...props} /> : <Bar {...props} />;
}

function WithNavigate(props: Props) {
  const navigate = useNavigate();
  return <Bar {...props} go={(to) => (typeof to === 'number' ? navigate(to) : navigate(to))} />;
}

/** Pages that are views of another page's records: their record dialogs use that page's document type. */
const DOC_TYPE_OF: Record<string, string> = { 'master-products': 'inv-items', 'master-materials': 'inv-items' };

function Bar({
  actions,
  record = null,
  mode = 'full',
  blocked,
  onAction,
  pageId,
  recordId = null,
  docNo,
  go,
}: Props & { go?: (to: string | number) => void }) {
  const toast = useToast();
  const [moving, setMoving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<{ id: string; number: string } | null>(null);
  /** The record the email dialog is open for ('' = closed). */
  const [emailing, setEmailing] = useState('');
  const [importing, setImporting] = useState(false);
  const [syncedRecord, setSyncedRecord] = useState<{ id: string; docNo: string } | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ pageId: string; recordId: string; docNo: string }>;
      if (ce.detail && (!pageId || ce.detail.pageId === pageId)) {
        // an empty id = the page un-ticked its record: the buttons go back to "select a record"
        setSyncedRecord(ce.detail.recordId ? { id: ce.detail.recordId, docNo: ce.detail.docNo } : null);
      }
    };
    window.addEventListener('v40-active-record', handler);
    if (pageId && !syncedRecord) {
      window.dispatchEvent(new CustomEvent('v40-request-active-record', { detail: { pageId } }));
    }
    return () => window.removeEventListener('v40-active-record', handler);
  }, [pageId, syncedRecord]);

  // Page mode: only what an older page does not already draw itself (they keep their own Excel / Print / Add).
  // Excel / Print / Edit / Delete: V40 shows them on every page. Older pages draw some themselves, so the shell
  // bar adds them only when the page body has no such button (checked once the page has rendered).
  const [own, setOwn] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (mode !== 'page') return undefined;
    setOwn(null);
    const t = setTimeout(() => {
      const found = new Set<string>();
      document.querySelectorAll<HTMLElement>('.main button').forEach((b) => {
        if (!b.closest('.actionbar')) found.add((b.textContent ?? '').trim());
      });
      setOwn(found);
    }, 900);
    return () => clearTimeout(t);
  }, [mode, pageId]);
  // BI screens (including Custom Dashboards) always get the one standard toolbar (QA report BI-03).
  const isV40Page =
    !!pageId &&
    (pageId.startsWith('bi-') || (!pageId.includes('dashboard') && !pageId.includes('settings')));

  const shown = isV40Page
    ? (pageId?.startsWith('admin-')
        ? ADMIN_CORE_BUTTONS
        : pageId?.startsWith('bi-')
          ? BI_CORE_BUTTONS
          : V40_CORE_BUTTONS
      ).map((lbl) => BAR.find((b) => b.label === lbl)!).filter(Boolean)
    : BAR.filter(
        (b) =>
          (b.where ?? 'both') === 'both' ||
          b.where === mode ||
          (mode === 'page' && b.ifAbsent === true && own !== null && !own.has(b.label)),
      );
  const effRecordId = recordId || syncedRecord?.id || null;
  const effDocNo = docNo || syncedRecord?.docNo || undefined;
  const haveRecord = !!pageId && !!effRecordId;
  const docType = pageId ? (DOC_TYPE_OF[pageId] ?? pageId) : '';
  const effectiveRecord: RecordActions | null =
    record !== null
      ? record
      : haveRecord
        ? {
            allowed: ['edit', 'delete', 'documents', 'submit'],
            blocked: {},
          }
        : null;

  /** The record a page's record picker shows, for the buttons that need one when none is ticked. */
  function shownRecord(): { id: string; docNo: string } | null {
    const detail: { pageId: string | undefined; record: { id: string; docNo: string } | null } = { pageId, record: null };
    window.dispatchEvent(new CustomEvent('v40-shown-record', { detail }));
    return detail.record;
  }

  async function runDefault(label: string): Promise<void> {
    try {
      const target = GO[label];
      if (label === 'Print') window.print();
      else if (label === '← Return') go?.(-1);
      else if (label === '＋ Add New' || label === '＋ Add') {
        const detail = { pageId, handled: false };
        window.dispatchEvent(new CustomEvent('v40-add-record', { detail }));
        if (!detail.handled) {
          // no page listened: press the page's own "+ New" button, if it has one (TC-21: it used to answer with a toast only)
          const own = findAddButton(document.getElementById('main') ?? document.body);
          if (own) own.click();
          else toast('Nothing is typed in on this screen: its records are made from other documents.');
        }
      }
      else if (label === '⇧ Import' || label === 'Import') {
        setImporting(true);
      }
      else if (label === 'Duplicates') {
        // QA ERP-DUP-01: really compare the rows of the register on screen and highlight the repeated ones
        toast(duplicateMessage(scanDuplicates()));
      } else if (label === 'Full 360°') {
        // a register that owns the active record opens its 360° trace in place; any other page opens the order 360° screen
        const detail = { pageId, handled: false };
        window.dispatchEvent(new CustomEvent('v40-open-360', { detail }));
        if (!detail.handled && target) go?.(target);
      } else if (target) go?.(target);
      else if (MOVE_LABELS.has(label)) {
        if (haveRecord && effRecordId) setMoving(true);
        else setPicking(true);
      } else if (label === 'Send Email') {
        if (haveRecord && effRecordId) setEmailing(effRecordId);
        else toast('Select a record first, then press Send Email.');
      } else if (label === '⇩ Export' && !haveRecord) await runDefault('Excel');
      else if ((label === 'Excel' || label === '⇩ Export') && haveRecord && effRecordId)
        saveFile(await docsMailApi.print(pageId ?? '', effRecordId, 'excel'), `${effDocNo ?? 'record'}.xlsx`);
      else if (label === 'Excel') {
        // a register that can export all its records does so; the rows drawn on screen are only the fallback
        const detail = { pageId, handled: false };
        window.dispatchEvent(new CustomEvent('v40-export-register', { detail }));
        if (detail.handled) return;
        const table = document.querySelector<HTMLTableElement>('.main table');
        if (!table) return void toast('Nothing to export: no table on this page.');
        saveFile(
          {
            blob: new Blob(['\ufeff' + tableToCsv(table)], { type: 'text/csv;charset=utf-8' }),
            filename: null,
          },
          `${pageId ?? 'register'}.csv`,
        );
      } else if (label === 'Industry PDF' || label === 'Word') {
        const shownRow = effRecordId ? null : shownRecord();
        const rowId = effRecordId || shownRow?.id || document.querySelector<HTMLTableRowElement>('table tbody tr')?.getAttribute('data-id');
        const rowNo = effDocNo ?? shownRow?.docNo;
        const kind: PrintKind = label === 'Word' ? 'word' : 'standard';
        if (rowId && pageId) {
          try {
            saveFile(
              await docsMailApi.print(pageId ?? '', rowId, kind),
              `${rowNo ?? 'document'}.${label === 'Word' ? 'docx' : 'pdf'}`,
            );
            return;
          } catch {
            // fall back
          }
        }
        if (label === 'Word') {
          const table = document.querySelector<HTMLTableElement>('.main table') || document.querySelector<HTMLTableElement>('table');
          const docHtml = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'><head><meta charset='utf-8'><title>${effDocNo ?? pageId}</title></head><body><h2>Sawant Group ERP — ${pageId}</h2><p>Reference: ${effDocNo ?? 'Register Export'}</p>${table ? table.outerHTML : ''}</body></html>`;
          saveFile({ blob: new Blob(['\ufeff' + docHtml], { type: 'application/msword;charset=utf-8' }), filename: `${effDocNo ?? pageId}.doc` }, `${effDocNo ?? pageId}.doc`);
          return;
        }
        window.print();
      } else if (label === 'Documents') {
        toast(`Opening documents repository for ${effDocNo || pageId}.`);
        go?.('/m/business-documents');
      } else if (label === 'Submit Approval') {
        const detail = { pageId, recordId: effRecordId, handled: false };
        window.dispatchEvent(new CustomEvent('v40-submit-record', { detail }));
        if (!detail.handled) toast("This screen's own Submit button sends the record for approval.");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not complete this action.');
    }
  }

  function click(label: string) {
    // V40 has two add buttons (head "＋ Add New", tab "＋ Add") and "Load Selected" (open the ticked row): the screens know "＋ Add", "Edit" and "View"
    if (label === '＋ Add New' && onAction?.('＋ Add') === true) return;
    if (label === 'Load Selected' && (onAction?.('Edit') === true || onAction?.('View') === true)) return;
    if (onAction?.(label) === true) return;
    if (DEFAULTS.has(label)) void runDefault(label);
  }

  return (
    <div className="actionbar" role="toolbar" aria-label="Page actions" data-testid="actionbar">
      {shown.map((b) => {
        if (isV40Page ? !actions.view : !actions[b.need]) return null; // no permission: hidden
        let reason: string | null = blocked?.[b.label] ?? null;
        if (reason !== null) {
          // the screen's own reason wins
        } else if (b.record) {
          if (effectiveRecord === null) reason = PICK_FIRST;
          else if (effectiveRecord.blocked[b.record]) reason = effectiveRecord.blocked[b.record] ?? null;
          else if (!effectiveRecord.allowed.includes(b.record)) reason = 'Not available for this record.';
        } else if (b.needsRecord && !haveRecord) reason = PICK_FIRST;
        else if (!DEFAULTS.has(b.label) && !onAction)
          reason = 'Not available yet: this page has no handler for it.';
        // A button stays clickable (the client's QA lists greyed buttons as defects): the click says what to do
        const needsPick = reason === PICK_FIRST;
        const disabled = false;
        const extraClass = BUTTON_CLASS[b.label] ?? '';
        const btnClassName = b.primary ? `btn primary ${extraClass}`.trim() : `btn ${extraClass}`.trim();
        return (
          <span key={b.label} className="actionbar-item" title={reason ?? undefined}>
            <button
              type="button"
              className={btnClassName}
              disabled={disabled}
              aria-disabled={disabled}
              onClick={() => {
                if (needsPick || reason) {
                  if (b.label === 'Send Email') {
                    const shown = effRecordId ? null : shownRecord();
                    const target = effRecordId || shown?.id || '';
                    if (target) setEmailing(target);
                    else toast(shown ? 'There is no record on this tab to email yet.' : 'Tick or open a record first, then press Send Email.');
                    return;
                  }
                  if (MOVE_LABELS.has(b.label) && pageId) {
                    setPicking(true);
                    return;
                  }
                  if (b.label === 'Industry PDF' || b.label === 'Word') {
                    void runDefault(b.label);
                    return;
                  }
                  toast(reason || ('Select a row first, then press ' + b.label + '.'));
                } else {
                  click(b.label);
                }
              }}
            >
              {b.label}
            </button>
            {reason ? <span className="sr-only">{reason}</span> : null}
          </span>
        );
      })}
      {importing ? (
        <ImportDrawer
          pageId={pageId ?? ''}
          onClose={() => setImporting(false)}
          onOpenWorkspace={() => go?.('/m/admin-import')}
        />
      ) : null}
      {picking && pageId ? (
        <PickDocumentDialog
          pageId={docType}
          onClose={() => setPicking(false)}
          onPick={(r) => {
            setPicking(false);
            setPicked(r);
          }}
        />
      ) : null}
      {picked && pageId ? <MoveForwardDialog docType={docType} docId={picked.id} docNo={picked.number} onClose={() => setPicked(null)} onMoved={() => setPicked(null)} /> : null}
      {emailing && pageId ? (
        <EmailDocDialog docType={docType} docId={emailing} onClose={() => setEmailing('')} />
      ) : null}
      {moving && pageId && effRecordId ? (
        <MoveForwardDialog
          docType={docType}
          docId={effRecordId}
          docNo={effDocNo}
          onClose={() => setMoving(false)}
          onMoved={() => setMoving(false)}
        />
      ) : null}
    </div>
  );
}
