# apps/api: Phase 3 (Stage A) choices and deviations

These are the places where the API makes a choice that `docs/phase3-4/CONTRACT.md` Stage A leaves open, or differs from it. Phase 1 and 2 choices stay in `README-PHASE1.md` and `README-PHASE2.md`.

## Data

- **Migration `20261103000000_phase3_context`** creates `companies`, `units`, `financial_years`, `user_units`, `user_preferences` and `users.default_unit_id`. It also **inserts the company, the 3 units and the 2 FYs itself** (not only the seed), so that in the same migration every existing MANAGER / LEAD / MEMBER gets all 3 units (`user_units`). ADMIN and SUPER_ADMIN get no rows: they have every unit implicitly.
- **Seeded names:** units `TAL` "Talwade", `SAW` "Sawardari", `VAR` "Varale" (the "(Unit 1/2/3)" in the contract is their order, kept by `created_at`). FY `2025-26` (OPEN) and `2026-27` (OPEN, current), labels "FY 2025-26" / "FY 2026-27".
- **DB rules beyond Prisma:**
  - `companies`: at most one row (unique index on a constant), code `^[A-Z0-9]{2,20}$`, currency `^[A-Z]{3}$`.
  - `units`: code `^[A-Z0-9]{2,10}$`, name 2–100.
  - `financial_years`: start is 1 April, end = start + 1 year − 1 day, code = `YYYY-YY` of those years, a closed year is never current, and a partial unique index allows only one `is_current`. With the unique start date, this makes overlapping years impossible.
  - `user_preferences.all_units` (see below) is never true together with a unit id.
- **FKs:** `user_units.unit_id` and `users.default_unit_id` are RESTRICT (so a referenced unit cannot be deleted); `user_units.user_id` CASCADE; `user_preferences.unit_id` / `fy_id` SET NULL.
- **Units are not linked to `companies`** (there is exactly one company). `req.ctx.companyId` is that row's id.
- **Seed (`src/core/seed/phase3-defaults.ts`)**, run by `npm run db:seed`, at server boot and in the test global setup. Insert-if-missing only, never an update. The company is checked on every run (it cannot be deleted). Units and FYs are applied **once** and recorded in the existing `system.seed` setting (`units`, `financialYears`), like Phase 2 departments, so a unit an admin deleted is not re-created. A seeded FY is only made current if no year is current yet.
- **Module controls:** the migration switches `enabled` and `allow_add/edit/delete/export` back on for the 24 Administration pages if they had been switched off (see the orchestrator decision below).

## Context (`src/core/context/resolve-context.ts`)

- **Header values.** `X-Unit-Id` is a unit uuid, or `all` (any case) for "All units". `X-FY-Id` is an FY uuid. A missing or blank header falls back.
- **Errors.**
  - A malformed value, an unknown unit id or an unknown FY id → **422 `CONTEXT_INVALID`**.
  - An existing unit that is INACTIVE, or not assigned to a non-admin, and `all` from a non-admin → **403 `CONTEXT_FORBIDDEN`**.
  - An inactive unit is refused for SUPER_ADMIN too.
- **Fallbacks.** Unit: the saved preference (if still active and accessible; "All units" only if still ADMIN+) → `users.default_unit_id` (if active and accessible) → the first accessible active unit in Unit Master order. FY: the preference → the current FY (→ newest open → newest).
- **Edge cases.** A non-admin with no active unit gets `unitId: null, allUnits: false` (no unit). An ADMIN+ when no unit is active at all gets "All units".
- **`req.ctx = {companyId, unitId, fyId, allUnits}`.** `allUnits` is added so Stage B can tell "All units" apart from "no unit".
- **Closed FYs are valid context.** Reads work. The write rule (409 `PERIOD_CLOSED`) is Stage C.
- **"All units" is not refused by `resolveContext` itself**, because Phase 2/3 admin writes (users, departments, units, …) are company-wide and an admin working in "All units" must still be able to edit them. Instead, `requireConcreteUnit` (exported, tested) is the guard Stage B/C put on unit-scoped writes: it returns 422 `CONTEXT_INVALID` for "All units" or no unit.
- **Where it is mounted.** After `authenticate` + `requirePasswordChanged` on every authenticated business router: `/users`, `/departments`, `/roles`, `/permissions`, `/department-access`, `/module-controls`, `/settings`, `/audit-logs`, `/company`, `/units`, `/financial-years`.
  - **Not** on `/auth/*`, `/meta/*`, `/health` or `/me/*`. The web can therefore always reach `/me/context` (and `/auth/me`, `/me/menu`) to recover from a stale header, e.g. after a unit was deactivated.
  - The middleware does not cache; unit access changes take effect on the next request. The access-profile cache is still cleared on every unit or user-unit write.
