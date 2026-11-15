# UI AUDIT REPORT (Phase 36 Part B)

Role audited: **super-after** · generated 2026-11-13T23:05:04.694Z · local database rhai_erp_ui · V40 = `RHAI_ERP_V40_Edit_Update_Fixed.html` (read-only).

> Method: every page opened in V40 (its own `nav(id)`) and in the ERP at 1440 / 1024 / 390; buttons, tabs, API calls, console, overflow and text problems read from the DOM. Buttons are **not clicked** (no Save/Submit/Approve/Post/Delete/Send); a V40 button counts PRESENT when the ERP shows a button with the same label (or the V40 add/email/pdf alias), PRESENT-PLACEHOLDER when it is disabled, MISSING otherwise; PRESENT-WORKS vs PRESENT-DEAD needs click tests and is reported as PRESENT (untested). Tabs inside pages, record views and add/edit forms are compared by label only (default view screenshots).

## Summary

| Measure | Value |
|---|---|
| Pages audited | 327 of 327 |
| Opened OK | 327 (not found: 0, failed: 0) |
| Issues P0 / P1 / P2 / P3 | 0 / 622 / 4 / 327 |
| Data verdicts | OK 222 · OK-NONTABLE 88 · EMPTY-OK 14 · API-ERROR 3 |
| V40 buttons: missing / placeholder / present | 3208 / 2076 / 4623 (extra ERP-only: 2455) |
| Pages with a missing V40 button | 321 |
| Pages missing V40 tabs | 295 |
| Average UI score (rule-based, /30) | 20.2 |
| Pages below 18/30 | 63 |
| Renderer | own page 240 · generic fallback 87 |
| Page-wide sideways scroll 1440 / 1024 / 390 | 0 / 0 / 3 |
| Pages with "Arrives in Phase" | 0 |
| Inline style attributes (sum over pages) | 1262 |

### Score rule (0-3 each, 10 areas)
header (title present, no extra clutter) · button placement (share of V40 buttons present) · table (register present, no overflow) · filters (search box) · record view (Edit/View/Open present) · form (Add present) · states (no bad text / console errors) · consistency (few inline styles) · phone & tablet (no sideways scroll at 390/1024) · V40 parity (buttons + tabs). Heuristic, from the DOM only.

## Top 25 root causes

| # | Category | Sev | Pages | Example | Fix approach |
|---|---|---|---|---|---|
| 1 | LAYOUT | P3 | 327 | 2 inline style attributes on the page | C1: replace inline styles with ui.css classes |
| 2 | BUTTON-MISSING | P1 | 321 | 13 V40 button(s) missing: ← Return, ⇧ Import, ⇩ Export, Duplicates, Department I | C3: one shared head row + record bar (src/ui ActionRow) wired per page |
| 3 | PARITY | P1 | 295 | 7 of 7 V40 tabs missing (ERP has 0) | C5: V36 tabs from the registry on every page (ui Tabs) |
| 4 | BREAK | P2 | 3 | console error: Failed to load resource: the server responded with a status of 40 | C4: fix the page / route |
| 5 | RESPONSIVE | P1 | 3 | page-wide sideways scroll at 390px | C4/C7: tables scroll in their own box, single-column forms |
| 6 | API | P1 | 2 | GET /api/v1/hr/attendance/days?month=2027-02 -> 404 | Phase 37 (API) unless wrong URL/field |
| 7 | BREAK | P2 | 1 | console error: Warning: Each child in a list should have a unique "key" prop.%s% | C4: fix the page / route |
| 8 | API | P1 | 1 | GET /api/v1/hr/ess/me -> 404 | Phase 37 (API) unless wrong URL/field |

## Per family

