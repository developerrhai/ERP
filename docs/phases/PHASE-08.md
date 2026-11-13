# PHASE 08

# PHASE 08 — Inventory & WMS v2
(Read ERRATA.md first: E-10 account key names, E-24 inter-GSTIN transfers, E-06/Phase 6 item columns.)

## 1. Goal & why
Turn the existing stock slice into the stock engine that Procurement (9), Sales (10), Quality (12),
Manufacturing (13) and Maintenance (14) all post through. Every stock movement also posts to the GL,
and stock value must equal GL inventory per unit at all times (R-07).

**Existing** (migration phase5_inventory):
- items, warehouses.
- stock_ledger: append-only by trigger; one direction per row; balance can't go negative.
- stock_balances: per (item, warehouse), on_hand ≥ 0.
- stock_vouchers: **one item per voucher** (item, warehouse and qty on the header).
- posting.ts:
  - postMovement: locks the balance FOR UPDATE, moving average, refuses negative stock, the last unit
    takes the remaining value;
  - reverseVoucher.
- vouchers/service.ts: post, dispatch, receive, cancel with Idempotency-Key and FY check.

**Defects:**
| # | Defect | Effect |
|---|---|---|
| C4 | Single-item vouchers | A 20-line issue slip means 20 vouchers. |
| C5 | No backdated-posting guard (D-20 requires one) | History order changes silently. |
| C6 | No batch / serial / bin in the ledger; batch is free text | No FEFO, no recall, no bin stock. |
| C7 | No GL posting | Breaks R-07. |
| C8 | Voucher types and statuses are fixed CHECK lists | Breaks D-11. |
| C9 | Reversing an inflow after later issues uses the original value | Value can go negative while qty is positive. |
| C10 | "Approver" is free text | No maker-checker. |
| C11 | Transfers must be received in full; in-transit stock has no value | No transit-loss handling, no GL for goods in transit. |

## 2. Pages in scope
**Built now (22 pages):**
- inv-items (6 tabs; valuation method shown read-only as "Moving Average"; inventory key preview)
- inv-stock (all 16 fields, incl. Zone / Rack / Shelf / Bin / Batch and Reserved / Blocked / Available)
- inv-transactions, inv-opening (lines + Excel upload), inv-adjustment, inv-transfer
- inv-reservation, inv-reconciliation
- inv-ageing, inv-valuation, inv-reorder
- inv-batch, inv-serial, inv-expiry
- wms-warehouses, wms-zones, wms-racks, wms-shelves, wms-bins
- wms-cycle, wms-physical
- wms-barcode (registry, labels, scan lookup)
- wms-transfer (bin-level view of transfer vouchers; no table of its own)

**Deferred:**
| Page / tab | Phase | Note |
|---|---|---|
| wms-putaway | 9 | This phase exposes suggestBin() only. |
| wms-pick, wms-packing | 10 | This phase gives allocate() with FEFO. |
| wms-rfid | not planned | Shows "Not enabled". |
| inv-serial: Warranty / Service tabs | 10 / 14 / 17 | Empty states that explain why. |
| inv-reorder: "Suggested PR" button | 9 | Disabled until then. |
| inv-valuation: FIFO / Standard tabs | — | Show "Company uses Weighted Average (Ind AS 2 ¶25)" plus a standard-vs-average comparison. |

## 3. Business logic & research (rules adopted)
**Sources** (★ = re-check, D-21):
- Ind AS 2 / AS 2 — allowed cost formulas: FIFO or weighted average (LIFO not allowed); one formula for
  similar items; GST that can be claimed back is excluded from cost; freight is included.
- ERPNext: Stock Ledger Entry, Bin, Serial and Batch Bundle★, Stock Reconciliation, Repost Item Valuation.
- Odoo: stock.move, valuation layers★, quants, transit locations.
- SAP movement types★: 561 initial entry (→ OPN), 501 receipt without PO (→ RECEIPT), 201 issue to
  cost centre (→ ISSUE), 301/303–305 plant transfers (→ TRF), 311 storage-location transfer
  (→ TRF direct / BIN_MOVE), 551 scrapping (→ ADJ write-off), 701/702 count differences (→ RCN).
  101 belongs to Phase 9, 261 to Phase 13.
