// Seeds Quality (QMS) demo data through the API: inspection plans, incoming / in-process / final / supplier (ISIR) inspections,
// rejections (NCR), quality alerts, 8D and CI forms (CAPA), 5-why cases, instruments and calibration, quality cost.
// Re-runnable: natural keys are plan code, inspection kind + date, form title, defect text, instrument equipment no, 5-why title.
import * as L from './opslib.mjs';
const { call, ensure, step, list, day } = L;
await L.login();

await L.withApprovalsOff(['qms-'], async () => {
  L.plant('Talwade');
  const items = {};
  for (const r of await list('/pages/inv-items/records')) items[r.code] = r;
  const it = (c) => items[`ITM/000${String(c).padStart(2, '0')}`].id;
  const sup = (await list('/suppliers')).filter((s) => s.status === 'ACTIVE');
  const cust = (await list('/customers')).filter((c) => c.status === 'ACTIVE');
  const S = (i) => sup[i % sup.length], C = (i) => cust[i % cust.length];

  // ---- inspection plans
  const plans = await list('/qms/plans');
  const N = (name, spec, unit, lsl, usl) => ({ name, spec, unit, type: 'NUMERIC', lsl, usl });
  const A = (name, spec) => ({ name, spec, type: 'ATTRIBUTE' });
  const planDefs = [
    ['QP-IQC-MS10', 'MS Plate 10mm incoming plan', 'INCOMING', it(1), [N('Thickness', '10 +/- 0.3 mm', 'mm', 9.7, 10.3), N('Width', '1250 +/- 5 mm', 'mm', 1245, 1255), A('Surface, rust and scale', 'No pitting')]],
    ['QP-IQC-CU25', 'Copper wire 2.5 sqmm incoming plan', 'INCOMING', it(6), [N('Conductor diameter', '1.78 mm min', 'mm', 1.78, 1.9), N('Insulation resistance', '>= 100 MOhm/km', 'MOhm', 100, null), A('Colour code and print', 'As per IS 694')]],
    ['QP-IPQC-PUMP', 'Pump assembly in-process plan', 'IN_PROCESS', it(25), [N('Shaft run-out', '<= 0.05 mm', 'mm', 0, 0.05), N('Bore diameter', '35 H7', 'mm', 35, 35.025), A('Seal seating', 'No leak at 2 bar')]],
    ['QP-IPQC-GBOX', 'Gear box in-process plan', 'IN_PROCESS', it(20), [N('Backlash', '0.08 - 0.15 mm', 'mm', 0.08, 0.15), N('Noise level', '<= 75 dB', 'dB', 0, 75)]],
    ['QP-PDI-PANEL', 'Control panel pre-dispatch plan', 'PRE_DISPATCH', it(24), [N('Insulation resistance', '>= 2 MOhm', 'MOhm', 2, null), N('Earth continuity', '<= 0.1 Ohm', 'Ohm', 0, 0.1), A('Wiring and ferrule labels', 'As per drawing')]],
    ['QP-ISIR-GEAR', 'Gear blank supplier sample plan (ISIR)', 'ISIR', it(15), [N('Outside diameter', '120 +/- 0.05 mm', 'mm', 119.95, 120.05), N('Hardness', '58 - 62 HRC', 'HRC', 58, 62)]],
  ];
  for (const [code, name, kind, itemId, characteristics] of planDefs)
    await ensure(`plan ${code}`, null, (p) => p.code === code, '/qms/plans', { code, name, kind, itemId, characteristics, notes: 'Demo inspection plan' }, plans);

  // ---- inspections
  const insp = await list('/qms/inspections');
  const rowsFor = (kind, ok) => {
    const v = (good, bad) => (ok ? good : bad);
    switch (kind) {
      case 'INCOMING': return [{ label: 'Thickness', spec: '10 +/- 0.3 mm', unit: 'mm', rowType: 'NUMERIC', lsl: '9.7', usl: '10.3', readings: [v('10.12', '10.58')] }, { label: 'Width', spec: '1250 +/- 5 mm', unit: 'mm', rowType: 'NUMERIC', lsl: '1245', usl: '1255', readings: ['1251'] }, { label: 'Surface condition', rowType: 'ATTRIBUTE', readings: [v('OK', 'NOK')] }];
      case 'IN_PROCESS': return [{ label: 'Bore diameter', spec: '35 H7', unit: 'mm', rowType: 'NUMERIC', lsl: '35', usl: '35.025', readings: ['35.012', '35.015', '35.010', v('35.018', '35.041'), '35.013'] }, { label: 'Shaft run-out', spec: '<= 0.05 mm', unit: 'mm', rowType: 'NUMERIC', lsl: '0', usl: '0.05', readings: ['0.02', '0.03', '0.02', '0.04', '0.03'] }];
      case 'PRE_DISPATCH': return [{ label: 'Insulation resistance', spec: '>= 2 MOhm', unit: 'MOhm', rowType: 'NUMERIC', lsl: '2', usl: null, readings: ['4.1', '3.9', '4.3', '4.0', '3.8'] }, { label: 'Earth continuity', spec: '<= 0.1 Ohm', unit: 'Ohm', rowType: 'NUMERIC', lsl: '0', usl: '0.1', readings: ['0.04', '0.05', '0.04', v('0.06', '0.14'), '0.05'] }];
      case 'ISIR': return [{ label: 'Outside diameter', spec: '120 +/- 0.05 mm', unit: 'mm', rowType: 'NUMERIC', lsl: '119.95', usl: '120.05', extra: { zone_item: 'A1', tolerance: '+/-0.05' }, readings: ['120.01', '119.99', '120.02', v('120.00', '120.09'), '120.03'] }, { label: 'Hardness', spec: '58 - 62 HRC', unit: 'HRC', rowType: 'NUMERIC', lsl: '58', usl: '62', extra: { zone_item: 'B2', tolerance: '58-62' }, readings: ['59', '60', '60', '61', '59'] }];
      default: return [{ label: 'Weld fit-up, gap and alignment', rowType: 'ATTRIBUTE', readings: [v('OK', 'NOK')] }, { label: 'Weld profile and spatter', rowType: 'ATTRIBUTE', readings: ['OK'] }];
    }
  };
  const headerFor = (kind, i) => {
    switch (kind) {
      case 'INCOMING': return { supplier: S(i).id, invoice_no: `INV/26-27/${1180 + i}`, item: it([1, 2, 6, 12, 4, 5][i % 6]), grade_spec: 'IS 2062 E250', heat_batch_no: `HT-${4410 + i}`, dimensions: 'As per PO' };
      case 'IN_PROCESS': return { part: it([25, 20, 24][i % 3]), machine: ['CNC-01', 'WLD-02', 'ASM-LINE'][i % 3], operation: ['Bore finishing', 'Gear cutting', 'Final assembly'][i % 3] };
      case 'PRE_DISPATCH': return { customer: C(i).id, part: it([24, 25, 20][i % 3]), challan_no: `DC/26-27/${210 + i}`, in_charge: 'Suresh Kamble' };
      case 'ISIR': return { supplier: S(i + 2).id, part_no: it(15), revision: 'R0' + (i % 3), material_spec: 'EN8 forged blank', reviewed_by: 'Quality Head' };
      case 'WELDING': return { stage: 'AFTER', acceptance_class: 'B', weld_no: `W-${300 + i}`, welder_no: `WLR-${12 + i}`, wps_no: 'WPS-07', heat_no: `HT-${900 + i}` };
      default: return { part: 'MS fabricated frame', location: 'Frame joint J' + (i + 1) };
    }
  };
  // [kind, day, lotQty, readings ok, final state, rejected qty]
  const plan = [
    ['INCOMING', 2, 500, true, 'Decided', 0], ['INCOMING', 4, 300, true, 'Decided', 0], ['INCOMING', 6, 800, false, 'Decided', 120], ['INCOMING', 9, 250, true, 'Submitted'], ['INCOMING', 11, 400, true, 'Draft'], ['INCOMING', 13, 600, false, 'Decided', 60],
    ['IN_PROCESS', 3, 40, true, 'Decided', 0], ['IN_PROCESS', 5, 30, false, 'Decided', 4], ['IN_PROCESS', 8, 25, true, 'Decided', 0], ['IN_PROCESS', 12, 50, true, 'Submitted'], ['IN_PROCESS', 14, 20, true, 'Draft'],
    ['PRE_DISPATCH', 7, 10, true, 'Decided', 0], ['PRE_DISPATCH', 10, 6, true, 'Decided', 0], ['PRE_DISPATCH', 13, 8, false, 'Decided', 1], ['PRE_DISPATCH', 14, 12, true, 'Draft'],
    ['WELDING', 6, 12, true, 'Decided', 0], ['WELDING', 11, 8, false, 'Decided', 2], ['VT', 9, 15, true, 'Decided', 0], ['VT', 12, 10, true, 'Submitted'],
    ['ISIR', 5, 5, true, 'Decided', 0], ['ISIR', 8, 5, false, 'Decided', 5], ['ISIR', 12, 5, true, 'Submitted'], ['ISIR', 14, 5, true, 'Draft'],
  ];
  let idx = 0;
  for (const [kind, d, lotQty, ok, state, rej = 0] of plan) {
    idx++;
    let rec = insp.find((x) => x.kind === kind && String(x.docDate).slice(0, 10) === day(d));
    if (!rec) {
      rec = await ensure(`${kind} inspection ${day(d)}`, null, () => false, '/qms/inspections', { kind, docDate: day(d), lotQty, header: headerFor(kind, idx), rows: rowsFor(kind, ok) }, []);
      if (rec) insp.push(rec); else continue;
    } else L.stats.skipped++;
    let cur = (await call('GET', `/qms/inspections/${rec.id}`)).data;
    if (state !== 'Draft' && cur.status === 'Draft') {
      await step('inspection submit', 'POST', `/qms/inspections/${cur.id}/submit`, { result: ok ? 'ACCEPTED' : 'REJECTED', note: ok ? 'All readings within tolerance' : 'One or more readings out of tolerance' }, { 'if-match': `"${cur.version}"` });
      cur = (await call('GET', `/qms/inspections/${cur.id}`)).data;
    }
    if (state === 'Decided' && cur.status === 'Submitted')
      await step('inspection decide', 'POST', `/qms/inspections/${cur.id}/decide`, { acceptedQty: ok ? String(lotQty - rej) : '0', rejectedQty: ok ? String(rej) : String(lotQty), note: !ok || rej ? 'Rejected lot quantity held for disposition' : 'Lot accepted' }, { 'if-match': `"${cur.version}"` });
  }
  L.summary('qms inspections');

  // ---- rejections (NCR register)
  const rejs = await list('/qms/rejections');
  const rejDefs = [
    ['Machining', 'Ramesh Patil', 25, 'Pump casing', 3, 'Bore oversize by 0.03 mm', 'Dimensional', 'REWORK', 'Re-bore and fit a bush'],
    ['Welding', 'Anil More', null, 'Control panel enclosure', 2, 'Weld porosity on corner seam', 'Welding', 'SCRAP', 'Beyond repair, return to scrap yard'],
    ['Powder coating', 'Sagar Jadhav', null, 'Panel door', 6, 'Coating thickness below 60 micron', 'Finish', 'REWORK', 'Re-coat after surface prep'],
    ['Assembly', 'Vikas Shinde', 20, 'Gear box 1:10', 1, 'Oil seal damaged during fitment', 'Handling', 'USE_AS_IS', 'Seal replaced, no impact on function'],
    ['Incoming', 'Store keeper', 1, 'MS Plate 10mm', 120, 'Thickness above tolerance on 3 plates', 'Supplier', 'RETURN_TO_VENDOR', 'Debit note to be raised on the supplier'],
    ['Machining', 'Ramesh Patil', 15, 'Cast iron block', 4, 'Blow holes found after rough machining', 'Casting', 'HOLD', 'Awaiting supplier analysis'],
  ];
  for (const [process, operator, itemNo, part, holdQty, defect, defectType, disposition, note] of rejDefs) {
    const r = await ensure(`rejection ${defect}`, null, (x) => x.defect === defect, '/qms/rejections', { rejectDate: day(5 + (holdQty % 8)), process, operator, itemId: itemNo ? it(itemNo) : undefined, part, holdQty, defect, defectType }, rejs);
    if (r && disposition !== 'HOLD' && !r.disposition) await step('dispose', 'POST', `/qms/rejections/${r.id}/dispose`, { disposition, note }, { 'if-match': `"${r.version}"` });
  }

  // ---- quality alerts (NCR page), 8D and CI forms (CAPA page)
  const forms = [];
  for (const k of ['ALERT', 'EIGHT_D', 'CI', 'MOM']) forms.push(...(await list(`/qms/forms?kind=${k}`)));
  // an earlier run listed forms without a kind and created duplicates: cancel every copy after the first of a title
  const seen = new Set();
  for (const f of [...forms].sort((a, b) => a.number.localeCompare(b.number))) {
    if (f.status !== 'Open') continue;
    if (seen.has(f.title)) { await step('cancel duplicate form', 'POST', `/qms/forms/${f.id}/cancel`, { reason: 'Duplicate created while seeding' }, { 'if-match': `"${f.version}"` }); f.status = 'Cancelled'; } else seen.add(f.title);
  }
  const fin = async (title, body, closeIt) => {
    const f = await ensure(`form ${title}`, null, (x) => x.title === title && x.status !== 'Cancelled', '/qms/forms', body, forms);
    if (f && closeIt && f.status !== 'Closed') await step('close form', 'POST', `/qms/forms/${f.id}/close`, { note: 'Verified effective after 30 days' }, { 'if-match': `"${f.version}"` });
    return f;
  };
  await fin('Alert: wrong grade of fasteners at assembly', { kind: 'ALERT', title: 'Alert: wrong grade of fasteners at assembly', docDate: day(4), data: { part: it(1), notification_date: day(4), issue: 'Grade 8.8 bolts found in a lot marked 10.9 at the pump line.', evidence_ok: 'Bolt head marking 10.9', evidence_not_ok: 'Bolt head marking 8.8', containment: 'Lot quarantined, 100 percent sorting done' }, itemId: it(1) }, true);
  await fin('Alert: customer complaint, panel door misaligned', { kind: 'ALERT', title: 'Alert: customer complaint, panel door misaligned', docDate: day(8), data: { part: it(24), notification_date: day(8), issue: 'Customer reported door gap above 3 mm on two panels.' }, customerId: C(2).id, itemId: it(24) }, false);
  await fin('Alert: coil insulation test failure', { kind: 'ALERT', title: 'Alert: coil insulation test failure', docDate: day(11), data: { part: it(16), notification_date: day(11), issue: 'Two motors failed the HV test at 1.5 kV.', containment: 'Batch on hold' }, itemId: it(16) }, false);
  await fin('8D: pump casing bore oversize', { kind: 'EIGHT_D', title: '8D: pump casing bore oversize', docDate: day(6), capaRef: 'CAPA-26-001', data: { d1_team: 'Quality head, Production supervisor, Tool room', d2_problem: 'Bore oversize 0.03 mm on 3 of 40 pump casings.', d3_containment: 'Stock sorted; 3 pieces re-bored.', why_made: 'Boring tool wear beyond limit', why_missed: 'In-process check frequency too low', d4_root_cause: 'Tool life not tracked; insert used beyond 400 pieces', d5_corrective: 'Insert change every 300 pieces, tool life counter added', d6_implemented: 'Implemented on CNC-01 on 12 Nov', d7_prevent: 'Tool life added to the in-process plan', d8_recognise: 'Team recognised in the monthly meeting' }, itemId: it(25) }, true);
  await fin('8D: powder coat thickness below limit', { kind: 'EIGHT_D', title: '8D: powder coat thickness below limit', docDate: day(10), capaRef: 'CAPA-26-002', data: { d1_team: 'Painting supervisor, Quality engineer', d2_problem: 'Coating thickness 42 to 55 micron against 60 minimum on panel doors.', d3_containment: '6 doors re-coated' }, itemId: it(24) }, false);
  await fin('CI: reduce panel wiring time by 15 percent', { kind: 'CI', title: 'CI: reduce panel wiring time by 15 percent', docDate: day(3), data: { theme: 'Productivity', project_no: 'CI-26-007', start_date: day(3), end_date: day(28), category: 'P', team: 'Assembly team', before: '90 minutes per panel', target: '76 minutes per panel', why_1: 'Wire cutting is done at the bench', why_2: 'No pre-cut wire kit', why_3: 'Kit preparation not planned', root_cause: 'Wire kit not prepared in advance', actions: 'Pre-cut wire kits from the cutting station', after: '78 minutes per panel' } }, true);
  await fin('MOM: monthly quality review meeting, October', { kind: 'MOM', title: 'MOM: monthly quality review meeting, October', docDate: day(2), data: { agenda: 'PPM review, customer complaints, calibration status', own_reps: 'Quality head, Production head, Purchase', points: '1. Internal PPM 2400, target 2000. 2. Two open 8D. 3. Three gauges due for calibration.' } }, false);

  // ---- 5-why cases (screens page)
  const why5 = await list('/screens/qms-5why');
  const fw = [
    ['Pump casing bore oversize', 'Bore diameter oversize on 3 pieces', [['Why was the bore oversize?', 'The boring insert was worn'], ['Why was the insert worn?', 'It ran 420 pieces against a limit of 300'], ['Why was the limit crossed?', 'Nobody counted the pieces on the tool'], ['Why was it not counted?', 'No tool life counter on the machine'], ['Why no counter?', 'Not in the machine commissioning checklist']], 'Tool life not monitored', 'Add counter and change insert every 300 pieces'],
    ['Panel door paint peel-off', 'Paint peeled in the adhesion tape test', [['Why did the paint peel?', 'Poor adhesion on the sheet'], ['Why was adhesion poor?', 'Surface still had oil film'], ['Why was oil present?', 'Degreasing bath was weak']]],
    ['Late dispatch of gear boxes', 'Three gear box orders dispatched 4 days late', [['Why late?', 'Final assembly finished late'], ['Why?', 'Oil seals were not available']]],
  ];
  for (const [title, problem, steps, root, action] of fw)
    await ensure(`5-why ${title}`, null, (x) => x.title === title, '/screens/qms-5why', { values: { title, problem, department: 'Quality', ...(root ? { root, action } : {}) }, lines: steps.map(([why, answer]) => ({ why, answer })) }, why5);

  // ---- instruments and calibration
  const inst = await list('/qms/instruments');
  const instDefs = [
    ['HC-001', 'EQ-VC-01', 'Vernier caliper 0-150 mm', '0-150 mm', '0.02 mm', 'Mitutoyo', 'QC lab', 12, 'PASS', '2026-10-05', '2027-10-04'],
    ['HC-002', 'EQ-MM-02', 'Micrometer 25-50 mm', '25-50 mm', '0.01 mm', 'Mitutoyo', 'QC lab', 12, 'PASS', '2026-09-20', '2027-09-19'],
    ['HC-003', 'EQ-DG-03', 'Dial gauge 0-10 mm', '0-10 mm', '0.01 mm', 'Baker', 'Machine shop', 6, 'PASS', '2026-06-10', '2026-12-09'],
    ['HC-004', 'EQ-HT-04', 'Hardness tester Rockwell', '20-70 HRC', '0.5 HRC', 'Fine Spavy', 'QC lab', 12, 'PASS', '2026-08-18', '2027-08-17'],
    ['HC-005', 'EQ-IR-05', 'Insulation tester 5 kV', '0-10 GOhm', '0.1 MOhm', 'Megger', 'Final test', 12, 'FAIL', '2026-10-28', '2027-10-27'],
    ['HC-006', 'EQ-TG-06', 'Thread plug gauge M12', 'M12x1.75 6H', 'Go/No-go', 'Vogel', 'Machine shop', 12, 'PASS', '2026-04-02', '2026-11-30'],
    ['HC-007', 'EQ-PG-07', 'Pressure gauge 0-10 bar', '0-10 bar', '0.1 bar', 'Wika', 'Pump test bench', 6, 'PASS', '2026-05-12', '2026-11-11'],
  ];
  for (const [hc, eq, name, range, lc, make, loc, freq, res, on, until] of instDefs) {
    const existed = inst.find((i) => i.equipmentNo === eq);
    const x = await ensure(`instrument ${eq}`, null, (i) => i.equipmentNo === eq, '/qms/instruments', { historyCardNo: hc, name, equipmentNo: eq, measuringRange: range, leastCount: lc, make, location: loc, frequencyMonths: freq, division: 'Quality' }, inst);
    if (x && !existed)
      await step('calibrate', 'POST', `/qms/instruments/${x.id}/calibrate`, { calibratedOn: on, validUntil: until, certificateNo: `CAL/${eq}/${on.slice(2, 4)}`, agency: 'Precision Calibration Labs, Pune', result: res, errorFound: res === 'FAIL' ? 'Reading drift above 5 percent at 5 kV' : undefined, note: res === 'FAIL' ? 'Sent for repair and re-calibration' : 'Within limits' });
  }

  // ---- quality cost
  const costs = (await call('GET', '/qms/costs?month=2026-11')).data?.rows ?? [];
  for (const [category, description, amount] of [['PREVENTION', 'Operator quality training, November', 18000], ['APPRAISAL', 'Calibration charges for gauges', 24500], ['INTERNAL_FAILURE', 'Rework of pump casings and panel doors', 31200], ['INTERNAL_FAILURE', 'Scrap of welded enclosures', 14800], ['EXTERNAL_FAILURE', 'Customer return handling, door misalignment', 9600]])
    await ensure(`cost ${description}`, null, (c) => c.description === description, '/qms/costs', { month: '2026-11', category, description, amount }, costs);

  // ---- Sawardari: a few records
  const sw = L.plant('Sawardari');
  const sInst = await list('/qms/instruments');
  const x = await ensure('Sawardari instrument', null, (i) => i.equipmentNo === 'SW-VC-01', '/qms/instruments', { historyCardNo: 'SW-HC-001', name: 'Vernier caliper 0-200 mm', equipmentNo: 'SW-VC-01', measuringRange: '0-200 mm', leastCount: '0.02 mm', make: 'Mitutoyo', location: 'Sawardari QC', frequencyMonths: 12, division: 'Quality' }, sInst);
  if (x && !sInst.some((i) => i.equipmentNo === 'SW-VC-01')) await step('calibrate', 'POST', `/qms/instruments/${x.id}/calibrate`, { calibratedOn: day(6), validUntil: '2027-11-05', certificateNo: 'CAL/SW-VC-01/26', agency: 'Precision Calibration Labs, Pune', result: 'PASS', note: 'Within limits' });
  const sInsp = await list('/qms/inspections');
  for (const [d, lotQty, ok] of [[7, 200, true], [10, 150, false]]) {
    if (sInsp.some((r) => r.kind === 'INCOMING' && String(r.docDate).slice(0, 10) === day(d))) { L.stats.skipped++; continue; }
    const rec = await ensure(`Sawardari INCOMING ${day(d)}`, null, () => false, '/qms/inspections', { kind: 'INCOMING', docDate: day(d), lotQty, header: headerFor('INCOMING', d + 40), rows: rowsFor('INCOMING', ok) }, []);
    if (rec) {
      let cur = (await call('GET', `/qms/inspections/${rec.id}`)).data;
      await step('submit', 'POST', `/qms/inspections/${cur.id}/submit`, { result: ok ? 'ACCEPTED' : 'REJECTED' }, { 'if-match': `"${cur.version}"` });
      cur = (await call('GET', `/qms/inspections/${rec.id}`)).data;
      await step('decide', 'POST', `/qms/inspections/${cur.id}/decide`, { acceptedQty: ok ? String(lotQty) : '0', rejectedQty: ok ? '0' : String(lotQty), note: ok ? 'Lot accepted' : 'Lot rejected, return to vendor' }, { 'if-match': `"${cur.version}"` });
    }
  }
});
L.summary('qms total');
