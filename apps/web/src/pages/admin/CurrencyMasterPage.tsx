// Currency Master (admin-currency): typed master for system currencies,
// ISO codes, symbols, base currency flag, exchange rates, and decimal precision.
import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Field, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { toUiError, type UiError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet, Currency, UserStatus } from '../../types';
import {
  createCurrency,
  deleteCurrency,
  listCurrencies,
  updateCurrency,
  type CurrencyInput,
} from './orgApi';

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; item: Currency }
  | { kind: 'delete'; item: Currency }
  | null;

export function CurrencyMasterPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const { data, loading, error, reload, setData } = useLoad(listCurrencies, []);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [modalKey, setModalKey] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const canChange = actions.controls || actions.add || actions.edit;
  const canDelete = actions.controls || actions.delete;
  const close = (): void => setDialog(null);

  const reloadCurrency = async (id: string): Promise<void> => {
    const list = await listCurrencies();
    setData(list);
    const fresh = list.find((c) => c.id === id);
    setDialog((cur) => (cur && cur.kind !== 'add' && fresh ? { ...cur, item: fresh } : null));
    setModalKey((k) => k + 1);
  };

  const afterSave = (message: string): void => {
    close();
    reload();
    toast(message);
  };

  const filtered = (data ?? []).filter((c) => {
    if (statusFilter && c.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return (
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.symbol.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Currency Master</h1>
          <p>Currencies, base currency configuration, and exchange rates.</p>
        </div>
        <div className="actions">
          <Link className="btn" to="/m/admin-settings">
            ← System Setup
          </Link>
          {canChange ? (
            <button
              type="button"
              className="btn primary"
              onClick={() => setDialog({ kind: 'add' })}
            >
              ＋ Add Currency
            </button>
          ) : null}
        </div>
      </div>
      {error ? (
        <div className="msg error show static" role="alert">
          {error}
        </div>
      ) : null}
      <div className="recordbar" style={{ marginBottom: 16 }}>
        <input
          type="search"
          placeholder="Search currency code, name or symbol…"
          value={search}
          aria-label="Search currencies"
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          value={statusFilter}
          aria-label="Filter by status"
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Name</th>
              <th scope="col">Symbol</th>
              <th scope="col">Decimals</th>
              <th scope="col">Base Currency</th>
              <th scope="col">Exchange Rate</th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const active = c.status === 'ACTIVE';
              return (
                <tr key={c.id}>
                  <td>
                    <strong>{c.code}</strong>
                  </td>
                  <td>{c.name}</td>
                  <td>
                    <span style={{ fontSize: '1.1em' }}>{c.symbol}</span>
                  </td>
                  <td>{c.decimalPlaces ?? 2}</td>
                  <td>
                    {c.isBase ? (
                      <span
                        className="chip"
                        style={{ background: '#dbeafe', color: '#1e40af', fontWeight: 600 }}
                      >
                        Base Currency
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{c.isBase ? '1.000000' : Number(c.exchangeRate ?? 1).toFixed(4)}</td>
                  <td>
                    <span className={`status ${c.status.toLowerCase()}`}>
                      {active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    {canChange || canDelete ? (
                      <div className="actions">
                        {canChange ? (
                          <button
                            type="button"
                            className="btn sm"
                            aria-label={`Edit ${c.name}`}
                            onClick={() => setDialog({ kind: 'edit', item: c })}
                          >
                            Edit
                          </button>
                        ) : null}
                        {canDelete && !c.isBase ? (
                          <button
                            type="button"
                            className="btn sm danger"
                            aria-label={`Delete ${c.name}`}
                            onClick={() => setDialog({ kind: 'delete', item: c })}
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <span className="v8-sub">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {loading && !data ? (
              <tr className="empty-row">
                <td colSpan={8}>Loading…</td>
              </tr>
            ) : null}
            {data && filtered.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={8}>No currencies found.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {dialog?.kind === 'add' ? (
        <CurrencyFormModal
          onClose={close}
          onSaved={(item) => afterSave(`Currency ${item.code} created.`)}
        />
      ) : null}
      {dialog?.kind === 'edit' ? (
        <CurrencyFormModal
          key={modalKey}
          item={dialog.item}
          onReload={() => reloadCurrency(dialog.item.id)}
          onClose={close}
          onSaved={(item) => afterSave(`Currency ${item.code} updated.`)}
        />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <CurrencyDeleteModal
          key={modalKey}
          item={dialog.item}
          onReload={() => reloadCurrency(dialog.item.id)}
          onClose={close}
          onDone={(msg) => afterSave(msg)}
        />
      ) : null}
    </>
  );
}

interface FormProps {
  item?: Currency;
  onReload?: () => Promise<void>;
  onClose: () => void;
  onSaved: (c: Currency) => void;
}

function CurrencyFormModal({ item, onReload, onClose, onSaved }: FormProps) {
  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [symbol, setSymbol] = useState(item?.symbol ?? '');
  const [decimalPlaces, setDecimalPlaces] = useState(String(item?.decimalPlaces ?? 2));
  const [exchangeRate, setExchangeRate] = useState(String(item?.exchangeRate ?? 1.0));
  const [isBase, setIsBase] = useState(item?.isBase ?? false);
  const [status, setStatus] = useState<UserStatus>(item?.status ?? 'ACTIVE');
  const [err, setErr] = useState<UiError | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const validate = (): Record<string, string> => {
    const f: Record<string, string> = {};
    const c = code.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) {
      f.code = 'ISO Currency Code must be 3 capital letters (e.g. INR, USD).';
    }
    const n = name.trim();
    if (n.length < 2 || n.length > 60) f.name = 'Currency name must be 2–60 characters.';
    if (!symbol.trim()) f.symbol = 'Symbol is required.';
    const dec = Number(decimalPlaces);
    if (isNaN(dec) || dec < 0 || dec > 4) f.decimalPlaces = 'Decimals must be between 0 and 4.';
    const rate = Number(exchangeRate);
    if (isNaN(rate) || rate <= 0) f.exchangeRate = 'Exchange rate must be a positive number.';
    return f;
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (inFlight.current) return;
    const local = validate();
    if (Object.keys(local).length) {
      setErr({ message: '', fields: local, code: 'LOCAL' });
      return;
    }
    const input: CurrencyInput = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      symbol: symbol.trim(),
      decimalPlaces: Number(decimalPlaces),
      exchangeRate: isBase ? 1.0 : Number(exchangeRate),
      isBase,
      status,
    };
    inFlight.current = true;
    setPending(true);
    setErr(null);
    try {
      if (!item) {
        onSaved(await createCurrency(input));
        return;
      }
      const patch: Partial<CurrencyInput> = {};
      if (input.code !== item.code) patch.code = input.code;
      if (input.name !== item.name) patch.name = input.name;
      if (input.symbol !== item.symbol) patch.symbol = input.symbol;
      if (input.decimalPlaces !== item.decimalPlaces) patch.decimalPlaces = input.decimalPlaces;
      if (input.exchangeRate !== item.exchangeRate) patch.exchangeRate = input.exchangeRate;
      if (input.isBase !== item.isBase) patch.isBase = input.isBase;
      if (status !== item.status) patch.status = status;
      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }
      onSaved(await updateCurrency(item.id, item.version, patch));
    } catch (caught) {
      setErr(toUiError(caught));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const formId = item ? 'curr-edit-form' : 'curr-add-form';
  return (
    <Modal
      title={item ? `Edit Currency — ${item.code}` : 'Add Currency'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn primary" disabled={pending}>
            {pending ? 'Saving…' : item ? 'Save Changes' : 'Create Currency'}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={(e) => void onSubmit(e)} noValidate>
        {err?.message ? (
          <ErrorMessage
            onReload={
              err.code === 'VERSION_CONFLICT' && onReload ? () => void onReload() : undefined
            }
          >
            {err.message}
          </ErrorMessage>
        ) : null}
        <div className="form-grid">
          <Field
            label="ISO Code (3 Letters)"
            value={code}
            maxLength={3}
            autoComplete="off"
            error={err?.fields.code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <Field
            label="Currency Name"
            value={name}
            maxLength={60}
            autoComplete="off"
            error={err?.fields.name}
            onChange={(e) => setName(e.target.value)}
          />
          <Field
            label="Symbol"
            value={symbol}
            maxLength={5}
            autoComplete="off"
            error={err?.fields.symbol}
            onChange={(e) => setSymbol(e.target.value)}
          />
          <Field
            label="Decimal Places (0–4)"
            type="number"
            value={decimalPlaces}
            error={err?.fields.decimalPlaces}
            onChange={(e) => setDecimalPlaces(e.target.value)}
          />
          <Field
            label="Exchange Rate (vs Base)"
            type="number"
            step="0.0001"
            value={exchangeRate}
            disabled={isBase}
            error={err?.fields.exchangeRate}
            onChange={(e) => setExchangeRate(e.target.value)}
          />
          {item ? (
            <SelectField
              label="Status"
              value={status}
              error={err?.fields.status}
              onChange={(v) => setStatus(v as UserStatus)}
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </SelectField>
          ) : null}
          <div className="field" style={{ gridColumn: '1 / -1', marginTop: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isBase}
                disabled={item?.isBase}
                onChange={(e) => setIsBase(e.target.checked)}
              />
              Set as Base Currency (primary reporting currency)
            </label>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function CurrencyDeleteModal({
  item,
  onReload,
  onClose,
  onDone,
}: {
  item: Currency;
  onReload: () => Promise<void>;
  onClose: () => void;
  onDone: (message: string) => void;
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
      await deleteCurrency(item.id, item.version);
      onDone(`Currency ${item.code} deleted.`);
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
      title="Delete Currency"
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
      {error ? (
        <ErrorMessage
          onReload={error.code === 'VERSION_CONFLICT' ? () => void onReload() : undefined}
        >
          {error.message}
        </ErrorMessage>
      ) : null}
      <p className="confirm-text">
        Delete currency <strong>{item.name}</strong> ({item.code})? Currencies referenced in posted
        vouchers or price lists cannot be deleted.
      </p>
    </Modal>
  );
}
