# 02a — Inventory and WMS: scope and the frozen UI (sections 1-3)

Part of `02-INVENTORY-WMS.md` (index). Read `00-BUILDER-RULES.md` and `01-SHARED-FOUNDATION.md` first. Other parts: `02b` (processes), `02c` (database), `02d` (rules, API, reports, extras), `02e` (edge cases, tests, reviewer list), `02f` (tickets).

---

## 1. Scope and status

### 1.1 The 27 pages

"Owner dept" is the department stored on rows (`department` column, as built: `Warehouse`). "Typed (kit)" means: a typed page built with the new table-handler kit (T-INV-04), tables in section 5, registered in `TYPED_PAGES` (`apps/api/src/engine/kinds.ts`) so the generic engine answers 404 `NOT_GENERIC`.

| # | Page id | Title (registry) | Family | Owner dept | Kind | Exists in code today | What this plan adds |
|---|---|---|---|---|---|---|---|
| 1 | `inv-items` | Item / SKU Master | Inventory | Warehouse | BUILT | typed, full CRUD, soft delete, 16 frozen fields | 5 profile-tab views, 4 `[ADD]` fields (valuation method, QC required, unit weight, storage units), tracking locks (BR-INV-13/14), UOM-driven dropdowns, barcode registry link |
| 2 | `inv-stock` | Stock Balance | Inventory | Warehouse | BUILT | typed read-only list of item x warehouse, 10 fields (NOT the frozen 16, gap G-02) | realign to the 16 frozen fields, Reserved / Blocked / Available, location view, 5 tab views |
| 3 | `inv-transactions` | Inventory Transactions | Inventory | Warehouse | BUILT | ledger list + Receipt/Issue vouchers (gap G-03: columns differ) | frozen ledger columns, batch/serial/UOM on the voucher, 5 tab views |
| 4 | `inv-opening` | Opening Stock | Inventory | Warehouse | BUILT | one-item voucher, post/cancel (gap G-04: 3 fields missing) | 3 missing fields, batch/serial opening, warehouse upload (import), validation, posting summary |
| 5 | `inv-adjustment` | Stock Adjustment | Inventory | Warehouse | BUILT | one-item voucher, post/cancel (gap G-05: label `Date`) | label fix, maker-checker threshold, 5 tab views, scrap reason handling |
| 6 | `inv-transfer` | Stock Transfer | Inventory | Warehouse | BUILT | dispatch / receive / cancel, cross-unit | batch/serial carry-over, in-transit report, SLA, 5 tab views |
| 7 | `inv-reservation` | Stock Reservation | Inventory | Warehouse | TO BUILD typed (kit) | nothing | whole page + `StockService.reserve/release` |
| 8 | `inv-reconciliation` | Stock Reconciliation | Inventory | Warehouse | TO BUILD typed (kit) | nothing | whole page, approval, posting |
| 9 | `inv-ageing` | Stock Ageing | Inventory | Warehouse | TO BUILD typed read-only view | nothing | whole page |
| 10 | `inv-valuation` | Stock Valuation | Inventory | Warehouse | TO BUILD typed (kit) | moving average only, in `posting.ts` | FIFO, standard cost, revaluation, runs, GL bridge |
| 11 | `inv-reorder` | Smart Reorder | Inventory | Warehouse | TO BUILD typed (kit) | `reorder_level` on items, "Below Reorder" flag | policies, safety stock, EOQ, suggestions |
| 12 | `inv-batch` | Batch / Lot Tracking | Inventory | Warehouse | TO BUILD typed (kit) | free text `batch_serial` on vouchers | batch master, batch balances, QC, recall |
| 13 | `inv-serial` | Serial Number Tracking | Inventory | Warehouse | TO BUILD typed (kit) | free text only | serial master, history, warranty |
| 14 | `inv-expiry` | Expiry Tracking | Inventory | Warehouse | TO BUILD typed read-only+edit | nothing | whole page, FEFO, dispositions |
| 15 | `wms-warehouses` | Warehouse Master | Warehouse / WMS | Warehouse | BUILT | typed master (gap G-01: `Used Capacity` missing) | Used Capacity, `bin_managed`, `[ADD]` fields, 5 tab views |
| 16 | `wms-zones` | Zone Management | Warehouse / WMS | Warehouse | TO BUILD typed (kit) | nothing | whole page |
| 17 | `wms-racks` | Rack Management | Warehouse / WMS | Warehouse | TO BUILD typed (kit) | nothing | whole page |
| 18 | `wms-shelves` | Shelf Management | Warehouse / WMS | Warehouse | TO BUILD typed (kit) | nothing | whole page |
| 19 | `wms-bins` | Bin Management | Warehouse / WMS | Warehouse | TO BUILD typed (kit) | nothing | whole page, bulk generator |
| 20 | `wms-putaway` | Put Away | Warehouse / WMS | Warehouse | TO BUILD typed (kit) | nothing | tasks, rules, suggestion |
| 21 | `wms-pick` | Pick List | Warehouse / WMS | Warehouse | TO BUILD typed (kit) | nothing | waves, tasks, FEFO/FIFO, short pick |
| 22 | `wms-packing` | Packing | Warehouse / WMS | Warehouse | TO BUILD typed (kit) | nothing | cartons, weights, labels, dispatch |
| 23 | `wms-cycle` | Cycle Count | Warehouse / WMS | Warehouse | TO BUILD typed (kit) | nothing | ABC plan, blind count, recount |
| 24 | `wms-physical` | Physical Verification | Warehouse / WMS | Warehouse | TO BUILD typed (kit) | nothing | freeze, sheets, recount, approval, posting |
| 25 | `wms-transfer` | Warehouse Transfers | Warehouse / WMS | Warehouse | TO BUILD typed (kit) | nothing | multi-line orchestration of pick + dispatch + receive + putaway |
| 26 | `wms-barcode` | Barcode / QR | Warehouse / WMS | Warehouse | TO BUILD typed (kit) | `items.barcode` single value | registry, templates, printers, scan endpoint |
| 27 | `wms-rfid` | RFID Support | Warehouse / WMS | Warehouse | TO BUILD typed (kit) | nothing | tags, readers, import, mismatch report (report only) |

Also in scope but not one of the 27 pages: `admin-uom` (UOM master, today generic) becomes typed (T-INV-06) because the UOM tables are owned by this plan (foundation 3.3 and section 8).

No page is TO BUILD "generic-with-extras": every new page needs its own tables, so all are typed.

### 1.2 Gaps found in the BUILT pages (checked against `apps/api/tests/fixtures/field-types.json`)

| Gap | Page | What is wrong in the code today | Decision |
|---|---|---|---|
| G-01 | `wms-warehouses` | field `Used Capacity` (7th frozen field) is missing | FIX in T-INV-03: add read-only `usedCapacity` between `totalCapacity` and `dockDoors` |
| G-02 | `inv-stock` | fields are `itemCode,itemName,unit,warehouse,uom,onHand,avgRate,stockValue,reorderLevel,status`; frozen list has Zone, Rack, Shelf, Bin, Batch, Reserved, Blocked, Available, Average Cost | FIX in T-INV-03: the schema becomes the 16 frozen fields in frozen order; `unit` and `uom` move to `[ADD]` after `status`; `avgRate` is renamed `averageCost`; tests that name `avgRate` are updated in the same ticket (list them in the report) |
| G-03 | `inv-transactions` | ledger view columns are Date, Voucher No, Type, Item, Warehouse, In, Out, Rate, Value, Balance Qty, Posted By | FIX in T-INV-03: ledger view columns become the frozen 14 (Transaction No, Date Time, Transaction Type, Reference, Item, Warehouse From, Warehouse To, Batch Serial, Qty In, Qty Out, Unit Cost, Value, User, Status); `balanceQty` stays as an `[ADD]` last column |
| G-04 | `inv-opening` | `Upload Batch`, `Validation Status`, `Posting Status` missing | FIX in T-INV-14 |
| G-05 | `inv-adjustment` | label of `postingDate` is `Posting Date`, frozen label is `Date` | FIX in T-INV-03 (label only; key unchanged) |
| G-06 | `inv-items` | `Category` is text, fixture says enum | ACCEPT (DEC-04) |
| G-07 | `inv-adjustment` | `Reason Code` is a select, fixture says longtext | ACCEPT (DEC-03), `reasonNote` longtext `[ADD]` |
| G-08 | all BUILT | profile tabs 2-6 show "built in Phase 9" notice | FIX per page (tab views, section 2) |
| G-09 | `wms-warehouses` | `Operating Hours` is text, fixture qty | ACCEPT (DEC-05) |

### 1.3 What the existing code gives and what we must not break

* `stock_ledger` (append-only, trigger), `stock_balances` (PK item x warehouse), `stock_vouchers` (one table, `kind`), `postMovement` in `apps/api/src/modules/inventory/stock/posting.ts` (moving average, `SELECT ... FOR UPDATE` on the balance row), `Errors.insufficientStock`, `number_series` keyed `(page_id, unit_id, fy_id)`, typed handler interface `TypedHandler` in `typed.ts`, `TYPED_SCHEMAS` in `definitions.ts`.
* The 645 existing tests (API) and the web tests must stay green after every ticket. The approach (section 5.4): every new column on an existing table is nullable or has a default that reproduces today's behaviour; every new rule that could reject an existing flow is gated by tracking flags that no existing test sets, or by a setting whose default keeps today's behaviour.

---

## 2. The frozen UI, page by page

### 2.0 Conventions used in every page block

* Field tables are generated from `field-types.json`: **Label** is frozen; **Key** is what `labelToKey` gives (built pages keep their built key); **Type** and **Req** are the fixture's; **List = col** marks the first 12 fields (the list columns, as `listColumns = fields.slice(0, 12)`). Anything after the 12th is in the form and the drawer only. `[ADD]` fields are listed separately after the table and always come AFTER the frozen fields.
* Every typed page's header is the standard one: title, purpose line (from `PAGES` in the registry), `Excel`, `Print`, and `+ Add` (only when the page is not read-only and the user has `add`). Button wording is never changed.
* Universal tabs (Module Dashboard, Data Quality, Activity Timeline, Audit Trail, Reports and the rest of the 16-tab strip) exist in `apps/web/src/pages/generic/ModuleTabs.tsx` and are not re-planned. The register tab is the profile tab the web picks with `registerTabName` (first tab matching `register|list|directory|master|queue|log`, else the first).
* Profile tab lines: `view key` is the key in `schema.tabViews` (section 7.3). **Kind**: `R` register (the existing list), `C` register with another column set or a preset filter, `A` aggregate (KPIs + table from a report `RPT-INV-nn`, section 8), `W` workspace with action buttons, `S` small CRUD table inside the tab, `K` chart/calendar. The prototype renderer name is given so the screenshot comparison knows which look (stat tiles `v9-workspace`, `v9-section`, tables, stepper) to use. Wherever the prototype renderer draws fake data (`v9Rows`), the real tab shows real rows or the honest empty state: **"No records yet."** (never invented numbers).
* Status values appear in the column `Status` as the existing `status` chip (`statusClass` in `RegisterTab.tsx`).
* Empty state of every list: the existing `No records found.` text; where a page needs a hint the hint is listed.

### 2.1 `inv-items` - Item / SKU Master (BUILT)

