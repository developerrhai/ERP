# PHASE 38 report — The V40 frame on all 327 pages

STATUS: PLAN ONLY (nothing built yet)

## Before (V40 parity, from packages/registry/registry.v2.json)
327 pages: 248 built (old frame), 79 planned. 1,800 tabs, 4,311 fields. 31 pages have no tabs (12 Department Inbox pages among them).
Inbox: my-approvals (Approval Inbox) is 'planned', 5 tabs; 12 dept-inbox-* pages 'planned', 0 tabs; dept-movement-inbox (Received / Accepted) is NOT in registry.v2 and must be added.

| # | Family | Pages | Tabs | Built (old) |
|---|---|---|---|---|
| 1 | Executive | 7 | 11 | 5 |
| 2 | ERP Process Control | 9 | 55 | 0 |
| 3 | Department Inbox | 12 | 0 | 0 |
| 4 | CRM | 8 | 48 | 8 |
| 5 | Department Work | 12 | 0 | 0 |
| 6 | Sales | 10 | 60 | 10 |
| 7 | Procurement / SCM | 11 | 66 | 11 |
| 8 | Inventory | 14 | 84 | 14 |
| 9 | Warehouse / WMS | 13 | 78 | 13 |
| 10 | Manufacturing | 13 | 78 | 13 |
| 11 | Quality / QMS | 10 | 60 | 10 |
| 12 | Maintenance | 10 | 60 | 10 |
| 13 | Finance & Accounts | 19 | 114 | 19 |
| 14 | Indian Taxation | 10 | 60 | 10 |
| 15 | HRMS | 12 | 72 | 12 |
| 16 | Payroll | 12 | 72 | 12 |
| 17 | Projects | 17 | 110 | 11 |
| 18 | Assets | 8 | 48 | 8 |
| 19 | Service / Support | 9 | 54 | 9 |
| 20 | Logistics / Fleet | 16 | 96 | 16 |
| 21 | Business Documents | 7 | 37 | 0 |
| 22 | Document Management | 6 | 36 | 6 |
| 23 | Business Intelligence | 10 | 60 | 10 |
| 24 | AI & Automation | 11 | 66 | 11 |
| 25 | Communication | 6 | 36 | 6 |
| 26 | Administration | 24 | 144 | 24 |
| 27 | Contract Labour Management | 17 | 96 | 0 |
| 28 | Work Management | 2 | 14 | 0 |
| 29 | Workplace Management | 2 | 16 | 0 |
| 30 | Integrated Plant Flow | 10 | 69 | 0 |

## V40 comparison (2026-11-14, `node scripts/gen-parity.cjs`, UI audit "after" run)
* Pages: 272 of 327 have their own screen; 2 use the generic register; 53 are not in the menu yet (my-approvals, 12 dept-inbox-*, 12 dept-work-*, document-movement-center, dispatch-dc, accounts-gst-invoice, cl-*, plant-*, master-customers/products/materials, customer-receipts, ...).
* Average UI score 20.2 / 30 (target >= 25). 63 pages below 18.
* V40 buttons: 4,623 present, 2,076 greyed with a reason, 3,208 missing. 321 pages miss at least one V40 button.
* Tabs: most pages show only the first view (Phase 38 task T-38-1 / T-38-5).
