# 02e - Inventory and WMS: edge cases, test plan, reviewer checklist (sections 10, 11, 13)

Part of `02-INVENTORY-WMS.md`. Rules `BR-INV-nn` in `02d`, tickets in `02f`. Section 12 (tickets) is in `02f`.

---

## 10. Edge cases and careless-user scenarios

Each row: what the user does, the exact safe behaviour, and the test that proves it (file under `apps/api/tests/`, test name given in the ticket). "Tn" = ticket id.

| # | Scenario | Expected safe behaviour | Test |
|---|---|---|---|
| EC-01 | Double click on Post of a receipt | 2nd request with same `Idempotency-Key`: same body + `Idempotent-Replay: true`; without key: 409 `CONFLICT` (status check inside the tx); exactly one ledger row | `inv-stock-core.test.ts` `post twice posts once` (T11) |
| EC-02 | Two users issue the last 5 units at the same time | one succeeds, the other 409 `INSUFFICIENT_STOCK`; balance never negative | `inv-stock-core.test.ts` `parallel issues of last units` (T11) |
| EC-03 | Issue more than available while 30 are reserved for someone else | 409 `STOCK_RESERVED` "Only 50 available (30 reserved, 20 blocked)" | `inv-reservation.test.ts` `issue respects reservations` (T17) |
| EC-04 | Receive a batch-tracked item without batch number | 422 `BATCH_REQUIRED`, nothing written | `inv-batch.test.ts` `batch required` (T15) |
| EC-05 | Receive a batch whose expiry is before mfg date or in the past | 422 field error on `expiryDate` | `inv-batch.test.ts` `expiry dates validated` (T15) |
| EC-06 | Issue from an expired batch | 409 `BATCH_EXPIRED`; scrap Adjustment with reason Expiry is allowed | `inv-expiry.test.ts` `expired batch blocked, scrap allowed` (T18) |
| EC-07 | Issue from a batch On Hold / Pending QC | 409 `BATCH_BLOCKED`; after Release it works | `inv-batch.test.ts` `qc blocks issue` (T12) |
| EC-08 | Issue without naming a batch for a batch item | FEFO auto-allocation over several batches; one ledger row per batch; reversal restores each batch | `inv-batch.test.ts` `fefo auto allocation and reversal` (T15) |
| EC-09 | Serial list shorter/longer than qty | 422 `SERIAL_QTY_MISMATCH` | `inv-serial.test.ts` (T13) |
| EC-10 | Receive a serial that already exists / a scrapped serial again | 409 `SERIAL_DUPLICATE` | `inv-serial.test.ts` (T13) |
| EC-11 | Issue a serial that is not In Stock in that warehouse | 409 `SERIAL_NOT_IN_STOCK`, no partial posting | `inv-serial.test.ts` (T13) |
| EC-12 | Turn on Batch Tracked for an item that has stock | 409 `TRACKING_LOCKED` | `inv-batch.test.ts` (T12) |
| EC-13 | Item flagged both batch and serial | 422 `TRACKING_CONFLICT` | `inv-batch.test.ts` (T12) |
| EC-14 | Change valuation method of an item with history | 409 `VALUATION_METHOD_LOCKED` | `inv-valuation.test.ts` (T20) |
| EC-15 | Cancel (reverse) a FIFO receipt whose layer was partly consumed | 409 `LAYER_CONSUMED`, voucher stays Posted | `inv-valuation.test.ts` (T20) |
| EC-16 | Post to a frozen warehouse (any user, even Manager) | 409 `WAREHOUSE_FROZEN` + audit `STOCK_FROZEN_BLOCK`; the count's own reconciliation posts | `wms-physical.test.ts` (T30) |
| EC-17 | Same user enters count 1 and the recount | 409 `SAME_COUNTER` | `wms-cycle.test.ts` (T29) |
| EC-18 | Stock moves after a cycle count line was counted | line becomes `Stale`; Submit gives 409 `COUNT_STALE` until recounted | `wms-cycle.test.ts` (T29) |
| EC-19 | Creator approves own reconciliation / adjustment above threshold | 403 `MAKER_CHECKER` | `inv-reconciliation.test.ts`, `inv-adjustment-approval.test.ts` (T23, T15) |
| EC-20 | Reconciliation gain for an item with zero average and no standard cost/receipt | 422 `UNIT_COST_REQUIRED` | `inv-reconciliation.test.ts` (T23) |
| EC-21 | Stock lowered by adjustment below reserved qty | reservations shortened (lowest priority newest first), audit `RESERVATION_SHORTENED`; balance CHECK never fails | `inv-reservation.test.ts` (T17) |
| EC-22 | Reservation for more than exists | status Waiting/Partial (not an error); served when stock arrives in priority order | `inv-reservation.test.ts` (T17) |
| EC-23 | Release a Fulfilled reservation | 409 `CONFLICT` (terminal) | `inv-reservation.test.ts` (T17) |
| EC-24 | Putaway into a full bin | 409 `BIN_CAPACITY_EXCEEDED`; nothing moved; other bin works | `wms-putaway.test.ts` (T26) |
| EC-25 | Reverse an issue, then look at ageing | reversed issue is ignored by the age attribution (documented limit); on hand stays right | `inv-ageing.test.ts` (T24) |
| EC-26 | Delete a bin with stock / a zone with bins | 409 `BIN_NOT_EMPTY` / `IN_USE` | `wms-structure.test.ts` (T08, T09) |
| EC-27 | Create a bin whose zone is in another warehouse | 422 (composite FK also 23503 if forced via SQL) | `wms-structure.test.ts` (T09) |
| EC-28 | Zone capacity smaller than sum of its bins | 422 `CAPACITY_EXCEEDED` on the change that breaks it | `wms-structure.test.ts` (T09) |
| EC-29 | Enable bins on a warehouse with open in-transit transfer | 409 `CONFLICT`; after receipt works; stock moves to STAGING, Sigma bins = on hand | `wms-structure.test.ts` (T09) |
| EC-30 | Short pick with no other bin | task `Short Picked`, reservation shortened to picked, remainder Waiting | `wms-pick.test.ts` (T27) |
| EC-31 | Picker confirms more than required | 422 field `pickedQty` | `wms-pick.test.ts` (T27) |
| EC-32 | Mark pack Ready without label/weights/QC check | 422 listing failed checks | `wms-packing.test.ts` (T28) |
| EC-33 | Weight 2.5 % off expected | verify fails; override needs reason and `approve` | `wms-packing.test.ts` (T28) |
| EC-34 | Dispatch the same pack twice | second call 409 `CONFLICT`, one issue per line | `wms-packing.test.ts` (T28) |
| EC-35 | WMS transfer to the same warehouse / unknown destination code | 422 | `wms-transfer.test.ts` (T31) |
| EC-36 | Scan garbage, wrong check digit, unknown AI | HTTP 200 `valid:false` with message; `scan_events` row; no stock change | `wms-barcode.test.ts` (T33) |
| EC-37 | Same barcode on two items | 409 `DUPLICATE` | `wms-barcode.test.ts` (T33) |
| EC-38 | RFID CSV with bad EPC, unknown reader, future time, duplicate rows | those rows reported in `errors`, good rows imported, stock unchanged | `wms-rfid.test.ts` (T34) |
| EC-39 | RFID tag read in the wrong zone | tag `exception = Location mismatch`; no ledger row (asserted by counting ledger before/after) | `wms-rfid.test.ts` (T34) |
| EC-40 | Revalue an item with zero stock / zero delta / FIFO item by rate | 422 messages (BR-INV-23) | `inv-valuation.test.ts` (T21) |
| EC-41 | NRV reversal larger than the write-down | 422 `NRV_REVERSAL_EXCEEDS_WRITEDOWN` | `inv-valuation.test.ts` (T21) |
| EC-42 | Backdated posting date in a closed FY / outside the FY | 409 `PERIOD_CLOSED` / 422 | `inv-stock-core.test.ts` (T11) |
| EC-43 | Post an opening for an item that already has ledger rows | 409 `CONFLICT` (built) | existing test |
| EC-44 | Import 2,001 rows / duplicate item rows / negative qty | 413 / row error `duplicate row` / row error | `inv-opening.test.ts` (T14) |
| EC-45 | Reorder policy with max < min, or vendor blank | 422 | `inv-reorder.test.ts` (T35) |
| EC-46 | Sales-like caller reserves in a warehouse of another unit | 422 `CONTEXT_INVALID` / 403 `CONTEXT_FORBIDDEN` | `inv-reservation.test.ts` (T17) |
| EC-47 | Member with only `view` runs an action | 403 `FORBIDDEN` | `inv-permissions.test.ts` (T38) |
| EC-48 | Two users edit the same batch (stale `If-Match`) | 409 `VERSION_CONFLICT` | `inv-batch.test.ts` (T12) |
| EC-49 | Negative-stock setting ON: issue 8 of 5 (untracked) | posts, value -300, later receipt average per BR-INV-04; with a batch item still `INSUFFICIENT_STOCK` | `inv-stock-core.test.ts` (T11) |
| EC-50 | UOM: enter 2.5 Box with precision enforcement on | 422 `UOM_PRECISION`; off: baseQty 30 | `inv-uom.test.ts` (T06, T15) |

