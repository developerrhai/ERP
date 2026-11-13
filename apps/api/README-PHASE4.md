# apps/api: Phase 4 (Stage B) choices and deviations

Generic metadata engine: `docs/phase3-4/CONTRACT.md` Stage B, plus the fix round. Phase 1–3 choices stay in `README-PHASE1/2/3.md`.

## Where things are

- `src/engine/classify.ts` + `classify-exceptions.ts`: label → field type and required marks. `field-schema.ts`: page schema. `record-input.ts`: validation of a record's `data`. `date-order.ts`: end-not-before-start rules. `kinds.ts`: which engine serves a page. `overrides/`: enum option lists.
- `src/modules/records/`: `GET /pages/:pageId/schema`, `/pages/:pageId/audit` and `/pages/:pageId/records[...]` (routes → controller → service → repository; `export.ts` builds the xlsx).
- Migration `20261104000000_phase4_generic_records`: `generic_records` (with the generated `search tsvector` column and GIN index, raw SQL only), `number_series`, `idempotency_keys`.

## Field typing (B1), corrected in the fix round

- **The old docs/plan/04-modules.md tables are no longer the reference.** They came from substring matching and typed some labels absurdly (`Priority` as money, `Account Name` as qty, `Transaction` as HSN, `Monthly Cost` as date...). The classifier now matches on **words**, in a fixed order, and `classify-exceptions.ts` lists the labels (and two page-specific cases) the word rules cannot decide. **`tests/fixtures/field-types.json` is the reviewed expectation for all 2,773 fields** (label, type, required) and is the source of truth. `tests/fixtures/type-changes.json` lists every label whose type differs from the old tables (254 labels), so `docs/plan/04-modules.md` can be regenerated.
- **Rules, in order:**
  - the exact label `Status` is the workflow status;
  - identifier types only for labels that clearly are those: `GSTIN`, `PAN`, `IFSC`, `Aadhaar`, `UAN`, exactly `HSN` / `HSN SAC`, labels with `Mobile` or exactly `Phone`, exactly `Email` / `From Address`;
  - a label with the word `name` or `title` is **text**; one with `description`, `subject`, `reason`, `remarks`, `comments`, `notes`, `address`, `action` and similar is **long text** (a test fails if such a label gets any other type, except Credit Note Ref, Credit Notes, From Address and first-field codes);
  - a label ending in `Status` is an **enum**;
  - `%` is pct; `... Date` is a date; `... At` is a datetime;
  - quantity units and counts (qty, hrs, days, count, weight...) are qty;
  - start / end / from / till / expiry / due words are dates; time-of-day words are datetimes (durations such as `Setup Time` are qty);
  - a last word of type / mode / channel / method / category / source / stage / priority / severity... is an enum;
  - then bool, money, ref; everything else is text.
- **First field = code** when its label ends in No / ID / Code / Ref / Number. **Master page** = first label ends in Code / ID / Ref / Number (not No): masters start `Active`, others `Draft`.
- **Required:** the first field, any label ending in `Name`, the first party `ref` (customer, vendor, supplier, item, employee, machine, asset, project) and the first date. There are no per-page exceptions any more.
- **`... Status` fields are enums, not read-only.** Only the field labelled exactly `Status` is the workflow status (the `status` column, changed by `POST /:id/status`, never typed). Defaults: Consent Status = Pending / Granted / Withdrawn, Approval Status, QC Status, Payment Status, Hold Status, Posting Status, Delivery Status, Filing Status and others (`overrides/defaults.ts`); a Status-suffix label without an entry is free text. Priority, FEFO Priority, Putaway Priority and Severity default to Low / Medium / High / Critical; Stage and Source keep the prototype lists. Per-page overrides are in `overrides/pages.ts`.
- **Keys:** camelCase of the label, unique per page (`Next Follow-up` → `nextFollowUp`, `Probability %` → `probabilityPct`, `0 30 Qty` → `f030Qty`, repeated → `name2`).
- **Constraints:**
  - text 200 and long text 4000 characters; HTML tags are stripped.
  - money is `0..99,999,999,999,999`, rounded to 2 decimals; negative only when the label contains variance / adjust / difference / movement / profit / savings.
  - pct `0..100`, 2 decimals; qty ≥ 0, 3 decimals; numbers may be sent as numeric strings.
  - Dates are real `YYYY-MM-DD` dates; datetimes `YYYY-MM-DDTHH:mm...`, stored as sent.
  - Mobile `^[6-9]\d{9}$` (spaces and dashes removed). GSTIN pattern plus **check character**. PAN, IFSC, HSN 4/6/8 digits, UAN 12 digits. `bool` must be a JSON boolean.
  - An enum with options accepts only those; without options it is free text ≤ 200.
