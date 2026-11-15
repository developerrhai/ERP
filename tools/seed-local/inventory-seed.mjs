// Seeds demo Inventory + WMS data on the LOCAL ui database through the API only. Re-runnable: every record has a natural key
// (item name, voucher reference "SEED-...", bin / zone / rack / shelf code, tag EPC, ...) and is skipped when it exists.
// Run: node tools/seed-local/inventory-seed.mjs        (env SEED_API, default http://localhost:4100/api/v1)
import * as L from './lib.mjs';
const { api, list, ensure, act, d, ifm } = L;

await L.login(); await L.setUnit("TAL");
const itemsAll = async () => (await list('/pages/inv-items/records')).map((r) => ({ id: r.id, code: r.code, name: r.data.itemName, ...r.data }));
const wh = async () => Object.fromEntries((await api('GET', '/lookups/warehouses')).data.map((w) => [w.code, w.id]));

async function ensureItem(items, spec) {
  const ex = items.find((i) => i.name === spec.itemName);
  const r = await ensure(`item ${spec.itemName}`, ex, 'POST', '/pages/inv-items/records', { data: { status: 'Active', ...spec } });
  if (r && !ex) items.push({ id: r.id, code: r.code, name: spec.itemName, ...spec });
  return ex ?? (r ? items.at(-1) : null);
}

// voucher helper: create (skip when reference exists) -> submit -> post | dispatch | receive. An existing voucher that is
// stuck part-way (e.g. a stock shortage in an earlier run) is resumed: a step runs only when the status allows it.
const FROM = { submit: ['Draft'], post: ['Approved'], dispatch: ['Approved'], receive: ['Dispatched'] };
async function voucher(kind, ref, body, steps = ['submit', 'post']) {
  let v = (await list(`/inventory/vouchers/${kind}`, `&q=${encodeURIComponent(ref)}`)).find((x) => x.reference === ref);
  if (v) L.stats.skipped++;
  else { v = await ensure(`${kind} ${ref}`, null, 'POST', `/inventory/vouchers/${kind}`, { ...body, reference: ref }); if (!v) return null; }
  for (const s of steps) {
    const cur = (await api('GET', `/inventory/vouchers/${kind}/${v.id}`)).data;
    if (!FROM[s].includes(cur.status)) continue;
    const r = await act(`${kind} ${ref} ${s}`, 'POST', `/inventory/vouchers/${kind}/${v.id}/${s}`, undefined, ifm(cur.version));
    if (!r.ok) break;
    console.log(`    ${ref}: ${s} done`);
  }
  return v;
}

