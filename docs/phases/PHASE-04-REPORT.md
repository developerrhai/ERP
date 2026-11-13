# Phase 04 Completion Report — Generic engine v2 + documents + print

**Date**: 06-11-2026 (IST)
**Status**: BUILT LOCALLY, NOT COMMITTED, NOT DEPLOYED — waiting for owner review (see §7 for what is not green and why)
**Spec**: `docs/phases/PHASE-04.md` (a DRAFT written by Claude on 06-11-2026 because the original file was an empty stub; the owner told Claude to build it as written, with the §12 proposals as defaults)
**Governing standard**: `docs/phases/STANDARDS.md`, `docs/phases/ROADMAP.md`, `CLAUDE.md`

## 1. What was built

| Step | Result |
|------|--------|
| 1 Migrations | 3 migrations written, SQL shown to the owner, applied on owner's "yes" to `rhai_erp`, `rhai_erp_test`, `rhai_erp_e2e` (never the old `erp`) |
| 2 Dependencies | `pg-boss 10.4.2`, `busboy 1.6.0` (runtime); `harfbuzzjs 1.6.4`, `@types/busboy 1.5.5` (dev). `pdfkit` and `@types/pdfkit` were already there from Phase 3. Fonts committed under `apps/api/assets/fonts` |
| 3 Lock matrix | `engine/lock-matrix.ts`; used by update, remove, restore, status, submit, documents (C6); bulk delete goes through remove |
| 4 Commands | `kit/commands.ts` rewritten on Postgres idempotency; no `Map` result cache, no `any`; web `kitApi.ts` types updated; kit contract tests green |
| 5 Documents | `core/storage` (existing), `core/scan`, `modules/documents`, busboy upload pipeline |
| 6 PDF | `core/pdf` with script runs; T-PDF-01 gate passes before templates were written |
| 7 Export / jobs | CSV + xlsx fixes, background export, pg-boss started in `server.ts`, Phase 1 cleanup scheduled in `maintenance` |
| 8 Import | `modules/imports` wizard backend + jobs |
| 9 Summary / quality / submit | endpoints, submit, bulk submit |
| 10 Web | phase map, server dashboard + quality, Documents tab + drawer panel, Submit Selected, drawer Submit, Import wizard, Reports extras, PDF buttons, print CSS |
| 11 Tests | see §6 |

## 2. DATABASE CHANGES (all of them)

All three migrations are in `apps/api/prisma/migrations/` and mirrored in `schema.prisma`.

### 2.1 `20261110000000_phase04_m1_files_documents`
* `stored_files` + `scan_status VARCHAR(12) NOT NULL DEFAULT 'PENDING'` (CHECK PENDING / CLEAN / INFECTED / SKIPPED), `scan_detail VARCHAR(200)`, `scanned_at TIMESTAMPTZ(3)`. Existing rows (letterhead logos) are set to `SKIPPED`.
* New table `record_documents` (`id`, `page_id`, `record_id → generic_records` RESTRICT, `file_id → stored_files` RESTRICT, `doc_type`, `title`, `created_by_id`, `created_at`, `deleted_by_id`, `deleted_at`); partial index on `record_id WHERE deleted_at IS NULL`; index `(page_id, created_at)`.

### 2.2 `20261110010000_phase04_m2_idempotency_v2`
* `idempotency_keys` + `scope VARCHAR(160) DEFAULT 'records:create'`, `state` (RUNNING / DONE / FAILED, CHECK), `response_code INT`, `response_body JSONB`, `expires_at TIMESTAMPTZ(3) DEFAULT now() + 24 h`; `record_id` becomes nullable.
* Primary key changes from `(user_id, key)` to `(user_id, scope, key)`; index `idempotency_keys_expires_idx`.

### 2.3 `20261110020000_phase04_m3_import_export_jobs`
* New table `data_jobs` (`kind` EXPORT / IMPORT_VALIDATE / IMPORT_COMMIT, `page_id`, `unit_id`, `fy_id`, `status` QUEUED / RUNNING / DONE / FAILED / CANCELLED, `params JSONB`, `input_file_id`, `output_file_id`, row counts, `error_summary JSONB`, `created_by_id`, timestamps, `expires_at`); index `(created_by_id, created_at DESC)`.

### 2.4 Created at runtime, not by our migrations
* pg-boss creates its own schema `pgboss` (tables for queues, jobs, schedules) in the database it connects to when the API starts (`server.ts` → `startJobs`). It is library-managed; do not edit it by hand. On a production deploy the DB user needs `CREATE` on the database for the first start.

