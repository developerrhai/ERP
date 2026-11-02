// The schemas of the seven typed Inventory pages (docs/phase3-4 C1-C3): fields with their types,
// read-only / computed marks, enum options and lookups, the buttons (actions) with their confirm
// messages, list filters and totals. They answer GET /pages/:pageId/schema in the same shape as the
// generic engine (kind "typed"), so GenericModulePage renders them.
import type { FieldMeta, FieldType } from '../../engine/field-types';
import type { SchemaAction } from '../../engine/field-schema';

export const ITEM_TYPES = [
  'Raw Material',
  'Semi-Finished',
  'Finished Good',
  'Consumable',
  'Spare Part',
  'Packing Material',
  'Service',
];
export const UOMS = ['Nos', 'Set', 'Kg', 'Meter', 'Box', 'Litre', 'Pair', 'Sheet', 'Roll'];
export const TEMPERATURE_ZONES = ['Ambient', 'Cold', 'Frozen', 'Hazardous'];
export const REASON_CODES = ['Damage', 'Expiry', 'Count Correction', 'Theft/Loss', 'Other'];
export const TX_TYPES = ['Receipt', 'Issue'];

export const INVENTORY_PAGES = [
  'inv-items',
  'wms-warehouses',
  'inv-opening',
  'inv-transactions',
  'inv-adjustment',
  'inv-transfer',
  'inv-stock',
] as const;
export type InventoryPageId = (typeof INVENTORY_PAGES)[number];

export interface SchemaFilter {
  key: string;
  label: string;
  type: 'bool' | 'select';
  /** Query parameter name. */
  param: string;
  options?: string[];
  /** A select whose options come from a lookup. */
  lookup?: 'items' | 'warehouses';
}

export interface SchemaTotal {
  key: string;
  label: string;
  format: 'qty' | 'money';
}

export interface ViewColumn {
  key: string;
  label: string;
  format?: 'qty' | 'money' | 'date' | 'datetime' | 'text';
}

export interface SchemaView {
  key: string;
  label: string;
  /** Display columns for views that are not the voucher list (key = a key of the row `data`). */
  columns?: ViewColumn[];
}

export interface TypedSchema {
  pageId: InventoryPageId;
  title: string;
  family: string;
  purpose: string;
  kind: 'typed';
  /** True for pages that only list (Stock Balance). */
  readOnly: boolean;
  master: boolean;
  tabs: string[];
  fields: FieldMeta[];
  statuses: string[];
  editableStatuses: string[];
  transitions: Record<string, string[]>;
  actions: SchemaAction[];
  listColumns: string[];
  filters: SchemaFilter[];
  totals: SchemaTotal[];
  views: SchemaView[];
}

interface FieldOptions extends Partial<FieldMeta> {
  readOnly?: boolean;
}

const f = (key: string, label: string, type: FieldType, o: FieldOptions = {}): FieldMeta => ({
  key,
  label,
  type,
  required: false,
  readOnly: false,
  ...o,
});

const BIG = 99_999_999_999_999;
const money = (key: string, label: string, o: FieldOptions = {}) =>
  f(key, label, 'money', { min: 0, max: BIG, ...o });
const qty = (key: string, label: string, o: FieldOptions = {}) =>
  f(key, label, 'qty', { min: 0, max: BIG, ...o });
const text = (key: string, label: string, max = 200, o: FieldOptions = {}) =>
  f(key, label, 'text', { maxLength: max, ...o });
const select = (key: string, label: string, options: string[], o: FieldOptions = {}) =>
  f(key, label, 'enum', { options, ...o });
const date = (key: string, label: string, o: FieldOptions = {}) =>
  f(key, label, 'date', { pattern: '^\\d{4}-\\d{2}-\\d{2}$', ...o });
const item = (key = 'item', label = 'Item') =>
  f(key, label, 'ref', { required: true, refPage: 'inv-items', lookup: 'items' });
const warehouse = (key: string, label: string) =>
  f(key, label, 'ref', { required: true, refPage: 'wms-warehouses', lookup: 'warehouses' });
const statusField = (statuses: string[]) =>
  f('status', 'Status', 'status', { readOnly: true, options: statuses });

