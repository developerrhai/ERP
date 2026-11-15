// Seeds demo Procurement data on the LOCAL ui database through the API only (validation, numbering and plant rules apply).
// Re-runnable: each record carries a natural key (purpose / notes / vendor invoice no. beginning "SEED-") and is skipped when it exists.
// Chain: PR -> RFQ -> vendor quotes -> comparison -> award -> PO -> GRN -> purchase invoice (and PR -> PO directly).
// Run: node tools/seed-local/procurement-seed.mjs        (env SEED_API, default http://localhost:4100/api/v1)
import * as L from './lib.mjs';
const { api, list, ensure, act, d, ifm } = L;

await L.login();
await L.setUnit('TAL');

const suppliers = await list('/suppliers');
const sup = (name) => suppliers.find((s) => s.name.startsWith(name));
const itemsAll = (await list('/pages/inv-items/records')).map((r) => ({ id: r.id, code: r.code, name: r.data.itemName, ...r.data }));
const item = (c) => itemsAll.find((i) => i.code === c);
const whs = Object.fromEntries((await api('GET', '/lookups/warehouses')).data.map((w) => [w.code, w.id]));
const terms = await list('/payment-terms');
const term = (code) => terms.find((t) => t.code === code)?.id ?? null;
const rate = (c, f = 1) => String(Math.round(Number(item(c).standardCost) * f * 100) / 100);

// generic step runner: only run a document action when its status allows it
async function step(label, base, id, verb, allowed, body) {
  const cur = (await api('GET', `${base}/${id}`)).data;
  if (!allowed.includes(cur.status)) return cur;
  const r = await act(`${label} ${verb}`, 'POST', `${base}/${id}/${verb}`, body, ifm(cur.version));
  if (r.ok) console.log(`    ${label}: ${verb}`);
  return (await api('GET', `${base}/${id}`)).data;
}
const byKey = (rows, field, key) => rows.find((r) => (r[field] ?? '').startsWith(key));

// ============================================================================================ purchase requisitions
async function requisitions() {
  console.log('Purchase requisitions');
  const prs = await list('/scm/pr');
  const pl = (c, qty, f = 1.05) => ({ itemId: item(c).id, qty, uom: item(c).baseUom, estRate: rate(c, f), requiredDate: d(26) });
  const plan = [
    ['SEED-PR-01', 'MS plates for BLDC motor housings', [pl('ITM/00001', 2000), pl('ITM/00002', 1500)], 'approved'],
    ['SEED-PR-02', 'Copper wire for winding department', [pl('ITM/00005', 800), pl('ITM/00006', 600)], 'approved'],
    ['SEED-PR-03', 'Silicon steel lamination and magnets', [pl('ITM/00008', 1200), pl('ITM/00009', 300)], 'approved'],
    ['SEED-PR-04', 'Powder coat and insulation paper', [pl('ITM/00010', 400), pl('ITM/00014', 250)], 'approved'],
    ['SEED-PR-05', 'Maintenance spares for press shop', [pl('ITM/00031', 40), pl('ITM/00036', 12), pl('ITM/00040', 30)], 'approved'],
    ['SEED-PR-06', 'Packing material for November dispatches', [pl('ITM/00059', 200), pl('ITM/00058', 150)], 'approved'],
    ['SEED-PR-07', 'Brass rod and round bar for turning shop', [pl('ITM/00012', 500), pl('ITM/00013', 300)], 'approved'],
    ['SEED-PR-08', 'Safety consumables quarterly', [pl('ITM/00051', 120), pl('ITM/00052', 60)], 'draft'],
    ['SEED-PR-09', 'Cutting inserts for CNC shop', [pl('ITM/00045', 100)], 'draft'],
    ['SEED-PR-10', 'Aluminium bar for heat sinks', [pl('ITM/00007', 700)], 'pending'],
  ];
  for (const [ref, purpose, lines, end] of plan) {
    let pr = byKey(prs, 'purpose', ref);
    if (pr) L.stats.skipped++;
    else pr = await ensure(`PR ${ref}`, null, 'POST', '/scm/pr', { requiredDate: d(26), supplierType: 'MATERIAL', purpose: `${ref} ${purpose}`, lines });
    if (!pr?.id || end === 'draft') continue;
    await step(`PR ${ref}`, '/scm/pr', pr.id, 'submit', ['Draft']);
  }
}

