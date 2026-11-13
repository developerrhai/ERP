# PHASE 03


# PHASE 03 — Organisation masters
(Role names here are the pre-Phase-2 names; see ERRATA E-04. GSTIN validators: ERRATA E-05. Files: E-07.)

## 1. Goal & why
One correct source for company identity, units, the calendar (FY + 12 months), document numbers,
units of measure, currencies and designations. Later phases print GST invoices from these masters,
so mistakes here end up on statutory documents.

**Keep:**
- modules company, units, financial-years, departments, settings and module-controls
  (they already use If-Match, audit and an FY advisory lock);
- fy-rules.ts (FY code "2026-27", 1 Apr – 31 Mar);
- the existing admin web pages;
- resolveContext.

**Gaps:**
1. **Numbering is hard-coded in two places.**
   - Records build `PFX/UNIT/FY/00001` themselves; Inventory has its own `numbered()`.
   - number_series is only a counter: no admin page, no audit.
   - `SIN/TAL/26-27/00001` is 19 characters, but GST Rule 46 allows at most 16.
   - Numbers are given at draft, so deleting a draft leaves a gap.
2. **No monthly periods.** Only the FY can be OPEN or CLOSED; there is no soft close.
3. **Some masters are stored wrongly.** Designations, currencies and UOM are stored as generic
   records tied to one unit and one FY. UOM has no GST UQC, and items.base_uom is free text.
4. **Company details are duplicated.** The letterhead setting repeats them from the company table.
5. **Units are missing fields:** state code, structured address, phone, email, manager.
   The unit code can be changed after it has been used in document numbers.
6. **Departments:** head is free text, there is no parent department, and the delete check is weak.
7. **System Setup** says Approval Matrix comes in "Phase 6"; it is now Phase 5.

## 2. Pages in scope
| Id | Title | After this phase |
|---|---|---|
| admin-company | Company Master | Legal and trade name, PAN, CIN, TAN, structured registered office, phone, email, website, logo. Code and INR are read-only. |
| admin-branches | Unit Master | TAL/SAW/VAR plus new units. GSTIN (state is taken from the GSTIN), address, pincode, manager, phone, email. The code is frozen once used. |
| admin-departments | Department Master | Code, name, parent, head (a user), status. Delete is blocked while the department is in use. |
| admin-designations | Designation Master | Code, name, grade, level, department, reports-to. Typed table. |
| admin-fy | Financial Years | Tabs: FY Master, **Period Calendar** (12 months: Open / Soft-closed / Closed), **Period Audit**. |
| admin-currency | Currency Master | INR is the fixed base. Other ISO currencies are optional, with manual exchange rates. |
| admin-uom | UOM Master | Code, name, class, decimals, GST UQC, conversions. |
| admin-numbering | Document Numbering | Series per document type and unit, token pattern, live preview, counters, number audit. |
| admin-settings | System Setup | 14 tiles, plus Letterhead & PDF (logo, signature, Test PDF). |
| admin-settings/controls | System Control Center | Unchanged, plus a hint that the Approval column works from Phase 5. |

## 3. Business logic & research (rules adopted)
**Financial year:**
- Source: Companies Act s.2(41); the income-tax year (Income-tax Act 2025 from 1 Apr 2026).
- FY is always 1 Apr – 31 Mar with 12 calendar-month periods.
- Code "2026-27", label "FY 2026-27".

**Letterhead (Companies Act s.12(3)(c) + CGST Rule 46):**
- The header prints the company legal name, registered office, CIN, PAN, phone, email and website.
- The document's unit address and unit GSTIN print as "Place of business".
- None of these are stored in the letterhead setting any more.

**GST document serials (CGST Rule 46(b) and Rules 49–55; GSTR-1 Table 13):**
- At most 16 characters, using only A–Z, 0–9, "-" and "/".
- Consecutive and unique per FY; multiple series are allowed.
- A GST series must contain {UNIT} and an FY token, because units may share one GSTIN.
- Numbers are given at Post/Approve, never at draft, inside the posting transaction.
- A cancelled number is kept as cancelled and never reused.
- GST document types: sales-invoices, fin-creditnote, fin-debitnote, sales-dispatch (challan), gate-out.
- The 16-character limit is data: setting gst.docNumber = {maxLength:16, charset:"A-Z0-9/-", effectiveFrom:"2017-07-01"}.

