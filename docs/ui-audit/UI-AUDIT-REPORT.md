# UI AUDIT REPORT (Phase 36 Part B)

Role audited: **super** · generated 2026-11-13T18:52:52.110Z · local database rhai_erp_ui · V40 = `RHAI_ERP_V40_Edit_Update_Fixed.html` (read-only).

> Method: every page opened in V40 (its own `nav(id)`) and in the ERP at 1440 / 1024 / 390; buttons, tabs, API calls, console, overflow and text problems read from the DOM. Buttons are **not clicked** (no Save/Submit/Approve/Post/Delete/Send); a V40 button counts PRESENT when the ERP shows a button with the same label (or the V40 add/email/pdf alias), PRESENT-PLACEHOLDER when it is disabled, MISSING otherwise; PRESENT-WORKS vs PRESENT-DEAD needs click tests and is reported as PRESENT (untested). Tabs inside pages, record views and add/edit forms are compared by label only (default view screenshots).

## Summary

| Measure | Value |
|---|---|
| Pages audited | 327 of 327 |
| Opened OK | 284 (not found: 43, failed: 0) |
| Issues P0 / P1 / P2 / P3 | 43 / 749 / 3 / 327 |
| Data verdicts | OK-NONTABLE 82 · OK 186 · NOT-FOUND 43 · EMPTY-OK 13 · API-ERROR 3 |
| V40 buttons: missing / placeholder / present | 7294 / 1086 / 1527 (extra ERP-only: 1224) |
| Pages with a missing V40 button | 324 |
| Pages missing V40 tabs | 295 |
| Average UI score (rule-based, /30) | 15.4 |
| Pages below 18/30 | 232 |
| Renderer | own page 240 · generic fallback 87 |
| Page-wide sideways scroll 1440 / 1024 / 390 | 0 / 37 / 122 |
| Pages with "Arrives in Phase" | 11 |
| Inline style attributes (sum over pages) | 1132 |

### Score rule (0-3 each, 10 areas)
header (title present, no extra clutter) · button placement (share of V40 buttons present) · table (register present, no overflow) · filters (search box) · record view (Edit/View/Open present) · form (Add present) · states (no bad text / console errors) · consistency (few inline styles) · phone & tablet (no sideways scroll at 390/1024) · V40 parity (buttons + tabs). Heuristic, from the DOM only.

## Top 25 root causes

| # | Category | Sev | Pages | Example | Fix approach |
|---|---|---|---|---|---|
| 1 | LAYOUT | P3 | 327 | 2 inline style attributes on the page | C1: replace inline styles with ui.css classes |
| 2 | PARITY | P1 | 295 | 7 of 7 V40 tabs missing (ERP has 0) | C5: V36 tabs from the registry on every page (ui Tabs) |
| 3 | BUTTON-MISSING | P1 | 281 | 13 V40 button(s) missing: ← Return, ⇧ Import, ⇩ Export, Duplicates, Department I | C3: one shared head row + record bar (src/ui ActionRow) wired per page |
| 4 | RESPONSIVE | P1 | 122 | page-wide sideways scroll at 390px | C4/C7: tables scroll in their own box, single-column forms |
| 5 | BREAK | P0 | 43 | V40 page id shows "Page not found" in the ERP | C4: fix the page / route |
| 6 | TEXT | P1 | 11 | screen shows "Arrives in Phase" | C3: remove "Arrives in Phase" - grey the button with a reason (ui Button reason) |
| 7 | BREAK | P2 | 3 | console error: Failed to load resource: the server responded with a status of 40 | C4: fix the page / route |
| 8 | API | P1 | 2 | GET /api/v1/hr/attendance/days?month=2027-02 -> 404 | Phase 37 (API) unless wrong URL/field |
| 9 | API | P1 | 1 | GET /api/v1/hr/ess/me -> 404 | Phase 37 (API) unless wrong URL/field |

## Per family

