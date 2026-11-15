# 05 — Finance & Accounts (19 pages) + Indian Taxation (10 pages) — INDEX AND MASTER PLAN

> **File set (read all, in this order).** The plan is long, so it is split as the task allowed (same layout idea as `03-SCM-PROCUREMENT.md`).
> | File | Holds |
> |---|---|
> | `05-FINANCE-TAX.md` (this file) | the 16 headings 0-15: short summaries with pointers for 0-9 and 12, and **in full** sections 10, 11, 13, 14, 15 |
> | `05a-FINANCE-TAX-SCOPE-UI-PROCESSES.md` | **0 Header, 1 Scope and status, 2 The frozen UI page by page (29 pages), 3 Market, 4 End-to-end processes** incl. **4.1.4 alignment with plans 03/04 (binding)** |
> | `05b-FINANCE-TAX-DATABASE.md` | **5 Database design**: ERD, DDL + Prisma for every NEW table, SQL report functions, migration order, seeds (chart of accounts, report lines, defaults, TDS/TCS, posting rules) |
> | `05c-FINANCE-TAX-RULES-API.md` | **6 Business rules BR-FIN-01..45, 7 API, 8 Reports and KPIs, 9 Extra functions** |
> | `05d-FINANCE-TAX-TICKETS.md` | **12 Build tickets T-FIN-01 .. T-FIN-46** |
>
> Always read `00-BUILDER-RULES.md` and `01-SHARED-FOUNDATION.md` first. They win over this plan except where a line starts with `FOUNDATION-CHANGE:`. **Where `05a` section 4.1.4 differs from other text in 05a-05c, 4.1.4 wins** (it records the contracts agreed with plans 03 and 04 after they were written). Dates are as of **2026-11-03**.

---

## 0. Header
*(Full text: `05a` section 0.)* Purpose: the real accounting engine (chart of accounts, fiscal periods, immutable general ledger `gl_entries`, journals, `AccountingService.post/reverse`, `posting_rules`, draining of `accounting_event_queue`), cash/bank books, supplier payments, bill-wise AR/AP, credit/debit notes, bank reconciliation, cost/profit centres, expenses, budgets, statutory reports, and the Indian tax layer (GST registrations, registers, GSTR-1, GSTR-2B reconciliation, GSTR-3B with credit utilisation, TDS/TCS register-challan-return data, e-invoice and e-way bill JSON with manual IRN/EWB entry; no portal calls in v1). Users: Finance, CFO, ADMIN+. Needs plans 02 (`accounting_event_queue`), 03 (`parties`, `tax_codes`, `hsn_sac`, `tds_sections`, events), 04 (Sales events, collections, credit notes). Foundation changes FC-1..FC-6 (+ revised FC-3) are listed in `05a` section 0 and 4.1.4.

## 1. Scope and status
*(Full text: `05a` section 1.)* 29 pages: **typed** `fin-coa, fin-journal, fin-ar, fin-ap, fin-creditnote, fin-debitnote, fin-bankreco, fin-costcenter, fin-profitcenter, fin-expenses, fin-budget, tax-gst, tax-gstr1, tax-gstr3b, tax-tds, tax-tcs, tax-hsn, tax-einvoice, tax-eway`; **report-view** `fin-gl, fin-trial, fin-pnl, fin-bs, fin-cashflow, fin-ageing, tax-salesreg, tax-purchasereg`; **mixed** `fin-cashbook, fin-bankbook` (read-only ledger plus `[ADD]` Payment / Transfer / non-customer Receipt buttons). Frozen Add/Edit/Delete render disabled with the tooltip "Report — post a voucher instead" on report pages. All 29 are today generic placeholders and move to `TYPED_PAGES`.

## 2. The frozen UI, page by page
*(Full text: `05a` section 2.)* For every page: field table (labels and order from `packages/registry/registry.json`, types and required marks from `field-types.json`), statuses, row actions, filters, totals, empty state, and the six profile tabs with renderer type, content and data source. `[ADD]` items are appended after frozen items.

## 3. How the market does it
*(Full text: `05a` section 3.)* ERPNext, Odoo, Zoho Books, Tally Prime, SAP, Dynamics: adopt immutable GL entries (ERPNext/Dynamics), group-based chart with Schedule III line mapping (Tally), bill-wise settlement (Tally), lock-date ladder (Odoo), bank reconciliation with scored auto-match (Zoho/Odoo), budget control Ignore/Warn/Stop (ERPNext/Dynamics), symbolic posting rules (SAP/Dynamics), GSTR JSON + 2B reconciliation (ERPNext India Compliance); skip live bank feeds and portal APIs in v1.

