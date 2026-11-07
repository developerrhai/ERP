// The four voucher pages are served by /inventory/vouchers/:kind (header + lines). The generic records API
// (/pages/inv-opening/records ...) still answers for them through this adapter so older clients, exports and the
// audit view keep working: list / get, and create with the OLD one-item form, which becomes a voucher with one line.
// Everything else (edit, delete, actions) goes through the new endpoints.
import { AppError, Errors } from '../../../core/http/errors';
import type { PageSchema } from '../../../engine/field-schema';
import { validateRecordInput } from '../../../engine/record-input';
import type { Caller } from '../../records/service';
import { TYPED_SCHEMAS } from '../definitions';
import type { InventoryPageId } from '../definitions';
import type { TypedHandler, TypedRecordDto } from '../typed';
import { kindOfPage, voucherService } from './voucher-service';
import type { HeaderInput, VoucherDto } from './voucher-service';

const toRecord = (v: VoucherDto): TypedRecordDto => {
  const first = v.lines[0];
  return {
    id: v.id,
    code: v.number,
    status: v.status,
    unitId: v.unitId,
    fyId: v.fyId,
    department: v.department,
    data: { ...v, status: v.status },
    version: v.version,
    amount: v.totalValue,
    createdAt: v.createdAt,
    createdBy: { id: v.createdBy, name: '' },
    updatedAt: v.createdAt,
    deletedAt: null,
    refs: {
      ...(first
        ? { item: { id: first.item.id, code: first.item.code, name: first.item.name } }
        : {}),
      ...(v.warehouse ? { warehouse: v.warehouse } : {}),
    },
  };
};

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** The old single-item form of each page -> header + one line. */
function fromLegacy(pageId: string, f: Record<string, unknown>): HeaderInput {
  const date = str(f.postingDate) ?? undefined;
  const batch = str(f.batchSerial);
  const common = { ...(date ? { postingDate: date } : {}) };
  const line = (qty: unknown, extra: Record<string, unknown> = {}) => ({
    itemId: str(f.item) ?? '',
    ...(typeof qty === 'number' ? { qty } : {}),
    ...(batch ? { batchNo: batch } : {}),
    ...extra,
  });
  switch (pageId) {
    case 'inv-opening':
      return {
        ...common,
        warehouseId: str(f.warehouse) ?? '',
        lines: [line(f.openingQty, { unitCost: f.unitCost as number })],
      };
    case 'inv-transactions': {
      const type =
        f.transactionType === 'Receipt'
          ? 'Receipt'
          : f.transactionType === 'Issue'
            ? 'Issue'
            : null;
      return {
        ...common,
        warehouseId: str(f.warehouse) ?? '',
        txType: type,
        reference: str(f.reference),
        lines: [line(f.qty, type === 'Receipt' ? { unitCost: f.unitCost as number } : {})],
      };
    }
    case 'inv-adjustment':
      return {
        ...common,
        warehouseId: str(f.warehouse) ?? '',
        lines: [
          {
            itemId: str(f.item) ?? '',
            countedQty: typeof f.countedQty === 'number' ? f.countedQty : null,
            reasonCode: str(f.reasonCode),
            ...(batch ? { batchNo: batch } : {}),
          },
        ],
      };
    default:
      return {
        ...common,
        warehouseId: str(f.sourceWarehouse) ?? '',
        toWarehouseId: str(f.destinationWarehouse),
        vehicleRef: str(f.vehicleRef),
        expectedReceipt: str(f.expectedReceipt),
        lines: [line(f.requestedQty)],
      };
  }
}

/** Field errors of the new header+lines form -> the keys of the old one-item form. */
function legacyFields(pageId: string, fields: Record<string, string>): Record<string, string> {
  const wh = pageId === 'inv-transfer' ? 'sourceWarehouse' : 'warehouse';
  const qtyKey =
    pageId === 'inv-opening' ? 'openingQty' : pageId === 'inv-transfer' ? 'requestedQty' : 'qty';
  const map: Record<string, string> = {
    warehouseId: wh,
    toWarehouseId: 'destinationWarehouse',
    txType: 'transactionType',
    'lines.0.itemId': 'item',
    'lines.0.qty': qtyKey,
    'lines.0.unitCost': 'unitCost',
    'lines.0.countedQty': 'countedQty',
    'lines.0.reasonCode': 'reasonCode',
    'lines.0.batchNo': 'batchSerial',
  };
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [map[k] ?? k, v]));
}

export function voucherTypedHandler(pageId: string): TypedHandler {
  const info = kindOfPage(pageId);
  if (!info) throw new Error(`No voucher kind for ${pageId}`);
  const readOnly = () => {
    throw Errors.readOnly('Use the Inventory voucher screen: /api/v1/inventory/vouchers.');
  };
  return {
    pageId,
    async list(caller: Caller, q) {
      const { rows, total } = await voucherService.list(caller, info, {
        ...(q.q ? { q: q.q } : {}),
        ...(q.status ? { status: q.status } : {}),
        page: q.page,
        size: q.size,
        deleted: q.deleted === true,
      });
      return { rows: rows.map(toRecord), total };
    },
    async get(caller, id) {
      return toRecord(await voucherService.get(caller, info, id));
    },
    async create(caller, input) {
      const schema = TYPED_SCHEMAS[pageId as InventoryPageId] as unknown as PageSchema;
      const v = validateRecordInput(schema, input, 'create');
      try {
        return toRecord(await voucherService.create(caller, info, fromLegacy(pageId, v.values)));
      } catch (e) {
        if (e instanceof AppError && e.code === 'VALIDATION_ERROR' && e.fields) {
          throw Errors.validation(legacyFields(pageId, e.fields));
        }
        throw e;
      }
    },
    update: readOnly,
    remove: readOnly,
    restore: readOnly,
    action: readOnly,
    exportRows(caller, q) {
      return this.list(caller, { ...q, page: 1, size: 10_000 });
    },
  };
}
