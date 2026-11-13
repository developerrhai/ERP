# PHASE 10

# PHASE 10 — CRM & Sales (+ Accounts Receivable)

## 1. Goal
Build order-to-cash for TAL, SAW and VAR:
lead → opportunity → quotation → sales order → reservation → pick → pack → dispatch → tax invoice
→ collection → return → credit note.

Plus receivables (fin-ar, fin-creditnote, fin-ageing) and company-wide credit control. Stock moves via
StockService, money via PostingService in the same transaction, and every document submits through
ApprovalService. KPIs come from real rows (R-15).

## 2. Pages (23; fields and tabs frozen as in index.html)
| Group | Pages |
|---|---|
| CRM | crm-leads, crm-opportunities, crm-pipeline (Kanban: New / Qualified / Proposal / Negotiation / Won; a "Lost" lane hidden behind a toggle, D-19), crm-followups, crm-meetings, crm-feedback, crm-sources, crm-customer360 (360° tabs over the Phase 6 master) |
| Sales | sales-quotations, sales-orders, sales-reservations, sales-delivery, sales-dispatch, sales-invoices, sales-collections, sales-pricelist (promotions + margin simulation), sales-credit, sales-returns |
| AR (owned by Sales, D-09) | fin-ar, fin-creditnote, fin-ageing (its Payables tab is a read-only view of Phase 9 data) |
| WMS | wms-pick, wms-packing |

## 3. Rules (all statutory values are dated data, needs_review)
| Topic | Rule |
|---|---|
| Invoice contents (CGST Rule 46) | Supplier name, address, GSTIN; consecutive serial ≤ 16 characters; date; recipient details (unregistered and ≥ ₹50,000: name, address, state); HSN (4/6 digits); description, qty, UQC, value, discount, taxable value; rate and amount per tax head; place of supply; delivery address if different; reverse-charge flag; signature. |
| Time of supply (s.12, s.31) | The invoice is issued at or before removal of goods, so by default `require_invoice_before_dispatch = true`: the invoice must be Posted before gate-out. |
| Advances for goods | No GST (Notification 66/2017). Post to CUSTOMER_ADVANCE. |
| Rounding | Tax per line and per head at 2 decimals, half-up. Grand total rounded to the rupee. The difference is an explicit ROUND_OFF line, never more than ₹1. |
| Credit notes (s.34) | GST can be reduced only if the note is issued by 30 Nov after the year ends. Later notes are commercial only (gst_adjusted = false). The Finance Act 2025 "recipient reverses ITC" proviso is a data flag. |
| E-invoice | Applies above AATO ₹5 cr. If AATO ≥ ₹10 cr, it must be reported within 30 days. This phase stores fields only; the JSON is built in Phase 11. |
| TCS | 206C(1H) was omitted from 1-Apr-2025, so there is no TCS line on sales. |
| TDS deducted by customer | Receipts can record it: Dr TDS_RECEIVABLE. |
| Cash receipts | Must be < ₹2,00,000 per transaction (data row). |
| Credit exposure | Company-wide (D-15), checked at order approval and at dispatch (the SAP SD pattern). |
| Flow | Same as ERPNext / Odoo / SAP: COGS is booked at delivery; revenue at invoice. |
| Numbering | Allocated at post. Invoice `SITAL/2627/00001` and credit note `CNTAL/2627/00001` (16 characters each); other documents `SO/TAL/2627/0001`; drafts show `DRAFT/<8hex>`. |

## 4. Database (<ts>_phase10_*)
1. **crm:**
   - lead_sources, crm_pipeline_stages (6 rows: sort, default_probability, required_fields, is_hidden),
     crm_loss_reasons, crm_competitors
   - leads (unique normalised mobile/email among live rows), lead_score_rules
   - crm_followups, crm_meetings + participants
   - crm_timeline_entries (append-only)
   - opportunities + opportunity_stage_history
   - crm_feedback, marketing_consents
2. **pricing:**
   - price_promotions (list, item or category, min_qty, discount_pct, validity; promotions never stack)
   - customer_item_prices (customer, item, customer_part_no, price, discount, min_qty, validity)
3. **sales_docs:**
   - sales_quotations + lines + revisions (snapshot)
   - sales_orders + lines (qty, cancelled, delivered, invoiced, returned, rate, discount, list_rate,
     price_source, cost_rate, taxable, CGST/SGST/IGST/cess, line_total)
   - sales_reservations (→ Phase 8 reservation)
   - credit_holds (customer, order, reason, exposure, limit, status ACTIVE/RELEASED/AUTO_RELEASED)
   - credit_overrides (amount, valid_until, approval_id)