- **`ref` is free text** (≤ 200). `refPage` is set when the label ends in customer (→ `crm-customer360`), vendor / supplier (`scm-suppliers`), item (`inv-items`), warehouse (`wms-warehouses`), employee (`hr-employees`), department (`admin-departments`) or branch / unit (`admin-branches`); these page ids are my choice. Labels with a `Name` word are text now, so `Customer Name` and the like have no `refPage`.
- **Date order (`date-order.ts`):** the end must not be before the start (equal is fine); 422 on the later field with `Must not be before <start label>.`. Pairs on one page:

  - Start/End, From/To, Valid From with Till / Until / To, Effective From/To, Planned Start/End, and any `<X> Start|From` with `<X> End|To|Till|Until` (Baseline, Warranty, Posting...);
  - Issue/Expiry, Mfg/Expiry, Joining/Confirmation, Resignation/Last Working;
  - Start Date with Due, Close, Closing or Target Date.

  On PATCH the stored other side is used, and only pairs involving a changed field are checked, so an old inconsistent record can still be edited elsewhere.

- **Aadhaar:** 12 digits (first digit 2–9) are stored as `XXXXXXXX1234` plus a hidden HMAC-SHA256 (keyed with the server secret; a plain sha256 of 12 digits is brute-forceable) under `_h_<key>`; never returned or audited. A masked value sent back unchanged is accepted; any other masked value → 422.
- **Schema response** (`GET /pages/:pageId/schema`, needs `view`, answers for every page kind): `pageId, title, family, purpose, kind, master, tabs, fields[{key,label,type,required,readOnly,options?,min?,max?,maxLength?,pattern?,refPage?}], statuses, editableStatuses, transitions, actions, listColumns, ownerDepartment, approvalRequired`.
  - `ownerDepartment` and `approvalRequired` come live from `module_controls` (null / false if the page has no row).
  - `actions` is `[]` for generic pages; `listColumns` = first 12 field keys.
  - `editableStatuses` = Draft, Active, Inactive, Open, Pending: **a Cancelled or Completed record cannot be edited (409 `RECORD_LOCKED`)**, but can still be deleted and restored.
- **Kinds:** 7 `typed` (inv-items, wms-warehouses, inv-stock, inv-opening, inv-transactions, inv-adjustment, inv-transfer); 35 `custom` (the 21 prototype custom pages plus the other 14 Administration pages); **206 `generic`**, which includes **four Administration masters: admin-designations, admin-currency, admin-uom, admin-taxes**. The Administration hard rule still applies to them (ADMIN and above only) and their module-control flags stay locked on. The records endpoints answer `404 NOT_GENERIC` for typed and custom pages; the schema endpoint answers for all.

## Records API (B2/B3)

