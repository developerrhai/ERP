# UI AUDIT REPORT (Phase 36 Part B)

Role audited: **sales-talsaw** · generated 2026-11-13T22:32:35.787Z · local database rhai_erp_ui · V40 = `RHAI_ERP_V40_Edit_Update_Fixed.html` (read-only).

> Method: every page opened in V40 (its own `nav(id)`) and in the ERP at 1440 / 1024 / 390; buttons, tabs, API calls, console, overflow and text problems read from the DOM. Buttons are **not clicked** (no Save/Submit/Approve/Post/Delete/Send); a V40 button counts PRESENT when the ERP shows a button with the same label (or the V40 add/email/pdf alias), PRESENT-PLACEHOLDER when it is disabled, MISSING otherwise; PRESENT-WORKS vs PRESENT-DEAD needs click tests and is reported as PRESENT (untested). Tabs inside pages, record views and add/edit forms are compared by label only (default view screenshots).

## Summary

| Measure | Value |
|---|---|
| Pages audited | 327 of 327 |
| Opened OK | 327 (not found: 0, failed: 0) |
| Issues P0 / P1 / P2 / P3 | 0 / 625 / 2 / 327 |
| Data verdicts | OK 55 · OK-NONTABLE 38 · EMPTY-OK 13 · API-ERROR 2 · NO-DATA-BUG? 219 |
| V40 buttons: missing / placeholder / present | 8571 / 373 / 963 (extra ERP-only: 1413) |
| Pages with a missing V40 button | 327 |
| Pages missing V40 tabs | 296 |
| Average UI score (rule-based, /30) | 14.7 |
| Pages below 18/30 | 240 |
| Renderer | own page 240 · generic fallback 87 |
| Page-wide sideways scroll 1440 / 1024 / 390 | 0 / 0 / 0 |
| Pages with "Arrives in Phase" | 0 |
| Inline style attributes (sum over pages) | 695 |

### Score rule (0-3 each, 10 areas)
header (title present, no extra clutter) · button placement (share of V40 buttons present) · table (register present, no overflow) · filters (search box) · record view (Edit/View/Open present) · form (Add present) · states (no bad text / console errors) · consistency (few inline styles) · phone & tablet (no sideways scroll at 390/1024) · V40 parity (buttons + tabs). Heuristic, from the DOM only.

## Top 25 root causes

| # | Category | Sev | Pages | Example | Fix approach |
|---|---|---|---|---|---|
| 1 | BUTTON-MISSING | P1 | 327 | 13 V40 button(s) missing: ← Return, ⇧ Import, ⇩ Export, Duplicates, Department I | C3: one shared head row + record bar (src/ui ActionRow) wired per page |
| 2 | LAYOUT | P3 | 327 | 2 inline style attributes on the page | C1: replace inline styles with ui.css classes |
| 3 | PARITY | P1 | 296 | 7 of 7 V40 tabs missing (ERP has 0) | C5: V36 tabs from the registry on every page (ui Tabs) |
| 4 | BREAK | P2 | 2 | console error: Failed to load resource: the server responded with a status of 40 | C4: fix the page / route |
| 5 | API | P1 | 1 | GET /api/v1/inventory/reservations?page=1&size=20 -> 403 | Phase 37 (API) unless wrong URL/field |
| 6 | API | P1 | 1 | GET /api/v1/lookups/warehouses?limit=50 -> 403 | Phase 37 (API) unless wrong URL/field |

## Per family

