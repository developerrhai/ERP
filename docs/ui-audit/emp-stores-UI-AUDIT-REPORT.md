# UI AUDIT REPORT (Phase 36 Part B)

Role audited: **emp-stores** · generated 2026-11-13T22:32:35.325Z · local database rhai_erp_ui · V40 = `RHAI_ERP_V40_Edit_Update_Fixed.html` (read-only).

> Method: every page opened in V40 (its own `nav(id)`) and in the ERP at 1440 / 1024 / 390; buttons, tabs, API calls, console, overflow and text problems read from the DOM. Buttons are **not clicked** (no Save/Submit/Approve/Post/Delete/Send); a V40 button counts PRESENT when the ERP shows a button with the same label (or the V40 add/email/pdf alias), PRESENT-PLACEHOLDER when it is disabled, MISSING otherwise; PRESENT-WORKS vs PRESENT-DEAD needs click tests and is reported as PRESENT (untested). Tabs inside pages, record views and add/edit forms are compared by label only (default view screenshots).

## Summary

| Measure | Value |
|---|---|
| Pages audited | 327 of 327 |
| Opened OK | 327 (not found: 0, failed: 0) |
| Issues P0 / P1 / P2 / P3 | 0 / 623 / 0 / 327 |
| Data verdicts | OK 93 · OK-NONTABLE 42 · NO-DATA-BUG? 192 |
| V40 buttons: missing / placeholder / present | 7884 / 605 / 1418 (extra ERP-only: 1454) |
| Pages with a missing V40 button | 327 |
| Pages missing V40 tabs | 296 |
| Average UI score (rule-based, /30) | 15.5 |
| Pages below 18/30 | 220 |
| Renderer | own page 240 · generic fallback 87 |
| Page-wide sideways scroll 1440 / 1024 / 390 | 0 / 0 / 0 |
| Pages with "Arrives in Phase" | 0 |
| Inline style attributes (sum over pages) | 746 |

### Score rule (0-3 each, 10 areas)
header (title present, no extra clutter) · button placement (share of V40 buttons present) · table (register present, no overflow) · filters (search box) · record view (Edit/View/Open present) · form (Add present) · states (no bad text / console errors) · consistency (few inline styles) · phone & tablet (no sideways scroll at 390/1024) · V40 parity (buttons + tabs). Heuristic, from the DOM only.

## Top 25 root causes

| # | Category | Sev | Pages | Example | Fix approach |
|---|---|---|---|---|---|
| 1 | BUTTON-MISSING | P1 | 327 | 13 V40 button(s) missing: ← Return, ⇧ Import, ⇩ Export, Duplicates, Department I | C3: one shared head row + record bar (src/ui ActionRow) wired per page |
| 2 | LAYOUT | P3 | 327 | 2 inline style attributes on the page | C1: replace inline styles with ui.css classes |
| 3 | PARITY | P1 | 296 | 7 of 7 V40 tabs missing (ERP has 0) | C5: V36 tabs from the registry on every page (ui Tabs) |

## Per family

