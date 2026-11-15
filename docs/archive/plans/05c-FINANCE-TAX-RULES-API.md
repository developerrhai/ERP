# 05c — Finance & Tax: business rules, API, reports, extras

> Part 3 of 5 of `05-FINANCE-TAX.md`. Sections 6, 7, 8, 9.

---

## 6. Business rules and formulas

Conventions: `D(x)` = `Decimal`; `r2(x)` = round half-up to 2 dp (`ROUND_HALF_UP`, helper in `apps/api/src/modules/finance/money.ts`, same semantics as `inventory/money.ts`); amounts compared with `.equals`, never `==`. Every rule lists **error code (HTTP)** and **ticket**. Errors are thrown with `Errors.*` helpers; new codes (marked `new`) are added to `ErrorCode` in `apps/api/src/core/http/errors.ts` by T-FIN-08.

### 6.1 Ledger core

**BR-FIN-01 Balanced journal.** A journal posts only if (a) it has at least 2 lines, (b) every line has exactly one of debit/credit `> 0` (the other `0.00`), (c) `Σ debit = Σ credit` exactly (Decimal, 2 dp, no tolerance), (d) every amount has at most 2 decimals (more -> 422 `AMOUNT_PRECISION`). The DB re-checks at commit (deferred trigger). Example: lines Dr 5,000.00 / Cr 2,000.00 / Cr 3,000.00 balance; Dr 5,000.00 / Cr 4,999.99 -> 422 `JOURNAL_UNBALANCED` with `fields: {difference:"0.01"}`. Error `JOURNAL_UNBALANCED` 422 (new). Ticket T-FIN-04.

**BR-FIN-02 Period and lock rules.** The posting date `d` must lie inside an existing `fiscal_periods` row `p` whose FY is `OPEN` (`financial_years.status`): FY `CLOSED` -> 409 `PERIOD_CLOSED` (existing code); `p.status='CLOSED'` -> 409 `PERIOD_CLOSED`; `p.status='LOCKED'` -> 409 `PERIOD_LOCKED` (new) unless the caller passes `overrideLock=true` **and** holds the override gate (7.6) in which case the journal posts and `journals.warnings` gets `{code:'LOCK_OVERRIDDEN', by, reason}` (reason mandatory). A date with no period row -> 422 `NO_PERIOD`. A date more than 1 day in the future -> 422 `FUTURE_DATE` unless setting `fin.allow_future_dates=true`. **Backdating** within an open period is allowed; before the go-live date -> 422 `BEFORE_GO_LIVE` (only voucher types `Opening`/`Closing` may precede `fin.go_live_date`). Example: today 2026-11-02, period Oct 2026 `LOCKED`: a journal dated 2026-10-15 -> 409 `PERIOD_LOCKED`; Nov 2026 `OPEN`: dated 2026-11-02 posts. Ticket T-FIN-04, T-FIN-24.

**BR-FIN-03 Account usability on a line.** The account must be: `status='Active'`, `is_group=false`, `posting_allowed=true` (else 422 `ACCOUNT_NOT_POSTABLE` with the account code), not soft-deleted; `cost_center_required` -> line needs an active `cost_center_id` (422 `COST_CENTER_REQUIRED`); `party_required` -> line needs `party_id`, and the party must be active and have the role matching `control_side` (customer for RECEIVABLE, supplier for PAYABLE) else 422 `PARTY_REQUIRED` / `PARTY_ROLE_MISMATCH`; a line with a `party_id` on an account that is not a control account -> allowed only on `1501`, `1505`, `2401`, `1502` (advances/employee advances) else 422 `PARTY_NOT_ALLOWED`. The line's `unit_id` defaults to the journal unit and must be an active unit the caller may write to. `profit_center_id` defaults to the unit's default profit centre. Ticket T-FIN-04.

**BR-FIN-04 Immutability and reversal.** Posted `journals`, `journal_lines` and all `gl_entries` are never updated or deleted (DB triggers). A correction = `reverse`: the new journal (voucher type `Reversal`, `reversal_of_id`) has every line's debit and credit **swapped** with the same party/cost centre/profit centre/unit, `gl_entries.is_reversal=true`, `reverses_gl_id` = the original entry, open items and tax documents of the original are cancelled/neutralised in the same transaction. Rules: only `Posted` and not already reversed (409 `ALREADY_REVERSED`), not itself a reversal (409 `CANNOT_REVERSE_REVERSAL`), reversal date in an OPEN period >= original date (422 `REVERSAL_DATE_INVALID`), reason 5-300 chars (422 `REASON_REQUIRED`), a journal whose open items are partly settled cannot be reversed until the allocations are reversed first (409 `SETTLED_DOCUMENT`; the UI lists them), a journal that produced a **Filed** GST document cannot be reversed (409 `GST_PERIOD_FILED`; issue a credit/debit note instead), a journal containing a bank line that is **Reconciled** cannot be reversed (409 `RECONCILED_ENTRY`). Example: JV/TAL/2026-27/0007 Dr Rent 10,000.00 / Cr Bank 10,000.00 reversed on 2026-11-03 -> Dr Bank 10,000.00 / Cr Rent 10,000.00; net effect on Rent 0.00; both journals remain visible. Ticket T-FIN-04.

**BR-FIN-05 Idempotent event posting.** `(event, doc_type, doc_id)` is unique in `accounting_event_queue` and `(source_event, source_doc_type, source_doc_id)` is unique in `journals` (partial, non-reversal). Posting the same event twice returns the first journal and writes nothing (`Idempotent-Replay` semantics, no error for producers; a different payload for the same key -> 409 `EVENT_PAYLOAD_CHANGED` and the queue row stays untouched). Ticket T-FIN-05/07.

**BR-FIN-06 Rounding and round-off.** All money `numeric(18,2)`; computation in `Decimal`; rounding `r2` only where stated (line GST, TDS, interest). Invoice round-off is the difference between the computed total and the rounded-to-rupee total: `roundOff = round(total) - total` with `round` half-up to 0 dp, so `|roundOff| <= 0.50`; the maximum accepted is setting `fin.max_round_off` (default `1.00`): larger -> 422 `ROUND_OFF_TOO_LARGE`. Round-off goes to `6270 Round Off` (key `ROUND_OFF`). Example: invoice 14,567.89 -> total 14,568.00, `roundOff = +0.11`. Ticket T-FIN-04/06.

**BR-FIN-07 Voucher numbering.** `NumberingService.next(tx, {docType, unitId, fyId})` -> `<PFX>/<UNIT>/<FY>/<0001>` e.g. `JV/TAL/2026-27/0001`, `RCP/SAW/2026-27/0012`. Gap-free: the number is taken **at the moment of posting** (journals, payments, notes get a temporary code while Draft where they have a Draft state: `DRAFT-<8 hex>` for journals; payments and notes take their number at **create** because they have no free-edit Draft in the ledger sense: payments are created `Posted` directly (the modal is the draft), notes number at create and a deleted Draft note keeps its number (soft delete, number never reused, as the builder rules say)). Event journals take their voucher type's prefix by the table in 6.1b. A rollback gives the number back (same transaction). Ticket T-FIN-04.

**BR-FIN-06b Voucher prefix by journal source.** `Journal/Opening/Closing/Depreciation/Provision/Adjustment/Reversal/Bank Charges/Tax Settlement/Other` -> `JV` (Opening -> `OBL`, Closing -> `CLS`); `Receipt` -> `RCP`; `Payment` -> `PAY`; `Contra` -> `CNT`; `Credit Note` -> `CRN`; `Debit Note` -> `DBN`; `Expense` -> `EXP`; event journals for `Sales Invoice`, `Purchase Invoice`, `Goods Receipt`, `Delivery`, `Stock Adjustment` **use the producer's `docNo` as the voucher number** (`gl_entries.voucher_no = docNo`, `journals.code = 'JV/'+unit+'/'+fy+'/'+next` is **not** consumed; instead `journals.code = 'EV/' + eventShortCode + '/' + docNo`, unique) so that the ledger shows the invoice number. Reversal journals: prefix `JV`, voucher type `Reversal`.

**BR-FIN-08 Control accounts and sub-ledger agreement.** Postings to the control accounts `1201, 1202, 2101, 2102, 2104` must carry `party_id`; the open-items sub-ledger is created from those lines (`bill_mode='NEW'`) or settled (`'AGAINST'`). A manual journal that debits/credits a control account must supply `bill_doc_no` (and `bill_due_date` for NEW): else 422 `BILL_REF_REQUIRED`. The agreement test BR-FIN-36 compares them. Ticket T-FIN-15.

**BR-FIN-09 Multi-currency (SHOULD, T-FIN-46).** v1 posts INR only; a journal with `currency_code <> 'INR'` -> 422 `CURRENCY_NOT_SUPPORTED` until T-FIN-46. Design for later: `amount_fc`, `fx_rate = INR per 1 unit` (6 dp), base amount `r2(amount_fc × fx_rate)`; revaluation at month end of open foreign items: `unrealised = r2(outstanding_fc × (closing_rate − booking_rate))` posted to `4204`/`6261` and auto-reversed on day 1 of next month. Example: USD 1,000 invoice at 83.20 = ₹83,200.00; closing rate 84.00 -> ₹84,000.00 -> loss 800.00 (receivable up -> gain 800.00 to `4204`).

**BR-FIN-10 Allocation of receipts and payments.** (a) **FIFO** suggestion: open items of the party ordered by `due_date ASC NULLS LAST, doc_date ASC, doc_no ASC`; allocate until the amount is exhausted. (b) **Specific**: the user lists `(itemId, amount)`. (c) Each allocation `0 < a <= item.outstanding` (positive items) -> else 422 `OVER_ALLOCATION`; `Σ a <= payment.amount + payment.tds_amount` -> else 422 `OVER_ALLOCATION`. (d) The unallocated part `u = amount + tds - Σa` creates an `ADVANCE` open item of opposite sign (receipt -> `-u` on RECEIVABLE; payment -> `-u` on PAYABLE) posted on the **same control account** (not on `2401`/`1501`) with `due_date = doc_date`; later settled by `allocate`. For payments with `Σa = 0` and no `allowAdvance` -> 422 `ADVANCE_NOT_CONFIRMED`. (e) A **blocked** or **disputed** open item cannot be paid by a payment (422 `ITEM_BLOCKED`) but can receive a receipt. (f) Allocation rows are append-only; undo = reversal rows. (g) Currency must match (INR). Example: customer owes INV-1 ₹40,000 (due 10 Oct) and INV-2 ₹60,000 (due 20 Oct); receipt ₹70,000 -> FIFO: INV-1 40,000, INV-2 30,000, unallocated 0; INV-2 outstanding 30,000. Ticket T-FIN-14/15.

**BR-FIN-11 Cash controls.** (a) A cash account (`sub_type='Cash'`) may not go below zero at the end of the posting date for the unit (setting `fin.allow_negative_cash=false`): evaluated on the unit's cumulative cash balance up to and including the entry date; violating a payment -> 409 `NEGATIVE_CASH`; (b) cash **payments** to one party on one day totalling more than `fin.cash_payment_limit_per_day` (default `10000.00`) -> **warning** `CASH_LIMIT_PAYMENT` stored in `journals.warnings` and shown (Income-tax disallowance rule: section 40A(3) of the 1961 Act, equivalent provision of the 2025 Act (unverified section number)); (c) cash **receipts** from one party in one day, one transaction or one event of `>= fin.cash_receipt_limit_per_day` (default `200000.00`) -> **blocked** 422 `CASH_RECEIPT_LIMIT` (section 269ST of the 1961 Act; 2025-Act equivalent unverified); (d) payments of mode `Cash` need a bank account row of kind `CASH`/`PETTY`, other modes kind `BANK` (422 `MODE_ACCOUNT_MISMATCH`). Example: ₹9,500 cash to vendor A on a day -> ok; second ₹1,000 same day -> 10,500 > 10,000 -> warning (not blocked). ₹2,00,000.00 cash receipt from a customer -> blocked. Ticket T-FIN-14.

