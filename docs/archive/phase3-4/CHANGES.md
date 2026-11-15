# Phase 3 / 4 / Inventory slice — What changed and why

Spec: [`CONTRACT.md`](CONTRACT.md). API choices: `apps/api/README-PHASE3.md` (and `README-PHASE4.md` once Stage B is done).

Progress: **Stages A and B are done and verified.** Stage C (products and inventory) is in progress.

## Stage A — Company, Units, Financial Years, real context (done)

### What you can now do
| Screen | What it does | Why |
|---|---|---|
| **Top bar → Unit** | Switch between Talwade, Sawardari, Varale. Super Admin and Admin also get **All Units**. The choice is remembered | Your three manufacturing units are now real, not a decoration |
| **Top bar → Financial year** | Pick the FY (closed years are marked). The choice is remembered | Stock, vouchers and numbering will be per FY |
| **Company Master** (`admin-company`) | Edit the company's legal name, GSTIN, PAN, CIN, address. Code, currency and timezone are fixed | One company, as in your setup |
| **Unit Master** (`admin-branches`, renamed from "Branches") | Add, edit, activate/deactivate units. A unit with users cannot be deleted | The prototype's "Branches" are your manufacturing units |
| **Financial Years** (`admin-fy`) | 2025-26 and 2026-27 are seeded (2026-27 is current). Add the next year, set the current year, close and reopen. The current year cannot be closed | Indian FY (1 Apr – 31 Mar), exactly one current |
| **User Master → Units** | Each Manager, Lead and Member must be given at least one unit and a default unit. Admins work in all units | A user in Talwade does not see Varale's data |

### Rules enforced on the server
* The browser sends the chosen unit and FY with every request. The server checks the user really has that unit. A faked unit is refused.
* "All Units" is allowed only for Admin and above, and only for reading.
* Administration modules cannot have Add/Edit/Delete/Export switched off. This stops anyone from locking everybody out of user management.

### Bug found by the final test run
The audit entry for "user units changed" listed unit ids in whatever order the database returned them, so a test passed or failed by chance. It is now sorted, which makes the entry stable.

### Files
**API (`apps/api`)**

| File | Why |
|---|---|
| `prisma/migrations/20261103000000_phase3_context` | Tables for company, units, financial years, user↔unit, preferences. Seeds the 3 units and 2 years, and gives the 10 existing managers all 3 units |
| `src/core/context/*` | `resolveContext`: validates the unit and FY on every request |
| `src/modules/{company,units,financial-years}` | The three master APIs, layered like Phase 2 |
| `src/modules/me/context-service.ts` | `GET/PUT /me/context` |
| `src/core/seed/phase3-defaults.ts` | Idempotent defaults |
| `src/core/http/field-schemas.ts` | GSTIN/PAN/CIN validation shared by company, units and letterhead |
| `tests/phase3-{context,masters,users}.test.ts` | 90 tests |

Changed: users (units on create/edit, `?unitId=` filter), module-controls (Administration lock), app wiring and CORS headers.

**Web (`apps/web`)**

| File | Why |
|---|---|
| `src/lib/context*.ts`, `shell/ContextSelectors.tsx` | The real Unit and FY selectors; ask before discarding unsaved edits |
| `pages/admin/{CompanyMaster,UnitMaster,FinancialYears}Page.tsx` | The three admin pages |
| `components/ContextChips.tsx` | Dept / Role / Unit / FY chips |
| `lib/unsaved.ts` | Unsaved-edit guard used by pages that keep drafts |
| `lib/registry.ts` | Relabels "Companies" to "Company Master" and "Branches" to "Unit Master" (the extracted registry stays a faithful copy of the prototype) |

**Tests:** API 498, web 194, and end-to-end **26 scenarios** (6 new in `tests/e2e/phase3.spec.ts`), each green on 3 consecutive runs from a fresh database.

## Stage B — Generic page engine (done and verified)

About 206 standard pages now open as real registers. Each has the prototype's 16 tabs, and is tied to the selected unit and financial year.

