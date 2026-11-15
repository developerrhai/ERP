# 04 — CRM and Sales (INDEX) — Sawant Group ERP

**Layout of this plan** (mirrors plan 03): this file is the index and holds sections 0, 1, 3, 9, 10, 11, 13, 14, 15 and the ticket index of section 12. Details: `04a-UI-PAGES.md` (section 2, the 18 frozen pages), `04b-PROCESSES-DB.md` (section 4 processes, section 5 database), `04c-RULES-API-REPORTS.md` (sections 6, 7, 8: business rules, API, reports), `04d-TICKETS.md` (section 12 full tickets). Read `00-BUILDER-RULES.md`, `01-SHARED-FOUNDATION.md` and `03-SCM-PROCUREMENT.md` (+ `03a/03b/03c`) first: this plan **extends** what plan 03 builds (`parties`, `payment_terms`, `tax_codes`, `tax_code_rates`, `hsn_sac`, `document_links`, `TaxService`, `PartyService`, typed-page plumbing, `PanelView`, `LinesEditor`) and never redefines it.

## 0. Header

**Purpose.** Build the customer side of the Sawant Group ERP for the three units (Talwade TAL, Sawardari SAW, Varale VAR; FY April-March; ₹, `en-IN`): **CRM** (lead → qualification → opportunity → Kanban pipeline, follow-ups, meetings and calls, Customer 360°, customer feedback / NPS, lead sources) and **Sales / quote-to-cash** (price lists with customer pricing and quantity slabs, quotations with revisions and approval, sales orders, stock reservations, delivery scheduling, dispatch with e-way bill and POD, GST sales invoices with e-invoice (IRN) handling, collections with allocation and TDS, credit limits and holds, sales returns and credit notes). 18 pages: 8 CRM + 10 Sales.

**Who it serves.** Owner department **Sales** (sales reps, sales managers). Also **Finance** (invoices, receipts, credit control, e-invoice), **Warehouse** (reservation, pick, pack, dispatch, returns), **Service** (customer 360, feedback). Approvers: Sales Manager (discount, margin, order value), Credit Controller (holds, overrides).

**Dependencies (build order).** Needs Phase 1-5 code and, **in this order**: plan 02 (Inventory: `accounting_event_queue`, `AccountingService.post` stub, optional batch/serial/reservation), plan 03 (SCM: `parties`, `party_addresses`, `party_contacts`, `payment_terms`, `tax_codes`, `tax_code_rates`, `hsn_sac`, `document_links`, `TaxService`, `PartyService`, typed-page plumbing `modules/scm/shared/*`, `PanelView`/`LinesEditor` web components, error helpers). The first migration of this plan starts with a **guard** that fails with a clear message when one of these is missing (ticket T-SAL-01/02 → `STATUS: QUESTION`). All Inventory touch-points (availability, reservation, issue, return receipt) go through **one adapter file** `modules/sales/stock-port.ts` so plan 02 can plug in later. Feeds plan 05 (Finance drains `accounting_event_queue` events `SALES_INVOICE_POSTED`, `DELIVERY_POSTED`, `RECEIPT_RECEIVED`, `CREDIT_NOTE_POSTED`, `SALES_RETURN_POSTED`; reads the views `v_sales_receivable`, `v_customer_ledger`; implements the real IRP gateway).

**Foundation items this plan uses:** standard columns (§2), `parties` customer side (§3.1), `payment_terms`, `tax_codes`/`tax_code_rates`/`hsn_sac` and `TaxService.compute(db, input)` (SCM), `document_links` (§3.4), `NumberingService` via `recordRepository.nextNumber` (existing `number_series`), `StockService.postMovement` (exists, `stock/posting.ts`), `AccountingService.post` (stub of plan 02), `ApprovalService` (Phase 6; until then **this plan has its own light approval inside each document** — `approval_status` PENDING/APPROVED with segregation of duties, BR-SAL-22; it does **not** use the SCM interim engine because the sales approval rules are discount/margin/value based, not department/amount ladders), status vocabulary (§6).

**FOUNDATION-CHANGE items (the architect decides; the builder never decides):**
1. `FOUNDATION-CHANGE:` **Statutory document numbers** (sales tax invoice and credit note) use a compact form of at most 16 characters (`TAL/2627/00001`, `CN/TAL/2627/0001`) instead of `<PFX>/<UNIT>/<FY>/<0001>` (20+ characters), because GST Rule 46 / Rule 53 limit the serial number to 16 characters and the IRP rejects longer numbers. They are numbered **at post**, not at create (gap-free, BR-SAL-43). All other documents keep the foundation format with `FY = fy.code.slice(2)` (`SO/TAL/26-27/0001`), as plan 03 does.
2. `FOUNDATION-CHANGE:` `stock_ledger.voucher_type` CHECK gets two values `DELIVERY` and `SALES_RETURN` (the constraint is owned by plan 02, which may add more): our migration rebuilds the list from the live constraint (T-SAL-02).
3. `FOUNDATION-CHANGE:` `document_links.from_type` / `to_type` CHECK (plan 03 §5.3, `varchar(12)`) gets `LEAD`, `OPP`, `DLP`, `DSP`, `CN`, `SRET`, `COL` (we reuse `QUOTATION`, `SO`, `SINV`; the dispatch uses `DSP`, not `DELIVERY`): rebuilt from the live constraint (T-SAL-02).
4. `FOUNDATION-CHANGE:` foundation §7 gives "Receipt / Payment" to Finance. The page `sales-collections` is Sales, so **customer receipts and their allocation to sales invoices are built here** (`sales_collections`, `sales_collection_allocations`); Finance consumes the event `RECEIPT_RECEIVED` for bank/cash journals and reconciliation and owns supplier payments.
5. `FOUNDATION-CHANGE:` `PanelView` section vocabulary of plan 03 (C6) is **extended** with `funnel`, `bars`, `timeline`, `calendar`, `board` (T-SAL-15); existing section types are unchanged; `LinesEditor.lineKind` gets `qtn|so|dsp|inv|cn|ret|plan`.
6. `FOUNDATION-CHANGE:` `FieldMeta.lookup` union widened with `customers, leads, leadCustomers, relatedRecords, opportunities, quotations, salesOrders, invoices, dispatches, priceLists, leadSources, lossReasons, competitors`; `FieldMeta.suffix?: string` (display suffix such as `/10`); `ScmTypedSchema`-like type reused as `SalesTypedSchema` (T-SAL-06).
7. `FOUNDATION-CHANGE:` new audit actions and target types (04b §5.2.3); new error codes (04c §6.99).
8. `FOUNDATION-CHANGE:` tables created here that the foundation did not list: `sales_config`, `crm_*`, `credit_profiles`, `credit_holds`, `sales_collection_actions`, `customer_item_prices`.

