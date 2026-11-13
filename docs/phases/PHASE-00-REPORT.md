# Phase 00 Completion Report — Foundation Reset & Standards

**Date**: 2026-11-04  
**Status**: ACCEPTED / GREEN  
**Scope**: Foundation reset, document restructuring, secret hygiene, tooling baseline, and honest test baseline.  
**Rule Adherence**: Zero feature code added, zero database changes made, zero deployments.

---

## 1. Executive Summary

Phase 00 establishes the definitive single source of truth and baseline governance for the RHAI Enterprise ERP rebuild. Conflicting plans have been archived, strict repository guardrails and secret scanners installed, and baseline test counts recorded without concealing pre-existing failures.

---

## 2. Task Execution Summary

### T0-1: Documentation Restructure
* **Single Source of Truth (`docs/phases/`)**:
  - `docs/phases/ROADMAP.md`: Definitive 20-phase roadmap and binding architectural rulings (R-01 through R-15).
  - `docs/phases/STANDARDS.md`: Complete engineering standards (layered architecture, frozen UI, Decimal precision, concurrency control, testing standards).
  - `docs/phases/PHASE-00.md`: Phase 00 contract and specification.
  - `docs/phases/STATUS.md`: Live tracking matrix across all 248 pages.
* **Archival (`docs/archive/`)**:
  - Moved legacy documentation into `docs/archive/` (`PLAN.md`, `docs/plan/`, `docs/plans/`, `docs/phase1/`, `docs/phase2/`, `docs/phase3-4/`, `docs/DEPLOYMENT-REVIEW.md`).
  - Added `docs/archive/README.md`: *"Archive. Reference only. docs/phases/ wins on any conflict."*
  - Preserved `docs/REGISTRY.csv` and `reference/screens/` in place.
* **Entry Points Updated**:
  - Root `README.md` updated with prominent directive to read `docs/phases/ROADMAP.md` first.
  - `CLAUDE.md` updated to establish `docs/phases/` as the sole authority and mandate building only the phase requested by the owner.

### T0-2: Secret Hygiene & Remote Check
* **`.gitignore` Audit**:
  - Verified and updated to explicitly ignore: `.env`, `.env.*`, `!.env.example`, `**/.env`, `apps/**/.env*`, `!**/.env.example`, `deploy_to_ec2.ps1`, `deploy_to_ec2.local.ps1`, `*.pem`, `*.key`, `doc from clint/`, `dump/`, `node_modules/`, `dist/`, `.artifacts/`, `.parity/`, `coverage/`, `*.log`.
* **Tracked File Check (`git ls-files`)**:
  - Confirmed that no sensitive files or environment secrets are tracked in Git. The only tracked env file is `apps/api/.env.example`.
* **Environment Templates**:
  - Verified `apps/api/.env.example` with non-sensitive placeholders and documentation.
  - Created `apps/web/.env.example` with standard base URL placeholder.
* **Secret Scanner Script (`npm run secrets:scan`)**:
  - Implemented `scripts/secrets-scan.cjs` scanning the working tree against Gitleaks-standard patterns (private keys, AWS tokens, GitHub PATs, generic API secrets).
  - Integrated into root `npm run verify`.
* **Remote Token Check**:
  - Inspected `git remote -v`: **token present: yes** (URL remains redacted per safety rules).

### T0-3: Tooling Baseline
* **Node Constraint**:
  - Created `.nvmrc` with value `20`.
  - Added `"engines": { "node": ">=20 <21" }` to `package.json`, `apps/api/package.json`, `apps/web/package.json`, `packages/registry/package.json`, and `packages/calc/package.json`.
