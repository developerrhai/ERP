// Prints how many records each seeded page holds per plant (read-only). Run: node tools/seed-local/counts.mjs
import * as L from './lib.mjs';
await L.login();
const paths = {
 'crm-sources':'/crm/sources','crm-leads':'/crm/leads','crm-opportunities':'/crm/opportunities','crm-followups':'/crm/followups','crm-meetings':'/crm/meetings','crm-feedback':'/crm/feedback',
 'sales-enquiries':'/sales/enquiries','customer rfq':'/sales/rfq','sales-quotations':'/sales/quotations','sales-orders':'/sales/orders','sales-dispatch':'/sales/dispatch','sales-invoices':'/sales/invoices','sales-collections(receipts)':'/sales/receipts','sales-returns':'/sales/returns','sales-pricelist':'/price-lists',
 'scm-pr':'/scm/pr','scm-rfq':'/scm/rfq','scm-vendorquote':'/scm/vendorquote','scm-comparison':'/scm/comparison','scm-po':'/scm/po','scm-grn':'/scm/grn','scm-purchaseinvoice':'/scm/purchaseinvoice','scm-contracts':'/scm/contracts','wms-putaway tasks':'/wms/putaway/tasks',
 'inv-opening':'/inventory/vouchers/opening','inv-transactions(vouchers)':'/inventory/vouchers/transactions','inv-adjustment':'/inventory/vouchers/adjustment','inv-transfer':'/inventory/vouchers/transfer','inv-reservation':'/inventory/reservations','holds':'/inventory/holds','inv-batch':'/inventory/batches','inv-serial':'/inventory/serials','counts (cycle/physical/reconciliation)':'/inventory/counts','wms-bins':'/inventory/bins',
};
const out = {};
for (const unit of ['TAL','SAW']) { await L.setUnit(unit); for (const [k,p] of Object.entries(paths)) { const r = await L.api('GET', p + (p.includes('?')?'&':'?') + 'size=100'); const n = r.meta?.total ?? (Array.isArray(r.data)?r.data.length:'?'); (out[k] ??= {})[unit]=r.ok? n : 'ERR '+r.status; } }
for (const p of ['wms-zones','wms-racks','wms-shelves','wms-rfid','wms-pick','wms-packing','wms-transfer']) { for (const unit of ['TAL','SAW']) { await L.setUnit(unit); const r = await L.screenRows(p); (out[p] ??= {})[unit]=r.length; } }
for (const [k,v] of Object.entries(out)) console.log(k.padEnd(42), 'TAL', String(v.TAL).padEnd(6), 'SAW', v.SAW);
await L.setUnit('TAL');
const ev = await L.api('GET','/scm/evaluation'); console.log('evaluation rows', Array.isArray(ev.data)?ev.data.length:JSON.stringify(ev.data).slice(0,100));
const cr = await L.api('GET','/sales/credit/overview'); console.log('credit overview', Array.isArray(cr.data)?cr.data.length:'?');
const dl = await L.api('GET','/sales/dispatch-list?date=2026-11-15'); console.log('delivery list', Array.isArray(dl.data)?dl.data.length:'?');
