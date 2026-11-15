// Renders docs/ui-audit/DATA-FEED-LOG.md from feed-results.jsonl (latest record per step+item wins).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FeedRecord } from './log';
const dir = path.resolve(__dirname, '../../../docs/ui-audit');
const rows = readFileSync(path.join(dir, 'feed-results.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as FeedRecord);
const latest = new Map<string, FeedRecord>();
for (const r of rows) latest.set(`${r.step}|${r.item}`, r);
const all = [...latest.values()];
const by = (s: string) => all.filter((r) => r.status === s);
const out: string[] = ['# DATA-FEED-LOG (Phase 36 Part A)', '', `Generated ${new Date().toISOString()}. Database: local rhai_erp_ui. Everything below was entered through the screens (Playwright), except the first Super User (seed script).`, ''];
out.push(`**Totals:** done ${by('done').length} · already existed ${by('exists').length} · failed ${by('failed').length} · findings ${by('finding').length}`, '');
const steps = [...new Set(all.map((r) => r.step))];
out.push('## Per step', '', '| Step | Done | Existed | Failed |', '|---|---|---|---|');
for (const s of steps) out.push(`| ${s} | ${all.filter((r) => r.step === s && r.status === 'done').length} | ${all.filter((r) => r.step === s && r.status === 'exists').length} | ${all.filter((r) => r.step === s && r.status === 'failed').length} |`);
out.push('', '## Failed forms', '');
if (!by('failed').length) out.push('None.');
for (const r of by('failed')) out.push(`- **${r.item}** (page \`${r.page}\`): ${(r.note ?? '').replace(/\u001b\[[0-9;]*m/g, '')}${r.api ? ` — API: \`${r.api}\`` : ''}${r.shot ? ` — shot: \`${r.shot}\`` : ''}`);
out.push('', '## Findings (data entry made hard / bugs found)', '');
for (const r of by('finding')) out.push(`- **${r.item}** (\`${r.page ?? ''}\`): ${r.note ?? ''}`);
out.push('', '## Already fixed in Part C (kept above for history)', '',
  '* Customer Master (master-customers) and 42 other V40 page ids showed "Page not found": now redirect to the right screen (ModulePage V40_ALIASES).',
  '* Designation create always failed with 422 (web sent status on create; level range 1-100 vs API 1-99): fixed.',
  '* Customer / supplier / item dropdowns capped at 30 rows and no search: now type-ahead with server search (DocPage LookupCombo).',
  '* Line grid labels not linked (duplicate ids) and no totals: unique ids per line; Taxable / CGST / SGST-IGST / Grand total / amount in words panel added.',
  '* Duplicate Menu button and duplicate Notification Center menu item removed; top bar kept on one line.',
  '* V40 head-row buttons were missing or dead: page bar now carries them with working targets (record ones greyed with a reason); "Arrives in Phase" text removed.',
  '',
  '## Still open from the feed (not fixed)', '',
  '* Raw item UUID in PO/SO detail (API must return item code and name); raw codes NOT_REQUIRED / NONE in GRN view; dialogs that turn into a record view instead of closing; "Submit for Approval" still offered on pending suppliers; HSN master has no GST rate; HSN rule only shown after Save; Customer/Supplier/Enquiry forms smaller than V40; date inputs show mm/dd/yyyy; form footer wording inconsistent (Save / Save Record / Save draft / Create ...).',
  '', '## Deviations and what was NOT fed in this session', '',
  '* Most records were entered as the **Super User** (fast), not as the user of each department. Approvals, Receive/Accept and the BOM/PO/GRN approvals were done by the matrix approvers (Purchase Manager, Purchase Head, Sales Manager/Head, GM, Director, CFO, the receiving department heads).',
  '* **Not fed (listed for the next session):** approval-matrix and workflow-matrix edits, mail automations, attendance policies and devices (step 4); price list, customers/suppliers beyond the 5-field forms, contract workers (5/6); one department Return (8); QC (incoming and final), delivery challans, sales invoices, receipts, purchase invoices, payments, journals, bank entries (9-11); a month of device-simulator attendance, leave, regularisation, overtime, one payroll run (12); shift handovers, canteen scans, maintenance breakdown (assets need "Needs maintenance" ticked first), service tickets, project with gates, gate pass (13).',
  '* Volumes entered: 1 Administrator + 31 users, 20 customers, 20 suppliers (8 approved), 60 items, 4 HSN rows, 3 warehouses, 3 work centres, 3 BOMs (released), 3 routings (released), 10 enquiries, 9 quotations, 6 sales orders (approved; 3 moved Sales -> Purchase / Production / Warehouse and received + accepted), 5 PRs, 6 POs (approved), 4 GRNs (1 posted), 3 production orders (released), 40 employees, 6 tasks, 4 assets, 3 visitors.',
  '* Unit/FY/department seed: 3 plants, 1 FY, 11 departments come from the seed script; Engineering (12th) was added through the screen.');
writeFileSync(path.join(dir, 'DATA-FEED-LOG.md'), out.join('\n') + '\n');
console.log('DATA-FEED-LOG.md written');
