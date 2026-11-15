# 03a — SCM: Section 2 (the frozen UI page by page) and Section 7 (API design)

Part of `03-SCM-PROCUREMENT.md`. Read `00-BUILDER-RULES.md`, `01-SHARED-FOUNDATION.md` and the index first. Table/column names used here are defined in `03b-SCM-DATABASE.md`. Error codes are catalogued in index §6.99 (`03-SCM-PROCUREMENT.md`).

---

# SECTION 2 — THE FROZEN UI, PAGE BY PAGE

## 2.0 Conventions that hold for all 11 pages

**C1. Field keys.** `labelToKey(label)` (see `apps/api/src/engine/keys.ts`). The `data` object of a row, the form, the Excel export and `field-types.json` use these keys. `[ADD]` fields get an explicit camelCase key given below.

**C2. Row shape** is the existing typed shape `{id, code, status, unitId, fyId, department, data, version, amount, createdAt, createdBy, updatedAt, deletedAt, refs}`. `code` = the document number; `amount` = the document's money total (grand total / invoice total / committed value). Lookup fields hold an **id** in `data` and `refs[<key>] = {id, code, name}`.

**C3. Register columns** = the first 11 frozen fields + `Status` (the prototype `registerTab` shows 11 fields; Status is always appended). The schema's `listColumns` must be set explicitly (the inventory helper `define()` cuts at 12 fields: SCM must override it).

**C4. Header + lines.** Documents with lines (PR, RFQ, Quote, Comparison, PO, GRN, Purchase Invoice, Debit Note, Contract) return `data.lines: Line[]` **only** on `GET /pages/:pageId/records/:id` and accept `data.lines` on create/patch (whole array replaces the draft lines; each line has a `lineNo` assigned by the server 1..n). The list endpoint never returns lines. Computed header fields (marked **calc**) are read-only; the server recomputes them on every write; the client value is ignored.

**C5. First-line summary fields.** Frozen fields that look like a single item (PR: Item Service, Specification, Quantity, UOM) are the **Add-form entry of line 1**. On create/patch, if `data.lines` is absent and these keys are present, the server writes/updates line 1 from them. On read they are filled from the lines (`itemService` = line 1 item id, `specification` = line 1 specification, `quantity` = Σ line qty (only when all UOM equal, else line 1 qty), `uom` = line 1 UOM). When more than one line exists the register shows `Item Service` as "<item code> +N more".

