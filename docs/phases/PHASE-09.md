# PHASE 09

# PHASE 09 — Procurement / SCM (+ Accounts Payable)
(Read ERRATA E-22, E-23 first.)

## 1. Goal
Build the whole buying chain:
PR → RFQ → Quote → Comparison → PO / Contract → GRN (batch/serial, QC hold, put-away)
→ Purchase Invoice (3-way match, GST ITC, RCM, TDS) → Debit Note → AP payment.

The result is real stock, GR/IR, AP open items, and TDS/ITC data.

**Replacements from the old plans:**
| Old name | New |
|---|---|
| ApprovalGateway | Phase 5 ApprovalService |
| parties | suppliers |
| postMovement | StockService |
| AccountingService | PostingService |
| nextNumber | NumberingService |
| AP_CONTROL | AP |
| INVENTORY | INVENTORY_RM / INVENTORY_FG |

## 2. Pages
| Page | Notes |
|---|---|
| scm-pr | Budget check through BudgetService (default mode OFF). |
| scm-rfq, scm-vendorquote, scm-comparison, scm-po, scm-contracts | — |
| scm-grn | The QC decision action is built here; AQL inspection comes in Phase 12. |
| scm-purchaseinvoice | The 2B column is a manual status; 2B import comes in Phase 11. |
| scm-approval | Approval Center filtered to PR, RFQ, VQ, CMP, PO, POA, CON, GRN, PINV, DN, SPP, EVL. |
| scm-suppliers | Only the Performance Scorecard, Supplier Risk and Compliance Documents tabs (the master is Phase 6). |
| scm-evaluation | — |
| wms-putaway | — |
| fin-ap | Bank file / H2H payments come later; v1 records the UTR by hand. |
| fin-debitnote | — |

Also later: import purchases (customs BOE) in a later SCM phase; auto-PR from MRP in Phase 13.

## 3. Rules (research: SAP MIRO, Oracle holds, ERPNext, Odoo; CGST s.16/17/31; Ind AS 2; MSMED s.15–16)
- **3-way match:** per line, against the GRN accepted qty and the PO net rate.
  - Tolerances: qty 2 %, price 2 %, tax ₹1.
  - A breach puts the invoice On Hold; override needs a reason and approval.
- **GR/IR:** the GRN credits GRIR at PO value. The invoice debits GRIR at the matched value; any
  difference goes to PURCHASE_PRICE_VARIANCE.
- **Landed cost:** freight known at GRN is added to stock cost through LANDED_COST_CLEARING.
  - Split by value, qty or weight; the last line takes the remainder.
  - Recoverable GST is never added to cost.
- **ITC** (s.16(2) conditions):
  - Tax invoice held, goods received, tax paid, return filed, invoice in 2B.
  - 180-day payment rule (Rule 37): ITC is reversed if the supplier is unpaid after 180 days and
    reclaimed on payment.
  - Time limit s.16(4): 30 Nov after the year.
  - Blocked credits under s.17(5) are flagged by the accountant; never auto-detected.
- **RCM** (s.9(3) notified services such as GTA, s.9(4)):
  - Self-invoice + payment voucher. Tax is a liability; ITC after payment.
  - The flag is data (hsn_sac_rates.rcm).
- **TDS** (each a dated row, R-23):
  - 194Q: 0.1 % above ₹50 lakh per supplier per year, when last year's turnover was above ₹10 cr.
  - 194C: ₹30,000 single / ₹1,00,000 yearly.
  - 194J: ₹50,000. 194H: ₹20,000.
  - TCS 206C(1H) is off from 1-Apr-2025 (seeded with effective_to 2025-03-31).
  - Income-tax Act 2025 (from 1-Apr-2026): sections keep `legacy_code` plus `new_section_ref`
    (s.393 table item). The transaction date picks which Act applies.
- **MSME:** pay within the agreed days (max 45; 15 with no agreement). s.16 interest is 3× the bank
  rate, compounded monthly (shown for information only).
- **Supplier evaluation:** Quality 40 / Delivery 30 / Cost 20 / Response 10; compliance is a gate.

