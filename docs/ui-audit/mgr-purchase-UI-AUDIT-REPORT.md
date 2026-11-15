# UI AUDIT REPORT (Phase 36 Part B)

Role audited: **mgr-purchase** · generated 2026-11-13T22:32:34.704Z · local database rhai_erp_ui · V40 = `RHAI_ERP_V40_Edit_Update_Fixed.html` (read-only).

> Method: every page opened in V40 (its own `nav(id)`) and in the ERP at 1440 / 1024 / 390; buttons, tabs, API calls, console, overflow and text problems read from the DOM. Buttons are **not clicked** (no Save/Submit/Approve/Post/Delete/Send); a V40 button counts PRESENT when the ERP shows a button with the same label (or the V40 add/email/pdf alias), PRESENT-PLACEHOLDER when it is disabled, MISSING otherwise; PRESENT-WORKS vs PRESENT-DEAD needs click tests and is reported as PRESENT (untested). Tabs inside pages, record views and add/edit forms are compared by label only (default view screenshots).

## Summary

| Measure | Value |
|---|---|
| Pages audited | 327 of 327 |
| Opened OK | 327 (not found: 0, failed: 0) |
| Issues P0 / P1 / P2 / P3 | 0 / 624 / 1 / 327 |
| Data verdicts | OK 80 · OK-NONTABLE 51 · NO-DATA-BUG? 195 · API-ERROR 1 |
| V40 buttons: missing / placeholder / present | 7813 / 605 / 1489 (extra ERP-only: 1649) |
| Pages with a missing V40 button | 327 |
| Pages missing V40 tabs | 296 |
| Average UI score (rule-based, /30) | 15.4 |
| Pages below 18/30 | 226 |
| Renderer | own page 240 · generic fallback 87 |
| Page-wide sideways scroll 1440 / 1024 / 390 | 0 / 0 / 0 |
| Pages with "Arrives in Phase" | 0 |
| Inline style attributes (sum over pages) | 744 |

### Score rule (0-3 each, 10 areas)
header (title present, no extra clutter) · button placement (share of V40 buttons present) · table (register present, no overflow) · filters (search box) · record view (Edit/View/Open present) · form (Add present) · states (no bad text / console errors) · consistency (few inline styles) · phone & tablet (no sideways scroll at 390/1024) · V40 parity (buttons + tabs). Heuristic, from the DOM only.

## Top 25 root causes

| # | Category | Sev | Pages | Example | Fix approach |
|---|---|---|---|---|---|
| 1 | BUTTON-MISSING | P1 | 327 | 13 V40 button(s) missing: ← Return, ⇧ Import, ⇩ Export, Duplicates, Department I | C3: one shared head row + record bar (src/ui ActionRow) wired per page |
| 2 | LAYOUT | P3 | 327 | 2 inline style attributes on the page | C1: replace inline styles with ui.css classes |
| 3 | PARITY | P1 | 296 | 7 of 7 V40 tabs missing (ERP has 0) | C5: V36 tabs from the registry on every page (ui Tabs) |
| 4 | API | P1 | 1 | GET /api/v1/sales/orders?size=20 -> 403 | Phase 37 (API) unless wrong URL/field |
| 5 | BREAK | P2 | 1 | console error: Failed to load resource: the server responded with a status of 40 | C4: fix the page / route |

## Per family

| Family | Pages | Avg score | P0 | P1 | Missing buttons | Worst 3 pages |
|---|---|---|---|---|---|---|
| Executive | 7 | 22.7 | 0 | 9 | 41 | command-center (19), dashboard (20), my-approvals (20) |
| ERP Process Control | 9 | 17.6 | 0 | 19 | 165 | master-customers (12), sales-enquiries (12), customer-receipts (12) |
| Department Inbox | 12 | 23.0 | 0 | 12 | 204 | dept-inbox-administration (23), dept-inbox-sales (23), dept-inbox-projects (23) |
| CRM | 8 | 13.0 | 0 | 16 | 251 | crm-leads (12), crm-opportunities (12), crm-followups (12) |
| Department Work | 12 | 24.0 | 0 | 12 | 48 | dept-work-sales (24), dept-work-purchase (24), dept-work-warehouse (24) |
| Sales | 10 | 12.0 | 0 | 20 | 370 | sales-quotations (12), sales-orders (12), sales-reservations (12) |
| Procurement / SCM | 11 | 21.8 | 0 | 22 | 128 | scm-grn (19), scm-evaluation (19), scm-comparison (20) |
| Inventory | 14 | 20.6 | 0 | 28 | 148 | inv-transactions (18), inv-ageing (18), inv-valuation (18) |
| Warehouse / WMS | 13 | 21.4 | 0 | 26 | 124 | wms-putaway (16), wms-barcode (16), wms-bins (21) |
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
| Logistics / Fleet | 16 | 16.3 | 0 | 32 | 178 | log-transporters (16), log-routes (16), log-freight (16) |
| Business Documents | 7 | 14.6 | 0 | 13 | 220 | dispatch-dc (12), quality-certificate (12), accounts-gst-invoice (12) |
| Document Management | 6 | 12.0 | 0 | 12 | 197 | dms-folders (12), dms-docs (12), dms-versions (12) |
| Business Intelligence | 10 | 16.0 | 0 | 20 | 98 | bi-builder (16), bi-reports (16), bi-dashboards (16) |
| AI & Automation | 11 | 18.8 | 0 | 22 | 57 | auto-workflows (16), auto-rules (16), auto-webhooks (16) |
| Communication | 6 | 12.0 | 0 | 12 | 204 | comm-whatsapp (12), comm-email (12), comm-sms (12) |
| Administration | 24 | 12.9 | 0 | 48 | 599 | admin-company (12), admin-branches (12), admin-departments (12) |
| Contract Labour Management | 17 | 12.8 | 0 | 33 | 556 | cl-contractors (12), cl-workorders (12), cl-workers (12) |
| Work Management | 2 | 18.5 | 0 | 4 | 23 | ops-shift-roster (12), ops-tasks (25) |
| Workplace Management | 2 | 17.0 | 0 | 4 | 30 | ops-canteen (12), ops-visitors (22) |
| Integrated Plant Flow | 10 | 19.8 | 0 | 20 | 128 | flow-bom-approval (15), maint-part-movement (19), plant-process-movement (19) |

