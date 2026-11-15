# 02d - Inventory and WMS: business rules, API, reports, extras (sections 6-9)

Part of `02-INVENTORY-WMS.md`. Table names refer to `02c`; ticket ids to `02f`.

Number formats everywhere: quantities `Decimal` with 3 dp, rates 6 dp, money 2 dp, **round half-up (away from zero on .5)** with `Decimal` (`round2`, `round3`, `round6` in `apps/api/src/modules/inventory/money.ts`). Percentages 4 dp. Never use JavaScript `number` for any of these inside a service; convert to `number` only in the DTO (`num()` in `money.ts`). Dates are `YYYY-MM-DD` strings in the unit's time zone (Asia/Kolkata); "today" comes from one function `today()` (injectable in tests).

---

## 6. Business rules and formulas

Format: **BR-INV-nn** rule - formula - worked example - error on violation - implementing ticket. Error codes marked (new) are added to `apps/api/src/core/http/errors.ts` by T-INV-02 with the HTTP status shown; all others exist.

### 6.1 Posting core and availability

**BR-INV-01 Moving average (built, keep).** Inflow: `value += qty x rate` (or an exact `value`); outflow leaves at the current average `avg = value / on_hand` (6 dp) and `outValue = round2(qty x avg)`; an outflow that empties the stock takes the whole remaining value. Example: receive 10 @ 100 (on hand 10, value 1,000.00, avg 100); receive 10 @ 120 (20, 2,200.00, avg 110); issue 15 -> value out `round2(15 x 110) = 1,650.00`, left 5 / 550.00 / avg 110; issue 5 -> takes all 550.00 (rate 110). Error: 409 `INSUFFICIENT_STOCK`. Ticket: built; regression in T-INV-11, T-INV-20.

**BR-INV-02 Dates and periods (built + clarified).** The posting date defaults to today moved into the voucher's financial year and must lie in it (422 otherwise); the FY must be OPEN (409 `PERIOD_CLOSED`). **A backdated posting is valued at the state of the stock at the time it is posted, not at its date**: no history is recomputed, the average is computed in posting order. Reports that bucket by date use `posting_date`; the running balance columns use `posted_at` order. Example: today 2026-11-02, a receipt posted with date 2026-10-05 is valued with today's average and appears in October's valuation run; October's already-Final run is NOT changed (a Final run is a snapshot) - the next run's opening value takes it. Ticket: T-INV-11.

**BR-INV-03 Availability.** `available = max(0, on_hand - reserved - blocked)` per item x warehouse (and per batch inside a batch). An issue/transfer-dispatch/pick not tied to a reservation may take at most `available`. One tied to reservation R may take at most `max(0, on_hand - (reserved - R.reserved_qty) - blocked)` and at most `R.reserved_qty`. Example: on hand 100, reserved 30 (all by R), blocked 20: available = 50. Issue 60 with no reservation -> 409 `STOCK_RESERVED` "Only 50 available (30 reserved, 20 blocked)". Issue 40 naming R -> allowed (limit `100 - 0 - 20 = 80`, and 40 <= 30? no: 40 > R.reserved_qty 30, so only 30 come from R; the other 10 must come from available (50): rule: first consume `min(qty, R.reserved_qty)` from R, the rest must fit in `available`; here 10 <= 50 -> allowed, `R.fulfilled += 30`, status Fulfilled). Error 409 `STOCK_RESERVED` (new). Tickets: T-INV-11, T-INV-17.

**BR-INV-04 Negative-stock policy.** Setting `inventory.policy.allowNegativeStock` (default false; changed only by SUPER_ADMIN through `PATCH /inventory/policy`, audited `SETTINGS_UPDATED`). When false: as BR-INV-01. When true **and the item is neither batch- nor serial-tracked** and not FIFO: an outflow larger than on hand is posted at the current `avg_rate` (if `avg_rate = 0` then at the item standard cost, else 0 and the response carries `warnings: ["NEGATIVE_STOCK_RATE_UNKNOWN"]`), the ledger row and the balance row get `negative_allowed = true`, the average rate is left unchanged while `on_hand <= 0`, and the balance value becomes `value - outValue` (negative). Example: on hand 5, value 500 (avg 100), issue 8 -> out value `round2(8 x 100) = 800`, on hand -3, value -300, avg stays 100; then receive 10 @ 120 -> on hand 7, value `-300 + 1,200 = 900`, avg `round6(900 / 7) = 128.571429` (the correction of the negative period is absorbed by the average; the valuation report shows it as "negative stock correction"). Reservations never reserve negative stock. Errors: 409 `INSUFFICIENT_STOCK` when false or item tracked/FIFO. Ticket: T-INV-11.

**BR-INV-05 Frozen warehouse.** While `warehouses.frozen_by_count_id` is not null, `StockService.postMovement` for that warehouse is refused 409 `WAREHOUSE_FROZEN` "Warehouse TAL-MAIN is frozen for physical count PHY/TAL/2026-27/0001", **except** movements carrying `countId = that count` (its reconciliation postings). Each refusal writes an audit row `STOCK_FROZEN_BLOCK` (detail: voucher type, item). Reservations and holds are also refused. Tickets: T-INV-11, T-INV-30.

**BR-INV-06 UOM conversion and precision.** `baseQty = round3(enteredQty x factor)`; factor lookup order for (item, uom -> item.base_uom): (1) same UOM -> 1; (2) `uom = item.alt_uom` -> `item.alt_uom_factor` (1 alt = factor base); (3) `uom_conversions` row with this `item_id`; (4) global row (`item_id` NULL); else 422 `UOM_NOT_CONVERTIBLE` (new) "No conversion from Box to Nos for item ITM/00012". Precision (only when `inventory.policy.enforceUomPrecision = true`): the entered qty must have at most `uoms.decimals` decimals of its own UOM, else 422 `UOM_PRECISION` (new). Example: item base Nos, alt Box factor 12; enter 2.5 Box -> baseQty 30.000; with enforce on, Box decimals 0 -> 422 on 2.5. The conversion factor is stored on the voucher (`uom`, `uom_factor`, `entered_qty`) so later factor changes never alter posted history. Tickets: T-INV-02, T-INV-15.

### 6.2 Tracking: batch, serial, expiry, QC

**BR-INV-07 Batch rules.** A batch-tracked item needs a batch on every posted movement: receipt/opening/inbound transfer (creates the batch when `batchNo` is new for the item: `mfgDate` required, `expiryDate` required when `shelfLifeDays` is set; default `expiryDate = mfgDate + shelfLifeDays` days), issue/outbound (existing batch; blank -> FEFO auto-allocation BR-INV-11). Constraints: `mfgDate <= posting date`; `expiryDate > mfgDate`; a receipt of a batch whose expiry is before the posting date is refused. Errors: 422 `BATCH_REQUIRED` (new) "Item X is batch-tracked: enter a batch number", 422 field errors for dates. Example: shelfLifeDays 365, mfg 2026-10-01 -> expiry 2027-10-01 (365 days after: 2026-10-01 + 365 = 2027-10-01). Tickets: T-INV-12, T-INV-15.

**BR-INV-08 Batch immutability.** Once a batch has any ledger row: `item`, `batchNo`, `mfgDate` cannot change (409 `CONFLICT`); `expiryDate` can only be extended (new date > old) through the action `extend-expiry` with a reason of at least 5 characters, audited `BATCH_EXPIRY_EXTENDED`; supplier, GRN ref, disposition, owner stay editable. Ticket: T-INV-12.

**BR-INV-09 Batch QC status.** `Pending QC`, `On Hold`, `Rejected` batches are **blocked**: on hand but not available; issue/transfer/pick/reserve of them -> 409 `BATCH_BLOCKED` (new) "Batch B-77 is On Hold". `Released` is the only available state. Allowed changes: Pending QC -> Released/On Hold/Rejected; On Hold -> Released/Rejected; Rejected -> On Hold only (re-inspection); Released -> On Hold. Each change needs a reason, writes `batch_events` and audit `BATCH_QC_CHANGED`. A **write-off of blocked stock** by an Adjustment with reason Damage/Expiry is allowed. Releasing triggers the allocator (BR-INV-17). Tickets: T-INV-12, T-INV-11.

**BR-INV-10 Expiry.** A batch with `expiry_date < posting_date` is expired: issue, dispatch of a transfer, reservation, pick, and pack dispatch of it -> 409 `BATCH_EXPIRED` (new). Exception: an Adjustment/Reconciliation/scrap with reason `Expiry` or `Damage` may post. `expiry_date = posting_date` is still usable on that day. Ticket: T-INV-11.

**BR-INV-11 FEFO / FIFO allocation.** Candidate batches (of the item in the warehouse): `Released`, not recalled, not expired, `available_batch = on_hand - reserved > 0`. FEFO order: `expiry_date ASC NULLS LAST`, then batch creation time ASC (older first), then `batch_no ASC`. FIFO order: batch creation time ASC, then `batch_no`. Allocate greedily until the quantity is covered; if not covered the allocation is partial and the caller decides (issue voucher: 409 `INSUFFICIENT_STOCK`; pick: short). Example (FEFO), warehouse W, item X: B1 exp 2026-12-15 qty 10; B2 exp 2026-11-20 qty 5; B3 exp 2026-11-20 qty 8 (received after B2); B4 no expiry qty 20; B5 expired 2026-10-01 qty 4; B6 On Hold qty 7. Order: B2, B3, B1, B4 (B5 and B6 excluded). Issue 20 -> B2 5, B3 8, B1 7. Tickets: T-INV-15, T-INV-27.

**BR-INV-12 Serial rules.** A serial-tracked item: quantity must be a whole number; the list of serials (`serialNos`, trimmed, case-sensitive, unique inside the request) must have exactly `qty` entries -> 422 `SERIAL_QTY_MISMATCH` (new). Receipt/opening: each serial must not exist for the item -> 409 `SERIAL_DUPLICATE` (new) (a `Scrapped` serial can never be reused). Issue/transfer-out: each serial must be `In Stock` (or `Reserved` by the same reservation) in the source warehouse -> 409 `SERIAL_NOT_IN_STOCK` (new). Serial status changes: receipt -> In Stock; reservation (optional) -> Reserved; transfer dispatch -> In Transit, receive -> In Stock (destination); issue -> Issued with `current_owner` = reference/customer; return receipt of an Issued serial -> Returned then In Stock; Adjustment with reason Damage/Theft -> Scrapped. Every change writes a `serial_events` row linked to the ledger row. Serial items are never FIFO-layered per serial; valuation follows the item's method. Tickets: T-INV-13, T-INV-15.

**BR-INV-13 One kind of tracking.** An item cannot be both batch- and serial-tracked: 422 `TRACKING_CONFLICT` (new) on create/update of the item (DB: `items_one_tracking`, NOT VALID). Ticket: T-INV-12.

**BR-INV-14 Tracking flags are locked by stock.** `batch_tracked`, `serial_tracked` cannot change once the item has any ledger row: 409 `TRACKING_LOCKED` (new) "Item has stock history: create a new item instead". Ticket: T-INV-12.

**BR-INV-15 Reservation create.** Required qty > 0 (422); item and warehouse active; warehouse in the context unit; batch (if given) belongs to the item, is Released and not expired; the allocator runs inside the creating transaction (see 4.2). `reserved_until` default today + `reservationDays`; if given must be >= today (422). Reserved qty never exceeds required. Ticket: T-INV-17.

**BR-INV-16 Reservation end.** `Release` (user): sets status Released, `release_reason`, returns `reserved_qty` to available (balance `reserved_qty -= R.reserved_qty`), reruns allocator for others. `Expire` (daily job): reservations with `reserved_until < today` and status Waiting/Partial/Reserved -> Expired, same quantity logic. `Extend`: `reserved_until += 7 days` (max 3 times? no limit, audited). A reservation consumed fully by issues is Fulfilled (terminal). Setting `autoReleaseReservations=false` disables the job; `releaseOnDemandCancel` is used by Sales later via `StockService.release`. Ticket: T-INV-17.

