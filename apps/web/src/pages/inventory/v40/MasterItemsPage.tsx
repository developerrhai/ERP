// Product Master (master-products) and Raw Material Master (master-materials): the item master read through the V40 tab
// layouts of those two ERP Process Control pages, with the V40 master workspace around them (record strip, KPI cards,
// Department Filter, Validation Controls, Detailed Table). Every record is an item: Add / Edit / Delete use the Item
// form and the Item / SKU Master permission.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ContextChips } from '../../../components/ContextChips';
import { EmailDocDialog } from '../../../components/EmailDocDialog';
import { Modal } from '../../../components/Modal';
import { MoveForwardDialog } from '../../../components/MoveForward';
import { useToast } from '../../../components/Toast';
import { RecordDocsModal, SubmitSelectedDialog } from '../../../components/workspace/RecordDialogs';
import { saveCsvTable } from '../../../components/workspace/csv';
import { RecordToolbar } from '../../../components/workspace/RecordToolbar';
import { DepartmentFilter, WorkspaceKpis, useWorkspaceSummary } from '../../../components/workspace/Workspace';
import { getSession } from '../../../auth/session';
import { useAppContext } from '../../../lib/context';
import { docsMailApi, saveFile } from '../../../lib/docsMailApi';
import { toUiError } from '../../../lib/errors';
import { useLoad } from '../../../lib/useLoad';
import { usePagePermissions } from '../../../lib/usePagePermissions';
import type { ActionSet } from '../../../types';
import { ApprovalsPanel, AuditPanel, tabKind, useFrame } from '../../frame/V40TabFrame';
import { deleteRecord, getRecord, getSchema, restoreRecord, type PageSchema, type RecordRow } from '../../generic/engineApi';
import { RecordDrawer } from '../../generic/RecordDrawer';
import { RecordFormModal } from '../../generic/RecordFormModal';
import { PageHead } from '../shared';
import { INV_HEADS } from './heads';
import { InvTabView } from './InvTabView';
import { getV40Tab, type V40TabRow } from './v40Api';
import { cellText } from './V40Cell';

type MasterPage = 'master-products' | 'master-materials';

const CONFIG: Record<
  MasterPage,
  { firstTab: string; noun: string; codeKey: string; nameKey: string; itemType: string; owner: string; detail: [string, string, 'text' | 'qty' | 'money' | 'status'][] }
> = {
  'master-products': {
    firstTab: 'Product Register',
    noun: 'Product',
    codeKey: 'productId',
    nameKey: 'productName',
    itemType: 'Finished Good',
    owner: 'Production',
    detail: [
      ['productId', 'Product ID / SKU', 'text'],
      ['productName', 'Product Name', 'text'],
      ['category', 'Category', 'text'],
      ['uom', 'Unit of Measurement', 'text'],
      ['sellingPrice', 'Selling Price', 'money'],
      ['taxPct', 'Tax / GST %', 'text'],
      ['minimumStock', 'Minimum Stock', 'qty'],
      ['status', 'Status', 'status'],
    ],
  },
  'master-materials': {
    firstTab: 'Material Register',
    noun: 'Material',
    codeKey: 'materialCode',
    nameKey: 'materialName',
    itemType: 'Raw Material',
    owner: 'Warehouse',
    detail: [
      ['materialCode', 'Material Code', 'text'],
      ['materialName', 'Material Name', 'text'],
      ['category', 'Category', 'text'],
      ['unit', 'Unit', 'text'],
      ['currentStock', 'Current Stock', 'qty'],
      ['reorderLevel', 'Reorder Level', 'qty'],
      ['standardCost', 'Standard Cost', 'money'],
      ['status', 'Status', 'status'],
    ],
  },
};

const STANDARD_TAB = /^(analytics|documents|approvals?|reports?|audit trail)/i;