- Cycle counting: ABC split at 80 % / 95 % of consumption value; count A every 30 days, B every 90,
  C every 365; blind count; recount by a different person.
- EOQ = √(2DS/H). Safety stock SS = z·σd·√LT, or z·√(LT·σd² + ADU²·σLT²). Reorder point ROP = ADU·LT + SS.
- GS1 barcodes: AIs (01) GTIN-14, (10) batch, (17) expiry YYMMDD, (11) mfg date, (21) serial,
  (30) qty, (00) SSCC; the FNC1 / ASCII 29 separator.

**Rules:**
1. **Valuation = moving average per item + warehouse** for every item (items.valuation_method fixed to
   MOVING_AVG). FIFO is rejected for v1: it is complex and brings no benefit for stable-priced
   components. Batches and serials carry no cost of their own.
2. **Backdated postings are not reposted (D-20):**
   - A posting dated before the latest movement of that item + warehouse → 409 BACKDATED_POSTING.
   - Exception: a user with `approve` on the page. The posting is valued at the current state, flagged
     is_backdated=true, and audited BACKDATED_POSTING_ALLOWED. The GL journal still uses the voucher date.
   - Future dates → 422 FUTURE_DATE. The period lock applies (PERIOD_CLOSED).
   - Reversals are dated the cancel date, so they are never backdated.
3. **No negative stock, ever** — no setting. The check runs at item + warehouse level and at the batch
   and bin level.
4. **One GL key per item type** (lookup item_type_inventory_keys, editable by Finance):
   - Raw Material, Packing, Consumable, Spare → INVENTORY_RM
   - Semi-Finished → INVENTORY_WIP
   - Finished Good → INVENTORY_FG
   - Service → not stockable (422 ITEM_NOT_STOCKED)
5. **Transit warehouse:**
   - Each unit gets a system warehouse <UNIT>-TRANSIT (is_transit, hidden from users), valued under
     STOCK_IN_TRANSIT.
   - Cross-unit transfers are always two steps (dispatch, then receive). Same-unit transfers may be direct.
   - Transfers between different GSTINs follow E-24.
6. **Reversal valuation (fixes C9):**
   - Reversing an outflow brings stock back at its original value.
   - Reversing an inflow takes out the original qty at the original value. If value would go below 0
     while qty > 0 → 409 REVERSAL_VALUE_NEGATIVE; the user posts a revaluation adjustment instead.
   - When qty reaches 0, the row takes the whole remaining value.

## 4. Database design
**Migration A `<ts>_phase08_inventory_lines`:**
- **Lookups (no CHECK lists, D-11):**
  - document_types(code PK, name, prefix, owner_phase) — seed OPN, TXN, ADJ, TRF, RCN.
  - stock_voucher_types(code PK, name, direction IN/OUT/ZERO, gl_template, sap_equiv,
    needs_value_approval) — seed OPENING, RECEIPT, ISSUE, ADJUSTMENT, TRANSFER_OUT, TRANSFER_IN,
    TRANSIT_IN, TRANSIT_OUT, TRANSIT_LOSS, BIN_MOVE, RECONCILIATION, REVERSAL.
- **stock_vouchers** header — add:
  - doc_type, purpose, issue_to_department, cost_centre, remarks
  - approval_request_id, approved_by_id, approved_at, total_value
  - cancel_reason, cancelled_at, cancelled_by_id
  - journal_id, reversal_journal_id, is_legacy
  - status moves to the lookup stock_voucher_statuses: Draft, Pending Approval, Approved, Posted,
    Dispatched, Partly Received, Received, Cancelled, Rejected
- **New stock_voucher_lines:**
  - id, voucher_id, line_no (unique per voucher)
  - item_id, warehouse_id, to_warehouse_id, bin_id, to_bin_id
  - entered_qty, uom (code text, D-04), uom_factor, qty (base unit)
  - unit_cost, value
  - system_qty, counted_qty, variance_qty, reason_code (FK)
  - dispatched_qty, received_qty, dispatch_value, transit_loss_qty
  - batch_alloc jsonb, legacy_batch_serial
  - audit columns, version
  - CHECK qty > 0 except for ADJ / RCN
