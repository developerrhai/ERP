// The V40 tab layouts of the Inventory pages: for each page and each V40 tab, which columns it shows (labels exactly as V40 prints
// them, in V40's order) and which real dataset feeds them. The column set of a tab comes from the V40 renderer of that tab
// (docs/ui-audit/pages/<page>/data.json); the values come from datasets.ts (real tables only). A column without a real source
// is not listed here at all: the dataset returns null for it and the page prints a truthful dash.
export type Fmt =
  | 'text'
  | 'qty'
  | 'money'
  | 'date'
  | 'datetime'
  | 'days'
  | 'status'
  | 'allocate'
  | 'open';

export interface V40Col {
  key: string;
  label: string;
  format?: Fmt;
}

const col = (key: string, label: string, format: Fmt = 'text'): [string, V40Col] => [
  key,
  { key, label, format },
];

/** Every column any Inventory tab uses. Keys are unique; the same key means the same thing on every page. */
export const CATALOG: Readonly<Record<string, V40Col>> = Object.fromEntries([
  col('actions', 'Actions', 'open'),
  col('status', 'Status', 'status'),
  // the "allocation workspace" of V40 (Record / Demand / Available / Allocated / Short / Location / Action)
  col('w_record', 'Record'),
  col('w_demand', 'Demand', 'qty'),
  col('w_available', 'Available', 'qty'),
  col('w_allocated', 'Allocated', 'qty'),
  col('w_short', 'Short', 'qty'),
  col('w_location', 'Location'),
  col('w_action', 'Action', 'allocate'),
  // the "reference / due / amount" workspace
  col('p_reference', 'Reference'),
  col('p_due', 'Due', 'date'),
  col('p_amount', 'Amount', 'money'),
  col('p_allocated', 'Allocated', 'money'),
  col('p_balance', 'Balance', 'money'),
  col('p_action', 'Action', 'allocate'),
  // the "exception" workspace
  col('e_exception', 'Exception'),
  col('e_record', 'Record'),
  col('e_severity', 'Severity'),
  col('e_age', 'Age', 'days'),
  col('e_rootCause', 'Root Cause'),
  col('e_owner', 'Owner'),
  col('e_action', 'Action', 'open'),
  // the "validation" workspace
  col('v_rule', 'Validation Rule'),
  col('v_pass', 'Pass', 'qty'),
  col('v_warning', 'Warning', 'qty'),
  col('v_fail', 'Fail', 'qty'),
  col('v_action', 'Action', 'open'),
  // the "ledger book" workspace
  col('b_date', 'Date', 'date'),
  col('b_reference', 'Reference'),
  col('b_particulars', 'Particulars'),
  col('b_debit', 'Debit', 'money'),
  col('b_credit', 'Credit', 'money'),
  col('b_balance', 'Balance', 'money'),
  col('b_action', 'Action', 'open'),
  // items / stock
  col('itemCode', 'Item Code'),
  col('itemName', 'Item Name'),
  col('itemType', 'Item Type'),
  col('category', 'Category'),
  col('brand', 'Brand'),
  col('hsnSac', 'HSN SAC'),
  // product / raw material master
  col('productId', 'Product ID / SKU'),
  col('productName', 'Product Name'),
  col('uom', 'Unit of Measurement'),
  col('sellingPrice', 'Selling Price', 'money'),
  col('taxPct', 'Tax / GST %'),
  col('minimumStock', 'Minimum Stock', 'qty'),
  col('defaultBom', 'Default BOM'),
  col('defaultRouting', 'Default Routing'),
  col('partNumber', 'Part Number'),
  col('materialCode', 'Material Code'),
  col('materialName', 'Material Name'),
  col('unit', 'Unit'),
  col('currentStock', 'Current Stock', 'qty'),
  col('preferredVendor', 'Preferred Vendor'),
  col('standardCost', 'Standard Cost', 'money'),
  col('leadTimeDays', 'Lead Time Days', 'days'),
  col('projectNumber', 'Project Number'),
  col('baseUom', 'Base UOM'),
  col('warehouse', 'Warehouse'),
  col('batch', 'Batch Number'),
  col('stockValue', 'Stock Value', 'money'),
  col('onHand', 'On Hand', 'qty'),
  col('reserved', 'Reserved', 'qty'),
  col('availableCol', 'Available', 'qty'),
  // inventory transactions
  col('txnId', 'Transaction ID'),
  col('txnAt', 'Transaction Date Time', 'datetime'),
  col('txnType', 'Transaction Type'),
  col('refId', 'Reference ID'),
  col('parentRef', 'Parent Reference ID'),
  col('salesOrder', 'Sales Order'),
  // opening stock
  col('openingRef', 'Opening Ref'),
  col('financialYear', 'Financial Year'),
  col('item', 'Item'),
  col('batchSerial', 'Batch Serial'),
  col('openingQty', 'Opening Qty', 'qty'),
  col('unitCost', 'Unit Cost', 'money'),
  col('uploadBatch', 'Upload Batch'),
  col('validationStatus', 'Validation Status'),
  col('postingStatus', 'Posting Status'),
  // stock adjustment
  col('adjNo', 'Adjustment No'),
  col('date', 'Date', 'date'),
  col('systemQty', 'System Qty', 'qty'),
  col('countedQty', 'Counted Qty', 'qty'),
  col('varianceQty', 'Variance Qty', 'qty'),
  col('valueImpact', 'Value Impact', 'money'),
  col('reasonCode', 'Reason Code'),
  col('approver', 'Approver'),
  // stock transfer
  col('transferNo', 'Transfer No'),
  col('transferDate', 'Transfer Date', 'date'),
  col('sourceWarehouse', 'Source Warehouse'),
  col('destinationWarehouse', 'Destination Warehouse'),
  col('requestedQty', 'Requested Qty', 'qty'),
  col('dispatchedQty', 'Dispatched Qty', 'qty'),
  col('receivedQty', 'Received Qty', 'qty'),
  col('expectedReceipt', 'Expected Receipt', 'date'),
  col('customerId', 'Customer ID'),
  col('customerPo', 'Customer PO Number'),
  col('machineOrder', 'Manufacturing / Machine Order'),
  // reservation
  col('resNo', 'Reservation No'),
  col('demandType', 'Demand Type'),
  col('demandRef', 'Demand Ref'),
  col('requiredQty', 'Required Qty', 'qty'),
  col('reservedQty', 'Reserved Qty', 'qty'),
  col('availableQty', 'Available Qty', 'qty'),
  // reconciliation
  col('reconNo', 'Reconciliation No'),
  col('countRef', 'Count Ref'),
  col('physicalQty', 'Physical Qty', 'qty'),
  col('variance', 'Variance', 'qty'),
  col('valueVariance', 'Value Variance', 'money'),
  // ageing
  col('itemCodeAge', 'Item Code'),
  col('lastMovement', 'Last Movement', 'date'),
  col('ageDays', 'Age Days', 'days'),
  col('q030', '0 30 Qty', 'qty'),
  col('q3190', '31 90 Qty', 'qty'),
  col('q91180', '91 180 Qty', 'qty'),
  col('q180', '180 Plus Qty', 'qty'),
  // valuation
  col('valRef', 'Valuation Ref'),
  col('method', 'Method'),
  col('openingValue', 'Opening Value', 'money'),
  col('receiptValue', 'Receipt Value', 'money'),
  col('issueValue', 'Issue Value', 'money'),
  col('adjustmentValue', 'Adjustment Value', 'money'),
  col('closingValue', 'Closing Value', 'money'),
  col('closingQty', 'Closing Qty', 'qty'),
  // reorder
  col('adu', 'Avg Daily Usage', 'qty'),
  col('leadTime', 'Lead Time Days', 'days'),
  col('safetyStock', 'Safety Stock', 'qty'),
  col('reorderLevel', 'Reorder Level', 'qty'),
  col('suggestedQty', 'Suggested Qty', 'qty'),
  // batch
  col('batchNo', 'Batch No'),
  col('batchReceivedQty', 'Received Qty', 'qty'),
  col('batchAvailableQty', 'Available Qty', 'qty'),
  col('blockedQty', 'Blocked Qty', 'qty'),
  col('qcStatus', 'QC Status'),
  col('mfgDate', 'Mfg Date', 'date'),
  col('expiryDate', 'Expiry Date', 'date'),
  // serial
  col('serialNo', 'Serial No'),
  col('currentWarehouse', 'Current Warehouse'),
  col('currentOwner', 'Current Owner'),
  col('purchaseGrn', 'Purchase GRN'),
  col('salesInvoice', 'Sales Invoice'),
  col('warrantyEnd', 'Warranty End', 'date'),
  // expiry
  col('expBatch', 'Batch'),
  col('daysToExpiry', 'Days to Expiry', 'days'),
  col('expAvailableQty', 'Available Qty', 'qty'),
  col('expValue', 'Stock Value', 'money'),
]);