| Family | Pages | Avg score | P0 | P1 | Missing buttons | Worst 3 pages |
|---|---|---|---|---|---|---|
| Executive | 7 | 22.7 | 0 | 9 | 41 | command-center (19), dashboard (20), my-approvals (20) |
| ERP Process Control | 9 | 20.7 | 0 | 18 | 90 | process-exceptions (16), mfg-material-issue (18), customer-receipts (19) |
| Department Inbox | 12 | 23.0 | 0 | 12 | 204 | dept-inbox-administration (23), dept-inbox-sales (23), dept-inbox-projects (23) |
| CRM | 8 | 23.1 | 0 | 16 | 69 | crm-sources (22), crm-leads (23), crm-opportunities (23) |
| Department Work | 12 | 21.0 | 0 | 12 | 48 | dept-work-sales (21), dept-work-purchase (21), dept-work-warehouse (21) |
| Sales | 10 | 20.7 | 0 | 20 | 118 | sales-delivery (19), sales-invoices (19), sales-collections (19) |
| Procurement / SCM | 11 | 21.8 | 0 | 22 | 128 | scm-grn (19), scm-evaluation (19), scm-comparison (20) |
| Inventory | 14 | 20.6 | 0 | 28 | 148 | inv-transactions (18), inv-ageing (18), inv-valuation (18) |
| Warehouse / WMS | 13 | 21.4 | 0 | 26 | 124 | wms-putaway (16), wms-barcode (16), wms-bins (21) |
| Manufacturing | 13 | 21.0 | 0 | 25 | 137 | mfg-mrp (19), mfg-workorders (19), mfg-wip (19) |
| Quality / QMS | 10 | 20.8 | 0 | 20 | 117 | qms-inspections (19), qms-ncr (19), qms-plans (21) |
| Maintenance | 10 | 20.5 | 0 | 20 | 98 | maint-breakdown (19), maint-schedule (19), maint-downtime (19) |
| Finance & Accounts | 19 | 19.5 | 0 | 38 | 179 | fin-gl (16), fin-cashbook (16), fin-bankbook (16) |
| Indian Taxation | 10 | 19.8 | 0 | 20 | 111 | tax-salesreg (18), tax-purchasereg (18), tax-gstr1 (19) |
| HRMS | 12 | 20.1 | 0 | 27 | 129 | hr-ess (15), hr-leave (16), hr-attendance (18) |
| Payroll | 12 | 19.5 | 0 | 24 | 119 | pay-processing (16), pay-payslip (16), pay-register (16) |
| Projects | 17 | 19.9 | 0 | 33 | 159 | proj-dependencies (16), proj-tasks (16), proj-gantt (16) |
| Assets | 8 | 20.9 | 0 | 16 | 79 | asset-allocation (19), asset-qr (19), asset-capitalization (21) |
| Service / Support | 9 | 19.1 | 0 | 20 | 89 | service-technicians (15), service-visits (16), service-tickets (18) |
| Logistics / Fleet | 16 | 16.3 | 0 | 32 | 178 | log-transporters (16), log-routes (16), log-freight (16) |
| Business Documents | 7 | 21.4 | 0 | 13 | 82 | accounts-gst-invoice (19), document-movement-center (20), dispatch-dc (21) |
| Document Management | 6 | 20.8 | 0 | 12 | 53 | dms-docs (20), dms-folders (21), dms-versions (21) |
| Business Intelligence | 10 | 16.0 | 0 | 20 | 98 | bi-builder (16), bi-reports (16), bi-dashboards (16) |
| AI & Automation | 11 | 18.8 | 0 | 22 | 57 | auto-workflows (16), auto-rules (16), auto-webhooks (16) |
| Communication | 6 | 16.5 | 0 | 12 | 65 | comm-whatsapp (16), comm-email (16), comm-sms (16) |
| Administration | 24 | 20.9 | 0 | 44 | 157 | admin-backup (15), admin-company (16), admin-import (16) |
| Contract Labour Management | 17 | 19.3 | 0 | 33 | 183 | cl-compliance (16), cl-ppe (16), cl-medical (16) |
| Work Management | 2 | 23.0 | 0 | 4 | 12 | ops-shift-roster (21), ops-tasks (25) |
| Workplace Management | 2 | 19.0 | 0 | 4 | 17 | ops-canteen (16), ops-visitors (22) |
| Integrated Plant Flow | 10 | 20.4 | 0 | 20 | 119 | maint-part-movement (19), plant-process-movement (19), plant-unit-routing (19) |