- **stock_reason_codes**(code, name, kind GAIN / LOSS / BOTH, gl_key, is_write_off, gst_itc_reversal) —
  seed COUNT_CORRECTION, DAMAGE, EXPIRY, THEFT_LOSS, FOUND, OTHER, TRANSIT_LOSS.
- **stock_ledger** — add:
  - voucher_line_id, batch_id, bin_id, is_backdated, journal_id
  - legacy bool NOT NULL DEFAULT true, then SET DEFAULT false. Old rows become true through the fast
    default, so no UPDATE runs and the append-only trigger is untouched.
  - CHECK (legacy OR voucher_line_id IS NOT NULL)
  - replace the voucher-type CHECK with an FK to the lookup
- **warehouses** — add is_transit, bin_managed, default_receiving_bin_id, pick_method FEFO / FIFO / MANUAL.
  Insert TAL-TRANSIT, SAW-TRANSIT and VAR-TRANSIT.
- **item_type_inventory_keys**.
- **items** — add valuation_method default MOVING_AVG, qc_required, gtin, abc_class, xyz_class,
  CHECK not both batch- and serial-tracked; drop alt_uom columns (E-06; Phase 6 copied them);
  VALIDATE items_hsn_required once "Missing HSN" = 0.

**Migration B `<ts>_phase08_tracking_bins`:**
- wms_zones(warehouse_id, code, name, zone_type, storage_class, temperature, capacity, putaway_priority, pick_sequence)
- wms_racks(zone_id, code, aisle, rack_type, levels, max_load_kg)
- wms_shelves(rack_id, code, level, dimensions, max_weight_kg, storage_rule)
- wms_bins(shelf_id, warehouse_id, zone_id, rack_id, code, bin_type, capacity_cu, putaway_priority,
  status). Warehouse/zone/rack are copied onto the bin and kept consistent by a trigger.
  UNIQUE(warehouse_id, code).
- batches(item_id, batch_no, mfg_date, expiry_date, supplier_name, supplier_id, grn_ref,
  qc_status Pending QC / Released / On Hold / Rejected, recalled, first_received_on).
  UNIQUE(item_id, batch_no).
- serial_numbers(item_id, serial_no, status In Stock / Reserved / In Transit / Issued / Scrapped /
  Returned, warehouse_id, bin_id, batch_id, current_owner, purchase_ref, sales_ref, warranty_end,
  condition, last_ledger_id). UNIQUE(item_id, serial_no).
- stock_ledger_serials(ledger_id, serial_id)
- stock_slices(id, item_id, warehouse_id, batch_id null, bin_id null, on_hand, reserved):
  - unique index on (item, warehouse, COALESCE(batch, nil-uuid), COALESCE(bin, nil-uuid));
  - CHECK on_hand ≥ 0 and reserved ≤ on_hand.
- stock_balances stays the value authority (item + warehouse); add reserved_qty and blocked_qty.

**Migration C `<ts>_phase08_planning_counts`:**
- stock_reservations(code, demand_type Manual / Sales Order / Work Order / Maintenance, demand_ref,
  demand_doc_id, item, warehouse, batch, required_qty, reserved_qty, fulfilled_qty, priority,
  reserved_until, status Waiting / Partial / Reserved / Fulfilled / Released / Expired)
- stock_holds(item, warehouse, batch, qty, reason, source_doc, status)
- reorder_policies(item, warehouse, method ROP_EOQ / MIN_MAX, lead_time_days, sigma_lt,
  service_level, ordering_cost, holding_pct, min_qty, max_qty, order_multiple, preferred_vendor_id)
- reorder_suggestions(policy_id, run_date, adu, sigma_d, ss, rop, eoq, on_hand, open_po,
  in_transit_in, net_req, suggested_qty, status)
- cycle_count_plans(code, warehouse, zone, abc_class, frequency_days, planned_date, supervisor_id,
  blind default true, status)
- cycle_count_lines(plan_id, item, batch, bin, snapshot_at, system_qty, count1, counter1_id, count2,
  counter2_id, final_qty, status Open / Counted / Recount / Stale / Approved)