**BR-INV-17 Allocation order.** For one item x warehouse the allocator serves open reservations (status Waiting/Partial) in order: priority rank (Critical 1, High 2, Medium 3, Low 4), `reserved_until ASC NULLS LAST`, `created_at ASC`, `code ASC`; each gets `min(required - reserved - fulfilled, available_remaining)`. It runs after every inflow, release, batch QC release, hold release and reservation change, inside the same transaction, under the `stock_balances` row lock. Example: available 10 after a receipt; waiting: R1 High need 6, R2 Critical need 8, R3 High need 6 older than R1. Order: R2 (Critical) gets 8, then R3 (High, older) gets 2 (Partial), R1 gets 0. Ticket: T-INV-17.

**BR-INV-18 Blocked and holds.** `blocked(item, wh) = Sigma over batches of the item in wh [ if batch.qc_status <> 'Released' or batch.recalled then batch.on_hand else least(batch.on_hand, Sigma active holds on that batch) ] + Sigma active holds of the item in wh with batch_id NULL`. A hold (`stock_holds`, status Active) needs qty <= available at creation (409 `STOCK_RESERVED`); releasing sets Released. Example: item not batch-tracked, on hand 100, hold 15 -> blocked 15, available 85 (if no reservations). Ticket: T-INV-11, T-INV-16.

**BR-INV-19 Corrective movements shorten reservations.** After any movement that lowers on hand (Adjustment, Reconciliation, scrap) the balance must satisfy `reserved <= on_hand` (DB CHECK). If it would not, the engine releases quantity from reservations in reverse allocation order (Low before Critical; newest first) until it holds: each touched reservation drops to Partial/Waiting (`reserved_qty` reduced), audited `RESERVATION_SHORTENED` with the reservation codes. A normal Issue/Transfer never needs this (BR-INV-03 stops it earlier). Example: on hand 10, reserved 8 (R1 5 Critical, R2 3 Low); adjustment to 6 -> reserved must be <= 6: R2 loses 2 (3 -> 1, Partial), R1 untouched. Ticket: T-INV-17.

### 6.3 Valuation

**BR-INV-20 FIFO layers.** Item `valuation_method = 'FIFO'`: each inflow creates a `stock_cost_layers` row (`qty_remaining = qty`, `rate`); an outflow consumes layers `ORDER BY received_on ASC, created_at ASC, id ASC` (for a batch-tracked FIFO item, only the layers of that batch), writing `stock_layer_consumptions`; `out value = Sigma round6?` computed as `Sigma round2(consumed_qty x layer_rate)` then rounded so that the sum equals the ledger value exactly (last piece takes the remainder); ledger `rate = round6(out value / qty)`. The balance `value` stays Sigma of remaining layer values; `avg_rate = value / on_hand`. Example: layers [10 @ 100], [10 @ 120]; issue 15 -> consumes 10 @ 100 = 1,000.00 and 5 @ 120 = 600.00, out value 1,600.00, rate 106.666667; remaining [5 @ 120] = 600.00 (ERPNext shows the same numbers, Moving Average would give 1,650). Reversal of an outflow restores the consumed layers from `stock_layer_consumptions`; reversal of an inflow requires its layer to be untouched (`qty_remaining = qty_in`) else 409 `LAYER_CONSUMED` (new). Ticket: T-INV-20.

**BR-INV-21 Standard cost.** `valuation_method = 'STANDARD'`: every movement is valued at `items.standard_cost` (must be set, else 422 `UNIT_COST_REQUIRED`... use `STANDARD_COST_MISSING` (new, 422)); for an inflow with an actual rate the price variance `ppv = round2(qty x (actualRate - standardCost))` is stored on the ledger row (`ledger.ppv`) and passed in the accounting payload (positive = paid more than standard, an unfavourable variance); the balance value is `qty x standard`. Example: standard 100, receipt 10 @ actual 110 -> ledger value 1,000.00, `ppv = 100.00`. Changing `standard_cost` of an item that has stock does **not** revalue by itself; Finance/Store uses a STANDARD revaluation (BR-INV-23). Ticket: T-INV-20.

**BR-INV-22 Valuation method lock.** `valuation_method` may change only while the item has no ledger row (409 `VALUATION_METHOD_LOCKED` (new)); a change of method on an item with history is done by creating a new item. (ERPNext allows FIFO to Moving Average only; we avoid the hybrid history.) Ticket: T-INV-20 (the check) and T-INV-03? no: T-INV-20.

**BR-INV-23 Revaluation.** Document `stock_revaluations`, kinds RATE (moving-average items), STANDARD (standard-cost items), NRV, NRV_REVERSAL, LANDED. At Post, under the balance lock: `qty_at_post = on_hand`; RATE: `new_value = round2(on_hand x new_rate)`, `delta = new_value - value`; STANDARD: set `items.standard_cost = new_rate` in the same transaction for ALL warehouses and post one revaluation per warehouse with stock (one document per item x warehouse; the page creates them together), `delta = round2(on_hand x new_rate) - value`; the REVALUATION ledger row has quantity 0, `value = delta` (signed), `balance_value = value + delta`, rate = new average (`new_value / on_hand`), voucher_type `REVALUATION`; `stock_balances.value += delta`, `avg_rate` recomputed. FIFO items: RATE is refused (422 `NOT_SUPPORTED_FOR_FIFO`: use NRV or LANDED) because layers carry the rates. Refused when on hand is 0 (422 "No stock to revalue") and when `delta = 0`. Example: on hand 20, value 2,200 (avg 110), new rate 115 -> new value 2,300.00, delta +100.00; accounting `STOCK_REVALUATION_POSTED` Dr `INVENTORY` 100 / Cr `INVENTORY_REVALUATION_GAIN` 100. Cancelling a Posted revaluation posts the opposite delta (a REVERSAL-type pair: ledger `REVERSAL` with `reverses_id`) only if no outflow happened since (else 409 `CONFLICT` "Stock moved after this revaluation; post a new revaluation"). Ticket: T-INV-21.

**BR-INV-24 Value identity (invariant INV-1).** For every item x warehouse: `stock_balances.on_hand = Sigma(qty_in - qty_out)` and `stock_balances.value = Sigma(ledger.value)` (signed values). For every ledger row: `balance_qty` and `balance_value` equal the running totals in `posted_at` order. Tested by the simulation (T-INV-40) and by `GET /inventory/integrity`. Ticket: T-INV-40.

**BR-INV-25 Valuation buckets.** For a run [from, to] and an item x warehouse: `bucket(row)` is `Receipt` for voucher types OPENING, RECEIPT, TRANSFER_IN; `Issue` for ISSUE, TRANSFER_OUT; `Adjustment` for ADJUSTMENT, RECONCILIATION, REVALUATION; a REVERSAL row takes the bucket of the row it reverses (`reverses_id`). `opening_value = Sigma(value) for posting_date < from`; `receipt_value = Sigma(value) in Receipt bucket within [from, to]`; `issue_value = -Sigma(value) in Issue bucket`; `adjustment_value = Sigma(value) in Adjustment bucket`; `closing_value = opening + receipt - issue + adjustment` (also a DB CHECK) and must equal `Sigma(value) for posting_date <= to`; `closing_qty = Sigma(qty_in - qty_out) for posting_date <= to`. Example: opening 1,000; receipt +2,200; issue 1,650 (ledger value -1,650); adjustment -110 -> closing = 1,000 + 2,200 - 1,650 + (-110) = 1,440. Ticket: T-INV-21.

**BR-INV-26 GL bridge.** `GlBridge.inventoryBalance(tx, {unitId, asOf, warehouseId?})` returns the net of `INVENTORY` role postings or `null`. Until Finance registers an implementation it returns `null` and the UI shows "Finance not live". When available: `variance = closing_value (unit) - glBalance`; a Final run stores both; `abs(variance) > 0.01` is flagged red and listed in Stock Health. Ticket: T-INV-21.

**BR-INV-27 Net realisable value (Ind AS 2).** Kind NRV: `delta = -(value - round2(on_hand x nrvRate))` only when nrvRate < current average (a write-down), reason required, stored as a negative delta; kind NRV_REVERSAL: allowed up to the cumulative posted NRV write-downs of the same item x warehouse that have not been reversed: `reversal <= Sigma(NRV deltas posted) + Sigma(NRV_REVERSAL deltas posted)` (the sum of NRV deltas is negative), and never above original cost (average before write-down). Error 422 `NRV_REVERSAL_EXCEEDS_WRITEDOWN` (new). Example: write-down 500.00 posted; later reversal of 200.00 -> ok; another 400.00 -> 422 (only 300.00 left). The GST consequence: a write-down is **not** a write-off (no `gstItcReversal`). Ticket: T-INV-21.

**BR-INV-28 Landed cost hook.** `StockService.applyLandedCost(tx, {receiptLedgerIds[], amount, allocation: 'VALUE'|'QTY', docType, docId, date})` allocates `amount` over the receipt rows pro rata to their value (or quantity), `share_i = round2(amount x value_i / Sigma value)`, last row gets the remainder. For each row: `onHandPart = round2(share_i x min(qty_i, current on_hand of that item x warehouse) / qty_i)`, `consumedPart = share_i - onHandPart`. The on-hand part is posted as a REVALUATION (kind LANDED) increasing stock value (and, for FIFO, the layer rate of that layer: `rate += onHandPart / qty_remaining`); the consumed part goes to the accounting payload as `LANDED_COST_VARIANCE`. Example: receipt 100 pcs value 10,000; freight 1,000; 40 pcs already issued, 60 on hand: share 1,000.00; onHandPart `round2(1,000 x 60/100) = 600.00`, consumedPart 400.00. Ticket: T-INV-21.

**BR-INV-29 Costing of a reconciliation gain.** unit cost for a positive variance when `avg_rate = 0`: item standard cost, else the rate of the last RECEIPT/OPENING ledger row of the item, else 422 `UNIT_COST_REQUIRED` (new). Ticket: T-INV-23.

### 6.4 Counts, adjustments, reconciliation

**BR-INV-30 Adjustment approval (maker-checker).** Setting `approvalThresholdValue` (default 10,000.00). Posting an Adjustment whose `abs(valueImpact) > threshold` requires the poster to have `approve` on `inv-adjustment` **and** not be the creator: 403 `MAKER_CHECKER` (new) "Above 10,000.00 a different approver must post this adjustment"; on success `approved_by_id` = poster and the `approver` text is set to the poster's name. At or below the threshold the built behaviour is unchanged (any user with `edit` posts). The Draft preview already shows the value impact. Example: variance -150 x avg 80 = -12,000.00 > 10,000 -> creator gets 403; a Manager with `approve` posts it. Ticket: T-INV-15.

**BR-INV-31 Reconciliation line.** `variance = physical - system`; `valueVariance = round2(variance x unitCost)`, `unitCost` = moving average (FIFO: the weighted cost of the layers consumed for a loss, BR-INV-29 for a gain). At Post (under the balance lock) `system` is re-read; `variance` and value are recomputed with the locked figures (so the snapshot never causes a wrong posting); a gain is an inflow at `unitCost`, a loss an outflow at the average / layers. Zero variance posts nothing (status Posted, `posting_ref` empty). Root cause (code + text) is required when `abs(valueVariance) >= reconThresholdValue` (10,000.00) -> 422 field `rootCauseCode`; approval by a user other than the creator (`approve` permission) is required for the same condition -> 403 `MAKER_CHECKER`. Example: system 50, physical 47, average 120 -> variance -3, value -360.00, outflow 3 @ 120. Statuses: Draft -> Under Review (Submit) -> Approved -> Posted; Under Review -> Rejected -> Draft (editable again); Draft/Under Review/Approved -> Cancelled; Posted -> Cancelled by reversal (needs `delete`). Lines created by an approved count start `Approved`. Ticket: T-INV-23.

