# Phase 20 Go-Live Readiness Checklist (`docs/PROGRESS.md`)

- [x] **Multi-process core (`20-A`):** Postgres rate-limit store (`rate_limit_hits` + fail-open global / fail-closed auth), `LISTEN/NOTIFY` cache bus (`erp_cache`), `pg_advisory_lock('erp:boot-seed')`, pool caps (`connection_limit=10`, `pg-boss max=5`, `ARGON2_MAX_CONCURRENCY=4`), two-process proxy harness (`tests/e2e/start-api-cluster.mjs`), cross-process replay/rate-limit/cache-bus test (`apps/api/tests/phase20-multiprocess.test.ts`).
- [ ] **Two-process E2E 3x green (`20-A`):** Run 3 consecutive clean runs on `rhai_erp_e2e` with `start-api-cluster.mjs` during pre-cutover verification.
- [ ] **k6 load thresholds met (`20-E`):** Run `tests/perf/k6-suite.js` against `_perf` / staging and archive report in `docs/perf/`.
- [x] **Code, Secrets & Security baselines (`20-F`):** `npm run secrets:scan` clean; ASVS L2 sheet (`docs/security/asvs-l2.csv`), `.github/workflows/security-zap.yml`, `.gitleaks.toml`, `infra/nginx/sawant-erp.conf`, `apps/web/vercel.json` headers & `docs/security/rotation-checklist.md`.
- [ ] **Owner Secret Rotation (`D1–D13`):** Owner executes `docs/security/rotation-checklist.md` prior to go-live.
- [ ] **Amazon RDS PostgreSQL + PITR + Restore Drill (`20-K`):** Provision RDS in `ap-south-1` and execute `infra/release/restore-drill.sh` recording `RTO <= 4 h`.
- [ ] **S3 Document Bucket Migration (`20-C`):** Provision `sawant-erp-prod-docs-aps1` (KMS + TLS-only + EC2 IAM role) and run `npx tsx tools/migrate-files-to-s3.ts`.
- [x] **Audit Partitioning & Role Split (`20-D`):** `audit_logs` monthly range partitioned (`20261202010000_phase20_b_audit_partitioning`), `ensure_audit_partitions(3)` pg-boss job, `erp_app` restricted to `SELECT + INSERT`, 0 unindexed FKs (`tools/verify-fk-indexes.ts`).
- [ ] **CloudWatch Alarms Live Test (`20-B`):** Deploy `infra/cloudwatch/agent-config.json` & `alarms.json` and trigger one test alarm to SNS topic.
- [ ] **Opening Balances Reconciled & Signed at 0 Difference (`20-G`):** Execute all 6 datasets (`GL_TRIAL`, `STOCK`, `AR_OPEN`, `AP_OPEN`, `EMPLOYEES_YTD`, `ASSET_REGISTER`, `OPEN_PO_SO`) via Cut-Over Console and capture dual CFO + Dept Head sign-offs.
- [ ] **UAT Signed & March 2027 Parallel Run Closed (`20-L`):** Execute `docs/uat/UAT-PACKS.md` and sign department packs.
- [x] **Hindi UI & WCAG 2.1 AA Accessibility (`20-H`, `20-I`):** `react-i18next` EN/HI toggle saved to `users.preferred_locale`, all keys matched in `hi.json`, minimum `12px` CSS typography, `axe-core` tests passing with 0 serious/critical issues.
- [x] **DPDP Notice, Request Register & Retention Job (`20-J`):** English/Hindi/Marathi privacy notices seeded, first-login modal, 30-day SLA request register, retention anonymisation sweep, and `docs/dpdp/breach-runbook.md`.
- [ ] **CA / HR Head `needs_review` Sign-Off (R-23 / ERRATA E-30):** Owner CA & HR Head review statutory tables & DPDP dates prior to cut-over.
- [ ] **Zero Demo Data Verification:** Verify production DB has zero seeded test/demo transactions before opening to plant users.

## Phase 36 - UI parity with V40 (2026-11-14)
Part A mostly done (264 forms through the screens), Part B done (327 pages x V40/ERP, 5 roles), Part C partly done: 0 pages "not found" (was 43), P0 43 -> 0, average UI score 15.4 -> 20.0, V40 head-row buttons on every page, type-ahead pickers and GST totals panel on documents, V39 Home cards, no sideways scroll at tablet width. Open: V36 tabs, full document layout, inline styles, Lighthouse/axe, remaining feed steps. See docs/phases/PHASE-36-REPORT.md.