const action = (
  key: string,
  label: string,
  variant: string,
  confirm: string | null,
  allowedFrom: string[],
  requires: 'edit' | 'delete' = 'edit',
  requiresFrom?: string[],
): SchemaAction => ({
  key,
  label,
  variant,
  confirm,
  allowedFrom,
  requires,
  ...(requiresFrom ? { requiresFrom } : {}),
});

const POST: SchemaAction = action(
  'post',
  'Post',
  'primary',
  'Post {code}? Stock will change and the voucher will be locked.',
  ['Draft'],
);
const CANCEL_POSTED: SchemaAction = action(
  'cancel',
  'Cancel',
  'danger',
  'Cancel {code}? Reversing stock entries will be written.',
  ['Posted'],
  'delete',
);

const VOUCHER_STATUSES = ['Draft', 'Posted', 'Cancelled'];

type Overridable = 'readOnly' | 'master' | 'filters' | 'totals' | 'views' | 'transitions';

function define(
  def: Omit<TypedSchema, 'listColumns' | 'kind' | Overridable> &
    Partial<Pick<TypedSchema, Overridable>>,
): TypedSchema {
  return {
    readOnly: false,
    master: false,
    filters: [],
    totals: [],
    views: [],
    transitions: {},
    ...def,
    kind: 'typed',
    listColumns: def.fields.slice(0, 12).map((x) => x.key),
  };
}

const ITEMS = define({
  pageId: 'inv-items',
  title: 'Item / SKU Master',
  family: 'Inventory',
  purpose:
    'Products and materials: classification, units of measure, tax code, costs and reorder level.',
  master: true,
  tabs: [],
  statuses: ['Active', 'Inactive'],
  editableStatuses: ['Active', 'Inactive'],
  actions: [
    action(
      'deactivate',
      'Deactivate',
      'default',
      'Deactivate {code}? It can no longer be used in new vouchers.',
      ['Active'],
    ),
    action('activate', 'Activate', 'primary', null, ['Inactive']),
  ],
  fields: [
    f('itemCode', 'Item Code', 'code', { maxLength: 30, pattern: '^[A-Z0-9/_-]{2,30}$' }),
    text('itemName', 'Item Name', 150, { required: true, minLength: 2 }),
    select('itemType', 'Item Type', ITEM_TYPES, { required: true }),
    text('category', 'Category', 100),
    text('brand', 'Brand', 100),
    f('hsnSac', 'HSN SAC', 'hsn', { pattern: '^(\\d{4}|\\d{6}|\\d{8})$' }),
    select('baseUom', 'Base UOM', UOMS, { required: true }),
    select('altUom', 'Alt UOM', UOMS),
    qty('altUomFactor', 'Alt UOM Factor'),
    text('barcode', 'Barcode', 60),
    f('batchTracked', 'Batch Tracked', 'bool'),
    f('serialTracked', 'Serial Tracked', 'bool'),
    qty('shelfLifeDays', 'Shelf Life Days'),
    money('standardCost', 'Standard Cost'),
    money('sellingPrice', 'Selling Price'),
    qty('reorderLevel', 'Reorder Level'),
    statusField(['Active', 'Inactive']),
  ],
});

const WAREHOUSES = define({
  pageId: 'wms-warehouses',
  title: 'Warehouse Master',
  family: 'Warehouse / WMS',
  purpose: 'Stores and warehouses of each unit.',
  master: true,
  tabs: [],
  statuses: ['Active', 'Inactive'],
  editableStatuses: ['Active', 'Inactive'],
  actions: [
    action(
      'deactivate',
      'Deactivate',
      'default',
      'Deactivate {code}? It can no longer be used in new vouchers.',
      ['Active'],
    ),
    action('activate', 'Activate', 'primary', null, ['Inactive']),
  ],
  fields: [
    f('warehouseCode', 'Warehouse Code', 'code', {
      required: true,
      maxLength: 30,
      pattern: '^[A-Z0-9/_-]{2,30}$',
    }),
    text('warehouseName', 'Warehouse Name', 100, { required: true, minLength: 2 }),
    f('branch', 'Branch', 'ref', { readOnly: true, refPage: 'admin-branches' }),
    text('address', 'Address', 300),
    text('manager', 'Manager', 100),
    qty('totalCapacity', 'Total Capacity'),
    qty('dockDoors', 'Dock Doors'),
    text('operatingHours', 'Operating Hours', 100),
    select('temperatureZone', 'Temperature Zone', TEMPERATURE_ZONES),
    statusField(['Active', 'Inactive']),
  ],
});