**BR-INV-32 Count tolerance and recount.** A counted line is within tolerance when `abs(c1 - system) <= system x tolerancePct / 100` **and** `abs(c1 - system) x unitCost <= toleranceValue`; a system qty of 0 allows no difference. Otherwise status `Recount` and a second count by a **different user** is required (409 `SAME_COUNTER` (new) if the same user). `final = c2` when present else `c1`. The recount is final: no third count (the supervisor can reject the plan and re-plan). Example: system 200, tolerance 2 % = 4 units, count 205 -> difference 5 > 4 -> recount, even though 5 x 100 = 500 <= 500. Tickets: T-INV-29, T-INV-30.

**BR-INV-33 Count accuracy.** Line accuracy `accuracyPct = round(100 x lines with abs(final - system) <= tolerance / lines counted, 1 dp)`; value accuracy (IRA) `= max(0, 1 - Sigma abs(valueVariance) / Sigma(system x unitCost)) x 100`. Example: 20 lines, 17 within tolerance -> 85.0 %; system value 2,000,000.00, absolute variance 30,000.00 -> IRA 98.5 %. Ticket: T-INV-29.

**BR-INV-34 Stale counts.** A line is `Stale` (and its `system_qty` refreshed, counts cleared) when any stock ledger row for its item x warehouse (x batch) has `posted_at > snapshot_at`, detected on count entry and on Submit. Not applicable in a physical count (the warehouse is frozen). Error 409 `COUNT_STALE` (new) when a user tries to submit a plan with stale lines. Ticket: T-INV-29.

**BR-INV-35 Physical count freeze.** `Freeze` is allowed when status Planned, the warehouse is not already frozen (409 `WAREHOUSE_FROZEN`) and there are no Dispatched (in-transit) transfers *from* it? (they can still be received; only outgoing dispatches are blocked by BR-INV-05). Freeze snapshots every item x bin x batch with `on_hand > 0` into `physical_count_lines` (a bin-less warehouse: one line per item x batch). Unfreeze happens on Post, Cancel, or the Unfreeze button (Planned/Frozen/Counting only, `delete` permission). Ticket: T-INV-30.

**BR-INV-36 CARO discrepancy flag.** For a physical count: per inventory class (`items.item_type`), `netVariancePct = abs(Sigma valueVariance of the class) / Sigma(system value of the class) x 100`. If `>= 10` the class is flagged `Report in CARO 3(ii)(a)` (red chip, listed in the Reconciliation tab). Net basis (excess and shortage netted) as per the commentary found; confirm with the auditor *(unverified)*. Example: class Raw Material book value 5,000,000; shortages -400,000 and excesses +150,000 -> net -250,000 -> 5.0 % (no flag); shortages -700,000, excess +150,000 -> 11.0 % (flag). Ticket: T-INV-30.

**BR-INV-37 ABC classification.** For each item, `annualValue = Sigma(qty_out x average rate at issue) over the last 365 days` for voucher types ISSUE (net of reversals) - consumption value; sort descending; `cumPct` = running share of the total **including the item**; class A if `cumPct <= aCumPct (80)`, B if `<= bCumPct (95)`, else C; the first item is always A; items with annualValue 0 are C. Example in 3.2 data: values 5.0M, 3.0M, 1.0M, 0.5M, 0.3M, 0.2M (total 10.0M): cum 50, 80, 90, 95, 98, 100 -> A, A, B, B, C, C. Ticket: T-INV-24.

**BR-INV-38 XYZ classification.** `cv = stddev_sample(monthly issue qty, last 12 months, zero months included) / mean`; X if `cv <= 0.5`, Y if `<= 1.0`, Z otherwise; mean 0 -> Z. Example monthly [10,12,8,10,10,10,12,8,10,10,10,10]: mean 10, sample stddev about 1.206 -> cv 0.12 -> X. Ticket: T-INV-24.

**BR-INV-39 Cycle count schedule.** `nextCountDate(item) = lastCompletedCountDate + freqDays[class]` (A 30, B 90, C 365 by default, from the policy); an item never counted is due now. `Generate Due Counts` creates one plan per warehouse containing the due items of the chosen classes (max 200 lines per plan; more -> several plans), `planned_date = today`. Frequency label of a plan: 30 -> Monthly, 90 -> Quarterly, 365 -> Yearly (A weekly = 7, half-yearly = 182 selectable manually). `lastCompletedCountDate` = latest `completed_at` of a plan/physical count line containing the item, or a posted reconciliation of count type Cycle/Physical. Ticket: T-INV-29.

### 6.5 Reorder, ageing, expiry

**BR-INV-40 Average daily usage.** Window = `usageWindowDays` (90) ending today. `usage = Sigma(ISSUE qty_out) - Sigma(qty returned by reversal of ISSUE)` of the item in the warehouse (only voucher type ISSUE; transfers, adjustments and scrap are not consumption); `ADU = round3(usage / window)`. Daily buckets (zeros included) give `sigma_d` = **sample** standard deviation (n-1). Example daily usage over 5 days [4,6,5,5,5]: ADU 5.000; deviations 1,1,0,0,0 -> variance `2/4 = 0.5` -> `sigma_d = 0.707107`. Ticket: T-INV-35.

**BR-INV-41 Safety stock.** `SS = z x sigma_d x sqrt(LT)`; with lead-time variability `sigma_LT > 0`: `SS = z x sqrt(LT x sigma_d^2 + ADU^2 x sigma_LT^2)`; `z` from the service level by this table with linear interpolation between rows: 50 -> 0.0000, 80 -> 0.8416, 85 -> 1.0364, 90 -> 1.2816, 92 -> 1.4051, 94 -> 1.5548, 95 -> 1.6449, 96 -> 1.7507, 97 -> 1.8808, 97.5 -> 1.9600, 98 -> 2.0537, 99 -> 2.3263, 99.5 -> 2.5758, 99.9 -> 3.0902. Round3. Example: ADU 5, sigma_d 0.707107, LT 9, service 95 % -> `SS = 1.6449 x 0.707107 x 3 = 3.489`; with sigma_LT 2: `1.6449 x sqrt(9 x 0.5 + 25 x 4) = 1.6449 x sqrt(104.5) = 1.6449 x 10.22252 = 16.815`. Ticket: T-INV-35.

**BR-INV-42 Reorder level.** `ROP = round3(ADU x LT + SS)` (+ `ADU x reviewDays` when `reviewDays > 0`). Example: `5 x 9 + 3.489 = 48.489`. A manual `reorder_level` on the item is used only when no policy exists. Ticket: T-INV-35.

**BR-INV-43 EOQ.** `D = ADU x 365`; `H = holdingCostPct / 100 x unitCost` where unitCost = average rate (standard cost if the average is 0); `EOQ = round3(sqrt(2 x D x S / H))`, `S = orderingCost`; 0 when `S` or `H` is 0. Example: ADU 5 -> D 1,825; S 400; unit cost 50, holding 20 % -> H 10; EOQ `sqrt(2 x 1,825 x 400 / 10) = sqrt(146,000) = 382.099`. Ticket: T-INV-35.

**BR-INV-44 Net requirement and suggested quantity.** `position = available + openPO + inTransitIn` (available per BR-INV-03; in-transit-in = dispatched transfer qty not yet received to this warehouse; openPO from `OpenSupplyProvider`, 0 without SCM). Trigger level `T = ROP` (method ROP_EOQ) or `min_qty` (MIN_MAX). `netRequirement = max(0, T - position)` (3 dp). Triggered when `position <= T` (ROP_EOQ) or `position < T` (MIN_MAX). Suggested: ROP_EOQ with EOQ > 0 -> `roundUp(EOQ x (floor(netRequirement / EOQ) + 1), multiple)`; EOQ = 0 -> `roundUp(max(netRequirement, multiple), multiple)`; MIN_MAX -> `roundUp(max_qty - position, multiple)`. `roundUp(x, m) = ceil(x / m) x m`. Status: `Stock-out` if available = 0; `Reorder Now` if triggered; `Reorder Soon` if not triggered but `position <= T x 1.25`; `Inactive` if policy inactive; else `OK`. Examples: ROP_EOQ ROP 48.489, EOQ 382.099, multiple 10, position 20 -> net 28.489 -> `floor(28.489/382.099)+1 = 1` -> `382.099` -> roundUp to 10 -> 390. MIN_MAX min 50, max 200, multiple 25, position 30 -> triggered, `200 - 30 = 170` -> 175. One Open suggestion per policy (updated, not duplicated). Ticket: T-INV-35.

**BR-INV-45 Forecast accuracy.** Forecast for month m = mean of the previous 3 months' issue qty; over the last 6 months `WAPE = Sigma abs(A - F) / Sigma A`, accuracy `= max(0, 1 - WAPE) x 100`, `bias = Sigma(F - A) / Sigma A`. Example A = [100,120,80], F = [110,100,110]: Sigma abs = 60, Sigma A = 300 -> WAPE 0.2 -> accuracy 80.0 %, bias `(10-20+30)/300 = +6.7 %`. Ticket: T-INV-35.

**BR-INV-46 Stock age.** For an item x warehouse the on-hand quantity is attributed to the **most recent inflows backwards** (equivalent to FIFO consumption): inflows = ledger rows with `qty_in > 0` of types OPENING, RECEIPT, TRANSFER_IN, ADJUSTMENT, RECONCILIATION (net of reversed rows), ordered by `posting_date DESC, posted_at DESC`; take rows until the sum reaches on hand (the last row partially). `age = asOf - posting_date`. Buckets 0-30, 31-90, 91-180, 180+ (columns `f030Qty`, `f3190Qty`, `f91180Qty`, `f180PlusQty`); `ageDays = round(Sigma(qty x age) / on_hand)` half-up. Example (asOf 2026-11-02): inflows 2026-05-01 +100, 2026-08-15 +50, 2026-10-20 +30; issues 120 in between; on hand 60 -> attributed 30 (13 days old) + 30 from the 08-15 row (79 days) -> bucket 0-30 = 30, 31-90 = 30, `ageDays = round((30x13 + 30x79)/60) = 46`. For FIFO items the real open layers are used (same result). A transfer-in resets the age (documented limitation, backlog X-30). Ticket: T-INV-24.

**BR-INV-47 Movement class.** `lastIssue = max(posting_date)` of ISSUE rows (net of reversals) of the item x warehouse; `days = asOf - lastIssue` (no issue ever: days since first receipt). `Fast Moving` if `days <= movementDays.fast (30)`; `Normal` if `<= 90`; `Slow Moving` if `<= 180`; else `Dead Stock`. Items with on hand 0 are not listed. Suggested `Action` text: Fast "Keep safety stock"; Normal "-"; Slow "Review reorder policy; consider transfer to a warehouse with demand"; Dead "Liquidate, return to supplier or scrap (NRV review)". Ticket: T-INV-24.

**BR-INV-48 Expiry bands.** `daysToExpiry = expiry_date - today`. Band: `Expired` (<= 0), `Critical` (1-30), `High` (31-60), `Medium` (61-90), `Low` (> 90); status `Expired` (<= 0), `Near Expiry` (1 to `nearExpiryDays`), `Disposed` (disposition Scrap/Return to Supplier/Donate and available = 0), else `OK`. `fefoRank` = rank by FEFO order (BR-INV-11) within item x warehouse. Rows exist only for batch x warehouse with `on_hand > 0`. Ticket: T-INV-18.

**BR-INV-49 Expiry loss.** `Expiry Loss` of a month = abs(Sigma `value_impact`) of **posted** Adjustments/Reconciliations with reason `Expiry` (or root cause Damage on an expired batch) posted in the month. Value currently at risk = Sigma(stock value of expired batches with stock). Ticket: T-INV-18.

### 6.6 WMS

**BR-INV-50 Location hierarchy and enabling bins.** `warehouse > zone > rack > shelf > bin`; every child carries `warehouse_id` and a composite FK makes cross-warehouse links impossible. Codes: zone unique per warehouse (`^[A-Z0-9_-]{1,12}$`), rack per warehouse, shelf per rack, bin per warehouse; codes are upper-cased by the server and never reused (soft-deleted rows keep them). A zone/rack/shelf/bin with stock/children cannot be deactivated or deleted (409 `IN_USE`; bin with stock 409 `BIN_NOT_EMPTY`). **Enabling `bin_managed`** (action on the warehouse, needs `edit`): requires no open Dispatched transfer from/to it and not frozen; in one transaction creates zone `RCV` (Receiving) and `DSP` (Dispatch) if missing, system bins `STAGING` (zone RCV) and `OUTBOUND` (zone DSP) (`is_system`, type Staging, capacity 0 = unlimited), then writes one `stock_bin_balances` row in STAGING for every item x batch with stock (qty = on hand), creates the default putaway rule, and one `stock_bin_moves` row (COUNT-free type `RECEIPT`, task_type `INIT`). Disabling is allowed only if all stock is in STAGING (409 `BIN_NOT_EMPTY`). Tickets: T-INV-08, T-INV-09.

