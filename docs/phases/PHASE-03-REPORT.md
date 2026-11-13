# Phase 03 Completion Report — Organisation Masters

**Date**: 05-11-2026 (IST)  
**Status**: COMPLETE / GREEN  
**Governing Standard**: docs/phases/STANDARDS.md, docs/phases/ROADMAP.md, docs/phases/ERRATA.md, CLAUDE.md  
**Scope**: Company Master statutory fields (PAN/CIN/State Code), Unit Master statutory fields, Financial Years lifecycle (OPEN/CLOSED, single current invariant, period posting guard), Typed Masters (Designations, Currencies, UOMs), Number Series allocation engine, Letterhead v2 with file storage & PDF streaming, `packages/statutory` GSTIN/PAN validator, and frontend admin interfaces.

---

## 1. Executive Summary

Phase 03 establishes the organizational and master data foundation for the Sawant Group ERP:

1. **Company & Units (M1)**:
   - Upgraded Company Master with statutory fields (`pan`, `cin`, `state_code`), contact details (`email`, `phone`, `website`), and address.
   - Upgraded Unit Master with `state_code`, `city`, `pincode`, and GSTIN validation.
   - Enforced single-company architecture (R-01) and 3 active units (TAL, SAW, VAR per R-02).

2. **Financial Years & Periods (M2)**:
   - Added `status` (`OPEN` or `CLOSED`) and partial unique index guaranteeing exactly one `is_current = TRUE` financial year.
   - Built lifecycle endpoints (`set-current`, `close`, `reopen`).
   - Wired `assertCanPost` guard into all inventory transaction lifecycle transitions (`post`, `dispatch`, `receive`, `cancel`), immediately halting transaction processing when the document date falls in a closed financial year with standard `409 PERIOD_CLOSED`.

3. **Statutory Integrity (`packages/statutory`)**:
   - Created `@rhai/statutory` package with pure unit-tested statutory validators.
   - Implemented standard ISO 7064 Mod 11, 2 for Indian PAN validation.
   - Implemented Luhn Mod-36 algorithm for Indian 15-character GSTIN checksum validation conforming to ERRATA E-05 (fixing the alphanumeric alphabet `0-9A-Z`).
   - Mapped 2-digit Indian GST state codes with names.

4. **Typed Masters (M3)**:
   - Created dedicated, typed modules replacing legacy generic records for:
     - **Designations** (`/api/v1/designations`): authority levels (1–100), optional department linkage, active status.
     - **Currencies** (`/api/v1/currencies`): ISO-4217 3-letter codes, single Base Currency invariant (`INR` base rate = 1.0, non-base rates > 0), decimal places (0–4).
     - **Units of Measure (UOM)** (`/api/v1/uoms`): standard categories (`COUNT`, `WEIGHT`, `LENGTH`, `VOLUME`, `AREA`, `TIME`, `OTHER`), precision decimals (0–4), active status.
   - Removed `admin-designations`, `admin-currency`, and `admin-uom` from `GENERIC_ADMIN_PAGES`.

5. **Document Numbering Engine (M4)**:
   - Created `number_series` table and `NumberingService.allocate` replacing PostgreSQL sequences and previous `nextNumber()` implementations.
   - Uses `SELECT ... FOR UPDATE` row-level pessimistic locking for concurrency and gap-free guarantees.
   - Supports configurable pattern tokens: `{PREFIX}`, `{UNIT}`, `{FY}`, `{YYYY}`, `{YY}`, `{MM}`, `{PAD<n>}`.
   - Verified 10 and 20 parallel create calls produce strictly consecutive, gap-free numbers without collisions.

