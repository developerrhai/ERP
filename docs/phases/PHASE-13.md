# PHASE 13

# PHASE 13 — Manufacturing (BOM, routing, planning, MRP, shop floor, costing)
(ERRATA E-25: calendars use weekdays until Phase 15 holidays exist. E-27: machines become assets in Phase 14.)

## 1. Goal
Replace the 13 static manufacturing pages and the fake shop-floor numbers (OEE 87.6 %, target 8,400)
with a real production system:
- versioned multi-level BOMs;
- routings on work centres;
- production plans driven by sales orders;
- MRP as a pg-boss job that creates purchase requests and planned production orders;
- production orders with job cards per operation;
- material issue/return through StockService;
- FG receipt gated by QC;
- scrap and rework;
- actual costing that posts to the GL for every movement.

KPIs come only from logged data. With no data the page says "No data yet".

## 2. Pages
mfg-bom, mfg-routing, mfg-workcenters, mfg-plan, mfg-orders, mfg-mrp, mfg-workorders (job cards),
mfg-shopfloor (rebuilt tablet-first), mfg-wip, mfg-fg, mfg-scrap, mfg-rework, mfg-costing.

Prototype field names are kept as labels where a real column backs them. Fields with nothing behind
them are dropped, never faked.

## 3. Rules (ERPNext BOM / Work Order / Job Card; Odoo MRP; SAP PP 261/262/101; Orlicky MRP; OEE; Ind AS 2 ¶12–16; CGST s.143)
- A released BOM can't change; changes create a new version through "Revise".
- One job card per operation. An operation can't complete more than the previous operation's good qty.
- Order statuses follow SAP: created → released → confirmed → technically complete → closed.
- **MRP:**
  - net = gross − on hand − scheduled receipts + safety stock;
  - lot sizing: lot-for-lot, fixed lot or EOQ;
  - release date = due date − lead time;
  - low-level coding.
- **Overhead (Ind AS 2):**
  - work-centre overhead rate = budgeted overhead / **normal capacity** hours (Finance sets it);
  - absorbed cost goes to OVERHEAD_ABSORBED (contra expense), so under-absorption stays in P&L;
  - abnormal scrap goes to SCRAP_LOSS and is never capitalised.
- **Subcontracting / job work is NOT in v1** (Phase 13b). A routing operation flagged is_outside blocks release.
- **Costing:** actual costing in line with the Phase 8 moving average. Standard roll-up is used only for
  quoting, planning and variance reports; no variance journal in v1.

## 4. Database (<ts>_phase13_masters / _planning / _execution / _costing; qty (18,3), rate (18,6), money (18,2))
**Masters:**
- mfg_item_planning(item_id PK, make_or_buy, low_level_code, lead_time_days, safety_stock,
  lot_sizing LFL/FIXED/EOQ, fixed_lot_qty, min_order_qty, order_multiple, eoq_setup_cost,
  eoq_holding_rate, default_bom_id, default_routing_id, backflush_wh_id, wip_wh_id, fg_wh_id)
- work_centers(code unique per unit, name, department, cost_centre, machine_count, labour_count,
  calendar_id, hours_per_shift, shifts_per_day, normal_capacity_hrs_per_day, labour_rate_per_hr,
  overhead_rate_per_hr, oee_target_pct, efficiency_pct, status) — asset_id FK added in Phase 14
- work_center_calendars + exceptions(date, available_hrs, reason)
- downtime_reasons(code, name, category PLANNED/UNPLANNED, counts_against_availability)
- scrap_reasons(code, normal)
- boms(item, bom_no, version, revision, bom_type STANDARD/ENGINEERING/REWORK, base_qty, uom,
  effective_from/to, status DRAFT/PENDING_APPROVAL/RELEASED/OBSOLETE, is_default, routing_id,
  std_material_cost, approval_request_id)
  - unique (item, version); released = immutable
  - exactly one default released BOM per item (partial unique index)
- bom_lines(bom, line_no, component_item, qty_per_base, uom, conversion_factor, scrap_pct 0–50,
  issue_method MANUAL/BACKFLUSH, operation_seq, effective_from/to, is_phantom, reference_designator, remarks)
- bom_line_alternates(line, alt_item, priority, ratio)
- routings(item, routing_no, version, status, effective_from)
- routing_operations(routing, seq 10/20…, name, work_center, setup_min, run_min_per_unit (ideal cycle),
  queue_min, move_min, qc_required, qms_plan_ref, is_outside (blocked), tooling_note)