**BR-INV-51 Capacity.** Capacity units (CU): `occupied(bin) = Sigma(stock_bin_balances.qty x items.storage_units)`. A putaway / replenishment into a bin with `capacity > 0` needs `occupied + qty x storage_units <= capacity` else 409 `BIN_CAPACITY_EXCEEDED` (new); `capacity = 0` means unlimited. Hierarchy sums: `Sigma(active bin capacity in a zone) <= zone.capacity` when the zone capacity is set, and `Sigma(zone capacity) <= warehouse.total_capacity` when set, else 422 `CAPACITY_EXCEEDED` (new) on the create/update that breaks it. Example: zone capacity 1,000; bins 400 + 400 exist; creating a bin of 300 -> 422 (total 1,100); creating a bin of 200 -> ok. Putaway of 30 Nos (storage_units 2 -> 60 CU) into a bin with capacity 100, occupied 50 -> 110 > 100 -> 409. Tickets: T-INV-08, T-INV-09, T-INV-26.

**BR-INV-52 Putaway suggestion.** Input: task (item, batch, qty), warehouse. Steps: (1) active rules of the warehouse ordered by `priority ASC, id`; a rule matches when each of its non-null filters equals the item (item_id, item_category, item_type) or the item's storage class (derived from the zone it is preferably stored in? no: from `items.item_type`? ) - **storage class filter matches `zones.storage_class` of the candidate bins**, not the item; (2) candidate bins of the rule: `fixed_bin_id` if set, else bins in `zone_id` (if set) of `target_bin_type` (if set); bins must be Active, not system, not Quarantine unless the item batch is `On Hold`; Pick Face bins only if `fixed_item_id` equals the item; (3) drop bins that cannot take the quantity: capacity (BR-INV-51) - if no bin can take it all, allow the best bin to take part and the rest becomes a second task; mixing: if `allow_mix_items = false` drop bins that contain another item, if `allow_mix_batches = false` drop bins with another batch of the item; (4) rank: (a) bins that already contain the same item (consolidation) first, (b) zone `putaway_priority` (High, Medium, Low), (c) bin `putaway_priority`, (d) least free space that still fits (tight packing), (e) `code`. (5) The first is `suggested_bin_id` with `suggested_rule_id`; top 3 are shown. No rule matches / no candidate -> task status Exception "No bin available". Example: item X, rule 1 (priority 10, zone STO, Pallet bins); bins P1 (cap 100, occupied 90), P2 (cap 100, occupied 20, already has X), P3 (cap 100, empty); qty 30 (30 CU): P1 dropped (120 > 100); P2 contains X -> first; suggestion P2. Ticket: T-INV-26.

**BR-INV-53 Putaway completion.** Complete with `chosenBin` (default the suggestion) and `qty <= qty - done_qty`: checks bin Active (409 `BIN_BLOCKED`), capacity (BR-INV-51), then moves STAGING -> bin (`stock_bin_balances` -1/+1, `stock_bin_moves` PUTAWAY); `done_qty += qty`; status In Progress until `done_qty = qty` then Completed with `completed_at`. A put-away to a bin whose zone has a stricter temperature/storage class than the item allows is refused if the zone `allowed_item_types` is set and excludes the item type: 422 `ZONE_RESTRICTION`. Ticket: T-INV-26.

**BR-INV-54 Pick allocation and route.** For a reservation of qty Q in a bin-managed warehouse: batches in FEFO or FIFO order (BR-INV-11); inside a batch, bins ordered: Pick Face bins first, then bins with the smallest quantity that still covers the remainder, else largest first; take `min(remaining, bin qty - qty already allocated to open tasks)`. One task per (bin, batch). Warehouses that are not bin-managed create tasks with `from_bin_id` NULL (pick by batch only). Route sequence: sort the wave's tasks by `(zone.pick_sequence, rack.aisle, rack.code, shelf.level_no, bin.code)` ascending, `route_seq = 1..n`. Example: tasks in bins STO-A01-R1-L1-01, STO-A01-R1-L2-01, PCK-B02... with zone sequences STO 20, PCK 10 -> PCK first. Ticket: T-INV-27.

**BR-INV-55 Short pick.** Confirm with `picked < required`: the picker chooses a reason (Not found, Damaged, Location empty, Other); `short_qty = required - picked`, status `Short Picked`. The system looks for other bins with unallocated stock of the same batch/item: if found it offers `Re-pick from another bin` (creates a new Open task for `short_qty` in the same wave, route re-sequenced); if the user accepts the short the reservation `reserved_qty` is reduced by `short_qty` (it becomes Partial/Waiting) and the stock stays where it is (a `Location empty` reason also creates a cycle-count line request: an `inv-reconciliation` Draft is NOT created automatically; the bin is flagged for count by adding it to the next generated cycle plan). Ticket: T-INV-27.

**BR-INV-56 Packing weights.** Carton volumetric weight `= length x width x height (cm) / volumetricDivisor` (5000) in kg, 3 dp; pack `volumetricWeight = Sigma`; `grossWeight = Sigma carton gross weight`; chargeable weight (information) `= Sigma max(gross_i, volumetric_i)`. Expected net weight `= Sigma(line qty x item.unit_weight_kg)`; **weight check passes** when all items have a unit weight and `abs(measured - expected) <= expected x packWeightTolerancePct / 100`. Example: carton 50 x 40 x 30 -> 60,000 / 5,000 = 12.000 kg; expected 24.000, measured 24.400 -> 1.67 % pass; measured 24.600 -> 2.5 % fail. If any item lacks a weight the check is "not checkable" and `qcCheck` must be ticked manually with a reason. Ticket: T-INV-28.

**BR-INV-57 Dispatch ready.** `Mark Ready` requires: every pick task of the pack Picked or Short-accepted; every line assigned to a carton; at least 1 carton; each carton has dimensions and weight; `qcCheck = true`; `labelStatus = 'Printed'`. Else 422 listing the failed checks. `Dispatch` requires Ready to Dispatch and posts the issue (see 4.3). A dispatched pack cannot be cancelled except by Manager reversal of the issue vouchers (backlog X-33); an unshipped pack can be cancelled: tasks stay Picked, stock stays in OUTBOUND (the Supervisor puts it back with a replenishment task). Ticket: T-INV-28.

**BR-INV-58 WMS transfer lifecycle.** As 4.4. Rules: source <> destination (422); destination resolved from the code in `Destination` (422 "Unknown destination warehouse code"); lines need qty <= available at Start Picking (409 `STOCK_RESERVED`); `Dispatch` only when `picked_qty = qty` for all lines; `Receive` posts the receive of every voucher (all-or-nothing in one transaction); `Cancel` allowed in Draft, Picking (releases reservations), In Transit (reverses dispatches, needs `delete`); not after Received. Variance `= Sigma((dispatched_qty - putaway_qty) x rate)` evaluated when Completed or when the user closes with open tasks (status Completed with variance). Ticket: T-INV-31.

**BR-INV-59 Barcode parsing and check digits.** Check digit (EAN-13, UPC-A, GTIN-14, GTIN-8): from the digit left of the check digit moving left, weights 3,1,3,1,...; `check = (10 - sum mod 10) mod 10`. Test vectors: EAN-13 `4006381333931` valid (sum 89 -> check 1); UPC-A `614141123452` valid (sum 78 -> 2); GTIN-14 `09506000134352` valid (13 data digits `0950600013435` sum 78 -> 2); `4006381333932` invalid. GS1 element strings: accept human form `(01)09506000134352(17)261231(10)LOT123` and machine form `01095060001343521726123110LOT123` where a variable-length AI (10, 21) is followed by FNC1 (ASCII 29, also accepted as `]` `\u001d` or the literal `<GS>`) unless last. AI table: `01` GTIN n14 fixed; `10` batch/lot an..20 variable; `17` expiry n6 fixed `YYMMDD`; `15` best before n6 fixed; `21` serial an..20 variable; `30` count n..8 variable; `37` count of trade items n..8 variable. Date `YYMMDD`: `YY` 00-50 -> 2000-2050, 51-99 -> 1951-1999; `DD = 00` means the last day of the month (per the GS1 General Specifications *(unverified from the pages read)*); invalid month/day -> invalid. Unknown AIs make the scan invalid with reason "Unsupported AI 91". The GTIN-14 `0950600013435 2` maps to the registry barcode `9506000134352` (strip the leading indicator zero) or the full 14-digit string, whichever is registered. Ticket: T-INV-33.

**BR-INV-60 Scan resolution and context rules.** Order: (1) exact `wms_bins.code` in the warehouse (contexts PUTAWAY, PICK, COUNT, LOOKUP); (2) GS1 string -> GTIN -> `item_barcodes.barcode` (14-digit or its 13-digit form); batch (AI 10) is looked up for that item; expiry (AI 17) is compared with the batch: mismatch -> valid false "Expiry does not match the batch"; serial (AI 21) looked up; (3) plain string in `item_barcodes`; (4) in context RECEIVE a plain string equal to a batch no of the open item, (5) serial no; (6) item code. Context rules: PICK - item (and batch) must equal the open task's, else invalid "Wrong item for task PCK/..."; PUTAWAY - item must equal the task item; COUNT - item must be in the plan; RECEIVE - item must be active. Every scan writes `scan_events`; on a known barcode `scan_count += 1` (valid) or `invalid_scan_count += 1` (context failure); an unknown string only writes the event (`result_kind UNKNOWN`). The endpoint never changes stock. Ticket: T-INV-33.

**BR-INV-61 RFID mismatch (report only).** Import rows `epc,readerCode,rssi,readAt`: EPC upper-cased, must match `^[0-9A-F]{8,48}$` (else row error); readerCode must exist (else row error); `readAt` ISO timestamp not in the future by more than 5 minutes; duplicate (epc, reader, readAt) rows inside the file are ignored. Each good row appends `rfid_read_events`; for a registered tag: `last_read_at = max`, `last_rssi`, `actual_zone_id = reader.zone_id`, `exception = 'Location mismatch'` when `expected_zone_id` is set and differs from the reader zone, else null; tag `Missing` status is set by the job when `now - last_read_at > missedReadHours` (24) or never read after 24 h of registration; reading a Missing tag sets it back to Active. Accuracy % `= matched / (matched + mismatched + missed) x 100` over active tags. Example: 200 active tags: 170 read in the right zone, 10 mismatched, 20 missed -> 85.0 %. **No stock, ledger or bin balance is ever changed by RFID.** Ticket: T-INV-34.

**BR-INV-62 Occupancy figures.** Bin: `occupied` (CU) as BR-INV-51, `available = max(0, capacity - occupied)` (blank for capacity 0). Shelf `occupiedPct = Sigma occupied of its bins / Sigma capacity of its bins with capacity > 0 x 100`; rack the same over all its bins; `usedLoad (kg) = Sigma(qty x items.unit_weight_kg)` over its bins (items without weight count 0 and the row shows a "weights missing" hint); zone `used = Sigma occupied`; warehouse `Used Capacity = Sigma occupied` over bins (bin-managed) or `Sigma(on_hand x storage_units)` (not bin-managed). Heatmap colours: green < 60, amber 60-85, red > 85. Tickets: T-INV-08, T-INV-09.

### 6.7 Cross-cutting