## 4. Database (migrations <ts>_phase09_*)
1. **scm_masters**
   - tds_sections(code, legacy_code, new_section_ref, description, mode ON_ALL/ON_EXCESS,
     threshold_single, threshold_annual, rate_pct, rate_pct_individual, no_pan_rate, rounding,
     effective_from/to, needs_review)
   - supplier_tds_ledger(supplier_id, fy_id, section_code, doc_type, doc_id, base, cum_base_after,
     cum_tds_base_after, tds_amount, reverses_id)
   - scm_settings (tolerances, over_receipt_pct, rfq_min_suppliers_above, qc_hold_warehouse_id per
     unit, msme_alert_days, eval weights, tds_194q_applicable, itc_180_alert_days, post_on_approve)
   - supplier_items(supplier, item, last_price, lead_days, quality_hold)
   - scm_budgets
   - purchase_contracts + _lines (rate, discount, min/max qty, validity, released_qty)
   - Lookup inserts:
     - document_types: PR, RFQ, VQ, CMP, PO, POA, CON, GRN, PINV, SINV, DN, SPP, SPAY, EVL, PUT
     - stock_voucher_types: GRN, GRN_QC, PUTAWAY, PURCH_RETURN
     - account keys: LANDED_COST_CLEARING, ITC_INELIGIBLE_EXPENSE, ITC_REVERSED_180
2. **sourcing**
   - purchase_requisitions + lines (item or service text, qty, uom, est_rate, cost_center,
     required_date, closed_qty)
   - rfqs + lines + rfq_suppliers
   - vendor_quotes + lines (round_no, is_current, charges, landed_cost, technical_compliance)
   - vendor_comparisons + comparison_entries (weights, scores, rank, locked_at)
   - document_links(from/to type, id, line, qty)
3. **po**
   - purchase_orders (supplier, po_type Standard/Capital/Service/Subcontract, ship_to_warehouse,
     payment_term, pos_state, regime, totals, revision_no)
   - purchase_order_lines (item, hsn, qty, uom, base_qty, rate, discount, gst rate & amounts,
     delivery_date, contract_line_id, received/accepted/billed/returned/closed qty, over_receipt_pct)
   - purchase_order_revisions (snapshot jsonb)
4. **grn_putaway**
   - goods_receipts (po_id, receipt_date, warehouse, vehicle, lr_no, vendor_invoice_ref, qc_status,
     putaway_status)
   - goods_receipt_lines (po_line_id, received_qty, base_qty, qc_required,
     qc_state PENDING/DONE/NOT_REQUIRED, accepted/rejected qty, reject_reason, taxable_value,
     landed_charge, stock_value, unit_cost, billed/returned/putaway qty)
   - goods_receipt_batches (batch_no, mfg, expiry, qty, serial_nos)
   - goods_receipt_charges (type, amount, basis, capitalize, supplier_id)
   - putaway_tasks (task_no, grn_line_id, item, batch, qty, from location, suggested_bin,
     actual_bin, operator, priority, times, exception, status Open/Assigned/Done/Exception/Cancelled)
5. **invoice_ap**
   - purchase_invoices (vendor_invoice_no + _norm, supplier_gstin, invoice_date, doc_date, due_date,
     msme_due_date, is_rcm, self_invoice_no, totals, tds_section_code, tds_base, tds_amount,
     net_payable, paid_amount, match_state, gstr2b_status, payment_status, payment_block,
     itc_reversed_amount)
     - UNIQUE (supplier, vendor_invoice_no_norm, fy) where not Cancelled / deleted
   - purchase_invoice_lines (grn_line_id, po_line_id, qty, rate, taxable, tax columns,
     itc_flag ELIGIBLE/CAPITAL_GOODS/INPUT_SERVICE/INELIGIBLE_17_5/NOT_APPLICABLE, matched_value,
     match_status)
   - purchase_invoice_charges
   - invoice_match_exceptions (code, severity, state OPEN/OVERRIDDEN, reason)
   - debit_notes + lines (kind RETURN/RATE_DIFF/SHORT_SUPPLY/QUALITY, invoice_id?, grn_line_id, stock_value)
   - supplier_payment_proposals + lines
   - supplier_payments (SPAY) + allocations
   - itc_reversals (invoice_id, kind R37_REVERSE/R37_RECLAIM, amounts per head)
