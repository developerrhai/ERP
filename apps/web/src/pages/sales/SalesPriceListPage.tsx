// Sales Price Lists (sales-pricelist): the register of the price list master (apps/api masters/simple-masters.ts "price-lists")
// with its item rates, so Item Category, Base Price, Min Qty and Margin % are real figures. Create (header + item lines),
// View (cards + item grid), Edit (the header fields the master allows) and Delete are all on this page.
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { request } from '../../lib/api';
import { toUiMessage } from '../../lib/errors';
import { lookupItems, type Ref } from '../../lib/inventoryApi';
import { lookupCustomers, post } from '../../lib/scmApi';
import type { Option } from '../../lib/scmApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, ErrorBox, inr, PageHead } from '../finance/shared';
import { LookupCombo } from '../procurement/DocPage';
import { V40Register } from './V40Register';

interface PriceList {
  id: string;
  code: string;
  name: string;
  kind: string;
  currencyCode: string;
  customerId: string | null;
  priceIncludesTax: boolean;
  validFrom: string | null;
  validTo: string | null;
  isDefault: boolean;
  status: string;
  version: number;
}
interface PriceItem {
  id: string;
  itemCode: string;
  itemName: string;
  category: string | null;
  uomCode: string;
  minQty: string;
  rate: string;
  discountPct: string;
  standardCost: string | null;
}
interface Line {
  itemId: string;
  uomCode: string;
  minQty: string;
  rate: string;
  discountPct: string;
}
const emptyLine = (): Line => ({ itemId: '', uomCode: '', minQty: '0', rate: '', discountPct: '0' });
const day = (v: string | null): string => (v ? v.slice(0, 10) : '');

export function SalesPriceListPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const [form, setForm] = useState<{ list?: PriceList } | null>(null);
  const [view, setView] = useState<PriceList | null>(null);
  const [msg, setMsg] = useState('');
  const reload = (): void => setTick((n) => n + 1);

  async function open(id: string, then: (l: PriceList) => void): Promise<void> {
    setMsg('');
    try {
      then((await request<PriceList>(`/price-lists/${id}`)).data);
    } catch (e) {
      setMsg(toUiMessage(e));
    }
  }
  async function remove(id: string): Promise<void> {
    setMsg('');
    try {
      await request<unknown>(`/price-lists/${id}`, { method: 'DELETE' });
      toast('Price list deleted.');
      reload();
    } catch (e) {
      setMsg(toUiMessage(e));
    }
  }

  return (
    <>
      <PageHead title="Price Lists" sub="Selling rates by item, by customer or for everyone, with the dates they apply.">
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setForm({})}>
            ＋ New Price List
          </button>
        ) : null}
      </PageHead>
      <ErrorBox message={msg} />
      <V40Register
        pageId="sales-pricelist"
        actions={actions}
        reloadKey={tick}
        onChanged={reload}
        onOpen={(id) => void open(id, setView)}
        onEdit={actions.edit ? (id) => void open(id, (l) => setForm({ list: l })) : undefined}
        canEditRow={() => true}
        rowExtra={(r) =>
          actions.delete ? (
            <button type="button" className="btn sm danger" onClick={() => void remove(r.id)}>
              Delete
            </button>
          ) : null
        }
        fallback={<p className="v8-sub">Price lists are shown inside the V40 tab view.</p>}
      />
      {form ? (
        <PriceListForm
          list={form.list}
          onClose={() => setForm(null)}
          onSaved={(code) => {
            setForm(null);
            toast(`Price list ${code} saved.`);
            reload();
          }}
        />
      ) : null}
      {view ? <PriceListView list={view} onClose={() => setView(null)} /> : null}
    </>
  );
}

