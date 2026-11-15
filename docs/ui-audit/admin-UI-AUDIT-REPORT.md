# UI AUDIT REPORT (Phase 36 Part B)

Role audited: **admin** · generated 2026-11-13T22:32:34.119Z · local database rhai_erp_ui · V40 = `RHAI_ERP_V40_Edit_Update_Fixed.html` (read-only).

> Method: every page opened in V40 (its own `nav(id)`) and in the ERP at 1440 / 1024 / 390; buttons, tabs, API calls, console, overflow and text problems read from the DOM. Buttons are **not clicked** (no Save/Submit/Approve/Post/Delete/Send); a V40 button counts PRESENT when the ERP shows a button with the same label (or the V40 add/email/pdf alias), PRESENT-PLACEHOLDER when it is disabled, MISSING otherwise; PRESENT-WORKS vs PRESENT-DEAD needs click tests and is reported as PRESENT (untested). Tabs inside pages, record views and add/edit forms are compared by label only (default view screenshots).

## Summary

| Measure | Value |
|---|---|
| Pages audited | 327 of 327 |
| Opened OK | 327 (not found: 0, failed: 0) |
| Issues P0 / P1 / P2 / P3 | 0 / 619 / 4 / 327 |
| Data verdicts | OK-NONTABLE 88 · OK 221 · EMPTY-OK 15 · API-ERROR 3 |
| V40 buttons: missing / placeholder / present | 3395 / 2077 / 4435 (extra ERP-only: 2280) |
| Pages with a missing V40 button | 321 |
| Pages missing V40 tabs | 295 |
| Average UI score (rule-based, /30) | 20.2 |
| Pages below 18/30 | 64 |
| Renderer | own page 240 · generic fallback 87 |
| Page-wide sideways scroll 1440 / 1024 / 390 | 0 / 0 / 0 |
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
| 5 | API | P1 | 2 | GET /api/v1/hr/attendance/days?month=2027-02 -> 404 | Phase 37 (API) unless wrong URL/field |
| 6 | BREAK | P2 | 1 | console error: Warning: Each child in a list should have a unique "key" prop.%s% | C4: fix the page / route |
| 7 | API | P1 | 1 | GET /api/v1/hr/ess/me -> 404 | Phase 37 (API) unless wrong URL/field |

## Per family

| Family | Pages | Avg score | P0 | P1 | Missing buttons | Worst 3 pages |
|---|---|---|---|---|---|---|
| Executive | 7 | 22.1 | 0 | 9 | 41 | dashboard (17), command-center (19), my-approvals (20) |
| ERP Process Control | 9 | 20.7 | 0 | 18 | 102 | process-exceptions (16), mfg-material-issue (18), customer-receipts (19) |
| Department Inbox | 12 | 23.0 | 0 | 12 | 216 | dept-inbox-administration (23), dept-inbox-sales (23), dept-inbox-projects (23) |
| CRM | 8 | 23.0 | 0 | 16 | 97 | crm-sources (22), crm-leads (23), crm-opportunities (23) |
| Department Work | 12 | 20.6 | 0 | 12 | 51 | dept-work-warehouse (18), dept-work-sales (20), dept-work-purchase (20) |
| Sales | 10 | 20.9 | 0 | 20 | 158 | sales-delivery (19), sales-collections (19), sales-credit (19) |
| Procurement / SCM | 11 | 21.9 | 0 | 22 | 172 | scm-evaluation (18), scm-comparison (20), scm-grn (20) |
| Inventory | 14 | 20.1 | 0 | 28 | 196 | inv-transactions (17), inv-reconciliation (18), inv-ageing (18) |
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
| Service / Support | 9 | 19.6 | 0 | 18 | 89 | service-technicians (15), service-visits (16), service-warranty (18) |
| Logistics / Fleet | 16 | 16.3 | 0 | 32 | 178 | log-transporters (16), log-routes (16), log-freight (16) |
| Business Documents | 7 | 21.4 | 0 | 13 | 82 | accounts-gst-invoice (19), document-movement-center (20), dispatch-dc (21) |
| Document Management | 6 | 20.8 | 0 | 12 | 53 | dms-docs (20), dms-folders (21), dms-versions (21) |
| Business Intelligence | 10 | 16.0 | 0 | 20 | 98 | bi-builder (16), bi-reports (16), bi-dashboards (16) |
| AI & Automation | 11 | 18.8 | 0 | 22 | 57 | auto-workflows (16), auto-rules (16), auto-webhooks (16) |
| Communication | 6 | 16.5 | 0 | 12 | 65 | comm-whatsapp (16), comm-email (16), comm-sms (16) |
| Administration | 24 | 21.0 | 0 | 43 | 157 | admin-backup (15), admin-company (16), admin-import (16) |
| Contract Labour Management | 17 | 19.3 | 0 | 33 | 183 | cl-compliance (16), cl-ppe (16), cl-medical (16) |
| Work Management | 2 | 23.0 | 0 | 4 | 12 | ops-shift-roster (21), ops-tasks (25) |
| Workplace Management | 2 | 19.0 | 0 | 4 | 17 | ops-canteen (16), ops-visitors (22) |
| Integrated Plant Flow | 10 | 20.4 | 0 | 20 | 119 | maint-part-movement (19), plant-process-movement (19), plant-unit-routing (19) |