## 1. Scope and status

**Status of every page today:** all 18 are served by the generic engine (`generic_records` JSONB) or, for `crm-pipeline`, are a `custom` placeholder (static Kanban). **Added by this plan:** typed tables, services, real tabs. No page, tab or field is renamed. Registry facts: 8 CRM + 10 Sales = 18 pages; 108 profile tabs (6 each).

| # | Page id | Title | Owner dept | Kind today → after | Register tab | Tables |
|---|---|---|---|---|---|---|
| 1 | `crm-leads` | Lead Management | Sales | generic → typed | Lead Register | `leads` |
| 2 | `crm-opportunities` | Opportunity Management | Sales | generic → typed | Opportunity Register | `opportunities`, `opportunity_stage_history` |
| 3 | `crm-pipeline` | Sales Pipeline / Kanban | Sales | custom (static board) → typed + Kanban | first tab (board) | view over `opportunities` |
| 4 | `crm-followups` | Follow-ups & Tasks | Sales | generic → typed | Outcome Log | `crm_followups` |
| 5 | `crm-meetings` | Meetings & Calls | Sales | generic → typed | Call Log | `crm_meetings` |
| 6 | `crm-customer360` | Customer 360° | Sales | generic → typed | first tab (profile) | view over `parties` |
| 7 | `crm-feedback` | Customer Feedback | Sales | generic → typed | Feedback Inbox | `crm_feedback` |
| 8 | `crm-sources` | Lead Sources | Sales | generic → typed | Source Master | `lead_sources` |
| 9 | `sales-quotations` | Sales Quotations | Sales | generic → typed | Quotation Register | `sales_quotations` (+lines, revisions) |
| 10 | `sales-orders` | Sales Orders | Sales | generic → typed | Order Register | `sales_orders` (+lines) |
| 11 | `sales-reservations` | Stock Reservations | Sales | generic → typed | Reservation Queue | `sales_reservations` |
| 12 | `sales-delivery` | Delivery Scheduling | Sales | generic → typed | first tab | `sales_delivery_plans` (+lines) |
| 13 | `sales-dispatch` | Dispatch | Sales | generic → typed | Dispatch Queue | `sales_dispatches` (+lines) |
| 14 | `sales-invoices` | Sales Invoices | Sales | generic → typed | Invoice Register | `sales_invoices` (+lines), `sales_credit_notes` (+lines) |
| 15 | `sales-collections` | Collections | Sales | generic → typed | Collection Worklist | `sales_collections`, allocations, actions |
| 16 | `sales-pricelist` | Price Lists | Sales | generic → typed | Price List Master | `price_lists`, `price_list_items`, `customer_item_prices` |
| 17 | `sales-credit` | Credit Limits | Sales | generic → typed | first tab | `credit_profiles`, `credit_holds` (+ `parties`) |
| 18 | `sales-returns` | Sales Returns | Sales | generic → typed | Return Register | `sales_returns` (+lines) |

**Visible also to:** Finance (invoices, collections, credit, returns, orders, customer 360), Warehouse (orders, reservations, delivery, dispatch, returns), Service (customer 360, feedback, invoices) — by the department-family grants (configuration) plus the read rule BR-SAL-60.

**What exists vs what is added.** Exists: generic engine for all pages except the static Kanban; items, warehouses, stock ledger and balances; units, FY; plan 03 shared masters. Added: 36 new tables + 2 views, ~45 endpoints, 90 panel builders for the 108 profile tabs, Kanban drag board, line editor tabs, nightly jobs, five PDF templates, event payloads for Finance. **Not in scope (backlog, section 9):** foreign-currency billing, EDI schedules, real IRP/e-way API client (plan 05), Phase 6 approval engine, WhatsApp/e-mail sending (Communication module).

## 2. The frozen UI, page by page — SUMMARY (full text in `04a-UI-PAGES.md`)
All 18 pages, with the 6 registry tab names, one line per tab (data source and prototype renderer), full field tables with keys/types/required marks from `field-types.json`, statuses, row actions, filters, totals, empty states. Placeholders (`crm-pipeline`, `crm-customer360`) keep the generic frozen fields as register columns and get the real UI inside their tabs.

## 3. How the market does it