### 2.5 Data (not schema) changes
* No seed rows added. No RBAC rows added (`submit`, `export`, `add` already exist; import uses `add` + `export`).
* Files go to `storage/uploads` on the API host (local disk behind `StorageProvider`); exports are removed after 7 days by `maintenance`.

## 3. Decisions taken (owner said "use my proposals")
Lock-matrix table as in PHASE-04 §5 C6; documents on generic pages only; types PDF / PNG / JPG / XLSX / DOCX / CSV, 10 MB, 20 per record; import is all-or-nothing and needs `add` + `export`; `expectedVersion` body fallback is kept; sync export limit 5,000, async 50,000, files kept 7 days; Noto fonts committed.

## 4. Deviations from the draft (and why)
* **`harfbuzzjs` stays a dev dependency** (as the owner listed). Shaping at runtime is done by pdfkit's fontkit; HarfBuzz is the independent oracle in the gate test only.
* **Missing `If-Match` is `400`**, not `428` (the project's existing `parseIfMatch` behaviour, used by every PATCH).
* **Status change out of a terminal status stays `422`** (old contract) while edit/delete/submit/documents answer `409 RECORD_LOCKED`.
* **Commands answer `{data, result}`**: `result` is a deprecated alias so the existing kit contract tests stay green.
* **`transactional pages: Pending → Open`** is no longer possible by hand (only Cancel); the approval engine (Phase 5) will move Pending records.
* Duplicate detection in the import is: identical rows inside the file = error; a name that already exists = warning. The engine has no natural-key concept yet.

## 5. Files outside Phase 4 that had to be touched
* `tests/e2e/e2e-env.mjs`: the e2e Super Admin password contained the login id ("owner"), which the Phase 1 password policy rejects, so the e2e DB could not even be seeded. Replaced by policy-compliant test-only values.
* `tests/e2e/auth.spec.ts`: one assertion carried the pre-Phase-1 login error text.
* `tests/phase4-fixes.test.ts`: the test "a Cancelled record can still be deleted and restored" encoded the old behaviour that the lock matrix (ROADMAP R-09) intentionally removes.
* `apps/web` `fieldModel.ts` phase numbers now follow `docs/phases/ROADMAP.md` (they still used the old plan's numbers).

## 6. Test results
Three runs, each starting from a freshly reset database (`rhai_erp_test` is reset by the vitest global setup, `rhai_erp_e2e` by the e2e launcher). Each run: API typecheck, web typecheck, API Phase 4 + kit suites, the whole web suite, the Phase 4 e2e spec.

| Run | API type errors | Web type errors | API Phase 4 + kit | Web (all) | E2E `phase4b` |
|-----|-----------------|-----------------|-------------------|-----------|---------------|
| 1 | 0 | 0 | 17 files, 169 tests pass | 37 files, 350 tests pass | 4 / 4 |
| 2 | 0 | 0 | 17 files, 169 tests pass | 37 files, 350 tests pass | 4 / 4 |
| 3 | 0 | 0 | 17 files, 169 tests pass | 37 files, 350 tests pass | 4 / 4 |

Run 3 was interrupted by the machine running low on memory during its e2e step; only that step was repeated (after stopping a leftover test server on port 4100) and it passed 4 / 4.

The API suites in the table: `lock-matrix`, `idempotency-v2`, `documents`, `pdf-gate` (T-PDF-01), `pdf-template`, `export-safe`, `phase4-engine` (lock matrix via API, submit / bulk submit, summary / quality, CSV / PDF, 5,000-row cap, background export, crashed-job redelivery, stale-job maintenance, import wizard incl. rollback with gap-free numbers), `phase4-records`, and the nine `kit-*` contract suites.

Not run three times: the full API suite and `npm run verify` (see §7), and the earlier-phase e2e specs (`auth`, `phase2`, `phase3`, `phase4`, `phase5`): in one full e2e run 11 passed, 6 failed and 32 were skipped, all in those earlier specs (for example the "create an Admin" screen after roles v2).

## 7. Not green, and not caused by Phase 4
The repository already had failing tests before this phase (uncommitted Phase 1–3 work: roles v2, scope, admin masters now "custom", password policy, env checks). The full API run shows 58 such failures in 15 files (`permissions`, `phase2-review`, `meta-audit`, `auth-login`, `access`, `phase4-fixes` ×2, `phase4-schema`, `kit-registry`, `rbac-matrix`, `production-config`, `phase3-users`, `rate-limit-env`, `phase02-roles`, `password`, `auth-session`, `inv-migration-m1`), plus API lint errors in `kit/` and the web `kit/` folder. Because of that `npm run verify` cannot be green at the repository level; Phase 4 files are lint-clean and Phase 4 suites are green. These need their own clean-up pass; I did not touch them.