## The 30 slowest pages

| Page | Load ms |
|---|---|
| document-movement-center | 3323 |
| cl-wages | 3181 |
| dept-inbox-finance | 3152 |
| maint-equipment | 3129 |
| sales-dispatch | 3103 |
| admin-numbering | 2630 |
| pay-pt | 2608 |
| fleet-drivers | 2596 |
| mfg-shopfloor | 2594 |
| admin-fy | 2588 |
| hr-shifts | 2584 |
| scm-comparison | 2556 |
| scm-grn | 2535 |
| ai-executive | 2535 |
| bi-scheduler | 2534 |
| admin-integrations | 2533 |
| mfg-workorders | 2530 |
| maint-part-movement | 2524 |
| fin-gl | 2520 |
| log-shipments | 2519 |
| sales-orders | 2496 |
| scm-evaluation | 2496 |
| ai-insights | 2492 |
| proj-documents | 2484 |
| wms-pick | 2483 |
| crm-sources | 2481 |
| asset-disposal | 2477 |
| mfg-plan | 2476 |
| tax-gst | 2476 |
| dept-inbox-administration | 2472 |

## The 30 slowest API calls

| Page | Call | Status | ms | bytes |
|---|---|---|---|---|
| tax-gstr1 | GET /api/v1/hardening/privacy/notice?locale=en | 200 | 902 | 0 |
| inv-valuation | GET /api/v1/inventory/reports/gl-compare | 200 | 901 | 142 |
| tax-gstr1 | GET /api/v1/me/menu | 200 | 877 | 0 |
| tax-gstr1 | GET /api/v1/me/plants | 200 | 877 | 332 |
| tax-gstr1 | GET /api/v1/me/locale | 200 | 867 | 24 |
| inv-valuation | GET /api/v1/hardening/privacy/notice?locale=en | 200 | 862 | 0 |
| tax-gstr1 | GET /api/v1/me/permissions?pageId=tax-gstr1 | 200 | 844 | 782 |
| tax-gstr1 | GET /api/v1/broadcasts/active | 200 | 834 | 11 |
| tax-gstr1 | GET /api/v1/notifications/unread-count | 200 | 832 | 20 |
| tax-gstr1 | GET /api/v1/hardening/privacy/notice?locale=en | 200 | 827 | 0 |
| inv-valuation | GET /api/v1/inventory/reports/valuation?from=2026-11-01&to=2026-11-13&page | 200 | 825 | 791 |
| tax-gstr1 | GET /api/v1/me/plants | 200 | 815 | 332 |
| inv-valuation | GET /api/v1/inventory/reports/gl-compare | 200 | 814 | 142 |
| tax-gstr1 | GET /api/v1/me/locale | 200 | 800 | 24 |
| tax-gstr1 | GET /api/v1/health | 200 | 787 | 34 |
| inv-valuation | GET /api/v1/inventory/reports/valuation?from=2026-11-01&to=2026-11-13&page | 200 | 775 | 791 |
| tax-gstr1 | GET /api/v1/me/menu | 200 | 773 | 0 |
| inv-items | GET /api/v1/pages/inv-items/schema | 200 | 731 | 0 |
| auto-rules | GET /api/v1/jobs | 200 | 711 | 0 |
| inv-valuation | GET /api/v1/me/context | 200 | 651 | 568 |
| auto-workflows | GET /api/v1/jobs | 200 | 641 | 0 |
| bi-reports | GET /api/v1/command-center | 200 | 626 | 0 |
| bi-builder | GET /api/v1/command-center | 200 | 587 | 0 |
| bi-sales | GET /api/v1/command-center | 200 | 560 | 0 |
| cl-wages | POST /api/v1/auth/refresh | 200 | 522 | 0 |
| maint-equipment | POST /api/v1/auth/refresh | 200 | 509 | 0 |
| sales-dispatch | POST /api/v1/auth/refresh | 200 | 504 | 0 |
| global-search | GET /api/v1/command-center | 200 | 488 | 0 |
| bi-profit | GET /api/v1/command-center | 200 | 479 | 0 |
| document-movement-center | POST /api/v1/auth/refresh | 200 | 469 | 0 |

## Needs Phase 37 (API / flow)

- ops-order-360: GET /api/v1/sales/orders?size=20 -> 403

## Part C plan (order of fixes)
1. C1 design system: `src/ui` + `ui.css` (built) → migrate pages to it.
2. C3 one head row (← Return, Excel, Industry PDF, Word, Print, ＋ Add, Edit, Delete, Documents, Submit Approval, Approval Queue, Move Forward, ⇧ Import, ⇩ Export, Duplicates) + record bar; remove the bar above the title; remove "Arrives in Phase".
3. C5 table-first register + V36 tabs on every page; the 12 documents first (Quotation, Sales Order, PR, PO, GRN, Incoming QC, Production Order, Delivery Challan, GST Invoice, Receipt, Purchase Invoice, Payment).
4. C4 fix overflow/breaks listed in issues.csv.
5. C6 Home = V39 department workspace; C7 phone/tablet; C8 NO-DATA-BUG; C9 re-audit with before/after.
