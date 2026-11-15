// Seeds Logistics, Fleet and Gate demo data through the API: transporters, routes, freight rate cards and calculations, vehicles and
// their documents, drivers, fuel logs, vehicle services, shipments with tracking and POD, containers, and gate in / out / return passes.
// Re-runnable: natural keys are supplier name, route code, rate card code, vehicle reg no, licence no, shipment LR no, gate challan ref.
import * as L from './opslib.mjs';
const { call, ensure, step, list, day } = L;
await L.login();
const talwade = L.plant('Talwade');
const iso = (d, h = 10, m = 0) => `2026-11-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+05:30`;

await L.withApprovalsOff(['log-', 'fleet-', 'gate-'], async () => {
  // ---- transporters: suppliers flagged as transporters (created as contractors when missing), with a profile
  const sups = await list('/suppliers');
  const trDefs = [
    ['Shree Sai Roadlines', 'MH', 'Bhiwandi', '9822011101', 'AAFCS1123K', 4.5, '2027-03-31'],
    ['VRL Logistics Ltd', 'KA', 'Hubballi', '9845077702', 'AABCV3340L', 4.2, '2027-06-30'],
    ['Patel Transport Co', 'GJ', 'Ahmedabad', '9825033303', 'AAEFP7781M', 3.8, '2027-01-31'],
    ['Safexpress Pvt Ltd', 'DL', 'Gurugram', '9810044404', 'AAECS5512N', 4.6, '2027-09-30'],
  ];
  const T = {};
  for (const [name, st, city, mobile, pan, rating, ins] of trDefs) {
    let s = sups.find((x) => x.name === name);
    if (!s) s = await ensure(`transport supplier ${name}`, null, () => false, '/suppliers', { name, gstRegistrationType: 'UNREGISTERED', supplierType: 'CONTRACTOR', pan, stateCode: { MH: '27', KA: '29', GJ: '24', DL: '07' }[st], city, mobile }, []);
    else L.stats.skipped++;
    if (!s) continue;
    T[name] = s;
    const prof = await call('POST', `/transporters/${s.id}/profile`, { pan, vehicleTypes: ['TRUCK_19FT', 'TRUCK_32FT', 'TEMPO_14FT'], gtaRcm: true, insuranceValidTill: ins, rating });
    if (!prof.ok) console.log('warn profile', name, prof.status, prof.err, JSON.stringify(prof.details));
  }
  const transp = L.rowsOf((await call('GET', '/transporters')).data);
  L.summary('log transporters');

  // ---- routes: [code, name, origin, destination, km, hours, toll, primary transporter, stops]
  const routes = await list('/routes');
  const routeDefs = [
    ['RT-TAL-PUN', 'Talwade to Pune Chakan', 'Talwade', 'Chakan, Pune', 28, 1.5, 120, 'Shree Sai Roadlines', [[1, 'Dehu Road', 12, 10]]],
    ['RT-TAL-NSK', 'Talwade to Nashik MIDC', 'Talwade', 'Ambad, Nashik', 205, 5, 450, 'Shree Sai Roadlines', [[1, 'Lonavala bypass', 70, 15], [2, 'Igatpuri', 150, 15]]],
    ['RT-TAL-AMD', 'Talwade to Ahmedabad', 'Talwade', 'Naroda, Ahmedabad', 520, 11, 1150, 'Patel Transport Co', [[1, 'Vapi', 270, 20], [2, 'Surat', 360, 20]]],
    ['RT-TAL-BLR', 'Talwade to Bengaluru', 'Talwade', 'Peenya, Bengaluru', 845, 17, 1850, 'VRL Logistics Ltd', [[1, 'Kolhapur', 355, 20], [2, 'Hubballi', 560, 30]]],
    ['RT-TAL-DEL', 'Talwade to Delhi NCR', 'Talwade', 'Manesar, Gurugram', 1390, 28, 3200, 'Safexpress Pvt Ltd', [[1, 'Vadodara', 430, 20], [2, 'Jaipur', 1030, 30]]],
    ['RT-TAL-JNP', 'Talwade to JNPT port', 'Talwade', 'JNPT Nhava Sheva', 135, 4, 380, 'Shree Sai Roadlines', []],
  ];
  for (const [code, name, originPlace, destinationPlace, distanceKm, stdTransitHrs, tollCost, tr, stops] of routeDefs)
    await ensure(`route ${code}`, null, (r) => r.code === code, '/routes', { code, name, originUnitId: talwade.id, originPlace, destinationPlace, distanceKm, stdTransitHrs, tollCost, primaryTransporterId: T[tr]?.id, stops: stops.map(([seq, place, kmFromOrigin, stdHaltMin]) => ({ seq, place, kmFromOrigin, stdHaltMin })) }, routes);
  const R = Object.fromEntries((await list('/routes')).map((r) => [r.code, r]));
  for (const [code, , , , , , , tr] of routeDefs) if (R[code] && T[tr]) await call('POST', `/transporters/${T[tr].id}/lanes`, { routeId: R[code].id, vehicleType: 'TRUCK_19FT' });

  // ---- freight rate cards
  const cards = await list('/freight-rate-cards');
  const cardDefs = [
    ['FRC-PUN-TRIP', 'Shree Sai Roadlines', 'RT-TAL-PUN', 'TRUCK_19FT', 'PER_TRIP', { flatRate: 6500, minCharge: 6500 }, null],
    ['FRC-NSK-KG', 'Shree Sai Roadlines', 'RT-TAL-NSK', 'TRUCK_19FT', 'PER_KG_SLAB', { minCharge: 9000 }, [[0, 1000, 5.5], [1000.01, 5000, 4.2], [5000.01, 20000, 3.4]]],
    ['FRC-AMD-KM', 'Patel Transport Co', 'RT-TAL-AMD', 'TRUCK_32FT', 'PER_KM', { flatRate: 38, minKm: 400, fuelSurchargePct: 6 }, null],
    ['FRC-BLR-TRIP', 'VRL Logistics Ltd', 'RT-TAL-BLR', 'TRUCK_32FT', 'PER_TRIP', { flatRate: 58000, fuelSurchargePct: 5 }, null],
    ['FRC-DEL-KG', 'Safexpress Pvt Ltd', 'RT-TAL-DEL', 'TRUCK_32FT', 'PER_KG_SLAB', { minCharge: 24000 }, [[0, 2000, 11], [2000.01, 10000, 8.5], [10000.01, 25000, 6.8]]],
    ['FRC-JNP-CBM', 'Shree Sai Roadlines', 'RT-TAL-JNP', 'TRUCK_19FT', 'PER_CBM', { flatRate: 780, minCharge: 12000 }, null],
  ];
  for (const [code, tr, rc, vehicleType, basis, extra, slabs] of cardDefs) {
    if (!T[tr] || !R[rc]) continue;
    const c = await ensure(`rate card ${code}`, null, (x) => x.code === code, '/freight-rate-cards', { code, supplierId: T[tr].id, routeId: R[rc].id, vehicleType, basis, validFrom: '2026-04-01', validTill: '2027-03-31', ...extra, ...(slabs ? { slabs: slabs.map(([fromQty, toQty, rate]) => ({ fromQty, toQty, rate })) } : {}) }, cards);
    if (c && !['APPROVED'].includes(c.status) && code !== 'FRC-JNP-CBM') await step('approve rate card', 'POST', `/freight-rate-cards/${c.id}/approve`, {});
  }
  const RC = Object.fromEntries((await list('/freight-rate-cards')).map((c) => [c.code, c]));
  L.summary('log routes and rates');

  // ---- vehicles (own, leased, hired-style) and their documents
  const vehicles = await list('/vehicles');
  const vDefs = [
    ['MH04JK4821', 'TRUCK_19FT', 'OWN', true, 'Tata LPT 1918', 'DIESEL', 300, 4.2, 48210],
    ['MH12QP7730', 'TRUCK_32FT', 'OWN', true, 'Ashok Leyland 3718', 'DIESEL', 400, 3.6, 91420],
    ['MH14GT2207', 'TEMPO_14FT', 'LEASED', true, 'Eicher Pro 3015', 'DIESEL', 120, 5.8, 22940],
    ['MH46CD9087', 'CAR', 'OWN', false, 'Maruti Ertiga VXi CNG', 'CNG', 60, 16, 31870],
    ['MH43AD1156', 'FORKLIFT', 'OWN', false, 'Godrej 3T Diesel Forklift', 'DIESEL', 45, 2.2, 3120],
    ['MH05EK3340', 'TEMPO_14FT', 'OWN', true, 'Mahindra Bolero Pickup', 'DIESEL', 60, 11, 64880],
  ];
  for (const [regNo, vehicleType, ownership, isTransport, makeModel, fuelType, tankCapacityL, stdKmpl, currentOdometer] of vDefs)
    await ensure(`vehicle ${regNo}`, null, (v) => v.regNo === regNo, '/vehicles', { regNo, vehicleType, ownership, isTransport, makeModel, fuelType, tankCapacityL, stdKmpl, currentOdometer, unitId: talwade.id }, vehicles);
  const V = Object.fromEntries((await list('/vehicles')).map((v) => [v.regNo, v]));
  const docDefs = {
    MH04JK4821: [['RC', 'RC/MH04/2019/55120', '2034-06-30'], ['INS', 'POL/2026/MH04JK4821', '2027-05-14'], ['PUC', 'PUC/TH/881204', '2027-01-09'], ['FIT', 'FIT/MH04/2025/1822', '2027-08-22'], ['PERMIT', 'NP/MH/2024/33018', '2029-03-31']],
    MH12QP7730: [['RC', 'RC/MH12/2020/77310', '2035-02-28'], ['INS', 'POL/2026/MH12QP7730', '2026-12-04'], ['PUC', 'PUC/PN/220318', '2026-11-27'], ['FIT', 'FIT/MH12/2025/2290', '2026-11-08'], ['PERMIT', 'NP/MH/2023/21877', '2028-03-31']],
    MH14GT2207: [['RC', 'RC/MH14/2022/11742', '2037-04-30'], ['INS', 'POL/2026/MH14GT2207', '2027-02-17'], ['PUC', 'PUC/PM/455920', '2026-12-19'], ['FIT', 'FIT/MH14/2025/660', '2027-04-10'], ['PERMIT', 'SP/MH/2024/9901', '2029-03-31']],
    MH46CD9087: [['RC', 'RC/MH46/2023/40911', '2038-09-14'], ['INS', 'POL/2026/MH46CD9087', '2027-03-02'], ['PUC', 'PUC/NM/302110', '2027-02-11']],
    MH43AD1156: [['RC', 'RC/MH43/2021/18820', '2036-01-31'], ['INS', 'POL/2026/MH43AD1156', '2027-01-26'], ['PUC', 'PUC/TH/990127', '2026-11-30']],
    MH05EK3340: [['RC', 'RC/MH05/2018/90114', '2033-11-20'], ['INS', 'POL/2026/MH05EK3340', '2026-11-25'], ['PUC', 'PUC/KL/117740', '2027-01-15'], ['FIT', 'FIT/MH05/2025/3011', '2027-05-05'], ['PERMIT', 'SP/MH/2022/5501', '2027-03-31']],
  };
  for (const [reg, docs] of Object.entries(docDefs)) {
    const v = V[reg]; if (!v) continue;
    const have = (await call('GET', `/vehicles/${v.id}`)).data?.documents ?? [];
    for (const [docTypeCode, docNo, expiryDate] of docs) {
      if (have.some((d) => d.docTypeCode === docTypeCode)) { L.stats.skipped++; continue; }
      const r = await call('POST', `/vehicles/${v.id}/documents`, { docTypeCode, docNo, issueDate: '2025-11-01', expiryDate, authority: 'RTO Maharashtra' });
      if (r.ok) { L.stats.created++; console.log(`ok   vehicle doc ${reg} ${docTypeCode}`); } else { L.stats.failed++; console.log('FAIL vehicle doc', reg, docTypeCode, r.status, r.err); }
    }
  }

  // ---- drivers
  const drivers = await list('/drivers');
  for (const [name, mobile, licenceNo, licenceClass, licenceExpiry, hazardousEndorsement] of [
    ['Ramesh Pawar', '9822100011', 'MH0420120045123', 'HMV', '2029-03-18', false],
    ['Sanjay Gaikwad', '9823100022', 'MH1220100088231', 'HMV', '2028-07-09', true],
    ['Dilip Shinde', '9822100033', 'MH1420150012876', 'LMV', '2027-12-30', false],
    ['Anwar Sheikh', '9850100044', 'MH4620180033907', 'HMV', '2026-12-10', false],
    ['Prakash Jadhav', '9890100055', 'MH0520130067412', 'HMV', '2026-11-20', false],
  ]) await ensure(`driver ${name}`, null, (d) => d.licenceNo === licenceNo, '/drivers', { name, mobile, licenceNo, licenceClass, licenceExpiry, hazardousEndorsement }, drivers);
  const D = Object.fromEntries((await list('/drivers')).map((d) => [d.name, d]));

  // ---- fuel logs: [vehicle, driver, day, odometer, litres, rate, post]
  const fuel = await list('/fuel-logs');
  const fuelDefs = [
    ['MH04JK4821', 'Ramesh Pawar', 2, 48500, 62, 91.4, true], ['MH04JK4821', 'Ramesh Pawar', 9, 49070, 138, 91.6, true], ['MH04JK4821', 'Sanjay Gaikwad', 14, 49640, 134, 91.8, false],
    ['MH12QP7730', 'Sanjay Gaikwad', 3, 91890, 120, 91.4, true], ['MH12QP7730', 'Sanjay Gaikwad', 10, 92560, 186, 91.6, true],
    ['MH14GT2207', 'Dilip Shinde', 5, 23210, 46, 91.5, true], ['MH14GT2207', 'Dilip Shinde', 12, 23590, 66, 91.7, false],
    ['MH46CD9087', 'Anwar Sheikh', 6, 32200, 22, 86, true], ['MH05EK3340', 'Prakash Jadhav', 8, 65240, 33, 91.6, true],
  ];
  for (const [reg, drv, d, odometer, litres, rate, post] of fuelDefs) {
    const v = V[reg]; if (!v) continue;
    const exists = fuel.find((f) => (f.vehicleId === v.id || f.regNo === reg) && Number(f.odometer) === odometer);
    let f = exists;
    if (!f) { f = await ensure(`fuel ${reg} ${odometer}`, null, () => false, '/fuel-logs', { vehicleId: v.id, driverId: D[drv]?.id, filledAt: iso(d, 7, 30), odometer, litres, rate, isFullTank: true }, []); if (f) fuel.push(f); } else L.stats.skipped++;
    if (f && post && f.status === 'DRAFT') await step('post fuel', 'POST', `/fuel-logs/${f.id}/post`, {});
  }

  // ---- vehicle services: [vehicle, type, due km, due date, service date, odometer, lines, state]
  const svcs = await list('/vehicle-services');
  const svcDefs = [
    ['MH04JK4821', 'PERIODIC', 50000, '2026-11-20', null, null, [['LABOUR', 'Periodic service labour', 1, 3500], ['PART', 'Engine oil 15W40, 12 L', 12, 420], ['PART', 'Oil and fuel filter set', 1, 1850]], 'SCHEDULED'],
    ['MH12QP7730', 'BRAKE', 92000, '2026-11-12', '2026-11-12', 92100, [['LABOUR', 'Brake overhaul labour', 1, 4200], ['PART', 'Brake lining set', 1, 7600], ['PART', 'Brake drum turning', 2, 650]], 'POSTED'],
    ['MH14GT2207', 'TYRE', 25000, '2026-11-18', null, null, [['PART', 'Tyre 215/75 R15 retread', 2, 4800], ['LABOUR', 'Tyre fitting and balancing', 2, 400]], 'SCHEDULED'],
    ['MH05EK3340', 'PERIODIC', 65000, '2026-11-09', '2026-11-09', 65100, [['LABOUR', 'Service labour', 1, 1800], ['PART', 'Engine oil 15W40, 7 L', 7, 420], ['PART', 'Air filter', 1, 780]], 'POSTED'],
    ['MH43AD1156', 'REPAIR', 3200, '2026-11-14', '2026-11-14', 3150, [['LABOUR', 'Hydraulic hose replacement', 1, 2200], ['PART', 'Hydraulic hose 1.2 m', 2, 1750]], 'SCHEDULED'],
  ];
  const MAIN = L.rowsOf((await call('GET', '/lookups/warehouses?limit=50')).data).find((w) => w.code === 'TAL-MAIN')?.id;
  for (const [reg, serviceType, dueKm, dueDate, serviceDate, odometer, lines, state] of svcDefs) {
    const v = V[reg]; if (!v) continue;
    let s = svcs.find((x) => (x.vehicleId === v.id) && x.serviceType === serviceType && String(x.dueDate).slice(0, 10) === dueDate);
    if (!s) s = await ensure(`service ${reg} ${serviceType}`, null, () => false, '/vehicle-services', { vehicleId: v.id, serviceType, dueKm, dueDate, ...(serviceDate ? { serviceDate, odometer } : {}), downtimeHrs: serviceDate ? 6 : 0, lines: lines.map(([lineType, description, qty, rate]) => ({ lineType, description, qty, rate })) }, []);
    else L.stats.skipped++;
    if (s && state === 'POSTED' && s.status !== 'POSTED') await step('post service', 'POST', `/vehicle-services/${s.id}/post`, { warehouseId: MAIN });
  }
  L.summary('log fleet');

  // ---- shipments: [LR no, customer index, route, transporter, vehicle, driver, status steps, billed amount]
  const customers = (await list('/customers')).filter((c) => c.status === 'ACTIVE');
  const ships = await list('/shipments');
  const shDefs = [
    ['LR/TAL/2611/001', 0, 'RT-TAL-PUN', 'Shree Sai Roadlines', 'MH04JK4821', 'Ramesh Pawar', 'pod', 1200],
    ['LR/TAL/2611/002', 3, 'RT-TAL-NSK', 'Shree Sai Roadlines', null, null, 'pod', 4200],
    ['LR/TAL/2611/003', 7, 'RT-TAL-AMD', 'Patel Transport Co', null, 'Anwar Sheikh', 'transit', 9800],
    ['LR/TAL/2611/004', 10, 'RT-TAL-BLR', 'VRL Logistics Ltd', null, null, 'transit', 15600],
    ['LR/TAL/2611/005', 11, 'RT-TAL-DEL', 'Safexpress Pvt Ltd', null, null, 'dispatched', 7200],
    ['LR/TAL/2611/006', 14, 'RT-TAL-PUN', 'Shree Sai Roadlines', 'MH14GT2207', 'Dilip Shinde', 'planned', 650],
    ['LR/TAL/2611/007', 4, 'RT-TAL-NSK', 'Shree Sai Roadlines', 'MH05EK3340', 'Prakash Jadhav', 'delivered', 2800],
  ];
  for (const [lrNo, ci, rc, tr, reg, drv, state, weightKg] of shDefs) {
    const c = customers[ci % customers.length];
    let sh = ships.find((s) => s.lrNo === lrNo);
    if (!sh) {
      sh = await ensure(`shipment ${lrNo}`, null, () => false, '/shipments', { customerId: c.id, transporterId: T[tr]?.id, routeId: R[rc]?.id, ...(reg ? { vehicleId: V[reg]?.id, driverId: D[drv]?.id } : { hiredVehicleNo: ['GJ01XT9042', 'KA25AB3318', 'HR55AL7721'][ci % 3], hiredDriverName: 'Hired driver ' + lrNo.slice(-3), hiredDriverMobile: '98200000' + lrNo.slice(-2) }), plannedDispatchAt: iso(6 + (ci % 7), 9), plannedDeliveryAt: iso(8 + (ci % 7), 17), lrNo, lrDate: day(6 + (ci % 7)), weightKg, volumeCbm: Math.round(weightKg / 180) }, []);
      if (sh) ships.push(sh);
    } else L.stats.skipped++;
    if (!sh) continue;
    const cur = (await call('GET', `/shipments?size=100`)).data?.find?.((x) => x.id === sh.id) ?? sh;
    if (state !== 'planned' && !['DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'POD_RECEIVED', 'CLOSED'].includes(cur.status)) {
      const body = reg ? { vehicleId: V[reg]?.id, driverId: D[drv]?.id, transporterId: T[tr]?.id } : { hiredVehicleNo: ['GJ01XT9042', 'KA25AB3318', 'HR55AL7721'][ci % 3], transporterId: T[tr]?.id };
      await step('allocate', 'POST', `/shipments/${sh.id}/allocate`, body);
    }
    const ev = L.rowsOf((await call('GET', `/shipments/${sh.id}/events`)).data);
    const evSeq = { dispatched: [['DISPATCHED', 'Talwade gate']], transit: [['DISPATCHED', 'Talwade gate'], ['IN_TRANSIT', 'Highway checkpoint']], delivered: [['DISPATCHED', 'Talwade gate'], ['IN_TRANSIT', 'Highway checkpoint'], ['OUT_FOR_DELIVERY', 'Destination city']], pod: [['DISPATCHED', 'Talwade gate'], ['IN_TRANSIT', 'Highway checkpoint'], ['DELIVERED', 'Customer site']], planned: [] }[state];
    if (ev.filter((e) => e.source === 'MANUAL').length < evSeq.length)
      for (const [i, [milestone, location]] of evSeq.entries()) if (!ev.some((e) => e.milestone === milestone)) await step('track', 'POST', `/shipments/${sh.id}/events`, { milestone, location, note: `${milestone} at ${location}`, ...(milestone === 'IN_TRANSIT' && state === 'transit' ? { delayMins: lrNo.endsWith('4') ? 180 : 0, etaAt: iso(15, 17) } : {}) });
    if (state === 'pod' && !L.rowsOf((await call('GET', '/pods')).data).some((p) => p.shipmentId === sh.id)) {
      const p = await call('POST', '/pods', { shipmentId: sh.id, deliveredAt: iso(9 + (ci % 3), 15), receiverName: ['Mr. Joshi, stores', 'Mr. Deshmukh, receiving'][ci % 2], receiverMobile: '9822111222', remarks: 'Delivered in good condition' });
      if (p.ok) { L.stats.created++; console.log('ok   pod ' + lrNo); if (ci === 0) await step('release billing', 'POST', `/pods/${p.data.id}/release-billing`, {}); } else console.log('warn pod', p.status, p.err, JSON.stringify(p.details));
    }
    // freight calculation against the matching rate card
    const card = { 'RT-TAL-PUN': RC['FRC-PUN-TRIP'], 'RT-TAL-NSK': RC['FRC-NSK-KG'], 'RT-TAL-AMD': RC['FRC-AMD-KM'], 'RT-TAL-BLR': RC['FRC-BLR-TRIP'], 'RT-TAL-DEL': RC['FRC-DEL-KG'] }[rc];
    const done = L.rowsOf((await call('GET', '/freight-calculations')).data);
    if (card && card.status === 'APPROVED' && !done.some((x) => x.shipmentId === sh.id)) { const f = await call('POST', '/freight/calculate', { rateCardId: card.id, shipmentId: sh.id, weightKg, volumeCbm: Math.round(weightKg / 180), tollAmount: R[rc]?.tollCost ?? 0, loadingAmount: 600, gtaRcmApplicable: true, save: true }); if (f.ok) { L.stats.created++; console.log('ok   freight ' + lrNo); } else console.log('warn freight', f.status, f.err, JSON.stringify(f.details)); }
  }
  L.summary('log shipments');

  // ---- containers (ISO 6346 check digit computed)
  const iso6346 = (p10) => { const v = (ch) => { if (/\d/.test(ch)) return +ch; let n = ch.charCodeAt(0) - 55; n += Math.floor((n - 1) / 10); return n; }; let sum = 0; for (let i = 0; i < 10; i++) sum += v(p10[i]) * 2 ** i; return String((sum % 11) % 10); };
  const cno = (p10) => p10 + iso6346(p10);
  const cons = await list('/containers');
  for (const [containerNo, containerType, owner, freeDays, moves] of [
    [cno('MSKU771234'), '40HC', 'Maersk Line', 7, ['GATE_IN', 'STUFFED', 'GATE_OUT']], [cno('TGHU440012'), '20GP', 'Textainer', 5, ['GATE_IN', 'STUFFED']], [cno('CMAU330554'), '40GP', 'CMA CGM', 7, ['GATE_IN']], [cno('HLXU662398'), '20GP', 'Hapag-Lloyd', 5, ['GATE_IN', 'STUFFED', 'GATE_OUT', 'EMPTY_RETURN']],
  ]) {
    const c = await ensure(`container ${containerNo}`, null, (x) => x.containerNo === containerNo, '/containers', { containerNo, containerType, owner, freeDays }, cons);
    if (c && !cons.some((x) => x.containerNo === containerNo && x.id !== c.id) && (c.movements ?? []).length === 0 && !L.stats['mv' + containerNo]) {
      const have = L.rowsOf((await call('GET', '/containers')).data).find((x) => x.id === c.id);
      if (!have || (have.status ?? '') === '' || ['NEW', 'EMPTY', 'AVAILABLE', undefined].includes(have.status)) for (const eventType of moves) await step('container move', 'POST', `/containers/${c.id}/movements`, { eventType, location: 'Talwade yard', remarks: eventType.toLowerCase().replace('_', ' ') });
    }
  }

  // ---- gate passes
  const passes = await list('/gate-passes');
  const gp = async (ref, body) => {
    const hit = passes.find((p) => p.challanRef === ref);
    if (hit) { L.stats.skipped++; return hit; }
    const p = await ensure(`gate pass ${ref}`, null, () => false, '/gate-passes', { challanRef: ref, ...body }, []);
    if (p) passes.push(p);
    return p;
  };
  const items = {}; for (const r of await list('/pages/inv-items/records')) items[r.code] = r;
  const itemId = (n) => items[`ITM/000${n}`].id;
  const wh = L.rowsOf((await call('GET', '/lookups/warehouses?limit=50')).data);
  const outWh = (wh.find((w) => /job|transit|returnable/i.test(w.name))?.id) ?? wh.find((w) => w.code === 'TAL-FG').id;
  const sup = (await list('/suppliers')).filter((s) => s.status === 'ACTIVE' && s.supplierType === 'MATERIAL');
  // inward: supplier visits and returns
  for (const [ref, vehicleNo, party, purpose, sIdx, steps, qty, desc] of [
    ['GI-DEMO-01', 'MH43BX2210', 'Alfa Metals Pvt Ltd', 'Sample material for approval', 0, 'exit', 4, 'MS plate sample pieces'],
    ['GI-DEMO-02', 'GJ05AU7714', 'Eagle Packaging Pvt Ltd', 'Packing material delivery without PO, to be regularised', 4, 'inside', 400, 'Corrugated box large'],
    ['GI-DEMO-03', 'MH12LK6609', 'Laxmi Lubricants Pvt Ltd', 'Cutting oil drums, advance delivery', 11, 'at-gate', 6, 'Cutting oil 20 L drum'],
  ]) {
    const p = await gp(ref, { direction: 'IN', passType: 'INWARD_OTHER', gateName: 'MAIN_GATE', partyType: 'SUPPLIER', supplierId: sup[sIdx % sup.length]?.id, partyName: party, vehicleNo, driverName: 'Supplier driver', driverMobile: '9822000000', purpose, challanWeightKg: 900, lines: [{ description: desc, uom: 'NOS', qty, unitRate: 100 }] });
    if (!p) continue;
    let cur = (await call('GET', `/gate-passes/${p.id}`)).data;
    if (steps !== 'at-gate' && cur.status === 'DRAFT') { await step('enter', 'POST', `/gate-passes/${p.id}/enter`, { weighInKg: 8450 }); cur = (await call('GET', `/gate-passes/${p.id}`)).data; }
    if (steps === 'exit' && cur.status === 'INSIDE') { await step('weigh', 'POST', `/gate-passes/${p.id}/weigh`, { weighOutKg: 8100 }); await step('exit', 'POST', `/gate-passes/${p.id}/exit`, {}); }
  }
  // outward: returnable (job work) and non-returnable (scrap, samples)
  const out = [
    ['GX-DEMO-01', 'RETURNABLE', 'Outside powder coating, job work (2 pass cycle)', 'MH04JK4821', 'exit', 'Epoxy powder coat job work: MS enclosure panels', itemId('08'), 80, 164, 'INPUT'],
    ['GX-DEMO-02', 'RETURNABLE', 'Heat treatment of EN8 shafts at vendor', 'MH12QP7730', 'pending', 'Gear shaft blanks for heat treatment', itemId('11'), 120, 200, 'INPUT'],
    ['GX-DEMO-03', 'NON_RETURNABLE', 'Scrap sold to Shree Metal Traders', 'MH14GT2207', 'exit', 'Cast iron turning scrap', itemId('14'), 35, 236, 'NONE'],
    ['GX-DEMO-04', 'NON_RETURNABLE', 'Free sample to customer, approved by sales head', 'MH46CD9087', 'draft', 'Aluminium bar sample 25 mm', itemId('09'), 5, 176, 'NONE'],
  ];
  for (const [ref, passType, purpose, vehicleNo, steps, desc, iid, qty, rate, jw] of out) {
    const p = await gp(ref, { direction: 'OUT', passType, gateName: 'MAIN_GATE', partyType: 'OTHER', partyName: passType === 'RETURNABLE' ? 'Jaykar Coatings Pvt Ltd' : 'Shree Metal Traders', vehicleNo, driverName: 'Ramesh Pawar', driverMobile: '9822100011', purpose, isChallan: true, ...(passType === 'RETURNABLE' ? { expectedReturnDate: '2026-12-10' } : {}), lines: [{ itemId: iid, description: desc, uom: 'KG', qty, unitRate: rate, hsnCode: '7208', jobworkCategory: jw, sourceWarehouseId: wh.find((w) => w.code === 'TAL-MAIN').id, ...(passType === 'RETURNABLE' ? { outWarehouseId: outWh } : {}) }] });
    if (!p) continue;
    let cur = (await call('GET', `/gate-passes/${p.id}`)).data;
    if (steps !== 'draft' && cur.approvalStatus === 'PENDING' && steps !== 'pending-hold') { if (steps !== 'pending') { await step('approve', 'POST', `/gate-passes/${p.id}/approve`, {}); cur = (await call('GET', `/gate-passes/${p.id}`)).data; } }
    if (steps === 'exit' && cur.status !== 'EXITED' && cur.approvalStatus === 'APPROVED') await step('exit', 'POST', `/gate-passes/${p.id}/exit`, {});
  }
  // a returnable comes back: inward return pass and recorded return
  const outP = passes.find((p) => p.challanRef === 'GX-DEMO-01');
  if (outP && !passes.some((p) => p.challanRef === 'GR-DEMO-01')) {
    const od = (await call('GET', `/gate-passes/${outP.id}`)).data;
    if (od.status === 'EXITED') {
      const back = await gp('GR-DEMO-01', { direction: 'IN', passType: 'INWARD_RETURN', gateName: 'MAIN_GATE', partyType: 'OTHER', partyName: 'Jaykar Coatings Pvt Ltd', vehicleNo: 'MH04JK4821', driverName: 'Ramesh Pawar', purpose: 'Return of coated panels, part quantity', lines: [{ itemId: od.lines[0].itemId, description: 'Coated panels returned', uom: 'KG', qty: 50, unitRate: 116 }] });
      if (back) { await step('enter', 'POST', `/gate-passes/${back.id}/enter`, { weighInKg: 7800 }); await step('return', 'POST', `/gate-passes/${back.id}/returns`, { returns: [{ outLineId: od.lines[0].id, qty: 50, condition: 'GOOD', remarks: 'Coating complete, 50 kg received back' }] }); }
    }
  }

  // ---- Sawardari: a vehicle with documents, a driver and an inward gate pass
  const saw = L.plant('Sawardari');
  const swVeh = await list('/vehicles');
  const sv = await ensure('Sawardari vehicle', null, (v) => v.regNo === 'MH15FG6021', '/vehicles', { regNo: 'MH15FG6021', vehicleType: 'TEMPO_14FT', ownership: 'OWN', isTransport: true, makeModel: 'Tata Ace Gold', fuelType: 'DIESEL', tankCapacityL: 30, stdKmpl: 14, currentOdometer: 18420, unitId: saw.id }, swVeh);
  if (sv && !swVeh.some((v) => v.regNo === 'MH15FG6021')) for (const [docTypeCode, docNo, expiryDate] of [['RC', 'RC/MH15/2022/6021', '2037-05-12'], ['INS', 'POL/2026/MH15FG6021', '2027-04-02'], ['PUC', 'PUC/NK/55120', '2027-01-20'], ['FIT', 'FIT/MH15/2025/410', '2027-06-30'], ['PERMIT', 'SP/MH/2024/7710', '2029-03-31']]) await step('vehicle doc', 'POST', `/vehicles/${sv.id}/documents`, { docTypeCode, docNo, issueDate: '2025-11-01', expiryDate, authority: 'RTO Nashik' });
  const swDrv = await list('/drivers');
  await ensure('Sawardari driver', null, (d) => d.licenceNo === 'MH1520140098765', '/drivers', { name: 'Kishor Bhosale', mobile: '9890200066', licenceNo: 'MH1520140098765', licenceClass: 'LMV', licenceExpiry: '2028-09-14' }, swDrv);
  const swPass = await list('/gate-passes');
  if (!swPass.some((p) => p.challanRef === 'GI-DEMO-S1')) await ensure('Sawardari gate pass', null, () => false, '/gate-passes', { direction: 'IN', passType: 'INWARD_OTHER', gateName: 'MAIN_GATE', partyType: 'OTHER', partyName: 'Sagar Hardware, Nashik', vehicleNo: 'MH15BQ3382', driverName: 'Sagar driver', driverMobile: '9822000099', purpose: 'Welding consumables hand delivery', challanRef: 'GI-DEMO-S1', challanWeightKg: 180, lines: [{ description: 'Welding rod 3.15 mm, 5 boxes', uom: 'BOX', qty: 5, unitRate: 540 }] }, []);
  else L.stats.skipped++;
});
L.summary('logistics total');
