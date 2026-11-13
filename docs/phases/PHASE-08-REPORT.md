# PHASE-08 REPORT — Inventory & WMS v2

Built 2026-11-07. Local only: nothing pushed, nothing deployed, nothing committed. Dev database `rhai_erp` migrated; test DB `rhai_erp_test` reset freely.

## 0. How the spec was defined (read this first)
`docs/phases/PHASE-08.md` holds only the four client requirements. You chose (this session):
* **Migrations A / B / C** = the archive plan's M1–M6 (`docs/archive/plans/02c*`) regrouped and adapted to today's rules.
* **GL**: inline through Phase 7 `PostingService` in the same transaction (the old event queue is replaced; ERRATA/Phase 7 open question 5).
* Build steps 1–13; **migration D only after your approval**.
Everything archive-only that conflicts with the current rules was changed: no `company_id` (D-01), voucher types in a lookup table not a CHECK list (D-11), no PO/pick/pack/putaway/RFID (not in your step list).

## 1. What was built
| Step | Result |
|---|---|
| 1 Migrations A, B, C + pre-flight + verification queries | `20261116000000_phase08_a_foundation`, `…010000_phase08_b_tracking`, `…020000_phase08_c_counts_reorder`; `npm run inventory:preflight`; `prisma/verify/phase08-verify.sql` (V-01…V-07) |
| 2 `postMovement` → `postCoreMovement` (+ re-export) | `stock/posting.ts` |
| 3 `StockService` | sorted locking, slices (batch/bin/status), batches + FEFO + expiry/QC/recall blocking, serials, **Quality Inspection stock**, reservations/holds/freeze guards, backdate guard (D-20), in-transaction equality assertion (slices = balance = last ledger row; journal = ledger) |
| 4 Vouchers with header + lines | submit → approve (Phase 5 engine, maker ≠ checker) → post / dispatch / receive / cancel; cancel = reversal of stock AND GL dated the cancel date |
| 5 Transit warehouses + transfers | per-unit transit warehouse on `STOCK_IN_TRANSIT`; inter-unit clearing for cross-unit; **E-24** refuses different GSTINs with the exact message |
| 6 Batch / serial / bin masters + pages | QC status, extend expiry, disposition, recall with affected documents, serial history, bin CRUD |
| 7 Reservations + holds | priority allocator (Critical>High>Medium>Low), consume by issue, expiry job, hold release |
| 8 Counts + reconciliation | cycle (blind, tolerance, recount by another person, stale), physical (warehouse freeze, CARO 10 % flag), **weekly Powder Stock Monitoring Sheet** (5 week rows per powder item, Remarks, Checked By + date) → one Adjustment voucher through the normal flow |
| 9 Reorder, ageing, expiry, valuation, jobs | Min/Max and ROP+EOQ with the archive's worked examples; ageing (newest-receipts-backwards), expiry bands, valuation buckets + stock-vs-GL; pg-boss `inventory.daily` 02:00 IST (reservation expiry, reorder suggestions, expiry/reorder alerts via Phase 5 notifications `STOCK_EXPIRING`, `STOCK_REORDER`) |
| 10 Barcode + GS1 | EAN/UPC/GTIN check digits, GS1 AI 01/10/17/15/21/30/37, human + machine strings, context rules, `scan_events` log; never posts stock |
| 11 UI | 14 screens: Opening, Transactions (Ledger \| Vouchers), Adjustment, Transfer, Batches, Serials, Bins, Reservations (+Holds), Reconciliation, Cycle Count, Physical Verification, Smart Reorder, Ageing, Expiry, Valuation (+books check, integrity, pre-flight, cut-over for administrators), Barcode |
| 12 Tests | see §4 |
| 13 GL cut-over job | `GET/POST /inventory/gl-cutover` (once per unit; opening journal = stock − GL per inventory account; drains old queue rows) |
| 14 Migration D | **drafted, NOT applied**: `apps/api/prisma/pending/phase08_d_legacy_cleanup.sql` |

Client requirements: (1) powder sheet ✔; (2) Quality Inspection status ✔ (receipts of items flagged "Quality Inspection Required" — new item field — or lines marked so land in QI and cannot be issued; `POST /inventory/stock-status` moves them to Unrestricted/Blocked, Phase 12 will call `StockService.changeStatus`); (3) batch + manufacturing/expiry dates + expiry alerts ✔; (4) customer-supplied material ✔ (built after the first report; see §1A).

