// Zones, Racks, Shelves, RFID tags, Pick Waves and Pack Units: records with an entry form of their own, saved through
// /screens/:pageId (the same form the server validates).
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import {
  deleteRow,
  getEditData,
  getScreenRecord,
  listScreen,
  updateRow,
  type ScreenColumn,
} from '../../lib/screensApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { ErrorBox, Pill } from '../inventory/shared';
import type { V40Row } from '../sales/salesV40Api';
import { DetailSections } from '../screens/DetailSections';
import { ScreenFormModal } from '../screens/ScreenFormModal';
import { formatCell } from '../screens/ScreenPage';
import { ShelfBinsPanel } from '../screens/ShelfBinsPanel';
import { Confirm, WmsRegister, recordOf, useWmsActions } from './WmsRegister';

/** A one-press change of status a page offers on a record, besides editing it. */
interface Step {
  label: string;
  from: string[];
  values: Record<string, string>;
  done: string;
  /** asks first, with these words */
  ask?: string;
}

const ON_OFF: Step[] = [
  { label: 'Deactivate', from: ['Active'], values: { status: 'Inactive' }, done: 'deactivated' },
  { label: 'Activate', from: ['Inactive', 'Lost'], values: { status: 'Active' }, done: 'activated' },
];
const STEPS: Record<string, Step[]> = {
  'wms-zones': ON_OFF,
  'wms-racks': ON_OFF,
  'wms-shelves': ON_OFF,
  'wms-rfid': [...ON_OFF, { label: 'Report lost', from: ['Active', 'Inactive'], values: { status: 'Lost' }, done: 'reported lost' }],
  'wms-pick': [
    { label: 'Submit (release)', from: ['Draft'], values: { status: 'Released' }, done: 'released' },
    { label: 'Cancel wave', from: ['Draft'], values: { status: 'Cancelled' }, done: 'cancelled', ask: 'A cancelled wave cannot be picked or changed again.' },
  ],
  'wms-packing': [
    { label: 'Submit (packed)', from: ['Open'], values: { status: 'Packed' }, done: 'marked packed' },
    { label: 'Cancel pack', from: ['Open', 'Packed'], values: { status: 'Cancelled' }, done: 'cancelled', ask: 'A cancelled pack unit cannot be changed again.' },
  ],
};