// ============================================================================================ RFQ -> quotes -> comparison -> PO
async function sourcing() {
  const prs = await list('/scm/pr');
  const prOf = (ref) => byKey(prs, 'purpose', ref);

  console.log('RFQs');
  const rfqs = await list('/scm/rfq');
  const rfqPlan = [
    ['SEED-PR-01', ['Alfa Metals', 'Bhavani Steel', 'Mangal Castings'], 'quoted'],
    ['SEED-PR-03', ['Samarth Laminations', 'Ishwar Magnets', 'Harsh Electricals'], 'quoted'],
    ['SEED-PR-04', ['Jaykar Coatings', 'Parag Enamel'], 'issued'],
    ['SEED-PR-07', ['Gajanan Tools', 'Mangal Castings', 'Krishna Fasteners'], 'invited'],
    ['SEED-PR-06', ['Eagle Packaging', 'Fortune Polymers'], 'draft'],
  ];
  const rfqByPr = {};
  for (const [prRef, names, end] of rfqPlan) {
    const pr = prOf(prRef); if (!pr) continue;
    const tag = `SEED-RFQ for ${prRef}`;
    let rfq = rfqs.find((r) => (r.notes ?? '').startsWith(tag));
    if (rfq) L.stats.skipped++;
    else {
      const r = await act(`PR ${prRef} to-rfq`, 'POST', `/scm/pr/${pr.id}/to-rfq`, { dueDate: d(22) });
      if (!r.ok) continue;
      L.stats.created++; console.log(`  + RFQ from ${prRef}`);
      rfq = r.data; const full = (await api('GET', `/scm/rfq/${rfq.id ?? rfq.rfqId}`)).data;
      rfq = full ?? rfq;
      const upd = await api('PUT', `/scm/rfq/${rfq.id}`, { notes: `${tag} (quotes requested from approved suppliers)` }, ifm(rfq.version));
      if (!upd.ok) console.log('  ! rfq notes', upd.err);
    }
    if (!rfq?.id) continue;
    rfqByPr[prRef] = rfq.id;
    if (end === 'draft') continue;
    let cur = await step(`RFQ ${prRef}`, '/scm/rfq', rfq.id, 'submit', ['Draft']);
    if (cur.issuedAt) continue;
    await act(`RFQ ${prRef} invite`, 'POST', `/scm/rfq/${rfq.id}/invite`, { supplierIds: names.map((n) => sup(n).id) });
    if (end === 'invited') continue;
    cur = await step(`RFQ ${prRef}`, '/scm/rfq', rfq.id, 'issue', ['Approved']);
  }

  console.log('Vendor quotes');
  const vqs = await list('/scm/vendorquote');
  const vqFor = async (prRef, supplierName, f, lead, tag, compliance = true) => {
    const rfqId = rfqByPr[prRef]; if (!rfqId) return null;
    const key = `SEED-VQ ${tag}`;
    let vq = vqs.find((v) => (v.notes ?? '').startsWith(key));
    if (vq) { L.stats.skipped++; return vq; }
    const rfq = (await api('GET', `/scm/rfq/${rfqId}`)).data;
    const lines = (rfq.lines ?? []).map((l) => ({ rfqLineId: l.id, itemId: l.itemId, qty: l.qty, uom: l.uom, rate: rate(l.itemCode ?? itemsAll.find((i) => i.id === l.itemId)?.code, f), discountPct: '2', gstPct: '18', leadDays: lead }));
    return ensure(`vendor quote ${tag}`, null, 'POST', '/scm/vendorquote', { rfqId, supplierId: sup(supplierName).id, quoteDate: d(10), validUntil: '2026-12-15', paymentTermId: term('NET30') ?? term('IMMEDIATE'), freight: '1500', otherCharges: '0', technicalCompliance: compliance, notes: `${key} ${supplierName}`, lines });
  };
  const q1 = [
    await vqFor('SEED-PR-01', 'Alfa Metals', 1.0, 7, 'PR01-Alfa'),
    await vqFor('SEED-PR-01', 'Bhavani Steel', 0.97, 10, 'PR01-Bhavani'),
    await vqFor('SEED-PR-01', 'Mangal Castings', 1.05, 5, 'PR01-Mangal'),
    await vqFor('SEED-PR-03', 'Samarth Laminations', 0.99, 8, 'PR03-Samarth'),
    await vqFor('SEED-PR-03', 'Ishwar Magnets', 1.03, 6, 'PR03-Ishwar'),
    await vqFor('SEED-PR-03', 'Harsh Electricals', 0.95, 14, 'PR03-Harsh', false),
  ];
  for (const q of q1.filter(Boolean)) await step(`vendor quote ${q.number ?? ''}`, '/scm/vendorquote', q.id, 'submit', ['Draft']);

  console.log('Comparisons');
  const cmps = await list('/scm/comparison');
  const cmpFor = async (prRef, end) => {
    const rfqId = rfqByPr[prRef]; if (!rfqId) return null;
    let c = cmps.find((x) => x.rfqId === rfqId);
    if (c) L.stats.skipped++; else c = await ensure(`comparison for ${prRef}`, null, 'POST', '/scm/comparison', { rfqId, wPrice: 50, wLead: 30, wQuality: 20 });
    if (!c?.id) return null;
    if (end === 'draft') return c;
    let cur = await step(`comparison ${prRef}`, '/scm/comparison', c.id, 'submit', ['Draft']);
    if (end === 'approved') return cur;
    if (!cur.lockedAt && cur.status === 'Approved') {
      const full = (await api('GET', `/scm/comparison/${c.id}`)).data;
      const best = (full.lines ?? []).find((l) => Number(l.rank) === 1);
      const quoteId = best?.quoteId;
      if (quoteId) await act(`comparison ${prRef} award`, 'POST', `/scm/comparison/${c.id}/award`, { quoteId, reason: 'Best weighted score on price, lead time and quality' });
    }
    return (await api('GET', `/scm/comparison/${c.id}`)).data;
  };
  const cmp1 = await cmpFor('SEED-PR-01', 'awarded');
  await cmpFor('SEED-PR-03', 'approved');

  console.log('Purchase orders');
  const pos = await list('/scm/po');
  const poOf = (tag) => pos.find((p) => (p.notes ?? '').startsWith(tag));
  const poIds = {};
  // PO 1: from the awarded comparison (PR-01)
  if (cmp1?.id && cmp1.lockedAt) {
    if (pos.find((p) => p.comparisonId === cmp1.id)) L.stats.skipped++;
    else { const r = await act('PO from comparison', 'POST', `/scm/po/from-comparison/${cmp1.id}`); if (r.ok) { L.stats.created++; console.log('  + PO from comparison PR-01'); } }
  }
  // PO 2/3: direct from requisitions
  const direct = [['SEED-PR-02', 'Chaitanya Copper', 'WH:TAL-RM'], ['SEED-PR-05', 'Dhanlaxmi Bearings', 'WH:TAL-SP']];
  for (const [prRef, sname, wh] of direct) {
    const pr = prOf(prRef); if (!pr) continue;
    if ((await list('/scm/po')).find((p) => (p.notes ?? '').includes(prRef) || p.prId === pr.id)) { L.stats.skipped++; continue; }
    const r = await api('POST', `/scm/pr/${pr.id}/to-po`, { supplierId: sup(sname).id, shipToWarehouseId: whs[wh.slice(3)] });
    if (!r.ok && /Only 0 left/.test(r.err ?? '')) { L.stats.skipped++; continue; }
    if (!r.ok) { L.stats.failed++; L.failures.push(`PR ${prRef} to-po: ${r.err}`); continue; }
    { L.stats.created++; console.log(`  + PO from ${prRef}`); }
  }
  // standalone POs
  const mkPo = async (tag, sname, wc, lines, type = 'Standard', term_ = 'NET30', notesExtra = '') => {
    let po = poOf(tag);
    if (po) { L.stats.skipped++; return po; }
    return ensure(`PO ${tag}`, null, 'POST', '/scm/po', { supplierId: sup(sname).id, poDate: d(9), poType: type, supplierType: 'MATERIAL', shipToWarehouseId: whs[wc], paymentTermId: term(term_) ?? null, notes: `${tag} ${notesExtra}`, lines: lines.map(([c, qty, f, days, gst]) => ({ itemId: item(c).id, qty, uom: item(c).baseUom, rate: rate(c, f ?? 1), discountPct: '0', gstPct: gst ?? '18', deliveryDate: d(days ?? 20), leadDays: 10 })) });
  };
  await mkPo('SEED-PO-A', 'Eagle Packaging', 'TAL-MAIN', [['ITM/00059', 300, 1], ['ITM/00058', 200, 1]], 'Standard', 'NET30', 'packing material');
  await mkPo('SEED-PO-B', 'Laxmi Lubricants', 'TAL-MAIN', [['ITM/00046', 40, 1], ['ITM/00047', 120, 1]], 'Standard', 'NET30', 'lubricants and grease');
  await mkPo('SEED-PO-C', 'Nirmal Abrasives', 'TAL-MAIN', [['ITM/00049', 200, 1], ['ITM/00048', 400, 1]], 'Standard', 'IMMEDIATE', 'abrasives');
  await mkPo('SEED-PO-D', 'Harsh Electricals', 'TAL-SP', [['ITM/00037', 40, 1], ['ITM/00038', 30, 1]], 'Standard', 'NET30', 'electrical spares');
  // approve every draft PO except SEED-PO-C, which stays a draft
  for (const p of await list('/scm/po')) if (p.status === 'Draft' && !/SEED-PO-C/.test(p.notes ?? '')) await step(`PO ${p.number}`, '/scm/po', p.id, 'submit', ['Draft']);
}

