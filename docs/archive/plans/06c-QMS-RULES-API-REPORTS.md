# 06c — Quality / QMS: Business rules, API design, reports (sections 6, 7, 8 of the plan)

> Part of `06-QUALITY-QMS.md` (index). Tables are in `06b-QMS-DATABASE.md`, the pages in `06a-QMS-UI-PROCESSES.md`, the tickets in `06d-QMS-EXTRAS-TESTS-TICKETS.md`.

## 6. Business rules and formulas

**Global conventions for every rule.**
* *Today* = the current date in the time zone `qms.timezone` (default `Asia/Kolkata`), never the server's UTC date. One helper `todayIst()` in `modules/qms/calc.ts` returns `YYYY-MM-DD`.
* *Round half-up*: `roundHalfUp(x, dp)`. For `Decimal` use `toDecimalPlaces(dp, Decimal.ROUND_HALF_UP)`. For JS numbers (statistics only) use `sign(x) * Math.round((Math.abs(x) + Number.EPSILON) * 10**dp) / 10**dp`.
* *Divide by zero*: a ratio whose denominator is 0 is `0` in stored columns and `null` in report JSON (the web shows "—"). Never `NaN`/`Infinity`.
* Every error is `{error:{code,message,status,requestId,fields?}}` built with `qmsError(status, code, message, fields?)` (file `modules/qms/errors.ts`, wraps `AppError`). The codes are listed in 6.30.
* Every rule runs inside the **caller's DB transaction**; the status is re-read `FOR UPDATE` inside the transaction before it is checked (double click / retry safe).

### BR-QMS-01 AQL sampling lookup
* **Input:** `lotQty` (Decimal, > 0), a sampling plan (`qms_sampling_plan_rows`), optional `fixedSampleSize`.
* **Algorithm** (`sampleFor(lotQty, rows)` in `calc.ts`):
  1. `lotSize = ceil(lotQty)` (20.5 kg → 21).
  2. Sort rows by `lot_min`. If `lotSize < rows[0].lotMin` → `{sample: lotSize, ac: 0, re: 1}` (inspect everything).
  3. Else find the row with `lotMin ≤ lotSize ≤ lotMax` → `{sample: min(row.sampleSize, lotSize), ac: row.ac, re: row.re}`.
  4. Else (`lotSize > last.lotMax`) → throw `QMS_LOT_OUT_OF_RANGE` 422 "Lot size {n} is above the table (max {max}). Pick a plan that covers it, or enter the sample size by hand with a reason."
  5. If the inspection plan has `fixed_sample_size` and **no** `sampling_plan_id`: `{sample: min(fixed, lotSize), ac: 0, re: 1}`. If it has both, the fixed size replaces `sample` but `ac/re` still come from the table.
  6. A manual override (`sampleQty` sent by an approver with a `samplingOverrideReason` ≥ 10 characters) replaces `sample`; `ac/re` stay.
* **Per-characteristic sample count** (`sampleCountFor(char, lotSize, planSample)`): `PLAN`→planSample; `FIXED`→min(sample_fixed, lotSize); `ALL`→lotSize (if > 200 → `QMS_SAMPLE_TOO_LARGE` 422 "100% checks above 200 pieces are recorded as one summary line"); `PER_N`→ceil(lotSize / sample_per_n). Total result rows of one inspection ≤ `qms.max_results_per_inspection` (2000) else `QMS_TOO_MANY_RESULTS` 422.
* **Worked examples (plan `CLIENT-AQL`):** lot 20 → row 16–25 → sample 5, Ac 0, Re 1. Lot 40 → 8, Ac 1, Re 2. Lot 100 → 20, Ac 1, Re 2. Lot 300 → 50, Ac 3, Re 4. Lot 1200 → 80, Ac 5, Re 6. Lot 1201 → error. Lot 1 → sample 1, Ac 0, Re 1. Lot 20.5 → lotSize 21 → 5, 0/1.
* **Ticket:** T-QMS-11 (function), T-QMS-19 (use).

### BR-QMS-02 Lot decision (incoming) — the recommendation
* **Inputs:** results of the inspection (after the sample was inspected), `ac`, `mtc_status`, plan.
* **Definitions:** a *defective piece* = a distinct `sample_no` that has **at least one** result `NG` on a `MEASURED` or `ATTRIBUTE` characteristic (a piece with 3 failed characteristics counts once). `defective_count` = number of defective pieces. A *verification failure* = any `CHECKLIST` result `NG`. A *critical failure* = any `NG` on a characteristic with `char_class = 'Critical'`.
* **Algorithm** (`recommendLot(...)` returns `{aqlResult, recommendation, reasons[]}`):
  1. `aqlResult = defectiveCount ≤ ac ? 'ACCEPT' : 'REJECT'` (Re = Ac+1 so ≥ Re is the same test).
  2. `recommendation = 'REJECT'` if aqlResult REJECT, or verification failure, or critical failure.
  3. Else `recommendation = 'HOLD'` if `mtc_status` is required (plan characteristic named like "MTC" is `is_required`, or item category is raw material) and `mtc_status <> 'Received'`.
  4. Else `'ACCEPT'`.
* **Client formula difference (decision):** the client sheet's "Final Decision" rejects the lot when *any* rejected quantity > 0 and ignores Ac; its "AQL Result" uses Ac. QMS uses the AQL result (this rule). A lot with 1 defective piece in a sample of 20 (Ac 1) is **accepted** and the one piece is rejected individually (BR-QMS-03).
* **Examples:** lot 100, sample 20, Ac 1: 1 defective → `ACCEPT`; 2 defective → `REJECT`. Lot 100, 0 defective but one CHECKLIST row "Material Grade matches PO/Drawing/MTC" = NG → `REJECT`. Lot 100, all OK, `mtc_status = 'Pending'` → `HOLD`.
* **User decision vs recommendation:** `Reject` or `Hold` may always be chosen. `Accept` when recommendation is `REJECT` → `QMS_DECISION_CONFLICT` 422; the only way is `Accept Under Deviation` by a user with `approve` on the page, with `reason` ≥ 10 characters and `deviationRef` (BR-QMS-25 four-eyes). `Accept` when recommendation is `HOLD` is allowed only if `mtc_status` is changed to `Received` or `Not Applicable` first.
* **Error:** `QMS_DECISION_CONFLICT`, `QMS_DECISION_INCOMPLETE` (results still `PEND`). **Ticket:** T-QMS-11, T-QMS-19.

### BR-QMS-03 Quantity reconciliation of a decision
* Invariant (also a DB CHECK for Completed): `accepted_qty + rejected_qty + hold_qty + rework_qty = lot_qty`, all ≥ 0, scale 3.
* **Defaults** offered by the server: `Accept` → rejected = number of defective pieces **if** the UOM is a count UOM (`Nos`, `Set`, `Pair`, `Box`), else 0; accepted = lot − rejected. `Reject` → rejected = lot. `Hold` → hold = lot. `Accept Under Deviation` → accepted = lot − rejected (the approver may change).
* A user-supplied split must satisfy the invariant, else `QMS_QTY_MISMATCH` 422 with `fields: {acceptedQty: "…"}`. For `Accept` the rejected quantity must be ≥ the default (pieces found defective cannot be accepted): else `QMS_QTY_MISMATCH`.
* **Example:** lot 100 Nos, defective 1, Accept → accepted 99, rejected 1, hold 0, rework 0 → one NCR for qty 1 (BR-QMS-07).
* **Ticket:** T-QMS-19.

### BR-QMS-04 Result evaluation per characteristic
* `MEASURED`: `result = 'OK'` when `(lsl IS NULL OR v ≥ lsl) AND (usl IS NULL OR v ≤ usl)` (limits inclusive), compared as `Decimal` at 4 decimals (the value is rounded half-up to 4 dp when saved); else `'NG'`. Missing value → `'PEND'`.
* If a plan characteristic gives `nominal` and a tolerance text `±t` / `+a/-b` but no limits, the **plan save** computes `lsl = nominal − b`, `usl = nominal + a` (4 dp). Example: nominal 10.0000, `±0.05` → lsl 9.9500, usl 10.0500; reading 10.0500 → OK; 10.0501 → NG; 9.9499 → NG.
* `ATTRIBUTE` / `CHECKLIST`: the inspector chooses `OK`, `NG`, `NA` (not applicable) or `NF` (not found). `NF` counts as OK; `NA` is ignored; `PEND` blocks completion of required rows. For flaws whose limit is a formula (VT sheet, e.g. "h ≤ 0,05 t, but max. 0,5 mm") the inspector measures with the weld gauge, types the value in `observed_text`, and chooses OK/NG — QMS does **not** evaluate the formula (decision D-3).
* `completeInspection` fails with `QMS_RESULTS_INCOMPLETE` 422 (message "12 required results are still pending") when any `is_required` result of a sampled row is `PEND`.
* **Ticket:** T-QMS-11, T-QMS-17.