**GST UQC list** (einvoice1.gst.gov.in master codes — verify before go-live):
BAG BAL BDL BKL BOU BOX BTL BUN CAN CBM CCM CMS CTN DOZ DRM GGK GMS GRS GYD KGS KLR KME LTR MLT MTR
MTS NOS OTH PAC PCS PRS QTL ROL SET SQF SQM SQY TBS TGM THD TON TUB UGS UNT YDS.
Every UOM maps to exactly one UQC; OTH is allowed.

**GSTIN checks** (validator per ERRATA E-05):
- The check digit is validated.
- The first 2 digits must equal the unit's state code.
- Characters 3–12 must equal the company PAN.

**Comparison with other ERPs:**
- ERPNext Accounting Period and "Accounts Frozen Till" match our Soft-closed; Odoo lock dates match
  Soft-closed vs Closed.
- Odoo `no_gap` sequences use SELECT … FOR UPDATE, and so do we.
- Postgres sequences are never used for document numbers, because they leave gaps.

## 4. Database design (owner approval before applying any of these)
**M1 `<ts>_phase03_reference_data`:**
- gst_states (code char(2) PK, name, kind STATE/UT/OTHER, effective_from, effective_to).
  Seed the official list with needs_review.
- uqc_codes (code char(3) PK, description, effective_from, effective_to). Seed the 45 codes.
- Both are read-only to the API. They are reference data, not demo data.

**M2 `<ts>_phase03_org_masters`:**
- **companies** add:
  - tan (CHECK `^[A-Z]{4}\d{5}[A-Z]$`)
  - reg_line1, reg_line2, reg_city, reg_pincode (CHECK `^[1-9]\d{5}$`), reg_state_code (FK)
  - phone, email, website
  - logo_file_id (FK stored_files)
  - Backfill the old address into reg_line1; drop the old column in Phase 4.
- **units** add:
  - state_code (FK)
  - line1, line2, city, pincode
  - phone, email
  - manager_user_id
  - code_locked bool
  - CHECK: gstin is null, or substr(gstin,1,2) = state_code.
  - GSTIN is **not** unique, because units may share a registration.
- **departments** add:
  - head_user_id
  - parent_id (CHECK ≠ id)
  - The old head column is renamed legacy_head.
- **designations:**
  - code unique (`^[A-Z0-9-]{2,10}$`)
  - name unique, case-insensitive
  - grade, level 1–20
  - department_id, reports_to_id
  - status
- **currencies:**
  - code char(3) PK
  - name, symbol, decimals 0–4
  - is_base (partial unique)
  - status, version
  - Seed INR only (₹, 2 decimals, base).
- **exchange_rates:**
  - currency_code, rate_date, rate > 0 (₹ per 1 unit)
  - source MANUAL / RBI_REF / CUSTOMS / FEDAI
  - UNIQUE(currency_code, rate_date, source); never for the base currency.
- **uoms:**
  - code unique (`^[A-Z0-9]{1,10}$`), name unique
  - uom_class COUNT / WEIGHT / LENGTH / AREA / VOLUME / TIME / OTHER
  - decimals 0–6
  - uqc_code (FK, NOT NULL)
  - needs_review, status
  - Seed: NOS→NOS (0), SET→SET (0), KG→KGS (3), MTR→MTR (3), BOX→BOX (0), LTR→LTR (3), PCS→PCS (0).
- **uom_conversions:**
  - from_uom, to_uom, factor > 0
  - unique pair, from ≠ to
  - same class (checked by the service)
- **stored_files** (minimal, per ERRATA E-07).
- Every new FK gets an index.