| Concept | Odoo | ERPNext | Zoho (CRM / Books / Inventory) | SAP (B1 / S4 SD) | Dynamics 365 Sales | Tally Prime | Salesforce / HubSpot | Decision for us |
|---|---|---|---|---|---|---|---|---|
| Lead → opportunity | Lead converts to opportunity, pipeline kanban with stage probability and expected revenue, lost reasons, activities, predictive scoring | Lead → Opportunity → Quotation, customer created on conversion | Lead scoring rules (manual + AI), Blueprint with mandatory fields per transition | Lead/opportunity in CRM add-on | Business process flow Qualify → Develop → Propose → Close; qualifying a lead creates the opportunity | n/a | Stages with default probability and forecast categories (Pipeline/Best Case/Commit); scoring = fit + engagement with decay | **Adopt**: stage table with probability + forecast category, gates per stage (Zoho Blueprint idea), lead score = fit + engagement with decay (HubSpot), conversion creates customer + opportunity (Dynamics/ERPNext). **Skip** AI scoring (no data), kept rule-based |
| Pipeline UI | Drag cards, rotting deals | Kanban on opportunities | Kanban + forecast | n/a | Pipeline view | n/a | Kanban + forecast | **Adopt** drag with server-side gates, stale marker (BR-SAL-76) |
| Quotation | Quotation with validity, options, pricelist, optional lines | Quotation addressed to lead or customer; amendment | Estimates with expiry; convert to SO/invoice | Quotation → order | Quote revisions, quote → order | n/a (no quotations in core) | CPQ approvals by discount | **Adopt** revisions with snapshots, validity + expiry job, discount/margin approval (CPQ idea). **Skip** CPQ bundles |
| Pricing | Pricelists with rules: fixed, discount, formula; min qty; customer specific | Price List + Pricing Rule (qty slabs, validity, margin) | Price lists per item (markup/discount) | Pricing procedure with condition types and sequence (customer, price list, discount, surcharge) | Price lists with discount lists, price list items | Price levels | Price books | **Adopt** a deterministic resolution order customer → list slab → list default → item price (SAP condition-sequence idea) with a returned trace; one best promo, no stacking. **Skip** formula pricing |
| Order & invoicing policy | "Invoice what is ordered / delivered" (ordered default; delivered requires validated delivery) | Delivery Note and Sales Invoice optional via Selling Settings; partial delivery/billing; short close | Sales order → package → shipment → invoice | Order → delivery → billing document; billing block | Order → invoice | Sales order voucher → delivery note → sales voucher | n/a | **Adopt** per-order `invoice_policy` On Delivery / On Order; invoice from dispatch lines; backorder = open qty; short-close |
| Reservation | Reserve at confirm | Reserved qty in bin | Committed stock | ATP check, reservation | n/a | n/a (batch allocation) | n/a | **Adopt** reservation per order line with expiry and priority; availability = on hand − reserved |
| Credit control | Credit limit by add-on (third parties): block or warn at confirm | Credit limit per customer/company, bypass role | Credit limit warnings | **Automatic credit management**: exposure check at order/delivery/goods issue, block, release by authorised user, rechecks; known issue: released documents can be re-blocked | Credit hold flag | Credit limit + days with warning/ block | n/a | **Adopt** SAP-style exposure (AR + open orders − advances), check at approve and dispatch, release with reason and segregation, override with expiry. **Pitfall avoided**: re-block surprise → override valid until a date and logged |
| E-invoice / e-way | via localisation | via India Compliance app | E-invoicing and e-way inside Books | via partner | via partner | Generate IRN and QR from the sales voucher; e-way in same step; IRP rejects numbers starting with 0, / or - | n/a | **Adopt** `EInvoiceGateway` interface, applicability by AATO setting, 30-day window alert (day 25), IRN cancel within 24 h, ≤16-char numbers; real client is plan 05 |
| Returns / credit note | Credit note from invoice | Credit note against invoice | Credit notes | Returns delivery + credit memo | Return order | Credit note voucher (sales return) | n/a | **Adopt** return → receive (stock at original cost) → credit note; Section 34 deadline flag |
| Collections | Follow-ups via activities | Payment Entry with references; dunning | Payment reminders | Dunning, payment run | n/a | Receipt voucher with bill-wise allocation | n/a | **Adopt** bill-wise oldest-first allocation, advances, promise-to-pay log, escalation ladder |
| Customer 360 | Partner form smart buttons | Customer dashboard with activities | Customer overview | BP overview | Account hierarchy and timeline | Ledger view | Account page | **Adopt** unified timeline + KPIs + exceptions |
| Feedback / NPS | Surveys | Feedback via issue | Surveys | n/a | Customer Voice | n/a | NPS survey | **Adopt** NPS/CSAT fields with detractor follow-up |
| Automotive schedules | Scheduling agreements (add-on) | Blanket order | n/a | Scheduling agreements with forecast (FRC) and JIT releases (VDA/AIAG/Odette) | n/a | n/a | n/a | **Backlog** (X-10): customer delivery schedules; customer part numbers are **adopted now** (`customer_item_prices.customer_part_no`) |

Complaints and pitfalls found in the research and how we avoid them: credit blocks that re-apply after release (SAP notes) → override with expiry; Odoo needs a validated delivery before invoicing on delivered qty (confusing errors) → we show the exact missing quantity (`NOTHING_TO_INVOICE`); duplicate leads from web forms → duplicate rules BR-SAL-73; probability treated as truth although forecasts need calibration → calibration rows in the Forecast tab; score decay is needed or stale leads look hot (HubSpot) → decay in BR-SAL-71; e-invoice 30-day block surprises users → warning from day 25.

## 4. End-to-end processes — SUMMARY (full text with diagrams in `04b-PROCESSES-DB.md` §4)
4.1 Lead capture and qualification; 4.2 lead → opportunity → quotation → sales order; 4.3 order → reservation → delivery/dispatch → invoice → e-invoice / e-way → collection; 4.4 returns and credit notes; 4.5 credit hold and release; 4.6 price approval; 4.7 pipeline stage gates; 4.8 customer feedback / NPS loop. Each has numbered steps, actors, statuses and a mermaid diagram.

## 5. Database design — SUMMARY (full DDL, Prisma, seeds, migrations in `04b-PROCESSES-DB.md` §5)
36 new tables + 2 views in 6 migrations `20261201000000_sal_foundation` … `20261201000500_sal_billing`; ALTERs of `parties`, `stock_ledger`, `document_links`. Tables: `sales_config`, `crm_pipeline_stages`, `lead_sources`, `crm_loss_reasons`, `crm_competitors`, `leads`, `crm_followups`, `crm_meetings`, `crm_timeline_entries`, `opportunities`, `opportunity_stage_history`, `crm_feedback`, `price_lists`, `price_list_items`, `customer_item_prices`, `sales_quotations`, `sales_quotation_lines`, `sales_quotation_revisions`, `sales_orders`, `sales_order_lines`, `sales_reservations`, `credit_profiles`, `credit_holds`, `sales_delivery_plans`, `sales_delivery_plan_lines`, `sales_dispatches`, `sales_dispatch_lines`, `sales_invoices`, `sales_invoice_lines`, `sales_credit_notes`, `sales_credit_note_lines`, `sales_returns`, `sales_return_lines`, `sales_collections`, `sales_collection_allocations`, `sales_collection_actions` (36 tables; ERD in 04b §5.1).