- physical_counts + lines: same shape plus freeze_at and count_team; warehouses.frozen_by_count_id
- item_barcodes(item_id, barcode, type EAN13 / GTIN14 / CODE128 / QR / GS1_DM, uom, factor),
  label_templates, scan_events

**Data migration of old single-item vouchers** (inside migration A, one transaction):
1. **Pre-flight** (`npm run job:inventory-premigrate`, read-only). Refuses if:
   - any status is unknown;
   - Σledger ≠ stock_balances;
   - serial-tracked items have stock but there is no serial-backfill.csv.
2. Insert one stock_voucher_lines row (line_no=1) per voucher. Copy item, warehouses, qty,
   counted/system/variance, cost, value and dispatch fields. Map reason codes ("Theft/Loss" →
   THEFT_LOSS …). batch_serial goes to legacy_batch_serial. uom = item base UOM, factor 1.
3. Set doc_type from kind (OPENING → OPN …) and is_legacy=true. Keep statuses.
4. **Dispatched transfers:** insert a TRANSIT_IN ledger row into <UNIT>-TRANSIT at dispatch_value, and
   upsert balances and slices.
5. **Batch items with stock:** create batch "MIG-<item code>" (Released, no expiry) with one slice per
   warehouse. Store staff re-batch later through a zero-value ADJ line pair. Serials come from
   serial-backfill.csv; the count must equal on_hand.
6. **Non-bin warehouses:** one slice per item + warehouse with bin NULL.
7. **Verification queries** — the migration fails if any is non-zero:
   - every voucher has exactly 1 line;
   - Σslices = balances;
   - ledger = balances;
   - transit balance = Σ dispatch_value of Dispatched transfers.
8. **GL cut-over** (job, not SQL): `job:inventory-gl-cutover --date` posts one journal per unit:
   - Dr INVENTORY_RM / WIP / FG and STOCK_IN_TRANSIT at current balances;
   - Cr OPENING_BALANCE_EQUITY;
   - needs the accountant's approval; runs once only.

**Migration D `<ts>_phase08_drop_single_item`:**
- Runs only after 3 clean runs and the pre-flight passing on a production copy, **with owner approval**.
- Drops the old header columns: item_id, warehouse_id, to_warehouse_id, qty, counted/system/variance,
  unit_cost, dispatched/received, dispatch_rate, dispatch_value, batch_serial, tx_type, reason_code,
  approver — plus their indexes and CHECKs.

## 5. Services & algorithms
**StockService** — the public contract for later phases (modules/inventory/stock/stock-service.ts):
~~~ts
post(tx, { docType, docId, docNo, postingDate, unitId, lines: MoveLine[], allowBackdated, countId? }): PostResult
// MoveLine {lineId,itemId,warehouseId,binId?,direction:'IN'|'OUT',qty,rate?,value?,batch?:{no,mfg,expiry}|{id},serials?:string[],voucherType,glKey?}
reverse(tx, { docId, cancelDate, reason }): PostResult
transfer(tx, {dispatch|receive, …})            // uses transit warehouse
allocate(tx, { itemId, warehouseId, qty, method:'FEFO'|'FIFO', binPreference? }): Slice[]
reserve / release / consume(tx, reservationId, qty)
hold / releaseHold
availability(db, itemId, warehouseId, batchId?) // {onHand,reserved,blocked,available}
suggestBin(db, itemId, warehouseId, qty)        // for Phase 9 putaway
~~~

**Posting, per document, in one transaction:**
1. Validate lines: item stockable and active, UOM conversion, batch and serial rules.
2. Backdated check for every item + warehouse touched.
3. **Deadlock-free locking:** collect all (item, warehouse) pairs, sort them, then INSERT … ON CONFLICT
   DO NOTHING and SELECT … FOR UPDATE the balances in that order. Slices are touched only while their
   parent is locked.
4. For each line and each slice:
   - postCoreMovement (the renamed postMovement; valuation unchanged);
   - set voucher_line_id, batch and bin on the ledger row;
   - update the slice;
   - serials: update status and insert stock_ledger_serials.
5. Group ledger values by (unit, GL key, side) and call PostingService.post in the same transaction.
   Skip net-zero journals (BIN_MOVE, same-key same-unit direct transfer).