export const GROUPS: Readonly<Record<string, readonly string[]>> = {
  '@alloc': ['w_record', 'w_demand', 'w_available', 'w_allocated', 'w_short', 'w_location', 'w_action'],
  '@pay': ['p_reference', 'p_due', 'p_amount', 'p_allocated', 'p_balance', 'p_action'],
  '@exc': ['e_exception', 'e_record', 'e_severity', 'e_age', 'e_rootCause', 'e_owner', 'e_action'],
  '@val': ['v_rule', 'v_pass', 'v_warning', 'v_fail', 'v_action'],
  '@book': ['b_date', 'b_reference', 'b_particulars', 'b_debit', 'b_credit', 'b_balance', 'b_action'],
};

export type DatasetKey =
  | 'items'
  | 'itemMaster'
  | 'stockPair'
  | 'batchStock'
  | 'ledger'
  | 'voucher'
  | 'reservation'
  | 'countLine'
  | 'ageing'
  | 'valuation'
  | 'reorder'
  | 'batch'
  | 'serial'
  | 'expiry';

export interface TabSpec {
  dataset: DatasetKey;
  /** What narrows the dataset for this tab (e.g. Receipts, Low Stock, 0 to 30 Days); read by the dataset. */
  variant?: string;
  cols: readonly string[];
  /** Status values offered in the status filter of the tab. */
  statuses?: readonly string[];
}

