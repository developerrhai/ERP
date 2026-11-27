// /m/wms-* : which desk draws each Warehouse / WMS page.
import type { ActionSet } from '../../types';
import { BarcodeDesk, TransferDesk, WarehouseDesk } from './RecordDesks';
import { ScreenDesk } from './ScreenDesk';
import { BinDesk, CountDesk, PutawayDesk } from './StockDesks';

type Desk = (props: { pageId: string; title: string; sub: string; actions: ActionSet }) => JSX.Element;

const DESKS: Record<string, Desk> = {
  'wms-warehouses': WarehouseDesk,
  'wms-zones': ScreenDesk,
  'wms-racks': ScreenDesk,
  'wms-shelves': ScreenDesk,
  'wms-bins': BinDesk,
  'wms-putaway': PutawayDesk,
  'wms-pick': ScreenDesk,
  'wms-packing': ScreenDesk,
  'wms-cycle': CountDesk,
  'wms-physical': CountDesk,
  'wms-transfer': TransferDesk,
  'wms-barcode': BarcodeDesk,
  'wms-rfid': ScreenDesk,
};

export const WMS_PAGES: ReadonlySet<string> = new Set(Object.keys(DESKS));

export function WmsPage(props: { pageId: string; title: string; sub: string; actions: ActionSet }) {
  const Page = DESKS[props.pageId];
  // keyed by page: nothing typed or ticked on one warehouse page is carried to the next
  return Page ? <Page key={props.pageId} {...props} /> : null;
}
