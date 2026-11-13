// Phase 22 §7: list (table + pager) -> row click opens a drawer. One screen for every page served by
// GET /screens/:pageId. Never shows a made-up number; with no rows it shows the empty state.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionBar } from '../../components/ActionBar';
import { Drawer } from '../../components/Drawer';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { ScreenFormModal } from './ScreenFormModal';
import { ShelfBinsPanel } from './ShelfBinsPanel';
import { DetailSections } from './DetailSections';
import { ApiError } from '../../lib/api';
import {
  deleteRow,
  getScreenRecord,
  listScreen,
  type ColType,
  type RecordActions,
  type ScreenColumn,
  type ScreenPage as ScreenData,
  type ScreenRow,
} from '../../lib/screensApi';
import type { ActionSet } from '../../types';
import { dmy, ErrorBox, inr, PageHead, Pill } from '../finance/shared';

const NOT_BUILT =
  'Records on this screen are calculated or created on other screens, so they are not typed in here.';
const NO_FORM: Readonly<Record<string, string>> = {
  '＋ Add': NOT_BUILT,
  Edit: NOT_BUILT,
  Delete: NOT_BUILT,
  'Submit Approval': NOT_BUILT,
};

export function formatCell(v: unknown, type: ColType): string {
  // only plain scalars are shown; anything else is "—" so a made-up value never reaches the screen
  const text =
    typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
  if (text === '') return '—';
  switch (type) {
    case 'money':
      return inr(text);
    case 'date':
    case 'datetime':
      return dmy(text);
    case 'pct':
      return `${Number(text)} %`;
    case 'num':
      return String(Number(text));
    case 'bool':
      return text === 'true' ? 'Yes' : 'No';
    default:
      return text;
  }
}

function Cell({ v, col }: { v: unknown; col: ScreenColumn }) {
  if (col.type === 'status' && typeof v === 'string' && v !== '') return <Pill>{v}</Pill>;
  return <>{formatCell(v, col.type)}</>;
}

/** "10,000+" when the server only has an estimate. */
export function totalLabel(total: number, estimate: boolean): string {
  return estimate ? '10,000+' : String(total);
}

interface Props {
  pageId: string;
  title: string;
  sub: string;
  actions: ActionSet;
}

interface OpenState {
  row: ScreenRow;
  rec?: RecordActions;
  fields?: ScreenColumn[];
  values?: Record<string, unknown>;
}