## 6. Business rules and formulas — SUMMARY (full text in `04c-RULES-API-REPORTS.md` §6)
`BR-SAL-01 … BR-SAL-92` in groups: 01-09 totals/tax/place of supply; 20-28 pricing, approval, quotation, order; 30-39 stock, reservation, partial delivery, dispatch; 40-48 receipts, e-way, e-invoice, returns, credit notes, TDS; 50-54 credit; 60-62 scope and parties; 70-76 CRM; 80-90 KPIs; 91-92 concurrency and dates. Each has the rule, exact formula, a worked numeric example, error code and ticket.

## 7. API design — SUMMARY (full endpoint table E1-E.. in `04c` §7)
Typed pages use the existing `/pages/:pageId/records…` shapes plus panels `GET /pages/:pageId/records/:id/panels/:panelKey` and `GET /pages/:pageId/panels/:panelKey` (plan 03 C6), "create from" endpoints under `/api/v1/sales`, Kanban `PATCH /api/v1/crm/opportunities/:id/stage`, lookups under `/api/v1/lookups`, reports under `/api/v1/sales/reports` and `/api/v1/crm/reports`.

## 8. Reports and KPIs — SUMMARY (full definitions in `04c` §8)
Pipeline value, weighted pipeline, win rate, lead conversion, quote → order, sales by customer / item / unit / month, margin, OTIF, DSO, ageing, top customers, discount leakage, NPS, source ROI.


## 9. Extra functions beyond the prototype `[ADD]`

Priority: **MUST** = in the tickets, needed for a correct business flow; **SHOULD** = in the tickets or a small follow-up ticket; **COULD** = backlog. "Source" = where the idea was seen (ideas only, nothing copied).

| # | Extra | Pri | Rationale | Source | In tickets? |
|---|---|---|---|---|---|
| X-01 | Lead duplicate detection (mobile, e-mail, fuzzy company) with override | MUST | duplicate leads waste calls and split history | Zoho, HubSpot, Odoo merge | T-SAL-11 |
| X-02 | Lead scoring (rule based, decay) | MUST | prioritise follow-up; stale leads must cool | Zoho scoring rules, HubSpot decay | T-SAL-11 |
| X-03 | Stage gates and loss reasons on the pipeline | MUST | forecast quality; lost-reason analytics | Zoho Blueprint, Dynamics BPF | T-SAL-12 |
| X-04 | Unified timeline per lead / opportunity / customer | MUST | Customer 360 and audit of conversations | Dynamics, Odoo chatter | T-SAL-08 |
| X-05 | Consent register for marketing messages (DPDP) | MUST | statutory; WhatsApp/SMS campaigns need it | DPDP Act 2023 / Rules 2025 | T-SAL-08 |
| X-06 | Price resolution trace and customer-specific prices | MUST | users must see why a price was chosen | SAP condition technique, ERPNext Pricing Rule | T-SAL-18 |
| X-07 | Discount authority and margin floor approval | MUST | prevents leakage; segregation of duties | CPQ approvals, ERPNext margin | T-SAL-19 |
| X-08 | Quotation revisions with snapshots | MUST | negotiation history, audit | Odoo, ERPNext amendment | T-SAL-19 |
| X-09 | Credit exposure check, holds, override with expiry | MUST | bad debt control | SAP automatic credit management | T-SAL-22 |
| X-10 | Customer delivery schedules / forecast releases (automotive: weekly buckets, JIT) | COULD | OEM customers send schedules instead of POs | SAP scheduling agreements (VDA/AIAG/Odette) | backlog |
| X-11 | Customer part number and description per item | SHOULD | OEM documents use their own part numbers | SAP customer-material info | T-SAL-18 (`customer_item_prices`) |
| X-12 | Packing standard / packing instruction per customer-item | COULD | automotive packing specs | SAP packing proposals | backlog |
| X-13 | Price-change notes (customer price revision with effective date and retro difference credit note) | SHOULD | automotive price revisions are applied retro | industry practice (unverified) | backlog (uses credit-note "Rate Difference", T-SAL-29) |
| X-14 | Early-payment discount on invoices (`payment_terms.early_discount_*`) | COULD | collections incentive | Zoho, Tally | backlog |
| X-15 | Warranty / serial-based service history link | COULD | Service module needs serials sold | Service plans | backlog |
| X-16 | Over-delivery tolerance and short-close | MUST | real partial deliveries | ERPNext, SAP | T-SAL-21/25 |
| X-17 | Delivery challan for job work and returnable goods with return tracking | SHOULD | Rule 55; job work return deadlines | CGST Rule 55 | challan type in T-SAL-25; return tracking backlog |
| X-18 | E-invoice IRN window alert (day 25 of 30) | MUST | IRP rejects after 30 days for AATO ≥ ₹10 Cr | GSTN advisory | T-SAL-27/31 |
| X-19 | E-way bill rule engine and validity calculator | MUST | transport legality | CGST Rule 138 | T-SAL-25 |
| X-20 | Foreign-currency export billing with exchange rate | COULD | export customers | Odoo, ERPNext | backlog (INR only) |
| X-21 | Receipt allocation oldest-first, advances, TDS receivable | MUST | bill-wise ledger | Tally | T-SAL-28 |
| X-22 | Promise-to-pay log and dunning ladder | SHOULD | collection discipline | ERPNext dunning | T-SAL-28/33 |
| X-23 | Customer statement (JSON and PDF) with ageing | SHOULD | customers ask for statements | Tally, Zoho Books | T-SAL-32/34 |
| X-24 | Sales returns with disposition and original-cost stock-in | MUST | correct inventory value | ERPNext, SAP | T-SAL-29 |
| X-25 | Section 34 credit-note deadline flag | MUST | GST cannot be reduced after 30 Nov | CGST Act s.34 | T-SAL-29 |
| X-26 | Reservation expiry and priority allocation | SHOULD | stale reservations block stock | ERPNext, Zoho committed stock | T-SAL-23/33 |
| X-27 | OTIF measurement with re-promise history | SHOULD | customer scorecards (automotive) | SAP, industry | T-SAL-24 |
| X-28 | Customer tier (A/B/C) and stage (active / at risk / dormant) | SHOULD | account management | Salesforce account tiers | T-SAL-33 |
| X-29 | NPS / CSAT with detractor follow-up | SHOULD | closes the feedback loop | Salesforce, HubSpot | T-SAL-14 |
| X-30 | Public lead capture endpoint with key and consent flag | SHOULD | website forms | Odoo, Zoho web forms | T-SAL-11 |
| X-31 | Round-robin lead assignment | SHOULD | fair distribution | Zoho assignment rules | T-SAL-11 (capture) |
| X-32 | Forecast calibration rows (planned vs actual win rate) | COULD | probability must be calibrated | Salesforce guidance | T-SAL-16 |
| X-33 | Customer credit note application to other invoices | COULD | remainder usage | Tally | backlog |
| X-34 | Duplicate receipt reference guard | MUST | double entry of the same UTR | Tally bill-wise | T-SAL-28 |
| X-35 | Sales order from a customer PO file / EDI | COULD | OEMs send EDI | SAP EDI | backlog |
| X-36 | Drop-ship (supplier delivers to customer) | COULD | trading items | ERPNext | backlog |
| X-37 | Item weights for load planning | COULD | Q-07 | — | backlog |