---

## 11. Test plan

### 11.1 Rules for every ticket's tests
* API tests use supertest and the helpers in `apps/api/tests/phase5-helpers.ts`; new helpers go into `apps/api/tests/inv-helpers.ts` (T-INV-04): `makeBatchItem`, `makeSerialItem`, `makeFifoItem`, `receive(item, wh, qty, rate, opts)`, `createDemoWarehouseStructure`, `setPolicy`.
* A test's `afterAll` deletes only rows it created (builder rule 7.1). Always `ORDER BY`; sort arrays before comparing. One vitest process at a time.
* Money in tests is compared as strings with 2 dp (`'1650.00'`), quantities with 3 dp.
* After a migration ticket: `npm run db:reset:test`, full `npm run verify`, record the number of passed tests before/after (must not drop).

### 11.2 Unit tests (pure functions, no DB) - `apps/api/tests/unit/`
`inv-formulas.test.ts` (T-INV-35): ADU/sigma example (BR-INV-40), SS 3.489 and 16.815, ROP 48.489, EOQ 382.099, suggested 390 and 175, WAPE 80.0 / bias +6.7, z-table interpolation (95 -> 1.6449, 96.5 -> 1.8157). `inv-barcode.test.ts` (T-INV-33): check-digit vectors (4006381333931 valid, ...932 invalid, 614141123452, 09506000134352), GS1 parse of both forms, date rules (`261231` -> 2026-12-31; `260200` -> 2026-02-28; `991231` -> 1999-12-31), unknown AI. `inv-allocation.test.ts` (T-INV-15): FEFO order example (B2,B3,B1,B4), 20 -> 5/8/7. `inv-ageing-attribution.test.ts` (T-INV-24): the 30/30/46 example. `inv-uom.test.ts` (T-INV-02): factor lookup order, rounding. `inv-putaway-rank.test.ts` (T-INV-26): P2 chosen.