6. Assert inside the transaction that the journal's inventory lines = the ledger values. Otherwise 500
   GL_STOCK_MISMATCH and roll back.

**Transfer:**
- **Dispatch:** TRANSFER_OUT from the source at average, then TRANSIT_IN to <source unit>-TRANSIT at the
  same value. GL: Dr STOCK_IN_TRANSIT / Cr INVENTORY_x (source unit).
- **Receive** (received ≤ outstanding): TRANSIT_OUT at the transit average (the last unit takes the
  remainder), then TRANSFER_IN at the destination at the same value. GL: Dr INVENTORY_x (destination
  unit) / Cr STOCK_IN_TRANSIT. Partial receipts give status Partly Received.
- **Close short:** the remainder becomes TRANSIT_LOSS (reason TRANSIT_LOSS; approval above the
  threshold). GL: Dr STOCK_ADJUSTMENT / Cr STOCK_IN_TRANSIT.
- **Cancel** of a dispatched transfer with nothing received reverses both legs.
- **Direct** (same unit): OUT + IN in one step, with no GL when the key and unit are the same.

**Adjustment (ADJ):**
- Lines carry a counted qty or a ± qty, plus a reason.
- Gains enter at the average; if the average is zero, use the standard cost, then the last receipt
  rate, otherwise 422 UNIT_COST_REQUIRED.
- Losses leave at the average.
- If |Σvalue| > inventory.policy.approvalThreshold (default ₹10,000, a setting), or any write-off
  reason is used, Submit creates an approval request. The approver cannot be the creator
  (403 MAKER_CHECKER).
- The system qty is re-read under lock at post time.

**Counts (reconciliation / physical):**
- The system qty is snapshotted at snapshot_at.
- **Blind count:** users with the Counter role never see the system qty.
- Tolerance: |count1 − system| ≤ 2 % of system **and** value difference ≤ ₹500 (settings). Otherwise
  Recount, which must be done by a different user (409 SAME_COUNTER). Final = count2 if present, else count1.
- A cycle-count line goes **Stale** if any ledger row for its slice is posted after snapshot_at. Stale
  lines are refreshed; Submit → 409 COUNT_STALE.
- A physical count **freezes** the warehouse: other postings → 409 WAREHOUSE_FROZEN.
- Approve creates an RCN voucher (same approval rules as ADJ). Variances post as RECONCILIATION rows,
  with GL as for ADJ.
- Accuracy % = lines within tolerance / lines counted. Record accuracy IRA = 1 − Σ|value variance| /
  Σ system value.

**GL journals** (worked examples; RM item, TAL):
| Voucher | Dr | Cr | Example |
|---|---|---|---|
| OPN 100 @ ₹50 | INVENTORY_RM 5,000 | OPENING_BALANCE_EQUITY 5,000 | |
| RECEIPT, reason FOUND | INVENTORY_RM | STOCK_ADJUSTMENT | 10 @ 52 = 520 |
| ISSUE to department | CONSUMPTION_EXPENSE | INVENTORY_RM | 15 @ avg 50.18 = 752.70 |
| ADJ loss 3 @ 50 | STOCK_ADJUSTMENT 150 | INVENTORY_RM 150 | DAMAGE flags gst_itc_reversal for Phase 11 |
| ADJ gain | INVENTORY_RM | STOCK_ADJUSTMENT | |
| TRF dispatch TAL→SAW 20 @ 50 | STOCK_IN_TRANSIT 1,000 | INVENTORY_RM (TAL) 1,000 | |
| TRF receive 18 | INVENTORY_RM (SAW) 900 | STOCK_IN_TRANSIT 900 | |
| TRF close short 2 | STOCK_ADJUSTMENT 100 | STOCK_IN_TRANSIT 100 | |
| RCN | as ADJ | | |
| Cancel | PostingService reversal dated the cancel date | | |

Later phases follow the same pattern:
- Phase 9 GRN: Dr INVENTORY / Cr GRIR.
- Phase 10 delivery: Dr COGS / Cr INVENTORY.
- Phase 13: Dr WIP / Cr RM; finished goods: Dr FG / Cr WIP.

