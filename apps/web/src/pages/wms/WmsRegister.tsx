// The one register of every Warehouse / WMS page: page head (Excel, Print, Add), the shared V40 register of the open tab
// (columns of that tab, search, status, sort, tick boxes, View / Edit / Email / PDF / Word / Excel / Print / Move Forward /
// Docs per row, the page's own row buttons, Allocate / Reallocate) and the pop-ups the page hands in.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { saveFile } from '../../lib/docsMailApi';
import { toUiError } from '../../lib/errors';
import { post } from '../../lib/scmApi';
import type { ActionSet } from '../../types';
import { ApprovalsPanel, AuditPanel, useFrame } from '../frame/V40TabFrame';
import { getSalesV40, type V40Row } from '../sales/salesV40Api';
import { V40Register, type V40RegisterProps } from '../sales/V40Register';
import { ErrorBox, PageHead } from '../inventory/shared';
import './wms.css';

export interface AddButton {
  label: string;
  onClick: () => void;
}

/** The stored record a register row stands for (a pick task row stands for its wave). */
export const recordOf = (r: V40Row): string => r.record_id ?? r.id;

/** One row per record: several rows can stand for the same record. */
export function distinctRecords(rows: V40Row[]): V40Row[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(recordOf(r))) return false;
    seen.add(recordOf(r));
    return true;
  });
}

export const message = (e: unknown): string => {
  const u = toUiError(e);
  return Object.values(u.fields)[0] ?? u.message;
};

/** Runs actions one at a time; says what was done, or shows why not, and reloads the register. */
export function useWmsActions() {
  const toast = useToast();
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const busy = useRef(false);
  const reload = (): void => setReloadKey((n) => n + 1);
  const run = async (work: () => Promise<unknown>, done: string): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    setError('');
    try {
      await work();
      toast(done);
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      busy.current = false;
      reload();
    }
  };
  /** The same action on every ticked record; one failing does not stop the rest. */
  const each = async (rows: V40Row[], work: (r: V40Row) => Promise<unknown>, verb: string): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    setError('');
    let done = 0;
    const failed: string[] = [];
    for (const r of distinctRecords(rows)) {
      try {
        await work(r);
        done += 1;
      } catch (e) {
        failed.push(`${r.number}: ${message(e)}`);
      }
    }
    busy.current = false;
    toast(`${done} ${verb}${failed.length ? `, ${failed.length} not ${verb}` : ''}.`);
    setError(failed.join('  '));
    reload();
  };
  return { error, setError, reloadKey, reload, run, each };
}

/** "Are you sure?" with an optional reason the server keeps. */
export function Confirm({
  title,
  text,
  action,
  danger = true,
  askReason = false,
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  action: string;
  danger?: boolean;
  askReason?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const short = askReason && reason.trim().length < 5;
  return (
    <Modal
      title={title}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Keep it
          </button>
          <button
            type="button"
            className={danger ? 'btn danger' : 'btn primary'}
            disabled={short}
            title={short ? 'Type a reason of at least 5 letters.' : undefined}
            onClick={() => onConfirm(reason.trim())}
          >
            {action}
          </button>
        </>
      }
    >
      <p>{text}</p>
      {askReason ? (
        <div className="field">
          <label>
            Reason *
            <input autoFocus maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>
      ) : null}
    </Modal>
  );
}

const csv = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const MAX_EXPORT_PAGES = 100;

/** Every row of the open tab (not only the 20 on screen) as a file that opens in Excel. */
async function exportTab(pageId: string, tab: string, first: boolean): Promise<number> {
  const lines: string[] = [];
  let count = 0;
  for (let page = 1; page <= MAX_EXPORT_PAGES; page += 1) {
    const data = await getSalesV40(pageId, { tab, first, page, size: 100 });
    const cols = data.columns.filter((c) => c.type !== 'actions' && c.type !== 'docs');
    if (page === 1) lines.push(cols.map((c) => csv(c.label)).join(','));
    for (const r of data.rows) lines.push(cols.map((c) => csv(r[c.key] ?? '')).join(','));
    count += data.rows.length;
    if (data.rows.length < 100) break;
  }
  const name = `${pageId}.csv`;
  saveFile({ blob: new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), filename: name }, name);
  return count;
}