## The 30 slowest pages

| Page | Load ms |
|---|---|
| log-pod | 3320 |
| admin-workflow | 3319 |
| maint-equipment | 3260 |
| admin-currency | 3223 |
| dept-inbox-finance | 3207 |
| plant-unit-routing | 3036 |
| fin-creditnote | 2736 |
| dept-work-quality | 2682 |
| qms-plans | 2678 |
| wms-cycle | 2625 |
| plant-flow-command | 2622 |
| mfg-mrp | 2602 |
| qms-inspections | 2577 |
| log-tracking | 2577 |
| plant-project-forward | 2554 |
| service-amc | 2548 |
| scm-vendorquote | 2544 |
| mfg-orders | 2543 |
| dept-work-service | 2543 |
| tax-salesreg | 2526 |
| admin-users | 2526 |
| dispatch-dc | 2522 |
| qms-incoming | 2517 |
| dept-inbox-sales | 2515 |
| qms-ncr | 2513 |
| ai-sales | 2513 |
| proj-budget | 2512 |
| tax-gst | 2510 |
| fin-gl | 2508 |
| mfg-bom | 2500 |

## The 30 slowest API calls

| Page | Call | Status | ms | bytes |
|---|---|---|---|---|
| pay-pf | GET /api/v1/hardening/privacy/notice?locale=en | 200 | 894 | 0 |
| pay-pf | GET /api/v1/me/locale | 200 | 894 | 24 |
| pay-pf | GET /api/v1/me/menu | 200 | 883 | 0 |
| pay-pf | GET /api/v1/me/plants | 200 | 877 | 639 |
| pay-pf | GET /api/v1/me/permissions?pageId=pay-pf | 200 | 869 | 616 |
| pay-pf | GET /api/v1/broadcasts/active | 200 | 865 | 11 |
| pay-pf | GET /api/v1/notifications/unread-count | 200 | 846 | 21 |
| pay-pf | GET /api/v1/hardening/privacy/notice?locale=en | 200 | 845 | 0 |
| pay-pf | GET /api/v1/me/locale | 200 | 845 | 24 |
| pay-pf | GET /api/v1/health | 200 | 833 | 34 |
| pay-pf | GET /api/v1/me/plants | 200 | 830 | 639 |
| dms-docs | GET /api/v1/dms/dispositions | 200 | 812 | 11 |
| dms-docs | GET /api/v1/dms/search?q= | 200 | 807 | 30 |
| dms-docs | GET /api/v1/dms/folders | 200 | 805 | 11 |
| dms-docs | GET /api/v1/dms/tags | 200 | 798 | 11 |
| maint-alerts | GET /api/v1/me/plants | 200 | 715 | 639 |
| maint-alerts | GET /api/v1/hardening/privacy/notice?locale=en | 200 | 715 | 0 |
| maint-alerts | GET /api/v1/me/menu | 200 | 630 | 0 |
| maint-alerts | GET /api/v1/broadcasts/active | 200 | 628 | 11 |
| maint-alerts | GET /api/v1/me/locale | 200 | 628 | 24 |
| maint-alerts | GET /api/v1/me/permissions?pageId=maint-alerts | 200 | 602 | 622 |
| maint-alerts | GET /api/v1/notifications/unread-count | 200 | 589 | 21 |
| maint-alerts | GET /api/v1/hardening/privacy/notice?locale=en | 200 | 588 | 0 |
| maint-alerts | GET /api/v1/me/plants | 200 | 572 | 639 |
| maint-alerts | GET /api/v1/health | 200 | 570 | 34 |
| maint-alerts | GET /api/v1/me/locale | 200 | 563 | 24 |
| bi-reports | GET /api/v1/command-center | 200 | 556 | 0 |
| plant-unit-routing | POST /api/v1/auth/refresh | 200 | 553 | 0 |
| maint-alerts | GET /api/v1/broadcasts/active | 200 | 550 | 11 |
| maint-alerts | GET /api/v1/me/menu | 200 | 545 | 0 |

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
