# PHASE-13 REPORT — Manufacturing, v2 (built to `docs/phases/PHASE-13.md`)

Built 2026-11-09. Local only until the owner deploys. Migrations `20261125000000_phase13v2_a_masters`, `…010000_b_planning`, `…020000_c_execution_costing`, `…030000_d_cleanup`, `…040000_e_widen_status` sit on top of the first build (`20261123…` and `20261124…`). They are applied to `rhai_erp` (dev) and `rhai_erp_test`.

This replaces the first Phase 13 build, which was written before the real spec was saved. The first build is deployed; this one is not yet.

## 1. What the spec asked for and where it is
| Spec | Where | State |
|---|---|---|
| Work centres with rates, shifts, calendar, OEE target | **Work Centers** `mfg-workcenters` (tabs: centres, calendars, downtime reasons, scrap reasons) | Built. Release of an order is refused until labour rate, overhead rate and cost centre are set (`WC_RATE_MISSING`). |
| BOM with approval, revisions, phantom, alternates, tree, cost roll-up, import | **Bill of Material** `mfg-bom` | Built. DRAFT → PENDING_APPROVAL → RELEASED → OBSOLETE; a released BOM is locked; *New revision*; default per item; loop check; explode, tree, cost roll-up snapshot, paste-in import. |
| Routing with queue/move time, QC flag | **Routing** `mfg-routing` | Built. Release, revise, obsolete. |
| Item planning (lead time, safety stock, lot sizing LFL / FIXED / EOQ) | `PUT /mfg/item-planning/:itemId` | Built (API). Screen: the Item Master carries the item; planning fields are edited through the API for now. |
| Production plans | **Production Planning** `mfg-plan` | Built: pull demand from sales orders, capacity check, material check, release, run MRP. The daily board and the capacity view stay as tabs. |
| MRP with pegging, buckets, exceptions, conversion | **MRP** `mfg-mrp` | Built. Runs on the job queue (inline when it is off); suggestions are firmed, ignored or converted (buy → one draft requisition, make → draft production order); bulk convert. |
| Production orders with approval, material issue, return, backflush | **Production Orders** `mfg-orders` | Built. Approval above `ORDER_APPROVAL_VALUE`; over-issue limit `OVER_ISSUE_PCT`; supervisors may go over it. |
| Job cards with time logs, pause reasons, OEE | **Work Orders** `mfg-workorders`, **Shop Floor** `mfg-shopfloor` | Built. Tablet view with big buttons, supervisor dashboard (OEE, rejection %, downtime, output by hour, overdue). Job card and traveller PDFs carry QR codes. |
| WIP, absorption, scrap, rework, FG receipt, close in the ledger | all of the above | Built (§2). |
| Cost sheet, variances, yield, plan adherence | **Production Costing** `mfg-costing`, **WIP Tracking** `mfg-wip` | Built. Variances are reported, not posted. |

## 2. The money
* Material issued or backflushed: **Dr WIP 1302 / Cr raw material 1301**. Return reverses it.
* Labour and overhead (logged hours × the work centre rates), at job card completion: **Dr WIP 1302 / Cr Overhead Absorbed 5116**.
* Normal scrap stays in the product cost. Abnormal scrap = quantity × (WIP ÷ order quantity): **Dr Scrap Loss 5109 / Cr WIP 1302**. Recovery goes back to stock at its value.
* FG receipt takes its share of WIP: **Dr finished goods 1303 / Cr WIP 1302**; the last piece takes the exact balance. An item that needs inspection is held in quality until the Usage Decision releases or blocks it.
* Close sweeps rounding (up to ₹1) or a zero-good order to Scrap Loss; otherwise `ORDER_HAS_OPEN_WIP`.
* The cost ledger cannot be changed (database trigger); WIP of an order = the sum of its ledger rows, and **WIP Tracking** compares the ledger with the general ledger.
* The spec's worked examples are tests: 100 motors → copper 82.000 kg; stator MRP table; OEE 0.7778; FG ₹476,760 ÷ 98 = ₹4,864.90; abnormal scrap 9,740.

