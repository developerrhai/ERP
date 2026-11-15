// Seeds Manufacturing demo data through the API: work centres, routings, BOMs, plans, MRP, orders, issue, job cards, receipts, scrap, rework, downtime.
// Re-runnable: a record is skipped when its natural key (work centre code, item for BOM/routing, customerPoNo on orders, plan notes) exists.
import * as L from './opslib.mjs';
const { call, ensure, step, list, day } = L;
await L.login();
L.plant('Talwade');

const items = {};
for (const r of await list('/pages/inv-items/records')) items[r.code] = r;
const it = (c) => items[`ITM/000${c}`].id;
const wh = (await call('GET', '/lookups/warehouses?limit=50')).data;
const FG = wh.find((w) => w.code === 'TAL-FG').id, MAIN = wh.find((w) => w.code === 'TAL-MAIN').id;
const cc = L.rowsOf((await call('GET', '/mfg/cost-centers')).data).find((c) => c.code === 'TAL-PROD')?.id;

await L.withApprovalsOff(['mfg-', 'qms-'], async () => {
// ---- work centres
const wcs = await list('/mfg/work-centers');
const wcDefs = [
  ['WC-WLD', 'Welding and Fabrication Bay', 'MANUAL', 3, 6, 150, 70],
  ['WC-PNT', 'Powder Coating Booth', 'LINE', 1, 3, 140, 110],
  ['WC-TST', 'Testing and Calibration Bench', 'MANUAL', 2, 2, 160, 60],
];
for (const [code, name, kind, mc, lc, lr, or] of wcDefs)
  await ensure(`work centre ${code}`, null, (w) => w.code === code, '/mfg/work-centers',
    { code, name, kind, machineCount: mc, labourCount: lc, hoursPerShift: 8, shiftsPerDay: 2, normalCapacityHrs: 16, labourRatePerHr: lr, overheadRatePerHr: or, costCentreId: cc, oeeTargetPct: 80, efficiencyPct: 90, department: 'Production' }, wcs);
const W = {};
for (const w of await list('/mfg/work-centers')) {
  W[w.code] = w.id;
  if (!w.costCentreId && cc) await step('wc cost centre', 'PATCH', `/mfg/work-centers/${w.id}`, { costCentreId: cc }, { 'if-match': `"${w.version}"` });
}

// ---- routings and BOMs for four more finished products (Talwade)
const products = [
  { code: 25, ops: [['WC-CNC', 'Machining', 20, 45], ['WC-ASM', 'Pump assembly', 15, 60], ['WC-TST', 'Pressure test', 5, 20]],
    lines: [[1, 3], [6, 0.8], [17, 1], [12, 1.5]] },
  { code: 20, ops: [['WC-CNC', 'Gear cutting', 30, 70], ['WC-ASM', 'Gearbox assembly', 15, 50], ['WC-TST', 'Noise and backlash test', 5, 15]],
    lines: [[15, 6], [12, 2], [13, 0.5]] },
  { code: 24, ops: [['WC-WLD', 'Enclosure fabrication', 20, 80], ['WC-PNT', 'Powder coating', 10, 40], ['WC-ASM', 'Panel wiring', 15, 90], ['WC-TST', 'Functional test', 5, 25]],
    lines: [[4, 12], [10, 0.6], [6, 4], [5, 3]] },
  { code: 22, ops: [['WC-WLD', 'Frame welding', 25, 120], ['WC-CNC', 'Shaft machining', 20, 60], ['WC-ASM', 'Machine assembly', 20, 150], ['WC-TST', 'Trial run', 10, 45]],
    lines: [[1, 40], [2, 25], [18, 1], [19, 1], [20, 1]] },
];
const rts = await list('/mfg/routings'), boms = await list('/mfg/boms');
const hasRt = (id) => rts.find((r) => r.itemId === id && r.status !== 'OBSOLETE');
const hasBom = (id) => boms.find((b) => b.itemId === id && b.status !== 'OBSOLETE');
for (const p of products) {
  const id = it(String(p.code).padStart(2, '0'));
  if (!hasRt(id)) {
    const r = await ensure(`routing ${p.code}`, null, () => false, '/mfg/routings', { itemId: id, ops: p.ops.map(([wc, name, setup, run], i) => ({ seq: (i + 1) * 10, name, workCentreId: W[wc], setupMinutes: setup, runMinutes: run, qcRequired: i === p.ops.length - 1 })) }, []);
    if (r) { await step('release routing', 'POST', `/mfg/routings/${r.id}/release`, {}, { 'if-match': `"${r.version}"` }); }
  }
  if (!hasBom(id)) {
    const rt = (await list('/mfg/routings')).find((r) => r.itemId === id && r.status === 'RELEASED');
    const b = await ensure(`bom ${p.code}`, null, () => false, '/mfg/boms', { itemId: id, baseQty: 1, routingId: rt?.id, lines: p.lines.map(([c, q]) => ({ itemId: it(String(c).padStart(2, '0')), qtyPer: q, issueMethod: 'MANUAL', scrapPct: 2 })) }, []);
    if (b) { const s = await step('submit bom', 'POST', `/mfg/boms/${b.id}/submit`, {}, { 'if-match': `"${b.version}"` }); const v = s.data?.version ?? b.version; await step('release bom', 'POST', `/mfg/boms/${b.id}/release`, {}, { 'if-match': `"${v}"` }); }
  }
}
L.summary('mfg masters');

// ---- production plan, MRP
const cust = (await list('/customers')).filter((c) => c.status === 'ACTIVE');
const plans = await list('/mfg/production-plans');
const PLAN_NOTE = 'Demo plan: November 2026 production programme';
let plan = plans.find((p) => (p.notes ?? '') === PLAN_NOTE);
if (!plan) {
  plan = await ensure('production plan', null, () => false, '/mfg/production-plans', {
    planDate: day(2), horizonDays: 30, notes: PLAN_NOTE,
    lines: [[25, 40, 20], [20, 30, 22], [24, 12, 25], [22, 4, 28], [16, 25, 18]].map(([c, q, d]) => ({ demandSource: 'MANUAL', itemId: it(String(c).padStart(2, '0')), plannedQty: q, demandQty: q, requiredDate: day(d) })),
  }, []);
}
if (plan) {
  const cur = (await call('GET', `/mfg/production-plans/${plan.id}`)).data;
  if (cur.status === 'DRAFT' || cur.status === 'Draft') {
    await step('plan capacity', 'POST', `/mfg/production-plans/${plan.id}/check-capacity`);
    await step('plan material', 'POST', `/mfg/production-plans/${plan.id}/check-material`);
    let s = await step('plan submit', 'POST', `/mfg/production-plans/${plan.id}/submit`, {}, { 'if-match': `"${cur.version}"` });
    await step('plan release', 'POST', `/mfg/production-plans/${plan.id}/release`, {}, { 'if-match': `"${s.data?.version ?? cur.version + 1}"` });
  }
  console.log('plan status', (await call('GET', `/mfg/production-plans/${plan.id}`)).data?.status);
}
const runs = await list('/mfg/mrp-runs');
if (runs.length < 2 && plan) {
  await ensure('mrp run (plan)', null, () => false, '/mfg/mrp-runs', { horizonDays: 30, bucket: 'WEEK', includeSo: true, planId: plan.id, notes: 'Demo MRP run on the November plan' }, runs);
  if (runs.length < 1) { await new Promise((r) => setTimeout(r, 4000)); await ensure('mrp run (all)', null, () => false, '/mfg/mrp-runs', { horizonDays: 14, bucket: 'DAY', includeSo: true, notes: 'Demo MRP run, two weeks daily' }, runs); }
}
L.summary('mfg plan/mrp');

// ---- raw material stock into the Talwade main store (a goods receipt voucher), so material can be issued to orders
{
  const REF = 'MFG-SEED-RM-STOCK';
  let v = (await list('/inventory/vouchers/transactions')).find((x) => x.reference === REF);
  if (!v) {
    const lines = [];
    for (let c = 1; c <= 30; c++) { const x = items[`ITM/000${String(c).padStart(2, '0')}`]; if (x) lines.push({ itemId: x.id, qty: x.data.baseUom === 'Kg' ? 600 : 120, unitCost: x.data.standardCost, stockStatus: 'UNRESTRICTED' }); }
    v = await ensure('RM stock receipt', null, () => false, '/inventory/vouchers/transactions', { postingDate: day(3), warehouseId: MAIN, txType: 'Receipt', reference: REF, narration: 'Raw material stock for the production demo', lines }, []);
  } else L.stats.skipped++;
  for (const verb of ['submit', 'approve', 'post']) {
    if (!v) break;
    const cur = (await call('GET', `/inventory/vouchers/transactions/${v.id}`)).data;
    if (cur.status === 'Posted') break;
    if (verb === 'approve' && cur.status !== 'Pending Approval') continue;
    if (verb === 'submit' && cur.status !== 'Draft') continue;
    await step(`rm receipt ${verb}`, 'POST', `/inventory/vouchers/transactions/${v.id}/${verb}`, {}, { 'if-match': `"${cur.version}"` });
  }
}

// ---- production orders in several states (every step checks the current state, so a re-run only finishes what is missing)
const ords = await list('/mfg/production-orders');
const mk = async (n, code, qty, due, extra = {}) => {
  const po = `DEMO-MFG-${n}`;
  const had = ords.find((o) => o.customerPoNo === po);
  if (had) { L.stats.skipped++; return had; }
  const c = cust[n % cust.length];
  return ensure(`order ${po}`, null, () => false, '/mfg/production-orders', { itemId: it(String(code).padStart(2, '0')), qty, dueDate: day(due), startDate: day(Math.max(2, due - 12)), customerId: c.id, customerPoNo: po, warehouseId: FG, rmWarehouseId: MAIN, priority: 3, notes: `Demo order ${n}`, ...extra }, []);
};
const ver = async (id) => (await call('GET', `/mfg/production-orders/${id}`)).data;
const release = async (o) => { const d = await ver(o.id); if (d.status === 'Planned') return step('release', 'POST', `/mfg/production-orders/${o.id}/release`, {}, { 'if-match': `"${d.version}"` }); };
const issueAll = async (o, frac = 1) => {
  const d = await ver(o.id);
  if (d.status !== 'Released') return;
  const mats = (await call('GET', `/mfg/production-orders/${o.id}/materials`)).data;
  const arr = Array.isArray(mats) ? mats : mats?.rows ?? mats?.materials ?? [];
  if (arr.some((m) => Number(m.issuedQty ?? m.qtyIssued ?? 0) > 0)) return;
  const lines = arr.map((m) => ({ materialId: m.id, qty: String(+(Number(m.requiredQty ?? m.qtyRequired ?? m.qty) * frac).toFixed(3)) })).filter((l) => Number(l.qty) > 0);
  if (!lines.length) { console.log('warn no materials', JSON.stringify(mats).slice(0, 300)); return; }
  return step('issue', 'POST', `/mfg/production-orders/${o.id}/issue`, { lines }, { 'if-match': `"${d.version}"` });
};
const jobs = async (o) => (await list(`/mfg/job-cards?orderId=${o.id}`)).filter((j) => j.orderId === o.id).sort((a, b) => a.seq - b.seq);
const runJob = async (j, good, extra = {}) => {
  if (j.status === 'Done' || j.status === 'Completed') return;
  if (j.status === 'Pending') { const s = await step('jc start', 'POST', `/mfg/job-cards/${j.id}/start`, { kind: 'RUN', operator: 'Ramesh Patil' }); if (!s.ok) return; }
  return step('jc complete', 'POST', `/mfg/job-cards/${j.id}/complete`, { good, operator: 'Ramesh Patil', ...extra });
};

await mk(1, 25, 20, 24);                                          // stays Planned
const o2 = await mk(2, 20, 15, 26); if (o2) await release(o2);   // Released
const o3 = await mk(3, 25, 10, 22);                               // running: first operation done
if (o3) { await release(o3); await issueAll(o3); const js = await jobs(o3); if (js[0]) await runJob(js[0], '10'); }
await mk(4, 24, 5, 20);                                           // (first run: completed before stock existed; left as is)
await mk(7, 24, 5, 21);                                           // (completed through an in-process inspection; see report: qty_completed stays 0)
const o4 = await mk(8, 16, 6, 19);                                // full cycle to finished goods
if (o4) {
  await release(o4); await issueAll(o4);
  if ((await ver(o4.id)).materialStatus !== 'NOT_ISSUED') for (const j of await jobs(o4)) await runJob(j, '5');
  let d = await ver(o4.id);
  if (['Released', 'In Progress'].includes(d.status)) await step('tech complete', 'POST', `/mfg/production-orders/${o4.id}/start-complete`, {}, { 'if-match': `"${d.version}"` });
  d = await ver(o4.id);
  for (const op of d.ops ?? []) if (op.inspectionId) {   // the last operation raised an in-process inspection: record readings, submit, accept
    let i = (await call('GET', `/qms/inspections/${op.inspectionId}`)).data;
    if (i.status === 'Draft') {
      const p = await step('inspection rows', 'PATCH', `/qms/inspections/${i.id}`, { rows: [
        { label: 'Insulation resistance', spec: '>= 2 MOhm', unit: 'MOhm', rowType: 'NUMERIC', lsl: '2', usl: null, readings: ['4.2', '3.8', '4.0', '4.4', '3.9'] },
        { label: 'Wiring and labelling as per drawing', rowType: 'ATTRIBUTE', readings: ['OK', 'OK', 'OK', 'OK', 'OK'] }] }, { 'if-match': `"${i.version}"` });
      const s = await step('inspection submit', 'POST', `/qms/inspections/${i.id}/submit`, { result: 'ACCEPTED' }, { 'if-match': `"${p.data?.version ?? i.version}"` });
      i = (await call('GET', `/qms/inspections/${i.id}`)).data;
    }
    if (i.status === 'Submitted') await step('inspection decide', 'POST', `/qms/inspections/${i.id}/decide`, { acceptedQty: String(d.qty), rejectedQty: '0', note: 'All pieces passed the functional test' }, { 'if-match': `"${i.version}"` });
  }
  d = await ver(o4.id);
  if (Number(d.qtyReceived) === 0) await step('fg receipt', 'POST', '/mfg/production-receipts', { orderId: o4.id, qty: '5', batchNo: 'CP-NOV-001' });
}
const o5 = await mk(5, 22, 2, 28);                                // scrap and rework
if (o5) {
  await release(o5); await issueAll(o5);
  const js = await jobs(o5);
  if (js[0]) await runJob(js[0], '1', { scrap: '1', reason: 'Weld porosity on frame' });
  if (js[1]) await runJob(js[1], '0', { rework: '1', reason: 'Bore oversize, re-machine' });
}
const o6 = await mk(6, 20, 8, 27);                                // cancelled
if (o6) { const d = await ver(o6.id); if (d.status === 'Planned') await step('cancel', 'POST', `/mfg/production-orders/${o6.id}/cancel`, { reason: 'Customer deferred the delivery schedule' }, { 'if-match': `"${d.version}"` }); }
L.summary('mfg orders');

// ---- scrap entries, rework orders, downtime, order close
const byPo = async (n) => (await list('/mfg/production-orders')).find((o) => o.customerPoNo === `DEMO-MFG-${n}`);
const scrapReasons = L.rowsOf((await call('GET', '/mfg/scrap-reasons')).data), dtReasons = L.rowsOf((await call('GET', '/mfg/downtime-reasons')).data);
const scraps = await list('/mfg/scrap-entries');
const scrapDefs = [[3, 1, 'Burr and dimension out of tolerance on machined housing', 'DEFECT', true], [5, 1, 'Material defect found in MS bar, lamination crack', 'MATERIAL_DEFECT', false], [8, 1, 'Power supply fault, part damaged on the line', 'MACHINE_FAULT', true]];
for (const [n, q, why, code, sub] of scrapDefs) {
  const o = await byPo(n); if (!o) continue;
  const e = await ensure(`scrap ${n}`, null, (x) => x.reason === why, '/mfg/scrap-entries', { orderId: o.id, qty: q, reason: why, reasonId: scrapReasons.find((r) => r.code === code)?.id, isNormal: false, disposalMethod: 'Sold as scrap' }, scraps);
  if (e && sub && (e.status === 'Draft')) await step('scrap submit', 'POST', `/mfg/scrap-entries/${e.id}/submit`, {}, { 'if-match': `"${e.version}"` });
}
for (const rw of await list('/mfg/rework-orders')) {
  if (rw.status === 'Open') {
    const r = await step('rework release', 'POST', `/mfg/rework-orders/${rw.id}/release`, {}, { 'if-match': `"${rw.version}"` });
  }
}
// downtime has no list API, so the work centre notes carry a marker to keep this step idempotent
for (const [wc, code, why] of [['WC-CNC', 'BREAKDOWN', 'spindle bearing noise'], ['WC-ASM', 'NO_MATERIAL', 'waiting for gaskets'], ['WC-WLD', 'BREAK', 'tea break']]) {
  const w = (await list('/mfg/work-centers')).find((x) => x.code === wc);
  if (!w || String(w.notes ?? '').includes('[demo downtime logged]')) { L.stats.skipped++; continue; }
  const d = await step('downtime start', 'POST', '/mfg/downtime', { workCentreId: W[wc], reasonId: dtReasons.find((r) => r.code === code)?.id, remarks: `Demo downtime: ${why}` });
  if (d.ok) { L.stats.created++; await step('downtime end', 'POST', `/mfg/downtime/${d.data.id}/end`, {}); await step('mark wc', 'PATCH', `/mfg/work-centers/${w.id}`, { notes: `${w.notes ?? ''} [demo downtime logged]`.trim() }, { 'if-match': `"${w.version}"` }); }
}
{ const o = await byPo(8); if (o) { const d = await ver(o.id); if (d.status === 'Completed') await step('close order', 'POST', `/mfg/production-orders/${o.id}/close`, { note: 'Short-closed after 5 of 6 pieces; balance not needed' }, { 'if-match': `"${d.version}"` }); } }

// ---- Sawardari: a small set (work centres, routing, BOM, two orders)
L.plant('Sawardari');
{
  const SW = L.rowsOf((await call('GET', '/lookups/warehouses?limit=50')).data).find((w) => w.code === 'SAW-MAIN').id;
  const scc = L.rowsOf((await call('GET', '/mfg/cost-centers')).data)[0]?.id;
  const swc = await list('/mfg/work-centers');
  for (const [code, name, kind, lr, or] of [['SW-CUT', 'Sheet Cutting and Bending', 'MACHINE', 160, 80], ['SW-ASM', 'Sawardari Assembly Bay', 'MANUAL', 150, 60]])
    await ensure(`work centre ${code}`, null, (w) => w.code === code, '/mfg/work-centers', { code, name, kind, machineCount: 2, labourCount: 4, hoursPerShift: 8, shiftsPerDay: 1, normalCapacityHrs: 8, labourRatePerHr: lr, overheadRatePerHr: or, costCentreId: scc, oeeTargetPct: 75, efficiencyPct: 90 }, swc);
  const SW2 = {}; for (const w of await list('/mfg/work-centers')) SW2[w.code] = w.id;
  const item = it('24');
  if (!(await list('/mfg/routings')).some((r) => r.itemId === item)) {
    const r = await ensure('Sawardari routing', null, () => false, '/mfg/routings', { itemId: item, ops: [{ seq: 10, name: 'Cut and bend enclosure', workCentreId: SW2['SW-CUT'], setupMinutes: 20, runMinutes: 45 }, { seq: 20, name: 'Assemble and wire panel', workCentreId: SW2['SW-ASM'], setupMinutes: 10, runMinutes: 90 }] }, []);
    if (r) await step('release routing', 'POST', `/mfg/routings/${r.id}/release`, {}, { 'if-match': `"${r.version}"` });
  }
  if (!(await list('/mfg/boms')).some((b) => b.itemId === item)) {
    const rt = (await list('/mfg/routings')).find((r) => r.itemId === item && r.status === 'RELEASED');
    const b = await ensure('Sawardari BOM', null, () => false, '/mfg/boms', { itemId: item, routingId: rt?.id, lines: [[4, 10], [6, 3], [5, 2]].map(([c, q]) => ({ itemId: it(String(c).padStart(2, '0')), qtyPer: q, issueMethod: 'MANUAL' })) }, []);
    if (b) { const sb = await step('submit bom', 'POST', `/mfg/boms/${b.id}/submit`, {}, { 'if-match': `"${b.version}"` }); await step('release bom', 'POST', `/mfg/boms/${b.id}/release`, {}, { 'if-match': `"${sb.data?.version ?? b.version + 1}"` }); }
  }
  const sord = await list('/mfg/production-orders');
  for (const [n, q, due, rel] of [[11, 4, 24, false], [12, 6, 27, true]]) {
    const po = `DEMO-MFG-${n}`;
    if (sord.some((o) => o.customerPoNo === po)) { L.stats.skipped++; continue; }
    const o = await ensure(`Sawardari order ${po}`, null, () => false, '/mfg/production-orders', { itemId: item, qty: q, dueDate: day(due), startDate: day(due - 8), customerPoNo: po, warehouseId: SW, rmWarehouseId: SW, priority: 3 }, []);
    if (o && rel) await release(o);
  }
}
});
L.summary('mfg total');