export function ScreenPage({ pageId, title, sub, actions }: Props) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<string | undefined>(undefined);
  const [stack, setStack] = useState<(string | null)[]>([null]); // cursor of each page shown so far
  const [data, setData] = useState<ScreenData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState<OpenState | null>(null);
  const [formMode, setFormMode] = useState<{ editId?: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toast = useToast();
  const seq = useRef(0);
  const cursor = stack[stack.length - 1] ?? null;

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    setError('');
    try {
      const page = await listScreen(pageId, { q: query, sort, cursor });
      if (my !== seq.current) return;
      setData(page);
    } catch (e) {
      if (my !== seq.current) return;
      if (e instanceof ApiError && e.code === 'CURSOR_INVALID') {
        // silent restart + toast
        setNotice('The list changed, showing the latest.');
        setStack([null]);
        return;
      }
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [pageId, query, sort, cursor]);

  useEffect(() => {
    void load();
  }, [load]);

  const meta = data?.meta;
  const cols = meta?.columns ?? [];
  const rows = data?.data ?? [];
  const size = meta?.limit ?? 25;
  const from = rows.length === 0 ? 0 : (stack.length - 1) * size + 1;
  const to = (stack.length - 1) * size + rows.length;

  const formDef = meta?.form ?? null;
  const blocked: Readonly<Record<string, string>> | undefined = formDef
    ? {
        ...(formDef.noEdit ? { Edit: formDef.noEdit } : {}),
        ...(formDef.noDelete ? { Delete: formDef.noDelete } : {}),
      }
    : NO_FORM;

  function onAction(label: string) {
    if (!formDef) return;
    if (label === '＋ Add') setFormMode({});
    else if (label === 'Edit' && open) setFormMode({ editId: open.row.id });
    else if (label === 'Delete' && open) setConfirmDelete(true);
  }

  async function doDelete() {
    if (!open) return;
    try {
      await deleteRow(pageId, open.row.id);
      toast('Deleted.');
      setConfirmDelete(false);
      setOpen(null);
      await load();
    } catch (e) {
      setConfirmDelete(false);
      setError(e instanceof ApiError ? e.message : 'Could not delete.');
    }
  }

  async function openRow(row: ScreenRow) {
    setOpen({ row });
    try {
      const rec = await getScreenRecord(pageId, row.id);
      setOpen({ row, rec: rec.data.actions, fields: rec.fields, values: rec.data });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not open this record.');
      setOpen(null);
    }
  }

  return (
    <>
      <PageHead title={title} sub={sub} />
      <ActionBar actions={actions} record={open?.rec ?? null} blocked={blocked} onAction={onAction} />
      {notice ? (
        <div className="toast show" role="status">
          {notice}
        </div>
      ) : null}
      <ErrorBox message={error} />
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          setStack([null]);
          setQuery(q.trim());
        }}
      >
        <label>
          <span className="sr-only">Search</span>
          <input type="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {meta ? (
          <label>
            <span className="sr-only">Sort by</span>
            <select
              value={sort ?? meta.sort}
              onChange={(e) => {
                setStack([null]);
                setSort(e.target.value);
              }}
            >
              {meta.sorts.flatMap((s) => [
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')} ↑
                </option>,
                <option key={`-${s}`} value={`-${s}`}>
                  {s.replace(/_/g, ' ')} ↓
                </option>,
              ])}
            </select>
          </label>
        ) : null}
        <button type="submit" className="btn sm">
          Search
        </button>
      </form>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <tr className="empty-row">
                <td colSpan={Math.max(cols.length, 1)}>Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={Math.max(cols.length, 1)}>
                  {query
                    ? `No ${meta?.things ?? 'records'} match your search.`
                    : `No ${meta?.things ?? 'records'} yet. Press ＋ Add to create the first one.`}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => void openRow(r)}>
                  {cols.map((c) => (
                    <td key={c.key}>
                      <Cell v={r[c.key]} col={c} />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <nav className="v8-pager" aria-label="Pagination">
        <span>
          Showing {from}–{to} of {meta ? totalLabel(meta.total, meta.totalIsEstimate) : '…'}
        </span>
        <div className="pages">
          <button
            type="button"
            className="v8-page"
            disabled={stack.length <= 1 || loading}
            onClick={() => setStack((s) => s.slice(0, -1))}
          >
            Previous
          </button>
          <button
            type="button"
            className="v8-page"
            disabled={!meta?.hasMore || loading}
            onClick={() => {
              const next = meta?.nextCursor;
              if (next) setStack((s) => [...s, next]);
            }}
          >
            Next
          </button>
        </div>
      </nav>
      {open ? (
        <Drawer title={title} onClose={() => setOpen(null)}>
          {open.fields && open.values ? (
            <dl className="kv">
              {open.fields.map((f) => (
                <div key={f.key}>
                  <dt>{f.label}</dt>
                  <dd>
                    <Cell v={open.values?.[f.key]} col={f} />
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p role="status">Loading…</p>
          )}
          <DetailSections pageId={pageId} id={open.row.id} />
          {pageId === 'wms-shelves' ? <ShelfBinsPanel shelfId={open.row.id} canEdit={actions.edit} /> : null}
          <ActionBar actions={actions} record={open.rec ?? null} blocked={blocked} onAction={onAction} />
        </Drawer>
      ) : null}
      {formMode && formDef ? (
        <ScreenFormModal
          pageId={pageId}
          form={formDef}
          {...(formMode.editId ? { editId: formMode.editId } : {})}
          onClose={() => setFormMode(null)}
          onSaved={() => {
            setFormMode(null);
            setOpen(null);
            setStack([null]);
            void load();
          }}
        />
      ) : null}
      {confirmDelete && open ? (
        <Modal
          title="Delete this record?"
          sub={formatCell(open.row[cols[0]?.key ?? 'id'], 'text')}
          size="sm"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button type="button" className="btn danger" onClick={() => void doDelete()}>
                Delete
              </button>
            </>
          }
        >
          <p>This removes the record from the lists. It can be restored by an administrator.</p>
        </Modal>
      ) : null}
    </>
  );
}
