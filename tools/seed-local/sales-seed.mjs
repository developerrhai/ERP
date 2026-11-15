// Seeds demo CRM + Sales data on the LOCAL ui database through the API only (validation, numbering and plant rules apply).
// Re-runnable: every record carries a natural key (lead name+company, opportunity title, follow-up title, meeting subject,
// feedback comment, document reference "SEED-...") and is skipped when it already exists.
// Run order on a fresh database: inventory-seed.mjs (stock) -> procurement-seed.mjs -> sales-seed.mjs.
// Run: node tools/seed-local/sales-seed.mjs        (env SEED_API, default http://localhost:4100/api/v1)
import * as L from './lib.mjs';
const { api, list, ensure, act, d, ifm } = L;

await L.login();
await L.setUnit('TAL');

const customers = await list('/customers');
const cust = (name) => customers.find((c) => c.name.startsWith(name));
const itemsAll = (await list('/pages/inv-items/records')).map((r) => ({ id: r.id, code: r.code, name: r.data.itemName, ...r.data }));
const item = (c) => itemsAll.find((i) => i.code === c);
const users = (await api('GET', '/users')).data ?? [];
const uid = (login) => users.find((u) => u.loginId === login)?.id ?? null;
const reps = [uid('emp.sales.talsaw'), uid('mgr.sales.tal'), uid('head.sales')].filter(Boolean);
const rep = (i) => reps[i % reps.length] ?? null;

