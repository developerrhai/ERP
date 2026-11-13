# PHASE-14 REPORT — Maintenance and Assets (built to `docs/phases/PHASE-14.md`)

Built 2026-11-09. Local only: nothing pushed, nothing deployed, nothing committed. Migrations `20261126000000_phase14_asset_masters`, `…010000_maintenance`, `…020000_asset_docs`, `…030000_depreciation`, `…040000_seed_rates`, `…050000_disposal_gst_split`, applied to `rhai_erp` (dev) and `rhai_erp_test`. The spec file names the first five; the sixth adds one column (CGST+SGST or IGST on a sale).

## 1. What was built
One asset spine: **one physical object = one row in `assets`**. Machine Master, Equipment Master and Asset Master are three views of it; the book value is never stored but read from the view `v_asset_book_value`.

| Page | What it does |
|---|---|
| `maint-machines`, `maint-equipment` | Lists of machines / equipment (parts belong to a machine through `parent_asset_id`, loops are refused by the database). The detail shows health, failures, MTBF, MTTR, availability, last and next service, meters and their readings, a QR label. |
| `maint-preventive` | PM plans by days, by meter, or whichever comes first, with checklists (OK / NOT OK, number with limits, text) and planned spares. |
| `maint-schedule` | What falls due; a daily job (02:45) and a button raise the PM work order once per due date. One open service per plan; cancelling or skipping a service moves the plan on. |
| `maint-breakdown` | Report → acknowledge (raises the work order, machine goes under maintenance) → start repair → repaired (failure mode / cause / mechanism codes are required) → close. The downtime clock starts at the report and stops at the repair. |
| `maint-workorders`, `asset-maintenance` | The same work orders: machines and equipment on one page, all other assets on the other. Approval, start, checks, spares issued from stock, labour, vendor charges, complete, sign-off. |
| `maint-spares` | Spare Part items with the Phase 8 stock of the unit (a view, not a second stock). |
| `maint-downtime` | Planned and unplanned stops, no overlap per asset (database trigger). They also feed the Phase 13 OEE of the work centre behind the machine. |
| `maint-mtbf`, `maint-alerts` | MTBF / MTTR / availability from logged events only; alerts for PM due and overdue (escalating), breakdowns nobody picked up, warranties ending, loans due back. |
| `asset-master` | Register with cost, depreciation and book value; categories with Schedule II life, method and residual; meters. |
| `asset-capitalization` | AS 10 cost lines (price, freight, installation, testing, fees); GST you claim stays out of the cost, GST that is blocked (or you choose) is added. Draft → approve → post: Dr asset account / Cr the source accounts. Sets the BOOK and TAX profiles. |
| `asset-allocation` | Hand-over and return, condition out and in, due-back date. |
| `asset-transfer` | Inside the unit changes the record. Between units posts both sides through the inter-unit clearing account (1308); the PM plans follow the asset. |
| `asset-depreciation` | **BOOK** (posts: Dr 6241 / Cr accumulated depreciation, per category) and **TAX** (memo: IT-Act block, opening + additions − sale, half rate under 180 days). Extra-shift factor for plant and machinery (+50 % double, +100 % triple, not for NESD). Months run in order; missed months are caught up. |
| `asset-disposal` | Sale / scrap / write-off / donation; gain or loss against the book value, GST on the sale (CGST+SGST or IGST), the s.18(6) figure as a memo. Revaluation and impairment are tables only; their methods answer NOT_IN_SCOPE. |
| `asset-qr` | QR labels (PDF), scans logged (valid or not), physical verification counts. |

The spares of a work order leave stock through the Phase 8 StockService and post in the same transaction: Dr maintenance expense (6211) / Cr inventory; a return comes back at the average of what is still out.

## 2. Database
Masters (`asset_categories`, `asset_category_book_params`, `it_blocks`, `it_block_rates`, `assets`, `asset_book_profile`, `meters`, `meter_readings`, `mfg_work_centres.asset_id`, the view) — maintenance (`failure_codes`, `checklist_templates` + items, `pm_plans` + spares, `pm_schedules`, `breakdown_tickets`, `maint_work_orders` + tasks / spares / labour / vendor charges, `downtime_events`, `alert_rules`, `alerts`) — asset documents (capitalisations + cost lines, allocations, transfers, shift usage, disposals, revaluation / impairment placeholders, QR labels, scans, physical verifications + lines) — depreciation (runs, lines, IT block ledger). A meter never reads lower unless flagged as a reset (trigger). Code changes outside the new module: account key `MAINT_EXPENSE` and the stock voucher types `MWO_ISSUE` / `MWO_RETURN`, a queue `assets.daily`, and the OEE report (downtime events).

## 3. Seeded rows (all flagged "to review" — confirm them before the first depreciation run)
Twelve categories with the Schedule II lives the spec names (factory building 30 y, RCC 60 y, general P&M 15 y, continuous process 25 y, computers 3 y, servers 6 y, furniture 10 y, office equipment 5 y, electrical 10 y, motor car 8 y, two-wheeler 10 y, heavy vehicle 8 y), method SLM, residual 5 %, mapped to the chart's existing asset and accumulated depreciation accounts. IT-Act rates ONLY for the four blocks the spec names (P&M 15 %, computers 40 %, furniture 10 %, buildings 10 %), under ITA1961 s.32 from 2014 and ITA2025 from 1-Apr-2026. Failure codes are a small ISO 14224-style starter list. Alert rules with default days.