6. **Letterhead v2 & Storage (M5)**:
   - Created `stored_files` table with SHA-256 integrity verification, MIME detection, and byte count.
   - Implemented `LocalDiskStorage` provider storing assets in `apps/api/storage/files` with path safety and directory partitioning.
   - Upgraded `settings.letterhead` schema: `logoFileId`, `primaryColor`, `accentColor`, `showGstin`, `showPan`, `showCin`, `footerText`.
   - Implemented `pdfkit` PDF streaming generator with logo rendering, header accent bars, statutory blocks, and test PDF endpoint (`POST /api/v1/settings/letterhead/test-pdf`).

7. **Web Application Updates**:
   - **Company Master (`CompanyMasterPage.tsx`)**: Full form with statutory inputs, live GSTIN/PAN validation, dirty-state diffing, and ETag/If-Match concurrency.
   - **Unit Master (`UnitMasterPage.tsx`)**: Modal inputs for state code, city, pincode, with live GSTIN format and state code matching.
   - **Letterhead Designer (`LetterheadPage.tsx`)**: Live visual preview, primary color hex picker with presets, logo upload via `POST /api/v1/files`, header toggle checkboxes, and working "Test PDF" download button.
   - **Typed Master Pages**: Created `DesignationMasterPage.tsx`, `CurrencyMasterPage.tsx`, and `UomMasterPage.tsx` matching the `index.html` look with search, filters, add/edit modals, and delete confirmations.
   - **System Setup Navigation (`SystemSetupPage.tsx`)**: Verified 9 prototype tiles navigate to the newly built modules.

---

## 2. Database Changes

### Migrations Added
The following forward-only hand-written SQL migrations were applied to `rhai_erp` and `rhai_erp_test`:

1. `20261109000000_phase03_m1_company_units`
   - Added columns to `companies`: `pan VARCHAR(10)`, `cin VARCHAR(21)`, `state_code VARCHAR(2)`.
   - Added column to `units`: `state_code VARCHAR(2)`.
   - Added check constraints on state code formatting.

2. `20261109010000_phase03_m2_financial_year_periods`
   - Added `status VARCHAR(10) NOT NULL DEFAULT 'OPEN'` to `financial_years` with `CHECK (status IN ('OPEN', 'CLOSED'))`.
   - Created unique partial index `idx_financial_years_single_current ON financial_years (is_current) WHERE is_current = TRUE`.

3. `20261109020000_phase03_m3_typed_masters`
   - Added `department_id UUID REFERENCES departments(id) ON DELETE SET NULL` to `designations`.
   - Added `status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'` to `designations`.
   - Added unique index on `currencies(code)` and `uoms(code)`.

4. `20261109030000_phase03_m4_numbering_series`
   - Created `number_series` table:
     - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
     - `doc_type VARCHAR(60) NOT NULL`
     - `unit_id UUID REFERENCES units(id) ON DELETE CASCADE`
     - `fy_id UUID REFERENCES financial_years(id) ON DELETE CASCADE`
     - `prefix VARCHAR(20) NOT NULL`
     - `pattern VARCHAR(120) NOT NULL`
     - `current_number INTEGER NOT NULL DEFAULT 0`
     - `padding INTEGER NOT NULL DEFAULT 4`
     - `status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'`
     - Audit columns (`version`, `created_at`, `updated_at`, `created_by_id`, `updated_by_id`)
   - Unique partial indexes for scoping by document type, unit, and financial year.

5. `20261109040000_phase03_m5_stored_files_letterhead`
   - Created `stored_files` table:
     - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
     - `filename VARCHAR(255) NOT NULL`
     - `content_type VARCHAR(100) NOT NULL`
     - `byte_size BIGINT NOT NULL`
     - `sha256 VARCHAR(64) NOT NULL`
     - `storage_path VARCHAR(500) NOT NULL`
     - Audit columns (`created_at`, `created_by_id`)
   - Updated `settings.letterhead` schema with stored file references.

---

## 3. API Endpoints