function PriceListView({ list: l, onClose }: { list: PriceList; onClose: () => void }) {
  const items = useLoad<PriceItem[]>(
    async () => (await request<PriceItem[]>(`/sales/price-lists/${l.id}/items`)).data,
    [l.id],
  );
  const card = (label: string, value: string) => (
    <div key={label}>
      <dt>{label}</dt>
      <dd>{value || '—'}</dd>
    </div>
  );
  return (
    <Modal
      title={`${l.code} · ${l.name}`}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <dl className="kv">
        {card('Price list code', l.code)}
        {card('Name', l.name)}
        {card('Type', l.kind)}
        {card('Currency', l.currencyCode)}
        {card('Valid from', l.validFrom ? dmy(day(l.validFrom)) : '')}
        {card('Valid to', l.validTo ? dmy(day(l.validTo)) : '')}
        {card('Price includes tax', l.priceIncludesTax ? 'Yes' : 'No')}
        {card('Default list', l.isDefault ? 'Yes' : 'No')}
        {card('Status', l.status)}
      </dl>
      <ErrorBox message={items.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Category</th>
              <th>UOM</th>
              <th style={{ textAlign: 'right' }}>Min qty</th>
              <th style={{ textAlign: 'right' }}>Rate</th>
              <th style={{ textAlign: 'right' }}>Disc %</th>
              <th style={{ textAlign: 'right' }}>Margin %</th>
            </tr>
          </thead>
          <tbody>
            {(items.data ?? []).map((i) => {
              const rate = Number(i.rate);
              const cost = Number(i.standardCost ?? 0);
              return (
                <tr key={i.id}>
                  <td>
                    {i.itemCode} · {i.itemName}
                  </td>
                  <td>{i.category ?? '—'}</td>
                  <td>{i.uomCode}</td>
                  <td style={{ textAlign: 'right' }}>{Number(i.minQty)}</td>
                  <td style={{ textAlign: 'right' }}>{inr(i.rate)}</td>
                  <td style={{ textAlign: 'right' }}>{Number(i.discountPct)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {rate > 0 && cost > 0 ? (((rate - cost) / rate) * 100).toFixed(1) : '—'}
                  </td>
                </tr>
              );
            })}
            {items.data && items.data.length === 0 ? (
              <tr>
                <td colSpan={7}>No items on this price list yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function PriceListForm({
  list,
  onClose,
  onSaved,
}: {
  list?: PriceList | undefined;
  onClose: () => void;
  onSaved: (code: string) => void;
}) {
  const edit = !!list;
  const [code, setCode] = useState(list?.code ?? '');
  const [name, setName] = useState(list?.name ?? '');
  const [kind, setKind] = useState(list?.kind ?? 'SELLING');
  const [currency, setCurrency] = useState(list?.currencyCode ?? 'INR');
  const [customerId, setCustomerId] = useState(list?.customerId ?? '');
  const [validFrom, setValidFrom] = useState(day(list?.validFrom ?? null));
  const [validTo, setValidTo] = useState(day(list?.validTo ?? null));
  const [inclTax, setInclTax] = useState(list?.priceIncludesTax ?? false);
  const [isDefault, setIsDefault] = useState(list?.isDefault ?? false);
  const [status, setStatus] = useState(list?.status ?? 'ACTIVE');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [err, setErr] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const setLine = (i: number, patch: Partial<Line>): void =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function save(): Promise<void> {
    setErr('');
    setFields({});
    if (name.trim().length < 2) return setFields({ name: 'Enter the price list name.' });
    if (!edit && !/^[A-Z0-9_/-]{2,30}$/.test(code))
      return setFields({ code: 'Use 2 to 30 capital letters, digits, dash or slash, for example PL-2026.' });
    if (validFrom && validTo && validTo < validFrom) return setFields({ validTo: 'Valid to cannot be before valid from.' });
    setBusy(true);
    try {
      if (edit && list) {
        await request<PriceList>(`/price-lists/${list.id}`, {
          method: 'PATCH',
          headers: { 'If-Match': `"${list.version}"` },
          body: {
            name: name.trim(),
            priceIncludesTax: inclTax,
            isDefault,
            status,
            validFrom: validFrom || null,
            validTo: validTo || null,
          },
        });
        onSaved(list.code);
      } else {
        const items = lines
          .filter((l) => l.itemId)
          .map((l) => ({
            itemId: l.itemId,
            uomCode: l.uomCode.trim() || 'NOS',
            minQty: Number(l.minQty) || 0,
            rate: l.rate,
            discountPct: Number(l.discountPct) || 0,
          }));
        if (items.some((i) => !(Number(i.rate) > 0))) {
          setBusy(false);
          return setErr('Enter a rate above 0 for every item line.');
        }
        await post('/price-lists', {
          code,
          name: name.trim(),
          kind,
          currencyCode: currency.toUpperCase(),
          ...(customerId ? { customerId } : {}),
          priceIncludesTax: inclTax,
          isDefault,
          status,
          ...(validFrom ? { validFrom } : {}),
          ...(validTo ? { validTo } : {}),
          ...(items.length ? { items } : {}),
        });
        onSaved(code);
      }
    } catch (e) {
      setErr(toUiMessage(e));
      setBusy(false);
    }
  }

  const field = (id: string, label: string, node: React.ReactNode, error?: string) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {node}
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
  return (
    <Modal
      title={edit ? `Edit ${list?.code}` : 'New Price List'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <ErrorBox message={err} />
      <div className="form-grid">
        {field('pl-code', 'Code *', <input id="pl-code" value={code} disabled={edit} onChange={(e) => setCode(e.target.value.toUpperCase())} />, fields.code)}
        {field('pl-name', 'Price List Name *', <input id="pl-name" value={name} onChange={(e) => setName(e.target.value)} />, fields.name)}
        {field(
          'pl-kind',
          'Type',
          <select id="pl-kind" value={kind} disabled={edit} onChange={(e) => setKind(e.target.value)}>
            <option value="SELLING">Selling</option>
            <option value="BUYING">Buying</option>
          </select>,
        )}
        {field('pl-cur', 'Currency', <input id="pl-cur" value={currency} disabled={edit} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />)}
        {!edit
          ? field(
              'pl-cust',
              'Customer (blank = everyone)',
              <LookupCombo<Option>
                id="pl-cust"
                value={customerId}
                search={lookupCustomers}
                label={(o) => o.label}
                onPick={(o) => setCustomerId(o?.id ?? '')}
              />,
            )
          : null}
        {field('pl-from', 'Valid from', <input id="pl-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />)}
        {field('pl-to', 'Valid to', <input id="pl-to" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />, fields.validTo)}
        {field(
          'pl-status',
          'Status',
          <select id="pl-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>,
        )}
        <label className="check">
          <input type="checkbox" checked={inclTax} onChange={(e) => setInclTax(e.target.checked)} /> Rates include tax
        </label>
        <label className="check">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> Default list
        </label>
      </div>
      {!edit ? (
        <>
          <h3>Items</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>UOM</th>
                  <th>Min qty</th>
                  <th>Rate</th>
                  <th>Disc %</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <LookupCombo<Ref>
                        id={`pl-item-${i}`}
                        value={l.itemId}
                        search={lookupItems}
                        label={(o) => `${o.code} · ${o.name}`}
                        onPick={(o) => setLine(i, { itemId: o?.id ?? '', ...(o?.uom ? { uomCode: o.uom } : {}) })}
                      />
                    </td>
                    <td>
                      <input aria-label="UOM" value={l.uomCode} onChange={(e) => setLine(i, { uomCode: e.target.value.toUpperCase() })} />
                    </td>
                    <td>
                      <input aria-label="Min qty" type="number" min={0} value={l.minQty} onChange={(e) => setLine(i, { minQty: e.target.value })} />
                    </td>
                    <td>
                      <input aria-label="Rate" type="number" min={0} step="any" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} />
                    </td>
                    <td>
                      <input aria-label="Discount %" type="number" min={0} max={100} value={l.discountPct} onChange={(e) => setLine(i, { discountPct: e.target.value })} />
                    </td>
                    <td>
                      <button type="button" className="btn sm danger" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_x, j) => j !== i))}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
            ＋ Add item
          </button>
        </>
      ) : (
        <p className="muted">The items of an existing price list are kept as they are; create a new list for a new rate card.</p>
      )}
    </Modal>
  );
}
