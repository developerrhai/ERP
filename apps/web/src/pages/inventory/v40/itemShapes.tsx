// The V40 tabs of Item / SKU Master and Stock Balance that are the page's own register: same rows, same search / filters / totals /
// selection / Move Forward / Edit buttons, but the columns V40 shows on that tab (plus the real fields that belong to it).
// The computed columns (Demand / Available / Allocated / Short / Location, valuation of reserved stock) come from the stock tables
// through the typed list (extra keys of each row's data), never from the browser.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { FieldMeta, PageSchema, RecordRow } from '../../generic/engineApi';
import { formatMoney } from '../../generic/fieldModel';
import { AllocateCell } from './V40Cell';

const calc = (key: string, label: string, type: FieldMeta['type'] = 'qty'): FieldMeta => ({
  key,
  label,
  type,
  required: false,
  readOnly: true,
});

// ---- Item / SKU Master ---------------------------------------------------------------------------

const ITEM_EXTRA: FieldMeta[] = [
  calc('stockRecord', 'Record', 'text'),
  calc('stockDemand', 'Demand'),
  calc('stockAvailable', 'Available'),
  calc('stockAllocated', 'Allocated'),
  calc('stockShort', 'Short'),
  calc('stockLocation', 'Location', 'text'),
  calc('stockAction', 'Action', 'text'),
];
const ITEM_ALLOC = ['stockRecord', 'stockDemand', 'stockAvailable', 'stockAllocated', 'stockShort', 'stockLocation', 'stockAction'];

/** V40 tab name -> the register columns (field keys) it shows. */
export const ITEM_TAB_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  'Item Master': ['itemCode', 'itemName', 'itemType', 'baseUom', 'altUom', 'category', 'brand', 'hsnSac', 'status'],
  'Classification & UOM': ['baseUom', 'altUom', 'altUomFactor', 'itemCode', 'itemName', 'itemType', 'category', 'brand', 'hsnSac', 'status'],
  'Tax & HSN': ['hsnSac', 'itemCode', 'itemName', 'itemType', 'category', 'brand', 'baseUom', 'status'],
  'Planning Parameters': [...ITEM_ALLOC, 'itemCode', 'itemName', 'itemType', 'category', 'brand', 'hsnSac', 'baseUom', 'reorderLevel', 'status'],
  'Traceability Setup': ['status', 'itemCode', 'itemName', 'itemType', 'category', 'brand', 'hsnSac', 'baseUom', 'batchTracked', 'serialTracked', 'qcRequired', 'shelfLifeDays'],
  'Cost & Price': ['standardCost', 'itemCode', 'itemName', 'itemType', 'category', 'brand', 'hsnSac', 'sellingPrice', 'status'],
};

// ---- Stock Balance -------------------------------------------------------------------------------

const STOCK_EXTRA: FieldMeta[] = [
  calc('itemType', 'Item Type', 'text'),
  calc('batch', 'Batch Number', 'text'),
  calc('reserved', 'Reserved'),
  calc('available', 'Available'),
  calc('stockRecord', 'Record', 'text'),
  calc('demand', 'Demand'),
  calc('allocated', 'Allocated'),
  calc('short', 'Short'),
  calc('location', 'Location', 'text'),
  calc('stockAction', 'Action', 'text'),
  calc('payReference', 'Reference', 'text'),
  calc('payDue', 'Due', 'text'),
  calc('payAmount', 'Amount', 'money'),
  calc('payAllocated', 'Allocated', 'money'),
  calc('payBalance', 'Balance', 'money'),
  calc('payAction', 'Action', 'text'),
];
const STOCK_ALLOC = ['stockRecord', 'demand', 'available', 'allocated', 'short', 'location', 'stockAction'];
const STOCK_PAY = ['payReference', 'payDue', 'payAmount', 'payAllocated', 'payBalance', 'payAction'];
const STOCK_REC = ['itemCode', 'itemName', 'itemType', 'warehouse', 'batch'];

export const STOCK_TAB_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  'Stock Overview': [...STOCK_ALLOC, ...STOCK_REC, 'stockValue', 'status', 'stockStatus'],
  'Warehouse Balance': [...STOCK_PAY, ...STOCK_REC, 'available', 'stockValue', 'status', 'stockStatus'],
  Reservations: [...STOCK_ALLOC, ...STOCK_REC, 'onHand', 'reserved', 'status'],
  'Low Stock': [...STOCK_ALLOC, ...STOCK_REC, 'stockValue', 'status', 'stockStatus'],
};