- **Sent but not yet used.** Stage A modules do not filter by unit (none is unit-scoped). The context is validated and exposed for Stage B.

## Endpoints

- **`GET /me/context` ignores the context headers** and reports `current` from the preference / default / first unit, so it is always the way back. `fys` is newest first. `units` are the caller's ACTIVE accessible units (all active units for ADMIN+). Sent with `Cache-Control: no-store`.
- **`PUT /me/context`.**
  - The body is `{unitId: uuid|null, fyId: uuid}`; both keys are required and unknown keys are refused. A missing key or wrong shape → 422 `VALIDATION_ERROR`. Bad or forbidden ids → the same 422 `CONTEXT_INVALID` / 403 `CONTEXT_FORBIDDEN` as the headers.
  - It returns the full `GET /me/context` body.
  - It writes an audit row `CONTEXT_CHANGED` (targetType `User`) only when the choice actually changed. "Audit every write" is applied literally; a repeat of the same choice writes nothing.
- **Preference storage.** "All units" is stored as `user_preferences.all_units = true` with `unit_id = null`, not as a bare null, so that a SET NULL after a unit delete is never read as "All units".
- **`/company`.**
  - `GET` and `PATCH` (If-Match, ETag).
  - Editable: `legalName`, `tradeName`, `pan`, `cin`, `gstin`, `address`. **`code`, `currency` and `timezone` are read-only** (sending them → 422 "Unknown field."), as the web expects.
  - GSTIN / PAN / CIN use the letterhead patterns, upper-cased; `''` clears them to null.
  - A no-op PATCH keeps the version and writes no audit row. Audit: `COMPANY_UPDATED`.
- **`/units`.**
  - `GET` (all units, including inactive, with `userCount` = explicit `user_units` rows; optional `?status=`), `POST`, `PATCH /:id` (If-Match), `DELETE /:id` (optional If-Match, checked if present; 204).
  - No `GET /units/:id` (not in the contract).
  - The code may be changed, as for departments. Voucher numbers issued later embed the unit code as text; revisit in Stage B if codes must be frozen once used.
  - The name is unique case-insensitively (checked before insert).
  - **`DELETE`:** 409 `IN_USE` while any user has the unit in `user_units` or as `default_unit_id`. A later FK (warehouses, records) violating RESTRICT also maps to 409 `IN_USE`.
  - Audit: `UNIT_CREATED` / `UNIT_UPDATED` / `UNIT_DELETED`.
- **`/financial-years`.**
  - **`POST` accepts any of `code`, `startDate`, `endDate`, `label`, all optional.** An empty body adds the year after the latest one. The values must agree (422 otherwise). The start must be 1 April and the end 31 March of the next year. The year range is 2000–2098.
  - A year that already exists (same code or start date, which is the "overlap" case) → **409 `DUPLICATE`** with `fields.code`.
  - Past years may be added too (e.g. `2024-25`); gaps are not refused.
  - **`PATCH /:id`** changes only `label` (If-Match required).
  - **`POST /:id/set-current`, `/close`, `/reopen`** take an optional If-Match, checked if present. They are no-ops (no audit) when already in that state.
  - **Errors:** setting a CLOSED year current → **409 `CONFLICT`**; closing the current year → **409 `CONFLICT`**. Both are new uses of the existing `CONFLICT` code.
  - All FY writes run under one advisory lock, so parallel set-current calls are serialised and exactly one year stays current.
  - There is no FY delete (not in the contract).
  - Audit: `FINANCIAL_YEAR_CREATED` / `_UPDATED` / `_SET_CURRENT` / `_CLOSED` / `_REOPENED`.