async function run() {
  const items = await itemsAll();
  const byName = (n) => items.find((i) => i.name === n);
  // extra tracked items (batch / serial) so Batches and Serials have something to show
  await ensureItem(items, { itemName: 'Servo Motor 750W (Serial Tracked)', itemType: 'Finished Good', baseUom: 'Nos', hsnSac: '340319', serialTracked: true, standardCost: 8200, sellingPrice: 10500, reorderLevel: 5 });
  await ensureItem(items, { itemName: 'BLDC Motor 2kW (Serial Tracked)', itemType: 'Finished Good', baseUom: 'Nos', hsnSac: '850110', serialTracked: true, standardCost: 14200, sellingPrice: 18200, reorderLevel: 3 });
  await ensureItem(items, { itemName: 'Epoxy Primer Red Oxide 20L (Batch Tracked)', itemType: 'Consumable', baseUom: 'Nos', hsnSac: '340319', batchTracked: true, shelfLifeDays: 365, standardCost: 3150, sellingPrice: 3900, reorderLevel: 10 });
  await ensureItem(items, { itemName: 'Hydraulic Oil ISO 68 210L (Batch Tracked)', itemType: 'Consumable', baseUom: 'Nos', hsnSac: '340319', batchTracked: true, shelfLifeDays: 730, standardCost: 21500, sellingPrice: 24800, reorderLevel: 4 });
  const W = await wh();
  const I = (n) => byName(n).id;


  await L.setUnit('TAL');
  const code = (c) => items.find((i) => i.code === c);
  const line = (c, qty, extra = {}) => ({ itemId: code(c).id, qty, unitCost: code(c).standardCost, ...extra });
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => 'ITM/' + String(a + i).padStart(5, '0'));
  const qtyFor = (i, base) => base + ((i * 37) % 11) * (base / 10);


  // stock ledger rows per item+warehouse: an opening voucher is only allowed for pairs with no movement yet
  const ledger = new Set();
  for (const r of await list('/pages/inv-transactions/records')) ledger.add(`${r.refs?.item?.code}|${r.refs?.warehouse?.code}`);
  const free = (whCode, codes) => codes.filter((c) => !ledger.has(`${c}|${whCode}`));
  const onHand = async (c, whCode) => (await api('GET', `/inventory/availability?itemId=${code(c).id}&warehouseId=${W[whCode]}`)).data?.onHand ?? 0;
  const adjLine = async (c, whCode, delta, reasonCode, remarks) => ({ itemId: code(c).id, countedQty: Math.max(0, (await onHand(c, whCode)) + delta), unitCost: code(c).standardCost, reasonCode, remarks });

  console.log('Opening stock');
  await voucher('opening', 'SEED-OPN2-TAL-RM', { postingDate: d(1), warehouseId: W['TAL-RM'], narration: 'Opening balance raw material store (migrated from Tally)', lines: free('TAL-RM', range(3, 15)).map((c, i) => line(c, Math.round(qtyFor(i, 800)))) });
  await voucher('opening', 'SEED-OPN2-TAL-MAIN', {
    postingDate: d(2), warehouseId: W['TAL-MAIN'], narration: 'Opening balance main store (consumables and batch items)',
    lines: [
      ...free('TAL-MAIN', range(46, 60)).map((c, i) => line(c, 60 + (i % 4) * 15)),
      { itemId: I('Epoxy Primer Red Oxide 20L (Batch Tracked)'), qty: 40, unitCost: 3150, batchNo: 'EPX-2610-A', mfgDate: '2026-10-05', expiryDate: '2027-10-04' },
      { itemId: I('Hydraulic Oil ISO 68 210L (Batch Tracked)'), qty: 12, unitCost: 21500, batchNo: 'HYD-2609-C', mfgDate: '2026-09-12', expiryDate: '2028-09-11' },
    ],
  });
  await voucher('opening', 'SEED-OPN-TAL-FG', {
    postingDate: d(1), warehouseId: W['TAL-FG'], narration: 'Opening balance finished goods store',
    lines: [
      ...free('TAL-FG', range(16, 20)).map((c, i) => line(c, 25 + i * 5)),
      { itemId: I('Servo Motor 750W (Serial Tracked)'), qty: 6, unitCost: 8200, serialNos: ['SM750-2611-001', 'SM750-2611-002', 'SM750-2611-003', 'SM750-2611-004', 'SM750-2611-005', 'SM750-2611-006'] },
      { itemId: I('BLDC Motor 2kW (Serial Tracked)'), qty: 4, unitCost: 14200, serialNos: ['BL2K-2611-101', 'BL2K-2611-102', 'BL2K-2611-103', 'BL2K-2611-104'] },
    ],
  });
  await voucher('opening', 'SEED-OPN-TAL-SP', { postingDate: d(2), warehouseId: W['TAL-SP'], narration: 'Opening balance spares store', lines: free('TAL-SP', range(31, 45)).map((c, i) => line(c, 20 + (i % 5) * 10)) });
  await voucher('opening', 'SEED-OPN-TAL-DRAFT', { postingDate: d(3), warehouseId: W['TAL-MAIN'], narration: 'Opening balance correction (draft, awaiting review)', lines: [line('ITM/00060', 40)] }, []);
  await voucher('opening', 'SEED-OPN-TAL-PEND', { postingDate: d(3), warehouseId: W['TAL-SP'], narration: 'Opening balance top-up submitted', lines: [line('ITM/00045', 30)] }, ['submit']);

  console.log('Receipts and issues');
  await voucher('transactions', 'SEED-TXN-R1', { postingDate: d(5), warehouseId: W['TAL-RM'], txType: 'Receipt', narration: 'Receipt of copper wire against supplier challan 4471', lines: [line('ITM/00005', 500), line('ITM/00006', 400)] });
  await voucher('transactions', 'SEED-TXN-R2', { postingDate: d(7), warehouseId: W['TAL-RM'], txType: 'Receipt', narration: 'Receipt of MS plates from Alfa Metals', lines: [line('ITM/00001', 1200), line('ITM/00002', 900)] });
  await voucher('transactions', 'SEED-TXN-R3', { postingDate: d(8), warehouseId: W['TAL-MAIN'], txType: 'Receipt', narration: 'Receipt of epoxy primer batch B', lines: [{ itemId: I('Epoxy Primer Red Oxide 20L (Batch Tracked)'), qty: 25, unitCost: 3180, batchNo: 'EPX-2611-B', mfgDate: '2026-11-03', expiryDate: '2027-11-02' }] });
  await voucher('transactions', 'SEED-TXN-I1', { postingDate: d(8), warehouseId: W['TAL-RM'], txType: 'Issue', narration: 'Issue to winding line for work order WO-1102', lines: [line('ITM/00005', 220), line('ITM/00008', 30), line('ITM/00010', 25)] });
  await voucher('transactions', 'SEED-TXN-I2', { postingDate: d(10), warehouseId: W['TAL-MAIN'], txType: 'Issue', narration: 'Packing material issued to dispatch', lines: [line('ITM/00059', 30), line('ITM/00058', 20), line('ITM/00060', 15)] });
  await voucher('transactions', 'SEED-TXN-I3', { postingDate: d(12), warehouseId: W['TAL-SP'], txType: 'Issue', narration: 'Spares issued to maintenance (draft)', lines: [line('ITM/00031', 4), line('ITM/00036', 2)] }, []);

  console.log('Adjustments');
  await voucher('adjustment', 'SEED-ADJ-1', { postingDate: d(9), warehouseId: W['TAL-RM'], reasonNote: 'Rust damage found during storage check', lines: [await adjLine('ITM/00001', 'TAL-RM', -35, 'Damage', 'Rusted plates scrapped'), await adjLine('ITM/00002', 'TAL-RM', -12, 'Damage')] });
  await voucher('adjustment', 'SEED-ADJ-2', { postingDate: d(11), warehouseId: W['TAL-MAIN'], reasonNote: 'Count correction after weekly check', lines: [await adjLine('ITM/00052', 'TAL-MAIN', 18, 'Count Correction'), await adjLine('ITM/00051', 'TAL-MAIN', -6, 'Count Correction')] });
  await voucher('adjustment', 'SEED-ADJ-3', { postingDate: d(13), warehouseId: W['TAL-SP'], reasonNote: 'Pending loss write-off', lines: [await adjLine('ITM/00033', 'TAL-SP', -3, 'Theft/Loss')] }, ['submit']);
  await voucher('adjustment', 'SEED-ADJ-4', { postingDate: d(14), warehouseId: W['TAL-SP'], reasonNote: 'Draft adjustment for expired seals', lines: [await adjLine('ITM/00033', 'TAL-SP', -2, 'Expiry')] }, []);

  console.log('Transfers');
  await voucher('transfer', 'SEED-TRF-1', { postingDate: d(6), warehouseId: W['TAL-MAIN'], toWarehouseId: W['TAL-RM'], expectedReceipt: d(7), narration: 'Wire and paper back to raw material store', lines: [line('ITM/00014', 40), line('ITM/00011', 60)] }, ['submit', 'dispatch', 'receive']);
  await voucher('transfer', 'SEED-TRF-2', { postingDate: d(9), warehouseId: W['TAL-FG'], toWarehouseId: W['TAL-MAIN'], expectedReceipt: d(16), narration: 'Finished motors staged to main store for dispatch', lines: [line('ITM/00016', 6), line('ITM/00017', 4)] }, ['submit', 'dispatch']);
  await voucher('transfer', 'SEED-TRF-3', { postingDate: d(12), warehouseId: W['TAL-SP'], toWarehouseId: W['TAL-MAIN'], expectedReceipt: d(17), narration: 'Bearings to main store', lines: [line('ITM/00031', 10), line('ITM/00032', 10)] }, ['submit']);
  await voucher('transfer', 'SEED-TRF-4', { postingDate: d(13), warehouseId: W['TAL-MAIN'], toWarehouseId: W['TAL-RM'], narration: 'Return of unused abrasives (draft)', lines: [line('ITM/00049', 20)] }, []);

  await wmsLocations(W, ['TAL-RM', 'TAL-FG', 'TAL-MAIN', 'TAL-SP']);
  await reservationsAndHolds(W, code);
  await countsStage(W, code);
  await pickPack(W, code);
  await sawardari(code);
}

