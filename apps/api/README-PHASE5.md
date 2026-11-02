# apps/api: Inventory slice (Stage C) choices and deviations

Product → warehouse → opening stock → receive / issue / transfer / adjust → balance and ledger: `docs/phase3-4/CONTRACT.md` Stage C. Earlier choices stay in `README-PHASE1..4.md`.

## Where things are

- `src/modules/inventory/`
  - `definitions.ts`: the typed schemas of the seven pages (fields, actions, filters, totals, views).
  - `items/`, `warehouses/`, `vouchers/`: one repository + service per area; `stock/`: the posting engine (`posting.ts`), Stock Balance / ledger queries and the two previews.
  - `lookups/`: `GET /lookups/items|warehouses`. `typed-pages.ts`: pageId → handler. `export.ts`, `audit.ts`, `typed.ts`, `money.ts`: shared pieces.
- The records controller / routes (`src/modules/records/`) dispatch to a typed handler when the page is one of the seven, otherwise to the generic engine. Same URLs, same row shape.
- Migration `20261105000000_phase5_inventory`: `items`, `warehouses`, `stock_ledger` (append-only trigger), `stock_balances`, `stock_vouchers`; CHECKs; partial unique barcode index; the three Main Store warehouses. `src/core/seed/phase5-defaults.ts` creates the same warehouses on a fresh database (after the Super Admin exists).

## Endpoints (same shapes as the generic engine)

- `GET /pages/:pageId/schema` returns `kind:'typed'`, `readOnly` (page), per field `readOnly` / `lookup` / `refPage` / `options`, `actions:[{key,label,variant,confirm,allowedFrom,requires,requiresFrom?}]` (`confirm` has a `{code}` placeholder; `requires` is the page permission the action needs, `edit` or `delete`; if `requiresFrom` is present, `requires` applies only from those statuses and `edit` is enough from the others), `editableStatuses`, `statuses`, `filters:[{key,label,type,param,options?,lookup?}]`, `totals:[{key,label,format}]`, `views:[{key,label,columns?:[{key,label,format?}]}]` (`format` is `qty | money | date | datetime | text`; `key` is a key of the row `data`, item / warehouse cells are shown from `refs`), `ownerDepartment`, `approvalRequired`.
- `GET|POST /pages/:pageId/records`, `GET|PATCH|DELETE /records/:id`, `POST /records/:id/restore`, `POST /records/bulk` (delete), `GET /records/export.xlsx`, `GET /pages/:pageId/audit`, `GET /records/:id/audit`.
- **`POST /pages/:pageId/records/:id/actions/:action`**
  - Vouchers: `post | cancel` (opening, transactions, adjustment) and `dispatch | receive | cancel` (transfer).
  - Items and warehouses: `activate | deactivate`.
  - Body is optional `{dispatchedQty?, receivedQty?}`. An unknown action is 404, a status that does not allow it is 409 `CONFLICT`.
  - The response is the record; `Idempotency-Key` is honoured and a replay has `Idempotent-Replay: true`.
- **`GET /pages/inv-adjustment/preview?itemId&warehouseId`** → `{systemQty, avgRate, unitCost, stockValue}`; **`GET /pages/inv-transfer/preview?...`** → `{available, avgRate}`. Any other page → 404; ids are validated (422); a warehouse outside the context unit is 404 for non-admins.
- **`GET /lookups/items?q&limit`** (view on inv-items; active items; `{id,code,name,uom}`) and **`GET /lookups/warehouses?q&limit&unitId&any`** (view on wms-warehouses; active warehouses `{id,code,name,unitId,unitCode}`). Warehouses default to the context unit; `unitId` needs access to that unit (403 `CONTEXT_FORBIDDEN`); `any=true` lists all units (a transfer destination may be anywhere). `limit` 1–50.
- **List / get rows** are `{id, code, status, unitId, fyId, department, data, version, amount, createdAt, createdBy, updatedAt, deletedAt, refs}`; `refs[<fieldKey>] = {id, code, name}` for lookup fields. List `meta` is `{page,size,total}` plus `totals` for Stock Balance (`{onHand, stockValue}` of the whole filtered set).
- Row details by page:
  - `data` is keyed by the schema's field keys; lookup fields hold the id.
  - Items and warehouses: `unitId: null` for items, `fyId: null` for both; `amount` is the standard cost of an item.
  - Vouchers: `amount` is the posted value.
  - Stock Balance row: `id = "<itemId>_<warehouseId>"`, `code` = item code.