**M3 `<ts>_phase03_fiscal_periods`:**
- fiscal_periods:
  - fy_id, period_no 1–12
  - code "Apr-2026", start_date (unique), end_date
  - status OPEN / SOFT_CLOSED / CLOSED
  - status_reason, status_changed_by_id, status_changed_at
  - UNIQUE(fy_id, period_no)
- Backfill 12 rows per existing FY. Periods of a CLOSED FY become CLOSED.

**M4 `<ts>_phase03_number_series_v2`:**
- Rename the old number_series to number_series_counters_old.
- **number_series** (definition):
  - doc_type (registry page id)
  - unit_id (null = all units, with a counter per unit)
  - prefix (`^[A-Z0-9]{1,6}$`), pattern
  - reset YEARLY / NEVER
  - start_value
  - gst_document bool
  - allocate_on CREATE / POST (GST ⇒ POST)
  - status
  - Partial unique: one ACTIVE series per (doc_type, unit).
- **number_series_counters:** series_id, unit_id, fy_id (nullable), next_value.
  Unique per (series, unit, FY).
- **number_allocations:**
  - series_id, unit_id, fy_id, value
  - number, doc_page, doc_id
  - status ISSUED / CANCELLED
  - allocated_by_id, allocated_at
  - Unique (series, unit, fy, value) and unique (doc_page, number).
- **Data migration:**
  - Create one series per existing page:
    - generic pages: `{PFX}/{UNIT}/{FY}/{#####}`;
    - inventory pages: `{PFX}/{UNIT}/{FY}/{####}`.
  - Copy the counters unchanged, so **the next number is exactly the same as before**.
  - Insert allocation rows for existing codes and voucher numbers.
  - Set code_locked on every unit that is already used.
  - Drop the old table.

**M5 `<ts>_phase03_master_moves`:**
1. **Move masters out of generic records:**
   - Move designations, currencies and UOM from generic_records into the typed tables (code from
     the data value, upper-cased).
   - A UOM without a UQC gets OTH + needs_review.
   - Hard-delete the moved generic rows and print the counts.
2. **Items:**
   - Match items.base_uom / alt_uom to a UOM by code or name; if none matches, insert one (OTH, needs_review).
   - Rewrite the item columns to the UOM code and add the FKs.
3. **Letterhead v2:**
   - Copy values into companies only where the company field is still empty.
   - Rewrite the setting to {footer, signatoryName, signatoryDesignation, signatureFileId, showLogo, paperSize:'A4'}.

## 5. Services, rules & algorithms
**NumberingService.allocate(docType, {unitId, fyId, date}, tx, vars?)** — replaces both old allocators:
1. Find the ACTIVE series for (docType, unit), otherwise the all-units series.
2. If none exists:
   - GST document → 409 SERIES_MISSING;
   - otherwise auto-create a default non-GST series (audited NUMBER_SERIES_AUTO_CREATED).
3. Insert the counter if missing, then SELECT next_value … FOR UPDATE.
4. Render the pattern. If it is longer than the limit (16 for GST, otherwise 40) → 409 SERIES_EXHAUSTED.
5. Increment next_value and insert the allocation row.
6. Call it as the **last** statement before commit. A rollback then leaves no gap.