4. **fulfilment:**
   - sales_delivery_plans + lines (promise_date, repromise_history, otif_status)
   - pick_waves, pick_tasks (source_bin, batch, serials, required/picked/short qty, route_seq)
   - pack_units (cartons, gross_kg, volumetric_kg, label_status, qc_check)
   - sales_dispatches + lines (type Sale/Sample/Replacement/JobWork; unit_cost, cost_value,
     stock_voucher_id, invoiced_qty, returned_qty; eway_no, lr_no, vehicle, driver, pod_date, pod_status)
5. **billing_ar:**
   - sales_invoices + lines (invoice_type, supplier_gstin, place_of_supply_state, regime, reverse_charge,
     lut_ref, totals, round_off, paid_amount, credit_note_amount, balance (generated), due_date,
     einvoice fields, gl_voucher_id)
   - sales_receipts + sales_receipt_allocations (invoice, amount, tds_amount, reversed_at). The receipt
     reference must be unique per customer and mode. Fields: mode, deposit account, tds_deducted, unallocated.
   - sales_collection_actions
   - sales_returns + lines (condition, disposition RESTOCK/QUARANTINE/SCRAP/REPLACE)
   - sales_credit_notes + lines (reason SALES_RETURN/RATE_DIFF/DISCOUNT/QUALITY/OTHER, gst_adjusted,
     gst_deadline, applied_to_invoice)
   - sales_config (one row): invoice-before-dispatch, over-delivery %, reservation hold days, discount
     authority by role, order-value authority, max_overdue_days 30, lead decay
   - Lookup inserts: DELIVERY, SALES_RETURN (stock_voucher_types); IUT and the other document_types

## 5. Algorithms
**State machines:**
- **Lead:** New → Contacted → Qualified → Converted, or Disqualified. Convert is idempotent and creates
  one customer + one opportunity.
- **Opportunity:**
  - skipping forward needs "approve"; moving back needs a reason (≥ 5 characters);
  - Negotiation needs a quotation that is Sent or Approved;
  - Won needs an Accepted quotation or a live sales order;
  - Lost needs a loss reason;
  - a Kanban drag sends PATCH with If-Match.
- **Quotation:** Draft → Submitted → Approved/Rejected → Sent → Accepted/Lost/Expired. "Revise"
  snapshots the quotation and goes back to Draft as R+1.
- **Sales order:** Draft → Pending Approval → Approved → (On Hold) → Partially Delivered → Delivered →
  Invoiced → Closed. Short-close allowed; cancel only before any delivery.
- **Dispatch:** Draft → Picked → Packed → Dispatched (posted) → Delivered (POD).
- **Invoice:** Draft → … → Posted → Partially Paid → Paid. Cancel only with no live allocations and no
  active IRN.
- **Receipt:** Draft → Posted → Bounced / Cancelled (reversal).
- **Return:** Requested → Approved → Received → Inspected → Credited → Closed, or Rejected.

**Pricing:**
- Order: customer price → list slab → list default → best single promotion → item price. Returns a trace.
- Margin % = (net − moving-average cost) / net × 100.
- Approval is needed when a line discount exceeds the user's authority or margin is below the floor.
  - Example: rate 1,000, discount 10 % → net 900; cost 850 → margin 5.56 % < 10 % floor → approval.

**GST per line** (packages/calc/salesTax, Decimal):
- taxable = r2(qty × rate) − discount + freight share.
- Intra-state: CGST = SGST = r2(taxable × rate/200). Inter-state: IGST = r2(taxable × rate/100).
  Export under LUT: 0.
- The rate is the one valid on the invoice date.
- Grand total = round to the rupee; |round-off| ≤ 1.
- Freight is shared in proportion to taxable value; the largest line takes the remainder.

Worked example (TAL → Pune customer, 18 %):
| Line | Qty × rate | Discount | Taxable | CGST 9 % | SGST 9 % |
|---|---|---|---|---|---|
| MA-200 | 10 × 4,250 | 5 % (2,125) | 40,375.00 | 3,633.75 | 3,633.75 |
| BRK-14 | 25 × 186.35 | — | 4,658.75 | 419.29 | 419.29 |
| **Total** | | | **45,033.75** | **4,053.04** | **4,053.04** |
- Exact total 53,139.83 → grand total 53,140.00, round-off +0.17.
- For an Ahmedabad customer instead: IGST 7,267.50 + 838.58 = 8,106.08.

