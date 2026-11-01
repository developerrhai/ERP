# 4. Module-by-Module Specification

[← Back to PLAN.md](../../PLAN.md)

This section covers all **22 families and 248 menu pages** found in `index.html`. The page tables below are generated from `MENU` + `PROFILES` (the runtime `pay-payslip` override from V9.2 is applied), so every page id, title, tab and field is exactly what the prototype holds. Nothing has been added to the page list. Anything added beyond index.html is marked **[ADD]**.

## 4.0 Conventions used by every family

### 4.0.1 What every generic page has (from index.html)
227 of the 248 pages are drawn by `renderModule(id)` (V9 engine plus the V9.2 wrapper). Each one has:

* **Page head:** title, purpose text, and the buttons `Excel`, `Letterhead PDF` (only when `can("export")` and the module control `export` are on), `Print`, and `＋ Add`.
* **Context chips:** Department, Role, Owner, Approval Required/No.
* **Record bar:** a record `<select>` plus `＋ Add`, `Edit`, `Delete`, `Documents`, `Submit Approval` (when the module control `approval` is on) and `Approval Queue` (when the user has `can("approve")`).
* **Green banner:** "V9 DISTINCT TAB ENGINE". This is decorative; we will drop the claim and keep the slot (see §2).
* **16 tabs:** `Module Dashboard`, then the page's 6 profile tabs, then `Analytics & Graphs`, `AI Decision Center` (with sub-tabs Summary / Forecast / Risk & Anomaly / Recommendations / What-if), `Automation Studio`, `Data Quality`, `Activity Timeline`, `Documents`, `Approvals`, `Reports`, `Audit Trail`.
* **V9.2 table:** a "20-row Detailed Table" is appended under every tab. Its actions are View / Edit / Docs / PDF / Delete.
* **Register tab** (when a tab label matches register/list/directory/queue/log/catalog): 5 summary minis, search, status filter, page size 10/20/25, `Reset 25 Demo`, a selection counter, `Export Selected`, `Submit Selected` and `Delete Selected`. The table has a checkbox column, sortable headers and per-row `📎`, View, Edit, Delete, PDF and Submit, plus a Previous/Next pager.
* **Add/Edit modal:** one `<input>` per profile field. The type is guessed from the field name (`date`, `email`, `number` or `text`). Nothing is marked required or validated.
* **View drawer:** every field, plus Edit, Documents and PDF.

Each profile tab is drawn by one of 36 V9 workspace renderers, which `v9SpecialType()` picks by regex on the tab label. `docs/REGISTRY.csv` lists the renderer for every tab.

In the rebuild, **each renderer type becomes a reusable React workspace component**, fed by real data from the API.

### 4.0.2 Field type and validation rules (the engine contract)
Every field in the tables below is annotated `Name:type`. A trailing `*` means required. The rules are deterministic, and they are the default the metadata engine applies. Families override them where their section says so.