| Family | Pages | Avg score | P0 | P1 | Missing buttons | Worst 3 pages |
|---|---|---|---|---|---|---|
| Executive | 7 | 22.1 | 0 | 9 | 46 | command-center (18), dashboard (20), my-approvals (20) |
| ERP Process Control | 9 | 17.6 | 0 | 18 | 182 | master-products (12), master-materials (12), mfg-material-issue (12) |
| Department Inbox | 12 | 23.0 | 0 | 12 | 216 | dept-inbox-administration (23), dept-inbox-sales (23), dept-inbox-projects (23) |
| CRM | 8 | 22.9 | 0 | 16 | 91 | crm-sources (21), crm-leads (23), crm-opportunities (23) |
| Department Work | 12 | 20.0 | 0 | 12 | 60 | dept-work-sales (20), dept-work-purchase (20), dept-work-warehouse (20) |
| Sales | 10 | 20.4 | 0 | 22 | 148 | sales-returns (18), sales-delivery (19), sales-invoices (19) |
| Procurement / SCM | 11 | 12.0 | 0 | 22 | 415 | scm-pr (12), scm-rfq (12), scm-vendorquote (12) |
| Inventory | 14 | 12.0 | 0 | 28 | 485 | inv-items (12), inv-stock (12), inv-transactions (12) |
| Warehouse / WMS | 13 | 12.0 | 0 | 26 | 448 | wms-warehouses (12), wms-zones (12), wms-racks (12) |
| Manufacturing | 13 | 12.6 | 0 | 26 | 432 | mfg-bom (12), mfg-routing (12), mfg-workcenters (12) |
| Quality / QMS | 10 | 12.0 | 0 | 20 | 363 | qms-plans (12), qms-incoming (12), qms-process (12) |
| Maintenance | 10 | 12.0 | 0 | 20 | 336 | maint-machines (12), maint-equipment (12), maint-preventive (12) |
| Finance & Accounts | 19 | 12.0 | 0 | 38 | 637 | fin-coa (12), fin-gl (12), fin-journal (12) |
| Indian Taxation | 10 | 12.0 | 0 | 20 | 350 | tax-gst (12), tax-gstr1 (12), tax-gstr3b (12) |
| HRMS | 12 | 12.0 | 0 | 24 | 415 | hr-employees (12), hr-recruitment (12), hr-onboarding (12) |
| Payroll | 12 | 12.0 | 0 | 24 | 401 | pay-structure (12), pay-processing (12), pay-overtime (12) |
| Projects | 17 | 12.6 | 0 | 34 | 527 | proj-stage-gates (12), proj-dependencies (12), proj-specifications (12) |
| Assets | 8 | 12.0 | 0 | 16 | 277 | asset-master (12), asset-capitalization (12), asset-allocation (12) |
| Service / Support | 9 | 19.6 | 0 | 18 | 116 | service-technicians (15), service-visits (16), service-warranty (18) |
| Logistics / Fleet | 16 | 12.0 | 0 | 32 | 558 | log-transporters (12), log-routes (12), log-freight (12) |
| Business Documents | 7 | 16.7 | 0 | 13 | 173 | quality-certificate (12), hr-offer-letter (12), hr-appointment-letter (12) |
| Document Management | 6 | 12.0 | 0 | 12 | 197 | dms-folders (12), dms-docs (12), dms-versions (12) |
| Business Intelligence | 10 | 16.0 | 0 | 20 | 128 | bi-builder (16), bi-reports (16), bi-dashboards (16) |
| AI & Automation | 11 | 18.8 | 0 | 22 | 76 | auto-workflows (16), auto-rules (16), auto-webhooks (16) |
| Communication | 6 | 16.5 | 0 | 12 | 83 | comm-whatsapp (16), comm-email (16), comm-sms (16) |
| Administration | 24 | 12.9 | 0 | 48 | 599 | admin-company (12), admin-branches (12), admin-departments (12) |
| Contract Labour Management | 17 | 12.5 | 0 | 33 | 580 | cl-contractors (12), cl-workorders (12), cl-workers (12) |
| Work Management | 2 | 18.0 | 0 | 4 | 25 | ops-shift-roster (12), ops-tasks (24) |
| Workplace Management | 2 | 13.5 | 0 | 4 | 44 | ops-canteen (12), ops-visitors (15) |
| Integrated Plant Flow | 10 | 18.0 | 0 | 20 | 163 | flow-bom-approval (15), mfg-unit-route (15), mfg-transfer-note (15) |

## The 30 slowest pages

| Page | Load ms |
|---|---|
| log-shipments | 3342 |
| dept-work-warehouse | 3244 |
| wms-transfer | 3114 |
| quality-certificate | 3110 |
| maint-schedule | 3047 |
| dept-inbox-purchase | 2711 |
| asset-master | 2655 |
| admin-numbering | 2643 |
| dms-tags | 2564 |
| qms-5why | 2546 |
| plant-unit-routing | 2509 |
| dept-work-hr | 2507 |
| fin-debitnote | 2491 |
| sales-orders | 2488 |
| tax-eway | 2488 |
| admin-audit | 2483 |
| dms-versions | 2480 |
| fin-bankreco | 2476 |
| wms-barcode | 2473 |
| scm-purchaseinvoice | 2472 |
| admin-branches | 2472 |
| dms-search | 2469 |
| scm-po | 2465 |
| tax-tcs | 2463 |
| hr-expense | 2463 |
| plant-department-movement | 2463 |
| asset-capitalization | 2462 |
| asset-disposal | 2459 |
| proj-demo-control | 2458 |
| scm-grn | 2455 |