Purpose line: *Products and materials: classification, units of measure, tax code, costs and reorder level.*

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does, from which data |
|---|---|---|---|---|---|
| 1 | Item Master | v9Master | (register) | R | the item list with search, status filter, Add/Edit/Delete/Deactivate, import is not in scope |
| 2 | Classification & UOM | v9Master | `items-classification` | C | columns itemCode, itemName, itemType, category, brand, baseUom, altUom, altUomFactor, `[ADD]` ABC and XYZ class (from `item_classifications`); KPI: items without category; link "UOM master" opens `admin-uom` |
| 3 | Tax & HSN | v9TaxWorkspace | `items-tax-hsn` | A | columns itemCode, itemName, hsnSac, `HSN valid` (Yes if 4/6/8 digits), `Tax rate` (from `hsn_sac`/`tax_codes` once the SCM plan builds them; until then the cell is `-`); KPIs: items without HSN, items with invalid HSN length. No invented GST numbers. |
| 4 | Planning Parameters | v9Allocation | `items-planning` | C | itemCode, itemName, reorderLevel, shelfLifeDays, policy min/max/safety/lead time (from `reorder_policies`, first active policy), ABC class, `Below reorder` flag |
| 5 | Traceability Setup | v9Master | `items-traceability` | C | itemCode, itemName, batchTracked, serialTracked, shelfLifeDays, qcRequired, valuationMethod, `On hand` (shows why the flags are locked, BR-INV-14) |
| 6 | Cost & Price | v9Finance | `items-cost-price` | A | itemCode, itemName, standardCost, sellingPrice, `Average cost` (stock-weighted over all warehouses), `Last receipt rate`, `Margin %` = (sellingPrice - averageCost) / sellingPrice x 100 (blank if sellingPrice is 0); KPIs: items without cost, items selling below cost |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Item Code | `itemCode` | code | yes | col | BUILT. Auto `ITM/00001` or user `^[A-Z0-9/_-]{2,30}$`; immutable |
| 2 | Item Name | `itemName` | text | yes | col |  |
| 3 | Item Type | `itemType` | enum |  | col | BUILT select: Raw Material, Semi-Finished, Finished Good, Consumable, Spare Part, Packing Material, Service |
| 4 | Category | `category` | enum |  | col | BUILT as free text (fixture says enum; accepted deviation DEC-04) |
| 5 | Brand | `brand` | text |  | col |  |
| 6 | HSN SAC | `hsnSac` | hsn |  | col | BUILT 4/6/8 digits |
| 7 | Base UOM | `baseUom` | text |  | col | BUILT select; options now come from `uoms` (T-INV-06); frozen once ledger rows exist |
| 8 | Alt UOM | `altUom` | text |  | col | BUILT; needs `altUomFactor` (built extra field, kept) |
| 9 | Barcode | `barcode` | text |  | col | BUILT unique among live items; mirrored to `item_barcodes` primary row (T-INV-32) |
| 10 | Batch Tracked | `batchTracked` | bool |  | col | BUILT bool; locked once stock/ledger exists (BR-INV-14); not with Serial Tracked (BR-INV-13) |
| 11 | Serial Tracked | `serialTracked` | bool |  | col | BUILT bool; same locks |
| 12 | Shelf Life Days | `shelfLifeDays` | qty |  | col | BUILT; required when Batch Tracked and the item has expiry (default expiry = mfg + days) |
| 13 | Standard Cost | `standardCost` | money |  |  | BUILT; the cost used when valuation = Standard Cost |
| 14 | Selling Price | `sellingPrice` | money |  |  |  |
| 15 | Reorder Level | `reorderLevel` | qty |  |  | BUILT simple level; superseded per warehouse by reorder_policies (inv-reorder) |
| 16 | Status | `status` | status |  |  | BUILT Active / Inactive |

`[ADD]` fields (after `status`): `valuationMethod` (select Moving Average / FIFO / Standard Cost, default Moving Average, locked after the first ledger row, BR-INV-22), `qcRequired` (bool: receipts of this item start as `Pending QC`), `unitWeightKg` (qty, 3 dp, used for pack weight check and rack load), `storageUnits` (qty, default 1: capacity units one base UOM occupies, BR-INV-51).
Statuses: Active, Inactive. Row actions: Deactivate / Activate (built), Edit, Delete. Filters: status, search. Header buttons: Excel, Print, + Add. Totals: none. Empty state: `No records found.`

### 2.2 `inv-stock` - Stock Balance (BUILT, read-only)

Purpose line: *Stock on hand per item and warehouse, valued at the moving average.* (kept; the new text of the purpose line is unchanged).

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does, from which data |
|---|---|---|---|---|---|
| 1 | Stock Overview | v9Allocation | (register) | R | list of item x warehouse (`view=summary`, default) or item x warehouse x bin x batch (`view=location`) with a segmented switch (the existing `views` mechanism) |
| 2 | Warehouse Balance | v9Payment | `stock-warehouse-balance` | A | RPT-INV-01: one row per warehouse (code, name, unit, items with stock, total value, % of unit value, capacity used %); click a row filters the register |
| 3 | Available vs Reserved | v9Allocation | `stock-avail-reserved` | C | itemCode, warehouse, onHand, reserved, blocked, available, `Open reservations` (count); only rows with reserved > 0 or blocked > 0; button "Open reservations" goes to `inv-reservation` filtered |
| 4 | Batch Expiry | v9Allocation | `stock-batch-expiry` | C | batch rows of tracked items ordered by expiry ascending: item, batch, warehouse, expiry, days to expiry, available qty, value (RPT-INV-03) |
| 5 | Blocked Stock | v9Allocation | `stock-blocked` | C | RPT-INV-04: item, warehouse, batch, blocked qty, reason (`QC Pending`, `On Hold`, `Rejected`, `Manual hold HLD/...`), since; row action "Release hold" (needs `edit`) for manual holds |
| 6 | Stock Health | v9Allocation | `stock-health` | A | RPT-INV-05: counts OK / Below Reorder / Out of Stock, dead-stock value, value expiring in 60 days, `Ledger integrity` (RPT-INV-53 result: green tick or the list of mismatching pairs), reserved % of on-hand |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Item Code | `itemCode` | code | yes | col | read-only (code of the item) |
| 2 | Item Name | `itemName` | text | yes | col |  |
| 3 | Warehouse | `warehouse` | ref |  | col | read-only; `view=summary` one row per item x warehouse |
| 4 | Zone | `zone` | ref |  | col | read-only; shows the zone when all stock of the row sits in one zone, `Multiple` otherwise, blank when warehouse is not bin-managed |
| 5 | Rack | `rack` | ref |  | col | read-only, same rule as Zone |
| 6 | Shelf | `shelf` | ref |  | col | read-only, same rule as Zone |
| 7 | Bin | `bin` | ref |  | col | read-only, same rule; `view=location` splits the row per bin and batch |
| 8 | Batch | `batch` | text |  | col | text, read-only; batch no when one batch, `Multiple`, blank for untracked items |
| 9 | On Hand | `onHand` | qty |  | col | read-only qty, from stock_balances |
| 10 | Reserved | `reserved` | qty |  | col | read-only qty, stock_balances.reserved_qty |
| 11 | Blocked | `blocked` | qty |  | col | read-only qty, BR-INV-18 |
| 12 | Available | `available` | qty |  | col | read-only qty = max(0, OnHand - Reserved - Blocked) |
| 13 | Reorder Level | `reorderLevel` | qty |  |  | read-only; the reorder policy level of the warehouse, else the item level |
| 14 | Average Cost | `averageCost` | money |  |  | read-only money (6 dp shown as 2 dp); built key was `avgRate` (T-INV-03 renames, see G-02) |
| 15 | Stock Value | `stockValue` | money |  |  | read-only money |
| 16 | Status | `status` | status |  |  | OK / Below Reorder / Out of Stock [ADD] |

`[ADD]` after `status`: `unit` (text), `uom` (text), `valuationMethod` (text). Statuses: OK, Below Reorder, Out of Stock. Row actions: none (drawer only). Filters: warehouse (lookup), `belowReorder` (bool), `[ADD]` batch (text), `[ADD]` view (summary/location). Totals: onHand, reserved, blocked, available, stockValue (of the whole filtered set). Header: Excel, Print (no + Add: read-only, 405 `READ_ONLY`). Empty state: `No stock yet. Post an Opening Stock voucher to start.`

### 2.3 `inv-transactions` - Inventory Transactions (BUILT)

Purpose line: *Manual material receipts and issues; the list shows the stock ledger.*

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does, from which data |
|---|---|---|---|---|---|
| 1 | Movement Ledger | v9Allocation | (register, `view=ledger`) | R | the ledger with the 14 frozen columns; segmented switch Ledger / Vouchers (built) |
| 2 | Receipts | v9Payment | `tx-receipts` | C | ledger rows with voucher type Opening, Receipt, Transfer In (net of reversals), totals qty and value; header button `+ Add` creates a Receipt voucher |
| 3 | Issues | v9Exceptions | `tx-issues` | C | ledger rows Issue, Transfer Out; plus the exception list "issues refused in the last 7 days" is NOT stored, so the tab shows only rows |
| 4 | Transfers | v9Allocation | `tx-transfers` | C | ledger rows Transfer Out / Transfer In paired by voucher no, with `In transit` flag when the matching in-row is missing |
| 5 | Adjustments | v9Allocation | `tx-adjustments` | C | ledger rows Adjustment, Reconciliation, Revaluation with reason (from the voucher) and value |
| 6 | Transaction Audit | v9TaxWorkspace | `tx-audit` | A | RPT-INV-07: per voucher: number, creator, poster, posted at, reversed by; KPIs: vouchers posted today, reversed this month, vouchers posted by their creator above the threshold |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Transaction No | `transactionNo` | code | yes | col | voucher no (TXN/...) for vouchers; ledger rows show the voucher no of the movement |
| 2 | Date Time | `dateTime` | datetime |  | col | ledger `posted_at`; voucher form uses `postingDate` date (built) |
| 3 | Transaction Type | `transactionType` | enum |  | col | voucher form: Receipt, Issue. Ledger: Opening, Receipt, Issue, Adjustment, Reconciliation, Revaluation, Transfer Out, Transfer In, Reversal |
| 4 | Reference | `reference` | ref |  | col | free text (built `reference`) |
| 5 | Item | `item` | ref | yes | col |  |
| 6 | Warehouse From | `warehouseFrom` | ref |  | col | ledger: warehouse of an outflow / transfer-out; voucher form: the single `warehouse` |
| 7 | Warehouse To | `warehouseTo` | ref |  | col | ledger: warehouse of an inflow / transfer-in |
| 8 | Batch Serial | `batchSerial` | text |  | col | text; batch no or serial list (BR-INV-07/12) |
| 9 | Qty In | `qtyIn` | qty |  | col | ledger column |
| 10 | Qty Out | `qtyOut` | qty |  | col | ledger column |
| 11 | Unit Cost | `unitCost` | money |  | col | money (rate, 2 dp shown) |
| 12 | Value | `value` | money |  | col | signed money for ledger rows |
| 13 | User | `user` | ref |  |  | posted by (ref to user) |
| 14 | Status | `status` | status |  |  | ledger rows: Posted / Reversal; vouchers Draft / Posted / Cancelled |

`[ADD]` (voucher form only, after the frozen fields): `uom` (select, default the item base UOM, BR-INV-06), `mfgDate`, `expiryDate` (dates, receipts of batch items), `serialNos` (longtext, one serial per line or comma separated), `reservationNo` (lookup, issues only: consume this reservation). `balanceQty` (ledger last column, read-only). Statuses: ledger Posted / Reversal; vouchers Draft, Posted, Cancelled. Row actions on a voucher: Post, Cancel (needs `delete` once posted), Edit, Delete (Draft only). Filters: `view`, item, warehouse, voucher type, date range `[ADD]`. Totals: qty in, qty out, value. Empty state: `No records found.`

### 2.4 `inv-opening` - Opening Stock (BUILT)

