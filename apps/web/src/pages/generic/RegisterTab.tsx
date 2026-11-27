// Register tab (prototype registerTab / v8RowHtml): summary minis computed from the loaded data,
// search, status filter, page size, sortable headers, checkbox selection that survives paging,
// Export Selected / Delete Selected (typed confirmation above 10) and View / Edit / Delete rows.
import { registerColumns, useHiddenColumns } from '../../lib/pageSettings';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { tableToCsv } from '../../components/ActionBar';
import { EmailDocDialog } from '../../components/EmailDocDialog';
import { ErrorMessage } from '../../components/ErrorMessage';
import { MoveForwardDialog } from '../../components/MoveForward';
import { useToast } from '../../components/Toast';
import { docsMailApi, saveFile } from '../../lib/docsMailApi';
import { Modal } from '../../components/Modal';
import { Pager } from '../../components/Pager';
import { ApiError } from '../../lib/api';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { submitBulk } from './phase4Api';
import {
  bulkDelete,
  exportXlsx,
  listRecords,
  type BulkResult,
  type FieldMeta,
  type PageAction,
  type PageView,
  type PageSchema,
  type RecordQuery,
  type RecordRow,
} from './engineApi';
import { ActionButtons } from './RecordActions';
import { usePlants } from '../../lib/plants';
import { FilterControl } from './kit/FilterBar';
import {
  canEditRecord,
  canRemoveRecord,
  displayValue,
  formatMoney,
  formatQty,
  isLowRow,
  isEmptyValue,
  listFields,
  valueOf,
} from './fieldModel';

export const PAGE_SIZES = [10, 20, 25] as const;
export const TYPED_CONFIRM_WORD = 'DELETE';
export const TYPED_CONFIRM_ABOVE = 10;

export interface RegisterQuery {
  q: string;
  status: string;
  sort: string;
  page: number;
  size: number;
  /** Values of schema.filters, keyed by their query parameter ('' = off). */
  filters: Record<string, string>;
}

/** Scalar query fields a register control may change (filters go through onFilter). */
export type QueryPatch = Partial<Omit<RegisterQuery, 'filters'>>;

interface Props {
  schema: PageSchema;
  perms: ActionSet;
  query: RegisterQuery;
  onQuery: (patch: QueryPatch) => void;
  onFilter: (param: string, value: string) => void;
  /** Alternative views (Ledger | Vouchers) and the one shown now. */
  views?: PageView[];
  activeView?: string;
  onSwitchView?: (key: string) => void;
  /** Bumped by the page after a create / edit / delete / action so the list reloads. */
  reloadToken: number;
  onChanged: () => void;
  onView: (row: RecordRow) => void;
  onEdit: (row: RecordRow) => void;
  onDelete: (row: RecordRow) => void;
  onAction: (row: RecordRow, action: PageAction) => void;
  onNotify: (message: string) => void;
  /** Reports the loaded rows so the page's record bar can offer them. */
  onRows?: (rows: RecordRow[]) => void;
  onOpenWorkspace?: (row: RecordRow) => void;
  /** Optional: draws the cell of a column itself (return undefined for the normal text). Used by pages whose V40 tabs add computed columns. */
  cellRender?: (row: RecordRow, field: FieldMeta) => ReactNode | undefined;
  /** The V40 master workspace (Item / SKU Master, Stock Balance): KPI cards, side panel and the Detailed Table. */
  workspace?: RegisterWorkspace | undefined;
}

export interface RowHandlers {
  /** Docs opens the record's documents (without it, Docs opens the record). */
  onDocs?: ((row: RecordRow) => void) | undefined;
  /** Replace the Edit / Delete of the row (Stock Balance: both go through a Stock Adjustment). */
  onEditRow?: ((row: RecordRow) => void) | undefined;
  onDeleteRow?: ((row: RecordRow) => void) | undefined;
  /** 360° Track, only on the rows that have something to follow. */
  trackOf?: ((row: RecordRow) => (() => void) | undefined) | undefined;
}