export function WmsRegister({
  pageId,
  title,
  sub,
  actions,
  add = [],
  error,
  reloadKey,
  reload,
  above,
  children,
  onAllocate,
  ...register
}: {
  pageId: string;
  title: string;
  sub: string;
  actions: ActionSet;
  add?: AddButton[];
  error: string;
  reloadKey: number;
  reload: () => void;
  /** shown above the register (the scan box of the Barcode page) */
  above?: ReactNode;
  /** the page's pop-ups */
  children?: ReactNode;
} & Pick<V40RegisterProps, 'onOpen' | 'onEdit' | 'canEditRow' | 'rowExtra' | 'bulkExtra' | 'onAllocate'>) {
  const frame = useFrame();
  const toast = useToast();
  const tab = frame?.tabName ?? '';
  const first = (frame?.index ?? 0) === 0;
  const adds = actions.add ? add : [];

  // the top bar's "＋ Add New" and "⇩ Export" belong to this register
  const live = useRef({ adds, tab, first });
  live.current = { adds, tab, first };
  useEffect(() => {
    const onAdd = (e: Event): void => {
      const { detail } = e as CustomEvent<{ pageId?: string; handled: boolean }>;
      if (detail.pageId !== pageId || detail.handled) return;
      detail.handled = true;
      const button = live.current.adds[0];
      if (button) button.onClick();
      else toast('Your role cannot add records on this page.');
    };
    const onExport = (e: Event): void => {
      const { detail } = e as CustomEvent<{ pageId?: string; handled: boolean }>;
      if (detail.pageId !== pageId || !actions.export) return;
      detail.handled = true;
      exportTab(pageId, live.current.tab, live.current.first)
        .then((n) => toast(`${n} rows exported.`))
        .catch((err: unknown) => toast(message(err)));
    };
    window.addEventListener('v40-add-record', onAdd);
    window.addEventListener('v40-export-register', onExport);
    return () => {
      window.removeEventListener('v40-add-record', onAdd);
      window.removeEventListener('v40-export-register', onExport);
    };
  }, [pageId, actions.export, toast]);

  /** Allocate / Reallocate: gives the free stock of a warehouse to the demand waiting there. */
  const allocate = (warehouseId: string): void => {
    post<{ items: number; allocated: number; waiting: number }>('/fam/v40/allocate', { warehouseId })
      .then((r) => {
        toast(r.items === 0 ? 'No demand is waiting for stock in this warehouse.' : `Allocation run: ${r.allocated} reservation(s) given stock, ${r.waiting} still waiting.`);
        reload();
      })
      .catch((e: unknown) => toast(message(e)));
  };

  const approvals = /^approvals?$/i.test(tab);
  const audit = /^audit trail$/i.test(tab);
  return (
    <div className="wms-page">
      <PageHead title={title} sub={sub}>
        {actions.export ? (
          <button
            type="button"
            className="btn"
            onClick={() =>
              exportTab(pageId, tab, first)
                .then((n) => toast(`${n} rows exported.`))
                .catch((e: unknown) => toast(message(e)))
            }
          >
            Excel
          </button>
        ) : null}
        {actions.print ? (
          <button type="button" className="btn" onClick={() => window.print()}>
            Print
          </button>
        ) : null}
        {adds.map((b) => (
          <button key={b.label} type="button" className="btn primary" onClick={b.onClick}>
            {b.label}
          </button>
        ))}
      </PageHead>
      <ErrorBox message={error} />
      {above}
      {approvals ? (
        <ApprovalsPanel pageId={pageId} />
      ) : audit ? (
        <AuditPanel pageId={pageId} />
      ) : (
        <V40Register
          pageId={pageId}
          actions={actions}
          fallback={null}
          sortable
          reloadKey={reloadKey}
          onChanged={reload}
          onAllocate={onAllocate ?? allocate}
          {...register}
        />
      )}
      {children}
    </div>
  );
}