## The 30 slowest API calls

| Page | Call | Status | ms | bytes |
|---|---|---|---|---|
| auto-workflows | GET /api/v1/jobs | 200 | 1172 | 0 |
| plant-project-forward | GET /api/v1/hardening/privacy/notice?locale=en | 200 | 623 | 0 |
| plant-project-forward | GET /api/v1/me/permissions?pageId=dept-movement-inbox | 200 | 616 | 689 |
| dept-work-warehouse | POST /api/v1/auth/refresh | 200 | 614 | 0 |
| plant-project-forward | GET /api/v1/me/menu | 200 | 593 | 0 |
| plant-project-forward | GET /api/v1/me/plants | 200 | 588 | 503 |
| plant-project-forward | GET /api/v1/me/locale | 200 | 582 | 24 |
| auto-rules | GET /api/v1/jobs | 200 | 579 | 0 |
| plant-project-forward | GET /api/v1/broadcasts/active | 200 | 579 | 11 |
| ops-mfg-dashboard | GET /api/v1/dashboards/plant | 200 | 569 | 0 |
| global-search | GET /api/v1/command-center | 200 | 534 | 0 |
| bi-dashboards | GET /api/v1/command-center | 200 | 508 | 0 |
| bi-reports | GET /api/v1/command-center | 200 | 499 | 0 |
| bi-purchase | GET /api/v1/command-center | 200 | 498 | 0 |
| qms-plans | GET /api/v1/me/context | 200 | 485 | 646 |
| command-center | GET /api/v1/command-center | 200 | 457 | 0 |
| auto-jobs | GET /api/v1/jobs | 200 | 435 | 0 |
| quality-certificate | POST /api/v1/auth/refresh | 200 | 433 | 0 |
| log-shipments | POST /api/v1/auth/refresh | 200 | 418 | 0 |
| wms-transfer | POST /api/v1/auth/refresh | 200 | 417 | 0 |
| maint-schedule | POST /api/v1/auth/refresh | 200 | 395 | 0 |
| auto-workflows | GET /api/v1/jobs | 200 | 365 | 0 |
| auto-rules | GET /api/v1/jobs | 200 | 345 | 0 |
| global-search | GET /api/v1/command-center | 200 | 339 | 0 |
| bi-builder | GET /api/v1/command-center | 200 | 328 | 0 |
| bi-sales | GET /api/v1/command-center | 200 | 318 | 0 |
| mfg-unit-route | GET /api/v1/broadcasts/active | 200 | 316 | 11 |
| mfg-unit-route | GET /api/v1/broadcasts/active | 200 | 315 | 11 |
| bi-reports | GET /api/v1/command-center | 200 | 291 | 0 |
| dept-inbox-purchase | POST /api/v1/auth/refresh | 200 | 289 | 0 |

## Needs Phase 37 (API / flow)

- sales-reservations: GET /api/v1/inventory/reservations?page=1&size=20 -> 403
- sales-returns: GET /api/v1/lookups/warehouses?limit=50 -> 403

## Part C plan (order of fixes)
1. C1 design system: `src/ui` + `ui.css` (built) → migrate pages to it.
2. C3 one head row (← Return, Excel, Industry PDF, Word, Print, ＋ Add, Edit, Delete, Documents, Submit Approval, Approval Queue, Move Forward, ⇧ Import, ⇩ Export, Duplicates) + record bar; remove the bar above the title; remove "Arrives in Phase".
3. C5 table-first register + V36 tabs on every page; the 12 documents first (Quotation, Sales Order, PR, PO, GRN, Incoming QC, Production Order, Delivery Challan, GST Invoice, Receipt, Purchase Invoice, Payment).
4. C4 fix overflow/breaks listed in issues.csv.
5. C6 Home = V39 department workspace; C7 phone/tablet; C8 NO-DATA-BUG; C9 re-audit with before/after.