export interface RegisterWorkspace extends RowHandlers {
  /** Replaces the summary minis. */
  kpis?: ReactNode;
  /** Under the cards: the Department Filter. */
  filterBar?: ReactNode;
  /** Row buttons of the main table: the short master set, or none (the Detailed Table carries them). */
  mainActions: 'master' | 'none';
  /** Panel on the right of the main table (Validation Controls). */
  side?: ReactNode;
  /** Under the main table (＋ Add Master Record). */
  footer?: ReactNode;
  detail: { title: string; fields: FieldMeta[] };
  /** "Submit Selected" for the ticked rows. */
  onSubmitSelected?: ((rows: RecordRow[]) => void) | undefined;
}

type RowMode = 'full' | 'master' | 'none';

/** The uuid a row's print / email / movement buttons act on. */
export const docIdOf = (row: RecordRow): string => row.recordId ?? row.id;

export const statusClass = (s: string): string => s.toLowerCase().replace(/\s+/g, '-');

/** A "… Status" column on a typed list (Stock Balance) renders as a pill too. */
function isPillField(f: FieldMeta, row: RecordRow): boolean {
  return /status$/i.test(f.label) && !isEmptyValue(valueOf(row, f));
}

function nextSort(current: string, key: string): string {
  if (current === key) return `-${key}`;
  if (current === `-${key}`) return '';
  return key;
}