### 11.3 API tests (per ticket, names in the tickets)
One file per page/area as listed in section 10 and in each ticket: `inv-stock-core`, `inv-uom`, `inv-batch`, `inv-serial`, `inv-opening`, `inv-adjustment-approval`, `inv-reservation`, `inv-expiry`, `inv-valuation`, `inv-accounting-events`, `inv-reconciliation`, `inv-ageing`, `wms-structure`, `wms-putaway`, `wms-pick`, `wms-packing`, `wms-cycle`, `wms-physical`, `wms-transfer`, `wms-barcode`, `wms-rfid`, `inv-reorder`, `inv-kpis`, `inv-jobs`, `inv-permissions`, `inv-tabviews` (every `tabViews` key of every page answers 200 with the documented shape for an empty database and for the demo data), `inv-schema-freeze` (T-INV-03/16: for each of the 27 pages the schema fields equal the fixture labels in order, types from `field-types.json`, `[ADD]` fields only after the frozen ones).

### 11.4 Invariants (executed by `GET /inventory/integrity` and by the simulation)
* **INV-1** per item x warehouse: `on_hand = Sigma(qty_in - qty_out)`, `value = Sigma(value)`, and the last ledger row's balances equal the balance row.
* **INV-2** `reserved_qty = Sigma reservations(reserved_qty)` for live statuses; `reserved <= on_hand`.
* **INV-3** batch-tracked: `Sigma stock_batch_balances.on_hand = on_hand`; `Sigma batch reserved = reserved` for batch reservations.
* **INV-4** bin-managed warehouse: `Sigma stock_bin_balances.qty = on_hand` per item x warehouse (x batch).
* **INV-5** serial-tracked: count of serials with status In Stock/Reserved in the warehouse = `on_hand`.
* **INV-6** FIFO items: `Sigma(qty_remaining x rate) = value` and `Sigma qty_remaining = on_hand`.
* **INV-7** every Posted voucher/reconciliation/revaluation has exactly one accounting event (except intra-unit transfers) and `Sigma` of event amounts per unit = `Sigma` ledger value of the corresponding types.
* **INV-8** valuation lines: closing identity and `Sigma closing_value (unit) = Sigma(stock_balances.value)` for a run dated today.

