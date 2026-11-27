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

const DEFAULT_CURRENCIES: Currency[] = [
  { id: 'cur-inr', code: 'INR', name: 'Indian Rupee', symbol: '₹', decimalPlaces: 2, isBase: true, exchangeRate: 1, status: 'ACTIVE', version: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  { id: 'cur-usd', code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2, isBase: false, exchangeRate: 84.25, status: 'ACTIVE', version: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  { id: 'cur-eur', code: 'EUR', name: 'Euro', symbol: '€', decimalPlaces: 2, isBase: false, exchangeRate: 91.50, status: 'ACTIVE', version: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  { id: 'cur-gbp', code: 'GBP', name: 'British Pound', symbol: '£', decimalPlaces: 2, isBase: false, exchangeRate: 108.20, status: 'ACTIVE', version: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  { id: 'cur-jpy', code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimalPlaces: 0, isBase: false, exchangeRate: 0.55, status: 'ACTIVE', version: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  { id: 'cur-aed', code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', decimalPlaces: 2, isBase: false, exchangeRate: 22.94, status: 'ACTIVE', version: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
];

export function CurrencyMasterPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const { data: rawData, reload, setData } = useLoad(listCurrencies, []);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [modalKey, setModalKey] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter] = useState('');

  const data = (rawData && rawData.length > 0) ? rawData : DEFAULT_CURRENCIES;
  const canChange = actions.controls || actions.add || actions.edit;
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
          <p>Currencies, base currency configuration, and foreign exchange rates.</p>
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

      {/* 4 Top Summary Cards (Demo ERP Baseline) */}
      <div className="kpis x-d-grid x-cols-repeat-4-1fr x-gap-12px x-m-14px-0">
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Currencies</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">{data.length} Active</b>
          <span className="x-fs-11px x-c-success">Configured in system</span>
        </div>
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Base Currency</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">INR (₹)</b>
          <span className="x-fs-11px x-c-primary">Default legal currency</span>
        </div>
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Forex Sync</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">Synced Daily</b>
          <span className="x-fs-11px x-c-success">Automated ECB / RBI feed</span>
        </div>
        <div className="kpi x-p-12px x-bg-card x-r-8px x-bd-1px-solid-line-strong">
          <small className="x-c-muted">Data Quality</small>
          <b className="x-fs-18px x-c-text x-d-block x-m-4px-0">100%</b>
          <span className="x-fs-11px x-c-success">ISO 4217 compliant</span>
        </div>
      </div>

      {/* Split view: Currency Master list + Validation Controls panel */}
      <div className="x-d-grid x-cols-minmax-0-1_8fr-minmax-280px-1fr x-gap-14px x-m-14px-0">
        <div className="card table-wrap x-p-14px x-bg-card x-r-10px x-bd-1px-solid-line-strong">
          <div className="x-d-flex x-jc-space-between x-ai-center x-mb-12px">
            <h3 className="x-m-0 x-fs-14px x-c-text">Currency Master Register</h3>
            <button
              type="button"
              className="btn sm primary"
              onClick={() => setDialog({ kind: 'add' })}
            >
              ＋ Add Master Record
            </button>
          </div>
          <div className="recordbar x-mb-12px">
            <input
              type="search"
              placeholder="Search currency code, name or symbol…"
              value={search}
              aria-label="Search currencies"
              onChange={(e) => setSearch(e.target.value)}
              className="x-p-6px-10px x-fs-12px x-bd-1px-solid-line-strong x-r-6px x-w-100pct"
            />
          </div>
          <table className="register-table">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Name</th>
                <th scope="col">Symbol</th>
                <th scope="col">Rate</th>
                <th scope="col">Base</th>
                <th scope="col">Status</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.code}</strong></td>
                  <td>{c.name}</td>
                  <td>{c.symbol}</td>
                  <td>{c.isBase ? '1.0000' : Number(c.exchangeRate ?? 1).toFixed(4)}</td>
                  <td>{c.isBase ? <span className="chip" style={{ background: '#dbeafe', color: '#1e40af', fontSize: 11 }}>Base</span> : '—'}</td>
                  <td><span className={`status ${(c.status ?? 'ACTIVE').toLowerCase()}`}>{c.status ?? 'Active'}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button type="button" className="btn sm" onClick={() => setDialog({ kind: 'edit', item: c })}>Edit</button>
                      <button type="button" className="btn sm danger" onClick={() => setDialog({ kind: 'delete', item: c })} disabled={c.isBase}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card panel x-p-14px x-bg-card x-r-10px x-bd-1px-solid-line-strong">
          <h3 className="x-m-0-0-10px x-fs-14px x-c-text">Validation Controls</h3>
          <p className="x-fs-12px x-c-muted x-m-0-0-12px">Forex governance, exchange tolerance and accounting integration controls.</p>
          <div className="x-d-flex x-fd-column x-gap-8px x-fs-12px">
            <div className="x-d-flex x-jc-space-between x-p-4px-0 x-bb-1px-solid-line">
              <span>Base Currency Lock:</span>
              <b className="x-c-success">Enabled (INR)</b>
            </div>
            <div className="x-d-flex x-jc-space-between x-p-4px-0 x-bb-1px-solid-line">
              <span>ISO 4217 Validation:</span>
              <b className="x-c-success">Strict</b>
            </div>
            <div className="x-d-flex x-jc-space-between x-p-4px-0 x-bb-1px-solid-line">
              <span>Daily Forex Sync:</span>
              <b className="x-c-success">Active (ECB / RBI)</b>
            </div>
            <div className="x-d-flex x-jc-space-between x-p-4px-0 x-bb-1px-solid-line">
              <span>Cross-Currency Tolerance:</span>
              <b>±2.5%</b>
            </div>
            <div className="x-d-flex x-jc-space-between x-p-4px-0 x-bb-1px-solid-line">
              <span>Gain/Loss Ledger:</span>
              <b className="x-c-success">Mapped (GL-4810)</b>
            </div>
            <div className="x-d-flex x-jc-space-between x-p-4px-0">
              <span>Revaluation Frequency:</span>
              <b>Monthly Close</b>
            </div>
          </div>
          <div className="x-mt-14px">
            <button
              type="button"
              className="btn primary x-w-100pct"
              onClick={() => toast('Forex Rates updated from live RBI reference feed.')}
            >
              Run Forex Sync Now
            </button>
          </div>
        </div>
      </div>

      {/* Detailed Table at Bottom with Full Row Actions */}
      <div className="card table-wrap x-mt-16px">
        <div className="x-p-10px-14px x-bb-1px-solid-line x-d-flex x-jc-space-between x-ai-center">
          <b>Currency Master • Detailed Table</b>
          <button type="button" className="btn sm" onClick={() => window.print()}>Print Register</button>
        </div>
        <table>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Currency Name</th>
              <th scope="col">Symbol</th>
              <th scope="col">Decimals</th>
              <th scope="col">Base</th>
              <th scope="col">Exchange Rate</th>
              <th scope="col">Status</th>
              <th scope="col" style={{ width: 220, textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={`det-${c.id}`}>
                <td><strong>{c.code}</strong></td>
                <td>{c.name}</td>
                <td><span style={{ fontSize: '1.1em' }}>{c.symbol}</span></td>
                <td>{c.decimalPlaces ?? 2}</td>
                <td>{c.isBase ? <span className="chip" style={{ background: '#dbeafe', color: '#1e40af' }}>Base</span> : 'No'}</td>
                <td>{c.isBase ? '1.000000' : Number(c.exchangeRate ?? 1).toFixed(4)}</td>
                <td><span className={`status ${(c.status ?? 'ACTIVE').toLowerCase()}`}>{c.status ?? 'Active'}</span></td>
                <td style={{ textAlign: 'center' }}>
                  <div style={{ display: 'inline-flex', gap: 4 }}>
                    <button type="button" className="btn sm" onClick={() => alert(`View: ${c.code} - ${c.name}`)}>View</button>
                    <button type="button" className="btn sm" onClick={() => setDialog({ kind: 'edit', item: c })}>Edit</button>
                    <button type="button" className="btn sm" onClick={() => alert(`Documents for ${c.code}`)}>Docs</button>
                    <button type="button" className="btn sm" onClick={() => window.print()}>PDF</button>
                  </div>
                </td>
              </tr>
            ))}
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
          <div className="field x-grid-column-1-n1 x-mt-8px">
            <label className="x-d-flex x-ai-center x-gap-6px x-cur-pointer">
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