// ============================================================================================ contracts
async function contracts() {
  console.log('Contracts');
  const have = await list('/scm/contracts');
  const plan = [
    ['SEED Rate contract - Alfa Metals MS plates FY26-27', 'Alfa Metals', 'RATE', [['ITM/00001', 0.97], ['ITM/00002', 0.97]], 'approved'],
    ['SEED Rate contract - Chaitanya Copper wire FY26-27', 'Chaitanya Copper', 'RATE', [['ITM/00005', 0.96], ['ITM/00006', 0.96]], 'approved'],
    ['SEED Blanket order - Dhanlaxmi Bearings spares', 'Dhanlaxmi Bearings', 'BLANKET', [['ITM/00031', 0.93], ['ITM/00032', 0.93]], 'approved', '500000'],
    ['SEED Rate contract - Eagle Packaging cartons', 'Eagle Packaging', 'RATE', [['ITM/00059', 0.94]], 'draft'],
    ['SEED Rate contract - Laxmi Lubricants oils', 'Laxmi Lubricants', 'RATE', [['ITM/00046', 0.95], ['ITM/00047', 0.95]], 'pending'],
  ];
  for (const [title, sname, type, lines, end, maxValue] of plan) {
    let c = have.find((x) => x.title === title);
    if (c) L.stats.skipped++;
    else c = await ensure(`contract ${title}`, null, 'POST', '/scm/contracts', { supplierId: sup(sname).id, title, validFrom: '2026-11-01', validTo: '2027-03-31', contractType: type, maxValue: maxValue ?? null, notes: 'Annual price agreement, GST extra as applicable', lines: lines.map(([c, f]) => ({ itemId: item(c).id, uom: item(c).baseUom, rate: rate(c, f), discountPct: '1', minQty: '10', maxQty: '5000' })) });
    if (c?.id && end !== 'draft') await step(`contract ${title.slice(5, 30)}`, '/scm/contracts', c.id, 'submit', ['Draft']);
  }
}

