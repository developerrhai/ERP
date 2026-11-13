# PHASE-09 REPORT — Procurement / SCM (+ Accounts Payable)

Built 2026-11-07. Local only: nothing pushed, nothing deployed, nothing committed. Migrations applied to `rhai_erp` (dev) and `rhai_erp_test`; `rhai_erp_e2e` is rebuilt by the e2e runner.

## 0. Decisions taken with the owner (this session)
* Build everything in one go (no stage stops).
* **QMS (Phase 12) does not exist**: `QmsInboundPort.onGrnPosted` is a no-op hook. Stock that needs inspection waits in the Phase 8 stock status **Quality Inspection**.
* **Vendor-quote cost breakup** (raw material, process costs, margin) is **stored as entered** (`vendor_quote_lines.cost_breakup`). No formula in code; Phase 6B rule sets will own the totals.
* **Statutory seeds** use the figures of the spec only, every row dated and `needs_review` (see §3).

## 1. What was built
| Area | Result |
|---|---|
| `packages/calc/src/procurement` | tax (CGST/SGST/IGST, header rounding), over-receipt, landed-cost split (value/qty/weight, last line takes the rest), 3-way match, TDS (ON_ALL 194C style, ON_EXCESS 194Q style, debit-note negative rows), MSME due date + interest, ITC-180 reversal, supplier evaluation, PO delivery status. 19 unit tests = every worked example of PHASE-09 §5. |
| `apps/api/src/modules/procurement/` | `core` (rows, numbering, audit, approval handler, scoping), `crud` (header+lines), `sourcing-service` (PR, RFQ, quote rounds, comparison + award, contracts), `po-service` (PO, amend, short-close, revisions, from comparison / PR, delivery tracking), `grn-service` (GRN, landed cost, Quality Inspection, `qcDecide`, put-away), `invoice-service` (purchase invoice, 3-way match, TDS ledger, RCM, ITC flags, MSME/due dates, debit notes), `ap-service` (payables, ageing, due schedule, payment proposals, supplier payments, `applyPayment`, Rule 37 reclaim), `jobs` (`scm.daily` 01:30 IST: ITC-180 reverse + 15-day alert, MSME / contract / delay / supplier-document alerts, monthly evaluation), `reports-service` (GRIR, MSME overdue, ITC-180, ITC at risk, PO pending, scorecard, KPIs, alerts and the exported `GrirService.openByItem`, `ProcurementQueries.openPoQty`, `SupplierScoreService.latest`, `PurchaseRequestGateway.create`, `TdsService.preview/ledger`), `qms-port`, `math` (Decimal runtime copy of the calc formulas), `routes`. |
| Every post | `assertCanPost` + `NumberingService` + `StockService` + `PostingService` in one transaction; cancel = reversal journal + `StockService.reverseVoucher`. |
| Web (11 pages) | `scm-pr`, `scm-rfq` (invite/issue), `scm-vendorquote` (round, cost breakup stored), `scm-comparison` (rank, award, create PO), `scm-po` (+ Delivery tracking dialog), `scm-contracts`, `scm-grn` (Receive against PO, batch/serial entry, QC decision, "Stock in QC hold" banner), `scm-purchaseinvoice` (PO-GRN Matching tab with plain reasons, Payment Readiness tab, override), `fin-ap` (Payables, Ageing, Due calendar with MSME rows red, proposal, Pay with UTR), `wms-putaway` (phone cards: Claim → bin → Done), `scm-evaluation`. |