function RecordView({
  pageId,
  id,
  title,
  canEdit,
  onEdit,
  onClose,
}: {
  pageId: string;
  id: string;
  title: string;
  canEdit: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const rec = useLoad(() => getScreenRecord(pageId, id), [pageId, id]);
  const fields: ScreenColumn[] = rec.data?.fields ?? [];
  const values: Record<string, unknown> = rec.data?.data ?? {};
  const status = String(values.status ?? '');
  return (
    <Modal
      title={`${title} details`}
      onClose={onClose}
      footer={
        <>
          {canEdit && rec.data?.data.actions.allowed.includes('edit') ? (
            <button type="button" className="btn primary" onClick={onEdit}>
              Edit
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <ErrorBox message={rec.error} />
      {rec.loading && !rec.data ? <p role="status">Loading…</p> : null}
      <dl className="wms-kv">
        {fields.map((f) => (
          <div key={f.key}>
            <dt>{f.label}</dt>
            <dd>{f.type === 'status' && status ? <Pill>{status}</Pill> : formatCell(values[f.key], f.type)}</dd>
          </div>
        ))}
      </dl>
      <DetailSections pageId={pageId} id={id} />
      {pageId === 'wms-shelves' ? <ShelfBinsPanel shelfId={id} canEdit={canEdit} /> : null}
    </Modal>
  );
}

export function ScreenDesk({ pageId, title, sub, actions }: { pageId: string; title: string; sub: string; actions: ActionSet }) {
  const meta = useLoad(() => listScreen(pageId, { limit: 1 }), [pageId]);
  const form = meta.data?.meta.form ?? null;
  const act = useWmsActions();
  const [editing, setEditing] = useState<{ id?: string } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ title: string; text: string; action: string; yes: () => void } | null>(null);

  const editable = (status: string): boolean => Boolean(form) && !form?.noEdit && (!form?.editStatuses || form.editStatuses.includes(status));
  const noun = form?.title ?? 'Record';
  const steps = STEPS[pageId] ?? [];
  const apply = async (id: string, values: Record<string, string>): Promise<void> => {
    const current = await getEditData(pageId, id);
    await updateRow(pageId, id, current.version, { values });
  };

  const rowExtra = (r: V40Row) => (
    <>
      {actions.edit
        ? steps
            .filter((s) => s.from.includes(r.status))
            .map((s) => {
              const go = (): void => void act.run(() => apply(recordOf(r), s.values), `${r.number} ${s.done}.`);
              return (
                <button
                  key={s.label}
                  type="button"
                  className="btn sm"
                  onClick={() => (s.ask ? setAsk({ title: `${s.label}: ${r.number}?`, text: s.ask, action: s.label, yes: go }) : go())}
                >
                  {s.label}
                </button>
              );
            })
        : null}
      {actions.delete && editable(r.status) ? (
        <button
          type="button"
          className="btn sm danger"
          onClick={() =>
            setAsk({
              title: `Delete ${r.number}?`,
              text: pageId === 'wms-pick' ? 'This removes the whole wave with all its pick tasks.' : 'This removes the record from the lists. An administrator can restore it.',
              action: 'Delete',
              yes: () => void act.run(() => deleteRow(pageId, recordOf(r)), `${r.number} deleted.`),
            })
          }
        >
          Delete
        </button>
      ) : null}
    </>
  );

  const bulkExtra = (selected: V40Row[], done: () => void) => (
    <>
      {actions.edit
        ? steps
            .filter((s) => !s.ask && s.label !== 'Report lost')
            .map((s) => {
              const rows = selected.filter((r) => s.from.includes(r.status));
              const label = `${s.label.replace(/ \(.*\)$/, '')} Selected`;
              return (
                <button
                  key={s.label}
                  type="button"
                  className="btn sm"
                  disabled={rows.length === 0}
                  title={rows.length === 0 ? `Tick a ${s.from.join(' / ')} record first.` : undefined}
                  onClick={() => void act.each(rows, (r) => apply(recordOf(r), s.values), s.done).then(done)}
                >
                  {label}
                </button>
              );
            })
        : null}
      {actions.delete ? (
        <button
          type="button"
          className="btn sm danger"
          disabled={selected.length === 0}
          title={selected.length === 0 ? 'Tick the records to delete first.' : undefined}
          onClick={() =>
            setAsk({
              title: `Delete ${selected.length} selected?`,
              text: 'Records that are still in use, or can no longer be changed, are kept and named with the reason.',
              action: 'Delete',
              yes: () => void act.each(selected, (r) => deleteRow(pageId, recordOf(r)), 'deleted').then(done),
            })
          }
        >
          Delete Selected
        </button>
      ) : null}
    </>
  );

  return (
    <WmsRegister
      pageId={pageId}
      title={title}
      sub={sub}
      actions={actions}
      add={form ? [{ label: `＋ Add ${noun}`, onClick: () => setEditing({}) }] : []}
      error={meta.error || act.error}
      reloadKey={act.reloadKey}
      reload={act.reload}
      onOpen={setViewing}
      onEdit={actions.edit ? (id) => setEditing({ id }) : undefined}
      canEditRow={editable}
      rowExtra={rowExtra}
      bulkExtra={bulkExtra}
    >
      {viewing ? (
        <RecordView
          pageId={pageId}
          id={viewing}
          title={noun}
          canEdit={actions.edit}
          onEdit={() => {
            setEditing({ id: viewing });
            setViewing(null);
          }}
          onClose={() => {
            setViewing(null);
            act.reload();
          }}
        />
      ) : null}
      {editing && form ? (
        <ScreenFormModal
          pageId={pageId}
          form={form}
          {...(editing.id ? { editId: editing.id } : {})}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            act.reload();
          }}
        />
      ) : null}
      {ask ? (
        <Confirm
          title={ask.title}
          text={ask.text}
          action={ask.action}
          onClose={() => setAsk(null)}
          onConfirm={() => {
            const yes = ask.yes;
            setAsk(null);
            yes();
          }}
        />
      ) : null}
    </WmsRegister>
  );
}