export function MasterItemsPage({ pageId, actions }: { pageId: MasterPage; actions: ActionSet }) {
  const cfg = CONFIG[pageId];
  const head = INV_HEADS[pageId] ?? { title: cfg.noun, sub: '' };
  const frame = useFrame();
  const toast = useToast();
  useEffect(() => {
    frame?.claim();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- claim once per page mount
  }, []);
  // outside the V40 tab strip (a bare render) the page opens on its first tab
  const tabName = frame?.tabName ?? cfg.firstTab;
  const index = frame?.index ?? 0;
  const kind = tabKind(tabName, index);
  const register = !STANDARD_TAB.test(tabName.trim());

  // the records are items: what the user may do with them comes from Item / SKU Master
  const items = usePagePermissions('inv-items').actions;
  const schema = useLoad<PageSchema>(() => getSchema('inv-items'), []);
  const unitId = useAppContext().data?.current.unitId ?? null;
  const [department, setDepartment] = useState('');
  const [token, setToken] = useState(0);
  const changed = useCallback(() => setToken((n) => n + 1), []);
  const summary = useWorkspaceSummary(pageId, token);
  const [shown, setShown] = useState<{ rows: V40TabRow[]; total: number }>({ rows: [], total: 0 });
  const onRows = useCallback((rows: V40TabRow[], total: number) => setShown({ rows, total }), []);
  const [activeId, setActiveId] = useState('');

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RecordRow | null>(null);
  const [viewing, setViewing] = useState<RecordRow | null>(null);
  const [deleting, setDeleting] = useState<V40TabRow[] | null>(null);
  const [docs, setDocs] = useState<V40TabRow | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [moving, setMoving] = useState<V40TabRow | null>(null);
  const [submitting, setSubmitting] = useState<V40TabRow[] | null>(null);

  const canAdd = items.add && !!schema.data;
  // the top bar's "＋ Add New" opens the same form
  useEffect(() => {
    const onAdd = (e: Event): void => {
      const detail = (e as CustomEvent<{ pageId?: string; handled: boolean }>).detail;
      if (detail.pageId !== pageId) return;
      detail.handled = true;
      if (canAdd) setAdding(true);
      else toast('You need the Add right on Item / SKU Master to create a record.');
    };
    window.addEventListener('v40-add-record', onAdd);
    return () => window.removeEventListener('v40-add-record', onAdd);
  }, [pageId, canAdd, toast]);

  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const codeOf = (r: V40TabRow): string => str(r.cells[cfg.codeKey]) || str(r.cells.productId) || str(r.cells.materialCode);
  const nameOf = (r: V40TabRow): string => str(r.cells[cfg.nameKey]);
  const real = shown.rows.filter((r): r is V40TabRow & { id: string } => !!r.id);
  const current = real.find((r) => r.id === activeId) ?? real[0];

  const open = async (id: string, then: (row: RecordRow) => void): Promise<void> => {
    try {
      then(await getRecord('inv-items', id));
    } catch (e) {
      toast(toUiError(e).message);
    }
  };
  const view = (r: V40TabRow): void => void open(r.id ?? '', setViewing);
  const edit = (r: V40TabRow): void => void open(r.id ?? '', setEditing);
  const print = async (r: V40TabRow, as: 'word' | 'standard'): Promise<void> => {
    try {
      saveFile(await docsMailApi.print('inv-items', r.id ?? '', as), `${codeOf(r)}.${as === 'word' ? 'docx' : 'pdf'}`);
    } catch (e) {
      toast(toUiError(e).message);
    }
  };
  const saved = (row: RecordRow, verb: string): void => {
    setAdding(false);
    setEditing(null);
    changed();
    toast(`${row.code} ${verb}.`);
  };

  /** The Detailed Table's columns of some rows, as text. */
  const textRows = (rows: V40TabRow[]): string[][] =>
    rows.map((r) => cfg.detail.map(([key, , format]) => cellText({ key, label: key, format }, r.cells[key]) ?? ''));

  // the top bar's Excel / Export: every record of this master (and of the chosen department), not only the page on screen
  useEffect(() => {
    const exportAll = async (): Promise<void> => {
      try {
        const all: V40TabRow[] = [];
        for (let page = 1; page <= 100; page += 1) {
          const res = await getV40Tab(pageId, cfg.firstTab, { q: '', status: '', page, size: 100, department });
          all.push(...res.rows);
          if (res.rows.length === 0 || all.length >= res.total) break;
        }
        saveCsvTable(`${pageId}.csv`, cfg.detail.map(([, label]) => label), textRows(all));
      } catch (e) {
        toast(toUiError(e).message);
      }
    };
    const onExport = (e: Event): void => {
      const { detail } = e as CustomEvent<{ pageId?: string; handled: boolean }>;
      if (detail.pageId !== pageId || !actions.export) return;
      detail.handled = true;
      void exportAll();
    };
    window.addEventListener('v40-export-register', onExport);
    return () => window.removeEventListener('v40-export-register', onExport);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- textRows and cfg follow pageId
  }, [pageId, department, actions.export, toast]);

  /** The Detailed Table's own export: the rows it shows, without the buttons. */
  const exportDetail = (as: 'word' | 'excel' | 'pdf'): void => {
    const heads = cfg.detail.map(([, label]) => label);
    const body = textRows(shown.rows);
    const title = `${head.title} – Detailed Table`;
    const html = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const table = `<table border="1" cellpadding="4" style="border-collapse:collapse"><tr>${heads.map((h) => `<th>${html(h)}</th>`).join('')}</tr>${body
      .map((line) => `<tr>${line.map((c) => `<td>${html(c)}</td>`).join('')}</tr>`)
      .join('')}</table>`;
    if (as === 'excel') {
      saveCsvTable(`${pageId}.csv`, heads, body);
    } else if (as === 'word') {
      saveFile(
        { blob: new Blob([`<html><head><meta charset="utf-8"></head><body><h2>${html(title)}</h2>${table}</body></html>`], { type: 'application/msword' }), filename: null },
        `${pageId}.doc`,
      );
    } else {
      const w = window.open('', '_blank');
      if (!w) return toast('Allow pop-ups to save this table as PDF.');
      w.document.write(`<html><head><meta charset="utf-8"><title>${html(title)}</title></head><body><h2>${html(title)}</h2>${table}</body></html>`);
      w.document.close();
      w.print();
    }
  };

  const rowButtons = (r: V40TabRow): ReactNode =>
    r.id ? (
      <>
        <button type="button" className="btn sm" onClick={() => view(r)}>
          View
        </button>
        {items.edit ? (
          <button type="button" className="btn sm" onClick={() => edit(r)}>
            Edit
          </button>
        ) : null}
        <button type="button" className="btn sm" onClick={() => setDocs(r)}>
          Docs
        </button>
        {items.delete ? (
          <button type="button" className="btn sm danger" onClick={() => setDeleting([r])}>
            Delete
          </button>
        ) : null}
      </>
    ) : null;

  const table = (
    <InvTabView
      pageId={pageId}
      tab={tabName}
      perms={actions}
      department={register ? department : ''}
      refresh={token}
      onRows={onRows}
      rowAction={rowButtons}
      bulk={(picked, clear) => (
        <>
          <button type="button" className="btn" disabled={picked.length === 0} onClick={() => setSubmitting(picked)}>
            Submit Selected
          </button>
          {items.delete ? (
            <button
              type="button"
              className="btn danger"
              disabled={picked.length === 0}
              onClick={() => {
                setDeleting(picked);
                clear();
              }}
            >
              Delete Selected
            </button>
          ) : null}
        </>
      )}
      extra={
        kind === 'audit' ? (
          <>
            <h3 className="inv-v40-sub">Audit entries</h3>
            <AuditPanel pageId="inv-items" />
          </>
        ) : kind === 'approvals' ? (
          <>
            <h3 className="inv-v40-sub">Approval requests</h3>
            <ApprovalsPanel pageId="inv-items" />
          </>
        ) : null
      }
    />
  );

  const user = getSession().user;
  return (
    <>
      <PageHead title={head.title} sub={head.sub} />
      {user ? (
        <ContextChips
          user={user}
          owner={cfg.owner}
          {...(schema.data?.approvalRequired !== undefined ? { approval: schema.data.approvalRequired } : {})}
        />
      ) : null}
      {register ? (
        <>
          <RecordToolbar
            pageId={pageId}
            docType="inv-items"
            records={real.map((r) => ({ key: r.id, label: `${codeOf(r)} · ${nameOf(r)}`, docId: r.id, docNo: codeOf(r), status: r.status ?? '' }))}
            activeKey={current?.id ?? ''}
            onSelect={setActiveId}
            canEdit={items.edit}
            onChanged={changed}
            onLoad={{ run: () => current && view(current) }}
            onAdd={canAdd ? { run: () => setAdding(true) } : undefined}
            onEdit={items.edit ? { run: () => current && edit(current) } : undefined}
            onDelete={items.delete ? { run: () => current && setDeleting([current]) } : undefined}
          />
          <WorkspaceKpis summary={summary} noun={head.title} />
          <DepartmentFilter value={department} onChange={setDepartment} />
        </>
      ) : null}
      {table}
      {register && index === 0 && canAdd ? (
        <button type="button" className="btn primary ws-add" onClick={() => setAdding(true)}>
          ＋ Add Master Record
        </button>
      ) : null}
      {register ? (
        <section className="card ws-section" aria-label={`${head.title} – Detailed Table`}>
          <div className="ws-section-head">
            <h3>{head.title} – Detailed Table</h3>
            <small>
              {shown.rows.length} of {shown.total} records. All row actions are available here.
            </small>
            <span className="ws-spacer" />
            <button
              type="button"
              className="btn sm"
              onClick={() => (current ? setEmail(current.id) : toast('There is no record to email yet.'))}
              title="Emails the record picked in the Record box"
            >
              Send Email
            </button>
            <button type="button" className="btn sm" onClick={() => exportDetail('word')}>
              Word
            </button>
            <button type="button" className="btn sm" onClick={() => exportDetail('excel')}>
              Excel
            </button>
            <button type="button" className="btn sm" onClick={() => exportDetail('pdf')}>
              PDF
            </button>
          </div>
          <div className="table-wrap">
            <table className="register-table ws-detail ws-lined">
              <thead>
                <tr>
                  {cfg.detail.map(([key, label]) => (
                    <th key={key} scope="col">
                      {label}
                    </th>
                  ))}
                  <th scope="col" className="sticky-actions">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {real.map((r) => (
                  <tr key={r.id}>
                    {cfg.detail.map(([key, label, format]) => {
                      const text = cellText({ key, label, format }, r.cells[key]) ?? '—';
                      return (
                        <td key={key} className={format === 'qty' || format === 'money' ? 'num' : undefined}>
                          {format === 'status' ? <span className={`status ${text.toLowerCase()}`}>{text}</span> : text}
                        </td>
                      );
                    })}
                    <td className="sticky-actions">
                      <div className="actions row-actions ws-actions narrow">
                        {rowButtons(r)}
                        <button type="button" className="btn sm" onClick={() => setEmail(r.id)}>
                          Email
                        </button>
                        <button type="button" className="btn sm" onClick={() => void print(r, 'word')}>
                          Word
                        </button>
                        <button type="button" className="btn sm" onClick={() => void print(r, 'standard')}>
                          PDF
                        </button>
                        <button type="button" className="btn sm primary" onClick={() => setMoving(r)}>
                          Move Forward
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {real.length === 0 ? (
                  <tr className="empty-row">
                    <td colSpan={cfg.detail.length + 1}>No records to show.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {(adding || editing) && schema.data ? (
        <RecordFormModal
          schema={{ ...schema.data, title: head.title }}
          unitId={unitId}
          {...(editing ? { row: editing } : { defaults: { itemType: cfg.itemType } })}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={(row) => saved(row, editing ? 'updated' : 'created')}
        />
      ) : null}
      {viewing && schema.data ? (
        <RecordDrawer
          schema={schema.data}
          row={viewing}
          perms={items}
          canEdit={items.edit}
          canDelete={items.delete}
          onEdit={(row) => {
            setViewing(null);
            setEditing(row);
          }}
          onDelete={(row) => {
            setViewing(null);
            setDeleting([{ id: row.id, status: row.status, alloc: null, cells: { [cfg.codeKey]: row.code } }]);
          }}
          onAction={() => undefined}
          onClose={() => setViewing(null)}
        />
      ) : null}
      {deleting ? (
        <DeleteItems
          targets={deleting.filter((r) => !!r.id).map((r) => ({ id: r.id ?? '', code: codeOf(r) }))}
          onClose={() => setDeleting(null)}
          onDone={(message) => {
            setDeleting(null);
            changed();
            toast(message);
          }}
        />
      ) : null}
      {docs?.id ? (
        <RecordDocsModal docType="inv-items" docId={docs.id} docNo={codeOf(docs)} status={docs.status ?? ''} canEdit={items.edit} onClose={() => setDocs(null)} />
      ) : null}
      {email ? <EmailDocDialog docType="inv-items" docId={email} onClose={() => setEmail(null)} /> : null}
      {moving?.id ? (
        <MoveForwardDialog
          docType="inv-items"
          docId={moving.id}
          docNo={codeOf(moving)}
          onClose={() => setMoving(null)}
          onMoved={() => {
            toast(`${codeOf(moving)} moved forward.`);
            setMoving(null);
            changed();
          }}
        />
      ) : null}
      {submitting ? (
        <SubmitSelectedDialog
          docType="inv-items"
          targets={submitting.filter((r) => !!r.id).map((r) => ({ docId: r.id ?? '', docNo: codeOf(r) }))}
          onClose={() => setSubmitting(null)}
          onDone={(message) => {
            setSubmitting(null);
            changed();
            toast(message);
          }}
        />
      ) : null}
    </>
  );
}

/** Delete one or several items; the server refuses one that has stock movements (deactivate it instead). */
function DeleteItems({
  targets,
  onClose,
  onDone,
}: {
  targets: { id: string; code: string }[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // after deleting, the dialog stays open once so the delete can be undone
  const [restore, setRestore] = useState<{ id: string; token?: string | undefined }[]>([]);
  const [result, setResult] = useState('');
  const toast = useToast();
  const one = targets.length === 1 ? targets[0] : null;
  const run = async (): Promise<void> => {
    setBusy(true);
    setError('');
    let done = 0;
    const refused: string[] = [];
    const undo: { id: string; token?: string | undefined }[] = [];
    for (const t of targets) {
      try {
        const row = await getRecord('inv-items', t.id);
        const res = await deleteRecord('inv-items', row);
        undo.push({ id: t.id, token: res.undoToken });
        done += 1;
      } catch (e) {
        refused.push(`${t.code}: ${toUiError(e).message}`);
      }
    }
    setBusy(false);
    if (done === 0) {
      setError(refused.join(' '));
      return;
    }
    setRestore(undo);
    if (refused.length) toast(refused[0] ?? '');
    setResult(`Deleted ${done} record${done === 1 ? '' : 's'}.${refused.length ? ` ${refused.length} could not be deleted.` : ''}`);
  };
  const undoAll = async (): Promise<void> => {
    setBusy(true);
    try {
      for (const u of restore) await restoreRecord('inv-items', u.id, u.token);
      onDone('Delete undone.');
    } catch (e) {
      setError(toUiError(e).message);
      setBusy(false);
    }
  };
  return (
    <Modal
      size="sm"
      title="Delete record"
      onClose={result ? () => onDone(result) : onClose}
      footer={
        result ? (
          <>
            <button type="button" className="btn" disabled={busy} onClick={() => void undoAll()}>
              Undo
            </button>
            <button type="button" className="btn primary" onClick={() => onDone(result)}>
              Done
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn danger" disabled={busy} onClick={() => void run()}>
              {busy ? 'Deleting…' : 'Delete'}
            </button>
          </>
        )
      }
    >
      {error ? (
        <p role="alert" className="error-text">
          {error}
        </p>
      ) : null}
      <p className="confirm-text">
        {result || (one ? `Delete ${one.code}?` : `Delete ${targets.length} selected records?`)}
      </p>
    </Modal>
  );
}