- bom_cost_snapshots(bom, rolled_at, material, labour, overhead, total, per_unit, detail)

**Planning:**
- production_plans(plan_no, plan_date, horizon, status DRAFT/SUBMITTED/RELEASED/CLOSED)
- production_plan_lines(demand_source SALES_ORDER/MANUAL/FORECAST, so_line_id, item, demand_qty,
  planned_qty, required_date, bom, capacity_load_pct, material_avail_pct, checked_at)
- mrp_runs(run_no, plan_id, horizon_days, bucket DAY/WEEK, include_so, status QUEUED/RUNNING/DONE/FAILED,
  job_id, times, error, params)
- mrp_item_buckets(run, item, bucket_date, gross, scheduled_receipts, projected_on_hand, net,
  planned_receipt, planned_release)
- mrp_suggestions(run, item, type MAKE/BUY, qty, release_date, due_date,
  status OPEN/FIRMED/CONVERTED/IGNORED, converted_doc_type/id)
- mrp_pegging(suggestion, source_type SO_LINE/PLAN_LINE/PARENT_SUGGESTION/SAFETY_STOCK, source_id, qty)
- mrp_exceptions(run, item, code PAST_DUE_RELEASE/NO_BOM/NO_SUPPLIER/CYCLE/EXPEDITE, message)

**Execution:**
- production_orders(order_no, item, bom (frozen), routing, planned/produced/rejected/scrapped qty,
  start, due, priority, plan_line, so_line, wip_wh, fg_wh, over_production_pct (default 0),
  status DRAFT/PENDING_APPROVAL/RELEASED/IN_PROGRESS/COMPLETED/CLOSED/CANCELLED, material_status)
- production_order_materials(frozen explosion: component, required, issued, returned, consumed,
  issue_method, operation_seq)
- job_cards(order × operation: work_center, planned_qty, qty_in, good, rejected, scrap, rework,
  planned/actual times, status OPEN/RUNNING/PAUSED/DONE)
- job_card_time_logs(job_card, from_ts, to_ts, kind SETUP/RUN, operator_name (text until Phase 15),
  good, rejected, idempotency_key)
- downtime_logs(work_center, job_card, reason, from_ts, to_ts, minutes (generated), remarks)
- material_issues + lines and material_returns + lines (order, item, batch/serial, qty, rate, amount,
  stock_txn_id)
- production_receipts + lines (order, item, qty, batch/serial, qc_status PENDING/ACCEPTED/REJECTED,
  qms_inspection_ref, unit_cost, amount, cost_breakup, stock_txn_id)
- scrap_entries(order, job_card, item, qty, reason, is_normal, recoverable_qty, recovery_item,
  recovery_value, disposal_method, loss_value, approval_request_id, status)
- rework_orders(source_ncr_ref, order, item, qty, rework_routing, rework_bom, status, labour_hrs,
  material_cost, reinspection_result)

**Costing:**
- production_cost_sheets(order, std/act material, std/act labour, std/act overhead, abnormal_scrap,
  std_total, act_total, variance_pct, finalised_at)
- production_cost_ledger(order, event, amount, element MATERIAL/LABOUR/OVERHEAD/SCRAP/FG, journal_id)
  — the WIP sub-ledger

**Numbering:** BOM, RT, PP, PO-MFG, JC, MI, MR, FGR, SCR, RWK, MRP.
**Stock voucher types:** MFG_ISSUE, MFG_RETURN, FG_RECEIPT, SCRAP.
**Indexes:** production_orders(unit, status, due); job_cards(work_center, status); mrp_*(run, item).

## 5. Algorithms (packages/calc)
**BomService.explode(item, qty, date):**
- Use the default released BOM and lines valid on the date.
- Required = qty / base_qty × qty_per_base × conversion × (1 + scrap %), rounded to 3 decimals half-up.
- Phantom lines explode straight through.
- Cycle check (depth-first search) on save and on release → BOM_CYCLE with the path.
- Example: 100 motors MTR-BLDC-48 → 100 stators → copper wire 0.800 kg × 1.025 = **82.000 kg**;
  lamination stack × 1 = 100.

**Low-level codes:** recomputed by BFS on every BOM release; llc = max(parent llc + 1).