| Family | Pages | Avg score | P0 | P1 | Missing buttons | Worst 3 pages |
|---|---|---|---|---|---|---|
| Executive | 7 | 16.3 | 1 | 13 | 66 | my-approvals (12), command-center (12), ai-insights (13) |
| ERP Process Control | 9 | 11.6 | 6 | 13 | 264 | master-customers (9), master-products (9), master-materials (9) |
| Department Inbox | 12 | 12.0 | 12 | 0 | 276 | dept-inbox-administration (12), dept-inbox-sales (12), dept-inbox-projects (12) |
| CRM | 8 | 18.5 | 0 | 18 | 202 | crm-leads (17), crm-opportunities (17), crm-sources (18) |
| Department Work | 12 | 16.0 | 2 | 12 | 100 | dept-work-sales (12), dept-work-purchase (12), dept-work-engineering (16) |
| Sales | 10 | 17.1 | 0 | 22 | 298 | sales-delivery (16), sales-invoices (16), sales-collections (16) |
| Procurement / SCM | 11 | 17.8 | 0 | 24 | 333 | scm-evaluation (15), scm-comparison (16), scm-grn (16) |
| Inventory | 14 | 16.6 | 0 | 29 | 386 | inv-transactions (14), inv-ageing (14), inv-valuation (14) |
| Warehouse / WMS | 13 | 18.2 | 0 | 33 | 303 | wms-barcode (12), wms-putaway (13), wms-bins (17) |
| Manufacturing | 13 | 16.8 | 0 | 26 | 358 | mfg-mrp (15), mfg-wip (15), mfg-scrap (15) |
| Quality / QMS | 10 | 17.3 | 0 | 21 | 290 | qms-ncr (15), qms-inspections (16), qms-plans (17) |
| Maintenance | 10 | 16.9 | 0 | 20 | 278 | maint-breakdown (15), maint-schedule (15), maint-downtime (15) |
| Finance & Accounts | 19 | 16.2 | 0 | 38 | 517 | fin-cashbook (12), fin-bankbook (12), fin-gl (13) |
| Indian Taxation | 10 | 15.9 | 0 | 22 | 279 | tax-salesreg (14), tax-purchasereg (14), tax-gstr1 (15) |
| HRMS | 12 | 15.8 | 0 | 36 | 300 | hr-attendance (12), hr-leave (12), hr-ess (12) |
| Payroll | 12 | 14.7 | 0 | 34 | 313 | pay-processing (12), pay-register (12), pay-pf (13) |
| Projects | 17 | 15.4 | 2 | 39 | 402 | proj-dependencies (9), proj-demo-control (12), proj-timesheets (12) |
| Assets | 8 | 17.3 | 0 | 16 | 224 | asset-allocation (15), asset-qr (15), asset-depreciation (17) |
| Service / Support | 9 | 15.7 | 0 | 27 | 186 | service-technicians (12), service-warranty (12), service-claims (12) |
| Logistics / Fleet | 16 | 11.7 | 0 | 42 | 306 | log-transporters (10), log-routes (10), log-freight (10) |
| Business Documents | 7 | 14.1 | 4 | 14 | 184 | dispatch-dc (9), accounts-gst-invoice (9), hr-appointment-letter (9) |
| Document Management | 6 | 17.8 | 0 | 12 | 101 | dms-docs (17), dms-folders (18), dms-versions (18) |
| Business Intelligence | 10 | 11.4 | 0 | 31 | 178 | bi-reports (11), bi-scheduler (11), bi-sales (11) |
| AI & Automation | 11 | 14.5 | 0 | 37 | 89 | auto-workflows (11), auto-rules (11), auto-webhooks (11) |
| Communication | 6 | 11.5 | 0 | 24 | 113 | comm-whatsapp (11), comm-email (11), comm-sms (11) |
| Administration | 24 | 16.8 | 0 | 73 | 284 | admin-backup (10), admin-company (11), admin-import (11) |
| Contract Labour Management | 17 | 13.7 | 6 | 48 | 409 | cl-safety (9), cl-ppe (9), cl-medical (9) |
| Work Management | 2 | 19.0 | 0 | 8 | 16 | ops-shift-roster (17), ops-tasks (21) |
| Workplace Management | 2 | 15.0 | 0 | 7 | 22 | ops-canteen (12), ops-visitors (18) |
| Integrated Plant Flow | 10 | 11.5 | 10 | 10 | 217 | maint-part-movement (9), plant-process-movement (9), plant-unit-routing (9) |

## The 30 slowest pages

| Page | Load ms |
|---|---|
| inv-ageing | 3983 |
| customer-receipts | 3881 |
| mfg-shopfloor | 3448 |
| maint-mtbf | 3262 |
| fin-ageing | 3242 |
| hr-exit | 3177 |
| wms-putaway | 3163 |
| scm-suppliers | 3127 |
| dept-work-warehouse | 3107 |
| scm-approval | 2836 |
| dept-inbox-production | 2783 |
| mfg-fg | 2780 |
| log-transporters | 2721 |
| inv-transfer | 2708 |
| wms-barcode | 2691 |
| mfg-wip | 2685 |
| gate-return | 2645 |
| mfg-routing | 2634 |
| inv-adjustment | 2623 |
| service-history | 2617 |
| scm-rfq | 2614 |
| service-amc | 2613 |
| crm-feedback | 2604 |
| inv-stock | 2604 |
| dept-work-sales | 2603 |
| fleet-documents | 2595 |
| plant-process-movement | 2594 |
| cl-workers | 2591 |
| crm-sources | 2589 |
| inv-transactions | 2584 |

