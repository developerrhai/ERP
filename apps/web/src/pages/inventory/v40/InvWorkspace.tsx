// The V40 workspace of Item / SKU Master and Stock Balance around the generic register: the record strip, KPI cards,
// Department Filter, Validation Controls and the Detailed Table. A Stock Balance row is never edited or deleted by hand:
// Edit and Delete open a Stock Adjustment for its item and warehouse, Add opens a receipt, so the ledger stays true.
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../../components/Toast';
import { RecordDocsModal, SubmitSelectedDialog } from '../../../components/workspace/RecordDialogs';
import { RecordToolbar, type ToolbarRecord } from '../../../components/workspace/RecordToolbar';
import { DepartmentFilter, ValidationControls, WorkspaceKpis, useWorkspaceSummary } from '../../../components/workspace/Workspace';
import { useLoad } from '../../../lib/useLoad';
import { fetchPagePermissions } from '../../../lib/usePagePermissions';
import type { ActionSet } from '../../../types';
import type { PageAction, PageSchema, RecordRow } from '../../generic/engineApi';
import { ActionButtons } from '../../generic/RecordActions';
import { docIdOf, type RegisterWorkspace } from '../../generic/RegisterTab';

export const WORKSPACE_PAGES: ReadonlySet<string> = new Set(['inv-items', 'inv-stock']);

/** Columns of the Detailed Table under the main register (V40 order). */
const DETAIL: Record<string, string[]> = {
  'inv-items': ['itemCode', 'itemName', 'itemType', 'materialClass', 'category', 'brand', 'hsnSac', 'gstPct', 'baseUom', 'altUom', 'status'],
  'inv-stock': ['itemCode', 'itemName', 'itemType', 'warehouse', 'batch', 'available', 'stockValue', 'status'],
};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The form of a Stock Adjustment / Receipt opened for one balance row. */
export function stockVoucherLink(page: 'inv-adjustment' | 'inv-transactions', row: RecordRow, counted?: string): string {
  const [itemId = '', warehouseId = ''] = row.id.split('_');
  const q = new URLSearchParams({
    new: '1',
    itemId,
    warehouseId,
    itemCode: str(row.data.itemCode) || row.code,
    itemName: str(row.data.itemName),
    uom: str(row.data.uom),
    ...(counted !== undefined ? { counted } : {}),
  });
  return `/m/${page}?${q.toString()}`;
}

export interface InvWorkspaceInput {
  schema: PageSchema;
  /** The schema the register is drawing (with the computed fields of the open tab). */
  registerSchema: PageSchema;
  perms: ActionSet;
  /** True while the register itself is on screen (not a Documents / Reports tab). */
  active: boolean;
  tabIndex: number;
  rows: RecordRow[];
  activeId: string;
  onActive: (id: string) => void;
  department: string;
  onDepartment: (department: string) => void;
  reloadToken: number;
  onChanged: () => void;
  onAdd: () => void;
  onView: (row: RecordRow) => void;
  onEdit: (row: RecordRow) => void;
  onDelete: (row: RecordRow) => void;
  onAction: (row: RecordRow, action: PageAction) => void;
}

export interface InvWorkspaceView {
  toolbar: ReactNode;
  register: RegisterWorkspace | undefined;
  dialogs: ReactNode;
}