**MRP** (pg-boss job mfg.mrp.run, one at a time per unit; items processed by ascending LLC):
- Gross = open SO qty + plan lines + parent planned releases × BOM qty + open production-order requirements.
- Scheduled receipts = open PO qty (Phase 9) + open production orders.
- On hand = StockService availability − reservations.
- Per bucket: POH = previous POH + receipts − gross. If POH < safety stock: net = SS − POH, planned
  receipt = lotSize(net), release = due − lead time on the calendar. A release in the past →
  PAST_DUE_RELEASE.
- lotSize: LFL → net; FIXED → ⌈net/F⌉ × F; EOQ → max(net, EOQ); then MOQ and order multiple.
- A re-run replaces OPEN suggestions (idempotent).

Worked example — stator, lead time 2 weeks, safety stock 50, on hand 300, 200 arriving in week 2:
| Week | Gross | Receipts | POH before | Net | Planned receipt (LFL) | Release |
|---|---|---|---|---|---|---|
| 1 | 150 | 0 | 150 | 0 | – | – |
| 2 | 250 | 200 | 100 | 0 | – | – |
| 3 | 300 | 0 | −200 | 250 | 250 → POH 50 | week 1 |
| 4 | 200 | 0 | −150 | 200 | 200 → POH 50 | week 2 |

With FIXED lots of 500: week 3 receives 500 (POH 300), week 4 POH 100, no order.

**Converting suggestions:**
- BUY → PurchaseRequestGateway.create (Phase 9).
- MAKE → draft production order, with pegging copied.

**Releasing a production order:**
- Freeze the BOM explosion; create job cards from the routing; reserve components.
- Value (std roll-up × qty) above the threshold → approval.
- Capacity check: Σ(setup + run × qty)/60 per work centre per day vs calendar hours. Over 100 % is a
  warning, not a block.

**Issue method:**
- MANUAL for batch/serial-tracked or high-value parts (copper, magnets, controllers, castings).
- BACKFLUSH for consumables and fasteners: on job-card completion of the matching operation (or at FG
  receipt), qty = (good + rejected) × per-unit requirement, FEFO. A shortage fails the confirmation;
  stock never goes negative.
- Manual over-issue up to 5 % (setting); more needs a supervisor.

**Job card rules:**
- Operation 10's qty_in = order qty; each later qty_in ≤ the previous operation's good qty.
- good + rejected + scrap + rework ≤ qty_in.
- Time logs can't overlap.
- If qc_required, completion calls QmsProcessPort.requestInspection, and good qty moves on only after acceptance.

**WIP and FG:**
- WIP = Σ cost ledger per order; reconciled to the INVENTORY_WIP GL (difference > ₹1 → exception).
- FG unit cost (actual) = (material consumed + labour absorbed + overhead absorbed − abnormal scrap −
  recovery) / cumulative good qty.
- The final receipt or order close sweeps the remaining WIP into FG; with good qty 0, it goes to SCRAP_LOSS.
- Labour / overhead absorbed = Σ logged hours × work-centre rates.
- With item.qc_required, FG goes into QC hold until final QC accepts it (Phase 12).

**Variances** (reported only, not posted):
- material usage = (actual − standard qty) × standard rate
- material price = actual qty × (actual − standard rate)
- labour/overhead efficiency = (actual − standard hrs) × rate
- yield = standard input / actual output

**OEE = A × P × Q:**
- planned time = shift − planned downtime; run time = planned − unplanned downtime.
- Example: 480 min shift − 30 break = 450 planned; 45 breakdown → run 405, A = 0.9000.
  Ideal cycle 0.5 min × 720 pcs → P = 360/405 = 0.8889. Good 700 → Q = 0.9722.
  **OEE = 0.7778.** Check: 700 × 0.5 / 450 = 0.7778.
- P is capped at 1; above 1 flags CYCLE_TIME_SUSPECT.

**GL journals** (worked order of 100 motors; every post calls assertCanPost; cancel = reversal):
| Event | Dr | Cr | ₹ |
|---|---|---|---|
| Material issue | INVENTORY_WIP | INVENTORY_RM | 4,50,000 |
| Return of unused copper | INVENTORY_RM | INVENTORY_WIP | 5,000 |
| Labour, 40 h × ₹300 | INVENTORY_WIP | OVERHEAD_ABSORBED (labour, WC cost centre) | 12,000 |
| Overhead, 40 h × ₹700 | INVENTORY_WIP | OVERHEAD_ABSORBED (overhead) | 28,000 |
| Backflushed consumables | INVENTORY_WIP | INVENTORY_RM | 2,000 |
| Abnormal scrap, 2 × (4,87,000/100) | SCRAP_LOSS | INVENTORY_WIP | 9,740 |
| Scrap recovery (copper at NRV) | INVENTORY_RM | INVENTORY_WIP | 500 |
| FG receipt, 98 motors | INVENTORY_FG | INVENTORY_WIP | 4,76,760 (₹4,864.90 each) |