**C6. Tab panels.** The six profile tabs get content from `GET /pages/:pageId/records/:id/panels/:panelKey` (record scoped, **R**) or `GET /pages/:pageId/panels/:panelKey` (page scoped, **P**). `panelKey` = tab label in lower-case with non-alphanumerics replaced by `-` (e.g. `Approval & Amendments` → `approval-amendments`). The first profile tab is always the register table. An **R** panel needs a selected row (`?rec=<id>` in the URL, set when the user clicks a register row's name or the new row action `Open workspace`); with no row selected it shows the empty state "Select a record in the register to see its <tab name>." A **P** panel shows aggregates for the unit + FY context.
Panel JSON (one vocabulary, rendered by one web component `PanelView`, using prototype classes `v9-section`, `v9-grid`, `kpis`, `table-wrap`, `v9-stepper`, `notice`):
```json
{ "title": "string", "subtitle": "string",
  "kpis": [{ "label": "string", "value": "string|number", "format": "money|qty|pct|text|date", "tone": "good|warn|bad|null" }],
  "sections": [
    { "type": "table", "title": "string", "columns": [{ "key": "string", "label": "string", "format": "money|qty|pct|date|datetime|text|status" }],
      "rows": [{ "...": "..." }], "empty": "string", "rowActions": [{ "key": "string", "label": "string", "requires": "add|edit|delete|approve", "confirm": "string|null" }] },
    { "type": "stepper", "steps": [{ "label": "string", "state": "done|current|pending|rejected", "note": "string" }] },
    { "type": "facts",   "items": [{ "label": "string", "value": "string" }] },
    { "type": "notice",  "tone": "info|warn|bad", "text": "string" },
    { "type": "lines",   "editable": true, "lineKind": "pr|rfq|vq|po|grn|pi|dn|contract" } ],
  "actions": [{ "key": "string", "label": "string", "variant": "primary|default|danger", "requires": "add|edit|delete|approve", "confirm": "string|null", "endpoint": "string" }] }
```
`type:"lines"` is the only editable section: the web renders `LinesEditor` (ticket T-SCM-31), which reads and writes `data.lines` of the record (PATCH with `If-Match`). Everything else is read-only; buttons call the `endpoint` (POST) or a normal record action.

**C7. Empty states** (exact text): register with no rows → `No <title lower-case> yet. Click ＋ Add to create the first one.`; R panel with no data → `Nothing to show yet for this record.`; P panel with no data → `No data for <unit>, <FY label> yet.`

**C8. Status colours** reuse `statusClass()` of `RegisterTab.tsx`: Draft grey; Submitted / In Process blue; Approved / Posted / Completed / Active green; On Hold / Pending amber; Rejected / Cancelled / Blocked red; Closed / Inactive grey.

**C9. Approval Level text** (calc, wherever the field exists): `L<current> of <total> · <role label>` while Submitted (e.g. `L2 of 3 · Department Head`); `Approved L3` after approval; `Not required` when `approval_status='NA'`; `-` in Draft.

**C10. Unit / FY.** Every document belongs to the context unit and FY (`requireConcreteUnit` on writes). `doc_date` must lie in the FY (422 on the field) and the FY must be OPEN (409 `PERIOD_CLOSED`). Suppliers, tax and payment-term masters are company-wide. Approvals are unit-scoped.

**C11. Edit rules.** Only `Draft` is editable and deletable (409 `RECORD_LOCKED` otherwise). Delete = soft delete with undo token (as inventory). Posted/approved documents are cancelled or amended, never edited. Every action is idempotent (`Idempotency-Key`; status re-check inside the transaction under `SELECT … FOR UPDATE` of the header row).

**C12. Permissions.** `add` creates; `edit` patches and runs submit/release/post/receive-type actions; `approve` approves/rejects/overrides; `delete` deletes Drafts and cancels anything that already moved stock or money; `export` exports. Data scope OWN/DEPARTMENT/ALL applies to documents; masters need only `view`. Finance, Quality and Warehouse read SCM pages through the family access already seeded (the permission matrix is configuration, not code).

**C13. Excel export.** Frozen columns in order + `Status`; lookups as `code - name`; money with 2 dp; totals row on money pages (sum of `amount`). `Export Selected` uses `ids`.

**C14. Header buttons.** `Excel`, `Print`, `＋ Add` exist already. Row action buttons listed per page are the typed `actions` (shown in the row menu and in the drawer). New buttons are tagged `[ADD]`.

---

## 2.1 `scm-pr` — Purchase Requisition (renderer registerTab+; family Procurement / SCM)

**Purpose (frozen):** "Control source-to-pay execution with supplier collaboration, approvals, logistics and three-way matching."
**Tabs (frozen names, prototype renderer → what this plan shows):**

| # | Tab | Scope | Shows / does | Data from |
|---|---|---|---|---|
| 1 | Requisition Register | register | the frozen register; filters; row actions | `purchase_requisitions` |
| 2 | Requirement Details | R | `lines` editor (item, specification, qty, UOM, est. rate, required date, suggested supplier) while Draft; read-only table after; stock cover per line (on-hand, reorder level, open PO qty) | `purchase_requisition_lines`, `stock_balances`, `items`, open PO qty from `document_links` |
| 3 | Budget Availability | R | facts: cost center, FY budget, committed, actual, this PR, available after; verdict OK/WARN/BLOCK per BR-SCM-22; stepper "Within budget → Needs override" | `scm_budgets`, BudgetService |
| 4 | Approval Journey | R | stepper of approval levels with approver, decision, time, comment; table of steps; Submit / Withdraw buttons | `scm_approval_requests/steps` |
| 5 | RFQ Conversion | R | per line: qty, qty already on RFQ, on PO, open; buttons `Create RFQ`, `Create PO` (only Approved); stepper PR→RFQ→Quote→PO→GRN | `document_links` |
| 6 | PR Cycle Analytics | P | KPIs: open PRs, avg approval hours, avg PR→PO days, % converted, PRs past required date; table by department | queries (section 8) |

**Fields (frozen order, key : type, `*` required; column in `purchase_requisitions` unless noted):**
`prNo`:code* (`code`, readOnly, auto `PR/<UNIT>/<FY>/<0001>`) · `prDate`:date* (`doc_date`) · `department`:ref (`requesting_department`, text name, default creator's department; lookup `departments`) · `requester`:ref (`requester_id` user; lookup `users`; default current user) · `requiredDate`:date (`required_date`, ≥ `prDate` else 422) · `itemService`:ref* (line 1 item; lookup `items`) · `specification`:longtext (line 1) · `quantity`:qty (C5) · `uom`:text (C5) · `budgetAmount`:money (**calc** Σ line qty×est_rate; if no est. rate on any line, user value kept; `budget_amount`) · `costCenter`:ref (`cost_center` text ≤40; free text with datalist from `scm_budgets`) · `project`:ref (`project_code` text ≤40) · `priority`:enum (`priority`: Low, Medium, High, Urgent; default Medium) · `approvalLevel`:text (**calc**, C9) · `status`:status.
**`[ADD]` after frozen:** `purpose`:text(200) (`purpose`); `requestType`:enum (`request_type`: Goods, Service, Capital; default Goods); `deliveryWarehouse`:ref (`warehouse_id`, lookup `warehouses`); `convertedPct`:pct (**calc**, % of line qty on a PO).
**Statuses:** `Draft → Submitted → Approved → In Process → Completed`; side exits `Rejected`, `Cancelled`, `Closed` (short-closed), `On Hold`. `In Process` = some qty on an RFQ/PO; `Completed` = every line fully on POs.
**Row actions (`actions`):** `submit` (Draft; edit) · `withdraw` (Submitted; edit; back to Draft, cancels the open approval request) · `approve` / `reject` (Submitted; approve; reject needs comment) · `hold` / `resume` (Approved, In Process; edit) · `cancel` (Draft, Submitted, Approved with nothing converted; delete when Approved) · `close` (short-close open lines, Approved/In Process; edit; reason required) · `createRfq` / `createPo` `[ADD]` (Approved, In Process; add).
**Filters:** status, priority, department, requester (me), required-date overdue (bool), `request type`. **Totals:** `Budget Amount` sum.
**Header buttons:** Excel, Print, ＋ Add (frozen). `[ADD]` bulk `Create RFQ from selected` (selection of Approved PRs, same-category).
**Validations:** at least one line before submit (422 `PR_NO_LINES`); qty > 0, ≤ 9 digits, 3 dp; required date not before PR date; item must be Active; Service item allowed only when `requestType='Service'` or line allows (warn only); suggested supplier must be Active and approved.

---

## 2.2 `scm-rfq` — RFQ Management

| # | Tab | Scope | Shows / does | Data from |
|---|---|---|---|---|
| 1 | RFQ Register | register | frozen register | `rfqs` |
| 2 | Supplier Invitations | R | invited suppliers table (supplier, contact e-mail, invited at, status Invited/Viewed/Quoted/Declined/No response, reminder count); `Add suppliers` picker (Active+approved only, filtered by category capability); `Send RFQ` (records dispatch + produces the e-mail text and a printable RFQ); `Send reminder` | `rfq_suppliers`, `supplier_items` |
| 3 | Technical Requirements | R | `Technical Spec` text, per-line technical parameters and mandatory documents checklist (read from `rfq_lines.tech_spec`); validation checklist with pass counts of quotes' technical compliance | `rfqs`, `rfq_lines`, `vendor_quotes` |
| 4 | Commercial Terms | R | `Commercial Terms`, payment terms requested, validity, delivery location, Incoterms (import), penalty/LD clause, bid-bond flag; terms checklist vs received quotes (deviations count) | `rfqs`, quotes |
| 5 | Response Tracker | R | matrix: line × supplier quoted rate (L1 highlighted), response date, lead time; progress bar `quoted/invited`; closing-date countdown | `vendor_quote_lines` |
| 6 | Sourcing Cycle Analytics | P | KPIs: open RFQs, avg response rate %, avg days RFQ→award, savings % (L1 vs last PO rate), no-response suppliers | section 8 |

**Fields:** `rfqNo`:code* (`RFQ/<UNIT>/<FY>/<0001>`) · `prNo`:ref (`pr_id`; lookup `purchaseRequisitions`; Approved/In Process PRs only) · `rfqDate`:date* · `closingDate`:date (`closing_date`, ≥ `rfqDate`; required before `issue`) · `buyer`:ref (`buyer_id` user; default current) · `category`:enum (`category`: Raw Material, Components, Packing, Consumables, Services, Capital Goods, Transport, Others) · `vendorCount`:qty (**calc** number of invited suppliers) · `technicalSpec`:longtext · `commercialTerms`:longtext · `deliveryLocation`:text(200) (default ship-to warehouse name) · `validity`:date (`validity_date`: quotes must be valid until at least this date) · `status`:status.
**`[ADD]`:** `rfqType`:enum (`rfq_type`: Single Source, Open Bidding, Limited Tender; default Open Bidding) · `currency`:text (default INR) · `lineCount`:qty (**calc**) · `responseCount`:qty (**calc** quotes received).
**Statuses:** `Draft → In Process (issued) → Closed (bidding closed) → Completed (awarded: PO created)`; `Cancelled`.
**Actions:** `issue` (Draft; edit; needs ≥1 line, ≥1 supplier (≥3 when value > `scm_settings.rfq_min_suppliers_above` ₹5,00,000 unless rfq type is Single Source and a reason is given) and closing date in the future) · `extend` `[ADD]` (In Process; new closing date; edit) · `closeBidding` (In Process; edit) · `reopen` (Closed, no comparison approved; edit) · `cancel` (Draft, In Process; delete) · `createComparison` (Closed; add) · `remind` `[ADD]`.
**Filters:** status, buyer, category, closing in ≤ 3 days. **Totals:** none.
**Validations:** cannot issue without closing date; a supplier can be invited once (409 `DUPLICATE`); blocked/inactive suppliers rejected (422 `SUPPLIER_NOT_ACTIVE`); PR lines cannot be over-allocated (BR-SCM-04).

---

## 2.3 `scm-vendorquote` — Vendor Quotations

| # | Tab | Scope | Shows / does | Data from |
|---|---|---|---|---|
| 1 | Quotation Register | register | frozen register | `vendor_quotes` |
| 2 | Commercial Breakdown | R | `lines` editor (rate, discount %, GST code, lead days, MOQ, validity) and charges (freight, packing, insurance, duty); computed base, discount, GST, freight, **landed cost** with line-wise landed unit cost; ITC-recoverable vs cost GST | lines, TaxService |
| 3 | Technical Compliance | R | checklist per RFQ technical requirement: Compliant / Partially / Non-Compliant / Not Stated + remarks; overall `Technical Compliance` result; document attachments names | `vendor_quote_compliance` jsonb |
| 4 | Negotiation History | R | rounds table (round no, date, by whom, rate before → after, remark) and button `Record negotiation round`; each round creates a revision of the lines (BR-SCM-14) | `vendor_quote_rounds` jsonb on header |
| 5 | Deviation Log | R | table of deviations vs RFQ (price over target, payment terms worse, delivery later than required, validity short, spec deviation) auto-computed, each with severity and accept/reject note | computed |
| 6 | Quote Analytics | P | KPIs: quotes received, avg discount achieved by negotiation %, L1 win rate, avg lead days, quotes expired | section 8 |

**Fields:** `quoteNo`:code* (`VQ/<UNIT>/<FY>/<0001>`) · `rfqNo`:ref (`rfq_id`; lookup `rfqs`; In Process or Closed only) · `vendor`:ref* (`supplier_id`; lookup `suppliers`; must be invited when the RFQ has invitations → 422 `SUPPLIER_NOT_INVITED`) · `quoteDate`:date* · `baseAmount`:money (**calc** Σ qty×rate) · `discount`:money (**calc** Σ line discounts + header discount) · `gst`:money (**calc** Σ tax) · `freight`:money (input; header charge) · `landedCost`:money (**calc**, BR-SCM-14) · `leadTimeDays`:qty (**calc** max of line lead days; editable only when no lines) · `paymentTerms`:longtext (snapshot text of selected term, editable) · `warranty`:text(100) · `technicalCompliance`:text (**calc** `Compliant`/`Partially Compliant`/`Non-Compliant`/`Not Assessed`) · `status`:status.
**`[ADD]`:** `paymentTermsId`:ref (`payment_terms_id`, lookup `paymentTerms`) · `validUntil`:date (`valid_until`) · `packingCharge`, `insuranceCharge`, `dutyCharge`:money · `roundNo`:qty (**calc** negotiation round) · `supplierQuoteRef`:text(60) (supplier's own quote number).
**Statuses:** `Draft → Submitted (recorded, comparable) → Completed (awarded)`; `Rejected` (disqualified), `Closed` (not awarded / expired), `Cancelled`.
**Actions:** `submitQuote` (Draft; edit; needs lines with rates > 0, validity ≥ RFQ validity else warning) · `reviseRound` `[ADD]` (Submitted; edit; opens a new round, keeps history) · `disqualify` (Submitted; approve; reason) · `reinstate` · `cancel` · `createPo` (Submitted; add; direct award path only when no comparison is required, BR-SCM-16).
**Filters:** status, RFQ, vendor, expiring in ≤ 7 days. **Totals:** `Landed Cost` sum.
**Validations:** one live quote per (RFQ, supplier, round) — a new round supersedes; quote date ≥ RFQ date; after RFQ closing date: 422 `QUOTE_AFTER_CLOSING` unless the user has `approve` and gives a reason (late-bid override, audited); rates ≥ 0; at least one line rate > 0 on submit.

---

## 2.4 `scm-comparison` — Vendor Comparison (placeholder register + real matrix)

The register keeps the generic placeholder fields; the real comparison lives in the tabs.

| # | Tab | Scope | Shows / does | Data from |
|---|---|---|---|---|
| 1 | Comparison Sheet | register | frozen register (one row per comparison); row action `Open workspace` | `purchase_comparisons` |
| 2 | Weighted Criteria | R | criteria weights form (Price 50, Delivery 20, Quality 15, Payment terms 10, Experience 5 = 100; editable while Draft), per-quote score table, total, rank; verdict if weights ≠ 100 | `purchase_comparison_entries`, BR-SCM-18 |
| 3 | Landed Cost | R | line × supplier matrix of **landed unit cost** (value, freight, duty, non-creditable GST), L1 highlighted per line and in total; total landed cost per supplier; savings vs last PO price | quotes |
| 4 | Technical Compliance | R | per supplier compliance result + disqualified flag (non-compliant quotes are greyed and excluded from ranking) | quotes |
| 5 | Negotiation Scenario | R | what-if: user enters a target discount % or rate per supplier (not saved to the quote) and sees the re-ranked total; button `Request negotiation` creates a new quote round request (sets quote `Submitted`→ round pending; note + e-mail text) | computed client-side from panel JSON + server `POST …/simulate` |
| 6 | Award Recommendation | R | recommended supplier (highest weighted score), L1 supplier, justification text (required if different), split-award table (qty split per line between suppliers), buttons `Submit for approval`, `Create PO` (one PO per awarded supplier) | comparison |

**Fields (frozen placeholder set):** `documentNo`:code* (`CMP/<UNIT>/<FY>/<0001>`) · `vendor`:ref* (`recommended_supplier_id`, the recommended/awarded supplier; **required to submit**, may be empty only in Draft? — the field is frozen required, so on create the user picks the provisional supplier; the server overwrites it with the recommended one on `evaluate`) · `department`:ref (`requesting_department`, from PR) · `buyer`:ref (`buyer_id`) · `date`:date* (`doc_date`) · `requiredDate`:date (`required_date`, from PR/RFQ) · `amount`:money (**calc** landed total of the recommended supplier) · `approvalLevel`:text (**calc**, C9) · `reference`:ref (`rfq_id`; lookup `rfqs`; Closed RFQs) · `status`:status.
**`[ADD]`:** `justification`:longtext · `l1Vendor`:ref (**calc** lowest landed total qualified) · `savingsPct`:pct (**calc** vs reference price, BR-SCM-18).
**Statuses:** `Draft → Submitted → Approved → Completed (PO raised)`; `Rejected`, `Cancelled`.
**Actions:** `evaluate` (Draft; edit; recomputes scores, picks recommended) · `submit` (Draft; edit) · `approve`/`reject` (Submitted; approve) · `createPo` (Approved; add; per awarded supplier) · `cancel`.
**Validations:** needs ≥ 1 qualified quote (422 `NO_QUALIFIED_QUOTE`); a single quote allowed only for RFQ type Single Source (else 422 `MIN_QUOTES`, setting `scm_settings.min_quotes_for_comparison`=2); weights must sum to 100 (422 `WEIGHTS_INVALID`); if recommended ≠ L1 a justification of ≥ 20 characters (422 `COMPARISON_JUSTIFICATION_REQUIRED`); comparison locks the scores at `submit` (snapshot).

---

## 2.5 `scm-po` — Purchase Orders

| # | Tab | Scope | Shows / does | Data from |
|---|---|---|---|---|
| 1 | PO Register | register | frozen register | `purchase_orders` |
| 2 | Item Schedule | R | `lines` editor (item, description, HSN, qty, UOM, rate, disc %, tax code, delivery date, warehouse, over-receipt %), per-line ordered / received / accepted / billed / open; delivery calendar (month grid by line delivery date) | `purchase_order_lines`, `document_links` |
| 3 | Commercial Terms | R | payment terms, delivery terms/Incoterms, freight/other charges with tax, warranty, penalty, ship-to, bill-to (unit GSTIN), place of supply, tax summary by rate (CGST/SGST/IGST/cess), TCS/RCM flags; validation checklist (GSTIN valid, bank verified, contract rate honoured, budget) | header + TaxService |
| 4 | Approval & Amendments | R | approval stepper; **revision history** table (R0, R1…: date, by, reason, value before→after, diff summary) and `Amend` / `View revision` buttons | `purchase_order_revisions`, approvals |
| 5 | GRN Invoice Match | R | per PO line: ordered, received, accepted, rejected, billed, balance to receive, balance to bill; list of linked GRNs and invoices with status; match verdict (matched / short / over / unbilled receipts) | `document_links`, GRN, PI |
| 6 | Supplier Performance | R | the PO supplier's last evaluation scores, OTIF on this PO, price trend of PO items vs last 3 POs, open PO value with this supplier | evaluation, section 8 |

**Fields:** `poNo`:code* (`PO/<UNIT>/<FY>/<0001>`) · `vendor`:ref* (`supplier_id`, Active+approved) · `poType`:enum (`po_type`: Standard, Blanket Release, Import, Service, Capital, Job Work; default Standard) · `poDate`:date* (`doc_date`) · `deliveryDate`:date (`delivery_date`, ≥ PO date; default max line date) · `shipToWarehouse`:ref (`warehouse_id`; lookup `warehouses`; must belong to the context unit) · `currency`:text (`currency_code`, default INR; non-INR needs poType Import) · `subtotal`:money (**calc** Σ qty×rate before discount) · `discount`:money (**calc**) · `gst`:money (**calc** CGST+SGST+IGST+cess) · `freight`:money (input, taxable charge) · `otherCharges`:money (input, taxable at the highest line rate unless a tax code is chosen) · `grandTotal`:money (**calc**, rounded to ₹1 with `round_off` stored) · `paymentTerms`:longtext (snapshot text) · `buyer`:ref (`buyer_id`) · `revision`:text (**calc** `R0`,`R1`,…) · `status`:status.
**`[ADD]`:** `paymentTermsId`:ref · `contractId`:ref (`contract_id`, lookup `contracts`, set for Blanket Release) · `prId`:ref (**calc**, first source PR) · `comparisonId`:ref (**calc**) · `placeOfSupply`:text(2) (**calc** state code, default unit's state) · `freightTaxCode`:ref (`freight_tax_code_id`) · `receivedPct`:pct (**calc**) · `billedPct`:pct (**calc**) · `exchangeRate`:qty(6 dp) (Import) · `isRcm`:bool (**calc** from supplier unregistered) · `termsAndConditions`:longtext · `releasedAt`:datetime (**calc**) · `costCenter`:text(40) · `project`:text(40) (copied from the PR, used by the budget check).
**Statuses:** `Draft → Submitted → Approved → In Process (released to supplier; receiving allowed) → Completed (fully received) → Closed (fully received and billed, or short-closed)`; `On Hold`, `Rejected`, `Cancelled`.
**Actions:** `submit` · `withdraw` · `approve`/`reject` · `release` (Approved; edit; stamps `released_at`, → In Process; produces printable PO) · `amend` `[ADD]` (Approved, In Process; edit; reason; BR-SCM-13) · `hold`/`resume` · `shortClose` (In Process, Completed; approve; closes open qty lines, reason; BR-SCM-12) · `closePo` (Completed and fully billed; edit) · `cancel` (Draft, Submitted, Approved with nothing received; delete) · `createGrn` (In Process; add) · `createInvoice` (In Process, Completed; add).
**Filters:** status, vendor, PO type, buyer, delivery overdue (bool), `pending receipt`, `pending billing`. **Totals:** `Grand Total` sum, `GST` sum.
**Validations (summary; full list BR-SCM-01..13):** ≥1 line; tax computed by server; supplier GSTIN state vs unit state decides CGST/SGST vs IGST; supplier Blocked → 422 `SUPPLIER_NOT_ACTIVE`; item inactive → 422; contract rate check (BR-SCM-16); budget check (BR-SCM-22); PO value tiers drive approval (BR-SCM-26).

---

## 2.6 `scm-grn` — Goods Receipt / GRN

| # | Tab | Scope | Shows / does | Data from |
|---|---|---|---|---|
| 1 | GRN Register | register | frozen register | `goods_receipts` |
| 2 | Receipt Lines | R | `lines` editor: PO line picker (open qty shown), item, ordered, open, received qty, accepted, rejected, UOM, rate (from PO, read-only), landed charge share, remark; running totals (Item Count, Accepted, Rejected) | `goods_receipt_lines`, PO |
| 3 | Batch Serial Capture | R | for batch-tracked / serial-tracked items: grid per line: batch no, mfg date, expiry date, qty; serial numbers (paste list); validity checks (Σ batch qty = received qty; serial count = qty; no duplicate serial in the document or in earlier GRNs) | `goods_receipt_batches` |
| 4 | QC & Acceptance | R | per line: QC required, QC status, accepted/rejected qty, reject reason code, inspector, decision date; `Record QC decision`; location of stock (receiving vs QC hold); `Return rejected to supplier` | lines, stock |
| 5 | PO Variance | R | per line: PO qty vs received (±%), PO rate vs invoice rate (when invoiced), over-receipt flag, early/late vs delivery date (days), landed-cost breakdown (charge, basis, share) | PO, charges |
| 6 | Receipt Analytics | P | KPIs: GRNs this month, receipts value, avg receipt-to-QC-decision hours, rejection %, late receipts %, GRN not invoiced (count, ₹) | section 8 |

**Fields:** `grnNo`:code* (`GRN/<UNIT>/<FY>/<0001>`) · `poNo`:ref (`po_id`; lookup `purchaseOrders`; In Process; **required** unless `scm_settings.allow_grn_without_po` is true and the user has `approve`, BR-SCM-07) · `vendor`:ref* (`supplier_id`; defaults from PO, read-only when PO set) · `receiptDate`:date* (`doc_date`; ≤ today; ≥ PO date) · `warehouse`:ref (`warehouse_id`; receiving warehouse of the context unit) · `vehicle`:ref (`vehicle_no` text ≤20, upper-case) · `lrNo`:text(40) (`lr_no`) · `vendorInvoice`:ref (`vendor_invoice_no` text ≤40, the supplier's challan/invoice no. on the delivery) · `itemCount`:qty (**calc** number of lines) · `acceptedQty`:qty (**calc** Σ accepted) · `rejectedQty`:qty (**calc** Σ rejected) · `qcStatus`:enum (`qc_status`: Not Required, Pending, Accepted, Partially Accepted, Rejected; **calc**) · `putawayStatus`:enum (`putaway_status`: Not Required, Pending, Completed; default Pending, set by Warehouse; plan 02/WMS owns putaway tasks — here a manual flag action `markPutaway`) · `status`:status.
**`[ADD]`:** `challanDate`:date · `ewayBillNo`:text(20) · `transporter`:text(100) · `driverMobile`:phone · `gateEntryNo`:text(30) · `landedCostTotal`:money (**calc** Σ charges) · `receivedValue`:money (**calc** accepted+rejected at PO price) · `stockLocation`:text (**calc** "Receiving"/"QC Hold").
**Statuses:** `Draft → Posted → Cancelled` (foundation posted-document vocabulary).
**Actions:** `post` (Draft; edit) · `cancel` (Posted; delete; reversal; blocked once invoiced or stock consumed, BR-SCM-09) · `qcDecide` (Posted with Pending QC; approve — Quality role; body per-line accepted/rejected) · `markPutaway` (Posted; edit) · `returnToVendor` `[ADD]` (Posted with rejected qty; add; creates the debit note + stock issue) · `createInvoice` (Posted; add).
**Filters:** status, QC status, vendor, warehouse, not invoiced (bool). **Totals:** `Accepted Qty`, `Rejected Qty` sums.
**Validations:** BR-SCM-05 (partial receipts), BR-SCM-06 (over-receipt tolerance), BR-SCM-07 (GRN without PO block), BR-SCM-08 (batch/serial), BR-SCM-09 (cancel rules).

---

## 2.7 `scm-purchaseinvoice` — Purchase Invoice

| # | Tab | Scope | Shows / does | Data from |
|---|---|---|---|---|
| 1 | Invoice Register | register | frozen register | `purchase_invoices` |
| 2 | PO GRN Matching | R | per invoice line: billed qty/rate vs PO line vs GRN accepted (unbilled) qty; variance qty %, price %, tax ₹; per-line verdict `Matched`/`Within tolerance`/`Exception`; summary Matched Amount, Variance; `Re-run match` | `purchase_invoice_lines`, BR-SCM-10 |
| 3 | Tax Validation | R | stepper (Source data → Tax validation → ITC decision → GSTR-2B match → Posted); facts: supplier GSTIN valid/active, place of supply, CGST/SGST/IGST split correct, HSN present, RCM flag; ITC eligibility per line (editable by Finance: `Eligible`, `Ineligible 17(5)`, `Capital goods`, `Input service`, `Not applicable`) with reason; GSTR-2B status; TDS section / base / rate / amount | TaxService, BR-SCM-20, BR-SCM-21 |
| 4 | Debit Adjustments | R | debit notes and purchase returns against this invoice/GRN (code, date, value, status), `Create debit note`; rate-difference, quality-rejection and short-supply reasons; net payable after debit notes | `purchase_debit_notes` |
| 5 | Payment Readiness | R | gross, TDS, debit notes, **net payable**, due date, MSME due date and days left (red when late), payment status, bank account verified?, hold flags; read-only mirror of Finance payments (empty until Finance exists) | BR-SCM-19, BR-SCM-25 |
| 6 | Invoice Exceptions | R | exceptions list (code, severity, message, raised at, status Open/Overridden/Resolved, by, note) with `Override` (needs approve, reason) / `Resolve` | `purchase_invoice_exceptions` |

**Fields:** `purchaseInvoiceNo`:code* (`PINV/<UNIT>/<FY>/<0001>`; our internal voucher number) · `vendor`:ref* · `vendorInvoiceRef`:ref (`vendor_invoice_no` text ≤40, **required to submit**; duplicate check BR-SCM-11) · `invoiceDate`:date* (`invoice_date`, the supplier's invoice date; the voucher's own `doc_date` is the entry date, defaults to today moved into the FY, and is not shown as a frozen field) · `dueDate`:date (**calc** BR-SCM-19; editable only by Finance `approve` with reason) · `poNo`:ref (`po_id` primary PO; lines may reference several POs of the same supplier) · `grnNo`:ref (`grn_id` primary GRN; lines carry their own `grn_line_id`) · `taxableValue`:money (**calc**) · `gst`:money (**calc**) · `tds`:money (**calc** BR-SCM-17) · `invoiceTotal`:money (**calc** supplier's invoice grand total incl. tax, before TDS) · `matchedAmount`:money (**calc**) · `variance`:money (**calc**, signed) · `paymentStatus`:enum (`payment_status`: Unpaid, Partially Paid, Paid, On Hold; Finance updates) · `status`:status.
**`[ADD]`:** `supplierInvoiceTotal`:money (the amount printed on the supplier's invoice, typed by AP clerk; difference to calc → exception `TOTAL_MISMATCH`) · `isRcm`:bool (**calc**) · `gstr2bStatus`:enum (`gstr2b_status`: Not Checked, Matched, Mismatch, Not In 2B, Manual OK) · `itcClaimable`:money (**calc** Σ eligible tax) · `msmeDueDate`:date (**calc**) · `ewayBillNo`:text · `holdReason`:text(200) · `netPayable`:money (**calc**) · `placeOfSupply`:text(2).
**Statuses:** `Draft → Submitted (match run) → Approved → Posted → Cancelled`; `On Hold` (match exceptions), `Rejected`.
**Actions:** `submit` (Draft; edit; runs match, BR-SCM-10) · `override` `[ADD]` (On Hold; approve; per-exception reason) · `approve`/`reject` (Submitted; approve) · `post` (Approved; approve or Finance edit; writes TDS ledger + accounting event; BR-SCM-17/23) · `cancel` (Posted; delete; blocked if paid) · `hold`/`release` · `setItc` `[ADD]` · `createDebitNote` (Posted; add).
**Filters:** status, vendor, payment status, due in ≤ 7 days, MSME overdue, has exceptions. **Totals:** Taxable Value, GST, TDS, Invoice Total sums.
**Validations:** BR-SCM-10, 11, 17, 19, 20, 21, 23; supplier Blocked → `SUPPLIER_NOT_ACTIVE`; unverified bank only blocks *payment* (not posting); invoice date not in future; invoice date not before first PO date warns; invoice FY vs doc FY.

---

## 2.8 `scm-approval` — Purchase Approval

| # | Tab | Scope | Shows / does | Data from |
|---|---|---|---|---|
| 1 | Approval Inbox | register (+ stepper header) | the frozen register filtered to *my pending* by default; stepper of the selected request; buttons `Approve`, `Reject`, `Return` | `scm_approval_requests/steps` |
| 2 | Amount Matrix | P | the matrix by document type × department × level (threshold, approver role / named user, SLA hours); editable by ADMIN+ (`controls`) | `scm_approval_matrix` |
| 3 | Department Rules | P | rules list: self-approval forbidden, same approver cannot do two levels, requester ≠ approver, budget override needs level ≥ 3, PO > ₹10,00,000 needs Director, `approval_required` module switch state; rule toggles for the three configurable ones | `scm_settings`, module controls |
| 4 | Delegation & Escalation | P | delegations (from user, to user, from/to dates, doc types) with add/revoke; escalation rules (after SLA hours escalate to next level; reminders) and list of escalated requests | `scm_approval_delegations` |
| 5 | Decision History | R/P | decisions timeline (who, level, decision, comment, time) for the selected request, or all recent (P) | `scm_approval_steps` |
| 6 | Approval SLA | P | KPIs: pending, avg age hours, % within SLA, escalated, by approver table | section 8 |

**Fields:** `requestNo`:code* (`APR/<UNIT>/<FY>/<0001>`) · `transactionType`:enum (`doc_type`: Purchase Requisition, RFQ, Vendor Comparison, Purchase Order, Purchase Invoice, Contract, Supplier, Debit Note) · `documentNo`:text (`doc_code` snapshot) · `department`:ref (`department`) · `requester`:ref (`requested_by`) · `amount`:money (`amount`) · `currentLevel`:text (**calc** `L2 of 3`) · `approver`:ref (**calc** the user (or role label) expected now; after decision, who decided) · `submittedAt`:datetime (`submitted_at`) · `ageHours`:qty (**calc** hours since `submitted_at`, or to decision time) · `decision`:enum (**calc**: Pending, Approved, Rejected, Returned) · `comments`:longtext (last decision comment) · `status`:status.
**Statuses:** `Pending`, `Approved`, `Rejected`, `Cancelled` (withdrawn), `On Hold` (document put on hold). (Shown in the existing vocabulary; no `Draft`.)
**Row actions:** `approve` (approve) · `reject` (approve; comment required) · `returnForChange` (approve; → document back to Draft, request Cancelled with `Returned`) · `reassign` `[ADD]` (approve+controls; to a named eligible user) · `remind` `[ADD]`.
**No ＋ Add:** requests are created only by `submit` on a document; the header `＋ Add` is hidden for this page via `readOnlyCreate:true` in the schema (new schema flag; ticket T-SCM-05). **Filters:** `my pending` (default), status, type, department, overdue SLA. **Totals:** `Amount` sum.
**Validations:** BR-SCM-26/27: requester cannot approve own request (403 `SELF_APPROVAL_FORBIDDEN`); user must be eligible for the current step (403 `APPROVAL_NOT_ELIGIBLE`); a decision on a request that is no longer Pending → 409 `CONFLICT`; stale document version (document changed after submit) → 409 `VERSION_CONFLICT`.

---

## 2.9 `scm-suppliers` — Supplier Master (view over `parties` where `is_supplier`)

| # | Tab | Scope | Shows / does | Data from |
|---|---|---|---|---|
| 1 | Supplier Directory | register | frozen register | `parties` |
| 2 | Compliance Documents | R | document list: GST certificate, PAN, MSME/Udyam, cancelled cheque, ISO, TDS lower-deduction certificate, NDA, quality agreement; number, valid from/to, status Valid / Expiring (≤ 30 days) / Expired / Missing (mandatory set), upload name (file storage is the DMS family; here only metadata + `file_ref` text); compliance score | `supplier_documents` |
| 3 | Category Capability | R | items/categories the supplier can supply (approved vendor list): item, lead days, MOQ, last price, preferred flag, approved-since; add/remove; quality hold flag | `supplier_items` |
| 4 | Bank & Tax Details | R | GSTIN, PAN, GST registration type, state, MSME category/no., TDS section/rate override with certificate validity; bank accounts (masked), verification status, **change history with the two-person rule** (`Verify` button visible to a different user with `approve`); payment terms | `parties`, `party_bank_accounts` |
| 5 | Performance Scorecard | R | last 12 evaluations (trend), 4 scores, rank, OTIF, PPM, price index; link to `scm-evaluation` | `supplier_evaluations` |
| 6 | Supplier Risk | R | risk flags: blocked/expired docs, bank unverified, GSTIN cancelled (manual flag), single-source items, MSME payment overdue amount, concentration (% of 12-month spend), low rating, NCR count; overall risk Low/Medium/High (BR-SCM-29) | computed |

**Fields:** `vendorCode`:code* (`code`: auto `SUP/00001` or user `^[A-Z0-9/_-]{2,30}$`, fixed afterwards) · `companyName`:text* (`name` 2–150) · `gstin`:gstin (15 chars + checksum; unique among live parties) · `pan`:pan (matches GSTIN chars 3–12) · `category`:enum (`supplier_category`: Raw Material, Components, Packing, Consumables, Services, Capital Goods, Transport, Others) · `contactPerson`:ref (text; primary contact name; the contact row is `party_contacts.is_primary`) · `mobile`:phone (primary contact) · `email`:email (primary contact) · `paymentTerms`:longtext (snapshot text of `payment_terms`) · `bankAccount`:ref (**calc** default verified account shown as `HDFC ••••4321`; read-only) · `complianceScore`:pct (**calc**) · `qualityScore`:pct (**calc**) · `deliveryScore`:pct (**calc**) · `overallRating`:pct (**calc**) · `status`:status.
**`[ADD]`:** `legalName`:text · `partyType`:enum (COMPANY, INDIVIDUAL, GOVERNMENT, SEZ, EXPORT) · `gstRegistrationType`:enum (Registered, Composition, Unregistered, SEZ, Overseas) · `stateCode`:text(2) (**calc** from GSTIN, editable for unregistered) · `msmeRegistered`:bool · `msmeNo`:text (Udyam) · `msmeCategory`:enum (Micro, Small, Medium) · `msmeAgreementDays`:qty (agreed credit days ≤ 45, empty = none, BR-SCM-25) · `paymentTermsId`:ref · `tdsSectionId`:ref · `tdsRateOverride`:pct · `tdsCertValidTo`:date · `currencyCode`:text(3) · `isTransporter`:bool · `onboardingStatus`:enum (**calc** Draft/Submitted/Approved/Rejected) · `blockReason`:text(200) · `creditDays`:qty (payment due days from terms, calc).
**Statuses (display):** `Draft → Submitted → Active` (onboarding approved) with `Rejected`; masters `Active ⇄ Inactive`, `Blocked`.
**Actions:** `submitOnboarding` (Draft; edit; needs GSTIN or registration type Unregistered/Overseas, PAN for TDS, ≥1 contact, ≥1 address) · `approveOnboarding`/`rejectOnboarding` (Submitted; approve; approver ≠ creator) · `deactivate`/`activate` · `block` (Active; approve; reason) / `unblock` · `verifyBank` `[ADD]` (approve; verifier ≠ account changer, BR-SCM-24).
**Filters:** status, category, MSME (bool), has expiring docs, rating < 60. **Totals:** none.
**Validations:** GSTIN format+checksum (422 field `gstin`), PAN match, duplicate GSTIN/PAN (409 `DUPLICATE`), duplicate bank account across suppliers (warning flag `SHARED_BANK_ACCOUNT` in Supplier Risk), delete → 409 `IN_USE` if any PO/PI/GRN/quote exists.

---

## 2.10 `scm-evaluation` — Supplier Evaluation

| # | Tab | Scope | Shows / does | Data from |
|---|---|---|---|---|
| 1 | Evaluation Cycles | register (+KPIs) | frozen register; `Run evaluation for period` button (ADD) shows period picker | `supplier_evaluations` |
| 2 | Quality Score | R | acceptance %, PPM, GRN list with rejected qty, NCR count (0 until Quality plan), score derivation (BR-SCM-28) | GRN lines |
| 3 | Delivery OTIF | R | per due PO line: promised date, receipt date, days late, in-full %, on-time/in-full flags; OTIF % | PO/GRN lines |
| 4 | Cost Competitiveness | R | per item: supplier avg rate vs benchmark, index, value weight; score | PO/GRN lines |
| 5 | Compliance Rating | R | document status, invoice error rate (exceptions per invoice), bank verification, MSME flags; compliance % and gate | docs, invoices |
| 6 | Supplier Ranking | P | table of all suppliers evaluated in the period ranked, grade A/B/C/D, change vs previous period, trend arrow | evaluations |

**Fields:** `evaluationNo`:code* (`EVL/<UNIT>/<FY>/<0001>`) · `vendor`:ref* · `period`:date* (`period_end`, the last day of the evaluated month) · `qualityScore`:pct · `deliveryOtif`:pct (OTIF %, as % not score) · `costScore`:pct · `responsiveness`:pct · `compliance`:pct · `rejectionPpm`:qty · `leadTimeDays`:qty (avg actual lead days PO date → receipt) · `overallScore`:pct · `rank`:qty · `status`:status. All score fields are **calc** (read-only; manual adjustment only in `[ADD]` fields).
**`[ADD]`:** `grade`:enum (A, B, C, D) · `periodStart`:date · `sampleLines`:qty (delivery lines evaluated) · `adjustmentPts`:qty (−10..+10, reviewer adjustment) · `adjustmentReason`:text(200) · `riskFlag`:bool.
**Statuses:** `Draft` (computed) `→ Approved` (published; feeds supplier scores) `→ Cancelled`.
**Actions:** `recompute` (Draft; edit) · `adjust` `[ADD]` (Draft; approve; ±10 pts with reason) · `publish` (Draft; approve; locks, sets ranks, updates supplier scorecard; BR-SCM-28) · `cancel` (Draft).
**Creation:** rows are created by `POST /pages/scm-evaluation/run` (all active suppliers with activity) or the monthly job; `＋ Add` is allowed only to create one for a single supplier/period (calls the same computation; `readOnlyCreate:false` but the form takes just Vendor and Period). **Filters:** period (month), vendor, grade, status. **Totals:** none.
**Validations:** one evaluation per (supplier, period) (409 `DUPLICATE`); period must be a completed month; cannot publish with `sampleLines = 0` (score shown as "No activity", excluded from ranks).

---

## 2.11 `scm-contracts` — Rate / Blanket Contracts

| # | Tab | Scope | Shows / does | Data from |
|---|---|---|---|---|
| 1 | Contract Register | register | frozen register | `purchase_contracts` |
| 2 | Rate Schedule | R | `lines` editor: item, UOM, agreed rate, discount %, tax code, min/max qty per release, valid from/to; price-revision history; calendar of rate validity | `purchase_contract_lines` |
| 3 | Volume Commitments | R | per line: committed qty, released qty, invoiced qty, balance; header value cap: committed, consumed, balance, % used; progress bars | contract + POs |
| 4 | Validity & Renewal | R | start/end dates, renewal date, auto-renew flag, notice days, days to expiry, checklist (price review done, supplier docs valid, performance acceptable), `Renew` (creates a new Draft contract copy) | contract |
| 5 | Release Orders | R | POs released against the contract (PO no, date, value, status, received %), `Create release order` | `purchase_orders.contract_id` |
| 6 | Contract Utilization | P | KPIs: active contracts, committed vs consumed total, contracts ≥ 80 % used, expiring in 60 days, spend under contract % (maverick spend = PO value without contract / total) | section 8 |

**Fields:** `contractNo`:code* (`CON/<UNIT>/<FY>/<0001>`) · `vendor`:ref* · `contractType`:enum (`contract_type`: Rate Contract, Blanket Order, Annual Rate Agreement, Service Contract) · `category`:enum (as supplier category) · `startDate`:date* · `endDate`:date (≥ start; required to approve) · `currency`:text (default INR) · `committedValue`:money (cap; required > 0 for Blanket Order; optional for Rate Contract) · `consumedValue`:money (**calc** Σ taxable value of non-cancelled release POs) · `balanceValue`:money (**calc** committed − consumed) · `releaseOrders`:qty (**calc** count of release POs) · `renewalDate`:date (default end date − notice days) · `status`:status.
**`[ADD]`:** `paymentTermsId`:ref · `noticeDays`:qty (default 30) · `autoRenew`:bool · `invoicedValue`:money (**calc**) · `terms`:longtext · `maxReleaseValue`:money (optional per-release cap).
**Statuses:** `Draft → Submitted → Approved → In Process (effective: start ≤ today ≤ end) → Completed (balance 0 / qty exhausted)`; `Closed` (expired or terminated), `On Hold`, `Rejected`, `Cancelled`.
**Actions:** `submit` · `approve`/`reject` · `activate` (Approved with start ≤ today; the nightly job does the same) · `hold`/`resume` · `terminate` (In Process; approve; reason) · `renew` `[ADD]` (In Process, Closed; add) · `createRelease` (In Process; add) · `cancel` (Draft, Submitted).
**Filters:** status, vendor, type, expiring in 60 days, ≥ 80 % used. **Totals:** `Committed Value`, `Consumed Value`, `Balance Value`.
**Validations:** BR-SCM-16 (release against contract), only one In Process contract per (supplier, item, overlapping dates) unless `allowOverlap` (409 `CONTRACT_OVERLAP`).

---

# SECTION 7 — API DESIGN

## 7.0 Common rules

* **Base paths** are the existing ones. Typed CRUD for every SCM page: `GET|POST /pages/:pageId/records`, `GET|PATCH|DELETE /pages/:pageId/records/:id`, `POST /pages/:pageId/records/:id/restore`, `POST /pages/:pageId/records/bulk`, `GET /pages/:pageId/records/export.xlsx`, `GET /pages/:pageId/schema`, `GET /pages/:pageId/audit`, `GET /records/:id/audit` — shapes as in `apps/api/README-PHASE5.md`. Mutations take `If-Match: "<version>"` (412 style per existing `VERSION_CONFLICT` 409), actions take optional `Idempotency-Key`.
* **Action endpoint:** `POST /pages/:pageId/records/:id/actions/:action` with body `{ comment?, reason?, ...action fields }` (`actionBodySchema` is widened by T-SCM-05 to `z.record(...)` validated per action by the SCM handler; the existing Inventory fields stay valid). Response = the record (200) or 409/422/403 errors.
* **Sub-resource endpoints (new, mounted by `scmRouter` before the pages router):** `GET /pages/:pageId/records/:id/panels/:panelKey`, `GET /pages/:pageId/panels/:panelKey`, plus the "create from" and calculator endpoints below. Permission: `view` for GET panels; `add` for create-from; the named action permission for others. All need the context (`resolveContext`) and `requireConcreteUnit` when writing.
* **Create from (chaining):** `POST /pages/scm-rfq/records/from/scm-pr/:id`, `POST /pages/scm-po/records/from/scm-pr/:id`, `POST /pages/scm-po/records/from/scm-comparison/:id`, `POST /pages/scm-po/records/from/scm-contracts/:id`, `POST /pages/scm-po/records/from/scm-vendorquote/:id`, `POST /pages/scm-grn/records/from/scm-po/:id`, `POST /pages/scm-purchaseinvoice/records/from/scm-grn/:id`, `POST /pages/scm-purchaseinvoice/records/from/scm-po/:id`, `POST /pages/scm-comparison/records/from/scm-rfq/:id`. Body `{ lines?: [{ sourceLineId, qty }], supplierId? }`; no `lines` = all open lines. Response = new Draft record (201) with `Location`. Links are written to `document_links` in the same transaction.
* **Audit actions added to `AUDIT_ACTIONS` (FOUNDATION-CHANGE, ticket T-SCM-05):** `SUPPLIER_CREATED/UPDATED/DELETED/RESTORED/STATUS_CHANGED/BANK_CHANGED/BANK_VERIFIED`, `SCM_DOC_CREATED/UPDATED/DELETED/RESTORED/SUBMITTED/APPROVED/REJECTED/RETURNED/WITHDRAWN/CANCELLED/POSTED/RELEASED/AMENDED/HELD/RESUMED/CLOSED/OVERRIDDEN`, `SCM_APPROVAL_DECIDED/DELEGATED/ESCALATED`, `SCM_SETTINGS_UPDATED`, `SCM_EVALUATION_PUBLISHED`, `SCM_TDS_POSTED`. Target types added to `AuditTarget`: `Supplier`, `ScmDocument`, `ScmApproval`, `ScmSettings`. Audit `detail` always has `pageId`, `code`, `unitId`, `docType`, and the figures changed.
* **Money/qty JSON:** numbers (2/3/6 dp) as JSON numbers via `num()`; request amounts accepted as numbers or decimal strings, parsed with `D()`; never floating arithmetic.
* **Error format:** fixed `{error:{code,message,status,requestId,fields?}}`. Catalogue of codes: index §6.99.

## 7.1 Endpoint table

| # | Method + path | Permission (page, action) | Request → Response | Errors |
|---|---|---|---|---|
| E1 | `GET /lookups/suppliers?q&limit&category&activeOnly` | `scm-suppliers` view | → `{data:[{id,code,name,gstin,stateCode,status,msme}]}` (default `activeOnly=true`) | 422 limit |
| E2 | `GET /lookups/users?q&limit&department` | view on the calling page (any SCM page) | → `[{id,code(email),name,department}]` | |
| E3 | `GET /lookups/departments`, `/lookups/payment-terms`, `/lookups/tax-codes?date=`, `/lookups/hsn?q=`, `/lookups/purchase-requisitions?status=`, `/lookups/rfqs`, `/lookups/quotes?rfqId=`, `/lookups/purchase-orders?supplierId&open=1`, `/lookups/goods-receipts?supplierId&uninvoiced=1`, `/lookups/contracts?supplierId&active=1` | view on the matching page | `[{id,code,name,extra?}]` | |
| E4 | `POST /pages/scm-pr/records` | `scm-pr` add | `{data:{prDate,department?,requester?,requiredDate?,itemService,specification?,quantity,uom,costCenter?,project?,priority?,purpose?,requestType?,deliveryWarehouse?, lines?:[PrLine]}}` → 201 record (Draft) | 422 field errors; 409 `PERIOD_CLOSED` |
| E5 | `POST …/actions/submit|withdraw|approve|reject|hold|resume|cancel|close|createRfq|createPo` on `scm-pr` | edit (approve for approve/reject; delete for cancel of Approved) | body `{comment?,reason?}`; `createRfq`/`createPo` body `{lines?}` → record of the NEW document (201) | 409 `CONFLICT`, 422 `PR_NO_LINES`, `BUDGET_EXCEEDED`, 403 `SELF_APPROVAL_FORBIDDEN` |
| E6 | RFQ: `POST /pages/scm-rfq/records/:id/suppliers` `{supplierIds:[uuid]}`, `DELETE …/suppliers/:supplierId`, `POST …/actions/issue|extend|closeBidding|reopen|cancel|createComparison|remind` | edit / add / delete | `extend` body `{closingDate}` | `SUPPLIER_NOT_ACTIVE`, `RFQ_CLOSED`, `DUPLICATE` |
| E7 | Quotes: `POST …/actions/submitQuote|reviseRound|disqualify|reinstate|cancel|createPo`; `PUT /pages/scm-vendorquote/records/:id/compliance` `{items:[{requirementKey,result,remark}]}`; `POST …/round` `{remark, lines:[{lineNo,rate,discountPct}]}` | edit / approve | → record | `QUOTE_AFTER_CLOSING`, `SUPPLIER_NOT_INVITED` |
| E8 | Comparison: `POST …/actions/evaluate|submit|approve|reject|createPo|cancel`; `PUT /pages/scm-comparison/records/:id/criteria` `{weights:{price,delivery,quality,terms,experience}, justification?}`; `POST …/simulate` `{adjustments:[{quoteId,discountPct?,lineRates?:[{lineNo,rate}]}]}` → `{ranking:[{quoteId,landedTotal,totalScore,rank}]}` (nothing saved) | edit | | `WEIGHTS_INVALID`, `NO_QUALIFIED_QUOTE`, `MIN_QUOTES`, `COMPARISON_JUSTIFICATION_REQUIRED` |
| E9 | PO: `POST …/actions/submit|withdraw|approve|reject|release|amend|hold|resume|shortClose|closePo|cancel|createGrn|createInvoice`; `amend` body `{reason}`; `shortClose` body `{reason, lineNos?}` | as page §2.5 | | `PO_NOT_RELEASED`, `BLANKET_BALANCE_EXCEEDED`, `CONTRACT_NOT_ACTIVE`, `CONFLICT` |
| E10 | `POST /pages/scm-po/preview` `{supplierId,poDate,placeOfSupply?,lines:[{itemId,qty,rate,discountPct,taxCodeId}],freight?,otherCharges?}` → computed lines + totals (the TaxService result; nothing saved) | `scm-po` view | | `TAX_CODE_NOT_EFFECTIVE`, `TAX_COMPOSITION_SUPPLIER` |
| E11 | GRN: `POST …/actions/post|cancel|qcDecide|markPutaway|returnToVendor|createInvoice`; `qcDecide` body `{lines:[{lineNo,acceptedQty,rejectedQty,reasonCode?,remark?}]}`; `returnToVendor` body `{lines:[{lineNo,qty}],reason,vehicleNo?}` → debit note record | edit / approve / delete | | `OVER_RECEIPT`, `BATCH_REQUIRED`, `SERIAL_MISMATCH`, `QC_HOLD_WAREHOUSE_MISSING`, `GRN_PO_REQUIRED`, `GRN_ALREADY_INVOICED`, `INSUFFICIENT_STOCK` |
| E12 | `PUT /pages/scm-grn/records/:id/charges` `{charges:[{chargeType,amount,basis,supplierRef?,taxCodeId?}]}` (Draft only) → recomputed allocation | edit | | |
| E13 | Purchase Invoice: `POST …/actions/submit|override|approve|reject|post|cancel|hold|release|setItc|createDebitNote`; `override` body `{exceptionId,reason}`; `setItc` body `{lines:[{lineNo,itcEligibility,reason?}]}`; `POST …/rematch`; `PUT …/gstr2b` `{status, note?}` (manual) | edit / approve | | `DUPLICATE_INVOICE`, `MATCH_BLOCKED`, `NOT_RECEIVED`, `NOT_ELIGIBLE`… |
| E14 | `GET /pages/scm-purchaseinvoice/tds-preview?supplierId&base&date&sectionId?` → `{sectionCode,ratePct,thresholdBefore,cumulativeBefore,taxableBase,tds,reason}` | view | | |
| E15 | Debit notes: `GET|POST /pages/scm-purchaseinvoice/debit-notes`, `GET …/debit-notes/:id`, `POST …/debit-notes/:id/actions/post|cancel` | `scm-purchaseinvoice` add/edit/delete | body `{invoiceId? , grnId?, reason, lines:[{sourceLineId,qty,rate?}]}` | `RETURN_EXCEEDS_RECEIVED`, `INSUFFICIENT_STOCK` |
| E16 | Approval: `POST /pages/scm-approval/records/:id/actions/approve|reject|returnForChange|reassign|remind`; matrix `GET|PUT /scm/approval-matrix` (ADMIN controls); delegations `GET|POST /scm/approval-delegations`, `DELETE /scm/approval-delegations/:id`; `GET /scm/approvals/mine` → pending count + rows | approve / controls | | `SELF_APPROVAL_FORBIDDEN`, `APPROVAL_NOT_ELIGIBLE` |
| E17 | Suppliers: `POST …/actions/submitOnboarding|approveOnboarding|rejectOnboarding|deactivate|activate|block|unblock`; addresses `GET|POST /pages/scm-suppliers/records/:id/addresses`, `PATCH|DELETE …/addresses/:addressId`; contacts `…/contacts`; bank `…/bank-accounts` (`POST` creates `verified_at=null`; `PATCH` changes reset verification; `POST …/bank-accounts/:bankId/verify`); docs `…/documents`; capability `…/items` | add/edit/approve | | `BANK_VERIFY_SAME_USER`, `DUPLICATE`, `IN_USE` |
| E18 | Evaluation: `POST /pages/scm-evaluation/run` `{period:'2026-10', supplierIds?}` → `{created, skipped}`; `POST …/actions/recompute|adjust|publish|cancel` | add / edit / approve | | `DUPLICATE`, `PERIOD_NOT_COMPLETE` |
| E19 | Contracts: `POST …/actions/submit|approve|reject|activate|hold|resume|terminate|renew|createRelease|cancel`; `GET …/records/:id/utilization` | edit / approve | | `CONTRACT_OVERLAP`, `CONTRACT_NOT_ACTIVE` |
| E20 | Settings: `GET|PUT /scm/settings` (view/controls on `scm-approval`; ADMIN+ for PUT) → the `scm_settings` row; budgets `GET|PUT /scm/budgets` (Finance/Purchase `approve` on `scm-pr`) | | | |
| E21 | Reports: `GET /scm/reports/:key?from&to&supplierId&format=json|xlsx` for the keys in section 8 | `view` on the report's page + `export` for xlsx | `{columns,rows,totals}` | 404 unknown key |
| E22 | Alerts: `GET /scm/alerts` → `[{key,severity,count,items[]}]` for the dashboard/notification centre (MSME due, PO overdue, contract expiry, docs expiry, approvals overdue, GRN not invoiced) | view on any SCM page | | |
| E23 | Panels: `GET /pages/:pageId/records/:id/panels/:panelKey` and `/pages/:pageId/panels/:panelKey` (C6) | view | PanelDto | 404 unknown panel |
| E24 | Jobs (internal, no HTTP for users; `POST /scm/jobs/:name/run` for ADMIN+ in dev/test only): `evaluation-monthly`, `contract-lifecycle`, `approval-escalation`, `doc-expiry`, `msme-due` | ADMIN | `{ran, affected}` | |

Detailed request/response JSON for the three record-defining calls (the others follow the same pattern and are fixed by the line schemas in 7.2):

**Create PO (E-PO) request**
```json
POST /pages/scm-po/records
{ "data": {
  "vendor": "<supplierId>", "poType": "Standard", "poDate": "2026-11-03", "deliveryDate": "2026-11-20",
  "shipToWarehouse": "<warehouseId>", "currency": "INR", "freight": 1500, "otherCharges": 0,
  "paymentTermsId": "<paymentTermsId>", "buyer": "<userId>", "termsAndConditions": "…",
  "lines": [ { "itemId": "<itemId>", "description": "HR coil 2.5mm", "hsnSac": "7208", "qty": 10, "uom": "Kg",
               "rate": 62.5, "discountPct": 2, "taxCodeId": "<GST18 id>", "deliveryDate": "2026-11-20",
               "overReceiptPct": 5, "prLineId": null, "contractLineId": null } ] } }
```
**Response (201) — record shape C2 with**
```json
{ "data": { "id": "…", "code": "PO/TAL/26-27/0001", "status": "Draft", "version": 1, "amount": 2493.00,
  "data": { "poNo": "PO/TAL/26-27/0001", "vendor": "<id>", "poType": "Standard", "poDate": "2026-11-03",
            "subtotal": 625.00, "discount": 12.50, "gst": 380.26, "freight": 1500.00, "otherCharges": 0.00,
            "roundOff": 0.24, "grandTotal": 2493.00, "revision": "R0", "placeOfSupply": "27",
            "lines": [ { "lineNo": 1, "itemId": "…", "qty": 10, "rate": 62.5, "discountAmount": 12.50, "taxableValue": 612.50,
                         "taxCodeId": "…", "cgstRate": 9, "cgstAmount": 55.13, "sgstRate": 9, "sgstAmount": 55.13,
                         "igstRate": 0, "igstAmount": 0, "lineTotal": 722.76, "receivedQty": 0, "acceptedQty": 0, "billedQty": 0 } ] },
  "refs": { "vendor": { "id": "…", "code": "SUP/00001", "name": "…" } } } }
```
(The arithmetic is exact and is worked in BR-SCM-01/02: line taxable 612.50; CGST and SGST 55.13 each; freight 1,500 at GST18 gives 135.00 + 135.00; tax 380.26; raw total 2,492.76; round-off +0.24; grand total 2,493.00. Tests use these numbers. Unit TAL, FY 2026-27 numbers read `PO/TAL/26-27/0001`.)

## 7.2 Line JSON schemas (zod names in `apps/api/src/modules/scm/schemas/lines.ts`)

* **PrLine** `{ itemId, description?, specification?, qty, uom, estRate?, requiredDate?, suggestedSupplierId?, remark? }`
* **RfqLine** `{ prLineId?, itemId, description?, qty, uom, techSpec?, requiredDate? }`
* **QuoteLine** `{ rfqLineId?, itemId, description?, qty, uom, rate, discountPct?, taxCodeId, leadDays?, moq?, validUntil?, makeBrand?, remark? }`
* **PoLine** `{ itemId, description?, hsnSac?, qty, uom, rate, discountPct?, taxCodeId, deliveryDate?, warehouseId?, overReceiptPct?, prLineId?, quoteLineId?, contractLineId?, remark? }`
* **GrnLine** `{ poLineId?, itemId, description?, receivedQty, acceptedQty?, rejectedQty?, uom, rate?, qcRequired?, rejectReason?, weightKg?, remark?, batches?:[{batchNo, mfgDate?, expiryDate?, qty, serialNos?:string[]}] }` (`rate` only when no PO)
* **PiLine** `{ poLineId?, grnLineId?, itemId?, description, hsnSac?, qty, uom, rate, discountPct?, taxCodeId, itcEligibility?, tdsSectionId? }`
* **DnLine** `{ grnLineId?, piLineId?, itemId, qty, uom, rate?, reasonCode }`
* **ContractLine** `{ itemId, uom, rate, discountPct?, taxCodeId?, minQty?, maxQty?, validFrom?, validTo? }`
All qty 3 dp > 0, ≤ 999,999,999.999; rates 6 dp ≥ 0; pct 0–100 with 4 dp; unknown keys rejected (422).