export function useInvWorkspace(p: InvWorkspaceInput): InvWorkspaceView {
  const pageId = p.schema.pageId;
  const on = WORKSPACE_PAGES.has(pageId);
  const stock = pageId === 'inv-stock';
  const navigate = useNavigate();
  const toast = useToast();
  // the two voucher pages that stand behind Add / Edit / Delete of a balance row (asked only on Stock Balance)
  const rights = useLoad(
    async () => {
      if (!stock) return null;
      const [adjust, receive] = await Promise.all([
        fetchPagePermissions('inv-adjustment'),
        fetchPagePermissions('inv-transactions'),
      ]);
      return { adjust: adjust.actions.add === true, receive: receive.actions.add === true };
    },
    [stock],
  );
  const summary = useWorkspaceSummary(on ? pageId : null, p.reloadToken);
  const [docsRow, setDocsRow] = useState<RecordRow | null>(null);
  const [submitting, setSubmitting] = useState<RecordRow[] | null>(null);
  if (!on) return { toolbar: null, register: undefined, dialogs: null };

  const docNoOf = (r: RecordRow): string => (stock ? `${r.code} @ ${r.refs?.warehouse?.code ?? str(r.data.warehouse)}` : r.code);
  const records: ToolbarRecord[] = p.rows.map((r) => ({
    key: r.id,
    label: stock ? `${r.code} · ${str(r.data.warehouse)}` : `${r.code} · ${str(r.data.itemName)}`,
    docId: docIdOf(r),
    docNo: docNoOf(r),
    status: r.status,
  }));
  const current = p.rows.find((r) => r.id === p.activeId) ?? p.rows[0];
  const onCurrent = (go: (r: RecordRow) => void) => (): void => {
    if (current) go(current);
  };

  const canAdjust = stock && rights.data?.adjust === true;
  const canReceive = stock && rights.data?.receive === true;
  const editStock = (r: RecordRow): void => {
    toast('A balance changes only through stock entries: a Stock Adjustment opens for this row.');
    navigate(stockVoucherLink('inv-adjustment', r));
  };
  const writeOff = (r: RecordRow): void => {
    toast('To remove this stock, save the Stock Adjustment with counted quantity 0 and submit it.');
    navigate(stockVoucherLink('inv-adjustment', r, '0'));
  };

  const toolbar = !p.active ? null : (
    <RecordToolbar
      pageId={pageId}
      records={records}
      activeKey={current?.id ?? ''}
      onSelect={p.onActive}
      canEdit={p.perms.edit}
      onChanged={p.onChanged}
      onLoad={{ run: onCurrent(p.onView) }}
      onAdd={
        stock
          ? canReceive
            ? { label: '＋ Add Stock', run: () => navigate(current ? stockVoucherLink('inv-transactions', current) : '/m/inv-transactions?new=1') }
            : undefined
          : p.perms.add
            ? { run: p.onAdd }
            : undefined
      }
      onEdit={
        stock
          ? canAdjust
            ? { run: onCurrent(editStock) }
            : undefined
          : p.perms.edit
            ? { run: onCurrent(p.onEdit) }
            : undefined
      }
      onDelete={
        stock
          ? canAdjust
            ? { run: onCurrent(writeOff) }
            : undefined
          : p.perms.delete
            ? { run: onCurrent(p.onDelete) }
            : undefined
      }
      extra={
        !stock && current ? (
          <ActionButtons schema={p.schema} row={current} small perms={p.perms} onAction={p.onAction} />
        ) : undefined
      }
    />
  );

  const byKey = new Map(p.registerSchema.fields.concat(p.schema.fields).map((f) => [f.key, f]));
  const detailFields = (DETAIL[pageId] ?? []).flatMap((k) => {
    const f = byKey.get(k);
    return f ? [f] : [];
  });
  const noun = p.schema.title;
  const master = !stock && p.tabIndex === 0;

  const register: RegisterWorkspace | undefined = !p.active
    ? undefined
    : {
        kpis: <WorkspaceKpis summary={summary} noun={noun} />,
        filterBar: <DepartmentFilter value={p.department} onChange={p.onDepartment} />,
        mainActions: stock ? 'none' : 'master',
        ...(master
          ? {
              side: <ValidationControls rules={summary?.controls ?? []} />,
              footer: p.perms.add ? (
                <button type="button" className="btn primary ws-add" onClick={p.onAdd}>
                  ＋ Add Master Record
                </button>
              ) : undefined,
            }
          : {}),
        detail: { title: `${noun} – Detailed Table`, fields: detailFields },
        onDocs: setDocsRow,
        ...(canAdjust ? { onEditRow: editStock, onDeleteRow: writeOff } : {}),
        ...(stock
          ? {
              trackOf: (r: RecordRow) => (Number(r.data.demand) > 0 ? () => navigate('/m/ops-order-360') : undefined),
            }
          : {}),
        onSubmitSelected: setSubmitting,
      };

  const dialogs = (
    <>
      {docsRow ? (
        <RecordDocsModal
          docType={pageId}
          docId={docIdOf(docsRow)}
          docNo={docNoOf(docsRow)}
          status={docsRow.status}
          canEdit={p.perms.edit}
          onClose={() => setDocsRow(null)}
        />
      ) : null}
      {submitting ? (
        <SubmitSelectedDialog
          docType={pageId}
          targets={submitting.map((r) => ({ docId: docIdOf(r), docNo: docNoOf(r) }))}
          onClose={() => setSubmitting(null)}
          onDone={(message) => {
            setSubmitting(null);
            toast(message);
            p.onChanged();
          }}
        />
      ) : null}
    </>
  );

  return { toolbar, register, dialogs };
}