### 6.2 Tax: TDS / TCS

**BR-FIN-12 TDS computation** (`TdsService.compute(tx, {partyId, sectionCode, amount, date, sourceDocId?})` returns `{section, applicable, baseAmount, ratePct, tdsAmount, noPanApplied, cumBefore, cumTaxedBefore, trail}`).

1. **Section row**: the `tds_sections` row with `kind='TDS'`, `code = sectionCode` (default `parties.tds_section_id`'s code), `effective_from <= date` and (`effective_to` null or `>= date`), `status='Active'`. Not found -> 422 `TDS_SECTION_NOT_FOUND`. Transactions dated up to 2026-03-31 use the `1961` row, from 2026-04-01 the `2025` row (the seed has both, same rates).
2. **Amount base**: the taxable value of the invoice **excluding GST when GST is shown separately** on the invoice; otherwise the gross amount. The producer passes `amount` already net of GST (`TDS_BASE_EXCLUDES_GST`, CBDT circular, unverified reference).
3. **PAN and rate**: PAN = `parties.pan`; valid pattern `^[A-Z]{5}[0-9]{4}[A-Z]$`. If PAN missing/invalid -> `noPanApplied=true` and rate = `no_pan_rate` of the section (higher-rate rule, old s.206AA; new-Act equivalent unverified). Else rate = `rate_individual` when the PAN 4th character is `P` (individual) or `H` (HUF) and the section has `rate_individual`; else `rate_pct`. A per-party override `parties.tds_rate_override` (foundation) replaces the rate **only if** it is `>=` the section rate, or if a lower-deduction certificate is on file (`[ADD]` field `tds_lower_rate_valid_to`; SHOULD) -> else it is ignored and logged.
4. **Thresholds** (financial year of `date`; `cumBefore` = Σ `base_amount` of non-cancelled TDS entries of that party+section in the FY; `cumTaxedBefore` = Σ `base_amount` of those with `tds_amount > 0`; `A` = this amount; `cumAfter = cumBefore + A`):
   * `base_mode = CATCHUP`: if `threshold_annual` is not null and `cumAfter > threshold_annual` -> `base = cumAfter − cumTaxedBefore`; else if `threshold_single` is not null and `A > threshold_single` -> `base = A`; else if both thresholds are null -> `base = A`; else `base = 0` (no deduction yet; the amount still counts in `cumBefore`).
   * `base_mode = EXCESS_ONLY` (194Q, 194O style): `base = max(0, min(A, cumAfter − threshold_annual))`.
5. `tdsAmount = r2(base × ratePct / 100)`.
6. A zero `tdsAmount` still writes a `tds_entries` row only when `A > 0` and the section applies (status `Deducted`, `tds_amount 0.00`, so `cumBefore` tracking works): `kind='TDS'`, `base_amount=A`, `computation.base=0`. (Entries with 0 TDS are hidden in the register unless `includeZero=true`.)
7. **Timing**: the deduction date is the **earlier** of the credit date (invoice posting date) and the payment date. An advance payment made first creates the entry at payment; the later invoice computes with `sourceDocId` and **nets** prior deduction on the same invoice: invoice base `B`; already deducted on advance `X` (sum of entries linked by `advance_for_invoice`) -> deduct on `B − advanceBase` only. (Advance linkage is SHOULD; v1: the producer flag `tdsAlreadyDeductedOnAdvance` reduces `amount`.)
8. **Rounding**: TDS rounded to the **nearest rupee**? Statute requires tax in whole rupees on the challan and TDS return; v1 books the paisa amount `r2` and the **challan** and **return** round the total per deductee to the nearest rupee (half-up) with the difference to `6264`? **Decision D-FIN-5:** TDS amount per entry is rounded to the nearest rupee: `tdsAmount = round0(base × rate / 100)` half-up, because the deductor deposits whole rupees (Income-tax rule practice; unverified). `r2` therefore always yields `.00`. Example below uses this.

Worked examples (`194C`, company deductee, rate 2%, single 30,000, annual 1,00,000, CATCHUP):
| # | Payment date | Amount A | cumBefore | cumTaxedBefore | cumAfter | Rule hit | Base | TDS |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-05-10 | 25,000 | 0 | 0 | 25,000 | below both | 0 | 0 |
| 2 | 2026-06-12 | 28,000 | 25,000 | 0 | 53,000 | below both | 0 | 0 |
| 3 | 2026-07-02 | 29,000 | 53,000 | 0 | 82,000 | below both | 0 | 0 |
| 4 | 2026-08-05 | 25,000 | 82,000 | 0 | 1,07,000 | annual crossed | 1,07,000 | **2,140** |
| 5 | 2026-09-01 | 20,000 | 1,07,000 | 1,07,000 | 1,27,000 | annual crossed | 20,000 | 400 |
Single payment 35,000 as the first of the year -> `A > 30,000` -> base 35,000 -> TDS 700. `194Q` (0.1%, annual 50,00,000, EXCESS_ONLY): purchases 40,00,000 then 20,00,000 -> second: `cumAfter = 60,00,000`, base `min(20,00,000, 10,00,000) = 10,00,000` -> TDS 1,000. `194J-B` professional 10%: invoice 50,000 + GST 9,000: base 50,000 (annual threshold 50,000: `cumAfter = 50,000 > 50,000`? **No** (not greater) -> base 0; the next 10,000 -> cumAfter 60,000 > 50,000 -> base 60,000 -> TDS 6,000).
No-PAN: same 194J-B 50,000 + 30,000 with party PAN missing -> base 80,000 × 20% = 16,000, entry flagged `no_pan_applied`.
Due dates (shown in `TDS Compliance`): **deposit** by the 7th of the following month (30 April for March); **returns** 31 Jul / 31 Oct / 31 Jan / 31 May. Late deduction interest 1% per month or part month, late deposit 1.5% per month or part month (old s.201(1A); 2025-Act section unverified): `interest = r2(tds × rate × monthsOrPart / 100)`; example TDS 10,000 deducted on 12 Aug (due to be deducted at invoice on 5 Aug -> 1 month) -> 100.00; deposited on 20 Sep instead of 7 Sep -> 1 month part -> 150.00. Error codes: `TDS_SECTION_NOT_FOUND` 422 (new), `PAN_INVALID` 422, `TDS_ALREADY_DEPOSITED` 409 (new). Ticket T-FIN-31.

**BR-FIN-12b Challan rules.** `Σ allocated amounts = challan.tax_amount` (422 `CHALLAN_MISMATCH`); an entry belongs to at most one challan; the section/kind of the entries must be TDS for a TDS challan; challan date >= every entry date; entries of one challan must be in the same return quarter? **No**, a challan may cover entries of one month only (warning if mixed). Cancelling a challan frees the entries (`Deducted`). Posting: `Dr 2311 TDS Payable / Cr Bank` through a `payments` document (`purpose='TDS'`, party null) with `payments.amount = challan.total`; interest and fee go to `6254`... **no**: TDS interest/fee -> `6263 Penalties and Fines` (non-deductible), tax -> `2311`. Ticket T-FIN-31.

**BR-FIN-13 TCS computation.** On a sales invoice for goods in a TCS-notified category (`parties` flag or item category `tcs_section`), `TcsService.compute` returns `tcsAmount = r2(base × rate / 100)` where base = taxable value (excluding GST when separately shown: unverified) for **scrap** (rate 1%; section `206C-SCRAP`), minerals, forest produce etc.; no-PAN collectee -> `no_pan_rate`. The TCS is **added to the customer's receivable** (`grandTotal` includes it, rule `SALES_INVOICE_POSTED` seq 40 credits `2312`). No TCS row exists for sale of goods above ₹50 lakh (old 206C(1H) omitted from 1 Apr 2025). TCS **paid to suppliers** (supplier charged TCS on our purchase) is an asset `1411` (`tcsAmount` in the purchase payload). Collection date = earlier of invoice and receipt. Due dates: deposit by the 7th of next month; quarterly statement `27EQ` due 15 Jul / 15 Oct / 15 Jan / 15 May (**unverified; sources conflict**; stored in settings `tax.tcs_return_due_days`). Ticket T-FIN-32.

### 6.3 Tax: GST

**BR-FIN-14 GST head split and rounding (verification, not recomputation).** `TaxService.compute` (plan 03) owns the split; Finance **validates** every incoming `tax` block and tax document: intra-state (`supply_state_code = pos_state_code`) -> `cgst = sgst`, `igst = 0`; inter-state -> `igst > 0`, `cgst = sgst = 0`; export/SEZ -> IGST; per line `|cgst − r2(taxable × rate / 200)| <= 0.01` and `|igst − r2(taxable × rate / 100)| <= 0.01`; Σ line = header (exact). Violation -> 422 `TAX_PAYLOAD_MISMATCH` with the line number. Example: taxable 1,00,000.00 at 18% intra-state: CGST 9,000.00, SGST 9,000.00; inter-state: IGST 18,000.00. Rates in force on `doc_date` are those in the payload (Finance does not look them up) but the **allowed set on date** is checked: from **2025-09-22** the standard rates are 0, 5, 18 and 40 (plus 0.25 and 3 for specified goods like diamonds / bullion and 1.5 where notified; unverified residual rates), cess separate; before that 0, 5, 12, 18, 28. A rate outside the allowed set on that date raises the GSTR-1 validation issue `RATE_NOT_ALLOWED` (WARN, not blocking posting). Ticket T-FIN-27/28.

**BR-FIN-15 GSTR-3B liability, credit utilisation and cash (exact order).** Inputs per GSTIN and period: output liability `L_i, L_c, L_s, L_ce` (IGST, CGST, SGST, cess) = outward tax from the **filed GSTR-1** + RCM tax payable; credit balances in the electronic credit ledger **at the time of the return** (previous balance + this period's eligible ITC after reversals) `C_i, C_c, C_s, C_ce`. Algorithm (Section 49A/49B and Rule 88A of the CGST Rules):
1. **Cess**: `u = min(C_ce, L_ce)`; `L_ce -= u`; `C_ce -= u` (cess credit only against cess).
2. **IGST credit first**: `u = min(C_i, L_i)` against IGST liability; then the remaining IGST credit against CGST liability then SGST liability (order = setting `fin.igst_spill_order`, default `CGST_FIRST`): `u = min(C_i, L_c)` ... then `u = min(C_i, L_s)`. (Rule 88A lets the taxpayer choose the CGST/SGST order; both are lawful; the default fixes it deterministically.) IGST credit must be **fully exhausted** before any CGST/SGST credit is used (Section 49A).
3. **CGST credit** against remaining CGST liability, then against remaining IGST liability. Never against SGST.
4. **SGST credit** against remaining SGST liability, then against remaining IGST liability. Never against CGST.
5. Remaining liability per head `R_i, R_c, R_s, R_ce` is paid in **cash** from the electronic cash ledger (same head only), each `>= 0`: `cashPaid = R_i + R_c + R_s + R_ce`. Remaining credit is carried forward.
6. `creditUtilised = (L_i+L_c+L_s+L_ce) − cashPaid`; **Net Tax Payable** (page column) = `cashPaid` (tax payable in cash after credit); **Outward Tax** (page column) = `L_i + L_c + L_s + L_ce − RCM part`, i.e. outward only; RCM is separate in `rcm_*`.
Worked example A: `L`: IGST 50,000, CGST 30,000, SGST 30,000; `C`: IGST 40,000, CGST 20,000, SGST 25,000. IGST credit 40,000 -> IGST liability 10,000 left, IGST credit 0. CGST credit 20,000 -> CGST left 10,000. SGST credit 25,000 -> SGST left 5,000. Cash: IGST 10,000 + CGST 10,000 + SGST 5,000 = **25,000**; credit utilised = 110,000 − 25,000 = **85,000**.
Worked example B (IGST spill): `L`: IGST 10,000, CGST 30,000, SGST 30,000; `C`: IGST 40,000, CGST 5,000, SGST 5,000. IGST credit: 10,000 to IGST (IGST liability 0, credit left 30,000), 30,000 to CGST (CGST liability 0, credit 0), SGST liability 30,000 unchanged. CGST credit 5,000: CGST liability 0, IGST liability 0 -> stays (carried forward 5,000). SGST credit 5,000 -> SGST liability 25,000. Cash **25,000** (SGST only); carried forward CGST credit 5,000.
Entries: one `tax_ledger` row per movement (`ITC` debit with `ITC_UTILISED`, `LIABILITY` credit with `LIABILITY_DISCHARGED`, `CASH` debit with `CASH_UTILISED`) and one settlement journal (4.8 step 8). Error `GSTR1_NOT_FILED` 409 (new), `CASH_LEDGER_SHORT` 409 (new: cash ledger balance < `cashPaid`; the user must deposit first). Ticket T-FIN-30.

**BR-FIN-16 Reverse charge.** An inward document with `reverse_charge=true` carries no supplier GST. The buyer self-assesses at the rate of the supply: `rcmTax` heads by POS rule; journal (rules in 5.20): `Dr Input tax (if eligible) / Cr RCM payable`; in GSTR-3B Table 3.1(d) the RCM tax is **liability** and Table 4(A)(3) shows the same as ITC (if eligible) **but only usable after cash payment**: the RCM liability must be discharged in **cash** (not by credit): in the utilisation algorithm RCM liability `Lr_*` is paid from the **cash ledger** first, then the ITC created by it is added to `C_*` for **later** periods (statutory rule: RCM ITC claimable only after the tax is paid in cash). Example: RCM IGST 9,000 for legal services: cash 9,000 in the period; ITC 9,000 credited to the credit ledger in the same return period only after payment (as posted by `utilise`), usable from the next utilisation run. Mandatory categories seed in `tax.rcm_categories`; RCM on purchases from unregistered suppliers is applicable only for notified classes (unverified), so Finance does **not** auto-assume RCM: the producer sets `rcm`. Ticket T-FIN-30.

**BR-FIN-17 ITC eligibility and claiming.** Per inward `tax_documents`: `itc_eligibility`: `ELIGIBLE` default for a registered supplier, goods/services for business; `INELIGIBLE` for Section 17(5) categories (motor vehicles for persons < 13 seating except specified uses, food and beverages, outdoor catering, club membership, health services, travel benefits to employees, works contract for immovable property, goods lost/stolen/destroyed/gifts: list stored as `tax.blocked_credit_categories` settings; unverified detail), composition-scheme suppliers, personal use, exempt supplies; `BLOCKED` = held by the user; `PENDING` = awaiting 2B. **Rule 36(4)/2B**: claim only if `match_status='Matched'` (or `Value Mismatch` within tolerance `tax.2b_tolerance` default `1.00` per head); otherwise `PENDING` unless an override with a reason by a user holding the ITC-override gate (writes `itc_override_reason`, audited). **Time limit** (Section 16(4)): ITC for an invoice dated in FY X cannot be claimed after **30 November of FY X+1** (or annual return date if earlier): later -> `itc_eligibility='INELIGIBLE'` with reason `TIME_BARRED` (error on claim `ITC_TIME_BARRED` 422). **Rule 37**: invoice unpaid beyond **180 days** from the date of invoice -> ITC reversal line in 3B Table 4(B)(2) in the period it crosses 180 days, re-claimable on payment; computed by `GET /tax/gstr3b/:id/reversals` from open items (PAYABLE, `doc_date + 180 < periodEnd`, outstanding > 0): reversed ITC = `itc × outstanding / amount`, r2. Example: purchase invoice 1,18,000 (ITC 18,000) dated 1 Mar; unpaid on 28 Aug (180 days); reversal in the Aug return = 18,000.00; if paid 1,00,000 by then -> outstanding 18,000: reversal = `18,000 × 18,000 / 118,000 = 2,745.76`. Ticket T-FIN-29/30.

**BR-FIN-18 GST interest and late fee (formulas; verify before coding, section 15).**
* Interest on late payment of tax (Section 50(1)): `interest = r2(taxPaidLate × 18 / 100 × days / 365)` per head, on the **net cash tax** unpaid after due date, `days` = filing/payment date − due date.
* Interest on ITC wrongly availed and utilised (Section 50(3)): 24% p.a. on the excess, same formula.
* Late fee (Section 47): GSTR-3B/GSTR-1 late: ₹50 per day (₹25 CGST + ₹25 SGST), nil return ₹20 per day (₹10 + ₹10); caps per return by AATO band: nil ₹500; AATO up to ₹1.5 Cr ₹2,000; ₹1.5-5 Cr ₹5,000; above ₹5 Cr ₹10,000 (unverified; settings `gst.latefee_cap_*`). `lateFee = min(cap, days × perDay)`.
Example: GSTR-3B due 20 Nov, cash tax 25,000 filed and paid 25 Nov: days 5; interest = `25,000 × 0.18 × 5 / 365 = 61.64`; late fee = `5 × 50 = 250`. Entries in 3B: `interest`, `late_fee` columns; booked `Dr 6254 / Cr 1415`. Ticket T-FIN-35.

**BR-FIN-33 GSTR-1 build and validation rules.** Source rows: `tax_documents` with `direction='OUTWARD'`, the return's `gst_registration_id`, `doc_date` in the month, `status='Posted'`. Classification: `B2B` (recipient has GSTIN, not export) -> sections B2B (4A) (and 4B when `reverse_charge`); `B2CL` = inter-state B2C invoice value `> 1,00,000` (section 5; threshold setting `gst.b2cl_limit`, from Aug 2024 ₹1 lakh: unverified); everything else B2C -> B2CS (7) aggregated by `(supply type INTRA/INTER, POS, rate)`; exports -> 6A; credit/debit notes -> CDNR (registered) / CDNUR (unregistered with `B2CL`/`EXPWP`/`EXPWOP`); HSN summary (12) by `(hsn, uqc, rate)` Σ qty, taxable, tax; document summary (13). Issues (code -> severity): `GSTIN_INVALID` (ERROR; checksum mod-36 fail), `POS_MISSING` ERROR, `HSN_MISSING` ERROR, `HSN_DIGITS` ERROR (fewer than 4 digits when AATO band `LE_5CR`, fewer than 6 otherwise), `RATE_NOT_ALLOWED` WARN, `TAX_HEAD_MISMATCH` ERROR, `DUPLICATE_DOC_NO` ERROR, `DATE_OUT_OF_PERIOD` ERROR, `IRN_MISSING` ERROR (e-invoice applicable and unit band `GE_10CR`/enabled, doc dated >= the e-invoice start date, no IRN), `IRN_LATE` WARN, `NEG_VALUE` ERROR, `ORIGINAL_NOT_FOUND` WARN (note without original), `EXPORT_NO_SHIPPING` WARN. `error_count` = number of ERROR issues; JSON generation blocked while `> 0` (409 `RETURN_HAS_ERRORS`). `Tax Liability` = Σ (igst+cgst+sgst+cess) of invoices + debit notes − credit notes. Example: month with B2B invoices taxable 5,00,000 (GST 90,000), B2CS taxable 1,00,000 (GST 18,000), credit note taxable 20,000 (GST 3,600) -> `B2B Taxable` 500000.00, `B2C Taxable` 100000.00, `Credit Notes` 20000.00, `Tax Liability` = 90,000 + 18,000 − 3,600 = **104,400.00**. Ticket T-FIN-28.

**BR-FIN-34 GSTR-2B matching.** Keyed on `(supplier_gstin, normalised doc_no, doc type)` where normalised doc_no = upper-case, alphanumerics only, leading zeros stripped. Per inward `tax_document` and `gstr2b_lines` of the same registration and period (2B period or the two months around the invoice date): exact key + `|Σtax diff| <= tolerance` (default `1.00`) + date equal -> `Matched`; key found but tax/taxable differs beyond tolerance -> `Value Mismatch` (tax_diff stored); key found, date differs (> 0 days) but values equal -> `Date Mismatch`; same doc_no but a different GSTIN with equal values -> `GSTIN Mismatch`; a book document without a 2B row -> `Missing in 2B`; a 2B row without a book document -> `Missing in Books` (shown in the reconciliation list; not tied to a document). `Difference` on the register = `books tax (cgst+sgst+igst+cess) − 2B tax`. Re-importing the same file (same sha256) -> 409 `DUPLICATE_IMPORT`; a newer file for the same period supersedes (older import `Superseded`, matches recomputed). Ticket T-FIN-29.

**BR-FIN-35 Filed-period lock.** When `gst_returns` GSTR-1 for GSTIN G and period P is `Filed`: a new or reversed **outward tax document** of G dated in P -> 409 `GST_PERIOD_FILED` (the message names the filed period and suggests the first day of the next open period); the drain marks that queue row `FAILED` with this code so Finance dates it in the next period by editing `doc_date` override in the queue row (`POST /finance/queue/:id/redate`, MANAGER). A Filed GSTR-3B blocks inward documents' ITC claim period <= P. Ticket T-FIN-28/30.

**BR-FIN-30 Credit and debit notes.** (a) Must reference an original document unless `reason_code` is `Post Sale Discount` with an agreement flag (then `original_doc_no` optional). (b) `Σ credited taxable per original line <= original taxable − already credited` -> else 422 `CREDIT_EXCEEDS_INVOICE`. (c) Tax at the **original rates and head split**; recomputed `r2(taxable × rate / 100)` (split halves for CGST/SGST). (d) Section 34 time limit: a note that reduces output tax (customer credit note) dated after **30 November following the FY of the original invoice** (or the annual-return date if earlier) -> `is_commercial=true`, taxes forced to `0.00`, posted without GST (error `NOTE_TIME_BARRED` is a **warning**, not an exception). A **debit note** (increases tax) has no such statutory limit. (e) Posting date within the open period; a note referencing an invoice in a **filed** period is itself dated in the open period (it is reported in the period of the note). (f) e-invoice applicability copies the invoice's. Example: invoice INV-9 taxable 1,00,000 at 18% (CGST 9,000, SGST 9,000); credit note taxable 10,000 -> CGST 900, SGST 900, total 11,800.00; journal Dr 4107 10,000 / Dr 2301 900 / Dr 2302 900 / Cr 1201 11,800.00. Ticket T-FIN-16.

**BR-FIN-31 E-invoice.** Applicable when the GSTIN has `e_invoice_enabled` (set when AATO crossed ₹5 Cr in any year since 2017-18: user decision recorded) and the document is B2B/export/SEZ (or a CN/DN against such). IRN is 64 lowercase hex; Ack No numeric <= 20; Ack Date >= invoice date. 30-day rule: for `aato_band='GE_10CR'` the Ack Date must be `<= invoice date + 30 days` (reporting limit from 1 Apr 2025 for AATO >= ₹10 Cr); a later entry is stored with `late=true` and a WARN (the portal would not have issued it: warn the user to verify). Cancellation only within **24 hours** of Ack Date (`requestCancel` refuses with 409 `CANCEL_WINDOW_PASSED`; after that a credit note is the only route). An IRN can be entered once; changing needs `cancel` first. `tax_documents.irn` is set only by `enterIrn`. Ticket T-FIN-33.

**BR-FIN-32 E-way bill.** Required when consignment value `> tax.eway_threshold` (₹50,000; per-state override map). Validity (Rule 138(10)): `validityDays = ceil(distance_km / km_per_day)` with `km_per_day = 200` (Normal) or `20` (ODC) from `eway_validity_rules` effective on the generation date; minimum 1 day; **valid until the end of the last day** (midnight at the end of day `generatedDate + validityDays − 1`... implemented as `date(generated_at) + validityDays days` at `00:00` of the next day = i.e. `valid_until = (generated_date + validityDays) 00:00` local) (validity counting start and the midnight rule are reported differently in sources: **unverified**, kept in data, not code). Example: 450 km normal cargo -> `ceil(450/200) = 3` days; generated 2026-11-02 10:30 -> valid until 2026-11-05 00:00. Part B (vehicle) must be updated before movement; `Part B Status='Updated'` once `vehicle_no` given. Extension window: from 8 hours before expiry to 8 hours after expiry (portal practice; unverified): outside -> 409 `EXTENSION_WINDOW`. Cancel within 24 hours of generation and before verification by an officer (user declaration). `markExpired` job sets `Expired` when `valid_until < now`. Ticket T-FIN-34.

### 6.4 Banking

**BR-FIN-19 Bank reconciliation difference.** For statement S of bank account B with ledger account A at statement date D (`unit` = context):
`ERP Balance` = `Σ(debit − credit)` of `gl_entries` on A with `posting_date <= D` (company-wide unless the bank account has a `unit_id`, then that unit).
`Unmatched ERP` = `Σ(debit − credit)` of those entries **not fully matched** (matched amount < entry amount counts the remaining part).
`Unmatched Bank` = `Σ(credit − debit)` of S's lines in status `Unmatched`/`Suggested` (deposits positive, withdrawals negative).
`Matched Amount` = `Σ bank_matches.amount` of active matches of S's lines.
`Difference = Bank Balance − (ERP Balance − Unmatched ERP + Unmatched Bank)`.
`reconcile` requires `Difference = 0.00` (422 `RECON_DIFFERENCE`) and no `Suggested` lines (422 `SUGGESTIONS_PENDING`). Example: ERP balance 5,00,000; deposit in transit +10,000 (ERP only); cheque issued −40,000 (ERP only) -> Unmatched ERP = −30,000; bank-only interest credit +5,000 -> Unmatched Bank = +5,000; bank balance 5,35,000: `5,35,000 − (5,00,000 + 30,000 + 5,000) = 0`. Ticket T-FIN-17.

**BR-FIN-20 Auto-match scoring.** Candidate pair (bank line `b`, GL entry `g` on the bank's ledger account, not fully matched): direction must agree (deposit = debit entry; withdrawal = credit entry); `|b.amount − g.remaining| = 0.00` else no candidate (1:1 only in auto mode). `score = 50` (amount) `+ 40` if the normalised reference of `b` (alphanumeric, upper-case, min length 6) equals or is contained in the normalised `instrument_no`/`utr`/`voucher_no` of `g`'s source or vice versa `+` date proximity `|b.txn_date − g.posting_date|`: 0 days +10, 1 day +7, 2 days +4, 3 days +2, > 3 days candidate dropped unless the UTR matched (then +0). `+5` if the party name tokens appear in the bank description. Thresholds: `score >= 60` -> `AUTO` active match; `50 <= score < 60` -> `Suggested`. Assignment: sort all candidate pairs by `score desc, date diff asc, g.seq asc`; take greedily if neither side is used; ties on identical score for one bank line with several entries -> all become `Suggested` (never auto). Example: bank line 28 Oct deposit ₹46,500.00 ref `UTR20261028AB12` vs receipt RCP/TAL/2026-27/0031 dated 27 Oct amount 46,500.00 UTR `UTR20261028AB12`: 50 + 40 + 7 = 97 -> AUTO. Same amount, no UTR, 2 days apart: 50 + 4 = 54 -> Suggested. Ticket T-FIN-17.

### 6.5 Reports

**BR-FIN-21 Trial balance check.** For any filter, `Σ closing_debit = Σ closing_credit`, `Σ period_debit = Σ period_credit`, `Σ opening_debit = Σ opening_credit` (to the paisa). The API returns `variance = Σ closing_debit − Σ closing_credit`; non-zero -> response flag `banner:"OUT_OF_BALANCE"`. Opening rule: balance-sheet accounts open with all earlier entries; income/expense accounts open with entries from the FY start to `from`. Example: opening 10,000 Dr cash; period Dr 5,000 Cr 2,000 -> closing 13,000 Dr. Ticket T-FIN-18.

**BR-FIN-22 Balance sheet equation.** `Assets = Liabilities + Equity + Unclosed Profit`, where assets/liabilities/equity lines use `fn_account_movement` over `(-infinity, asOf]` with `include_closing=true`, and `BS.E.120 = -Σ(debit − credit)` of Income/Expense accounts over the same range (closing entries included, so closed years add 0). Check `BS.TA − BS.TL = 0.00`. Example: cash 100,000 Dr; share capital 60,000 Cr; sales 50,000 Cr; rent 10,000 Dr: Assets 100,000; Equity 60,000; unclosed profit `-(10,000 − 50,000) = 40,000`; total 100,000. Ticket T-FIN-19.

**BR-FIN-23 P&L.** Period amounts from `fn_account_movement(from, to, include_closing=false)`: Income lines = `credit − debit`, Expense lines = `debit − credit`; `PL.210 = PL.100 − PL.200`; `PL.320 EBITDA = PL.210 − PL.300 − PL.310`; `PL.400 PBT = PL.320 + PL.110 − PL.330 − PL.340`; `PL.500 PAT = PL.400 − PL.410`; `Variance = YTD − Budget YTD`; `Variance % = Variance / |Budget YTD| × 100` (blank when 0). Margin % in the Profit Centre page `= Contribution / Revenue × 100`, 2 dp. Example: revenue 10,00,000; COGS 6,00,000; employee 1,00,000; other 50,000; depreciation 40,000; finance 20,000; other income 10,000; tax 30,000: gross profit 4,00,000; EBITDA 2,50,000; PBT 2,50,000 + 10,000 − 40,000 − 20,000 = 2,00,000; PAT 1,70,000. Ticket T-FIN-19.

**BR-FIN-24 Cash flow (indirect).** Over `[from, to]`, excluding closing journals everywhere: `NetProfit = PL.500`. For each non-cash BS account `a`: `delta(a) = Σ(debit − credit)` in the period. Then `CFO = NetProfit − Σ delta(a for cf_class in (WC, NONCASH))` (accumulated depreciation increases make `delta` negative so this adds depreciation back; shown as separate lines: depreciation add-back = `−Σ delta(NONCASH)`; each WC line = `−Σ delta(accounts of that report line)`); `CFI = −Σ delta(a for cf_class = INVESTING)`; `CFF = −Σ delta(a for cf_class = FINANCING) − Σ delta(Equity accounts with cf_class NA)`; `NetChange = CFO + CFI + CFF`; opening cash = net debit of `CASH` accounts before `from`; closing cash = at `to`; **check** `closing − opening = NetChange`. A BS account of type Asset/Liability with `cf_class='NA'` is a COA validation failure and falls into CFO "Other" so the identity still holds. Worked example: PAT 1,00,000; accumulated depreciation +20,000; receivables +50,000 (delta +50,000); inventory +30,000; payables +40,000 (delta −40,000); machine bought 1,00,000 cash (INVESTING delta +100,000); term loan +1,50,000 (FINANCING delta −150,000). CFO = 100,000 + 20,000 − 50,000 − 30,000 + 40,000 = **80,000**; CFI = **−1,00,000**; CFF = **+1,50,000**; net **+1,30,000**; opening cash 10,000 -> closing 1,40,000. Ticket T-FIN-20.

**BR-FIN-25 Ageing buckets.** `daysPastDue = asOf − COALESCE(due_date, doc_date)` (basis `DueDate`; basis `InvoiceDate` uses `doc_date`): `<= 0` Current (not yet due); 1-30; 31-60; 61-90; `> 90`. `Age Days` (register) `= max(0, daysPastDue)`. Credits (negative outstanding) reduce the bucket where their own date falls. Partial settlements use the `fn_open_items_asof` outstanding at `asOf`. Example (asOf 2026-11-02): invoice ₹50,000 due 2026-10-20 -> 13 days -> bucket 1-30; invoice ₹30,000 due 2026-11-02 -> 0 -> Current; invoice ₹20,000 due 2026-07-01 -> 124 days -> 90+. **BR-FIN-25b Collection priority score** `= overdue₹ × (1 + min(daysOldest, 180) / 180)` rounded 2 dp, descending. Ticket T-FIN-21.

**BR-FIN-26 MSME.** Supplier with `msme_registered` and category micro/small: payment due `<= 45 days` from the date of acceptance (`doc_date` when a GRN date is unknown; or the agreed days if shorter): `open_items.msme_due_date = doc_date + min(agreedDays, 45)`. Interest on overdue (MSMED Act s.15-16): compound interest with monthly rests at **three times the RBI bank rate**: `r = 3 × bankRate` (setting `msme.bank_rate_pct`, **must be maintained by Finance**); for `m` full months and `d` further days overdue on principal `P` (outstanding): `interest = r2( P × (1 + r/1200)^m × (1 + r/1200 × d/30) − P )`. Example: P = 1,00,000.00, bank rate 6.50% -> r = 19.5%; overdue 2 months 0 days: `1,00,000 × (1.01625)^2 − 1,00,000 = 3,276.41`. Medium-enterprise suppliers: bank rate only (court view; **unverified**) -> not applied (`msme_category` micro/small only). Income-tax angle: **section 43B(h)** disallows deduction for amounts due to micro/small suppliers unpaid beyond the time limit at year-end -> report `GET /finance/msme/overdue-at-year-end?asOf` lists them. The interest is a **provision alert** (a report), not automatically posted; `Post MSME Interest` creates a journal Dr `6253` / Cr `2101` (party) on request. Schedule III requires disclosure of MSME dues (BS tab `Liabilities` line). Ticket T-FIN-35.

**BR-FIN-27 Budget control.** Defined in 4.11. `available = budget − committed(open) − actual`; Stop: block when `amount > available`; Warn: allow with warning; Ignore: no check. `actual` = `Σ(debit − credit)` of `gl_entries` on the budget's account (and cost centre when set) within the FY, **excluding** closing entries; `Variance % = (actual − budget) / budget × 100`. Example: budget 1,00,000 Stop; actual 70,000; committed 20,000; new expense 15,000 -> available 10,000 -> 409 `BUDGET_EXCEEDED` (15,000 > 10,000); expense 10,000 -> posts (available 0). Ticket T-FIN-23.

**BR-FIN-28 Year-end close.** 4.7. Net profit of unit U = Σ over its Income/Expense entries of the FY (excluding closing). Closing journal lines: for each account with unit net `n = Σ(debit − credit)`: if `n > 0` credit `n` (expense), if `n < 0` debit `|n|` (income); balancing `3004`: credit when total of the P&L is a profit. Example: unit TAL income 12,00,000 Cr, expenses 9,00,000 Dr: lines Dr Income accounts 12,00,000; Cr Expense accounts 9,00,000; Cr 3004 3,00,000. Errors `CLOSE_BLOCKED` 409 (new, with `blockers[]`). Ticket T-FIN-24.

**BR-FIN-29 Depreciation hook.** Assets module posts `DEPRECIATION_POSTED`; Finance only maps the accounts (5.20). Reference calculators for the later module (not built here): Companies Act Schedule II: straight-line or WDV over useful life (plant and machinery general 15 years, continuous process 25; residual up to 5% of cost); Income-tax: WDV on blocks (plant and machinery generally 15%, computers 40%, furniture 10%; unverified). Book vs tax depreciation difference feeds deferred tax (manual journal in v1).

**BR-FIN-36 Reconciliations that must hold (integrity checks).** Evaluated by `GET /finance/integrity-checks` and shown in `fin-trial` Exception Review; tested in T-FIN-36/41: (1) TB variance = 0; (2) for each unit and date: `Σ stock_balances.value` of the unit's warehouses (`stock_ledger` latest balances) = GL balance of inventory accounts `1301..1308,1310` **for event-posted stock** within `0.00` (tolerance setting `fin.stock_gl_tolerance` default `0.00`; the inventory plan guarantees `STOCK_*` events for every ledger row); (3) per party: `Σ open_items.outstanding` (RECEIVABLE) = GL balance of accounts `1201,1202` for that party; same for PAYABLE vs `2101,2102,2104` (sign: payable credit); (4) bank account ledger balance = last reconciled statement closing balance + Σ later GL entries ... (warning only); (5) GST: `tax_ledger` ITC balance per head = GL `1401..1404` for the GSTIN's unit(s) (warning if different units share nothing); (6) `settled_amount = Σ allocations` for every open item; (7) the sum of `3009` = 0 after opening. Violations list: `{check, key, expected, actual, difference}`.

**BR-FIN-37 Inter-unit transfers.** `STOCK_TRANSFER_DISPATCHED` debits `1308` in the **source** unit and credits stock in the source unit; `..._RECEIVED` credits `1308` in the **destination** unit and debits stock there. The company-wide balance of `1308` is the value in transit (0 when all transfers are received); each unit's `1308` balance shows `+` (source) and `−` (destination) and is reported "to be eliminated on consolidation": no elimination is needed within one legal entity. GST on inter-state (different state GSTIN) transfers is a **supply between distinct persons** (taxable): such transfers also carry a `tax` block with `docKind='INV'`, treatment `B2B`, party = the other unit's GSTIN; all three units are in Maharashtra, so intra-state transfers between units with **different GSTINs** are also taxable supplies (separate registrations): the Inventory plan must supply the tax block (assumed); Finance books it like a sale to a distinct person only when the payload has `tax`. (OQ-4.)

**BR-FIN-38 Expense policy.** `Policy Result`: claim `amount` (excluding GST) vs `limit_per_claim` of the (category, grade, effective) policy: `<=` -> `Within`; month-to-date sum of the claimant's claims in the category (`Submitted/Approved/Posted`, same calendar month) + this claim `> limit_per_month` -> `Exceeded`. `Exceeded` needs an approver note; `amount > approval_limit` needs a holder of `delete` on the page. Receipts: if `amount > receipt_required_above` the claim needs `bill_no` (422 `RECEIPT_REQUIRED`). A duplicate `(party, bill_no)` -> 409 `DUPLICATE`. ITC on the claim only if `supplier_gstin` is valid and the category is not blocked (`Food`, `Entertainment`, `Lodging` default blocked). Example: Food limit 1,500; claim 1,800 -> `Exceeded`. Ticket T-FIN-22.

**BR-FIN-39 Maker-checker and bank-account verification.** A journal or note at/above its threshold needs `approve` by a user other than `prepared_by` (403 `MAKER_CHECKER`); the user who creates a payment cannot be the sole approver of the vendor bank account change (foundation 3.1: payments to a supplier use only `party_bank_accounts` with `verified_at` not null and `verified_by <> updated_by_id`; a payment to an unverified account -> 422 `BANK_ACCOUNT_UNVERIFIED`, applies when the payment mode is `NEFT/RTGS/IMPS/UPI` and the party has any bank accounts; skipped when the party has none (cash/cheque)). Ticket T-FIN-14.

**BR-FIN-40 Audit and retention.** Every write calls `AuditService` (actions in 7.7). Posted data is never hard-deleted: books of account are retained for at least 8 financial years (Companies Act s.128(5); unverified numbering, rule verified), so there is no "purge" feature; archives are `[ADD]` COULD. The audit trail export (T-FIN-46) lists every journal action with user, time, ip (ADMIN+). 

**BR-FIN-41 Opening balances.** One journal per unit, voucher type `Opening`, date = `fin.go_live_date − 1 day`, lines for each account with a non-zero opening balance; AR/AP control account lines must be entered as **bills** (open items) via the Opening Bills (4.4.7) and are **excluded** from the grid (the grid shows them read-only, derived); stock accounts are posted by the Inventory opening vouchers (`STOCK_OPENING_POSTED`) and are also read-only in the grid; the grid's `Difference` goes to `3009` automatically only if `|difference| <= ₹1.00`, else the post is refused (`OPENING_NOT_BALANCED` 422). After posting, `3009` must be 0.00. Only possible once (a second attempt -> 409 `OPENING_ALREADY_POSTED`; corrections by reversal). Ticket T-FIN-24.

**BR-FIN-42 Account master rules.** Code `^[0-9]{4,8}$` unique, immutable once it has entries or children (409 `IN_USE`); `root_type` immutable once it has entries; `parent` must be a group of the **same root type** (422 `PARENT_TYPE_MISMATCH`), no cycles (422 `CYCLE`); a group cannot be made postable and cannot receive entries; a leaf with entries cannot become a group (409); `Inactive` blocks new postings but keeps history; deleting: only a non-system account without entries/children (soft delete, code never reused); system accounts (`is_system`) cannot be deleted or have their sub type changed. Ticket T-FIN-10.

**BR-FIN-43 Draft journal editing.** Only `Draft` (not `Pending Approval`) journals are editable (409 `RECORD_LOCKED`); editing a Pending journal needs it to be rejected back to Draft; `version`/`If-Match` on every PATCH (409 `VERSION_CONFLICT`). Lines are replaced as a set on PATCH. Ticket T-FIN-09.

**BR-FIN-44 Scope of reports.** Every list/report applies: context unit (`unit_id` = ctx unit, or all permitted units for All Units), context FY (default dates = FY start..end, `asOf` default = today clipped to FY end), and the data scope (OWN / DEPARTMENT / ALL) of the page for drafts; posted ledger data is visible to anyone with `view` on the page (it is shared accounting data, like Stock Balance). Cost-centre/profit-centre filters are exact (descendants included for groups via the tree). Ticket T-FIN-08.

**BR-FIN-45 Cost-centre allocation.** An expense line may be split across cost centres by percentages: the editor sends several lines (one per cost centre) -- the server does not split automatically in v1; the `Transaction Allocation` tab `Allocate` action creates a reclass journal `Adjustment` moving the amount from the unallocated line's cost centre (none) to the target(s) with percentages summing to exactly `100.00` and the last target taking the rounding remainder. Example: ₹10,000.00 split 33.33 / 33.33 / 33.34 -> 3,333.00 / 3,333.00 / 3,334.00 (last gets the remainder). Ticket T-FIN-12.

---

## 7. API design

All paths are under the existing API prefix (the Inventory plan uses `/pages/...` and `/lookups/...` without `/api`; follow `apps/api/src/app.ts`). JSON bodies camelCase; money as **decimal strings** in requests and responses of the Finance-specific endpoints (`"1234.50"`), as **numbers** only in the shared typed-page row DTO (`data` values, to stay compatible with `GenericModulePage`). Errors use the fixed envelope. `If-Match: <version>` on every PATCH/DELETE/action that changes a versioned record. `Idempotency-Key` on every POST that posts money (existing helper).

### 7.1 `AccountingService` (TypeScript interface; file `apps/api/src/modules/finance/accounting/service.ts`)

```ts
export type VoucherType = 'Journal'|'Opening'|'Closing'|'Depreciation'|'Provision'|'Adjustment'|'Reversal'|'Bank Charges'|'Receipt'|'Payment'|'Contra'|'Sales Invoice'|'Purchase Invoice'|'Credit Note'|'Debit Note'|'Goods Receipt'|'Delivery'|'Stock Adjustment'|'Expense'|'Tax Settlement'|'Payroll'|'Other';
export interface JournalLineInput {
  accountId: string; debit: string; credit: string;            // decimal strings, one of them "0.00"
  partyId?: string; costCenterId?: string; profitCenterId?: string; unitId?: string; narration?: string;
  billMode?: 'NEW'|'AGAINST'; billDocNo?: string; billDocDate?: string; billDueDate?: string;
}
export interface PostInput {                                   // exactly one of `lines` or (`event` + `payload`)
  unitId: string; docDate: string; voucherType: VoucherType;
  narration?: string; referenceNo?: string; sourceDocType?: string; sourceDocId?: string; sourceDocNo?: string;
  event?: string; payload?: EventPayload;                      // rule-driven (FC-1: the stub's `lines` is accepted as alias of `payload` for events)
  lines?: JournalLineInput[];                                  // explicit lines (manual, payments, closing...)
  source: 'MANUAL'|'EVENT'|'PAYMENT'|'NOTE'|'EXPENSE'|'TAX'|'SYSTEM';
  overrideLock?: { reason: string }; overrideBudget?: { reason: string };
  autoReverseOn?: string;
}
export interface PostedJournal { id: string; code: string; status: 'Posted'; totalDebit: string; totalCredit: string; glEntryIds: string[]; warnings: Warning[]; openItemIds: string[]; taxDocumentId?: string; }
export const AccountingService = {
  /** Foundation name. QUEUE mode (setting): inserts a PENDING queue row and returns {queued:true,queueId}. INLINE mode: posts now. */
  post(tx: Tx, input: PostInput, actor: Actor): Promise<PostedJournal | { queued: true; queueId: string }>,
  /** Always posts now (used by the drain and by Finance's own services). Steps in 7.1.1. */
  postJournal(tx: Tx, input: PostInput, actor: Actor): Promise<PostedJournal>,
  reverse(tx: Tx, journalId: string, reason: string, actor: Actor, opts?: { reversalDate?: string; overrideLock?: { reason: string } }): Promise<PostedJournal>,
  reverseBySource(tx: Tx, sourceDocType: string, sourceDocId: string, reason: string, actor: Actor): Promise<PostedJournal | null>,
};
```
#### 7.1.1 `postJournal` algorithm (T-FIN-04; numbered, implement in this order)

1. `assertConcreteUnit`; load FY by `docDate` (`financial_years` row containing the date) -> 422 `NO_PERIOD` if none; FY `CLOSED` -> 409 `PERIOD_CLOSED`.
2. Resolve lines: if `event`, call `resolveRules(tx, event, payload)` (T-FIN-06) -> `JournalLineInput[]`; else use `lines`. Quantise every amount: reject more than 2 decimals.
3. `SELECT ... FROM fiscal_periods WHERE start_date <= $1 AND end_date >= $1 FOR SHARE`; apply BR-FIN-02.
4. Load all accounts used (`WHERE id = ANY($ids)`), check BR-FIN-03 for each line; load parties; default `unitId`, `profitCenterId`.
5. Check BR-FIN-01 (count >= 2, one side, Σ equal).
6. Budget check (4.11) for each expense-account debit line (skipped for `source` `SYSTEM`, voucher types `Closing`, `Reversal`, `Opening`).
7. Cash controls (BR-FIN-11) for lines on cash accounts when `source='PAYMENT'`.
8. Idempotency for events: `INSERT ... ON CONFLICT DO NOTHING` semantics on the journal unique index; if a journal exists return it.
9. Number: `NumberingService.next(tx,{docType: prefixOf(voucherType), unitId, fyId})` (or the event code per BR-FIN-06b).
10. `INSERT journals (status='Draft', ...)`, `INSERT journal_lines`, `INSERT gl_entries` (one per line, copying account, party, dimensions, voucher no, source), then `UPDATE journals SET status='Posted', posting_status='Posted', period_id, code, total_debit, total_credit, posted_at, posted_by`.
11. Sub-ledger: for each line with `billMode='NEW'` insert an `open_items` row (sign rule: RECEIVABLE debit -> `+amount`, credit -> `-amount`; PAYABLE credit -> `+amount`, debit -> `-amount`); for `'AGAINST'` the caller (payment service) has already prepared `allocations` through `OpenItemService.settle` in the same transaction.
12. If the input has a `tax` block (event payload): validate (BR-FIN-14), insert `tax_documents` + lines (+ `einvoice_records`, `eway_bills` drafts when applicable); if `tdsAmount > 0` insert `tds_entries`.
13. Audit `JOURNAL_POSTED` (detail: code, total, unit, source). Return `PostedJournal`.
Everything in the caller's transaction. Any error rolls back all.

### 7.2 Typed page definitions

Each typed page gets an entry in `apps/api/src/modules/finance/definitions.ts` (`FINANCE_PAGES` const array of the 19 finance ids + `TAX_PAGES` of the 10 tax ids), exporting a `TypedSchema` per page built with the helpers `f/money/qty/text/select/date/statusField/action` copied from `inventory/definitions.ts` (do not import from inventory; copy the helpers into `modules/finance/schema-helpers.ts` and keep them identical). `TypedSchema` is extended (file `apps/api/src/modules/finance/typed-extra.ts`) with `tabViews: Record<string, string>` and `reportColumns`. Field `key`s: camelCase of the registry label (`Account Code` -> `accountCode`, `1 30 Days` -> `d1to30`, `90 Plus` -> `d90Plus`, `Margin %` -> `marginPct`, `Rate %` -> `ratePct`). The **labels and order are copied from `packages/registry/registry.json`**; the schema test asserts label+order equality with the registry for every page (extends `phase4-schema.test.ts` logic). For typed pages `kind: 'typed'`; the field `required` flags equal `field-types.json` (except 1.2 item 5 type remarks).

Actions per page (`key | label | variant | allowedFrom | requires`):
* fin-journal: `submit|Submit|primary|Draft|edit`, `approve|Approve|success|Draft(pending)|delete`, `reject|Reject|danger|Draft(pending)|delete`, `post|Post|primary|Draft|edit`, `reverse|Reverse|danger|Posted|delete`.
* fin-coa: `activate`, `deactivate` (edit).
* fin-ar: `receive|Receive Payment|primary|Open,Part Received|add`, `dispute|Dispute|danger|Open,Part Received|edit`, `resolve|Resolve Dispute|Disputed|edit`, `setOwner`, `promise|Promise to Pay`, `cancel` (Opening Bills).
* fin-ap: `pay|Pay|primary|Open,Part Paid|add`, `block|Block Payment|danger|Open,Part Paid|edit`, `unblock|Unblock|Blocked|edit`, `addToProposal`, `cancel`.
* fin-creditnote / fin-debitnote: `submit`, `approve`, `reject`, `post`, `cancel` (Draft/Submitted: edit; Posted -> `reverse`: delete).
* fin-bankreco: `autoMatch|Auto Match`, `reconcile|Reconcile|success`, `reopen|Reopen|danger (delete)`, `cancel`.
* fin-costcenter / fin-profitcenter: `activate`, `deactivate`.
* fin-expenses: `submit`, `approve` (delete), `reject`, `post`, `cancel`.
* fin-budget: `approve` (delete), `close` (delete), `cancel`.
* tax-gst: `activate`, `deactivate`.
* tax-gstr1: `prepare`, `validate`, `generateJson`, `markFiled`, `revise`, `reopen`.
* tax-gstr3b: `compute`, `utilise`, `generateJson`, `markFiled`, `reopen`.
* tax-tds / tax-tcs: `linkChallan`, `cancel`, `recompute`.
* tax-hsn: `activate`, `deactivate`, `endDate`.
* tax-einvoice: `generateJson`, `enterIrn`, `markError`, `requestCancel`, `confirmCancel`, `markNotApplicable`.
* tax-eway: `generateJson`, `enterEwb`, `updatePartB`, `extend`, `cancel`.
Report-view pages: `actions: []`, `readOnly: true`.

### 7.3 Endpoints

Page-generic routes (same as Inventory; every typed page): `GET /pages/:pageId/schema`, `GET|POST /pages/:pageId/records`, `GET|PATCH|DELETE /records/:id`, `POST /records/:id/restore`, `POST /records/bulk`, `GET /records/export.xlsx`, `GET /pages/:pageId/audit`, `POST /pages/:pageId/records/:id/actions/:action`. Report pages answer list/get/export only (others 405 `READ_ONLY`). `GET /pages/:pageId/records?view=<key>` selects a view (the `tabViews`). Query: `q, status, sort, page, size, from, to, asOf, account, party, costCenter, profitCenter, voucherType, bankAccount, ...` per page filters (section 2).

Finance-specific endpoints (permission = `requirePageAction(<pageId>, <action>)`):

| Method + path | Perm | Request -> Response | Errors |
|---|---|---|---|
| `GET /finance/accounts/tree?asOf=` | fin-coa view | -> `{nodes:[{id,code,name,rootType,isGroup,balance:"…",side:"Dr"|"Cr",children:[…]}]}` | |
| `GET /finance/accounts/lookup?q=&postable=true&type=` | fin-coa view | -> `[{id,code,name,rootType,subType,partyRequired,costCenterRequired}]` | |
| `GET /finance/coa/validation` | fin-coa view | -> `{rules:[{key,label,pass,warn,fail,items:[…]}],score}` | |
| `GET /finance/periods?fyId=` | fin-coa view | -> periods | |
| `POST /finance/periods/:id/lock` / `unlock` / `close` | fin-coa delete (+ admin-fy edit for unlock/close) | `{reason?}` -> period | 409 `INVALID_TRANSITION`, `CLOSE_BLOCKED` |
| `POST /finance/fiscal-years/:fyId/close` | admin-fy edit | `{notes?}` -> `{journals:[…],netProfit}` | `CLOSE_BLOCKED` |
| `GET|PUT /finance/opening-balances` | fin-coa view / edit | `{goLiveDate, rows:[{accountId,debit,credit,readOnly}], difference}` | |
| `POST /finance/opening-balances/post` | fin-coa edit | `{}` -> journal | `OPENING_NOT_BALANCED`, `OPENING_ALREADY_POSTED` |
| `GET /finance/journals/:id` | fin-journal view | journal with lines, gl ids, reversal links | |
| `GET /finance/ledger?account=&from=&to=&party=&costCenter=&profitCenter=&voucherType=&includeClosing=` | fin-gl view | rows `{seq,postingDate,voucherNo,voucherType,account,narration,debit,credit,costCenter,profitCenter,reference,runningBalance,status}` + totals | |
| `GET /finance/ledger/integrity` | fin-gl view | checks list | |
| `GET /finance/party-ledger?partyId=&from=&to=` | fin-ar/fin-ap view | statement with running balance | |
| `GET /finance/open-items?partyId=&side=&status=&dueTo=` | fin-ar/fin-ap view | open items | |
| `POST /finance/payments` | fin-cashbook/bankbook add (kind-dependent) | `{kind,mode,bankAccountId,counterBankAccountId?,partyId?,docDate,amount,tdsAmount?,chargesAmount?,instrumentNo?,instrumentDate?,utr?,narration?,purpose?,allocations:[{itemId,amount}],allowAdvance?,autoAllocate?:'FIFO'}` -> payment | `OVER_ALLOCATION`, `ADVANCE_NOT_CONFIRMED`, `NEGATIVE_CASH`, `CASH_RECEIPT_LIMIT`, `MODE_ACCOUNT_MISMATCH`, `BANK_ACCOUNT_UNVERIFIED`, `ITEM_BLOCKED`, `DUPLICATE` (UTR) |
| `GET /finance/payments/:id/allocation-suggestion` | view | FIFO suggestion | |
| `POST /finance/payments/:id/allocate` | edit | `{allocations:[…]}` | `OVER_ALLOCATION` |
| `POST /finance/payments/:id/cancel` | delete | `{reason}` | `RECONCILED_ENTRY`, `SETTLED_DOCUMENT` |
| `GET /finance/bank-accounts` / `POST` / `PATCH :id` / `POST :id/verify` | fin-bankbook view / add / edit / delete | bank account master (account no stored encrypted, only last 4 returned) | `DUPLICATE`, `IFSC_INVALID` |
| `POST /finance/payment-proposals` | fin-ap add | `{dueTo, vendorIds?, itemIds?}` -> proposal lines | |
| `POST /finance/bank-reco/import` (multipart `file`, `bankAccountId`, `openingBalance?`, `closingBalance?`, `map?`) | fin-bankreco add | -> statement | `STATEMENT_DOES_NOT_FOOT`, `DUPLICATE_STATEMENT`, `UNSUPPORTED_FILE` |
| `GET /finance/bank-reco/:id/workspace` | view | `{statement, bankLines, erpEntries, matches, summary}` | |
| `POST /finance/bank-reco/:id/auto-match` | edit | -> counts | |
| `POST /finance/bank-reco/:id/matches` | edit | `{lineIds:[…], glEntryIds:[…]}` -> matches | `AMOUNT_MISMATCH` |
| `DELETE /finance/bank-reco/matches/:matchId` | edit | -> | `RECONCILED_ENTRY` |
| `POST /finance/bank-reco/matches/:matchId/accept` / `reject` | edit | | |
| `POST /finance/bank-reco/lines/:lineId/create-voucher` | add | `{kind:'BANK_CHARGE'|'INTEREST'|'RECEIPT'|'PAYMENT', accountId?, partyId?, narration?}` -> journal/payment + match | |
| `GET /finance/reports/trial-balance` | fin-trial view | filters -> `{rows,totals,variance,banner}` | |
| `GET /finance/reports/pnl`, `/balance-sheet`, `/cash-flow` | fin-pnl/bs/cashflow view | filters (`from,to,asOf,compare,costCenter,profitCenter`) -> `{lines:[{code,name,level,lineType,current,ytd,priorYtd,budgetYtd,variance,variancePct,category}],checks:{…}}` | |
| `GET /finance/ageing?side=&asOf=&basis=` | fin-ageing view | -> `{rows:[{partyId,code,name,current,d1to30,d31to60,d61to90,d90Plus,total}],totals}` | |
| `GET /finance/kpis` | fin-trial view | section 8 | |
| `GET /finance/integrity-checks` | fin-trial view | BR-FIN-36 | |
| `POST /finance/queue/drain` | fin-journal edit | `{limit?}` -> `{processed,posted,failed}` | |
| `GET /finance/queue?status=&event=` | fin-journal view | queue rows | |
| `POST /finance/queue/:id/retry` / `redate` | fin-journal edit / delete | `{docDate?}` | `GST_PERIOD_FILED` |
| `GET|PUT /finance/posting-rules?event=` | fin-coa view / delete + admin | list / replace rules of an event (validated with a self-test balance) | `RULE_UNBALANCED` |
| `POST /finance/budget/check` | internal service-to-service (authenticated user) | `{unitId,date,accountId,costCenterId?,amount,source}` -> `{mode,available,exceeded}` | |
| `POST /finance/budget/commit` / `release` / `cancel` | internal | commitments | |
| `GET /tax/gst/validate` | tax-gst view | | |
| `GET /tax/pos/test?from=&to=` | tax-gst view | -> `{type:'INTRA'|'INTER',heads:['CGST','SGST']}` | |
| `GET /tax/gstr1/:id/summary|sections/:section|issues` | tax-gstr1 view | | |
| `GET /tax/gstr1/:id/json` (download) | tax-gstr1 export | file `GSTR1_<gstin>_<MMYYYY>.json` | `RETURN_HAS_ERRORS` |
| `POST /tax/gstr2b/import` (multipart) | tax-purchasereg add | `{registrationId, period, file}` -> import + counts | `DUPLICATE_IMPORT`, `UNSUPPORTED_FILE` |
| `POST /tax/gstr2b/:importId/match` | edit | -> counts by status | |
| `POST /tax/purchase-docs/:id/itc` | tax-purchasereg edit | `{eligibility,reason,claimPeriod?,override?}` | `ITC_TIME_BARRED`, `MATCH_REQUIRED` |
| `GET /tax/gstr3b/:id/summary|reversals|reco` | tax-gstr3b view | | |
| `GET /tax/gstr3b/:id/json` | tax-gstr3b export | file `GSTR3B_<gstin>_<MMYYYY>.json` | |
| `POST /tax/gst-cash/deposit` | tax-gstr3b add | `{registrationId,bankAccountId,date,igst,cgst,sgst,cess,interest,fee,challanNo}` -> payment + tax_ledger | |
| `GET /tax/tax-ledger?registrationId=&type=` | tax-gstr3b view | balances + rows | |
| `POST /tax/challans` | tax-tds add | `{kind,challanDate,bsrCode,serial,interest?,fee?,entryIds:[…],bankAccountId}` | `CHALLAN_MISMATCH` |
| `POST /tax/tax-returns` / `:id/prepare` / `:id/file` | tax-tds add / edit | `{kind,formCode,fyId,quarter}` | `RETURN_VALIDATION` |
| `GET /tax/tax-returns/:id/file` | export | CSV | |
| `POST /tax/tds/compute` | internal | `{partyId,sectionCode?,amount,date}` -> compute result (no write) | |
| `GET /tax/einvoice/:id/json`, `/tax/eway/:id/json` | export | file | |
| `GET /tax/compliance-calendar?month=` | tax-gst view | due dates by GSTIN and TDS/TCS | |
| `GET /lookups/accounts`, `/lookups/cost-centers`, `/lookups/profit-centers`, `/lookups/parties?role=`, `/lookups/bank-accounts`, `/lookups/gst-registrations` | view on the owning page | `{id,code,name,…}` limit 1-50 | |

### 7.4 Report endpoint behaviour

* All report endpoints accept `from` (default FY start), `to`/`asOf` (default today clipped to the FY end), context unit (header) and FY; they run the SQL of 5.14 with `p_units = [ctx.unit]` or the caller's permitted units for All Units.
* Row DTO for the typed report pages reuses `TypedRecordDto` with `id` = a deterministic key (`<accountId>` for TB, `<lineCode>` for statements, `<partyId>` for ageing), `code` = Account Code / Line Code / Party Code, `data` the field values, `status` as listed in section 2, `amount` null.
* Large result guard: ledger `size <= 500` per page; exports up to 10,000 rows (`413 PAYLOAD_TOO_LARGE` beyond).

### 7.5 Export hooks

`GET /records/export.xlsx?pageId=` for typed/report pages uses `buildTypedWorkbook` pattern (copy `inventory/export.ts` to `finance/export.ts`, with the report page rows and a bold totals row; statements add a `Particulars` indent by level). PDF: `POST /pages/:pageId/export.pdf` (the prototype's `Letterhead PDF`) calls the existing letterhead PDF service with a table definition `{title, columns, rows, totals}`; if the letterhead service is not present yet the endpoint answers 501 `NOT_IMPLEMENTED` and the web hides nothing (button stays; toast "PDF export arrives with the Reports phase"). Ticket T-FIN-38.

### 7.6 Permissions and gates (no role names in services)

Page permission = `requirePageAction(pageId, action)`. Special gates are **page actions on a named page** (checked with `can(user, pageId, action)` in the route, never `role === ...`):
| Gate | Check |
|---|---|
| post a journal / payment / note | `edit` (journals), `add` (payments, notes) on the page |
| approve (journal, note, expense, budget), reverse, cancel a Posted document, override budget | `delete` on the page |
| lock a period | `delete` on `fin-coa` |
| unlock / close a period, override a LOCKED period, year-end close, rule edit | `edit` on `admin-fy` (Administration pages are ADMIN+ by hard rule) |
| ITC override, re-open a filed return | `delete` on `tax-purchasereg` / the return page |
| record Filed (ARN) | `edit` on the return page |
| export | `export` + module `export` flag |
Default matrix suggestion for the seed of `role_permissions` (Finance department): MEMBER view/add/edit/export; LEAD + approve through `delete` only on `fin-bankreco`; MANAGER all; (the actual matrix is edited in Administration; the plan only states the intended defaults; seed is optional: T-FIN-41).

### 7.7 Error codes (new unless marked existing) and audit actions

`JOURNAL_UNBALANCED 422`, `AMOUNT_PRECISION 422`, `PERIOD_LOCKED 409`, `NO_PERIOD 422`, `FUTURE_DATE 422`, `BEFORE_GO_LIVE 422`, `ACCOUNT_NOT_POSTABLE 422`, `COST_CENTER_REQUIRED 422`, `PARTY_REQUIRED 422`, `PARTY_ROLE_MISMATCH 422`, `PARTY_NOT_ALLOWED 422`, `ALREADY_REVERSED 409`, `CANNOT_REVERSE_REVERSAL 409`, `REVERSAL_DATE_INVALID 422`, `REASON_REQUIRED 422`, `SETTLED_DOCUMENT 409`, `RECONCILED_ENTRY 409`, `EVENT_PAYLOAD_CHANGED 409`, `NO_POSTING_RULE 422`, `UNMAPPED_ACCOUNT_KEY 422`, `RULE_UNBALANCED 422`, `ROUND_OFF_TOO_LARGE 422`, `BILL_REF_REQUIRED 422`, `OVER_ALLOCATION 422`, `ADVANCE_NOT_CONFIRMED 422`, `ITEM_BLOCKED 422`, `NEGATIVE_CASH 409`, `CASH_RECEIPT_LIMIT 422`, `MODE_ACCOUNT_MISMATCH 422`, `BANK_ACCOUNT_UNVERIFIED 422`, `MAKER_CHECKER 403`, `BUDGET_EXCEEDED 409`, `STATEMENT_DOES_NOT_FOOT 422`, `DUPLICATE_STATEMENT 409`, `PREVIOUS_STATEMENT_OPEN 409`, `RECON_DIFFERENCE 422`, `SUGGESTIONS_PENDING 422`, `AMOUNT_MISMATCH 422`, `CLOSE_BLOCKED 409`, `OPENING_NOT_BALANCED 422`, `OPENING_ALREADY_POSTED 409`, `PARENT_TYPE_MISMATCH 422`, `CYCLE 422`, `ACCOUNT_HAS_BALANCE 409`, `INVALID_TRANSITION 409`, `CREDIT_EXCEEDS_INVOICE 422`, `RECEIPT_REQUIRED 422`, `TAX_PAYLOAD_MISMATCH 422`, `GST_PERIOD_FILED 409`, `GSTR1_NOT_FILED 409`, `RETURN_HAS_ERRORS 409`, `CASH_LEDGER_SHORT 409`, `DUPLICATE_IMPORT 409`, `UNSUPPORTED_FILE 422`, `ITC_TIME_BARRED 422`, `MATCH_REQUIRED 422`, `TDS_SECTION_NOT_FOUND 422`, `PAN_INVALID 422`, `TDS_ALREADY_DEPOSITED 409`, `CHALLAN_MISMATCH 422`, `RETURN_VALIDATION 422`, `CANCEL_WINDOW_PASSED 409`, `EXTENSION_WINDOW 409`, `GSTIN_STATE_MISMATCH 422`, `CURRENCY_NOT_SUPPORTED 422`, `NOT_IMPLEMENTED 501`. Existing reused: `PERIOD_CLOSED`, `RECORD_LOCKED`, `VERSION_CONFLICT`, `DUPLICATE`, `IN_USE`, `READ_ONLY`, `NOT_GENERIC`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `PAYLOAD_TOO_LARGE`, `CONTEXT_INVALID`.
Audit actions (add to `AUDIT_ACTIONS`, targets `Journal`, `Payment`, `Account`, `Statement`, `TaxReturn`...): `JOURNAL_CREATED/UPDATED/DELETED/POSTED/APPROVED/REJECTED/REVERSED`, `PAYMENT_POSTED/CANCELLED`, `ALLOCATION_ADDED/REVERSED`, `ACCOUNT_CREATED/UPDATED/DELETED/STATUS_CHANGED`, `PERIOD_LOCKED/UNLOCKED/CLOSED`, `FY_CLOSED`, `OPENING_POSTED`, `BANK_STATEMENT_IMPORTED/RECONCILED/REOPENED`, `BANK_MATCHED/UNMATCHED`, `NOTE_*`, `EXPENSE_*`, `BUDGET_*`, `QUEUE_DRAINED/RETRIED/REDATED`, `RULES_CHANGED`, `GST_RETURN_PREPARED/VALIDATED/JSON_GENERATED/FILED/REOPENED`, `ITC_OVERRIDDEN`, `TDS_DEDUCTED/CHALLAN_LINKED/RETURN_FILED`, `EINVOICE_IRN_ENTERED/CANCELLED`, `EWAY_*`, `TAX_SETTLED`. T-FIN-08 adds the enum values and `AuditTarget` names.

### 7.8 `TdsService` and `TcsService`

```ts
TdsService.compute(tx, { partyId, sectionCode?, amount: string, date: string, sourceDocId?: string }): Promise<TdsResult>
TdsResult = { applicable: boolean, sectionId: string, sectionCode: string, newSection: string|null,
              baseAmount: string, ratePct: string, tdsAmount: string, noPanApplied: boolean,
              cumBefore: string, cumTaxedBefore: string, trail: string[] }   // trail = human lines "Cumulative 82,000.00 + 25,000.00 = 1,07,000.00 > 1,00,000.00 -> base 1,07,000.00"
TdsService.record(tx, result, ctx)  // inserts tds_entries (status Deducted) - called by the drain / payments
```
`TcsService.compute` identical shape with `kind='TCS'`.

### 7.9 GSTR-1 JSON (GSTN offline-tool layout; **re-verify against the current offline tool schema before coding**)

```json
{ "gstin": "27AAAAA0000A1Z5", "fp": "102026", "gt": 0, "cur_gt": 0,
  "b2b":  [ { "ctin": "27BBBBB1111B1Z6", "inv": [ { "inum": "INV/TAL/2026-27/0001", "idt": "05-10-2026", "val": 118000.00, "pos": "27", "rchrg": "N", "inv_typ": "R",
              "itms": [ { "num": 1, "itm_det": { "txval": 100000.00, "rt": 18, "camt": 9000.00, "samt": 9000.00, "iamt": 0, "csamt": 0 } } ] } ] } ],
  "b2cl": [ { "pos": "29", "inv": [ { "inum": "…", "idt": "…", "val": 0, "itms": [ { "num": 1, "itm_det": { "txval": 0, "rt": 18, "iamt": 0, "csamt": 0 } } ] } ] } ],
  "b2cs": [ { "sply_ty": "INTRA", "typ": "OE", "pos": "27", "rt": 18, "txval": 0, "camt": 0, "samt": 0, "csamt": 0 } ],
  "cdnr": [ { "ctin": "…", "nt": [ { "ntty": "C", "nt_num": "CRN/…", "nt_dt": "…", "val": 0, "pos": "27", "rchrg": "N", "inv_typ": "R", "itms": [ ] } ] } ],
  "cdnur":[ { "typ": "B2CL", "ntty": "C", "nt_num": "…", "nt_dt": "…", "val": 0, "pos": "29", "itms": [ ] } ],
  "exp":  [ { "exp_typ": "WOPAY", "inv": [ { "inum": "…", "idt": "…", "val": 0, "sbpcode": "INNSA1", "sbnum": "…", "sbdt": "…", "itms": [ { "txval": 0, "rt": 0, "iamt": 0, "csamt": 0 } ] } ] } ],
  "hsn":  { "data": [ { "num": 1, "hsn_sc": "7326", "desc": "…", "uqc": "NOS", "qty": 0, "rt": 18, "txval": 0, "iamt": 0, "camt": 0, "samt": 0, "csamt": 0 } ] },
  "doc_issue": { "doc_det": [ { "doc_num": 1, "docs": [ { "num": 1, "from": "INV/TAL/2026-27/0001", "to": "INV/TAL/2026-27/0100", "totnum": 100, "cancel": 0, "net_issue": 100 } ] } ] } }
```
Rules: dates `DD-MM-YYYY`; amounts numbers with 2 dp (written from `Decimal.toFixed(2)` converted by `Number()` at the last step only for JSON, never summed as floats); `fp` = `MMYYYY`; empty sections omitted; `gt` and `cur_gt` are optional (filled from settings if provided); items grouped per rate per invoice (`num` incremental).

### 7.10 TDS/TCS return CSV (intermediate; the FVU-ready format is produced by the department's TDS software; v1 provides the data)

Header `Sr,DeducteePAN,DeducteeName,SectionCode,PaymentDate,AmountPaid,TaxRatePct,TdsAmount,NoPanFlag,ChallanBSR,ChallanSerial,ChallanDate,DepositedAmount,EntryNo`. One row per entry; sorted by section, deductee, date; amounts 2 dp; dates `DD/MM/YYYY`; UTF-8 with BOM-less LF. Validation before `prepare`: PAN present or flag, challan linked, challan Σ equals Σ of its entries.

### 7.11 Portal adapter (no network in v1)

```ts
export interface GstPortalAdapter {            // apps/api/src/modules/tax/adapters/gst-portal-adapter.ts
  readonly mode: 'MANUAL' | 'GSP';
  generateIrn?(json: IrpInvoiceJson): Promise<{ irn: string; ackNo: string; ackDate: string; signedQr: string }>;
  cancelIrn?(irn: string, reasonCode: 1|2|3|4, remark: string): Promise<{ cancelDate: string }>;
  generateEwb?(json: EwbBillJson): Promise<{ ewbNo: string; validUpto: string }>;
  fileGstr1?(json: Gstr1Json): Promise<{ arn: string }>;
}
export const manualAdapter: GstPortalAdapter = { mode: 'MANUAL' };   // all optional methods absent -> services use the "manual number entry" path
```
Services call `adapter.generateIrn` only when defined (never in v1). The only registered adapter is `manualAdapter`; a test asserts no `fetch`/`http` import exists under `modules/tax/**` (grep test).

### 7.12 Queue drain trigger

`startFinanceJobs()` in `apps/api/src/server.ts` (not in `app.ts`, so tests do not start timers): every 60 s `drainQueue({limit:100})` when setting `fin.auto_drain` is true; every hour `autoReverseDue()` (journals with `auto_reverse_on <= today`), `ensureFiscalPeriods()`, `markExpiredEwb()`, `retryFailed()`. Tests call the functions directly. The web `Post pending` button (header `[ADD]` on `fin-journal`, visible with a count badge of PENDING+FAILED rows) calls `POST /finance/queue/drain`.

---

## 8. Reports and KPIs

Endpoint `GET /finance/kpis?asOf=` returns every KPI below (strings for money). Definitions (all by context unit/FY; `asOf` default today; periods use calendar month/FY):

| KPI | Exact definition |
|---|---|
| Cash + Bank | `Σ(debit − credit)` of accounts with `sub_type IN ('Cash','Bank')` up to `asOf` |
| AR (Receivables) | `Σ outstanding` of RECEIVABLE open items at `asOf` (= GL `1201+1202`) |
| AP (Payables) | `Σ outstanding` of PAYABLE open items at `asOf` (= GL `2101+2102+2104`) |
| Overdue AR / AP | outstanding with `due_date < asOf` |
| DSO | `AR(asOf) / creditSales(last N days) × N`, `N = 90`, credit sales = `Σ credit − debit` of accounts `4101..4106,4109` (excl. returns) for invoices posted in the N days with a customer; 1 decimal. Example: AR 2,40,00,000; sales 6,00,00,000 -> `240/600 × 90 = 36.0` days |
| DPO | `AP(asOf) / (COGS + non-stock purchases over N days) × N` (accounts `5101,5102` net of `5103`), N = 90, 1 decimal |
| Inventory days | `Inventory value / COGS(N) × N` |
| Net profit MTD / YTD | `PL.500` over month-to-date / FY-to-date (excluding closing) |
| Gross margin % | `PL.210 / PL.100 × 100` YTD, 2 dp |
| Budget variance % | `Σ(actual − budget) / Σ budget × 100` over approved budgets YTD (budget pro-rated by `budget_months` up to the current month) |
| Unreconciled bank items | count and net ₹ of bank statement lines `Unmatched`/`Suggested` + uncleared GL entries older than 7 days |
| GST liability (month) | Outward tax of the open/filed GSTR-1 for the month + RCM liability (per GSTIN and total) |
| ITC available vs claimed | available = Σ `itc_*` of inward documents of the period with eligibility `ELIGIBLE` and `match_status` in (`Matched`); claimed = Σ ITC in the (Filed or computed) GSTR-3B Table 4A for the period; gap = available − claimed |
| 2B mismatches | count (and tax ₹) of inward documents in status `Value Mismatch`, `Date Mismatch`, `GSTIN Mismatch`, `Missing in 2B` + `Missing in Books` rows, current month |
| TDS payable by due date | `Σ tds_amount` of entries in status `Deducted` (not in a challan) grouped by due date = 7th of the month after the deduction (30 April for March); overdue = past due |
| Returns due in next 7 days | GSTR-1, GSTR-3B, TDS payment/return dates from the compliance calendar within 7 days, per GSTIN, with status |
| Invoices without IRN | count/₹ of e-invoice records `Pending`/`JSON Generated` and overdue (`due_by < today`) |
| E-way bills expiring today | `eway_bills` `Active`/`Extended` with `valid_until::date = today` |
| MSME overdue payables | count/₹ of PAYABLE items of micro/small suppliers with `msme_due_date < asOf` |
| Pending postings | queue rows `PENDING` + `FAILED` |

Dashboards (`Module Dashboard` tab 4 cards) for Finance pages keep the generic cards plus a 5th `[ADD]` KPI chip row from this endpoint (T-FIN-37): `fin-ar` Overdue AR + DSO; `fin-ap` Overdue AP + DPO + MSME overdue; `fin-bankreco` unreconciled items; `fin-journal` pending postings; `tax-gstr1` returns due; `tax-gstr3b` ITC available vs claimed; `tax-tds` TDS payable; `tax-einvoice` invoices without IRN; `tax-eway` expiring today; `tax-purchasereg` 2B mismatches.

---

## 9. Extra functions `[ADD]`

Priority: **MUST** (built in this plan's tickets), **SHOULD** (ticketed later in the plan), **COULD** (not ticketed). Market source in brackets.

| # | Function | Priority | Rationale / source | Ticket |
|---|---|---|---|---|
| 1 | Event queue drain with retry and `Post pending` | MUST | the integration backbone [foundation, ERPNext background posting] | T-FIN-07 |
| 2 | Period lock ladder OPEN/LOCKED/CLOSED + GST-filed lock | MUST | Odoo lock dates, Zoho lock | T-FIN-24 |
| 3 | Maker-checker approvals with thresholds | MUST | SAP release strategies, voucher authorisation in Tally | T-FIN-09 |
| 4 | Bill-wise allocation with FIFO suggestion and on-account advances | MUST | Tally bill references | T-FIN-14 |
| 5 | Payment proposal / payment run (batch pay by due date, per vendor) | SHOULD | SAP payment run, BC payment journal | T-FIN-44 |
| 6 | Vendor advance with TDS netting against the later invoice | SHOULD | Tally advance ref | T-FIN-44 |
| 7 | Bank rules auto-categorisation (description contains -> account / party) | SHOULD | Zoho bank rules, Odoo reconciliation models | T-FIN-43 |
| 8 | Recurring journals (rent, depreciation, accruals) with auto-reverse | SHOULD | ERPNext Auto Repeat, BC recurring journals | T-FIN-43 |
| 9 | Accrual auto-reverse date on journals | MUST | month-end practice | T-FIN-09 |
| 10 | TDS threshold tracker with catch-up and certificates data (Form 16A data export) | SHOULD (tracker MUST) | ERPNext Tax Withholding Category | T-FIN-31, T-FIN-44 |
| 11 | TDS receivable view vs Form 26AS / AIS (manual upload of the AIS CSV and difference list) | COULD | Indian practice; listed in 04-modules market comparison | - |
| 12 | GSTR-2B reconciliation with tolerance and mismatch reasons | MUST | ERPNext India Compliance, Tally | T-FIN-29 |
| 13 | ITC reversal calculator (rule 37 180 days, rule 42/43 apportionment) | SHOULD | GST compliance | T-FIN-30 (180 days), rule 42/43 COULD |
| 14 | GST notice / demand tracker (notice no, section, due date, amount, reply status) | COULD | CA practice | - |
| 15 | E-way bill extension helper with window check | MUST | rule 138 | T-FIN-34 |
| 16 | IRN 30-day warning dashboard | MUST | GSTN advisory | T-FIN-33 |
| 17 | MSME 45-day alert, interest calculator, 43B(h) year-end report | MUST | MSMED Act, Income-tax 43B(h) | T-FIN-35 |
| 18 | Multi-unit consolidation view (All Units) with inter-unit transit | MUST | Dynamics financial dimensions | T-FIN-18 |
| 19 | Audit-trail export for statutory audit (all journal actions with users, CSV/XLSX) | SHOULD | Companies Act audit trail (accounting software feature) | T-FIN-46 |
| 20 | Multi-currency with revaluation | SHOULD | ERPNext / Zoho | T-FIN-46 |
| 21 | Expense policy limits, duplicate-bill check | MUST | Zoho Expense, ERPNext Expense Claim | T-FIN-22 |
| 22 | Budget versus actual with commitments and run-rate forecast | MUST | Dynamics budget control | T-FIN-23 |
| 23 | Cost-centre reclass allocation (percentage split) | MUST | SAP CO | T-FIN-12 |
| 24 | Cash count and cash short/excess journal | MUST | petty-cash practice | T-FIN-14 |
| 25 | Profit centre per unit with segment P&L | MUST | SAP profit centres | T-FIN-12 |
| 26 | Inventory valuation vs GL reconciliation report | MUST | auditors' standard check | T-FIN-36 |
| 27 | Ledger integrity page (TB, sub-ledger, bank, GST agreement) | MUST | internal control | T-FIN-36 |
| 28 | Bulk journal import from CSV (opening balances, month-end uploads) | SHOULD | Tally import | T-FIN-46 |
| 29 | Customer statement of account PDF / collection reminder letters | COULD | Zoho | - |
| 30 | Write-off of small balances (< ₹ setting) with approval | COULD | Odoo | - |
| 31 | Lower-deduction certificate (TDS) validity tracker | COULD | TRACES practice | - |
| 32 | e-TDS return FVU file generation | COULD | needs the NSDL format (out of scope v1) | - |
| 33 | Fixed asset capitalisation link (CWIP to asset) | COULD | Assets module later | - |
| 34 | Dunning levels and credit hold on overdue (hook to Sales credit limit) | COULD | SAP dunning | - |