**Reorder** (pg-boss job inventory.reorder, 02:00 IST):
- ADU = issues over 90 days ÷ 90; σd = sample standard deviation of daily usage, zero days included.
- SS = z·σd·√LT, or z·√(LT·σd² + ADU²·σLT²) when σLT > 0. z: 90 % 1.2816, 95 % 1.6449, 99 % 2.3263
  (interpolated between).
- ROP = ADU·LT + SS.
- EOQ = √(2·ADU·365·S / (h%·avg rate)).
- Position = available + open PO (0 until Phase 9) + in-transit in.
- Triggered when position ≤ ROP. Suggested qty = roundUp(EOQ·(⌊net/EOQ⌋+1), multiple).
  MIN_MAX = max − position.
- Status: Stock-out / Reorder Now / Reorder Soon (≤ 1.25·ROP) / OK.
- **Worked example:** ADU 5, σd 0.7071, LT 9 days, 95 % → SS 3.489, ROP 48.489. With S ₹400, h 20 %,
  average ₹50 → EOQ 382.099. Position 20, multiple 10 → suggest 390.

**ABC:** 365-day consumption value; cumulative ≤ 80 % = A, ≤ 95 % = B, rest = C. Recomputed monthly.

**Ageing:**
- On-hand qty is attributed back over inflows by date (FIFO assumption). Batch items use
  first_received_on.
- Buckets: 0–30, 31–90, 91–180, 180+ days.
- Classes by days since last issue: Fast ≤ 30, Normal ≤ 90, Slow ≤ 180, otherwise Dead.

**Expiry / FEFO:**
- Candidates: Released, not recalled, expiry ≥ posting date, available > 0.
- Order: expiry ascending (no expiry last), then first_received_on, then batch_no.
- Expired batches cannot be issued, reserved or transferred (409 BATCH_EXPIRED); they can only be
  written off with an ADJ reason EXPIRY or DAMAGE.
- Bands: Expired ≤ 0 days, Critical 1–30, High 31–60, Medium 61–90, Low > 90.

**Availability:**
- available = on_hand − reserved − blocked.
- blocked = qty of batches not Released or recalled, plus active holds.
- An issue not tied to a reservation may take at most "available" (409 STOCK_RESERVED).

**Pure calculators** (packages/calc): movingAverage, safetyStock, rop, eoq, zFromService, abc,
ageBuckets, fefoOrder, gs1Parse.

## 6. API
- Typed records endpoints stay (/pages/:pageId/records…). The voucher body is {header…, lines:[…]}
  through the LinesEditor kit; {data,meta}; ETag/If-Match.
- **Actions:** POST /pages/:pageId/records/:id/actions/{submit|approve|reject|post|dispatch|receive|close-short|cancel}
  with an Idempotency-Key. Cancel needs {reason} (at least 5 characters).
- **New endpoints:**
  - GET /inventory/availability?itemId&warehouseId[&batchId]
  - GET /inventory/allocate-preview?itemId&warehouseId&qty
  - GET /inventory/scan?code= (parses GS1 or looks up barcode/bin → {item, batch, serial, bin, qty})
  - GET /inventory/integrity (ledger = balances, Σslices, GL = stock per unit and key)
  - POST /inventory/opening/upload (xlsx → Draft OPN with per-row validation)
  - POST /inventory/counts/:id/{freeze|unfreeze|generate-lines|submit|approve}
  - POST /inventory/reorder/run
  - POST /inventory/batches/:id/actions/{qc-status|extend-expiry|recall}
  - GET /inventory/labels/:id?format=zpl|json

## 7. UI & user flow (index.html look; built for store staff)
**Voucher forms:**
- A header strip (date, warehouse, purpose) above a line grid.
- The first column is "Scan or type item". A keyboard-wedge scanner fills item, batch, expiry and qty
  from GS1; Enter adds the line.
- Each line shows Available live, in green or red.
- Batches and serials open a side panel with a FEFO suggestion pre-filled. Serials are scanned with a
  counter "7 / 10".

**Buttons follow the status:**
- Save Draft → Submit → (Approve) → Post.
- Transfers: Dispatch, Receive, Close Short.
- Posted vouchers are read-only, show the ledger rows, and have a "Journal" link.

