# Phase 3 + 4 + Inventory Slice — Contract

This contract builds on the Phase 1 and Phase 2 contracts (`docs/phase1`, `docs/phase2`, `apps/api/README-PHASE1/2.md`). Those stay in force; where this file differs, this file wins.

**Repo rules:** read `CLAUDE.md`. No push, no commit, no deploy, no secrets in output.

The work is built in three stages, **A → B → C, in this order**. Each stage must be green before the next starts.

---

## Stage A — Phase 3: Company, Units, Financial Years, and real context selectors

### A1. Data (Prisma, snake_case plural)

**`companies`** — exactly one row, seeded.
* `code` SAWANT, `legalName` "Sawant Group (Ready Hand)", `tradeName` "Sawant Group"
* `pan?`, `cin?`, `gstin?`, `address?`, `currency` INR, `timezone` Asia/Kolkata
* `version`, timestamps
* Editable on page `admin-company` by ADMIN+ with `controls`. Same validation as the letterhead (GSTIN, PAN, CIN).

**`units`** — the manufacturing units. The prototype's "Branches" page `admin-branches` is now **Unit Master**.
* `id`, `code` (unique, `^[A-Z0-9]{2,10}$`), `name` (unique), `address?`, `gstin?` (validated)
* `status` ACTIVE|INACTIVE, `version`
* Seed:
  * `TAL` Talwade (Unit 1)
  * `SAW` Sawardari (Unit 2)
  * `VAR` Varale (Unit 3)
* Delete → 409 `IN_USE` if any user, warehouse or record references the unit. Deactivating instead is allowed.

**`financial_years`**
* `id`, `code` (e.g. `2026-27`, unique), `label` ("FY 2026-27"), `startDate`, `endDate`
* `status` OPEN|CLOSED, `isCurrent` (exactly one current; partial unique index), `version`
* Seed 2025-26 (OPEN) and 2026-27 (OPEN, current). Indian FY: 1 Apr – 31 Mar. Validation: end = start + 1 year − 1 day, no overlap.
* Page `admin-fy`: list, add next FY, set current, close/reopen. Closing is blocked if it is the current FY.

**`user_units`** — `(userId, unitId)`, which units a user may work in.
* ADMIN+ implicitly have all units (no rows needed).
* `users.defaultUnitId?`.
* User Master gains a **Units** multi-select (required for MANAGER/LEAD/MEMBER: at least 1) and a **Default unit**.
* Existing non-admin users get all 3 units in the migration.

**`user_preferences`** — `(userId)` → `unitId?`, `fyId?`. The last chosen context.

### A2. Context on every request
* The web sends `X-Unit-Id` and `X-FY-Id` on every API call.
* Middleware `resolveContext`:
  * validates the unit is ACTIVE and accessible to the user;
  * validates the FY exists;
  * exposes `req.ctx = {companyId, unitId|null, fyId}`.
* `unitId = null` means "All units". It is allowed **only for ADMIN+**, and only for reading lists. A write needs a concrete unit.
* Missing headers → the user's preference, else the default unit, else the first accessible unit; FY → current.
* An invalid unit or FY → 403 `CONTEXT_FORBIDDEN` / 422 `CONTEXT_INVALID`.

**Endpoints**

| Method & path | Who | Notes |
|---|---|---|
| `GET /me/context` | any | `{data:{company:{id,code,tradeName}, units:[{id,code,name}], allUnitsAllowed:boolean, fys:[{id,code,label,status,isCurrent}], current:{unitId|null, fyId}}}` |
| `PUT /me/context` | any | body `{unitId|null, fyId}`; validates, saves the preference |
| `GET/PATCH /company` | view/controls on admin-company | |
| `GET/POST/PATCH/DELETE /units` | view/controls on admin-branches | |
| `GET/POST/PATCH /financial-years` | view/controls on admin-fy | |
| `POST /financial-years/:id/set-current` | `controls` on admin-fy | |
| `POST /financial-years/:id/close` and `/reopen` | `controls` on admin-fy | |

Audit every write. Clear the access cache when unit access changes.

### A3. Web
* **Top bar.**
  * The Company select shows the single company (disabled when there is only one).
  * The **Unit** select lists the accessible units, plus "All Units" for ADMIN+.
  * The **FY** select lists the years; closed years are marked "(closed)".
  * Changing a selector calls `PUT /me/context`, updates the headers and refetches the current page's data.
  * If the page has unsaved edits, ask first ("Discard unsaved changes?").