## 3. Decisions and deviations
1. **Status words** keep the first build's labels: orders Planned / Pending Approval / Released / In Progress / Completed / Closed / Cancelled; BOM and routing DRAFT / PENDING_APPROVAL / RELEASED / OBSOLETE; job card Pending / In Progress / Paused / Done. The spec's tables map to `mfg_*` tables.
2. **Subcontracting / job work** is out of the spec's scope. An operation at an *Outside* work centre blocks release (`ORDER_OUTSIDE_OP_V1`). The first build's job-work registers and customer-challan rework stay as paperwork registers.
3. **Needs your decision** (seeded as "needs review", not guessed): the over-issue tolerance (5 %), the order-approval value and the scrap-approval value (both empty, so nothing waits). Set them in Work Centers › Settings (API: `PUT /mfg/settings/:key`).
4. Item planning has an API but no dedicated screen.
5. Lists show the newest 100 rows. Excel exports read at most 5,000 rows without saying so.
6. Employees' reads are refused for every manufacturing endpoint; shared reads (orders, reasons, settings) pass for anyone who can view any manufacturing page.

## 4. Test results
**The three clean runs required by STANDARDS were NOT done.** The machine is short of memory, so each check ran once.
* API, new file `phase13-v2.test.ts`: **12 of 12 pass** (access; BOM approval and loop refusal; explode and cost roll-up; routing release; order release, issue with replay, over-issue by a supervisor; job cards with time logs and an overlap refusal; scrap; partial and final FG receipt; WIP back at zero and ledger = general ledger; backflushed material cannot be returned; MRP from a plan with pegging, firm and convert; calendars, settings, OEE and shop-floor reads; PDFs and Excel; day board; job-work balances; approval limit; employee refusals). `phase13-calc.test.ts` (the spec's worked examples): 15 of 15.
* Full API suite on a freshly reset `rhai_erp_test`, before the review fixes: 74 files passed, 2 skipped; 1041 tests passed, 45 skipped, 0 failed. After the fixes the Phase 13 file was re-run (12 of 12).
* Web, full suite: 47 files passed, 394 tests passed, 29 skipped, 0 failed (`Mfg.test.tsx`, 7 of 7). Web `tsc` and `eslint` clean for the new pages.
* e2e `phase13.spec.ts` (opens all 13 pages) was updated for the new titles but **not re-run** in this round.
* Repo-wide `tsc` still lists errors in older test files (`kit-*`, `assert-can-post`, `phase06b`, `phase09-math`) that Phase 13 did not touch.
* Independent review (code-review, high): 10 findings, all fixed:
  1. Editing a draft BOM erased line data the form does not show (unit factor, dates, alternates, designator) → the form now sends it back.
  2. Backflushed material could be "returned" to the store → returnable = issued − returned − consumed (also in cancel).
  3. MRP ignored backflush components of open orders → counted as demand.
  4. Sales-order demand counted twice when a plan pulled the same lines → plan lines that came from a sales order are skipped when sales orders are included.
  5. The first partial FG receipt of a running order took all the WIP → share is taken against the pieces still planned.
  6. Cancelling a scrap entry with recovery reversed the wrong stock move → the move now records its scrap entry.
  7. A stuck MRP run blocked the unit for ever → runs older than 30 minutes are marked failed.
  8. Firmed make suggestions gave their components no demand → their components are demand until they become orders.
  9. A second "complete" with a fresh key looked like a replay and lost the counts → a replay is only accepted for a key that was recorded.
  10. MRP export "Start by" column was empty → reads `releaseDate`.

## 5. Not done
* The three clean verify/e2e runs; the e2e re-run (above).
* Item-planning screen; paging controls on lists.
* Holiday-aware finite scheduling (Phase 15 owns calendars); link of a work centre to the asset register (`work_centres.asset_id`, Phase 14).

## 6. Owner check list (after deployment)
1. **Work Centers**: add *Cutting*, with labour rate, overhead rate and a cost centre. Add a calendar and a downtime reason.
2. **Bill of Material › New**: finished good with a component (scrap 5 %); *Save draft*, *Send for approval*, *Release*. A BOM that contains itself is refused.
3. **Routing › New**: Cutting then Assembly; release.
4. **Production Orders › New**: quantity 10, stores chosen; *Release*; open it, enter the quantities under *Issue material*.
5. **Work Orders**: open the first card, *Start setup*, *Start run*, enter good 8 and scrap 2 with a reason, *Complete*. The second card now opens.
6. **Scrap Management**: submit the scrap draft. **WIP Tracking** shows the order and "Matches" with the ledger.
7. **Finished Goods Receipt**: receive 4, then 4. **Production Orders › Work is finished › Close order**; WIP Tracking no longer lists it.
8. **Production Planning › New plan**: add a line, *Check capacity*, *Check material*, *Release plan*, *Run MRP on this plan*; open **MRP**: see Make / Buy and the "why" for each; *Firm* and *Convert*.
9. **Shop Floor**: pick the work center on a tablet; the big buttons work; the dashboard says "No data yet" until cards are logged.