## 10. Edge cases and careless-user scenarios (each is one `it()` in `tests/sales-breakit.test.ts`, ticket T-SAL-37, unless a file is named)

| ID | Scenario | Exact safe behaviour | Proving test |
|---|---|---|---|
| S-01 | Two people create a lead with the same mobile | second gets 409 `DUPLICATE` with `matches`; unique index backs it | `crm-leads.test.ts` |
| S-02 | Company name 90 % similar | success with `warnings[SIMILAR_LEAD]` | `crm-leads.test.ts` |
| S-03 | Convert the same lead twice (double click) | second 409 `CONFLICT`, one customer, one opportunity | `crm-leads.test.ts` |
| S-04 | Drag a deal to Won without accepted quotation | 422 `STAGE_GATE_FAILED`, card snaps back | `crm-pipeline.test.ts` |
| S-05 | Two reps drag the same card at once | one succeeds; other 409 `VERSION_CONFLICT` | `crm-pipeline.test.ts` |
| S-06 | Delete a lead / customer that has documents | 409 `IN_USE`; deactivate instead | breakit |
| S-07 | Marketing message to a lead with withdrawn consent | `canMarket` false; reason text; transactional still allowed | `crm-consent.test.ts` |
| S-08 | Follow-up dated yesterday | 422 `DATE_IN_PAST` | `crm-followups.test.ts` |
| S-09 | Quotation to a Blocked customer | 422 `CUSTOMER_BLOCKED` | breakit |
| S-10 | Rate typed "1,000" or negative qty | parsed to 1000 / 422 field error on `lines[n].qty` | breakit |
| S-11 | Discount above authority | status Submitted / PENDING; creator cannot approve (403 `SELF_APPROVAL_FORBIDDEN`) | `sales-quotations.test.ts` |
| S-12 | Edit a Sent quotation | 409 `RECORD_LOCKED`; use `revise` | `sales-quotations.test.ts` |
| S-13 | Create-order twice from one quotation | second 409 `QUOTATION_ALREADY_CONVERTED` | `sales-orders.test.ts` |
| S-14 | Same customer PO on two orders | 409 `DUPLICATE_PO` until `confirmDuplicate` | `sales-orders.test.ts` |
| S-15 | Order beyond credit limit | On Hold, hold row, reason shown; dispatch 409 `CREDIT_HOLD` | `sales-credit.test.ts` |
| S-16 | Creator releases own hold | 403 `SELF_APPROVAL_FORBIDDEN` | `sales-credit.test.ts` |
| S-17 | Two parallel orders that jointly exceed the limit | exactly one approved, other On Hold | `sales-credit.test.ts` |
| S-18 | Reserve more than available | partial reservation, short qty shown; never negative available | `sales-reservations.test.ts` |
| S-19 | Dispatch more than open qty | 422 `QTY_EXCEEDS_OPEN` | `sales-dispatch.test.ts` |
| S-20 | Dispatch with not enough stock | 409 `INSUFFICIENT_STOCK`, nothing changed | `sales-dispatch.test.ts` |
| S-21 | Double click on Dispatch / Post (same key, and different key) | same key: replay; different key: 409 `CONFLICT`; one ledger row | `sales-dispatch.test.ts` |
| S-22 | Dispatch before invoice (Sale) | 409 `INVOICE_REQUIRED` | `sales-dispatch.test.ts` |
| S-23 | Consignment above ₹50,000 without e-way bill | 409 `EWAY_REQUIRED`; expired validity 409 `EWAY_EXPIRED` | `sales-dispatch.test.ts` |
| S-24 | Edit or delete a posted invoice (API and raw SQL) | 409 `RECORD_LOCKED`; trigger raises | `sales-invoices.test.ts` |
| S-25 | Backdated invoice | 409 `INVOICE_DATE_BEFORE_PREVIOUS` | `sales-invoices.test.ts` |
| S-26 | Delete a Draft invoice | no number consumed; next post gets the next number | `sales-invoices.test.ts` |
| S-27 | Invoice more than delivered/ordered | 422 `QTY_EXCEEDS_UNINVOICED` | `sales-invoices.test.ts` |
| S-28 | Customer GSTIN changed after IRN | invoice keeps its snapshot `billing_gstin`; the party edit is allowed but the invoice field is read-only | `sales-invoices.test.ts` |
| S-29 | Generate IRN after 30 days (aato ≥ ₹10 Cr) / cancel IRN after 24 h | 409 `IRN_WINDOW_EXPIRED` / `IRN_CANCEL_WINDOW` | `sales-einvoice.test.ts` |
| S-30 | Receipt allocated beyond balance, TDS above balance, cash ≥ ₹2 lakh | 422 `ALLOCATION_EXCEEDS_BALANCE` / `TDS_EXCEEDS_BALANCE` / `CASH_LIMIT_EXCEEDED` | `sales-collections.test.ts` |
| S-31 | Same UTR entered twice | 409 `DUPLICATE` | `sales-collections.test.ts` |
| S-32 | Return more than invoiced (with another return pending) | 422 `RETURN_QTY_EXCEEDS_INVOICED` | `sales-returns.test.ts` |
| S-33 | Credit note after 30 Nov following the FY | `gst_adjusted = false`, tax 0, warning | `sales-creditnotes.test.ts` |
| S-34 | Action in a closed FY / future-dated document | 409 `PERIOD_CLOSED` / 422 `DATE_IN_FUTURE` | breakit |
| S-35 | User without permission or outside data scope opens a record | 403 on action; 404 on the row | each page test |
| S-36 | Stale `If-Match` on any PATCH | 409 `VERSION_CONFLICT` | each page test |

