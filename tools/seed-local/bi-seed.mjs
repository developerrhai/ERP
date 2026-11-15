// Seeds BI, Automation and Communication demo data through the API: saved BI reports, report schedules, automation rules
// (some activated), message templates and contact consents. It does NOT send messages, create payment links or create webhook
// endpoints, so nothing leaves the local server. Re-runnable: natural keys are report code, rule code, template code, consent address.
import * as L from './opslib.mjs';
const { call, ensure, step, list } = L;
await L.login();
L.plant('Talwade');

await L.withApprovalsOff(['comm-'], async () => {
  // ---- saved BI reports
  const reports = L.rowsOf((await call('GET', '/bi/reports')).data);
  const repDefs = [
    ['RPT-OPEN-SO', 'Open sales orders by customer', 'sales_orders', ['doc_no', 'customer_name', 'status', 'grand_total'], [{ column: 'status', op: 'ne', value: 'Closed' }], ['customer_name'], 'BAR', 'ALL'],
    ['RPT-AR-AGE', 'Overdue receivables by customer', 'ar_aging', ['customer_name', 'overdue_amount', 'overdue_days'], [], ['customer_name'], 'BAR', 'DEPARTMENT'],
    ['RPT-STOCK-VAL', 'Stock value by warehouse', 'stock_balance', ['warehouse_code', 'on_hand', 'stock_value'], [], ['warehouse_code'], 'PIE', 'ALL'],
    ['RPT-PROD-STATUS', 'Production orders by status', 'production_orders', ['status', 'qty', 'qty_completed'], [], ['status'], 'BAR', 'DEPARTMENT'],
    ['RPT-QC-DECISION', 'Inspections by kind and decision', 'inspections', ['kind', 'decision', 'lot_qty', 'accepted_qty'], [], ['kind', 'decision'], 'TABLE', 'DEPARTMENT'],
    ['RPT-GRN-SUP', 'GRN value by supplier', 'grn', ['supplier_name', 'total_value'], [], ['supplier_name'], 'BAR', 'DEPARTMENT'],
    ['RPT-SHIP-STATUS', 'Shipments by status', 'shipments', ['status', 'weight_kg'], [], ['status'], 'PIE', 'DEPARTMENT'],
    ['RPT-INV-STATUS', 'Invoices and balance due', 'invoices', ['customer_name', 'status', 'grand_total', 'balance_due'], [], ['customer_name'], 'TABLE', 'ALL'],
  ];
  for (const [code, name, datasetCode, columns, filters, groupBy, chartType, visibility] of repDefs)
    await ensure(`BI report ${code}`, null, (r) => r.code === code, '/bi/reports', { code, name, datasetCode, columns, filters, groupBy, chartType, visibility }, reports);
  const R = Object.fromEntries(L.rowsOf((await call('GET', '/bi/reports')).data).map((r) => [r.code, r]));
  const users = await list('/users');
  const owner = users.find((u) => /owner|admin/i.test(u.name + u.loginId) && u.roleLevel >= 90) ?? users[0];
  const heads = users.filter((u) => /^head\./.test(u.loginId ?? '')).slice(0, 3).map((u) => u.id);

  // ---- report schedules
  const schedules = L.rowsOf((await call('GET', '/bi/schedules')).data);
  for (const [code, cronExpr, format] of [['RPT-OPEN-SO', '0 8 * * 1', 'PDF'], ['RPT-AR-AGE', '30 9 * * 1-5', 'XLSX'], ['RPT-STOCK-VAL', '0 7 1 * *', 'CSV']]) {
    if (!R[code]) continue;
    await ensure(`schedule ${code}`, null, (s) => s.reportId === R[code].id && s.cronExpr === cronExpr, '/bi/schedules', { reportId: R[code].id, cronExpr, format, recipientUserIds: [owner?.id, ...heads].filter(Boolean) }, schedules);
  }

  // ---- automation rules
  const rules = L.rowsOf((await call('GET', '/automation/rules')).data);
  const ruleDefs = [
    ['RULE-LOW-STOCK', 'Alert purchase when stock drops below reorder', 'Inventory', 'stock.below_reorder', { field: 'onHand', op: 'lt', value: 10 }, [{ type: 'notify', params: { department: 'Purchase', title: 'Stock below reorder point' } }], true],
    ['RULE-BREAKDOWN', 'Notify maintenance head on P1 breakdown', 'Maintenance', 'breakdown.reported', { field: 'priority', op: 'eq', value: 'P1' }, [{ type: 'notify', params: { department: 'Maintenance', title: 'P1 machine breakdown reported' } }], true],
    ['RULE-NCR', 'Notify quality head when an NCR is raised', 'Quality', 'ncr.raised', { all: [{ field: 'holdQty', op: 'gt', value: 0 }] }, [{ type: 'notify', params: { department: 'Quality', title: 'New non-conformance raised' } }], true],
    ['RULE-INV-OVERDUE', 'Remind finance about overdue invoices', 'Finance', 'invoice.overdue', { field: 'overdueDays', op: 'gte', value: 30 }, [{ type: 'notify', params: { department: 'Finance', title: 'Invoice overdue by 30 days or more' } }], false],
    ['RULE-SO-CONFIRMED', 'Notify production when a sales order is confirmed', 'Sales', 'sales_order.confirmed', { field: 'grandTotal', op: 'gte', value: 100000 }, [{ type: 'notify', params: { department: 'Production', title: 'High value sales order confirmed' } }], false],
  ];
  for (const [code, name, module, triggerEvent, conditions, actions, activate] of ruleDefs) {
    const r = await ensure(`rule ${code}`, null, (x) => x.code === code, '/automation/rules', { code, name, module, triggerEvent, conditions, actions, priority: 10, maxRunsPerHour: 30 }, rules);
    if (r && activate && r.status === 'DRAFT') await step('activate rule', 'POST', `/automation/rules/${r.id}/activate`, { approved: false });
  }

  // ---- message templates and consents (no message is sent)
  const tpls = L.rowsOf((await call('GET', '/comm/templates')).data);
  for (const [code, channel, name, category, body, variables, extra] of [
    ['PAYREM_SMS', 'SMS', 'Payment reminder', 'TRANSACTIONAL', 'Dear {{partyName}}, invoice {{docNo}} of Rs {{amount}} is due on {{dueDate}}. Please pay. Regards, {{unitName}}', ['partyName', 'docNo', 'amount', 'dueDate', 'unitName'], { dltTemplateId: '1107169012345678901', dltHeader: 'RHAIER' }],
    ['DISPATCH_WA', 'WHATSAPP', 'Dispatch update', 'TRANSACTIONAL', 'Your order {{orderNo}} is dispatched in vehicle {{vehicleNo}}. LR {{lrNo}}. Expected delivery {{eta}}.', ['orderNo', 'vehicleNo', 'lrNo', 'eta'], { waTemplateName: 'dispatch_update_v1', waStatus: 'APPROVED' }],
    ['QUOTE_EMAIL', 'EMAIL', 'Quotation sent', 'TRANSACTIONAL', 'Please find quotation {{docNo}} attached. Valid till {{validTill}}.', ['docNo', 'validTill'], {}],
    ['GREET_WA', 'WHATSAPP', 'Festival greeting', 'MARKETING', 'Wishing you and your team a happy and prosperous Diwali. Regards, {{unitName}}', ['unitName'], { waTemplateName: 'diwali_greeting_v1', waStatus: 'APPROVED' }],
  ]) await ensure(`template ${code}`, null, (t) => t.code === code, '/comm/templates', { code, channel, name, category, body, variables, ...extra }, tpls);
  const customers = (await list('/customers')).filter((c) => c.status === 'ACTIVE').slice(0, 6);
  const consents = L.rowsOf((await call('GET', '/comm/consents')).data);
  for (const [i, c] of customers.entries()) {
    const address = `9822${String(100000 + i * 1311).slice(0, 6)}`;
    await ensure(`consent ${address}`, null, (x) => x.address === address && x.channel === 'WHATSAPP', '/comm/consents', { channel: 'WHATSAPP', address, optedIn: i !== 3, partyId: c.id, source: i % 2 ? 'WEB_FORM' : 'SALES_VISIT' }, consents);
  }
});
L.summary('bi/automation/comm total');