| Family | Pages | Avg score | P0 | P1 | Missing buttons | Worst 3 pages |
|---|---|---|---|---|---|---|
| Executive | 7 | 22.3 | 0 | 9 | 46 | command-center (18), dashboard (20), my-approvals (20) |
| ERP Process Control | 9 | 19.0 | 0 | 18 | 137 | master-customers (12), process-exceptions (16), mfg-material-issue (18) |
| Department Inbox | 12 | 23.0 | 0 | 12 | 216 | dept-inbox-administration (23), dept-inbox-sales (23), dept-inbox-projects (23) |
| CRM | 8 | 13.0 | 0 | 16 | 251 | crm-leads (12), crm-opportunities (12), crm-followups (12) |
| Department Work | 12 | 23.0 | 0 | 12 | 60 | dept-work-sales (23), dept-work-purchase (23), dept-work-warehouse (23) |
| Sales | 10 | 20.6 | 0 | 20 | 148 | sales-delivery (19), sales-invoices (19), sales-collections (19) |
| Procurement / SCM | 11 | 21.7 | 0 | 22 | 161 | scm-comparison (19), scm-grn (19), scm-evaluation (19) |
| Inventory | 14 | 20.4 | 0 | 28 | 190 | inv-transactions (18), inv-ageing (18), inv-valuation (18) |
| Warehouse / WMS | 13 | 21.3 | 0 | 26 | 163 | wms-putaway (16), wms-barcode (16), wms-warehouses (21) |
| Manufacturing | 13 | 12.6 | 0 | 26 | 432 | mfg-bom (12), mfg-routing (12), mfg-workcenters (12) |
| Quality / QMS | 10 | 12.0 | 0 | 20 | 363 | qms-plans (12), qms-incoming (12), qms-process (12) |
| Maintenance | 10 | 12.0 | 0 | 20 | 336 | maint-machines (12), maint-equipment (12), maint-preventive (12) |
| Finance & Accounts | 19 | 12.0 | 0 | 38 | 637 | fin-coa (12), fin-gl (12), fin-journal (12) |
| Indian Taxation | 10 | 12.0 | 0 | 20 | 350 | tax-gst (12), tax-gstr1 (12), tax-gstr3b (12) |
| HRMS | 12 | 12.0 | 0 | 24 | 415 | hr-employees (12), hr-recruitment (12), hr-onboarding (12) |
| Payroll | 12 | 12.0 | 0 | 24 | 401 | pay-structure (12), pay-processing (12), pay-overtime (12) |
| Projects | 17 | 12.6 | 0 | 34 | 527 | proj-stage-gates (12), proj-dependencies (12), proj-specifications (12) |
| Assets | 8 | 12.0 | 0 | 16 | 277 | asset-master (12), asset-capitalization (12), asset-allocation (12) |
| Service / Support | 9 | 12.0 | 0 | 18 | 306 | service-tickets (12), service-requests (12), service-technicians (12) |
| Logistics / Fleet | 16 | 16.3 | 0 | 32 | 226 | log-transporters (16), log-routes (16), log-freight (16) |
| Business Documents | 7 | 16.7 | 0 | 13 | 173 | quality-certificate (12), hr-offer-letter (12), hr-appointment-letter (12) |
| Document Management | 6 | 12.0 | 0 | 12 | 197 | dms-folders (12), dms-docs (12), dms-versions (12) |
| Business Intelligence | 10 | 16.0 | 0 | 20 | 128 | bi-builder (16), bi-reports (16), bi-dashboards (16) |
| AI & Automation | 11 | 13.9 | 0 | 22 | 180 | auto-workflows (12), auto-rules (12), auto-jobs (12) |
| Communication | 6 | 12.0 | 0 | 12 | 204 | comm-whatsapp (12), comm-email (12), comm-sms (12) |
| Administration | 24 | 12.9 | 0 | 48 | 599 | admin-company (12), admin-branches (12), admin-departments (12) |
| Contract Labour Management | 17 | 12.8 | 0 | 33 | 560 | cl-contractors (12), cl-workorders (12), cl-workers (12) |
| Work Management | 2 | 18.0 | 0 | 4 | 25 | ops-shift-roster (12), ops-tasks (24) |
| Workplace Management | 2 | 17.0 | 0 | 4 | 32 | ops-canteen (12), ops-visitors (22) |
| Integrated Plant Flow | 10 | 19.0 | 0 | 20 | 144 | flow-bom-approval (15), maint-part-movement (18), plant-process-movement (18) |

## The 30 slowest pages

| Page | Load ms |
|---|---|
| scm-grn | 3122 |
| service-tickets | 3070 |
| comm-email | 3052 |
| bi-scheduler | 3042 |
| dept-inbox-maintenance | 3040 |
| hr-recruitment | 3008 |
| cl-contractors | 2588 |
| inv-opening | 2582 |
| dept-work-purchase | 2577 |
| sales-enquiries | 2566 |
| mfg-mrp | 2556 |
| mfg-fg | 2551 |
| admin-branches | 2551 |
| hr-shifts | 2546 |
| mfg-material-issue | 2528 |
| admin-users | 2517 |
| dept-inbox-engineering | 2515 |
| asset-capitalization | 2505 |
| mfg-rework | 2499 |
| fin-ar | 2493 |
| dept-inbox-service | 2490 |
| proj-gantt | 2488 |
| pay-pf | 2487 |
| dept-work-finance | 2486 |
| qms-ncr | 2485 |
| dms-search | 2476 |
| proj-expenses | 2470 |
| hr-leave | 2469 |
| proj-stage-gates | 2462 |
| maint-breakdown | 2461 |