## 11. Test plan

**Layers** (one vitest process at a time, builder rule 3.4): **Unit** (`tests/unit/**`): pure functions: calc (`computeSalesDocumentPure`), price resolution, scoring, stage gates, credit evaluation, risk score, allocation, credit-note computation, OTIF status, event builders (balance), invoice number format, amount in words, state codes. **API** (`tests/*.test.ts`, supertest, `sales-helpers.ts`): every page (H5 of 04d), every endpoint E1-E41, permissions, scope, audit, idempotency. **Schema** (`sales-schema.test.ts`, `sales-schema-parity.test.ts`): frozen fields = fixture; tables = Prisma. **Simulation** (`sales-simulation.test.ts`): invariants. **e2e** (`tests/e2e/sales.spec.ts`).

**Numbered scenarios with data and expected numbers (all numbers also appear in the BR examples):**
1. *Totals.* 10 nos × ₹1,250.00, 5 % discount, GST 18 % intra, freight 500 → taxable 12,375.00; CGST 1,113.75; SGST 1,113.75; grand 14,603; round-off +0.50 (BR-SAL-02). Inter-state: IGST 2,227.50.
2. *Freight split.* 500 over taxable 11,875 @18 % and 4,000 @5 % → shares 374.02 / 125.98; half-taxes 1,102.41 / 103.15.
3. *Price.* item 1,000; Dealer list 8 %: qty 10 → 920; slab 850 at 100; customer 800 at 50 (BR-SAL-20).
4. *Margin.* net 900, cost 760 → 15.5556 %; cost 850 → 5.5556 % below floor 10.
5. *Lead score.* 96; with 65 days inactivity 86 (BR-SAL-71).
6. *Pipeline.* weighted forecast of ₹10,00,000 at 50 % = ₹5,00,000 (Best Case); win rate 12/(12+8) = 60.0 %.
7. *Credit.* limit 10,00,000; AR 4,00,000; advances 50,000; open orders 3,00,000; new order 4,00,000 → exposure 6,50,000, required 10,50,000 → hold; available 3,50,000.
8. *Reservation.* on hand 100, reserved by others 30, need 80 → reserve 70, short 10.
9. *Dispatch.* 10 nos at average 120 → ledger OUT value 1,200.00; COGS Dr 1,200 / Inventory Cr 1,200; stock total unchanged elsewhere.
10. *Invoice posting.* `TAL/2627/00001`; AR Dr 14,603.00 = SALES 12,375.00 + CGST 1,113.75 + SGST 1,113.75 + ROUND_OFF 0.50.
11. *Receipt.* invoices 50,000 and 30,000, receipt 60,000 → 50,000 Paid; 10,000 on the second (balance 20,000); receipt 90,000 → advance 10,000.
12. *TDS.* taxable 1,00,000 at 0.1 % → 100.00; at 2 % → 2,000.00.
13. *Credit note.* 4 of 10 nos → taxable 4,950.00; CGST 445.50; SGST 445.50; grand 5,841.00; remaining 6 → 7,425.00; deadline for FY 2025-26 = 2026-11-30.
14. *Return.* qty rule 3 + 8 > 10 → 422; Restock of 3 at cost 120 → stock value +360.00.
15. *DSO.* AR 24,00,000; 90-day sales 60,00,000 → 36.0 days. *NPS* 5/3/2 → 30.0. *Source ROI* cost 1,40,000, revenue 8,40,000 → 500.00 %.
16. *e-way.* value 72,000, 450 km → required, 3 days validity. *OTIF* table of BR-SAL-89.
17. *Concurrency.* 6 parallel dispatches of the last 4 units → 4 succeed; parallel receipts on one invoice never over-allocate; 2 parallel approvals at the credit limit → one passes.
18. *e2e flow 1* lead → cash (T-SAL-38); *flow 2* credit hold and release; *flow 3* return and credit note; visual parity of `crm-leads`, `crm-pipeline`, `sales-orders` register tabs with `reference/screens/v92`.

## 12. Build tickets — INDEX (full tickets in `04d-TICKETS.md`)
39 tickets `T-SAL-01 … T-SAL-39` in strict dependency order; the index table with titles, dependencies and sizes is at the end of `04d-TICKETS.md` (sizes: S ≤ 4 files, M ≤ 8, L ≤ 12 files and ≈ 900 lines). Groups: **01-06** database and plumbing; **07-08** calculation and shared services; **09-14** CRM data pages; **15-17** panels and CRM reports; **18-24** pricing, quotations, orders, credit, reservations, delivery; **25-29** dispatch, invoices, e-invoice, collections, returns and credit notes; **30-32** sales panels, reports, statement; **33** nightly jobs; **34** PDFs; **35** seeds; **36-38** simulation, break-it, e2e; **39** README. Every business rule `BR-SAL-nn` names its ticket in `04c`.