Purpose line: *Opening balance of an item in a warehouse, allowed before any other movement.*

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | Opening Stock Register | v9Allocation | (register) | R | opening vouchers |
| 2 | Warehouse Upload | v9Allocation | `opening-upload` | W | upload panel: choose warehouse, paste or choose a CSV (columns `itemCode,qty,unitCost,batchNo,mfgDate,expiryDate,serialNos`), preview with row errors, button "Create Draft Vouchers" (endpoint `POST /pages/inv-opening/import`, section 7); the list of past upload batches |
| 3 | Batch Serial Opening | v9Allocation | `opening-batch-serial` | C | opening vouchers of batch/serial tracked items with their batch/serial text and expiry |
| 4 | Valuation Basis | v9Finance | `opening-valuation-basis` | A | per item: method (from item), opening qty, cost, value; total opening value per warehouse; note: opening is valued at the unit cost entered, BR-INV-01 |
| 5 | Validation Errors | v9Validation | `opening-validation` | A | RPT-INV-08: the 8 checks (mandatory fields, item active, warehouse in unit, qty > 0, unit cost >= 0, batch required, serial count = qty, no earlier ledger rows) with pass/warn/fail counts of Draft vouchers and a list of failing vouchers with the message |
| 6 | Posting Summary | v9Ledger | `opening-posting-summary` | A | RPT-INV-09: posted opening value per warehouse and FY, voucher count, running total; link to the ledger rows |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Opening Ref | `openingRef` | code | yes | col | BUILT OPN/<UNIT>/<FY>/<0001> |
| 2 | Financial Year | `financialYear` | text |  | col | BUILT read-only |
| 3 | Warehouse | `warehouse` | ref |  | col |  |
| 4 | Item | `item` | ref | yes | col |  |
| 5 | Batch Serial | `batchSerial` | text |  | col |  |
| 6 | Opening Qty | `openingQty` | qty |  | col |  |
| 7 | Unit Cost | `unitCost` | money |  | col |  |
| 8 | Opening Value | `openingValue` | money |  | col |  |
| 9 | Valuation Method | `valuationMethod` | enum |  | col | BUILT read-only; now shows the item method: Moving Average / FIFO / Standard Cost |
| 10 | Upload Batch | `uploadBatch` | text |  | col | text [GAP G-04: not built]; filled by the Warehouse Upload import (T-INV-14) |
| 11 | Validation Status | `validationStatus` | enum |  | col | enum Valid / Warning / Error, read-only [GAP G-04] |
| 12 | Posting Status | `postingStatus` | enum |  | col | enum Not Posted / Posted / Reversed, read-only, derived from Status [GAP G-04] |

`[ADD]`: `postingDate` is built (key `postingDate`, label `Posting Date`, extra), `batchNo`, `mfgDate`, `expiryDate`, `serialNos`, `uom`. Statuses: Draft, Posted, Cancelled. Actions: Post, Cancel. Totals: opening value. Empty state: `No records found.`

### 2.5 `inv-adjustment` - Stock Adjustment (BUILT)

Purpose line: *Correct the stock of an item in a warehouse to the counted quantity.*

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | Adjustment Register | registerTab | (register) | R | adjustment vouchers |
| 2 | Count Variance | v9Finance | `adj-count-variance` | A | RPT-INV-10: variance qty and value by warehouse for the period, count of positive and negative adjustments, largest 10; a small simulator (item, counted qty) that calls the existing preview and shows the value impact before saving |
| 3 | Reason Codes | v9Allocation | `adj-reasons` | A | RPT-INV-10: value and count per reason code (Damage, Expiry, Count Correction, Theft/Loss, Other), share % |
| 4 | Approval Control | v9Approval | `adj-approval` | W | Drafts above the approval threshold waiting for a user with `approve`; buttons Approve / Return (set `approver`, BR-INV-30); the five-level stepper is shown as: Requester, Approver (the others stay inactive) |
| 5 | Value Impact | v9Finance | `adj-value-impact` | A | RPT-INV-11: month trend of net value impact and write-off value (negative adjustments), chart + table |
| 6 | Adjustment Audit | v9History | `adj-audit` | C | audit rows of `VOUCHER_*` events for adjustment vouchers (from `/pages/inv-adjustment/audit`) |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Adjustment No | `adjustmentNo` | code | yes | col |  |
| 2 | Date | `postingDate` | date | yes | col | BUILT key `postingDate`; label must read `Date` (gap G-05, built label was Posting Date) |
| 3 | Warehouse | `warehouse` | ref |  | col |  |
| 4 | Item | `item` | ref | yes | col |  |
| 5 | System Qty | `systemQty` | qty |  | col |  |
| 6 | Counted Qty | `countedQty` | qty |  | col |  |
| 7 | Variance Qty | `varianceQty` | qty |  | col |  |
| 8 | Unit Cost | `unitCost` | money |  | col |  |
| 9 | Value Impact | `valueImpact` | money |  | col |  |
| 10 | Reason Code | `reasonCode` | longtext |  | col | BUILT select Damage, Expiry, Count Correction, Theft/Loss, Other (fixture says longtext; accepted deviation DEC-03); [ADD] `reasonNote` longtext |
| 11 | Approver | `approver` | ref |  | col | BUILT text; BR-INV-30 turns it into a real user check above the threshold |
| 12 | Status | `status` | status |  | col |  |

`[ADD]`: `reasonNote` (longtext), `batchNo` (text, tracked items), `serialNos`. Statuses: Draft, Posted, Cancelled. Actions: Post (needs `approve` too above threshold), Cancel. Totals: value impact. Empty state: `No records found.`

### 2.6 `inv-transfer` - Stock Transfer (BUILT)

Purpose line: *Move stock between warehouses, also across units, in two steps: dispatch and receive.*

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | Transfer Orders | v9Allocation | (register) | R | transfer vouchers |
| 2 | Source Allocation | v9Allocation | `trf-source-allocation` | C | Draft transfers with source `available` now (live preview) and shortage flag |
| 3 | In Transit | v9Logistics | `trf-in-transit` | W | RPT-INV-12: Dispatched transfers with age, vehicle, expected receipt, overdue flag; stepper Ready - Dispatched - Received; Receive button |
| 4 | Destination Receipt | v9Payment | `trf-destination-receipt` | C | received transfers: dispatched vs received qty, days in transit |
| 5 | Transfer Variance | v9Finance | `trf-variance` | A | RPT-INV-13: dispatched value minus received value (0 by rule today; non-zero only for cancelled-in-transit adjustments), by lane (source to destination) |
| 6 | Transfer SLA | v9Allocation | `trf-sla` | A | RPT-INV-14: % received on or before `expectedReceipt`, average transit days per lane |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Transfer No | `transferNo` | code | yes | col |  |
| 2 | Transfer Date | `postingDate` | date | yes | col | BUILT key `postingDate` |
| 3 | Source Warehouse | `sourceWarehouse` | ref |  | col |  |
| 4 | Destination Warehouse | `destinationWarehouse` | ref |  | col |  |
| 5 | Item | `item` | ref | yes | col |  |
| 6 | Requested Qty | `requestedQty` | qty |  | col |  |
| 7 | Dispatched Qty | `dispatchedQty` | qty |  | col |  |
| 8 | Received Qty | `receivedQty` | qty |  | col |  |
| 9 | In Transit | `inTransit` | qty |  | col |  |
| 10 | Vehicle Ref | `vehicleRef` | ref |  | col | BUILT text (fixture ref: accepted, Logistics not built) |
| 11 | Expected Receipt | `expectedReceipt` | date |  | col |  |
| 12 | Status | `status` | status |  | col |  |

`[ADD]`: `batchNo`, `serialNos` (carry over batch/serial identity), `wmsTransferNo` (read-only back-link when created by `wms-transfer`). Statuses: Draft, Dispatched, Received, Cancelled. Actions: Dispatch, Receive, Cancel. Empty state: `No records found.`

### 2.7 `inv-reservation` - Stock Reservation (NEW)

