// Chart of Accounts (fin-coa): one tree of group and ledger accounts. System accounts cannot be deleted.
import { useRef, useState, type FormEvent } from 'react';
import { Field, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { toUiError, type UiError } from '../../lib/errors';
import {
  createAccount,
  deleteAccount,
  listAccounts,
  updateAccount,
  type Account,
} from '../../lib/financeApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { PageHead, Pill, Empty, ErrorBox } from './shared';

const TYPES = ['Asset', 'Liability', 'Equity', 'Income', 'Expense'] as const;

export function ChartOfAccountsPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(() => listAccounts({ size: 200 }), []);
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<
    { kind: 'add' } | { kind: 'edit'; item: Account } | { kind: 'delete'; item: Account } | null
  >(null);
  const rows = (data?.rows ?? []).filter((a) => {
    const q = search.trim().toLowerCase();
    return !q || a.code.includes(q) || a.name.toLowerCase().includes(q);
  });
  const byId = new Map((data?.rows ?? []).map((a) => [a.id, a]));
  const depth = (a: Account): number => {
    let d = 0;
    let cur = a.parentId ? byId.get(a.parentId) : undefined;
    while (cur && d < 8) {
      d += 1;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return d;
  };
  const done = (msg: string) => {
    setDialog(null);
    reload();
    toast(msg);
  };

  return (
    <>
      <PageHead
        title="Chart of Accounts"
        sub="Every account the ledger can post to, grouped the way your statements read."
      >
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setDialog({ kind: 'add' })}>
            ＋ Add Account
          </button>
        ) : null}
      </PageHead>
      <ErrorBox message={error} />
      <div className="recordbar" style={{ marginBottom: 16 }}>
        <input
          type="search"
          placeholder="Search by code or name…"
          aria-label="Search accounts"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Account</th>
              <th scope="col">Type</th>
              <th scope="col">Rules</th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>
                  <strong>{a.code}</strong>
                </td>
                <td style={{ paddingLeft: 12 + depth(a) * 16, fontWeight: a.isGroup ? 600 : 400 }}>
                  {a.name}
                </td>
                <td>{a.rootType}</td>
                <td className="v8-sub">
                  {[
                    a.isGroup ? 'Group' : '',
                    a.costCenterRequired ? 'Needs cost centre' : '',
                    a.partyRequired
                      ? a.controlSide === 'RECEIVABLE'
                        ? 'Customer account'
                        : 'Supplier account'
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </td>
                <td>
                  <Pill>{a.status}</Pill>
                </td>
                <td>
                  <div className="actions">
                    {actions.edit ? (
                      <button
                        type="button"
                        className="btn sm"
                        aria-label={`Edit ${a.name}`}
                        onClick={() => setDialog({ kind: 'edit', item: a })}
                      >
                        Edit
                      </button>
                    ) : null}
                    {actions.delete && !a.isSystem ? (
                      <button
                        type="button"
                        className="btn sm danger"
                        aria-label={`Delete ${a.name}`}
                        onClick={() => setDialog({ kind: 'delete', item: a })}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {loading && !data ? <Empty cols={6}>Loading…</Empty> : null}
            {data && rows.length === 0 ? (
              <Empty cols={6}>No accounts found. Click ＋ Add Account.</Empty>
            ) : null}
          </tbody>
        </table>
      </div>
      {dialog?.kind === 'add' ? (
        <AccountForm
          accounts={data?.rows ?? []}
          onClose={() => setDialog(null)}
          onSaved={(a) => done(`Account ${a.code} created.`)}
        />
      ) : null}
      {dialog?.kind === 'edit' ? (
        <AccountForm
          accounts={data?.rows ?? []}
          item={dialog.item}
          onClose={() => setDialog(null)}
          onSaved={(a) => done(`Account ${a.code} updated.`)}
        />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <DeleteAccount
          item={dialog.item}
          onClose={() => setDialog(null)}
          onDone={() => done(`Account ${dialog.item.code} deleted.`)}
        />
      ) : null}
    </>
  );
}

function AccountForm({
  accounts,
  item,
  onClose,
  onSaved,
}: {
  accounts: Account[];
  item?: Account;
  onClose: () => void;
  onSaved: (a: Account) => void;
}) {
  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [parentId, setParentId] = useState(item?.parentId ?? '');
  const [isGroup, setIsGroup] = useState(item?.isGroup ?? false);
  const [costCenterRequired, setCcReq] = useState(item?.costCenterRequired ?? false);
  const [status, setStatus] = useState<'Active' | 'Inactive'>(item?.status ?? 'Active');
  const [err, setErr] = useState<UiError | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    const f: Record<string, string> = {};
    if (!/^[0-9]{4,8}$/.test(code)) f.code = 'Use 4 to 8 digits, for example 6201.';
    if (name.trim().length < 2) f.name = 'Enter the account name.';
    if (!item && !parentId) f.parentId = 'Choose the group this account belongs to.';
    if (Object.keys(f).length) {
      setErr({ message: '', fields: f, code: 'LOCAL' });
      return;
    }
    inFlight.current = true;
    setPending(true);
    setErr(null);
    try {
      if (!item)
        onSaved(
          await createAccount({ code, name: name.trim(), parentId, isGroup, costCenterRequired }),
        );
      else
        onSaved(
          await updateAccount(item.id, item.version, {
            name: name.trim(),
            costCenterRequired,
            status,
          }),
        );
    } catch (caught) {
      setErr(toUiError(caught));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <Modal
      title={item ? `Edit ${item.code}` : 'Add Account'}
      sub="Accounts sit under a group; their type comes from the group."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="coa-form" className="btn primary" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="coa-form" onSubmit={(e) => void submit(e)} noValidate>
        {err?.message ? <ErrorBox message={err.message} /> : null}
        <Field
          label="Account code *"
          value={code}
          disabled={!!item}
          onChange={(e) => setCode(e.target.value)}
          error={err?.fields.code}
          inputMode="numeric"
        />
        <Field
          label="Account name *"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={err?.fields.name}
        />
        {!item ? (
          <SelectField
            label="Belongs to group *"
            value={parentId}
            onChange={setParentId}
            error={err?.fields.parentId}
          >
            <option value="">Choose a group…</option>
            {accounts
              .filter((a) => a.isGroup)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
          </SelectField>
        ) : null}
        {!item ? (
          <label className="check">
            <input
              type="checkbox"
              checked={isGroup}
              onChange={(e) => setIsGroup(e.target.checked)}
            />{' '}
            This is a group (it holds other accounts and cannot be posted to)
          </label>
        ) : null}
        <label className="check">
          <input
            type="checkbox"
            checked={costCenterRequired}
            onChange={(e) => setCcReq(e.target.checked)}
          />{' '}
          Every posting needs a cost centre
        </label>
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
        <p className="v8-sub">Types: {TYPES.join(', ')}.</p>
      </form>
    </Modal>
  );
}

function DeleteAccount({
  item,
  onClose,
  onDone,
}: {
  item: Account;
  onClose: () => void;
  onDone: () => void;
}) {
  const [err, setErr] = useState('');
  const [pending, setPending] = useState(false);
  return (
    <Modal
      title="Delete account"
      size="sm"
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
            onClick={() =>
              void (async () => {
                setPending(true);
                try {
                  await deleteAccount(item.id);
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
      }
    >
      <ErrorBox message={err} />
      <p>
        Delete account{' '}
        <strong>
          {item.code} · {item.name}
        </strong>
        ? An account with ledger entries cannot be deleted; make it inactive instead.
      </p>
    </Modal>
  );
}
