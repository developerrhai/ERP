// Cost Centers (fin-costcenter) and Profit Centers (fin-profitcenter): where money was spent / earned.
import { useRef, useState, type FormEvent } from 'react';
import { Field, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { useAppContext } from '../../lib/context';
import { toUiError, type UiError } from '../../lib/errors';
import {
  createDimension,
  deleteDimension,
  listDimension,
  updateDimension,
  type Dimension,
} from '../../lib/financeApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { Empty, ErrorBox, PageHead, Pill } from './shared';

export function DimensionsPage({ kind, actions }: { kind: 'cost' | 'profit'; actions: ActionSet }) {
  const toast = useToast();
  const label = kind === 'cost' ? 'Cost Center' : 'Profit Center';
  const { data, loading, error, reload } = useLoad(() => listDimension(kind), [kind]);
  const [dialog, setDialog] = useState<
    { kind: 'add' } | { kind: 'edit'; item: Dimension } | { kind: 'delete'; item: Dimension } | null
  >(null);
  const done = (msg: string) => {
    setDialog(null);
    reload();
    toast(msg);
  };
  return (
    <>
      <PageHead
        title={`${label}s`}
        sub={
          kind === 'cost'
            ? 'The departments and activities that spend money. Expense postings can be tagged to one.'
            : 'The units or businesses whose profit you want to see on its own.'
        }
      >
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setDialog({ kind: 'add' })}>
            ＋ Add {label}
          </button>
        ) : null}
      </PageHead>
      <ErrorBox message={error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Name</th>
              <th scope="col">{kind === 'cost' ? 'Type' : 'Default for unit'}</th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((d) => (
              <tr key={d.id}>
                <td>
                  <strong>{d.code}</strong>
                </td>
                <td>{d.name}</td>
                <td>
                  {kind === 'cost'
                    ? d.isGroup
                      ? 'Group'
                      : 'Cost centre'
                    : d.isDefault
                      ? 'Yes'
                      : '—'}
                </td>
                <td>
                  <Pill>{d.status}</Pill>
                </td>
                <td>
                  <div className="actions">
                    {actions.edit ? (
                      <button
                        type="button"
                        className="btn sm"
                        aria-label={`Edit ${d.name}`}
                        onClick={() => setDialog({ kind: 'edit', item: d })}
                      >
                        Edit
                      </button>
                    ) : null}
                    {actions.delete ? (
                      <button
                        type="button"
                        className="btn sm danger"
                        aria-label={`Delete ${d.name}`}
                        onClick={() => setDialog({ kind: 'delete', item: d })}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {loading && !data ? <Empty cols={5}>Loading…</Empty> : null}
            {data && data.rows.length === 0 ? (
              <Empty cols={5}>Nothing here yet. Click ＋ Add {label}.</Empty>
            ) : null}
          </tbody>
        </table>
      </div>
      {dialog && dialog.kind !== 'delete' ? (
        <DimensionForm
          kind={kind}
          label={label}
          groups={(data?.rows ?? []).filter((d) => d.isGroup)}
          {...(dialog.kind === 'edit' ? { item: dialog.item } : {})}
          onClose={() => setDialog(null)}
          onSaved={(d) => done(`${label} ${d.code} saved.`)}
        />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <Modal
          title={`Delete ${label}`}
          size="sm"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <DeleteButton
                kind={kind}
                item={dialog.item}
                onDone={() => done(`${label} ${dialog.item.code} deleted.`)}
              />
            </>
          }
        >
          <p>
            Delete{' '}
            <strong>
              {dialog.item.code} · {dialog.item.name}
            </strong>
            ? One that already has ledger entries cannot be deleted; make it inactive instead.
          </p>
        </Modal>
      ) : null}
    </>
  );
}

function DeleteButton({
  kind,
  item,
  onDone,
}: {
  kind: 'cost' | 'profit';
  item: Dimension;
  onDone: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState('');
  return (
    <>
      {err ? <span className="field-error">{err}</span> : null}
      <button
        type="button"
        className="btn danger"
        disabled={pending}
        onClick={() =>
          void (async () => {
            setPending(true);
            try {
              await deleteDimension(kind, item.id);
              onDone();
            } catch (e) {
              setErr(toUiError(e).message);
              setPending(false);
            }
          })()
        }
      >
        Delete
      </button>
    </>
  );
}

function DimensionForm({
  kind,
  label,
  groups,
  item,
  onClose,
  onSaved,
}: {
  kind: 'cost' | 'profit';
  label: string;
  groups: Dimension[];
  item?: Dimension;
  onClose: () => void;
  onSaved: (d: Dimension) => void;
}) {
  const ctx = useAppContext().data;
  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [parentId, setParentId] = useState(item?.parentId ?? '');
  const [isGroup, setIsGroup] = useState(item?.isGroup ?? false);
  const [status, setStatus] = useState<'Active' | 'Inactive'>(item?.status ?? 'Active');
  const [err, setErr] = useState<UiError | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    const f: Record<string, string> = {};
    if (!item && !/^[A-Z0-9-]{2,20}$/.test(code))
      f.code = 'Use 2 to 20 capital letters, digits or dashes, for example TAL-PROD.';
    if (name.trim().length < 2) f.name = 'Enter a name.';
    if (Object.keys(f).length) {
      setErr({ message: '', fields: f, code: 'LOCAL' });
      return;
    }
    inFlight.current = true;
    setPending(true);
    setErr(null);
    try {
      if (!item) {
        const unitId = ctx?.current.unitId ?? null;
        if (kind === 'profit' && !unitId)
          throw new Error('Choose a unit at the top of the screen first.');
        onSaved(
          await createDimension(
            kind,
            kind === 'cost'
              ? { code, name: name.trim(), parentId: parentId || null, isGroup, unitId }
              : { code, name: name.trim(), unitId },
          ),
        );
      } else {
        onSaved(await updateDimension(kind, item.id, item.version, { name: name.trim(), status }));
      }
    } catch (caught) {
      setErr(
        caught instanceof Error && !('code' in caught)
          ? { message: caught.message, fields: {}, code: 'LOCAL' }
          : toUiError(caught),
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  return (
    <Modal
      title={item ? `Edit ${item.code}` : `Add ${label}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="dim-form" className="btn primary" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="dim-form" onSubmit={(e) => void submit(e)} noValidate>
        <ErrorBox message={err?.message ?? ''} />
        <Field
          label="Code *"
          value={code}
          disabled={!!item}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          error={err?.fields.code}
        />
        <Field
          label="Name *"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={err?.fields.name}
        />
        {!item && kind === 'cost' ? (
          <>
            <SelectField label="Belongs to" value={parentId} onChange={setParentId}>
              <option value="">(top level)</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.code} · {g.name}
                </option>
              ))}
            </SelectField>
            <label className="check">
              <input
                type="checkbox"
                checked={isGroup}
                onChange={(e) => setIsGroup(e.target.checked)}
              />{' '}
              This is a group (it holds other cost centres)
            </label>
          </>
        ) : null}
        {item ? (
          <SelectField
            label="Status"
            value={status}
            onChange={(v) => setStatus(v as 'Active' | 'Inactive')}
          >
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </SelectField>
        ) : null}
      </form>
    </Modal>
  );
}