Purpose line (registry): *Maintain accurate quantity, valuation, traceability, replenishment and stock movement controls.*

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | Reservation Register | v9Allocation | (register) | R | reservations; header `+ Add` = manual reservation |
| 2 | Demand Source | v9Allocation | `res-demand-source` | A | RPT-INV-15: required / reserved / short qty grouped by demand type and demand ref |
| 3 | Allocation Priority | v9Allocation | `res-priority` | W | the waiting queue per item x warehouse in allocation order (BR-INV-17); buttons Raise Priority / Lower Priority on a row (changes the enum, re-runs the allocator) |
| 4 | Shortage Handling | v9Allocation | `res-shortage` | W | RPT-INV-16: Waiting and Partial reservations with short qty, `open PO` qty (provider), expected date, buttons: Create Reorder Suggestion (inserts into `reorder_suggestions`), Release |
| 5 | Release Rules | v9Rules | `res-release-rules` | S | the small settings table (BR-INV-16): auto-release after `reservationDays`, release when demand cancelled, expire at `Reserved Until`; stored in `settings` key `inventory.policy` (rows are the 3 rules, toggles `enabled`; the prototype's 6 invented rules are replaced by these 3 real ones) |
| 6 | Reservation Ageing | v9Allocation | `res-ageing` | A | RPT-INV-17: reservation age buckets 0-7, 8-14, 15-30, 30+ days, value reserved, oldest 10 |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Reservation No | `reservationNo` | code | yes | col | RES/<UNIT>/<FY>/<0001>, auto, read-only |
| 2 | Demand Type | `demandType` | enum |  | col | enum Sales Order, Production Order, Transfer Order, Project, Service Job, Manual |
| 3 | Demand Ref | `demandRef` | ref |  | col | ref stored as text (order no) until Sales/Manufacturing exist; `demand_doc_id` nullable uuid for later |
| 4 | Item | `item` | ref | yes | col | lookup items, required, active |
| 5 | Warehouse | `warehouse` | ref |  | col | lookup warehouses (context unit) |
| 6 | Batch Serial | `batchSerial` | text |  | col | text; optional batch no to reserve a specific batch |
| 7 | Required Qty | `requiredQty` | qty |  | col | qty > 0, editable only while Waiting/Partial |
| 8 | Reserved Qty | `reservedQty` | qty |  | col | read-only, filled by the allocator |
| 9 | Available Qty | `availableQty` | qty |  | col | read-only, live available of item x warehouse now (not stored) |
| 10 | Priority | `priority` | enum |  | col | enum Critical, High, Medium, Low (default Medium) |
| 11 | Reserved Until | `reservedUntil` | date |  | col | date, optional; default = today + setting `reservationDays` (14); empty = no expiry |
| 12 | Status | `status` | status |  | col | Waiting, Partial, Reserved, Fulfilled, Released, Expired |

`[ADD]`: `batchId` hidden, `fulfilledQty` (read-only qty). Statuses: Waiting, Partial, Reserved, Fulfilled, Released, Expired. Row actions: Release (any live status; needs `edit`), Re-allocate (Waiting/Partial; needs `edit`), Extend (+7 days, needs `edit`). Filters: status, item, warehouse, demand type, priority. Totals: required, reserved. Empty state: `No reservations yet.`

### 2.8 `inv-reconciliation` - Stock Reconciliation (NEW)

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | System vs Physical | v9Allocation | (register) | R | reconciliation lines (one record per item x warehouse x batch); `+ Add` = manual line |
| 2 | Variance Lines | v9Finance | `rcn-variance-lines` | C | lines with variance <> 0 (from counts), sorted by |value variance| desc; totals |
| 3 | Root Cause | v9Quality | `rcn-root-cause` | W | lines needing a root cause (|value| >= threshold); a form to set cause (select of 8 codes below) and note; Pareto of causes (RPT-INV-18). Cause codes: Counting Error, Unrecorded Issue, Unrecorded Receipt, Wrong Location, Damage, Theft, Unit Conversion, System Error |
| 4 | Approval Posting | v9Approval | `rcn-approval-posting` | W | Under Review lines with buttons Approve / Reject (needs `approve`, approver <> creator above the threshold), Post (Approved only) |
| 5 | Value Impact | v9Finance | `rcn-value-impact` | A | net / gain / loss value of the period by warehouse, % of book value (feeds CARO flag, BR-INV-36) |
| 6 | Reconciliation History | v9Ledger | `rcn-history` | C | posted/cancelled lines with the ledger voucher no and who approved |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Reconciliation No | `reconciliationNo` | code | yes | col | RCN/<UNIT>/<FY>/<0001>, auto |
| 2 | Count Ref | `countRef` | ref |  | col | ref to a wms-cycle / wms-physical count no (text + `count_type`); blank for manual |
| 3 | Warehouse | `warehouse` | ref |  | col | lookup warehouses |
| 4 | Item | `item` | ref | yes | col | lookup items |
| 5 | System Qty | `systemQty` | qty |  | col | read-only; snapshot at creation, re-read under lock at post |
| 6 | Physical Qty | `physicalQty` | qty |  | col | editable in Draft |
| 7 | Variance | `variance` | money |  | col | fixture type money (quirk): holds the signed QTY variance = Physical - System (3 dp); see DEC-02 |
| 8 | Unit Cost | `unitCost` | money |  | col | read-only; average (or FIFO layer cost / standard) at post |
| 9 | Value Variance | `valueVariance` | money |  | col | read-only money = round2(Variance x Unit Cost) |
| 10 | Root Cause | `rootCause` | text |  | col | text, required when |Value Variance| >= threshold (BR-INV-31) |
| 11 | Posting Ref | `postingRef` | ref |  | col | read-only; the ledger voucher no after Post |
| 12 | Status | `status` | status |  | col | Draft, Under Review, Approved, Posted, Rejected, Cancelled |

`[ADD]`: `batchNo` (text), `rootCauseCode` (select of the 8 codes), `countType` (read-only: Cycle / Physical / Manual), `approvedBy` (read-only user). Statuses: Draft, Under Review, Approved, Posted, Rejected, Cancelled. Row actions: Submit for Review, Approve, Reject, Post, Cancel (Posted: needs `delete`, reversal). Filters: status, warehouse, count ref. Totals: value variance (sum). Empty state: `No records found.`

### 2.9 `inv-ageing` - Stock Ageing (NEW, read-only)

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | Ageing Summary | v9Ageing | (register `view=summary`) | R | the 12-field list; bar chart of qty per bucket above the table (the prototype `v9AgeChart`, canvas `barChart`) |
| 2 | 0 to 30 Days | v9Allocation | `age-0-30` | C | rows with `f030Qty` > 0, ordered by qty desc |
| 3 | 31 to 90 Days | v9Allocation | `age-31-90` | C | rows with `f3190Qty` > 0 |
| 4 | 91 to 180 Days | v9Allocation | `age-91-180` | C | rows with `f91180Qty` > 0 |
| 5 | 180 Plus Days | v9Allocation | `age-180-plus` | C | rows with `f180PlusQty` > 0 and their value |
| 6 | Slow Dead Stock | v9Allocation | `age-slow-dead` | A | RPT-INV-20: Slow Moving and Dead Stock rows, value at risk, suggested action; button "Create Transfer Draft" (to a warehouse with demand) and "Create Adjustment Draft (scrap)" (drafts only) |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Item Code | `itemCode` | code | yes | col | read-only view page |
| 2 | Item Name | `itemName` | text | yes | col |  |
| 3 | Warehouse | `warehouse` | ref |  | col |  |
| 4 | Last Movement | `lastMovement` | date |  | col | date of the last ledger row of the item x warehouse |
| 5 | Age Days | `ageDays` | qty |  | col | weighted-average age in days of the on-hand stock (BR-INV-46) |
| 6 | 0 30 Qty | `f030Qty` | qty |  | col | key `f030Qty`; qty aged 0-30 days |
| 7 | 31 90 Qty | `f3190Qty` | qty |  | col | key `f3190Qty` |
| 8 | 91 180 Qty | `f91180Qty` | qty |  | col | key `f91180Qty` |
| 9 | 180 Plus Qty | `f180PlusQty` | qty |  | col | key `f180PlusQty` |
| 10 | Stock Value | `stockValue` | money |  | col | money = on-hand value |
| 11 | Classification | `classification` | enum |  | col | Fast Moving, Normal, Slow Moving, Dead Stock (BR-INV-47) |
| 12 | Action | `action` | longtext |  | col | longtext, generated suggestion; the user may overwrite it (stored in `item_classifications.action_note`) |

Statuses: none (the page has no `Status` field). Row actions: edit the `Action` note only (needs `edit`). Filters: warehouse, classification, `asOf` date `[ADD]`. Totals: stock value, qty per bucket. Header: Excel, Print. Empty state: `No stock to age.`

### 2.10 `inv-valuation` - Stock Valuation (NEW)

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | Valuation Summary | v9Finance | (register) | R | valuation run lines; header button `Run Valuation` (`[ADD]`, dialog: from date, to date, warehouse optional) creates a Draft run |
| 2 | FIFO Layers | v9Allocation | `val-fifo-layers` | C | RPT-INV-22: open cost layers of FIFO items: item, warehouse, received date, remaining qty, rate, value |
| 3 | Weighted Average | v9Allocation | `val-weighted-average` | C | RPT-INV-23: moving-average items: on hand, average rate, value, last receipt rate, difference % |
| 4 | Standard Cost | v9Finance | `val-standard-cost` | W | RPT-INV-24: STANDARD items: standard cost, current average actual, price variance YTD (PPV); button "Revalue to new standard" opens a revaluation draft |
| 5 | Revaluation | v9Finance | `val-revaluation` | S | list of `stock_revaluations`; `+ New Revaluation`, Post, Cancel (BR-INV-23, NRV write-down BR-INV-27) |
| 6 | Inventory GL Bridge | v9Allocation | `val-gl-bridge` | A | RPT-INV-26: per unit: stock value (ledger), GL balance (from `GlBridge`), variance; until Finance is live every GL cell shows `Finance not live` and variance `-`; account role mapping table (section 5.9) |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Valuation Ref | `valuationRef` | code | yes | col | VAL/<UNIT>/<FY>/<0001>-L<line> |
| 2 | Date | `date` | date | yes | col | required; the run's as-of date (to-date) |
| 3 | Warehouse | `warehouse` | ref |  | col |  |
| 4 | Item | `item` | ref | yes | col |  |
| 5 | Method | `method` | enum |  | col | Moving Average, FIFO, Standard Cost (from the item) |
| 6 | Opening Value | `openingValue` | money |  | col | value at start of the period |
| 7 | Receipt Value | `receiptValue` | money |  | col | BR-INV-25 bucket Receipt |
| 8 | Issue Value | `issueValue` | money |  | col | BR-INV-25 bucket Issue (positive number) |
| 9 | Adjustment Value | `adjustmentValue` | money |  | col | BR-INV-25 bucket Adjustment (signed) |
| 10 | Closing Qty | `closingQty` | qty |  | col | qty at the as-of date |
| 11 | Closing Value | `closingValue` | money |  | col | = Opening + Receipt - Issue + Adjustment |
| 12 | GL Balance | `glBalance` | money |  | col | from `GlBridge`; null until Finance is live |
| 13 | Variance | `variance` | money |  |  | = Closing Value - GL Balance; null while GL Balance is null |

`[ADD]`: `runNo` (read-only), `runStatus` (Draft / Final), `unit`. Row actions (of a run line): none; run actions: Finalize (locks the run, captures GL balance), Delete Draft run. Statuses: no `Status` field; `runStatus` chip. Filters: run, warehouse, item, method. Totals: opening, receipt, issue, adjustment, closing value. Empty state: `No valuation run yet. Use Run Valuation.`

### 2.11 `inv-reorder` - Smart Reorder (NEW)

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | Reorder Dashboard | v9Intelligence | (register) | R | policies with live computed columns; chart (line, `lineChart`) of items below reorder over the last 12 months is NOT stored: the chart shows today's counts per status (bar) |
| 2 | Min Max Policy | v9Rules | `ro-min-max` | S | editable table of policies: item, warehouse, method (Min-Max / ROP-EOQ), min, max, multiple, active |
| 3 | Safety Stock | v9Allocation | `ro-safety-stock` | C | RPT-INV-28: ADU, sigma of daily usage, lead time, service level, z, safety stock |
| 4 | EOQ & Lead Time | v9Allocation | `ro-eoq` | C | RPT-INV-29: annual demand, ordering cost, holding cost per unit, EOQ, lead time |
| 5 | Suggested PR | v9Allocation | `ro-suggested-pr` | W | RPT-INV-30: open suggestions grouped by preferred vendor with Select all, "Mark Converted" (enter PR no) and Dismiss; "Create PR" appears only when SCM registers the gateway (section 7.6) |
| 6 | Forecast Accuracy | analyticsTab | `ro-forecast-accuracy` | K | RPT-INV-31: WAPE per item over 6 months and a trend chart; KPIs: overall accuracy %, bias |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Item Code | `itemCode` | code | yes | col |  |
| 2 | Item Name | `itemName` | text | yes | col |  |
| 3 | Warehouse | `warehouse` | ref |  | col |  |
| 4 | Avg Daily Usage | `avgDailyUsage` | qty |  | col | BR-INV-40 |
| 5 | Lead Time Days | `leadTimeDays` | qty |  | col | editable, policy |
| 6 | Safety Stock | `safetyStock` | qty |  | col | BR-INV-41 |
| 7 | Reorder Level | `reorderLevel` | qty |  | col | BR-INV-42 |
| 8 | On Hand | `onHand` | qty |  | col | available quantity incl. in-transit-in is NOT counted here |
| 9 | Open PO | `openPo` | qty |  | col | from `OpenSupplyProvider` (0 until SCM) |
| 10 | Net Requirement | `netRequirement` | qty |  | col | BR-INV-44 |
| 11 | Suggested Qty | `suggestedQty` | qty |  | col | BR-INV-44 |
| 12 | Preferred Vendor | `preferredVendor` | ref | yes | col | required in fixture; stored as text `preferred_vendor` (+ nullable `preferred_vendor_id` for the SCM plan) |
| 13 | Status | `status` | status |  |  | OK, Reorder Soon, Reorder Now, Stock-out, Inactive |

`[ADD]`: `method` (select Min-Max / ROP-EOQ), `minQty`, `maxQty`, `orderMultiple`, `serviceLevelPct`, `orderingCost`, `holdingCostPct`, `eoq` (read-only), `reviewDays`. Statuses: OK, Reorder Soon, Reorder Now, Stock-out, Inactive. Row actions: Recalculate, Generate Suggestion, Deactivate. Filters: status, warehouse, vendor. Totals: suggested qty. Empty state: `No reorder policies yet. Add one per item and warehouse.`

### 2.12 `inv-batch` - Batch / Lot Tracking (NEW)

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | Batch Register | v9Allocation | (register) | R | batches; `+ Add` creates a batch master (normally batches are created by receipts) |
| 2 | Manufacturing Expiry | v9Ageing | `batch-expiry-ageing` | A | expiry buckets (expired, 0-30, 31-60, 61-90, 90+ days) of available batch qty, chart + counts |
| 3 | Batch Stock | v9Allocation | `batch-stock` | C | batch x warehouse rows: on hand, reserved, blocked, available |
| 4 | Batch Movements | v9Allocation | `batch-movements` | C | RPT-INV-32: ledger rows of a batch (forward and backward traceability): date, voucher, type, warehouse, qty in/out; filter by batch no |
| 5 | Quality Status | v9Quality | `batch-quality` | W | QC status of batches with buttons Release, Put On Hold, Reject (each with reason, `edit`); inspection parameter table is NOT built (Quality module later) |
| 6 | Batch Recall | v9Communication | `batch-recall` | W | RPT-INV-33: pick a batch, `Start Recall` (blocks the batch, lists every issue/transfer movement = affected documents and warehouses), timeline of recall notes, `Add Note`, `Close Recall` |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Batch No | `batchNo` | code | yes | col | unique per item; auto `BT/<UNIT>/<FY>/<0001>` when blank on a receipt |
| 2 | Item | `item` | ref | yes | col |  |
| 3 | Warehouse | `warehouse` | ref |  | col | receiving warehouse (first receipt); stock per warehouse in tab Batch Stock |
| 4 | Mfg Date | `mfgDate` | date | yes | col | required in fixture; <= today |
| 5 | Expiry Date | `expiryDate` | date |  | col | > Mfg Date; default Mfg + item shelf life days |
| 6 | Received Qty | `receivedQty` | qty |  | col | read-only, sum of receipts |
| 7 | Available Qty | `availableQty` | qty |  | col | read-only, across warehouses, excludes reserved and blocked |
| 8 | Blocked Qty | `blockedQty` | qty |  | col | read-only |
| 9 | QC Status | `qcStatus` | enum |  | col | Pending QC, Released, On Hold, Rejected |
| 10 | Supplier | `supplier` | ref |  | col | text until parties exist |
| 11 | GRN Ref | `grnRef` | ref |  | col | text |
| 12 | Status | `status` | status |  | col | derived: Active, Exhausted, Expired, Recalled |

`[ADD]`: `disposition`, `recallReason`, `onHandQty` (read-only total). Statuses: Active, Exhausted, Expired, Recalled. Row actions: Release, Hold, Reject, Start Recall, Close Recall, Extend Expiry (reason required, BR-INV-08). Filters: status, item, QC status, expiry range. Totals: available qty. Empty state: `No batches yet. Batches are created when you receive a batch-tracked item.`

### 2.13 `inv-serial` - Serial Number Tracking (NEW)

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | Serial Register | v9Allocation | (register) | R | serial numbers |
| 2 | Ownership History | v9History | `serial-ownership` | W | timeline of `serial_events` of one serial (search box): received, issued to customer, returned, scrapped |
| 3 | Warranty Link | v9Service | `serial-warranty` | A | RPT-INV-34: serials by warranty state: Under warranty, Expiring in 30 days, Expired, No warranty; the prototype kanban lanes are replaced by these four groups |
| 4 | Serial Movements | v9Allocation | `serial-movements` | C | all `serial_events` (date, serial, event, from, to, voucher) |
| 5 | Service History | v9Service | `serial-service-history` | C | rows of serials with a `Service Ticket` reference (read-only until the Service module exists) |
| 6 | Serial Exceptions | v9Allocation | `serial-exceptions` | A | RPT-INV-35: serials In Stock in a warehouse with no matching on-hand (count mismatch), serials issued twice, serials without warranty date on sold items |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Serial No | `serialNo` | code | yes | col | unique per item (company-wide), 1-40 chars `^[A-Za-z0-9._/-]+$` |
| 2 | Item | `item` | ref | yes | col |  |
| 3 | Current Warehouse | `currentWarehouse` | ref |  | col | read-only lookup |
| 4 | Current Owner | `currentOwner` | ref |  | col | text: `Company` or the customer name |
| 5 | Purchase GRN | `purchaseGrn` | ref |  | col | text ref |
| 6 | Sales Invoice | `salesInvoice` | ref |  | col | text ref |
| 7 | Warranty End | `warrantyEnd` | date |  | col | date, editable |
| 8 | Last Movement | `lastMovement` | date |  | col | read-only date |
| 9 | Service Ticket | `serviceTicket` | ref |  | col | text ref (Service module later) |
| 10 | Condition | `condition` | longtext |  | col | longtext editable (New, Used, Damaged ... free note) |
| 11 | Status | `status` | status |  | col | In Stock, Reserved, In Transit, Issued, Returned, Scrapped |

`[ADD]`: `batchNo` (text), `itemTrackingNote`. Statuses: In Stock, Reserved, In Transit, Issued, Returned, Scrapped. Row actions: Edit warranty/condition (needs `edit`), Mark Scrapped (adjustment draft, `delete`-free; creates an Adjustment voucher), Return To Stock (when Returned). No delete. Filters: status, item, warehouse, warranty state. Empty state: `No serial numbers yet.`

### 2.14 `inv-expiry` - Expiry Tracking (NEW)

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | Expiry Dashboard | v9Ageing | (register) | R | batch x warehouse with stock, ordered by expiry; chart of qty by band |
| 2 | Near Expiry | v9Ageing | `exp-near` | C | rows with 0 < days to expiry <= `nearExpiryDays` (60) |
| 3 | Expired Stock | v9Ageing | `exp-expired` | C | rows with days to expiry <= 0 and available > 0, value at risk |
| 4 | FEFO Allocation | v9Allocation | `exp-fefo` | C | per item x warehouse the FEFO sequence with rank 1..n and the next batch to pick (BR-INV-11) |
| 5 | Disposition Actions | v9Workflow | `exp-disposition` | W | five lanes: To Decide, Use First, Discount Sale, Return To Supplier, Scrap/Rework; action buttons move a row between lanes (sets `disposition`); `Scrap` creates an Adjustment draft (reason Expiry) |
| 6 | Expiry Loss | v9Ageing | `exp-loss` | A | RPT-INV-37: value written off for expiry per month (posted Adjustments with reason Expiry + scrapped batches) and value currently expired |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Item | `item` | ref | yes | col | required; view over batch x warehouse |
| 2 | Batch | `batch` | text |  | col | text, batch no (fixture text) |
| 3 | Warehouse | `warehouse` | ref |  | col |  |
| 4 | Expiry Date | `expiryDate` | date |  | col |  |
| 5 | Days to Expiry | `daysToExpiry` | qty |  | col | expiry - today (negative = expired) |
| 6 | Available Qty | `availableQty` | qty |  | col | available of the batch in the warehouse |
| 7 | Stock Value | `stockValue` | money |  | col | available qty x item average cost |
| 8 | FEFO Priority | `fefoPriority` | enum |  | col | Expired, Critical (<=30 d), High (31-60), Medium (61-90), Low (>90) |
| 9 | Disposition | `disposition` | enum |  | col | editable: None, Use First, Discount Sale, Return to Supplier, Rework, Scrap, Donate |
| 10 | Owner | `owner` | ref |  | col | user responsible, editable |
| 11 | Status | `status` | status |  | col | OK, Near Expiry, Expired, Disposed |

`[ADD]`: `itemName`, `expiryBandDays`. Statuses: OK, Near Expiry, Expired, Disposed. Row actions: Set Disposition, Hold Batch (QC On Hold), Create Scrap Adjustment. No create/delete (rows are derived). Filters: status, warehouse, disposition, item. Totals: available qty, stock value. Empty state: `No batch stock with an expiry date.`

### 2.15 `wms-warehouses` - Warehouse Master (BUILT)

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | Warehouse Directory | registerTab | (register) | R | warehouses |
| 2 | Capacity Profile | v9Allocation | `wh-capacity` | C | per warehouse: totalCapacity, usedCapacity, free CU, utilisation %, zone count, bin count, capacity bar |
| 3 | Storage Policy | v9Rules | `wh-storage-policy` | S | per-warehouse switches: `binManaged`, `putawayRequired`, `pickMethod` (FEFO / FIFO), `allowNegative` (read-only here; global setting) - edits `warehouses` `[ADD]` columns |
| 4 | Operating Calendar | v9Calendar | `wh-calendar` | K | month grid (prototype `calendar`/`day` classes) showing holidays and count days: planned cycle counts, physical counts and freezes from `cycle_count_plans` / `physical_counts`, and `Add Closure Day` (closure days are kept in `settings` key `inventory.calendar.<warehouseId>`, a JSON array of `{date,label}`; no table) |
| 5 | Service Zones | v9Allocation | `wh-zones` | C | zones of the warehouse with type, capacity, used (link to `wms-zones`) |
| 6 | Warehouse KPIs | v9Allocation | `wh-kpis` | A | RPT-INV-38: stock value, utilisation %, inventory record accuracy (IRA), dock-to-stock hours, pick lines per hour, open putaway/pick tasks |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Warehouse Code | `warehouseCode` | code | yes | col | BUILT |
| 2 | Warehouse Name | `warehouseName` | text | yes | col |  |
| 3 | Branch | `branch` | ref |  | col | BUILT read-only (the unit) |
| 4 | Address | `address` | longtext |  | col |  |
| 5 | Manager | `manager` | ref |  | col |  |
| 6 | Total Capacity | `totalCapacity` | qty |  | col | BUILT, in capacity units (CU) |
| 7 | Used Capacity | `usedCapacity` | qty |  | col | GAP G-01: not built. Read-only qty = sum of bin occupied CU (0 when not bin-managed: = on-hand qty x item CU) |
| 8 | Dock Doors | `dockDoors` | qty |  | col |  |
| 9 | Operating Hours | `operatingHours` | qty |  | col | BUILT text (fixture qty: accepted, DEC-05) |
| 10 | Temperature Zone | `temperatureZone` | enum |  | col |  |
| 11 | Status | `status` | status |  | col | BUILT Active / Inactive |

`[ADD]` (after `status`): `binManaged` (bool, default false; can be switched on only when stock exists with no bins: it creates the STAGING bin and moves all stock into it, BR-INV-50), `putawayRequired` (bool), `pickMethod` (select FEFO / FIFO / Manual, default FEFO), `frozen` (read-only bool, true while a physical count is freezing it). Statuses: Active, Inactive. Actions: Deactivate / Activate (built). Empty state: `No records found.`

### 2.16 `wms-zones` - Zone Management (NEW)

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | Zone Directory | v9Allocation | (register) | R | zones |
| 2 | Zone Capacity | v9Allocation | `zone-capacity` | C | capacity, used, free, sum of bin capacity, over-allocation flag (BR-INV-51) |
| 3 | Storage Restrictions | v9Allocation | `zone-restrictions` | C | storageClass, temperature, allowed item types (`[ADD]` `allowedItemTypes` text list), hazardous flag |
| 4 | Putaway Priority | v9Allocation | `zone-putaway-priority` | C | zones ordered by putaway priority; up/down buttons change the enum |
| 5 | Picking Strategy | v9Allocation | `zone-picking` | C | pickSequence, zone type, pick method inherited from warehouse; editable pick sequence |
| 6 | Zone Utilization | v9Allocation | `zone-utilization` | A | RPT-INV-39: used / capacity % per zone with bar |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Zone Code | `zoneCode` | code | yes | col | unique per warehouse, `^[A-Z0-9_-]{1,12}$` |
| 2 | Warehouse | `warehouse` | ref |  | col | lookup warehouses, required, immutable after create |
| 3 | Zone Name | `zoneName` | text | yes | col |  |
| 4 | Zone Type | `zoneType` | enum |  | col | Receiving, Storage, Picking, Packing, Dispatch, Quarantine, Returns |
| 5 | Capacity | `capacity` | qty |  | col | CU; sum of bin capacities must be <= it (BR-INV-51) |
| 6 | Used | `used` | qty |  | col | read-only CU |
| 7 | Storage Class | `storageClass` | enum |  | col | General, Cold Chain, Hazardous, Bulk, High Value |
| 8 | Temperature | `temperature` | qty |  | col | deg C, may be negative (qty min -80) |
| 9 | Putaway Priority | `putawayPriority` | enum |  | col | High, Medium, Low |
| 10 | Pick Sequence | `pickSequence` | qty |  | col | integer >= 1, route order (BR-INV-54) |
| 11 | Status | `status` | status |  | col |  |

`[ADD]`: `allowedItemTypes` (text, comma list of item types, empty = all). Statuses: Active, Inactive. Actions: Deactivate / Activate; delete only if no bins (409 `IN_USE`). Filters: warehouse, zone type, status. Empty state: `No zones yet. Add a zone to structure the warehouse.`

### 2.17 `wms-racks` - Rack Management (NEW)

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | Rack Directory | v9Allocation | (register) | R | racks |
| 2 | Rack Capacity | v9Allocation | `rack-capacity` | C | levels, bins count, capacity CU, occupied CU |
| 3 | Load Limits | v9Allocation | `rack-load` | C | maxLoad, usedLoad, % used, flag when > 90 % (BR-INV-62) |
| 4 | Slotting Rules | v9Rules | `rack-slotting` | S | the `putaway_rules` of the warehouse that name this rack's zone (CRUD, section 5) |
| 5 | Occupancy Heatmap | v9Allocation | `rack-heatmap` | K | grid rack x level coloured by occupancy % (green < 60, amber 60-85, red > 85); cells from bins |
| 6 | Rack Audit | v9Allocation | `rack-audit` | W | `lastAudit` per rack, overdue (> 365 days) flag, button "Record Audit" sets `lastAudit` = today and writes an audit row |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Rack Code | `rackCode` | code | yes | col | unique per warehouse |
| 2 | Warehouse | `warehouse` | ref |  | col |  |
| 3 | Zone | `zone` | ref |  | col |  |
| 4 | Aisle | `aisle` | text |  | col | text e.g. A01 |
| 5 | Rack Type | `rackType` | enum |  | col | Selective Pallet, Drive-in, Cantilever, Shelving, Mezzanine, Floor Stack |
| 6 | Levels | `levels` | qty |  | col | integer 1-20 |
| 7 | Max Load | `maxLoad` | qty |  | col | kg |
| 8 | Used Load | `usedLoad` | qty |  | col | read-only kg = sum(qty x item unit_weight_kg) in the rack's bins |
| 9 | Occupancy % | `occupancyPct` | pct |  | col | read-only, key `occupancyPct` = occupied CU / bin capacity CU x 100 (BR-INV-62) |
| 10 | Last Audit | `lastAudit` | date |  | col | date, editable (Rack Audit tab) |
| 11 | Status | `status` | status |  | col |  |

Statuses: Active, Inactive. Actions: Deactivate / Activate, Record Audit. Filters: warehouse, zone, status. Empty state: `No racks yet.`

### 2.18 `wms-shelves` - Shelf Management (NEW)

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | Shelf Directory | v9Allocation | (register) | R | shelves |
| 2 | Shelf Dimensions | v9Allocation | `shelf-dimensions` | C | dimensions parsed to L, W, H cm and volume litres = LxWxH/1000 |
| 3 | SKU Compatibility | v9Allocation | `shelf-compat` | C | storageRule, items currently stored, items violating the rule (rule text is advisory; `[ADD]` `maxItemWeightKg` enforces) |
| 4 | Occupancy | v9Allocation | `shelf-occupancy` | C | occupiedPct, skuCount, weight on shelf vs maxWeight |
| 5 | Replenishment | v9Allocation | `shelf-replenishment` | W | pick-face bins on the shelf below 25 % of capacity with reserve stock elsewhere in the warehouse: suggested move qty; button "Create Move Task" creates a putaway-type task `Replenishment` (priority Medium) |
| 6 | Shelf Audit | v9Allocation | `shelf-audit` | C | lastCount, overdue (> 180 days), button "Create Cycle Count" prefilled for the shelf's bins |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Shelf Code | `shelfCode` | code | yes | col | unique per rack |
| 2 | Rack | `rack` | ref |  | col | lookup racks, required in practice |
| 3 | Level | `level` | text |  | col | text `L1`..`L<levels>` |
| 4 | Dimensions | `dimensions` | text |  | col | text `L x W x H` in cm, pattern `^\d+(\.\d+)?x\d+(\.\d+)?x\d+(\.\d+)?$` |
| 5 | Max Weight | `maxWeight` | qty |  | col | kg |
| 6 | SKU Count | `skuCount` | qty |  | col | read-only, distinct items in its bins |
| 7 | Occupied % | `occupiedPct` | pct |  | col | read-only key `occupiedPct` (BR-INV-62) |
| 8 | Storage Rule | `storageRule` | text |  | col | text, e.g. `Fragile - top level only` |
| 9 | Last Count | `lastCount` | date |  | col | date, set when a count line of the shelf is approved |
| 10 | Status | `status` | status |  | col |  |

`[ADD]`: `maxItemWeightKg`. Statuses: Active, Inactive. Filters: warehouse, rack. Empty state: `No shelves yet.`

### 2.19 `wms-bins` - Bin Management (NEW)

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | Bin Directory | v9Allocation | (register) | R | bins; header buttons `+ Add` and `[ADD]` `Generate Bins` (dialog, section 7) |
| 2 | Bin Capacity | v9Allocation | `bin-capacity` | C | capacity, occupied, available, % full |
| 3 | SKU Slotting | v9Allocation | `bin-slotting` | C | contents of a bin: item, batch, qty, CU; plus `[ADD]` fixed-item assignment (pick faces) |
| 4 | Occupancy Heatmap | v9Allocation | `bin-heatmap` | K | grid of bins coloured by occupancy for the chosen zone / rack |
| 5 | Movement History | v9Allocation | `bin-history` | C | `stock_bin_moves` (date, item, batch, qty, from bin, to bin, task no) |
| 6 | Bin Exceptions | v9Allocation | `bin-exceptions` | A | bins over capacity (cannot happen by BR, listed if it does after a capacity cut), negative bin balances (never), bins with stock but Blocked/Inactive, empty bins marked Full |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Bin Code | `binCode` | code | yes | col | unique per warehouse, `^[A-Z0-9_-]{2,30}$` |
| 2 | Warehouse | `warehouse` | ref |  | col |  |
| 3 | Zone | `zone` | ref |  | col |  |
| 4 | Rack | `rack` | ref |  | col |  |
| 5 | Shelf | `shelf` | ref |  | col |  |
| 6 | Bin Type | `binType` | enum |  | col | Standard, Pallet, Floor, Pick Face, Bulk, Staging, Quarantine |
| 7 | Capacity | `capacity` | qty |  | col | CU |
| 8 | Occupied | `occupied` | qty |  | col | read-only CU |
| 9 | Available | `available` | qty |  | col | read-only CU = Capacity - Occupied |
| 10 | SKU Count | `skuCount` | qty |  | col | read-only |
| 11 | Putaway Priority | `putawayPriority` | enum |  | col | High, Medium, Low |
| 12 | Status | `status` | status |  | col | Active, Inactive, Blocked |

`[ADD]`: `fixedItemId` (lookup items, pick-face bins), `maxWeightKg`. Statuses: Active, Inactive, Blocked. Actions: Block / Unblock (needs `edit`), Deactivate (only when empty, 409 `BIN_NOT_EMPTY`). Filters: warehouse, zone, rack, bin type, status, `emptyOnly`. Empty state: `No bins yet. Use Generate Bins.`

### 2.20 `wms-putaway` - Put Away (NEW)

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | Putaway Queue | registerTab | (register) | R | tasks |
| 2 | Suggested Bins | v9Allocation | `put-suggested` | C | for open tasks: top 3 candidate bins with free CU and the reason (rule no) from the suggestion engine |
| 3 | Rule Priority | v9Allocation | `put-rules` | S | CRUD of `putaway_rules` of the warehouse, ordered by priority; up/down buttons |
| 4 | Operator Tasks | v9Project | `put-operator` | W | per operator: assigned tasks, in progress, completed today (the prototype Gantt is replaced by a table of tasks with start/finish); buttons Assign, Start, Complete |
| 5 | Putaway Exceptions | v9Exceptions | `put-exceptions` | W | tasks in Exception status or older than 4 hours: reason, age, owner; buttons Retry (re-suggest), Cancel |
| 6 | Dock to Stock Time | v9Allocation | `put-dock-to-stock` | A | RPT-INV-42: average and 90th percentile of completed - created hours per day and per dock |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Task No | `taskNo` | code | yes | col | PUT/<UNIT>/<FY>/<0001> |
| 2 | GRN Ref | `grnRef` | ref |  | col | text (receipt voucher no or GRN no) |
| 3 | Item | `item` | ref | yes | col |  |
| 4 | Batch | `batch` | text |  | col | text batch no |
| 5 | Qty | `qty` | qty |  | col | base UOM qty to put away |
| 6 | Source Dock | `sourceDock` | text |  | col | text (dock door / staging bin code) |
| 7 | Suggested Bin | `suggestedBin` | ref |  | col | lookup bins, system-set (BR-INV-52) |
| 8 | Operator | `operator` | ref |  | col | lookup users, editable |
| 9 | Priority | `priority` | enum |  | col | High, Medium, Low |
| 10 | Created Time | `createdTime` | datetime |  | col | read-only datetime |
| 11 | Completed Time | `completedTime` | datetime |  | col | read-only datetime |
| 12 | Exception | `exception` | text |  | col | text reason when status Exception |
| 13 | Status | `status` | status |  |  | Pending, Assigned, In Progress, Completed, Exception, Cancelled |

`[ADD]`: `doneQty`, `chosenBin` (bin actually used), `taskType` (Putaway / Replenishment). Statuses: Pending, Assigned, In Progress, Completed, Exception, Cancelled. Row actions: Assign, Start, Complete, Report Exception, Cancel. Filters: status, operator, priority, warehouse. Empty state: `No putaway tasks. Receipts into a bin-managed warehouse create them.`

### 2.21 `wms-pick` - Pick List (NEW)

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | Pick Waves | v9Allocation | (register `view=waves`) | R | waves (`pick_waves`) as the first view, tasks as `view=tasks` (segmented switch); header `+ Add` = Create Wave |
| 2 | Pick Tasks | v9Allocation | `pick-tasks` | C | the task register (the 12 frozen fields) |
| 3 | Route Optimization | v9Logistics | `pick-route` | W | tasks of one wave in route order (BR-INV-54) with the stepper Released - Picking - Picked - Packed; button Re-sequence |
| 4 | Batch Serial Pick | v9Allocation | `pick-batch-serial` | C | tasks of batch/serial items: allocated batch, expiry, serials to scan |
| 5 | Short Picks | v9Allocation | `pick-short` | W | tasks with Short Qty > 0: reason, alternative bins (BR-INV-55), buttons Re-pick From Another Bin, Accept Short |
| 6 | Pick Productivity | v9Allocation | `pick-productivity` | A | RPT-INV-43: lines per hour per picker, accuracy %, short rate |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Pick Task No | `pickTaskNo` | code | yes | col | PCK/<UNIT>/<FY>/<0001> |
| 2 | Wave No | `waveNo` | text |  | col | text, WAV/... of the wave |
| 3 | Sales Order | `salesOrder` | ref |  | col | text (demand ref of the reservation) |
| 4 | Item | `item` | ref | yes | col |  |
| 5 | Batch Serial | `batchSerial` | text |  | col | text, allocated batch / serials |
| 6 | Source Bin | `sourceBin` | ref |  | col | lookup bins, allocator-set |
| 7 | Required Qty | `requiredQty` | qty |  | col | read-only |
| 8 | Picked Qty | `pickedQty` | qty |  | col | editable by the picker |
| 9 | Picker | `picker` | ref |  | col | lookup users |
| 10 | Route Seq | `routeSeq` | qty |  | col | integer from BR-INV-54 |
| 11 | Short Qty | `shortQty` | qty |  | col | read-only = Required - Picked when closed short |
| 12 | Status | `status` | status |  | col | Open, Released, In Progress, Picked, Short Picked, Cancelled |

`[ADD]`: `waveStrategy` (FEFO / FIFO), `reservationNo`, `shortReason`. Statuses: Open, Released, In Progress, Picked, Short Picked, Cancelled. Task actions: Start, Confirm Pick (qty), Report Short, Cancel. Wave actions: Release, Close. Filters: wave, status, picker, warehouse. Empty state: `No pick tasks. Create a wave from reservations.`

### 2.22 `wms-packing` - Packing (NEW)

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | Packing Queue | v9Allocation | (register) | R | pack orders |
| 2 | Cartonization | v9Allocation | `pack-cartons` | W | cartons of the selected pack order (L, W, H cm, gross kg) with Add Carton / Assign Lines; lines list |
| 3 | Label Printing | v9Allocation | `pack-labels` | W | label data (SSCC-style carton labels, text/QR payload) and `Mark Printed` / `Reprint` (no printer driver in scope, section 7.5 label endpoint returns ZPL and plain text) |
| 4 | Weight Verification | v9Allocation | `pack-weights` | C | expected net weight vs measured, tolerance, pass/fail (BR-INV-56) |
| 5 | Packing Exceptions | v9Allocation | `pack-exceptions` | C | weight fails, unpicked lines, missing labels |
| 6 | Pack Productivity | v9Allocation | `pack-productivity` | A | RPT-INV-45: packs and cartons per packer per day, average minutes per pack |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Pack No | `packNo` | code | yes | col | PAK/<UNIT>/<FY>/<0001> |
| 2 | Sales Order | `salesOrder` | ref |  | col | text |
| 3 | Customer | `customer` | ref | yes | col | required in fixture (ref); stored as text `customer_name` |
| 4 | Picked Qty | `pickedQty` | qty |  | col | read-only sum of pack lines |
| 5 | Cartons | `cartons` | qty |  | col | read-only count of cartons |
| 6 | Gross Weight | `grossWeight` | qty |  | col | kg, sum of carton weights |
| 7 | Volumetric Weight | `volumetricWeight` | qty |  | col | kg = sum(L x W x H cm / 5000) (BR-INV-56) |
| 8 | Label Status | `labelStatus` | enum |  | col | Not Printed, Printed, Reprint Needed |
| 9 | Packer | `packer` | ref |  | col | lookup users |
| 10 | QC Check | `qcCheck` | bool |  | col | bool, set by the weight check or manually with reason |
| 11 | Dispatch Ready | `dispatchReady` | bool |  | col | bool, system-set (BR-INV-57) |
| 12 | Status | `status` | status |  | col | Open, Packing, Packed, Ready to Dispatch, Dispatched, Cancelled |

`[ADD]`: `customerName`, `expectedNetKg`, `measuredNetKg`, `deliveryRef`. Statuses: Open, Packing, Packed, Ready to Dispatch, Dispatched, Cancelled. Actions: Start Packing, Mark Packed, Verify Weight, Mark Ready, Dispatch, Cancel. Filters: status, packer, warehouse. Empty state: `No pack orders. Picked tasks create them.`

### 2.23 `wms-cycle` - Cycle Count (NEW)

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | Cycle Count Plan | v9Allocation | (register) | R | count plans; header `+ Add`, `[ADD]` `Generate Due Counts` |
| 2 | ABC Frequency | v9Allocation | `cyc-abc` | S | table class A/B/C with frequency (days) and tolerance (settings `inventory.policy.cycle`); item counts per class from `item_classifications`; button `Recalculate ABC` |
| 3 | Count Tasks | v9Project | `cyc-tasks` | W | count lines of the plan (bin, item, batch; system qty hidden while `blind`), entry of counted qty; table with start/finish instead of the Gantt |
| 4 | Variance Review | v9Finance | `cyc-variance` | C | lines outside tolerance with count 1, count 2, variance, value; buttons Request Recount, Accept |
| 5 | Approval Posting | v9Approval | `cyc-approval` | W | plan in Under Review: Approve (needs `approve`), creates reconciliation lines |
| 6 | Count Accuracy | analyticsTab | `cyc-accuracy` | K | RPT-INV-46: accuracy % by plan, by class, by month; trend chart |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Count Plan No | `countPlanNo` | code | yes | col | CYC/<UNIT>/<FY>/<0001> |
| 2 | Warehouse | `warehouse` | ref |  | col |  |
| 3 | Zone | `zone` | ref |  | col | lookup zones, optional |
| 4 | ABC Class | `abcClass` | enum |  | col | A, B, C, All |
| 5 | Frequency | `frequency` | enum |  | col | Weekly, Monthly, Quarterly, Half-Yearly, Yearly |
| 6 | Planned Date | `plannedDate` | date |  | col | date |
| 7 | Items Planned | `itemsPlanned` | qty |  | col | read-only |
| 8 | Items Counted | `itemsCounted` | qty |  | col | read-only |
| 9 | Variance Lines | `varianceLines` | qty |  | col | read-only |
| 10 | Accuracy % | `accuracyPct` | pct |  | col | read-only key `accuracyPct` (BR-INV-33) |
| 11 | Supervisor | `supervisor` | ref |  | col | lookup users |
| 12 | Status | `status` | status |  | col | Planned, Counting, Recount, Under Review, Approved, Completed, Cancelled |

`[ADD]`: `blind` (bool, default true), `tolerancePct` (default 2), `toleranceValue` (default 500). Statuses: Planned, Counting, Recount, Under Review, Approved, Completed, Cancelled. Actions: Start, Submit For Review, Approve, Complete, Cancel. Filters: warehouse, class, status, date range. Empty state: `No count plans. Generate due counts or add a plan.`

### 2.24 `wms-physical` - Physical Verification (NEW)

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | Physical Count Plan | v9Allocation | (register) | R | physical counts |
| 2 | Freeze Controls | v9Allocation | `phy-freeze` | W | warehouse freeze state: Freeze / Unfreeze buttons with the list of postings refused since the freeze (count from `audit_logs` action `STOCK_FROZEN_BLOCK`) |
| 3 | Count Sheets | v9Allocation | `phy-sheets` | W | sheets by zone/shelf: lines with blank count box; `Print Sheet` (print view, Print button of the header), entry of count 1 |
| 4 | Recount Queue | registerTab | `phy-recount` | C | lines whose count 1 differs from system beyond tolerance, with count 2 entry |
| 5 | Reconciliation | v9Ledger | `phy-reconciliation` | A | variance lines by value, running total, net variance % of book value, the 10 % CARO flag (BR-INV-36) |
| 6 | Audit Closure | v9History | `phy-closure` | W | sign-off checklist (all lines counted, recount done, variances approved, posted, warehouse unfrozen) and `Close Count` |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Physical Count No | `physicalCountNo` | code | yes | col | PHY/<UNIT>/<FY>/<0001> |
| 2 | Warehouse | `warehouse` | ref |  | col |  |
| 3 | Freeze Date | `freezeDate` | date | yes | col | required date; stock of the warehouse is frozen from the Freeze action |
| 4 | Count Team | `countTeam` | text |  | col | text names |
| 5 | Items | `items` | qty |  | col | read-only line count |
| 6 | First Count Variance | `firstCountVariance` | qty |  | col | read-only qty = sum |count1 - system| |
| 7 | Recount Variance | `recountVariance` | qty |  | col | read-only qty = sum |final - system| |
| 8 | Value Variance | `valueVariance` | money |  | col | read-only money, net |
| 9 | Approved By | `approvedBy` | ref |  | col | lookup users, system-set on Approve |
| 10 | Posting Date | `postingDate` | date |  | col | date, set at Post |
| 11 | Status | `status` | status |  | col | Planned, Frozen, Counting, Recount, Under Review, Approved, Posted, Closed, Cancelled |

`[ADD]`: `tolerancePct` (default 2), `blind` (default true), `closedBy` (read-only user), `closureNote` (longtext). Statuses: Planned, Frozen, Counting, Recount, Under Review, Approved, Posted, Closed, Cancelled. Actions: Freeze, Start Counting, Request Recount, Submit For Review, Approve, Post, Close, Cancel. Filters: warehouse, status. Empty state: `No physical verification yet.`

### 2.25 `wms-transfer` - Warehouse Transfers (NEW)

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | Transfer Queue | v9Allocation | (register) | R | WMS transfers |
| 2 | Inter Warehouse Plan | v9Allocation | `wtr-plan` | C | lines (item, batch, qty), source available, destination capacity |
| 3 | Pick Dispatch | v9Allocation | `wtr-pick-dispatch` | W | pick wave progress of the transfer and Dispatch button (enabled when all lines picked) |
| 4 | In Transit | v9Logistics | `wtr-in-transit` | W | transfers in transit, stepper, Receive button |
| 5 | Destination Putaway | v9Allocation | `wtr-putaway` | C | putaway tasks created at the destination, done vs pending |
| 6 | Transfer Accuracy | v9Allocation | `wtr-accuracy` | A | RPT-INV-48: % lines received complete and put away on time; average cycle hours |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | WMS Transfer No | `wmsTransferNo` | code | yes | col | WTR/<UNIT>/<FY>/<0001> |
| 2 | Source Warehouse | `sourceWarehouse` | ref |  | col | lookup warehouses (context unit) |
| 3 | Destination | `destination` | text |  | col | fixture type text: the destination warehouse CODE, resolved by the server (422 if unknown) |
| 4 | Pick Wave | `pickWave` | text |  | col | text, set when picking starts |
| 5 | Dispatch Ref | `dispatchRef` | ref |  | col | text, the inv-transfer voucher no(s) |
| 6 | In Transit Qty | `inTransitQty` | qty |  | col | read-only |
| 7 | Received Qty | `receivedQty` | qty |  | col | read-only |
| 8 | Putaway Qty | `putawayQty` | qty |  | col | read-only |
| 9 | Variance | `variance` | money |  | col | money, read-only = (dispatched - putaway) x rate |
| 10 | Expected Date | `expectedDate` | date |  | col | date |
| 11 | Status | `status` | status |  | col | Draft, Picking, In Transit, Received, Putaway, Completed, Cancelled |

`[ADD]`: `destinationWarehouseId` (hidden id behind `destination`), `reason`. Statuses: Draft, Picking, In Transit, Received, Putaway, Completed, Cancelled. Actions: Start Picking, Dispatch, Receive, Complete, Cancel. Filters: status, source, destination. Empty state: `No warehouse transfers.`

### 2.26 `wms-barcode` - Barcode / QR (NEW)

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | Barcode Registry | v9Allocation | (register) | R | barcodes |
| 2 | Label Templates | v9Allocation | `bc-templates` | S | CRUD of `label_templates` with a live preview box |
| 3 | Scan Transactions | v9TaxWorkspace | `bc-scan` | W | `[ADD]` scan console: one input (focus kept for a hardware scanner), context select (Lookup / Receive / Put away / Pick / Count), result card (parsed item, batch, expiry, serial, bin) and the last 20 `scan_events`; the stepper of the prototype is replaced by the five contexts |
| 4 | Printer Setup | v9Master | `bc-printers` | S | CRUD of `label_printers` |
| 5 | Invalid Scans | v9Exceptions | `bc-invalid` | C | `scan_events` with `valid = false`: raw text, reason, user, time |
| 6 | Scan Productivity | v9Allocation | `bc-productivity` | A | RPT-INV-49: scans per user per hour, invalid %, per context |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Barcode | `barcode` | code | yes | col | unique among live barcodes, 4-60 chars |
| 2 | Item | `item` | ref | yes | col |  |
| 3 | Barcode Type | `barcodeType` | enum |  | col | EAN-13, UPC-A, Code 128, GS1-128, QR Code, GS1 DataMatrix, Internal |
| 4 | UOM | `uom` | text |  | col | text uom code the barcode stands for |
| 5 | Label Template | `labelTemplate` | ref |  | col | lookup label_templates |
| 6 | Printer | `printer` | text |  | col | text printer code |
| 7 | Last Printed | `lastPrinted` | date |  | col | read-only date |
| 8 | Scan Count | `scanCount` | qty |  | col | read-only |
| 9 | Invalid Scans | `invalidScans` | qty |  | col | read-only |
| 10 | Status | `status` | status |  | col | Active, Inactive, Retired |

`[ADD]`: `packQty` (qty per barcode, default 1), `isPrimary` (bool, read-only). Statuses: Active, Inactive, Retired. Actions: Print Label (returns label payload), Retire. Filters: item, type, status. Empty state: `No barcodes. Each item with a barcode appears here.`

### 2.27 `wms-rfid` - RFID Support (NEW, report only)

| # | Profile tab | Prototype renderer | View key | Kind | What it shows / does |
|---|---|---|---|---|---|
| 1 | RFID Tag Registry | v9Allocation | (register) | R | tags; `+ Add` registers one tag |
| 2 | Reader Setup | v9Master | `rfid-readers` | S | CRUD of `rfid_readers` (code, name, zone, type Portal/Handheld, status) |
| 3 | Read Events | v9Allocation | `rfid-events` | C | `rfid_read_events`; import panel: paste/choose CSV (`epc,readerCode,rssi,readAt`) -> `POST /pages/wms-rfid/import` |
| 4 | Portal Mapping | v9Mapping | `rfid-mapping` | S | reader -> zone mapping and the CSV column mapping (fixed: not editable); shows sample row |
| 5 | Missed Reads | v9Allocation | `rfid-missed` | C | active tags whose last read is older than `missedReadHours` (24) or never |
| 6 | RFID Accuracy | analyticsTab | `rfid-accuracy` | K | RPT-INV-50: matched / (matched + mismatched + missed) %, trend, top 10 mismatched zones |

| # | Label (frozen) | Key | Type | Req | List | Notes |
|---|---|---|---|---|---|---|
| 1 | Tag EPC | `tagEpc` | text | yes | col | hex `^[0-9A-F]{8,48}$`, unique |
| 2 | Item | `item` | ref | yes | col |  |
| 3 | Batch Serial | `batchSerial` | text |  | col | text |
| 4 | Reader Zone | `readerZone` | ref |  | col | lookup zones |
| 5 | Last Read Time | `lastReadTime` | datetime |  | col | read-only |
| 6 | Read Strength | `readStrength` | qty |  | col | RSSI dBm (qty field accepts negative: min -120) |
| 7 | Expected Location | `expectedLocation` | text |  | col | text bin code |
| 8 | Actual Location | `actualLocation` | text |  | col | read-only text, last reader zone/bin |
| 9 | Exception | `exception` | text |  | col | read-only text from the mismatch report |
| 10 | Status | `status` | status |  | col | Active, Missing, Inactive |

`[ADD]`: `epcHex` is the same as `tagEpc` (no extra). RFID NEVER posts stock (BR-INV-61). Statuses: Active, Missing, Inactive. Actions: Mark Missing, Deactivate, Import. Filters: item, zone, status, `exceptionOnly`. Empty state: `No RFID tags registered.`

---

## 3. How the market does it

Research done on 2026-11-02 (sources in section 15). Claims I could not confirm against an official page are marked *(unverified)*. Only ideas are taken; no GPL/AGPL code or text is copied.

### 3.1 Comparison table

| Concept | Odoo | ERPNext / Frappe | Zoho Inventory | SAP Business One | Tally Prime | Dynamics 365 SCM / Business Central | Dolibarr |
|---|---|---|---|---|---|---|---|
| Valuation methods | Standard, Average (AVCO), FIFO per product category *(from memory, unverified)* | FIFO and Moving Average per item; FIFO keeps a queue of [qty, rate] per item x warehouse; method can go FIFO to Moving Average, not back | Average / FIFO (org setting) *(unverified)* | Per item: Moving Average, FIFO, Standard; perpetual inventory | Average Cost, FIFO, FIFO Perpetual, Last Purchase Cost, LIFO, Standard Cost, At Zero Cost per item | FIFO, LIFO, Average, Standard, Specific *(from memory, unverified)* | Weighted average price or standard (PMP) |
| Backdated entries | recomputes valuation layers | **Repost Item Valuation** job recomputes every later ledger entry; major source of user complaints; docs suggest Standard Cost if backdating is frequent | n/a | n/a | n/a | adjust-cost job *(unverified)* | not recomputed |
| Negative stock | setting per location/product | setting "Allow Negative Stock"; ERPNext advises keeping it OFF; v15 does not apply it to serial/batch items; negative stock gives guessed rates and negative values | allowed by setting *(unverified)* | blocked unless setting | allowed ("negative stock" warning) | blocked for serial/lot-tracked items *(blog, unverified)* | allowed by setting |
| Batch / lot | Lots with expiry (use/removal/alert dates); removal strategy FIFO, LIFO, FEFO, closest location | Batch doctype, expiry, batch-wise valuation optional; v15 "Serial and Batch Bundle" | Batch Reference# (yours) and Manufacturer Batch#; an item is batch OR serial, not both | batch management with expiry | batch with mfg / expiry, "days left" reports | item tracking codes enforce expiry rules; lots and serials | Lot/Serial module: once flagged, no movement without the number; dates stored per lot |
| Serial | per-unit lots (qty 1) | Serial No doctype with warranty, status, valuation per serial optional | serial per unit, warranty | serial management with warranty | n/a (not core) | serial item tracking | serial with sell-by |
| Reservation | reservation on pickings/moves; reserved qty reduces "free" | Reserved qty in Bin; Stock Reservation Entry (v15) | committed stock in sales orders | committed qty in item master data | n/a | reservation entries | per-order allocation |
| Putaway | putaway rules per product or category, with capacity limits (newer versions) *(vendor blog)* | none native (manual) | bin locations (smallest unit) | bin locations, sub-levels | godown | work templates + location directives (rules choosing put/pick locations) | none |
| Pick | removal strategies, batch pickings, waves | Pick List (from sales order, by warehouse) | picklists | pick and pack manager | n/a | wave templates, work pools, work templates | shipment picking |
| Cycle count | location-level "Inventory Frequency (days)" + scheduled date + annual inventory day | Stock Reconciliation (no native schedule) | n/a | stock posting / counting | physical stock voucher | cycle count plans, thresholds, by-location or by-item; physical inventory journals | inventory module |
| Reconciliation | inventory adjustments (apply counts) | Stock Reconciliation for opening and cycle counts; difference account; known problems with backdating and serial/batch | inventory adjustments | inventory posting | physical stock | physical inventory journal; directed locations use warehouse physical inventory journal | inventory correction |
| Reorder | Reordering rules min/max, trigger auto/manual, multiple, route, lead times | Reorder level + request qty on Item, auto material request | reorder point per item, "low stock" report, reorder point calculator *(vendor page)* | MRP wizard | reorder level report | planning / replenishment | alert + replenishment page |
| Revaluation | landed costs, manual revaluation of layers | Stock Reconciliation value change; Landed Cost Voucher | inventory adjustment (value) | Inventory Revaluation document (Moving Average and Standard; FIFO is disputed in sources) | n/a | revaluation journal | n/a |
| Barcode | Barcode app, GS1 | Barcode scanner field | barcode on items | n/a | n/a | barcode + GS1 | Warehouse Scanner Pro (add-on) |
| QC hold / blocked | quality checks, scrap | Quality Inspection; rejected warehouse | n/a | blocked status in bins/warehouses | n/a | blocked inventory status, blocking by lot | n/a |

### 3.2 What the standards say (verified from the pages used)

* **Ind AS 2 Inventories:** carry at the lower of cost and net realisable value (NRV); cost formulas FIFO or weighted average for interchangeable items, specific identification for non-interchangeable; the same formula for inventories of similar nature; LIFO is not allowed; write-down to NRV is an expense in the period; a reversal is allowed when NRV rises but only up to the original write-down. (Secondary guides; confirm paragraph numbers against the ICAI/MCA text before quoting in an audit file.) We implement: BR-INV-01 (average), BR-INV-20 (FIFO), BR-INV-27 (NRV write-down and capped reversal). LIFO is deliberately not offered.
* **CARO 2020 clause 3(ii)(a):** the auditor reports whether inventory was physically verified at reasonable intervals and whether discrepancies of **10 % or more in aggregate for each class of inventory** were properly dealt with in the books. We implement the flag in the physical verification (BR-INV-36). Clause 3(ii)(b) (quarterly bank statements agree with books, for working-capital limits above Rs 5 crore) is a Finance/Banking matter, not built here.
* **GST (dates matter, today is 2026-11-02):** since **22 Sep 2025** (56th GST Council, 3 Sep 2025) most goods are taxed at **5 % or 18 %**, with **40 %** for a few luxury/sin goods; the old 12 % and 28 % slabs are gone for most items. Rates are therefore never hard-coded in Inventory; the HSN-to-rate lookup stays in the tax master of the SCM plan. Section 17(5)(h) CGST blocks input tax credit on goods **lost, stolen, destroyed, written off or given as gifts/free samples**; so an adjustment or scrap that physically writes goods off has a GST consequence (ITC reversal), whereas a mere value write-down to NRV is argued not to trigger it (commentary only, *unverified* against CBIC text). Inventory therefore tags these postings: reason codes `Damage`, `Expiry`, `Theft/Loss` and scrap set `gst_itc_reversal_flag = true` in the accounting event payload, for the Finance/Tax plan to act on.
* **GS1:** AI (01) GTIN 14 digits, (10) batch/lot 1-20 alphanumeric, (17) expiry YYMMDD, (21) serial 1-20 alphanumeric; fixed-length AIs are not followed by a separator, variable-length AIs are terminated by the FNC1 (ASCII 29) unless last. AIs are mandatory in GS1-128, GS1 DataMatrix and GS1 QR Code. EPC/RFID tags use SGTIN-96 encoding by the Tag Data Standard; passive UHF Gen2 (ISO/IEC 18000-63) *(details unverified, from GS1 summaries)*.
* **Safety stock, reorder point, EOQ:** ROP = average daily demand x lead time + safety stock; SS = z x sigma_d x sqrt(LT) (z = 1.28 / 1.65 / 2.33 for 90 / 95 / 99 %); with lead-time variability SS = z x sqrt(LT x sigma_d^2 + d^2 x sigma_LT^2); EOQ = sqrt(2DS/H). The trigger should compare against forecast available stock (on hand - reservations + incoming), not raw on hand. (Vendor guides; textbook formulas.)
* **ABC / cycle counting:** ABC by annual consumption value (unit cost x usage); class A counted most often. Sources disagree on the exact cutoffs and frequencies (examples: A weekly/monthly, B monthly/quarterly, C quarterly/yearly); the frequency number is a minimum per year and classes should be reviewed yearly. We therefore make the thresholds and frequencies **settings** with defaults (80 / 95 % cumulative value; A monthly, B quarterly, C yearly), not facts.

### 3.3 Known user complaints and pitfalls (and our answer)

| Pitfall seen in the market | Our answer |
|---|---|
| Backdated entries silently change later valuation (ERPNext Repost Item Valuation; slow, error prone) | We **do not recompute** history. Posting date may be chosen inside the open FY, but the moving average is computed in posting order; a backdated entry is valued at the current average (BR-INV-02). FIFO layers are consumed in layer order, not date order. Documented, tested, no repost job. |
| Negative stock corrupts valuation and rates | Default blocked, DB CHECK stays; the setting, when on, uses an exact rule (BR-INV-04) and never applies to batch/serial items |
| Stock value and general ledger drift apart | Every stock posting writes an accounting event in the same transaction; a daily GL bridge variance report; invariant tests (section 11) |
| Stock reconciliation with batch/serial and backdating gives wrong differences (ERPNext threads) | Reconciliation works per item x warehouse x batch with the system qty re-read under lock at post; serial items are reconciled by serial list; stale-count detection (BR-INV-34) |
| Reserved stock is issued to someone else | Issue limit = on hand - reserved - blocked (BR-INV-03) |
| FIFO valuation does not mean the warehouse picks oldest first (Tally note) | Pick allocation is a separate rule (FEFO/FIFO by batch/bin), BR-INV-11 and 54 |
| Bin locations forced on everyone (Zoho forum asks for bins without batches) | `warehouses.bin_managed` is a per-warehouse switch; bins work without batch tracking |
| Large uploads (> 5,000 rows) unreliable (ERPNext forum) | Import is chunked: max 2,000 rows per request, one voucher per row in a transaction per 200 rows, rows with errors are reported, not silently dropped |
| Unit of measure mismatches break reconciliation to GL | UOM conversion is explicit and stored on the voucher (`uom`, `uom_factor`, `base_qty`) |

### 3.4 What we adopt, what we skip

| Adopt | From | Why |
|---|---|---|
| FEFO removal strategy, expiry-aware allocation | Odoo, D365, Tally | pharma/food/chemical customers of Sawant need it; cheap with a batch table |
| Location hierarchy warehouse > zone > rack > shelf > bin with capacity | SAP B1 (sub-levels), D365, Zoho | the frozen WMS pages demand it |
| Putaway rules with priority and capacity | Odoo, D365 location directives | the frozen `Rule Priority` tab |
| Min/Max reordering with multiple, trigger on forecast available | Odoo | simple and understood by store keepers |
| Safety stock by service level and EOQ | textbook, Zoho calculator | frozen fields `Safety Stock`, `EOQ & Lead Time` |
| Per-item valuation method (Moving Average, FIFO, Standard) | SAP B1, Tally, ERPNext | one engine, three strategies |
| Inventory revaluation document | SAP B1 | the frozen `Revaluation` tab; keeps GL in step |
| Cycle count frequency per class with next date | Odoo, D365 | frozen `ABC Frequency` tab |
| Count freeze for physical verification | D365 / SAP practice | prevents false variances |
| "Batch OR serial, not both" | Zoho | removes a large class of edge cases |
| Landed cost as value-only adjustment | ERPNext Landed Cost Voucher | SCM needs it (hook `applyLandedCost`) |
| Inventory-to-GL reconciliation report | Sage / ERPNext guidance | frozen `Inventory GL Bridge` tab |
| Blocked stock via QC status on the batch | D365 inventory status | frozen `Blocked` column |

| Skip (and why) | |
|---|---|
| LIFO, Last Purchase Cost, At Zero Cost | not allowed by Ind AS 2 (LIFO) or not useful; keeps the engine small |
| Automatic repost of history | complexity and user pain; replaced by "no backdated recompute" rule |
| Serial-wise valuation (cost per serial) | rarely needed in this business; serial items value at the item's method; COULD later |
| RFID driven stock posting | RFID is report only (brief); mismatch report instead |
| Drools-style generic rule engines for putaway | a priority list of simple rules is enough |
| Full WMS directed work (D365 work templates, work pools) | too heavy; tasks + waves are enough for 3 units |
| Carrier integration / shipping labels via API | Logistics module later |