| Type | Rule (on the field label) | Validation |
|---|---|---|
| `code` | the first field of the page, when it ends in No/ID/Code/Ref/Number | Transactions: auto-generated from the numbering series, read-only. Masters: user-entered, unique per company, `^[A-Z0-9/_-]{2,30}$` |
| `status` | the label contains "Status" (the record's main status field) | Enum. Changed only by workflow actions, never typed in the form |
| `date` / `datetime` | date, expiry, due, valid, effective, from/to, period start/end. Time, at, arrival, punch → datetime | ISO date. Business rules check order (end ≥ start) and FY/period lock |
| `money` | amount, value, cost, price, total, GST/CGST/SGST/IGST, freight, budget, balance, outstanding, paid, salary components, revenue, limit | `numeric(18,2)`, ≥ 0 unless the field is an adjustment/variance. Shown as ₹ with en-IN grouping |
| `pct` | `%`, rate, score, probability, rating, efficiency | 0–100, 2 decimals |
| `qty` | qty, quantity, hours, hrs, days, min, count, KM, weight, volume, odometer | `numeric(18,3)` ≥ 0, with UOM precision from `admin-uom` |
| `ref` | customer, vendor/supplier, item, warehouse, employee, owner/manager, department, branch, company, project, machine, asset, account, cost/profit center, transporter, vehicle, driver, approver, references to other documents (SO/PO/GRN/Invoice/NCR…) | Foreign key picked from a searchable lookup. The referenced record must be active and inside the user's scope |
| `email`, `phone`, `gstin`, `pan`, `ifsc`, `hsn`, `aadhaar`, `uan` | by name | Email RFC; Indian mobile `^[6-9]\d{9}$`; GSTIN 15 characters with checksum; PAN `^[A-Z]{5}\d{4}[A-Z]$`; IFSC `^[A-Z]{4}0[A-Z0-9]{6}$`; HSN 4/6/8 digits; Aadhaar stored masked (last 4) plus a hash; UAN 12 digits |
| `bool` | tracked, allowed, required, enabled, billable, current, MFA, verified, critical… | Yes/No toggle |
| `enum` | stage, priority, type, mode, channel, method, category, source, decision, result, disposition… | Option list held in `admin-customfields`/master data. Defaults are given per family |
| `text` / `longtext` | everything else. Description, remarks, narration, notes, reason, problem, agenda, details and comments are `longtext` | Trimmed; max 200 / 4000 characters; HTML stripped |

The required (`*`) rules are: the first field; any `…Name` field; the primary party/subject `ref` (customer, vendor, item, employee, machine, asset or project, whichever comes first); and the first document date.

Rules shared by every page:
* `status`, derived totals and `code` are read-only in forms.
* Every save goes through the server-side Zod schema built from this metadata.
* Every list supports search, filter, sort, paginate, export and bulk actions (§5).

### 4.0.3 Shared statuses
The prototype status vocabulary is `Active, Approved, Pending, Draft, Open, Completed`, and the CSS also styles `paid, closed, in-progress, rejected, overdue, cancelled`. We standardise on two sets:

* **Transactional:** `Draft → Submitted (Pending) → Approved → In Process → Completed/Closed`, with side exits `Rejected` (back to Draft for edit) and `Cancelled`.
* **Master:** `Active ↔ Inactive`, plus `Blocked`.

Approved, posted or closed records are **locked**. They change only through amendment/reversal documents. Each family below lists its own status set.

### 4.0.4 How to read "market comparison"
Each family has a section with that name. It compares index.html with ERPNext/Frappe, Odoo, Zoho, Tally, SAP B1, Dolibarr and Akaunting, at the level of features and rules. **No code is copied.** ERPNext (GPL-3), Dolibarr (GPL-3) and Akaunting (BSL/GPL variants) are used for ideas only. Statutory sources are cited in [Appendix C](../../PLAN.md#appendix-c--sources).

---

## 4.1 Executive (5 pages)
**Purpose / users:** cross-functional landing pages. Every department can see this family (`DEPT_FAMILIES`). The owner is Administration.

**index.html facts.** None of these pages uses the generic engine:

* `dashboard` → `dashboard()`. Its KPIs are computed from seeded demo rows of 5–7 "core modules" per department (`v8DeptCoreModules`).
* `command-center` → `commandCenter()`. The KPIs and text are **hard-coded**: 91/100, ₹18.7L AR >90 days, etc.
* `ai-insights` → `aiPage()`. It shares the same page with all 7 `ai-*` pages of the AI family.
* `notifications` → `notificationPage()`. Every count is hard-coded ("14 approvals pending, 23 stock alerts…").
* `global-search` → `searchPage()`. It scans the first 50 rows of every permitted module, returns at most 40 hits, and links to the module, not to the record.

**Pages (5) — generated from index.html registry.** Legend: `Field:type`, `*` = required. "Renderer" = page-level function in index.html.

| # | Page id | Title | Renderer | Profile tabs (6) | Fields |
|---|---|---|---|---|---|
| 1 | `dashboard` | Executive Dashboard | dashboard() | — (no profile) | — (custom page) |
| 2 | `command-center` | Command Center | commandCenter() | — (no profile) | — (custom page) |
| 3 | `ai-insights` | Executive AI Insights | aiPage() | Executive AI Insights Workspace · Executive AI Insights Details · Executive AI Insights Workflow · Executive AI Insights Exceptions · Executive AI Insights Performance · Executive AI Insights Controls *(profile defined but ignored by the custom renderer; rebuild uses it)* | Record ID:code*, Model Rule:enum, Module:text, Trigger Input:text, Score Condition:pct, Recommended Action:longtext, Owner:ref, Last Run:datetime, Next Run:datetime, Status:status |
| 4 | `notifications` | Notification Center | notificationPage() | — (no profile) | — (custom page) |
| 5 | `global-search` | Global Search | searchPage() | — (no profile) | — (custom page) |


**Rebuild spec**
* **Department dashboards.** We keep the hero, the 4 KPIs, the trend and risk charts, the 20-row table and the AI summary layout exactly. Every number comes from an API `GET /dashboards/:dept` that aggregates real tables. KPI definitions per department are in §3.
* **Command Center.** The four health scores are composites with documented formulas:
  * Sales = order-to-target %;
  * Cash = (cash + bank) / 30-day AP due;
  * Inventory = 100 − (slow-moving value / stock value × 100);
  * Production = OEE.
  * "Critical Exceptions" are live counts: AR > 90 days, shortage SKUs (available < reorder level), SO past promise date, overdue PM.
* **Notification Center.** It lists the user's `notifications` table rows, with read/unread state, a filter by type, and deep links to the record. **[ADD]** "Mark all read", per-type mute.
* **Global Search.** It uses Postgres full-text search (`tsvector`) over each registered page's searchable fields, only inside the user's scope. Results are grouped by module and deep-link to `/m/:page/:id`. Debounced, minimum 2 characters (as in the prototype), max 50 results per module.

**KPIs and their sources:** dashboards → aggregate SQL views (`v_kpi_sales`, `v_kpi_finance`, …), refreshed live with a short cache (60 s).

**Market comparison.** ERPNext workspaces, Odoo dashboards and Zoho home all show live KPI cards with drill-down; the prototype shows synthetic values. **Improvements:** drill-down from every KPI to a filtered list, per-user pinned KPIs, and showing the "as of" timestamp.

**Edge cases.** A user with no data sees zero states, never NaN. A KPI query the user is not scoped for returns 403 for that card only, so the rest of the dashboard still renders. A slow aggregate is cut off by a timeout and shows "—" with a retry link.

---

## 4.2 CRM (8 pages)
**Purpose / users:** lead-to-opportunity management. Users are the Sales and Service departments; the owner is Sales.

**Special pages:** `crm-pipeline` → `kanbanPage()`, a static 5-lane board (New, Qualified, Proposal, Negotiation, Won) with 3 dummy cards per lane and no drag. `crm-pipeline` and `crm-customer360` use the generic placeholder field set (`Record No|Name|Customer Company|…`).

**Pages (8) — generated from index.html registry.** Legend: `Field:type`, `*` = required. "Renderer" = page-level function in index.html.

| # | Page id | Title | Renderer | Profile tabs (6) | Fields |
|---|---|---|---|---|---|
| 1 | `crm-leads` | Lead Management | renderModule() | Lead Register · Qualification Desk · Communication Timeline · Follow-up Queue · Lead Scoring · Conversion Analytics | Lead No:code*, Lead Name:text*, Company:ref, Mobile:phone, Email:email, Source:enum, Campaign:text, Owner:ref, Stage:enum, Qualification Score:pct, Expected Value:money, Next Follow-up:date*, Consent Status:status, Status:status |
| 2 | `crm-opportunities` | Opportunity Management | renderModule() | Opportunity Register · Stage Progress · Probability & Forecast · Proposal Activity · Competitor Tracking · Win Loss Analysis | Opportunity No:code*, Customer:ref*, Opportunity Name:text*, Stage:enum, Probability %:pct, Expected Value:money, Expected Close:text, Primary Contact:ref, Salesperson:ref, Competitor:text, Next Action:longtext, Status:status |
| 3 | `crm-pipeline` | Sales Pipeline / Kanban | kanbanPage() | Sales Pipeline / Kanban Workspace · Sales Pipeline Kanban Details · Sales Pipeline Kanban Workflow · Sales Pipeline Kanban Exceptions · Sales Pipeline Kanban Performance · Sales Pipeline Kanban Controls *(profile defined but ignored by the custom renderer; rebuild uses it)* | Record No:code*, Name:text*, Customer Company:ref*, Owner:ref, Stage:enum, Priority:money, Next Action:longtext, Expected Value:money, Due Date:date*, Status:status |
| 4 | `crm-followups` | Follow-ups & Tasks | renderModule() | Follow-up Planner · Due Today · Overdue Actions · Reminder Automation · Outcome Log · Completion Analytics | Follow-up No:code*, Lead Customer:ref, Related Record:ref, Owner:ref, Due Date:date*, Due Time:datetime, Channel:enum, Purpose:longtext, Outcome:longtext, Next Follow-up:date, Priority:money, Status:status |
| 5 | `crm-meetings` | Meetings & Calls | renderModule() | Meeting Calendar · Call Log · Agenda & Notes · Participants · Action Items · Engagement Analytics | Meeting No:code*, Subject:longtext, Customer Lead:ref*, Start Date:date*, Start Time:datetime, Duration:qty, Location Mode:enum, Organizer:ref, Participants:qty, Agenda:longtext, Outcome:longtext, Status:status |
| 6 | `crm-customer360` | Customer 360° | renderModule() | Customer 360° Workspace · Customer 360° Details · Customer 360° Workflow · Customer 360° Exceptions · Customer 360° Performance · Customer 360° Controls | Record No:code*, Name:text*, Customer Company:ref*, Owner:ref, Stage:enum, Priority:money, Next Action:longtext, Expected Value:money, Due Date:date*, Status:status |
| 7 | `crm-feedback` | Customer Feedback | renderModule() | Feedback Inbox · CSAT & NPS · Issue Categories · Response Workflow · Improvement Actions · Sentiment Trends | Feedback No:code*, Customer:ref*, Date:date*, Channel:enum, Rating:pct, NPS Score:pct, Category:enum, Comments:longtext, Owner:ref, Corrective Action:longtext, Closure Date:date, Status:status |
| 8 | `crm-sources` | Lead Sources | renderModule() | Source Master · Campaign Mapping · UTM Tracking · Source Cost · Source Quality · ROI Analysis | Source Code:code*, Source Name:enum*, Channel:enum, Campaign:text, UTM Source:enum, UTM Medium:text, Monthly Cost:date*, Leads:qty, Qualified:qty, Won:qty, Revenue:money, Status:status |


**Statuses.**
* Lead: `New → Contacted → Qualified → Converted | Disqualified`.
* Opportunity stage: `New, Qualified, Proposal, Negotiation, Won, Lost` (the prototype's `stages`).
* Follow-up/Meeting: `Planned → Done | Missed | Cancelled`.
* Feedback: `Open → Actioned → Closed`.

**Workflow and rules.**
* **Lead capture** (manual, import, or **[ADD]** web-form API). Duplicate check runs on mobile, email and company name (fuzzy ≥ 85%), using `admin-duplicates`.
* **Consent Status** is mandatory before any WhatsApp/SMS is sent (DPDP Act 2023; see sources).
* **Qualification Score** is 0–100: a sum of weighted BANT criteria, configurable (the prototype's `V3_CONCEPT_RULES` "qualification" idea, which is never used in the file). A lead converts to an opportunity only when it is Qualified. Conversion creates/links a Customer master record (Sales → `crm-customer360`).
* **Opportunity.** `Probability %` defaults from the stage (10/25/50/75/100/0) and the user can override it. Weighted pipeline = Σ(Expected Value × Probability/100). Won requires a linked quotation or SO; Lost requires a reason and competitor.
* **Pipeline Kanban.** Drag between stages calls `PATCH /opportunities/:id/stage`, which checks the transition rules.
* **Follow-ups.** Overdue = Due Date < today and status Planned. They feed notifications.
* **Lead Sources.** Leads, Qualified, Won and Revenue are **computed** from linked leads/opportunities (read-only). Cost per lead = Monthly Cost / Leads.
* **Feedback.** `NPS Score` is 0–10; NPS = %promoters(9–10) − %detractors(0–6).

**KPIs.** Pipeline value, weighted pipeline, conversion % (won / closed), average cycle days, follow-ups due today and overdue, NPS.

**Market comparison.** ERPNext Lead → Opportunity → Quotation, Odoo CRM's drag pipeline with expected revenue × probability, and Zoho CRM's Blueprint stage rules are all richer than the prototype, which has no conversion, no drag, and stage as free text. **Add:** lead→opportunity→quotation conversion with carried data, activity timeline per record, stage-gate required fields, lost-reason analytics, assignment rules (round-robin by territory).

**Careless-user risks.**
* Two people create the same lead → duplicate warning; save is blocked if the match score is ≥ 95%.
* Someone drags a card to Won without a quotation → 422 error with a message.
* Someone deletes a lead that has opportunities → blocked; archive instead.

---

## 4.3 Sales (10 pages)
**Users:** Sales, Finance and Warehouse departments. Owner: Sales.

**Pages (10) — generated from index.html registry.** Legend: `Field:type`, `*` = required. "Renderer" = page-level function in index.html.

| # | Page id | Title | Renderer | Profile tabs (6) | Fields |
|---|---|---|---|---|---|
| 1 | `sales-quotations` | Sales Quotations | renderModule() | Quotation Register · Item & Tax Lines · Pricing Controls · Terms & Validity · Approval & Revision · Conversion Analysis | Quotation No:code*, Customer:ref*, Quote Date:date*, Valid Till:date, Price List:money, Currency:text, Subtotal:money, Discount:money, Taxable:money, GST:money, Freight:money, Grand Total:money, Salesperson:ref, Revision:text, Status:status |
| 2 | `sales-orders` | Sales Orders | renderModule() | Order Register · Order Items · Stock Allocation · Delivery Commitments · Billing Status · Margin & Credit | SO No:code*, Customer:ref*, PO Reference:ref, Order Date:date*, Promise Date:date, Warehouse:ref, Currency:text, Subtotal:money, Discount:money, GST:money, Freight:money, Total:money, Credit Check:money, Salesperson:ref, Status:status |
| 3 | `sales-reservations` | Stock Reservations | renderModule() | Reservation Queue · Warehouse Allocation · Batch Serial Allocation · Expiry Priority · Release & Reallocate · Reservation Exceptions | Reservation No:code*, Demand Ref:ref, Customer:ref*, Item:ref, Warehouse:ref, Batch Serial:text, Required Qty:qty, Reserved Qty:qty, Short Qty:qty, Priority:money, Expiry Date:date*, Status:status |
| 4 | `sales-delivery` | Delivery Scheduling | renderModule() | Delivery Plan · Promise Dates · Route & Vehicle · Load Planning · Delivery Exceptions · OTIF Performance | Delivery Plan No:code*, Sales Order:ref, Customer:ref*, Ship To:text, Promise Date:date*, Route:text, Transporter:ref, Vehicle:ref, Planned Qty:qty, Delivered Qty:qty, POD:text, OTIF Status:status, Status:status |
| 5 | `sales-dispatch` | Dispatch | renderModule() | Dispatch Queue · Pick Pack Readiness · Vehicle & Driver · Dispatch Documents · POD Status · Dispatch Analytics | Dispatch No:code*, Sales Order:ref, Customer:ref*, Warehouse:ref, Pick List:text, Packing Ref:ref, Vehicle:ref, Driver:ref, Dispatch Date:date*, E Way Bill:text, LR No:text, POD Status:status, Status:status |
| 6 | `sales-invoices` | Sales Invoices | renderModule() | Invoice Register · Tax Breakdown · E-Invoice Status · Receipts & Balance · Credit Notes · Invoice Ageing | Invoice No:code*, Customer:ref*, Invoice Date:date*, Due Date:date, GSTIN:gstin, Place of Supply:enum, Taxable Value:money, CGST:money, SGST:money, IGST:money, Grand Total:money, Paid:money, Balance:money, IRN Status:status, Status:status |
| 7 | `sales-collections` | Collections | renderModule() | Collection Worklist · Due Today · Promise to Pay · Receipt Allocation · Escalation Actions · DSO Analytics | Collection No:code*, Customer:ref*, Invoice No:ref, Due Date:date*, Outstanding:money, Promise Date:date, Collector:ref, Contact Mode:enum, Receipt Amount:money, Receipt Date:date, Reference:ref, Status:status |
| 8 | `sales-pricelist` | Price Lists | renderModule() | Price List Master · Customer Pricing · Quantity Slabs · Promotion Rules · Effective Dates · Margin Simulation | Price List Code:code*, Price List Name:money*, Customer Segment:ref*, Item Category:ref, Currency:text, Base Price:money, Min Qty:qty, Discount %:pct, Effective From:date*, Effective To:date, Margin %:pct, Status:status |
| 9 | `sales-credit` | Credit Limits | renderModule() | Credit Profiles · Limit Utilization · Overdue Exposure · Credit Holds · Approval Overrides · Risk Scoring | Customer Code:code*, Customer:ref*, Credit Limit:money, Used Limit:money, Available Limit:money, Overdue:date*, Oldest Due Days:qty, Risk Grade:ref, Hold Status:status, Override Approver:ref, Review Date:date, Status:status |
| 10 | `sales-returns` | Sales Returns | renderModule() | Return Register · Return Reason · Inspection & Disposition · Credit Note Link · Replacement Flow · Return Analytics | Return No:code*, Customer:ref*, Invoice Ref:ref, Return Date:date*, Item:ref, Qty:qty, Reason:longtext, Condition:longtext, Disposition:enum, Credit Note Ref:money, Replacement Ref:ref, Status:status |


**Statuses.**
* Quotation: `Draft → Submitted → Approved → Sent → Accepted | Expired | Lost`. Revisions are R0, R1….
* SO: `Draft → Pending Approval → Approved → Partially Delivered → Delivered → Invoiced → Closed | Cancelled | On Hold (credit)`.
* Delivery/Dispatch: `Planned → Picked → Packed → Dispatched → Delivered (POD)`.
* Invoice: `Draft → Posted → Partially Paid → Paid | Cancelled` (cancelled only before IRN, or with an e-invoice cancel within the permitted window).
* Return: `Requested → Approved → Received → Credit Note Issued`.

**Line items.** Header fields come from the profile. Lines are **[ADD]**, as the typed child table `document_lines`: item, description, HSN, qty, UOM, rate, discount %, taxable, GST rate, CGST/SGST/IGST, line total. This matches the prototype's `v9LineItems` concept, which today saves only to a localStorage side key and never touches the header totals.

**Calculations (server-side, rounding at line level to 2 dp):**
* `line_taxable = qty × rate × (1 − disc%/100)`.
* Tax split: if place of supply state = supplier state, then CGST = SGST = taxable × rate/2; otherwise IGST = taxable × rate.
* `Subtotal = Σ qty×rate`; `Discount = Σ discounts`; `Taxable = Subtotal − Discount`; `GST = Σ tax`; `Grand Total = Taxable + GST + Freight` (freight is taxed at the rate of the principal supply, as configured), rounded to the nearest rupee, with a round-off line posted.
* `Balance = Grand Total − Paid`.
* GST rates come from `tax-hsn` effective on the invoice date. The post-22-Sep-2025 slabs are 5/18/40 plus legacy rates for old documents.

**Rules.**
* **Credit check on SO approval:** `exposure = AR outstanding + open SO value not invoiced`. If exposure + this SO > Credit Limit, or the customer has overdue beyond N days, the SO goes `On Hold` and needs an override approver (`sales-credit.Override Approver`). `Available Limit = Credit Limit − Used Limit`, computed.
* **Reservations** reduce `available` (inventory §4.5). `Short Qty = Required − Reserved`.
* **Dispatch** needs a pick list and packing. An e-way bill is required when consignment value > ₹50,000 (Rule 138). Dispatch writes the stock ledger (issue).
* **Invoice posting:** Dr Customer / Cr Sales / Cr Output CGST-SGST-IGST, plus COGS at valuation rate (Dr COGS / Cr Inventory) when perpetual inventory is on. An IRN is required before the invoice is shared when e-invoicing applies (AATO > ₹5 Cr). For AATO ≥ ₹10 Cr the IRN must be obtained within 30 days of the invoice date (the system warns on day 25).
* **Collections** allocate receipts to invoices (FIFO by due date by default). Unallocated amounts are kept as advances.
* **Price lists:** pick the price list in force for the customer segment on the document date, with min-qty slabs. A margin floor is enforced (`Margin %` < floor → approval).
* **Returns** create a credit note (Finance §4.10) and stock receipt into a `Returns`/QC location.

**KPIs.** Orders and value MTD, OTIF % (delivered on or before promise date at full qty / total), DSO = AR / (credit sales / days), conversion quote→order %, average discount %.

**Market comparison.** ERPNext Quotation→SO→Delivery Note→Sales Invoice, Odoo's sale/stock link, Tally's voucher flow, and Zoho's e-invoice integration all chain documents and carry quantities forward; the prototype has isolated tables. **Add:** document chaining with "pull from previous", partial delivery and invoice, multi-currency with exchange gain/loss, price-list engine, credit hold, TDS-receivable tracking, customer statement PDF.

**Careless-user risks.**
* Editing an invoice after posting → locked; use a credit note.
* Invoicing more than delivered → 422.
* Double click on "Post" → idempotency key prevents a duplicate.
* Changing the customer GSTIN after IRN → blocked.
* Rate entered as "1,000" text → parsed or rejected with a field error.
* Negative qty → rejected (returns use a return document).

---

## 4.4 Procurement / SCM (11 pages)
**Users:** Purchase, Finance, Quality and Warehouse. Owner: Purchase. `scm-comparison` uses the generic placeholder field set.

**Pages (11) — generated from index.html registry.** Legend: `Field:type`, `*` = required. "Renderer" = page-level function in index.html.

| # | Page id | Title | Renderer | Profile tabs (6) | Fields |
|---|---|---|---|---|---|
| 1 | `scm-pr` | Purchase Requisition | renderModule() | Requisition Register · Requirement Details · Budget Availability · Approval Journey · RFQ Conversion · PR Cycle Analytics | PR No:code*, PR Date:date*, Department:ref, Requester:ref, Required Date:date, Item Service:ref*, Specification:longtext, Quantity:qty, UOM:text, Budget Amount:money, Cost Center:ref, Project:ref, Priority:money, Approval Level:text, Status:status |
| 2 | `scm-rfq` | RFQ Management | renderModule() | RFQ Register · Supplier Invitations · Technical Requirements · Commercial Terms · Response Tracker · Sourcing Cycle Analytics | RFQ No:code*, PR No:ref, RFQ Date:date*, Closing Date:date, Buyer:ref, Category:enum, Vendor Count:qty*, Technical Spec:text, Commercial Terms:longtext, Delivery Location:text, Validity:date, Status:status |
| 3 | `scm-vendorquote` | Vendor Quotations | renderModule() | Quotation Register · Commercial Breakdown · Technical Compliance · Negotiation History · Deviation Log · Quote Analytics | Quote No:code*, RFQ No:ref, Vendor:ref*, Quote Date:date*, Base Amount:money, Discount:money, GST:money, Freight:money, Landed Cost:money, Lead Time Days:qty, Payment Terms:longtext, Warranty:text, Technical Compliance:text, Status:status |
| 4 | `scm-comparison` | Vendor Comparison | renderModule() | Comparison Sheet · Weighted Criteria · Landed Cost · Technical Compliance · Negotiation Scenario · Award Recommendation | Document No:code*, Vendor:ref*, Department:ref, Buyer:ref, Date:date*, Required Date:date, Amount:money, Approval Level:text, Reference:ref, Status:status |
| 5 | `scm-po` | Purchase Orders | renderModule() | PO Register · Item Schedule · Commercial Terms · Approval & Amendments · GRN Invoice Match · Supplier Performance | PO No:code*, Vendor:ref*, PO Type:enum, PO Date:date*, Delivery Date:date, Ship To Warehouse:ref, Currency:text, Subtotal:money, Discount:money, GST:money, Freight:money, Other Charges:money, Grand Total:money, Payment Terms:longtext, Buyer:ref, Revision:text, Status:status |
| 6 | `scm-grn` | Goods Receipt / GRN | renderModule() | GRN Register · Receipt Lines · Batch Serial Capture · QC & Acceptance · PO Variance · Receipt Analytics | GRN No:code*, PO No:ref, Vendor:ref*, Receipt Date:date*, Warehouse:ref, Vehicle:ref, LR No:text, Vendor Invoice:ref, Item Count:qty, Accepted Qty:qty, Rejected Qty:qty, QC Status:status, Putaway Status:status, Status:status |
| 7 | `scm-purchaseinvoice` | Purchase Invoice | renderModule() | Invoice Register · PO GRN Matching · Tax Validation · Debit Adjustments · Payment Readiness · Invoice Exceptions | Purchase Invoice No:code*, Vendor:ref*, Vendor Invoice Ref:ref, Invoice Date:date*, Due Date:date, PO No:ref, GRN No:ref, Taxable Value:money, GST:money, TDS:money, Invoice Total:money, Matched Amount:money, Variance:money, Payment Status:status, Status:status |
| 8 | `scm-approval` | Purchase Approval | renderModule() | Approval Inbox · Amount Matrix · Department Rules · Delegation & Escalation · Decision History · Approval SLA | Request No:code*, Transaction Type:hsn, Document No:text, Department:ref, Requester:ref, Amount:money, Current Level:text, Approver:ref, Submitted At:datetime, Age Hours:qty, Decision:enum, Comments:longtext, Status:status |
| 9 | `scm-suppliers` | Supplier Master | renderModule() | Supplier Directory · Compliance Documents · Category Capability · Bank & Tax Details · Performance Scorecard · Supplier Risk | Vendor Code:code*, Company Name:ref*, GSTIN:gstin, PAN:pan, Category:enum, Contact Person:ref, Mobile:phone, Email:email, Payment Terms:longtext, Bank Account:ref, Compliance Score:pct, Quality Score:pct, Delivery Score:pct, Overall Rating:pct, Status:status |
| 10 | `scm-evaluation` | Supplier Evaluation | renderModule() | Evaluation Cycles · Quality Score · Delivery OTIF · Cost Competitiveness · Compliance Rating · Supplier Ranking | Evaluation No:code*, Vendor:ref*, Period:date*, Quality Score:pct, Delivery OTIF:text, Cost Score:pct, Responsiveness:text, Compliance:text, Rejection PPM:qty, Lead Time Days:qty, Overall Score:pct, Rank:qty, Status:status |
| 11 | `scm-contracts` | Rate / Blanket Contracts | renderModule() | Contract Register · Rate Schedule · Volume Commitments · Validity & Renewal · Release Orders · Contract Utilization | Contract No:code*, Vendor:ref*, Contract Type:enum, Category:enum, Start Date:date*, End Date:date, Currency:text, Committed Value:money, Consumed Value:money, Balance Value:money, Release Orders:qty, Renewal Date:date, Status:status |


**Statuses.**
* PR: `Draft → Pending → Approved → Partially Ordered → Ordered | Rejected | Cancelled`.
* RFQ: `Draft → Sent → Closed → Awarded`.
* PO: `Draft → Pending → Approved → Released → Partially Received → Received → Billed → Closed | Short-Closed | Cancelled`. Amendments create revisions.
* GRN: `Draft → QC Pending → Accepted/Partially Rejected → Put Away`.
* Purchase Invoice: `Draft → Matched → Posted → Partially Paid → Paid | Blocked (variance)`.

**Rules and calculations.**
* **Budget check on PR:** `Budget Amount` ≤ cost-center available (`fin-budget.Available = Budget − Committed − Actual`). The control mode is Warn or Stop. An approved PR adds to **Committed**.
* **Vendor quote:** `Landed Cost = Base − Discount + GST(if not ITC eligible) + Freight + other`.
* **Comparison** weighted score = Σ wᵢ × normalised scoreᵢ over price, lead time, payment terms, warranty and technical compliance. Weights are configurable and default to 50/20/10/10/10. Awarding a vendor that is not the best scorer needs a reason.
* **PO** totals use the same formulas as Sales. Vendor GST state decides CGST/SGST vs IGST. Approval levels come from the matrix by Grand Total.
* **GRN:** received qty ≤ open PO qty + tolerance (configurable, default 0%). Rejected qty goes to the QC location. GRN posts stock at PO rate (Dr Inventory / Cr Stock-Received-Not-Billed).
* **Three-way match** on the purchase invoice:
  * qty: invoice ≤ accepted GRN qty;
  * rate: |invoice rate − PO rate| ≤ tolerance (default 1%);
  * tax: GSTIN and rate match.
  * `Matched Amount` and `Variance` are computed. If the variance exceeds tolerance, the status becomes `Blocked` and needs approval.
  * Posting: Dr SRNB, Dr Input GST (if ITC eligible), Cr Vendor, Cr TDS payable.
* **TDS on purchase invoice:** section from the vendor master. Rate × taxable value above the threshold. Section numbers follow the Income-tax Act 2025 from 1 Apr 2026 (legacy 1961 numbers for earlier dates), e.g. purchase of goods (old 194Q, 0.1% above ₹50 L aggregate), contractors, professionals.
* **Supplier master:** GSTIN and PAN are validated (PAN = GSTIN chars 3–12). The bank account needs a 2-person change approval (fraud control). MSME flag → 45-day payment alert (MSMED Act s.15).
* **Supplier evaluation:**
  * `Overall Score = 0.4×Quality + 0.3×OTIF + 0.2×Cost + 0.1×Responsiveness`;
  * `Rejection PPM = rejected qty / received qty × 10⁶`.
  * Computed monthly from GRN/QC data, not typed.
* **Blanket contracts:** `Balance Value = Committed − Consumed`. Release orders (POs referencing the contract) cannot exceed the balance.

**KPIs.** Open PR/PO count and value, PR→PO cycle days, supplier OTIF, price variance %, savings vs. last price, blocked invoices.

**Market comparison.** ERPNext (Material Request → RFQ → Supplier Quotation → PO → Purchase Receipt → Purchase Invoice), Odoo's received-quantity bill control and 3-way matching, and SAP B1 approval procedures. The prototype has the pages but no linkage and no match. **Add:** document chaining, tolerance-based 3-way match with block, vendor portal for quotes (**later**), last-purchase-price lookup, MSME due-date tracking.

**Careless-user risks.**
* Receiving against a closed PO → blocked.
* Invoice entered twice with the same vendor invoice number → unique constraint (vendor + invoice no + FY).
* Changing a PO after a GRN → only via amendment, and quantities cannot go below received.
* Deleting a supplier with transactions → blocked; inactivate instead.

---

## 4.5 Inventory (14 pages)
**Users:** Purchase, Production, Maintenance and Warehouse. Owner: Warehouse.

**Pages (14) — generated from index.html registry.** Legend: `Field:type`, `*` = required. "Renderer" = page-level function in index.html.

| # | Page id | Title | Renderer | Profile tabs (6) | Fields |
|---|---|---|---|---|---|
| 1 | `inv-items` | Item / SKU Master | renderModule() | Item Master · Classification & UOM · Tax & HSN · Planning Parameters · Traceability Setup · Cost & Price | Item Code:code*, Item Name:ref*, Item Type:ref, Category:enum, Brand:text, HSN SAC:hsn, Base UOM:text, Alt UOM:text, Barcode:text, Batch Tracked:bool, Serial Tracked:bool, Shelf Life Days:qty, Standard Cost:money, Selling Price:money, Reorder Level:text, Status:status |
| 2 | `inv-stock` | Stock Balance | renderModule() | Stock Overview · Warehouse Balance · Available vs Reserved · Batch Expiry · Blocked Stock · Stock Health | Item Code:code*, Item Name:ref*, Warehouse:ref, Zone:ref, Rack:ref, Shelf:ref, Bin:ref, Batch:text, On Hand:text, Reserved:text, Blocked:text, Available:text, Reorder Level:text, Average Cost:money, Stock Value:money, Status:status |
| 3 | `inv-transactions` | Inventory Transactions | renderModule() | Movement Ledger · Receipts · Issues · Transfers · Adjustments · Transaction Audit | Transaction No:code*, Date Time:datetime, Transaction Type:hsn, Reference:ref, Item:ref*, Warehouse From:ref, Warehouse To:ref, Batch Serial:text, Qty In:qty, Qty Out:qty, Unit Cost:money, Value:money, User:ref, Status:status |
| 4 | `inv-opening` | Opening Stock | renderModule() | Opening Stock Register · Warehouse Upload · Batch Serial Opening · Valuation Basis · Validation Errors · Posting Summary | Opening Ref:code*, Financial Year:date*, Warehouse:ref, Item:ref*, Batch Serial:text, Opening Qty:qty, Unit Cost:money, Opening Value:money, Valuation Method:enum, Upload Batch:text, Validation Status:status, Posting Status:status |
| 5 | `inv-adjustment` | Stock Adjustment | renderModule() | Adjustment Register · Count Variance · Reason Codes · Approval Control · Value Impact · Adjustment Audit | Adjustment No:code*, Date:date*, Warehouse:ref, Item:ref*, System Qty:qty, Counted Qty:qty, Variance Qty:qty, Unit Cost:money, Value Impact:money, Reason Code:longtext, Approver:ref, Status:status |
| 6 | `inv-transfer` | Stock Transfer | renderModule() | Transfer Orders · Source Allocation · In Transit · Destination Receipt · Transfer Variance · Transfer SLA | Transfer No:code*, Transfer Date:date*, Source Warehouse:ref, Destination Warehouse:ref, Item:ref*, Requested Qty:qty, Dispatched Qty:qty, Received Qty:qty, In Transit:qty, Vehicle Ref:ref, Expected Receipt:text, Status:status |
| 7 | `inv-reservation` | Stock Reservation | renderModule() | Reservation Register · Demand Source · Allocation Priority · Shortage Handling · Release Rules · Reservation Ageing | Reservation No:code*, Demand Type:enum, Demand Ref:ref, Item:ref*, Warehouse:ref, Batch Serial:text, Required Qty:qty, Reserved Qty:qty, Available Qty:qty, Priority:money, Reserved Until:text, Status:status |
| 8 | `inv-reconciliation` | Stock Reconciliation | renderModule() | System vs Physical · Variance Lines · Root Cause · Approval Posting · Value Impact · Reconciliation History | Reconciliation No:code*, Count Ref:qty, Warehouse:ref, Item:ref*, System Qty:qty, Physical Qty:qty, Variance:money, Unit Cost:money, Value Variance:money, Root Cause:longtext, Posting Ref:ref, Status:status |
| 9 | `inv-ageing` | Stock Ageing | renderModule() | Ageing Summary · 0 to 30 Days · 31 to 90 Days · 91 to 180 Days · 180 Plus Days · Slow Dead Stock | Item Code:code*, Item Name:ref*, Warehouse:ref, Last Movement:date*, Age Days:qty, 0 30 Qty:qty, 31 90 Qty:qty, 91 180 Qty:qty, 180 Plus Qty:qty, Stock Value:money, Classification:enum, Action:longtext |
| 10 | `inv-valuation` | Stock Valuation | renderModule() | Valuation Summary · FIFO Layers · Weighted Average · Standard Cost · Revaluation · Inventory GL Bridge | Valuation Ref:code*, Date:date*, Warehouse:ref, Item:ref*, Method:enum, Opening Value:money, Receipt Value:money, Issue Value:money, Adjustment Value:money, Closing Qty:qty, Closing Value:money, GL Balance:money, Variance:money |
| 11 | `inv-reorder` | Smart Reorder | renderModule() | Reorder Dashboard · Min Max Policy · Safety Stock · EOQ & Lead Time · Suggested PR · Forecast Accuracy | Item Code:code*, Item Name:ref*, Warehouse:ref, Avg Daily Usage:qty, Lead Time Days:qty, Safety Stock:text, Reorder Level:text, On Hand:text, Open PO:text, Net Requirement:text, Suggested Qty:qty, Preferred Vendor:ref, Status:status |
| 12 | `inv-batch` | Batch / Lot Tracking | renderModule() | Batch Register · Manufacturing Expiry · Batch Stock · Batch Movements · Quality Status · Batch Recall | Batch No:code*, Item:ref*, Warehouse:ref, Mfg Date:date*, Expiry Date:date, Received Qty:qty, Available Qty:qty, Blocked Qty:qty, QC Status:status, Supplier:ref, GRN Ref:ref, Status:status |
| 13 | `inv-serial` | Serial Number Tracking | renderModule() | Serial Register · Ownership History · Warranty Link · Serial Movements · Service History · Serial Exceptions | Serial No:code*, Item:ref*, Current Warehouse:ref, Current Owner:ref, Purchase GRN:ref, Sales Invoice:text, Warranty End:text, Last Movement:date*, Service Ticket:ref, Condition:longtext, Status:status |
| 14 | `inv-expiry` | Expiry Tracking | renderModule() | Expiry Dashboard · Near Expiry · Expired Stock · FEFO Allocation · Disposition Actions · Expiry Loss | Item:ref*, Batch:text, Warehouse:ref, Expiry Date:date*, Days to Expiry:qty, Available Qty:qty, Stock Value:money, FEFO Priority:money, Disposition:enum, Owner:ref, Status:status |


**Core model [ADD] — the stock ledger is the single source of truth.**
* `stock_ledger_entries` (item, warehouse, bin, batch, serial, qty ±, valuation rate, value ±, voucher type/no, posting datetime) is **append-only**.
* `stock_balances` (item × warehouse × bin × batch) is maintained transactionally:
  * `On Hand` = Σ ledger qty;
  * `Reserved` = Σ active reservations;
  * `Blocked` = QC hold;
  * `Available = On Hand − Reserved − Blocked`.
* In the prototype these are independent random columns.

**Valuation.**
* Per item: FIFO or Moving Average (the default).
* Moving average: `new_rate = (old_qty×old_rate + in_qty×in_rate)/(old_qty+in_qty)`. Issues are valued at the current rate.
* FIFO: issues consume the oldest layers.
* A backdated entry triggers a repost of later entries for that item-warehouse, done as a queued job with a lock.
* `inv-valuation.Variance = Stock Value − GL Inventory balance`, which must be 0 under perpetual inventory.

**Rules.**
* Negative stock is **not allowed** (a company setting, default off).
* Opening stock is allowed only in the first open period, imported through `inv-opening` with validation. Posting: Dr Inventory / Cr Opening Balance Equity.
* Adjustment and reconciliation: `Variance Qty = Counted − System`; `Value Impact = Variance × rate`. Needs approval above a value threshold.
* Transfer: `In Transit = Dispatched − Received`. It is a two-step transfer through an in-transit warehouse.
* Reorder:
  * `Reorder Level = Avg Daily Usage × Lead Time + Safety Stock`;
  * `Net Requirement = max(0, Reorder Level − (On Hand + Open PO − Reserved))`;
  * `Suggested Qty = max(Net Requirement, MOQ)`, rounded to a pack size. **[ADD]** EOQ option `√(2DS/H)`.
  * "Create PR" turns suggestions into PRs.
* Ageing buckets 0–30 / 31–90 / 91–180 / 180+ are based on the receipt date of the remaining FIFO layers.
* Batch: `Expiry = Mfg + Shelf Life Days`. FEFO is used for picking. Expired stock is auto-blocked by a nightly job.
* Serial: unique per item. Movement history comes from the ledger.

**KPIs.** Stock value (from the ledger), turns = COGS / average inventory, days on hand, shortage SKUs (Available < Reorder Level), near-expiry value (≤ 30 days), inventory accuracy % from counts.

**Market comparison.** ERPNext's Stock Ledger/Bin with FIFO/MA and repost, Odoo's quants with reservation and FEFO removal strategy, and Tally's godowns with batch. **Add:** UOM conversions, item variants (later), a projected-qty view, and FEFO enforcement.

**Careless-user risks.**
* Two users issue the last unit at the same time → row-level lock (`SELECT … FOR UPDATE` on the balance); the second gets "insufficient stock".
* Typing On Hand directly → impossible (read-only, derived).
* Deleting an item with ledger entries → blocked.
* Changing the valuation method after transactions → blocked.

---

## 4.6 Warehouse / WMS (13 pages)
**Users:** Purchase, Production and Warehouse. Owner: Warehouse.

**Pages (13) — generated from index.html registry.** Legend: `Field:type`, `*` = required. "Renderer" = page-level function in index.html.

| # | Page id | Title | Renderer | Profile tabs (6) | Fields |
|---|---|---|---|---|---|
| 1 | `wms-warehouses` | Warehouse Master | renderModule() | Warehouse Directory · Capacity Profile · Storage Policy · Operating Calendar · Service Zones · Warehouse KPIs | Warehouse Code:code*, Warehouse Name:ref*, Branch:ref, Address:text, Manager:ref, Total Capacity:money, Used Capacity:qty, Dock Doors:text, Operating Hours:qty, Temperature Zone:ref, Status:status |
| 2 | `wms-zones` | Zone Management | renderModule() | Zone Directory · Zone Capacity · Storage Restrictions · Putaway Priority · Picking Strategy · Zone Utilization | Zone Code:code*, Warehouse:ref, Zone Name:text*, Zone Type:enum, Capacity:qty, Used:text, Storage Class:enum, Temperature:text, Putaway Priority:money, Pick Sequence:qty, Status:status |
| 3 | `wms-racks` | Rack Management | renderModule() | Rack Directory · Rack Capacity · Load Limits · Slotting Rules · Occupancy Heatmap · Rack Audit | Rack Code:code*, Warehouse:ref, Zone:ref, Aisle:text, Rack Type:enum, Levels:qty, Max Load:text, Used Load:text, Occupancy %:pct, Last Audit:date*, Status:status |
| 4 | `wms-shelves` | Shelf Management | renderModule() | Shelf Directory · Shelf Dimensions · SKU Compatibility · Occupancy · Replenishment · Shelf Audit | Shelf Code:code*, Rack:ref, Level:text, Dimensions:text, Max Weight:qty, SKU Count:qty, Occupied %:pct, Storage Rule:text, Last Count:date*, Status:status |
| 5 | `wms-bins` | Bin Management | renderModule() | Bin Directory · Bin Capacity · SKU Slotting · Occupancy Heatmap · Movement History · Bin Exceptions | Bin Code:code*, Warehouse:ref, Zone:ref, Rack:ref, Shelf:ref, Bin Type:enum, Capacity:qty, Occupied:text, Available:text, SKU Count:qty, Putaway Priority:money, Status:status |
| 6 | `wms-putaway` | Put Away | renderModule() | Putaway Queue · Suggested Bins · Rule Priority · Operator Tasks · Putaway Exceptions · Dock to Stock Time | Task No:code*, GRN Ref:ref, Item:ref*, Batch:text, Qty:qty, Source Dock:enum, Suggested Bin:ref, Operator:ref, Priority:money, Created Time:datetime, Completed Time:datetime, Exception:text, Status:status |
| 7 | `wms-pick` | Pick List | renderModule() | Pick Waves · Pick Tasks · Route Optimization · Batch Serial Pick · Short Picks · Pick Productivity | Pick Task No:code*, Wave No:text, Sales Order:ref, Item:ref*, Batch Serial:text, Source Bin:ref, Required Qty:qty, Picked Qty:qty, Picker:ref, Route Seq:text, Short Qty:qty, Status:status |
| 8 | `wms-packing` | Packing | renderModule() | Packing Queue · Cartonization · Label Printing · Weight Verification · Packing Exceptions · Pack Productivity | Pack No:code*, Sales Order:ref, Customer:ref*, Picked Qty:qty, Cartons:qty, Gross Weight:money, Volumetric Weight:qty, Label Status:status, Packer:ref, QC Check:text, Dispatch Ready:bool, Status:status |
| 9 | `wms-cycle` | Cycle Count | renderModule() | Cycle Count Plan · ABC Frequency · Count Tasks · Variance Review · Approval Posting · Count Accuracy | Count Plan No:code*, Warehouse:ref, Zone:ref, ABC Class:enum, Frequency:enum, Planned Date:date*, Items Planned:qty*, Items Counted:qty, Variance Lines:qty, Accuracy %:pct, Supervisor:text, Status:status |
| 10 | `wms-physical` | Physical Verification | renderModule() | Physical Count Plan · Freeze Controls · Count Sheets · Recount Queue · Reconciliation · Audit Closure | Physical Count No:code*, Warehouse:ref, Freeze Date:date*, Count Team:qty, Items:qty*, First Count Variance:money, Recount Variance:money, Value Variance:money, Approved By:ref, Posting Date:date, Status:status |
| 11 | `wms-transfer` | Warehouse Transfers | renderModule() | Transfer Queue · Inter Warehouse Plan · Pick Dispatch · In Transit · Destination Putaway · Transfer Accuracy | WMS Transfer No:code*, Source Warehouse:ref, Destination:text, Pick Wave:text, Dispatch Ref:ref, In Transit Qty:qty, Received Qty:qty, Putaway Qty:qty, Variance:money, Expected Date:date*, Status:status |
| 12 | `wms-barcode` | Barcode / QR | renderModule() | Barcode Registry · Label Templates · Scan Transactions · Printer Setup · Invalid Scans · Scan Productivity | Barcode:code*, Item:ref*, Barcode Type:enum, UOM:text, Label Template:text, Printer:text, Last Printed:date*, Scan Count:qty, Invalid Scans:date, Status:status |
| 13 | `wms-rfid` | RFID Support | renderModule() | RFID Tag Registry · Reader Setup · Read Events · Portal Mapping · Missed Reads · RFID Accuracy | Tag EPC:text*, Item:ref*, Batch Serial:text, Reader Zone:ref, Last Read Time:datetime, Read Strength:text, Expected Location:text, Actual Location:money, Exception:text, Status:status |


**Model.** `warehouse → zone → rack → shelf → bin` is a typed hierarchy. Bin capacity is held in units, kg or m³. Occupancy % = used / capacity, computed from stock balances × item volume/weight.

**Flows.**
* **Put-away:** an accepted GRN line creates a task. The suggested bin follows the rule order: (1) same item/batch bin with space, (2) zone storage class matching the item class, (3) nearest empty bin by pick sequence. The operator confirms the actual bin by scan. If it differs from the suggestion it is logged as an exception. Dock-to-stock time = Completed − Created.
* **Pick:** an approved SO/transfer → wave (grouped by route/time) → pick tasks ordered by route sequence, FEFO/FIFO batch choice. `Short Qty = Required − Picked` triggers a backorder or substitute.
* **Packing:** cartons, gross weight, and volumetric weight = L×W×H(cm)/5000 (courier default, configurable). Labels; QC check required before `Dispatch Ready`.
* **Cycle count:** ABC class frequency (A monthly, B quarterly, C half-yearly). Blind count (system qty hidden). Variance above tolerance → recount. Accuracy % = lines without variance / lines counted. Posting goes through the adjustment with approval.
* **Physical verification:** freezes movements for the warehouse (bins locked) during the count window.
* **Barcode/QR:** label printing to PDF (ZPL later); scans are resolved through `GET /scan/:code`.
* **RFID:** the reader integration is **not in scope** for v1. The page keeps a manual/CSV import of read events and flags expected vs. actual location mismatches.

**KPIs.** Open put-away/pick tasks, lines/hour per picker, short-pick %, dock-to-stock hours, bin utilisation %, count accuracy %.

**Market comparison.** Odoo Barcode/WMS (putaway rules, waves, batch transfers), ERPNext putaway rules, and SAP B1 bin locations. **Add:** a mobile-first scan UI for tasks (same design tokens), capacity-aware putaway, and pick-path ordering.

**Careless-user risks.**
* Scanning the wrong bin → mismatch prompt, no silent move.
* Deleting a bin with stock → blocked.
* A count started but never finished → auto-expires after N days, and the freeze is released with an audit entry.

---

## 4.7 Manufacturing (13 pages)
**Users:** Production and Quality. Owner: Production. `mfg-shopfloor` → `shopfloor()` has **hard-coded** KPIs (OEE 87.6%, Target 8,400 …) and an 8-bar hourly chart.

**Pages (13) — generated from index.html registry.** Legend: `Field:type`, `*` = required. "Renderer" = page-level function in index.html.

| # | Page id | Title | Renderer | Profile tabs (6) | Fields |
|---|---|---|---|---|---|
| 1 | `mfg-bom` | Bill of Materials | renderModule() | BOM Register · BOM Structure · Component Effectivity · Alternates & Substitutes · Revision Control · Cost Rollup | BOM No:code*, Parent Item:ref*, Version:text, BOM Type:ref, Base Qty:qty, Effective From:date*, Effective To:date, Component Count:qty, Material Cost:money, Scrap %:pct, Revision:text, Status:status |
| 2 | `mfg-routing` | Routing | renderModule() | Routing Register · Operation Sequence · Standard Times · Work Center Assignment · Tooling Requirements · Routing Efficiency | Routing No:code*, Item:ref*, Version:text, Operation Count:qty, Primary Work Center:ref, Setup Time:text, Run Time:text, Queue Time:text, Move Time:text, Labor Cost:money, Machine Cost:money, Status:status |
| 3 | `mfg-workcenters` | Work Centers | renderModule() | Work Center Master · Capacity Calendar · Machines & Labor · Rates & Cost · Shift Availability · Utilization | Work Center Code:code*, Work Center Name:ref*, Department:ref, Machine Count:qty*, Labor Count:qty, Daily Capacity Hrs:qty, Efficiency %:pct, Hourly Rate:money, Calendar:text, Status:status |
| 4 | `mfg-plan` | Production Planning | renderModule() | Production Plan · Demand Inputs · Capacity Check · Material Check · Plan Release · Plan Adherence | Plan No:code*, Plan Date:date*, Horizon:text, Item:ref*, Demand Qty:qty, Planned Qty:qty, Capacity Load %:pct, Material Availability %:pct, Release Date:date, Planner:text, Status:status |
| 5 | `mfg-orders` | Production Orders | renderModule() | Production Orders · Material Issue · Operation Progress · Quality Results · Finished Receipt · Order Variance | Production No:code*, Item:ref*, BOM Version:ref, Routing:ref, Planned Qty:qty, Produced Qty:qty, Rejected Qty:qty, Start Date:date*, Due Date:date, Work Center:ref, Priority:money, Material Status:status, Status:status |
| 6 | `mfg-mrp` | Material Requirement Planning | renderModule() | MRP Run · Gross Requirements · Net Requirements · Planned Orders · Shortage Exceptions · MRP Pegging | MRP Run No:code*, Run Date:date*, Horizon:text, Item:ref*, Gross Requirement:money, On Hand:text, Scheduled Receipt:text, Safety Stock:text, Net Requirement:text, Planned Order Qty:qty, Required Date:date, Pegging Ref:ref, Status:status |
| 7 | `mfg-workorders` | Work Orders | renderModule() | Work Order Queue · Operation Details · Operator Assignment · Material Consumption · Downtime & Scrap · Completion | WO No:code*, Production Order:ref, Operation:text, Work Center:ref, Machine:ref*, Operator:ref, Planned Qty:qty, Completed Qty:qty, Start Time:datetime, End Time:datetime, Downtime Min:qty, Scrap Qty:qty, Status:status |
| 8 | `mfg-shopfloor` | Shop Floor Dashboard | shopfloor() | Shop Floor Dashboard Workspace · Shop Floor Dashboard Details · Shop Floor Dashboard Workflow · Shop Floor Dashboard Exceptions · Shop Floor Dashboard Performance · Shop Floor Dashboard Controls *(profile defined but ignored by the custom renderer; rebuild uses it)* | Document No:code*, Item:ref*, Production Order:ref, Work Center:ref, Planned Qty:qty, Actual Qty:money, Start Date:date*, Due Date:date, Owner:ref, Status:status |
| 9 | `mfg-wip` | WIP Tracking | renderModule() | WIP Overview · Stage Inventory · Operation Ageing · Bottleneck Queue · WIP Valuation · WIP Reconciliation | WIP Ref:code*, Production Order:ref, Item:ref*, Operation:text, Work Center:ref, Qty In:qty, Qty Good:qty, Qty Rejected:qty, Queue Age Hrs:qty, Unit Cost:money, WIP Value:money, Status:status |
| 10 | `mfg-fg` | Finished Goods Receipt | renderModule() | FG Receipt Register · Production Reference · Batch Serial Capture · QC Release · Warehouse Putaway · Yield Analysis | FG Receipt No:code*, Production Order:ref, Item:ref*, Batch Serial:text, Receipt Date:date*, Produced Qty:qty, Accepted Qty:qty, Rejected Qty:qty, Warehouse:ref, Bin:ref, QC Release:bool, Status:status |
| 11 | `mfg-scrap` | Scrap Management | renderModule() | Scrap Register · Scrap Reasons · Material Recovery · Approval & Disposal · Cost Impact · Scrap Trend | Scrap No:code*, Production Order:ref, Operation:text, Item:ref*, Scrap Qty:qty, Reason:longtext, Recoverable Qty:qty, Disposal Method:enum, Unit Cost:money, Loss Value:money, Approver:ref, Status:status |
| 12 | `mfg-rework` | Rework Management | renderModule() | Rework Queue · Defect Source · Rework Routing · Material Labor · Reinspection · Rework Cost | Rework No:code*, Source NCR:ref, Production Order:ref, Item:ref*, Qty:qty, Defect:text, Rework Routing:ref, Labor Hrs:qty, Material Cost:money, Reinspection Result:enum, Status:status |
| 13 | `mfg-costing` | Production Costing | renderModule() | Cost Sheet · Material Cost · Labor Cost · Machine Overhead · Variance Analysis · Actual vs Standard | Cost Sheet No:code*, Production Order:ref, Item:ref*, Standard Material:text, Actual Material:money, Standard Labor:text, Actual Labor:money, Machine OH:ref, Other OH:text, Standard Total:money, Actual Total:money, Variance %:pct, Status:status |


**Flows and formulas.**
* **BOM:** multi-level with a revision. `Material Cost = Σ component qty × (1+scrap%) × valuation rate`, rolled up recursively. Only one Active default BOM per item per effectivity window. A cycle check prevents A→B→A.
* **Routing:** operations with work center, setup/run/queue/move time. `Labor Cost = Σ (setup + run × qty) × labor rate`; `Machine Cost = Σ hours × WC hourly rate`.
* **Work Center:** `Daily Capacity Hrs` × Efficiency % gives available hours.
* **Production planning:** demand (SO + forecast) → planned qty. `Capacity Load % = required hours / available hours`.
* **MRP** (a run is a background job):
  * `Gross Requirement` = demand exploded through the BOM over the horizon;
  * `Net = max(0, Gross − On Hand − Scheduled Receipts + Safety Stock)`;
  * planned orders are offset by lead time;
  * pegging links each planned order to its demand.
  * Output: suggested Production Orders and PRs.
* **Production Order** `Released` requires material availability (Available ≥ required, or partial-release allowed by setting). It issues materials (backflush or manual) and creates Work Orders per routing operation.
* **Work Order:** Completed Qty ≤ Planned. Downtime minutes link to maintenance downtime. Scrap qty goes to the scrap entry.
* **WIP:** `WIP Value = materials issued + labor + overhead − FG received − scrap value`.
* **FG Receipt:** Accepted Qty goes into stock at production cost after QC release (Final Quality). Rejected qty goes to rework or scrap.
* **Scrap:** `Loss Value = (Scrap Qty − Recoverable Qty) × Unit Cost`, with approval above a threshold.
* **Rework:** linked to an NCR; reinspection is needed before stock.
* **Costing:** `Variance % = (Actual Total − Standard Total)/Standard Total × 100`. Actuals come from issues, timesheets on work orders, and overhead absorption.
* **Shop floor:** OEE = Availability × Performance × Quality, where
  * Availability = (planned time − downtime)/planned time;
  * Performance = (ideal cycle time × total count)/run time;
  * Quality = good/total.
  * All three come from work-order logs.

**KPIs.** OEE, plan attainment = produced/planned, yield %, rejection %, WIP value, average order lead time, MRP shortages.

**Market comparison.** ERPNext BOM/Work Order/Job Card with production plan & MRP, Odoo MRP with work orders and OEE, and Tally job work. **Add:** job-card time logging (start/pause/stop), backflush, subcontracting (job work, **later**), BOM cost-rollup history.

**Careless-user risks.**
* Editing an active BOM in use → a new revision is created; open orders keep their revision.
* Completing more than planned → needs over-production % permission.
* Deleting a released production order → cancel only, which reverses issues.

---

## 4.8 Quality / QMS (10 pages)
**Users:** Production, Quality and Purchase (read). Owner: Quality.

**Pages (10) — generated from index.html registry.** Legend: `Field:type`, `*` = required. "Renderer" = page-level function in index.html.

| # | Page id | Title | Renderer | Profile tabs (6) | Fields |
|---|---|---|---|---|---|
| 1 | `qms-plans` | Inspection Plans | renderModule() | Inspection Plan Master · Characteristics · Sampling Rules · Specification Limits · Revision Control · Plan Coverage | Plan Code:code*, Plan Name:text*, Inspection Type:enum, Item Category:ref*, Revision:text, Sampling Standard:text, Sample Size:text, Characteristic Count:qty, Effective Date:date*, Owner:ref, Status:status |
| 2 | `qms-incoming` | Incoming Quality | renderModule() | Incoming Inspection Queue · Supplier Lot · Sampling & Tests · Acceptance Decision · NCR Link · Supplier Quality Trend | Inspection No:code*, GRN Ref:ref, Vendor:ref*, Item:ref, Batch:text, Lot Qty:qty, Sample Qty:qty, Accepted Qty:qty, Rejected Qty:qty, Decision:enum, Inspector:ref, NCR Ref:ref, Status:status |
| 3 | `qms-process` | In-Process Quality | renderModule() | In Process Inspection · Operation Checkpoints · SPC Readings · Hold Release · Defect Escalation · Process Capability | Inspection No:code*, Production Order:ref, Operation:text, Item:ref*, Sample Time:datetime, Parameter:text, Specification:longtext, Actual:money, Result:enum, Inspector:ref, Hold Status:status, Status:status |
| 4 | `qms-final` | Final Quality | renderModule() | Final Inspection Queue · Final Checklist · Test Results · Release Certificate · Customer Requirement · Final Yield | Inspection No:code*, Production Order:ref, Item:ref*, Batch Serial:text, Qty:qty, Checklist Score:pct, Test Result:enum, Accepted:text, Rejected:text, Certificate No:text, Inspector:ref, Status:status |
| 5 | `qms-supplier` | Supplier Quality | renderModule() | Supplier Quality Dashboard · PPM & Rejection · Incoming Trends · SCAR Actions · Audit Findings · Supplier Quality Score | Vendor:ref*, Period:date*, Lots Received:qty, Lots Rejected:qty, PPM:qty, Quality Score:pct, OTIF:text, NCR Count:qty, SCAR Open:text, Audit Score:pct, Overall Rating:pct, Status:status |
| 6 | `qms-inspections` | Quality Inspections | renderModule() | Inspection Register · Parameter Results · Sample Details · Accept Reject · Attachments & Certificates · Inspection Analytics | Inspection No:code*, Inspection Type:enum, Reference:ref, Item:ref*, Lot Batch:text, Sample Qty:qty, Parameters:text, Accepted:text, Rejected:text, Inspector:ref, Inspection Date:date*, Status:status |
| 7 | `qms-ncr` | Non-Conformance / NCR | renderModule() | NCR Register · Containment · Root Cause · Disposition · Responsibility & Due Date · NCR Trend | NCR No:code*, Date:date*, Source:enum, Reference:ref, Item:ref*, Problem Description:longtext, Containment:longtext, Disposition:enum, Owner:ref, Due Date:date, Severity:enum, Status:status |
| 8 | `qms-capa` | CAPA | renderModule() | CAPA Register · Problem Statement · Root Cause · Corrective Action · Preventive Action · Effectiveness Check | CAPA No:code*, NCR Ref:ref, Problem Statement:longtext, Root Cause:longtext, Corrective Action:longtext, Preventive Action:longtext, Owner:ref, Target Date:date*, Effectiveness Date:date, Effectiveness Result:date, Status:status |
| 9 | `qms-5why` | 5 Why Analysis | renderModule() | 5 Why Cases · Problem Definition · Why Chain · Root Cause Evidence · Action Linkage · Closure Review | Case No:code*, NCR Ref:ref, Problem:longtext, Why 1:longtext, Why 2:longtext, Why 3:longtext, Why 4:longtext, Why 5:longtext, Root Cause:longtext, Owner:ref, Status:status |
| 10 | `qms-calibration` | Calibration | renderModule() | Instrument Register · Calibration Schedule · Calibration Results · Out of Tolerance · Certificates · Compliance Status | Instrument ID:code*, Instrument Name:text*, Department:ref, Range:text, Accuracy:pct, Calibration Frequency:enum, Last Calibration:date*, Next Due:date, Agency:text, Certificate:text, Result:enum, Status:status |


**Flows.**
* **Inspection Plans:** characteristics (parameter, nominal, LSL/USL, method). The sampling standard is IS 2500 / ISO 2859-1 AQL tables (sample size from lot size and AQL; configurable table).
* **Incoming QC** (from GRN), **In-process** (from work order), **Final** (from FG receipt), and generic **Inspections**:
  * the result per parameter is Pass when LSL ≤ actual ≤ USL;
  * lot decision is Accept / Reject / Accept with deviation (needs approval);
  * `Accepted + Rejected = Lot Qty` (validated);
  * rejected lots raise an NCR automatically.
* **Hold:** an in-process failure sets `Hold Status`, which blocks further work-order completion.
* **NCR:** severity Minor/Major/Critical; containment is mandatory before disposition. Disposition is Use-as-is / Rework / Scrap / Return to vendor. Closure needs a CAPA for Major/Critical.
* **CAPA:** root cause (from 5-Why or fishbone), corrective action, preventive action, target date, and an effectiveness check (`Effectiveness Date` ≥ closure + N days). Status `Open → In Progress → Verification → Closed (Effective) | Reopened (Not effective)`.
* **5 Why:** Why1..5 → Root Cause. At least 3 whys are needed to save as Complete.
* **Supplier Quality:** PPM, lots rejected and SCAR open, computed from incoming QC and NCRs.
* **Calibration:** `Next Due = Last Calibration + Frequency`. An overdue instrument is **blocked** from being chosen on inspections. An out-of-tolerance result triggers a review of inspections since the last good calibration.

**KPIs.** First-pass yield, PPM (incoming, internal, customer), open NCR by severity, CAPA overdue, calibration compliance %.

**Market comparison.** ERPNext Quality Inspection templates and Odoo Quality control points and alerts (Enterprise). Zoho has none natively. **Add:** inspection templates tied to item category, auto-triggers from GRN/WO/FG, certificate (CoA) PDF, AQL sampling tables.

**Careless-user risks.**
* Closing an NCR without containment → blocked.
* An inspector with an expired calibration instrument → blocked.
* Accepted + Rejected ≠ Lot → validation error.

---

## 4.9 Maintenance (10 pages)
**Users:** Production and Maintenance. Owner: Maintenance.

**Pages (10) — generated from index.html registry.** Legend: `Field:type`, `*` = required. "Renderer" = page-level function in index.html.

| # | Page id | Title | Renderer | Profile tabs (6) | Fields |
|---|---|---|---|---|---|
| 1 | `maint-machines` | Machine Master | renderModule() | Machine Register · Technical Specifications · Location & Ownership · Service History · Documents · Machine Health | Machine Code:code*, Machine Name:ref*, Department:ref, Location:text, Make:text, Model:enum, Serial No:text, Criticality:enum, Commission Date:date*, Last Service:date, Next Service:date, MTBF Hrs:qty, Status:status |
| 2 | `maint-equipment` | Equipment Master | renderModule() | Equipment Register · Criticality · Component Hierarchy · Operating Parameters · Maintenance History · Lifecycle Cost | Equipment Code:code*, Equipment Name:text*, Parent Asset:ref, Department:ref, Location:text, Criticality:enum, Make:text, Model:enum, Serial No:text, Warranty End:text, Status:status |
| 3 | `maint-preventive` | Preventive Maintenance | renderModule() | PM Schedule · Maintenance Plans · Due Work · Checklist Execution · Spare Planning · PM Compliance | PM Plan No:code*, Machine:ref*, Frequency:enum, Checklist:text, Last Done:date*, Next Due:date, Estimated Hrs:qty, Technician Skill:ref, Spare Kit:text, Compliance %:pct, Status:status |
| 4 | `maint-breakdown` | Breakdown Maintenance | renderModule() | Breakdown Queue · Failure Details · Response Timeline · Repair Actions · Root Cause · Breakdown Cost | Breakdown No:code*, Machine:ref*, Reported At:datetime, Reported By:ref, Failure Symptom:text, Priority:money, Technician:ref, Response Time Min:qty, Repair Time Min:qty, Production Loss Hrs:qty, Root Cause:longtext, Status:status |
| 5 | `maint-workorders` | Maintenance Work Orders | renderModule() | Maintenance WO · Job Plan · Technician Assignment · Parts & Tools · Completion & Signoff · Work Order KPI | MWO No:code*, Type:enum, Machine:ref*, Job Description:longtext, Priority:money, Technician:ref, Planned Start:date*, Planned End:date, Actual Hrs:qty, Parts Cost:money, Labor Cost:money, Completion:text, Status:status |
| 6 | `maint-spares` | Spare Parts | renderModule() | Spare Master · Stock Availability · Critical Spares · Consumption History · Reorder Planning · Spare Cost | Spare Code:code*, Spare Name:text*, Machine Category:ref*, Warehouse:ref, On Hand:text, Reserved:text, Reorder Level:text, Lead Time:qty, Preferred Vendor:ref, Unit Cost:money, Criticality:enum, Status:status |
| 7 | `maint-schedule` | Maintenance Schedule | renderModule() | Maintenance Calendar · Weekly Plan · Monthly Plan · Resource Loading · Shutdown Plan · Schedule Compliance | Schedule Ref:code*, Period:date*, Machine:ref*, Maintenance Type:enum, Planned Date:date, Duration Hrs:qty, Technician:ref, Production Window:text, Parts Ready:bool, Status:status |
| 8 | `maint-downtime` | Downtime | renderModule() | Downtime Register · Planned Downtime · Unplanned Downtime · Reason Pareto · Production Loss · Downtime Trend | Downtime No:code*, Machine:ref*, Start Time:datetime, End Time:datetime, Duration Min:qty, Type:enum, Reason:longtext, Production Order:ref, Lost Qty:qty, Cost Impact:money, Owner:ref, Status:status |
| 9 | `maint-mtbf` | MTBF / MTTR | renderModule() | Reliability Dashboard · MTBF by Asset · MTTR by Asset · Failure Frequency · Reliability Trend · Improvement Actions | Machine:ref*, Period:date*, Operating Hours:qty, Failures:qty, MTBF Hrs:qty, Repair Hours:qty, MTTR Hrs:qty, Availability %:pct, Target MTBF:text, Trend:enum, Status:status |
| 10 | `maint-alerts` | Maintenance Alerts | renderModule() | Alert Center · Service Due · Calibration Due · Document Expiry · Breakdown Escalation · Alert Rules | Alert No:code*, Alert Type:enum, Asset:ref*, Due Date:date*, Days Remaining:qty, Owner:ref, Escalation Level:text, Notification Channel:enum, Acknowledged:bool, Status:status |


**Flows and formulas.**
* **Machine/Equipment masters** (equipment can have a parent asset). Criticality is A/B/C.
* **Preventive Maintenance plans:** frequency by days, running hours, or both. A nightly job creates a Maintenance Work Order **N days before** `Next Due`. PM compliance % = PM WOs completed on time / due.
* **Breakdown:** reported → acknowledged (response time) → repaired (repair time).
  * `Response Time Min = acknowledged − reported`;
  * `Repair Time Min = repaired − acknowledged`.
  * It creates downtime automatically and links to the production order to compute `Lost Qty` and `Cost Impact = lost hours × WC hourly rate + parts + labor`.
* **MWO:** parts are issued from the spares store (inventory issue with machine as cost object). Labor hours × rate. Completion needs a checklist.
* **Spares:** this is an inventory view, filtered to spare category items (no separate stock).
* **Schedule:** a calendar of planned PM respecting the production window. A clash with a released production order warns.
* **MTBF/MTTR:** `MTBF = operating hours / failures`; `MTTR = repair hours / failures`; `Availability = MTBF/(MTBF+MTTR)`. Computed per period from breakdown records.
* **Alerts:** generated from PM due, calibration and warranty dates. The escalation level rises daily while unacknowledged.

**KPIs.** MTBF, MTTR, availability %, PM compliance %, breakdown count, maintenance cost per machine.

**Market comparison.** ERPNext Asset Maintenance, Odoo Maintenance (preventive by period, MTBF/MTTR stats) and SAP B1 Equipment cards. **Add:** meter-based PM, QR scan to open a machine, technician mobile view, spare reservation for planned PM.

**Careless-user risks.**
* Closing a breakdown without a root cause → blocked for criticality A.
* Overlapping downtime records for the same machine → validation error.

---

## 4.10 Finance & Accounts (19 pages)
**Users:** Finance, CFO (scope `finance`). Owner: Finance.

**Pages (19) — generated from index.html registry.** Legend: `Field:type`, `*` = required. "Renderer" = page-level function in index.html.

| # | Page id | Title | Renderer | Profile tabs (6) | Fields |
|---|---|---|---|---|---|
| 1 | `fin-coa` | Chart of Accounts | renderModule() | Account Tree · Account Master · Group Mapping · Posting Controls · Opening Balances · COA Validation | Account Code:code*, Account Name:qty*, Account Type:qty, Parent Group:ref, Normal Balance:money, Posting Allowed:bool, Cost Center Required:ref, Tax Mapping:text, Currency:text, Status:status |
| 2 | `fin-gl` | General Ledger | renderModule() | General Ledger · Voucher Drilldown · Account Movement · Cost Center Split · Period Comparison · Ledger Audit | Posting Date:date*, Voucher No:text, Voucher Type:enum, Account:ref, Narration:longtext, Debit:money, Credit:money, Cost Center:ref, Profit Center:ref, Reference:ref, Running Balance:money, Status:status |
| 3 | `fin-journal` | Journal Entries | renderModule() | Journal Register · Debit Credit Lines · Supporting Documents · Approval & Posting · Reversal Entries · Journal Audit | JV No:code*, Date:date*, Reference:ref, Narration:longtext, Debit Total:money, Credit Total:money, Cost Center:ref, Supporting Doc:text, Prepared By:ref, Approved By:ref, Posting Status:status, Status:status |
| 4 | `fin-cashbook` | Cash Book | renderModule() | Cash Book · Receipts · Payments · Petty Cash · Cash Reconciliation · Cash Position | Date:date*, Voucher No:text, Receipt Payment:text, Party:ref, Narration:longtext, Cash In:money, Cash Out:money, Balance:money, Reference:ref, User:ref, Status:status |
| 5 | `fin-bankbook` | Bank Book | renderModule() | Bank Book · Bank Receipts · Bank Payments · Transfers · Uncleared Items · Bank Position | Date:date*, Voucher No:text, Bank Account:ref, Receipt Payment:text, Party:ref, Instrument UTR:text, Debit:money, Credit:money, Balance:money, Clearing Status:status, Status:status |
| 6 | `fin-ap` | Accounts Payable | renderModule() | Vendor Payables · Invoice Queue · Due Schedule · Payment Proposal · Debit Notes · AP Ageing | Vendor Invoice:ref*, Vendor:ref*, Invoice Date:date*, Due Date:date, Invoice Amount:money, Paid:money, Outstanding:money, Age Days:qty, Payment Block:text, Payment Method:enum, Status:status |
| 7 | `fin-ar` | Accounts Receivable | renderModule() | Customer Receivables · Invoice Exposure · Due Schedule · Collection Allocation · Credit Notes · AR Ageing | Invoice No:code*, Customer:ref*, Invoice Date:date*, Due Date:date, Invoice Amount:money, Received:text, Outstanding:money, Age Days:qty, Credit Limit:money, Collection Owner:ref, Status:status |
| 8 | `fin-creditnote` | Credit Notes | renderModule() | Credit Note Register · Reference Invoice · Tax Adjustment · Approval · Ledger Posting · Credit Note Analysis | Credit Note No:code*, Customer:ref*, Invoice Ref:ref, Date:date*, Reason:longtext, Taxable Adjustment:money, GST Adjustment:money, Total:money, Approval:text, Posting Ref:ref, Status:status |
| 9 | `fin-debitnote` | Debit Notes | renderModule() | Debit Note Register · Vendor Reference · Tax Adjustment · Approval · Ledger Posting · Debit Note Analysis | Debit Note No:code*, Vendor:ref*, Invoice Ref:ref, Date:date*, Reason:longtext, Taxable Adjustment:money, GST Adjustment:money, Total:money, Approval:text, Posting Ref:ref, Status:status |
| 10 | `fin-bankreco` | Bank Reconciliation | renderModule() | Reconciliation Workspace · Bank Statement · ERP Transactions · Auto Matching · Unmatched Exceptions · Reconciliation Summary | Statement Ref:code*, Bank Account:ref, Statement Date:date*, ERP Balance:money, Bank Balance:money, Matched Amount:money, Unmatched Bank:text, Unmatched ERP:text, Difference:money, Reconciled By:ref, Status:status |
| 11 | `fin-costcenter` | Cost Centers | renderModule() | Cost Center Master · Hierarchy · Budget Mapping · Transaction Allocation · Cost Statement · Variance | Cost Center Code:code*, Cost Center Name:ref*, Department:ref, Manager:ref, Parent:ref, Budget:money, Actual:money, Committed:money, Available:text, Status:status |
| 12 | `fin-profitcenter` | Profit Centers | renderModule() | Profit Center Master · Revenue Allocation · Cost Allocation · Contribution Margin · Segment P&L · Performance | Profit Center Code:code*, Profit Center Name:ref*, Branch:ref, Manager:ref, Revenue:money, Direct Cost:money, Allocated Cost:money, Contribution:money, Margin %:pct, Status:status |
| 13 | `fin-expenses` | Expense Management | renderModule() | Expense Register · Expense Claims · Policy Validation · Approval Queue · Payment Status · Spend Analytics | Expense No:code*, Employee Vendor:ref*, Date:date*, Category:enum, Department:ref, Cost Center:ref, Amount:money, GST:money, Policy Result:enum, Approver:ref, Payment Status:status, Status:status |
| 14 | `fin-budget` | Budgeting | renderModule() | Budget Register · Department Budgets · Commitments · Actual Consumption · Budget Control · Variance Forecast | Budget No:code*, Financial Year:date*, Department:ref, Cost Center:ref, Account:ref, Budget Amount:money, Committed:money, Actual:money, Available:text, Variance %:pct, Control Mode:enum, Status:status |
| 15 | `fin-trial` | Trial Balance | renderModule() | Trial Balance · Opening Balance · Debit Movement · Credit Movement · Closing Balance · Exception Review | Account Code:code*, Account Name:qty*, Opening Debit:money, Opening Credit:money, Period Debit:date*, Period Credit:date, Closing Debit:money, Closing Credit:money, Variance:money, Status:status |
| 16 | `fin-pnl` | Profit & Loss | renderModule() | Profit & Loss · Revenue Breakdown · COGS & Gross Margin · Operating Expenses · EBITDA & Net Profit · Period Comparison | Line Code:code*, Particulars:text, Current Month:date*, YTD:money, Prior Year YTD:money, Budget YTD:money, Variance:money, Variance %:pct, Status:status |
| 17 | `fin-bs` | Balance Sheet | renderModule() | Balance Sheet · Assets · Liabilities · Equity · Working Capital · Period Comparison | Line Code:code*, Particulars:text, Current Period:date*, Prior Period:date, Movement:money, Category:enum, Status:status |
| 18 | `fin-cashflow` | Cash Flow | renderModule() | Cash Flow · Operating Activities · Investing Activities · Financing Activities · Cash Forecast · Variance | Line Code:code*, Cash Flow Category:money, Current Month:date*, YTD:money, Prior YTD:money, Forecast:money, Variance:money, Status:status |
| 19 | `fin-ageing` | AR/AP Ageing | renderModule() | Ageing Summary · Receivable Buckets · Payable Buckets · Top Overdue Accounts · Collection Priority · Ageing Trend | Party Code:code*, Party Name:ref*, Type:enum, Current:money, 1 30 Days:qty, 31 60 Days:qty, 61 90 Days:qty, 90 Plus:money, Total Outstanding:money, Owner:ref, Status:status |


**Double-entry core [ADD — typed tables].**
* `accounts` (tree), `journal_entries`, `journal_lines(account, debit, credit, cost_center, profit_center, party)`, `fiscal_periods`.
* The constraint **Σ debit = Σ credit per entry** is enforced by a DB constraint trigger and the service.
* Posted entries are immutable. Corrections are made by reversal (`Reversal Entries` tab).
* `fin-gl` and the cash/bank books, trial balance, P&L, BS and cash flow are **reports/views** over `journal_lines`. They are not data-entry tables, even though the prototype shows Add/Edit/Delete on them. Their add/edit/delete buttons render disabled with the tooltip "Report — post a voucher instead" (decision D-07).

**Rules and formulas.**
* **COA:** Account Type (Asset/Liability/Equity/Income/Expense). Normal Balance comes from the type. `Posting Allowed` = leaf only. An account with entries cannot be deleted or have its type changed. A seed Indian COA (Schedule III-aligned groups) is provided.
* **Journal:** `Debit Total = Credit Total` or the save fails. Needs approval above the matrix threshold. Posting date must be in an open period of an open FY (`admin-fy.Posting From/To`).
* **Cash book:** `Balance = Opening + Σ Cash In − Σ Cash Out`. A negative cash balance is blocked. Cash payments above ₹10,000 to one person per day are warned (Income-tax disallowance rule; ref s.40A(3) of the 1961 Act / its 2025-Act equivalent).
* **Bank book:** Clearing Status `Uncleared → Cleared` (set by reconciliation).
* **Bank reconciliation:**
  * import a statement (CSV/XLSX; parsing an MT940 file is optional later);
  * auto-match on amount + date ±3 days + reference/UTR;
  * `Difference = Bank Balance − (ERP Balance ± unmatched items)`, and it must be 0 to mark Reconciled.
* **AP/AR:** derived from invoices − payments. `Age Days = today − Due Date`.
* **Ageing buckets:** Current, 1–30, 31–60, 61–90, 90+ (identical to `fin-ageing` fields).
* **Credit/Debit Notes:** reference the original invoice; GST adjustment at the original rate. They feed GSTR-1 (CDNR) and the purchase register.
* **Cost/Profit centers:** `Available = Budget − Committed − Actual`. `Contribution = Revenue − Direct Cost − Allocated Cost`; `Margin % = Contribution/Revenue × 100`.
* **Expenses:** checked against policy limits per category/grade (`Policy Result` = Within/Exceeded). Paid through AP.
* **Budget:** Control Mode is Ignore / Warn / Stop, applied at PR, PO and journal posting.
* **Trial balance:** Closing = Opening + Period Dr − Period Cr. `Variance` must be 0 (Σ Dr = Σ Cr). Any non-zero value shows a red banner.
* **P&L / BS / Cash Flow:** mapped through report-line → account-group mapping. Cash flow uses the indirect method from P&L + working-capital movements. BS check: Assets = Liabilities + Equity.
* **Period close:** lock a month; year-end closing entry moves P&L to Retained Earnings.

**KPIs.** Cash + bank, AR, AP, DSO, DPO, net profit MTD/YTD, budget variance %, unreconciled bank items.

**Market comparison.** ERPNext (immutable GL, period closing voucher), Tally (vouchers, groups, bank reco), Zoho Books (bank feeds, auto-match rules) and Akaunting (simple double entry). **Add:** bank-rule auto-categorisation, recurring journals, multi-currency revaluation, the TDS receivable (Form 26AS / AIS) reconciliation view.

**Careless-user risks.**
* Posting to a closed period → 409 error "Period locked".
* Deleting a posted voucher → impossible; reversal only.
* Unbalanced journal from rounding → the UI shows the live difference and Save stays disabled.
* Two people reconcile the same line → optimistic lock.

---

## 4.11 Indian Taxation (10 pages)
**Users:** Finance. Owner: Finance.

**Pages (10) — generated from index.html registry.** Legend: `Field:type`, `*` = required. "Renderer" = page-level function in index.html.

| # | Page id | Title | Renderer | Profile tabs (6) | Fields |
|---|---|---|---|---|---|
| 1 | `tax-gst` | GST Setup | renderModule() | GST Configuration · GSTIN Registrations · Tax Rates · Place of Supply · Reverse Charge · GST Validation | GSTIN:gstin*, Legal Name:text*, State:enum, Registration Type:enum, Effective Date:date*, Default Tax Scheme:ref, E Invoice Enabled:bool, E Way Enabled:bool, Status:status |
| 2 | `tax-gstr1` | GSTR-1 | renderModule() | GSTR 1 Workspace · B2B Invoices · B2C Supplies · Credit Debit Notes · HSN Summary · Return Validation | Return Period:date*, GSTIN:gstin, B2B Taxable:money, B2C Taxable:money, Exports:text, Credit Notes:money, Tax Liability:money, Document Count:qty, Validation Errors:date*, Filing Status:status |
| 3 | `tax-gstr3b` | GSTR-3B | renderModule() | GSTR 3B Workspace · Outward Tax Liability · Eligible ITC · Ineligible ITC · Tax Payment · Return Reconciliation | Return Period:date*, GSTIN:gstin, Outward Tax:text, Reverse Charge:text, Eligible ITC:money, Ineligible ITC:money, Net Tax Payable:money, Cash Paid:money, Credit Utilized:money, Filing Status:status |
| 4 | `tax-tds` | TDS | renderModule() | TDS Register · Section Mapping · Deduction Entries · Challan Allocation · Return Preparation · TDS Compliance | TDS Entry No:code*, Section:text, Deductee:ref, PAN:pan, Payment Date:date*, Amount Paid:money, Rate %:pct, TDS Amount:money, Challan Ref:ref, Return Quarter:text, Status:status |
| 5 | `tax-tcs` | TCS | renderModule() | TCS Register · Section Mapping · Collection Entries · Challan Allocation · Return Preparation · TCS Compliance | TCS Entry No:code*, Section:text, Collectee:ref, PAN:pan, Receipt Date:date*, Amount:money, Rate %:pct, TCS Amount:money, Challan Ref:ref, Return Quarter:text, Status:status |
| 6 | `tax-hsn` | HSN / SAC | renderModule() | HSN SAC Master · Rate Mapping · Item Service Mapping · Usage Validation · HSN Summary · Compliance Checks | HSN SAC:hsn*, Description:longtext, Goods Service:text, GST Rate:money, Cess Rate:money, UQC:text, Effective From:date*, Effective To:date, Usage Count:qty, Status:status |
| 7 | `tax-einvoice` | E-Invoice | renderModule() | E Invoice Queue · IRN Generation · QR Code · Cancellation · Error Queue · IRP Reconciliation | Invoice No:code*, Customer GSTIN:gstin*, Invoice Date:date*, Taxable Value:money, GST:money, IRN:text, Ack No:text, Ack Date:date, QR Status:status, Cancellation Status:status, Error:text, Status:status |
| 8 | `tax-eway` | E-Way Bill | renderModule() | E Way Bill Queue · Part A Details · Vehicle Part B · Validity & Distance · Extension Cancellation · EWB Exceptions | EWB No:code*, Document No:text, Document Date:date*, From GSTIN:gstin, To GSTIN:gstin, Transporter:ref, Vehicle:ref, Distance KM:qty, Valid Until:date, Part B Status:status, Status:status |
| 9 | `tax-salesreg` | Sales Register | renderModule() | Sales Register · Invoice Detail · Tax Summary · Customer GSTIN · Document Type · GST Reconciliation | Invoice No:code*, Date:date*, Customer:ref*, GSTIN:gstin, Document Type:enum, Taxable:money, CGST:money, SGST:money, IGST:money, Total:money, IRN:text, Status:status |
| 10 | `tax-purchasereg` | Purchase Register | renderModule() | Purchase Register · Vendor Invoice Detail · ITC Eligibility · Vendor GSTIN · 2B Match Status · GST Reconciliation | Vendor Invoice:ref*, Date:date*, Vendor:ref*, GSTIN:gstin, Taxable:money, CGST:money, SGST:money, IGST:money, ITC Eligible:money, 2B Match:text, Difference:money, Status:status |


**Rules (verified; see Appendix C):**
* **GST setup:** one row per GSTIN. The state code is the first 2 digits. Registration Type is Regular/Composition/SEZ/ISD. Place of supply decides the IGST vs. CGST+SGST split.
* **Rates:** from 22 Sep 2025 the main slabs are 5% and 18%, plus 40% for specified demerit goods (56th GST Council). Older documents keep the rate in force on their date (`tax-hsn` and `admin-taxes` carry `Effective From/To`).
* **HSN:** 4 digits are required for AATO ≤ ₹5 Cr and 6 digits above (Notification 78/2020). The HSN summary in GSTR-1 is built from invoice lines.
* **GSTR-1** (due 11th monthly; QRMP quarterly 13th, with IFF):
  * B2B, B2CL, B2CS, exports, CDNR, HSN and document summary are built from posted sales invoices and credit notes;
  * `Validation Errors` count GSTIN format, POS, HSN and rate mismatches;
  * the output is the GSTN offline-tool JSON for upload.
  * From the July 2025 period, GSTR-3B liability auto-populates from GSTR-1/1A and is not editable, so GSTR-1 must be right first. GSTR-1A is the correction route.
* **GSTR-3B** (due 20th monthly; 22nd/24th for QRMP):
  * outward tax from GSTR-1 data;
  * ITC from the purchase register with eligibility flags and 2B match;
  * `Net Tax Payable = Outward Tax + RCM − Eligible ITC utilised` (utilisation order: IGST credit first against IGST, then CGST/SGST as per rules 88A);
  * `Cash Paid = Net Tax Payable − Credit Utilised`.
* **TDS/TCS:**
  * Deductee/collectee master with PAN. Without a PAN the higher rate applies (old s.206AA / 206CC).
  * Section master holds rate and threshold per FY with the Act version (1961 for transactions before 1 Apr 2026, 2025 Act sections 392/393 after).
  * Quarterly return grouping (24Q salary, 26Q non-salary, 27EQ TCS) and challan linkage.
  * TCS on sale of goods (old 206C(1H)) is **not applicable from 1 Apr 2025**. Keep specified-goods TCS (scrap etc.).
* **E-invoice:** applicable when AATO > ₹5 Cr in any FY since 2017-18.
  * Build the IRP JSON (INV-01 schema) and store IRN, Ack No/Date and signed QR.
  * Cancellation within 24 h on the IRP.
  * ≥ ₹10 Cr AATO: report within 30 days.
  * **v1 does not call the IRP.** We generate JSON and accept a manual IRN entry. An IRP/GSP adapter interface is provided for later.
* **E-way bill:** required above ₹50,000 consignment value (state rules may differ for intra-state).
  * Part A comes from the invoice/delivery; Part B is vehicle details.
  * `Valid Until` is computed from distance (1 day per 200 km for normal cargo, 20 km for ODC, per Rule 138(10)). The slab table is held as configurable data because sources conflict; verify against the CBIC text in Phase 12.
  * Extension and cancellation (within 24 h). Same "JSON + manual number" approach as e-invoice.
* **Sales/Purchase registers:** views over posted documents.
  * `2B Match` compares the purchase register with an uploaded GSTR-2B JSON: Matched / Mismatch (value/date/GSTIN) / Missing in 2B / Missing in books.
  * `Difference = books − 2B tax`.

**KPIs.** Output tax, ITC available vs. claimed, 2B mismatches, returns due in the next 7 days, invoices without IRN, e-way bills expiring today.

**Market comparison.** Tally (GSTR JSON, reconciliation), Zoho Books (direct GSTN filing via GSP), ERPNext India Compliance app (e-invoice/e-waybill through GSP, 2B reconciliation; open source, studied for ideas only). **Add:** 2B reconciliation, rate-change effective dating, IRN 30-day warning. Direct portal filing is **out of scope** (§14).

**Careless-user risks.**
* An invoice dated in a filed period → blocked (period marked `Filed`).
* HSN with the wrong digit count → validation error.
* Switching from IGST to CGST after posting → locked.

---

## 4.12 HRMS (12 pages)
**Users:** HR. Owner: HR. Every employee gets **[ADD]** ESS self-service through `hr-ess`.

**index.html facts.**
* `hr-employees` has a photo column (base64 in the row) and a photo upload in the Add form.
* The Virtual Employee ID card renderer (`hrTab`, CSS `.id-card`) **exists but no tab reaches it** (verified with Playwright; `hrTab` is only called from the overridden V7/V8 `renderTab`). The only ID output is `rowPDF` titled "EMPLOYEE INFORMATION / ID", a text-only list.
* The hr-employees profile lacks fields that `hrTab` reads (Blood Group, Weekly Off, Confirmation Date, CTC, Salary Date).
* The tab label "Documents" appears **twice** (a profile tab plus the universal tab). This also happens on `maint-machines`.

**Pages (12) — generated from index.html registry.** Legend: `Field:type`, `*` = required. "Renderer" = page-level function in index.html.

| # | Page id | Title | Renderer | Profile tabs (6) | Fields |
|---|---|---|---|---|---|
| 1 | `hr-employees` | Employee Master | renderModule() | Employee Directory · Employment Profile · Personal & Statutory · Organization Assignment · Documents · Employee Lifecycle | Employee ID:code*, Employee Name:ref*, Department:ref, Designation:text, Manager:ref, Employment Type:enum, Joining Date:date*, Work Location:text, Mobile:phone, Email:email, PAN:pan, Aadhaar:aadhaar, UAN:uan, ESIC IP:text, Shift:ref, Status:status |
| 2 | `hr-recruitment` | Recruitment | renderModule() | Job Requisitions · Candidate Pipeline · Interviews · Offers · Joining Forecast · Recruitment Analytics | Requisition No:code*, Job Title:text, Department:ref, Openings:qty, Hiring Manager:ref, Candidate:date*, Stage:enum, Source:enum, Interview Date:date, Offer CTC:money, Expected Join:text, Status:status |
| 3 | `hr-onboarding` | Onboarding | renderModule() | Onboarding Queue · Document Collection · Joining Checklist · IT Asset Allocation · Induction · Probation Tracking | Onboarding ID:code*, Employee Candidate:date*, Joining Date:date, Department:ref, Documents %:pct, Background Check:text, Laptop Asset:ref, Email Created:email, Induction:text, Probation End:text, Owner:ref, Status:status |
| 4 | `hr-attendance` | Attendance | renderModule() | Daily Attendance · Monthly Calendar · Late Early & Overtime · Geo Device Logs · Regularization · Attendance Analytics | Date:date*, Employee ID:ref*, Employee:ref, Shift:ref, Punch In:datetime, Punch Out:datetime, Work Hours:qty, Late Min:qty, Early Min:qty, Overtime Hrs:qty, Mode:enum, Location:text, Regularization:text, Status:status |
| 5 | `hr-shifts` | Shift Management | renderModule() | Shift Master · Shift Rosters · Rotation Rules · Night Shift · Weekly Off & Holiday · Coverage Analysis | Shift Code:code*, Shift Name:text*, Start Time:datetime, End Time:datetime, Break Min:qty, Grace Min:qty, Min Hours:qty, Overtime Rule:datetime, Night Shift:bool, Weekly Off Pattern:text, Status:status |
| 6 | `hr-leave` | Leave Management | renderModule() | Leave Requests · Leave Balances · Approval Queue · Leave Calendar · Policy Rules · Leave Analytics | Leave Request No:code*, Employee:ref*, Leave Type:ref, From Date:date*, To Date:date, Days:qty, Reason:longtext, Balance Before:money, Balance After:money, Approver:ref, Decision:enum, Status:status |
| 7 | `hr-expense` | Employee Expenses | renderModule() | Expense Claims · Receipts & Categories · Policy Validation · Approval Queue · Payment Link · Expense Analytics | Claim No:code*, Employee:ref*, Date:date*, Category:enum, Purpose:longtext, Amount:money, GST:money, Receipt:text, Policy Limit:money, Approver:ref, Payment Status:status, Status:status |
| 8 | `hr-performance` | Performance | renderModule() | Performance Cycles · Goals & KRAs · Check Ins · Ratings · Calibration · Performance Analytics | Cycle:date*, Employee:ref*, Department:ref, Goal Score:pct, Competency Score:pct, Manager Rating:pct, Calibration Rating:pct, Final Rating:pct, Promotion Potential:text, Status:status |
| 9 | `hr-training` | Training | renderModule() | Training Calendar · Programs · Participants · Assessments · Certificates · Training Effectiveness | Training ID:code*, Program:text, Provider:enum, Start Date:date*, End Date:date, Participants:qty, Cost:money, Assessment Score:pct, Certificate:text, Effectiveness:date, Status:status |
| 10 | `hr-documents` | Employee Documents | renderModule() | Employee Documents · Expiry Tracker · Verification · Access Control · Acknowledgements · Document Compliance | Document ID:code*, Employee:ref*, Document Type:enum, Document No:text, Issue Date:date*, Expiry Date:date, Verified:bool, Verified By:bool, File:text, Status:status |
| 11 | `hr-exit` | Exit Management | renderModule() | Exit Cases · Resignation Approval · Clearance Checklist · Final Settlement · Exit Interview · Attrition Analytics | Exit Case No:code*, Employee:ref*, Resignation Date:date*, Last Working Date:date, Reason:longtext, Manager Approval:ref, Clearance %:pct, Asset Return:bool, Final Settlement:money, Exit Interview:text, Status:status |
| 12 | `hr-ess` | Employee Self Service | renderModule() | My Profile · My Attendance · My Leave · My Payslips · My Expenses · HR Requests | Request No:code*, Employee:ref*, Request Type:enum, Request Date:date*, Subject:longtext, Details:longtext, Assigned HR:ref, Response Due:date, Resolution:text, Status:status |


**Rules.**
* **Employee:**
  * `Employee ID` comes from a series;
  * PAN, Aadhaar (masked, last 4 shown, full value encrypted at rest), UAN (12 digits) and ESIC IP (10 digits) are validated;
  * Manager must be an active employee with no cycle;
  * Joining Date ≤ today + 90 days.
  * **[ADD]** fields needed by the ID card and payroll: Blood Group, Weekly Off, Confirmation Date, Date of Birth, Gender, Bank (A/c, IFSC), PT State, Tax Regime, Salary Structure.
  * The **Virtual ID card** is restored as a tab ("ID Card") and as a PDF with photo + QR.
* **Recruitment:** stages `Applied → Screening → Interview → Offer → Hired | Rejected`. Hired → creates an Onboarding record.
* **Onboarding:** checklist. `Documents %` = verified docs / required docs.
* **Attendance:**
  * `Work Hours = Punch Out − Punch In − break`;
  * `Late Min = max(0, Punch In − (shift start + grace))`;
  * `Early Min = max(0, shift end − Punch Out)`;
  * `Overtime Hrs = max(0, Work Hours − shift min hours)` (subject to approval);
  * status Present / Half Day (< Min Hours/2… configurable) / Absent / On Leave / Holiday / Weekly Off.
  * Regularisation requests go through approval.
  * Night shift spans midnight (end < start → +1 day).
* **Leave:**
  * `Days` excludes weekly offs and holidays (configurable sandwich rule);
  * `Balance After = Balance Before − Days`, which cannot go negative unless the leave type allows LWP;
  * no overlap with other leave;
  * accrual monthly by policy, carry-forward cap at year-end.
* **Expenses:** `Amount ≤ Policy Limit`, otherwise approval. A receipt is required above ₹N. Paid through payroll or AP.
* **Performance:** `Final Rating` = weighted Goal + Competency, after calibration.
* **Training:** effectiveness after 30/60/90 days.
* **Employee Documents:** expiry alerts at 30/15/7 days.
* **Exit:** `Last Working Date = Resignation Date + notice period` (shortfall recovered in F&F). `Clearance %` = cleared departments / total. Final settlement goes to payroll F&F. Assets are returned through `asset-allocation`.
* **ESS:** employees see only their own records (row-level scope `self`).

**KPIs.** Headcount, attendance % today, late %, open positions, time-to-hire, attrition %, leave pending, document expiries.

**Market comparison.** ERPNext HRMS (Frappe HR: attendance, leave policy, shift types, check-ins), Zoho People, greytHR and Keka (Indian-market favourites for ESS/attendance). **Add:** geo/biometric import (CSV/device API later), holiday lists per branch, ESS mobile view, and the ID card restored.

**Careless-user risks.**
* Leave overlapping an approved leave → blocked.
* Punch Out before Punch In without the night-shift flag → error.
* Deleting an employee with payroll → blocked; status Exited instead.

---

## 4.13 Payroll (12 pages)
**Users:** HR (and Finance read for postings). Owner: HR.

**index.html facts.**
* `pay-payslip` is overridden by V9.2: 37 fields, its own 6 tabs drawn by `v92PayslipTab`, a payslip preview card, and a vector **Payslip PDF** (letterhead, employee block, earnings/deductions table, employer contributions, net pay in words, signatory, "Page 1 / 1").
* The 25 seeded payslips use:
  * PF 12% × min(Basic, 15000);
  * ESIC 0.75% / 3.25% if Gross ≤ 21000;
  * PT flat 200;
  * TDS as a crude % of gross;
  * Gratuity 4.81% of Basic.
* The PDF writes "INR" because `pdfEsc` strips non-ASCII, so the ₹ sign is lost.
* `v9Payroll` (other payroll tabs) shows synthetic rows ("Employee 1…20").

**Pages (12) — generated from index.html registry.** Legend: `Field:type`, `*` = required. "Renderer" = page-level function in index.html.

| # | Page id | Title | Renderer | Profile tabs (6) | Fields |
|---|---|---|---|---|---|
| 1 | `pay-structure` | Salary Structure | renderModule() | Salary Structure Master · Earnings Components · Deduction Components · Statutory Mapping · CTC Simulation · Structure Revision | Structure Code:code*, Structure Name:ref*, Grade:ref, Basic %:pct, HRA %:pct, Allowances:money, Employer PF:money, Employer ESIC:money, Variable Pay:text, Effective From:date*, Status:status |
| 2 | `pay-processing` | Payroll Processing | renderModule() | Payroll Run · Attendance Inputs · Earnings Deductions · Statutory Calculation · Validation & Lock · Payroll Summary | Payroll Month:date*, Employee ID:ref*, Employee:ref, Paid Days:qty, Gross Salary:money, PF:money, ESIC:money, PT:money, TDS:money, Loan:money, Overtime:money, Bonus:money, Other Deduction:money, Net Salary:money, Status:status |
| 3 | `pay-overtime` | Overtime | renderModule() | Overtime Register · Eligible Hours · Rate Rules · Approval Queue · Payroll Transfer · OT Analytics | OT No:code*, Employee:ref*, Date:date*, Shift:ref, Eligible Hours:qty, Approved Hours:qty, Rate Type:enum, OT Rate:money, OT Amount:money, Approver:ref, Payroll Month:date, Status:status |
| 4 | `pay-incentive` | Incentives / Bonus | renderModule() | Incentive Register · Scheme Rules · Target Achievement · Approval · Payroll Transfer · Incentive Analytics | Incentive No:code*, Employee:ref*, Scheme:ref, Period:date*, Target:text, Achievement %:pct, Calculated Amount:money, Approved Amount:money, Approver:ref, Payroll Month:date, Status:status |
| 5 | `pay-loan` | Loans / Advances | renderModule() | Loan Register · Disbursement · EMI Schedule · Recovery · Foreclosure · Outstanding Analysis | Loan No:code*, Employee:ref*, Loan Type:money, Disbursement Date:date*, Principal:money, Interest:money, EMI:money, Paid EMIs:money, Outstanding:money, Next Recovery:text, Status:status |
| 6 | `pay-pf` | PF | renderModule() | PF Workspace · UAN Mapping · Employee Contribution · Employer Contribution · ECR Validation · PF Compliance | Payroll Month:date*, Employee:ref*, UAN:uan, PF Wage:money, Employee PF:money, Employer EPF:text, Employer EPS:text, VPF:money, ECR Status:status, Status:status |
| 7 | `pay-esic` | ESIC | renderModule() | ESIC Workspace · IP Mapping · Contribution Calculation · Eligibility · Challan Preparation · ESIC Compliance | Payroll Month:date*, Employee:ref*, IP Number:text, ESIC Wage:text, Employee ESIC:money, Employer ESIC:money, Eligibility:enum, Challan Status:status, Status:status |
| 8 | `pay-pt` | Professional Tax | renderModule() | Professional Tax · State Slabs · Employee Liability · Monthly Summary · Challan · PT Compliance | Payroll Month:date*, Employee:ref*, State:enum, Gross Wage:money, PT Slab:text, PT Amount:money, Challan Batch:text, Status:status |
| 9 | `pay-tds` | Payroll TDS | renderModule() | Payroll TDS · Tax Regime · Declarations · Taxable Income · Monthly Deduction · Form 16 Summary | Payroll Month:date*, Employee:ref*, PAN:pan, Tax Regime:enum, Projected Income:ref, Deductions:money, Taxable Income:money, Annual Tax:text, TDS Till Date:date*, Current TDS:text, Status:status |
| 10 | `pay-payslip` | Payslips | renderModule() | Payslip Register · Earnings Breakdown · Deductions Breakdown · Employer Contribution · Payment & Distribution · Payslip Audit | Payroll Month:date*, Employee ID:ref*, Employee:ref, Department:ref, Designation:text, Joining Date:date*, PAN:pan, PF UAN:uan, ESIC No:text, Bank Name:ref*, Bank Account:ref, Paid Days:qty, Basic:money, HRA:money, Special Allowance:money, Conveyance:money, Overtime:money, Bonus:money, Other Earnings:money, Gross:money, PF:money, ESIC:money, Professional Tax:money, TDS:money, Loan Deduction:money, Other Deduction:money, Total Deductions:money, Net Pay:money, Employer PF:money, Employer ESIC:money, Gratuity:money, CTC:money, Payment Mode:enum, Payment Date:date, Email Status:status, Download Count:qty, Status:status |
| 11 | `pay-bank` | Bank Transfer File | renderModule() | Bank Transfer Batches · Salary Accounts · Payment File · Validation Errors · Bank Acknowledgement · Payment Reconciliation | Batch No:code*, Payroll Month:date*, Bank:ref, Employee Count:qty*, Gross Transfer:money, File Format:enum, Generated At:datetime, Uploaded At:datetime, Bank Ack:text, Failed Count:qty, Status:status |
| 12 | `pay-register` | Salary Register | renderModule() | Salary Register · Department Summary · Employee Breakdown · Statutory Deductions · Cost Center Split · Payroll Trend | Payroll Month:date*, Department:ref, Employee Count:qty*, Gross Salary:money, Employee Deductions:money, Employer Contributions:money, Net Salary:money, Overtime:money, Bonus:money, Status:status |


**Payroll engine [ADD — typed tables] rules (see sources).**
* **Salary structure** components:
  * Basic, HRA, Special, Conveyance…;
  * formula engine with variables `CTC, BASIC, GROSS, PAID_DAYS, DAYS_IN_MONTH`;
  * **Code on Wages 2019 (in force 21 Nov 2025):** excluded allowances above 50% of total remuneration are added back to "wages". The structure editor warns when Basic + DA + retaining allowance < 50%.
* **Paid days** = days in month − LWP − absent (from attendance/leave). `Earned component = monthly × Paid Days / Days in month`.
* **PF:**
  * PF wage = Basic + DA (capped at ₹15,000 unless the "PF on actual" option is set);
  * employee 12%;
  * employer 12% split as EPS 8.33% of min(wage, 15,000) (so max ₹1,250) and EPF = 12% − EPS;
  * EDLI 0.5% (wage capped at 15,000) and admin 0.5% are employer cost;
  * VPF optional.
  * The ECR text file follows the EPFO format.
  * *Unverified claim of a wage-ceiling raise to ₹25,000*: the ceiling is a **configurable dated parameter**, with no hard-coding.
* **ESIC:**
  * eligible if gross ≤ ₹21,000 (₹25,000 for PwD) at the start of the contribution period. Eligibility then holds for the whole period (Apr–Sep, Oct–Mar) even if wages rise;
  * employee 0.75%, employer 3.25%;
  * employee share exempt if average daily wage ≤ ₹176.
* **Professional Tax:** a state slab table. Maharashtra:
  * men > ₹10,000: ₹200/month, ₹300 in February, ₹2,500/year cap;
  * women ≤ ₹25,000 exempt (from 1 Apr 2023);
  * other states are configurable.
* **TDS on salary:** projected annual income − exemptions/deductions per regime (new/old) → slab tax + cess (4%) − rebate.
  * `Current TDS = (Annual Tax − TDS till date) / remaining months`.
  * Section 192 (1961 Act) until 31 Mar 2026, **section 392 of the Income-tax Act 2025** from 1 Apr 2026.
  * Slabs are configurable data per FY.
* **Overtime:** `OT Amount = Approved Hours × OT Rate`. The Factories Act default is 2× the ordinary hourly rate = (Basic+DA)/(26×8), configurable.
* **Loans:** `EMI = P·r(1+r)ⁿ/((1+r)ⁿ−1)`. Recovered in payroll; `Outstanding` reduces.
* **Processing:** `Draft → Calculated → Verified → Approved → Locked → Paid`.
  * Locked months cannot be recalculated.
  * Arrears are computed in a later month.
  * `Net = Gross − (PF + ESIC + PT + TDS + Loan + Other)`.
  * Negative net → blocked with an error.
* **Payslip:** generated from the locked payroll. The PDF uses an embedded Unicode font (₹ and Hindi). Email distribution is logged in `Email Status`; downloads are counted.
* **Bank transfer file:** bank-specific CSV/XLSX template, `Gross Transfer = Σ Net Pay` of the selected employees. The status is updated from the bank acknowledgement upload.
* **Salary register / postings:** journal Dr Salary Expense (by cost center), Dr Employer contributions, Cr Salary Payable, Cr PF/ESIC/PT/TDS payable.

**KPIs.** Gross, deductions, net, employer cost, headcount paid, statutory dues by due date (PF/ESIC by the 15th, TDS by the 7th, PT per state).

**Market comparison.** greytHR, Keka, Zoho Payroll (strong Indian statutory compliance) and ERPNext Payroll (salary structure formulas; India payroll docs). Tally Payroll is basic. **Add:** arrears, F&F settlement, Form 16 data export, payroll lock with variance report vs. the previous month (±10% flag).

**Careless-user risks.**
* Running payroll twice for the same month → unique (company, month, employee).
* Editing Gross on a payslip → impossible; recalculate from the structure.
* Changing a structure mid-month → effective-dated, so proration is applied.

---

## 4.14 Projects (11 pages)
**Users:** Projects. Owner: Projects. `proj-kanban` → `kanbanPage()` (static lanes, generic fields). `proj-gantt` tabs are drawn by `v9Project`, a 12-week fake grid.

**Pages (11) — generated from index.html registry.** Legend: `Field:type`, `*` = required. "Renderer" = page-level function in index.html.

| # | Page id | Title | Renderer | Profile tabs (6) | Fields |
|---|---|---|---|---|---|
| 1 | `proj-projects` | Projects | renderModule() | Project Register · Scope & Milestones · Team & Roles · Budget & Cost · Risks & Issues · Project Health | Project Code:code*, Project Name:ref*, Customer:ref, Project Manager:ref, Start Date:date*, End Date:date, Budget:money, Committed Cost:money, Actual Cost:money, Progress %:pct, Health:enum, Status:status |
| 2 | `proj-tasks` | Tasks | renderModule() | Task Register · Priority Board · Dependencies · Assignees · Time Tracking · Task Analytics | Task No:code*, Project:ref*, Task:ref, Owner:ref, Priority:money, Start Date:date*, Due Date:date, Estimated Hrs:qty, Actual Hrs:qty, Dependency:text, Progress %:pct, Status:status |
| 3 | `proj-subtasks` | Subtasks | renderModule() | Subtask Register · Parent Task · Dependencies · Assignees · Completion Evidence · Subtask Progress | Subtask No:code*, Parent Task:ref, Subtask:text, Owner:ref, Due Date:date*, Estimated Hrs:qty, Actual Hrs:qty, Dependency:text, Evidence:text, Progress %:pct, Status:status |
| 4 | `proj-milestones` | Milestones | renderModule() | Milestone Plan · Deliverables · Acceptance Criteria · Dependencies · Status Review · Milestone Variance | Milestone No:code*, Project:ref*, Milestone:text, Target Date:date*, Actual Date:date, Acceptance Criteria:longtext, Owner:ref, Dependency:text, Progress %:pct, Status:status |
| 5 | `proj-team` | Team Assignment | renderModule() | Team Allocation · Role Matrix · Availability · Utilization · Skills · Resource Forecast | Project:ref*, Employee:ref*, Role:text, Allocation %:pct, From Date:date*, To Date:date, Billable:bool, Hourly Cost:money, Availability %:pct, Status:status |
| 6 | `proj-timesheets` | Timesheets | renderModule() | Timesheet Register · Daily Entries · Approval Queue · Billable Hours · Project Allocation · Utilization Analytics | Timesheet No:code*, Employee:ref*, Project:ref, Task:ref, Date:date*, Hours:qty, Billable Hours:qty, Description:longtext, Approver:ref, Approval Status:status, Status:status |
| 7 | `proj-expenses` | Project Expenses | renderModule() | Project Expense Register · Cost Category · Budget Check · Approval · Client Billable · Expense Variance | Expense No:code*, Project:ref*, Date:date*, Category:enum, Vendor Employee:ref, Amount:money, Billable:bool, Budget Head:ref, Approver:ref, Status:status |
| 8 | `proj-budget` | Project Budget | renderModule() | Project Budget · Budget Lines · Committed Cost · Actual Cost · Estimate to Complete · Cost Variance | Budget Line:money*, Project:ref*, Cost Category:money, Budget:money, Committed:money, Actual:money, Estimate to Complete:money, Estimate at Completion:money, Variance:money, Status:status |
| 9 | `proj-kanban` | Kanban | kanbanPage() | Kanban Workspace · Kanban Details · Kanban Workflow · Kanban Exceptions · Kanban Performance · Kanban Controls *(profile defined but ignored by the custom renderer; rebuild uses it)* | Record No:code*, Project:ref*, Task Milestone:text, Owner:ref, Start Date:date*, Due Date:date, Budget Hrs:qty, Actual Hrs:qty, Progress %:pct, Status:status |
| 10 | `proj-gantt` | Gantt / Timeline | renderModule() | Gantt Plan · Task Timeline · Dependencies · Critical Path · Baseline Variance · Schedule Forecast | Task:ref*, Project:ref*, Start Date:date*, End Date:date, Duration Days:qty, Dependency:text, Baseline Start:text, Baseline End:text, Variance Days:qty, Critical:bool, Progress %:pct, Status:status |
| 11 | `proj-profitability` | Project Profitability | renderModule() | Profitability Summary · Revenue · Direct Cost · Resource Cost · Contribution Margin · Project Ranking | Project:ref*, Customer:ref*, Revenue:money, Labor Cost:money, Material Cost:money, Expense Cost:money, Other Cost:money, Contribution:money, Margin %:pct, Rank:qty, Status:status |


**Rules.**
* Hierarchy: project → task → subtask; milestones; dependencies FS/SS with lag; no cycles.
* Progress % rolls up, weighted by estimated hours.
* `Health`: Green if SPI ≥ 0.95 and CPI ≥ 0.95, Amber ≥ 0.85, otherwise Red. Here
  * `SPI = EV/PV`, `CPI = EV/AC`;
  * `EV = Budget × Progress%`;
  * `AC = Actual Cost` (timesheets × hourly cost + expenses + material).
* **Budget:** `Estimate at Completion = Actual + Estimate to Complete`; `Variance = Budget − EAC`.
* **Team:** Σ Allocation % per employee per date ≤ 100 (warn above).
* **Timesheets:** hours per day ≤ 24, and ≤ 12 without a warning; only on tasks the employee is assigned to; approved timesheets are locked. Billable hours ≤ hours.
* **Gantt:** computed from tasks.
  * Critical path by forward/backward pass, so `Critical` = total float 0.
  * `Variance Days = End − Baseline End`.
  * Baselines are set at approval.
* **Profitability:** `Contribution = Revenue − (Labor + Material + Expense + Other)`; Margin %. Revenue comes from linked sales invoices.

**KPIs.** Active projects, at-risk count (Red), budget burn %, utilisation %, billable %, overdue tasks/milestones.

**Market comparison.** ERPNext Projects (timesheets → billing, Gantt) and Odoo Project/Timesheets. **Add:** drag-and-drop Kanban and Gantt, baselines, EV metrics, invoice from timesheets.

**Careless-user risks.**
* A dependency loop → error.
* A timesheet on a closed project → blocked.
* Deleting a task with timesheets → blocked.

---

## 4.15 Assets (8 pages)
**Users:** Maintenance, Projects and Service. Owner: Maintenance.

**Pages (8) — generated from index.html registry.** Legend: `Field:type`, `*` = required. "Renderer" = page-level function in index.html.

| # | Page id | Title | Renderer | Profile tabs (6) | Fields |
|---|---|---|---|---|---|
| 1 | `asset-master` | Asset Master | renderModule() | Asset Register · Classification · Location & Custodian · Financial Details · Documents & QR · Lifecycle Status | Asset ID:code*, Asset Name:ref*, Category:enum, Department:ref, Location:text, Custodian:ref, Purchase Date:date*, Supplier:ref, Purchase Cost:money, Capitalization Date:date, Useful Life Months:date, Book Value:money, QR Code:text, Status:status |
| 2 | `asset-capitalization` | Capitalization | renderModule() | Capitalization Queue · Purchase Link · Capitalization Date · Cost Components · GL Mapping · Capitalization Audit | Capitalization No:code*, Asset:ref*, Purchase Ref:ref, Capitalization Date:date*, Base Cost:money, Freight:money, Installation:text, Other Cost:money, Capitalized Value:money, GL Account:ref, Approver:ref, Status:status |
| 3 | `asset-allocation` | Allocation | renderModule() | Allocation Register · Employee Assignment · Department Location · Handover · Return · Allocation History | Allocation No:code*, Asset:ref*, Employee:ref, Department:ref, Location:text, Allocation Date:date*, Condition Out:longtext, Handover Doc:text, Return Due:date, Status:status |
| 4 | `asset-transfer` | Asset Transfer | renderModule() | Transfer Requests · Source Custodian · Destination Custodian · Approval · Physical Verification · Transfer History | Transfer No:code*, Asset:ref*, From Employee:ref, From Location:text, To Employee:ref, To Location:text, Request Date:date*, Transfer Date:date, Approver:ref, Condition:longtext, Status:status |
| 5 | `asset-maintenance` | Asset Maintenance | renderModule() | Asset Maintenance · Service Schedule · Work History · Service Cost · Warranty AMC Link · Asset Health | Service No:code*, Asset:ref*, Service Type:enum, Due Date:date*, Service Date:date, Vendor Technician:ref, Parts Cost:money, Labor Cost:money, Downtime Hrs:qty, Next Due:date, Status:status |
| 6 | `asset-depreciation` | Depreciation | renderModule() | Depreciation Run · Book Value · Useful Life · Method & Rate · Monthly Posting · Depreciation Forecast | Run No:code*, Period:date*, Asset:ref*, Opening Book Value:money, Depreciable Base:money, Method:enum, Rate:money, Depreciation:text, Closing Book Value:money, GL Posting:text, Status:status |
| 7 | `asset-disposal` | Asset Disposal | renderModule() | Disposal Register · Approval · Sale Scrap Value · Gain Loss · Asset Derecognition · Disposal Audit | Disposal No:code*, Asset:ref*, Request Date:date*, Disposal Method:enum, Sale Scrap Value:money, Book Value:money, Gain Loss:text, Buyer Vendor:ref, Approval:text, Posting Ref:ref, Status:status |
| 8 | `asset-qr` | Asset QR Codes | renderModule() | QR Registry · Label Generation · Print Queue · Scan History · Asset Verification · Invalid Scans | QR Code:code*, Asset ID:ref*, Asset Name:ref*, Label Template:text, Printed Date:date*, Printed By:ref, Last Scan:date, Scan Location:text, Verification Status:status, Status:status |


**Rules.**
* **Capitalization:** `Capitalized Value = Base + Freight + Installation + Other` (GST excluded when ITC is claimed). Posting: Dr Asset / Cr CWIP or Vendor.
* **Depreciation (Companies Act Schedule II):**
  * SLM: `(Cost − Residual)/Useful Life`, where residual ≤ 5% of cost by default.
  * WDV rate: `1 − (Residual/Cost)^(1/n)`.
  * Monthly run prorated by days in use.
  * **[ADD]** a parallel income-tax block depreciation report.
  * Run status `Draft → Posted`. A posted run creates a journal (Dr Depreciation / Cr Accumulated Depreciation).
  * `Closing Book Value = Opening − Depreciation`, which never goes below residual.
* **Allocation/Transfer:** one custodian at a time, with a handover document. A transfer needs the approval of both locations.
* **Disposal:** `Gain/Loss = Sale/Scrap Value − Book Value on disposal date`. Depreciation is charged up to the disposal date. Posting removes cost and accumulated depreciation.
* **QR:** a unique QR per asset encoding the URL `/m/asset-master/:id`. Scanning logs `Last Scan` and location (verification drive).

**KPIs.** Asset count and NBV, depreciation MTD, assets due service, unverified assets in the current drive.

**Market comparison.** ERPNext Assets (depreciation schedules, movement), Tally fixed-asset register (weak) and Zoho Books (simple). **Add:** physical verification drives through QR, component accounting (later).

**Careless-user risks.**
* Editing cost after depreciation was posted → blocked; use an adjustment.
* Disposing an allocated asset → it must be returned first.

---

## 4.16 Service / Support (9 pages)
**Users:** Sales, Projects and Service. Owner: Service.

**Pages (9) — generated from index.html registry.** Legend: `Field:type`, `*` = required. "Renderer" = page-level function in index.html.

| # | Page id | Title | Renderer | Profile tabs (6) | Fields |
|---|---|---|---|---|---|
| 1 | `service-tickets` | Service Tickets | renderModule() | Ticket Queue · SLA & Priority · Assignment · Conversation Timeline · Resolution & Closure · Service Analytics | Ticket No:code*, Customer:ref*, Product Asset:ref, Subject:longtext, Category:enum, Priority:money, Channel:enum, Assigned To:ref, Created At:datetime, SLA Due:date*, First Response:text, Resolution Time:text, Customer Rating:pct, Status:status |
| 2 | `service-requests` | Service Requests | renderModule() | Request Register · Request Classification · Customer Equipment · Approval & Estimate · Execution · Request Analytics | Request No:code*, Customer:ref*, Equipment:text, Request Type:enum, Description:longtext, Priority:money, Estimate:money, Approval:text, Assigned Team:ref, Requested Date:date*, Target Date:date, Status:status |
| 3 | `service-technicians` | Technician Allocation | renderModule() | Technician Board · Skills & Territory · Availability · Job Assignment · Travel Load · Technician Productivity | Technician ID:code*, Technician:ref, Skills:text, Territory:text, Current Jobs:qty, Available From:text, Travel KM:qty, Utilization %:pct, First Time Fix %:pct, Rating:pct, Status:status |
| 4 | `service-visits` | Site Visits | renderModule() | Visit Schedule · Route Plan · Visit Checklist · Parts Used · Customer Signoff · Visit Compliance | Visit No:code*, Ticket AMC:ref, Customer:ref*, Site:text, Technician:ref, Visit Date:date*, Arrival:datetime, Departure:datetime, Checklist %:pct, Parts Used:text, Customer Signoff:bool, Status:status |
| 5 | `service-spares` | Service Spare Parts | renderModule() | Service Spare Register · Van Stock · Issue to Job · Return Unused · Reorder · Spare Consumption | Issue No:code*, Ticket Visit:ref, Technician Van:ref, Spare Item:ref, Issued Qty:qty, Used Qty:qty, Returned Qty:qty, Unit Cost:money, Value:money, Status:status |
| 6 | `service-history` | Service History | renderModule() | Customer Service History · Equipment History · Tickets · Visits · Parts Replaced · Failure Trend | History Ref:code*, Customer:ref*, Equipment:text, Event Type:enum, Reference:ref, Date:date*, Issue:longtext, Action:longtext, Technician:ref, Parts:text, Cost:money, Status:status |
| 7 | `service-amc` | AMC Management | renderModule() | AMC Register · Coverage & SLA · Visit Schedule · Renewal Pipeline · Billing Status · AMC Profitability | AMC No:code*, Customer:ref*, Equipment:text, Coverage Type:enum, Start Date:date*, End Date:date, Visit Frequency:enum, Visits Planned:qty, Visits Completed:qty, Contract Value:money, Billed:money, Next Visit:text, Renewal Stage:enum, Status:status |
| 8 | `service-warranty` | Warranty Tracking | renderModule() | Warranty Register · Serial Eligibility · Coverage Terms · Claim History · Expiry Alerts · Warranty Cost | Warranty ID:code*, Customer:ref*, Product:text, Serial No:text, Invoice Ref:ref, Warranty Start:text, Warranty End:text, Coverage:enum, Claims Count:qty, Warranty Cost:money, Status:status |
| 9 | `service-claims` | Warranty Claims | renderModule() | Claim Register · Eligibility Check · Inspection · Approval · Replacement Repair · Claim Analytics | Claim No:code*, Warranty ID:ref, Customer:ref*, Serial No:text, Claim Date:date*, Problem:longtext, Eligibility:enum, Inspection Result:enum, Decision:enum, Repair Replace:text, Claim Cost:money, Status:status |


**Rules.**
* **Ticket:**
  * `SLA Due = Created At + resolution SLA(priority, contract)`, with business hours by calendar;
  * `First Response` and `Resolution Time` are timestamps;
  * breach flags at 80% and 100% of SLA;
  * statuses `New → Assigned → In Progress → Waiting (Customer/Parts) → Resolved → Closed | Reopened`;
  * the SLA clock pauses in "Waiting Customer".
* **Requests:** estimate approval before work starts.
* **Technician allocation:** match skills + territory + availability; `Utilization % = booked hrs / available hrs`; `First Time Fix % = tickets resolved on first visit / total`.
* **Visits:** checklist; parts used come from van stock; customer sign-off (typed name, plus drawn signature later).
* **Spares:** `Issued = Used + Returned + in hand` (validated). Consumption is billed when out of warranty/AMC.
* **History:** a computed timeline per customer/equipment.
* **AMC:** `Visits Planned` = months/frequency. A renewal reminder at 60/30/15 days. Billing schedule → sales invoices.
* **Warranty:** created automatically from a sales invoice of a serialised item (`Warranty End = invoice date + warranty months`).
* **Claims:** eligibility is computed (serial in warranty + coverage). The decision Repair/Replace needs an inspection result.

**KPIs.** Open tickets, SLA compliance %, MTTR (service), CSAT, AMC renewals due, warranty cost.

**Market comparison.** ERPNext Support/Warranty/Maintenance Visit, Zoho Desk (SLA, blueprint) and Odoo Helpdesk/Field Service. **Add:** SLA calendars, customer portal (later), signature capture.

**Careless-user risks.**
* Closing without resolution notes → blocked.
* A claim on an expired warranty → blocked unless "goodwill" approval.

---

## 4.17 Logistics / Fleet (16 pages)
**Users:** Purchase, Warehouse and Service. Owner: Warehouse. This includes the gate passes and container tracking.

**Pages (16) — generated from index.html registry.** Legend: `Field:type`, `*` = required. "Renderer" = page-level function in index.html.

| # | Page id | Title | Renderer | Profile tabs (6) | Fields |
|---|---|---|---|---|---|
| 1 | `log-transporters` | Transporter Master | renderModule() | Transporter Directory · Lane Capability · Rate Cards · Compliance Documents · Performance Score · Transporter Risk | Transporter Code:code*, Transporter Name:ref*, GSTIN:gstin, Contact:text, Primary Lanes:text, Vehicle Types:ref, Rate Card:text, Insurance Valid:date*, Compliance Score:pct, OTIF %:pct, Rating:pct, Status:status |
| 2 | `log-routes` | Route Management | renderModule() | Route Master · Stops & Distance · Transit Time · Toll & Restriction · Route Cost · Route Performance | Route Code:code*, Route Name:text*, Origin:text, Destination:text, Stops:qty, Distance KM:qty, Standard Transit Hrs:qty, Toll Cost:money, Restriction:text, Primary Transporter:ref, Status:status |
| 3 | `log-freight` | Freight Calculation | renderModule() | Freight Calculator · Rate Contracts · Weight Volume Slab · Fuel Surcharge · Additional Charges · Freight Variance | Calculation Ref:code*, Shipment Ref:ref, Transporter:ref, Route:text, Weight KG:qty, Volume CBM:qty, Base Freight:money, Fuel Surcharge:money, Toll:money, Other Charges:money, Total Freight:money, Status:status |
| 4 | `log-shipments` | Shipment Scheduling | renderModule() | Shipment Plan · Order Consolidation · Carrier Allocation · Vehicle Load · Dispatch Window · Shipment SLA | Shipment No:code*, Sales Orders:qty, Customer:ref*, Origin:text, Destination:text, Transporter:ref, Vehicle:ref, Planned Dispatch:text, Planned Delivery:text, Weight:qty, Volume:qty, Status:status |
| 5 | `log-tracking` | Shipment Tracking | renderModule() | Live Shipment Board · Milestones · Current Status · Delay Exceptions · Customer ETA · Tracking Performance | Shipment No:code*, Customer:ref*, Transporter:ref, Vehicle:ref, Last Location:text, Last Update:datetime, Current Milestone:text, ETA:text, Delay Min:qty, Exception:text, Status:status |
| 6 | `log-pod` | POD Tracking | renderModule() | POD Queue · Delivery Evidence · Receiver Details · Short Damage · Billing Release · POD Turnaround | POD No:code*, Shipment No:ref, Customer:ref*, Delivery Date:date*, Receiver:ref, Receiver Mobile:phone, POD File:text, Short Qty:qty, Damage Qty:qty, Billing Release:bool, Status:status |
| 7 | `fleet-vehicles` | Fleet Vehicles | renderModule() | Vehicle Register · Compliance Documents · Odometer & Usage · Fuel Performance · Service Schedule · Vehicle Cost | Vehicle No:code*, Vehicle Type:ref, Branch:ref, Driver:ref, Make Model:enum, Insurance Expiry:date*, Fitness Expiry:date, Permit Expiry:date, Pollution Expiry:date, Odometer:qty, Fuel Avg:text, Next Service:date, Status:status |
| 8 | `fleet-drivers` | Drivers | renderModule() | Driver Register · License & Documents · Vehicle Assignment · Trip History · Safety Incidents · Driver Score | Driver ID:code*, Driver Name:ref*, Mobile:phone, License No:text, License Expiry:date*, Vehicle Assigned:ref, Trips Month:date, KM Month:date, Incidents:qty, Rating:pct, Status:status |
| 9 | `fleet-fuel` | Fuel Management | renderModule() | Fuel Register · Fuel Issues · Mileage Calculation · Fuel Variance · Vendor Bills · Fuel Trend | Fuel Entry No:code*, Date:date*, Vehicle:ref, Driver:ref, Odometer:qty, Fuel Qty:qty, Rate:money, Amount:money, Vendor:ref*, Mileage:text, Variance %:pct, Status:status |
| 10 | `fleet-service` | Vehicle Service | renderModule() | Vehicle Service Plan · Due Service · Job Card · Parts & Labor · Downtime · Service Cost | Service Job No:code*, Vehicle:ref, Service Type:enum, Due KM Date:date*, Service Date:date, Odometer:qty, Vendor Workshop:ref*, Parts Cost:money, Labor Cost:money, Next Due:date, Downtime:qty, Status:status |
| 11 | `fleet-documents` | Vehicle Documents | renderModule() | Vehicle Documents · Insurance · Fitness · Permit · Pollution Certificate · Expiry Alerts | Document Ref:code*, Vehicle:ref, Document Type:enum, Document No:text, Issue Date:date*, Expiry Date:date, Authority:text, File:text, Days Remaining:qty, Status:status |
| 12 | `gate-in` | Inward Gate Pass | renderModule() | Inward Pass Register · Vehicle Entry · Material Details · Security Checks · Weighment · Exit Closure | Gate Pass No:code*, Date:date*, Vehicle:ref, Driver:ref, Vendor:ref*, Material:text, Quantity:qty, PO GRN Ref:ref, Entry Time:datetime, Weigh In:text, Security Check:text, Exit Time:datetime, Status:status |
| 13 | `gate-out` | Outward Gate Pass | renderModule() | Outward Pass Register · Vehicle Dispatch · Material Details · Security Checks · Document Validation · Exit Closure | Gate Pass No:code*, Date:date*, Vehicle:ref, Driver:ref, Customer:ref*, Material:text, Quantity:qty, Dispatch Ref:ref, E Way Bill:text, Entry Time:datetime, Weigh Out:text, Exit Time:datetime, Status:status |
| 14 | `gate-return` | Returnable Gate Pass | renderModule() | Returnable Pass Register · Material Out · Expected Return · Return Receipt · Overdue Items · Pass History | Pass No:code*, Date:date*, Party:ref, Material:text, Quantity:qty, Purpose:longtext, Expected Return:text, Returned Qty:qty, Return Date:date, Balance Qty:money, Authorized By:text, Status:status |
| 15 | `gate-nonreturn` | Non-Returnable Gate Pass | renderModule() | Non Returnable Pass · Material Out · Authorization · Value & Reason · Security Exit · Pass Audit | Pass No:code*, Date:date*, Party:ref, Material:text, Quantity:qty, Value:money, Reason:longtext, Department:ref, Authorized By:text, Vehicle:ref, Exit Time:datetime, Status:status |
| 16 | `container-track` | Container Tracking | renderModule() | Container Register · Allocation · Loading · Transit · Unloading & Return · Container Turnaround | Container No:code*, Type:enum, Owner:ref, Allocation Ref:ref, Loading Date:date*, Shipment:ref, Current Location:text, ETA:text, Unloading Date:date, Return Due:date, Return Date:date, Status:status |


**Rules.**
* **Freight:** `Total = Base Freight + Fuel Surcharge + Toll + Other`.
  * Base comes from the transporter rate card: per kg, per CBM, per trip or per km.
  * Chargeable weight = max(actual, volumetric).
  * Freight is apportioned to delivered orders by weight (configurable).
* **Shipment:** consolidates SOs with the same route/date. Vehicle capacity check (weight/volume). E-way bill reference is required when needed.
* **Tracking:** milestones Dispatched / In Transit / At Hub / Out for Delivery / Delivered. `Delay Min = now − ETA` when not delivered. Manual updates (GPS integration later).
* **POD:** image/PDF upload. Short/damage qty → a claim and a Sales Return. `Billing Release` = POD received (when the invoice policy is "on POD").
* **Fleet:**
  * compliance dates for insurance, fitness, permit and PUC, with alerts at 30/15/7 days; an **expired document blocks trip assignment**;
  * `Mileage = (Odometer − previous Odometer)/Fuel Qty`;
  * `Variance % = (expected − actual)/expected`;
  * the odometer must be non-decreasing.
* **Drivers:** a licence expiry blocks assignment.
* **Gate passes:**
  * Inward links to PO/GRN; Outward links to dispatch and e-way bill.
  * Returnable: `Balance Qty = Quantity − Returned Qty`, overdue when Expected Return < today with balance > 0.
  * Non-returnable needs authorization above a value threshold.
  * Weigh-in/out difference = net weight.
* **Container:** `Return Due` is detention-free days. Overdue → detention charges warning.

**KPIs.** On-time delivery %, freight cost per kg, average transit hours, vehicles with expiring documents, open returnable passes.

**Market comparison.** Zoho Inventory shipments, ERPNext Delivery Trip and Odoo delivery carriers. Indian TMS tools add an e-way-bill link. **Add:** e-way-bill linkage, document-expiry blocking, freight apportionment.

**Careless-user risks.**
* An odometer value lower than the last → blocked.
* An outward pass without dispatch → blocked for goods; allowed for non-returnable with authorization.

---

## 4.18 Document Management (6 pages)
**Users:** HR (from `DEPT_FAMILIES`). **[Change, D-11]** In the rebuild every department can read DMS, scoped by document permissions. Owner: Administration.

**Pages (6) — generated from index.html registry.** Legend: `Field:type`, `*` = required. "Renderer" = page-level function in index.html.

| # | Page id | Title | Renderer | Profile tabs (6) | Fields |
|---|---|---|---|---|---|
| 1 | `dms-folders` | Folders | renderModule() | Folder Tree · Folder Metadata · Ownership · Retention Rules · Access Rights · Folder Activity | Folder ID:code*, Folder Name:ref*, Parent Folder:ref, Owner:ref, Department:ref, Retention Years:text, Confidentiality:enum, Document Count:qty, Last Activity:text, Status:status |
| 2 | `dms-docs` | Documents | renderModule() | Document Register · Metadata & Tags · Preview & Versions · Access Rights · Workflow & Approval · Document Activity | Document ID:code*, Document Name:text*, Folder:ref, Document Type:enum, Owner:ref, Version:text, Tags:text, Effective Date:date*, Expiry Date:date, Approval Status:status, Access Level:enum, Status:status |
| 3 | `dms-versions` | Version Control | renderModule() | Version History · Check In Out · Change Notes · Compare Versions · Rollback · Version Audit | Document ID:code*, Document Name:text*, Version:text, Created Date:date*, Created By:ref, Change Note:longtext, File Size:text, Checked Out By:ref, Current Version:text, Status:status |
| 4 | `dms-permissions` | Document Permissions | renderModule() | Access Matrix · Users & Roles · Folder Rights · Document Rights · Share Links · Permission Audit | Resource:enum*, Resource Type:enum, User Role:text, View:bool, Upload:bool, Edit:bool, Delete:bool, Download:bool, Share:bool, Approve:bool, Status:status |
| 5 | `dms-tags` | Tags | renderModule() | Tag Master · Tag Groups · Document Usage · Auto Tag Rules · Duplicate Tags · Tag Analytics | Tag Code:code*, Tag Name:text*, Group:text, Description:longtext, Usage Count:qty, Auto Tag Rule:text, Owner:ref, Status:status |
| 6 | `dms-search` | Document Search | renderModule() | Search Workspace · Full Text Search · Metadata Filters · Saved Searches · Recent Results · Search Analytics | Search Ref:code*, User:ref, Query:longtext, Filters:longtext, Result Count:qty, Search Date:date*, Saved Search:bool, Exported:bool, Status:status |


**Rules.**
* **Storage:** files go to object storage (S3-compatible / local disk in dev). Metadata lives in Postgres. **No base64 in the DB.**
* **Folders:** a tree with retention years and confidentiality (Public/Internal/Confidential/Restricted).
* **Versioning:** check-out/check-in. `Current Version` is unique per document. Older versions are read-only.
* **Approval workflow:** for controlled documents (Draft → Review → Approved → Obsolete).
* **Permissions:** per folder/document × role/user: view/upload/edit/delete/download/share/approve. Inheritance from the folder; explicit deny wins.
* **Tags:** free + controlled vocabulary.
* **Search:** full-text on metadata (OCR is **later**). Saved searches.
* **Expiry alerts.** Retention: deletion is blocked until retention ends, then archive.
* The universal per-record **Documents** tab and the `📎` button use the same document service: a document is linked to (module, record).

**KPIs.** Documents, expiring in 30 days, pending approval, restricted count.

**Market comparison.** Zoho WorkDrive, SharePoint and Odoo Documents. ERPNext attachments are per record (File doctype). **Add:** versioning and retention, which the prototype lacks entirely (it stores base64 in localStorage, deletes without confirm or audit, and its "versions" are fake).

**Careless-user risks.**
* Uploading a 2 GB file → 25 MB limit (configurable) with a clear message.
* A `.exe` renamed to `.pdf` → magic-byte check rejects it.
* Deleting the current version → blocked.

---

## 4.19 Business Intelligence (10 pages)
**Users:** all departments (scoped data). Owner: Administration.

**Pages (10) — generated from index.html registry.** Legend: `Field:type`, `*` = required. "Renderer" = page-level function in index.html.

| # | Page id | Title | Renderer | Profile tabs (6) | Fields |
|---|---|---|---|---|---|
| 1 | `bi-builder` | Report Builder | renderModule() | Report Designer · Data Sources · Fields & Measures · Filters & Groups · Chart Builder · Preview & Publish | Report ID:code*, Report Name:text*, Data Source:enum, Dimensions:text, Measures:text, Filters:longtext, Visualization:enum, Owner:ref, Published:bool, Last Run:datetime, Status:status |
| 2 | `bi-reports` | Saved Reports | renderModule() | Report Library · Favorites · Permissions · Run History · Exports · Usage Analytics | Report ID:code*, Report Name:text*, Category:enum, Owner:ref, Shared With:text, Last Run:datetime, Run Count:qty, Export Count:qty, Favorite:bool, Status:status |
| 3 | `bi-dashboards` | Custom Dashboards | renderModule() | Dashboard Library · Widget Layout · Filters · Sharing · Subscriptions · Dashboard Usage | Dashboard ID:code*, Dashboard Name:text*, Owner:ref, Widget Count:qty, Shared With:text, Default Filters:longtext, Last Viewed:text, View Count:qty, Status:status |
| 4 | `bi-scheduler` | Report Scheduler | renderModule() | Schedule Register · Report Selection · Frequency · Recipients · Delivery Format · Run History | Schedule ID:code*, Report:ref, Frequency:enum, Run Time:text, Recipients:text, Format:enum, Last Run:datetime, Next Run:datetime, Delivery Status:status, Status:status |
| 5 | `bi-sales` | Sales Analytics | renderModule() | Sales KPI Summary · Revenue Trend · Product Mix · Customer Analysis · Salesperson Performance · Forecast | Period:date*, Revenue:money, Orders:qty, Average Order Value:money, Gross Margin %:pct, New Customers:ref, Win Rate %:pct, Forecast:money, Variance %:pct, Status:status |
| 6 | `bi-purchase` | Purchase Analytics | renderModule() | Purchase KPI Summary · Spend Trend · Supplier Spend · Price Variance · Lead Time · Savings Analysis | Period:date*, Purchase Spend:money, PO Count:qty, Supplier Count:qty*, Price Variance %:pct, OTIF %:pct, Savings:money, Open Commitments:text, Status:status |
| 7 | `bi-inventory` | Inventory Analytics | renderModule() | Inventory KPI Summary · Stock Value · Turnover · Ageing · Shortage & Overstock · Forecast | Period:date*, Stock Value:money, Inventory Turns:qty, Days on Hand:qty, Slow Stock Value:money, Shortage SKUs:text, Overstock SKUs:text, Forecast Accuracy %:pct, Status:status |
| 8 | `bi-finance` | Financial Analytics | renderModule() | Finance KPI Summary · Revenue Profit · Working Capital · Cash Flow · Budget Variance · Financial Ratios | Period:date*, Revenue:money, Gross Profit:money, EBITDA:money, Net Profit:money, Receivables:money, Payables:money, Cash Balance:money, Budget Variance %:pct, Status:status |
| 9 | `bi-branch` | Branch Performance | renderModule() | Branch Scorecard · Revenue · Profit · Inventory · People · Branch Ranking | Branch:ref*, Revenue:money, Gross Profit:money, Net Profit:money, Inventory Value:money, Employee Count:qty*, Sales Orders:qty, Customer Count:qty, Health Score:pct, Rank:qty, Status:status |
| 10 | `bi-profit` | Profitability Analysis | renderModule() | Profitability Summary · Product Margin · Customer Margin · Branch Margin · Project Margin · Contribution Analysis | Dimension:text*, Name:text*, Revenue:money, Direct Cost:money, Allocated Cost:money, Contribution:money, Margin %:pct, Rank:qty, Trend:enum, Status:status |


**Rules.**
* **Report Builder:** choose a **registered dataset** (whitelisted views per family; no free SQL), dimensions, measures (sum/count/avg/min/max), filters and visualization (table/bar/line/pie/KPI).
  * The query builder generates parameterised SQL through Prisma `$queryRaw` with a whitelist of identifiers.
  * Row scope of the viewer is always applied.
* **Saved reports:** owner, shared with roles/users, favourite, run/export counts.
* **Custom dashboards:** a widget grid (saved reports).
* **Scheduler:** a cron job runs and emails PDF/XLSX to recipients (who must be users with access, or explicitly allowed external emails). `Delivery Status` is logged.
* **Analytics pages** (`bi-sales`, `bi-purchase`, `bi-inventory`, `bi-finance`, `bi-branch`, `bi-profit`) are **read-only views** computed per period from transactional tables, using the formulas defined in the respective families. In the prototype they are editable tables of random numbers.

**Market comparison.** Zoho Analytics, ERPNext Report Builder / Query Report / Dashboard Charts, and Odoo pivot/graph views. **Add:** pivot view, drill-through to documents, scheduled delivery.

**Careless-user risks.**
* A report without filters over a million rows → server limit (10k rows view, 100k export) and a hint.
* Sharing a report with someone lacking access → they see only their scoped rows.

---

## 4.20 AI & Automation (11 pages)
**Users:** Sales, Purchase, Finance, HR, Production, Quality and Maintenance. Owner: Administration.

**index.html facts.**
* **All 8 `ai-*` ids** (including Executive `ai-insights`) route to one `aiPage()`: same page, hard-coded trend array, 20 "findings" built from `v8Stats` of seeded rows, and canned keyword answers in "Enterprise AI Copilot".
* The `auto-*` pages are generic.
* The module "Automation Studio" saves rules to localStorage and "Test" only logs an audit row. Nothing executes.

**Pages (11) — generated from index.html registry.** Legend: `Field:type`, `*` = required. "Renderer" = page-level function in index.html.

| # | Page id | Title | Renderer | Profile tabs (6) | Fields |
|---|---|---|---|---|---|
| 1 | `ai-copilot` | ERP AI Copilot | aiPage() | ERP AI Copilot Workspace · ERP AI Copilot Details · ERP AI Copilot Workflow · ERP AI Copilot Exceptions · ERP AI Copilot Performance · ERP AI Copilot Controls *(profile defined but ignored by the custom renderer; rebuild uses it)* | Record ID:code*, Model Rule:enum, Module:text, Trigger Input:text, Score Condition:pct, Recommended Action:longtext, Owner:ref, Last Run:datetime, Next Run:datetime, Status:status |
| 2 | `ai-demand` | Demand Forecasting | aiPage() | Demand Model · Forecast Horizon · Seasonality Drivers · Forecast Output · Accuracy Monitoring · Replenishment Recommendations *(profile defined but ignored by the custom renderer; rebuild uses it)* | Model ID:code*, Product Category:enum, Forecast Horizon:text, Training Window:text, Seasonality:text, Forecast Qty:qty, Confidence %:pct, MAPE %:pct, Last Trained:text, Next Refresh:text, Status:status |
| 3 | `ai-inventory` | Inventory Intelligence | aiPage() | Inventory Signals · Slow Dead Stock · Overstock Risk · Shortage Risk · Expiry Risk · Recommended Actions *(profile defined but ignored by the custom renderer; rebuild uses it)* | Signal ID:code*, Item:ref*, Warehouse:ref, Signal Type:enum, Current Stock:text, Expected Demand:text, Risk Score:pct, Estimated Value Impact:money, Recommended Action:longtext, Owner:ref, Status:status |
| 4 | `ai-sales` | Sales Intelligence | aiPage() | Lead Opportunity Scoring · Win Probability · Next Best Action · Churn Risk · Cross Sell · Sales Forecast *(profile defined but ignored by the custom renderer; rebuild uses it)* | Signal ID:code*, Lead Opportunity:text, Model Score:pct, Win Probability:pct, Churn Risk:text, Next Best Action:longtext, Recommended Product:text, Expected Value:money, Owner:ref, Status:status |
| 5 | `ai-vendor` | Vendor Intelligence | aiPage() | Vendor Risk Signals · Delivery Prediction · Quality Risk · Price Anomaly · Compliance Risk · Sourcing Recommendation *(profile defined but ignored by the custom renderer; rebuild uses it)* | Signal ID:code*, Vendor:ref*, Delivery Risk:text, Quality Risk:text, Price Risk:money, Compliance Risk:text, Overall Risk:text, Recommended Action:longtext, Category Owner:ref, Status:status |
| 6 | `ai-finance` | Finance Anomaly Detection | aiPage() | Anomaly Dashboard · Expense Anomalies · Duplicate Payments · Revenue Exceptions · Journal Risk · Investigation Queue *(profile defined but ignored by the custom renderer; rebuild uses it)* | Alert ID:code*, Transaction:hsn, Alert Type:enum, Risk Score:pct, Amount:money, Reason:longtext, Detected At:datetime, Reviewer:ref, Disposition:enum, Status:status |
| 7 | `ai-executive` | Executive Insights | aiPage() | Executive Brief · Revenue Insights · Working Capital Insights · Operations Insights · Risk Alerts · Recommended Actions *(profile defined but ignored by the custom renderer; rebuild uses it)* | Insight ID:code*, Domain:text, Insight:longtext, Business Impact:text, Confidence %:pct, Recommended Action:longtext, Owner:ref, Generated At:datetime, Status:status |
| 8 | `auto-workflows` | Workflow Automation | renderModule() | Workflow Automation Workspace · Workflow Automation Details · Workflow Automation Workflow · Workflow Automation Exceptions · Workflow Automation Performance · Workflow Automation Controls | Record ID:code*, Model Rule:enum, Module:text, Trigger Input:text, Score Condition:pct, Recommended Action:longtext, Owner:ref, Last Run:datetime, Next Run:datetime, Status:status |
| 9 | `auto-rules` | Automation Rules | renderModule() | Rule Library · Triggers · Conditions · Actions · Escalations · Execution History | Rule ID:code*, Rule Name:text*, Module:text, Trigger:text, Condition:longtext, Action:longtext, Escalation:text, Priority:money, Last Run:datetime, Executions:qty, Status:status |
| 10 | `auto-jobs` | Background Jobs | renderModule() | Job Queue · Scheduled Jobs · Running Jobs · Failed Jobs · Retry Policy · Job Performance | Job ID:code*, Job Name:text*, Job Type:enum, Schedule:text, Queue:text, Started At:datetime, Duration:qty, Attempts:qty, Last Error:text, Next Run:datetime, Status:status |
| 11 | `auto-webhooks` | Webhooks | renderModule() | Webhook Registry · Event Subscriptions · Endpoints & Secrets · Delivery Log · Retry Queue · Webhook Health | Webhook ID:code*, Event:text, Endpoint:text, Secret Status:status, Timeout:datetime, Max Retries:qty, Last Delivery:text, Last HTTP Code:text, Failure Count:qty, Status:status |


**Rebuild spec.**
* **Analytics first, no fake AI.** Each AI page becomes a real view:
  * **Demand Forecasting:** per item/category, a Holt-Winters / moving-average forecast from 24 months of sales. `MAPE = mean(|A−F|/A)×100`, shown honestly. "Insufficient history" appears when there are fewer than 6 months.
  * **Inventory Intelligence:** shortage risk = days of cover < lead time; slow/dead stock (no issue in 90/180 days).
  * **Sales Intelligence:** win-probability = stage probability adjusted by activity recency (rule-based v1). Churn risk = no order in 2× the average reorder interval.
  * **Vendor Intelligence:** risk from OTIF, PPM, price variance and compliance expiry.
  * **Finance Anomaly:** rules for duplicate invoice (same vendor + amount within 7 days), round-amount, weekend posting, z-score > 3 vs. the account's history, and new-bank-account payments.
  * **Executive Insights:** a top-N list of the above.
  * Every finding stores its inputs (explainability). The reviewer disposition feeds a false-positive %.
* **ERP AI Copilot (optional, behind a flag):**
  * an LLM (Anthropic Claude via API, e.g. `claude-sonnet-5-5`) with **tool-calling only on read APIs** under the user's own token and scope;
  * write actions need a human to click confirm (as the prototype's "AI Governance Controls" card promises);
  * prompts and responses are audited;
  * PII is masked;
  * disabled by default; if no key is configured the page says so.
* **Workflow Automation / Automation Rules:** a trigger (record created/updated/status changed/schedule), conditions (field ops) and actions (notify, set field, create task, submit for approval, call webhook). Executed by a **job queue** (BullMQ/pg-boss) with an execution log, retries and a kill switch.
* **Background Jobs:** a view over the queue: status, attempts, last error, retry/cancel (admin).
* **Webhooks:**
  * per-event subscriptions;
  * HMAC-SHA256 signature header;
  * secret shown once;
  * retries with exponential backoff up to Max Retries;
  * an SSRF guard (block private IP ranges and metadata IPs; https only in prod).

**Market comparison.** Zoho Zia, Odoo AI and ERPNext's Assignment/Notification rules plus server scripts (ERPNext lets scripts run arbitrary Python — we deliberately do **not**). **Add:** governed automation with audit and a kill switch.

**Careless-user risks.**
* An automation that updates a record which re-triggers itself → loop guard (max depth 3, idempotency per event).
* A webhook to `http://169.254.169.254` → blocked.

---

## 4.21 Communication (6 pages)
**Users:** Sales. Owner: Administration.

**Pages (6) — generated from index.html registry.** Legend: `Field:type`, `*` = required. "Renderer" = page-level function in index.html.

| # | Page id | Title | Renderer | Profile tabs (6) | Fields |
|---|---|---|---|---|---|
| 1 | `comm-whatsapp` | WhatsApp Business API | renderModule() | WhatsApp Dashboard · Templates · Conversation Log · Delivery Status · Automation · Opt In Compliance | Account:ref*, Phone Number ID:phone, Business Account:qty, Template Count:qty, Conversations Today:qty, Sent:qty, Delivered:qty, Read:qty, Failed:qty, Opt In %:pct, Status:status |
| 2 | `comm-email` | Email Integration | renderModule() | Email Accounts · Templates · Outbox Queue · Delivery Status · Linked Records · Email Analytics | Account ID:code*, Provider:enum, From Address:email, SMTP Host:text, Authentication:text, Daily Limit:money, Sent Today:qty, Bounce %:pct, Last Sync:datetime, Status:status |
| 3 | `comm-sms` | SMS Integration | renderModule() | SMS Accounts · Templates · Outbound Queue · Delivery Reports · OTP Messages · SMS Analytics | Account ID:code*, Provider:enum, Sender ID:text, DLT Entity:text, DLT Header:text, Daily Limit:money, Sent Today:qty, Delivery %:pct, Failed:qty, Status:status |
| 4 | `comm-templates` | Message Templates | renderModule() | Template Library · Variables · Channel Versions · Approval Status · Test Preview · Template Usage | Template ID:code*, Template Name:text*, Channel:enum, Category:enum, Language:enum, Variables:text, Approval Status:status, Last Updated:datetime, Usage Count:qty, Status:status |
| 5 | `comm-logs` | Communication Logs | renderModule() | Communication Timeline · WhatsApp Logs · Email Logs · SMS Logs · Failures · Delivery Analytics | Message ID:code*, Channel:enum, Recipient:text, Template Subject:ref, Related Record:ref, Sent At:datetime, Delivered At:datetime, Read At:datetime, Failure Reason:longtext, Status:status |
| 6 | `comm-payment` | Payment Gateway | renderModule() | Payment Gateway Setup · Payment Links · Transactions · Refunds · Webhook Events · Settlement Reconciliation | Gateway:text*, Merchant ID:text, Mode:enum, Webhook Status:status, Transactions Today:hsn, Success %:pct, Failed:qty, Refunds:money, Settlement Due:date*, Status:status |


**Rules.**
* **Provider adapters** behind interfaces: WhatsApp Cloud API, SMTP/SES, an SMS gateway with DLT (India TRAI: registered entity, header and template IDs are required for commercial SMS), and a payment gateway (Razorpay/PayU-type).
* **v1 ships with "log-only" mock adapters.** Real sending is enabled per company once credentials are entered (encrypted at rest; displayed masked).
* **Templates:** variables `{{customer.name}}`. WhatsApp templates need Meta approval (status tracked). SMS templates need a DLT template id.
* **Opt-in:** WhatsApp/SMS marketing is sent only when the contact's consent = Yes (DPDP Act 2023). Opt-out keywords update consent.
* **Logs:** every message, with status callbacks (delivered/read/failed).
* **Payment gateway:** create payment links for invoices. The webhook marks a receipt as **Pending Settlement**. Settlement reconciliation is done against the bank statement (real settlement is out of scope, §14).

**Careless-user risks.**
* Bulk send to 10,000 contacts by mistake → a confirmation with the count, a daily limit (`Daily Limit` field) and a rate limit.
* Sending to a contact without consent → skipped and logged.

---

## 4.22 Administration (24 pages)
**Users:** Super User (and, in the rebuild, any role granted `controls`). Owner: Administration.

**index.html facts.** These pages use custom renderers:

* `admin-departments` → `departmentMaster()`: prompt() dialogs; delete by array index.
* `admin-users` → `userMaster()`: prompt() dialogs. Edit can change only department, role and limit. The password defaults to "Welcome@123". Super User rows have no Delete but can be edited.
* `admin-roles` → `roleMaster()`: add/edit, **no delete**. Renaming a role orphans its permissions and users.
* `admin-permissions` → `permissionMaster()`: per-role scope select (department / * / finance) + 7 checkboxes + Save.
* `admin-approval` → `approvalCenter()`: the request queue, **not** the matrix. The matrix is reached by a button → `approvalMatrix()`.
* `admin-settings` → `systemSetup()`: 9 tiles, including the hidden **System Control Center** (`systemControls()`: per-module owner department + enabled/approval/edit/delete/export) and **Letterhead & PDF** (`letterheadSettings()`, 11 keys).
* The other 18 admin pages are generic.

**Pages (24) — generated from index.html registry.** Legend: `Field:type`, `*` = required. "Renderer" = page-level function in index.html.

| # | Page id | Title | Renderer | Profile tabs (6) | Fields |
|---|---|---|---|---|---|
| 1 | `admin-company` | Companies | renderModule() | Company Master · Legal & Tax Details · Addresses · Bank Accounts · Branding · Company Controls | Company Code:code*, Legal Name:text*, Trade Name:text*, CIN:text, PAN:pan, GSTIN:gstin, Registered Address:text, Currency:text, Timezone:ref, Financial Year:date*, Status:status |
| 2 | `admin-branches` | Branches | renderModule() | Branch Master · Addresses · GST Registration · Warehouses · Users · Branch Controls | Branch Code:code*, Branch Name:ref*, Company:ref, Address:text, GSTIN:gstin, Manager:ref, Warehouse Count:qty, Employee Count:qty*, Timezone:ref, Status:status |
| 3 | `admin-departments` | Departments | departmentMaster() | Department Master · Hierarchy · Managers · Cost Centers · Employees · Department Controls *(profile defined but ignored by the custom renderer; rebuild uses it)* | Department Code:code*, Department Name:ref*, Parent Department:ref, Head:text, Cost Center:ref, Employee Count:qty*, Branch:ref, Status:status |
| 4 | `admin-designations` | Designations | renderModule() | Designation Master · Grades · Reporting Level · Role Mapping · Employees · Designation Controls | Designation Code:code*, Designation Name:text*, Grade:ref, Level:text, Department:ref, Reports To Level:text, Role Mapping:text, Employee Count:qty*, Status:status |
| 5 | `admin-users` | Users | userMaster() | User Directory · Authentication · Role Assignment · Company Branch Scope · Session History · User Audit *(profile defined but ignored by the custom renderer; rebuild uses it)* | User ID:code*, Name:text*, Email:email, Mobile:phone, Role:text, Company:ref, Branch:ref, Department:ref, MFA:bool, Last Login:datetime, Session Count:qty, Status:status |
| 6 | `admin-roles` | Roles | roleMaster() | Role Master · Module Rights · Action Rights · Data Scope · Approval Limits · Role Audit *(profile defined but ignored by the custom renderer; rebuild uses it)* | Role Code:code*, Role Name:text*, User Count:qty, Module Count:qty, Approval Limit:money, Company Scope:ref, Branch Scope:ref, Data Scope:enum, Status:status |
| 7 | `admin-permissions` | Permissions | permissionMaster() | Permissions Workspace · Permissions Details · Permissions Workflow · Permissions Exceptions · Permissions Performance · Permissions Controls *(profile defined but ignored by the custom renderer; rebuild uses it)* | Code:code*, Name:text*, Category:enum, Company:ref, Branch:ref, Owner:ref, Effective From:date*, Effective To:date, Configuration:longtext, Status:status |
| 8 | `admin-approval` | Approval Matrix | approvalCenter() | Approval Matrix Workspace · Approval Matrix Details · Approval Matrix Workflow · Approval Matrix Exceptions · Approval Matrix Performance · Approval Matrix Controls *(profile defined but ignored by the custom renderer; rebuild uses it)* | Code:code*, Name:text*, Category:enum, Company:ref, Branch:ref, Owner:ref, Effective From:date*, Effective To:date, Configuration:longtext, Status:status |
| 9 | `admin-fy` | Financial Years | renderModule() | Financial Year Master · Period Calendar · Open Close Periods · Year End Controls · Carry Forward · Period Audit | FY Code:code*, Financial Year:date*, Start Date:date, End Date:date, Current:money, Posting From:text, Posting To:text, Year End Closed:bool, Status:status |
| 10 | `admin-currency` | Currencies | renderModule() | Currency Master · Exchange Rates · Rate Sources · Effective Dates · Revaluation · Currency Audit | Currency Code:code*, Currency Name:text*, Symbol:text, Decimals:qty, Base Currency:bool, Rate:money, Rate Date:date*, Rate Source:enum, Status:status |
| 11 | `admin-taxes` | Taxes | renderModule() | Tax Master · Tax Components · Rate Rules · Jurisdiction · Effective Dates · Tax Validation | Tax Code:code*, Tax Name:text*, Component:text, Rate %:pct, Jurisdiction:enum, HSN SAC Scope:hsn, Effective From:date*, Effective To:date, Status:status |
| 12 | `admin-numbering` | Document Numbering | renderModule() | Number Series · Company Branch Prefix · Financial Year Pattern · Sequence Rules · Reset Rules · Number Audit | Series Code:code*, Document Type:enum, Company:ref, Branch:ref, Prefix:text, FY Pattern:text, Sequence Length:qty, Next Number:text, Reset Frequency:enum, Status:status |
| 13 | `admin-uom` | UOM | renderModule() | UOM Master · Conversions · Base Units · Precision · Item Mapping · UOM Validation | UOM Code:code*, UOM Name:text*, UOM Class:enum, Base UOM:text, Conversion Factor:text, Precision:qty, Status:status |
| 14 | `admin-customfields` | Custom Fields | renderModule() | Custom Field Library · Field Types · Module Mapping · Validation Rules · Visibility · Field Usage | Field Code:code*, Field Label:text, Module:text, Field Type:enum, Mandatory:bool, Default Value:money, Validation:date*, Visibility Rule:text, Sort Order:text, Status:status |
| 15 | `admin-formbuilder` | Form Builder | renderModule() | Form Designer · Sections · Field Layout · Mandatory Rules · Conditional Visibility · Preview & Publish | Form Code:code*, Module:text, Form Name:text*, Sections:text, Fields:text, Layout:text, Conditional Rules:longtext, Version:text, Published:bool, Status:status |
| 16 | `admin-workflow` | Workflow Builder | renderModule() | Workflow Builder Workspace · Workflow Builder Details · Workflow Builder Workflow · Workflow Builder Exceptions · Workflow Builder Performance · Workflow Builder Controls | Code:code*, Name:text*, Category:enum, Company:ref, Branch:ref, Owner:ref, Effective From:date*, Effective To:date, Configuration:longtext, Status:status |
| 17 | `admin-import` | Import / Export | renderModule() | Import / Export Workspace · Import Export Details · Import Export Workflow · Import Export Exceptions · Import Export Performance · Import Export Controls | Code:code*, Name:text*, Category:enum, Company:ref, Branch:ref, Owner:ref, Effective From:date*, Effective To:date, Configuration:longtext, Status:status |
| 18 | `admin-duplicates` | Duplicate Detection | renderModule() | Duplicate Rules · Matching Fields · Potential Duplicates · Merge Review · Prevention Rules · Duplicate Audit | Rule ID:code*, Module:text, Match Fields:text, Threshold %:pct, Block Save:bool, Warn User:bool, Auto Merge:bool, Potential Duplicates:text, Last Scan:date*, Status:status |
| 19 | `admin-audit` | Audit Trail | renderModule() | Audit Explorer · User Activity · Data Changes · Login Events · Exports & Downloads · Audit Retention | Date Time:datetime*, User:ref, IP:text, Device:text, Module:text, Action:longtext, Record:text, Old Value:money, New Value:money, Session ID:text, Status:status |
| 20 | `admin-security` | Security | renderModule() | Security Center · Password Policy · MFA · Session Controls · IP Restrictions · Security Events | Policy ID:code*, Policy Name:text*, Password Min Length:qty, MFA Required:bool, Session Timeout Min:qty, Failed Login Limit:money, IP Restriction:text, Last Updated:datetime, Status:status |
| 21 | `admin-backup` | Backup & Restore | renderModule() | Backup & Restore Workspace · Backup and Restore Details · Backup and Restore Workflow · Backup and Restore Exceptions · Backup and Restore Performance · Backup and Restore Controls | Code:code*, Name:text*, Category:enum, Company:ref, Branch:ref, Owner:ref, Effective From:date*, Effective To:date, Configuration:longtext, Status:status |
| 22 | `admin-api` | API Management | renderModule() | API Clients · API Keys · Scopes · Rate Limits · Usage Logs · API Health | Client ID:code*, Client Name:text*, Owner:ref, Scopes:enum, Rate Limit:money, Last Used:datetime, Requests Today:qty, Error %:pct, Secret Expiry:date*, Status:status |
| 23 | `admin-integrations` | Integrations | renderModule() | Integration Catalog · Connected Apps · Credentials · Field Mapping · Sync Logs · Integration Health | Integration ID:code*, Integration:text, Provider:enum, Direction:enum, Authentication:text, Last Sync:datetime, Records Synced:text, Errors:text, Next Sync:text, Status:status |
| 24 | `admin-settings` | System Settings | systemSetup() | General Settings · Localization · Notifications · Storage · Feature Flags · System Diagnostics *(profile defined but ignored by the custom renderer; rebuild uses it)* | Setting Key:text*, Category:enum, Setting Name:text*, Value:money, Scope:enum, Editable By:text, Last Updated:datetime, Updated By:date*, Status:status |


**Rebuild spec.**
* **Companies / Branches:**
  * a company has legal name, CIN, PAN and GSTIN(s), currency and timezone;
  * a branch has its own GSTIN (state);
  * the top-bar Company/Branch/FY selectors become **real context**: they filter data and stamp new documents (in the prototype they only print in PDF headers).
* **Departments / Designations:** typed masters, used for login scoping, approval routing and cost centers. Delete is blocked when users or employees reference the row.
* **Users:**
  * invite by email (no self-signup in production; see §5);
  * fields: role(s), department, branch scope, approval limit, MFA, status;
  * "Reset password" sends a link;
  * last login and session count are shown;
  * **force sign-out** of all sessions.
* **Roles & Permissions:**
  * a role is a name, a level, and a permission set;
  * permissions are `(page id or family) × action(view, add, edit, delete, approve, export, controls)` × data scope (`self`, `department`, `branch`, `company`, `all`, plus the named scope `finance` kept for parity);
  * the matrix UI keeps the prototype's table look;
  * **server-side enforcement on every endpoint** (§8).
* **Approval Matrix:** rules (department, document type [ADD], level, threshold ₹, approver role, **[ADD]** specific user, SLA hours, escalate-to). The admin-approval page shows the matrix and the request queue as two tabs (decision D-09).
* **Financial Years:**
  * open/close;
  * posting window;
  * year-end close locks the year;
  * the FY selector lists only open/allowed years.
* **Currencies:** rates by date (manual; RBI reference import later).
* **Taxes:** GST components with effective dating.
* **Document Numbering:**
  * series per document type × company × branch × FY;
  * pattern e.g. `SO/{BR}/{FY}/{#####}`;
  * **gap-free allocation** inside the DB transaction (row lock on the series);
  * reset per FY.
* **UOM:** class, conversion factor to base, precision.
* **Custom Fields:** add fields to any registered page (stored in `custom_values` JSONB). Typed and validated like built-ins. Visible in forms and lists.
* **Form Builder:** layout (sections, order, conditional visibility) over registry + custom fields. Versioned; publish creates a new version.
* **Workflow Builder:** states, transitions, allowed roles, conditions. It attaches to a page type and replaces the default workflow.
* **Import/Export:**
  * XLSX/CSV import with a template download;
  * preview, row-level validation report, dry-run, then commit in batches;
  * export of any list.
* **Duplicate Detection:** rules per module (match fields, threshold, block/warn).
* **Audit Trail:** an immutable log of every create/update/delete/approve/export/login, with old and new values (diff), IP, user agent and session. It is append-only (DB grants deny UPDATE/DELETE). Retention ≥ 8 years for finance (Companies Act s.128 books retention).
* **Security:** password policy, MFA (TOTP), session timeout, failed-login lockout, IP allow-list.
* **Backup & Restore:** shows backup jobs (pg_dump/WAL done by ops, §12). Restore is ops-only; the UI shows status, not a restore button (decision D-12).
* **API Management:** API clients with scopes and rate limits. The secret is shown once and hashed at rest.
* **Integrations:** a list of adapters (GST/IRP, bank, WhatsApp, email, SMS, payment) with status, last sync and error.
* **System Settings:** typed key/value settings with scope (global/company/branch). Changes are audited. Includes the Letterhead.

**Careless-user risks.**
* The admin demotes the last Super User → blocked ("at least one active Super User").
* Deleting a role in use → blocked.
* Approval matrix with a level gap or a duplicate threshold → validation error.
* Changing a numbering series that has already issued numbers → only Next Number upward.
