// apps/api/src/modules/inventory/contracts.ts
// Integration interfaces and gateways for Inventory & WMS (plan 02 §7.6).

import type { Db } from '../../core/db/prisma';
import { dec, type Dec } from './money';

export type LedgerVoucherType =
  | 'OPENING'
  | 'RECEIPT'
  | 'ISSUE'
  | 'ADJUSTMENT'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'REVALUATION';

export interface MovementInput {
  unitId: string;
  warehouseId: string;
  itemId: string;
  postingDate: string;
  voucherType: LedgerVoucherType;
  voucherId: string;
  voucherNo: string;
  createdById: string;
  qtyIn?: Dec;
  qtyOut?: Dec;
  rate?: Dec;
  value?: Dec;
  outValue?: Dec;
  outRate?: Dec;
  reversesId?: string;
  batchId?: string;
  batchSpec?: {
    batchNo: string;
    mfgDate?: string;
    expiryDate?: string;
    supplierName?: string;
    grnRef?: string;
  };
  serialNos?: string[];
  binId?: string;
  reservationId?: string;
  countId?: string;
  uom?: string;
  uomFactor?: Dec;
  actualRate?: Dec;
  reasonCode?: string;
  reference?: string;
  allowExpired?: boolean;
  allowBlocked?: boolean;
}

export interface PostedEntry {
  id: string;
  itemId: string;
  warehouseId: string;
  batchId?: string | null;
  binId?: string | null;
  postingDate: Date;
  voucherType: string;
  voucherId: string;
  voucherNo: string;
  qtyIn: Dec;
  qtyOut: Dec;
  rate: Dec;
  value: Dec;
  balanceQty: Dec;
  balanceValue: Dec;
}

export interface ReserveInput {
  demandType: string;
  demandRef: string;
  unitId: string;
  warehouseId: string;
  itemId: string;
  requiredQty: Dec;
  batchSerial?: string;
  priority?: string;
  reservedUntil?: string;
  createdById: string;
}

export interface ReservationResult {
  reservationId: string;
  status: 'Waiting' | 'Partial' | 'Reserved';
  reservedQty: Dec;
  allocatedBatches: { batchId: string; qty: Dec }[];
}

export interface Availability {
  onHand: Dec;
  reserved: Dec;
  blocked: Dec;
  available: Dec;
  batchOnHand?: Dec;
  batchReserved?: Dec;
  batchAvailable?: Dec;
}

export interface HoldInput {
  companyId: string;
  unitId: string;
  itemId: string;
  warehouseId: string;
  batchId?: string;
  qty: Dec;
  reason: string;
  createdById: string;
}

export interface LandedCostInput {
  voucherId: string;
  costs: { chargeType: string; amount: Dec }[];
  apportionMethod: 'VALUE' | 'QTY' | 'WEIGHT';
}

export interface AccountingLine {
  accountCode: string;
  debit: Dec;
  credit: Dec;
  narrative?: string;
}

export interface AccountingEventInput {
  companyId: string;
  event: string;
  docType: string;
  docId: string;
  docDate: Date | string;
  unitId?: string | null;
  lines: AccountingLine[];
  gstItcReversal?: boolean;
  reasonCode?: string;
}

export interface ReverseEventInput {
  companyId: string;
  event: string;
  docType: string;
  docId: string;
  docDate: Date | string;
  unitId?: string | null;
  reason?: string;
}

export interface StockServiceApi {
  postMovement(tx: Db, m: MovementInput): Promise<PostedEntry[]>;
  reserve(tx: Db, r: ReserveInput): Promise<ReservationResult>;
  release(tx: Db, reservationId: string, reason: string): Promise<void>;
  availability(tx: Db, itemId: string, warehouseId: string, batchId?: string): Promise<Availability>;
  hold(tx: Db, h: HoldInput): Promise<string>;
  releaseHold(tx: Db, holdId: string): Promise<void>;
  applyLandedCost(tx: Db, a: LandedCostInput): Promise<void>;
}

export interface AccountingServiceApi {
  post(tx: Db, e: AccountingEventInput): Promise<void>;
  reverse(tx: Db, e: ReverseEventInput): Promise<void>;
}

export interface GlBridge {
  inventoryBalance(tx: Db, q: { unitId: string; asOf: string; warehouseId?: string }): Promise<Dec | null>;
}

export interface OpenSupplyProvider {
  openPoQty(tx: Db, q: { itemId: string; warehouseId: string }): Promise<Dec>;
}

export interface PurchaseRequestGateway {
  createDraft(tx: Db, lines: { itemId: string; warehouseId: string; qty: Dec; vendor?: string }[]): Promise<{ prRef: string }>;
}

// Module-level provider registries with default implementations
let glBridge: GlBridge = {
  async inventoryBalance() {
    return null;
  },
};

let openSupplyProvider: OpenSupplyProvider = {
  async openPoQty() {
    return dec(0);
  },
};

let purchaseRequestGateway: PurchaseRequestGateway = {
  async createDraft() {
    throw new Error('PurchaseRequestGateway not registered');
  },
};

export function registerGlBridge(bridge: GlBridge): void {
  glBridge = bridge;
}

export function getGlBridge(): GlBridge {
  return glBridge;
}

export function registerOpenSupplyProvider(provider: OpenSupplyProvider): void {
  openSupplyProvider = provider;
}

export function getOpenSupplyProvider(): OpenSupplyProvider {
  return openSupplyProvider;
}

export function registerPurchaseRequestGateway(gateway: PurchaseRequestGateway): void {
  purchaseRequestGateway = gateway;
}

export function getPurchaseRequestGateway(): PurchaseRequestGateway {
  return purchaseRequestGateway;
}
