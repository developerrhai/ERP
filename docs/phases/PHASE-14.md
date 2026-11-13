# PHASE 14

# PHASE 14 — Maintenance & Assets
(ERRATA E-21: ignore any "register/lock/push" wording. E-27: work_centres.asset_id.)

## 1. Goal
One asset spine. **One physical object = one row in `assets`.** Maintenance pages and fixed-asset
pages are two views of that row.

Two systems on top of it:
- a CMMS keeping TAL / SAW / VAR machines running;
- a fixed-asset register meeting Schedule II (Companies Act 2013), AS 10 and the Income-tax Act.

Every rupee posts through PostingService. MTBF, MTTR and availability come only from logged events.

## 2. Pages (18; prototype tabs kept; fake fields dropped or computed)
| Group | Pages |
|---|---|
| Maintenance | maint-machines (asset_kind MACHINE; MTBF, last/next service and health computed), maint-equipment (EQUIPMENT; hierarchy via parent_asset_id), maint-preventive, maint-breakdown, maint-workorders, maint-spares (view of Spare Part items + Phase 8 stock), maint-schedule, maint-downtime (feeds OEE), maint-mtbf (report), maint-alerts |
| Assets | asset-master (book value computed), asset-capitalization, asset-allocation, asset-transfer, asset-maintenance (same WOs, for non-machine assets), asset-depreciation, asset-disposal, asset-qr |

## 3. Rules
1. **Two depreciation areas:** BOOK (Companies Act, posts to the GL) and TAX (IT Act block WDV, memo only).
2. **Schedule II (book):**
   - Useful lives are seeded rows (needs_review): factory building 30 y, RCC non-factory 60 y, general
     plant & machinery 15 y, continuous-process plant 25 y, computers 3 y, servers/networks 6 y,
     furniture 10 y, office equipment 5 y, electrical installations 10 y, motor car 8 y, two-wheeler
     10 y, heavy vehicle 8 y.
   - Residual value ≤ 5 % of cost (more needs a written justification).
   - SLM or WDV per category, pro-rata by days.
   - Extra shift (plant & machinery unless NESD): +50 % for double-shift days, +100 % for triple.
   - Component approach: a significant part with a different life is a child asset (e.g. CNC 15 y,
     spindle motor 8 y).
3. **AS 10 cost:**
   - Cost = price (without claimed GST) + freight + installation + testing + professional fees.
   - Depreciation starts on the available-for-use date. Until then the cost sits in CWIP.
   - Revaluation and impairment: tables only.
4. **IT Act block:**
   - WDV on the block = opening + additions − sale proceeds.
   - Additions put to use < 180 days get half rate.
   - Rates (P&M 15 %, computers 40 %, furniture 10 %, buildings 10 %, …) are dated rows with act_ref
     (ITA1961 s.32 until FY 2025-26; ITA2025 from 1-Apr-2026), needs_review.
   - Additional depreciation is off under the 115BAA regime.
5. **GST on capital goods:**
   - ITC taken in full at GRN / invoice; barred if the tax is added to cost.
   - Blocked credits under s.17(5) are capitalised (category flag itc_eligible).
   - On sale, s.18(6): pay the higher of (ITC − 5 percentage points per quarter used) and the tax on
     the sale value.
6. **CMMS:**
   - Breakdown → work order (the SAP PM pattern).
   - PM plans by time or meter, whichever comes first.
   - ISO 14224-style failure codes (mode / cause / mechanism).
   - Planned downtime is not a failure.

## 4. Database (<ts>_phase14_asset_masters / _maintenance / _asset_docs / _depreciation / _seed_rates)
**Masters:**
- asset_categories(code, name, asset_class BUILDING/PM/FURNITURE/VEHICLE/COMPUTER/OFFICE_EQUIP/
  ELECTRICAL/INTANGIBLE, GL asset / accumulated depreciation / expense / CWIP accounts, itc_eligible,
  is_maintainable_default, nesd)
- asset_category_book_params(category, effective_from/to, method SLM/WDV, useful_life_months,
  residual_pct ≤ 5, sch2_ref, needs_review)