* **Pages:**
  * `admin-company` — Company form;
  * `admin-branches` — Unit Master table + modal, same look as Department Master;
  * `admin-fy` — Financial Years table with Set current / Close / Reopen and an Add-next-FY modal.
  * The System Setup tiles "Company Master" and "Branch Master" become active (rename the label to "Unit Master").
* **User Master:** Units multi-select (checkbox list) and Default unit in the Add/Edit modal; a Units column in the table.
* **Dashboard hero:** "<Unit name> • FY 2026-27" under the user name.

---

## Stage B — Phase 4: Generic metadata engine (all generic pages get real CRUD)

### B1. Field schema (API owns it)
`src/engine/field-schema.ts` turns registry profile fields into typed field metadata, using `docs/plan/04-modules.md` §4.0.2. Implement the same rules as the generator that produced the `Field:type*` tables in that file.

**Field metadata shape:**
`{key, label, type, required, readOnly, options?, min?, max?, maxLength?, pattern?, refPage?}`

Field types: `code, status, date, datetime, money, pct, qty, ref, email, phone, gstin, pan, ifsc, hsn, aadhaar, uan, bool, enum, text, longtext`.

**Rules:**
* `code` is auto-generated and read-only.
* `status` is read-only in forms.
* `ref` fields are **free text with suggestions** in this phase. Typed lookups come with the masters. Exception: `ref` fields that point to a known typed master (customer/vendor/item/warehouse/employee/department/unit) set `refPage` for later use.
* `enum` options come from per-page overrides in `src/engine/overrides/*.ts`. When none exist, the default list from the prototype seeds applies: Priority = Low, Medium, High, Critical; Stage = New, Qualified, Proposal, Negotiation, Won, Lost; Source = Website, Referral, WhatsApp, Campaign, Existing Customer, Walk-in; UOM = Nos, Set, Kg, Meter, Box, Litre. Otherwise free text.
* Aadhaar is stored masked (last 4 digits) plus a sha256 hash. The full number is never returned.

`GET /pages/:pageId/schema` → `{data:{pageId, title, family, purpose, tabs:[6 profile tabs], fields:[...], statuses:[...], actions:[...], kind:'generic'|'typed'|'custom', listColumns:[first ≤ 12 keys]}}`. Requires `view` on the page.

### B2. Storage
**`generic_records`**
* `id uuid`, `page_id`, `unit_id` (FK, not null), `fy_id` (FK, not null), `department` (owner department name), `code` (unique per page), `status`
* `amount numeric(18,2)?` — the first money field; used later by approvals and lists
* `doc_date date?` — the first date field
* `data jsonb`, `search tsvector` (generated from code + text fields)
* `version`, `created_by/at`, `updated_by/at`, `deleted_by/at`
* Indexes: `(page_id, unit_id, deleted_at)`, GIN on `search`, `(page_id, code)` unique.

**`number_series`**
* `(page_id, unit_id, fy_id)` → `next_value`, allocated with `SELECT … FOR UPDATE` inside the create transaction (gap-free).
* Code format: `<PFX>/<UNITCODE>/<FY>/<00001>`. PFX is the first 3 letters of the page title, upper case, letters only (the prototype rule), e.g. `LEA/TAL/26-27/00001`.