**Other screens:**
- Count sheets are printable and blind, with a phone-width entry screen.
- Stock Balance drills down: item → warehouse → bin and batch.
- Valuation has a GL Bridge tab, with a red chip when |variance| > ₹0.01.

## 8. Messages (plain English; 422 for field errors)
| Code | Message / example |
|---|---|
| INSUFFICIENT_STOCK 409 | "Only 4 Nos available of ITM-0012 in TAL-MAIN (bin A-01-02); you asked 6." |
| STOCK_RESERVED 409 | "Only 50 available (30 reserved, 20 blocked)." |
| BACKDATED_POSTING 409 | "ITM-0012 already has a movement on 05-11-2026 in TAL-MAIN. Use that date or later, or ask a manager with Approve." |
| FUTURE_DATE 422 | "Posting date cannot be in the future." |
| PERIOD_CLOSED 409 | (Phase 3 message) |
| BATCH_REQUIRED 422 | "Choose a batch for {item}." |
| BATCH_EXPIRED 409 | "Batch {b} expired on {date}; it can only be written off." |
| BATCH_BLOCKED 409 | "Batch {b} is on QC hold or recalled." |
| SERIAL_QTY_MISMATCH 422 | "Scan exactly {n} serial numbers." |
| SERIAL_DUPLICATE 409 | "Serial {s} is already in stock." |
| SERIAL_NOT_IN_STOCK 409 | "Serial {s} is not in this warehouse." |
| BIN_REQUIRED 422 | "Warehouse is bin-managed: scan a bin." |
| WAREHOUSE_FROZEN 409 | "This warehouse is frozen for a physical count." |
| COUNT_STALE 409 | "Stock moved after the count started. Refresh the stale lines." |
| SAME_COUNTER 409 | "The recount must be done by a different person." |
| MAKER_CHECKER 403 | "You created this document; another person must approve it." |
| REVERSAL_VALUE_NEGATIVE 409 | "Cancelling this would make stock value negative. Post a value adjustment instead." |
| UNIT_COST_REQUIRED 422 | "Enter a unit cost; this item has no average cost yet." |
| UOM_NOT_CONVERTIBLE 422 | "No conversion from {uom} to the base unit of {item}." |
| ITEM_NOT_STOCKED 422 | "{item} is a service and has no stock." |
| TRACKING_LOCKED 409 | "Batch/serial tracking cannot change once stock has moved." |
| VERSION_CONFLICT 412 | "Someone else changed this. Reload and try again." |
| IDEMPOTENCY_MISMATCH 409 | "This Idempotency-Key was already used for a different request." |

Duplicate lines (same item + warehouse + batch + bin) show the warning "merge lines?"; the user can still save.

## 9. Audit & notifications
- **Audit:**
  - VOUCHER_CREATED / UPDATED / SUBMITTED / APPROVED / REJECTED / POSTED / CANCELLED
  - TRANSFER_DISPATCHED / RECEIVED / CLOSED_SHORT
  - BACKDATED_POSTING_ALLOWED
  - BATCH_QC_CHANGED / EXPIRY_EXTENDED / RECALLED
  - SERIAL_STATUS_CHANGED
  - COUNT_FROZEN / SUBMITTED / APPROVED
  - STOCK_FROZEN_BLOCK, RESERVATION_*
  - MIGRATION_PHASE08 (counts)
- **Notifications** (daily 02:00 IST job):
  - low stock (available ≤ ROP, or ≤ reorder level) → Store and Purchase of the unit;
  - near expiry (≤ 30 days) and expired with stock → Store and QC;
  - transfers in transit beyond the expected date + 2 days;
  - stale or overdue counts.
- **Hourly:** GL bridge variance ≠ 0 → Accounts.

## 10. Tests
- **Unit (packages/calc):**
  - moving average (10 @ 100, then 10 @ 120, then issue 15 → 1,650.00);
  - SS / ROP / EOQ example and z interpolation;
  - ABC 80/95;
  - ageing example;
  - FEFO order (B2, B3, B1, B4);
  - GS1 parse of (01)…(17)271231(10)B77(21)S9, with and without the separator.