## The 30 slowest API calls

| Page | Call | Status | ms | bytes |
|---|---|---|---|---|
| inv-ageing | POST /api/v1/auth/refresh | 200 | 1220 | 0 |
| dept-work-purchase | GET /api/v1/hardening/privacy/notice?locale=en | 200 | 1178 | 0 |
| dept-work-purchase | GET /api/v1/me/context | 200 | 982 | 720 |
| customer-receipts | POST /api/v1/auth/refresh | 200 | 965 | 0 |
| scm-suppliers | POST /api/v1/auth/refresh | 200 | 697 | 0 |
| mfg-shopfloor | POST /api/v1/auth/refresh | 200 | 684 | 0 |
| maint-mtbf | POST /api/v1/auth/refresh | 200 | 652 | 0 |
| business-documents | GET /api/v1/doc-center/catalog | 200 | 614 | 0 |
| fin-trial | GET /api/v1/finance/reports/trial-balance?asOf=2026-11-13 | 200 | 581 | 143 |
| bi-sales | GET /api/v1/command-center | 200 | 578 | 0 |
| bi-builder | GET /api/v1/command-center | 200 | 570 | 0 |
| fin-trial | GET /api/v1/finance/reports/trial-balance?asOf=2026-11-13 | 200 | 559 | 143 |
| hr-exit | POST /api/v1/auth/refresh | 200 | 541 | 0 |
| bi-dashboards | GET /api/v1/command-center | 200 | 513 | 0 |
| auto-workflows | GET /api/v1/jobs | 200 | 505 | 0 |
| auto-workflows | GET /api/v1/jobs | 200 | 492 | 0 |
| dept-work-warehouse | POST /api/v1/auth/refresh | 200 | 478 | 0 |
| wms-barcode | GET /api/v1/me/permissions?pageId=wms-barcode | 200 | 478 | 621 |
| cl-workers | GET /api/v1/broadcasts/active | 200 | 466 | 11 |
| cl-workers | GET /api/v1/hardening/privacy/notice?locale=en | 200 | 465 | 0 |
| bi-branch | GET /api/v1/command-center | 200 | 462 | 0 |
| gate-in | GET /api/v1/hardening/privacy/notice?locale=en | 200 | 459 | 0 |
| fleet-vehicles | GET /api/v1/vehicle-services | 200 | 447 | 11 |
| fleet-vehicles | GET /api/v1/vehicle-services | 200 | 446 | 11 |
| fleet-vehicles | GET /api/v1/fuel-logs | 200 | 446 | 11 |
| fleet-vehicles | GET /api/v1/vehicles | 200 | 444 | 11 |
| sales-returns | GET /api/v1/me/menu | 200 | 429 | 0 |
| mfg-wip | GET /api/v1/mfg/reports/wip | 200 | 424 | 50 |
| mfg-wip | GET /api/v1/mfg/reports/wip-reconciliation | 200 | 424 | 87 |
| mfg-wip | GET /api/v1/mfg/reports/wip-reconciliation | 200 | 423 | 87 |

## Needs Phase 37 (API / flow)

- hr-attendance: GET /api/v1/hr/attendance/days?month=2027-02 -> 404
- hr-ess: GET /api/v1/hr/ess/me -> 404
- hr-shifts: GET /api/v1/hr/attendance/days?month=2027-02 -> 404

## Part C plan (order of fixes)
1. C1 design system: `src/ui` + `ui.css` (built) → migrate pages to it.
2. C3 one head row (← Return, Excel, Industry PDF, Word, Print, ＋ Add, Edit, Delete, Documents, Submit Approval, Approval Queue, Move Forward, ⇧ Import, ⇩ Export, Duplicates) + record bar; remove the bar above the title; remove "Arrives in Phase".
3. C5 table-first register + V36 tabs on every page; the 12 documents first (Quotation, Sales Order, PR, PO, GRN, Incoming QC, Production Order, Delivery Challan, GST Invoice, Receipt, Purchase Invoice, Payment).
4. C4 fix overflow/breaks listed in issues.csv.
5. C6 Home = V39 department workspace; C7 phone/tablet; C8 NO-DATA-BUG; C9 re-audit with before/after.