## 4. End-to-end processes
*(Full text: `05a` section 4; flows F1-F11 with mermaid diagrams.)* Event -> journal (queue, rules, drain), manual journal and reversal, payments with allocation, bank import and reconciliation, credit/debit notes, period and FY close with carry-forward, GST monthly cycle, TDS deduction -> challan -> quarterly return, e-invoice / e-way JSON with manual numbers, budget check, expense claim. **4.1.4** fixes the contracts with plans 03/04 (symbolic event lines mapped by `posting_rules`, TDS and TCS ownership, Sales-owned receipts and credit notes mirrored in Finance, supplier payments calling `PurchaseInvoiceService.applyPayment`, e-invoice/e-way write-back to Sales).

## 5. Database design (the core)
*(Full text: `05b`.)* 42 new tables with full DDL in 05b plus 2 SHOULD tables (T-FIN-43), list below, each with DDL, indexes, triggers, Prisma model and seed notes; decisions D-FIN-2 (separate immutable `gl_entries`, deferred balance trigger), D-FIN-3 (company-wide periods, unit as dimension), D-FIN-4 (bill-wise `open_items` + append-only `allocations`); SQL functions `fn_trial_balance`, `fn_account_movement`, `fn_open_items_asof`; 9 migration folders in order; seed of 211 accounts, report lines, account defaults, MAP/BUILD posting rules, TDS/TCS notes.
New tables: `accounts, fiscal_periods, report_lines, account_defaults, cost_centers, profit_centers, journals, journal_lines, gl_entries, posting_rules, open_items, allocations, bank_accounts, payments, bank_statements, bank_statement_lines, bank_matches, credit_debit_notes, credit_debit_note_lines, expense_policies, expense_claims, budgets, budget_months, budget_commitments, fiscal_year_closings, gst_registrations, tax_documents, tax_document_lines, tax_ledger, gst_returns, gst_return_sections, gst_return_issues, gstr2b_imports, gstr2b_lines, gstr2b_matches, tax_challans, tax_returns, tds_entries, tax_challan_allocations, einvoice_records, eway_validity_rules, eway_bills, recurring_journals, bank_rules` (44; plus ALTERs of `accounting_event_queue` and plan 03's `tds_sections`; `recurring_journals` and `bank_rules` DDL is in ticket T-FIN-43).

## 6. Business rules and formulas
*(Full text: `05c`.)* BR-FIN-01..45 with worked numbers and error codes: balanced journal, period/lock, account usability, reversal, idempotency, rounding, numbering, allocation FIFO, cash limits, TDS (threshold catch-up, EXCESS_ONLY, no-PAN), TCS, GST split verification, GSTR-3B utilisation order (examples A and B), RCM, ITC eligibility/time-bar/rule 37, interest and late fee, bank reconciliation difference and match score, TB/BS/P&L/cash-flow formulas, ageing, MSME interest, budget control, year-end close, credit/debit notes, e-invoice, e-way validity, GSTR-1 build, GSTR-2B matching, filed-period lock, integrity checks.

## 7. API design
*(Full text: `05c`.)* `AccountingService` interface and the 13-step `postJournal` algorithm, typed page definitions and actions, ~90 endpoints, report endpoints, export hooks, permission gates implemented as page actions (no role names in services), error code list, audit actions, `TdsService`, GSTR-1 JSON layout, TDS return CSV, `GstPortalAdapter` (manual only), queue drain job.

## 8. Reports and KPIs
*(Full text: `05c`.)* Cash+bank, AR, AP, DSO, DPO, net profit, gross margin, budget variance, unreconciled bank items, GST liability, ITC available vs claimed, 2B mismatches, TDS payable by due date, returns due, invoices without IRN, e-way bills expiring, MSME overdue, pending postings.

## 9. Extra functions `[ADD]`
*(Full text: `05c`.)* 34 prioritised items (MUST / SHOULD / COULD) with market source and ticket.

---

## 10. Edge cases and careless-user scenarios

Each row has the exact safe behaviour and the proving test (file under `apps/api/tests/`; `it` name abbreviated). IDs EC-01...

| ID | Scenario | Safe behaviour | Proving test |
|---|---|---|---|
| EC-01 | Posting into a closed period | 409 `PERIOD_CLOSED`; nothing written; queue row (event) becomes FAILED with the same code | `fin-accounting::closed period` |
| EC-02 | Posting into a LOCKED period without override | 409 `PERIOD_LOCKED`; with `overrideLock` + reason + `edit` on `admin-fy`: posts, warning `LOCK_OVERRIDDEN` stored | `fin-accounting::locked period` |
| EC-03 | Unbalanced journal (Cr 4,999.99 vs Dr 5,000.00) | 422 `JOURNAL_UNBALANCED` with difference 0.01; Save disabled in UI while difference is not 0.00 | `fin-accounting::unbalanced`, `FinanceForms.test::difference disables post` |
| EC-04 | Amount with 3 decimals (10.005) | 422 `AMOUNT_PRECISION` (never silently rounded) | `fin-accounting::precision` |
| EC-05 | Double posting of one event (same key twice, or two drains at once) | exactly one journal; second enqueue returns the first; changed payload -> 409 `EVENT_PAYLOAD_CHANGED` | `fin-enqueue::idempotent`, `fin-drain::concurrent` |
| EC-06 | Deleting a posted voucher (API DELETE / SQL DELETE) | API 409 `RECORD_LOCKED`; DB trigger blocks DELETE/UPDATE on `gl_entries`, posted journals and lines | `fin-ledger-db::immutable`, `fin-journal::delete posted` |
| EC-07 | Reversing twice / reversing a reversal | 409 `ALREADY_REVERSED` / `CANNOT_REVERSE_REVERSAL` (unique index `journals_reversal_of_key` as safety net) | `fin-accounting::reverse twice` |
| EC-08 | Backdated entry before go-live | 422 `BEFORE_GO_LIVE` (except Opening/Closing) | `fin-accounting::go live` |
| EC-09 | Future-dated entry (> today + 1) | 422 `FUTURE_DATE` unless setting allows | `fin-accounting::future` |
| EC-10 | Posting to a group / inactive / deleted account | 422 `ACCOUNT_NOT_POSTABLE` | `fin-accounting::account rules` |
| EC-11 | Control account line without party, or customer party on a payable account | 422 `PARTY_REQUIRED` / `PARTY_ROLE_MISMATCH` | `fin-accounting::party rules` |
| EC-12 | Overpayment: allocation larger than invoice outstanding | 422 `OVER_ALLOCATION` | `fin-payments::over allocation` |
| EC-13 | Payment with no allocation at all (accidental advance) | 422 `ADVANCE_NOT_CONFIRMED` unless `allowAdvance` | `fin-payments::advance` |
| EC-14 | Paying a blocked / disputed invoice | 422 `ITEM_BLOCKED` | `fin-openitems::blocked` |
| EC-15 | Duplicate bank statement file / duplicate UTR payment | 409 `DUPLICATE_STATEMENT` / 409 `DUPLICATE`; duplicate lines inside a new file are skipped and counted | `fin-bankreco::dup file`, `fin-payments::dup utr` |
| EC-16 | Statement that does not foot (opening + deposits - withdrawals != closing) | 422 `STATEMENT_DOES_NOT_FOOT`; nothing imported | `fin-bankreco::foot` |
| EC-17 | Reconciling with a non-zero difference / pending suggestions | 422 `RECON_DIFFERENCE` / `SUGGESTIONS_PENDING` | `fin-bankreco::reconcile guard` |
| EC-18 | Two users match the same ledger entry | the second gets 409 (row lock + unique active match); no double clearing | `fin-bankreco::concurrent match` |
| EC-19 | Reversing a journal whose bank line is reconciled | 409 `RECONCILED_ENTRY` | `fin-bankreco::reconciled reverse` |
| EC-20 | Reversing a document that is partly paid | 409 `SETTLED_DOCUMENT` (reverse the allocation first) | `fin-payments::settled reverse` |
| EC-21 | Wrong GSTIN (bad checksum, state prefix mismatch) | 422 `GSTIN_INVALID` / `GSTIN_STATE_MISMATCH` on registration; on a party/document the GSTR-1 validation issue `GSTIN_INVALID` blocks JSON | `fin-tax-gst::gstin`, `fin-gstr1::issues` |
| EC-22 | Invoice dated in a filed GST period | 409 `GST_PERIOD_FILED` (queue row FAILED; Finance re-dates it) | `fin-gstr1::filed lock` |
| EC-23 | GSTR-3B computed before GSTR-1 is filed | 409 `GSTR1_NOT_FILED` | `fin-gstr3b::needs gstr1` |
| EC-24 | Cash deposit short for the cash liability | 409 `CASH_LEDGER_SHORT`; no ledger rows written | `fin-gstr3b::cash short` |
| EC-25 | Claiming ITC after 30 Nov of the next FY, or not in 2B | 422 `ITC_TIME_BARRED` / `MATCH_REQUIRED` (override only with reason + gate, audited) | `fin-gstr2b::time bar` |
| EC-26 | Credit note larger than the invoice, or after the Section 34 date | 422 `CREDIT_EXCEEDS_INVOICE`; late -> commercial note with zero GST and a banner | `fin-notes::exceeds`, `fin-notes::late` |
| EC-27 | TDS without PAN | rate = no-PAN rate, entry flagged, never zero | `fin-tds-pure::no pan` |
| EC-28 | Deleting / cancelling a TDS entry already in a challan | 409 `TDS_ALREADY_DEPOSITED` | `fin-tds::deposited` |
| EC-29 | Challan total differs from Σ allocated entries | 422 `CHALLAN_MISMATCH` | `fin-tds::challan` |
| EC-30 | IRN of wrong length, entered late (> 30 days for AATO >= 10 Cr), or cancel after 24 h | 422 / flagged `late` + warning / 409 `CANCEL_WINDOW_PASSED` | `fin-einvoice::*` |
| EC-31 | E-way bill extension outside the window, vehicle number malformed | 409 `EXTENSION_WINDOW` / 422 | `fin-eway::*` |
| EC-32 | Negative cash balance via payment | 409 `NEGATIVE_CASH` | `fin-payments::negative cash` |
| EC-33 | Cash receipt of ₹2,00,000 or more from one party in a day | 422 `CASH_RECEIPT_LIMIT` | `fin-payments::269ST` |
| EC-34 | Budget exceeded in `Stop` mode | 409 `BUDGET_EXCEEDED`; MANAGER override needs a reason and is audited | `fin-budget::stop` |
| EC-35 | Maker approves own journal / note / expense | 403 `MAKER_CHECKER` | `fin-journal::maker checker` |
| EC-36 | Year-end close with a Draft journal, pending queue rows or unbalanced TB | 409 `CLOSE_BLOCKED` with the list | `fin-close::blocked` |
| EC-37 | Opening balances posted twice or not balanced | 409 `OPENING_ALREADY_POSTED` / 422 `OPENING_NOT_BALANCED` | `fin-close::opening` |
| EC-38 | Stale edit (two users edit the same draft) | 409 `VERSION_CONFLICT` via `If-Match` | `fin-journal::version` |
| EC-39 | Double click on Post / Pay (same Idempotency-Key) | one journal, replay header | `fin-journal::idempotent` |
| EC-40 | Event with an unknown logical account key, or no rules | queue row FAILED `UNMAPPED_ACCOUNT_KEY` / `NO_POSTING_RULE`, visible in `Post pending` badge | `fin-rules::unmapped` |
| EC-41 | Tax block that does not add up (IGST with CGST, sums differ) | 422 `TAX_PAYLOAD_MISMATCH` -> FAILED row | `fin-registers::mismatch` |
| EC-42 | Report page add/edit/delete via API | 405 `READ_ONLY` | `fin-pages-infra::read only` |
| EC-43 | User without page permission or from another unit | 403 / 404; All Units never writes (`CONTEXT_INVALID`) | `fin-pages-infra::access` |
| EC-44 | Rounding drift: invoice with round-off 0.11 and 0.50, negative round-off | balanced journals; |round-off| > 1.00 -> `ROUND_OFF_TOO_LARGE` | `fin-rules::round off` |
| EC-45 | Vendor invoice number entered twice for the same supplier | 409 `DUPLICATE` (unique open item / tax document) | `fin-openitems::dup invoice` |
| EC-46 | Supplier bank account changed and paid in the same hour | 422 `BANK_ACCOUNT_UNVERIFIED` until a second user verifies (foundation 3.1) | `fin-payments::unverified account` |
| EC-47 | Posted document edited via SQL by an administrator | blocked by triggers; the audit trail never contains an UPDATE of the ledger | `fin-ledger-db::immutable` |

## 11. Test plan

### 11.1 Unit tests (pure)
`money` rounding (half-up, 0.005 -> 0.01), `assertBalanced`, FIFO suggestion, TDS compute (BR-FIN-12 tables), `utilise` (examples A, B and variants), `gstInterest`/`gstLateFee`, MSME interest, e-way validity, GSTIN checksum, IRN regex, bank match scoring, statement engine formulas, cash-flow identity. Files `fin-*-pure.test.ts`.

### 11.2 API tests
One file per ticket as named in `05d`. Every posting endpoint tested for: success, each error code of its rules, permission (403), version conflict, idempotent replay, audit row written. Registry/schema conformance for all 29 pages (labels, order, required flags, typed kind).

### 11.3 End-to-end scenarios (T-FIN-42; each asserts the journal lines and balances exactly)
* **E1 Sales invoice to receipt.** Sales invoice (BR-SAL-43 example): AR 14,603.00 / Sales 12,375.00 / CGST 1,113.75 / SGST 1,113.75 / Round-off 0.50 -> drain -> journal `EV/SI/TAL/2627/00001`; AR open item 14,603.00; Sales collection 10,000.00 (event `RECEIPT_RECEIVED` with allocation) -> outstanding 4,603.00; remaining 4,603.00 -> settled; TB variance 0.00; GSTR-1 (Oct) B2CS/B2B totals equal register; output tax accounts 2301 = 1,113.75, 2302 = 1,113.75.
* **E2 Purchase with TDS.** GRN (Dr INVENTORY 10,600; Cr GRIR 10,000; Cr LANDED 600) then invoice (Dr GRIR 10,000; Dr INPUT_CGST 900; Dr INPUT_SGST 900; Cr TDS_PAYABLE 200; Cr AP_CONTROL 11,600) -> inventory 10,600 = GL 1301; AP item 11,600; TDS entry 200 (194C, supplier PAN present); payment 11,600 from bank -> settled, SCM `applyPayment` called; TDS challan 200 `Dr 2311 / Cr bank`; GL 2311 = 0.
* **E3 Credit note path.** Invoice taxable 1,00,000 @18% intra; Finance manual credit note 10,000 -> CGST 900, SGST 900, total 11,800.00; AR item reduced; GSTR-1 CDNR shows it; liability = 18,000 - 1,800 = 16,200.00.
* **E4 Bank reco.** BR-FIN-19 example completes with Difference 0.00.
* **E5 Period close.** Lock Oct; post into Oct -> blocked; unlock; close FY (unit TAL profit 3,00,000) -> `3004` credited; next FY TB opening shows 3,00,000.00.
* **E6 GST month.** Outward 50,000 IGST / 30,000 CGST / 30,000 SGST; ITC 40,000 / 20,000 / 25,000; GSTR-1 Filed; GSTR-3B compute + utilise -> cash 25,000, credit used 85,000; settlement journal zeroes 2301-2303 for the period and reduces 1401-1403 by the credit used.
* **E7 Reversal chain.** Post journal 10,000; reverse; both visible; every account net 0.00; reversal of a reconciled bank line refused.
* **E8 Budget stop.** Budget 1,00,000 Stop, actual 70,000, commitment 20,000: expense 15,000 blocked; 10,000 posts.
* **E9 E-invoice.** B2B invoice creates `Pending` record with `due_by` = date + 30 (band GE_10CR); JSON equals fixture; IRN entered -> `tax_documents.irn` set; GSTR-1 shows `irn`; cancel after 25 h refused.
* **E10 Inventory valuation = GL.** Random 50 stock events through the drain: `Σ stock_balances.value` = Σ GL 1301..1308 per unit.

### 11.4 Property / simulation tests (T-FIN-41)
Invariants over 10,000 random vouchers: P1 every journal balances; P2 TB variance 0.00 at every period end; P3 BS equation 0.00; P4 `settled_amount = Σ allocations` per open item and 0 <= settled <= abs(amount); P5 party sub-ledger = GL control balance; P6 `gl_entries` row count = `journal_lines` count of posted journals; P7 reversal pairs net to zero per account; P8 numbers per (type, unit, FY) gap-free; P9 `tax_documents` Σ per GSTIN equals Σ GL output tax accounts for the same period (except RCM); P10 inventory = GL.

### 11.5 Web and Playwright
Vitest: disabled report buttons with tooltip, view tabs, journal editor difference, FIFO modal, reco match button; Playwright `finance.spec.ts` (T-FIN-45) with screenshot comparison to `reference/screens/v92/` for the first tab of each page.

## 12. Build tickets
*(Full text: `05d`.)* 46 tickets in strict order. First tickets as required: **T-FIN-01/02 chart of accounts + periods + seeds -> T-FIN-03/04 ledger + `AccountingService.post/reverse` -> T-FIN-05/06 queue + `posting_rules` seed -> T-FIN-07 queue drain -> T-FIN-08 typed-page infrastructure -> T-FIN-09 manual journal**, then COA page, GL, centres, bank accounts, payments and books, AR/AP, notes, bank reco, TB, P&L/BS, cash flow, ageing, expenses, budgets, close; then tax core, GST setup/HSN, registers, GSTR-1, 2B, 3B, TDS, TCS, e-invoice, e-way, MSME/GST interest, integrity, KPIs, exports, web, simulation, API e2e, SHOULD tickets (43, 44, 46), Playwright. Size index and BR coverage table: `05d` section 12.1.

## 13. Reviewer checklist

Likely builder mistakes and what to verify (each item names the evidence):
1. **Money as float**: grep `parseFloat|Number\(|toFixed` in `modules/finance/**` and `modules/tax/**` outside DTO mappers/JSON writers; all arithmetic `Decimal`; JSON writers convert at the last step only.
2. **Unbalanced journals**: `assertBalanced` called before any insert; DB constraint trigger present; test with Cr 4,999.99 exists and passes; events validated at enqueue.
3. **Mutable ledger**: no `UPDATE`/`DELETE` on `gl_entries`, `allocations`, `tax_ledger` in any repository; triggers present with `TRUNCATE`; posted journals changed only through `reverse`.
4. **Wrong GST split**: Finance never recomputes tax; `TAX_PAYLOAD_MISMATCH` checks CGST=SGST, IGST XOR (CGST+SGST), sums; GSTR-3B utilisation order exactly BR-FIN-15 (IGST credit first and fully; CGST credit never against SGST; cess only against cess; RCM paid in cash).
5. **GSTR-3B before GSTR-1**: `GSTR1_NOT_FILED` guard for periods >= July 2025; liability not editable.
6. **Period handling**: period row locked `FOR SHARE`; LOCKED vs CLOSED vs FY closed all tested; GST filed lock separate.
7. **Idempotency**: unique `(event, doc_type, doc_id)` and journal source key; parallel drain test; `Idempotency-Key` on money POSTs; status checked inside the transaction.
8. **Numbering**: numbers taken at post, inside the transaction, from `number_series` (never `MAX+1`); Draft journals use `DRAFT-` codes; deleted Draft burns no number.
9. **Open items / allocations**: row locks `ORDER BY id FOR UPDATE`; `settled_amount` equals Σ allocations; reversal rows not updates; control-account lines carry party and bill reference; Finance never allocates a Sales receipt.
10. **Plan 03/04 contracts** (4.1.4): symbolic keys mapped by `posting_rules`, unknown key -> FAILED row (not guessed); TDS copied from payload (not recomputed); `tds_sections` not recreated; notes from Sales/SCM are read-only mirrors; supplier payment calls `applyPayment`.
11. **TDS**: threshold catch-up arithmetic reproduces the 5-row table (0,0,0,2,140,400); no-PAN rate; individual vs other rate by PAN 4th character; entries with zero TDS still tracked; challan Σ check.
12. **Frozen UI**: labels/order equal registry; 16 tabs untouched; report pages keep buttons disabled with the exact tooltip; no CSS changes; `[ADD]` items appended after frozen ones.
13. **Permissions**: every route has `requirePageAction`; special gates are page actions (`delete` on the page, `edit` on `admin-fy`), no role-name checks in services; All Units read-only.
14. **Audit**: every write audited with the actions of 7.7; ledger never audited as UPDATE.
15. **Report correctness**: TB opening rule for P&L accounts; closing journals excluded from P&L but included in BS and TB; BS equation; cash-flow identity; ageing uses outstanding as of the date.
16. **No portal calls**: grep test for network imports under `modules/tax/**`; adapter interface manual only.
17. **Prisma vs SQL**: every SQL column has the same-named Prisma field (reviewer diffs column lists per table); generated columns never written.
18. **Statutory constants** are data (settings or effective-dated rows), not hard-coded: thresholds, rates, due dates, late-fee caps, e-way km/day.
19. **Tests prove numbers**: examples of the plan appear in tests with the same figures; tests clean only their own rows; `ORDER BY` everywhere lists are compared.
20. **Soft delete / retention**: no hard delete path for posted data; Draft soft delete only.

## 14. Open questions and decisions taken (defaults apply until the owner answers)

| # | Question | Default taken |
|---|---|---|
| OQ-1 | `Current Month`, `Current Period`, `Prior Period` are typed `date` in `field-types.json` for P&L/BS/CF | Keep labels and order; the typed schema declares them `money` (they hold amounts); the registry test compares label+order only |
| OQ-2 | Employees who claim expenses before HRMS exists | created as `parties` (`INDIVIDUAL`, supplier) |
| OQ-3 | `Vehicle` ref on `tax-eway` while Logistics vehicles do not exist | vehicle number text with regex |
| OQ-4 | Inter-unit transfers between different GSTINs are taxable supplies; who supplies the tax block? | Inventory plan (assumed); Finance books only when the payload has `tax`; otherwise transit accounts only |
| OQ-5 | Two TDS threshold trackers (plan 03 `supplier_tds_ledger`, Finance `tds_entries`) | Finance uses the larger cumulative base of the two; consider retiring `supplier_tds_ledger` later |
| OQ-6 | Producer payload names (`tax`, `tds`, `allocations`, `bankAccountId`) differ from this plan | adapters in `F/events/adapters.ts` map them; missing data -> QUESTION in the builder report |
| OQ-7 | TDS rounding to whole rupees (D-FIN-5) | nearest rupee half-up per entry; confirm with the CA |
| OQ-8 | Rent TDS threshold (₹6,00,000 per year vs ₹50,000 per month) | annual 6,00,000 seeded, flagged for review |
| OQ-9 | TCS 27EQ / TDS 26Q form names and challan codes under the Income-tax Act 2025 | configurable text; defaults 26Q / 27EQ (unverified) |
| OQ-10 | GSTR-3B IGST spill order (CGST first or SGST first) | `fin.igst_spill_order = CGST_FIRST` |
| OQ-11 | Late-fee caps per return and the B2CL limit | settings `gst.latefee_cap_*`, `gst.b2cl_limit` with the values in BR-FIN-18 / BR-FIN-33, unverified |
| OQ-12 | Approval thresholds (journal ₹5,00,000; notes ₹1,00,000) | settings; replaced by `ApprovalService` in Phase 6 |
| OQ-13 | Bank statement formats beyond CSV/XLSX (MT940, CAMT.053) | not in v1 (optional later) |
| OQ-14 | Multi-currency revaluation and foreign-currency postings | v1 INR only (`CURRENCY_NOT_SUPPORTED`), T-FIN-46 later |
| OQ-15 | RBI bank rate for MSME interest | `msme.bank_rate_pct` must be maintained by Finance (placeholder 6.50) |
| OQ-16 | A Sales receipt allocation entered in Sales vs Finance (one owner) | Sales owns allocation; Finance mirrors (4.1.4 item 6) |
| OQ-17 | Journal number consumption at post (not at create) differs from generic create numbering | decision D-FIN-1 (gap-free) |
| OQ-18 | Whether `tax-einvoice` / `tax-eway` write back to Sales via services whose names are assumed | QUESTION if absent; otherwise mirrors only |

## 15. Sources

Used (searched 2026-11-02/03; secondary sources are marked; **primary text must be re-read before coding the statutory pieces**):
* ERPNext accounting, GL Entry, Payment Entry, Journal Entry, Period Closing Voucher: https://docs.frappe.io/erpnext/accounting-introduction · https://docs.frappe.io/erpnext/period-closing-voucher · https://docs.frappe.io/erpnext/user/manual/en/accounting-entries
* Odoo lock dates, reconciliation models, year-end closing: https://www.cybrosys.com/odoo/odoo-books/odoo-19-accounting/accounting-features-and-tools/lock-dates/ · https://www.odoo.com/documentation/saas-18.4/applications/finance/accounting/reporting/year_end.html · https://hibou.io/docs/accounting-3/reconciliation-models-625
* Tally Prime accounting groups, banking utilities, what's new: https://help.tallysolutions.com/tally-prime/accounting/accounting-in-tally-prime/ · https://help.tallysolutions.com/tally-prime/banking-utilities/ · https://tallysolutions.com/whats-new/
* Zoho Books banking and bank rules: https://www.zoho.com/books/banking.html
* Dynamics 365 Business Central posting groups and dimensions: https://learn.microsoft.com/en-us/training/modules/dimensions-dynamics-365-business-central/10-summary · https://learn.microsoft.com/en-us/dynamics365/business-central/finance-general-ledger (SAP document types / posting periods: not found by search; knowledge only (unverified))
* GSTR-3B hard-locking from GSTR-1 (July 2025) and GSTR-1A: https://cleartax.in/s/gstr-3B · https://www.lkslaw.com/insights/articles/hard-locking-gstr-3b-a-new-compliance-milestone-and-its-pitfalls · https://calcguru.in/?p=8457 · https://taxroutine.com/gstr-3b-hard-locking/ (secondary)
* ITC utilisation order, sections 49A/49B, rule 88A: https://taxadda.com/order-of-utilisation-of-input-tax-credit-under-gst/ · https://www.taxmann.com/post/blog/clarifications-on-rule-88a-order-of-utilization-of-input-tax-credit-issued-by-cbic/ · https://taxguru.in/goods-and-service-tax/utilisation-itc-sequence-gst-act-analysis.html (secondary)
* GST 2.0 rates from 22 Sep 2025 (56th Council, Notification 9/2025-CT(Rate)): https://taxguru.in/goods-and-service-tax/gst-rate-w-e-f-22nd-september-2025-topic-wise-analysis.html · https://gstcouncil.gov.in/sites/default/files/2025-09/faq.pdf · https://cleartax.in/s/56th-gst-council-meet-news
* E-invoice 30-day reporting for AATO >= ₹10 Cr from 1 Apr 2025 (GSTN advisory): https://www.mahagst.gov.in/public/uploads/gstnadvisory/1760531580_293%20Advisory%20Time%20Limit%20for%20Reporting%20e%20Invoice%20on%20the%20IRP%20Portal%20%20Lowering%20of%20Threshold%20to%20AATO%2010%20Crores%20and%20Above.pdf · https://cleartax.in/s/time-limit-for-reporting-e-invoices-on-the-irp-portal · https://www.taxmann.com/post/blog/time-limit-of-30-days-for-reporting-e-invoice-on-irp-portal-for-taxpayers-with-aato-of-10-crores-and-above-gstn-update/
* E-way bill Rule 138 validity (200 km/day, ODC 20 km/day), ₹50,000 threshold: https://cleartax.in/s/eway-bill-gst-rules-compliance · https://busy.in/gst/computing-distance-covered-determining-eway-bill-validity-its-extension · https://tallysolutions.com/gst/frequently-asked-questions-about-the-e-way-bill-answered/ (validity start and midnight rule conflict between sources)
* HSN digits in GSTR-1 Table 12 and Table 13 (Notification 78/2020, GSTN advisory 1 May 2025): https://www.mahagst.gov.in/public/uploads/gstnadvisory/1760596735_345%20Reporting%20of%20HSN%20codes%20in%20Table%2012%20and%20list%20of%20documents%20in%20table%2013%20of%20GSTR%201%201A.pdf · https://irisgst.com/tag/hsn-summary
* GSTR-1 / 3B due dates and QRMP: https://www.taxaj.com/learn/?p=384 · https://tallysolutions.com/gst/is-gstr-1-filing-mandatory-for-your-business-and-what-are-the-deadlines/ · https://taxguru.in/goods-and-service-tax/quarterly-return-monthly-payment-qrmp-scheme-analysis.html
* GST interest and late fee (sections 47, 50): https://taxguru.in/goods-and-service-tax/gst-late-fee-penalty-calculation-avoid.html · https://cleartax.in/s/gst-late-fee-interest-calculator
* GSTR-2B, section 16(4) time limit, section 34 credit notes, rule 36(4): https://busy.in/gst/gst-section-16-4-itc-time-limit-2026/ · https://thetaxcorp.in/article/gst-year-end-compliance-action-points-for-fy-2025-26-itc-credit-notes-rcm · https://calcguru.in/?p=8455
* Income-tax Act 2025 sections 392/393, old-to-new mapping, rates and thresholds: https://taxguru.in/income-tax/income-tax-act-2025-tds-rates-thresholds-compliance-ty-2026-27.html · https://india-briefing.com/news/section-393-income-tax-act-2025-tds-rules-rates-compliance-guide-44450.html/ · https://taxguru.in/?p=1044146 · https://calcguru.in/section-393-tds-fy-2026-27-transition-guide/
* TCS: 206C(1H) omitted from 1 Apr 2025; TCS under section 394; Form 143 replacing 27EQ (reported): https://www.jurishour.in/columns/income-tax-act-tcs-return-filing-deadlines-27eq-form-143-ty-2026-27/ · https://studycafe.in/tds-and-tcs-due-date-compliance-calendar-and-rate-chart-for-tax-year-2026-27-419610.html · https://www.incometaxindia.gov.in/w/tds-on-purchase-of-goods (secondary; also cited in `docs/plan/04-modules.md`)
* TDS deposit (7th; 30 April for March), return due dates, challan 281/281N: https://taxheal.com/?p=106259 · https://blog.tdsman.com/2025/07/tds-tcs-annual-compliance-calendar/ · https://calcguru.in/?p=7555
* Companies Act s.128 (8 financial years), Schedule III Division I vs II: https://www.incometaxindia.gov.in/w/section-128-81 · https://ca2013.com/128-books-of-account-etc-to-be-kept-by-company/ · https://tallysolutions.com/accounting/mandatory-accounting-records-companies-act/
* Schedule II depreciation (useful lives), income-tax block rates: https://www.incometaxindia.gov.in/w/schedule-ii · https://calcguru.in/?p=5903 (secondary)
* MSMED Act sections 15-16 (45 days, three times bank rate, monthly rests), 43B(h): https://www.livelaw.in/amp/law-firms/law-firm-articles-/the-stringency-of-interest-provisions-under-msmed-act-implementation-and-judicial-interpretation-310929 · https://taxmann.com/post/blog/a-study-of-provisions-of-the-msmed-act-related-disclosure-under-schedule-iii-of-companies-act · https://www.dcmsme.gov.in/publications/LegalFramework.pdf
* Repository: `PLAN.md` sections 2, 5, 6, 14; `docs/plan/04-modules.md` 4.10-4.11; `docs/REGISTRY.csv` rows 96-123; `apps/api/tests/fixtures/field-types.json`; `reference/index.html` (renderers `v9Ledger`, `v9Payment`, `v9Ageing`, `v9TaxWorkspace`, `registerTab`, `ewayTab`); `apps/api/README-PHASE5.md`; plans `03-*` and `04-*`.

**Re-verify before coding (unverified or conflicting; the code keeps these as data, not constants):**
1. GSTR-1 / GSTR-3B / QRMP / IFF due dates and the 25th PMT-06 date; GSTN offline-tool JSON keys (GSTR-1, GSTR-2B download, GSTR-3B).
2. Section 34 credit-note deadline (30 Nov following FY, or annual-return date) and debit-note position; Section 16(4) deadline; rule 36(4) and 37 (180 days); rule 42/43 apportionment (not built).
3. GST rate set after 22 Sep 2025 (0, 5, 18, 40; special rates 0.25, 3, 1.5; cess) and the B2CL limit (₹1,00,000 inter-state, from Aug 2024) and Table 12 / 13 HSN digit requirements by AATO.
4. Late-fee caps per return, interest 18% / 24% formula basis (net cash tax).
5. Income-tax Act 2025: section numbers for TDS/TCS (392/393/394), section mapping per nature of payment, rates and thresholds (rent 6,00,000 per year vs 50,000 per month), no-PAN higher rate section, late-deduction/deposit interest rates (1% / 1.5% per month), TDS/TCS return form numbers and due dates (26Q/27Q/27EQ vs new numbering), challan names; whether TDS is rounded to whole rupees; cash payment disallowance (old 40A(3)) and cash receipt limit (old 269ST) new-Act section numbers.
6. TDS base excludes GST when separately shown (CBDT circular), TCS base on scrap (with/without GST).
7. E-way bill: validity start (generation vs Part B), midnight expiry rule, extension window (8 hours before/after), state-wise intra-state thresholds, cancellation 24 h rule.
8. IRN hash input formula (for the optional local check), IRP INV-01 schema version and field names, 24-hour cancel window, e-invoice AATO thresholds (₹5 Cr mandate, ₹10 Cr 30-day limit).
9. MSMED: bank rate source, medium enterprise treatment, 43B(h) scope and date.
10. Schedule III Division II vs Division I line items used for the report lines; Ind AS applicability for this company.
11. Companies Act accounting-software audit-trail requirement (edit log) as applied to this ERP (we keep an immutable ledger + audit log).
