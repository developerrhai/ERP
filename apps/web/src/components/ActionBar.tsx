// Phase 22-C / Phase 36 C3: the one V40 button bar (ROADMAP R-32).
//   no permission        -> the button is hidden
//   the record blocks it -> the button is greyed and the reason is shown on hover / focus
// Phase 36: no button is ever dead. A page handler (onAction returning true) wins; otherwise the bar runs the
// shared default - Print, Excel (the visible table), Industry PDF / Word / record Excel (the print endpoint),
// Approval Queue, Documents and Move Forward (the Phase 25 dialog) - and a button that truly cannot work is
// greyed with "Not available yet: {reason}". There is no "Arrives in Phase" text any more.
import { useEffect, useState } from 'react';
import { useInRouterContext, useNavigate } from 'react-router-dom';
import type { ActionSet } from '../types';
import type { ActionKey, RecordActions } from '../lib/screensApi';
import { docsMailApi, saveFile, type PrintKind } from '../lib/docsMailApi';
import { useToast } from './Toast';
import { EmailDocDialog } from './EmailDocDialog';
import { MoveForwardDialog } from './MoveForward';

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
  { label: '← Return', need: 'view' },
  { label: 'Email', need: 'view', needsRecord: true },
  { label: 'Excel', need: 'export', where: 'full', ifAbsent: true },
  { label: 'Industry PDF', need: 'print', needsRecord: true },
  { label: 'Word', need: 'print', needsRecord: true },
  { label: 'Print', need: 'print', where: 'full', ifAbsent: true },
  { label: '＋ Add', need: 'add', primary: true, where: 'full' },
  { label: '⇧ Import', need: 'add' },
  { label: '⇩ Export', need: 'export' },
  { label: 'Duplicates', need: 'view' },
  { label: 'Edit', need: 'edit', record: 'edit', where: 'full', ifAbsent: true },
  { label: 'Delete', need: 'delete', record: 'delete', where: 'full', ifAbsent: true },
  { label: 'Documents', need: 'view', record: 'documents' },
  { label: 'Submit Approval', need: 'submit', record: 'submit' },
  { label: 'Approval Queue', need: 'view' },
  { label: 'Move Forward', need: 'view', needsRecord: true },
  { label: 'Project History', need: 'view' },
  { label: 'Approvals', need: 'view', where: 'full', ifAbsent: true },
  { label: 'Reports', need: 'view', where: 'full', ifAbsent: true },
  { label: 'Analytics & Graphs', need: 'view', where: 'full', ifAbsent: true },
  { label: 'Audit Trail', need: 'view', where: 'full', ifAbsent: true },
  { label: '360° Tracking', need: 'view', where: 'full', ifAbsent: true },
];

/** Page buttons the bar can run by itself (everything else needs the page's own onAction). */
const DEFAULTS = new Set([
  '← Return',
  'Email',
  'Excel',
  '⇩ Export',
  '⇧ Import',
  'Duplicates',
  'Industry PDF',
  'Word',
  'Print',
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

/** Where the navigation defaults go. */
const GO: Record<string, string> = {
  '⇧ Import': '/m/admin-import',
  Duplicates: '/m/admin-duplicates',
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
  const [emailing, setEmailing] = useState(false);
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
  const shown = BAR.filter(
    (b) =>
      (b.where ?? 'both') === 'both' ||
      b.where === mode ||
      (mode === 'page' && b.ifAbsent === true && own !== null && !own.has(b.label)),
  );
  const haveRecord = !!pageId && !!recordId;

  async function runDefault(label: string): Promise<void> {
    try {
      const target = GO[label];
      if (label === 'Print') window.print();
      else if (label === '← Return') go?.(-1);
      else if (target) go?.(target);
      else if (label === 'Move Forward') setMoving(true);
      else if (label === 'Email') setEmailing(true);
      else if (label === '⇩ Export' && !haveRecord) await runDefault('Excel');
      else if ((label === 'Excel' || label === '⇩ Export') && haveRecord)
        saveFile(await docsMailApi.print(pageId, recordId, 'excel'), `${docNo ?? 'record'}.xlsx`);
      else if (label === 'Excel') {
        const table = document.querySelector<HTMLTableElement>('.main table');
        if (!table) return void toast('Nothing to export: no table on this page.');
        saveFile(
          {
            blob: new Blob(['﻿' + tableToCsv(table)], { type: 'text/csv;charset=utf-8' }),
            filename: null,
          },
          `${pageId ?? 'register'}.csv`,
        );
      } else if (label === 'Industry PDF' || label === 'Word') {
        const kind: PrintKind = label === 'Word' ? 'word' : 'standard';
        saveFile(
          await docsMailApi.print(pageId ?? '', recordId ?? '', kind),
          `${docNo ?? 'document'}.${label === 'Word' ? 'docx' : 'pdf'}`,
        );
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not complete this action.');
    }
  }

  function click(label: string) {
    if (onAction?.(label) === true) return;
    if (DEFAULTS.has(label)) void runDefault(label);
  }

  return (
    <div className="actionbar" role="toolbar" aria-label="Page actions" data-testid="actionbar">
      {shown.map((b) => {
        if (!actions[b.need]) return null; // no permission: hidden
        let reason: string | null = blocked?.[b.label] ?? null;
        if (reason !== null) {
          // the screen's own reason wins
        } else if (b.record) {
          if (record === null) reason = 'Select a record first.';
          else if (record.blocked[b.record]) reason = record.blocked[b.record] ?? null;
          else if (!record.allowed.includes(b.record)) reason = 'Not available for this record.';
        } else if (b.needsRecord && !haveRecord) reason = 'Select a record first.';
        else if (!DEFAULTS.has(b.label) && !onAction)
          reason = 'Not available yet: this page has no handler for it.';
        const disabled = reason !== null;
        return (
          <span key={b.label} className="actionbar-item" title={reason ?? undefined}>
            <button
              type="button"
              className={b.primary ? 'btn primary' : 'btn'}
              disabled={disabled}
              aria-disabled={disabled}
              onClick={() => click(b.label)}
            >
              {b.label}
            </button>
            {disabled ? <span className="sr-only">{reason}</span> : null}
          </span>
        );
      })}
      {emailing && pageId && recordId ? (
        <EmailDocDialog docType={pageId} docId={recordId} onClose={() => setEmailing(false)} />
      ) : null}
      {moving && pageId && recordId ? (
        <MoveForwardDialog
          docType={pageId}
          docId={recordId}
          docNo={docNo}
          onClose={() => setMoving(false)}
          onMoved={() => setMoving(false)}
        />
      ) : null}
    </div>
  );
}