6. **evaluation**
   - supplier_evaluations (period, unit, Q/D/C/R/compliance, ppm, otif, overall, grade, rank,
     details, risk_flag)

Indexes: (supplier_id, status), (po_line_id), (due_date) where not Paid.

# 5. Services & algorithms
**Lifecycle:**
- Every document: Draft → Pending Approval → Approved → Posted → Cancelled.
  - A PO is "released" when Approved; its fulfilment (Open / In Process / Completed / Closed) is derived.
  - An invoice with open match errors stays On Hold and cannot be approved.
- Every docType registers with ApprovalService. Amount = grand total. Invoices and payment proposals
  route to the Finance department.
- With post_on_approve on (default), GRN / PINV / DN / SPAY post themselves on approval.

**Tax (GstRateService + placeOfSupply):**
- Intra-state: CGST = SGST = r2(taxable × rate/2 %). Inter-state: IGST.
- Header total rounded to the rupee.
- Example: 10 @ 62.50, 2 % discount, 18 % intra → taxable 612.50, CGST 55.13, SGST 55.13, total 722.76.

**Over-receipt:**
- Rule: received_before + new ≤ r3((ordered − closed) × (1 + pct)), checked under FOR UPDATE of the PO lines.
- Example: ordered 100, tolerance 5 %, already 100 received, new 6 → OVER_RECEIPT.

**GRN post (one transaction):**
1. assertCanPost.
2. Lock the PO lines.
3. Validate batches/serials: Σbatch = received; serial count = qty; serials unique.
4. Landed cost.
5. StockService.post IN at stock_value:
   - item.qc_required (or supplier_items.quality_hold) → unit QC-hold warehouse, batch "Pending QC",
     plus StockService.hold;
   - otherwise → the receiving bin, accepted = received.
6. PostingService.post.
7. NumberingService.allocate.
8. Update PO counters.
9. Create put-away tasks.
10. QmsInboundPort.onGrnPosted(tx, {grnId, lines}) — a no-op until Phase 12.

**qcDecide(tx, {grnLineId, acceptedQty, rejectedQty, rejectReason?, actorId}):**
- accepted + rejected = received (partial decisions are summed). Needs "approve" on scm-grn.
- Accepted: releaseHold + transfer to the ship-to warehouse at the same value; batch Released;
  put-away task created.
- Rejected: stays in QC-hold with status REJECTED. The only exits are a RETURN debit note or a scrap
  adjustment.
- No GL entry.

**Put-away:**
- Suggest with StockService.suggestBin. Complete = transfer to the actual bin (PUTAWAY, no GL).
- Claiming a task uses UPDATE … WHERE status='Open' RETURNING, so one person wins.
- Dock-to-stock = completed_at − GRN posted_at.

**3-way match example:**
- PO 100 @ 50.00; GRN accepted 98; invoice 100 @ 50.50.
- 100 > 98 × 1.02 = 99.96 → QTY_OVER_RECEIPT error.
- Price difference 1 % is within tolerance.
- Matched value = 98 × 50 = 4,900.00; variance 150.00.
- Duplicate invoice (normalised number + supplier + year) → 409.

**TDS** (advisory lock on supplier + year + section):
- 194C (2 %, 30k single / 1L yearly):
  - invoice 60,000 → TDS 1,200;
  - invoice 25,000 → 0 (cumulative 85,000);
  - invoice 20,000 → cumulative 1,05,000, base 45,000 → TDS 900.
- 194Q (on excess over 50 L, 0.1 %): 30 L → 0; 40 L → 2,000; 10 L → 1,000.
- A debit note writes a negative base row; the next invoice is computed net.
- Only the latest ledger row can be cancelled (TDS_LATER_ENTRIES).

**Due dates:**
- due = invoice date + term days.
- MSME Micro/Small: msme_due = last GRN date + min(agreed days or 15, 45); due = the earlier date.
  - Example: GRN 10-11-2026, agreed 45 → 25-12-2026; no agreement → 25-11-2026.
