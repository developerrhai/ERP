// Service / Support demo data via the local API only: tickets, service requests, AMC contracts, warranty claims.
// Re-runnable: tickets by subject, requests by customer + type + estimate, AMC by serial coverage, claims by serial + problem.
// Not seedable through the API (no create endpoint): technicians, warranty terms and registrations, so visits, spares,
// technician board and warranty registration stay empty. Tickets can be created, responded, paused, resolved and closed, but not assigned.
// Run: node tools/seed-local/service-seed.mjs   (SEED_API defaults to http://localhost:4100/api/v1)
import * as L from './seedlib.mjs';
const { api, ensure, act, d, rnd } = L;

await L.login();
const units = (await api('GET', '/units')).data; const U = Object.fromEntries(units.map((u) => [u.code, u.id]));
await L.setUnit('TAL');
const CHECKERS = ['head.hr', 'mgr.sales.tal', 'gm.shinde'];
async function asChecker(fn) {
  for (const u of CHECKERS) { try { await L.actAs(u); const r = await fn(); L.actAsOwner(); if (r && r.status !== 403) return r; } catch { /* next */ } finally { L.actAsOwner(); } }
  return null;
}
const customers = ((await api('GET', '/customers')).data ?? []);
// serial numbers are read through a short SELECT-free route: the AMC and claim forms list them from the inventory serial register
const serialRows = await (async () => {
  const r = await api('GET', '/inventory/serials?size=50');
  return Array.isArray(r.data) ? r.data : (r.data?.rows ?? r.data?.items ?? []);
})();
console.log('serials visible:', serialRows.length);

// ------------------------------------------------------------------ tickets
const SITE = {
  TAL: 'Plot 24, MIDC Talwade, Pimpri-Chinchwad, Pune 412114', SAW: 'Gat No 331, Sawardari, Chakan, Pune 410501',
};
const TICKETS = [
  [0, 'Spindle overheating alarm on VMC after 2 hours of running', 'BREAKDOWN', 1, 1, 'respond', 'Anil Deshpande', '9822345671'],
  [1, 'Hydraulic power pack noise and pressure drop on 200T press', 'BREAKDOWN', 2, 1, 'resolve', 'Sagar Wable', '9890011223'],
  [2, 'Preventive maintenance request for die-casting machine 4', 'PM', 3, 3, 'new', 'Rohit Kulkarni', '9370112233'],
  [3, 'Conveyor VFD fault code E-OC', 'BREAKDOWN', 2, 2, 'close', 'Jitendra Patil', '9923456780'],
  [4, 'Request for operator training on new PLC HMI', 'INSTALLATION', 4, 3, 'respond', 'Mayuri Joshi', '9763401122'],
  [5, 'Coolant pump leakage at machining line 2', 'BREAKDOWN', 2, 2, 'pause', 'Dinesh Mane', '9850776655'],
  [6, 'Software upgrade of dispatch label printer', 'COMPLAINT', 4, 4, 'new', 'Pallavi Bhosale', '9822667788'],
  [7, 'Air compressor not loading, trips on high temperature', 'BREAKDOWN', 1, 2, 'close', 'Ravi Shetty', '9421098765'],
];
const tickets0 = (await api('GET', '/service/tickets?size=100')).data;
const tickets = Array.isArray(tickets0) ? tickets0 : (tickets0?.rows ?? []);
for (let i = 0; i < TICKETS.length; i++) {
  const [ci, subject, category, impact, urgency, flow, contactPerson, contactPhone] = TICKETS[i];
  const cust = customers[ci % customers.length];
  const unit = i % 3 === 2 ? 'SAW' : 'TAL';
  await L.setUnit(unit);
  const ex = tickets.find((t) => t.subject === subject);
  const t = await ensure(`ticket ${subject.slice(0, 40)}`, ex, 'POST', '/service/tickets', { customerId: cust.id, contactPerson, contactPhone, siteAddress: SITE[unit], subject, category, channel: ['PORTAL', 'PHONE', 'EMAIL'][i % 3], impact, urgency, serialNumberId: serialRows[i]?.id ?? undefined });
  if (t && !ex) {
    const id = t.id;
    if (['respond', 'resolve', 'close', 'pause'].includes(flow)) await act('respond', 'POST', `/service/tickets/${id}/respond`, {});
    if (flow === 'pause') await act('pause', 'POST', `/service/tickets/${id}/pause`, { pauseStatus: 'AWAITING_PARTS', reason: 'Waiting for mechanical seal kit from OEM' });
    if (['resolve', 'close'].includes(flow)) await act('resolve', 'POST', `/service/tickets/${id}/resolve`, { notes: 'Fault traced, part replaced and machine run for 4 hours without alarm.' });
    if (flow === 'close') await act('close', 'POST', `/service/tickets/${id}/close`, { rating: 4 + (i % 2) });
  }
  await L.setUnit('TAL');
}

// ------------------------------------------------------------------ service requests (installation, relocation, overhaul, upgrade)
{
  const have = await L.list('/screens/service-requests');
  const REQ = [[0, 'INSTALLATION', 185000], [1, 'RELOCATION', 92000], [2, 'OVERHAUL', 340000], [3, 'UPGRADE', 128000], [4, 'INSTALLATION', 76500], [5, 'OVERHAUL', 215000]];
  for (const [ci, type, estimate] of REQ) {
    const cust = customers[ci % customers.length];
    const ex = have.find((x) => JSON.stringify(x).includes(cust.name) && JSON.stringify(x).includes(type) && JSON.stringify(x).includes(String(estimate)));
    await ensure(`service request ${type} ${cust.name}`, ex, 'POST', '/screens/service-requests', { values: { customer: cust.id, type, estimate } });
  }
}