**BR-INV-63 Numbering.** `<PFX>/<UNIT>/<FY>/<0001>` with the existing helper `numbered()`, from `number_series` keyed `(page_id = docType, unit, FY)` under `SELECT ... FOR UPDATE`, never `MAX+1`. docTypes and prefixes: `inv-reservation` RES; `inv-reconciliation` RCN; `inv-valuation` VAL (runs) and `inv-valuation:reval` REV (revaluations); `inv-reorder:suggestion` RSG; `inv-holds` HLD; `wms-putaway` PUT; `wms-pick` PCK (tasks) and `wms-pick:wave` WAV; `wms-packing` PAK; `wms-cycle` CYC; `wms-physical` PHY; `wms-transfer` WTR; batches without a user number `inv-batch` BT. Built: OPN, TXN, ADJ, TRF. Masters use user codes. Ticket: T-INV-02.

**BR-INV-64 Idempotency.** Every action/command that changes stock or money accepts `Idempotency-Key` and uses the existing store; a replay returns the stored response with `Idempotent-Replay: true`; the state check (`allowedFrom`) is repeated inside the transaction so a double click is a 409 `CONFLICT`, never a double posting. Ticket: T-INV-04.

**BR-INV-65 Events per posting.** Exactly one accounting event per ledger-writing document (table in 5.8), written in the same transaction by `AccountingService.post`; cancel/reversal writes `<EVENT>_REVERSED`. Ticket: T-INV-22.

**BR-INV-66 Event idempotency.** `accounting_event_queue` unique `(event, doc_type, doc_id)`; the stub uses `INSERT ... ON CONFLICT DO NOTHING`. Ticket: T-INV-02.

**BR-INV-67 Audit.** New audit actions (added to `AUDIT_ACTIONS`): `RESERVATION_CREATED`, `RESERVATION_RELEASED`, `RESERVATION_SHORTENED`, `RESERVATION_EXPIRED`, `BATCH_CREATED`, `BATCH_UPDATED`, `BATCH_QC_CHANGED`, `BATCH_EXPIRY_EXTENDED`, `BATCH_RECALLED`, `SERIAL_UPDATED`, `HOLD_PLACED`, `HOLD_RELEASED`, `RECONCILIATION_CREATED`, `RECONCILIATION_UPDATED`, `RECONCILIATION_STATUS_CHANGED`, `RECONCILIATION_POSTED`, `REVALUATION_POSTED`, `REVALUATION_CANCELLED`, `VALUATION_RUN_CREATED`, `VALUATION_RUN_FINALIZED`, `LOCATION_CREATED`, `LOCATION_UPDATED`, `LOCATION_DELETED`, `LOCATION_STATUS_CHANGED`, `WAREHOUSE_BIN_ENABLED`, `STOCK_FROZEN_BLOCK`, `COUNT_STATUS_CHANGED`, `COUNT_POSTED`, `WAREHOUSE_FROZEN`, `WAREHOUSE_UNFROZEN`, `PUTAWAY_COMPLETED`, `PICK_CONFIRMED`, `PACK_STATUS_CHANGED`, `WMS_TRANSFER_STATUS_CHANGED`, `BARCODE_CREATED`, `BARCODE_UPDATED`, `RFID_IMPORTED`, `REORDER_POLICY_CHANGED`, `UOM_CREATED`, `UOM_UPDATED`, `POLICY_UPDATED`, `JOB_RUN`. `targetType` values added: `Reservation`, `Batch`, `Serial`, `Location`, `Count`, `Policy`, `Pack`. `detail` always has `pageId`, `code`, `unitId` and the figures. Ticket: T-INV-02.

**BR-INV-68 Permissions.** Each new page uses `requireParamPageAction`: `view` for lists/tab views/lookups of that page, `add` for create and for commands that create, `edit` for patch and actions, `delete` for delete/cancel of anything that already moved stock, **`approve` for approvals** (adjustment above threshold, reconciliation approval, count approval, revaluation post above threshold? no - revaluation Post needs `approve`), `export` for xlsx, `controls` for `PATCH /inventory/policy`. Typed `SchemaAction.requires` widens to `'edit' | 'delete' | 'approve'` (T-INV-04). The module switch `allow_delete` etc. binds everyone as built. Data scope OWN/DEPARTMENT/ALL applies to documents (reservations, reconciliations, counts, tasks, packs, wms transfers, revaluations, runs); masters need only `view`. Ticket: T-INV-04.

**BR-INV-69 Delete rules.** Drafts of documents: soft delete with undo token (like vouchers). Masters: delete -> 409 `IN_USE` when referenced (zone with racks/bins, rack with shelves, shelf with bins, bin with stock or history in `stock_bin_moves`, batch with ledger rows, barcode never deleted once scanned -> Retire, policy -> deactivate). Posted/approved documents: never deleted; cancel/reverse. Ticket: T-INV-04.

**BR-INV-70 Unit scope.** Documents are created in the context unit (needs a concrete unit); the warehouse(s) must belong to it (422 `CONTEXT_INVALID`); lists follow the unit filter (`unitFilter(caller)`); "All units" is read-only. Masters of a warehouse (zones...) take the warehouse's unit. Batches, serials, barcodes, UOMs, templates are company-wide. Ticket: T-INV-04.

**BR-INV-71 Optimistic lock.** PATCH and every action on a document send `If-Match: <version>`; a stale version is 409 `VERSION_CONFLICT` (existing); `version` increments on every change of the row (not on child rows). Ticket: T-INV-04.

**BR-INV-72 Inactive items and warehouses.** An inactive item/warehouse is refused on any new document or posting (422 field error / 409), as built; masters referencing them stay readable. Ticket: T-INV-11.

---

## 7. API design

### 7.1 What is reused unchanged (all typed pages, built and new)

`GET /pages/:pageId/schema`, `GET|POST /pages/:pageId/records`, `GET|PATCH|DELETE /pages/:pageId/records/:id`, `POST .../restore`, `POST .../records/bulk` (delete), `GET .../records/export.xlsx`, `GET /pages/:pageId/audit`, `GET .../records/:id/audit`, `POST /pages/:pageId/records/:id/actions/:action`. Row shape = `TypedRecordDto` (`typed.ts`). Errors `{error:{code,message,status,requestId,fields?}}`. `If-Match` on PATCH/DELETE/actions; `Idempotency-Key` on actions and commands. `POST /records` creates in Draft/initial status. Bulk delete only Drafts/unused masters. Response codes: 200/201 success, 204 none, 400 malformed, 401, 403 `FORBIDDEN`/`MAKER_CHECKER`, 404 (including data-scope hidden), 405 `READ_ONLY`, 409 conflicts, 422 `VALIDATION_ERROR` with `fields`.

### 7.2 Extensions to the common machinery (ticket T-INV-04)