const OPENING = define({
  pageId: 'inv-opening',
  title: 'Opening Stock',
  family: 'Inventory',
  purpose: 'Opening balance of an item in a warehouse, allowed before any other movement.',
  tabs: [],
  statuses: VOUCHER_STATUSES,
  editableStatuses: ['Draft'],
  actions: [POST, CANCEL_POSTED],
  fields: [
    f('openingRef', 'Opening Ref', 'code', { readOnly: true, required: true }),
    date('postingDate', 'Posting Date'),
    text('financialYear', 'Financial Year', 40, { readOnly: true }),
    warehouse('warehouse', 'Warehouse'),
    item(),
    text('batchSerial', 'Batch Serial', 100),
    qty('openingQty', 'Opening Qty', { required: true }),
    money('unitCost', 'Unit Cost', { required: true }),
    money('openingValue', 'Opening Value', { readOnly: true }),
    text('valuationMethod', 'Valuation Method', 40, { readOnly: true }),
    statusField(VOUCHER_STATUSES),
  ],
});

const TRANSACTIONS = define({
  pageId: 'inv-transactions',
  title: 'Inventory Transactions',
  family: 'Inventory',
  purpose: 'Manual material receipts and issues; the list shows the stock ledger.',
  tabs: [],
  statuses: VOUCHER_STATUSES,
  editableStatuses: ['Draft'],
  actions: [POST, CANCEL_POSTED],
  fields: [
    f('transactionNo', 'Transaction No', 'code', { readOnly: true, required: true }),
    date('postingDate', 'Posting Date'),
    select('transactionType', 'Transaction Type', TX_TYPES, { required: true }),
    text('reference', 'Reference', 100),
    item(),
    warehouse('warehouse', 'Warehouse'),
    text('batchSerial', 'Batch Serial', 100),
    qty('qty', 'Qty', { required: true }),
    money('unitCost', 'Unit Cost'),
    money('value', 'Value', { readOnly: true }),
    statusField(VOUCHER_STATUSES),
  ],
  views: [
    {
      key: 'ledger',
      label: 'Ledger',
      columns: [
        { key: 'postingDate', label: 'Date', format: 'date' },
        { key: 'voucherNo', label: 'Voucher No', format: 'text' },
        { key: 'voucherType', label: 'Type', format: 'text' },
        { key: 'item', label: 'Item', format: 'text' },
        { key: 'warehouse', label: 'Warehouse', format: 'text' },
        { key: 'qtyIn', label: 'In', format: 'qty' },
        { key: 'qtyOut', label: 'Out', format: 'qty' },
        { key: 'rate', label: 'Rate', format: 'money' },
        { key: 'value', label: 'Value', format: 'money' },
        { key: 'balanceQty', label: 'Balance Qty', format: 'qty' },
        { key: 'postedBy', label: 'Posted By', format: 'text' },
      ],
    },
    { key: 'vouchers', label: 'Vouchers' },
  ],
  filters: [
    {
      key: 'view',
      label: 'Show',
      type: 'select',
      param: 'view',
      options: ['ledger', 'vouchers'],
    },
  ],
});

const ADJUSTMENT = define({
  pageId: 'inv-adjustment',
  title: 'Stock Adjustment',
  family: 'Inventory',
  purpose: 'Correct the stock of an item in a warehouse to the counted quantity.',
  tabs: [],
  statuses: VOUCHER_STATUSES,
  editableStatuses: ['Draft'],
  actions: [POST, CANCEL_POSTED],
  fields: [
    f('adjustmentNo', 'Adjustment No', 'code', { readOnly: true, required: true }),
    date('postingDate', 'Posting Date'),
    warehouse('warehouse', 'Warehouse'),
    item(),
    qty('systemQty', 'System Qty', { readOnly: true }),
    qty('countedQty', 'Counted Qty', { required: true }),
    f('varianceQty', 'Variance Qty', 'qty', { readOnly: true, min: -BIG, max: BIG }),
    money('unitCost', 'Unit Cost', { readOnly: true }),
    f('valueImpact', 'Value Impact', 'money', { readOnly: true, min: -BIG, max: BIG }),
    select('reasonCode', 'Reason Code', REASON_CODES, { required: true }),
    text('approver', 'Approver', 100),
    statusField(VOUCHER_STATUSES),
  ],
});

