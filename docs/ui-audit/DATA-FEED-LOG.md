# DATA-FEED-LOG (Phase 36 Part A)

Generated 2026-11-13T20:55:10.201Z. Database: local rhai_erp_ui. Everything below was entered through the screens (Playwright), except the first Super User (seed script).

**Totals:** done 264 · already existed 41 · failed 2 · findings 35

## Per step

| Step | Done | Existed | Failed |
|---|---|---|---|
| A1 | 14 | 1 | 0 |
| A2 | 1 | 0 | 0 |
| A3 | 0 | 31 | 0 |
| A5 | 125 | 6 | 0 |
| A7 | 30 | 0 | 0 |
| A9 | 29 | 0 | 0 |
| A13 | 13 | 0 | 2 |
| A10 | 3 | 3 | 0 |
| A8 | 9 | 0 | 0 |
| A6 | 40 | 0 | 0 |

## Failed forms

- **Breakdown CNC Lathe CL-20** (page `maint-breakdown`): no option for "Machine" — shot: `docs/ui-audit/shots/feed/A13-Breakdown_CNC_Lathe_CL_20.png`
- **Breakdown Air Compressor AC-7** (page `maint-breakdown`): no option for "Machine" — shot: `docs/ui-audit/shots/feed/A13-Breakdown_Air_Compressor_AC_7.png`

## Findings (data entry made hard / bugs found)

- **finding: master-customers** (`master-customers`): V40 page 'Customer Master' (registry id master-customers) shows 'Page not found'; the customer screen is mounted on crm-customer360 instead (ModulePage.tsx case crm-customer360). P0/P1 PARITY: route/renderer missing for the V40 page id.
- **finding: save button wording** (`many`): Form footers say Save / Save Record / Save draft / Close / Create User / Create Department - V40 wording is 'Save Record' / 'Update Record' + Cancel. Inconsistent across pages.
- **finding: head row above title** (`all`): Industry PDF / Word / Approval Queue / Move Forward sit in a bar ABOVE the page title (C3 says remove and put in the head row).
- **finding: party forms** (`crm-customer360`): Customer and Supplier forms ask only Name, Registration type, GSTIN, City, Mobile (V40 customer form has address, credit, contacts, bank).
- **finding: HSN length** (`inv-items`): Item form rejects 4-digit HSN: "Use at least 6 digits of HSN (your turnover rule)". Message appears only after Save; the field has no hint.
- **finding: enquiry form** (`sales-enquiries`): Enquiry form has only name, product, quantity (V40 enquiry has contact, source, due date, notes).
- **finding: quotation form** (`sales-quotations`): Customer is a plain full-list dropdown (no type-ahead); Valid until is a browser date box showing mm/dd/yyyy (V40/R: dd-mm-yyyy); the line grid repeats column headers inside every cell and is clipped at the right edge; no totals panel (Taxable/CGST/SGST/Grand Total); saves only as draft.
- **finding: item dropdown capped** (`sales-quotations / sales-orders`): Item dropdown in the line grid lists only 30 of the 60 items (no search, no type-ahead) - items beyond the 30th cannot be quoted. Needs the Combobox (server search).
- **finding: unit state not set** (`sales-quotations`): Saving a quotation with a plant that has no state/GSTIN gives 422 field "unitId" - but the form has no unit field, so the message "Please fix the highlighted fields" highlights nothing. The error should say which screen to fix (Units) or link to it.
- **finding: line labels** (`sales-quotations / sales-orders`): In the line grid the 2nd and later lines have labels that are not linked to their inputs (duplicate ids) - screen readers and getByLabel only see line 1; the grid also repeats a header row AND a label in every cell.
- **finding: GST rate missing** (`tax-hsn / sales-quotations`): HSN master form has no GST rate field, so a quotation line fails with "Enter the GST rate: no rate is set for HSN/SAC ..." until the user types GST % on every line. The GST rate table should be set up with the HSN (or the line should auto-fill it).
- **suppliers submitted: 8** (`scm-suppliers`): Each supplier has its own Submit for Approval button; there is no bulk submit.
- **approvals approved: 0** (`approvals`): Approved in the Approval Center as the Purchase Department Manager (level 1 of the matrix).
- **approvals approved: 1** (`approvals`): Approved in the Approval Center as the Purchase Department Manager (level 1 of the matrix).
- **finding: submit button on pending suppliers** (`scm-suppliers`): The row keeps showing "Submit for Approval" after the supplier is already pending; pressing it answers "Already pending approval". The button should be hidden or greyed with that reason.
- **suppliers submitted: 6** (`scm-suppliers`): Each supplier has its own Submit for Approval button; there is no bulk submit.
- **approvals approved: 7** (`approvals`): Approved in the Approval Center as the Purchase Department Manager (level 1 of the matrix).
- **BOM register after save** (`mfg-bom`): rows 3: BOM/TAL/26-27/0001 ITM/00016 · BLDC Motor 250W 0 3 DRAFT Open || BOM/TAL/26-27/0002 ITM/00017 · BLDC Motor 500W 0 3 DRAFT Open || BOM/TAL/26-27/0003 ITM/00018 · BLDC Motor 1kW 0 3 DRAFT Open; row buttons: Open
- **finding: BOM approval routing** (`approvals`): no BOM request visible
- **finding: PO detail shows raw item id** (`scm-po`): The PO detail drawer shows the ITEM column as a raw UUID (e.g. 9a1b8449-441e-...) instead of the item code and name. P1 TEXT/DATA bug (web: map item id to label).
- **approvals by mgr.purchase.tal: 6** (`approvals`): mgr.purchase.tal approved 6 request(s) waiting for them in the Approval Center.
- **approvals by head.purchase: 1** (`approvals`): head.purchase approved 1 request(s) waiting for them in the Approval Center.
- **approvals by dir.kulkarni: 0** (`approvals`): dir.kulkarni approved 0 request(s) waiting for them in the Approval Center.
- **approvals by cfo.deshpande: 0** (`approvals`): cfo.deshpande approved 0 request(s) waiting for them in the Approval Center.
- **finding: raw codes in GRN view** (`scm-grn`): GRN receipt view shows raw codes NOT_REQUIRED / NONE and a form that pre-fills received qty = ordered qty; the dialog also turns into a receipt view instead of closing. Use StatusBadge words.
- **approvals by mgr.purchase.tal: 4** (`approvals`): mgr.purchase.tal approved 4 request(s) in the Approval Center.
- **approvals by head.purchase: 20** (`approvals`): head.purchase approved 20 request(s) in the Approval Center.
- **finding: raw item id in document lines** (`sales-orders / scm-po / sales-quotations`): Detail drawers show the ITEM column as a raw UUID. The API line objects carry only itemId; they should also return itemCode and itemName (API owner, Phase 37). The web has no by-id item lookup to work around it.
- **approvals by mgr.sales.tal: 6** (`approvals`): mgr.sales.tal approved 6 request(s) in the Approval Center.
- **approvals by head.sales: 6** (`approvals`): head.sales approved 6 request(s) in the Approval Center.
- **approvals by gm.shinde: 6** (`approvals`): gm.shinde approved 6 request(s) in the Approval Center.
- **finding: inbox Purchase** (`dept-inbox`): Department Inbox opened as the department head; see attempt rows above for Received / Accepted.
- **finding: inbox Production** (`dept-inbox`): Department Inbox opened as the department head; see attempt rows above for Received / Accepted.
- **finding: inbox Warehouse** (`dept-inbox`): Department Inbox opened as the department head; see attempt rows above for Received / Accepted.
- **finding: breakdown needs maintainable asset** (`maint-breakdown`): Machine list is empty until an asset has "Needs maintenance (PM plans, breakdowns)" ticked on the Asset form; the Breakdown form gives no hint. Feeder did not tick it, so the 2 breakdowns were not entered.