- Interest (shown only) = P × ((1 + 3b/12)^(d/30) − 1). P 1,00,000, b 5.75 %, d 60 → ₹2,895.66.

**ITC-180 job (daily):**
- A posted invoice with ITC still unpaid at invoice date + 180 → ITC_R37_REVERSE:
  Dr ITC_REVERSED_180 / Cr INPUT_* for the unpaid share (ITC × unpaid / net payable).
  Example: ITC 890.82, 100 % unpaid → reverse 445.41 + 445.41.
- Alert 15 days before.
- Payment posts ITC_R37_RECLAIM in proportion.

**GL chain** (PO 100 shafts @ 50, 18 % intra, freight 500 capitalised, 194Q supplier already above limit):
| Event | Journal |
|---|---|
| GRN 100 | Dr INVENTORY_RM 5,500.00 / Cr GRIR 5,000.00 / Cr LANDED_COST_CLEARING 500.00 (unit cost 55) |
| QC 98 ok / 2 rejected | Stock transfer only, no GL |
| Invoice 98 @ 50.50 | Taxable 4,949.00, CGST 445.41, SGST 445.41, total 5,840.00. Dr GRIR 4,900.00; Dr PPV 49.00; Dr INPUT_CGST 445.41; Dr INPUT_SGST 445.41; Dr ROUND_OFF 0.18 / Cr TDS_PAYABLE 5.00; Cr AP 5,835.00 |
| Transporter invoice (GTA, RCM 5 %) | Dr LANDED_COST_CLEARING 500.00; Dr INPUT_CGST 12.50; Dr INPUT_SGST 12.50 / Cr RCM_PAYABLE_CGST 12.50; Cr RCM_PAYABLE_SGST 12.50; Cr AP 500.00 |
| Debit note: return 2 rejected (not invoiced) | Dr GRIR 100.00; Dr PPV 10.00 / Cr INVENTORY_RM 110.00 |
| Debit note: return 10 already invoiced | Dr AP 596.00; Dr PPV 45.00 / Cr INVENTORY_RM 550.00; Cr INPUT_CGST 45.45; Cr INPUT_SGST 45.45; Cr ROUND_OFF 0.10 |
| Debit note: rate difference ₹1 × 98 | Dr AP 115.64 / Cr PPV 98.00; Cr INPUT_CGST 8.82; Cr INPUT_SGST 8.82 |
| Payment | Dr AP 5,239.00 / Cr BANK_OR_CASH 5,239.00 |
| Ineligible ITC (s.17(5)) | Tax goes to Dr ITC_INELIGIBLE_EXPENSE |
| Cancel | Reversal journal + StockService.reverse. GRN cancel is blocked if billed, returned or put away. |

The inventory key comes from item type; service lines go to PURCHASE_EXPENSE with a cost centre.

**Evaluation (monthly):**
- Q = max(0, 100 − PPM/500); D from OTIF with a floor of 70; C = cost index; R = responsiveness.
- Example: Q 60, D 70, C 95.24, R 80 → 72.0480, grade B.

**Contracts exported to later phases:**
- qcDecide, QmsInboundPort
- PurchaseInvoiceService.applyPayment
- GrirService.openByItem
- SupplierScoreService.latest
- ProcurementQueries.openPoQty (for MRP)
- PurchaseRequestGateway.create (for MRP)
- TdsService.preview / ledger

## 6. API (/api/v1, Idempotency-Key + If-Match on every verb)
- **PR:** POST /scm/pr/:id/close-lines | to-rfq | to-po
- **RFQ / quotes / comparison:**
  - POST /scm/rfq/:id/issue | extend | invite
  - POST /scm/vendorquote/:id/round
  - POST /scm/comparison/:id/simulate | award
- **PO:**
  - POST /scm/po/from-comparison/:cmpId
  - POST /scm/po/:id/amend | short-close
  - GET /scm/po/:id/revisions
- **GRN:**
  - POST /scm/grn/from-po/:poId
  - POST /scm/grn/:id/post | cancel
  - POST /scm/grn/lines/:lineId/qc-decision