const TRANSFER_STATUSES = ['Draft', 'Dispatched', 'Received', 'Cancelled'];
const TRANSFER = define({
  pageId: 'inv-transfer',
  title: 'Stock Transfer',
  family: 'Inventory',
  purpose: 'Move stock between warehouses, also across units, in two steps: dispatch and receive.',
  tabs: [],
  statuses: TRANSFER_STATUSES,
  editableStatuses: ['Draft'],
  actions: [
    action(
      'dispatch',
      'Dispatch',
      'primary',
      'Dispatch {code}? Stock leaves the source warehouse.',
      ['Draft'],
    ),
    action(
      'receive',
      'Receive',
      'primary',
      'Receive {code}? Stock is added to the destination warehouse.',
      ['Dispatched'],
    ),
    action(
      'cancel',
      'Cancel',
      'danger',
      'Cancel {code}? Dispatched stock is returned to the source.',
      ['Draft', 'Dispatched'],
      'delete',
      ['Dispatched'],
    ),
  ],
  fields: [
    f('transferNo', 'Transfer No', 'code', { readOnly: true, required: true }),
    date('postingDate', 'Transfer Date'),
    warehouse('sourceWarehouse', 'Source Warehouse'),
    warehouse('destinationWarehouse', 'Destination Warehouse'),
    item(),
    qty('requestedQty', 'Requested Qty', { required: true }),
    qty('dispatchedQty', 'Dispatched Qty', { readOnly: true }),
    qty('receivedQty', 'Received Qty', { readOnly: true }),
    qty('inTransit', 'In Transit', { readOnly: true }),
    text('vehicleRef', 'Vehicle Ref', 60),
    date('expectedReceipt', 'Expected Receipt'),
    statusField(TRANSFER_STATUSES),
  ],
});

const STOCK = define({
  pageId: 'inv-stock',
  title: 'Stock Balance',
  family: 'Inventory',
  purpose: 'Stock on hand per item and warehouse, valued at the moving average.',
  readOnly: true,
  tabs: [],
  statuses: ['OK', 'Below Reorder'],
  editableStatuses: [],
  actions: [],
  fields: [
    f('itemCode', 'Item Code', 'text', { readOnly: true }),
    f('itemName', 'Item Name', 'text', { readOnly: true }),
    f('unit', 'Unit', 'text', { readOnly: true }),
    f('warehouse', 'Warehouse', 'text', { readOnly: true }),
    f('uom', 'UOM', 'text', { readOnly: true }),
    qty('onHand', 'On Hand', { readOnly: true }),
    f('avgRate', 'Avg Rate', 'money', { readOnly: true, min: 0, max: BIG }),
    money('stockValue', 'Stock Value', { readOnly: true }),
    qty('reorderLevel', 'Reorder Level', { readOnly: true }),
    f('status', 'Status', 'text', { readOnly: true }),
  ],
  filters: [
    {
      key: 'warehouse',
      label: 'Warehouse',
      type: 'select',
      param: 'warehouseId',
      lookup: 'warehouses',
    },
    { key: 'belowReorder', label: 'Below reorder only', type: 'bool', param: 'belowReorder' },
  ],
  totals: [
    { key: 'onHand', label: 'On Hand', format: 'qty' },
    { key: 'stockValue', label: 'Stock Value', format: 'money' },
  ],
});

export const TYPED_SCHEMAS: Readonly<Record<InventoryPageId, TypedSchema>> = {
  'inv-items': ITEMS,
  'wms-warehouses': WAREHOUSES,
  'inv-opening': OPENING,
  'inv-transactions': TRANSACTIONS,
  'inv-adjustment': ADJUSTMENT,
  'inv-transfer': TRANSFER,
  'inv-stock': STOCK,
};

export function typedSchema(pageId: string): TypedSchema | null {
  return (TYPED_SCHEMAS as Record<string, TypedSchema | undefined>)[pageId] ?? null;
}