- **Unit and FY from `req.ctx`.** Lists and exports are filtered by the context unit (All units for ADMIN+) **and by the context FY** (the contract names only the unit; the FY selector refetching different data implies it). Get-by-id respects the unit but not the FY, so a link to a record from another year still opens.
- **Writes** (create, patch, delete, restore, status, bulk) need a concrete unit (`requireConcreteUnit`, 422 `CONTEXT_INVALID` for All units) and the **record's financial year must be OPEN**; otherwise **409 `PERIOD_CLOSED`**. For create the FY is the context FY; for existing records it is the record's own FY, whatever year the header says.
- **Scope.** `OWN` → `created_by = me`; `DEPARTMENT` → `department = mine`, or the page's owner department (from `module_controls`) is mine, in which case the whole page; `ALL`. The same predicate applies to get / patch / delete / restore / status / bulk / export / audit, so a row outside the scope is a **404, not a 403**.
- **Codes** are `<PFX>/<UNIT>/<FY>/<00001>` (e.g. `LEA/TAL/26-27/00001`). PFX is the first 3 letters of the menu title (letters only, padded with `X` if shorter). `number_series` is read `FOR UPDATE` inside the create transaction, so a rolled-back create gives its number back. The code is unique per page. There is no user-entered code, not even on masters.
- **PATCH** takes `If-Match` (required), is partial, `null` / `''` clears an optional field (a required field → 422). A no-op returns the current row (no version bump, no audit). `ETag` on every record response.
- **DELETE** is a soft delete (`If-Match` optional) and returns `{data:{undoToken}}`, an HMAC of the id and deletion time. **`POST /:id/restore`** needs only `delete` permission and scope and no body; an optional `{undoToken}` is checked if sent. Restoring needs the record's FY to be open.
- **`GET ?deleted=true`** lists only soft-deleted rows and is ADMIN+ only (403 otherwise).
- **`POST /:id/status {to}`** (needs `edit`): `Draft→Active|Cancelled`, `Active→Inactive`, `Inactive→Active`, `Open→Completed`, `Pending→Open|Cancelled` (the last row is my reading of the contract's "Pending→…"). `Approved` / `Rejected` → 422 (Phase 6). Anything else → 422 `fields.to`. `statuses`: masters `Active, Inactive`; others `Draft, Active, Inactive, Cancelled`.
- **`POST /bulk {action:'delete', ids≤200}`** returns `{data:[{id, ok, error?:{code,message}}]}` in the order given. Each id is its own transaction and audit row (`bulk: true`). The route needs `delete` permission; scope and FY are checked per id.
- **List:** `q` = prefix full-text search over the code and every text value (`to_tsquery('simple', 'tok:*')`) OR `ILIKE` on the code with `%`, `_` and backslash escaped. `sort` is a schema key, `code`, `status`, `createdAt` or `updatedAt` (else 422); money / pct / qty sort numerically. `size` ≤ 100 (default 20), offset ≤ 10,000. Default order `-createdAt`.
- **Row shape (list and get):** `{id, code, status, unitId, fyId, department, data, version, amount, createdAt, createdBy:{id,name}, updatedAt, deletedAt}`. `amount` and the hidden `doc_date` copy the first money / date field; `deletedAt` is null except in `?deleted=true` lists and restore responses.
- **Idempotency-Key on POST create:** key 1–128 printable ASCII (else 400), scoped per user, held under an advisory lock. A repeat with the same body returns the first record (`201` + `Idempotent-Replay: true`) with no second row or audit; a different body → 409 `CONFLICT`. A failed validation does not store the key.
- **Export** `GET /export.xlsx` (needs `export`; same filters; extra `ids=a,b,c` for "Export Selected"): bold, frozen header; columns Code, Status, Unit, FY, Department, then the fields (code / status fields are not repeated); money cells use a `"₹" #,##0.00` format (not lakh/crore grouping); dates are real dates; bools Yes / No; any text cell starting with `= + - @` gets a leading `'`. Over 10,000 matching rows → 422. Audited as `RECORDS_EXPORTED` (target = the page id; detail has count and filters).
- **Audit rows:** `RECORD_CREATED / UPDATED / DELETED / RESTORED / STATUS_CHANGED` (targetType `Record`, targetId = record id; detail has `pageId`, `code` and before / after of the changed keys), `RECORDS_EXPORTED`. **`GET /audit-logs`** takes `pageId` (matches `detail.pageId`); `targetType` is matched case-insensitively (`record` finds `Record`).

## Audit tabs

- **`GET /pages/:pageId/audit?page&size`** and **`GET /pages/:pageId/records/:id/audit`** need `view` on the page and return the audit rows of the records the caller may see: the same unit context (All units for ADMIN+) and data scope as the lists, **deleted records included**, no FY filter.
- The row shape is the `/audit-logs` one `{id, at, action, targetType, targetId, ip, userAgent, detail, actor}`, newest first, with `meta:{page,size,total}`. **`ip` and `userAgent` are null for callers below ADMIN.** `RECORDS_EXPORTED` rows are not included (they belong to no record).
- A record the caller cannot see is 404; a typed or custom page is 404 `NOT_GENERIC`.

## Other changes

- **`validate()` now merges** the parts it validated into `res.locals.valid` instead of replacing them, so a router-level params check survives a route-level body check.
- **Units:** `DELETE /units/:id` reports records / number series as 409 `IN_USE` (message with the record count). PostgreSQL reports `ON DELETE RESTRICT` as SQLSTATE 23001, which Prisma does not map to `P2003`, so that case is handled by message as well.
- **New error codes:** `NOT_GENERIC` (404), `PERIOD_CLOSED` (409), `RECORD_LOCKED` (409).
- **New dependency:** `exceljs@4.4.0` (exact).
- `requireParamPageAction(action)` in `access.ts`: the same decision as `requirePageAction`, with the page id taken from `:pageId`.

## Not done / for later

- Typed pages (Stage C) and their `actions`, `preview` and lookups.
- `ref` lookups (free text with `refPage` only); the Documents / Approvals / Analytics tabs.
- Checking that a referenced record exists is not possible while `ref` is free text.
- The "FY/period lock" of §4.0.2 is the FY-open rule above (it checks the record's FY, not a date field).
- Rate limiting of the export (a 10,000-row xlsx is built in memory).

---

# Phase 4 v2 (docs/phases/PHASE-04.md): lock matrix, documents, PDF, export / import, jobs

Everything below was added in the Phase 4 "engine v2" build. The older sections above still describe
the Stage B records API; where they disagree (for example "a Cancelled record can be deleted"), this
section wins.

## Lock matrix (C6)
`src/engine/lock-matrix.ts` is the only place that decides what a status allows:
`update, remove, restore, status, submit, documents`. `records/service.ts` calls it from update,
remove, restore, changeStatus, submit and the document service. The page schema returns the table as
`schema.lock` and the web shows or hides buttons from it. Transactional pages can be deleted only in
Draft; Pending is locked except for a manual Cancel; Completed / Cancelled / Approved / Rejected are
fully locked; masters (Active / Inactive) stay editable and deletable. A closed year always wins
(`409 PERIOD_CLOSED`). Status changes out of a terminal status keep their old `422`.

## Idempotency v2 (C2) and commands (C7)
`core/http/idempotency.ts` stores key + request hash + response in `idempotency_keys`
(`user_id, scope, key`). Same key and hash replays the stored body (`Idempotent-Replay: true`), another
hash is `409`, a still-running request is `409 IN_PROGRESS`, a crashed one is taken over after 60 s.
`kit/commands.ts` no longer keeps any `Map` for results (only the command registry), has no `any`,
and answers `{data, result}` (`result` is a deprecated alias). The same helper protects submit,
document upload, background export and import commit.

## Documents (C8, C9)
`modules/documents`: `GET/POST /pages/:pageId/records/:id/documents`, `GET .../:docId/download`,
`DELETE .../:docId`. busboy streams the upload with a hard 10 MB limit; the type is decided from the
magic bytes and must match the extension (PDF, PNG, JPG, XLSX, DOCX, CSV); 20 documents per record;
`core/scan` rejects the EICAR test string, PDFs with `/JavaScript` `/Launch`, and Office files with
macros (a ClamAV adapter can implement `Scanner` later). Infected files are refused and never stored.
Files go through `core/storage` (local disk) and `stored_files.scan_status`.

## PDF (C10)
`core/pdf`: pdfkit + Noto Sans + Noto Sans Devanagari (`apps/api/assets/fonts`, SIL OFL). Text is split
into script runs; fontkit shapes the Devanagari runs. `tests/pdf-gate.test.ts` (T-PDF-01) compares the
glyph counts with HarfBuzz (`harfbuzzjs`, a dev dependency used only by the test), checks conjuncts
`क्ष` / `ज्ञ`, no `.notdef`, embedded subsets and the ToUnicode text layer. Templates:
`renderDocumentPdf` (record) and `renderTablePdf` (list). Endpoints: `GET .../records/:id/pdf`,
`GET .../records/export.pdf`.

## Export, CSV, jobs
`export.csv` (UTF-8 BOM, formula-injection prefix on every text cell, headers included), sync limit
5,000 rows. `POST /pages/:pageId/exports` starts a background export (up to 50,000 rows, file kept
7 days). `core/jobs` runs pg-boss in `server.ts` (single process); `data_jobs` holds status, counts,
errors and files; `GET /jobs`, `/jobs/:id`, `/jobs/:id/download`. The daily `maintenance` job runs the
Phase 1 cleanup (expired sessions, MFA challenges, reset tokens), purges expired idempotency keys and
job files, and fails jobs stuck in RUNNING. (The Phase 1 cleanup function existed but nothing
scheduled it before.)

## Import wizard
`POST /pages/:pageId/imports` (upload, headers, suggested mapping), `POST /imports/:jobId/validate`
(per-row checks with the same rules as the API, duplicates inside the file, warnings for names that
exist), `POST /imports/:jobId/commit` (all-or-nothing in one transaction with gap-free numbers;
needs `add` + `export` on the page), `GET /pages/:pageId/import-template.xlsx`.

## Summary, quality, submit
`GET .../records/summary`, `GET .../records/quality` (server counts, stale Drafts, empty required
fields, repeated natural key), `POST .../records/:id/submit` (If-Match, Idempotency-Key; Draft ->
Pending, uses the `submit` permission), `POST .../records/submit-bulk` (up to 100 ids, per-id report).

## Tests
`lock-matrix`, `idempotency-v2`, `documents`, `pdf-gate`, `pdf-template`, `phase4-engine` (API);
`Phase4.test.tsx` (web); `tests/e2e/phase4b.spec.ts` (browser).
