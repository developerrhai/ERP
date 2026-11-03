// GenericModulePage (prototype renderModule): /m/:pageId for every page the engine serves (schema kind
// generic or typed) — head, context chips, the 16-tab strip, the register with its dialogs, and the
// tabs that have real data. Pages the engine does not serve fall back to the placeholder.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ContextChips } from '../../components/ContextChips';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import { useAppContext } from '../../lib/context';
import { toUiError, type UiError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet, User } from '../../types';
import { ACTION_ICONS, ActionConfirmModal, actionsFor, variantClass } from './RecordActions';
import { RecordDrawer } from './RecordDrawer';
import { RecordFormModal } from './RecordFormModal';
import { PAGE_SIZES, RegisterTab, type QueryPatch, type RegisterQuery } from './RegisterTab';
import { AuditTab, DashboardTab, DataQualityTab, PhaseNotice, ReportsTab } from './ModuleTabs';
import { PanelView } from './kit/PanelView';
import {
  deleteRecord,
  exportXlsx,
  getSchema,
  restoreRecord,
  runAction,
  newIdempotencyKey,
  type PageAction,
  type PageSchema,
  type RecordRow,
} from './engineApi';
import {
  activeViewOf,
  canChangeRecord,
  confirmText,
  DASHBOARD_TAB,
  isLiveTab,
  moduleTabs,
  phaseForTab,
  registerTabName,
  schemaForView,
  voucherView,
} from './fieldModel';

export const UNDO_MS = 10_000;

interface Props {
  pageId: string;
  user: User;
  perms: ActionSet;
  /** Shown when the engine does not serve this page (404 / NOT_GENERIC / custom). */
  fallback: ReactNode;
}