**Pattern tokens:**
| Token | Meaning |
|---|---|
| {PFX} | the series prefix |
| {UNIT} | the unit code |
| {FY} | 26-27 |
| {FYS} | 2627 |
| {YYYY} / {YY} | FY start year |
| {#…#} | 3–8 digit counter, zero-padded |

Literal characters allowed: A–Z, 0–9, "-" and "/".

**Pattern rules:**
- exactly one number block;
- a yearly series needs an FY token;
- an all-units series needs {UNIT};
- a GST series needs {UNIT} and an FY token, and its longest possible number must be ≤ 16.

Default GST pattern: `{PFX}{UNIT}/{FYS}/{#####}`, for example "SITAL/2627/00001" (16 characters).

**Editing a series:**
- Pattern, prefix and reset are locked once numbers were issued in any OPEN FY → 409 SERIES_IN_USE.
  Deactivate it and create a new series.
- set-next may only raise the next number, needs a reason, and is audited.
- cancelAllocation(docPage, docId) marks a number cancelled. Phases 7–10 call it.

**Period guard — assertCanPost(date, actor, tx)** (used by every posting from now on; ERRATA E-08):
1. Lock the period row FOR SHARE.
2. The FY must be OPEN.
3. Then:
   - OPEN → allowed;
   - SOFT_CLOSED → allowed only with action `post` on admin-fy, otherwise 409 PERIOD_SOFT_CLOSED;
   - CLOSED → 409 PERIOD_CLOSED.
- Wire it now into the inventory post, dispatch, receive and cancel paths. A cancel reverses on
  the cancel date.

**Period transitions** (each locks the period row FOR UPDATE):
| Action | Rule |
|---|---|
| Soft-close a month | Earlier months must be at least soft-closed. |
| Close a month | Earlier months must be closed. |
| Reopen a month | Later months must not be closed. Closed → Open: SUPER_ADMIN only, reason ≥ 10 characters. Soft-closed → Open: ADMIN+. |
| Close the FY | All 12 months closed, and the FY is not the current one. |
| Reopen the FY | SUPER_ADMIN plus a reason. |

Creating an FY also creates its 12 periods, in one transaction.

**Units:**
- The state comes from the GSTIN.
- The check digit and the company-PAN match are verified.
- Changing a locked code → 409 CODE_LOCKED.

**Company:** a PAN change that disagrees with any unit GSTIN → 422, listing those units.

**Departments:**
- The head must be an active user.
- No cycles in the parent chain (check up to 20 levels).
- Delete is blocked while users, extra-department rows, controls, designations, child departments
  or document text still use the department.

**Currencies:**
- The base currency is locked (only its symbol can change).
- rateOn(code, date) returns the latest rate on or before the date. INR returns 1.

**UOM:**
- Code and decimals are frozen once any item uses the UOM.
- quantityValid(uom, qty) checks the number of decimal places.

**Letterhead:** renderLetterheadHeader(doc, {unitId?}) uses pdfkit + Noto fonts (ERRATA E-15).

**Kinds:** remove designations, currency and uom from the generic engine and make them typed pages,
together with admin-numbering.

## 6. API (/api/v1, {data, meta}, If-Match on writes, audited)
| Area | Endpoints |
|---|---|
| Company | GET/PATCH /company; POST /company/logo (PNG/JPEG checked by magic bytes, ≤ 512 KB) |
| Units | GET/POST/PATCH/DELETE /units; GET /reference/gst-states |
| Departments | GET/POST/PATCH/DELETE /departments |
| Designations | GET/POST/PATCH/DELETE /designations |
| Currencies | GET/POST/PATCH /currencies; GET/POST/DELETE /currencies/:code/rates; GET /currencies/:code/rate?date= |
| UOM | GET/POST/PATCH/DELETE /uoms; GET /reference/uqc; GET/POST/DELETE /uoms/conversions |
| Periods | GET /financial-years/:id/periods; POST /fiscal-periods/:id/{soft-close,close,reopen} {reason?} |
| Numbering | GET/POST/PATCH /number-series; POST /:id/{activate,deactivate}; POST /number-series/preview → {sample,length,maxLength,errors[]}; GET /:id/counters; POST /:id/counters/set-next {unitId,fyId,nextValue,reason}; GET /:id/allocations (with Excel export) |
| Letterhead | GET/PUT /settings/letterhead; POST /settings/letterhead/signature; GET /settings/letterhead/test.pdf?unitId= |
| Files | GET /stored-files/:id (authenticated, nosniff) |

## 7. UI & user flow (index.html look; plain labels)
- **Company:** sections "Legal & Tax Details", "Registered Office" and "Branding". The CIN hint reads
  "Printed on every letter and invoice."
- **Unit:** typing the GSTIN fills in the State and locks it. A locked code is greyed out with
  "Locked – already used in document numbers". Manager is chosen with a user picker.
- **Department:** "Reports to department" and a Head user picker. Delete shows the server's reason.
- **Financial Years → Period Calendar:** 12 rows with a coloured status pill. Buttons explain
  themselves: "Soft close – only Accounts heads can still post" and "Close – nobody can post".
  Reopening asks for a reason.
- **Document Numbering:**
  - Fields: Document type, Unit, "Short letters", "Number of digits", "Restart every financial year",
    "GST document".
  - The raw pattern sits under Advanced.
  - Live line: **"Next number will look like SITAL/2627/00001 — 16 of 16 characters"** (red when over).
  - Drawer tabs: Counters and Number Audit.
- **Designations / Currencies (Exchange Rates tab) / UOM (Conversions tab):** searchable UQC picker
  ("KGS – Kilograms") and a "Needs review" chip.
- **Letterhead & PDF:** live preview and a Test PDF button.

## 8. Exact messages
| Situation | Message |
|---|---|
| GSTIN check digit wrong | "Enter a valid 15-character GSTIN (check digit failed)." |
| GSTIN state mismatch | "GSTIN state 27 does not match the unit state 29." |
| GSTIN PAN mismatch | "GSTIN PAN part must equal the company PAN ABCDE1234F." |
| Pincode | "Enter a 6-digit PIN code." |
| TAN | "Enter a valid TAN (e.g. PNEA12345B)." |
| Locked unit code | "This unit code is already used in document numbers and cannot be changed." |
| Department cycle | "A department cannot report to itself or to one of its own sub-departments." |
| Inactive head | "Head must be an active user." |
| Designation code | "Designation code must be 2–10 capital letters, digits or '-'." |
| Base currency | "INR is the base currency and cannot be deactivated." |
| UOM without UQC | "Choose the GST UQC for this unit (use OTH – Others if none fits)." |
| UOM decimals locked | "Decimals cannot be changed: 12 items use this UOM." |
| Conversion class | "Conversion units must be of the same class (Weight ↔ Weight)." |
| No number block | "The pattern must contain exactly one number block like {#####}." |
| Yearly series without FY | "A yearly-restart series must include {FY}, {FYS} or {YY}." |
| GST number too long | "GST document numbers can be at most 16 characters; this pattern makes 19." |
| Bad characters | "Only capital letters, digits, '-' and '/' are allowed." |
| SERIES_IN_USE | "Numbers have already been issued from this series this year. Deactivate it and create a new series instead." |
| SERIES_MISSING | "Set up a number series for Sales Invoices (Talwade) in Document Numbering first." |
| SERIES_EXHAUSTED | "This series has run out of numbers within 16 characters. Create a new series." |
| set-next too low | "Next number can only be raised (highest issued is 00412)." |
| Soft-closed month | "Jun-2026 is soft-closed. Only users allowed to post in closed months can post here." |
| Closed month | "Jun-2026 is closed. Posting is not allowed." |
| Close out of order | "Close May-2026 first — months must be closed in order." |
| Reopen out of order | "Reopen Jul-2026 first — later months are closed." |
| FY close too early | "Close all 12 months before closing the year." |
| Missing reason | "A reason of at least 10 characters is required." |
| Bad logo | "Logo must be a PNG or JPEG of at most 512 KB." |

## 9. Audit
Every write records before/after:
- COMPANY_UPDATED, COMPANY_LOGO_CHANGED
- UNIT_*, DEPARTMENT_*, DESIGNATION_*
- CURRENCY_*, EXCHANGE_RATE_*
- UOM_*, UOM_CONVERSION_*
- PERIOD_SOFT_CLOSED / CLOSED / REOPENED (with reason)
- NUMBER_SERIES_*, NUMBER_COUNTER_SET (with reason)
- LETTERHEAD_UPDATED

Individual number allocations are recorded in number_allocations, not in the audit log.

## 10. Tests
- **Migrations:**
  - the next code after M4 equals the code before M4, for one generic page and one inventory page;
  - 12 periods per FY;
  - moved-master counts match;
  - item UOMs rewritten;
  - letterhead values copied.
- **Numbering:**
  - 50 parallel allocations → 1..50, no gaps, no duplicates;
  - a rolled-back transaction leaves no gap;
  - a 17-character GST pattern is refused and "SITAL/2627/00001" is accepted;
  - the character set is enforced;
  - SERIES_IN_USE, SERIES_MISSING and SERIES_EXHAUSTED;
  - set-next only goes up;
  - per-unit counters under one all-units series;
  - yearly reset.
- **Periods:**
  - the full transition matrix and ordering rules;
  - soft-closed posting with and without the grant;
  - a closed month is refused even for SUPER_ADMIN;
  - a close waits for an in-flight post;
  - FY close needs all 12 months closed.
- **GSTIN:** known-good and known-bad vectors; state and PAN match.
- **Masters:** unit code lock, department cycle and in-use checks, base currency, UOM decimals,
  conversion class.
- **Routing:** the 3 moved pages return 404 NOT_GENERIC from the generic API.
- **Playwright:**
  - setting TAL's GSTIN fills in the state;
  - the GST series preview shows 16 characters;
  - soft-close April;
  - a Member's April receipt is refused;
  - an ADMIN can post it.
- 3 clean runs.

## 11. Acceptance checks
- [ ] No admin master is stored in generic_records.
- [ ] Every inventory posting goes through assertCanPost.
- [ ] No hand-built number format remains; every number comes from allocate().
- [ ] Old documents keep their numbers, and new numbers continue the same sequence.
- [ ] A GST series that could exceed 16 characters cannot be saved.
- [ ] The letterhead uses only company and unit data.
- [ ] All System Setup tiles open working pages (Approval Matrix shows a "Phase 5" badge).
- [ ] Every master change is audited with before and after.

## 12. Out of scope
| Item | Owner |
|---|---|
| GST rates, HSN | Phases 6 / 11 |
| Cost centres, year-end carry-forward | Phase 7 |
| Live exchange-rate fetch | Never (R-12) |
| Employee counts | Phase 15 |
| Full print and attachments | Phase 4 |
| Approval behaviour | Phase 5 |

## 13. Owner manual check
**On screen:**
- Company Master shows CIN, PAN and the registered office, and Test PDF prints them at the top.
- Typing TAL's GSTIN fills State = Maharashtra (27).
- The Sales Invoices numbering preview says "16 of 16 characters".
- Period Calendar shows Apr-2026 to Mar-2027; soft-closing April works and appears in Period Audit.
- The UOM list shows KG mapped to KGS – Kilograms.

**Ask your accountant:**
- Are the invoice prefixes right (SI, CN, DN, DC)?
- Do the three units share one GSTIN?
- Who, besides Admin, may post in soft-closed months?

## 14. Build prompt
~~~
Read CLAUDE.md, docs/phases/STANDARDS.md, ROADMAP.md, ERRATA.md and PHASE-03.md, then
apps/api/src/modules/{company,units,financial-years,departments,settings,module-controls}/*,
modules/records/{service,repository}.ts, modules/inventory/vouchers/service.ts, engine/kinds.ts,
apps/web/src/pages/admin/*. Never push/commit unless asked. Show SQL for M1–M5 and get the owner's
approval before applying; apply locally and to the test DB only.
Order:
1 M1–M3 + packages/statutory (GSTIN/PAN per ERRATA E-05) + assertCanPost wired into inventory
  post/dispatch/receive/cancel;
2 M4 + core/numbering; replace nextNumber() and numbered() with allocate(); prove next codes unchanged;
3 typed designations/currencies/uoms modules; remove from GENERIC_ADMIN_PAGES;
4 M5 data moves + Letterhead v2 with stored_files + LocalDiskStorage + pdfkit Test PDF;
5 web pages and tiles in the index.html look;
6 tests §10, 3 clean runs.
No Postgres sequences for document numbers; no GST numbers at draft; no demo data.
Write PHASE-03-REPORT.md listing every DB change.