export function RegisterTab({
  schema,
  perms,
  query,
  onQuery,
  onFilter,
  views,
  activeView,
  onSwitchView,
  reloadToken,
  onChanged,
  onView,
  onEdit,
  onDelete,
  onAction,
  onNotify,
  onRows,
  onOpenWorkspace,
  cellRender,
  workspace,
}: Props) {
  const allFields = useMemo(() => listFields(schema), [schema]);
  // Settings tab: list the columns there, and leave out the ones this user hid (never all of them)
  useEffect(() => {
    registerColumns(schema.pageId, allFields.map((f) => ({ key: f.key, label: f.label })));
  }, [schema.pageId, allFields]);
  const hiddenCols = useHiddenColumns(schema.pageId);
  const fields = useMemo(() => {
    const kept = allFields.filter((f) => !hiddenCols.has(f.key));
    return kept.length > 0 ? kept : allFields;
  }, [allFields, hiddenCols]);
  // Phase 23: with 2+ plants chosen the list mixes plants, so a Plant column appears automatically.
  const showPlant = (usePlants().data?.selected.length ?? 1) > 1;
  const rq: RecordQuery = query;
  const { data, loading, error } = useLoad(
    () => listRecords(schema.pageId, rq),
    [
      schema.pageId,
      query.q,
      query.status,
      query.sort,
      query.page,
      query.size,
      JSON.stringify(query.filters),
      reloadToken,
    ],
  );
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const total = data?.meta.total ?? 0;
  // company-wide rows (items) belong to no plant: a column of dashes says nothing, so it is left out
  const plantColumn = showPlant && (rows.length === 0 || rows.some((r) => !!r.unitCode));
  useEffect(() => {
    onRows?.(data?.rows ?? []);
  }, [data, onRows]);

  // Search box: local text, pushed to the URL after a short pause.
  const [search, setSearch] = useState(query.q);
  const lastQ = useRef(query.q);
  useEffect(() => {
    if (query.q !== lastQ.current) {
      lastQ.current = query.q;
      setSearch(query.q);
    }
  }, [query.q]);
  useEffect(() => {
    if (search === lastQ.current) return undefined;
    const id = setTimeout(() => {
      lastQ.current = search;
      onQuery({ q: search, page: 1 });
    }, 300);
    return () => clearTimeout(id);
  }, [search, onQuery]);

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const tableBox = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const toastTop = useToast();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exportError, setExportError] = useState('');
  const pageIds = rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggle = (id: string, on: boolean): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const togglePage = (on: boolean): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of pageIds) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  // Submit Selected (generic transactional pages): only Drafts can be submitted; the server reports each id.
  const canSubmit =
    schema.kind === 'generic' && perms.submit === true && schema.lock?.Draft?.submit === true;
  const [submitting, setSubmitting] = useState(false);
  const submitSelected = async (): Promise<void> => {
    setSubmitting(true);
    try {
      const report = await submitBulk(schema.pageId, [...selected]);
      const okIds = report.filter((r) => r.ok).map((r) => r.id);
      setSelected((prev) => new Set([...prev].filter((id) => !okIds.includes(id))));
      onChanged();
      const failed = report.filter((r) => !r.ok);
      onNotify(
        failed.length
          ? `Submitted ${okIds.length}; ${failed.length} could not be submitted${failed[0]?.error ? ` (${failed[0].error.message})` : ''}.`
          : `Submitted ${okIds.length} record${okIds.length === 1 ? '' : 's'}.`,
      );
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Submit failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const exportSelected = async (): Promise<void> => {
    setBusy(true);
    setExportError('');
    try {
      await exportXlsx(schema.pageId, rq, [...selected]);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Export failed.');
    } finally {
      setBusy(false);
    }
  };

  const mini = useMemo(() => {
    const cells = rows.length * fields.length;
    const filled = rows.reduce(
      (n, r) => n + fields.filter((f) => !isEmptyValue(valueOf(r, f))).length,
      0,
    );
    // Summing rates, costs or prices is meaningless, so only amount-like money columns are totalled.
    const money = fields.find((f) => f.type === 'money' && !/rate|cost|price|mrp/i.test(f.label));
    const moneySum = money ? rows.reduce((n, r) => n + (Number(valueOf(r, money)) || 0), 0) : null;
    return {
      completeness: cells ? `${Math.round((filled / cells) * 100)}%` : '—',
      open: rows.filter((r) => ['Draft', 'Open', 'Pending'].includes(r.status)).length,
      money,
      moneySum,
    };
  }, [rows, fields]);

  const canExport = perms.export;
  const canDelete = perms.delete && !schema.readOnly;
  const sortIndicator = (key: string): string =>
    query.sort === key ? ' ▲' : query.sort === `-${key}` ? ' ▼' : '';
  const mainMode: RowMode = workspace ? workspace.mainActions : 'full';
  const detailBox = useRef<HTMLDivElement>(null);
  const [emailPicked, setEmailPicked] = useState<RecordRow | null>(null);
  const picked = rows.filter((r) => selected.has(r.id));
  const handlers: RowHandlers = workspace ?? {};
  const rowProps = {
    showPlant: plantColumn,
    schema,
    perms,
    onToggle: toggle,
    onView,
    onEdit,
    onDelete,
    onAction,
    onOpenWorkspace,
    handlers,
    ...(cellRender ? { cellRender } : {}),
  };
  /** Send Email of the table strip: the ticked record, else the department mail composer. */
  const sendEmail = (): void => {
    if (picked[0]) setEmailPicked(picked[0]);
    else if (workspace) toastTop('Tick a row first, then press Send Email.');
    else navigate('/m/dept-mail');
  };
  const exportsStrip = (box: () => HTMLDivElement | null, title: string): ReactNode => (
    <>
      <button type="button" className="btn sm" onClick={sendEmail}>
        Send Email
      </button>
      <button type="button" className="btn sm" onClick={() => exportTable(box(), title, 'word', toastTop)}>
        Word
      </button>
      <button type="button" className="btn sm" onClick={() => exportTable(box(), title, 'excel', toastTop)}>
        Excel
      </button>
      <button type="button" className="btn sm" onClick={() => exportTable(box(), title, 'pdf', toastTop)}>
        PDF
      </button>
    </>
  );

  return (
    <>
    {workspace?.kpis}
    {workspace?.filterBar}
    <div className={workspace?.side ? 'ws-split' : undefined}>
    <div className="card">
      {workspace ? null : <div className="v8-minis" aria-label="Summary">
        <div className="v8-mini">
          <small>Records</small>
          <b>{data ? total : '…'}</b>
        </div>
        <div className="v8-mini">
          <small>Showing on this page</small>
          <b>{rows.length}</b>
        </div>
        <div className="v8-mini">
          <small>Data completeness (this page)</small>
          <b>{mini.completeness}</b>
        </div>
        <div className="v8-mini">
          <small>Draft / Open (this page)</small>
          <b>{mini.open}</b>
        </div>
        <div className="v8-mini">
          <small>{mini.money ? `${mini.money.label} (this page)` : 'Selected'}</small>
          <b>{mini.money && mini.moneySum !== null ? formatMoney(mini.moneySum) : selected.size}</b>
        </div>
      </div>}
      {views && views.length > 1 ? (
        <div className="seg" role="group" aria-label="View">
          {views.map((v) => (
            <button
              key={v.key}
              type="button"
              className={v.key === activeView ? 'seg-btn active' : 'seg-btn'}
              aria-pressed={v.key === activeView}
              onClick={() => onSwitchView?.(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="v8-table-toolbar">
        <input
          type="search"
          placeholder={`Search ${schema.title}...`}
          aria-label={`Search ${schema.title}`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            // Enter applies the search at once instead of waiting for the typing pause.
            if (e.key === 'Enter') {
              lastQ.current = search;
              onQuery({ q: search, page: 1 });
            }
          }}
        />
        <select
          aria-label="Filter by status"
          value={query.status}
          onChange={(e) => onQuery({ status: e.target.value, page: 1 })}
        >
          <option value="">All Status</option>
          {schema.statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          aria-label="Rows per page"
          value={query.size}
          onChange={(e) => onQuery({ size: Number(e.target.value), page: 1 })}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n} rows
            </option>
          ))}
        </select>
        {(schema.filters ?? [])
          .filter((flt) => !(views && flt.param === 'view'))
          .map((flt) => (
            <FilterControl
              key={flt.param}
              filter={flt}
              value={query.filters[flt.param] ?? ''}
              onChange={(val) => onFilter(flt.param, val)}
            />
          ))}
        <span className="v8-spacer" />
        <span className="chip" aria-live="polite">
          {selected.size} selected
        </span>
        {selected.size > 0 ? (
          <button type="button" className="btn sm" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        ) : null}
        {canExport ? (
          <button
            type="button"
            className="btn"
            disabled={selected.size === 0 || busy}
            onClick={() => void exportSelected()}
          >
            Export Selected
          </button>
        ) : null}
        {canSubmit ? (
          <button
            type="button"
            className="btn"
            disabled={selected.size === 0 || submitting}
            onClick={() => void submitSelected()}
          >
            {submitting ? 'Submitting…' : 'Submit Selected'}
          </button>
        ) : null}
        {workspace?.onSubmitSelected ? (
          <button
            type="button"
            className="btn"
            disabled={picked.length === 0}
            title={picked.length === 0 ? 'Tick the records to submit' : undefined}
            onClick={() => workspace.onSubmitSelected?.(picked)}
          >
            Submit Selected
          </button>
        ) : null}
        {canDelete ? (
          <button
            type="button"
            className="btn danger"
            disabled={selected.size === 0}
            onClick={() => setBulkOpen(true)}
          >
            Delete Selected
          </button>
        ) : null}
      </div>
      {exportError ? <ErrorMessage>{exportError}</ErrorMessage> : null}
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      <div className="table-wrap" ref={tableBox}>
        <table className="register-table">
          <thead>
            <tr>
              <th scope="col">
                <input
                  type="checkbox"
                  className="v8-checkbox"
                  aria-label="Select all rows on this page"
                  checked={allOnPage}
                  disabled={rows.length === 0}
                  onChange={(e) => togglePage(e.target.checked)}
                />
              </th>
              {plantColumn ? (
                <th scope="col" aria-label="Plant">
                  Plant
                </th>
              ) : null}
              {fields.map((f) => (
                <th
                  key={f.key}
                  scope="col"
                  aria-sort={
                    query.sort === f.key
                      ? 'ascending'
                      : query.sort === `-${f.key}`
                        ? 'descending'
                        : 'none'
                  }
                >
                  {f.sortable === false ? (
                    f.label
                  ) : (
                    <button
                      type="button"
                      className="v8-sort"
                      onClick={() => onQuery({ sort: nextSort(query.sort, f.key), page: 1 })}
                    >
                      {f.label}
                      {sortIndicator(f.key)}
                    </button>
                  )}
                </th>
              ))}
              {mainMode === 'none' ? null : (
                <th scope="col" className="sticky-actions">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <RegisterRow
                key={r.id}
                {...rowProps}
                row={r}
                fields={fields}
                checked={selected.has(r.id)}
                mode={mainMode}
                selectable
              />
            ))}
            {loading && !data ? (
              <tr className="empty-row">
                <td colSpan={fields.length + 2 + (plantColumn ? 1 : 0)}>Loading…</td>
              </tr>
            ) : null}
            {data && rows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={fields.length + 2 + (plantColumn ? 1 : 0)}>
                  {query.q || query.status
                    ? 'No records match these filters.'
                    : `No ${schema.title} records yet.`}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {workspace ? (
        workspace.footer
      ) : (
        <div className="register-exports" role="group" aria-label={`${schema.title} detailed table actions`}>
          <b>{`${schema.title} – Detailed Table`}</b>
          <small className="muted">Table-level actions for the rows shown above.</small>
          <span className="v8-spacer" />
          {exportsStrip(() => tableBox.current, schema.title)}
        </div>
      )}
      {schema.totals?.length && data?.meta.totals ? (
        <div className="totals-bar" aria-label="Totals">
          {schema.totals.map((t) => {
            const raw = data.meta.totals?.[t.key];
            const n = Number(raw);
            return (
              <span key={t.key}>
                <small>{t.label}</small>
                <b>
                  {raw === undefined || !Number.isFinite(n)
                    ? '—'
                    : t.format === 'money'
                      ? formatMoney(n)
                      : formatQty(n)}
                </b>
              </span>
            );
          })}
        </div>
      ) : null}
      <Pager
        page={query.page}
        size={query.size}
        total={total}
        onPage={(p) => onQuery({ page: p })}
      />
    </div>
    {workspace?.side}
    </div>
    {workspace ? (
      <section className="card ws-section" aria-label={workspace.detail.title}>
        <div className="ws-section-head">
          <h3>{workspace.detail.title}</h3>
          <small>
            {rows.length} of {total} records. All row actions are available here.
          </small>
          <span className="ws-spacer" />
          {exportsStrip(() => detailBox.current, workspace.detail.title)}
        </div>
        <div className="table-wrap" ref={detailBox}>
          <table className="register-table ws-detail ws-lined">
            <thead>
              <tr>
                {workspace.detail.fields.map((f) => (
                  <th key={f.key} scope="col">
                    {f.label}
                  </th>
                ))}
                <th scope="col" className="sticky-actions">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <RegisterRow
                  key={r.id}
                  {...rowProps}
                  showPlant={false}
                  row={r}
                  fields={workspace.detail.fields}
                  checked={false}
                  mode="full"
                  selectable={false}
                />
              ))}
              {data && rows.length === 0 ? (
                <tr className="empty-row">
                  <td colSpan={workspace.detail.fields.length + 1}>No records to show.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    ) : null}
      {emailPicked ? (
        <EmailDocDialog docType={schema.pageId} docId={docIdOf(emailPicked)} onClose={() => setEmailPicked(null)} />
      ) : null}
      {bulkOpen ? (
        <BulkDeleteModal
          schema={schema}
          ids={[...selected]}
          onClose={() => setBulkOpen(false)}
          onDone={(results) => {
            const okIds = results.filter((r) => r.ok).map((r) => r.id);
            setSelected((prev) => new Set([...prev].filter((id) => !okIds.includes(id))));
            setBulkOpen(false);
            onChanged();
            const failed = results.length - okIds.length;
            onNotify(
              failed
                ? `Deleted ${okIds.length}; ${failed} could not be deleted.`
                : `Deleted ${okIds.length} record${okIds.length === 1 ? '' : 's'}.`,
            );
          }}
        />
      ) : null}
    </>
  );
}

/** Table-level export of the rows on screen: Excel = CSV, Word = an HTML .doc Word opens, PDF = the browser's Save as PDF. */
export function exportTable(box: HTMLElement | null, title: string, kind: 'word' | 'excel' | 'pdf', say: (m: string) => void): void {
  const table = box?.querySelector('table');
  if (!table) return say('There is no table to export yet.');
  const clean = table.cloneNode(true) as HTMLTableElement;
  clean.querySelectorAll('input, button, .sticky-actions, th:last-child, td:last-child').forEach((n) => n.remove());
  const save = (data: string, type: string, ext: string): void => {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]+/gi, '_')}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };
  if (kind === 'excel') return save('﻿' + tableToCsv(clean), 'text/csv;charset=utf-8', 'csv');
  if (kind === 'word') return save(`<html><head><meta charset="utf-8"></head><body><h2>${title}</h2>${clean.outerHTML}</body></html>`, 'application/msword', 'doc');
  const w = window.open('', '_blank');
  if (!w) return say('Allow pop-ups to save this table as PDF.');
  w.document.write(`<html><head><meta charset="utf-8"><title>${title}</title></head><body><h2>${title}</h2>${clean.outerHTML}</body></html>`);
  w.document.close();
  w.print();
}

