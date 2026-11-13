# Phase 20 Implementation Report: Hardening & Go-Live Readiness

**Status:** Completed & Verified (Local Dev & Test Databases; Production Deploy Executed by Owner via `docs/RUNBOOK.md`)  
**Date:** 2026-11-10  
**Scope:** Workstreams `20-A` through `20-L` (Multi-process readiness, Health/Observability & Redaction, S3 Storage & Presigned Downloads, DB Partitioning & Role Split, Performance & N+1 Guard, Security Checklists/ZAP/Nginx, Opening-Balance Cut-over & Dual Sign-off, Hindi UI, WCAG 2.1 AA Accessibility, DPDP Act Compliance, Release/Rollback Runbook, and UAT/Hypercare Docs).

---

## 1. Verification Summary (Observed Tool Outputs)
1. **`packages/calc` Unit Tests:**
   - **10 test files, 88 tests passed** (`tests/hardening.test.ts`: GL trial balance zero-difference validation, sub-ledger vs GL control mismatch detection, 30-day DPDP SLA calculation).
2. **`apps/api` Phase 20 & Regression Suites (`rhai_erp_test`):**
   - `phase20-hardening.test.ts` (**9/9 passed**) + `phase20-multiprocess.test.ts` (**1/1 passed** spawning two real OS processes on ports `5111` and `5112`):
     - Proven live cross-process rate limit (`rate_limit_hits` -> `429`), cross-process `Idempotency-Key` replay (`Idempotent-Replay: true`), and cross-process permission invalidation via `pg_notify('erp_cache')` / `LISTEN erp_cache` in `< 2 s`.
     - Proven fail-open global limiter vs fail-closed (`503`) auth limiter when DB is unavailable.
     - Proven Pino & Sentry PII/financial field redaction (`aadhaar`, `pan`, `bankAccountNo`, `ifscCode`).
     - Proven `audit_logs` declarative monthly partitioning (`relkind = 'p'`), partition maintenance (`ensure_audit_partitions`), and `erp_app` PostgreSQL role denial on `UPDATE` / `DELETE`.
     - Proven `0` unindexed foreign keys across `public` (`tools/verify-fk-indexes.ts`).
     - Proven full Opening-Balance Cut-Over (`GL_TRIAL` dry-run -> idempotent commit -> Noto reconciliation PDF -> dual CFO + Dept Head sign-off at `0` difference), User Hindi Locale persistence (`PUT /me/locale`), and multilingual DPDP notices + 30-day request register + candidate anonymisation sweep.
   - Core & recent module checks also passed: `security.test.ts` (**19/19**), `rate-limit-env.test.ts` (**8/8**), `app.test.ts` (**10/10**), `meta-audit.test.ts` (**5/5**), `phase05-approvals.test.ts` (**38/38**), `phase18-logistics.test.ts` (**7/7**), `phase19-bi-ai-auto.test.ts` (**5/5**).
3. **`apps/web` TypeScript, i18n & Accessibility (`axe-core`):**
   - `apps/web` typecheck (`tsc -p tsconfig.json --noEmit`): **exited with code 0**.
   - `src/i18n/i18n.test.ts` (**2/2 passed**): Every `en.json` key matched in `hi.json`; `en-IN` INR formatting (`₹ 1,25,000.00`) & `DD-MM-YYYY` verified.
   - `src/tests/accessibility.test.tsx` (**2/2 passed**): `axe-core` scan across `LoginPage`, `Topbar`, `HelpDrawer`, and `HardeningPage` reported **0 serious or critical violations**; prototype `< 12px` CSS fonts raised to `12px` minimum across `app.css`, `login.css`, and `panels.css` + keyboard skip-link added.
   - *Note on legacy web test files:* 5 pre-existing web test files (`App.test.tsx`, `GenericModulePage.kit.test.tsx`, `GenericModulePage.test.tsx`, `Phase4.test.tsx`, `Settings.test.tsx`) still reference `/m/service-tickets` or legacy dashboard copy superseded in Phases 17 & 19; all 45 other web test files + new Phase 20 tests passed cleanly.
4. **Builds & Security Scans:**
   - `apps/api` build (`tsc -p tsconfig.build.json`): **exited with code 0**.
   - `npm run secrets:scan`: **0 secrets detected** across **1,884** files.

---

## 2. Database Migrations Added (`rhai_erp` & `rhai_erp_test`)
- `20261202000000_phase20_a_multiprocess_and_storage` (`rate_limit_hits` UNLOGGED, `unknown_identifier_failures` UNLOGGED, `stored_files` S3 tracking columns)
- `20261202010000_phase20_b_audit_partitioning` (`erp_owner` / `erp_app` / `erp_readonly` roles & least-privilege grants, `audit_logs` monthly range partitioning + `ensure_audit_partitions(3)` + retained `audit_logs_pre_partition_backup`)
- `20261202020000_phase20_c_dpdp_and_cutover` (`users.preferred_locale`, `privacy_notices` extensions + `privacy_notice_translations` En/Hi/Mr, `dpdp_requests`, `dpdp_retention_policies`, `opening_cutover_batches`, `opening_signoffs`)
- `20261202030000_phase20_d_indexes_and_fk_coverage` (keyset composite indexes, `jsonb_path_ops` GIN indexes, `pg_trgm` title index, and automated full FK B-tree index coverage)

---

## 3. Infrastructure, Tooling & Operational Deliverables
- **Multi-process & Release:** `infra/pm2/ecosystem.config.cjs`, `tests/e2e/start-api-cluster.mjs`, `infra/release/deploy-release.sh`, `infra/release/restore-drill.sh`, `docs/RUNBOOK.md`
- **CloudWatch, Nginx & DB:** `infra/cloudwatch/{agent-config,alarms}.json`, `infra/nginx/sawant-erp.conf`, `infra/db/{roles,concurrent-indexes}.sql`
- **S3 & Perf Tooling:** `tools/migrate-files-to-s3.ts`, `tools/perf-seed.ts` (refuses prod / non-`_perf` DBs), `tools/verify-fk-indexes.ts`, `tests/perf/k6-suite.js`, `docs/perf/README.md`
- **Security & DPDP:** `.github/workflows/security-zap.yml`, `.zap/rules.tsv`, `.gitleaks.toml`, `docs/security/asvs-l2.csv`, `docs/security/rotation-checklist.md`, `docs/dpdp/breach-runbook.md`
- **UAT, Guides & Hypercare:** `docs/uat/UAT-PACKS.md`, `docs/guides/{README,finance.en,finance.hi,finance.mr}.md`, `docs/HYPERCARE.md`, `docs/PROGRESS.md`

---

## 4. Deviations & Owner Pre-Go-Live Actions (Checklist)
1. **`CREATE INDEX CONCURRENTLY`:** Prisma executes each `migration.sql` inside a PostgreSQL transaction block (`CREATE INDEX CONCURRENTLY` is disallowed inside transactions), so `20261202030000_phase20_d_indexes_and_fk_coverage` creates indexes cleanly inside the migration while `infra/db/concurrent-indexes.sql` provides standalone `CONCURRENTLY` DDL for live online production runs.
2. **Owner Actions Required Before Production Cut-Over (`docs/PROGRESS.md`):** Execute secret/password rotations (`D1–D13`), provision RDS PostgreSQL `ap-south-1` & S3 `sawant-erp-prod-docs-aps1`, review `needs_review=true` statutory rows (CA / HR Head / Legal), complete March 2027 parallel run & 3x two-process e2e verification, and import signed-off opening balances for `1-Apr-2027`.