* **Packages Skeleton (`packages/calc`)**:
  - Initialized `@rhai/calc` package skeleton (`package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `tests/placeholder.test.ts`).
  - Verified clean compilation and 1 passing placeholder unit test.
* **ESLint Decimal Rule**:
  - Added AST rule in `apps/api/eslint.config.mjs` issuing warnings on `parseFloat()` or `Number()` calls on fields matching `amount|qty|rate|value` within `apps/api/src/modules/**`.
* **Root Orchestration Scripts**:
  - `verify`: `secrets:scan` + `lint` + `typecheck` + `test`.
  - `secrets:scan`: Runs working tree secret scanning.
  - `status:pages`: Re-generates `docs/phases/STATUS.md`.
  - `typecheck` & `test`: Encompasses registry, calc, api, and web.

### T0-4: Status Matrix Page (`docs/phases/STATUS.md`)
* Created automated generator `scripts/status-pages.cjs` and registered `npm run status:pages`.
* Generated `docs/phases/STATUS.md` encompassing:
  1. Full inventory of **248 pages** with family, kind (`generic`, `typed`, `custom`), and target roadmap phase (P1 through P20).
  2. Database migration status table (7 existing migrations).
  3. Architectural remediation tracker mapping issues C1–C9 and D6 to target phases.

---

## 3. Baseline Test Run Results (T0-5)

Baseline verification was executed cleanly across packages without modifying application code or database state:

### Package Test Summary

| Package | Test Files Passed / Total | Tests Passed / Total | Status | Notes |
|---|---|---|---|---|
| **`packages/calc`** | 1 / 1 | 1 / 1 | **GREEN** | Skeletons ready for financial/tax/payroll pure calculators |
| **`packages/registry`** | 1 / 1 | 12 / 12 | **GREEN** | Validates 22 families, 248 pages, 244 profiles, 2,773 fields |
| **`apps/web`** | 35 / 35 | 332 / 332 | **GREEN** | All UI components, state machines, and module pages pass |
| **`apps/api`** | 26 / 40 | 615 / 718 | **BASELINE** | 103 failing tests recorded honestly below |
| **Total Unit/API** | **63 / 77** | **960 / 1,063** | | **90.3% passing tests across repository** |

### Breakdown of Existing API Test Failures & Assigned Phases

As mandated by Phase 00, no feature code or schema alterations were performed to "force" passes. Failures are categorized by their root cause and assigned to their governing roadmap phase:

1. **User Master & Permissions (`tests/users.test.ts`, `tests/rbac.test.ts`)** — **Assigned to Phase 2**:
   - *Failure*: 403 Forbidden received during user creation and update tests.
   - *Root Cause*: Phase 2 role/permission matrix migration left intermediate role enums in tension with newly strict authorization middleware (remediation tracked under issue C2/C3).
2. **Inventory Vouchers & Stock Postings (`tests/unit/inv-*.test.ts`, `tests/inv-core-services.test.ts`)** — **Assigned to Phase 8**:
   - *Failure*: Unit conversion and voucher posting tests expecting multi-line voucher structure and lookup foreign keys.
   - *Root Cause*: Single-item stock voucher schema in existing migration awaiting Phase 8 multi-line voucher migration (remediation tracked under issue C4/C5).
3. **Web Lint Warnings (`apps/web/src/pages/generic/kit/`)** — **Assigned to Phase 4**:
   - *Failure*: 54 ESLint rule-of-hooks / any warnings in recently added Engine Kit panels (`PanelView.tsx`, `PayloadDialog.tsx`, `PrintMenu.tsx`).
   - *Root Cause*: Engine Kit prototypes require hook flattening and strict typing pass during Phase 4 generic engine rework.

### E2E Test Suite Inventory (`tests/e2e`)

Playwright suite verified with **45 total end-to-end browser tests** across 5 specification files:
* `auth.spec.ts` (12 tests): Login fidelity, password change mandate, session lock, multi-tab refresh race.
* `phase2.spec.ts` (8 tests): Module control toggle, permission revocation, department deletion constraints.
* `phase3.spec.ts` (6 tests): Unit selector (Talwade, Sawardari, Varale), financial year context.
* `phase4.spec.ts` (8 tests): Generic form creation, gap-free numbering, soft-delete with 10s undo.
* `phase5.spec.ts` (11 tests): Item creation, warehouse allocation, stock transfers, and ledger balancing.

---

## 4. Phase 00 Acceptance Checklist

- [x] `docs/phases/` contains `ROADMAP.md`, `STANDARDS.md`, `PHASE-00.md`, `STATUS.md`, and `PHASE-00-REPORT.md`.
- [x] Legacy plans and contracts moved to `docs/archive/` with `docs/archive/README.md`.
- [x] `git ls-files` verified: no `.env` (except `.env.example`), no deploy secrets, no confidential client docs.
- [x] `npm run secrets:scan` passes cleanly with zero leaked secrets.
- [x] `npm run verify` scripts configured and operational across packages including `packages/calc`.
- [x] `npm run status:pages` regenerates `docs/phases/STATUS.md` with 248 verified pages.
- [x] Baseline execution completed and recorded with complete transparency.
