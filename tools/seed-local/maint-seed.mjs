// Seeds Maintenance demo data through the API: maintainable machines and equipment (capitalised so they are in service), meters,
// checklists, preventive plans and schedules, breakdowns, maintenance work orders, downtime and alerts.
// Re-runnable: natural keys are asset name, checklist code, plan title per asset, breakdown symptom, work order description, downtime reason.
import * as L from './opslib.mjs';
const { call, ensure, step, list, day } = L;
await L.login();
const ts = (d, h, m = 0) => `2026-11-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+05:30`;
const ver = (r) => ({ 'if-match': `"${r.version}"` });

await L.withApprovalsOff(['maint-', 'asset-'], async () => {
  L.plant('Talwade');
  const cats = Object.fromEntries((await list('/assets/categories')).map((c) => [c.code, c.id]));
  const cc = L.rowsOf((await call('GET', '/assets/lookup-cost-centres')).data).find((c) => /PROD|MNT/.test(c.code ?? ''))?.id;

  // ---- 1. assets
  // [base, name, category, make, model, serial, criticality, cost, location, dept]
  const defs = [
    ['/maint/machines', 'CNC Machining Centre VMC-850', 'PM_GENERAL', 'Jyoti CNC', 'VMC-850', 'JC-85-2231', 'A', 1850000, 'Machine shop', 'Production'],
    ['/maint/machines', 'Hydraulic Press HP-100', 'PM_GENERAL', 'Pragati', 'HP-100', 'PR-100-118', 'A', 780000, 'Press shop', 'Production'],
    ['/maint/machines', 'Powder Coating Oven PCO-3', 'PM_GENERAL', 'Thermax', 'PCO-3', 'TX-PC-3307', 'B', 640000, 'Paint shop', 'Production'],
    ['/maint/machines', 'Winding Machine WM-5', 'PM_GENERAL', 'Meteor', 'WM-5', 'MT-5-0912', 'B', 520000, 'Winding section', 'Production'],
    ['/maint/machines', 'MIG Welding Set MW-400', 'PM_GENERAL', 'Ador', 'Powertron 400', 'AD-4-7721', 'C', 185000, 'Welding bay', 'Production'],
    ['/maint/machines', 'Screw Air Compressor AC-15', 'PM_GENERAL', 'Elgi', 'EG-15', 'EL-15-4410', 'A', 420000, 'Utility room', 'Maintenance'],
    ['/maint/equipment', 'EOT Crane 5T', 'PM_GENERAL', 'Mazda', 'EOT-5', 'MZ-5T-0051', 'A', 950000, 'Main bay', 'Maintenance'],
    ['/maint/equipment', 'DG Set 125 kVA', 'ELECTRICAL', 'Kirloskar', 'KG1-125', 'KL-125-6620', 'A', 1150000, 'Generator yard', 'Maintenance'],
    ['/maint/equipment', 'Pump Pressure Test Bench PTB-2', 'PM_GENERAL', 'In-house', 'PTB-2', 'PTB2-001', 'B', 310000, 'Test area', 'Quality'],
    ['/maint/equipment', 'Industrial Chiller IC-10', 'PM_GENERAL', 'Blue Star', 'IC-10', 'BS-10-2290', 'B', 380000, 'Utility room', 'Maintenance'],
  ];
  const have = await list('/assets/lookup');
  const A = {};
  for (const [base, name, cat, make, model, serialNo, criticality, cost, location, department] of defs) {
    let a = have.find((x) => x.name === name || x.name === 'TEST ' + name);
    if (a && a.name !== name) { await step('rename', 'PATCH', `${base}/${a.id}`, { name }, ver(a)); a.name = name; }
    if (!a) a = await ensure(`asset ${name}`, null, () => false, base, { name, categoryId: cats[cat], isMaintainable: true, location, department, make, model, serialNo, criticality, commissionDate: day(2), putToUseDate: day(3), costCentreId: cc }, []);
    else L.stats.skipped++;
    if (!a) continue;
    A[name] = a;
    a = (await call('GET', `/assets/by-id/${a.id}`)).data;
    A[name] = a;
    if (a.status === 'CWIP') {
      const cap = await ensure(`capitalise ${name}`, null, () => false, '/assets/capitalisations', { assetId: a.id, capitalisationDate: day(3), source: 'PURCHASE', lines: [{ component: 'BASE', amount: cost, sourceDocRef: `PI/26-27/${name.slice(0, 3).toUpperCase()}`, glSourceAccount: '3009', gstAmount: Math.round(cost * 0.18), gstAddedToCost: false }, { component: 'FREIGHT', amount: Math.round(cost * 0.02), glSourceAccount: '3009' }, { component: 'INSTALLATION', amount: Math.round(cost * 0.03), glSourceAccount: '3009' }] }, []);
      if (cap) {
        let c = cap;
        let r = await step('cap submit', 'POST', `/assets/capitalisations/${c.id}/submit`, {}, ver(c)); c = r.data ?? c;
        r = await step('cap approve', 'POST', `/assets/capitalisations/${c.id}/approve`, {}, ver(c)); c = r.data ?? c;
        r = await step('cap post', 'POST', `/assets/capitalisations/${c.id}/post`, {}, ver(c));
      }
    }
  }
  const assets = Object.fromEntries((await list('/assets/lookup')).map((x) => [x.name, x]));
  L.summary('maint assets');

  // ---- 2. meters and readings (run hours) on the machines
  for (const n of ['CNC Machining Centre VMC-850', 'Hydraulic Press HP-100', 'Screw Air Compressor AC-15', 'DG Set 125 kVA']) {
    const a = assets[n]; if (!a) continue;
    const d = (await call('GET', `/assets/by-id/${a.id}`)).data;
    let m = (d.meters ?? [])[0] ? { ok: true, data: d.meters[0], had: true } : await call('POST', `/assets/by-id/${a.id}/meters`, { meterType: 'RUN_HRS', uom: 'hrs' });
    if (m.ok && m.data.lastValue != null) { L.stats.skipped++; continue; }
    if (m.ok) {
      if (!m.had) L.stats.created++;
      let v = { 'CNC Machining Centre VMC-850': 1210, 'Hydraulic Press HP-100': 860, 'Screw Air Compressor AC-15': 3420, 'DG Set 125 kVA': 410 }[n];
      for (const [dd, add] of [[3, 0], [8, 54], [13, 61]]) { v += add; await step('reading', 'POST', `/assets/meters/${m.data.id}/readings`, { value: v, readingAt: ts(dd, 18) }); }
    } else console.log('warn meter', m.status, m.err, JSON.stringify(m.details));
  }

  // ---- 3. checklists
  const cls = await list('/maint/checklists');
  const clDefs = [
    ['CL-CNC-WK', 'CNC weekly check', [['Coolant level and concentration', 'OK_NOTOK'], ['Way-lube oil level', 'OK_NOTOK'], ['Spindle temperature (deg C)', 'NUMBER', 20, 55], ['Air pressure at FRL (bar)', 'NUMBER', 5, 7], ['Chip conveyor cleaned', 'OK_NOTOK']]],
    ['CL-COMP-MN', 'Compressor monthly service', [['Oil level in sump', 'OK_NOTOK'], ['Air filter element condition', 'OK_NOTOK'], ['Discharge pressure (bar)', 'NUMBER', 6.5, 8], ['Belt tension', 'OK_NOTOK'], ['Remarks', 'TEXT']]],
    ['CL-DG-MN', 'DG set monthly check', [['Engine oil level', 'OK_NOTOK'], ['Coolant level', 'OK_NOTOK'], ['Battery voltage (V)', 'NUMBER', 12.4, 13.8], ['No-load run for 15 minutes', 'OK_NOTOK']]],
    ['CL-PRESS-QT', 'Press quarterly inspection', [['Hydraulic oil level', 'OK_NOTOK'], ['Oil temperature (deg C)', 'NUMBER', 30, 60], ['Ram guide wear', 'OK_NOTOK'], ['Safety light curtain test', 'OK_NOTOK']]],
  ];
  for (const [code, name, items] of clDefs)
    await ensure(`checklist ${code}`, null, (c) => c.code === code, '/maint/checklists', { code, name, items: items.map(([text, answerType, min, max]) => ({ text, answerType, ...(min !== undefined ? { min, max } : {}) })) }, cls);
  const CL = Object.fromEntries((await list('/maint/checklists')).map((c) => [c.code, c.id]));

  // ---- 4. preventive plans (activated) and schedule
  const plans = await list('/maint/plans');
  const planDefs = [
    ['CNC Machining Centre VMC-850', 'Weekly CNC lubrication and coolant check', 'TIME', 7, CL['CL-CNC-WK'], 2, day(10)],
    ['Screw Air Compressor AC-15', 'Monthly compressor service', 'TIME', 30, CL['CL-COMP-MN'], 4, '2026-10-19'],
    ['DG Set 125 kVA', 'Monthly DG set no-load run and checks', 'TIME', 30, CL['CL-DG-MN'], 2, '2026-10-18'],
    ['Hydraulic Press HP-100', 'Quarterly press hydraulic inspection', 'TIME', 90, CL['CL-PRESS-QT'], 6, '2026-08-20'],
    ['Powder Coating Oven PCO-3', 'Fortnightly oven burner and temperature check', 'TIME', 14, undefined, 3, '2026-11-03'],
    ['EOT Crane 5T', 'Half-yearly crane rope and brake inspection', 'TIME', 180, undefined, 5, '2026-05-20'],
  ];
  for (const [an, title, triggerType, intervalDays, checklistTemplateId, estHours, startFrom] of planDefs) {
    const a = assets[an]; if (!a) continue;
    const p = await ensure(`plan ${title}`, null, (x) => x.title === title, '/maint/plans', { assetId: a.id, title, triggerType, intervalDays, leadDays: 2, estHours, skillDesignation: 'Maintenance fitter', checklistTemplateId, startFrom }, plans);
    if (p && p.status !== 'ACTIVE') await step('activate plan', 'POST', `/maint/plans/${p.id}/activate`, {}, ver(p));
  }
  await step('generate schedule', 'POST', '/maint/schedules/generate', {});
  const sch = await list('/maint/schedules');
  const skipTarget = sch.find((s) => /DUE|PLANNED|OPEN|Scheduled/i.test(String(s.status)));
  if (sch.length > 3 && skipTarget && !sch.some((s) => /SKIP/i.test(String(s.status)))) await step('skip one occurrence', 'POST', `/maint/schedules/${skipTarget.id}/skip`, { reason: 'Machine under customer trial run, service moved to next week' });

  // ---- 5. breakdowns: [asset, symptom, priority, stopped, state]
  const bds = await list('/maint/breakdowns');
  const bdDefs = [
    ['Hydraulic Press HP-100', 'Oil leakage at main cylinder gland', 'P2', true, 'CLOSED', ['ELP', 'WEAR', 'HYD']],
    ['CNC Machining Centre VMC-850', 'Spindle overheating alarm during roughing', 'P1', true, 'RESOLVED', ['OHE', 'LUB', 'MECH']],
    ['Screw Air Compressor AC-15', 'Pressure not building above 5 bar', 'P1', true, 'REPAIR', null],
    ['DG Set 125 kVA', 'Fails to start on auto mains failure', 'P2', false, 'ACK', null],
    ['Powder Coating Oven PCO-3', 'Temperature controller showing erratic reading', 'P3', false, 'OPEN', null],
    ['MIG Welding Set MW-400', 'Wire feeder motor stops intermittently', 'P3', false, 'OPEN', null],
    ['Winding Machine WM-5', 'Traverse gear noise and vibration', 'P2', true, 'CANCEL', null],
  ];
  for (const [an, symptom, priority, machineStopped, state, fm] of bdDefs) {
    const a = assets[an]; if (!a) continue;
    let b = await ensure(`breakdown ${symptom}`, null, (x) => x.symptom === symptom, '/maint/breakdowns', { assetId: a.id, symptom, priority, machineStopped, reportedAt: ts(5 + (symptom.length % 8), 9, 30) }, bds);
    if (!b) continue;
    const get = async () => (await call('GET', `/maint/breakdowns/${b.id}`)).data;
    let cur = await get();
    const order = ['OPEN', 'ACK', 'IN_REPAIR', 'RESOLVED', 'CLOSED'];
    const idx = order.indexOf(String(cur.status).toUpperCase());
    if (idx < 0) continue;
    if (state === 'CANCEL' && idx === 0) { await step('cancel bd', 'POST', `/maint/breakdowns/${b.id}/cancel`, { reason: 'Raised on the wrong machine, noise was from the adjacent fan' }, ver(cur)); continue; }
    const want = { OPEN: 0, ACK: 1, REPAIR: 2, RESOLVED: 3, CLOSED: 4 }[state] ?? 0;
    if (idx < 1 && want >= 1) { await step('ack', 'POST', `/maint/breakdowns/${b.id}/acknowledge`, {}, ver(cur)); cur = await get(); }
    if (String(cur.status).toUpperCase() === 'ACK' && want >= 2) { await step('start repair', 'POST', `/maint/breakdowns/${b.id}/start-repair`, {}, ver(cur)); cur = await get(); }
    if (String(cur.status).toUpperCase() === 'IN_REPAIR' && want >= 3) { await step('resolve', 'POST', `/maint/breakdowns/${b.id}/resolve`, { failureMode: fm[0], failureCause: fm[1], failureMechanism: fm[2], rootCause: 'Wear of seals / lubrication interval exceeded', repairedAt: ts(12, 16, 0) }, ver(cur)); cur = await get(); }
    if (String(cur.status).toUpperCase() === 'RESOLVED' && want >= 4) await step('close bd', 'POST', `/maint/breakdowns/${b.id}/close`, {}, ver(cur));
  }

  // ---- 6. maintenance work orders: extra manual orders, then move each order along its lifecycle
  const wos0 = await list('/maint/work-orders');
  const woDefs = [
    ['Screw Air Compressor AC-15', 'CORRECTIVE', 'Replace worn drive belt and check pulley alignment', 'P2', 14, 15, 18500],
    ['Hydraulic Press HP-100', 'CALIBRATION', 'Calibrate pressure gauge and relief valve setting', 'P3', 18, 18, 6500],
    ['EOT Crane 5T', 'AMC', 'Annual maintenance contract visit by OEM engineer', 'P3', 22, 22, 28000],
    ['Pump Pressure Test Bench PTB-2', 'PM', 'Quarterly test bench leak and gauge check', 'P3', 20, 20, 4200],
    ['Industrial Chiller IC-10', 'CORRECTIVE', 'Chiller low refrigerant pressure, recharge and leak test', 'P2', 17, 17, 22000],
  ];
  for (const [an, woType, description, priority, ps, pe, estCost] of woDefs) {
    const a = assets[an]; if (!a) continue;
    await ensure(`work order ${description}`, null, (w) => w.description === description, '/maint/work-orders', { assetId: a.id, woType, description, priority, plannedStart: day(ps), plannedEnd: day(pe), estCost }, wos0);
  }
  const MAIN = L.rowsOf((await call('GET', '/lookups/warehouses?limit=50')).data).find((w) => w.code === 'TAL-MAIN').id;
  const stock = await list('/maint/spares');
  const spare = (code) => stock.find((x) => x.code === code && Number(x.onHand) > 5);
  const wos = await list('/maint/work-orders');
  const wd = async (w) => (await call('GET', `/maint/work-orders/${w.id}`)).data;
  const plan = {
    'Oil leakage at main cylinder gland': { to: 'signoff', spares: [['ITM/00042', 2], ['ITM/00043', 1]], labour: [[11, 9, 11, 14, 450]], vendor: null },
    'Spindle overheating alarm during roughing': { to: 'complete', spares: [['ITM/00032', 2]], labour: [[12, 9, 12, 13, 520]] },
    'Pressure not building above 5 bar': { to: 'start', spares: [['ITM/00035', 1]] },
    'Replace worn drive belt and check pulley alignment': { to: 'signoff', spares: [['ITM/00035', 1]], labour: [[15, 10, 15, 12, 400]] },
    'Calibrate pressure gauge and relief valve setting': { to: 'complete', labour: [[18, 10, 18, 13, 600]], vendor: 6500 },
    'Annual maintenance contract visit by OEM engineer': { to: 'start' },
    'Weekly CNC lubrication and coolant check': { to: 'signoff', labour: [[16, 8, 0, 10, 380]] },
  };
  for (const w of wos) {
    const pl = plan[w.description]; if (!pl) continue;
    let d = await wd(w);
    const rank = { PLANNED: 0, IN_PROGRESS: 1, COMPLETED: 2, CLOSED: 3, SIGNED_OFF: 3 };
    if (d.status === 'PLANNED' && d.approvalStatus && !['NOT_REQUIRED', 'APPROVED'].includes(d.approvalStatus)) {
      let r = await step('wo submit', 'POST', `/maint/work-orders/${d.id}/submit`, {}, ver(d)); d = await wd(w);
      r = await step('wo approve', 'POST', `/maint/work-orders/${d.id}/approve`, {}, ver(d)); d = await wd(w);
    }
    if (d.status === 'PLANNED') { await step('wo start', 'POST', `/maint/work-orders/${d.id}/start`, {}, ver(d)); d = await wd(w); }
    if (d.status !== 'IN_PROGRESS') continue;
    for (const [code, qty] of pl.spares ?? []) {
      const sp = spare(code); if (!sp || (d.spares ?? []).some((x) => x.itemId === sp.id)) continue;
      const r = await step('wo spare', 'POST', `/maint/work-orders/${d.id}/spares`, { itemId: sp.id, qty });
      
    }
    d = await wd(w);
    if (pl.to !== 'start') for (const row of d.spares ?? []) if (Number(row.issuedQty) === 0) await step('spare issue', 'POST', `/maint/work-orders/${d.id}/spares/${row.id}/issue`, { qty: row.qtyRequired ?? row.qtyPlanned ?? row.qty ?? 1, warehouseId: MAIN });
    if (pl.to !== 'start') {
      for (const t of d.tasks ?? []) if (!t.result) {
        const res = t.answerType === 'NUMBER' ? String(((Number(t.minValue ?? 10) + Number(t.maxValue ?? 20)) / 2).toFixed(1)) : t.answerType === 'TEXT' ? 'No issues seen' : 'OK';
        await step('wo task', 'PUT', `/maint/work-orders/${d.id}/tasks/${t.id}`, { result: res });
      }
      if (!(d.labour ?? []).length) for (const [dd, h1, , h2, rate] of pl.labour ?? []) await step('wo labour', 'POST', `/maint/work-orders/${d.id}/labour`, { vendorName: 'Maintenance fitter, in-house', startAt: ts(dd, h1), endAt: ts(dd, h2 + 0 > h1 ? h2 : h1 + 3), rate });
      if (pl.vendor && !(d.vendorCharges ?? []).length) await step('wo vendor', 'POST', `/maint/work-orders/${d.id}/vendor-charges`, { invoiceRef: 'CAL/INV/2211', amount: pl.vendor });
      d = await wd(w);
      if (d.status === 'IN_PROGRESS') { await step('wo complete', 'POST', `/maint/work-orders/${d.id}/complete`, {}, ver(d)); d = await wd(w); }
      if (pl.to === 'signoff' && d.status === 'COMPLETED') await step('wo sign-off', 'POST', `/maint/work-orders/${d.id}/sign-off`, {}, ver(d));
    }
  }
  // breakdowns whose work order is finished can now be closed
  for (const b of await list('/maint/breakdowns')) if (b.status === 'RESOLVED' && /Oil leakage/.test(b.symptom)) { const cur = (await call('GET', `/maint/breakdowns/${b.id}`)).data; await step('close bd', 'POST', `/maint/breakdowns/${b.id}/close`, {}, ver(cur)); }

  // ---- 7. downtime events [asset, start, end, type, reason, lost qty, cost impact]
  const dts = await list('/maint/downtime');
  for (const [an, s0, e0, dtType, reason, lostQty, costImpact] of [
    ['Hydraulic Press HP-100', ts(5, 9, 30), ts(6, 15, 0), 'UNPLANNED', 'Cylinder gland oil leakage', 180, 54000],
    ['CNC Machining Centre VMC-850', ts(3, 10, 0), ts(3, 17, 30), 'UNPLANNED', 'Spindle overheating, coolant chiller trip', 60, 38000],
    ['Screw Air Compressor AC-15', ts(4, 8, 0), ts(4, 12, 0), 'UNPLANNED', 'Low discharge pressure', 40, 15000],
    ['Powder Coating Oven PCO-3', ts(9, 17, 0), ts(9, 20, 0), 'PLANNED', 'Scheduled burner cleaning', 0, 0],
    ['DG Set 125 kVA', ts(10, 14, 0), ts(10, 15, 30), 'PLANNED', 'Monthly no-load run', 0, 0],
    ['EOT Crane 5T', ts(11, 8, 0), ts(11, 10, 0), 'PLANNED', 'Rope lubrication', 0, 0],
    ['Winding Machine WM-5', ts(14, 11, 0), null, 'UNPLANNED', 'Traverse gear noise, running at half speed', 25, 9000],
  ]) {
    const a = assets[an]; if (!a) continue;
    await ensure(`downtime ${reason}`, null, (x) => x.reason === reason, '/maint/downtime', { assetId: a.id, startAt: s0, ...(e0 ? { endAt: e0 } : {}), dtType, reason, lostQty, costImpact }, dts);
  }

  // ---- 8. alerts
  await step('run alerts', 'POST', '/maint/alerts/run', {});
  const alerts = await list('/maint/alerts');
  const first = alerts.find((x) => /OPEN|NEW/i.test(String(x.status)));
  if (first && !alerts.some((x) => /ACK/i.test(String(x.status)))) await step('ack alert', 'POST', `/maint/alerts/${first.id}/acknowledge`, {});


  // ---- Sawardari: two machines, a plan and a breakdown
  const sw = L.plant('Sawardari');
  const swCats = Object.fromEntries((await list('/assets/categories')).map((c) => [c.code, c.id]));
  const swHave = await list('/assets/lookup');
  const SW = {};
  for (const [name, make, model, serialNo, cost, location] of [['Sheet Shearing Machine SH-8', 'Pragati', 'SH-8', 'SW-SH8-221', 640000, 'Sheet shop'], ['Press Brake PB-60', 'Bystronic', 'PB-60', 'SW-PB60-118', 980000, 'Sheet shop']]) {
    let a = swHave.find((x) => x.name === name);
    if (!a) {
      a = await ensure(`Sawardari asset ${name}`, null, () => false, '/maint/machines', { name, categoryId: swCats.PM_GENERAL, isMaintainable: true, location, department: 'Production', make, model, serialNo, criticality: 'B', commissionDate: day(2), putToUseDate: day(3) }, []);
      if (a) {
        const cap = await ensure(`Sawardari capitalise ${name}`, null, () => false, '/assets/capitalisations', { assetId: a.id, capitalisationDate: day(3), source: 'PURCHASE', lines: [{ component: 'BASE', amount: cost, glSourceAccount: '3009', sourceDocRef: 'PI/26-27/SW' }] }, []);
        if (cap) { let c = cap; let r = await step('cap submit', 'POST', `/assets/capitalisations/${c.id}/submit`, {}, ver(c)); c = r.data ?? c; r = await step('cap approve', 'POST', `/assets/capitalisations/${c.id}/approve`, {}, ver(c)); c = r.data ?? c; await step('cap post', 'POST', `/assets/capitalisations/${c.id}/post`, {}, ver(c)); }
      }
    } else L.stats.skipped++;
    if (a) SW[name] = a;
  }
  const swPlans = await list('/maint/plans');
  if (SW['Press Brake PB-60']) await ensure('Sawardari plan', null, (x) => x.title === 'Monthly press brake hydraulic check', '/maint/plans', { assetId: SW['Press Brake PB-60'].id, title: 'Monthly press brake hydraulic check', triggerType: 'TIME', intervalDays: 30, leadDays: 2, estHours: 2, startFrom: day(12) }, swPlans);
  const swBd = await list('/maint/breakdowns');
  if (SW['Sheet Shearing Machine SH-8']) await ensure('Sawardari breakdown', null, (x) => x.symptom === 'Shearing blade gap uneven, burrs on cut edge', '/maint/breakdowns', { assetId: SW['Sheet Shearing Machine SH-8'].id, symptom: 'Shearing blade gap uneven, burrs on cut edge', priority: 'P3', machineStopped: false, reportedAt: ts(11, 10, 15) }, swBd);
  L.summary('maint plans/breakdowns');
});
L.summary('maint total');