- it_blocks(code, name, act_ref); it_block_rates(block, effective_from, rate_pct, half_rate_rule, needs_review)
- assets(asset_no "AST", name, category, asset_kind MACHINE/EQUIPMENT/IT/VEHICLE/FURNITURE/BUILDING/OTHER,
  parent_asset_id (no cycles), is_component, is_maintainable, department, location, cost_centre,
  work_centre_id, make, model, serial_no, criticality A/B/C, commission_date, warranty_end, supplier,
  purchase_invoice_ref, status CWIP/ACTIVE/IDLE/UNDER_MAINT/DISPOSED, qr_token unique, it_block_id,
  put_to_use_date)
  - book value is **never stored**; it comes from the view v_asset_book_value
- asset_book_profile(asset, area BOOK/TAX, method, life_months, residual_amount, rate_pct,
  dep_start_date, cost, accum_dep, last_dep_date, frozen) — changed only by posting services, under row lock
- meters(asset, meter_type RUN_HRS/STROKES/KM, uom); meter_readings(meter, reading_at, value — never
  lower unless flagged reset, entered_by, source MANUAL/IOT)
- ALTER work_centres ADD asset_id FK

**Maintenance:**
- pm_plans(plan_no, asset, title, trigger TIME/METER/BOTH, interval_days, meter, interval_meter,
  lead_days, est_hours, skill_designation, checklist_template, active) + pm_plan_spares(item, qty, uom)
- checklist_templates + items(seq, text, answer_type OK_NOTOK/NUMBER/TEXT, min, max)
- pm_schedules(plan, due_date, due_meter, status PLANNED/WO_CREATED/DONE/SKIPPED, wo_id, generated_key unique)
- breakdown_tickets(bd_no, asset, reported_at/by, symptom, photos, priority P1–P3, machine_stopped,
  acknowledged_at, repair_started_at, repaired_at, failure_mode/cause/mechanism codes, root_cause, wo_id,
  status OPEN/ACK/IN_REPAIR/RESOLVED/CLOSED/CANCELLED)
- maint_work_orders(mwo_no, type PM/BREAKDOWN/CORRECTIVE/CALIBRATION/AMC, asset, source PM schedule /
  breakdown, description, priority, planned/actual start & end, est_cost, approval_status, sign_off_by/at, status)
  - mwo_tasks(seq, text, result, done_by, done_at)
  - mwo_spares(item, warehouse, required/reserved/issued/returned qty, rate, amount, stock_voucher_id)
  - mwo_labour(employee or vendor, start, end, hours, rate, amount)
  - mwo_vendor_charges(supplier, invoice_ref, amount)
- downtime_events(dt_no, asset, work_centre, start_at, end_at, duration_min (generated),
  type PLANNED/UNPLANNED, reason, breakdown, production_order, lost_qty, cost_impact)
  - no overlap per asset (tstzrange gist exclusion)
- alert_rules(type, lead_days, escalation_minutes[], channel); alerts(rule, asset, ref, due_at,
  escalation_level, acknowledged_by/at, status)

**Asset documents:**
- asset_capitalisations(cap_no, asset, capitalisation_date, source PURCHASE/CWIP/OPENING_IMPORT,
  approval, journal) + asset_cap_cost_lines(component BASE/FREIGHT/INSTALLATION/TESTING/PROF_FEE/OTHER,
  source_doc_ref, amount, gl_source_account)
- asset_allocations(alloc_no, asset, employee, department, location, allocated_on, condition_out,
  handover_doc, return_due, returned_on, condition_in, status)
- asset_transfers(tr_no, asset, from/to unit, location, employee, cost centre, request_date,
  transfer_date, approval, condition, verified_by, journal) — inter-unit posts INTER_UNIT
- asset_shift_usage(asset, period, single_days, double_days, triple_days)
- depreciation_runs(run_no, area, period or FY, unit, status DRAFT/POSTED/REVERSED, journal, run_by, job_id)
  - unique (area, unit, period) where not reversed
  - depreciation_run_lines(run, asset or block, opening_value, base, method, rate, days, shift_factor,
    amount, closing_value)
- it_block_ledger(block, FY, opening_wdv, additions ≥180, additions <180, deletions, depreciation,
  closing_wdv, needs_review)
- asset_disposals(disp_no, asset, method SALE/SCRAP/WRITE_OFF/DONATION, request/disposal date, buyer,
  sale_value, gst_on_sale, s18_6_calc, nbv_at_disposal, gain_loss, approval, journal, status)
- asset_revaluations, asset_impairments (placeholders; methods throw NOT_IN_SCOPE)
- asset_qr_labels, asset_scans(asset, token, scanned_by/at, location, purpose VIEW/VERIFY/BREAKDOWN, valid)
- physical_verifications + lines(asset, found, condition, location_found)