// ============================================================================================ GRN -> purchase invoice
async function receiving() {
  console.log('Goods receipt');
  const grns = await list('/scm/grn');
  const pos = await list('/scm/po');
  const tagged = (t) => pos.find((p) => (p.notes ?? '').startsWith(t));
  const plan = [
    // PO key, warehouse, fraction received, end state, vehicle, vendor invoice ref
    ['SEED-PO-A', 'TAL-MAIN', 1, 'posted', 'MH 14 EF 3021', 'EP/2611/0418'],
    ['SEED-PO-B', 'TAL-MAIN', 0.5, 'posted', 'MH 12 SR 5530', 'LL/26-27/1180'],
    ['SEED-PO-D', 'TAL-SP', 1, 'draft', 'MH 04 KL 8812', 'HE/INV/7733'],
    ['PR02', 'TAL-RM', 0.6, 'posted', 'MH 43 BX 2204', 'CC/26-27/0951'],
    ['PR05', 'TAL-SP', 1, 'cancelled', 'MH 09 FD 1166', 'DB/26/0344'],
    ['CMP', 'TAL-RM', 1, 'posted', 'MH 46 AH 7701', 'AM/26-27/2208'],
  ];
  for (const [key, wc, frac, end, vehicleNo, vref] of plan) {
    const bySup = (n) => pos.filter((p) => p.supplierId === sup(n).id && p.status !== 'Draft' && p.number > 'PO/TAL/26-27/0008').sort((a, b) => a.number.localeCompare(b.number))[0];
    let po = key === 'PR02' ? bySup('Chaitanya Copper') : key === 'PR05' ? bySup('Dhanlaxmi Bearings') : key === 'CMP' ? pos.find((p) => p.comparisonId) : tagged(key);
    if (!po) { console.log(`  (no PO for ${key})`); continue; }
    const ref = `SEED-GRN ${vref}`;
    let g = grns.find((x) => (x.vendorInvoiceRef ?? '') === vref);
    if (g) L.stats.skipped++;
    else {
      const fr = await api('GET', `/scm/grn/from-po/${po.id}`);
      if (!fr.ok) { console.log(`  (cannot receive against ${po.number} [${po.status}]: ${fr.err})`); continue; }
      const from = fr.data;
      const lines = (from.lines ?? []).map((l) => ({ poLineId: l.poLineId ?? l.id, receivedQty: Math.max(1, Math.floor(Number(l.openQty ?? l.qty) * frac)) })).filter((l) => l.poLineId);
      if (!lines.length) { console.log(`  (nothing open on ${po.number})`); continue; }
      g = await ensure(`GRN for ${po.number}`, null, 'POST', '/scm/grn', { poId: po.id, warehouseId: whs[wc], receiptDate: d(14), vehicleNo, lrNo: `LR-${vref.slice(-4)}`, vendorInvoiceRef: vref, notes: ref, lines });
    }
    if (!g?.id || end === 'draft') continue;
    let cur = await step(`GRN ${vref}`, '/scm/grn', g.id, 'submit', ['Draft']);
    if (cur.status === 'Approved') cur = await step(`GRN ${vref}`, '/scm/grn', g.id, 'post', ['Approved']);
    if (end === 'cancelled' && cur.status === 'Posted') await act(`GRN ${vref} cancel`, 'POST', `/scm/grn/${g.id}/cancel`, { reason: 'Material rejected at gate, supplier to re-supply' });
  }

  console.log('Purchase invoices');
  const invs = await list('/scm/purchaseinvoice');
  const posted = (await list('/scm/grn')).filter((g) => g.status === 'Posted');
  const invPlan = [['EP/2611/0418', 'posted'], ['LL/26-27/1180', 'matched'], ['CC/26-27/0951', 'draft'], ['AM/26-27/2208', 'posted']];
  for (const [vref, end] of invPlan) {
    const g = posted.find((x) => x.vendorInvoiceRef === vref); if (!g) { console.log(`  (no posted GRN for ${vref})`); continue; }
    const vno = `SEED-INV-${vref}`;
    let inv = invs.find((x) => x.vendorInvoiceNo === vno);
    if (inv) L.stats.skipped++;
    else {
      const pre = (await api('GET', `/scm/purchaseinvoice/from-grn/${g.id}`)).data;
      const lines = (pre.lines ?? []).map((l) => ({ grnLineId: l.grnLineId, poLineId: l.poLineId, itemId: l.itemId, description: l.description ?? null, hsnSac: l.hsnSac ?? null, qty: l.qty, uom: l.uom, rate: l.rate, gstPct: l.gstPct ?? '18', itcFlag: 'ELIGIBLE' }));
      inv = await ensure(`purchase invoice ${vno}`, null, 'POST', '/scm/purchaseinvoice', { supplierId: g.supplierId, vendorInvoiceNo: vno, invoiceDate: d(14), poId: g.poId, notes: `Against ${g.number}`, lines });
    }
    if (!inv?.id || end === 'draft') continue;
    let cur = await step(`invoice ${vno}`, '/scm/purchaseinvoice', inv.id, 'submit', ['Draft']);
    cur = await step(`invoice ${vno}`, '/scm/purchaseinvoice', inv.id, 'match', ['Approved', 'Draft', 'Submitted']);
    if (end === 'posted') await step(`invoice ${vno}`, '/scm/purchaseinvoice', inv.id, 'post', ['Approved']);
  }
}