## 2. Migrations and DB changes
`20261119000000_phase09_a_scm_masters`, `…010000_b_sourcing`, `…020000_c_purchase_orders`, `…030000_d_grn_putaway`, `…040000_e_invoice_ap`, `…050000_f_evaluation`, `…060000_g_tds_ledger_seq`, `…070000_h_invoice_line_landed` (hand-written SQL, forward-only).
* A: `tds_sections`, `supplier_tds_ledger`, `scm_settings` (one row), `scm_unit_settings`, `supplier_items`, `scm_budgets`, `purchase_contracts` (+ lines); `stock_voucher_types` GRN / GRN_QC / PUTAWAY / PURCH_RETURN; account **6272** `ITC_REVERSED_180` + `account_defaults` + posting rule (`LANDED_COST_CLEARING` and `ITC_INELIGIBLE_EXPENSE` rules already existed from Phase 7; inserted again `ON CONFLICT DO NOTHING`).
* B: `purchase_requisitions` (+ lines), `rfqs` (+ lines, `rfq_suppliers`), `vendor_quotes` (+ lines with `cost_breakup`), `vendor_comparisons` + `comparison_entries`, `document_links`.
* C: `purchase_orders`, `purchase_order_lines` (received / accepted / billed / returned / closed counters, model, part no, lead days, delivery date), `purchase_order_revisions`.
* D: `goods_receipts`, `goods_receipt_lines`, `goods_receipt_batches`, `goods_receipt_charges`, `putaway_tasks`.
* E: `purchase_invoices` (+ lines, charges), `invoice_match_exceptions`, `debit_notes` (+ lines), `supplier_payment_proposals` (+ lines), `supplier_payments` (+ allocations), `itc_reversals` (created here, E-23).
* F: `supplier_evaluations`.
* G: `supplier_tds_ledger.seq` (identity). Found by the first clean runs: `created_at` is the transaction *start* time, so two parallel invoices of one supplier could be stored in the opposite order of their cumulative totals; the ledger is now ordered by `seq`, which is assigned while the supplier + year + section advisory lock is held.
Other code touched: `LedgerVoucherType` (+4 types), `DOC_PREFIX` (+13 series), `ErrorCode` (+20 codes), audit action list (+12 `SCM_*`), notification types (+9 `SCM_*`), pg-boss queue `scm.daily`, app router. Prisma models were **not** added: the module uses raw SQL (like Phase 8's migration code).

## 3. Deviations and things you must decide
1. **No `document_types` table exists** in this repository (the spec's lookup inserts assume one). Number series are `DOC_PREFIX` entries instead (`PR`, `RFQ`, `VQ`, `CMP`, `PO`, `CON`, `GRN`, `PINV`, `SINV`, `PDN`, `SPP`, `SPAY`, `EVL`; put-away reuses `PUT`).
2. **QC hold = Phase 8 stock status**, not a separate QC-hold warehouse (the client requirement and the Phase 8 report say Quality Inspection). Accepted → Unrestricted, rejected → Blocked; a RETURN debit note takes Blocked stock first. `scm_unit_settings.qc_hold_warehouse_id` exists but is unused (and `QC_HOLD_WAREHOUSE_MISSING` is never raised).
3. **TDS rates the spec did not give are empty on purpose**: 194J, 194H, TCS 206C(1H), individual / HUF rates, no-PAN rates, the Income-tax Act 2025 section references. The code refuses to deduct (`TDS_RATE_MISSING`) while a section has no rate. 194J/194H are loaded with an *annual* limit (50,000 / 20,000) because the spec states one number. Effective-from dates (`2021-07-01` for 194Q, `2020-04-01` for 194C/J/H, `2020-10-01` for 206C(1H)) are my placeholders; all rows `needs_review`.
4. **Supplier-evaluation grade bands** are not in the spec (it only says 72.0480 = B): defaults A ≥ 85, B ≥ 70, C ≥ 50, else D, in `scm_settings`, `needs_review`. "D from OTIF with a floor of 70" is implemented literally (D = max(OTIF %, 70)).
5. **RFQ minimum suppliers** (`rfq_min_suppliers_above`) is stored but **not enforced**: the spec gives no count. Issue needs at least one invited supplier.
6. **Reverse charge** follows the §5 GL table (Dr INPUT_x / Cr RCM_PAYABLE_x at invoice time) although §3 says "ITC after payment". The RCM flag is chosen on the invoice by the user: `hsn_sac_rates` has no `rcm` column in this repository. s.17(5) is flagged by the accountant (`itc_flag`), never auto-detected.
7. **Debit-note rounding** follows the two worked examples: a return against an invoice rounds to the rupee (ROUND_OFF), a rate-difference note keeps paise.
8. **Budget check** (PR) uses `scm_budgets` (mode OFF/WARN/BLOCK, default OFF) with committed PR value, not Phase 7 `BudgetService`, which needs an expense account a PR does not have.
9. **`fin-debitnote` is one page with two stores**: Phase 7 standalone notes and these stock-linked notes share one approval handler that asks which table owns the document. Numbers use series `PDN`. The web screen `fin-debitnote` still shows the Phase 7 notes only: the stock-linked notes are reachable through the API (`POST /fin/debitnote`, `/from-grn`, `/from-invoice`) and not yet through a web form.
10. **Phase 5 tests** used the (then generic) pages `scm-pr` / `scm-po` as sample documents. They now use `scm-approval` (still generic, Purchase department); logic unchanged. Web test `Finance.test.tsx` "Accounts Payable ageing" now reads `/fin/ap/ageing` (the page was replaced by the Phase 9 AP screen).
11. **Not built / left for later**: the `scm-approval` page filter (still the generic page), web tabs of `scm-suppliers` (the three tabs exist as API: `/scm/suppliers/:id/scorecard|risk|compliance-documents`), a web form for stock-linked debit notes, due-date override action (`SCM_DUE_DATE_OVERRIDE` is in the audit list, no endpoint), landed-cost revaluation after GRN, import/BOE, bank file/H2H, subcontract challans (all out of scope in §12). `SCM_TDS_RECALC` is not written.
12. The calc package cannot be imported by the API (`rootDir=src`), so `modules/procurement/math.ts` is a Decimal copy; `tests/phase09-math.test.ts` proves it equals `packages/calc` on every example.

## 4. Test results
| Suite | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| API `npx vitest run` (clean test DB each run, 69 files + 2 skipped) | 990 pass / 45 skipped | 990 / 45 | 990 / 45 (see note) |
| Phase 9 API files inside it (`phase09-chain`, `-sourcing`, `-ap`, `-guards`, `-math`: 26 tests) | all pass | all pass | all pass |
| `packages/calc` (46 tests, 19 of them Phase 9) | 46 / 46 | 46 / 46 | 46 / 46 |
| Web `npx vitest run` (44 files, +3 Phase 9 tests) | 375 pass / 29 skipped | 375 / 29 | 375 / 29 |
| e2e `auth.spec.ts` + `phase9.spec.ts` (3 Phase 9 stories) | 3 / 3 | 3 / 3 | 3 / 3 |

Note on the API runs. The first set of three clean runs found two real defects, both fixed before the numbers above: (1) two parallel GRNs of one PO could deadlock (now a per-PO advisory lock is the first statement of the GRN transaction, same per supplier for invoices) and (2) parallel invoices of one supplier could store the TDS ledger in the wrong order (migration G). After those fixes the runs were: pass, pass, one failure in `phase01-identity` "enforces challenge flow when MFA is enabled" (a TOTP time-window test of Phase 1, unrelated to Phase 9; the file then passed 3 of 3 alone), and a fourth full run that passed. The table shows the three passing runs.

Covered by the API tests: the whole §5 GL chain with the exact figures (GRN 5,500 / 5,000 / 500; invoice 4,900 GRIR, 49 PPV, 445.41 + 445.41 input tax, 0.18 round-off, 5 TDS, 5,835 AP; return Dr GRIR 100 / PPV 10 / Cr stock 110), QC 98/2, put-away, MATCH_BLOCKED with "Billed 100, received 98", DUPLICATE_INVOICE, TDS 194C 1,200 / 0 / 900 on real invoices and TDS_LATER_ENTRIES, RCM freight, ITC-180 reverse (once) and the 6272 balance, MSME due date, payment with UTR + BANK_UNVERIFIED + idempotent replay, ageing, evaluation row, contract limit CONTRACT_QTY_EXCEEDED, PO amend + revisions + short-close, delivery tracking (Delayed), supplier hold / not approved / contractor on a material PO, 401 on 22 read routes, every read route 200, 403 without access, 404 in another unit, 422, stale version 409, GRN cancel and its audit rows, and the concurrency cases (two GRNs on the last units → one OVER_RECEIPT, same invoice number twice → one 409, double put-away claim → one wins, replayed post → one journal, parallel TDS → correct cumulative).


## 5. Known issues
* e2e `auth.spec.ts` test 6 (waits for an old role label; 1-minute timeout) fails exactly as in the Phase 8 report; it is not a Phase 9 change.
* Repo-wide `npm run lint` still reports the old errors outside Phase 9; every new Phase 9 file (api src, api tests, web src, web tests) is eslint / prettier clean. `tsc` on `apps/api` still reports the old errors in `tests/kit-*.test.ts` and `tests/assert-can-post.test.ts`; `src/` is clean.
* The browser (Playwright) tests are a smoke test of the 11 pages and their main dialogs. The full chain with money, stock and GL is proved by the API tests; there is no browser test that clicks PR → payment.
* OWN / DEPARTMENT data scope is applied (`created_by_id` for OWN, unit always); DEPARTMENT scope is treated like UNIT inside the unit.

* **Independent review done** (`/code-review medium` on the procurement API, calc and web pages): 11 findings, all fixed, then the full API suite passed again (990 / 45 skipped). Fixed: debit notes check the supplier and cap the value against the invoice and earlier notes; one receipt line cannot appear twice on an invoice; cancelling a payment also reverses the Rule 37 reclaim (bank cancel runs last because it commits on its own); partial QC decisions create put-away tasks for the accepted quantity only; freight lines are linked to their receipt on the line (migration H, not matched by amount); vendor-printed IGST is used even without CGST; the "on hold" notice survives MATCH_BLOCKED; a requisition line cannot be ordered twice and BLOCK budget mode is enforced on submit; one PO per awarded comparison, unit-scoped (unique index in migration H); ITC-at-risk reads GSTR-2B status; award recomputes ranks and keeps stored weights. Not re-run after these fixes: the web and e2e suites (no web code changed).

## 6. Manual check list for the owner (5–15 clicks)
1. **System Setup › Control Center**: switch approval off for PR, PO, GRN, Purchase Invoice (or approve with a second person).
2. **Item Master**: an item with *Quality Inspection Required* ticked; **Supplier Master**: an approved supplier in Maharashtra; a bin under **Bin Management**.
3. **Purchase Requisition › New** → Submit → **Create RFQ** → invite 3 suppliers → Issue → three **Vendor Quotations** → **Vendor Comparison › Compare quotes** → Submit → Award → **Create purchase order** → Submit. Does it say *Approved*?
4. **Goods Receipt › Receive against PO** → type 100 (freight 500) → Save and submit. Banner: *Stock in QC hold*. **Stock Balance** shows 100 in Quality Inspection.
5. Open the receipt → **Decide** 98 accepted / 2 rejected. A put-away task appears; **Put Away** → Claim → bin → Done. The bin shows 98.
6. **Purchase Invoice › New** from that receipt, billed 100 @ 50.50: the line is red, *Billed 100, received 98*. Change to 98 → Submit. **Trial Balance**: GRIR 100, PPV 49, Input CGST/SGST 445.41, TDS 5 (for a 194Q supplier above the limit), AP 5,835.00.
7. API (`POST /fin/debitnote`, kind RETURN, grn + line, qty 2) → the 2 rejected pieces leave Blocked stock; GRIR becomes 0.
8. **Accounts Payable › Proposal for invoices due till** → Submit → (approver) → `POST /fin/ap/proposals/:id/to-payments` → **Payments › Pay** with a UTR → ageing falls to zero.
9. **Purchase Orders › Delivery tracking** shows Open / Partly received / **Delayed** lines.
10. **Supplier Evaluation › Run evaluation** shows rank and grade; red row = compliance failed.