## The 30 slowest pages

| Page | Load ms |
|---|---|
| wms-cycle | 3380 |
| sales-returns | 3276 |
| asset-master | 3207 |
| hr-shifts | 3153 |
| dept-inbox-projects | 3099 |
| my-approvals | 3090 |
| dept-work-service | 3086 |
| fin-cashbook | 3070 |
| hr-appointment-letter | 3034 |
| scm-purchaseinvoice | 2975 |
| dept-work-production | 2873 |
| wms-shelves | 2862 |
| wms-rfid | 2847 |
| wms-racks | 2843 |
| ops-tasks | 2744 |
| wms-zones | 2707 |
| crm-opportunities | 2664 |
| wms-transfer | 2663 |
| dms-versions | 2619 |
| container-track | 2573 |
| fin-ar | 2564 |
| maint-downtime | 2559 |
| inv-transfer | 2556 |
| admin-settings | 2556 |
| bi-builder | 2548 |
| sales-credit | 2542 |
| admin-uom | 2539 |
| scm-evaluation | 2536 |
| plant-interplant-movement | 2532 |
| wms-warehouses | 2530 |

## The 30 slowest API calls

| Page | Call | Status | ms | bytes |
|---|---|---|---|---|
| scm-grn | GET /api/v1/me/locale | 200 | 843 | 24 |
| scm-grn | GET /api/v1/hardening/privacy/notice?locale=en | 200 | 843 | 0 |
| wms-cycle | POST /api/v1/auth/refresh | 200 | 835 | 0 |
| proj-projects | GET /api/v1/projects? | 200 | 812 | 30 |
| scm-grn | GET /api/v1/me/menu | 200 | 795 | 0 |
| scm-grn | GET /api/v1/me/plants | 200 | 788 | 639 |
| scm-grn | GET /api/v1/notifications/unread-count | 200 | 777 | 20 |
| scm-grn | GET /api/v1/me/permissions?pageId=scm-grn | 200 | 762 | 677 |
| scm-grn | GET /api/v1/broadcasts/active | 200 | 758 | 11 |
| ai-finance | GET /api/v1/hardening/privacy/notice?locale=en | 200 | 755 | 0 |
| ai-finance | GET /api/v1/me/plants | 200 | 752 | 639 |
| scm-grn | GET /api/v1/me/locale | 200 | 741 | 24 |
| scm-grn | GET /api/v1/hardening/privacy/notice?locale=en | 200 | 740 | 0 |
| scm-grn | GET /api/v1/health | 200 | 732 | 34 |
| proj-projects | GET /api/v1/projects? | 200 | 726 | 30 |
| scm-grn | GET /api/v1/me/plants | 200 | 724 | 639 |
| scm-grn | GET /api/v1/me/menu | 200 | 712 | 0 |
| pay-structure | GET /api/v1/me/menu | 200 | 705 | 0 |
| scm-grn | GET /api/v1/notifications/unread-count | 200 | 703 | 20 |
| scm-grn | GET /api/v1/broadcasts/active | 200 | 702 | 11 |
| scm-grn | GET /api/v1/me/permissions?pageId=scm-grn | 200 | 698 | 677 |
| pay-structure | GET /api/v1/hardening/privacy/notice?locale=en | 200 | 685 | 0 |
| ai-finance | GET /api/v1/me/menu | 200 | 677 | 0 |
| ai-finance | GET /api/v1/me/locale | 200 | 666 | 24 |
| ai-finance | GET /api/v1/me/context | 200 | 664 | 720 |
| pay-structure | GET /api/v1/payroll/components | 200 | 663 | 0 |
| pay-structure | GET /api/v1/payroll/structures | 200 | 663 | 11 |
| pay-structure | GET /api/v1/payroll/structures | 200 | 663 | 11 |
| scm-grn | GET /api/v1/health | 200 | 656 | 34 |
| ai-finance | GET /api/v1/ai/insights | 200 | 651 | 11 |

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
