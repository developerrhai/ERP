// Assets demo data via the local API only: capitalisation of CWIP assets, allocation, transfer, depreciation runs, disposal.
// Re-runnable: capitalisation by asset, allocation by asset + employee, transfer / disposal by asset, depreciation run by area + period.
// Asset maintenance (non-machine assets) cannot be seeded: the API has no endpoint to create a new asset, and every asset here is a machine or equipment.
// Run: node tools/seed-local/assets-seed.mjs   (SEED_API defaults to http://localhost:4100/api/v1)
import * as L from './seedlib.mjs';
const { api, ensure, act, d } = L;

await L.login();
const units = (await api('GET', '/units')).data; const U = Object.fromEntries(units.map((u) => [u.code, u.id]));
await L.setUnit('TAL');
const CHECKERS = ['head.finance', 'mgr.finance', 'cfo.deshpande', 'gm.shinde'];
async function asChecker(fn) {
  for (const u of CHECKERS) { try { await L.actAs(u); const r = await fn(); L.actAsOwner(); if (r && r.status !== 403) return r; } catch { /* next */ } finally { L.actAsOwner(); } }
  return null;
}
const page = '?page=1&size=100';
const emps = (await L.list('/hr/employees')).filter((e) => e.status === 'ACTIVE' && e.unitName === 'Talwade').sort((a, b) => a.empCode.localeCompare(b.empCode));
const register = (await api('GET', '/assets/register' + page)).data ?? [];
const byNo = Object.fromEntries(register.map((a) => [a.assetNo, a]));
const A = (n) => byNo[`AST/TAL/26-27/00${String(n).padStart(2, '0')}`];

// ------------------------------------------------------------------ capitalisation (CWIP assets 1 to 4)
{
  const caps = (await api('GET', '/assets/capitalisations' + page)).data ?? [];
  const COST = { 1: [2150000, 85000, 120000, 45000], 2: [1480000, 60000, 90000, 30000], 3: [865000, 32000, 48000, 0], 4: [1950000, 70000, 0, 25000] };
  for (const n of [1, 2, 3, 4]) {
    const a = A(n); if (!a) continue;
    if (caps.find((c) => c.assetId === a.id)) { L.stats.skipped++; continue; }
    const [base, freight, install, test] = COST[n];
    const lines = [{ component: 'BASE', sourceDocRef: `PI/26-27/${300 + n}`, amount: base, glSourceAccount: '3009', gstAmount: Math.round(base * 0.18), gstAddedToCost: false }, { component: 'FREIGHT', sourceDocRef: `FRT/26-27/${40 + n}`, amount: freight, glSourceAccount: '3009', gstAmount: Math.round(freight * 0.05), gstAddedToCost: false }];
    if (install) lines.push({ component: 'INSTALLATION', sourceDocRef: `INS/26-27/${10 + n}`, amount: install, glSourceAccount: '3009' });
    if (test) lines.push({ component: 'TESTING', sourceDocRef: `TST/26-27/${5 + n}`, amount: test, glSourceAccount: '3009' });
    const c = await ensure(`capitalisation ${a.assetNo}`, null, 'POST', '/assets/capitalisations', { assetId: a.id, capitalisationDate: d(5 + n), source: n % 2 ? 'PURCHASE' : 'CWIP', lines });
    if (c && n <= 3) {
      await act('submit cap', 'POST', `/assets/capitalisations/${c.id}/submit`, {}, { 'if-match': `"${c.version ?? 1}"` });
      const cur = (await api('GET', `/assets/capitalisations/${c.id}`)).data;
      await asChecker(() => api('POST', `/assets/capitalisations/${c.id}/approve`, {}, { 'if-match': `"${cur?.version ?? 2}"` }));
      const cur2 = (await api('GET', `/assets/capitalisations/${c.id}`)).data;
      if (n <= 2) await act('post cap', 'POST', `/assets/capitalisations/${c.id}/post`, {}, { 'if-match': `"${cur2?.version ?? 3}"` });
    }
  }
}

// ------------------------------------------------------------------ allocation (to employees, some returned)
{
  const have = (await api('GET', '/assets/allocations' + page)).data ?? [];
  const ALLOC = [[10, 1, 'Maintenance', 'Machine shop', 'keep'], [11, 2, 'Production', 'Coating line', 'keep'], [12, 3, 'Production', 'Winding section', 'return'], [13, 4, 'Fabrication', 'Weld bay 1', 'keep'], [17, 5, 'Quality', 'Test lab', 'return'], [18, 0, 'Utilities', 'Chiller room', 'keep']];
  for (const [n, ei, department, location, flow] of ALLOC) {
    const a = A(n), e = emps[ei]; if (!a || !e) continue; // employeeId is not sent: allocating to an employee answers 500 on this server (see the report)
    const ex = have.find((x) => x.assetId === a.id);
    const r = await ensure(`allocation ${a.assetNo}`, ex, 'POST', '/assets/allocations', { assetId: a.id, department, location: `${location} (custodian ${e.firstName} ${e.lastName})`, allocatedOn: d(3 + (n % 5)), conditionOut: 'Good working condition, checked at handover', handoverDoc: `HO/TAL/26-27/${n}`, returnDue: flow === 'return' ? d(14) : '2027-03-31' });
    if (r && !ex && flow === 'return') await act('return allocation', 'POST', `/assets/allocations/${r.id}/return`, { returnedOn: d(13), conditionIn: 'Returned in good condition' });
  }
}