if (process.argv[1]?.endsWith('inventory-seed.mjs')) {
  const pages = ['inv-opening', 'inv-transactions', 'inv-adjustment', 'inv-transfer', 'inv-reservation', 'wms-cycle', 'wms-physical', 'wms-pick', 'wms-packing', 'inv-items'];
  await L.withApprovalOff(pages, run);
  L.summary('inventory-seed');
}

// ======================================================================================================
// WMS: zones -> racks -> shelves -> bins -> rfid tags
// ======================================================================================================
async function wmsLocations(W, only) {
  console.log('WMS locations');
  const layout = {
    'TAL-RM': { zones: [['RM-A', 'Raw Material Bulk Storage', 'Storage', 'Heavy', 'Ambient'], ['RM-REC', 'Raw Material Receiving Bay', 'Receiving', 'General', 'Ambient']], racks: [['RM-A-R1', 'RM-A', 'A1', 'Cantilever', 3, 4000], ['RM-A-R2', 'RM-A', 'A2', 'Selective', 4, 2500], ['RM-REC-R1', 'RM-REC', 'R1', 'Pallet Flow', 2, 1500]] },
    'TAL-FG': { zones: [['FG-A', 'Finished Goods Storage', 'Storage', 'General', 'Ambient'], ['FG-DSP', 'Dispatch Staging', 'Dispatch', 'General', 'Ambient']], racks: [['FG-A-R1', 'FG-A', 'B1', 'Selective', 4, 1800], ['FG-A-R2', 'FG-A', 'B2', 'Selective', 4, 1800], ['FG-DSP-R1', 'FG-DSP', 'D1', 'Drive-in', 2, 3000]] },
    'TAL-MAIN': { zones: [['MN-A', 'Main Store Shelving', 'Storage', 'General', 'Ambient'], ['MN-QRN', 'Quarantine Cage', 'Quarantine', 'Restricted', 'Ambient']], racks: [['MN-A-R1', 'MN-A', 'C1', 'Selective', 5, 1200], ['MN-A-R2', 'MN-A', 'C2', 'Selective', 5, 1200], ['MN-QRN-R1', 'MN-QRN', 'Q1', 'Selective', 2, 800]] },
    'TAL-SP': { zones: [['SP-A', 'Spares Cabinet Area', 'Storage', 'Small Parts', 'Ambient']], racks: [['SP-A-R1', 'SP-A', 'S1', 'Selective', 5, 600], ['SP-A-R2', 'SP-A', 'S2', 'Selective', 5, 600]] },
  };
  const whIdOf = (c) => W[c];
  layout['SAW-MAIN'] = { zones: [['SW-A', 'Sawardari Main Storage', 'Storage', 'General', 'Ambient'], ['SW-DSP', 'Sawardari Dispatch Bay', 'Dispatch', 'General', 'Ambient']], racks: [['SW-A-R1', 'SW-A', 'W1', 'Selective', 4, 1500], ['SW-DSP-R1', 'SW-DSP', 'W2', 'Pallet Flow', 2, 2000]] };
  for (const [wc, cfg] of Object.entries(layout)) {
    if (only && !only.includes(wc)) continue;
    let zrows = await L.screenRows('wms-zones');
    for (const [zc, zn, zt, sc, temp] of cfg.zones) {
      if (zrows.find((r) => r.code === zc)) { L.stats.skipped++; continue; }
      await L.screenCreate(`zone ${zc}`, 'wms-zones', { warehouse: whIdOf(wc), code: zc, name: zn, type: zt, capacity: 5000, storageClass: sc, temperature: temp, putaway: 100, pickSeq: 100 });
    }
    zrows = await L.screenRows('wms-zones');
    let rrows = await L.screenRows('wms-racks');
    for (const [rc, zc, aisle, rt, lv, load] of cfg.racks) {
      if (rrows.find((r) => r.code === rc)) { L.stats.skipped++; continue; }
      const z = zrows.find((r) => r.code === zc); if (!z) continue;
      await L.screenCreate(`rack ${rc}`, 'wms-racks', { zone: z.id, code: rc, aisle, type: rt, levels: lv, maxLoad: load });
    }
    rrows = await L.screenRows('wms-racks');
    let srows = await L.screenRows('wms-shelves');
    const binRows = await list('/inventory/bins', `&warehouseId=${whIdOf(wc)}`);
    for (const [rc] of cfg.racks) {
      const rk = rrows.find((r) => r.code === rc); if (!rk) continue;
      for (const lvl of [1, 2]) {
        const sc = `${rc}-L${lvl}`;
        let sh = srows.find((r) => r.code === sc);
        if (!sh) { await L.screenCreate(`shelf ${sc}`, 'wms-shelves', { rack: rk.id, code: sc, level: lvl, dimensions: '1200 x 600 x 450 mm', maxWeight: 400 - lvl * 50, rule: lvl === 1 ? 'Heavy items only' : 'Mixed small items' }); srows = await L.screenRows('wms-shelves'); sh = srows.find((r) => r.code === sc); } else L.stats.skipped++;
        if (!sh) continue;
        for (const n of [1, 2]) {
          const bc = `${sc}-B${n}`;
          let bin = binRows.find((b) => b.code === bc);
          if (!bin) { bin = await ensure(`bin ${bc}`, null, 'POST', '/inventory/bins', { warehouseId: whIdOf(wc), code: bc, name: `Bin ${bc}`, zone: rc.split('-').slice(0, 2).join('-'), binType: rk.zone?.includes?.('Quarantine') ? 'Quarantine' : n === 2 && lvl === 1 ? 'Pick Face' : 'Storage', capacity: 200 }); if (bin) binRows.push(bin); } else L.stats.skipped++;
          // (GET /screens/wms-shelves/:id/bins answers 404 "Unknown page", so the shelf row's bin count is the idempotency check)
          if (bin && Number(sh.bins ?? 0) < 2) {
            const r = await act(`place ${bc}`, 'POST', `/screens/wms-shelves/${sh.id}/bins`, { binId: bin.id });
            if (r.ok) { L.stats.created++; console.log(`  + place ${bc} on ${sc}`); }
          } else if (bin) L.stats.skipped++;
        }
      }
    }
    // rfid tags on the first bins of the warehouse
    const tags = await L.screenRows('wms-rfid');
    const bins = (await list('/inventory/bins', `&warehouseId=${whIdOf(wc)}`)).slice(0, 3);
    let k = 0;
    for (const b of bins) {
      k++; const epc = `E2000${wc.replace('TAL-', '')}${String(k).padStart(4, '0')}${b.code.replace(/\W/g, '').slice(-6)}`.toUpperCase();
      if (tags.find((t) => t.tag === epc || t.epc === epc || Object.values(t).includes(epc))) { L.stats.skipped++; continue; }
      await L.screenCreate(`rfid ${epc}`, 'wms-rfid', { warehouse: whIdOf(wc), bin: b.id, tag: epc, type: k % 2 ? 'RFID' : 'BARCODE', status: k === 3 ? 'Lost' : 'Active' });
    }
  }
}