async function amendments() {
  console.log('PO amendment');
  const po = (await list('/scm/po')).find((p) => /SEED-PO-D/.test(p.notes ?? ''));
  if (po && po.status === 'Approved' && Number(po.revisionNo ?? 0) === 0 && !po.amending) await act('PO amend', 'POST', `/scm/po/${po.id}/amend`, { reason: 'Supplier asked for revised delivery schedule' });
  else L.stats.skipped++;
}

async function evaluation() {
  console.log('Supplier evaluation');
  for (const period of ['2026-09', '2026-10', '2026-11']) await act(`evaluation ${period}`, 'POST', '/scm/evaluation/run', { period }, { 'idempotency-key': `seed-eval-${period}-${Date.now()}` });
}

// suppliers must be approved before they can be invited or ordered from; the demo suppliers 1-8 are, the rest are submitted here
async function approveSuppliers() {
  console.log('Supplier approvals');
  for (const name of ['Samarth Laminations', 'Ishwar Magnets', 'Mangal Castings', 'Jaykar Coatings', 'Parag Enamel', 'Krishna Fasteners', 'Laxmi Lubricants', 'Nirmal Abrasives']) {
    const s = sup(name); if (!s || s.approvalStatus === 'APPROVED') { L.stats.skipped++; continue; }
    const req = (await api('GET', `/approvals/doc/scm-suppliers/${s.id}`)).data?.latest;
    if (req?.status === 'PENDING') await act(`withdraw approval of ${name}`, 'POST', `/approvals/requests/${req.id}/withdraw`, {}, ifm(req.version));
    const r = await act(`supplier ${name} submit`, 'POST', `/suppliers/${s.id}/submit`);
    if (r.ok) { L.stats.created++; console.log(`  + supplier ${name} approved`); }
  }
  suppliers.splice(0, suppliers.length, ...(await list('/suppliers')));
}