- **Put-away:** GET /wms/putaway/tasks; POST /wms/putaway/:id/claim | complete | exception
- **Invoice:**
  - POST /scm/purchaseinvoice/from-grn
  - POST /scm/purchaseinvoice/:id/match | exceptions/:eid/override | itc | gstr2b-status
  - GET /scm/purchaseinvoice/:id/tds-preview
- **Debit notes:** POST /fin/debitnote/from-grn | from-invoice
- **AP:**
  - GET /fin/ap/payables | ageing | due-schedule
  - POST /fin/ap/proposals; POST /fin/ap/proposals/:id/to-payments
- **Reports:** GET /scm/reports/grir | msme-overdue | itc-180 | itc-at-risk | po-pending | supplier-scorecard
- **Alerts:** GET /scm/alerts

## 7. UI
- **GRN (store keeper):**
  1. "Receive against PO", pick the PO; lines pre-fill with the open qty.
  2. Type the received qty. The batch/serial grid opens only for tracked items.
  3. Save → Submit. A green banner says "Stock in QC hold: 3 lines" or "Put-away tasks created: 4".
- **Invoice:** the PO-GRN Matching tab shows a traffic light per line with a plain reason
  ("Billed 100, received 98"). The Payment Readiness tab shows due date, MSME due date, TDS, net
  payable, bank verified ✓, and an ITC-180 countdown.