// ======================================================================================================
// Reservations and holds
// ======================================================================================================
async function reservationsAndHolds(W, code) {
  console.log('Reservations and holds');
  const existing = await list('/inventory/reservations');
  const mk = async (ref, c, wc, qty, priority, until, demandType = 'Sales Order') => {
    let r = existing.find((x) => x.demandRef === ref);
    if (r) { L.stats.skipped++; return r; }
    r = await ensure(`reservation ${ref}`, null, 'POST', '/inventory/reservations', { itemId: code(c).id, warehouseId: W[wc], requiredQty: qty, priority, reservedUntil: until, demandType, demandRef: ref });
    return r;
  };
  await mk('SEED-RSV-01 SO Asha Steel', 'ITM/00016', 'TAL-FG', 8, 'High', d(25));
  await mk('SEED-RSV-02 SO Deccan Auto', 'ITM/00017', 'TAL-FG', 6, 'Critical', d(22));
  await mk('SEED-RSV-03 WO winding line', 'ITM/00005', 'TAL-RM', 150, 'Medium', d(28), 'Work Order');
  await mk('SEED-RSV-04 SO Kiran Hydraulics', 'ITM/00018', 'TAL-FG', 10, 'Medium', d(30));
  const toRelease = await mk('SEED-RSV-05 SO cancelled by customer', 'ITM/00019', 'TAL-FG', 5, 'Low', d(20));
  const toExtend = await mk('SEED-RSV-06 Maintenance shutdown', 'ITM/00036', 'TAL-SP', 4, 'High', d(18), 'Maintenance');
  const fresh = async (q, id) => (await api('GET', `/inventory/reservations?q=${encodeURIComponent(q)}`)).data?.find((x) => x.id === id);
  if (toRelease?.id) { const cur = await fresh('SEED-RSV-05', toRelease.id); if (cur && !['Released', 'Cancelled'].includes(cur.status)) await act('release RSV-05', 'POST', `/inventory/reservations/${cur.id}/release`, { reason: 'Customer cancelled the order' }, ifm(cur.version)); }
  if (toExtend?.id) { const cur = await fresh('SEED-RSV-06', toExtend.id); if (cur && !['Released', 'Cancelled'].includes(cur.status) && cur.reservedUntil <= d(18)) await act('extend RSV-06', 'POST', `/inventory/reservations/${cur.id}/extend`, { days: 7 }, ifm(cur.version)); }
  const holds = await list('/inventory/holds');
  for (const [reason, c, wc, qty] of [['SEED-HOLD quality query on supplier lot', 'ITM/00001', 'TAL-RM', 120], ['SEED-HOLD pending customer drawing approval', 'ITM/00020', 'TAL-FG', 4], ['SEED-HOLD suspected moisture damage', 'ITM/00010', 'TAL-MAIN', 25]]) {
    if (holds.find((h) => h.reason === reason)) { L.stats.skipped++; continue; }
    await ensure(`hold ${reason}`, null, 'POST', '/inventory/holds', { itemId: code(c).id, warehouseId: W[wc], qty, reason });
  }
}