export interface PageSpec {
  /** Used by every standard tab (Analytics & Graphs, Documents, Approvals, Reports, Audit Trail, Calendar & Schedule). */
  base: TabSpec;
  tabs: Readonly<Record<string, TabSpec>>;
  /** Voucher kind for the voucher dataset. */
  kind?: 'OPENING' | 'TRANSACTION' | 'ADJUSTMENT' | 'TRANSFER';
}

const T = (dataset: DatasetKey, cols: string[], variant?: string, statuses?: string[]): TabSpec => ({
  dataset,
  cols,
  ...(variant ? { variant } : {}),
  ...(statuses ? { statuses } : {}),
});

const STOCK_STATUS = ['OK', 'Below Reorder'];
const VOUCHER_STATUS = ['Draft', 'Pending Approval', 'Approved', 'Rejected', 'Posted', 'Cancelled'];
const TRANSFER_STATUS = ['Draft', 'Pending Approval', 'Approved', 'Dispatched', 'Received', 'Cancelled'];

const STOCK_REC = ['itemCode', 'itemName', 'itemType', 'warehouse', 'batch'];
const stockBase = T('stockPair', ['itemCode', 'itemName', 'itemType', 'warehouse', 'batch', 'onHand', 'reserved', 'status', 'actions'], undefined, STOCK_STATUS);

const TX_REC = ['txnId', 'txnAt', 'txnType', 'refId', 'parentRef', 'salesOrder', 'itemCode'];
const txBase = T('ledger', [...TX_REC, 'status', 'actions']);

