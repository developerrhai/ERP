// Seeds Finance demo data through the API: cash/bank accounts, journals, cash book and bank book entries, supplier payments (AP),
// credit and debit notes, bank statements and reconciliation, expense claims, budgets and recurring journals.
// Re-runnable: natural keys are bank account name, journal / payment reference no, note reason, claim description, budget name, statement period.
import * as L from './opslib.mjs';
const { call, ensure, step, list, day } = L;
await L.login();
const ver = (r) => ({ 'if-match': `"${r.version}"` });

await L.withApprovalsOff(['fin-'], async () => {
  const talwade = L.plant('Talwade');
  const accs = Object.fromEntries((await list('/finance/accounts')).map((a) => [a.code, a.id]));
  const ac = (c) => { if (!accs[c]) throw new Error('no account ' + c); return accs[c]; };
  const ccs = await list('/finance/cost-centers');
  const cc = (code) => ccs.find((c) => c.code === code)?.id;
  const ccLeaf = ccs.find((c) => !c.isGroup && (c.unitId === talwade.id || c.unitId === null))?.id;

  // ---- cash and bank accounts
  const banks = await list('/finance/bank-accounts');
  for (const [kind, name, code, bankName, last4, ifsc] of [
    ['CASH', 'Cash in Hand Talwade', '1101'], ['PETTY', 'Petty Cash Imprest Talwade', '1102'],
    ['BANK', 'SBI Current A/c Talwade', '1113', 'State Bank of India', '7733', 'SBIN0000456'],
  ]) await ensure(`bank account ${name}`, null, (b) => b.name === name, '/finance/bank-accounts', { unitId: talwade.id, accountId: ac(code), kind, name, ...(bankName ? { bankName, accountLast4: last4, ifsc } : {}) }, banks);
  const BA = Object.fromEntries((await list('/finance/bank-accounts')).map((b) => [b.name, b]));
  const HDFC = BA['HDFC Current A/c Talwade'], SBI = BA['SBI Current A/c Talwade'], CASH = BA['Cash in Hand Talwade'], PETTY = BA['Petty Cash Imprest Talwade'];
  const ICICI = BA['ICICI Collection A/c Talwade'];

  // ---- manual journals: [reference, date, type, narration, lines [[code, dr, cr, narration?]], final: 'Posted'|'Submitted'|'Draft', reverse?]
  const jrs = await list('/finance/journals');
  const journals = [
    ['JV-DEMO-01', 1, 'Opening', 'Opening bank, cash and capital balances for the demo year', [['1111', 4000000, 0], ['1113', 1500000, 0], ['1101', 200000, 0], ['3001', 0, 5700000]], 'Posted'],
    ['JV-DEMO-02', 3, 'Journal', 'Factory rent for November, provided', [['6201', 85000, 0, 'Rent Nov 2026'], ['2103', 0, 85000]], 'Posted'],
    ['JV-DEMO-03', 5, 'Provision', 'Electricity charges provision for November', [['6203', 142300, 0], ['2103', 0, 142300]], 'Posted'],
    ['JV-DEMO-04', 8, 'Depreciation', 'Depreciation on plant and machinery for November', [['6241', 118400, 0], ['1703', 0, 118400]], 'Posted'],
    ['JV-DEMO-05', 10, 'Bank Charges', 'HDFC bank charges and RTGS fees', [['6216', 1180, 0], ['1111', 0, 1180]], 'Posted'],
    ['JV-DEMO-06', 11, 'Adjustment', 'Insurance paid in advance for 12 months (policy 7731)', [['1504', 96000, 0], ['2103', 0, 96000]], 'Posted', true],
    ['JV-DEMO-07', 12, 'Journal', 'Staff welfare accrual for the festival gifts', [['6103', 24500, 0], ['2103', 0, 24500]], 'Submitted'],
    ['JV-DEMO-09', 6, 'Journal', 'Small operating expenses of the first fortnight, booked with cost centre', [['6205', 3200, 0], ['6222', 6800, 0], ['6212', 4150, 0], ['6214', 12600, 0], ['6220', 2450, 0], ['6207', 35000, 0], ['2103', 0, 64200]], 'Posted'],
    ['JV-DEMO-08', 13, 'Journal', 'Audit fee provision, second quarter', [['6208', 45000, 0], ['2103', 0, 45000]], 'Draft'],
  ];
  for (const [referenceNo, d, voucherType, narration, lines, final, rev] of journals) {
    const j = await ensure(`journal ${referenceNo}`, null, (x) => x.referenceNo === referenceNo, '/finance/journals', { unitId: talwade.id, docDate: day(d), voucherType, narration, referenceNo, lines: lines.map(([c, debit, credit, n]) => ({ accountId: ac(c), debit: String(debit), credit: String(credit), ...(n ? { narration: n } : {}), ...(c.startsWith('6') && ccLeaf ? { costCenterId: ccLeaf } : {}) })) }, jrs);
    if (!j) continue;
    let cur = (await call('GET', `/finance/journals/${j.id}`)).data;
    if (final !== 'Draft' && cur.status === 'Draft') { await step('journal submit', 'POST', `/finance/journals/${cur.id}/submit`, {}, ver(cur)); cur = (await call('GET', `/finance/journals/${j.id}`)).data; }
    if (final === 'Posted' && ['Submitted', 'Approved', 'Pending Approval'].includes(cur.status)) { await step('journal post', 'POST', `/finance/journals/${cur.id}/post`, {}, ver(cur)); cur = (await call('GET', `/finance/journals/${j.id}`)).data; }
    if (rev && cur.status === 'Posted' && !cur.reversedById && !cur.reversalOf) await step('journal reverse', 'POST', `/finance/journals/${cur.id}/reverse`, { reason: 'Policy was cancelled and re-issued, entry reversed', reverseDate: day(14), docDate: day(14) });
  }
  L.summary('fin journals');

  // ---- cash book and bank book: [reference, date, kind, bank account, amount, mode, counter account | to account | supplier, narration]
  const pays = await list('/finance/payments');
  const sup = (await list('/suppliers')).filter((s) => s.status === 'ACTIVE');
  const P = async (referenceNo, d, kind, ba, amount, mode, other, narration) => {
    if (!ba) return null;
    const body = { kind, docDate: day(d), bankAccountId: ba.id, amount: String(amount), mode, referenceNo, narration };
    if (kind === 'TRANSFER') body.toBankAccountId = other.id; else if (other.supplierId) { body.supplierId = other.supplierId; body.allowAdvance = true; } else body.counterAccountId = other;
    return ensure(`payment ${referenceNo}`, null, (x) => x.referenceNo === referenceNo, '/finance/payments', body, pays);
  };
  await P('CB-DEMO-01', 4, 'TRANSFER', HDFC, 150000, 'Cheque', CASH, 'Cash withdrawn from HDFC for site expenses');
  await P('CB-DEMO-02', 5, 'TRANSFER', CASH, 25000, 'Cash', PETTY, 'Imprest to the store petty cash');
  await P('CB-DEMO-03', 6, 'PAYMENT', CASH, 3200, 'Cash', ac('2103'), 'Printer paper and stationery');
  await P('CB-DEMO-04', 7, 'PAYMENT', CASH, 6800, 'Cash', ac('2103'), 'Canteen tea and snacks, week 1');
  await P('CB-DEMO-05', 9, 'PAYMENT', CASH, 4150, 'Cash', ac('2103'), 'Diesel for company van');
  await P('CB-DEMO-06', 10, 'PAYMENT', CASH, 12600, 'Cash', ac('2103'), 'Housekeeping material and labour');
  await P('CB-DEMO-07', 12, 'PAYMENT', PETTY, 2450, 'Cash', ac('2103'), 'Courier charges for samples');
  await P('CB-DEMO-08', 13, 'RECEIPT', CASH, 18000, 'Cash', ac('4106'), 'Scrap sold at the gate, cash');
  await P('BB-DEMO-01', 4, 'PAYMENT', HDFC, 85000, 'NEFT', ac('2103'), 'Factory rent for November');
  await P('BB-DEMO-02', 6, 'PAYMENT', HDFC, 35000, 'NEFT', ac('2103'), 'Legal and professional fee, Adv. Kulkarni');
  await P('BB-DEMO-03', 8, 'PAYMENT', SBI, 142300, 'RTGS', ac('2103'), 'MSEDCL electricity bill October');
  await P('BB-DEMO-04', 10, 'RECEIPT', HDFC, 82500, 'NEFT', ac('4106'), 'Scrap sale to Shree Metal Traders');
  await P('BB-DEMO-05', 11, 'RECEIPT', SBI, 14760, 'UPI', ac('4201'), 'Interest credited on fixed deposit');
  await P('BB-DEMO-06', 12, 'TRANSFER', SBI, 300000, 'RTGS', HDFC, 'Fund transfer SBI to HDFC for supplier payments');
  await P('BB-DEMO-07', 13, 'PAYMENT', HDFC, 96000, 'NEFT', ac('1504'), 'Insurance premium, fire and burglary policy');
  // supplier payments (AP): settle open bills when there are any, otherwise advance payments
  const bills = L.rowsOf((await call('GET', '/finance/open-items?side=PAYABLE&status=Open&size=100')).data).filter((b) => Number(b.outstanding) > 0 && b.partyType === 'SUPPLIER');
  let n = 0;
  for (const b of bills.slice(0, 5)) {
    n++;
    await P(`AP-DEMO-${b.docNo}`, 13, 'PAYMENT', HDFC, Math.min(Number(b.outstanding), 250000).toFixed(2), 'NEFT', { supplierId: b.partyId }, `Payment against bill ${b.docNo}`);
  }
  for (const [i, s] of sup.slice(0, 3).entries()) await P(`AP-DEMO-ADV${i + 1}`, 9 + i, 'PAYMENT', i === 1 ? SBI : HDFC, 50000 * (i + 1), 'NEFT', { supplierId: s.id }, `Advance to ${s.name} against the November order`);
  L.summary('fin payments');

  // ---- credit and debit notes
  const cust = (await list('/customers')).filter((c) => c.status === 'ACTIVE');
  const noteDefs = [
    ['credit-notes', 'CREDIT', 'REDUCE', cust[0], ac('4107'), 12500, 'Sales return of damaged goods, 5 pieces', 'INV/26-27/0412'],
    ['credit-notes', 'CREDIT', 'REDUCE', cust[1], ac('4108'), 8400, 'Rate difference allowed on the October supplies', 'INV/26-27/0398'],
    ['credit-notes', 'CREDIT', 'REDUCE', cust[2], ac('4107'), 31900, 'Short supply, quantity short by 2 units', 'INV/26-27/0420'],
    ['debit-notes', 'DEBIT', 'REDUCE', sup[0], ac('5103'), 15200, 'Rejected material returned to the supplier, 120 kg', 'GRN/26-27/0088'],
    ['debit-notes', 'DEBIT', 'REDUCE', sup[1], ac('5103'), 6300, 'Excess rate billed against the purchase order', 'PO/26-27/0041'],
    ['debit-notes', 'DEBIT', 'REDUCE', sup[2], ac('5111'), 9800, 'Price difference on bought-out gaskets', 'PO/26-27/0047'],
  ];
  let nIdx = 0;
  for (const [path, kind, effect, party, counter, amount, reason, againstDocNo] of noteDefs) {
    nIdx++;
    if (!party) continue;
    const notes = L.rowsOf((await call('GET', `/finance/${path}?size=100`)).data);
    const note = await ensure(`${kind} note ${reason}`, null, (x) => x.reason === reason, `/finance/${path}`, { effect, unitId: talwade.id, partyId: party.id, docDate: day(6 + nIdx), counterAccountId: counter, amount: String(amount), reason, againstDocNo }, notes);
    if (note && note.status === 'Draft' && nIdx % 3 !== 0) {
      let cur = (await call('GET', `/finance/${path}/${note.id}`)).data;
      const r = await step('note submit', 'POST', `/finance/${path}/${note.id}/submit`, {}, ver(cur)); cur = (await call('GET', `/finance/${path}/${note.id}`)).data;
      if (['Submitted', 'Approved', 'Draft'].includes(cur.status)) await step('note post', 'POST', `/finance/${path}/${note.id}/post`, {}, ver(cur));
    }
  }
  L.summary('fin notes');

  // ---- bank statements and reconciliation
  const stmts = await list('/finance/bank-statements');
  if (HDFC && !stmts.some((s) => s.bankAccountId === HDFC.id)) {
    const pl = (await list(`/finance/payments?bankAccountId=${HDFC.id}`)).filter((p) => p.status === 'Posted').sort((a, b) => String(a.docDate).localeCompare(String(b.docDate)));
    let bal = 4000000; // opening journal posted on the 1st
    const lines = [];
    for (const p of pl) {
      const out = p.kind === 'PAYMENT' || (p.kind === 'TRANSFER' && p.bankAccountId === HDFC.id);
      bal += out ? -Number(p.amount) : Number(p.amount);
      lines.push({ txnDate: String(p.docDate).slice(0, 10), description: `${p.mode} ${p.narration ?? ''}`.slice(0, 120), refNo: p.referenceNo ?? undefined, ...(out ? { withdrawal: String(p.amount) } : { deposit: String(p.amount) }) });
    }
    lines.push({ txnDate: day(10), description: 'Bank charges and RTGS fees', refNo: 'CHG-1110', withdrawal: '1180' }); bal -= 1180;
    await ensure('bank statement HDFC November', null, () => false, '/finance/bank-statements', { bankAccountId: HDFC.id, periodFrom: day(1), periodTo: day(14), openingBalance: '4000000', closingBalance: bal.toFixed(2), lines }, []);
    const s = (await list('/finance/bank-statements')).find((x) => x.bankAccountId === HDFC.id);
    if (s) {
      const sg = await call('GET', `/finance/bank-statements/${s.id}/suggestions`);
      const sugg = L.rowsOf(sg.data?.suggestions ?? sg.data);
      for (const g of sugg) if (g.lineId && (g.glEntryId ?? g.entryId)) await step('stmt match', 'POST', `/finance/bank-statements/${s.id}/match`, { lineId: g.lineId, glEntryId: g.glEntryId ?? g.entryId });
    }
  } else L.stats.skipped++;
  if (ICICI && !stmts.some((s) => s.bankAccountId === ICICI.id))
    await ensure('bank statement ICICI November', null, () => false, '/finance/bank-statements', { bankAccountId: ICICI.id, periodFrom: day(1), periodTo: day(14), openingBalance: '0', closingBalance: '248500', lines: [{ txnDate: day(5), description: 'NEFT credit Asha Steel Works Pvt Ltd', refNo: 'N310226110501', deposit: '175000' }, { txnDate: day(9), description: 'RTGS credit Bharat Fabricators', refNo: 'R310226110902', deposit: '98500' }, { txnDate: day(12), description: 'Bank charges', refNo: 'CHG-1112', withdrawal: '25000' }] }, []);
  L.summary('fin bank statements');

  // ---- expense claims
  const claims = await list('/finance/expenses');
  const pol = await list('/finance/expense-policies');
  const catOf = (n) => pol.find((p) => p.category === n)?.category ?? pol[0].category;
  for (const [i, [cat, amount, description, billNo, finalSt]] of [
    ['Travel', 4200, 'Cab fare for supplier audit visit to Pune, 2 days', 'CAB/1182', 'Paid'],
    ['Food', 1200, 'Working lunch with the customer team', 'RST/771', 'Paid'],
    ['Communication', 1100, 'Mobile recharge for the dispatch supervisor', 'RCG/5521', 'Submitted'],
    ['Travel', 6800, 'Train and auto fare for the Nashik vendor meeting', 'TKT/3092', 'Submitted'],
    ['Entertainment', 2800, 'Customer visit hospitality', 'HTL/118', 'Draft'],
    ['Food', 950, 'Night shift snacks for maintenance crew', 'RST/812', 'Draft'],
  ].entries()) {
    const c = await ensure(`expense ${description}`, null, (x) => x.description === description, '/finance/expenses', { unitId: talwade.id, claimDate: day(3 + i * 2), category: catOf(cat), amount: String(amount), description, billNo, costCenterId: ccLeaf }, claims);
    if (!c) continue;
    let cur = (await call('GET', `/finance/expenses/${c.id}`)).data;
    if (finalSt !== 'Draft' && cur.status === 'Draft') { await step('claim submit', 'POST', `/finance/expenses/${c.id}/submit`, {}, ver(cur)); cur = (await call('GET', `/finance/expenses/${c.id}`)).data; }
    if (finalSt === 'Paid' && ['Approved', 'Submitted'].includes(cur.status)) await step('claim pay', 'POST', `/finance/expenses/${c.id}/pay`, { bankAccountId: CASH?.id ?? HDFC.id, mode: 'Cash', docDate: day(14) }, ver(cur));
  }
  L.summary('fin expenses');

  // ---- budgets (FY 2026-27, Talwade): twelve monthly amounts
  const buds = await list('/finance/budgets');
  for (const [name, code, perMonth] of [['Rent budget', '6201', 85000], ['Electricity budget', '6203', 150000], ['Repairs and maintenance, plant', '6211', 60000], ['Travel and conveyance budget', '6206', 40000], ['Housekeeping budget', '6214', 15000], ['Training and development', '6219', 20000]]) {
    const months = Array.from({ length: 12 }, (_, m) => String(Math.round(perMonth * (m === 10 ? 1.1 : 1))));
    const b = await ensure(`budget ${name}`, null, (x) => x.name === name, '/finance/budgets', { unitId: talwade.id, accountId: ac(code), name, months, ...(ccLeaf ? { costCenterId: ccLeaf } : {}) }, buds);
    if (b && b.status === 'Draft' && code !== '6219') await step('budget activate', 'POST', `/finance/budgets/${b.id}/status`, { status: 'Active' }, ver(b));
  }

  // ---- recurring journals
  const recs = await list('/finance/recurring');
  await ensure('recurring rent accrual', null, (x) => x.name === 'Monthly rent accrual', '/finance/recurring', { unitId: talwade.id, name: 'Monthly rent accrual', voucherType: 'Journal', narration: 'Factory rent provision', frequency: 'MONTHLY', nextRun: day(30), autoPost: false, lines: [{ accountId: ac('6201'), debit: '85000', credit: '0' }, { accountId: ac('2103'), debit: '0', credit: '85000' }] }, recs);
  await ensure('recurring depreciation', null, (x) => x.name === 'Monthly depreciation, plant', '/finance/recurring', { unitId: talwade.id, name: 'Monthly depreciation, plant', voucherType: 'Depreciation', narration: 'Plant and machinery depreciation', frequency: 'MONTHLY', nextRun: day(30), autoPost: false, lines: [{ accountId: ac('6241'), debit: '118400', credit: '0' }, { accountId: ac('1703'), debit: '0', credit: '118400' }] }, recs);

  // ---- Sawardari: a cash account, a journal and a cash payment
  const saw = L.plant('Sawardari');
  const sb = await list('/finance/bank-accounts');
  let sawCash = accs['1103'];
  if (!sawCash) { const a = await ensure('GL account 1103', null, () => false, '/finance/accounts', { code: '1103', name: 'Cash in Hand - Sawardari', parentId: (await list('/finance/accounts')).find((x) => x.code === '1101').parentId, rootType: 'Asset', subType: 'Cash', cfClass: 'CASH' }, []); sawCash = a?.id; }
  if (sawCash) await ensure('Sawardari cash account', null, (b) => b.name === 'Cash in Hand Sawardari', '/finance/bank-accounts', { unitId: saw.id, accountId: sawCash, kind: 'CASH', name: 'Cash in Hand Sawardari' }, sb);
  const sj = await list('/finance/journals');
  const jv = await ensure('journal JV-DEMO-S1', null, (x) => x.referenceNo === 'JV-DEMO-S1', '/finance/journals', { unitId: saw.id, docDate: day(4), voucherType: 'Journal', narration: 'Sawardari factory rent provision, November', referenceNo: 'JV-DEMO-S1', lines: [{ accountId: ac('6201'), debit: '42000', credit: '0', ...(ccLeaf ? { costCenterId: ccLeaf } : {}) }, { accountId: ac('2103'), debit: '0', credit: '42000' }] }, sj);
  if (jv && jv.status === 'Draft') { let cur = (await call('GET', `/finance/journals/${jv.id}`)).data;
    if (ccLeaf && !(cur.lines ?? []).some((l) => l.costCenterId)) { await step('journal cost centre', 'PATCH', `/finance/journals/${jv.id}`, { lines: [{ accountId: ac('6201'), debit: '42000', credit: '0', costCenterId: ccLeaf }, { accountId: ac('2103'), debit: '0', credit: '42000' }] }, ver(cur)); cur = (await call('GET', `/finance/journals/${jv.id}`)).data; } await step('submit', 'POST', `/finance/journals/${jv.id}/submit`, {}, ver(cur)); cur = (await call('GET', `/finance/journals/${jv.id}`)).data; await step('post', 'POST', `/finance/journals/${jv.id}/post`, {}, ver(cur)); }
});
L.summary('finance total');