// ======================================================================================================
// Cycle counts and physical verification (posting a count writes the reconciliation adjustment voucher)
// ======================================================================================================
async function countsStage(W, code) {
  console.log('Counts');
  const counts = await list('/inventory/counts');
  const plan = [
    { name: 'cycle spares (posted)', upTo: 'post', delta: [-2, 0, 1, 0], body: { countType: 'CYCLE', warehouseId: W['TAL-SP'], plannedDate: d(10), itemIds: ['ITM/00031', 'ITM/00032', 'ITM/00033', 'ITM/00034'].map((c) => code(c).id), frequency: 'Monthly', blind: false, freezeWarehouse: false, tolerancePct: 2 } },
    { name: 'cycle main store (counting)', upTo: 'start', delta: [0, -3, 0], body: { countType: 'CYCLE', warehouseId: W['TAL-MAIN'], plannedDate: d(12), itemIds: ['ITM/00046', 'ITM/00047', 'ITM/00048'].map((c) => code(c).id), frequency: 'Weekly', blind: true, freezeWarehouse: false, tolerancePct: 5 } },
    { name: 'cycle raw material (review)', upTo: 'review', delta: [5, 0, -8], body: { countType: 'CYCLE', warehouseId: W['TAL-RM'], plannedDate: d(13), itemIds: ['ITM/00003', 'ITM/00004', 'ITM/00007'].map((c) => code(c).id), frequency: 'Monthly', blind: false, freezeWarehouse: false, tolerancePct: 1 } },
    { name: 'cycle finished goods (planned)', upTo: 'created', body: { countType: 'CYCLE', warehouseId: W['TAL-FG'], plannedDate: d(14), itemIds: ['ITM/00016', 'ITM/00017'].map((c) => code(c).id), frequency: 'Weekly', blind: false, freezeWarehouse: false, tolerancePct: 0 } },
    { name: 'physical verification spares (planned)', upTo: 'created', body: { countType: 'PHYSICAL', warehouseId: W['TAL-SP'], plannedDate: d(15), blind: true, freezeWarehouse: false, tolerancePct: 0 } },
  ];
  for (const p of plan) {
    let c = counts.find((x) => x.countType === p.body.countType && x.warehouseId === p.body.warehouseId && String(x.plannedDate).slice(0, 10) === p.body.plannedDate);
    if (c) L.stats.skipped++; else c = await ensure(`count ${p.name}`, null, 'POST', '/inventory/counts', p.body);
    if (!c?.id || p.upTo === 'created') continue;
    const get = async () => (await api('GET', `/inventory/counts/${c.id}`)).data;
    const step = async (verb, body) => { const cur = await get(); const r = await act(`count ${p.name} ${verb}`, 'POST', `/inventory/counts/${c.id}/${verb}`, body, ifm(cur.version)); if (r.ok) console.log(`    ${p.name}: ${verb}`); return r.ok; };
    let cur = await get();
    if (cur.status === 'Planned') { if (!(await step('start'))) continue; cur = await get(); }
    if (cur.status === 'Counting') {
      for (const [i, ln] of (cur.lines ?? []).entries()) {
        if (ln.status && ln.status !== 'Open') continue;
        const sys = Number(ln.systemQty ?? (await onHandOf(ln.itemId, p.body.warehouseId)));
        await act(`count line ${i}`, 'POST', `/inventory/counts/${c.id}/lines/${ln.id}/count`, { qty: Math.max(0, sys + (p.delta?.[i] ?? 0)), remarks: (p.delta?.[i] ?? 0) !== 0 ? 'Variance found on recount' : undefined }, ifm((await get()).version));
      }
    }
    // lines outside tolerance need a second count by a different person
    cur = await get();
    const recount = (cur.lines ?? []).filter((l) => l.status === 'Recount');
    if (recount.length && p.upTo !== 'start') await L.withUser('head.warehouse', async () => { for (const ln of recount) await act('recount line', 'POST', `/inventory/counts/${c.id}/lines/${ln.id}/count`, { qty: Number(ln.count1Qty), remarks: 'Recounted and confirmed' }, ifm((await get()).version)); });
    if (p.upTo === 'start') continue;
    cur = await get(); if (cur.status === 'Counting') await step('review');
    if (p.upTo === 'review') continue;
    cur = await get(); if (cur.status === 'Under Review') await L.withUser('head.warehouse', () => step('approve'));
    cur = await get(); if (cur.status === 'Approved') await step('post', {});
  }
}