const OPEN_REC = ['openingRef', 'financialYear', 'warehouse', 'item', 'batchSerial', 'openingQty', 'unitCost'];
const ADJ_REC = ['adjNo', 'date', 'warehouse', 'item', 'systemQty', 'countedQty', 'varianceQty'];
const XFER_REC = ['transferNo', 'transferDate', 'sourceWarehouse', 'destinationWarehouse', 'item', 'requestedQty', 'dispatchedQty'];
const RES_REC = ['resNo', 'demandType', 'demandRef', 'item', 'warehouse', 'batchSerial', 'requiredQty'];
const REC_REC = ['reconNo', 'countRef', 'warehouse', 'item', 'systemQty', 'physicalQty', 'variance'];
const AGE_REC = ['itemCode', 'itemName', 'warehouse', 'lastMovement', 'ageDays', 'q030', 'q3190'];
const VAL_REC = ['valRef', 'date', 'warehouse', 'item', 'method', 'openingValue', 'receiptValue'];
const ROP_REC = ['itemCode', 'itemName', 'warehouse', 'adu', 'leadTime', 'safetyStock', 'reorderLevel'];
const BATCH_REC = ['batchNo', 'item', 'warehouse', 'mfgDate', 'expiryDate', 'batchReceivedQty', 'batchAvailableQty'];
const SER_REC = ['serialNo', 'item', 'currentWarehouse', 'currentOwner', 'purchaseGrn', 'salesInvoice', 'warrantyEnd'];
const EXP_REC = ['item', 'expBatch', 'warehouse', 'expiryDate', 'daysToExpiry', 'expAvailableQty', 'expValue'];