### Company & Units
- `GET /api/v1/company` — Fetch single company with ETag and statutory fields.
- `PATCH /api/v1/company` — Update company statutory and contact information (requires If-Match).
- `GET /api/v1/units` — List units with state code and GSTIN.
- `POST /api/v1/units` — Create unit with statutory validation and uppercase code.
- `PATCH /api/v1/units/:id` — Update unit (requires If-Match).
- `DELETE /api/v1/units/:id` — Delete unit (prevents deleting units in use).

### Financial Years
- `GET /api/v1/financial-years` — List financial years.
- `POST /api/v1/financial-years` — Create financial year (validates Indian April 1 to March 31 dates).
- `PATCH /api/v1/financial-years/:id/set-current` — Atomically set single active financial year.
- `PATCH /api/v1/financial-years/:id/close` — Close financial year against posting.
- `PATCH /api/v1/financial-years/:id/reopen` — Reopen financial year.

### Typed Masters
- `GET /api/v1/designations`, `POST /api/v1/designations`, `PATCH /api/v1/designations/:id`, `DELETE /api/v1/designations/:id` — Designations CRUD.
- `GET /api/v1/currencies`, `POST /api/v1/currencies`, `PATCH /api/v1/currencies/:id`, `DELETE /api/v1/currencies/:id` — Currencies CRUD with Base Currency protection.
- `GET /api/v1/uoms`, `POST /api/v1/uoms`, `PATCH /api/v1/uoms/:id`, `DELETE /api/v1/uoms/:id` — Units of Measure CRUD.

### File Storage & Letterhead
- `POST /api/v1/files` — Upload stored file (Base64 payload, returns file metadata).
- `GET /api/v1/files/:id` — Stream stored file binary with Content-Type.
- `GET /api/v1/settings/letterhead` — Retrieve letterhead settings v2.
- `PUT /api/v1/settings/letterhead` & `PATCH /api/v1/settings/letterhead` — Update letterhead settings (requires If-Match).
- `POST /api/v1/settings/letterhead/test-pdf` — Stream rendered test PDF document.

---

## 4. Deviations from Phase File

None. All features follow the rulings:
- R-01: Exactly one company, no `company_id` columns.
- R-02: 3 units (TAL, SAW, VAR).
- R-10: Local disk storage behind `StorageService` interface, server-side `pdfkit`.
- ERRATA E-05: Mod-36 checksum algorithm for GSTIN validation.

---

## 5. Verification & Test Results

### 3 Consecutive Clean Test Runs

All test runs were executed from a clean database reset (`npm --prefix apps/api run db:reset:test`).

#### Run 1 (10:41:06 IST)
- **Database Reset**: `rhai_erp_test` cleanly dropped, migrated, and seeded.
- **Packages**:
  - `packages/statutory`: 1 test file, **8 passed clean** (618ms).
- **Backend API (`apps/api`)**:
  - Command: `npx vitest run tests/phase3-masters.test.ts tests/phase3-context.test.ts tests/typed-masters.test.ts tests/numbering-service.test.ts tests/letterhead-v2-storage.test.ts tests/assert-can-post.test.ts tests/inv-core-services.test.ts`
  - Results: **7 test files, 111 passed clean** (39.57s).
- **Frontend Web (`apps/web`)**:
  - Command: `npm --prefix apps/web test`
  - Results: **36 test files, 338 passed clean** (83.69s).

#### Run 2 (10:43:42 IST)
- **Database Reset**: `rhai_erp_test` cleanly dropped, migrated, and seeded.
- **Packages**:
  - `packages/statutory`: 1 test file, **8 passed clean** (645ms).
- **Backend API (`apps/api`)**:
  - Command: `npx vitest run tests/phase3-masters.test.ts tests/phase3-context.test.ts tests/typed-masters.test.ts tests/numbering-service.test.ts tests/letterhead-v2-storage.test.ts tests/assert-can-post.test.ts tests/inv-core-services.test.ts`
  - Results: **7 test files, 111 passed clean** (38.51s).
- **Frontend Web (`apps/web`)**:
  - Command: `npm --prefix apps/web test`
  - Results: **36 test files, 338 passed clean** (64.35s).