| Extension | Detail |
|---|---|
| `TYPED_PAGES` | add the 20 new page ids and `admin-uom` in `apps/api/src/engine/kinds.ts`; `INVENTORY_PAGES` in `definitions.ts` is widened to all of them |
| `SchemaAction.requires` | `'edit' \| 'delete' \| 'approve'` (also `requiresFrom` as built) in `engine/field-schema.ts` and `inventory/definitions.ts` |
| `actionBodySchema` | adds `params: z.record(z.string(), z.unknown()).optional()` (still `.strict()` otherwise) so actions can carry data; each action validates `params` with its own zod schema |
| `TypedHandler` | gains optional `schemaOverrides?(caller): Promise<Partial<Record<string, {options?: string[]}>>>` (dynamic dropdowns, e.g. UOM codes), optional `tabView?(caller, key, query): Promise<TabViewResult>`, optional `command?(caller, name, params, idempotencyKey): Promise<unknown>` |
| Schema payload | adds `tabViews: {tab, key, title, kind}[]` and `commands: {key,label,variant,requires,confirm?}[]` (header buttons) to the typed schema; absent for old clients |
| New routes | `GET /pages/:pageId/tab-views/:viewKey` (view), `POST /pages/:pageId/commands/:command` (permission by the command's `requires`, default `add`, concrete unit, idempotent) |
| Lookups | `GET /lookups/zones|racks|shelves|bins|batches|uoms|label-templates|printers` (below) beside `items` and `warehouses` |

### 7.3 Tab views

`GET /pages/:pageId/tab-views/:viewKey?page=1&size=20&q=&warehouseId=&itemId=&from=&to=&status=&<view specific filters>` (permission `view` on the page; unit filter and data scope as the register; `size` 1-100). Unknown key 404. Response:

```json
{
  "key": "val-fifo-layers",
  "title": "FIFO Layers",
  "kpis": [{ "key": "openLayers", "label": "Open layers", "value": 42, "format": "number", "hint": "Items valued FIFO" }],
  "columns": [{ "key": "itemCode", "label": "Item", "format": "text" }, { "key": "qtyRemaining", "label": "Qty left", "format": "qty" }],
  "rows": [{ "id": "uuid-or-composite", "itemCode": "ITM/00012", "qtyRemaining": 5, "refs": {} }],
  "meta": { "page": 1, "size": 20, "total": 42 },
  "totals": { "value": 600.0 },
  "chart": { "type": "bar", "labels": ["0-30","31-90"], "series": [{ "name": "Qty", "data": [30, 30] }] },
  "actions": [{ "key": "revalue", "label": "Revalue to new standard", "scope": "row", "requires": "approve", "confirm": null, "command": "revalue-standard" }],
  "inputs": [{ "key": "count1Qty", "label": "Count 1", "type": "qty", "rowAction": "count" }],
  "notice": null
}
```
`format` is one of `text | number | qty | money | pct | date | datetime | bool | status`. `chart` and `inputs` are optional. `actions[].scope` is `row` (button per row; posts `POST /pages/:pageId/records/:rowId/actions/:action` or the command with the row id in `params.id`) or `header` (posts the command). A view with no rows returns `rows: []` and the web shows `No records yet.`; `notice` is for honest limits (e.g. `"Finance is not live yet"`).

### 7.4 Commands (header-level, not tied to a record)

`POST /pages/:pageId/commands/:command` body `{ "params": { ... } }` -> `200 { "result": { ... } }` (plus `Idempotent-Replay`). Needs the permission named; unit context concrete.

| Page | Command | requires | params | result | Errors |
|---|---|---|---|---|---|
| `inv-opening` | `import` | add | `{ warehouseId, uploadBatch, rows: [{ itemCode, qty, unitCost, batchNo?, mfgDate?, expiryDate?, serialNos? }] }` (max 2,000 rows) | `{ created: n, errors: [{ row, field, message }], uploadBatch }`; with `dryRun: true` nothing is created | 422 per row (reported, not thrown), 413 |
| `inv-valuation` | `run` | add | `{ fromDate, toDate, warehouseId? }` | `{ runId, code, lines }` | 422 dates, 409 `PERIOD_CLOSED` |
| `inv-valuation` | `revalue-standard` | approve | `{ itemId, newStandardCost, reason }` | `{ revaluations: [id...] }` (Draft docs, one per warehouse with stock) | 422 |
| `inv-reorder` | `recalculate` | edit | `{ policyIds?: [] }` (empty = all of the context unit's warehouses) | `{ updated, suggestions }` | |
| `inv-reorder` | `generate-suggestions` | add | `{}` | `{ created, refreshed }` | |
| `inv-reorder` | `mark-converted` | edit | `{ suggestionIds: [], prRef }` | `{ updated }` | 409 not Open |
| `inv-ageing` | `recalculate-abc` | edit | `{}` | `{ items, a, b, c }` | |
| `wms-bins` | `generate` | add | `{ warehouseId, zoneId, rackId?, shelfId?, prefix, from, to, levels?, capacity, binType?, putawayPriority? }` -> codes `<prefix><nn>` (`from..to` 1..999, 2-digit padding) or with `levels` `<prefix><nn>-L<k>`; max 500 bins | `{ created, skipped: [codes] }` (existing codes skipped) | 422 `CAPACITY_EXCEEDED` |
| `wms-warehouses` | (action on record) `enable-bins`, `disable-bins` | edit | | the record | 409 `BIN_NOT_EMPTY`, 409 `WAREHOUSE_FROZEN` |
| `wms-pick` | `create-wave` | add | `{ warehouseId, strategy?: 'FEFO'\|'FIFO', reservationIds: [] }` | `{ waveId, code, tasks, short: [{ reservationId, shortQty }] }` | 409 `STOCK_RESERVED`, 422 |
| `wms-cycle` | `generate-due` | add | `{ warehouseId, classes?: ['A','B','C'] }` | `{ plans: [{id, code, lines}] }` | |
| `wms-rfid` | `import` | add | `{ importRef?, rows: [{ epc, readerCode, rssi?, readAt }] }` (max 50,000) | `{ imported, matched, mismatched, unknown, errors: [{row, message}] }` | 413 |
| `inv-expiry` | `run-alerts` | edit | `{}` | `{ nearExpiry, expired }` | |

### 7.5 New standalone endpoints

| Method + path | Permission | Request | Response | Errors |
|---|---|---|---|---|
| `GET /inventory/policy` | `view` on `inv-items` | | `{ policy: {...the JSON of 5.4.3...}, version }` | |
| `PATCH /inventory/policy` | `controls` on `inv-items` (and SUPER_ADMIN for `allowNegativeStock`) | `{ policy: { ...partial... } }` + `If-Match` | `{ policy, version }` | 422 unknown key or out of range (see below), 403 for `allowNegativeStock`, 409 version |
| `GET /inventory/integrity` | `controls` on `inv-items` | `?checks=INV-1,INV-3` optional | `{ ok: bool, checks: [{ id, name, ok, mismatches: [{ ref, expected, actual }] }] }` | |
| `POST /inventory/jobs/run-daily` | `controls` on `inv-items` | `{ jobs?: ['reservations','expiry','classify','reorder','rfid'], asOf? }` | `{ ran: [{ job, durationMs, affected }] }` | 409 if already running (advisory lock) |
| `GET /inventory/kpis` | `view` on `inv-stock` | `?warehouseId&asOf` | `{ stockValue, skuCount, turnover, dio, ira, fillRate?, ... }` (section 8) | |
| `GET /inventory/fefo-preview` | `view` on `inv-transactions` | `?itemId&warehouseId&qty` | `{ allocations: [{ batchId, batchNo, expiryDate, qty }], shortQty }` | 422 |
| `GET /pages/inv-reservation/preview` | `view` | `?itemId&warehouseId&batchId?` | `{ onHand, reserved, blocked, available, batchAvailable? }` | 404/422 |
| `GET /pages/wms-putaway/records/:id/suggestions` | `view` | | `{ suggestions: [{ binId, binCode, zoneCode, freeCu, ruleId, ruleName, reason }] }` (max 3) | |
| `GET /pages/wms-barcode/records/:id/label` | `view` | `?templateId&copies=1&format=zpl\|text\|json` | `{ format, copies, payload, template: {code,width_mm,height_mm,symbology} }` and it sets `last_printed_at` and audit `BARCODE_UPDATED` | 404, 422 |
| `POST /wms/scan` | `view` on `wms-barcode` (scan is a read; it writes only `scan_events`) | `{ raw, context: 'LOOKUP'\|'RECEIVE'\|'PUTAWAY'\|'PICK'\|'COUNT', warehouseId?, taskId?, itemId? }` | `{ valid, kind: 'ITEM'\|'BATCH'\|'SERIAL'\|'BIN'\|'UNKNOWN', item?: {id,code,name,uom}, batch?: {id,batchNo,expiryDate,qcStatus}, serial?: {id,serialNo,status}, bin?: {id,code,zoneCode}, qty?, expiryDate?, message }` | 422 raw empty or > 300 chars |
| `GET /lookups/zones` | `view` on `wms-zones` | `?warehouseId&q&limit` | `[{ id, code, name }]` | 403 `CONTEXT_FORBIDDEN` |
| `GET /lookups/racks` | `view` on `wms-racks` | `?warehouseId&zoneId&q&limit` | `[{ id, code, name }]` | |
| `GET /lookups/shelves` | `view` on `wms-shelves` | `?rackId&q&limit` | `[{ id, code, name }]` | |
| `GET /lookups/bins` | `view` on `wms-bins` | `?warehouseId&zoneId&type&activeOnly=true&q&limit` | `[{ id, code, name, zoneCode, capacity, occupied }]` | |
| `GET /lookups/batches` | `view` on `inv-batch` | `?itemId&warehouseId&availableOnly&q&limit` | `[{ id, code (= batch no), name, expiryDate, qcStatus, available }]` | |
| `GET /lookups/uoms` | `view` on `admin-uom` | `?q&limit` | `[{ id, code, name, decimals }]` | |
| `GET /lookups/label-templates`, `GET /lookups/printers` | `view` on `wms-barcode` | `?kind&q` | `[{ id, code, name }]` | |

`PATCH /inventory/policy` ranges: `reservationDays` 1-365; `nearExpiryDays` 1-365; `approvalThresholdValue`, `reconThresholdValue` >= 0 (2 dp); `countTolerancePct` 0-100; `countToleranceValue` >= 0; `movementDays` fast < normal < slow, each 1-3650; `abc.aCumPct` < `abc.bCumPct` <= 100, `freqDays` 1-3650; `xyz.xMaxCv` < `yMaxCv`; `usageWindowDays` 7-365; `serviceLevelDefaultPct` 50-99.9; `holdingCostPctDefault` 0-100; `packWeightTolerancePct` 0-50; `volumetricDivisor` 1000-10000; `missedReadHours` 1-720; booleans strict. The whole object is validated with one zod schema; unknown keys are rejected.

### 7.6 Integration interfaces (TypeScript, in `apps/api/src/modules/inventory/contracts.ts`, ticket T-INV-02)

```ts
export interface MovementInput {
  unitId: string; warehouseId: string; itemId: string; postingDate: string;
  voucherType: LedgerVoucherType; voucherId: string; voucherNo: string; createdById: string;
  qtyIn?: Dec; qtyOut?: Dec; rate?: Dec; value?: Dec; outValue?: Dec; outRate?: Dec; reversesId?: string;
  batchId?: string; batchSpec?: { batchNo: string; mfgDate?: string; expiryDate?: string; supplierName?: string; grnRef?: string };
  serialNos?: string[]; binId?: string; reservationId?: string; countId?: string;
  uom?: string; uomFactor?: Dec; actualRate?: Dec; reasonCode?: string; reference?: string;
  allowExpired?: boolean; allowBlocked?: boolean;       // only for write-offs (BR-INV-09/10)
}
export interface StockServiceApi {
  postMovement(tx: Db, m: MovementInput): Promise<PostedEntry[]>;           // 1..n ledger rows (one per batch)
  reserve(tx: Db, r: ReserveInput): Promise<ReservationResult>;              // BR-INV-15/17
  release(tx: Db, reservationId: string, reason: string): Promise<void>;     // BR-INV-16
  availability(tx: Db, itemId: string, warehouseId: string, batchId?: string): Promise<Availability>;
  hold(tx: Db, h: HoldInput): Promise<string>; releaseHold(tx: Db, holdId: string): Promise<void>;
  applyLandedCost(tx: Db, a: LandedCostInput): Promise<void>;                // BR-INV-28
}
export interface AccountingServiceApi { post(tx: Db, e: AccountingEventInput): Promise<void>; reverse(tx: Db, e: ReverseEventInput): Promise<void>; }
export interface GlBridge { inventoryBalance(tx: Db, q: { unitId: string; asOf: string; warehouseId?: string }): Promise<Dec | null>; }
export interface OpenSupplyProvider { openPoQty(tx: Db, q: { itemId: string; warehouseId: string }): Promise<Dec>; }
export interface PurchaseRequestGateway { createDraft(tx: Db, lines: { itemId: string; warehouseId: string; qty: Dec; vendor?: string }[]): Promise<{ prRef: string }>; }
```
Providers are registered through `registerOpenSupplyProvider`, `registerGlBridge`, `registerPurchaseRequestGateway` (module-level setters; default implementations return `0` / `null` / not registered). `PostedEntry` is the built one extended with `batchId?`.

### 7.7 Typed page definitions (what each `definitions` entry contains)

Field keys are `labelToKey(label)` (section 2 tables); the builder copies them. All new pages: `family` and `purpose` from the registry, `tabs: []` (the web gets the tabs from the registry), `master` true for zones/racks/shelves/bins/barcodes/rfid, false otherwise.

| Page | statuses | editableStatuses | actions (key / label / variant / allowedFrom / requires) | filters (param) | totals | views |
|---|---|---|---|---|---|---|
| `inv-reservation` | Waiting, Partial, Reserved, Fulfilled, Released, Expired | Waiting, Partial, Reserved | `release` Release danger {Waiting,Partial,Reserved} edit; `reallocate` Re-allocate default {Waiting,Partial} edit; `extend` Extend default {Waiting,Partial,Reserved} edit | status, itemId, warehouseId, demandType, priority | requiredQty, reservedQty | - |
| `inv-reconciliation` | Draft, Under Review, Approved, Posted, Rejected, Cancelled | Draft, Rejected | `submit` Submit primary {Draft} edit; `approve` Approve primary {Under Review} approve; `reject` Reject danger {Under Review} approve; `post` Post primary {Approved} edit; `cancel` Cancel danger {Draft,Under Review,Approved,Posted} delete (requiresFrom [Posted]) | status, warehouseId, countRef | valueVariance | - |
| `inv-ageing` | (none) | - | (read-only; PATCH only `action` note) | warehouseId, classification, asOf | stockValue, f030Qty, f3190Qty, f91180Qty, f180PlusQty | `summary` |
| `inv-valuation` | Draft, Final (field `runStatus`) | - | `finalize` Finalize primary {Draft} approve; `delete-run` Delete danger {Draft} delete | runId, warehouseId, itemId, method | closingValue etc. | - ; commands `run` |
| `inv-reorder` | OK, Reorder Soon, Reorder Now, Stock-out, Inactive | all | `recalculate` Recalculate default edit; `deactivate`/`activate` | status, warehouseId, vendor | suggestedQty | - |
| `inv-batch` | Active, Exhausted, Expired, Recalled | Active | `release` {any QC state} edit; `hold`; `reject`; `start-recall`; `close-recall`; `extend-expiry` (params `{newExpiry, reason}`) | status, itemId, qcStatus, expiryFrom, expiryTo | availableQty | - |
| `inv-serial` | In Stock, Reserved, In Transit, Issued, Returned, Scrapped | In Stock, Returned | `return-to-stock` {Returned} edit; `scrap` {In Stock,Returned} delete | status, itemId, warehouseId, warranty | - | - |
| `inv-expiry` | OK, Near Expiry, Expired, Disposed | (disposition, owner editable) | `hold-batch` edit; `scrap` edit (creates Adjustment draft) | status, warehouseId, disposition, itemId | availableQty, stockValue | - |
| `wms-zones/racks/shelves/bins` | Active, Inactive (bins also Blocked) | all | `activate`,`deactivate`; bins `block`,`unblock`; racks `record-audit` | warehouseId, zoneId, rackId, status, binType, emptyOnly | - | - |
| `wms-putaway` | Pending, Assigned, In Progress, Completed, Exception, Cancelled | Pending, Assigned | `assign` (params `{operatorId}`), `start`, `complete` (params `{chosenBin?, qty?}`), `exception` (`{reason}`), `cancel` | status, operatorId, priority, warehouseId | qty | `tasks` |
| `wms-pick` | Open, Released, In Progress, Picked, Short Picked, Cancelled | Open | `start`, `confirm` (`{pickedQty, shortReason?, serialNos?}`), `repick` (`{binId}`), `accept-short`, `cancel`; wave commands `release-wave`, `close-wave` | waveNo, status, pickerId, warehouseId, view | requiredQty, pickedQty | `tasks`, `waves` |
| `wms-packing` | Open, Packing, Packed, Ready to Dispatch, Dispatched, Cancelled | Open, Packing | `start`, `add-carton` (`{lengthCm,widthCm,heightCm,grossWeightKg}`), `assign-lines`, `mark-packed`, `verify-weight` (`{measuredNetKg, override?: reason}`), `mark-label-printed`, `mark-ready`, `dispatch` (`{reference?}`, delete), `cancel` | status, packerId | pickedQty | - |
| `wms-cycle` | Planned, Counting, Recount, Under Review, Approved, Completed, Cancelled | Planned | `start`, `submit`, `approve` (approve), `complete`, `cancel`; line action `count` (`{lineId, qty}`) | status, warehouseId, abcClass | itemsPlanned | - |
| `wms-physical` | Planned, Frozen, Counting, Recount, Under Review, Approved, Posted, Closed, Cancelled | Planned | `freeze`, `start-counting`, `request-recount`, `submit`, `approve` (approve), `post` (approve), `close`, `unfreeze` (delete), `cancel`; line action `count` | status, warehouseId | valueVariance | - |
| `wms-transfer` | Draft, Picking, In Transit, Received, Putaway, Completed, Cancelled | Draft | `start-picking`, `dispatch`, `receive`, `complete`, `cancel` (requires delete from In Transit) | status, sourceWarehouseId | inTransitQty | - |
| `wms-barcode` | Active, Inactive, Retired | Active, Inactive | `retire`, `activate`, `deactivate` | itemId, barcodeType, status | - | - |
| `wms-rfid` | Active, Missing, Inactive | all | `mark-missing`, `deactivate`, `activate` | itemId, zoneId, status, exceptionOnly | - | - |
| `admin-uom` | Active, Inactive | all | `activate`, `deactivate` | status | - | - |

Create/Patch bodies: `{ "data": { <field keys> } }` exactly as the generic engine; server-set fields are read-only (ignored on write with 422 if sent with a changed value? no: read-only keys in the body are rejected with 422 `fields: { key: "Read-only." }`). Child rows (carton lines, count lines, wave tasks) are created by actions/commands, not by POST. Document lists respect `?view=` where listed.

### 7.8 Request/response examples (the non-obvious ones)

`POST /pages/inv-reservation/records` -> 201
```json
{ "data": { "demandType": "Sales Order", "demandRef": "SO/TAL/2026-27/0042", "item": "<itemUuid>", "warehouse": "<whUuid>", "batchSerial": "B-2026-11", "requiredQty": 40, "priority": "High", "reservedUntil": "2026-11-20" } }
```
```json
{ "id": "...", "code": "RES/TAL/2026-27/0007", "status": "Partial", "data": { "requiredQty": 40, "reservedQty": 25, "availableQty": 0, "priority": "High", "reservedUntil": "2026-11-20" }, "version": 1 }
```
`POST /pages/wms-pick/commands/create-wave` body `{ "params": { "warehouseId": "<uuid>", "strategy": "FEFO", "reservationIds": ["<uuid1>","<uuid2>"] } }` -> `{ "result": { "waveId": "...", "code": "WAV/TAL/2026-27/0003", "tasks": 5, "short": [] } }`.
`POST /pages/wms-putaway/records/:id/actions/complete` body `{ "params": { "chosenBin": "<binUuid>", "qty": 30 } }` -> record with `doneQty: 30`, `status: "Completed"`.
`POST /wms/scan` body `{ "raw": "(01)09506000134352(17)261231(10)LOT123", "context": "RECEIVE", "warehouseId": "<uuid>" }` -> `{ "valid": true, "kind": "ITEM", "item": { "id": "...", "code": "ITM/00012", "name": "Widget", "uom": "Nos" }, "batch": { "batchNo": "LOT123", "expiryDate": "2026-12-31", "id": null, "qcStatus": null }, "message": "Item ITM/00012, batch LOT123 (new), expiry 2026-12-31" }`.

---

## 8. Reports and KPIs

Each report is a tab view (7.3) or a KPI. "Source" names the tables; SQL is given at the level the builder needs (use `prisma.$queryRaw` with tagged templates, always `ORDER BY`, always the unit filter `AND l.unit_id = ${unitId}` (or `IN` the user's units for All units) and exclude soft-deleted masters).

| Id | Report | Definition / formula | Source | Tab (page - tab) |
|---|---|---|---|---|
| RPT-INV-01 | Stock by warehouse | per warehouse: count of items with `on_hand > 0`, `Sigma value`, share of unit value, capacity used % = `usedCapacity / total_capacity` | `stock_balances`, `warehouses` | inv-stock - Warehouse Balance |
| RPT-INV-02 | Available vs reserved | rows with `reserved_qty > 0 or blocked > 0`; open reservation count | `stock_balances`, blocked view (BR-INV-18), `stock_reservations` | inv-stock - Available vs Reserved |
| RPT-INV-03 | Batch expiry list | batch x warehouse with stock ordered by `expiry_date ASC NULLS LAST` | `batches`, `stock_batch_balances` | inv-stock - Batch Expiry |
| RPT-INV-04 | Blocked stock | per item x warehouse x batch: blocked qty and reason (batch QC status or hold code) | batches + `stock_holds` | inv-stock - Blocked Stock |
| RPT-INV-05 | Stock health | counts per status; dead-stock value (class Dead Stock); expiring value `Sigma available x avg rate` for batches with `daysToExpiry <= 60`; reserved % = `Sigma reserved / Sigma on_hand`; integrity result | all | inv-stock - Stock Health |
| RPT-INV-07 | Transaction audit | per voucher: creator, poster, posted_at, reversed-by (voucher no of the REVERSAL), count posted today; vouchers posted by creator above threshold | `stock_vouchers`, `audit_logs` | inv-transactions - Transaction Audit |
| RPT-INV-08 | Opening validation | the 8 checks per Draft opening voucher (pass/warn/fail counts) | `stock_vouchers` | inv-opening - Validation Errors |
| RPT-INV-09 | Opening posting summary | `Sigma value` of Posted openings per warehouse and FY | `stock_vouchers` | inv-opening - Posting Summary |
| RPT-INV-10 | Adjustment analysis | `Sigma abs(variance)`, `Sigma value_impact` by warehouse and by reason code (Posted, period) | `stock_vouchers` | inv-adjustment - Count Variance / Reason Codes |
| RPT-INV-11 | Value impact trend | per month net `Sigma value_impact`, write-off = `Sigma` of negative impacts | `stock_vouchers` | inv-adjustment - Value Impact |
| RPT-INV-12 | In-transit | Dispatched transfers: age days = today - dispatch date, overdue = `expected_receipt < today` | `stock_vouchers` | inv-transfer - In Transit |
| RPT-INV-13 | Transfer variance | `Sigma(dispatch_value - received value)` by lane | `stock_vouchers` | inv-transfer - Transfer Variance |
| RPT-INV-14 | Transfer SLA | % of Received transfers with `received date <= expected_receipt`; average transit days | `stock_vouchers` | inv-transfer - Transfer SLA |
| RPT-INV-15 | Reservation demand sources | `Sigma required / reserved / (required-reserved-fulfilled)` grouped by demand type and ref (live statuses) | `stock_reservations` | inv-reservation - Demand Source |
| RPT-INV-16 | Shortages | Waiting/Partial with short qty, open PO qty, expected date | reservations + provider | inv-reservation - Shortage Handling |
| RPT-INV-17 | Reservation ageing | buckets of `today - created_at::date`: 0-7, 8-14, 15-30, 30+; value reserved = `reserved_qty x avg_rate` | reservations, balances | inv-reservation - Reservation Ageing |
| RPT-INV-18 | Root-cause Pareto | count and `abs(value)` by root cause code, sorted desc, cumulative % | `stock_reconciliations` | inv-reconciliation - Root Cause |
| RPT-INV-19/20 | Ageing summary / slow-dead | BR-INV-46/47; SQL in 8.1 | ledger | inv-ageing |
| RPT-INV-21 | Valuation summary | the run lines; totals per warehouse | `valuation_lines` | inv-valuation - Valuation Summary |
| RPT-INV-22 | FIFO layers | open layers (`qty_remaining > 0`) with value `qty_remaining x rate` | `stock_cost_layers` | inv-valuation - FIFO Layers |
| RPT-INV-23 | Weighted average | per item x warehouse (MOVING_AVG items): on hand, `avg_rate`, value, last receipt rate, `(avg - last)/last` % | balances, ledger | inv-valuation - Weighted Average |
| RPT-INV-24 | Standard cost | STANDARD items: standard cost, average actual receipt rate over 90 days, `Sigma ppv` YTD | ledger | inv-valuation - Standard Cost |
| RPT-INV-25 | Revaluations | documents with delta | `stock_revaluations` | inv-valuation - Revaluation |
| RPT-INV-26 | GL bridge | per unit: ledger value `Sigma(stock_balances.value)`, `glBalance` from `GlBridge`, `variance = value - gl` | balances + bridge | inv-valuation - Inventory GL Bridge |
| RPT-INV-27 | Reorder dashboard | counts per status; items to reorder now; suggested value = `Sigma suggested_qty x avg_rate` | policies | inv-reorder - Reorder Dashboard |
| RPT-INV-28/29 | Safety stock / EOQ tables | BR-INV-41/43 | policies | inv-reorder |
| RPT-INV-30 | Suggested PR | open suggestions grouped by vendor with total value | `reorder_suggestions` | inv-reorder - Suggested PR |
| RPT-INV-31 | Forecast accuracy | BR-INV-45 | ledger | inv-reorder - Forecast Accuracy |
| RPT-INV-32 | Batch traceability | forward/backward: all ledger rows of a batch with voucher, warehouse, counterpart reference | ledger | inv-batch - Batch Movements |
| RPT-INV-33 | Recall impact | outflow rows of the batch (issues, transfers) with voucher no and quantity still on hand by warehouse | ledger | inv-batch - Batch Recall |
| RPT-INV-34/35 | Serial warranty / exceptions | warranty state: `warranty_end >= today` Under warranty, `<= today+30` Expiring, `< today` Expired, null No warranty; exceptions as in 2.13 | serials | inv-serial |
| RPT-INV-36/37 | Expiry dashboard / loss | BR-INV-48/49 | batches | inv-expiry |
| RPT-INV-38 | Warehouse KPIs | stock value; utilisation `usedCapacity/total_capacity`; IRA (below); dock-to-stock hours (RPT-INV-42); pick lines per hour (RPT-INV-43); open tasks | multiple | wms-warehouses - Warehouse KPIs |
| RPT-INV-39/40/41 | Zone utilisation, rack heatmap, bin heatmap | BR-INV-62 | bins | wms-zones, wms-racks, wms-bins |
| RPT-INV-42 | Dock to stock time | per completed putaway task `hours = completed_at - created_at`; average and 90th percentile (`percentile_cont(0.9)`) per day and dock | `putaway_tasks` | wms-putaway - Dock to Stock Time |
| RPT-INV-43 | Pick productivity | per picker per day: Picked tasks, `lines per hour = tasks / hours between first start and last completion` (min 1 h), accuracy `= 1 - short tasks / tasks`, short rate | `pick_tasks` | wms-pick - Pick Productivity |
| RPT-INV-45 | Pack productivity | packs, cartons, average `completed - started` minutes per packer | `pack_orders` | wms-packing - Pack Productivity |
| RPT-INV-46 | Count accuracy | BR-INV-33 by plan, class, month | cycle plans | wms-cycle - Count Accuracy |
| RPT-INV-47 | Physical variance | BR-INV-36 | physical lines | wms-physical - Reconciliation |
| RPT-INV-48 | Transfer accuracy | % lines with `received_qty = dispatched_qty` and `putaway_qty = received_qty`; average hours Draft to Completed | WMS transfers | wms-transfer - Transfer Accuracy |
| RPT-INV-49 | Scan productivity | scans per user per hour, invalid % `= invalid / total x 100`, by context | `scan_events` | wms-barcode - Scan Productivity |
| RPT-INV-50 | RFID accuracy | BR-INV-61 | tags | wms-rfid - RFID Accuracy |
| RPT-INV-51 | Turnover and DIO | `turnover = consumption value (365 d ISSUE) / average stock value` where average stock value = mean of month-end values over 12 months (or current value when younger); `DIO = 365 / turnover` | ledger | `GET /inventory/kpis`, Stock Health |
| RPT-INV-52 | ABC/XYZ matrix | counts and value per ABC x XYZ cell (3 x 3) | `item_classifications` | inv-items - Classification & UOM; inv-ageing |
| RPT-INV-53 | Ledger integrity | INV-1..INV-6 (section 11) | all | Stock Health; `GET /inventory/integrity` |
| RPT-INV-54 | Inventory record accuracy (IRA) | over the last 90 days of finished counts: `1 - Sigma abs(value variance) / Sigma system value` | count lines | Warehouse KPIs |

### 8.1 SQL sketches of the non-trivial ones

**Ageing attribution (BR-INV-46) for one warehouse** (`:wh`, `:asOf`):
```sql
WITH bal AS (
  SELECT item_id, on_hand FROM stock_balances WHERE warehouse_id = :wh AND on_hand > 0
), infl AS (
  SELECT l.item_id, l.posting_date, l.qty_in AS qty,
         SUM(l.qty_in) OVER (PARTITION BY l.item_id ORDER BY l.posting_date DESC, l.posted_at DESC, l.id DESC) AS cum
  FROM stock_ledger l
  WHERE l.warehouse_id = :wh AND l.qty_in > 0 AND l.voucher_type IN ('OPENING','RECEIPT','TRANSFER_IN','ADJUSTMENT','RECONCILIATION')
    AND NOT EXISTS (SELECT 1 FROM stock_ledger r WHERE r.reverses_id = l.id) AND l.posting_date <= :asOf
), alloc AS (
  SELECT i.item_id, i.posting_date, b.on_hand,
         LEAST(i.qty, GREATEST(0, b.on_hand - (i.cum - i.qty))) AS take
  FROM infl i JOIN bal b USING (item_id)
)
SELECT item_id,
  SUM(take) FILTER (WHERE :asOf::date - posting_date <= 30)                          AS q0_30,
  SUM(take) FILTER (WHERE :asOf::date - posting_date BETWEEN 31 AND 90)              AS q31_90,
  SUM(take) FILTER (WHERE :asOf::date - posting_date BETWEEN 91 AND 180)             AS q91_180,
  SUM(take) FILTER (WHERE :asOf::date - posting_date > 180)                          AS q180p,
  ROUND(SUM(take * (:asOf::date - posting_date)) / NULLIF(SUM(take),0)) AS age_days
FROM alloc WHERE take > 0 GROUP BY item_id ORDER BY item_id;
```
(A reversed REVERSAL row itself has `qty_in` only when it reverses an outflow; those rows have `voucher_type = 'REVERSAL'` and are excluded by the type list; the quantity they restore is added back by treating a reversal of an issue as an inflow dated like the original issue - **do not**: it is simply ignored, so a reversed issue makes the oldest layers look older; accepted, documented in the edge-case list EC-25.)

**Valuation buckets (BR-INV-25) for a run** (`:from`, `:to`, optional `:wh`):
```sql
SELECT l.warehouse_id, l.item_id,
  COALESCE(SUM(l.value) FILTER (WHERE l.posting_date <  :from), 0) AS opening_value,
  COALESCE(SUM(l.value) FILTER (WHERE l.posting_date BETWEEN :from AND :to AND b.bucket = 'R'), 0) AS receipt_value,
  COALESCE(-SUM(l.value) FILTER (WHERE l.posting_date BETWEEN :from AND :to AND b.bucket = 'I'), 0) AS issue_value,
  COALESCE(SUM(l.value) FILTER (WHERE l.posting_date BETWEEN :from AND :to AND b.bucket = 'A'), 0) AS adjustment_value,
  COALESCE(SUM(l.qty_in - l.qty_out) FILTER (WHERE l.posting_date <= :to), 0) AS closing_qty,
  COALESCE(SUM(l.value) FILTER (WHERE l.posting_date <= :to), 0) AS closing_value
FROM stock_ledger l
LEFT JOIN stock_ledger o ON o.id = l.reverses_id
CROSS JOIN LATERAL (SELECT CASE COALESCE(o.voucher_type, l.voucher_type)
    WHEN 'OPENING' THEN 'R' WHEN 'RECEIPT' THEN 'R' WHEN 'TRANSFER_IN' THEN 'R'
    WHEN 'ISSUE' THEN 'I' WHEN 'TRANSFER_OUT' THEN 'I' ELSE 'A' END AS bucket) b
WHERE l.unit_id = :unit AND (:wh::uuid IS NULL OR l.warehouse_id = :wh)
GROUP BY l.warehouse_id, l.item_id
HAVING COUNT(*) FILTER (WHERE l.posting_date <= :to) > 0
ORDER BY l.warehouse_id, l.item_id;
```
The check `closing_value = opening + receipt - issue + adjustment` holds because every row with `posting_date <= :to` is in exactly one of: before `:from`, or inside the window with exactly one bucket.

**Blocked view (BR-INV-18)** as a SQL view `v_stock_blocked(item_id, warehouse_id, blocked_qty)` is NOT created (views are not in the migrations); the repository holds the query:
```sql
SELECT x.item_id, x.warehouse_id, SUM(x.q) AS blocked_qty FROM (
  SELECT sbb.item_id, sbb.warehouse_id,
    CASE WHEN b.qc_status <> 'Released' OR b.recalled THEN sbb.on_hand
         ELSE LEAST(sbb.on_hand, COALESCE((SELECT SUM(h.qty) FROM stock_holds h WHERE h.batch_id = b.id AND h.warehouse_id = sbb.warehouse_id AND h.status = 'Active'),0)) END AS q
  FROM stock_batch_balances sbb JOIN batches b ON b.id = sbb.batch_id
  UNION ALL
  SELECT h.item_id, h.warehouse_id, h.qty FROM stock_holds h WHERE h.batch_id IS NULL AND h.status = 'Active'
) x GROUP BY x.item_id, x.warehouse_id ORDER BY x.item_id, x.warehouse_id;
```

**KPI definitions** (`GET /inventory/kpis`): `stockValue = Sigma stock_balances.value`; `skuCount = items with on_hand > 0`; `turnover`, `dio` (RPT-INV-51); `ira` (RPT-INV-54); `stockoutRate = items with policy and available = 0 / items with policy`; `deadStockValue`; `expiringValue60`; `reservedPct`; `glVariance` (null until Finance). Shown in Stock Health and Warehouse KPIs tabs and exported by the Reports tab (Excel).

---

## 9. Extra functions beyond the prototype `[ADD]`

Priority: **MUST** = in the tickets and required for a correct system; **SHOULD** = in the tickets, small; **COULD** = backlog (not in tickets). "Source" is the product that has the idea.

| Id | Item | P | Why | Source | In ticket |
|---|---|---|---|---|---|
| X-01 | Multi-UOM with stored factor on the voucher | MUST | purchases in Box, stock in Nos | Zoho, Odoo | T-INV-06, 15 |
| X-02 | Batch master with expiry, QC status, recall | MUST | traceability and recalls | Odoo, ERPNext, D365 | T-INV-12 |
| X-03 | FEFO auto-allocation on issue | MUST | stops expired stock shipping | Odoo, Tally note | T-INV-15 |
| X-04 | Reservation with priority, expiry, allocator | MUST | prevents double promising | Odoo, SAP B1 | T-INV-17 |
| X-05 | Available = on hand - reserved - blocked | MUST | one truth for Sales | all | T-INV-11 |
| X-06 | Blocked stock via QC hold and manual hold | MUST | frozen `Blocked` column | D365 | T-INV-11/12 |
| X-07 | FIFO and standard cost per item | MUST | frozen valuation tabs | SAP B1, Tally | T-INV-20 |
| X-08 | Revaluation document | MUST | keeps GL in step | SAP B1 | T-INV-21 |
| X-09 | Inventory vs GL bridge | MUST | audit | ERPNext, Sage | T-INV-21 |
| X-10 | Maker-checker on adjustments and counts | MUST | fraud control | all | T-INV-15, 23 |
| X-11 | Count freeze for physical verification | MUST | no false variances | D365 | T-INV-30 |
| X-12 | Blind count + recount by another user | MUST | count integrity | D365, Odoo | T-INV-29 |
| X-13 | CARO 10 % discrepancy flag | MUST | statutory audit | CARO 2020 | T-INV-30 |
| X-14 | Location hierarchy with capacity | MUST | frozen WMS pages | SAP B1, D365 | T-INV-08/09 |
| X-15 | Putaway rules with priority and capacity | MUST | frozen tab | Odoo, D365 | T-INV-26 |
| X-16 | Pick waves with FEFO/FIFO and route sequence | MUST | frozen tab | D365, Odoo | T-INV-27 |
| X-17 | Short pick handling | MUST | real-life | D365 | T-INV-27 |
| X-18 | Packing cartons, volumetric weight, weight check | MUST | frozen tab | carriers | T-INV-28 |
| X-19 | GS1 parsing and check digits in the scan endpoint | MUST | GS1 labels from suppliers | GS1 | T-INV-33 |
| X-20 | Reorder policy: ROP, safety stock by service level, EOQ | MUST | frozen tabs | textbook, Zoho | T-INV-35 |
| X-21 | Suggested PR (hand-over to SCM) | MUST | closes the loop | Odoo | T-INV-35 |
| X-22 | Accounting events for every posting (stub queue) | MUST | Finance later | ERPNext | T-INV-22 |
| X-23 | ABC and XYZ classification | SHOULD | cycle count frequency | all | T-INV-24 |
| X-24 | Cycle count scheduling by class with next date | SHOULD | Odoo-style | Odoo | T-INV-29 |
| X-25 | Negative-stock policy (off by default) | SHOULD | some users insist | ERPNext | T-INV-11 |
| X-26 | Expiry alerts job and dispositions | SHOULD | reduce write-offs | Odoo | T-INV-18, 37 |
| X-27 | Scan event log with retention (archive job) | COULD | data growth | - | backlog |
| X-28 | Kitting / bundles (composite items) | COULD | assembly sales | Zoho | backlog |
| X-29 | Consignment stock (supplier- or customer-owned) | COULD | owner field on balances | SAP, D365 | backlog |
| X-30 | Keep age through transfers (origin date on ledger) | COULD | accurate ageing | - | backlog |
| X-31 | Serial warranty tracking with expiry alerts | SHOULD | frozen `Warranty Link` | Odoo, Zoho | T-INV-13 |
| X-32 | Scrap handling with reason, ITC reversal flag | SHOULD | GST 17(5)(h) | CGST | T-INV-22 |
| X-33 | Reversal of a dispatched pack | COULD | rare | - | backlog |
| X-34 | Bulk bin generator | SHOULD | set up 500 bins in a minute | Zoho/Odoo | T-INV-09 |
| X-35 | Opening stock CSV import with validation | SHOULD | go-live | ERPNext | T-INV-14 |
| X-36 | Landed cost hook | SHOULD | SCM needs it | ERPNext | T-INV-21 |
| X-37 | NRV write-down with capped reversal | SHOULD | Ind AS 2 | Ind AS | T-INV-21 |
| X-38 | Putaway exceptions queue and dock-to-stock KPI | SHOULD | frozen tabs | D365 | T-INV-26 |
| X-39 | Replenishment tasks from pick faces | SHOULD | frozen `Replenishment` tab | Odoo, Zoho | T-INV-26 |
| X-40 | Label payload as ZPL/text, no driver | SHOULD | simple, printer-agnostic | Zoho | T-INV-33 |
| X-41 | RFID import with mismatch report | SHOULD | brief | GS1 | T-INV-34 |
| X-42 | Lot-wise minimum shelf life at pick (customer rule) | COULD | food/pharma | SAP | backlog |
| X-43 | Cross-docking | COULD | | D365 | backlog |
| X-44 | Slotting optimisation by velocity | COULD | | D365 | backlog |
| X-45 | Cycle-count by exception from short picks | COULD | BR-INV-55 mentions bin flag only | - | backlog |
| X-46 | Inventory KPIs (turnover, DIO, IRA, stock-out rate) | SHOULD | management | all | T-INV-36 |
| X-47 | Integrity check endpoint | MUST | Sum ledger = balance in production | - | T-INV-36 |
| X-48 | Serial-wise valuation | COULD | | ERPNext | backlog |