export function GenericModulePage({ pageId, user, perms, fallback }: Props) {
  // A 404 means the engine does not serve this page (custom / not built): the placeholder shows.
  const {
    data: schema,
    loading,
    error,
  } = useLoad<PageSchema | null>(async () => {
    try {
      return await getSchema(pageId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  }, [pageId]);
  if (loading && !schema) {
    return (
      <p className="v8-sub" role="status">
        Loading page…
      </p>
    );
  }
  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (!schema || (schema.kind !== 'generic' && schema.kind !== 'typed')) return <>{fallback}</>;
  return <ModuleBody schema={schema} user={user} perms={perms} />;
}

type FormState = { row?: RecordRow } | null;

function ModuleBody({ schema, user, perms }: { schema: PageSchema; user: User; perms: ActionSet }) {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const ctx = useAppContext().data;
  const tabs = moduleTabs(schema);
  const activeView = activeViewOf(schema, params.get('view'));
  const viewSchema = useMemo(() => schemaForView(schema, activeView), [schema, activeView]);
  const registerTab = registerTabName(schema);
  const tabParam = params.get('tab') ?? '';
  const tab = tabs.includes(tabParam) ? tabParam : DASHBOARD_TAB;
  const sizeParam = Number(params.get('size'));
  const query: RegisterQuery = {
    q: params.get('q') ?? '',
    status: params.get('status') ?? '',
    sort: params.get('sort') ?? '',
    page: Math.max(1, Number(params.get('page')) || 1),
    size: (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : 10,
    filters: {
      ...Object.fromEntries(
        (schema.filters ?? []).map((flt) => [flt.param, params.get(flt.param) ?? '']),
      ),
      ...(activeView ? { view: activeView.key } : {}),
    },
  };
  const setFilter = useCallback(
    (param: string, value: string) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(param, value);
          else next.delete(param);
          next.delete('page');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const setQuery = useCallback(
    (patch: QueryPatch) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            const empty =
              v === '' ||
              v === undefined ||
              (k === 'page' && v === 1) ||
              (k === 'size' && v === 10);
            if (empty) next.delete(k);
            else next.set(k, String(v));
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  const selectTab = (t: string): void =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (t === DASHBOARD_TAB) next.delete('tab');
        else next.set('tab', t);
        return next;
      },
      { replace: false },
    );

  const [reloadToken, setReloadToken] = useState(0);
  const changed = useCallback(() => setReloadToken((n) => n + 1), []);
  const [form, setForm] = useState<FormState>(null);
  const [drawerRow, setDrawerRow] = useState<RecordRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<RecordRow | null>(null);
  const [actionDlg, setActionDlg] = useState<{ row: RecordRow; action: PageAction } | null>(null);
  const [headError, setHeadError] = useState('');
  const [undo, setUndo] = useState<{ row: RecordRow; token?: string } | null>(null);
  const [barRows, setBarRows] = useState<RecordRow[]>([]);
  const [barId, setBarId] = useState('');
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  const readOnly = !!schema.readOnly;
  const canAdd = perms.add && !readOnly && !schema.readOnlyCreate;
  const canEditPerm = perms.edit && !readOnly;
  const canDeletePerm = perms.delete && !readOnly;

  const openWorkspace = (row: RecordRow): void => {
    const recordPanel = schema.tabPanels?.find((tp) => tp.scope === 'record');
    if (!recordPanel) return;
    setDrawerRow(null);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', recordPanel.tab);
        next.set('rec', row.id);
        return next;
      },
      { replace: false },
    );
  };

  const afterSave = (row: RecordRow, verb: string): void => {
    setForm(null);
    setDrawerRow((cur) => (cur && cur.id === row.id ? row : cur));
    changed();
    const vouchers = voucherView(schema);
    if (activeView?.columns && vouchers) {
      // Add always creates a voucher: show it where it can be posted.
      setFilter('view', vouchers.key);
      toast('Draft saved — post it from Vouchers');
      return;
    }
    toast(`${row.code} ${verb}.`);
  };

  const startAction = (row: RecordRow, action: PageAction): void => {
    if (confirmText(action, row.code)) {
      setActionDlg({ row, action });
      return;
    }
    runAction(schema.pageId, row.id, action.key, newIdempotencyKey())
      .then((saved) => {
        setDrawerRow((cur) => (cur && cur.id === saved.id ? saved : cur));
        changed();
        toast(`${action.label}: ${saved.code} done.`);
      })
      .catch((err: unknown) => toast(toUiError(err).message));
  };

  const showUndo = (row: RecordRow, token?: string): void => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ row, ...(token ? { token } : {}) });
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
  };

  const undoDelete = (): void => {
    if (!undo) return;
    const { row, token } = undo;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(null);
    restoreRecord(schema.pageId, row.id, token)
      .then(() => {
        changed();
        toast(`${row.code} restored.`);
      })
      .catch((err: unknown) => toast(toUiError(err).message));
  };

  const filters = {
    q: query.q,
    status: query.status,
    sort: query.sort,
    filters: query.filters,
  };
  const excel = (): void => {
    setHeadError('');
    exportXlsx(schema.pageId, filters).catch((err: unknown) =>
      setHeadError(err instanceof ApiError ? err.message : 'Export failed.'),
    );
  };

  const barRow = barRows.find((r) => r.id === barId) ?? barRows[0];
  const unitId = ctx?.current.unitId ?? null;
  // The ledger columns only apply on the register tab; other tabs show vouchers.
  const drawerSchema = tab === registerTab ? viewSchema : schema;

  return (
    <div className="module-page">
      <div className="page-head">
        <div>
          <h1>{schema.title}</h1>
          <p>{schema.purpose ?? schema.family}</p>
        </div>
        <div className="actions">
          {perms.export ? (
            <button type="button" className="btn" onClick={excel}>
              Excel
            </button>
          ) : null}
          <button type="button" className="btn" onClick={() => window.print()}>
            Print
          </button>
          {canAdd ? (
            <button type="button" className="btn primary" onClick={() => setForm({})}>
              ＋ Add
            </button>
          ) : null}
        </div>
      </div>
      <ContextChips
        user={user}
        {...(schema.ownerDepartment ? { owner: schema.ownerDepartment } : {})}
        {...(schema.approvalRequired !== undefined ? { approval: schema.approvalRequired } : {})}
      />
      {headError ? <ErrorMessage>{headError}</ErrorMessage> : null}
      {tab === registerTab && viewSchema.actions.length > 0 && barRow ? (
        <div className="recordbar" aria-label="Record actions">
          <b>Record:</b>
          <select aria-label="Record" value={barRow.id} onChange={(e) => setBarId(e.target.value)}>
            {barRows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.code} — {r.status}
              </option>
            ))}
          </select>
          {actionsFor(viewSchema, barRow, perms).map((a) => (
            <button
              key={a.key}
              type="button"
              className={variantClass(a.variant)}
              onClick={() => startAction(barRow, a)}
            >
              {ACTION_ICONS[a.key] ? <span aria-hidden="true">{ACTION_ICONS[a.key]} </span> : null}
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="tabs" role="tablist" aria-label="Module views">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={t === tab}
            className={t === tab ? 'tab active' : 'tab'}
            onClick={() => selectTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={tab}>
        {tab === DASHBOARD_TAB ? (
          <DashboardTab schema={schema} reloadToken={reloadToken} onView={setDrawerRow} />
        ) : tab === registerTab ? (
          <RegisterTab
            key={activeView?.key ?? 'register'}
            schema={viewSchema}
            {...(schema.views ? { views: schema.views } : {})}
            {...(activeView ? { activeView: activeView.key } : {})}
            onSwitchView={(key) => setFilter('view', key)}
            perms={perms}
            query={query}
            onQuery={setQuery}
            onFilter={setFilter}
            reloadToken={reloadToken}
            onChanged={changed}
            onRows={setBarRows}
            onView={setDrawerRow}
            onEdit={(row) => setForm({ row })}
            onDelete={setDeleteRow}
            onAction={startAction}
            onNotify={toast}
            onOpenWorkspace={openWorkspace}
          />
        ) : tab === 'Data Quality' ? (
          <DataQualityTab schema={schema} reloadToken={reloadToken} />
        ) : tab === 'Activity Timeline' ? (
          <AuditTab schema={schema} variant="timeline" reloadToken={reloadToken} />
        ) : tab === 'Audit Trail' ? (
          <AuditTab schema={schema} variant="table" reloadToken={reloadToken} />
        ) : tab === 'Reports' ? (
          <ReportsTab schema={viewSchema} perms={perms} query={query} reloadToken={reloadToken} />
        ) : schema.tabPanels?.some((tp) => tp.tab === tab) ? (
          <PanelView
            pageId={schema.pageId}
            tab={schema.tabPanels.find((tp) => tp.tab === tab)!}
            recId={params.get('rec') ?? undefined}
            schema={schema}
            perms={perms}
            reloadToken={reloadToken}
            onChanged={changed}
          />
        ) : !isLiveTab(tab, schema) ? (
          <PhaseNotice tab={tab} phase={phaseForTab(tab, schema.family)} />
        ) : null}
      </div>

      {form ? (
        <RecordFormModal
          schema={schema}
          unitId={unitId}
          {...(form.row ? { row: form.row } : {})}
          onClose={() => setForm(null)}
          onSaved={(row) => afterSave(row, form.row ? 'updated' : 'created')}
        />
      ) : null}
      {drawerRow ? (
        <RecordDrawer
          schema={drawerSchema}
          row={drawerRow}
          perms={perms}
          canEdit={canEditPerm && canChangeRecord(drawerSchema, drawerRow)}
          canDelete={canDeletePerm && canChangeRecord(drawerSchema, drawerRow)}
          onEdit={(row) => {
            setDrawerRow(null);
            setForm({ row });
          }}
          onDelete={(row) => {
            setDrawerRow(null);
            setDeleteRow(row);
          }}
          onAction={(row, action) => {
            setDrawerRow(null);
            startAction(row, action);
          }}
          onOpenWorkspace={openWorkspace}
          onClose={() => setDrawerRow(null)}
        />
      ) : null}
      {deleteRow ? (
        <DeleteModal
          schema={schema}
          row={deleteRow}
          onClose={() => setDeleteRow(null)}
          onDeleted={(token) => {
            showUndo(deleteRow, token);
            setDeleteRow(null);
            changed();
          }}
        />
      ) : null}
      {actionDlg ? (
        <ActionConfirmModal
          schema={schema}
          row={actionDlg.row}
          action={actionDlg.action}
          onClose={() => setActionDlg(null)}
          onDone={(saved) => {
            setActionDlg(null);
            setDrawerRow((cur) => (cur && cur.id === saved.id ? saved : cur));
            changed();
            toast(`${actionDlg.action.label}: ${saved.code} done.`);
          }}
        />
      ) : null}
      {undo ? (
        <div className="toast show toast-action" role="status">
          Deleted.{' '}
          <button type="button" className="toast-undo" onClick={undoDelete}>
            Undo
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DeleteModal({
  schema,
  row,
  onClose,
  onDeleted,
}: {
  schema: PageSchema;
  row: RecordRow;
  onClose: () => void;
  onDeleted: (undoToken?: string) => void;
}) {
  const [error, setError] = useState<UiError | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const confirm = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await deleteRecord(schema.pageId, row);
      onDeleted(res.undoToken);
    } catch (caught) {
      setError(toUiError(caught));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  return (
    <Modal
      size="sm"
      title={`Delete ${schema.title}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? 'Deleting…' : 'Delete'}
          </button>
        </>
      }
    >
      {error ? <ErrorMessage>{error.message}</ErrorMessage> : null}
      <p className="confirm-text">Delete {row.code}? You can undo this for a few seconds.</p>
    </Modal>
  );
}