**Credit check** (CreditService.check locks the customer row; all figures company-wide):
~~~
exposure = openAR + deliveredUnbilled + openSO − (unallocated receipts + unapplied credit notes)
openSO   = Σ (qty − cancelled − max(delivered, invoiced)) × line_total/qty   (no double count)
pass if limit IS NULL or exposure + order ≤ limit + active override
fail OVERDUE if oldest overdue > max_overdue_days; fail BLOCKED if the customer is blocked
~~~
- Example: limit 10,00,000; AR 4,20,000; delivered-not-billed 50,000; open SO 2,80,000; advances 30,000
  → exposure 7,20,000. New SO of 3,10,000 → needs 10,30,000 → short by 30,000 → On Hold + credit_holds row.
- **Release:** goes through approval; the approver needs "approve" on sales-credit and cannot be the SO
  creator. Override = the shortfall, valid up to 30 days (default 7).
- **When it runs:** fully at SO approval; holds/overdue/blocked only at dispatch. Posting a receipt or
  credit note auto-releases holds that now pass.

**GL** (same transaction):
| Event | Journal |
|---|---|
| Delivery posted | Dr COGS 34,730.00 / Cr INVENTORY_FG 34,730.00 (31,200 + 3,530) |
| Invoice posted | Dr AR 53,140.00 (bill = invoice number, due date) / Cr SALES 45,033.75, Cr OUTPUT_CGST 4,053.04, Cr OUTPUT_SGST 4,053.04, Cr ROUND_OFF 0.17 |
| Receipt 50,000 + TDS 45.03 | Dr BANK_OR_CASH 50,000.00, Dr TDS_RECEIVABLE 45.03 / Cr AR 50,045.03 (balance 3,094.97) |
| Advance receipt | Dr BANK / Cr CUSTOMER_ADVANCE; later allocation: Dr CUSTOMER_ADVANCE / Cr AR |
| Credit note (return of 2 × MA-200) | Taxable 8,075.00, CGST/SGST 726.75 each, total 9,529. Dr SALES_RETURNS 8,075.00, Dr OUTPUT_CGST 726.75, Dr OUTPUT_SGST 726.75, Dr ROUND_OFF 0.50 / Cr AR 9,529.00 |
| Return received | Dr INVENTORY_FG 6,240.00 / Cr COGS 6,240.00 (QUARANTINE disposition → QC-hold warehouse) |
| Any cancellation | Exact mirror reversal |

**Stock:**
- SO approval → reserve (expires at promise date + hold days; a nightly job releases expired ones).
- Pick release → allocate with FEFO and create pick tasks.
- Dispatch post → StockService.post DELIVERY at moving average + consume the reservation; set serial
  sales_ref and warranty_end.
- Return → SALES_RETURN at the original unit cost.
- A dispatch cannot be cancelled once any of it is invoiced or returned.

**Receipt allocation:**
- Oldest first: the primary invoice first, then by due date, then by number.
- TDS is split pro-rata; the last allocation takes the remainder. Anything left becomes an advance.
- A bounced receipt reverses all its allocations.

**Concurrency:**
- Fixed lock order: customer → SO → SO lines → dispatch → stock balances → invoices (by id) → receipt.
- The document number is allocated only after all checks pass.

**Credit notes:**
- Qty-based notes are pro-rata, with the remainder on the last unit.
- Amount-based notes are capped at the remaining taxable value.
- They use the original invoice's tax rate and place of supply.
- gst_deadline = 30 Nov after the invoice's year (e.g. invoice 02-11-2026 → 30-11-2027).

**KPIs:**
- Pipeline value, and weighted (value × probability).
- Win rate = Won / (Won + Lost).
- OTIF: delivered on or before the promise date AND in full qty.
- DSO = AR / credit sales of the last 90 days × 90 (e.g. 48 L / 1.44 Cr × 90 = 30 days).
- Ageing from due date: Current, 1–30, 31–60, 61–90, 90+.
- Lead score = fit (max 60) + engagement (max 40), minus 10 % for every 14 idle days.
  Hot ≥ 70, Warm 40–69, Cold < 40.

## 6. API
- **Records:** typed pages under /pages/:pageId/records (+ panels).
- **CRM:**
  - POST /crm/leads/:id/convert | score; POST /crm/leads/capture
  - PATCH /crm/opportunities/:id/stage
  - GET /crm/pipeline
  - POST /crm/followups/:id/complete