## 13. Reviewer checklist
Verify, in this order:
1. **Frozen UI.** `sales-schema.test.ts` green; every label, order, type, required mark equals the fixture; `[ADD]` fields only after the frozen ones; tab names equal the registry; no new CSS colours, fonts, layouts; Kanban lane names New, Qualified, Proposal, Negotiation, Won exactly; `crm-pipeline` removed from `CUSTOM_PAGES` and added to `TYPED_PAGES`.
2. **Reuse of plan 03.** No second `parties`, `payment_terms`, `tax_codes`, `document_links` or numbering code; `TaxService.compute` used for all tax; `PanelView`/`LinesEditor` extended, not duplicated; no edit of SCM behaviour (SCM tests green).
3. **Money.** No `number` arithmetic on money (grep `parseFloat|Number(` near amounts); `Decimal` and `round2/round0`; totals from the server only; round-off sign; freight shares sum exactly to the freight.
4. **Tax.** Place of supply default and override; IGST vs CGST+SGST; rates from `tax_code_rates` by date; invoice re-resolves tax at the invoice date; LUT / bill-of-supply rules; no TCS field anywhere.
5. **Numbering.** SO/QTN etc. gap-free in the insert transaction; **invoice and credit-note numbers only at post**, ≤ 16 characters, no gap after deleting a Draft; collection number at post.
6. **Immutability.** Posted invoices, credit notes and dispatched lines cannot change (API and trigger); cancellations are reversals; append-only tables have triggers.
7. **Stock.** One touch-point `stock-port.ts`; `postMovement` types `DELIVERY` / `SALES_RETURN`; negative stock impossible; reversal restores exact value; reservation never exceeds on hand; rollback on any failure.
8. **Locks and idempotency.** `Idempotency-Key` on money/stock actions; status re-checked after the lock; the lock order of BR-SAL-91; parallel tests exist and pass.
9. **Permissions and scope.** Every route `requirePageAction`; `approve` actions need a different user; cross-department read table only as in BR-SAL-60; out-of-scope = 404; the public lead-capture route is the only unauthenticated route and uses a constant-time key compare and a rate limit.
10. **Credit.** Exposure formula exactly BR-SAL-50; override has an expiry; auto-release writes who and why.
11. **CRM.** Duplicate rules; scoring boundaries; stage gates; consent gating; converted lead locked.
12. **Events.** Every posting writes one balanced event, idempotent per `(event, doc_type, doc_id)`; reversal events exist.
13. **No fake data.** No demo rows, no hash-generated numbers in any panel; empty states exact.
14. **Tests.** Each ticket's tests exist and are not weakened; simulation and break-it suites present; the parity test lists every table.
**Likely builder mistakes:** (a) numbering invoices at create; (b) computing tax in the web `LinesEditor`; (c) using `INV/…` 20-character numbers; (d) forgetting `FOR UPDATE` before reading availability or invoice balance; (e) updating `paid_amount` through Prisma (generated `balance` column) instead of SQL; (f) counting On Hold orders in the credit exposure; (g) allowing the approver to equal the creator; (h) returning lines on list endpoints; (i) leaving `crm-pipeline` in `CUSTOM_PAGES` so the generic engine answers 404; (j) editing an applied migration; (k) using `Date.now()` inside jobs (tests inject `now`); (l) deleting a whole table in test `afterAll`.

## 14. Open questions and decisions taken (defaults apply until the owner answers)

| # | Question | Default taken |
|---|---|---|
| Q-01 | Is the company's AATO above ₹5 Cr (e-invoicing on) and ≥ ₹10 Cr (30-day limit)? | `sales_config.aato = 0`, e-invoice off; Finance enters AATO; thresholds are data |
| Q-02 | Which IRP/e-way provider (GSP) will be used? | Interface only (`EInvoiceGateway`); mock for tests; real client in plan 05 |
| Q-03 | State-specific intra-state e-way thresholds? | Single `eway_threshold` (₹50,000) editable in config |
| Q-04 | Must the IRN exist before the goods leave? | Warning only (documents checklist), no block |
| Q-05 | Commercial credit note after the Section 34 deadline: credit only the taxable value? | Yes (`gst_adjusted = false`, tax 0), Finance may override later |
| Q-06 | Who schedules the nightly jobs (cron / pm2)? | Provided as `npm run sales:nightly` and `POST /sales/jobs/nightly`; deployment schedules it daily at 02:00 IST |
| Q-07 | Item weights for load planning? | Not in the item master; weight typed on the dispatch |
| Q-08 | Exact customer tax-deduction rules (TDS) per customer? | `deducts_tds` + rate on the customer, default 2 % in config; informational |
| Q-09 | Should customer credit be company-wide or per unit? | Company-wide (all units) |
| Q-10 | Approval engine: use the Phase 6 `ApprovalService` later? | Not yet; sales uses document-level approval; a later ticket swaps `approval/discount.ts` |
| Q-11 | Batch / serial balances for issue (FEFO)? | Not until plan 02 ships batch balances; recorded only |
| Q-12 | Foreign currency billing? | INR only in v1 (X-20 backlog) |
| Q-13 | Can marketing consent expire? | 24 months (config) |
| Decisions | D-01 freight apportioned to lines at their own tax rate; D-02 invoice numbered at post; D-03 tax invoice and credit note use compact numbers; D-04 customer receipts built in Sales; D-05 reservations are Sales-owned rows with a stock port; D-06 credit exposure includes undelivered open orders and subtracts advances and unapplied credit notes; D-07 returns restock at the original dispatch cost | as stated |