## 4. Deviations and things you must decide
1. **Rates not in the spec.** Vehicles, electrical installations and office equipment have no IT block, because the spec's "…" names no rate. They are depreciated for the books only until you add the blocks (Depreciation › Rates).
2. **Motor cars and two-wheelers are marked "GST credit blocked"** (s.17(5)); their GST is added to the cost. Confirm per category.
3. **Separation of duties is not enforced.** One person can raise, approve and post an asset document or sign off their own work order (the owner works alone). Tell me if you want maker ≠ checker.
4. **s.18(6)** is shown on the disposal as a memo (the higher of the credit less 5 points per quarter and the tax on the sale, and the part beyond the tax charged). Nothing is posted for the extra amount; the way it is paid is a decision for you and your accountant.
5. **Vendor charges and labour** on a work order are recorded as cost on the order; they are not posted. Vendor invoices come through purchase invoices; wages through payroll.
6. **Depreciation** is posted at month end after the month has ended (the ledger refuses a future date). WDV uses the Schedule II formula rate (1 − (residual ÷ cost)^(1/life)), so it needs a residual above 0.
7. **Disposing of a part** of a machine (a component asset) is refused until the component is disposed of; a component cannot be capitalised separately from a purchase invoice automatically (you enter its cost lines).
8. No holiday-aware shift calendar (Phase 15). The "extra shift" days are typed per asset per month.
9. Lists show the newest 100 rows; the asset pickers in forms show the first 200 assets.
10. The IoT meter source exists in the table (`source`) but nothing writes it yet.

## 5. Test results
**The three clean runs required by STANDARDS were NOT done** (the machine is short of memory); each check ran once.
* Calculators `phase14-calc.test.ts` (hand-worked examples: SLM ₹6,242.01 for a month of a ₹12,20,000 plant, WDV rate 25.8866 %, shift factor 1.3333, AS 10 cost, s.18(6) ₹1,26,000, IT block ₹1,80,000 and closing ₹10,70,000): 11 of 11.
* API `phase14-assets.test.ts`: **20 of 20** (access; categories and the 5 % residual; component tree and loop refusal; capitalisation with GST and the ledger; book run posted once and reversed; extra shift; tax memo; allocation; transfer inside and between units; disposal with GST and s.18(6); QR scans, labels and verification; PM plan to work order once; spares issue and return with ledger; breakdown to repair and MTBF/MTTR; alerts; and the review regressions).
* Full API suite (before the review fixes): 76 files passed, 2 skipped; 1067 tests passed, 45 skipped, 0 failed. After the fixes the Phase 13 and 14 files were re-run (see the final line of the chat for the full-suite re-run).
* Web, full suite: 48 files, 400 tests passed, 29 skipped, 0 failed (`Assets.test.tsx`, 6 of 6). Web `tsc` and `eslint` clean for the new pages.
* e2e `phase14.spec.ts` (opens the 18 pages) was written but **not run**.
* Independent review (code-review, high): 10 findings, all fixed: second and later spare returns valued wrongly; a skipped or cancelled PM blocked the next one for ever (and a time+meter plan raised two jobs); plans of an asset moved to another unit broke the nightly job; depreciation months could be run out of order and lost the earlier month; a category's accounts could be changed after assets were booked; the spares view summed all units; a breakdown during a planned stop was refused; separation-of-duties comment claimed more than the code did; party accounts could not be posted for sale proceeds; owner-scope lists failed on tables without an owner column.

## 6. Known issues
* e2e not run; three clean runs not done (above).
* `package.json` formatting note of the repo lint is older than this phase.
* Older test files still list `tsc` errors outside Phases 13 and 14.

## 7. Owner check list (after deployment)
1. **Asset Master › Categories**: check the lives; click *Set life* to confirm one (the "To review" tag goes).
2. **Machine Master › New machine**: name, category *Plant and machinery (general)*; it starts in capital work in progress.
3. **Capitalisation › New**: pick the machine, price ₹12,00,000 + GST ₹2,16,000, freight ₹20,000, booked against an account; *Send for approval*, *Approve*, *Post*. The machine is Active with cost ₹12,20,000; the GST stays out of the cost.
4. **Depreciation › New run** (book, a finished month) → open it, check the days and amounts → *Post*. *Reverse* it with a reason. Then a run for *Income tax*: the block shows 15 %.
5. **Preventive Maintenance › New PM plan** (every 30 days, with a checklist) → **Maintenance Schedule › Raise due work orders now** → open the work order, *Start the job*, tick the checks, *Job is done*, *Sign off and close*.
6. **Breakdown Log › Report a breakdown** → *Acknowledge* → *Start repair* → *Repaired* (pick codes) → close the work order → *Close ticket*. **MTBF and MTTR** shows one failure.
7. **Maintenance Work Orders**: add a spare part, *Start*, *Issue* 2, *Return* 1; the cost shows and the ledger carries it.
8. **Asset Disposal**: sell an asset with GST; *Send for approval* → *Approve* → *Post*; the gain or loss and the s.18(6) note appear.
9. **QR and Verification**: print a label; type its code on *Scan*; start a count and tick the assets found.