- WIP after close = 0. Normal scrap (within BOM %) stays inside product cost.
- An FG receipt can be reversed only while that FG is still unconsumed (FG_ALREADY_CONSUMED).

**Concurrency:**
- Lock order: production order → job card → stock.
- Idempotency-Key on every POST; If-Match on updates.
- One MRP run per unit at a time (advisory lock); suggestions can't be converted while that run is RUNNING.

## 6. API (/api/v1/mfg)
- **Masters:**
  - work-centers CRUD (+ /:id/calendar), downtime-reasons, scrap-reasons
  - item-planning/:itemId (GET/PUT)
- **BOM:**
  - boms CRUD (draft only)
  - /boms/:id/submit | release | revise | obsolete | set-default
  - /boms/:id/explode?qty=&date= · /boms/:id/cost-rollup · /boms/import
- **Routing:** routings CRUD (+ /:id/release | revise)
- **Planning:**
  - production-plans CRUD (+ /:id/pull-demand | check-capacity | check-material | release | run-mrp)
  - mrp-runs (POST enqueue / GET) + /:id/suggestions | buckets | pegging | exceptions
  - mrp-suggestions/:id/firm | ignore | convert; mrp-suggestions/convert-bulk
- **Orders:** production-orders CRUD (+ /:id/release | start | complete | close | cancel, /:id/materials, /:id/cost-sheet)
- **Material:** material-issues (+ /:id/cancel); material-returns (+ /:id/cancel)
- **Shop floor:**
  - job-cards?work_center=&status= (+ /:id/start | pause | resume | complete, /:id/time-logs)
  - downtime (POST / PUT close)
- **Receipts, scrap, rework:**
  - production-receipts (+ /:id/cancel)
  - scrap-entries (+ /:id/submit | cancel)
  - rework-orders (+ /:id/release | complete)
- **Reports:** reports/wip | wip-reconciliation | oee | plan-adherence | yield | variance
- **Dashboard:** shopfloor/summary?unit=&date=

## 7. UI
- **BOM Structure:** indented tree with expand/collapse; qty at the chosen order qty; effective-date filter.
- **Prints:** job card (QR = job card number) and production traveller; drawings attached via DocumentService.
- **Flow:**
  1. Engineer: BOM draft → submit → approval → release.
  2. Planner: plan → pull SOs → capacity / material check → run MRP (progress bar) → suggestions with a
     pegging drawer → convert.
  3. Supervisor: release → issue material by scanning batches.
  4. Operator: shop floor.
  5. QC → FG receipt → close → cost sheet.
- **Shop floor** (tablet 1024 px, 48 px targets, large fonts):
  - unit → work centre → job queue (by priority, due date);
  - big buttons Start Setup / Start Run / Pause (reason = downtime) / Complete (keypad for good /
    rejected / scrap + reason);
  - operator name from a pick list until Phase 15;
  - a double tap is harmless (Idempotency-Key).
- **Supervisor dashboard:** OEE today per work centre, target vs actual, rejection %, downtime minutes,
  hourly good-qty chart from time logs. Empty → "No production logged today".

## 8. Messages
| Code | Message |
|---|---|
| BOM_CYCLE | "BOM loop: {path}. A part can't contain itself." |
| BOM_RELEASED_LOCKED | "Released BOM v{n} can't be edited. Use Revise to create v{n+1}." |
| BOM_EFFECTIVITY_OVERLAP | "Another default BOM for {item} is effective {from}–{to}." |
| SCRAP_PCT_RANGE | "Scrap % must be 0–50." |
| WC_RATE_MISSING | "Work centre {code} has no labour/overhead rate; Finance must set it before release." |
| ORDER_OUTSIDE_OP_V1 | "Outside (subcontract) operations arrive in Phase 13b." |
| JC_QTY_EXCEEDS_PREVIOUS | "Op {seq} can process at most {n} (good qty from op {prev})." |
| JC_QTY_SUM | "Good + rejected + scrap + rework ({x}) exceeds input {n}." |
| JC_QC_PENDING | "Waiting for in-process inspection {ref}." |
| STOCK_SHORT_BACKFLUSH | "Not enough {item} in {wh} (need {a}, have {b}). Issue material first." |
| OVER_ISSUE | "Issue exceeds requirement by more than {pct} %." |
| OVER_PRODUCTION | "Receipt exceeds order qty + {pct} % tolerance." |
| FG_QC_HOLD | "{item} needs final QC; stock stays on hold until accepted." |
| FG_ALREADY_CONSUMED | "This finished stock has already been used and can't be reversed." |
| ORDER_HAS_OPEN_WIP | "Close blocked: WIP ₹{x} not settled." |
| MRP_ALREADY_RUNNING | "MRP is already running for this unit." |