## 1A. Customer-supplied material (client requirement 4, ERRATA E-32)
Built from research on how SAP (special stock, non-valuated), ERPNext (zero-rate workaround, discouraged by its own docs) and Indian GST job work (Section 143: goods move on a challan and come back against it) handle it. Decision taken with the owner: **customer material is its own non-valued stock, not a flag on the item.**
* **Migration E** `20261118000000_phase08_e_customer_material` (applied to `rhai_erp` and `rhai_erp_test`): `customer_material_lots` (one lot per customer × item × warehouse × challan × batch), `customer_material_docs`, `customer_material_lines`, `customer_material_ledger` (append-only, trigger-protected), lines frozen by trigger.
* **It never touches** `stock_balances`, `stock_ledger`, `stock_slices` or the GL. So "stock value = GL" cannot be disturbed, our production cannot consume it, and our own Issue voucher on that item says "insufficient stock".
* **Three documents**, each posted at once (no approval, because nothing moves in our books): **Received** (needs the customer challan number + date; batch / dates; expired material is refused; the same challan + item + batch twice is refused as a double entry), **Used for a job** (needs a job / work order number; cannot exceed the lot; another customer's lot or an expired lot is refused), **Sent back** (needs our return challan number).
* **Cancel** = reverse movements dated the cancel date, with a reason (min 5 letters); a receipt cannot be cancelled while part of it is used; a posted line / ledger row can never be edited or deleted (database refuses).
* **Integrity check INV-7** added to `/inventory/integrity`: each lot balance = sum of its ledger.
* **Screen**: Inventory Transactions › **Customer Material** tab: three big numbered buttons, "Material we hold" (per customer / item, expandable lots, red *Expired / Expires soon*, "See movements" history), "Receipts, issues & returns" list with Cancel.
* **Left for Phase 13 (as the spec says)**: inward / outward registers per customer PO line and the rework register against the customer's challan (challan no, date, part, challan qty, balance qty, rework done at challan no).

## 1B. Who does what: click guide (also inside every screen under "How this works")
Roles: **Store keeper** = warehouse staff; **Manager (approver)**; **Quality person**; **Administrator**. Every inventory screen has a collapsible *"How this works: who does what"* strip under its title (customer material opens by default).

| Screen (menu) | Store keeper | Manager (approver) | Quality / Admin |
|---|---|---|---|
| Opening Stock | New Opening Stock › Save draft › Submit › (after approval) Post | Approve in My Approvals | – |
| Inventory Transactions › Vouchers | New Receipt / Issue › Save draft › Submit › Post | Approve | Quality person releases QI stock (Batch screen) |
| Inventory Transactions › Customer Material | 1 Received · 2 Used for a job · 3 Sent back | Weekly look at red Expired lines; Cancel a wrong entry | – |
| Stock Adjustment | New Adjustment (counted qty + reason) › Submit › Post | Approve | – |
| Stock Transfer | New Transfer › Submit › Dispatch (sender) › Receive (receiver) | Approve | – |
| Batch / Lot | – | – | Quality: Release / Hold / Reject, Extend expiry, Recall |
| Serial, Bins | Search serial history; choose bin when receiving | – | Admin creates bins |
| Reservation | New Reservation (priority); choose it on issue; Release | – | – |
| Cycle Count / Physical / Powder sheet | Start, enter counts, recount if asked | Approve (a different person from the counter), writes *Checked By* on the powder sheet | – |
| Reconciliation | – | Check differences, Approve to post | – |
| Smart Reorder | Read daily suggestions | Convert (enter PR no.) or Dismiss (reason) | Admin sets policies |
| Ageing, Expiry, Valuation | Weekly look at Critical / Near Expiry | Read ageing and valuation | Admin: pre-flight, integrity, books cut-over |
| Barcode / QR | Scan or type a code | – | – |

## 2. Migrations and DB changes
A (lookup `stock_voucher_types`, `item_type_accounts`, `stock_voucher_lines`, voucher header columns, transit flag, event queue loses `company_id`), B (`batches`, `batch_events`, `wms_bins`, `serial_numbers`, `serial_events`, `stock_slices`, `stock_reservations`, `stock_holds`; ledger FKs), C (`stock_counts`, `stock_count_lines`, `reorder_policies`, `reorder_suggestions`, `scan_events`, `inventory_gl_cutovers`, warehouse freeze column, **lines backfill for every legacy voucher, idempotent**). Applied to `rhai_erp` and `rhai_erp_test`. Dev DB had no stock data, so the backfill is proven by `tests/phase08-migration.test.ts` on a hand-made legacy voucher.

## 3. Deviations / things you must decide
1. **Old single-item flow is gone** (R-08). The generic `/pages/inv-*/records` API still lists/gets vouchers and still accepts the old one-item *create* (turned into a one-line voucher). Edit/delete/actions only on `/api/v1/inventory/vouchers/...`.
2. **Skipped, not deleted** (STANDARDS: never delete other phases' tests): API `phase5-stock.test.ts`, `phase5-simulation.test.ts`; web describes "Opening Stock", "Stock Transfer", "Stock Adjustment computed fields" (InventoryPages) and "Ledger | Vouchers toggle" (Views); e2e `phase5.spec.ts`. Each states what replaced it. Also skipped (superseded old one-item screens): web `TypedPages.test.tsx` (3 suites) and `Views.test.tsx` "action requires". Also updated: `phase5-helpers.ts` (old call shapes → new API), frozen fixture `inventory-schemas.json` (+ the `qcRequired` item field), web test helper `permissionsRoute` (more actions).
3. **Open owner decisions I did not guess**: customer-supplied material (E-32a); powder list = items with category "Powder" until the client confirms (E-32e); count tolerance 2 % / ₹500 and ABC cut-offs are the archive defaults; manual receipts credit `GRIR`, issues debit `CONSUMPTION_EXPENSE` (Phase 9 clears GRIR).
4. Item type → inventory account is data (`item_type_accounts`): Raw/Packing/Consumable/Spare → `INVENTORY_RM`, Semi-Finished → `_WIP`, Finished → `_FG`. Expense legs need a cost centre in the unit (pre-flight P-07).
5. Not built (not in your list): put-away/pick/pack/RFID, serial reservation, FIFO/standard-cost layers, revaluation/NRV documents, ABC/XYZ, landed cost.
6. Migration D also VALIDATEs `items_hsn_required` (Phase 6 promised this for Phase 8) — it refuses to run while any item lacks an HSN.

## 4. Test results (clean database each run)
| Suite | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| API `npx vitest run` (66 files, after customer material) | 964 pass / 45 skipped | 964 / 45 | 964 / 45 |
| Phase 8 files inside it: vouchers 7, stock 18, edge 12, migration 2, simulation 1 (150 random ops, integrity every 25), pure 11 | all pass | all pass | all pass |
| Web `src/pages/inventory` (11 tests) and the full web suite (43 files) | 372 pass / 29 skipped (full suite, once) | inventory 11 / 11 | inventory 11 / 11 |
| e2e `phase8.spec.ts` (6 stories, after `auth.spec.ts` on a fresh e2e DB) | 6 / 6 | 6 / 6 | 6 / 6 |

Integrity output (INV-1…INV-6, stock value = GL in every unit) after run 3: `docs/phases/PHASE-08-INTEGRITY.txt`.
Covered: 401/403 on 23 routes, 404 other unit, 422 field errors, illegal transitions, 3 parallel posts → one wins, Idempotency-Key replay/409, audit rows, backdate guard, freeze, maker≠checker on counts, cancel date, E-24, GL = stock.

## 5. Known issues
* `npm run e2e` (all specs): 7 failures outside Phase 8: `auth.spec` #6 (waits for an old role label; 1-minute timeout), `phase2` setup, `phase3` #73, `phase4` #130, `phase4b` #57 (all 1-minute timeouts after the auth failure) and `phase6b` #73 (Formats & Rules, a Phase 6B screen). I did not touch those specs and did not verify them against the code before Phase 8, so treat them as unexplained rather than proven pre-existing. Phase 8 stories alone: `npx playwright test -c tests/e2e/playwright.config.ts auth.spec.ts phase8.spec.ts` (6/6 pass; `auth.spec` #6 still fails).
* Repo-wide `npm run lint` still reports the old errors outside Phase 8 files; every Phase 8 file is eslint/prettier/tsc-clean (two intentional `Number()` DTO warnings in reports).
* Web full-suite and API full-suite pass except for the skipped legacy suites above.

## 6. Manual check list (5–15 clicks)
1. Sign in as owner, unit Talwade. **System Setup › Control Center**: switch approval off for the four stock vouchers (or keep it on and use a second approver).
2. **Item Master**: add `POWDER-RED`, category Powder, Batch Tracked, Shelf Life 365, Quality Inspection Required.
3. **Inventory Transactions › Vouchers › + New Receipt / Issue**: warehouse TAL-MAIN, item POWDER-RED, qty 25, cost 120, batch `R-1`, made today, expiry in 20 days → Save draft → Submit → Post.
4. **Ledger** tab shows the movement; **Stock Valuation** shows "In balance"; **Expiry Tracking** shows the batch as Critical/Near Expiry.
5. Create an Issue of 1 kg → Post → plain refusal naming Quality Inspection.
6. **Batch / Lot Tracking › Open** the batch → Release (reason). Issue now works.
7. **Stock Transfer**: TAL-MAIN → another warehouse, Submit, Dispatch, Receive; **Stock Valuation** stays in balance.
8. **Cancel** the receipt of a clean item with a reason and a date; ledger shows REVERSAL rows with that date.
9. **Cycle Count › Powder stock sheet (weekly) › + New Sheet** (`/m/wms-cycle`) → start, enter counts, a second person approves, Post.
10. **Barcode / QR**: type `(01)04006381333931(17)301231(10)LOT123`.
11. **Stock Valuation › Checks for the administrator**: Pre-flight, Integrity, Books cut-over.
12. Review `apps/api/prisma/pending/phase08_d_legacy_cleanup.sql` and tell me when to apply migration D.