// ------------------------------------------------------------------ AMC contracts
{
  const ex0 = (await api('GET', '/service/amc-contracts?size=100')).data;
  const have = Array.isArray(ex0) ? ex0 : (ex0?.rows ?? []);
  const AMC = [
    [0, 'COMPREHENSIVE', '2026-10-01', '2027-09-30', 'QUARTERLY', 480000, 'QUARTERLY', [0, 1], 'active'],
    [1, 'NON_COMPREHENSIVE', '2026-11-01', '2027-10-31', 'HALF_YEARLY', 168000, 'QUARTERLY', [2, 3, 4], 'active'],
    [2, 'COMPREHENSIVE', '2026-04-01', '2027-03-31', 'MONTHLY', 720000, 'MONTHLY', [5, 6], 'active'],
    [3, 'COMPREHENSIVE', '2026-12-01', '2027-11-30', 'QUARTERLY', 252000, 'ANNUAL', [7], 'draft'],
    [4, 'NON_COMPREHENSIVE', '2026-11-15', '2027-11-14', 'QUARTERLY', 96000, 'QUARTERLY', [8], 'approved'],
  ];
  for (const [ci, coverage, startDate, endDate, visitFrequency, contractValue, billingFrequency, serialIdx, flow] of AMC) {
    const cust = customers[ci % customers.length];
    const assetSerialIds = serialIdx.map((k) => serialRows[k]?.id).filter(Boolean);
    const ex = have.find((a) => (a.customerId === cust.id || a.customer_id === cust.id) && String(a.startDate ?? a.start_date).startsWith(startDate));
    const c = await ensure(`AMC ${cust.name} ${startDate}`, ex, 'POST', '/service/amc-contracts', { customerId: cust.id, coverage, startDate, endDate, visitFrequency, contractValue, billingFrequency, assetSerialIds });
    const cur = ex ?? c; if (!cur) continue;
    const status = String(cur.status ?? 'DRAFT'), appr = String(cur.approvalStatus ?? cur.approval_status ?? '');
    if (!ex && flow !== 'draft') await asChecker(() => api('POST', `/service/amc-contracts/${cur.id}/approve`, {}));
    if (!ex && flow === 'active') { const r = await asChecker(() => api('POST', `/service/amc-contracts/${cur.id}/activate`, {})); console.log(`    activate AMC ${cust.name}: ${r?.ok ? 'ok' : r?.err}`); }
    if (!ex && flow === 'active' && startDate <= '2026-11-01') { const r = await api('POST', `/service/amc-contracts/${cur.id}/recognise-revenue`, { period: startDate.slice(0, 7) }); console.log(`    revenue ${startDate.slice(0, 7)}: ${r.ok ? 'ok' : r.err}`); }
  }
}

// ------------------------------------------------------------------ warranty claims (eligibility is computed; no warranty registration can be created through the API)
{
  const have0 = (await api('GET', '/service/warranty-claims?size=100')).data;
  const have = Array.isArray(have0) ? have0 : (have0?.rows ?? []);
  const sup = (await api('GET', '/suppliers?size=5')).data;
  const suppliers = Array.isArray(sup) ? sup : (sup?.rows ?? []);
  const CLAIMS = [
    [0, 8, d(3), 'Drive end bearing seized after 5 months of commissioning', 'REPAIR', 'inspect'],
    [1, 9, d(6), 'Control panel display flickering and intermittent shutdown', 'REPLACE', 'supplier'],
    [2, 2, d(9), 'Hydraulic cylinder rod seal leakage', 'REJECT', 'inspect'],
    [3, 3, d(11), 'Motor winding burnt, suspected supply surge', 'PENDING', 'new'],
    [4, 4, d(13), 'Spindle taper wear within 8 months', 'REPAIR', 'new'],
  ];
  for (const [ci, si, failureDate, problemDescription, decision, flow] of CLAIMS) {
    const cust = customers[ci % customers.length];
    const sid = serialRows[si]?.id; if (!sid) continue;
    const ex = have.find((c) => (c.problemDescription ?? c.problem_description) === problemDescription);
    const c = await ensure(`claim ${problemDescription.slice(0, 40)}`, ex, 'POST', '/service/warranty-claims', { customerId: cust.id, serialNumberId: sid, failureDate, problemDescription });
    if (c && !ex && ['inspect', 'supplier'].includes(flow)) {
      await act('inspect claim', 'POST', `/service/warranty-claims/${c.id}/inspect`, { inspectionResult: `Inspected at site on ${failureDate}: ${decision === 'REJECT' ? 'damage due to external cause, outside warranty terms' : 'defect confirmed, covered under manufacturer warranty'}.`, decision, claimCost: decision === 'REJECT' ? 0 : 38500 });
      if (flow === 'supplier' && suppliers[0]) await act('supplier claim', 'POST', `/service/warranty-claims/${c.id}/claim-supplier`, { supplierId: suppliers[0].id, supplierGrnRef: 'GRN/TAL/26-27/0011', supplierClaimAmount: 38500 });
    }
  }
}
L.summary('service-seed');