export const PAGES: Readonly<Record<string, PageSpec>> = {
  // inv-items: tabs 0-5 are the item register itself (columns chosen in the web page); the rest use this base
  'inv-items': {
    base: T('items', ['itemCode', 'itemName', 'itemType', 'category', 'brand', 'hsnSac', 'baseUom', 'status', 'actions'], undefined, ['Active', 'Inactive']),
    tabs: {},
  },
  'master-products': {
    base: T('itemMaster', ['productId', 'productName', 'category', 'uom', 'sellingPrice', 'taxPct', 'minimumStock', 'status', 'actions'], undefined, ['Active', 'Inactive']),
    tabs: {
      'Product Register': T('itemMaster', ['productId', 'productName', 'category', 'uom', 'sellingPrice', 'taxPct', 'minimumStock', 'reorderLevel', 'defaultBom', 'defaultRouting', 'status', 'partNumber', 'actions'], undefined, ['Active', 'Inactive']),
      Planning: T('itemMaster', ['@alloc', 'productId', 'productName', 'category', 'uom', 'sellingPrice', 'taxPct', 'minimumStock', 'status', 'actions'], undefined, ['Active', 'Inactive']),
      'Price & Tax': T('itemMaster', ['productId', 'productName', 'category', 'uom', 'sellingPrice', 'taxPct', 'minimumStock', 'status', 'actions'], undefined, ['Active', 'Inactive']),
      'BOM Link': T('itemMaster', ['@alloc', 'productId', 'productName', 'category', 'uom', 'sellingPrice', 'taxPct', 'minimumStock', 'status', 'actions'], 'bom', ['Active', 'Inactive']),
      'Stock Policy': T('itemMaster', ['@alloc', 'productId', 'productName', 'minimumStock', 'status', 'category', 'uom', 'sellingPrice', 'actions'], undefined, ['Active', 'Inactive']),
      Controls: T('itemMaster', ['@alloc', 'productId', 'productName', 'category', 'uom', 'sellingPrice', 'taxPct', 'minimumStock', 'status', 'actions'], undefined, ['Active', 'Inactive']),
    },
  },
  'master-materials': {
    base: T('itemMaster', ['materialCode', 'materialName', 'category', 'unit', 'currentStock', 'minimumStock', 'reorderLevel', 'status', 'actions'], undefined, ['Active', 'Inactive']),
    tabs: {
      'Material Register': T('itemMaster', ['materialCode', 'materialName', 'category', 'unit', 'currentStock', 'minimumStock', 'reorderLevel', 'preferredVendor', 'standardCost', 'leadTimeDays', 'status', 'projectNumber', 'actions'], undefined, ['Active', 'Inactive']),
      'Stock Policy': T('itemMaster', ['@alloc', 'currentStock', 'minimumStock', 'status', 'materialCode', 'materialName', 'category', 'unit', 'actions'], undefined, ['Active', 'Inactive']),
      'Vendor Source': T('itemMaster', ['@alloc', 'preferredVendor', 'status', 'projectNumber', 'materialCode', 'materialName', 'category', 'unit', 'actions'], undefined, ['Active', 'Inactive']),
      'Tax & UOM': T('itemMaster', ['materialCode', 'materialName', 'category', 'unit', 'currentStock', 'minimumStock', 'reorderLevel', 'status', 'actions'], undefined, ['Active', 'Inactive']),
      Consumption: T('itemMaster', ['@alloc', 'materialCode', 'materialName', 'category', 'unit', 'currentStock', 'minimumStock', 'reorderLevel', 'status', 'actions'], undefined, ['Active', 'Inactive']),
      Controls: T('itemMaster', ['@alloc', 'materialCode', 'materialName', 'category', 'unit', 'currentStock', 'minimumStock', 'reorderLevel', 'status', 'actions'], undefined, ['Active', 'Inactive']),
    },
  },
  'inv-stock': {
    base: stockBase,
    tabs: {
      'Stock Overview': T('stockPair', ['@alloc', ...STOCK_REC, 'stockValue', 'status', 'actions'], undefined, STOCK_STATUS),
      'Warehouse Balance': T('stockPair', ['@pay', ...STOCK_REC, 'availableCol', 'stockValue', 'status', 'actions'], undefined, STOCK_STATUS),
      Reservations: T('stockPair', ['@alloc', ...STOCK_REC, 'onHand', 'reserved', 'status', 'actions'], undefined, STOCK_STATUS),
      'Low Stock': T('stockPair', ['@alloc', ...STOCK_REC, 'stockValue', 'status', 'actions'], 'low'),
      'Batch Traceability': T('batchStock', ['@alloc', ...STOCK_REC, 'stockValue', 'status', 'actions']),
      Audit: stockBase,
    },
  },
  'inv-transactions': {
    base: txBase,
    tabs: {
      'Movement Ledger': T('ledger', ['@alloc', ...TX_REC, 'status', 'actions']),
      Receipts: T('ledger', ['@pay', 'txnAt', 'status', ...['txnId', 'txnType', 'refId', 'parentRef', 'salesOrder'], 'actions'], 'receipts'),
      Issues: T('ledger', ['@exc', ...TX_REC, 'status', 'actions'], 'issues'),
      Transfers: T('ledger', ['@alloc', ...TX_REC, 'status', 'actions'], 'transfers'),
      'FG & Dispatch': T('ledger', [...TX_REC, 'status', 'actions'], 'fg'),
      Audit: txBase,
    },
  },
  'inv-opening': {
    kind: 'OPENING',
    base: T('voucher', [...OPEN_REC, 'status', 'actions'], undefined, VOUCHER_STATUS),
    tabs: {
      'Opening Stock Register': T('voucher', ['@alloc', 'warehouse', 'item', 'batchSerial', 'openingQty', 'uploadBatch', 'validationStatus', 'postingStatus', 'status', 'actions'], undefined, VOUCHER_STATUS),
      'Warehouse Upload': T('voucher', ['@alloc', 'warehouse', 'item', 'batchSerial', 'openingQty', 'uploadBatch', 'validationStatus', 'postingStatus', 'status', 'actions'], 'upload', VOUCHER_STATUS),
      'Batch Serial Opening': T('voucher', ['@alloc', 'warehouse', 'item', 'batchSerial', 'openingQty', 'uploadBatch', 'validationStatus', 'postingStatus', 'status', 'actions'], 'batchserial', VOUCHER_STATUS),
      'Valuation Basis': T('voucher', [...OPEN_REC, 'status', 'actions'], undefined, VOUCHER_STATUS),
      'Validation Errors': T('voucher', ['@val', ...OPEN_REC, 'status', 'actions'], 'errors', VOUCHER_STATUS),
      'Posting Summary': T('voucher', ['@book', ...OPEN_REC, 'status', 'actions'], 'posted', VOUCHER_STATUS),
    },
  },
  'inv-adjustment': {
    kind: 'ADJUSTMENT',
    base: T('voucher', [...ADJ_REC, 'status', 'actions'], undefined, VOUCHER_STATUS),
    tabs: {
      'Adjustment Register': T('voucher', [...ADJ_REC, 'unitCost', 'valueImpact', 'reasonCode', 'approver', 'status', 'actions'], undefined, VOUCHER_STATUS),
      'Count Variance': T('voucher', [...ADJ_REC, 'status', 'actions'], 'variance', VOUCHER_STATUS),
      'Reason Codes': T('voucher', ['@alloc', ...ADJ_REC, 'reasonCode', 'status', 'actions'], undefined, VOUCHER_STATUS),
      'Approval Control': T('voucher', [...ADJ_REC, 'approver', 'status', 'actions'], 'approval', VOUCHER_STATUS),
      'Value Impact': T('voucher', ['unitCost', 'valueImpact', 'adjNo', 'date', 'warehouse', 'item', 'systemQty', 'status', 'actions'], undefined, VOUCHER_STATUS),
      'Adjustment Audit': T('voucher', [...ADJ_REC, 'status', 'actions'], undefined, VOUCHER_STATUS),
    },
  },
  'inv-transfer': {
    kind: 'TRANSFER',
    base: T('voucher', [...XFER_REC, 'status', 'actions'], undefined, TRANSFER_STATUS),
    tabs: {
      'Transfer Orders': T('voucher', ['@alloc', 'transferDate', 'status', 'customerId', 'customerPo', 'salesOrder', 'machineOrder', 'transferNo', 'actions'], undefined, TRANSFER_STATUS),
      'Source Allocation': T('voucher', ['@alloc', 'sourceWarehouse', 'destinationWarehouse', 'item', 'requestedQty', 'dispatchedQty', 'receivedQty', 'status', 'actions'], undefined, TRANSFER_STATUS),
      'In Transit': T('voucher', [...XFER_REC, 'status', 'actions'], 'transit', TRANSFER_STATUS),
      'Destination Receipt': T('voucher', ['@pay', 'transferDate', 'expectedReceipt', 'status', 'transferNo', 'sourceWarehouse', 'destinationWarehouse', 'item', 'actions'], 'receipt', TRANSFER_STATUS),
      'Transfer Variance': T('voucher', [...XFER_REC, 'status', 'actions'], 'variance', TRANSFER_STATUS),
      'Transfer SLA': T('voucher', ['@alloc', ...XFER_REC, 'status', 'actions'], 'sla', TRANSFER_STATUS),
    },
  },
  'inv-reservation': {
    base: T('reservation', [...RES_REC, 'status', 'actions'], undefined, ['Waiting', 'Partial', 'Reserved', 'Fulfilled', 'Released', 'Expired']),
    tabs: {
      'Reservation Register': T('reservation', ['@alloc', ...RES_REC, 'status', 'actions']),
      'Demand Source': T('reservation', ['@alloc', ...RES_REC, 'status', 'actions']),
      'Allocation Priority': T('reservation', ['@alloc', 'item', 'warehouse', 'batchSerial', 'requiredQty', 'reservedQty', 'availableQty', 'status', 'actions'], 'priority'),
      'Shortage Handling': T('reservation', ['@alloc', ...RES_REC, 'status', 'actions'], 'short'),
      'Release Rules': T('reservation', [...RES_REC, 'status', 'actions']),
      'Reservation Ageing': T('reservation', ['@alloc', ...RES_REC, 'status', 'actions'], 'ageing'),
    },
  },
  'inv-reconciliation': {
    base: T('countLine', [...REC_REC, 'status', 'actions']),
    tabs: {
      'System vs Physical': T('countLine', ['@alloc', ...REC_REC, 'status', 'actions']),
      'Variance Lines': T('countLine', [...REC_REC, 'status', 'actions'], 'variance'),
      'Root Cause': T('countLine', [...REC_REC, 'status', 'actions'], 'variance'),
      'Approval Posting': T('countLine', [...REC_REC, 'status', 'actions'], 'approval'),
      'Value Impact': T('countLine', ['unitCost', 'valueVariance', 'reconNo', 'countRef', 'warehouse', 'item', 'systemQty', 'status', 'actions'], 'variance'),
      'Reconciliation History': T('countLine', ['@book', ...REC_REC, 'status', 'actions'], 'posted'),
    },
  },
  'inv-ageing': {
    base: T('ageing', [...AGE_REC, 'status', 'actions']),
    tabs: {
      'Ageing Summary': T('ageing', [...AGE_REC, 'status', 'actions']),
      '0 to 30 Days': T('ageing', ['@alloc', ...AGE_REC, 'status', 'actions'], 'b030'),
      '31 to 90 Days': T('ageing', ['@alloc', ...AGE_REC, 'status', 'actions'], 'b3190'),
      '91 to 180 Days': T('ageing', ['@alloc', ...AGE_REC, 'status', 'actions'], 'b91180'),
      '180 Plus Days': T('ageing', ['@alloc', ...AGE_REC, 'status', 'actions'], 'b180'),
      'Slow Dead Stock': T('ageing', ['@alloc', 'itemCode', 'itemName', 'warehouse', 'q030', 'q3190', 'q91180', 'q180', 'status', 'actions'], 'slow'),
    },
  },
  'inv-valuation': {
    base: T('valuation', [...VAL_REC, 'status', 'actions']),
    tabs: {
      'Valuation Summary': T('valuation', [...VAL_REC, 'status', 'actions']),
      'FIFO Layers': T('valuation', ['@alloc', ...VAL_REC, 'status', 'actions']),
      'Weighted Average': T('valuation', ['@alloc', ...VAL_REC, 'status', 'actions']),
      'Standard Cost': T('valuation', ['openingValue', 'receiptValue', 'issueValue', 'adjustmentValue', 'closingValue', 'valRef', 'date', 'status', 'actions']),
      Revaluation: T('valuation', [...VAL_REC, 'status', 'actions'], 'reval'),
      'Inventory GL Bridge': T('valuation', ['@alloc', 'warehouse', 'item', 'closingQty', 'valRef', 'date', 'method', 'openingValue', 'status', 'actions']),
    },
  },
  'inv-reorder': {
    base: T('reorder', [...ROP_REC, 'status', 'actions']),
    tabs: {
      'Reorder Dashboard': T('reorder', ['leadTime', 'reorderLevel', 'status', 'itemCode', 'itemName', 'warehouse', 'adu', 'actions']),
      'Min Max Policy': T('reorder', [...ROP_REC, 'status', 'actions']),
      'Safety Stock': T('reorder', ['@alloc', 'itemCode', 'itemName', 'warehouse', 'safetyStock', 'suggestedQty', 'status', 'adu', 'actions']),
      'EOQ & Lead Time': T('reorder', ['@alloc', 'leadTime', 'reorderLevel', 'status', 'itemCode', 'itemName', 'warehouse', 'adu', 'actions']),
      'Suggested PR': T('reorder', ['@alloc', ...ROP_REC, 'status', 'actions'], 'suggested'),
      'Forecast Accuracy': T('reorder', [...ROP_REC, 'status', 'actions']),
    },
  },
  'inv-batch': {
    base: T('batch', [...BATCH_REC, 'status', 'actions']),
    tabs: {
      'Batch Register': T('batch', ['@alloc', 'batchNo', 'item', 'warehouse', 'batchReceivedQty', 'batchAvailableQty', 'blockedQty', 'qcStatus', 'status', 'actions']),
      'Manufacturing Expiry': T('batch', ['item', 'batchReceivedQty', 'batchAvailableQty', 'blockedQty', 'qcStatus', 'status', 'batchNo', 'actions']),
      'Batch Stock': T('batch', ['@alloc', 'batchNo', 'item', 'warehouse', 'batchReceivedQty', 'batchAvailableQty', 'blockedQty', 'qcStatus', 'status', 'actions'], 'stock'),
      'Batch Movements': T('batch', ['@alloc', 'batchNo', 'item', 'warehouse', 'batchReceivedQty', 'batchAvailableQty', 'blockedQty', 'qcStatus', 'status', 'actions']),
      'Quality Status': T('batch', [...BATCH_REC, 'status', 'actions']),
      'Batch Recall': T('batch', ['batchNo', 'item', 'warehouse', 'batchReceivedQty', 'batchAvailableQty', 'blockedQty', 'qcStatus', 'status', 'actions']),
    },
  },
  'inv-serial': {
    base: T('serial', [...SER_REC, 'status', 'actions']),
    tabs: {
      'Serial Register': T('serial', ['@alloc', 'serialNo', 'item', 'currentWarehouse', 'status', 'currentOwner', 'purchaseGrn', 'salesInvoice', 'actions']),
      'Ownership History': T('serial', [...SER_REC, 'status', 'actions']),
      'Warranty Link': T('serial', [...SER_REC, 'status', 'actions']),
      'Serial Movements': T('serial', ['@alloc', 'serialNo', 'item', 'currentWarehouse', 'status', 'currentOwner', 'purchaseGrn', 'salesInvoice', 'actions']),
      'Service History': T('serial', [...SER_REC, 'status', 'actions']),
      'Serial Exceptions': T('serial', ['@alloc', 'serialNo', 'item', 'currentWarehouse', 'status', 'currentOwner', 'purchaseGrn', 'salesInvoice', 'actions'], 'exceptions'),
    },
  },
  'inv-expiry': {
    base: T('expiry', [...EXP_REC, 'status', 'actions']),
    tabs: {
      'Expiry Dashboard': T('expiry', [...EXP_REC, 'status', 'actions']),
      'Near Expiry': T('expiry', [...EXP_REC, 'status', 'actions'], 'near'),
      'Expired Stock': T('expiry', ['@alloc', 'item', 'expBatch', 'warehouse', 'expAvailableQty', 'expValue', 'status', 'expiryDate', 'actions'], 'expired'),
      'FEFO Allocation': T('expiry', ['@alloc', 'item', 'expBatch', 'warehouse', 'expAvailableQty', 'expValue', 'status', 'expiryDate', 'actions']),
      'Disposition Actions': T('expiry', [...EXP_REC, 'status', 'actions']),
      'Expiry Loss': T('expiry', [...EXP_REC, 'status', 'actions'], 'expired'),
    },
  },
};

/** The columns of a tab, groups expanded. An unknown key is a programming error and is dropped (tests cover every spec). */
export function resolveCols(spec: TabSpec): V40Col[] {
  const out: V40Col[] = [];
  for (const key of spec.cols) {
    for (const k of GROUPS[key] ?? [key]) {
      const c = CATALOG[k];
      if (c) out.push(c);
    }
  }
  return out;
}

/** V40 tab name -> its spec; the standard tabs (and any name this page does not list) get the base spec. */
export function specFor(pageId: string, tab: string): TabSpec | null {
  const page = PAGES[pageId];
  if (!page) return null;
  return page.tabs[tab] ?? page.base;
}