### What you can now do on a standard page (e.g. Lead Management)
| Feature | How it works | Why |
|---|---|---|
| **Add** | The form is generated from the page's fields: dates, ₹ amounts, % scores, drop-downs, GSTIN/PAN checks. Errors show under the field | One engine for all pages, so nothing is hand-built 200 times |
| **Document number** | Automatic and gap-free, e.g. `LEA/TAL/26-27/00001` (page, unit, financial year, counter). 5 people saving at the same moment get 5 consecutive numbers | Audit-friendly numbering |
| **Edit / Delete / Undo** | Delete is soft: a 10-second "Undo" brings it back. A changed-by-someone-else warning protects against overwriting | The prototype deleted for ever |
| **Search, filter, sort, page size, select-all, Excel export** | Real, on the server. Excel cells starting with `=` are neutralised so a malicious value cannot run as a formula | Formula-injection safety |
| **Unit and year isolation** | A record belongs to one unit and one FY. Talwade does not see Sawardari. Admins can view All Units, but cannot save in "All Units" | Your three plants stay separate |
| **Data scope** | Member sees only own records; Manager sees the department; Admin sees all. Someone else's record by direct link gives 404 | Role rules from Phase 2, now applied to data |
| **Closed year** | Writes to a closed financial year are refused | Period lock |
| **Dashboard, Data Quality, Audit tabs** | Real numbers computed from the page's data and its audit trail. Ordinary users see the audit of what they can see | No fake numbers |
| **Other tabs** | Say honestly "This view is built in Phase N" | Approvals, documents, AI etc. come later |

### Types and required fields were corrected
The first type guess reproduced silly cases from the prototype's heuristics (Priority as money, Account Name as a number, Monthly Cost as a date). All 2,773 fields were reviewed and fixed, e.g. Priority is a drop-down, any "Name" is text, "Consent Status" is a drop-down. The corrected table is `apps/api/tests/fixtures/field-types.json`, and `docs/plan/04-modules.md` was regenerated from it. A test fails if a "Name"/"Description"-type label ever becomes numeric again. The "required" rule applies only to real **document dates** (Order Date, Invoice Date), not to follow-up, planned or outcome dates (Next Follow-up, Promise Date, Actual Date).

### Also in this stage
* Designations, Currency, UOM and Taxes (Administration) are now editable masters (Admin only).
* End date before start date is refused (leave, contracts, projects).
* The audit trail has per-page and per-record endpoints scoped by the user's data access.
* The register's **View / Edit / Delete are fixed on screen** (they were off-screen to the right at normal width).

### Files
**API:**

| Folder / file | Why |
|---|---|
| `src/engine/*` | `classify` (field typing), `field-schema` (page schemas), `record-input` (validation), `date-order`, `overrides/` (drop-down options) |
| `src/modules/records/*` | List, create, get, edit, delete/restore, status, bulk, Excel export |
| `prisma/migrations/20261104000000_phase4_generic_records` | `generic_records` (searchable), `number_series`, `idempotency_keys` |
| `tests/phase4-*.test.ts`, `engine-classify.test.ts`, `fixtures/*` | Includes a test that creates, edits, deletes and restores a record on **every one of the 206 generic pages** |

**Web:** `src/pages/generic/*` (GenericModulePage, RegisterTab, RecordFormModal, RecordDrawer, ModuleTabs, LookupCombobox, RecordActions, engineApi, fieldModel).

### Test results (each green on 3 consecutive runs from a fresh database)
API **579**, web **246**, end-to-end **34** (8 new in `tests/e2e/phase4.spec.ts`).

### Known limitation (found in testing)
If you reload the page twice within a split second, the second reload can sign you out. The first reload's session refresh is cancelled after the server has already rotated the cookie, so the browser keeps an old cookie. This is the price of rotating refresh tokens (it makes stolen cookies useless). It should rarely happen to a person, and signing in again fixes it. The tests avoid it by waiting for the page to settle between navigations.

## Stage C — Product → Inventory (planned)
Item Master, Warehouse Master per unit, Opening Stock, Receipt/Issue, Transfer between units, Adjustment, Stock Balance and the stock ledger (append-only, no negative stock, moving-average cost).