- **Sales verbs:** POST /sales/:doc/:id/{submit|approve|reject|post|cancel|revise|send|accept|expire|short-close|repromise|pod}
- **Create-from:**
  - POST /sales/quotations/:id/create-order
  - POST /sales/orders/:id/{reserve|release|create-pick|create-dispatch}
  - POST /sales/dispatches/:id/create-invoice
  - POST /sales/invoices/:id/{create-credit-note|record-irn}
  - POST /sales/returns/:id/create-credit-note
- **WMS:**
  - POST /wms/pick-waves
  - POST /wms/pick-tasks/:id/confirm
  - POST /wms/pack-units/:id/{pack|verify-weight|print-label}
- **Receipts:** POST /sales/receipts/:id/{post|allocate|bounce}; POST /sales/collections/actions
-
- **Credit:**
  - GET /sales/credit/:customerId/exposure
  - POST /sales/credit/holds/:id/release
  - POST /sales/credit/:customerId/{block|unblock}
- **Pricing:** POST /sales/pricelist/simulate
- **AR:** GET /fin/ar?asOf=; GET /fin/ageing?asOf=&type=AR|AP; GET /fin/ar/:customerId/statement (JSON + PDF)
- **Print:** GET /sales/documents/:pageId/:id/pdf

## 7. UI (index.html look; LinesEditor with live tax totals from the shared calc package)
**Data scope by role:** salesperson OWN, sales manager DEPARTMENT, unit head UNIT, MD and Finance ALL.

**Flow:**
1. **Lead:** add lead → duplicate warning → score band shown.
2. **Convert:** creates customer + opportunity. The Kanban card drags; if a stage rule fails, the card
   snaps back with a plain message.
3. **Quotation:** price-trace chip ("Dealer list slab 850 for ≥100"), margin chip, approval badge.
4. **Sales order:** credit badge shows "Within limit ₹3,50,000 left" or "On hold: short ₹30,000".
5. **Fulfilment:** reserve → pick (phone view: bin, batch, qty) → pack → Dispatch Ready.
6. **Invoice:** created from the dispatch → Post. The number appears and the PDF carries every
   Rule 46 field. Then enter LR and e-way bill → Dispatched → POD.
7. **Collections:** worklist (Due Today, Promise to Pay). Receipt auto-allocation with a preview.
8. **Returns:** return → inspect → disposition → credit note, with a banner showing the s.34 deadline.

## 8. Messages
| Code | Message |
|---|---|
| DUPLICATE_LEAD | "A lead with this mobile or e-mail already exists: {leadNo}." |
| STAGE_GATE_FAILED | "{stage} needs {missing}." |
| DATE_IN_PAST | "Follow-up date cannot be before today." |
| CUSTOMER_BLOCKED | "Customer {name} is blocked for new sales. Ask Accounts." |
| PRICE_MISSING | "Line {n}: no price found for {item}. Enter a rate." |
| AUTHORITY_INSUFFICIENT | "Your discount limit is {x}%. This needs a higher approver." |
| QUOTATION_EXPIRED | "Quotation expired on {date}. Revise it first." |
| DUPLICATE_PO | "PO {ref} is already used on {soNo}. Confirm to continue." |
| CREDIT_LIMIT_EXCEEDED | "Credit limit exceeded by ₹{shortfall}. Order put on hold." |
| CREDIT_OVERDUE | "Customer has bills overdue by {d} days (limit {max})." |
| SELF_APPROVAL_FORBIDDEN | "You created this document; another person must approve it." |
| INSUFFICIENT_STOCK | "Line {n}: only {avail} {uom} available in {warehouse}." |
| OVER_DELIVERY | "Line {n}: maximum you can deliver is {max}." |
| INVOICE_REQUIRED_BEFORE_DISPATCH | "Post the tax invoice before goods leave the gate." |
| PLACE_OF_SUPPLY_MISSING | "Ship-to address has no state. Fix the customer address." |
| GSTIN_REQUIRED | "Registered customer has no valid GSTIN." |
| INVOICE_DATE_BEFORE_PREVIOUS | "Invoice date cannot be before the last posted invoice ({date}) of this unit." |
| DOC_NO_TOO_LONG | "Invoice number is longer than 16 characters. Check numbering setup." |
| ROUND_OFF_TOO_LARGE | "Round-off over ₹1. Check line amounts." |
| CASH_LIMIT_EXCEEDED | "Cash receipt must be below ₹2,00,000." |
| DUPLICATE_RECEIPT_REF | "Reference {utr} already recorded on {rcptNo}." |
| ALLOCATION_EXCEEDS_BALANCE | "Allocation exceeds balance ₹{bal} of {invNo}." |
| RETURN_QTY_EXCEEDS | "Line {n}: you can return at most {max}." |
| CN_AFTER_GST_DEADLINE (warning) | "After {deadline}: GST cannot be reduced; this is a commercial credit note." |
| INVOICE_HAS_RECEIPTS | "Cancel the receipts against this invoice first." |
| VERSION_CONFLICT | "Someone changed this record. Reload and try again." |