## Rules as built

- **Valuation:** moving average per item × warehouse in `Decimal` arithmetic: values 2 dp, rates 6 dp, quantities 3 dp, half-up. An inflow adds qty × rate; an outflow leaves at the current average. **An outflow that empties the stock takes the whole remaining value**, so no residue stays and Σ ledger = balance exactly. The average is 0 at zero stock.
- **No negative stock:** `postMovement` takes `SELECT … FOR UPDATE` on the balance row, so concurrent postings queue; a shortage is 409 `INSUFFICIENT_STOCK` (new code) and the whole transaction is rolled back. Tests: two parallel issues of the last unit, 6 parallel issues on 4 units, the same voucher posted twice at once.
- **Append-only ledger:** a trigger refuses UPDATE, DELETE and TRUNCATE (tested); CHECKs refuse a row with both or neither direction, a negative running balance or a negative balance row. `stock_balances` is changed in the same transaction.
- **Opening:** posts only if the item has no ledger row in that warehouse (409 `CONFLICT`). Value = qty × cost, valuation method "Moving Average" (read-only).
- **Receipt / Issue** (`inv-transactions`): a receipt needs a unit cost; an issue ignores it and is valued at the average (the posted voucher shows it).
- **Adjustment:** the system quantity is read under the balance lock at post (snapshot stored), variance = counted − system, valued at the average or, with no average yet, at the item standard cost (0 if none). A zero variance posts with no ledger entry. A Draft shows the live figures.
- **Transfer:** `dispatch` takes `dispatchedQty` (default = requested, ≤ requested) out of the source at the average and stores rate and value; `receive` adds exactly that quantity, rate and value to the destination. `receivedQty` must equal `dispatchedQty` (422). `cancel` is allowed from Draft (no ledger) and Dispatched (reversal); a Received transfer cannot be cancelled.
- **Reversal:** `cancel` of a Posted voucher writes `REVERSAL` entries (`reverses_id` links the original) with the **original quantity and value** in the opposite direction, so the balance returns exactly when nothing happened in between. If that would make stock negative → 409 `INSUFFICIENT_STOCK` and the voucher stays Posted.
- **Financial year:** vouchers are created in the context FY (must be OPEN, else 409 `PERIOD_CLOSED`); the posting date defaults to today moved into the FY and must lie in it (422 otherwise). Every action re-checks that the voucher's own FY is OPEN (header FY ignored on actions, as in the generic engine). A receipt's ledger date and reversal dates are today moved into the voucher's FY.
- **Units:** the (source) warehouse must be in the context unit for create, patch, post, dispatch and cancel (422 `CONTEXT_INVALID` / field error). The destination of a transfer may be in any active unit; it is stored as `to_unit_id`, the transfer is visible in both units, and `receive` is allowed with either unit as context. The `TRANSFER_IN` ledger row carries the destination warehouse's unit. "All units" can read but never write.
- **Only a Draft is editable or deletable** (409 `RECORD_LOCKED` otherwise). Deleting a Draft is a soft delete, its number is never reused, and `restore` + `undoToken` work like the generic engine.
- **Numbering:** `<PFX>/<UNIT>/<FY>/<0001>` with PFX `OPN`, `TXN`, `ADJ`, `TRF` (4 digits), from the existing `number_series` (page, unit, FY), gap-free.
- **Items:** code user-entered (`^[A-Z0-9/_-]{2,30}$`, upper-cased) or auto `ITM/00001` (company-wide, under an advisory lock); the code can never be changed. Barcode unique among live items (409 `DUPLICATE`). Alternate UOM needs a factor > 0 and vice versa. HSN 4/6/8 digits. The **base UOM is frozen once the item has ledger rows** (409). Delete → 409 `IN_USE` when the item has ledger rows or live vouchers (deactivate it instead); otherwise a soft delete. An inactive item cannot be used on a new voucher or posted.
- **Warehouses:** created in the context unit (needs a concrete unit); code unique and fixed; delete → 409 `IN_USE` once any ledger row or live voucher references it. `DELETE /units/:id` is 409 `IN_USE` while it has warehouses (FK RESTRICT).
- **Permissions:** the normal page permissions and module flags. `add` creates, `edit` patches and runs post, dispatch, receive, activate / deactivate and the cancel of a Draft; **`delete` is needed to cancel anything that already moved stock** (a Posted voucher, a Dispatched or Received transfer): 403 `FORBIDDEN` otherwise, after the visibility 404 and before the FY / stock checks, and the `allow_delete` module switch binds everyone. `delete` also deletes Drafts; `export` exports. Data scope (OWN / DEPARTMENT / ALL) applies to vouchers, so another member's voucher is 404; items, warehouses, the ledger and Stock Balance need only `view`.
- **Audit:** `ITEM_CREATED/UPDATED/DELETED/RESTORED/STATUS_CHANGED`, `WAREHOUSE_*` likewise, `VOUCHER_CREATED/UPDATED/DELETED/RESTORED`, `VOUCHER_POSTED`, `VOUCHER_CANCELLED`, `TRANSFER_DISPATCHED`, `TRANSFER_RECEIVED` (target types `Item`, `Warehouse`, `Voucher`; detail has `pageId`, `code`, `unitId`, the figures). `GET /pages/:pageId/audit` for the typed pages follows the unit context and OWN scope; ip and user agent are shown to ADMIN and above only.