const COLUMNS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  'inv-items': ITEM_TAB_COLUMNS,
  'inv-stock': STOCK_TAB_COLUMNS,
};

/** Query filters a tab forces on the register (Low Stock = below reorder level). */
export function forcedTabFilters(pageId: string, tabName: string, index: number): Record<string, string> | undefined {
  if (pageId === 'inv-stock' && index === 3 && tabName === 'Low Stock') return { belowReorder: 'true' };
  return undefined;
}

export interface TabShape {
  schema: PageSchema;
  cellRender: (row: RecordRow, field: FieldMeta) => ReactNode | undefined;
  header: ReactNode;
}

/** The price simulator of Cost & Price: pure arithmetic on the four numbers typed in, nothing is saved. */
export function PriceSimulator() {
  const [base, setBase] = useState('');
  const [discount, setDiscount] = useState('');
  const [tax, setTax] = useState('');
  const [margin, setMargin] = useState('');
  const n = (v: string): number => (v.trim() === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));
  const net = n(base) * (1 - n(discount) / 100);
  const taxAmount = net * (n(tax) / 100);
  const target = n(margin) > 0 && n(margin) < 100 ? net / (1 - n(margin) / 100) : null;
  const field = (label: string, value: string, set: (v: string) => void) => (
    <label className="field">
      {label}
      <input type="number" inputMode="decimal" min="0" value={value} onChange={(e) => set(e.target.value)} />
    </label>
  );
  return (
    <section className="card inv-v40-sim" aria-label="Cost and price simulation">
      <div className="inv-v40-bar">
        {field('Base Amount', base, setBase)}
        {field('Discount %', discount, setDiscount)}
        {field('Tax %', tax, setTax)}
        {field('Target Margin %', margin, setMargin)}
      </div>
      <div className="inv-v40-totals" aria-live="polite">
        <span>
          <small>Net after discount</small>
          <b>{formatMoney(net)}</b>
        </span>
        <span>
          <small>Tax</small>
          <b>{formatMoney(taxAmount)}</b>
        </span>
        <span>
          <small>Total with tax</small>
          <b>{formatMoney(net + taxAmount)}</b>
        </span>
        <span>
          <small>Price for the target margin</small>
          <b>{target === null ? '—' : formatMoney(target)}</b>
        </span>
      </div>
    </section>
  );
}

const text = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);
const numOf = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

/** The register shape of a V40 tab of Item / SKU Master or Stock Balance; null for any other page or tab. */
export function tabShape(
  schema: PageSchema,
  tabName: string,
  index: number,
  canEdit: boolean,
  reload: () => void,
): TabShape | null {
  const cols = COLUMNS[schema.pageId]?.[tabName];
  if (!cols || index > 5) return null;
  const known = new Set(schema.fields.map((f) => f.key));
  const extras = (schema.pageId === 'inv-items' ? ITEM_EXTRA : STOCK_EXTRA).filter((f) => !known.has(f.key));
  const stock = schema.pageId === 'inv-stock';
  return {
    schema: { ...schema, fields: [...schema.fields, ...extras], listColumns: [...cols] },
    header: tabName === 'Cost & Price' ? <PriceSimulator /> : null,
    cellRender: (row, field) => {
      if (field.key === 'stockRecord') return stock ? text(row.data.itemCode, row.code) : row.code;
      if (field.key === 'stockAction' || field.key === 'payAction') {
        const [itemId, warehouseId] = stock ? row.id.split('_') : [row.id, undefined];
        if (!itemId) return '—';
        return <AllocateCell row={{ id: null, alloc: { itemId, warehouseId: warehouseId ?? null }, cells: {} }} canEdit={canEdit} onDone={reload} />;
      }
      if (!stock) return undefined;
      const d = row.data;
      const amount = numOf(d.stockValue);
      const reserved = numOf(d.reserved);
      const rate = numOf(d.avgRate);
      const allocated = reserved !== null && rate !== null ? Math.round(reserved * rate * 100) / 100 : null;
      switch (field.key) {
        case 'payReference':
          return `${text(d.itemCode, '')} / ${text(d.warehouse, '')}`;
        case 'payDue':
          return '—';
        case 'payAmount':
          return amount === null ? '—' : formatMoney(amount);
        case 'payAllocated':
          return allocated === null ? '—' : formatMoney(allocated);
        case 'payBalance':
          return amount === null || allocated === null ? '—' : formatMoney(Math.round((amount - allocated) * 100) / 100);
        default:
          return undefined;
      }
    },
  };
}