const addDay = (iso, n) => { const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// =================================================================================================================
// CRM
// =================================================================================================================
async function crm() {
  console.log('CRM sources');
  const sources = await list('/crm/sources');
  for (const [code, name] of [['EXPO', 'Pune Engineering Expo 2026'], ['REFR', 'Customer referral'], ['IMART', 'IndiaMART enquiry'], ['WEBF', 'Website enquiry form']]) {
    if (sources.find((s) => s.code === code)) { L.stats.skipped++; continue; }
    await ensure(`source ${code}`, null, 'POST', '/crm/sources', { code, name });
  }
  const srcs = await list('/crm/sources');
  const src = (code) => srcs.find((s) => s.code === code)?.id ?? null;

  console.log('CRM leads');
  const leads = await list('/crm/leads');
  const leadPlan = [
    ['Sanjay Kulkarni', 'Kulkarni Agro Machines, Baramati', '9822011234', 'sanjay@kulkarniagro.example.in', '27', 'EXPO', 'BLDC motors for sugarcane crushers, 20 nos per month', 640000, 55, 'Qualified', null],
    ['Rahul Deshmukh', 'Deshmukh Engineering Works, Nashik', '9890455512', 'rahul@deshmukheng.example.in', '27', 'IMART', 'Servo drive 2kW for CNC retrofit, 6 nos', 285000, 40, 'Qualified', null],
    ['Meenal Joshi', 'Joshi Textile Machinery, Ichalkaranji', '9422733310', 'meenal@joshitextile.example.in', '27', 'REFR', '1kW BLDC motor for loom drives, trial lot of 10', 168000, 35, 'Contacted', null],
    ['Anil Gupta', 'Gupta Pumps and Motors, Ahmedabad', '9825044477', 'anil@guptapumps.example.in', '24', 'WEBF', 'Gear box 1:10 for pump skids', 330000, 25, 'New', null],
    ['Faizal Shaikh', 'Shaikh Auto Ancillaries, Chakan', '9850122046', 'faizal@shaikhauto.example.in', '27', 'COLD', 'Control panel 3-phase for assembly line', 460000, 30, 'Contacted', null],
    ['Prakash Naidu', 'Naidu Precision Tools, Bengaluru', '9845098123', 'prakash@naiduprecision.example.in', '29', 'EXPO', 'Wiring harness type 1, 200 nos', 2200000, 20, 'Unqualified', 'Order volume below minimum and requires South India warehouse'],
    ['Kavita Patil', 'Patil Rice Mill Equipments, Kolhapur', '9763012345', 'kavita@patilmill.example.in', '27', 'REFR', 'Fan motor 120W, 50 nos', 650000, 45, 'Qualified', null],
    ['Vijay Thakur', 'Thakur Cold Storage, Nagpur', '9975411820', 'vijay@thakurcold.example.in', '27', 'IMART', 'Pump assembly 3HP, 8 nos', 105600, 15, 'New', null],
  ];
  for (const [i, [name, company, mobile, email, stateCode, s, interest, estValue, score, status, lost]] of leadPlan.entries()) {
    let l = leads.find((x) => x.name === name && x.company === company);
    if (l) L.stats.skipped++;
    else l = await ensure(`lead ${name}`, null, 'POST', '/crm/leads', { name, company, mobile, email, stateCode, sourceId: src(s), assignedToId: rep(i), interest, estValue, score });
    if (l?.id && l.status !== status && (l.status === 'New' || (l.status === 'Contacted' && status !== 'Contacted')) && status !== 'New') {
      const cur = (await api('GET', `/crm/leads/${l.id}`)).data;
      if (cur.status === 'New' || (cur.status === 'Contacted' && status !== 'Contacted')) await act(`lead ${name} -> ${status}`, 'POST', `/crm/leads/${l.id}/status`, { status, ...(lost ? { lostReason: lost } : {}) });
    }
  }

  console.log('CRM opportunities');
  const opps = await list('/crm/opportunities');
  // two qualified leads are converted into opportunities (the lead becomes Converted)
  const freshLeads = await list('/crm/leads');
  let converted = 0;
  for (const l of freshLeads.filter((x) => x.status === 'Qualified').slice(0, 2)) {
    if (opps.find((o) => o.leadId === l.id)) continue;
    const c = await act(`convert lead ${l.name}`, 'POST', `/crm/leads/${l.id}/convert`, { title: `${l.company.split(',')[0]} - ${String(l.interest).slice(0, 40)}`, amount: String(l.estValue ?? 0) });
    if (c.ok) { L.stats.created++; converted++; }
  }
  const oppPlan = [
    ['Asha Steel Works - BLDC 250W annual rate contract', 'Asha Steel', 1850000, 60, d(30), 'Qualification', null],
    ['Deccan Auto - Servo drive 2kW pilot line', 'Deccan Auto', 760000, 70, d(25), 'Proposal', null],
    ['Hindustan Gearbox - Gear box 1:10 repeat order', 'Hindustan Gearbox', 1320000, 80, d(20), 'Proposal', null],
    ['Kiran Hydraulics - BLDC 1kW for press line', 'Kiran Hydraulics', 980000, 90, d(18), 'Won', null],
    ['Navkar Machines - Control panel retrofit', 'Navkar Machines', 540000, 10, d(28), 'Lost', 'Customer chose a cheaper local panel builder'],
    ['Omkar Pumps - Pump assembly 3HP supply', 'Omkar Pumps', 1260000, 50, d(27), 'Prospecting', null],
  ];
  for (const [title, cname, amount, probability, expectedClose, stage, lost] of oppPlan) {
    let o = (await list('/crm/opportunities')).find((x) => x.title === title);
    if (o) L.stats.skipped++;
    else o = await ensure(`opportunity ${title}`, null, 'POST', '/crm/opportunities', { customerId: cust(cname)?.id, title, amount: String(amount), probability, expectedClose, ownerId: rep(1) });
    if (!o?.id) continue;
    const cur = (await api('GET', `/crm/opportunities/${o.id}`)).data;
    const order = ['Prospecting', 'Qualification', 'Proposal', 'Negotiation', 'Won'];
    if (cur.status !== stage && !['Won', 'Lost'].includes(cur.status)) {
      const path = stage === 'Lost' ? ['Qualification', 'Lost'] : order.slice(order.indexOf(cur.status) + 1, order.indexOf(stage) + 1).filter((st) => st !== 'Negotiation' && st !== 'Won' || stage === 'Won' && st !== 'Negotiation');
      for (const st of path) { const r = await act(`opp ${cname} -> ${st}`, 'POST', `/crm/opportunities/${o.id}/move-stage`, { stage: st, note: 'Moved by seed', ...(st === 'Lost' ? { lostReason: lost } : {}) }); if (!r.ok) break; }
    }
  }

  console.log('CRM follow-ups and meetings');
  const allOpps = await list('/crm/opportunities');
  const fus = await list('/crm/followups');
  const fuPlan = [
    ['Call Kulkarni Agro for technical drawing', 'Call', 'LEAD', 'Kulkarni Agro', d(16), 'Done', 'Shared motor datasheet; customer will confirm torque requirement'],
    ['Send revised quotation to Deccan Auto', 'Email', 'CUSTOMER', 'Deccan Auto', d(17), 'Open'],
    ['Visit Hindustan Gearbox for sample approval', 'Visit', 'CUSTOMER', 'Hindustan Gearbox', d(18), 'Open'],
    ['Follow up payment promise from Asha Steel', 'Call', 'CUSTOMER', 'Asha Steel', d(14), 'Done', 'Finance confirmed NEFT on 18 Nov'],
    ['Share price list with Omkar Pumps', 'Email', 'CUSTOMER', 'Omkar Pumps', d(19), 'Open'],
    ['Reminder: Kiran Hydraulics delivery schedule', 'Task', 'CUSTOMER', 'Kiran Hydraulics', d(13), 'Done', 'Dispatch planned in two lots'],
    ['Demo video call with Deshmukh Engineering', 'Call', 'LEAD', 'Deshmukh Engineering', d(20), 'Open'],
    ['Collect GST certificate from Pragati Valves', 'Task', 'CUSTOMER', 'Pragati Valves', d(15), 'Open'],
  ];
  for (const [i, [title, kind, relatedType, who, date, status, outcome]] of fuPlan.entries()) {
    let f = fus.find((x) => x.title === title);
    if (f) L.stats.skipped++;
    else {
      const c = cust(who);
      const lead = freshLeads.find((l) => (l.company ?? '').startsWith(who));
      f = await ensure(`follow-up ${title}`, null, 'POST', '/crm/followups', { relatedType: relatedType === 'LEAD' && lead ? 'LEAD' : 'CUSTOMER', relatedId: relatedType === 'LEAD' && lead ? lead.id : c?.id ?? null, customerId: c?.id ?? null, title, kind, dueAt: `${date}T10:30:00+05:30`, assignedToId: rep(i) });
    }
    if (f?.id && status === 'Done' && f.status === 'Open') await act(`follow-up done ${title}`, 'POST', `/crm/followups/${f.id}/done`, { outcome });
  }
  const mtgs = await list('/crm/meetings');
  const mtgPlan = [
    ['Technical discussion with Deccan Auto engineering', 'Meeting', 'Deccan Auto', d(9), 90, 'Deccan Auto R&D: Mr. Bhosale, Mr. Kamble', 'Held', 'Agreed on servo drive spec; pilot of 6 units approved subject to price'],
    ['Quarterly business review with Asha Steel', 'Meeting', 'Asha Steel', d(10), 60, 'Asha Steel purchase head and finance controller', 'Held', 'Annual rate contract discussion started; 3% volume discount asked'],
    ['Phone call: delivery delay explanation to Kiran Hydraulics', 'Call', 'Kiran Hydraulics', d(11), 20, null, 'Held', 'Customer accepted revised delivery date of 25 Nov'],
    ['Plant visit by Hindustan Gearbox quality team', 'Meeting', 'Hindustan Gearbox', d(19), 120, 'Quality head and supplier development engineer', 'Planned'],
    ['Price negotiation with Omkar Pumps', 'Meeting', 'Omkar Pumps', d(21), 60, 'Omkar purchase manager', 'Planned'],
    ['Call: payment reminder to Navkar Machines', 'Call', 'Navkar Machines', d(17), 15, null, 'Planned'],
  ];
  for (const [i, [subject, kind, who, date, durationMin, attendees, status, outcome]] of mtgPlan.entries()) {
    let m = mtgs.find((x) => x.subject === subject);
    if (m) L.stats.skipped++;
    else { const c = cust(who); m = await ensure(`meeting ${subject}`, null, 'POST', '/crm/meetings', { relatedType: 'CUSTOMER', relatedId: c?.id ?? null, customerId: c?.id ?? null, subject, kind, startsAt: `${date}T15:00:00+05:30`, durationMin, attendees, ownerId: rep(i) }); }
    if (m?.id && status === 'Held' && m.status === 'Planned') await act(`meeting held ${subject}`, 'POST', `/crm/meetings/${m.id}/held`, { outcome });
  }

  console.log('CRM feedback');
  const fbs = await list('/crm/feedback');
  const fbPlan = [
    ['Asha Steel', 9, 'Delivery', 'Motors arrived on the promised date, packing was excellent.', 'Closed', null],
    ['Deccan Auto', 8, 'Quality', 'Overall quality is good. Requested test certificates with each lot.', 'In review', null],
    ['Kiran Hydraulics', 4, 'Delivery', 'Second lot was three days late and we had to stop our press line.', 'Closed', 'Expedited the pending lot and agreed a penalty-free revised schedule'],
    ['Hindustan Gearbox', 10, 'Service', 'Technical team responded within two hours to our commissioning query.', 'Closed', null],
    ['Omkar Pumps', 7, 'Price', 'Pricing is fair but competitors offer longer credit terms.', 'In review', null],
    ['Navkar Machines', 3, 'Quality', 'Two servo drives failed at commissioning; replacement took a week.', 'In review', null],
    ['Citra Engineering', 9, 'Service', 'Prompt after-sales support and clear documentation.', 'Closed', null],
    ['Pragati Valves', 6, 'Documentation', 'Invoice copies reached us late and GST details were wrong once.', 'Closed', 'Invoice template corrected and GSTIN verified before each dispatch'],
  ];
  for (const [who, rating, category, comment, status, action] of fbPlan) {
    let f = fbs.find((x) => x.comment === comment);
    if (f) L.stats.skipped++;
    else f = await ensure(`feedback ${who}`, null, 'POST', '/crm/feedback', { customerId: cust(who).id, rating, category, comment, givenOn: addDay(d(1), rating + 3) });
    if (f?.id && f.status === 'Open' || f?.status === 'New') {
      if (status === 'In review') await act(`feedback review ${who}`, 'POST', `/crm/feedback/${f.id}/status`, { status: 'In review' });
      if (status === 'Closed') await act(`feedback close ${who}`, 'POST', `/crm/feedback/${f.id}/status`, { status: 'Closed', actionNote: action ?? 'Acknowledged and thanked the customer' });
    }
  }
}


// =================================================================================================================
// Sales: price lists, enquiries, customer RFQs, quotations, orders, reservations, dispatch, invoices, receipts, returns
// =================================================================================================================
const rateOf = (c) => { const i = item(c); return Number(i.sellingPrice ?? Math.round(Number(i.standardCost) * 1.28)); };
const ql = (c, qty, discountPct = 0, extra = {}) => ({ itemId: item(c).id, qty, rate: rateOf(c), discountPct, gstPct: 18, uom: item(c).baseUom, leadDays: 14, ...extra });

async function priceLists() {
  console.log('Price lists');
  const have = await list('/price-lists');
  const pl = (c, f = 1) => ({ itemId: item(c).id, uomCode: item(c).baseUom, minQty: 0, rate: Math.round(rateOf(c) * f), discountPct: 0 });
  const plans = [
    { code: 'PL-STD-2627', name: 'Standard Selling Price List FY 2026-27', kind: 'SELLING', isDefault: true, validFrom: '2026-04-01', validTo: '2027-03-31', items: ['ITM/00016', 'ITM/00017', 'ITM/00018', 'ITM/00019', 'ITM/00020', 'ITM/00021', 'ITM/00025', 'ITM/00026', 'ITM/00029'].map((c) => pl(c)) },
    { code: 'PL-DEALER-2627', name: 'Dealer and Distributor Price List', kind: 'SELLING', validFrom: '2026-04-01', validTo: '2027-03-31', items: ['ITM/00016', 'ITM/00017', 'ITM/00018', 'ITM/00019'].map((c) => pl(c, 0.92)) },
    { code: 'PL-ASHA-2627', name: 'Asha Steel Works Key Account Rates', kind: 'SELLING', customerId: cust('Asha Steel')?.id, validFrom: '2026-10-01', validTo: '2027-03-31', items: ['ITM/00016', 'ITM/00017'].map((c) => pl(c, 0.95)) },
    { code: 'PL-OEM-2627', name: 'OEM Bulk Rate Card (min 50 nos)', kind: 'SELLING', validFrom: '2026-11-01', validTo: '2027-03-31', items: ['ITM/00016', 'ITM/00017', 'ITM/00018'].map((c) => ({ ...pl(c, 0.88), minQty: 50 })) },
    { code: 'PL-SUP-RM-2627', name: 'Raw Material Buying Reference Prices', kind: 'BUYING', validFrom: '2026-04-01', validTo: '2027-03-31', items: ['ITM/00001', 'ITM/00002', 'ITM/00005', 'ITM/00006'].map((c) => ({ itemId: item(c).id, uomCode: 'Kg', minQty: 0, rate: Number(item(c).standardCost), discountPct: 0 })) },
  ];
  for (const p of plans) {
    if (have.find((h) => h.code === p.code)) { L.stats.skipped++; continue; }
    await ensure(`price list ${p.code}`, null, 'POST', '/price-lists', p);
  }
}

async function bankAccounts() {
  const have = (await api('GET', '/finance/bank-accounts')).data ?? [];
  const accs = (await api('GET', '/finance/accounts?size=200')).data ?? [];
  const unitId = L.ctx.unit;
  const out = [];
  for (const [ledger, name, bankName, last4, ifsc] of [['1111', 'HDFC Current A/c Talwade', 'HDFC Bank', '4521', 'HDFC0000312'], ['1112', 'ICICI Collection A/c Talwade', 'ICICI Bank', '7788', 'ICIC0001234']]) {
    let b = have.find((x) => x.name === name);
    if (b) L.stats.skipped++;
    else b = await ensure(`bank account ${name}`, null, 'POST', '/finance/bank-accounts', { unitId, accountId: accs.find((a) => a.code === ledger)?.id, kind: 'BANK', name, bankName, accountLast4: last4, ifsc });
    if (b) out.push(b);
  }
  return out;
}

async function sales() {
  await priceLists();

  console.log('Sales enquiries');
  const enqs = (await api('GET', '/sales/enquiries?size=100')).data ?? [];
  const enqPlan = [
    ['Citra Engineering', null, 'BLDC Motor 500W, 40 nos for conveyor drives', 40, d(28), 'Qualified'],
    ['Jai Hind Forge', null, 'Gear box 1:20 for forging press line', 6, d(30), 'New'],
    [null, 'Bhosale Dairy Equipments, Satara', 'Pump assembly 1HP for milk chilling plant', 12, d(26), 'Lost'],
    ['Lotus Switchgear', null, 'Control panel 3-phase with VFD', 4, d(29), 'Qualified'],
    [null, 'Sahyadri Sugar Works, Karad', 'BLDC Motor 1kW, 25 nos for cane feeders', 25, d(24), 'New'],
    ['Rajhans Wire Products', null, 'Fan motor 120W for wire drawing blowers', 30, d(27), 'Qualified'],
  ];
  for (const [cn, prospect, product, qty, requiredDate, status] of enqPlan) {
    let e = enqs.find((x) => x.product === product);
    if (e) L.stats.skipped++;
    else e = await ensure(`enquiry ${product}`, null, 'POST', '/sales/enquiries', { customerId: cn ? cust(cn)?.id : null, prospectName: prospect, contact: prospect ? '9881234567' : null, product, qty, requiredDate, source: 'Phone', assignedToId: rep(2) });
    if (!e?.id || e.status === status) continue;
    if (status === 'Qualified' && e.status === 'New') await act(`enquiry ${product} qualify`, 'POST', `/sales/enquiries/${e.id}/qualify`);
    if (status === 'Lost' && e.status === 'New') await act(`enquiry ${product} lost`, 'POST', `/sales/enquiries/${e.id}/mark-lost`, { lostReason: 'Customer bought from a local dealer' });
    if (status === 'Quoted' && ['New', 'Qualified'].includes(e.status)) { if (e.status === 'New') await act('enquiry qualify', 'POST', `/sales/enquiries/${e.id}/qualify`); await act(`enquiry ${product} to quotation`, 'POST', `/sales/enquiries/${e.id}/to-quotation`); }
  }

  console.log('Customer RFQs');
  const rfqs = await list('/sales/rfq');
  const rfqPlan = [
    ['SEED-RFQ-01', 'Navkar Machines', [['ITM/00024', 3, 'Control panel with IP55 enclosure']], 'full'],
    ['SEED-RFQ-02', 'Quest Automation', [['ITM/00019', 4, 'Servo drive for pick and place cell'], ['ITM/00018', 4, null]], 'review'],
    ['SEED-RFQ-03', 'Shivneri Cables', [['ITM/00028', 25, 'Wiring harness type 2 for cable tester']], 'new'],
  ];
  for (const [ref, who, lines, upTo] of rfqPlan) {
    let r = rfqs.find((x) => x.customerRef === ref);
    if (r) L.stats.skipped++;
    else r = await ensure(`customer RFQ ${ref}`, null, 'POST', '/sales/rfq', { customerId: cust(who).id, customerRef: ref, receivedOn: d(6), requiredBy: d(28), description: `Enquiry from ${who}`, estimatedValue: '350000', lines: lines.map(([c, qty, desc]) => ({ itemId: item(c).id, qty, uom: item(c).baseUom, description: desc, targetRate: String(Math.round(rateOf(c) * 0.95)) })) });
    if (!r?.id || upTo === 'new') continue;
    const cur = (await api('GET', `/sales/rfq/${r.id}`)).data;
    if (cur.status === 'New' || cur.status === 'Received') await act(`rfq ${ref} engineering`, 'POST', `/sales/rfq/${r.id}/engineering-review`, { feasible: true, note: 'Standard product, feasible within lead time' });
    if (upTo === 'full') {
      const c2 = (await api('GET', `/sales/rfq/${r.id}`)).data;
      if (c2.status !== 'Reviewed' && c2.status !== 'Quoted') await act(`rfq ${ref} finance`, 'POST', `/sales/rfq/${r.id}/finance-review`, { marginPct: '22', note: 'Margin acceptable at standard cost plus 22 percent' });
      const c3 = (await api('GET', `/sales/rfq/${r.id}`)).data;
      if (c3.status === 'Reviewed') await act(`rfq ${ref} to quotation`, 'POST', `/sales/rfq/${r.id}/to-quotation`, { gstPct: '18' });
    }
  }

  console.log('Quotations');
  const quotes = await list('/sales/quotations');
  const oppId = (title) => allOppIds[title];
  const allOppIds = Object.fromEntries((await list('/crm/opportunities')).map((o) => [o.title, o.id]));
  const qPlan = [
    // ref, customer, lines, end state, opportunity title
    ['SEED-Q-01', 'Asha Steel', [ql('ITM/00016', 20, 3), ql('ITM/00017', 10, 3)], 'order', null],
    ['SEED-Q-02', 'Deccan Auto', [ql('ITM/00019', 6, 2)], 'order', 'Deccan Auto - Servo drive 2kW pilot line'],
    ['SEED-Q-03', 'Hindustan Gearbox', [ql('ITM/00020', 12, 4), ql('ITM/00021', 4, 4)], 'order', 'Hindustan Gearbox - Gear box 1:10 repeat order'],
    ['SEED-Q-04', 'Kiran Hydraulics', [ql('ITM/00018', 12, 2)], 'order', 'Kiran Hydraulics - BLDC 1kW for press line'],
    ['SEED-Q-05', 'Citra Engineering', [ql('ITM/00017', 40, 5)], 'approved', null],
    ['SEED-Q-06', 'Omkar Pumps', [ql('ITM/00026', 8, 0)], 'rejected', 'Omkar Pumps - Pump assembly 3HP supply'],
    ['SEED-Q-07', 'Falcon Powertrain', [ql('ITM/00022', 2, 0), ql('ITM/00023', 2, 0)], 'draft', null],
    ['SEED-Q-08', 'Ganga Castings', [ql('ITM/00025', 6, 2), ql('ITM/00029', 6, 2)], 'order', null],
    ['SEED-Q-09', 'Jai Hind Forge', [ql('ITM/00021', 3, 0)], 'revised', null],
    ['SEED-Q-10', 'Indus Motors', [ql('ITM/00016', 15, 4), ql('ITM/00018', 6, 4)], 'order', null],
  ];
  const quoteIds = {};
  for (const [ref, who, lines, end, opp] of qPlan) {
    let q = quotes.find((x) => x.customerRef === ref);
    if (q) L.stats.skipped++;
    else q = await ensure(`quotation ${ref}`, null, 'POST', '/sales/quotations', { customerId: cust(who).id, opportunityId: opp ? oppId(opp) ?? null : null, quoteDate: d(5), validUntil: '2026-12-31', customerRef: ref, notes: `Prices ex-works Talwade. Delivery 3-4 weeks. Payment 30 days. Ref ${ref}`, lines });
    if (!q?.id) continue;
    quoteIds[ref] = q.id;
    const get = async () => (await api('GET', `/sales/quotations/${q.id}`)).data;
    let cur = await get();
    if (end === 'draft') continue;
    if (cur.status === 'Draft') { const r = await act(`quotation ${ref} submit`, 'POST', `/sales/quotations/${q.id}/submit`, undefined, ifm(cur.version)); if (!r.ok) continue; cur = await get(); }
    if (end === 'approved') continue;
    if (cur.status === 'Approved' && cur.customerStatus === 'PENDING') {
      if (end === 'rejected') await act(`quotation ${ref} reject`, 'POST', `/sales/quotations/${q.id}/customer-decision`, { decision: 'REJECTED', decidedOn: d(12) });
      else if (end === 'revised') { await act(`quotation ${ref} revise`, 'POST', `/sales/quotations/${q.id}/revise`, { reason: 'Customer asked for revised lead time and rate' }); }
      else await act(`quotation ${ref} accept`, 'POST', `/sales/quotations/${q.id}/customer-decision`, { decision: 'ACCEPTED', decidedOn: d(8) });
    }
  }
  // move the linked opportunities forward now that quotations exist
  for (const [title, stage] of [['Deccan Auto - Servo drive 2kW pilot line', 'Negotiation'], ['Hindustan Gearbox - Gear box 1:10 repeat order', 'Negotiation'], ['Kiran Hydraulics - BLDC 1kW for press line', 'Won']]) {
    const o = (await list('/crm/opportunities')).find((x) => x.title === title); if (!o || o.status === stage || ['Won', 'Lost'].includes(o.status)) continue;
    if (stage === 'Won' && o.status !== 'Negotiation') await act(`opp ${title} -> Negotiation`, 'POST', `/crm/opportunities/${o.id}/move-stage`, { stage: 'Negotiation', note: 'Quotation sent' });
    await act(`opp ${title} -> ${stage}`, 'POST', `/crm/opportunities/${o.id}/move-stage`, { stage, note: stage === 'Won' ? 'PO received' : 'Price negotiation under way' });
  }

  console.log('Sales orders');
  const orders = await list('/sales/orders');
  const orderOf = (po) => orders.find((o) => o.customerPoNo === po);
  const toOrder = [['SEED-Q-01', 'ASHA/PO/2611/045', d(7), d(28)], ['SEED-Q-02', 'DAC-PO-8841', d(9), d(30)], ['SEED-Q-03', 'HGB/26-27/0612', d(10), '2026-12-05'], ['SEED-Q-04', 'KH-PO-2611-17', d(11), d(26)], ['SEED-Q-08', 'GC/PO/1187', d(12), '2026-12-10'], ['SEED-Q-10', 'IM/PUR/26/3321', d(12), d(27)]];
  for (const [qref, po, poDate, delivery] of toOrder) {
    if (orderOf(po)) { L.stats.skipped++; continue; }
    if (!quoteIds[qref]) continue;
    const r = await act(`order from ${qref}`, 'POST', `/sales/quotations/${quoteIds[qref]}/to-order`, { customerPoNo: po, customerPoDate: poDate, deliveryDate: delivery });
    if (r.ok) { L.stats.created++; console.log(`  + order from ${qref} (${po})`); }
  }
  const direct = [
    ['LSG/PO/4410', 'Lotus Switchgear', [{ itemId: item('ITM/00024').id, qty: 3, rate: rateOf('ITM/00024'), discountPct: 2, gstPct: 18, uom: 'Nos' }], 'approved'],
    ['RWP-2611-09', 'Rajhans Wire Products', [{ itemId: item('ITM/00029').id, qty: 10, rate: rateOf('ITM/00029'), discountPct: 0, gstPct: 18, uom: 'Nos' }, { itemId: item('ITM/00030').id, qty: 1, rate: rateOf('ITM/00030'), gstPct: 18, uom: 'Nos' }], 'approved'],
    ['TFS/PO/118', 'Tulsi Fasteners', [{ itemId: item('ITM/00016').id, qty: 8, rate: rateOf('ITM/00016'), discountPct: 1, gstPct: 18, uom: 'Nos' }], 'draft'],
    ['SC/26/0071', 'Shivneri Cables', [{ itemId: item('ITM/00027').id, qty: 14, rate: rateOf('ITM/00027'), discountPct: 3, gstPct: 18, uom: 'Nos' }], 'approved'],
  ];
  for (const [po, who, lines, end] of direct) {
    let o = orderOf(po);
    if (o) L.stats.skipped++;
    else o = await ensure(`order ${po}`, null, 'POST', '/sales/orders', { customerId: cust(who).id, customerPoNo: po, customerPoDate: d(8), orderDate: d(9), deliveryDate: d(27), shipTo: `${who}, Plant gate 2, MIDC`, notes: 'Direct order against customer purchase order', lines });
    if (o?.id && end === 'approved' && o.status === 'Draft') await act(`order ${po} submit`, 'POST', `/sales/orders/${o.id}/submit`, undefined, ifm(o.version));
  }
  // approve every draft order from quotations (to-order creates Draft) except the one kept as draft
  const orders2 = await list('/sales/orders');
  for (const o of orders2.filter((x) => x.status === 'Draft' && x.customerPoNo !== 'TFS/PO/118' && /SEED|PO|\//.test(x.customerPoNo ?? ''))) {
    if (!toOrder.some((t) => t[1] === o.customerPoNo)) continue;
    await act(`order ${o.customerPoNo} submit`, 'POST', `/sales/orders/${o.id}/submit`, undefined, ifm(o.version));
  }

  console.log('Order reservations');
  const orders3 = await list('/sales/orders');
  for (const po of ['ASHA/PO/2611/045', 'KH-PO-2611-17', 'LSG/PO/4410']) {
    const o = orders3.find((x) => x.customerPoNo === po); if (!o || o.status !== 'Approved') continue;
    const full = (await api('GET', `/sales/orders/${o.id}`)).data;
    if ((full.lines ?? []).some((l) => Number(l.reservedQty ?? 0) > 0 || Number(l.dispatchedQty ?? 0) > 0)) { L.stats.skipped++; continue; }
    const wh = (await api('GET', '/lookups/warehouses')).data.find((w) => w.code === (/ITM\/000(1[6-9]|20)/.test((full.lines[0]?.itemCode) ?? '') ? 'TAL-FG' : 'TAL-MAIN'))?.id;
    await act(`reserve ${po}`, 'POST', `/sales/orders/${o.id}/reserve`, { warehouseId: wh, priority: 'High' });
  }

  await fulfilment();
}

// =================================================================================================================
// Fulfilment: dispatch -> invoice -> receipt (collections) -> sales return
// =================================================================================================================
async function fulfilment() {
  console.log('Dispatch');
  const whs = Object.fromEntries((await api('GET', '/lookups/warehouses')).data.map((w) => [w.code, w.id]));
  const orders = await list('/sales/orders');
  const dispatches = await list('/sales/dispatch');
  const disp = {};
  // [tag, order PO, warehouse, {itemCode: qty}, end state, vehicle, transporter]
  const plan = [
    ['SEED-D-01', 'ASHA/PO/2611/045', 'TAL-FG', { 'ITM/00016': 12, 'ITM/00017': 10 }, 'posted', 'MH 04 JK 4821', 'Shree Sai Roadlines'],
    ['SEED-D-02', 'DAC-PO-8841', 'TAL-FG', { 'ITM/00019': 6 }, 'posted', 'MH 12 QP 7730', 'VRL Logistics'],
    ['SEED-D-03', 'HGB/26-27/0612', 'TAL-MAIN', { 'ITM/00020': 12, 'ITM/00021': 2 }, 'posted', 'MH 14 GU 2290', 'Gati Express'],
    ['SEED-D-04', 'KH-PO-2611-17', 'TAL-FG', { 'ITM/00018': 12 }, 'posted', 'MH 43 AD 1156', 'Shree Sai Roadlines'],
    ['SEED-D-05', 'GC/PO/1187', 'TAL-MAIN', { 'ITM/00025': 6, 'ITM/00029': 6 }, 'posted', 'GJ 01 XT 9042', 'Patel Transport Co'],
    ['SEED-D-06', 'IM/PUR/26/3321', 'TAL-FG', { 'ITM/00018': 3 }, 'approved', 'MH 04 HH 6612', 'Own vehicle'],
    ['SEED-D-07', 'LSG/PO/4410', 'TAL-MAIN', { 'ITM/00024': 3 }, 'draft', null, null],
    ['SEED-D-08', 'SC/26/0071', 'TAL-MAIN', { 'ITM/00027': 7 }, 'cancelled', 'MH 05 BC 3318', 'Gati Express'],
    ['SEED-D-09', 'RWP-2611-09', 'TAL-MAIN', { 'ITM/00029': 10, 'ITM/00030': 1 }, 'posted', 'MH 46 CD 9087', 'VRL Logistics'],
  ];
  for (const [tag, po, wc, qtys, end, vehicleNo, transporter] of plan) {
    const o = orders.find((x) => x.customerPoNo === po);
    if (!o) continue;
    let dd = dispatches.find((x) => x.remark === tag);
    if (dd) L.stats.skipped++;
    else {
      const from = (await api('GET', `/sales/dispatch/from-order/${o.id}`)).data;
      const lines = from.lines.filter((l) => qtys[l.itemCode]).map((l) => ({ orderLineId: l.orderLineId, qty: Math.min(qtys[l.itemCode], Number(l.openQty)) }));
      if (!lines.length) continue;
      dd = await ensure(`dispatch ${tag}`, null, 'POST', '/sales/dispatch', { orderId: o.id, warehouseId: whs[wc], dispatchDate: d(15), vehicleNo, transporter, lrNo: vehicleNo ? `LR${tag.slice(-2)}${o.number.slice(-4)}` : null, driver: vehicleNo ? 'Ramesh Pawar' : null, shipTo: o.shipTo ?? null, weightKg: '420', remark: tag, lines });
    }
    if (!dd?.id) continue;
    disp[tag] = dd.id;
    const get = async () => (await api('GET', `/sales/dispatch/${dd.id}`)).data;
    let cur = await get();
    if (end === 'draft') continue;
    if (cur.status === 'Draft') { await act(`dispatch ${tag} submit`, 'POST', `/sales/dispatch/${dd.id}/submit`, undefined, ifm(cur.version)); cur = await get(); }
    if (end === 'approved') continue;
    if (cur.status === 'Approved') { const r = await act(`dispatch ${tag} post`, 'POST', `/sales/dispatch/${dd.id}/post`); if (r.ok) console.log(`    ${tag}: posted`); cur = await get(); }
    if (end === 'cancelled' && cur.status === 'Posted') await act(`dispatch ${tag} cancel`, 'POST', `/sales/dispatch/${dd.id}/cancel`, { reason: 'Vehicle breakdown, goods returned to store' });
  }
  // short-close the untouched balance of one order line
  const hgb = orders.find((x) => x.customerPoNo === 'HGB/26-27/0612');
  if (hgb) {
    const full = (await api('GET', `/sales/orders/${hgb.id}`)).data;
    const line = (full.lines ?? []).find((l) => l.itemCode === 'ITM/00021');
    if (line && Number(line.closedQty ?? 0) === 0 && full.status === 'Approved') await act('short-close HGB line', 'POST', `/sales/orders/${hgb.id}/short-close`, { lineIds: [line.id], reason: 'Customer reduced the gear box 1:20 requirement' });
  }

  console.log('Invoices');
  const invoices = await list('/sales/invoices');
  const invs = {};
  const invPlan = [['SEED-I-01', 'SEED-D-01', 'posted'], ['SEED-I-02', 'SEED-D-02', 'posted'], ['SEED-I-03', 'SEED-D-03', 'posted'], ['SEED-I-04', 'SEED-D-04', 'posted'], ['SEED-I-05', 'SEED-D-05', 'draft'], ['SEED-I-06', 'SEED-D-09', 'cancelled']];
  for (const [tag, dtag, end] of invPlan) {
    const dispId = disp[dtag] ?? (await list('/sales/dispatch')).find((x) => x.remark === dtag)?.id;
    if (!dispId) continue;
    let inv = invoices.find((x) => (x.notes ?? '') === tag);
    if (inv) L.stats.skipped++;
    else inv = await ensure(`invoice ${tag}`, null, 'POST', '/sales/invoices', { dispatchId: dispId, invoiceDate: d(15), freight: tag === 'SEED-I-03' ? '2500' : null, notes: tag });
    if (!inv?.id) continue;
    invs[tag] = inv.id;
    const get = async () => (await api('GET', `/sales/invoices/${inv.id}`)).data;
    let cur = await get();
    if (end === 'draft') continue;
    if (cur.status === 'Draft') { await act(`invoice ${tag} submit`, 'POST', `/sales/invoices/${inv.id}/submit`, undefined, ifm(cur.version)); cur = await get(); }
    if (cur.status === 'Approved') { const r = await act(`invoice ${tag} post`, 'POST', `/sales/invoices/${inv.id}/post`); if (r.ok) console.log(`    ${tag}: posted`); cur = await get(); }
    if (end === 'cancelled' && cur.status === 'Posted') await act(`invoice ${tag} cancel`, 'POST', `/sales/invoices/${inv.id}/cancel`, { reason: 'Wrong billing address on invoice, re-issuing' });
  }

  console.log('Collections');
  const banks = await bankAccounts();
  const receipts = await list('/sales/receipts');
  const hdfc = banks[0]?.id; const icici = banks[1]?.id;
  const postedInv = async (tag) => { const id = invs[tag]; if (!id) return null; const i = (await api('GET', `/sales/invoices/${id}`)).data; return i.status === 'Posted' ? i : null; };
  const rcPlan = [
    ['SEED-RCT-01', 'SEED-I-01', 1, 'NEFT', hdfc, d(14), 'full'],
    ['SEED-RCT-02', 'SEED-I-02', 0.5, 'RTGS', hdfc, d(14), 'part'],
    ['SEED-RCT-03', 'SEED-I-03', 1, 'UPI', icici, d(15), 'full'],
    ['SEED-RCT-04', 'SEED-I-04', 0.3, 'Cheque', icici, d(15), 'part'],
  ];
  for (const [ref, itag, frac, mode, bank, date, kind] of rcPlan) {
    if (receipts.find((r) => r.reference === ref)) { L.stats.skipped++; continue; }
    const inv = await postedInv(itag); if (!inv || !bank) continue;
    const amount = (Number(inv.grandTotal) * frac).toFixed(2);
    const r = await act(`receipt ${ref}`, 'POST', '/sales/receipts', { customerId: inv.customerId, bankAccountId: bank, amount, mode, receiptDate: date, reference: ref, allocations: [{ invoiceId: inv.id, amount }] });
    if (r.ok) { L.stats.created++; console.log(`  + receipt ${ref} ${amount} ${kind}`); }
  }
  if (!receipts.find((r) => r.reference === 'SEED-RCT-05') && hdfc) {
    const r = await act('receipt on account', 'POST', '/sales/receipts', { customerId: cust('Citra Engineering').id, bankAccountId: hdfc, amount: '150000.00', mode: 'NEFT', receiptDate: d(15), reference: 'SEED-RCT-05' });
    if (r.ok) { L.stats.created++; console.log('  + receipt SEED-RCT-05 (advance, unallocated)'); }
  } else L.stats.skipped++;

  console.log('Sales returns');
  const returns = await list('/sales/returns');
  const retPlan = [['SEED-RET-01', 'SEED-I-04', 'TAL-FG', 1, 'Motor shaft key damaged in transit', 'posted'], ['SEED-RET-02', 'SEED-I-02', 'TAL-FG', 1, 'Wrong model shipped, customer asked for replacement', 'approved'], ['SEED-RET-03', 'SEED-I-03', 'TAL-MAIN', 1, 'Packing damage on gear box casing', 'draft']];
  for (const [tag, itag, wc, qty, reason, end] of retPlan) {
    if (returns.find((r) => r.reason === `${tag} ${reason}` || (r.reason ?? '').startsWith(tag))) { L.stats.skipped++; continue; }
    const inv = await postedInv(itag); if (!inv) continue;
    const rt = await ensure(`return ${tag}`, null, 'POST', '/sales/returns', { invoiceId: inv.id, warehouseId: whs[wc], returnDate: d(15), reason: `${tag} ${reason}`, lines: [{ invoiceLineId: inv.lines[0].id, qty, reason }] });
    if (!rt?.id || end === 'draft') continue;
    const get = async () => (await api('GET', `/sales/returns/${rt.id}`)).data;
    let cur = await get();
    if (cur.status === 'Draft') { await act(`return ${tag} submit`, 'POST', `/sales/returns/${rt.id}/submit`, undefined, ifm(cur.version)); cur = await get(); }
    if (end === 'posted' && cur.status === 'Approved') await act(`return ${tag} post`, 'POST', `/sales/returns/${rt.id}/post`);
  }
}

// =================================================================================================================
// Sawardari plant (a few documents: quotation -> order -> dispatch -> invoice, plus a draft quotation)
// =================================================================================================================
async function sawardari() {
  console.log('Sawardari plant');
  await L.setUnit('SAW');
  try {
    const whs = Object.fromEntries((await api('GET', '/lookups/warehouses')).data.map((w) => [w.code, w.id]));
    const quotes = await list('/sales/quotations');
    const mk = async (ref, who, lines) => {
      const ex = quotes.find((q) => q.customerRef === ref);
      if (ex) { L.stats.skipped++; return ex; }
      return ensure(`quotation ${ref} (SAW)`, null, 'POST', '/sales/quotations', { customerId: cust(who).id, quoteDate: d(8), validUntil: '2026-12-31', customerRef: ref, notes: 'Sawardari plant quotation. Ex-works Sawardari.', lines });
    };
    const q1 = await mk('SEED-QS-01', 'Pragati Valves', [ql('ITM/00016', 20, 2), ql('ITM/00017', 10, 2)]);
    await mk('SEED-QS-02', 'Rajhans Wire Products', [ql('ITM/00018', 5, 0)]);
    if (!q1?.id) return;
    const getQ = async () => (await api('GET', `/sales/quotations/${q1.id}`)).data;
    let cur = await getQ();
    if (cur.status === 'Draft') { await act('SAW quotation submit', 'POST', `/sales/quotations/${q1.id}/submit`, undefined, ifm(cur.version)); cur = await getQ(); }
    if (cur.status === 'Approved' && cur.customerStatus === 'PENDING') await act('SAW quotation accept', 'POST', `/sales/quotations/${q1.id}/customer-decision`, { decision: 'ACCEPTED', decidedOn: d(10) });
    const orders = await list('/sales/orders');
    let o = orders.find((x) => x.customerPoNo === 'PV/PO/SAW/2611/07');
    if (o) L.stats.skipped++;
    else { const r = await act('SAW order', 'POST', `/sales/quotations/${q1.id}/to-order`, { customerPoNo: 'PV/PO/SAW/2611/07', customerPoDate: d(11), deliveryDate: d(30) }); if (r.ok) { L.stats.created++; o = r.data; console.log('  + SAW order'); } }
    if (!o?.id) return;
    const getO = async () => (await api('GET', `/sales/orders/${o.id}`)).data;
    let oc = await getO();
    if (oc.status === 'Draft') { await act('SAW order submit', 'POST', `/sales/orders/${o.id}/submit`, undefined, ifm(oc.version)); oc = await getO(); }
    if (oc.status !== 'Approved') return;
    let dd = (await list('/sales/dispatch')).find((x) => x.remark === 'SEED-DS-01');
    if (dd) L.stats.skipped++;
    else {
      const from = (await api('GET', `/sales/dispatch/from-order/${o.id}`)).data;
      dd = await ensure('dispatch SEED-DS-01 (SAW)', null, 'POST', '/sales/dispatch', { orderId: o.id, warehouseId: whs['SAW-MAIN'], dispatchDate: d(15), vehicleNo: 'KA 01 MN 4410', transporter: 'Gati Express', lrNo: 'LRSAW0101', driver: 'Suresh Jadhav', weightKg: '310', remark: 'SEED-DS-01', lines: from.lines.map((l) => ({ orderLineId: l.orderLineId, qty: Math.min(10, Number(l.openQty)) })) });
    }
    if (!dd?.id) return;
    const getD = async () => (await api('GET', `/sales/dispatch/${dd.id}`)).data;
    let dc = await getD();
    if (dc.status === 'Draft') { await act('SAW dispatch submit', 'POST', `/sales/dispatch/${dd.id}/submit`, undefined, ifm(dc.version)); dc = await getD(); }
    if (dc.status === 'Approved') { await act('SAW dispatch post', 'POST', `/sales/dispatch/${dd.id}/post`); dc = await getD(); }
    if (dc.status !== 'Posted') return;
    let inv = (await list('/sales/invoices')).find((x) => x.notes === 'SEED-IS-01');
    if (inv) L.stats.skipped++;
    else inv = await ensure('invoice SEED-IS-01 (SAW)', null, 'POST', '/sales/invoices', { dispatchId: dd.id, invoiceDate: d(15), notes: 'SEED-IS-01' });
    if (!inv?.id) return;
    const getI = async () => (await api('GET', `/sales/invoices/${inv.id}`)).data;
    let ic = await getI();
    if (ic.status === 'Draft') { await act('SAW invoice submit', 'POST', `/sales/invoices/${inv.id}/submit`, undefined, ifm(ic.version)); ic = await getI(); }
    if (ic.status === 'Approved') await act('SAW invoice post', 'POST', `/sales/invoices/${inv.id}/post`);
  } finally { await L.setUnit('TAL'); }
}

async function run() {
  await crm();
  await sales();
  await sawardari();
}

if (process.argv[1]?.endsWith('sales-seed.mjs')) {
  const pages = ['crm-leads', 'crm-opportunities', 'crm-pipeline', 'crm-followups', 'crm-meetings', 'crm-feedback', 'crm-sources', 'sales-quotations', 'sales-orders', 'sales-enquiries', 'sales-reservations', 'sales-delivery', 'sales-dispatch', 'sales-invoices', 'sales-collections', 'sales-pricelist', 'sales-credit', 'sales-returns'];
  await L.withApprovalOff(pages, run);
  L.summary('sales-seed');
}