function RegisterRow({
  showPlant,
  schema,
  perms,
  row,
  fields,
  checked,
  onToggle,
  onView,
  onEdit,
  onDelete,
  onAction,
  onOpenWorkspace,
  cellRender,
  mode,
  selectable,
  handlers,
}: {
  showPlant: boolean;
  schema: PageSchema;
  perms: ActionSet;
  row: RecordRow;
  fields: FieldMeta[];
  checked: boolean;
  mode: RowMode;
  selectable: boolean;
  handlers: RowHandlers;
  onToggle: (id: string, on: boolean) => void;
  onView: (row: RecordRow) => void;
  onEdit: (row: RecordRow) => void;
  onDelete: (row: RecordRow) => void;
  onAction: (row: RecordRow, action: PageAction) => void;
  onOpenWorkspace?: (row: RecordRow) => void;
  cellRender?: (row: RecordRow, field: FieldMeta) => ReactNode | undefined;
}) {
  const editable = canEditRecord(schema, row);
  const removable = canRemoveRecord(schema, row);
  const hasRecordPanels = schema.tabPanels?.some((tp) => tp.scope === 'record');
  const toast = useToast();
  const [emailing, setEmailing] = useState(false);
  const [moving, setMoving] = useState(false);
  // V40 row buttons (Docs / Email / Word / PDF / Move Forward): each one runs on this row
  async function print(kind: 'word' | 'standard'): Promise<void> {
    try {
      saveFile(await docsMailApi.print(schema.pageId, docIdOf(row), kind), `${row.code}.${kind === 'word' ? 'docx' : 'pdf'}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That did not work.');
    }
  }
  const short = mode === 'master';
  const track = mode === 'full' ? handlers.trackOf?.(row) : undefined;
  return (
    <tr className={isLowRow(row) ? 'row-low' : undefined}>
      {selectable ? (
        <td>
          <input
            type="checkbox"
            className="v8-checkbox"
            aria-label={`Select ${row.code}`}
            checked={checked}
            onChange={(e) => onToggle(row.id, e.target.checked)}
          />
        </td>
      ) : null}
      {showPlant ? <td>{row.unitCode ?? '—'}</td> : null}
      {fields.map((f) => (
        <td key={f.key}>
          {cellRender && cellRender(row, f) !== undefined ? (
            cellRender(row, f)
          ) : f.type === 'status' ? (
            <span className={`status ${statusClass(row.status)}`}>{row.status}</span>
          ) : isPillField(f, row) ? (
            <span className={`status ${statusClass(displayValue(row, f))}`}>
              {displayValue(row, f)}
            </span>
          ) : (
            displayValue(row, f)
          )}
        </td>
      ))}
      {mode === 'none' ? null : (
      <td className="sticky-actions">
        <div className={`actions row-actions ws-actions${short ? ' compact' : ''}`}>
          {short ? null : <>
          {hasRecordPanels && onOpenWorkspace ? (
            <button
              type="button"
              className="btn sm"
              aria-label={`Open workspace for ${row.code}`}
              title="Open workspace"
              onClick={() => onOpenWorkspace(row)}
            >
              Open workspace
            </button>
          ) : null}
          <button
            type="button"
            className="btn sm"
            aria-label={`View ${row.code}`}
            title="View"
            onClick={() => onView(row)}
          >
            <span aria-hidden="true">👁</span> View
          </button>
          {handlers.onEditRow ? (
            <button type="button" className="btn sm" title="Correct this balance with a Stock Adjustment" onClick={() => handlers.onEditRow?.(row)}>
              <span aria-hidden="true">✎</span> Edit
            </button>
          ) : null}
          <button type="button" className="btn sm" aria-label={`Docs ${row.code}`} title="Documents of this record" onClick={() => (handlers.onDocs ?? onView)(row)}>
            Docs
          </button>
          <button type="button" className="btn sm" aria-label={`Email ${row.code}`} title="Email this record" onClick={() => setEmailing(true)}>
            Email
          </button>
          <button type="button" className="btn sm" aria-label={`Word ${row.code}`} title="Download as Word" onClick={() => void print('word')}>
            Word
          </button>
          <button type="button" className="btn sm" aria-label={`PDF ${row.code}`} title="Download as PDF" onClick={() => void print('standard')}>
            PDF
          </button>
          <ActionButtons schema={schema} row={row} small perms={perms} onAction={onAction} />
          </>}
          {perms.edit && editable ? (
            <button
              type="button"
              className="btn sm"
              aria-label={`Edit ${row.code}`}
              title="Edit"
              onClick={() => onEdit(row)}
            >
              <span aria-hidden="true">✎</span> Edit
            </button>
          ) : perms.edit && row.status === 'Pending Approval' ? (
            <button
              type="button"
              className="btn sm"
              aria-label={`Edit ${row.code}`}
              title="Locked while pending approval"
              disabled
            >
              <span aria-hidden="true">✎</span>
            </button>
          ) : null}
          {perms.delete && removable ? (
            <button
              type="button"
              className="btn sm danger"
              aria-label={`Delete ${row.code}`}
              title="Delete"
              onClick={() => onDelete(row)}
            >
              <span aria-hidden="true">🗑</span> Delete
            </button>
          ) : perms.delete && row.status === 'Pending Approval' ? (
            <button
              type="button"
              className="btn sm danger"
              aria-label={`Delete ${row.code}`}
              title="Locked while pending approval"
              disabled
            >
              <span aria-hidden="true">🗑</span>
            </button>
          ) : null}
          {handlers.onDeleteRow ? (
            <button type="button" className="btn sm danger" title="Write this stock off with a Stock Adjustment" onClick={() => handlers.onDeleteRow?.(row)}>
              <span aria-hidden="true">🗑</span> Delete
            </button>
          ) : null}
          {track ? (
            <button type="button" className="btn sm" title="Follow the open demand of this record" onClick={track}>
              360° Track
            </button>
          ) : null}
          <button type="button" className="btn sm primary" aria-label={`Move Forward ${row.code}`} title="Move this record to the next department" onClick={() => setMoving(true)}>
            Move Forward
          </button>
        </div>
        {emailing ? <EmailDocDialog docType={schema.pageId} docId={docIdOf(row)} onClose={() => setEmailing(false)} /> : null}
        {moving ? <MoveForwardDialog docType={schema.pageId} docId={docIdOf(row)} docNo={row.code} onClose={() => setMoving(false)} onMoved={() => setMoving(false)} /> : null}
      </td>
      )}
    </tr>
  );
}

function BulkDeleteModal({
  schema,
  ids,
  onClose,
  onDone,
}: {
  schema: PageSchema;
  ids: string[];
  onClose: () => void;
  onDone: (results: BulkResult[]) => void;
}) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const needsTyping = ids.length > TYPED_CONFIRM_ABOVE;
  const tooMany = ids.length > 200;

  const run = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError('');
    try {
      onDone(await bulkDelete(schema.pageId, ids));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <Modal
      size="sm"
      title="Delete Selected"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={pending || tooMany || (needsTyping && typed !== TYPED_CONFIRM_WORD)}
            onClick={() => void run()}
          >
            {pending ? 'Deleting…' : `Delete ${ids.length}`}
          </button>
        </>
      }
    >
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      <p className="confirm-text">
        Delete {ids.length} selected {schema.title} record{ids.length === 1 ? '' : 's'}? Deleted
        records can be restored by an administrator.
      </p>
      {tooMany ? (
        <p className="field-error">At most 200 records can be deleted at once. Clear some first.</p>
      ) : null}
      {needsTyping ? (
        <div className="field">
          <label htmlFor="bulk-confirm">
            Type {TYPED_CONFIRM_WORD} to confirm deleting {ids.length} records
          </label>
          <input
            id="bulk-confirm"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
      ) : null}
    </Modal>
  );
}