## Deviations and choices to know

1. **One `stock_vouchers` table with a `kind` column** and typed columns, not four tables (all four vouchers are one-item documents with a common life cycle). It carries soft delete and the transfer's dispatch figures.
2. **Inventory Transactions lists the ledger by default** ("list mode = the ledger"). The Receipt / Issue vouchers (the Drafts you can still post) are `?view=vouchers`; the schema's `views` and `filters` say so. `GET /records/:id` of this page returns vouchers. Ledger rows are `{id, code = voucher no, status Posted | Reversal, data:{postingDate, voucherNo, voucherType, item, warehouse, qtyIn, qtyOut, rate, value, balanceQty, postedBy}, refs}`.
3. **Stock Balance includes zero-quantity rows** (a pair with ledger history), as the contract says "or any ledger rows". It is list + get + export only: create / patch / delete answer 405 `READ_ONLY` (new code), actions 404.
4. **The warehouse's "Branch" field is the unit**: read-only, set from the context unit when created, shown through `refs.branch`.
5. **Items and warehouses use a soft delete** with undo (like generic records) so the toast "Undo" works; the code stays reserved while deleted.
6. **Idempotency-Key** is stored in the existing `idempotency_keys` table and shared with the generic POST; reusing a key for another voucher, action or body is 409.
7. The generic `POST /:id/status` does not exist for typed pages (404); status changes are actions.
8. **Typed exports** use the schema columns (lookup fields as "code - name"); Stock Balance adds a bold totals row unless "Export Selected" (`ids`) is used.
9. `recordParamsSchema` now accepts the composite Stock Balance id as well as a uuid.
10. `units.countRecords` etc.: a unit with generic records or warehouses cannot be deleted.

## Not done

- Batch / serial tracking beyond the flags and the free-text "Batch Serial" on vouchers; multi-line vouchers; reservations (Reserved / Blocked columns of the prototype Stock page); reorder alerts.
- Approval of adjustments (the Approver field is plain text).
- A bulk post / dispatch. Bulk delete exists (Draft vouchers, items and warehouses without usage).