- **Permissions:** `view` / `controls` on `admin-company`, `admin-branches` and `admin-fy` through `requirePageAction`. These are Administration pages, so they are ADMIN+ only, whatever the table says.
- **CORS:** `X-Unit-Id` and `X-FY-Id` added to `allowedHeaders`.

## Users

- **Create:**
  - `unitIds` (uuid array, no duplicates) is **required with ≥ 1 entry for MANAGER / LEAD / MEMBER**. For ADMIN it is optional.
  - Every unit must exist and be ACTIVE.
  - `defaultUnitId` (nullable) must be one of `unitIds`. An ADMIN with no `unitIds` may default to any active unit.
  - If no default is given, it stays null (the context falls back to the first unit).
  - The hierarchy (403) is still checked before the unit rules (422).
- **Update:**
  - `unitIds` replaces the set.
  - A unit that is already assigned and was deactivated may stay; a newly added one must be active.
  - A default that is no longer among the units is cleared automatically, unless a `defaultUnitId` was sent explicitly; then it must be valid, otherwise 422.
  - Demoting an ADMIN (with no unit rows) to MANAGER / LEAD / MEMBER without `unitIds` → 422 `fields.unitIds`.
  - A unit change bumps `users.version`, is part of the `USER_UPDATED` before/after (`unitIds`, `defaultUnitId`) and clears the access cache.
- **ADMIN+ and stored units.** ADMIN+ keep any stored `user_units` rows (used if they are demoted later). Their access is "all units" regardless.
- **The DTO** (also in `/auth/login`, `/auth/refresh`, `/auth/me`) gains `units:[{id,code,name}]` (explicit rows, in Unit Master order) and `defaultUnitId`. For ADMIN+, `units` lists only the explicit rows; the UI should show "All units" for them.
- **`GET /users?unitId=`** returns users assigned to that unit **plus every ADMIN / SUPER_ADMIN** (they may work in every unit). A malformed id → 422.

## Orchestrator decision (2026-11-02), implemented

- **Administration module-control flags are locked.** On any Administration-family page, `PATCH /module-controls/:pageId` with `allowAdd`, `allowEdit`, `allowDelete` or `allowExport` = `false` → **409 `PROTECTED`**, for the owner too (as for `enabled: false`). `true` and the other fields are unchanged.
- **Existing tests updated.**
  - The Phase 2 test that switched `admin-users` add/edit off through the API now writes the row directly to the DB. `decide()` still honours such a row.
  - The `admin-audit` `allowExport:false` check now expects 409.

## For the orchestrator (not API code)

- `packages/registry` titles still need renaming: **"Branches" → "Unit Master"** and **"Companies" → "Company Master"** (the API only reads titles from the registry, so nothing else changes here).

## Test notes

- `tests/helpers.ts` `makeUser` now gives MANAGER / LEAD / MEMBER all 3 seeded units by default (like the migration), with `unitCodes` / `defaultUnitCode` overrides.
- Existing tests that create non-admin users through the API now send `unitIds`. Tests that demote an admin give that admin one unit row first.
- **New test files:**
  - `phase3-context.test.ts`: the resolution matrix, mount points, CORS, and `/me/context`.
  - `phase3-masters.test.ts`: company, units, FYs, DB constraints, the module-control lock and the seed.
  - `phase3-users.test.ts`: user unit rules, the list filter and the DTO.
- `tests/phase3-helpers.ts` snapshots and restores company / units / FYs around tests that change them.