## 9. Audit & notifications
- **Audit:** SALES_DOC_POSTED / CANCELLED, CREDIT_HOLD_CREATED / RELEASED, CREDIT_LIMIT_CHANGED,
  PRICE_OVERRIDE, STAGE_MOVED, LEAD_CONVERTED, CONSENT_CHANGED. Timelines on lead, opportunity and customer.
- **Notifications:**
  - approvals needed and decided;
  - SO on hold / hold released;
  - follow-ups due at 09:00;
  - reservation expiring in 2 days;
  - broken promise-to-pay;
  - IRN deadline on day 25;
  - credit-note deadline 30 days ahead;
  - NPS ≤ 6 → account owner;
  - opportunity with no activity for 21 days.
- **Nightly jobs:** expire quotations and reservations, lead score decay, credit risk grade, ageing
  snapshot, dunning reminders.

## 10. Tests
- **Unit:** every example above (incl. 838.575 → 838.58), freight split, slabs and promotions, credit
  exposure, ageing, DSO, OTIF (4 cases), lead decay, credit-note remainder, s.34 deadline.
- **Integration:**
  - each journal is balanced and in the same transaction (a forced PostingService failure persists nothing);
  - posted documents can't be changed (PATCH → 409).
- **Concurrency:**
  - 20 parallel invoice posts → SITAL/2627/00001–00020 with no gaps;
  - two dispatches for the last 10 units → one wins;
  - two receipts on one invoice → no over-allocation;
  - two SOs at the limit → exactly one goes on hold;
  - double-click post → replay;
  - Kanban drag race → version conflict.
- **Playwright:**
  - lead → … → credit note, with AR and ageing figures correct;
  - credit hold overridden by a second user;
  - phone width.
- 3 clean runs.

## 11. Acceptance
- [ ] All 23 pages are real.
- [ ] GL AR = sum of invoice balances − unapplied amounts, per customer.
- [ ] Stock value out = COGS.
- [ ] Invoice PDFs carry every Rule 46 field; numbers are ≤ 16 characters and gap-free.
- [ ] The credit-hold override needs a second person.
- [ ] Every cancellation is a reversal.
- [ ] KPIs match hand calculations.

## 12. Out of scope
E-invoice/e-way JSON (Phase 11), foreign currency, EDI/OEM schedules, drop-ship, service and warranty
(Phase 17), WhatsApp/SMS sending (Phase 19).

## 13. Owner check
1. Enter the same mobile twice. Does it say "already exists"?
2. Quote 10 × ₹4,250 with 5 % to a Pune customer. Does it show CGST 3,633.75?
3. Raise an SO above the limit. Is it "On hold" with the shortfall, and can you approve your own? (It should refuse.)
4. Post an invoice. Is the number like SITAL/2627/00001?
5. Record a ₹50,000 receipt. Is the invoice Partially Paid?
6. Return 2 units. Does stock rise and a credit note appear?
7. Is the overdue bill in the right ageing bucket?

## 14. Build prompt
~~~
Read CLAUDE.md, docs/phases/STANDARDS.md, ROADMAP.md (R-01..R-24), ERRATA.md, PHASE-10.md, the Phase
2–9 code as built; docs/archive/plans/04*.md for field detail only (use customers not parties,
PostingService, StockService, SITAL/CNTAL numbering). Hand-written migrations <ts>_phase10_{crm,
pricing,sales_docs,fulfilment,billing_ar}; register DELIVERY/SALES_RETURN/IUT lookups. All money/tax
maths in packages/calc with the worked examples as tests. Every submit via ApprovalService; every
post = StockService then PostingService in one transaction, lock order §5, Idempotency-Key. No
statutory constants in code. 23 pages, index.html look, LinesEditor, exact §8 messages, §10 tests,
3 clean runs. Migrations to local dev/test only (R-16). Never push; commit only if asked. Write