// HSN codes used by the demo items have no GST rate yet, which blocks PR -> PO conversion and invoices
async function hsnRates() {
  const gst = (await list('/gst-rates')).find((g) => Number(g.igstPct) === 18 && g.kind === 'TAXABLE' && !/until/.test(g.name));
  if (!gst) return;
  for (const h of await list('/hsn-sac')) {
    const have = (await api('GET', `/hsn-sac/${h.id}/rates`)).data ?? [];
    if (have.length) { L.stats.skipped++; continue; }
    const r = await act(`GST rate for HSN ${h.code}`, 'POST', `/hsn-sac/${h.id}/rates`, { gstRateId: gst.id, effectiveFrom: '2025-09-22' });
    if (r.ok) { L.stats.created++; console.log(`  + GST 18% for HSN ${h.code}`); }
  }
}

// Sawardari plant: one PR -> PO -> GRN chain and a draft PO
async function sawardari() {
  console.log('Sawardari plant');
  await L.setUnit('SAW');
  try {
    const W = Object.fromEntries((await api('GET', '/lookups/warehouses')).data.map((w) => [w.code, w.id]));
    const prs = await list('/scm/pr');
    let pr = byKey(prs, 'purpose', 'SEED-PR-S1');
    if (pr) L.stats.skipped++;
    else pr = await ensure('PR SEED-PR-S1 (SAW)', null, 'POST', '/scm/pr', { requiredDate: d(26), supplierType: 'MATERIAL', purpose: 'SEED-PR-S1 Sawardari fabrication shop plates and wire', lines: [{ itemId: item('ITM/00001').id, qty: 600, uom: 'Kg', estRate: rate('ITM/00001', 1.05), requiredDate: d(26) }, { itemId: item('ITM/00005').id, qty: 200, uom: 'Kg', estRate: rate('ITM/00005', 1.05), requiredDate: d(26) }] });
    if (!pr?.id) return;
    await step('PR SEED-PR-S1', '/scm/pr', pr.id, 'submit', ['Draft']);
    const sawPos = async () => (await list('/scm/po')).filter((x) => x.shipToWarehouseId === W['SAW-MAIN']);
    let po = (await sawPos()).find((x) => x.supplierId === sup('Alfa Metals').id);
    if (po) L.stats.skipped++;
    else {
      const r = await api('POST', `/scm/pr/${pr.id}/to-po`, { supplierId: sup('Alfa Metals').id, shipToWarehouseId: W['SAW-MAIN'] });
      if (r.ok) { L.stats.created++; console.log('  + PO from SEED-PR-S1 (SAW)'); po = (await sawPos()).find((x) => x.supplierId === sup('Alfa Metals').id); }
      else { L.stats.failed++; L.failures.push('SAW to-po: ' + r.err); }
    }
    if (po && po.status === 'Draft') await step(`PO ${po.number}`, '/scm/po', po.id, 'submit', ['Draft']);
    if ((await sawPos()).find((x) => /SEED-PO-S2/.test(x.notes ?? ''))) L.stats.skipped++;
    else await ensure('PO SEED-PO-S2 (SAW)', null, 'POST', '/scm/po', { supplierId: sup('Krishna Fasteners').id, poDate: d(12), poType: 'Standard', supplierType: 'MATERIAL', shipToWarehouseId: W['SAW-MAIN'], notes: 'SEED-PO-S2 consumables for fabrication', lines: [{ itemId: item('ITM/00046').id, qty: 30, uom: item('ITM/00046').baseUom, rate: rate('ITM/00046', 1), gstPct: '18', deliveryDate: d(24) }] });
    if (!po?.id) return;
    let g = (await list('/scm/grn')).find((x) => x.vendorInvoiceRef === 'AM/SAW/2611/031');
    if (g) L.stats.skipped++;
    else {
      const fr = await api('GET', `/scm/grn/from-po/${po.id}`);
      if (fr.ok && fr.data.lines.length) g = await ensure('GRN (SAW)', null, 'POST', '/scm/grn', { poId: po.id, warehouseId: W['SAW-MAIN'], receiptDate: d(14), vehicleNo: 'MH 11 PQ 5521', vendorInvoiceRef: 'AM/SAW/2611/031', notes: 'SEED-GRN Sawardari receipt', lines: fr.data.lines.map((l) => ({ poLineId: l.poLineId ?? l.id, receivedQty: Math.max(1, Math.floor(Number(l.openQty ?? l.qty) * 0.8)) })) });
    }
    if (g?.id) { const cur = await step('GRN SAW', '/scm/grn', g.id, 'submit', ['Draft']); if (cur.status === 'Approved') await step('GRN SAW', '/scm/grn', g.id, 'post', ['Approved']); }
  } finally { await L.setUnit('TAL'); }
}

async function run() {
  await hsnRates();
  await approveSuppliers();
  await requisitions();
  await sourcing();
  await contracts();
  await receiving();
  await amendments();
  await evaluation();
  await sawardari();
}

if (process.argv[1]?.endsWith('procurement-seed.mjs')) {
  const pages = ['scm-suppliers', 'scm-pr', 'scm-rfq', 'scm-vendorquote', 'scm-comparison', 'scm-po', 'scm-grn', 'scm-purchaseinvoice', 'scm-contracts', 'scm-evaluation', 'scm-approval', 'wms-putaway'];
  await L.withApprovalOff(pages, run);
  L.summary('procurement-seed');
}