### 11.5 Simulation - `apps/api/tests/inv-simulation.test.ts` (T-INV-40)
Seeded pseudo-random (seed 20261103) 400 operations over 6 items (plain, batch, serial, FIFO, standard, batch+FEFO) x 3 warehouses (one bin-managed): receive, issue (with/without reservation), transfer dispatch/receive, adjustment, reconciliation, revaluation, reserve/release, putaway, pick/confirm, cancel/reverse (random 10 %). After every 20 operations and at the end, all INV-1..INV-8 hold; operations that violate a rule must fail with the documented code and leave all invariants intact. Runtime under 60 s.

### 11.6 End-to-end (Playwright, `tests/e2e/inventory.spec.ts`, T-INV-41) - numbered scenarios with data
1. **Go-live:** admin creates uom `Box`, item `E2E-A` (Nos, alt Box x12, batch-tracked, shelf life 365), warehouse `TAL-MAIN` bins enabled with structure (RCV, STO; rack R01; bins B01-B04 capacity 100). Opening via import CSV: `E2E-A,100,50,BATCH-1,2026-10-01,,` -> opening value 5,000.00; Stock page shows On Hand 100, Average Cost 50.00, Stock Value 5,000.00, Bin STAGING.
2. **Putaway:** task PUT created; complete into B01; bin occupied 100; capacity 100 -> second putaway of 1 into B01 refused (409 text visible as toast), into B02 ok.
3. **Reserve + pick + pack + dispatch:** reservation 40 (High) -> Reserved; Available becomes 60; wave FEFO -> 1 task from B01; picker confirms 40; pack order: 1 carton 50x40x30, gross 12.4 kg; verify weight (item 0.3 kg: expected 12.000, measured 12.200 -> pass); label printed; Ready; Dispatch -> On Hand 60, Reserved 0, ledger Issue 40 @ 50 = 2,000.00; reservation Fulfilled.
4. **Short pick:** reservation 70 when 60 available -> Partial 60; wave; picker confirms 55, reason `Not found` -> Short Picked; reservation reduced to 55 / remainder Waiting.
5. **Count + reconciliation:** cycle plan for A items; counter 1 enters 57 vs system 60 (3 units, 5 % > 2 %) -> Recount; another user enters 57; supervisor Approve -> reconciliation line `-3` value -150.00 -> Post -> On Hand 57; accuracy shows 0.0 % for that plan.
6. **Physical verification:** freeze TAL-MAIN; a receipt attempt shows `WAREHOUSE_FROZEN`; counts entered, approve by Manager (creator is not approver), post -> unfrozen; receipt now posts.
7. **Valuation:** Run Valuation for the month: opening 0, receipt 5,000.00, issue 2,000.00, adjustment -150.00, closing 2,850.00 and equals Stock Value; GL bridge shows `Finance not live`.
8. **Reorder:** policy ROP_EOQ (vendor "Acme", lead time 9, ordering cost 400); Recalculate; suggestion appears; Mark Converted with `PR-001`.
9. **Scan console:** paste `(01)09506000134352(17)261231(10)BATCH-1` -> card shows item, batch and expiry; paste `4006381333932` -> invalid message.
10. **Screenshot freeze:** the 27 pages' register tabs match `reference/screens/v92/` columns (header labels) - asserted by reading `<th>` texts against the registry.