// ======================================================================================================
// Pick waves and packing (WMS)
// ======================================================================================================
async function pickPack(W, code) {
  console.log('Pick waves and packing');
  const waves = await L.screenRows('wms-pick');
  // stable natural keys: the order numbers of the original demo orders (the Sales Order column of the wave)
  const sos = ['SO/TAL/26-27/0006', 'SO/TAL/26-27/0005', 'SO/TAL/26-27/0004', 'SO/TAL/26-27/0003', 'SO/TAL/26-27/0002'].map((number) => ({ number }));
  const binsOf = async (wc) => list('/inventory/bins', `&warehouseId=${W[wc]}`);
  const fgBins = await binsOf('TAL-FG'); const mnBins = await binsOf('TAL-MAIN');
  const plan = [
    ['TAL-FG', d(10), 'Released', [['ITM/00016', 6, fgBins[0]], ['ITM/00017', 4, fgBins[1]]]],
    ['TAL-FG', d(11), 'Released', [['ITM/00018', 8, fgBins[2]]]],
    ['TAL-FG', d(13), 'Draft', [['ITM/00019', 5, fgBins[3]], ['ITM/00020', 3, fgBins[0]]]],
    ['TAL-MAIN', d(12), 'Draft', [['ITM/00021', 10, mnBins[0]], ['ITM/00022', 6, mnBins[1]]]],
    ['TAL-FG', d(9), 'Cancelled', [['ITM/00016', 2, fgBins[1]]]],
  ];
  for (const [i, [wc, date, status, lines]] of plan.entries()) {
    const ref = sos[i]?.number ?? `SEED-PW-${i + 1}`;
    if (waves.find((w) => w.ref === ref)) { L.stats.skipped++; continue; }
    await L.screenCreate(`pick wave ${ref}`, 'wms-pick', { warehouse: W[wc], planned: date, reference: ref, status }, lines.map(([c, qty, bin]) => ({ item: code(c).id, bin: bin?.id, required: qty })));
  }
  const waves2 = await L.screenRows('wms-pick');
  const packs = await L.screenRows('wms-packing');
  const released = ['SO/TAL/26-27/0006', 'SO/TAL/26-27/0005', 'SO/TAL/26-27/0004', 'SO/TAL/26-27/0003'].map((ref) => waves2.find((w) => w.ref === ref)).filter(Boolean);
  const packPlan = [[2, 14, 17, 'Printed', true, 'Packed'], [1, 9.5, 12, 'Pending', false, 'Open'], [3, 21, 26, 'Printed', true, 'Packed'], [1, 6, 8, 'Pending', false, 'Open']];
  for (const [i, w] of released.entries()) {
    if (packs.find((p) => p.wave === w.wave)) { L.stats.skipped++; continue; }
    const [cartons, gross, vol, label, qc, status] = packPlan[i];
    await L.screenCreate(`pack unit for ${w.wave}`, 'wms-packing', { wave: w.id, cartons, gross, volumetric: vol, label, qc, status });
  }
}
async function onHandOf(itemId, warehouseId) { return (await api('GET', `/inventory/availability?itemId=${itemId}&warehouseId=${warehouseId}`)).data?.onHand ?? 0; }