## The 30 slowest API calls

| Page | Call | Status | ms | bytes |
|---|---|---|---|---|
| ops-mfg-dashboard | GET /api/v1/dashboards/plant | 200 | 1208 | 0 |
| ops-mfg-dashboard | GET /api/v1/dashboards/plant | 200 | 882 | 0 |
| proj-gantt | GET /api/v1/me/plants | 200 | 798 | 332 |
| proj-gantt | GET /api/v1/hardening/privacy/notice?locale=en | 200 | 798 | 0 |
| proj-gantt | GET /api/v1/me/menu | 200 | 778 | 0 |
| proj-gantt | GET /api/v1/me/locale | 200 | 765 | 24 |
| proj-gantt | GET /api/v1/me/permissions?pageId=proj-gantt | 200 | 760 | 788 |
| proj-gantt | GET /api/v1/broadcasts/active | 200 | 748 | 11 |
| proj-gantt | GET /api/v1/notifications/unread-count | 200 | 741 | 20 |
| proj-gantt | GET /api/v1/me/plants | 200 | 730 | 332 |
| proj-gantt | GET /api/v1/hardening/privacy/notice?locale=en | 200 | 729 | 0 |
| proj-gantt | GET /api/v1/health | 200 | 726 | 34 |
| proj-gantt | GET /api/v1/me/locale | 200 | 718 | 24 |
| proj-gantt | GET /api/v1/me/menu | 200 | 712 | 0 |
| proj-gantt | GET /api/v1/me/permissions?pageId=proj-gantt | 200 | 703 | 788 |
| sales-collections | GET /api/v1/hardening/privacy/notice?locale=en | 200 | 698 | 0 |
| sales-collections | GET /api/v1/me/plants | 200 | 697 | 332 |
| proj-gantt | GET /api/v1/broadcasts/active | 200 | 697 | 11 |
| proj-gantt | GET /api/v1/notifications/unread-count | 200 | 696 | 20 |
| cl-command-center | GET /api/v1/cl/command-center | 200 | 687 | 188 |
| cl-command-center | GET /api/v1/me/menu | 200 | 665 | 0 |
| sales-collections | GET /api/v1/me/menu | 200 | 661 | 0 |
| cl-command-center | GET /api/v1/cl/command-center | 200 | 649 | 188 |
| sales-collections | GET /api/v1/me/locale | 200 | 645 | 24 |
| sales-collections | GET /api/v1/me/permissions?pageId=sales-collections | 200 | 634 | 687 |
| sales-collections | GET /api/v1/broadcasts/active | 200 | 628 | 11 |
| sales-collections | GET /api/v1/notifications/unread-count | 200 | 612 | 20 |
| hr-recruitment | POST /api/v1/auth/refresh | 200 | 586 | 0 |
| sales-collections | GET /api/v1/me/plants | 200 | 584 | 332 |
| scm-grn | POST /api/v1/auth/refresh | 200 | 582 | 0 |

## Needs Phase 37 (API / flow)


## Part C plan (order of fixes)
1. C1 design system: `src/ui` + `ui.css` (built) → migrate pages to it.
2. C3 one head row (← Return, Excel, Industry PDF, Word, Print, ＋ Add, Edit, Delete, Documents, Submit Approval, Approval Queue, Move Forward, ⇧ Import, ⇩ Export, Duplicates) + record bar; remove the bar above the title; remove "Arrives in Phase".
3. C5 table-first register + V36 tabs on every page; the 12 documents first (Quotation, Sales Order, PR, PO, GRN, Incoming QC, Production Order, Delivery Challan, GST Invoice, Receipt, Purchase Invoice, Payment).
4. C4 fix overflow/breaks listed in issues.csv.
5. C6 Home = V39 department workspace; C7 phone/tablet; C8 NO-DATA-BUG; C9 re-audit with before/after.