// ------------------------------------------------------------------ transfer (Talwade to Sawardari and within the plant)
{
  const have = (await api('GET', '/assets/transfers' + page)).data ?? [];
  const TR = [[13, 'SAW', 'Sawardari weld shop', 'complete'], [9, null, 'Talwade press shop, bay 4', 'approve'], [17, 'SAW', 'Sawardari test lab', 'submit'], [12, null, 'Talwade stores annexe', 'draft']];
  for (const [n, to, toLocation, flow] of TR) {
    const a = A(n); if (!a) continue;
    if (have.find((x) => x.assetId === a.id)) { L.stats.skipped++; continue; }
    const t = await ensure(`transfer ${a.assetNo}`, null, 'POST', '/assets/transfers', { assetId: a.id, toUnitId: to ? U[to] : undefined, toLocation, condition: 'Working' });
    if (!t) continue;
    const ver = () => ({ 'if-match': `"${t.version ?? 1}"` });
    if (flow !== 'draft') { const s = await api('POST', `/assets/transfers/${t.id}/submit`, {}, ver()); if (!s.ok) console.log('    submit transfer:', s.err); }
    if (flow === 'approve' || flow === 'complete') { const cur = (await api('GET', `/assets/transfers/${t.id}`)).data; const r = await asChecker(() => api('POST', `/assets/transfers/${t.id}/approve`, {}, { 'if-match': `"${cur?.version ?? 2}"` })); if (!r?.ok) console.log('    approve transfer:', r?.err); }
    if (flow === 'complete') { const cur = (await api('GET', `/assets/transfers/${t.id}`)).data; const r = await api('POST', `/assets/transfers/${t.id}/complete`, {}, { 'if-match': `"${cur?.version ?? 3}"` }); if (!r.ok) console.log('    complete transfer:', r.err); }
  }
}

// ------------------------------------------------------------------ depreciation runs (book: October and November 2026; tax: November)
{
  const runs = (await api('GET', '/assets/depreciation/runs' + page)).data ?? [];
  for (const [area, period] of [['BOOK', '2026-09'], ['BOOK', '2026-10'], ['TAX', '2026-10']]) {
    const ex = runs.find((r) => r.area === area && String(r.period).startsWith(period));
    const r = await ensure(`depreciation ${area} ${period}`, ex, 'POST', '/assets/depreciation/runs', { area, period });
    if (r && !ex && area === 'BOOK' && period === '2026-09') { const p = await asChecker(() => api('POST', `/assets/depreciation/runs/${r.id}/post`, {}, { 'if-match': `"${r.version ?? 1}"` })); console.log(`    post depreciation: ${p?.ok ? 'ok' : p?.err}`); }
  }
}

// ------------------------------------------------------------------ disposal (sale, scrap, write-off)
{
  const have = (await api('GET', '/assets/disposals' + page)).data ?? [];
  const DISP = [[18, 'SALE', 'Gokul Scrap and Machinery Traders, Bhosari', 185000, 'approve'], [11, 'SCRAP', null, 0, 'submit'], [10, 'WRITE_OFF', null, 0, 'draft']];
  for (const [n, method, buyer, saleValue, flow] of DISP) {
    const a = A(n); if (!a) continue;
    if (have.find((x) => x.assetId === a.id)) { L.stats.skipped++; continue; }
    const body = { assetId: a.id, method, disposalDate: d(12) };
    if (buyer) { body.buyer = buyer; body.saleValue = saleValue; body.gstOnSale = Math.round(saleValue * 0.18); body.gstIntraState = true; body.proceedsAccount = process.env.SEED_PROCEEDS_ACCOUNT || '1111'; }
    const x = await ensure(`disposal ${a.assetNo} ${method}`, null, 'POST', '/assets/disposals', body);
    if (!x) continue;
    if (flow !== 'draft') { const s = await api('POST', `/assets/disposals/${x.id}/submit`, {}, { 'if-match': `"${x.version ?? 1}"` }); if (!s.ok) console.log('    submit disposal:', s.err); }
    if (flow === 'approve') { const cur = (await api('GET', `/assets/disposals/${x.id}`)).data; const r = await asChecker(() => api('POST', `/assets/disposals/${x.id}/approve`, {}, { 'if-match': `"${cur?.version ?? 2}"` })); if (!r?.ok) console.log('    approve disposal:', r?.err); }
  }
}
L.summary('assets-seed');