## Already fixed in Part C (kept above for history)

* Customer Master (master-customers) and 42 other V40 page ids showed "Page not found": now redirect to the right screen (ModulePage V40_ALIASES).
* Designation create always failed with 422 (web sent status on create; level range 1-100 vs API 1-99): fixed.
* Customer / supplier / item dropdowns capped at 30 rows and no search: now type-ahead with server search (DocPage LookupCombo).
* Line grid labels not linked (duplicate ids) and no totals: unique ids per line; Taxable / CGST / SGST-IGST / Grand total / amount in words panel added.
* Duplicate Menu button and duplicate Notification Center menu item removed; top bar kept on one line.
* V40 head-row buttons were missing or dead: page bar now carries them with working targets (record ones greyed with a reason); "Arrives in Phase" text removed.

## Still open from the feed (not fixed)

* Raw item UUID in PO/SO detail (API must return item code and name); raw codes NOT_REQUIRED / NONE in GRN view; dialogs that turn into a record view instead of closing; "Submit for Approval" still offered on pending suppliers; HSN master has no GST rate; HSN rule only shown after Save; Customer/Supplier/Enquiry forms smaller than V40; date inputs show mm/dd/yyyy; form footer wording inconsistent (Save / Save Record / Save draft / Create ...).

## Deviations and what was NOT fed in this session

* Most records were entered as the **Super User** (fast), not as the user of each department. Approvals, Receive/Accept and the BOM/PO/GRN approvals were done by the matrix approvers (Purchase Manager, Purchase Head, Sales Manager/Head, GM, Director, CFO, the receiving department heads).
* **Not fed (listed for the next session):** approval-matrix and workflow-matrix edits, mail automations, attendance policies and devices (step 4); price list, customers/suppliers beyond the 5-field forms, contract workers (5/6); one department Return (8); QC (incoming and final), delivery challans, sales invoices, receipts, purchase invoices, payments, journals, bank entries (9-11); a month of device-simulator attendance, leave, regularisation, overtime, one payroll run (12); shift handovers, canteen scans, maintenance breakdown (assets need "Needs maintenance" ticked first), service tickets, project with gates, gate pass (13).
* Volumes entered: 1 Administrator + 31 users, 20 customers, 20 suppliers (8 approved), 60 items, 4 HSN rows, 3 warehouses, 3 work centres, 3 BOMs (released), 3 routings (released), 10 enquiries, 9 quotations, 6 sales orders (approved; 3 moved Sales -> Purchase / Production / Warehouse and received + accepted), 5 PRs, 6 POs (approved), 4 GRNs (1 posted), 3 production orders (released), 40 employees, 6 tasks, 4 assets, 3 visitors.
* Unit/FY/department seed: 3 plants, 1 FY, 11 departments come from the seed script; Engineering (12th) was added through the screen.