### BR-QMS-05 Rates: rejection %, acceptance %, PPM, rework %, FPY
* `rejectionPct = rejected / received × 100` → 2 dp half-up. `acceptancePct = accepted / received × 100` → 2 dp. (Client AJ/AK columns.)
* `ppm = rejected / received × 1_000_000` → stored 2 dp, shown as integer (client AP / "Internal PPM" columns).
* `ppmGrade`: `ppm ≤ 1000 → 'A'`, `≤ 5000 → 'B'`, `≤ 10000 → 'C'`, else `'D'` (client's rating; thresholds from `qms.ppm_grade_cuts`).
* `reworkPct = rework / produced × 100` (2 dp). `firstPassYield = (inspected − rejected − reworked) / inspected × 100` (2 dp, floor at 0).
* **Example:** received 5000, rejected 12 → rejection 0.24 %, acceptance 99.76 %, PPM 2400.00 → grade `B`. Received 0 → all 0 / null.
* **Note (client defect to avoid):** the client's PPM sheet sums percentages for the YTD figure and divides rejects by *dispatches*. QMS computes YTD PPM as `Σ rejected / Σ base × 1e6`, never an average or sum of monthly ratios.
* **Ticket:** T-QMS-11.

### BR-QMS-06 Stock: QC hold, release, rejected stock, reversal
* **Where the stock is.** Goods needing inspection are received by Plan 03 into the unit's QC hold warehouse (`scm_settings.qc_hold_warehouse_id`) with `qc_state = PENDING`. The QC hold warehouse is also the reject area: rejected, rework and held pieces stay in it, identified by the NCR (decision D-10). Only `INCOMING` inspections post stock (D-4); the other kinds only record the decision, which Manufacturing and Sales read (section 1.4).
* **Who posts.** For an inspection linked to a GRN line, **Plan 03 posts** (D-16): QMS calls `GrnQcPort.decideLine` (Plan 03 `qcDecide`: accepted quantity QC hold to receiving with `TRANSFER_OUT` / `TRANSFER_IN` at unchanged value). QMS never posts a second movement for the same quantity. For an inspection without a GRN line (typed by hand) QMS posts through `QcStockPort.move` (`StockService.postMovement`, voucher types `QC_OUT` / `QC_IN`).
* **On a committed decision** (one transaction, `Idempotency-Key` required):
  1. `accepted_qty > 0`: with a GRN line, `GrnQcPort.decideLine`; without, `QcStockPort.move` QC hold to `target_warehouse_id` (move kind `RELEASE_TO_STOCK`). For a batch-tracked item the batch id is passed so the batch balance moves with it.
  2. `rejected_qty > 0`, `rework_qty > 0` and `hold_qty > 0` stay in the QC hold warehouse; no movement and no accounting event.
  3. With a GRN line, `decideLine` is called **once per GRN line**, when the last live inspection of that line is Completed, with `accepted = Σ accepted_qty` and `rejected = Σ rejected_qty + Σ rework_qty + Σ hold_qty` of all its inspections (Plan 03 requires `accepted + rejected = received`); `rejectReason` = the first defect name or "Quality rejection". Until then the stock simply stays in QC hold.
  4. Plan 02 batch status (`BatchQcPort`, only for batch-tracked items): decision Accept (accepted > 0) sets the batch `Released`; Reject with accepted = 0 sets `Rejected`; Hold sets `On Hold`; a later Use As Is / Sort-OK / rework-OK release of the whole remaining quantity sets `Released`.
  5. Each QMS-posted move is one `inspection_stock_moves` row with `idempotency_key = 'QCMOVE:' + decisionId + ':' + moveKind`; its id is the ledger `voucherId` and the inspection code is the `voucherNo`. For GRN-linked stock the row records the ledger ids returned by `decideLine` (kind `RELEASE_TO_STOCK`).
* Moves leave at the moving-average value and arrive at the same value (total value conserved). Insufficient stock in the QC hold warehouse gives `INSUFFICIENT_STOCK` 409 from `StockService`; the whole decision rolls back.
* **Releases after the first decision** (Use As Is, sorted-OK, reworked-OK pieces) are always `QcStockPort.move` from the QC hold warehouse to the receiving / target warehouse (Plan 03 `qcDecide` cannot be called twice for a line). The Plan 03 GRN line counters are not changed by these releases (open item for Plan 03, section 14 `OTHER-PLAN-ISSUE`).
* **Reversal** (`reopen`, permission `delete`): allowed only while no NCR created from this decision has a disposition beyond `Open` (else `QMS_REVERSAL_BLOCKED` 409) and, for a GRN-linked decision, only while Plan 03 still allows its own QC decision to be undone (`GrnQcPort` has no undo call: QMS refuses with `QMS_REVERSAL_BLOCKED` "Undo the QC decision on the GRN first" when the line is `DECIDED`). QMS-posted moves are undone with `reverseVoucher`, `reversed_at` set, the decision gets `is_current = false` and a `reversal_reason` (at least 10 characters), the auto-NCR is cancelled (reason "Decision reversed"), the inspection returns to `In Process`, the batch status returns to `On Hold`.
* **Worked example (no GRN line):** 100 kg of an item at average rate 50.00 sit in the QC hold warehouse (value 5,000.00). Decision accepted 90 / rejected 10: `QcStockPort.move` of 90 to the target warehouse (4,500.00 out, 4,500.00 in); the 10 rejected stay in QC hold (500.00). Sum of values 4,500.00 + 500.00 = 5,000.00; QC hold balance 10 / 500.00.
* **Error:** `QMS_NO_QC_WAREHOUSE` 422, `QMS_TARGET_WAREHOUSE_REQUIRED` 422, `QMS_REVERSAL_BLOCKED` 409, `INSUFFICIENT_STOCK` 409.
* **Ticket:** T-QMS-18 (adapters), T-QMS-19 (decision).

### BR-QMS-07 Automatic NCR on rejection
* **Trigger** (setting `qms.auto_ncr_on_reject` true): a decision is committed on an `INCOMING` inspection with `rejected_qty > 0` or `rework_qty > 0`; or an `IN_PROCESS`/`FINAL`/`VT`/`WELD_BEFORE_AFTER`/`ISIR`/`LAYOUT` inspection is Completed with `rejected_qty > 0` or `rework_qty > 0`.
* **Idempotency:** unique index `ncrs_one_per_decision_idx (source_inspection_id, source_decision_seq)`; a second call finds the live NCR and returns it. For non-incoming kinds `source_decision_seq = 0`.
* **Fields:** `source` = `'Incoming Inspection'` / `'In-Process'` / `'Final Inspection'` (VT, WELD_BEFORE_AFTER, ISIR, LAYOUT use `'In-Process'`); `reference` = inspection code; `item_id`, `supplier_id` (incoming), `batch_no`, `drawing_no`, `process_name` = `operation_name`, `operator_name`; `hold_qty = rejected_qty + rework_qty`; `defect_id` = the defect of the first NG result that has one; `problem_description` = text built from the NG results ("Characteristic: reading vs spec" lines, max 1000 chars); `containment` = "Stock held in reject area" (incoming) or "Lot on hold" (others); `severity` = max of: defect `default_severity`; `Critical` if a Critical characteristic failed; `Major` default; `owner_id` = the inspection's creator; `due_date = doc_date + qms.ncr_sla_days[severity]` calendar days; status `Open`. The inspection gets `ncr_id`.
* **Example:** incoming lot, decision Reject, lot 100 → NCR `NCR/U3/26-27/0007`, hold_qty 100, severity Major, due date = date + 7 days.
* **Ticket:** T-QMS-22.

### BR-QMS-08 NCR severity, SLA, aging, repeat detection, CAPA recommendation
* `dueDate = docDate + SLA[severity]` days (Critical 2, Major 7, Minor 15, from `qms.ncr_sla_days`); a user may change the due date but never to a date before `docDate` (`ncrs_due_chk`).
* `ageDays = (closing_date ?? today) − doc_date`. Buckets: `0–7`, `8–15`, `16–30`, `>30`. `overdue = today > due_date AND status IN ('Open','In Process','Completed')`.
* **Repeat:** on create, if another non-cancelled NCR exists with the same `item_id` and the same non-null `defect_id` and (same `supplier_id` for incoming, or same `process_name` otherwise) with `doc_date ≥ today − qms.repeat_window_days (90)` → `is_repeat = true`, `repeat_of_ncr_id` = the newest such NCR.
* **CAPA recommended** (`needsCapa` flag in the NCR DTO): `severity = 'Critical'` OR `is_repeat` OR `cost_internal + cost_external ≥ qms.capa_cost_trigger (50000.00)`. A Critical or repeat NCR cannot be **Closed** without a linked CAPA (`QMS_CAPA_REQUIRED` 409).
* **Status machine** (actions in 6.25): `Open → In Process` automatically when the first containment, disposition, root cause or 5-Why is recorded; `In Process → Completed` automatically when `coveredQty = holdQty` and every disposition is `Completed` or `Cancelled`; `Completed → Closed` by action `close` (needs `approve`, `root_cause` and `corrective_action` non-empty — both are columns of the client register); `Closed → In Process` by `reopen` (`approve`, reason ≥ 10 chars); `Open → Cancelled` by `cancel` (reason, only when no disposition has stock effect).
* **Ticket:** T-QMS-11 (pure parts), T-QMS-22.

### BR-QMS-09 Dispositions and quantity coverage
* Allowed dispositions: `Use As Is`, `Rework`, `Scrap`, `Return To Supplier`, `Sort`. NCR `disposition` summary = the single type used, or `Mixed`.
* **Coverage:** `coveredQty = Σ qty of lines of type Rework|Scrap|Return To Supplier|Use As Is that are not Cancelled  +  Σ qty_ok_after of Sort lines that are Completed`. Rule: `Σ qty of all non-cancelled lines ≤ holdQty` (else `QMS_DISPOSITION_QTY` 422, message "Dispositions total 12.000 but only 10.000 is on hold"). `uncoveredQty = holdQty − coveredQty` (a Sort that finds `qty_ng_after` pieces leaves them uncovered until a Scrap / Return line is added).
* NCR summary quantities (columns): `rework_qty = Σ Rework`, `reject_qty = Σ Scrap + Σ Return To Supplier`, `return_qty = Σ Return To Supplier`, `use_as_is_qty = Σ Use As Is` (non-cancelled).
* `Use As Is`: needs `concession_ref` and an approver (`approve`) other than the NCR owner; the stock moves QC hold warehouse to the target / receiving warehouse with `QcStockPort.move` (move kind `RELEASE_TO_STOCK`, idempotency key `QCMOVE:<ncrId>:<lineId>:ASIS`). A Critical NCR cannot use `Use As Is` (`QMS_ASIS_FORBIDDEN` 422).
* `Return To Supplier`: only for an NCR whose inspection is linked to a GRN line, because the return is Plan 03's debit note; otherwise `QMS_RTS_NEEDS_GRN` 422 ("Create the debit note in Procurement"). Needs `supplier_id` on the NCR (`QMS_SUPPLIER_REQUIRED` 422). On `complete` QMS calls `GrnQcPort.returnToVendor` (Plan 03 debit note and stock issue from the QC hold warehouse; the debit-note code becomes `rts_ref`); QMS posts no stock and no event of its own. If the supplier has no open SCAR for this NCR the response carries `suggestScar: true`.
* `Rework` creates a `rework_requests` row (BR-QMS-10); `Scrap` creates a `scrap_requests` row (BR-QMS-11); `Sort` records `qty_ok_after`/`qty_ng_after` on completion (sum = qty) and moves `qty_ok_after` back to stock (`SORT_OK_TO_STOCK`) and costs sorting hours (BR-QMS-12).
* **Example:** NCR hold 23. Lines: Rework 20 (Open), Scrap 3 → sum 23 ≤ 23 OK; adding Rework 1 → 24 > 23 → `QMS_DISPOSITION_QTY`. When rework completes with ok 19 / ng 1 → the NCR has uncovered 1 → user adds Scrap 1 → covered 23.
* **Ticket:** T-QMS-22, T-QMS-23.

### BR-QMS-10 Rework flow and re-inspection
* `rework_requests.qty` = the disposition qty (never more). A work log row adds `qty_reworked`; `qty_done = Σ qty_reworked ≤ qty` (else `QMS_REWORK_QTY` 422). Status: `Open → In Process` on the first log; `Completed` when `qty_done = qty` (action `complete` is rejected with `QMS_REWORK_INCOMPLETE` 409 if `qty_done < qty` unless `closeShort: true` with reason, which cancels the remainder).
* **Re-inspection is mandatory** before `Closed`: action `reinspect` creates a `Draft` inspection of the **same kind and plan as the source inspection** (`lot_qty = qty_done`, `rework_request_id` set); when that inspection is Completed, the service writes `qty_ok = accepted_qty`, `qty_ng = rejected_qty` on the request and on the disposition (`qty_ok_after`, `qty_ng_after`), moves ok pieces to stock (incoming) and sets the request `Closed` if `qty_ng = 0` else leaves it `Completed`. Closing without re-inspection → `QMS_REINSPECTION_REQUIRED` 409.
* Rework cost per log row: `amount = round2(hours × qms.rework_hour_rate + material_cost)`; one `ncr_cost_lines` row (`REWORK`, `source_type='REWORK_LOG'`, `source_id`=log id, unique so never doubled). **Example:** 6.00 h × 350.00 + 120.00 = 2220.00. Re-inspection hours count as `REINSPECTION` cost when entered manually.
* **Ticket:** T-QMS-23.

### BR-QMS-11 Scrap flow
* `scrap_requests`: `Open → Approved` (action `approve`, `approve` permission, approver ≠ requester `created_by_id`) `→ Completed` (action `complete`).
* On `complete`: if `from_warehouse_id` is set (default = the QC hold warehouse) → `QcStockPort.issueOut` the qty (voucher type `QC_OUT`, leaves at the average rate; `scrap_value` = ledger value, 2 dp) and one `AccountingService.post` of event `STOCK_SCRAP_POSTED` with the payload of `06b` 5.2.2 (`SCRAP_LOSS` debit, `INVENTORY` credit, `gstItcReversal = true`, `docNo`, `docDate`); if not set (WIP not tracked in stock) → no stock movement and no event (the cost line still counts for COPQ), `scrap_value = round2(qty × unit_cost)` where `unit_cost` defaults to `items.standard_cost`, and must be > 0 or the user enters it (`QMS_SCRAP_COST_REQUIRED` 422).
* Cost line `SCRAP` amount = `max(scrap_value − salvage_value, 0)` (`source_type='SCRAP_REQUEST'`).
* **Example:** scrap 10 pcs at average rate 50.00 → scrap_value 500.00; salvage 120.00 → cost 380.00.
* **Ticket:** T-QMS-23.

### BR-QMS-12 Cost of poor quality (COPQ) and cost of quality
* **Classes** (client "COPQ Summary" + "Quality Cost Monitor"): `INTERNAL` = Scrap + Rework + Sorting + Re-inspection + other internal; `EXTERNAL` = Customer Returns + Warranty/Field failures + Penalty + other external. `Prevention` and `Appraisal` come from monthly inputs.
* For a month `M` and unit `U` (all amounts 2 dp):
  * `internalFailure = Σ ncr_cost_lines.amount (cost_class INTERNAL, cost_date in M, NCR unit U, NCR not cancelled)`.
  * `externalFailure = Σ ncr_cost_lines (EXTERNAL, same filters) + monthly.customer_return_cost + monthly.warranty_cost + monthly.penalty_cost` (the monthly figures are for amounts **not** entered on any NCR; the screen says so).
  * `copq = internalFailure + externalFailure`.
  * `appraisal = monthly.appraisal_cost + Σ calibration_records.cost (status Completed, doc_date in M)`; `prevention = monthly.prevention_cost`.
  * `totalQualityCost = copq + appraisal + prevention`; `qualityCostPct = totalQualityCost / monthly.sales_value × 100` (2 dp; `null` when sales_value = 0); `copqPct` likewise.
* Sorting cost = `hours × qms.sorting_hour_rate`.
* **Worked example (one month):** sales 2,000,000.00; prevention 15,000.00; appraisal input 25,000.00 + calibration 5,000.00 = 30,000.00; internal failure: scrap 380.00 + rework 2,220.00 + sorting 37,400.00 = 40,000.00; external: NCR lines 12,000.00 + monthly warranty 8,000.00 = 20,000.00. `copq = 60,000.00` (3.00 %); `totalQualityCost = 60,000 + 30,000 + 15,000 = 105,000.00` → `5.25 %`.
* **Ticket:** T-QMS-11 (formulas), T-QMS-28.

### BR-QMS-13 CAPA / 8D gates
Status machine of a CAPA (`Open → In Process → Completed → Closed`, `Cancelled`):
* **Create** from an NCR (copies item, supplier, severity, problem text, containment rows) or standalone. `capa_type = 'Supplier (SCAR)'` needs `supplier_id` (DB CHECK); `'Customer (8D)'` needs `customer_ref` (warning only).
* **`start` (Open → In Process):** D1 team has ≥ 2 members and exactly one `Leader` (`QMS_D1_TEAM` 422); D2 `d2_what`, `d2_where`, `d2_when` non-empty (`QMS_D2_INCOMPLETE` 422).
* **`complete` (In Process → Completed):** (D3) severity Critical/Major → ≥ 1 containment row (`QMS_D3_MISSING`); (D4) ≥ 1 `OCCURRENCE` and ≥ 1 `ESCAPE` root cause, and at least one of each `verified = true` (`QMS_D4_INCOMPLETE`); (D5) ≥ 1 action with phase `D5` (responsible + target date); (D6) every `D5` action has a matching completed implementation: all D5 actions `Completed` with `done_date` (`QMS_D6_PENDING`); (D7) ≥ 1 action with phase `D7` (`QMS_D7_MISSING`); (D8) `d8_recognition` ≥ 10 characters (`QMS_D8_MISSING`). Sets `completed_date = today`, `effectiveness_due_date = completed_date + qms.capa_effectiveness_days`, `effectiveness_result = 'Pending'`; and copies the first OCCURRENCE root cause text into `root_cause` (500 chars) and the D5 / D7 action texts into `corrective_action` / `preventive_action` when those summary fields are empty.
* **`close`:** see BR-QMS-14.
* Target date default `doc_date + qms.capa_default_target_days (30)`. `overdue = today > target_date AND status IN ('Open','In Process')`. A D5/D6/D7 action is overdue when `today > target_date AND status IN ('Open','In Process')`.
* **Ticket:** T-QMS-24.

### BR-QMS-14 CAPA effectiveness check timing and closure
* `effectiveness_due_date = completed_date + 90 days` (calendar). **Example:** completed 2026-09-12 → due 2026-12-11.
* Action `record_effectiveness {result: 'Effective'|'Not Effective', note, date}`: allowed only when `today ≥ effectiveness_due_date`; an approver may record earlier with `earlyReason` (≥ 10 chars) (else `QMS_EFFECTIVENESS_TOO_EARLY` 409). `note` ≥ 20 characters and must say what was checked (e.g. recurrence count). Sets `effectiveness_date`.
* `Not Effective` → status back to `In Process`, `effectiveness_round + 1`, result `Pending`, D5/D7 actions may be added again; a new `complete` recomputes the due date.
* `close` (permission `approve`): requires `effectiveness_result = 'Effective'`; the closer must differ from `owner_id` (`QMS_FOUR_EYES` 403) — a single-user company may disable this with setting `qms.four_eyes = false` (default true); sets `closed_by_id`, `closed_at`; linked NCRs whose only blocker was this CAPA may then be closed.
* A **8D cycle time** = `closed_at::date − doc_date` days (report 8).
* **Ticket:** T-QMS-24.

### BR-QMS-15 5-Why validation
* Chain rule: `why_n` may be filled only if `why_(n−1)` is filled (`QMS_WHY_GAP` 422, `fields: {why3: "Fill Why 2 first"}`); same for `missed_why_n`.
* `complete` (→ Completed) needs `problem` ≥ 10 chars, `why_1` and `why_2` filled, `root_cause` ≥ 10 chars and **not equal** (case-insensitive, trimmed) to the problem text or to `why_1` (`QMS_ROOT_EQUALS_PROBLEM` 422); if any `missed_why_*` is filled, `missed_root_cause` is required.
* `close` needs `Completed` and, when `capa_id` is set, that CAPA to have ≥ 1 completed D5 action (the "Action Linkage / Closure Review" tabs).
* Linking: the first 5-Why of an NCR sets `ncrs.five_why_id`; creating a 5-Why from a CAPA sets `capas.five_why_id` and (if the CAPA has no OCCURRENCE root cause) offers the `root_cause` as a CAPA root-cause row with method `5-Why` (action `push_to_capa`).
* **Example:** problem "Chamfer was hand-ground" ; why_1 "Routing allowed manual finishing"; why_2 "Work instruction did not prohibit it"; root cause "PFMEA and control plan did not define the chamfer as a critical feature" → valid.
* **Ticket:** T-QMS-25.

### BR-QMS-16 Calibration due-date logic
* Frequency label → days: `30 days`=30, `90 days`=90, `180 days`=180, `365 days`=365, `730 days`=730, `Custom` = `frequency_days` (1..3650). The server always stores `frequency_days` consistent with the label.
* `next_due_date = last_calibration_date + frequency_days` (**plain calendar day addition**, no month arithmetic). Examples: 2026-01-15 + 365 = 2027-01-15; 2023-12-31 + 365 = 2024-12-30 (2024 is a leap year).
* `calibrationState(today, next_due, alertDays)`: no `last_calibration_date` → `'Not Calibrated'`; `today > next_due` → `'Overdue'`; `0 ≤ next_due − today ≤ alertDays (30)` → `'Due Soon'`; else `'Valid'`. The instrument **may be used on the due date itself** (due 2026-12-20: 2026-11-19 Valid, 2026-11-20 Due Soon (30 days), 2026-12-20 Due Soon (0 days), 2026-12-21 Overdue).
* A calibration record, when `Completed`, sets `instruments.last_calibration_date = doc_date`, `next_due_date = doc_date + frequency_days`, `agency`, `certificate_no`, `last_result`; its own `next_due_date` column must equal that. A record dated in the future → `QMS_DATE_FUTURE` 422; dated before the instrument's `last_calibration_date` → `QMS_CAL_ORDER` 422.
* **Import rule (client sheets):** the client sheet has "Validity" (= next due) but no last-calibration date: import sets `next_due_date = validity`, `last_calibration_date = validity − frequency_days`, and marks the row `derived` in the import report; a dash `-` in Validity (Unit-5 sheet) imports as **Not Calibrated** and the instrument is created `Blocked / MANUAL` until a calibration record is entered.
* **Ticket:** T-QMS-11, T-QMS-15.

### BR-QMS-17 Blocking of overdue / out-of-tolerance instruments
* `enforceCalibrationBlocks(tx, unitId?)`: `UPDATE instruments SET status='Blocked', block_reason='OVERDUE' WHERE status='Active' AND deleted_at IS NULL AND (next_due_date < today OR last_calibration_date IS NULL)`; one audit entry per instrument (`actor = null`, detail `{reason:'OVERDUE', due: …}`) and a notification to `notify_user_id` (notification stub: `notifyUser(userId, text)` no-op logger until Phase 6). Called: (a) by the scheduler every 15 minutes (`startQmsScheduler`, started in `server.ts`, guarded by `pg_try_advisory_lock(727001)` so only one process runs it), (b) at the start of every result-entry request, (c) when `qms-calibration` is listed. The scheduler is an optimisation; (b) and (c) make the rule correct without it.
* **Using a blocked instrument:** saving a result with `instrument_id` of an instrument that is `Blocked`/`Inactive`, or `Active` but `next_due_date < today` → `QMS_INSTRUMENT_BLOCKED` 409, message "Instrument INS-DEMO-001 is blocked (overdue since 2026-12-21). Use another instrument or calibrate it." The block applies to the *date of measurement* (`measured_at`, default now); old results are never changed.
* **Unblocking:** automatic when a `Completed` calibration record with result `Pass` or `Pass After Adjustment` is saved (and no open impact review for an OUT_OF_TOLERANCE block: else `QMS_IMPACT_REVIEW_OPEN` 409). Manual `block` / `unblock` actions need `approve` and a reason ≥ 10 chars (`block_reason = 'MANUAL'` / `'DAMAGED'`). An instrument `Inactive` (retired) can never be selected.
* **Ticket:** T-QMS-15, T-QMS-16, T-QMS-17.

### BR-QMS-18 Out-of-tolerance impact review
* Trigger: a calibration record `Completed` whose **as-found** evaluation fails, i.e. `result = 'Fail'` **or** `result = 'Pass After Adjustment'` with any point whose `as_found` is out of tolerance (as-found out of tolerance although adjusted; ISO/IEC 17025 clause 7.10 practice).
* Point evaluation: `point_result = 'OK'` when `|as_found − nominal| ≤ tolerance`. Suggested record result: all as-found OK → `Pass`; some as-found NG and all as-left OK → `Pass After Adjustment`; some as-left NG → `Fail`. A record with result `Pass` / `Pass After Adjustment` but an as-left NG point → `QMS_CAL_RESULT_CONFLICT` 422.
* Action in the same transaction: instrument `Blocked / OUT_OF_TOLERANCE` (if result `Fail`; for `Pass After Adjustment` the instrument returns to Active but the review is still opened); create `calibration_impact_reviews` (`Open`) with `window_start = instrument.last_calibration_date` **before** this record (or `commissioning_date`, or `created_at::date` if both null), `window_end = record.doc_date`; items = one per `inspections` row (status Completed) that has ≥ 1 `inspection_results` with `instrument_id = X AND measured_at::date BETWEEN window_start AND window_end` (`readings_count` = number of such results, `qty = lot_qty`).
* Close (`approve`): every item `action ≠ 'Pending'`, `conclusion` ≥ 20 characters; item action `NCR Raised` needs an NCR (the action button creates one with source `Calibration`, reference = the review code); `Recall` / `Re-inspect` need `remark`. Unblocking waits for closure (BR-QMS-17).
* **Example:** last good calibration 2026-01-10; Fail on 2026-12-20; 14 inspections used the instrument in between (56 readings) → review with 14 items.
* **Ticket:** T-QMS-16.

### BR-QMS-19 Process capability (Cp, Cpk, Pp, Ppk)
* **Data:** for one item + one `MEASURED` characteristic (same name / `characteristic_id`) and a date range, take all `inspection_results.measured_value` of Completed `IN_PROCESS` inspections (and `FINAL`, if the user ticks it), ordered by `inspected_at, sample_no`. `n` = count. `m = subgroup_size` (user input 1..10; default 5 if the plan sample per row is 5, else 1).
* **Insufficient data:** `n < qms.capability_min_samples (25)` or all values identical (σ = 0) → verdict `'Insufficient Data'`, indices `null`.
* **σ within:** if `m = 1`: `σw = MR̄ / 1.128` where `MR̄` = mean of `|x[i] − x[i−1]|` over the `n − 1` consecutive differences. If `2 ≤ m ≤ 10`: form consecutive subgroups of `m` (drop the incomplete last one), `σw = R̄ / d2(m)` with `R̄` = mean subgroup range and `d2` = {2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326, 6: 2.534, 7: 2.704, 8: 2.847, 9: 2.970, 10: 3.078}.
* **σ overall:** sample standard deviation with `n − 1`.
* `Cp = (USL − LSL) / (6σw)` (only with both limits); `CPU = (USL − x̄)/(3σw)`, `CPL = (x̄ − LSL)/(3σw)`; `Cpk = min(available of CPU, CPL)`. `Pp`, `Ppk` identical with `σo`. All rounded half-up to **2 decimals when displayed, 3 stored**.
* **Verdict** (by `Cpk`): `≥ 1.67` → `Capable`; `≥ 1.33` and `< 1.67` → `Conditionally Capable`; `< 1.33` → `Not Capable` (cut-offs from `qms.cpk_targets`; the commonly used AIAG values — customers may require others, see Sources).
* **Worked example A (summary):** LSL 9.90, USL 10.10, `x̄ = 10.02`, `R̄ = 0.10`, `m = 5` → `σw = 0.10 / 2.326 = 0.042992`; `Cp = 0.20 / (6 × 0.042992) = 0.775 → 0.78`; `CPU = 0.08 / 0.128976 = 0.620 → 0.62`; `CPL = 0.12 / 0.128976 = 0.930 → 0.93`; `Cpk = 0.62` → `Not Capable`.
* **Worked example B (test vector):** 25 individuals (`m = 1`) alternating `10.00, 10.10, 10.00, …` (13 × 10.00, 12 × 10.10); LSL 9.80, USL 10.20. `x̄ = 10.048`; `MR̄ = 0.10` → `σw = 0.10/1.128 = 0.088652`; `σo = sqrt(0.0624/24) = 0.050990`. `Cp = 0.40/0.531912 = 0.752 → 0.75`; `CPU = 0.152/0.265956 = 0.5715 → 0.57`; `CPL = 0.248/0.265956 = 0.9325 → 0.93`; `Cpk = 0.57`; `Pp = 0.40/0.305941 = 1.307 → 1.31`; `PPU = 0.152/0.152971 = 0.9937 → 0.99`; `PPL = 0.248/0.152971 = 1.621`; `Ppk = 0.99`.
* **Ticket:** T-QMS-11 (math), T-QMS-20 (study endpoint).

### BR-QMS-20 In-process hold, release and defect escalation
* On completing an `IN_PROCESS` inspection with `result = 'NG'` (any required NG, or `defective_count ≥ re` when a sampling plan applies) → `hold_status = 'On Hold'`, status `On Hold`. Production orders are free text now; Manufacturing later reads `hold_status` through `GET /qms/holds?productionOrderRef=`.
* `release_hold` (permission `approve`, `reason` ≥ 10 chars): allowed when the auto-NCR exists and `coveredQty = holdQty` **or** a re-inspection linked through `rework_request_id` was Completed with `rejected_qty = 0`; sets `hold_status = 'Released'`, status `Completed`. Otherwise `QMS_HOLD_NOT_CLEARED` 409.
* **Escalation:** when the same `item_id` + `operation_name` + `characteristic name` has `qms.escalation_consecutive_ng` (3) consecutive Completed inspections (ordered by `inspected_at`) each with ≥ 1 NG on that characteristic, create one NCR severity `Major`, source `In-Process`, problem "Repeated NG on <characteristic> in <operation> (3 inspections)", reference = the newest inspection code; one per streak (the streak is keyed by the oldest inspection id in `header_data.escalationKey`; a repeat call is a no-op).
* **Ticket:** T-QMS-20.

### BR-QMS-21 Final inspection: checklist score, test result, release certificate, final yield
* `checklistScore = round2(100 × OK_or_NF / (CHECKLIST rows − NA))` over sample 1 rows of `CHECKLIST` characteristics (0 rows → `null`). Example: 10 checklist rows, 1 NA, 8 OK, 1 NG → `100 × 8 / 9 = 88.89`.
* `test_result = 'Fail'` if any required result is `NG`; `'Pending'` while any is `PEND`; else `'Pass'`.
* Decision `Accept` is allowed only when `test_result = 'Pass'`; it generates `certificate_no` (key `qms-final:cert`, `RCT/U3/26-27/0001`) exactly once; `Accept Under Deviation` generates a certificate marked "Under deviation" and needs the deviation approver. A later `reopen` voids the certificate: `certificate_no` is kept, `header_data.certificateVoided = true`.
* `finalYield = accepted_qty / lot_qty × 100` (2 dp). A final-inspection `Accept` is the **release for dispatch**: `GET /qms/final-release?itemId&batchSerial` returns `{released: boolean, certificateNo, inspectionId}` for the Sales plan (port `QmsReleasePort`).
* **Ticket:** T-QMS-21.

### BR-QMS-22 ISIR / first-article inspection
* One `ISIR` inspection = one item at one drawing revision (`drawing_rev` required), `sampleCount` samples (default 5, max 10, `header_data.sampleCount`), result rows = dimensions × samples. Characteristic fields map to the client's columns: Zone/Item → `zone_item`, Description → `name`, Dimension Specification → `spec_text`, Tolerance → `tolerance_text` (and `lsl/usl`), Measuring Method → `method`, Measured Dimension 1..5 → `measured_value` of `sample_no` 1..5, OK / NOT OK → `result`.
* `dimensionalStatus = 'ACCEPTED'` iff every required `MEASURED` result of every sample is `OK` (else `'REJECTED'`); stored in `header_data.dimensionalStatus` on completion; `result` = `OK`/`NG` accordingly.
* Approval (action `approve`, permission `approve`): reviewer ≠ inspector (`QMS_FOUR_EYES`), sets `header_data.reviewedByName/reviewedOn`; only an approved ISIR counts for the "Customer Requirement" tab of `qms-final`.
* A new revision of the drawing needs a new ISIR (no edit of an approved one; BR-QMS-25).
* **Ticket:** T-QMS-21.

### BR-QMS-23 Inspection plan revision control
* Only a `Draft` plan can be edited (`QMS_PLAN_LOCKED` 409 otherwise). `approve` (permission `approve`, approver ≠ creator): needs ≥ 1 characteristic, every `MEASURED` with a limit, `effective_date` set; sets `approved_by_id/at`; in the same transaction the previously `Approved` revision of the same `code` becomes `Inactive` (only one Approved per code: DB index). `new_revision` clones an `Approved` or `Inactive` plan into a `Draft` with `revision + 1`, `supersedes_id`, all characteristics copied.
* **Plan selection** for a new inspection of kind K, item I, supplier S, date D (`selectPlan`): candidates = `Approved`, `effective_date ≤ D`, `inspection_kind = K`; rank 1: `item_id = I AND supplier_id = S`; 2: `item_id = I`; 3: `item_category = I.category AND supplier_id = S`; 4: `item_category = I.category`; 5: no item / no category; ties → higher revision, then later `approved_at`. None → `QMS_NO_PLAN` 422 ("No approved inspection plan covers this item. Choose a plan or ask Quality to create one.").
* On inspection creation the plan's characteristics are **copied into `inspection_results` rows** (frozen snapshot) together with `plan_id` and `plan_revision`; later plan revisions never change old inspections.
* **Ticket:** T-QMS-14, T-QMS-17.

### BR-QMS-24 Supplier quality score, rating, SCAR trigger
* Period `P` (month), unit `U`, supplier `S`. Base = Completed `INCOMING` inspections with `doc_date` in `P`.
  `lotsReceived = count`, `lotsRejected = count(decision = 'Reject')`, `qtyReceived = Σ lot_qty`, `qtyRejected = Σ rejected_qty`, `ppm = qtyRejected / qtyReceived × 1e6` (2 dp), `ppmGrade` per BR-QMS-05, `ncrCount` = NCRs of S with `doc_date` in P, `scarOpen` = SCARs of S with status Open / In Process.
* `qualityScore = clamp(100 × (1 − ppm / Z), 0, 100)` with `Z = qms.supplier_ppm_zero_point` (10000) → 2 dp. (PPM 1000 → 90.00; 2400 → 76.00; ≥ 10000 → 0.00.)
* `otifPct` from `OtifPort` (null when Plan 03 cannot give it). `auditScore` = score of the latest Completed `supplier_audits` of S with `doc_date ≤ period end` and within 12 months, else null.
* `overallRating = Σ(w_i × score_i) / Σ(w_i)` over the components that are not null, weights `qms.supplier_weights` (quality 0.5, otif 0.3, audit 0.2) → 2 dp. `ratingGrade`: `≥ 85 → A`, `≥ 70 → B`, `≥ 50 → C`, else `D` (`qms.supplier_grade_cuts`).
* **Worked example:** received 5000, rejected 12 → ppm 2400.00, qualityScore 76.00, OTIF 92.00, audit 80.00 → `0.5×76 + 0.3×92 + 0.2×80 = 38.00 + 27.60 + 16.00 = 81.60` → grade `B`, ppmGrade `B`. Without an audit score: `(0.5×76 + 0.3×92)/(0.5+0.3) = 65.60/0.8 = 82.00`.
* `compute` recalculates a `Draft` row (idempotent, one row per unit+supplier+month); `approve` freezes it (`Approved` rows are never recomputed; a correction is a new `Draft` after `reopen` by an approver).
* **SCAR trigger:** on `approve`, if `ppm > qms.scar_ppm_trigger (5000)` or the supplier has a Critical NCR in the period → create one SCAR (`capa_type = 'Supplier (SCAR)'`, `customer_ref = 'AUTO-SQS:' || period code`; a second approve finds it by that key and does nothing), owner = the approver.
* **Ticket:** T-QMS-11, T-QMS-26.

### BR-QMS-25 Statuses, permissions, four-eyes
| Document | Transitions (action key → needs permission) |
|---|---|
| Inspection plan | `Draft → Approved` (`approve` → approve; approver ≠ creator), `Approved → Inactive` (`deactivate` → approve), `new_revision` (→ add) |
| Inspection | `Draft → In Process` (`start` → edit), `In Process → Completed / On Hold` (`complete` → edit; computes result/recommendation), `decide` (→ edit; `Accept Under Deviation` → approve and approver ≠ `decided_by` of the inspector rule below), `On Hold → Completed` (`release_hold` → approve), `Completed → In Process` (`reopen` → delete), `Draft/In Process → Cancelled` (`cancel` → delete, reason) |
| NCR | per BR-QMS-08; `close`, `reopen` → approve; `cancel` → delete |
| CAPA | `start`, `complete`, `record_effectiveness` → edit (early → approve), `close` → approve, `cancel` → delete |
| 5-Why | `complete` → edit, `close` → approve |
| Calibration record | `Draft → Completed` (`complete` → edit), `Cancelled` (→ delete; not allowed once it changed the instrument unless reversed by a later record) |
| Instrument | `block`, `unblock` → approve; `retire` → delete |
| Supplier period | `compute` → edit, `approve` → approve, `reopen` → approve |
* **Four-eyes** (error `QMS_FOUR_EYES` 403, can be turned off with `qms.four_eyes=false`): plan approver ≠ plan creator; deviation approver ≠ the user who made the inspection (`inspector_id`); scrap approver ≠ `created_by_id`; CAPA closer ≠ CAPA owner; ISIR reviewer ≠ inspector; NCR `Use As Is` approver ≠ NCR owner.
* Edits are blocked (`RECORD_LOCKED` 409, existing code) on: Approved plans, Completed inspections, Closed NCR/CAPA/5-Why, Completed calibration records, Approved supplier periods. Corrections are made by `reopen` or a new revision, never by editing.
* All writes need a concrete unit (`requireConcreteUnit`), `If-Match` version (`VERSION_CONFLICT` 409), an audit row, and respect the module controls (`allow_add/edit/delete/export`) and data scope.
* **Ticket:** T-QMS-12 (state machine helper), used by every service ticket.

### BR-QMS-26 Visual weld (VT) and weld before/after reports
* `VT`: characteristics = the plan's flaw list (34 rows seeded); the inspector sets `OK/NG/NA/NF` per row (sample 1; one row per weld joint when "per joint" is chosen: then `sample_no` = joint index and `header_data.weldSrNo` is per joint — default is one report per weld). Report `result = 'NG'` if any `NG`. Header defaults: `applicableCode = 'DIN EN ISO 5817 CLASS B'`, `testStandard = 'VT (ISO 17637:2016)'`; the quality level (B/C/D) is a plain text/enum chosen by the user (not evaluated). `gaugeSrNo` must be the code of an instrument (BR-QMS-17 applies; a free text that matches no instrument gives a warning only).
* `WELD_BEFORE_AFTER`: result rows 1–3 fit-up, 4–5 before-welding (wire spool TC/lot is a text row), 6–11 after-welding (weld size & profile, spatter, undercut, surface porosity, surface crack, end crater). Quantities: `accepted_qty` (accepted as per the class), `rework_qty`, `rejected_qty` with the BR-QMS-03 invariant against `lot_qty`; `header_data.reworkedAcceptedQty ≤ accepted_qty` (pieces reworked and then accepted, shown separately on the print).
* NG weld → auto-NCR (BR-QMS-07) with defect category `WELDING`.
* **Ticket:** T-QMS-21.

### BR-QMS-27 Numbering
Exactly the table in `06b` §5.3; one function; keyed series; gap-free under `FOR UPDATE`; a cancelled or soft-deleted document keeps its number; numbers are never reused (foundation lesson 9). **Ticket:** T-QMS-12.

### BR-QMS-28 Attachments
* ≤ 10,485,760 bytes (`PAYLOAD_TOO_LARGE` 413), ≤ 20 per entity (`QMS_TOO_MANY_FILES` 422). Allowed types: JPEG, PNG, WebP, PDF, CSV, XLSX — **checked by magic bytes** (`FFD8FF`, `89504E47`, `52494646…57454250`, `25504446`, `504B0304` for XLSX; CSV must be valid UTF-8 text without NUL bytes), not by the declared type alone (`QMS_FILE_TYPE` 422). SVG / HTML / scripts are refused.
* Stored under `QMS_UPLOAD_DIR/<yyyy>/<attachmentId>`; original name only in the DB (sanitised: strip path separators and control characters, max 200); SHA-256 stored; the same hash on the same entity is a duplicate → returns the existing row (no second copy).
* Download needs `view` on the owning page; delete is soft (`deleted_at`) and needs `edit`. Attachments of Closed documents cannot be added or removed except by `approve` users.
* **Ticket:** T-QMS-12.

### BR-QMS-29 Concurrency and idempotency
* Lock order inside a transaction: inspection → NCR → disposition → rework/scrap request → stock balances (the latter locked by `postMovement`). Never lock in another order.
* Every state-changing `POST … /actions/*` and `POST /qms/*` that moves stock or creates numbered documents accepts `Idempotency-Key` (existing helper); the same key with the same body replays the stored result, a different body → `409 CONFLICT`.
* Creating inspections from a GRN (`onGrnPosted`) is idempotent through `inspections_one_per_grn_line_idx`.
* **Ticket:** T-QMS-12, T-QMS-19.

### BR-QMS-30 Error codes (all new codes; HTTP status)
`QMS_LOT_OUT_OF_RANGE` 422 · `QMS_SAMPLE_TOO_LARGE` 422 · `QMS_TOO_MANY_RESULTS` 422 · `QMS_RESULTS_INCOMPLETE` 422 · `QMS_DECISION_CONFLICT` 422 · `QMS_DECISION_INCOMPLETE` 422 · `QMS_QTY_MISMATCH` 422 · `QMS_NO_QC_WAREHOUSE` 422 · `QMS_TARGET_WAREHOUSE_REQUIRED` 422 · `QMS_REVERSAL_BLOCKED` 409 · `QMS_NO_PLAN` 422 · `QMS_PLAN_LOCKED` 409 · `QMS_INSTRUMENT_BLOCKED` 409 · `QMS_IMPACT_REVIEW_OPEN` 409 · `QMS_CAL_ORDER` 422 · `QMS_CAL_RESULT_CONFLICT` 422 · `QMS_DATE_FUTURE` 422 · `QMS_DISPOSITION_QTY` 422 · `QMS_ASIS_FORBIDDEN` 422 · `QMS_SUPPLIER_REQUIRED` 422 · `QMS_RTS_NEEDS_GRN` 422 · `QMS_CAPA_REQUIRED` 409 · `QMS_REWORK_QTY` 422 · `QMS_REWORK_INCOMPLETE` 409 · `QMS_REINSPECTION_REQUIRED` 409 · `QMS_SCRAP_COST_REQUIRED` 422 · `QMS_D1_TEAM` 422 · `QMS_D2_INCOMPLETE` 422 · `QMS_D3_MISSING` 422 · `QMS_D4_INCOMPLETE` 422 · `QMS_D6_PENDING` 422 · `QMS_D7_MISSING` 422 · `QMS_D8_MISSING` 422 · `QMS_EFFECTIVENESS_TOO_EARLY` 409 · `QMS_FOUR_EYES` 403 · `QMS_WHY_GAP` 422 · `QMS_ROOT_EQUALS_PROBLEM` 422 · `QMS_HOLD_NOT_CLEARED` 409 · `QMS_CAPABILITY_DATA` 422 · `QMS_TOO_MANY_FILES` 422 · `QMS_FILE_TYPE` 422 · `QMS_NOT_SUPPORTED` 422. Existing codes reused: `VALIDATION_ERROR`, `VERSION_CONFLICT`, `NOT_FOUND`, `FORBIDDEN`, `RECORD_LOCKED`, `INSUFFICIENT_STOCK`, `CONTEXT_INVALID`, `DUPLICATE`, `PAYLOAD_TOO_LARGE`, `CONFLICT`.

## 7. API design

Base: `/api/v1`. All routes: `authenticate`, `requirePasswordChanged`, `resolveContext` (unit + FY), then the permission shown. JSON in/out; dates `YYYY-MM-DD`; money / qty as JSON **numbers** with scale 2/3 in responses (like existing code `num()`), and accepted as numbers or numeric strings in requests (parsed with `Decimal`). Pagination `?page=&size=` (size ≤ 100). Lists are filtered by unit + FY context and data scope.

### 7.1 The ten typed pages (standard routes — already exist)
The ten pages are registered in `TYPED_PAGES` (`engine/kinds.ts`) and answered by `typedHandlerFor(pageId)`; the existing routes serve them: `GET /pages/:pageId/schema`, `GET|POST /pages/:pageId/records`, `GET|PATCH|DELETE /pages/:pageId/records/:id`, `POST …/:id/restore`, `POST …/:id/actions/:action`, `GET …/records/export.xlsx`, `GET /pages/:pageId/audit`. The page machinery that QMS needs but does not own is built once in `07-ENGINE-KIT.md` (decision D-07): `tabPanels` and the panel section types, header `commands`, `requires = add|edit|delete|approve`, typed filters, the action `payload`, widened `lookup` kinds and the print-template registry. QMS tickets depend on the relevant `T-KIT-xx` and only add: (a) the ten `TypedSchema` definitions, (b) the QMS panel builders (06a section 2), (c) the QMS lookup registrations — `suppliers`, `customers`, `users`, `instruments`, `defects`, `ncrs`, `capas`, `inspections`, `plans`, `fivewhys` (kinds that the kit already provides are reused, the rest are registered by QMS through the kit's lookup registry), `GET /lookups/<name>?q=&limit=` with `view` on the owning page — and (d) the QMS print components. The typed filters QMS uses on its list queries are passed through the kit's filter mechanism: `kind`, `supplierId`, `itemId`, `severity`, `decision`, `result`, `holdStatus`, `from`, `to`, `overdue`, `dueSoon`, `calState`, `capaType`, `period` (`YYYY-MM`). The list `data` of every row has the camelCase field keys of section 2 (frozen first, `[ADD]` after).

**Actions per page** (keys used in `schema.actions`; `payload` shapes in 7.2):
| Page | Actions (allowedFrom) |
|---|---|
| `qms-plans` | `approve` (Draft), `new_revision` (Approved, Inactive), `deactivate` (Approved) |
| `qms-incoming` / `qms-process` / `qms-final` / `qms-inspections` | `start` (Draft), `complete` (In Process), `decide` (`In Process`, `On Hold`), `release_hold` (On Hold), `reopen` (Completed), `cancel` (Draft, In Process), `approve_isir` (Completed, kind ISIR only) |
| `qms-ncr` | `close` (Completed), `reopen` (Closed), `cancel` (Open), `raise_capa`, `raise_5why` (Open, In Process, Completed) |
| `qms-capa` | `start` (Open), `complete` (In Process), `record_effectiveness` (Completed), `close` (Completed), `cancel` (Open, In Process) |
| `qms-5why` | `complete` (Open, In Process), `close` (Completed), `push_to_capa` (Completed) |
| `qms-calibration` | `block`, `unblock` (Blocked), `retire` (Active, Blocked), `calibrate` (opens a record Draft) |
| `qms-supplier` | `compute` (Draft), `approve` (Draft), `reopen` (Approved), `raise_scar` (Draft, Approved) |

### 7.2 Extension endpoints under `/qms` (router `modules/qms/routes.ts`; permission = page action in brackets)

**Plans and sampling** (`qms-plans`)
| Method + path | Perm | Request → response |
|---|---|---|
| `GET /qms/plans/:id/characteristics` | view | → `{rows:[{id, lineNo, name, charType, charClass, zoneItem, specText, nominal, lsl, usl, toleranceText, uom, method, instrumentType, requiresInstrument, frequencyText, sampleRule, sampleFixed, samplePerN, reactionPlan, controlPlanRef, isoRef, defectId, isRequired}]}` |
| `PUT /qms/plans/:id/characteristics` | edit | `If-Match` plan version; body `{rows:[…same shape without id…]}` (replace-all, Draft only, ≤ 300 rows) → `{plan, rows}`; errors `QMS_PLAN_LOCKED`, `VALIDATION_ERROR` (row index in `fields`) |
| `GET /qms/sampling-plans` / `GET /qms/sampling-plans/:id` | view | list / `{id, code, name, standard, aql, inspectionLevel, isDefault, status, version, rows:[{lotMin, lotMax, sampleSize, ac, re, codeLetter}]}` |
| `POST /qms/sampling-plans`, `PUT /qms/sampling-plans/:id` | add / edit | body = the same JSON; `PUT` replaces the rows, `If-Match`; errors `DUPLICATE`, `VALIDATION_ERROR` (overlap → `QMS_SAMPLING_OVERLAP` mapped to 422) |
| `POST /qms/sampling-plans/:id/actions/{activate\|deactivate\|set_default}` | approve | → plan |
| `GET /qms/sampling-lookup?lotQty=20&planId=<uuid>` | view | → `{lotSize:20, sampleSize:5, ac:0, re:1, codeLetter:null}` |
| `GET /qms/form-headers`, `PUT /qms/form-headers/:formCode` | view / approve | `{formCode,title,docNo,revNo,revDate,signatureLabels:[…]}` |

**Inspections** (permission = `can(kindPage, action) OR can('qms-inspections', action)`; `kindPage` per section 12 map)
| Method + path | Perm | Request → response |
|---|---|---|
| `POST /qms/inspections/from-grn` | add | `{grnLineId}` + `Idempotency-Key` → `{inspection}` (copies item, supplier, qty, batch, GRN no; selects the plan; sets sample from BR-QMS-01; creates result rows). Errors `QMS_NO_PLAN`, `QMS_LOT_OUT_OF_RANGE`, `NOT_FOUND` |
| standard `POST /pages/<kindPage>/records` | add | body keys of the page + `planId?`, `lotQty`, `targetWarehouseId?`, `headerData?` → creates a Draft inspection **and its result rows from the plan** |
| `GET /qms/inspections/:id/results` | view | → `{rows:[{id, lineNo, sampleNo, name, charType, charClass, specText, nominal, lsl, usl, uom, instrumentId, measuredValue, observedText, result, defectId, remark}], sample:{sampleQty, ac, re}}` |
| `PUT /qms/inspections/:id/results` | edit | `If-Match`; `{rows:[{lineNo, sampleNo, measuredValue?, observedText?, result?, instrumentId?, defectId?, remark?}]}` (partial upsert ≤ 500 rows) → `{updated, resultSummary:{ok,ng,pend,defectiveCount}}`; result of MEASURED rows is **computed by the server** (BR-QMS-04), client-sent `result` is honoured only for ATTRIBUTE/CHECKLIST. Errors `QMS_INSTRUMENT_BLOCKED`, `RECORD_LOCKED` |
| `POST …/records/:id/actions/complete` | edit | → inspection with `result`, `aqlResult`, `recommendation`, `reasons[]` |
| `POST …/records/:id/actions/decide` | edit / approve | `payload {decision, acceptedQty?, rejectedQty?, holdQty?, reworkQty?, reason?, deviationRef?, targetWarehouseId?}` + `Idempotency-Key` → `{inspection, decision, stockMoves:[…], ncr?}` |
| `GET /qms/inspections/:id/stock-moves` | view | → `{rows:[{moveKind, qty, fromWarehouse, toWarehouse, value, reversed}]}` |
| `POST …/actions/reopen` | delete | `payload {reason}` |
| `GET /qms/final-release?itemId=&batchSerial=` | view (`qms-final`) | → `{released, certificateNo, inspectionId, acceptedQty}` |
| `GET /qms/holds?productionOrderRef=` | view (`qms-process`) | → `{holds:[{inspectionId, code, itemId, holdQty}]}` |
| `POST /qms/capability-studies/compute` | edit (`qms-process`) | `{itemId, characteristicName, dateFrom, dateTo, subgroupSize, includeFinal?, lsl?, usl?}` → `{n, subgroupSize, mean, sigmaWithin, sigmaOverall, cp, cpk, pp, ppk, verdict, readings:[{at, value}]}` (not saved) ; `POST /qms/capability-studies` saves a Draft snapshot; `GET /qms/capability-studies?itemId=` |

**NCR** (`qms-ncr`)
| Method + path | Perm | Request → response |
|---|---|---|
| `GET /qms/ncrs/:id` | view | → NCR + `{containment:[…], dispositions:[…], costLines:[…], coveredQty, uncoveredQty, needsCapa, ageDays, overdue}` |
| `PUT /qms/ncrs/:id/containment` | edit | replace-all `{rows:[{scope, actionType, qty, responsible, doneOn, remark}]}` |
| `POST /qms/ncrs/:id/dispositions` | edit | `{disposition, qty, remark?, concessionRef?, rtsRef?}` → line; errors `QMS_DISPOSITION_QTY`, `QMS_ASIS_FORBIDDEN`, `QMS_SUPPLIER_REQUIRED` |
| `PATCH /qms/ncrs/:id/dispositions/:lineId` | edit | `{qty?, remark?, concessionRef?, rtsRef?}` while `Open` |
| `POST /qms/ncrs/:id/dispositions/:lineId/actions/{complete\|cancel\|approve_as_is}` | edit / approve | `complete` for Sort: `{qtyOk, qtyNg, hours?}`; for Return: `{rtsRef}` + `Idempotency-Key`; `approve_as_is` needs `approve` |
| `POST /qms/ncrs/:id/costs`, `DELETE /qms/ncrs/:id/costs/:lineId` | edit | manual lines only: `{costType, costDate, qty?, rate?, hours?, amount, basis}` (amount computed when qty×rate or hours×rate given) |
| `GET /qms/rework-requests?ncrId=`, `POST /qms/rework-requests/:id/log` | view / edit (`qms-ncr`) | log `{logDate, operatorName, hours, qtyReworked, materialCost, remark}` → request |
| `POST /qms/rework-requests/:id/actions/{start\|complete\|reinspect\|cancel}` | edit | `reinspect` → `{inspectionId}` |
| `GET /qms/scrap-requests?ncrId=`, `POST /qms/scrap-requests/:id/actions/{approve\|complete\|cancel}` | view / approve | `complete {unitCost?, salvageValue?, reason?}` + `Idempotency-Key` |
| `GET|POST|PATCH /qms/alerts`, `POST /qms/alerts/:id/actions/{close\|cancel}` | view/add/edit | Quality Alert (fields in 06a); files via attachments |
| `GET|POST|PATCH|DELETE /qms/defects`, `GET /qms/defect-categories` | view / approve | defect master (`approve` to change) |
| `GET /qms/monthly-inputs?year=2026`, `PUT /qms/monthly-inputs/:month` | view / approve | the Quality Monthly Data rows |
| `GET /qms/ncrs/export/rejection-register.xlsx?from&to&status` | export | the client's register layout (7.6) |

**CAPA / 8D / 5-Why** (`qms-capa`, `qms-5why`)
| Method + path | Perm | Request → response |
|---|---|---|
| `GET /qms/capas/:id` | view | → CAPA + `{team, containment, rootCauses, actions, gates:{start:[…missing…], complete:[…missing…]}}` (the gate lists are the messages of BR-QMS-13 not yet satisfied, so the UI can show what is missing) |
| `PUT /qms/capas/:id/team` · `/containment` · `/root-causes` | edit | replace-all arrays (shapes = columns in 06b §5.9) |
| `POST /qms/capas/:id/items` · `PATCH /qms/capas/:id/items/:actionId` · `DELETE …` | edit | D5/D6/D7 actions `{phase, actionType, description, responsible, responsibleUserId?, targetDate, doneDate?, status?, evidence?}` |
| `POST /qms/capas/from-ncr/:ncrId` | add | `{capaType?}` → capa (copies, links) |
| `GET /qms/capas/:id/report` | view | the data of the 8D print (7.7) |
| `POST /qms/five-why/from-ncr/:ncrId` · `from-capa/:capaId` | add | → case |
| meetings `GET|POST|PATCH /qms/meetings`, points `PUT /qms/meetings/:id/points`, actions `approve\|close\|cancel` | view/add/edit/approve (`qms-capa`) | fields in 06a |
| improvements `GET|POST|PATCH /qms/improvements`, `PUT …/actions-plan` | same | fields in 06a |

**Calibration** (`qms-calibration`)
| Method + path | Perm | Request → response |
|---|---|---|
| `GET /qms/calibration/schedule?from=&to=&unitId?` | view | → `{rows:[{instrumentId, code, name, nextDueDate, state, daysToDue, agency, notifyUser}]}` sorted by due date |
| `GET /qms/calibration/compliance` | view | → `{total, valid, dueSoon, overdue, notCalibrated, compliancePct}` |
| `POST /qms/calibration/sweep` | controls | runs `enforceCalibrationBlocks` → `{blocked: n}` |
| `POST /qms/calibration-records` | add | `{instrumentId, calibrationDate, performedBy, agency?, certificateNo?, certificateDate?, accreditationNo?, referenceStandard?, uncertaintyText?, result, asFoundText?, asLeftText?, cost?, points:[{nominal, asFound, asLeft, tolerance, uom}]}` → record (Draft) with computed point results |
| `POST /qms/calibration-records/:id/actions/{complete\|cancel}` | edit | `complete` updates the instrument (BR-QMS-16/17/18) → `{record, instrument, impactReviewId?}` |
| `GET /qms/impact-reviews/:id`, `PATCH /qms/impact-reviews/:id/items/:itemId`, `POST /qms/impact-reviews/:id/items/:itemId/raise-ncr`, `POST /qms/impact-reviews/:id/actions/close` | view / edit / approve | item `{action, remark}` |
| instrument import `POST /qms/instruments/import` | add | JSON rows in the client's column names (see Appendix A.8) → `{created, skipped, derived, errors:[{row, message}]}` (dry run with `?dryRun=true`) |

**Supplier quality** (`qms-supplier`)
| Method + path | Perm | Request → response |
|---|---|---|
| `POST /qms/supplier-periods/compute` | edit | `{month:'2026-09', supplierId?}` (no supplier = all suppliers with inspections that month) → `{rows:[period]}` |
| `GET /qms/supplier-scorecard?supplierId=&months=12` | view | → `{supplier, months:[{period, ppm, qualityScore, otif, auditScore, overallRating, grade}], trend}` |
| audits `GET|POST|PATCH /qms/supplier-audits`, `PUT /qms/supplier-audits/:id/findings`, `POST …/actions/{complete\|cancel}` | view/add/edit | fields in 06a |

**Attachments** (any owning page)
| Method + path | Perm | Request → response |
|---|---|---|
| `POST /qms/attachments?entityType=&entityId=&fileName=&caption=` | edit on owning page | raw body (`Content-Type: application/octet-stream`, ≤ 10 MB, `express.raw` on this route only) → `{id, fileName, mimeType, sizeBytes, sha256, caption}` |
| `GET /qms/attachments?entityType=&entityId=` | view | list |
| `GET /qms/attachments/:id/download` | view | the file with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` |
| `DELETE /qms/attachments/:id` | edit | soft delete |

**Reports / KPIs** (permission `view` on the page named; all accept `unitId` (via context), `from`, `to`): `GET /qms/reports/kpis`, `/fpy`, `/ppm`, `/pareto`, `/rejection-trend`, `/copq`, `/ncr-aging`, `/capa-aging`, `/calibration-compliance`, `/eight-d-cycle`, `/supplier-ranking`, `/rework-register` — definitions and response shapes in section 8.

**Print data** `GET /qms/print/:formCode/:id` (view on the form's page; `formCode` from 06b §5.14) → `{header:{title, docNo, revNo, revDate, company, unit, letterhead}, data:{…form-specific…}, signatures:[labels]}`; the web renders the layout (7.7). `GET /qms/print/RE​WORK_REG` takes `?from&to&status` instead of an id.

### 7.3 Typed-page definitions (`modules/qms/definitions.ts`)
Same shape as `modules/inventory/definitions.ts` (`TypedSchema`, helper `f/text/select/qty/money/date`, `define(...)`): one `TypedSchema` per page; `fields` = frozen fields **in registry order** followed by `[ADD]` fields; `listColumns = fields.slice(0,12)` (frozen fields only — the frozen lists have 11–13 fields; for the 13-field `qms-incoming` page the 13th (`Status`) is shown; the helper `slice(0,12)` is **replaced for QMS pages by an explicit `listColumns` array** in the definition equal to the frozen labels' keys, max 12). Field keys, types, required flags, options and the `[ADD]` fields are the tables in `06a` section 2 — **the builder copies them from there, not from memory**. Common option lists (constants in `modules/qms/constants.ts`):
* `INSPECTION_TYPES = ['Incoming','In-Process','Final','First Article (ISIR)','Visual Weld (VT)','Weld Before/After','Layout / Dimensional']` mapped to kinds `INCOMING,IN_PROCESS,FINAL,ISIR,VT,WELD_BEFORE_AFTER,LAYOUT`.
* `NCR_SOURCES = ['Incoming Inspection','In-Process','Final Inspection','Customer Complaint','Internal Audit','Supplier Audit','Process Deviation','Calibration','Other']`; `NCR_DISPOSITIONS = ['Use As Is','Rework','Scrap','Return To Supplier','Sort','Mixed']`; `SEVERITIES = ['Critical','Major','Minor']`; `DECISIONS = ['Pending','Accept','Accept Under Deviation','Reject','Hold']`; `RESULTS = ['OK','NG','Pending']`; `TEST_RESULTS = ['Pass','Fail','Pending']`; `HOLD_STATUSES = ['None','On Hold','Released']`; `CAL_FREQUENCIES = ['30 days','90 days','180 days','365 days','730 days','Custom']`; `CAL_RESULTS = ['Pass','Fail','Pass After Adjustment']`; `EFFECTIVENESS_RESULTS = ['Pending','Effective','Not Effective']`; `ITEM_CATEGORIES` = the distinct `items.category` values (a lookup, free text allowed).
* The registry's default enum for `Severity` is `Low/Medium/High/Critical`; QMS pages define their own `options`, and `PAGE_ENUM_OVERRIDES` gets `'qms-ncr': {Severity: [...SEVERITIES]}` so that `field-types.json` stays valid.
* Filters per page (the "Filters" lines in 06a); totals per page (the "Totals" lines in 06a); views (`views[]`) are the tab views of 06a that the generic list can show (`key`, `label`, `columns`).

### 7.4 Excel export in the client's layouts
Besides the standard `records/export.xlsx` (frozen columns), these **client-layout** workbooks are produced with `exceljs` (`modules/qms/exports/*.ts`), one worksheet each, same column titles and order as the client sheets (Appendix A), header block rows on top (company, form title, Doc No / Rev No / Rev Date from `qms_form_headers`), then the table, then "Prepared By / Reviewed By" row:
| File | Endpoint | Sheet columns |
|---|---|---|
| Rejection / Rework Register | `GET /qms/ncrs/export/rejection-register.xlsx` | `Sr no, Date, Process Name, Operator /Fitter Name, Part Name, Part No, HOLD QTY, Defect, Defect Type, Root Cause, Corrective Action Taken, Responsibility, REWORK QTY, REJECT QTY, Closing Date, Status` + summary sheets `Summary` (customer complaint count, dispatched qty, issue reported, % rejection, closed / open, by defect category, part-wise defect qty) and `PPM Monitor` (`Month, Customer, Project, Produced Qty, Rejected Qty, Customer Rej Qty, Internal PPM, Customer PPM, Target PPM, Status`), `Quality Cost Monitor` (`Month, Sales Value, Prevention Cost, Appraisal Cost, Internal Failure Cost, External Failure Cost, Total Quality Cost, Quality Cost %`), `COPQ Summary` (`Scrap Cost, Rework Cost, Customer Returns, Warranty/Field Failures, Sorting Cost, Penalty Cost, Total COPQ`) |
| Incoming inspection register | `GET /qms/inspections/export/incoming.xlsx` | `Sr No, Date, Supplier Name, Invoice No, Item Description, Material Grade/Spec, Heat/Batch No, Thikness, Width, Length, Total Qty, Accp/Qty, Rej/Qty, MTC Status, Remark` (the client's spelling "Thikness" is **kept** in this export only, flagged in the file header note) |
| Incoming inspection data sheet | `…/incoming-detail.xlsx` | the 45 columns of the client's "Incoming Inspection" data sheet (Appendix A.1) |
| Instruments list | `GET /qms/instruments/export.xlsx?unit=` | `Sr No, Division, History Card No, Equipment Name, Equipment No, Equipment Range / Specification, Least Count, Part Name, Validity, Source of Calibration, Calibration Frequency, Manufacturer Name, Analog/Digital, Purpose of Equipment, Model No., Equipment Location, Commissioning Date, Equipment Status, Notify To, Calibration Agency` (one sheet per unit) |
| Supplier scorecard | `GET /qms/supplier-scorecard/export.xlsx` | the frozen `qms-supplier` columns |
All use the request's unit context, `export` permission of the page, and refuse more than 50,000 rows (`VALIDATION_ERROR`).

### 7.5 Documents (print layouts) — see 7.7 for the list.

### 7.6 Notifications
`notifyUser(userId, text)` (stub logging to the pino logger and writing an `audit_logs` row `qms.notify`) is called for: calibration due soon (daily, once per instrument per due date), instrument blocked, NCR / CAPA overdue (once per day), CAPA action due in 2 days, deviation approval requested. Phase 6 replaces the stub.

### 7.7 Print templates (PDF through the browser's Print, like the prototype)
The existing app prints with the browser (`Print` / `Letterhead PDF` buttons); QMS adds **one React print component per client form** in `apps/web/src/pages/qms/print/` that renders the form from `GET /qms/print/:formCode/:id`, uses the letterhead settings, A4, `@media print` CSS in the existing print stylesheet (no new CSS framework; new class names prefixed `qp-`). Each form's exact header block and table columns are in `06a` section 2.11 ("Document templates") and Appendix A; the 15 `formCode`s are those of 06b §5.14.

## 8. Reports and KPIs

All reports are SQL aggregates over live (not deleted, not cancelled) data in the request's unit context (or all units for ADMIN+ "All units"), filtered by `from`/`to` (inclusive dates; default = current FY). Money 2 dp, quantities 3 dp, percentages 2 dp half-up, PPM integer-rounded in the UI. A report row with a zero denominator returns `null`.

| # | Report (endpoint) | Exact definition | Response |
|---|---|---|---|
| 1 | **KPIs** (`/kpis`) — the four department KPI cards (PLAN.md §2 "Quality") | `firstPassYield` = `(Σ inspected_qty − Σ rejected_qty − Σ rework_qty) / Σ inspected_qty × 100` over Completed `IN_PROCESS` and `FINAL` inspections in range; `openCriticalNcr` = count of NCR with `severity='Critical'` and status Open / In Process / Completed; `capaOverdue` = count of CAPA with `today > target_date` and status Open / In Process; `calibrationDue` = instruments with state `Due Soon` or `Overdue` | `{firstPassYield, openCriticalNcr, capaOverdue, calibrationDue}` |
| 2 | **First-pass yield** (`/fpy?groupBy=item\|process\|month`) | per group: `inspected`, `rejected`, `rework`, `fpy = (inspected − rejected − rework)/inspected×100`; plus `rolledThroughputYield = Π fpy_i/100` over the operation steps of one item (`groupBy=process` within one `itemId`) | rows |
| 3 | **PPM** (`/ppm?by=supplier\|item\|defect\|customer\|month`) | supplier / item: `Σ rejected / Σ received × 1e6` of Completed INCOMING; defect: NCR `reject_qty + rework_qty` per defect over the same base; customer / month (client "Internal PPM", "Customer PPM"): internal = `Σ NCR reject_qty (+ rework) / produced × 1e6`, customer = `customer_rej_qty / dispatched × 1e6` from `quality_monthly_inputs`; each row also `target` (`ppm_target`) and `status` = `Within Target` when ppm ≤ target else `Above Target` | rows + `ytd` computed from sums (BR-QMS-05 note) |
| 4 | **Defect Pareto** (`/pareto?by=category\|defect\|process\|part`) | NCR quantity (`hold_qty`) grouped; sorted desc; `cumulativePct` = running share of the total (2 dp); the `vital80` flag marks rows until cumulative ≥ 80 % | rows |
| 5 | **Rejection trend** (`/rejection-trend?interval=month`) | per month: `rejectedQty`, `receivedOrProducedQty`, `rejectionPct`, `ncrCount`, `closedCount`, `openCount` (the client's Summary Sheet block) | rows |
| 6 | **COPQ** (`/copq?groupBy=month\|unit\|ncr`) | BR-QMS-12 per group, with `internalFailure`, `externalFailure`, `copq`, `appraisal`, `prevention`, `totalQualityCost`, `qualityCostPct`; the `ncr` grouping lists the top 20 NCR by cost | rows |
| 7 | **NCR ageing** (`/ncr-aging`) | open NCR (status Open / In Process / Completed) counted by `ageDays` bucket `0–7`, `8–15`, `16–30`, `>30` × severity; `overdue` count; average age of closed NCR in range | matrix |
| 8 | **CAPA ageing and 8D cycle time** (`/capa-aging`, `/eight-d-cycle`) | open CAPA by age buckets; overdue CAPA; `cycleDays = closed_at::date − doc_date` per closed CAPA; `avgCycleDays`, `medianCycleDays`; effectiveness pass rate = `Effective / (Effective + Not Effective)` over rounds recorded in range | rows |
| 9 | **Calibration compliance** (`/calibration-compliance`) | `compliancePct = (valid + dueSoon) / (total − inactive) × 100` where state per BR-QMS-16 evaluated at `today`; list of overdue and due-in-30-days instruments with days; calibrations done in the range, on time (`doc_date ≤ due_before`) vs late; out-of-tolerance count and open impact reviews | summary + rows |
| 10 | **Supplier ranking** (`/supplier-ranking?month=`) | the Approved `supplier_quality_periods` of the month ordered by `overall_rating` desc; supplier trend of the last 6 months | rows |
| 11 | **Rework register** (`/rework-register`) | the client register rows (one per NCR) in the client's column order with `Status` = `OPEN` while the NCR is not Closed else `CLOSE`... (decision D-9: the web shows `Open` / `Closed`; the Excel export keeps the client's words `OPEN` / `CLOSE`) | rows |
| 12 | **Inspection analytics** (`/inspection-analytics`, tab "Inspection Analytics") | per kind: counts by status, accept / reject / hold split, average lot size, average days from `doc_date` to completion | rows |

**Dashboard KPIs of the `Module Dashboard` tab** (the four cards, in this order, replacing the generic four for the 10 QMS pages — PLAN.md §2 department table): `First-pass yield` (report 1), `Open NCR (critical)`, `CAPA overdue`, `Calibration due`.
