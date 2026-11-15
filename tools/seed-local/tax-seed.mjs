// Seeds Indian taxation demo records through the API: e-invoice IRN records, e-way bills, GSTR-1 / GSTR-3B filing marks,
// lower-deduction (TDS) certificates, an ITC reversal and a GSTR-2B import. The returns, registers, TDS and TCS summaries are computed
// from the sales and purchase documents, so they fill automatically from the invoices the other seeders create.
// Re-runnable: a record is skipped when its natural key (document, e-way bill no, certificate no, return month) exists.
import * as L from './opslib.mjs';
import { createHash } from 'node:crypto';
const { call, ensure, step, list } = L;
await L.login();
const hex64 = (s) => createHash('sha256').update(s).digest('hex');

await L.withApprovalsOff(['tax-'], async () => {
  const talwade = L.plant('Talwade');

  // ---- e-invoice (IRN recorded against pending invoices and credit notes)
  const pend = L.rowsOf((await call('GET', '/tax/einvoice/pending')).data);
  const recs = L.rowsOf((await call('GET', '/tax/einvoice/records')).data);
  for (const [i, d] of pend.slice(0, 4).entries()) {
    if (recs.some((r) => r.docNo === d.docNo)) { L.stats.skipped++; continue; }
    const r = await ensure(`e-invoice ${d.docNo}`, null, () => false, '/tax/einvoice', { docType: d.docType, docId: d.id, irn: hex64('IRN' + d.docNo), ackNo: String(parseInt(hex64('ACK' + d.docNo).slice(0, 10), 16) % 900000000000 + 100000000000), ackDate: `${d.date}T11:${10 + i}:00`, signedQr: 'eyJhbGciOiJSUzI1NiJ9.demo-signed-qr' }, []);
    if (r && i === 3) await step('e-invoice cancel', 'POST', `/tax/einvoice/${r.id}/cancel`, { reason: 'Wrong GSTIN entered, invoice re-issued' });
  }

  // ---- e-way bill
  const ew = L.rowsOf((await call('GET', '/tax/eway')).data);
  const ewp = L.rowsOf((await call('GET', '/tax/eway/pending')).data);
  const vehicles = ['MH12QR4418', 'MH14GT2207', 'MH04JK9031'];
  for (const [i, d] of ewp.slice(0, 3).entries()) {
    if (ew.some((e) => e.docNo === d.docNo || e.invoiceNo === d.docNo)) { L.stats.skipped++; continue; }
    const r = await ensure(`e-way bill ${d.docNo}`, null, () => false, '/tax/eway', { invoiceId: d.id, ewbNo: String(parseInt(hex64('EWB' + d.docNo).slice(0, 10), 16) % 900000000000 + 100000000000), ewbDate: `${d.date}T14:00:00`, distanceKm: [48, 215, 130][i], vehicleNo: vehicles[i], transporter: ['Shree Ganesh Roadlines', 'VRL Logistics', 'Safexpress'][i] }, []);
    if (r && i === 2) await step('e-way cancel', 'POST', `/tax/eway/${r.id}/cancel`, { reason: 'Goods not dispatched, order put on hold' });
  }

  // ---- TDS lower deduction certificates for two suppliers
  const certs = L.rowsOf((await call('GET', '/tax/tds/ldc')).data);
  const sup = (await list('/suppliers')).filter((s) => s.status === 'ACTIVE');
  for (const [i, [sec, cert, rate, max]] of [['194C', 'LDC/2627/10458', '0.5', '1500000'], ['194J', 'LDC/2627/11972', '1', '600000']].entries()) {
    if (!sup[i]) continue;
    await ensure(`LDC ${cert}`, null, (c) => c.certNo === cert, '/tax/tds/ldc', { supplierId: sup[i].id, sectionCode: sec, certNo: cert, ratePct: rate, validFrom: '2026-04-01', validTo: '2027-03-31', maxAmount: max }, certs);
  }

  // ---- ITC reversal (manual, rule 37 style)
  const rv = L.rowsOf((await call('GET', '/tax/itc/reversals?month=2026-11')).data?.rows ?? (await call('GET', '/tax/itc/reversals?month=2026-11')).data);
  const note = 'Reversal of ITC on invoices unpaid beyond 180 days, Rule 37';
  if (!rv.some((x) => x.note === note)) await ensure('ITC reversal', null, () => false, '/tax/itc/reversals', { kind: 'R37A', date: '2026-11-12', cgst: '2250', sgst: '2250', igst: '0', note }, []);
  else L.stats.skipped++;

  // ---- GSTR-2B import (a small portal-style file)
  const b2 = (await call('GET', '/tax/gstr2b?month=2026-10')).data;
  if (!(b2?.lines?.length || b2?.rows?.length || b2?.total)) {
    const payload = { data: { docdata: { b2b: [{ ctin: sup[0]?.gstin ?? '27SXCHN5837T1ZI', inv: [{ inum: 'AM/26-27/0418', idt: '12-10-2026', val: 118000, pos: '27', rchrg: 'N', itms: [{ itm_det: { txval: 100000, rt: 18, camt: 9000, samt: 9000, iamt: 0, csamt: 0 } }] }] }] } } };
    await ensure('GSTR-2B import Oct', null, () => false, '/tax/gstr2b/import', { month: '2026-10', sourceName: 'GSTR2B_27ABCDE1234F1Z5_102026.json', payload }, []);
  } else L.stats.skipped++;

  // ---- returns: mark October 2026 GSTR-1 and GSTR-3B as filed
  const filed = L.rowsOf((await call('GET', '/tax/returns')).data);
  for (const [type, arn, on] of [['GSTR1', 'AA2710260012345', '2026-11-11'], ['GSTR3B', 'AA2710260067890', '2026-11-20']])
    await ensure(`${type} filed Oct 2026`, null, (x) => x.type === type && String(x.period ?? x.month).startsWith('2026-10'), '/tax/returns/file', { type, month: '2026-10', arn, filedOn: on > '2026-11-15' ? '2026-11-15' : on }, filed);
});
L.summary('tax total');