## 15. Sources
URLs actually opened or returned by the searches and used for ideas or facts (a fetch that failed is marked). Statutory statements are cross-checked against at least one secondary source and marked "(unverified)" in the text where the primary text could not be opened.
* e-invoice threshold and 30-day limit: https://www.taxmann.com/post/blog/time-limit-of-30-days-for-reporting-e-invoice-on-irp-portal-for-taxpayers-with-aato-of-10-crores-and-above-gstn-update/ (opened: GSTN advisory dated 5 Nov 2024, AATO ≥ ₹10 Cr, from 1 Apr 2025, invoices, credit and debit notes); https://thetaxcorp.in/article/navigating-the-dual-gst-e-invoicing-thresholds-the-rs-5-crore-mandate-vs-the-30 ; https://taxguru.in/?p=1089104 ; https://www.fiscal-requirements.com/news/3480-e-invoicing-30-day-reporting-in-india-threshold-cut-april-2025
* GST 2.0 (56th Council, rates from 22 Sep 2025): https://taxguru.in/goods-and-service-tax/56th-gst-council-meeting-overview.html ; https://cleartax.in/s/56th-gst-council-meet-news ; https://busy.in/gst/gst-2-0-transition-new-slab-rates.md
* E-way bill (₹50,000, Part A/B, validity 1 day per 200 km): https://irisgst.com/?p=52867 ; https://www.smfgindiacredit.com/knowledge-center/eway-bill-gst.aspx ; https://awsdevint.tallysolutions.com/gst/eway-bill-rules/
* Credit notes, Section 34 deadline (30 Nov): https://taxguru.in/goods-and-service-tax/adjustment-tax-liability-refund-gst-credit-note.html ; https://www.cggst.com/uploads/document/1753688693-section-34.pdf ; the CBIC page https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter7/section34_v1.00.html could not be fetched (certificate error): section text taken from the secondary sources (unverified against the primary).
* TCS 206C(1H) no longer applies from 1 Apr 2025: https://calcguru.in/?p=8271 ; https://taxguru.in/income-tax/section-206c1h-tcs-sale-goods.html (secondary sources, unverified against the Finance Act text).
* Delivery challan (CGST Rule 55): https://gstzen.in/a/transportation-of-goods-without-issue-of-invoice-cgst-rule-55.html
* E-invoice in Tally (IRP number rules, e-way with e-invoice): https://help.tallysolutions.com/tally-prime/gst-regular-sales/e-invoicing-in-tallyprime/ ; IRN cancellation within 24 h: https://cleartax.in/s/gst-e-invoice-amend-cancellation
* Place of supply, zero-rated supply / SEZ / LUT: https://www.knowyourgst.com/gstlaw/igst-act/16-zero-rated-supply-190/ ; https://www.bajajfinserv.in/supply-to-sez-under-gst
* DPDP Act 2023 and Rules 2025 (phased commencement): https://www.azbpartners.com/bank/update-indias-digital-personal-data-protection-framework-comes-into-effect/ ; https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf ; https://www.jsalaw.com/wp-content/uploads/2025/11/JSA-Prism-InfoTech-November-2025-DPDP-Rules.Final_.pdf
* ERPNext selling flow, credit limit, pricing rules, partial delivery: https://docs.frappe.io/erpnext/selling.md ; https://docs.frappe.io/erpnext/sales-order
* Odoo invoicing policy: https://www.odoo.com/documentation/18.0/applications/sales/sales/invoicing/invoicing_policy.html ; Odoo CRM pipeline docs index https://www.odoo.com/documentation/18.0/applications/sales/crm/pipeline.html (navigation only); third-party credit limit apps https://apps.odoo.com/apps/modules/17.0/credit_management
* SAP credit management and release: https://masteringsap.com/?p=13880 ; https://userapps.support.sap.com/sap/support/knowledge/en/2828716 ; https://sapinsider.org/make-sap-automatic-credit-management-work-for-you-without-damaging-supply-chain-efficiency/ ; SAP scheduling agreements (automotive): https://learning.sap.com/courses/describing-sap-for-automotive-supply-chain-and-manufacturing/listing-key-features-of-sales-scheduling-agreements-in-sap ; https://help.sap.com/saphelp_46C/helpdata/EN/75/ee0fb555c811d189900000e8322d00/content.htm
* Zoho (scoring, Blueprint, packages and shipments): https://www.zoho.com/crm/process-management.html ; https://www.codestringers.com/articles/zoho-crm-scoring-rules ; https://www.zoho.com/inventory/help/sales-orders/packages.html
* Dynamics 365 Sales (qualify, process flow): https://learn.microsoft.com/en-ca/dynamics365/sales/qualify-lead-convert-opportunity-sales
* Salesforce forecast categories and weighted pipeline: https://www.salesforceben.com/forecast-categories-in-salesforce-everything-you-need-to-know/ ; HubSpot scoring and decay: https://knowledge.hubspot.com/scoring/build-lead-scores
* Repository sources: `PLAN.md` §2, §5, §6; `docs/plan/04-modules.md` §4.2, §4.3; `docs/REGISTRY.csv`; `apps/api/tests/fixtures/field-types.json`; `reference/index.html` (PROFILES, `v9*` renderers, CSS lines 44-65) and the screenshots `fam-02-CRM-crm-leads.png`, `ui-kanban.png`; `apps/api/README-PHASE5.md`; plans `00`, `01`, `03`, `03a`, `03b`, `03c`.

**Claims marked unverified:** GST Rule 46 / 53 sixteen-character serial limit (known rule, not re-opened); IRN hash input order; Section 269ST cash limit applying to receipts of sales; s.194Q TDS rate and limit; bill-to ship-to place of supply nuance; apportionment of freight over lines as the composite/mixed supply treatment; state-specific e-way thresholds; commercial credit note treatment after the Section 34 deadline; whether the e-invoice 5 Cr limit is "greater than" or "at least"; specific GST rates per HSN (never hard-coded here).