## 9. Audit & notifications
- **Audit:** every master change, status change, posting, reversal, approval, MRP run (parameters +
  counts) and conversion.
- **Notifications:**
  - BOM / order release / scrap approvals → approver;
  - MRP done / failed and past-due releases → planner;
  - shortage at release → stores;
  - QC hold → QC;
  - downtime over 30 min → supervisor;
  - overdue order → planner.

## 10. Tests
- **Unit:** explosion (phantom, alternates, scrap, UOM), cycle detection, LLC, the MRP table (LFL /
  FIXED / EOQ / MOQ / multiple / safety stock / past-due), OEE 0.7778 and the P > 1 cap, FG cost to the
  paisa, variances.
- **Integration:**
  - full order lifecycle: journals balance, WIP returns to 0, reversal restores everything;
  - backflush shortage blocks;
  - QC hold;
  - approval thresholds;
  - closed period;
  - MRP end to end (SO → suggestions → PR / order with pegging).
- **Concurrency:**
  - parallel completions never exceed qty_in;
  - parallel issues on the last stock;
  - duplicate key applied once;
  - one MRP run at a time;
  - stale If-Match → 412.
- **E2E:** tablet shop floor.
- 3 clean runs.

## 11. Acceptance
- [ ] No fake numbers anywhere; shopfloor uses the API.
- [ ] A 3-level motor BOM explodes correctly; a cycle is rejected.
- [ ] MRP from real SOs matches a hand calculation, with pegging to the SO.
- [ ] An order runs issue → 3 job cards → scrap → FG → close; cost sheet = GL; WIP = 0; trial balance holds.
- [ ] OEE shown = A × P × Q worked by hand from the logs.

## 12. Out of scope
Subcontracting (13b), finite scheduling / Gantt drag, MPS forecast beyond manual lines, standard-cost
GL with variance posting, co-products, operator master (Phase 15), IoT, offline tablet mode, ECO workflow.

## 13. Owner check
1. Create work centre CNC-1 (8 h, ₹300 labour, ₹700 overhead). Is it listed?
2. Make A contain B and B contain A. Does it say "BOM loop"?
3. Create an SO for 100 motors and run MRP. Do you see "Running", then suggestions with the SO reference?
4. Release and issue. Does copper stock fall, with WIP debited?
5. Tablet: Start → Pause (Breakdown) → Complete 98 good / 2 scrap. Does OEE update (not 87.6)?
6. Does FG show "QC hold" until accepted?
7. On a fresh database, are all mfg pages "No data yet"?

## 14. Build prompt
~~~
Read CLAUDE.md, docs/phases/STANDARDS.md, ROADMAP.md (R-01..R-24), ERRATA.md, PHASE-13.md, Phase 3–12
code as built. (1) packages/calc: bomExplode, detectCycle, lowLevelCodes, mrpNet, oee, fgUnitCost,
variances — Decimal; tests = §5 examples (82.000 kg; MRP table; OEE 0.7778; FG 4,76,760/98).
(2) migrations <ts>_phase13_* per §4. (3) services Bom, Routing, WorkCenter, Planning, Mrp (pg-boss
mfg.mrp.run, per-unit advisory lock), ProductionOrder, JobCard, Material (MFG_ISSUE/MFG_RETURN/
FG_RECEIPT/SCRAP), Receipt (QmsProcessPort QC hold), Scrap, Rework, Costing (cost ledger + PostingService;
assertCanPost; reversals only); approvals for BOM release, order release over threshold, scrap. Lock order
order → job card → stock; Idempotency-Key; If-Match. (4) API §6, messages §8. (5) UI: 13 pages + tablet
shop floor, job card/traveller PDFs, BOM import; no fake KPIs. (6) tests §10, 3 clean runs; subcontracting
stays blocked. Migrations local dev/test only (R-16). Never push; commit only if asked. Write
PHASE-13-REPORT.md.
~~~