// ======================================================================================================
// Sawardari plant (a few records)
// ======================================================================================================
async function sawardari(code) {
  await L.setUnit('SAW');
  console.log('Sawardari plant');
  const W = Object.fromEntries((await api('GET', '/lookups/warehouses')).data.map((w) => [w.code, w.id]));
  const line = (c, qty, extra = {}) => ({ itemId: code(c).id, qty, unitCost: code(c).standardCost, ...extra });
  const ledger = new Set();
  for (const r of await list('/pages/inv-transactions/records')) ledger.add(`${r.refs?.item?.code}|${r.refs?.warehouse?.code}`);
  const free = (codes) => codes.filter((c) => !ledger.has(`${c}|SAW-MAIN`));
  const codes = ['ITM/00001', 'ITM/00002', 'ITM/00005', 'ITM/00016', 'ITM/00017', 'ITM/00031', 'ITM/00046', 'ITM/00059'];
  await voucher('opening', 'SEED-OPN-SAW-MAIN', { postingDate: d(1), warehouseId: W['SAW-MAIN'], narration: 'Opening balance Sawardari main store', lines: free(codes).map((c, i) => line(c, 100 + i * 20)) });
  await voucher('transactions', 'SEED-TXN-SAW-R1', { postingDate: d(6), warehouseId: W['SAW-MAIN'], txType: 'Receipt', narration: 'Receipt of MS plates for Sawardari fabrication', lines: [line('ITM/00001', 300)] });
  await voucher('transactions', 'SEED-TXN-SAW-I1', { postingDate: d(9), warehouseId: W['SAW-MAIN'], txType: 'Issue', narration: 'Issue to fabrication shop', lines: [line('ITM/00001', 60)] });
  const oh = async (c) => (await api('GET', `/inventory/availability?itemId=${code(c).id}&warehouseId=${W['SAW-MAIN']}`)).data?.onHand ?? 0;
  await voucher('adjustment', 'SEED-ADJ-SAW-1', { postingDate: d(11), warehouseId: W['SAW-MAIN'], reasonNote: 'Packing material damaged in rain', lines: [{ itemId: code('ITM/00059').id, countedQty: Math.max(0, (await oh('ITM/00059')) - 5), unitCost: code('ITM/00059').standardCost, reasonCode: 'Damage' }] });
  await wmsLocations({ ...W }, ['SAW-MAIN']);
  const rs = await list('/inventory/reservations');
  if (!rs.find((r) => r.demandRef === 'SEED-RSV-SAW-01 SO Pragati Valves')) await ensure('reservation SAW-01', null, 'POST', '/inventory/reservations', { itemId: code('ITM/00016').id, warehouseId: W['SAW-MAIN'], requiredQty: 5, priority: 'Medium', reservedUntil: d(26), demandType: 'Sales Order', demandRef: 'SEED-RSV-SAW-01 SO Pragati Valves' }); else L.stats.skipped++;
  await L.setUnit('TAL');
}