- **Concurrency:**
  - two parallel issues of the last unit → one 409;
  - 6 issues against 4 units;
  - voucher A (X, Y) and voucher B (Y, X) in parallel ×50 → no deadlock;
  - double post with the same key, and with different keys → one 409;
  - two receives of one transfer.
- **Rules:**
  - backdated refusal and the approve override;
  - no negative slice;
  - reversal-negative guard;
  - full transit lifecycle including close-short;
  - blind count hides system qty;
  - same-user recount refused;
  - frozen warehouse;
  - maker-checker above the threshold.
- **GL invariant (property test):** 1,000 random movements across 3 units; after every step, stock value
  per unit and key = GL, and ledger = balances = Σslices.
- **Migration:** fixture database with old vouchers (posted, cancelled, draft, dispatched, batch stock)
  → migrations A–C → all verification queries return 0; old numbers still resolve; a re-run changes nothing.
- 3 clean runs.

## 11. Acceptance
- [ ] All 22 in-scope pages show real data. A 20-line issue posts in under 2 s.
- [ ] /inventory/integrity is all-zero on a production copy after migration.
- [ ] GL inventory = stock value per unit after the cut-over journal.
- [ ] Every old voucher shows with 1 line and its old number, and cancel still works.
- [ ] Later phases can post only through StockService: a lint rule blocks importing postCoreMovement
      outside the stock module.

## 12. Out of scope
| Item | Owner |
|---|---|
| FIFO / standard costing, NRV revaluation | Backlog |
| Landed cost | Phase 9 |
| Put-away, pick, pack tasks | Phases 9 / 10 |
| RFID, camera scanning | Not planned |
| GST ITC reversal entries (flag only here) | Phase 11 |
| QC-hold flows | Phase 12 |
| Reposting backdated history, negative-stock setting, per-serial reservations | Not planned |

## 13. Owner manual check
1. Open Stock Balance. Do TAL-MAIN totals match the old screen for 5 items?
2. Make an issue slip with 3 scanned items. Does each line show Available?
3. Use a date before the last movement. Does it say "already has a movement on …"?
4. Dispatch TAL → SAW, receive less, then Close Short. Does SAW stock rise and the In Transit tab clear?
5. Post an adjustment over ₹10,000. Does it go to Pending Approval, with only a different user able to approve?
6. Valuation → GL Bridge. Is the variance 0.00?
7. Does the count sheet print without system quantities?
8. Is an old voucher still visible with its old number?

## 14. Build prompt
~~~
Read CLAUDE.md, docs/phases/STANDARDS.md, ROADMAP.md, ERRATA.md, PHASE-08.md, then
apps/api/prisma/migrations/*phase5_inventory*, modules/inventory/** (stock/posting.ts,
vouchers/service.ts, definitions.ts), docs/archive/plans/02-INVENTORY-WMS.md, 02b, 02c, 02d,
docs/archive/plans/DECISIONS.md (D-04, D-11, D-17, D-18, D-20), and the Phase 7 PostingService
contract.
Order:
1 migrations A, B, C + pre-flight job + verification queries;
2 rename postMovement → postCoreMovement (keep a re-export);
3 StockService with sorted locking, slices, batches/serials, backdate guard, PostingService call +
  in-transaction equality assertion;
4 vouchers/service.ts rewritten for header+lines and submit/approve/post/cancel with Phase 5 approvals;
5 transit warehouses + transfer flow (E-24 for different GSTINs);
6 batch/serial/bin masters and pages;
7 reservations and holds;
8 counts and reconciliation;
9 reorder, ageing, expiry, valuation reports + pg-boss jobs;
10 barcode scan + GS1;
11 UI;
12 tests §10;
13 GL cut-over job;
14 migration D ONLY after owner approval.
Rules: routes→controller→service→repository; Decimal only; posted rows never edited; cancel =
reversal of stock AND GL dated the cancel date; no CHECK type lists (D-11); never UPDATE
stock_ledger; no demo data; ask before running any migration on a shared DB. 3 clean runs; attach
/inventory/integrity output to PHASE-08-REPORT.md. Never push; commit only if asked.