### B3. API (`/api/v1/pages/:pageId/records`)
* **Scope.**
  * `OWN` → `created_by = me`.
  * `DEPARTMENT` → `department = my department` **or** (the page's owner department = my department).
  * `ALL` → everything.
  * The unit filter comes from the context (`All units` only for ADMIN+). Soft-deleted rows are excluded unless `?deleted=true` (ADMIN+, for restore).

| Method & path | Permission | Notes |
|---|---|---|
| `GET /` | view | `q` (FTS + ILIKE fallback on code), `status`, `sort` (`field` or `-field`, whitelisted to schema keys + code/createdAt/updatedAt), `page`, `size` ≤ 100 → `{data:[{id,code,status,unitId,fyId,department,data,version,createdAt,createdBy:{id,name},updatedAt}], meta:{page,size,total}}` |
| `POST /` | add | body `{data:{...}}`; validated by the zod schema built from the field metadata (unknown keys → 422; read-only keys ignored). Sets code, status (`Draft` for transactional pages, `Active` for masters — a page is a master if its first field is a Code/ID-style field without "No"), unit/FY from context, department = creator's department |
| `GET /:id` | view | |
| `PATCH /:id` | edit | If-Match; same validation; partial |
| `DELETE /:id` | delete | soft delete; If-Match optional; returns `{data:{undoToken}}` |
| `POST /:id/restore` | delete | |
| `POST /:id/status` | edit | `{to}`: allowed transitions Draft→Active, Draft→Cancelled, Active→Inactive, Inactive→Active, Open→Completed, Pending→… Phase 6 owns Approved/Rejected; reject anything else with 422 |
| `POST /bulk` | per item | `{action:'delete', ids:[≤ 200]}` → per-id report `{id, ok, error?}` |
| `GET /export.xlsx` | export | exceljs; same filters; ≤ 10,000 rows; cells starting with `= + - @` prefixed with `'`; header row bold; ₹ number format for money; audit `RECORDS_EXPORTED` |

* Every write uses the module-control `allow_*` flags and `requirePageAction`.
* Audit `RECORD_CREATED / RECORD_UPDATED / RECORD_DELETED / RECORD_RESTORED / RECORD_STATUS_CHANGED`, with before/after `data`.
* **Excluded from the generic engine:**
  * the 21 custom pages;
  * the typed inventory pages of Stage C;
  * the Phase 2 admin pages.
  * Requests for these → 404 `NOT_GENERIC` (the typed pages expose the same REST shape themselves, see C3).

### B4. Web: `GenericModulePage` (prototype `renderModule`)

**Page head and chips**
* Page head: title, purpose; `Excel`, `Print`, `＋ Add` (each per permission and module control).
* Context chips: Department, Role, Owner, Approval required, **Unit**, **FY**.

**Tab strip** — the prototype 16 tabs: Module Dashboard + 6 profile tabs + Analytics & Graphs, AI Decision Center, Automation Studio, Data Quality, Activity Timeline, Documents, Approvals, Reports, Audit Trail. **Real in this phase:**

| Tab | What it shows |
|---|---|
| Module Dashboard | 4 KPI cards from real data (Records, Draft/Open, Active/Completed, Created this month) + the 20 most recent records table |
| Register (the profile tab whose label matches register/list/directory/master/queue/log; otherwise the first profile tab) | Prototype register table:<br>• 5 summary minis computed from data<br>• search, status filter, page size 10/20/25<br>• sortable headers<br>• checkbox selection → Export Selected (xlsx of the ids) / Delete Selected<br>• pager<br>• row actions View / Edit / Delete |
| Data Quality | completeness per field computed from data |
| Activity Timeline / Audit Trail | real audit rows for this page (`GET /audit-logs?targetType=record&pageId=`; extend audit-logs with a pageId filter) |
| Reports | Excel and Print |

**Every other tab** shows an honest notice: "This view is built in Phase N", with N from `docs/plan/13-roadmap.md` (Approvals → 6, Documents → 5, AI/Automation → 19, other profile tabs → the family's phase). No fake numbers anywhere.

**Add/Edit modal** (prototype `.modal .form-grid`) built from the schema:
* typed inputs (date pickers, number inputs with ₹ for money, % for pct, selects for enum, checkbox for bool, textarea for longtext);
* GSTIN/PAN live validation; required stars; 422 messages under the fields;
* the code is shown read-only on Edit.

**Other behaviour**
* **View drawer:** all fields + Edit/Delete.
* **Delete:** soft delete plus a toast "Deleted. Undo" (10 s) → restore.
* **Unsaved edits** in the modal ask before closing.
* The URL keeps `?tab=&q=&status=&sort=&page=`.
* `/m/:pageId` routes to `GenericModulePage` when `kind==='generic'`. The typed inventory pages use the same component with their own `kind:'typed'` schema (see C).

---

## Stage C — Inventory slice: product creation → stock (typed tables)

This is the owner's first business user flow:

**create a product → set up a warehouse in a unit → put opening stock → receive / issue / transfer between units / adjust → see the stock balance and the ledger.**

### C1. Tables (typed)

**`items`** (page `inv-items`, company-wide)
* `code` (user-entered or auto `ITM/00001`; unique; `^[A-Z0-9/_-]{2,30}$`), `name` (2–150, required)
* `itemType` enum: Raw Material, Semi-Finished, Finished Good, Consumable, Spare Part, Packing Material, Service
* `category?`, `brand?`
* `hsnSac?` (4/6/8 digits)
* `baseUom` (enum: Nos, Set, Kg, Meter, Box, Litre, Pair, Sheet, Roll — required), `altUom?`, `altUomFactor?` (> 0 when altUom set)
* `barcode?` (unique when present)
* `batchTracked bool`, `serialTracked bool` (flags only in this slice)
* `shelfLifeDays?`, `standardCost money?`, `sellingPrice money?`, `reorderLevel qty?`
* `status` ACTIVE|INACTIVE, `version`, audit columns
* Delete only when there are no ledger rows (409 IN_USE); otherwise deactivate.

**`warehouses`** (page `wms-warehouses`)
* `code` unique, `name`, `unitId` (FK, required — profile field "Branch" maps to Unit)
* `address?`, `manager?`, `totalCapacity?`, `dockDoors?`, `operatingHours?`, `temperatureZone?` (enum Ambient, Cold, Frozen, Hazardous)
* `status`, `version`
* Seed one per unit: `TAL-MAIN` "Talwade Main Store", `SAW-MAIN` "Sawardari Main Store", `VAR-MAIN` "Varale Main Store".

**`stock_ledger`** — **append-only** (trigger blocks UPDATE/DELETE/TRUNCATE).
* `id`, `postingDate`, `postedAt`, `unitId`, `warehouseId`, `itemId`
* `qtyIn numeric(18,3)`, `qtyOut numeric(18,3)` (one of them > 0)
* `rate numeric(18,6)`, `value numeric(18,2)` (+ in, − out)
* `balanceQty`, `balanceValue` (after this entry, per item × warehouse)
* `voucherType` (OPENING, RECEIPT, ISSUE, ADJUSTMENT, TRANSFER_OUT, TRANSFER_IN, REVERSAL), `voucherId`, `voucherNo`
* `createdById`

**`stock_balances`** — PK `(itemId, warehouseId)`: `onHand`, `value`, `avgRate`, `updatedAt`.
* Maintained in the **same transaction** as the ledger insert, with `SELECT … FOR UPDATE` on the balance row.

### C2. Vouchers (typed tables, one item per voucher)
The prototype profiles are single-line. Multi-line comes with Procurement/Sales.

**Statuses:** `Draft → Posted → Cancelled`.
* Only Draft is editable or deletable.
* Posting writes the ledger.
* Cancelling a posted voucher writes REVERSAL entries. Cancelling a posted receipt that would make stock negative → 409 `INSUFFICIENT_STOCK`.

**Numbering:** `<PFX>/<UNIT>/<FY>/<0001>` per type, assigned on create (gap-free; drafts keep their number).

| Page | Voucher | Fields (from the prototype profile, typed) | Post effect |
|---|---|---|---|
| `inv-opening` Opening Stock | OPENING | Warehouse, Item, Batch Serial (text), Opening Qty (> 0), Unit Cost (≥ 0), Opening Value (= qty × cost, read-only), Valuation Method (read-only "Moving Average") | qtyIn at cost. **Allowed only when the item has no other ledger rows in that warehouse** (409 otherwise) |
| `inv-transactions` Inventory Transactions | RECEIPT / ISSUE (manual material receipt/issue) | Transaction Type (Receipt\|Issue), Reference, Item, Warehouse, Qty (> 0), Unit Cost (receipt: required; issue: read-only = current avg rate) | Receipt: qtyIn at cost. Issue: qtyOut at avg rate. **No negative stock** |
| `inv-adjustment` Stock Adjustment | ADJUSTMENT | Warehouse, Item, System Qty (read-only, snapshot at post), Counted Qty (≥ 0), Variance Qty (computed), Unit Cost (avg rate, read-only), Value Impact (computed), Reason Code (Damage, Expiry, Count Correction, Theft/Loss, Other — required), Approver (text) | Variance > 0 → qtyIn at avg rate (or standard cost if the avg is 0); < 0 → qtyOut |
| `inv-transfer` Stock Transfer | TRANSFER_OUT then TRANSFER_IN | Source Warehouse, Destination Warehouse (≠ source; may be in another unit), Item, Requested Qty, Dispatched Qty, Received Qty, In Transit (computed), Vehicle Ref, Expected Receipt | **Two steps:**<br>• **Dispatch** (Draft→Dispatched): qtyOut from the source at avg rate, status `Dispatched`.<br>• **Receive** (Dispatched→Received): qtyIn at the dispatch rate into the destination; Received Qty must equal Dispatched Qty in this slice.<br>• Cancel is allowed only for Draft (or Dispatched → reverses the dispatch) |

**Read-only views:**
* **`inv-stock` Stock Balance.** One row per item × warehouse with on-hand > 0, or any ledger rows.
  * Columns: Item Code, Item Name, Unit, Warehouse, UOM, On Hand, Avg Rate, Stock Value, Reorder Level, Status.
  * Status = Below Reorder when on-hand < reorderLevel, else OK.
  * Filters: unit (from context), warehouse, item search, "below reorder only".
  * Totals row; Excel export.
* **`inv-transactions`** list mode = the ledger. Columns: Date, Voucher No, Type, Item, Warehouse, In, Out, Rate, Value, Balance Qty, Posted By. The "＋ Add" there creates a Receipt/Issue voucher.

**Rules:**
* The posting date must lie inside the context FY and that FY must be OPEN (409 `PERIOD_CLOSED`).
* The warehouse's unit must equal the context unit for create/post. Transfers check the source unit; the destination may be any active unit.
* Inactive items and warehouses cannot be used.
* **Valuation:** moving average per item × warehouse. Value rounded to 2 decimals, rate to 6.
* **Idempotency:** `Idempotency-Key` header on post/dispatch/receive/cancel; a repeated key returns the first result.
* **Concurrency:** two simultaneous issues of the last unit → exactly one succeeds; the other gets 409 `INSUFFICIENT_STOCK` (test it with parallel requests).
* **Audit:** `ITEM_*`, `WAREHOUSE_*`, `VOUCHER_POSTED`, `VOUCHER_CANCELLED`, `TRANSFER_DISPATCHED`, `TRANSFER_RECEIVED`.

### C3. Same REST shape as the generic engine
The typed pages expose `/api/v1/pages/:pageId/schema` and `/records` (list, create, get, patch, delete), with the same response shapes. Typed actions are added:

```
POST /pages/:pageId/records/:id/actions/:action   (post | cancel | dispatch | receive)
```

* The schema `actions:[{key,label,variant,confirm,allowedFrom:[statuses]}]` tells the web which buttons to show.
* `inv-stock` is list-only (`readOnly:true` in the schema).

So the web needs **no special pages**. `GenericModulePage` renders typed pages too, plus action buttons, computed read-only fields and a server-side "preview" of computed values. Example: `GET /pages/inv-adjustment/preview?itemId&warehouseId` → `{systemQty, avgRate}`, used to fill read-only fields live.

`ref` fields to items/warehouses are **real lookups** here: `GET /lookups/items?q=` and `GET /lookups/warehouses?q=&unitId=`, returning `{id, code, name, uom?}`. The web uses a searchable combobox.

### C4. Web flow checks
* The Item Master and Warehouse Master pages look like the prototype register (`reference/screens/v92/fam-05-Inventory-inv-items.png`).
* Opening Stock, Transfer and Adjustment forms show the computed fields live.
* Post, Dispatch, Receive and Cancel are buttons in the record bar, the View drawer and the row actions, with confirm modals ("Post OPN/TAL/26-27/0001? Stock will change and the voucher will be locked.").
* After posting, the record becomes read-only (no Edit or Delete) and a "Posted" status pill shows.
* Stock Balance shows totals and a "Below reorder" filter.

---

## Tests (each stage; must be green 3× in a row from a clean DB)
* **API (Stage A):** context resolution matrix; unit access; FY rules; company/unit validation.
* **API (Stage B):** schema generation for all 227 generic pages (snapshot counts per type); CRUD for **every** generic page (a loop over the registry: create → get → list → patch → soft delete → restore); scope OWN/DEPARTMENT/ALL; number-series concurrency (20 parallel creates → 20 distinct consecutive codes); xlsx export with formula escaping; status transitions.
* **API (Stage C):**
  * moving-average worked examples;
  * no negative stock (incl. parallel issue);
  * transfer across units;
  * reversal correctness;
  * the ledger is append-only;
  * Σ ledger = balance for every item × warehouse after a random 500-voucher simulation;
  * PERIOD_CLOSED;
  * idempotency.
* **Web:** unit tests for the context selectors, GenericModulePage (register, modal from schema, delete+undo), the action buttons, and the stock balance view.
* **E2E** (orchestrator): owner creates an item → opening stock 100 @ ₹50 in Talwade → issue 30 → transfer 20 to Sawardari (dispatch + receive) → adjust Talwade to 45 counted (+? per remaining) → Stock Balance shows the right qty and value in both units → a Member without inventory access cannot see these pages.