#### Run 3 (10:45:58 IST)
- **Database Reset**: `rhai_erp_test` cleanly dropped, migrated, and seeded.
- **Packages**:
  - `packages/statutory`: 1 test file, **8 passed clean** (615ms).
- **Backend API (`apps/api`)**:
  - Command: `npx vitest run tests/phase3-masters.test.ts tests/phase3-context.test.ts tests/typed-masters.test.ts tests/numbering-service.test.ts tests/letterhead-v2-storage.test.ts tests/assert-can-post.test.ts tests/inv-core-services.test.ts`
  - Results: **7 test files, 111 passed clean** (37.80s).
- **Frontend Web (`apps/web`)**:
  - Command: `npm --prefix apps/web test`
  - Results: **36 test files, 338 passed clean** (61.36s).

### Build & Security Verification
- **`npm --prefix apps/api run build`**: Exit code 0 (TypeScript strict build clean).
- **`npm --prefix apps/web run build`**: Exit code 0 (Vite production bundle clean).
- **`npm run secrets:scan`**: Scanned 572 files across working tree. Zero secrets detected.

---

## 6. Known Issues

None.

---

## 7. Manual Check List for the Owner (Clicks to Try)

1. **Company Master Statutory Fields**:
   - Navigate to `/m/admin-company`.
   - Verify PAN, CIN, and State Code fields render.
   - Enter an invalid GSTIN (e.g., `27AAACR1234A1Z0`); confirm validation blocks submit. Enter valid `27AAACR1234A1Z5`; confirm green validation indicator.
   - Click "Save Changes" and observe green toast.

2. **Unit Master State Code**:
   - Navigate to `/m/admin-branches`.
   - Click "＋ Add Unit".
   - Confirm State Code dropdown is present with Indian States.

3. **Financial Year Single Current Invariant**:
   - Navigate to `/m/admin-financial-years`.
   - Select FY 2025-26 and click "Set as Current".
   - Confirm FY 2025-26 receives the "Current" badge and FY 2026-27 is unmarked.
   - Click "Close FY" on FY 2025-26; confirm badge changes to "Closed".

4. **Letterhead v2 Designer & PDF Download**:
   - Navigate to `/m/admin-letterhead`.
   - Pick a primary accent color using the color swatches (e.g., `#0f766e`).
   - Toggle "Show GSTIN", "Show PAN", "Show CIN" checkboxes; observe the live preview updating instantly.
   - Click "Test PDF" button in the upper right.
   - Confirm a valid PDF downloads and opens with the configured logo, colors, and company details.

5. **Designation Master**:
   - Navigate to `/m/admin-designations`.
   - Click "＋ Add Designation".
   - Enter Code `TECH-LEAD`, Name `Technical Lead`, Level `40`. Select Department `Production`.
   - Click Save; verify the new row appears in the table with level badge `40`.

6. **Currency Master Base Currency Protection**:
   - Navigate to `/m/admin-currency`.
   - Observe `INR` with the "Base Currency" badge and exchange rate `1.000000`.
   - Click Edit on `INR`; confirm Base Currency checkbox is locked.
   - Add currency `USD` with rate `86.500000`; verify it saves and lists cleanly.

7. **UOM Master Categories**:
   - Navigate to `/m/admin-uom`.
   - Click "＋ Add UOM".
   - Verify category dropdown shows `COUNT`, `WEIGHT`, `LENGTH`, `VOLUME`, `AREA`, `TIME`, `OTHER`.
   - Create UOM `KG` (Weight, 3 decimals). Verify created row displays decimals `3`.

8. **System Setup Navigation**:
   - Navigate to `/admin/setup`.
   - Click on the tiles ("Company Master", "Unit Master", "Designations", "Currency Master", "Unit of Measure", "Letterhead Designer").
   - Confirm all tiles navigate cleanly to their respective pages.