- **fin-ap:** payables by supplier; due calendar with MSME rows in red; payment proposal ("select due
  till date" → tick rows → submit); ageing 0–30 / 31–60 / 61–90 / 90+.
- **wms-putaway (phone):** Claim → scan bin (the suggested bin is pre-selected) → Done.
- KPIs come from real queries only: PR→PO days, OTIF, PPM, GRIR ageing, dock-to-stock time.

## 8. Messages
| Code | Message |
|---|---|
| QUANTITY_EXCEEDS_OPEN | "Only {open} left on {prNo} line {n}." |
| OVER_RECEIPT | "Received {x} would exceed the allowed {max} (ordered {q}, tolerance {p} %). Ask the buyer to amend the PO." |
| GRN_PO_REQUIRED | "Receive against a Purchase Order. Ask Purchase to create one first." |
| PO_NOT_RELEASED | "This PO is not approved or is being amended." |
| BATCH_REQUIRED | "Enter batch numbers for {item}." |
| BATCH_QTY_MISMATCH | "Batch quantities add up to {s}, received is {r}." |
| SERIAL_MISMATCH | "Enter exactly {n} serial numbers." |
| QC_HOLD_WAREHOUSE_MISSING | "Set a QC hold warehouse for unit {unit} in SCM settings." |
| QC_QTY_MISMATCH | "Accepted + rejected must equal {received}." |
| DUPLICATE_INVOICE | "Invoice {no} of this supplier is already entered as {pinv}." |
| MATCH_BLOCKED | "Resolve or override the {n} matching problems first." |
| TDS_LATER_ENTRIES | "Cancel later TDS entries of this supplier first." |
| RETURN_EXCEEDS_RECEIVED | "You can return at most {n}." |
| SUPPLIER_ON_HOLD | "Supplier {name} is on purchase hold." |
| SUPPLIER_NOT_APPROVED | "Supplier is not approved yet." |
| PAYMENT_EXCEEDS_PAYABLE | "Only ₹{x} is payable on this invoice." |
| BANK_UNVERIFIED | "The supplier's bank account is not verified by a second person." |
| RCM_SELF_INVOICE | "Reverse-charge invoice needs supplier state and SAC." |
| CONTRACT_QTY_EXCEEDED | "Balance ₹{b}, this release ₹{r}." |

## 9. Audit & notifications
- **Audit:** before/after on everything, plus SCM_MATCH_OVERRIDDEN, SCM_ITC_FLAG_SET,
  SCM_DUE_DATE_OVERRIDE, SCM_QC_DECIDED, SCM_TDS_RECALC.
- **Notifications** (one per document + event):
  - PO approved → buyer
  - GRN posted → buyer, and QC when on hold
  - Invoice On Hold → buyer
  - MSME due in 7 days → CFO / AP
  - ITC-180 in 15 days → AP
  - Contract expiry in 30 days → buyer
  - Put-away exception → stores supervisor
  - Supplier document expiry → purchase head

## 10. Tests
- **Unit (calc):** every worked example above — tax, landed cost 33.33/33.33/33.34, match, TDS 194C
  and 194Q, MSME interest 2,895.66, evaluation 72.0480, ITC-180.
- **Journals:** each event checks exact lines, balance, and its reversal.
- **Concurrency:**
  - two GRNs on the last 5 units → one OVER_RECEIPT;
  - two invoices with the same number → one 409;
  - parallel TDS → correct cumulative totals;
  - double put-away claim → one wins;
  - idempotent replay → one journal.
- **Playwright:**
  - PR → RFQ → 3 quotes → comparison → PO → GRN with QC hold → qcDecide → put-away → invoice with
    exception override → payment → AP ageing at zero;
  - rejected → debit note;
  - RCM freight;
  - MSME alert.
- 3 clean runs.

## 11. Acceptance
- [ ] The full chain works on a clean database.
- [ ] Trial balance balances; GRIR = 0 after a PO is fully billed; stock = GRN value − returns.
- [ ] qcDecide and QmsInboundPort can be called by Phase 12.
- [ ] Every statutory row is dated and marked needs_review.

## 12. Out of scope
2B import (Phase 11), import/BOE purchases, bank file/H2H, subcontract challans (Phase 13b/18),
portal calls, vendor portal, landed-cost revaluation after GRN.

## 13. Owner check
1. Create PR → approve → PO. Does it say "Approved"?
2. GRN 100 of a QC item. Does stock show 100 in "QC Hold"?
3. Decide 98 ok / 2 rejected → complete put-away. Does the bin show 98?
4. Invoice 100. Is it red with "Billed 100, received 98"?
5. Fix it to 98. Does the ledger show the §5 lines?
6. Return 2. Is QC hold now 0?
7. Does AP Ageing show the right outstanding?

## 14. Build prompt
~~~
Read CLAUDE.md, docs/phases/STANDARDS.md, ROADMAP.md (R-01..R-24), ERRATA.md, PHASE-09.md and the
Phase 2–8 code as built. docs/archive/plans/03*.md are reference only; translate old names per §1.
Steps: 6 hand-written migrations <ts>_phase09_* (lookups ON CONFLICT DO NOTHING; statutory rows
needs_review); packages/calc (tax, landed cost, match, TDS, MSME interest, ITC-180, evaluation) with the
worked examples as tests; services PR→RFQ→VQ→CMP→CON→PO→GRN(+qcDecide, QmsInboundPort no-op,
put-away)→PINV(match, TDS, RCM, ITC, due/MSME)→DN→AP(proposal, payment, applyPayment, ageing)→ITC-180 and
evaluation jobs; each registers with ApprovalService; every post = assertCanPost + NumberingService +
StockService + PostingService in one transaction; routes/controllers/zod; 14 pages in the index.html
look; tests §10; 3 clean runs. Apply migrations to local dev/test only (R-16). Never decide a rate,
never call a portal, never push, commit only if asked. Write PHASE-09-REPORT.md with DB changes.


---

## Client requirements (added 2026-11-06, from the client documents)
1. **PO delivery tracking:** per PO line: supplier, PO date, lead time (days), expected delivery date, model,
   part no, PO qty, received qty, balance qty, status (Open / Partly received / Closed / **Delayed** — computed
   when today is past the expected date and balance > 0). Overdue lines feed Phase 5 notifications.
2. **Vendor quotation with cost breakup** (raw material cost, process costs, margin) inside the RFQ → quotes →
   comparison flow; the formulas come from Phase 6B rule sets, not code.
3. **Vendor tax invoice** capture: HSN, CGST / SGST / IGST split, bank details, advance terms; 3-way match as specified.
4. **Goods receipt → inspection lot:** posting a GRN creates a Phase 12 incoming inspection lot and sets the stock
   status "Quality Inspection" (Phase 8).
5. Supplier type MATERIAL vs CONTRACTOR (Phase 6) is available on PR / RFQ / PO.