### 11.7 Performance notes
Targets on the dev machine with 250,000 ledger rows: `inv-stock` list page of 20 under 300 ms; ageing for one warehouse under 1 s; valuation run for 5,000 pairs under 5 s; pick allocation for a 50-reservation wave under 2 s; `GET /inventory/integrity` under 30 s (it is an admin tool). All list SQL uses keyset-free `LIMIT/OFFSET` capped at the existing offset cap; every report has an index listed in 5.5. The simulation's `EXPLAIN` is not asserted.

---

## 13. Reviewer checklist

### 13.1 Data
1. Every new table of section 5 exists with the exact DDL (CHECKs, composite FKs, partial unique indexes, append-only triggers on the 8 LOG/append tables: `serial_events`, `batch_events`, `stock_bin_moves`, `stock_layer_consumptions`, `scan_events`, `rfid_read_events`, plus the existing ledger).
2. The 645 earlier tests still pass; the count did not drop; no test was weakened or deleted (the only allowed test edits are the named assertions of T-INV-03/16 for renamed fields).
3. INV-1..INV-8 hold in the simulation; `GET /inventory/integrity` returns `ok: true` on a seeded database.
4. No `number` arithmetic on money/qty in services (grep `parseFloat`, `Number(`, `* ` on Decimals); all rounding is half-up through `money.ts`.
5. All numbers come from `number_series` (`NumberingService`), never `MAX+1`; gap-free proof test exists.

### 13.2 Rules
6. Each `BR-INV-nn` has at least one test asserting its worked example (the numbers in section 6).
7. Every stock-writing path goes through `StockService.postMovement` (grep for `postCoreMovement`/`INSERT INTO stock_ledger` outside `stock/`).
8. Every posting writes its accounting event in the same transaction (INV-7).
9. Locks are taken inside the transaction before reading the value to change (balance row first, then batch row, then reservations).

### 13.3 UI freeze
10. For each of the 27 pages: field labels, order, types, required marks equal `field-types.json`; `[ADD]` items come after; page title/tab names equal the registry; no new page ids; button wording unchanged; CSS only copied from the prototype.
11. The new profile tabs show real data or `No records yet.` - never invented numbers, never the old "built in Phase 9" notice for a tab that has a `tabViews` entry.
12. `Used Capacity`, Reserved/Blocked/Available, ledger 14 columns, opening's 3 fields are present (G-01..G-05).

### 13.4 Security
13. Every route has `requireParamPageAction`/`requirePageAction` with the action of 7.7; `approve` is enforced for approvals; nothing checks roles by name.
14. Data scope applies to documents; unit filter on every list; writes need a concrete unit; lookups limited to the context unit unless admin.
15. No raw string concatenation in SQL (tagged templates or whitelisted identifiers only); import sizes capped (2,000 / 50,000); text lengths bounded; scan `raw` <= 300.
16. `PATCH /inventory/policy` validates every key; `allowNegativeStock` only by SUPER_ADMIN.

### 13.5 Most likely mistakes of a weak builder here
* Forgetting that `qty` on vouchers is the **base** quantity (UOM stored separately).
* Posting one ledger row for a multi-batch issue instead of one per batch (breaks INV-3 and reversal).
* Updating `stock_balances.reserved_qty` without the batch row, or the other way round.
* Reading the balance before taking `FOR UPDATE`, or locking in a different order in two code paths (deadlocks): order is balance, batch balance, reservations, layers.
* Making reconciliation use the snapshot `system_qty` instead of the re-read under lock.
* Recomputing history for backdated entries (forbidden) or valuing a backdated entry at its date.
* Putting stock into STAGING for a non-bin-managed warehouse.
* Letting RFID or the scan endpoint change stock.
* Treating `Variance` (money-typed per fixture) as a value instead of a quantity (DEC-02).
* Renaming `postingDate` keys while fixing labels (labels only; keys stay).
* Adding a Postgres ENUM, a Prisma relation, or editing an applied migration.
* Rendering invented numbers from the prototype's `v9Rows` instead of real data.
